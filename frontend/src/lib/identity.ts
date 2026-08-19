// Face-match identity continuity (Identity Spec §4.5, CLAUDE.md invariant 12).
//
// On-device only. The embedding is computed here, held here, and compared here.
// Only a score and a decision ever reach the server. No embedding and no frame
// is transmitted or stored server-side, and `assertNoBiometricContent` below is
// the runtime check on that rather than a comment asking nicely.
//
// What this module is and is not
// ------------------------------
// It holds the DECISIONS. The matcher itself lives in `faceMatcher.ts`, which
// loads MediaPipe and ONNX Runtime; keeping them apart means the part that can
// actually harm somebody stays testable without several megabytes of WASM.
//
// Every decision here is enforcement-aware. In `shadow` the checks run and
// their verdicts are recorded, and nothing is allowed to refuse entry or raise
// a flag — see `Enforcement` in identityConfig.ts for why that state exists
// rather than simply waiting.

import type { MetadataEvent } from "./eventLogger";
import {
  DEFAULT_COHORT,
  IDENTITY_THRESHOLDS,
  assertUsable,
  mayEnforce,
  thresholdsFor,
  type CohortId,
  type IdentityThresholdConfig,
} from "./identityConfig";

// --- the matcher seam -------------------------------------------------------

/** An opaque face embedding. Never serialised into an event, a manifest, or a
 *  network request — see `assertNoBiometricContent`. */
export type FaceEmbedding = { readonly kind: "face-embedding"; readonly values: Float32Array };

export interface FaceMatcher {
  /** True when a model is loaded and matching can actually happen. */
  readonly available: boolean;
  /** Compute an embedding from a live video frame. */
  embed(frame: ImageData): Promise<FaceEmbedding | null>;
  /** Cosine similarity in [-1, 1]; higher is more similar. */
  compare(a: FaceEmbedding, b: FaceEmbedding): number;
}

/** The shipped matcher. Does nothing, on purpose.
 *
 *  Identity matching is registered `spec` and below the release gate, and its
 *  thresholds are unvalidated. Until both change, the honest implementation is
 *  one that cannot produce a decision — not one that produces decisions nobody
 *  has checked. */
export const disabledMatcher: FaceMatcher = {
  available: false,
  async embed() {
    return null;
  },
  compare() {
    throw new Error("identity matching is disabled: no matcher is configured");
  },
};

// --- enrollment -------------------------------------------------------------

export type AssuranceLevel = "L1" | "L2" | "L3";

export type EnrollmentState =
  | { status: "none" }
  /** Declining is a first-class outcome, recorded with the version of the
   *  request that was declined. It is never a blocker. */
  | { status: "declined"; consentVersion: string; at: number }
  | { status: "enrolled"; consentVersion: string; at: number; embedding: FaceEmbedding };

/** The consent version for biometric enrollment.
 *
 *  Separate from capture consent and versioned independently, because agreeing
 *  to be recorded and agreeing to be biometrically matched are different
 *  agreements and a person may reasonably give one and refuse the other.
 *  Bundling them would make the refusal unexpressible. */
export const ENROLLMENT_CONSENT_VERSION = "biometric-enrollment-2026-08-15";

export type EnrollmentSource = "live-capture" | "uploaded-file";

export type EnrollmentRefusal = { reason: "not_live" | "no_face" | "matcher_unavailable" | "config"; message: string };

/** Enroll from a live, liveness-checked capture.
 *
 *  `source` is checked rather than trusted. An uploaded photograph can be
 *  anyone's, so enrolling from one would let a candidate register a face that
 *  is not theirs and then pass every subsequent check as the person in the
 *  photo. Existing profile avatars are display-only and are never an
 *  enrollment artifact; there is no code path from one to here.
 *
 *  Returns the embedding only. The frame is not returned, not cached, and goes
 *  out of scope with this call. */
export async function enroll(
  frame: ImageData,
  source: EnrollmentSource,
  matcher: FaceMatcher = disabledMatcher,
  config: IdentityThresholdConfig = IDENTITY_THRESHOLDS
): Promise<{ state: EnrollmentState } | { refusal: EnrollmentRefusal }> {
  if (source !== "live-capture") {
    return {
      refusal: {
        reason: "not_live",
        message:
          "Enrollment requires a live camera capture. An uploaded image cannot be shown to " +
          "belong to the person enrolling, and would let every later check pass as someone else.",
      },
    };
  }
  // `assertUsable` now refuses only an incoherent configuration — unvalidated
  // ENFORCEMENT, a missing cohort, inverted thresholds. Enrolling under shadow
  // is exactly what should happen: the reference is needed to produce the
  // scores that would validate the thresholds.
  const refusal = assertUsable(config);
  if (refusal) return { refusal: { reason: "config", message: refusal.message } };
  if (!matcher.available) {
    return { refusal: { reason: "matcher_unavailable", message: "Identity matching is not enabled." } };
  }

  const embedding = await matcher.embed(frame);
  if (!embedding) {
    return { refusal: { reason: "no_face", message: "No face was detected. Face the camera and try again." } };
  }
  return {
    state: { status: "enrolled", consentVersion: ENROLLMENT_CONSENT_VERSION, at: Date.now(), embedding },
  };
}

/** Record a declined enrollment. Never throws, never blocks.
 *
 *  Returns the narrow variant rather than the union, so a caller can read the
 *  declined consent version without narrowing — declining is a recorded
 *  decision, not an absence, and the type says so. */
export function decline(): Extract<EnrollmentState, { status: "declined" }> {
  return { status: "declined", consentVersion: ENROLLMENT_CONSENT_VERSION, at: Date.now() };
}

/** Which assurance level actually applied, and why.
 *
 *  Declining biometric enrollment does not block the session; it leaves the
 *  candidate at the level they would have had anyway. The distinction between
 *  requested and achieved is recorded because a credential that does not
 *  disclose its own assurance level is misleading (Identity Spec §4.2), and
 *  "L2 because they declined face matching" is a different fact from "L2
 *  because that is what the org asked for". */
export function effectiveAssurance(
  requested: AssuranceLevel,
  enrollment: EnrollmentState
): { achieved: AssuranceLevel; matchingApplied: boolean; reason: string } {
  if (enrollment.status === "enrolled") {
    return { achieved: requested, matchingApplied: true, reason: "biometric enrollment completed" };
  }
  if (enrollment.status === "declined") {
    return {
      achieved: requested,
      matchingApplied: false,
      reason: "candidate declined biometric enrollment; session continues at the configured level",
    };
  }
  return { achieved: requested, matchingApplied: false, reason: "no enrollment on file" };
}

// --- what a sample looks like ----------------------------------------------

export type MatchSample = {
  /** Session-relative ms — the same monotonic base as the pause events. */
  tMs: number;
  /** Faces visible in the frame. */
  faceCount: number;
  /** Similarity to the enrollment embedding, or null when there was no face to
   *  compare. Kept distinct from a score of 0: absent is not a bad match. */
  score: number | null;
};

// --- calibration: the safe failure -----------------------------------------

export type CalibrationDecision =
  | { outcome: "pass"; score: number; threshold: number; observedOnly: boolean }
  | {
      outcome: "refuse";
      reason: "below_threshold" | "no_face" | "multiple_faces";
      message: string;
      score: number | null;
      threshold: number;
      observedOnly: boolean;
    }
  /** Shadow mode: the check ran and its verdict was recorded, but it is not
   *  allowed to stop anyone. Distinct from `pass` so a caller cannot mistake
   *  an unenforced run for a successful match. */
  | {
      outcome: "observed";
      wouldHaveRefused: boolean;
      reason: "below_threshold" | "no_face" | "multiple_faces" | null;
      score: number | null;
      threshold: number;
      observedOnly: true;
    };

/** Judge a calibration sample. A refusal here mints NO exam ticket.
 *
 *  This is the strict side of invariant 12 and it can afford to be. Nobody is
 *  accused of anything, nothing is recorded against them, and the remedy is to
 *  sit the calibration again — which costs minutes. The asymmetry with
 *  `judgeExamSample` is the whole design. */
export function judgeCalibration(
  sample: MatchSample,
  cohort: CohortId = DEFAULT_COHORT,
  config: IdentityThresholdConfig = IDENTITY_THRESHOLDS
): CalibrationDecision {
  const { calibration: threshold } = thresholdsFor(cohort, config);
  const enforcing = mayEnforce(config);

  let reason: "below_threshold" | "no_face" | "multiple_faces" | null = null;
  let message = "";
  if (sample.faceCount > 1) {
    reason = "multiple_faces";
    message = `${sample.faceCount} people are visible. Calibration must be recorded alone.`;
  } else if (sample.faceCount === 0 || sample.score === null) {
    reason = "no_face";
    message = "No face was detected. Face the camera and run the check again.";
  } else if (sample.score < threshold) {
    reason = "below_threshold";
    message =
      "This does not appear to be the enrolled person. Run the check again, or re-enroll if this is a new device.";
  }

  // Shadow: record what would have happened, change nothing. The score is the
  // artefact a validation study needs; the refusal is the thing it has not
  // earned the right to make.
  if (!enforcing) {
    return {
      outcome: "observed",
      wouldHaveRefused: reason !== null,
      reason,
      score: sample.score,
      threshold,
      observedOnly: true,
    };
  }

  if (reason !== null) {
    return {
      outcome: "refuse",
      reason,
      message,
      score: reason === "no_face" ? null : sample.score,
      threshold,
      observedOnly: false,
    };
  }
  return { outcome: "pass", score: sample.score as number, threshold, observedOnly: false };
}

// --- mid-exam: the accusing failure ----------------------------------------

/** Running state across mid-exam samples. */
export type ExamMatchState = { consecutiveLow: number; flagsRaised: number };

export const initialExamMatchState = (): ExamMatchState => ({ consecutiveLow: 0, flagsRaised: 0 });

export type ExamJudgement = {
  state: ExamMatchState;
  /** The event to append, or null when this sample says nothing new. */
  event: MetadataEvent | null;
  /** True when this sample completed a run and raised a flag. Advisory only —
   *  nothing in the system may act on it beyond recording and surfacing it. */
  flagRaised: boolean;
};

/** Judge one mid-exam sample.
 *
 *  Note what this function cannot return. There is no "terminate", no "fail",
 *  and no "recalibrate" outcome, and that is structural rather than an
 *  oversight: a caller cannot end a session on a match result because this
 *  function gives it nothing to end a session with. Offering recalibration
 *  mid-exam would be worst of all — it is an enrollment path for whoever is in
 *  front of the camera now, which converts the check into its own bypass.
 *
 *  A single low sample raises nothing. People turn their heads, reach for
 *  coffee, and sit in changing light. Only a run of consecutive low samples is
 *  a finding, and the run length is configuration rather than a constant here. */
export function judgeExamSample(
  state: ExamMatchState,
  sample: MatchSample,
  cohort: CohortId = DEFAULT_COHORT,
  config: IdentityThresholdConfig = IDENTITY_THRESHOLDS
): ExamJudgement {
  const { exam: threshold } = thresholdsFor(cohort, config);
  const base = { match_threshold: threshold, threshold_version: config.version };

  // A fact about the room, not a claim about a person. Reported on its own
  // channel and deliberately NOT allowed to contribute to the low-match run:
  // a colleague walking past is not evidence that the candidate was swapped.
  if (sample.faceCount > 1) {
    return {
      state,
      event: { t_ms: sample.tMs, type: "identity_multiple_faces", attrs: { ...base, face_count: sample.faceCount } },
      flagRaised: false,
    };
  }

  // Absent is not a bad match. Someone who stood up is not someone else, and
  // counting it toward a substitution run would accuse people of leaving.
  if (sample.faceCount === 0 || sample.score === null) {
    return {
      state: { ...state, consecutiveLow: 0 },
      event: { t_ms: sample.tMs, type: "identity_absent", attrs: { ...base } },
      flagRaised: false,
    };
  }

  if (sample.score >= threshold) {
    return {
      state: { ...state, consecutiveLow: 0 },
      event: {
        t_ms: sample.tMs,
        type: "identity_match_ok",
        attrs: { ...base, match_score: round3(sample.score) },
      },
      flagRaised: false,
    };
  }

  const consecutiveLow = state.consecutiveLow + 1;
  // A run is complete, but a flag is an accusation and shadow mode has not
  // earned the right to make one. The event is still emitted — the score is
  // exactly what a validation study needs — and `flagRaised` stays false, so
  // nothing surfaces to a reviewer and the candidate is told nothing.
  const runComplete = consecutiveLow >= config.examConsecutiveLowSamples;
  const raises = runComplete && mayEnforce(config);
  return {
    state: {
      consecutiveLow: runComplete ? 0 : consecutiveLow,
      flagsRaised: state.flagsRaised + (raises ? 1 : 0),
    },
    event: runComplete
      ? {
          t_ms: sample.tMs,
          type: "identity_match_low",
          attrs: {
            ...base,
            match_score: round3(sample.score),
            consecutive_low: consecutiveLow,
            // So a reader of the log can tell an observation from an
            // accusation. Without it, a shadow-mode run and a real flag are
            // the same row.
            enforced: raises,
          },
        }
      : null,
    flagRaised: raises,
  };
}

/** What the candidate is told when a flag is raised. Invariant 7: honest.
 *
 *  It names what happened, says what it does and does not mean, and says what
 *  happens next. It does not accuse, because the system does not know — that
 *  is precisely why a human is being asked. */
export const FLAG_NOTICE =
  "A camera continuity flag was raised on this session and will be reviewed by a person. " +
  "Your session is continuing normally and nothing has been decided. " +
  "Flags are often raised by lighting, camera angle, or someone passing behind you. " +
  "You will be able to respond before any conclusion is reached.";

// --- the content check ------------------------------------------------------

const BIOMETRIC_KEYS = ["embedding", "descriptor", "landmark", "template", "vector", "frame", "image", "crop", "face_data"];

/** Reject anything face-derived before it can be serialised outward.
 *
 *  Invariant 5 covers biometric content as surely as it covers keystrokes, and
 *  this is the runtime half of that. A score is a scalar comparison result and
 *  may leave; anything from which a face could be reconstructed may not.
 *
 *  Checks values as well as names, because the field that leaks an embedding
 *  will not be the one called `embedding`. */
export function assertNoBiometricContent(attrs: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(attrs)) {
    const lowered = key.toLowerCase();
    for (const banned of BIOMETRIC_KEYS) {
      if (lowered.includes(banned)) {
        throw new Error(`biometric field "${key}" may not be recorded (CLAUDE.md invariants 5 and 12)`);
      }
    }
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      throw new Error(`"${key}" carries an array; an embedding must never reach an event payload`);
    }
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
