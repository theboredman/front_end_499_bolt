// Face-match thresholds (Identity Spec §4.5, CLAUDE.md invariant 12).
//
// Everything here is configuration rather than a constant in a matcher, for one
// reason: a threshold is a decision about how to distribute errors between two
// groups of people, and a decision like that has to be auditable after the
// fact. The version below is written into the session manifest, so a flag
// raised in March can be re-examined in September against the exact numbers
// that raised it — rather than against whatever the file says by then.
//
// Why two thresholds and not one
// ------------------------------
// The two matching paths fail in opposite directions and cannot share a number.
//
//   Calibration  — a low match REFUSES entry. Nobody is accused; the candidate
//                  retries. A false refusal costs minutes, so this can be
//                  strict.
//
//   Mid-exam     — a low match FLAGS the session for human review. That is an
//                  accusation against someone who cannot re-prove themselves
//                  without handing an impostor the same door. A false flag is
//                  expensive in a way a false refusal is not, so this is
//                  lenient.
//
// A single threshold would either accuse too readily or admit too readily.
// There is no value that is correct for both.

/** A cohort label for threshold validation.
 *
 *  NOT collected from the candidate and NOT inferred from their face. It exists
 *  so that a validation study — which recruits participants who consent to
 *  share demographic data for exactly this purpose — can fit and report
 *  per-cohort thresholds, and so that the shape of the config does not have to
 *  change when it does. In production every session uses `default`. */
export type CohortId = string;

export const DEFAULT_COHORT: CohortId = "default";

import type { Normalisation, TensorLayout } from "./faceMath";
export type { Normalisation, TensorLayout };

export type ThresholdPair = {
  /** Minimum similarity to mint an exam ticket. Strict: a false stop is cheap. */
  calibration: number;
  /** Minimum similarity below which a mid-exam sample raises a flag.
   *  Lenient: a false flag accuses a person. Must be <= `calibration`. */
  exam: number;
};

/** What the system is allowed to DO with a match result.
 *
 *  Separated from "is there a matcher?" because the two questions have
 *  different answers. The matcher is real; the thresholds are not yet
 *  validated, and those are independent facts.
 *
 *    off       nothing runs. No frames sampled, no scores computed.
 *    shadow    the matcher runs and every score is recorded, but NO decision
 *              is enforced: calibration never refuses, mid-exam never flags a
 *              reviewer, and the candidate is never accused of anything.
 *    enforced  decisions act.
 *
 *  Shadow is the point of this design. Per-cohort thresholds cannot be fitted
 *  without real scores from real sessions, and real scores cannot be collected
 *  without running the matcher — so "wait until it is validated" is circular.
 *  Shadow mode breaks the circle: it produces exactly the measurements the
 *  validation study needs while being structurally incapable of refusing entry
 *  or raising a flag.
 *
 *  `enforced` is refused while `validated` is false. That is the control. */
export type Enforcement = "off" | "shadow" | "enforced";

export type IdentityThresholdConfig = {
  /** Bumped on any change to the numbers below. Recorded in the manifest. */
  version: string;
  /** What the system may do with a result. Never `enforced` while
   *  `validated` is false — `assertUsable` refuses that combination. */
  enforcement: Enforcement;
  /** False until per-cohort validation has actually been performed. */
  validated: boolean;
  /** What was measured, by whom, on what. Empty until it has been. */
  validationNote: string;
  /** How many consecutive low samples raise one flag mid-exam.
   *
   *  A single frame below threshold is not evidence of anything: people turn
   *  their heads, reach for coffee, and sit in changing light. Requiring a run
   *  of them is what separates "a person left the frame for a moment" from
   *  "the person in the frame changed", and it is the cheapest available
   *  reduction in false accusations. */
  examConsecutiveLowSamples: number;
  /** Seconds between mid-exam samples. */
  examSampleIntervalSec: number;
  /** Where the recognition weights are served from. Same-origin by default:
   *  a model fetched from a third party is a third party deciding what your
   *  identity check does. */
  modelUrl: string;
  /** Embedding dimension the model emits, checked at load. A model with an
   *  unexpected output shape is the wrong model, and finding that out at load
   *  is better than finding it out as uniformly low scores. */
  embeddingDim: number;
  /** Pixel arrangement the model expects. Read it off the graph — a mismatch
   *  produces well-formed, meaningless embeddings rather than an error. */
  modelLayout: TensorLayout;
  /** Pixel scaling the weights were trained with. */
  modelNormalisation: Normalisation;
  /** Minimum mean agreement between enrolment frames. Below this the reference
   *  is rejected rather than banked. */
  minEnrolmentCoherence: number;
  /** Per-cohort overrides. `default` is required. */
  thresholds: Record<CohortId, ThresholdPair>;
};

/** The shipped configuration.
 *
 *  THESE NUMBERS ARE PLACEHOLDERS. The matcher runs on them in SHADOW mode —
 *  recording what they would have decided — and is refused permission to
 *  enforce them.
 *
 *  They are not derived from a validation study, because there is nothing to
 *  derive them from: one usable real session, zero labels, and
 *  `fairness.bias_measurement` is status `spec`, blocked on "real sessions
 *  across groups". Face matching has documented false-match-rate disparities
 *  across demographic groups spanning orders of magnitude (NIST FRVT Part 3),
 *  so a global threshold chosen by feel is not a neutral default — it is a
 *  decision to distribute errors unevenly and decline to measure it.
 *
 *  `validated: false` is what stops that decision from reaching anyone: it
 *  makes `enforced` an impossible configuration, so the numbers below can be
 *  measured against reality without ever being applied to a person. */
export const IDENTITY_THRESHOLDS: IdentityThresholdConfig = {
  version: "0.2.0-shadow",
  // Shadow, not off: the matcher is real and should run, because running it is
  // the only way to collect the scores that would let anyone set these
  // thresholds honestly. It cannot refuse or flag anybody while it does.
  enforcement: "shadow",
  validated: false,
  validationNote: "",
  examConsecutiveLowSamples: 3,
  examSampleIntervalSec: 15,
  // ArcFace, 512-d, installed at frontend/public/models/ (gitignored — see
  // docs/identity-model-setup.md).
  //
  // Layout is read off the graph: it declares input_1 [N,112,112,3], which is
  // NHWC. Feeding it planar NCHW does not error — it returns a well-formed
  // 512-d embedding encoding nothing about the face.
  //
  // Normalisation and channel order were MEASURED, not assumed. Mean pairwise
  // similarity over six distinct synthetic inputs, lower being more
  // discriminative:
  //
  //     sym  RGB  0.9013   <- chosen
  //     sym  BGR  0.9169
  //     unit RGB  0.9546
  //     unit BGR  0.9618
  modelUrl: "/models/arcface.onnx",
  embeddingDim: 512,
  modelLayout: "nhwc",
  modelNormalisation: "sym",
  minEnrolmentCoherence: 0.75,
  thresholds: {
    [DEFAULT_COHORT]: { calibration: 0.62, exam: 0.45 },
  },
};

/** Why the matcher may not act. `null` means the configuration is coherent. */
export type ConfigRefusal =
  | { reason: "unvalidated_enforcement"; message: string }
  | { reason: "missing_cohort"; message: string }
  | { reason: "inverted_thresholds"; message: string };

/** Gate on the configuration itself, checked before any matching happens.
 *
 *  A hard refusal rather than a warning. A warning in a log is not a control:
 *  it does not stop an unvalidated threshold from refusing a real candidate
 *  entry. The only way to make "must be validated before it decides anything"
 *  true is to make the combination unrepresentable.
 *
 *  Note what is NOT refused: running unvalidated thresholds in `shadow`. That
 *  is the intended state, because the scores it records are the only route to
 *  validating them. What is refused is `enforced` while unvalidated. */
export function assertUsable(
  config: IdentityThresholdConfig = IDENTITY_THRESHOLDS,
  cohort: CohortId = DEFAULT_COHORT
): ConfigRefusal | null {
  if (config.enforcement === "enforced" && !config.validated) {
    return {
      reason: "unvalidated_enforcement",
      message:
        "Identity matching cannot enforce decisions: its thresholds have not been " +
        "validated. Face-match error rates differ by demographic group, so a " +
        "threshold that has not been measured per cohort cannot be applied to " +
        "candidates. Run in shadow mode until it has.",
    };
  }
  const pair = config.thresholds[cohort] ?? config.thresholds[DEFAULT_COHORT];
  if (!pair) {
    return {
      reason: "missing_cohort",
      message: `No thresholds configured for cohort "${cohort}", and no default to fall back to.`,
    };
  }
  if (pair.exam > pair.calibration) {
    // Inverted, this would flag mid-exam more readily than it refuses at the
    // door — accusing people it would have let in. Invariant 12 upside down.
    return {
      reason: "inverted_thresholds",
      message:
        `Cohort "${cohort}" has a mid-exam threshold (${pair.exam}) above its calibration ` +
        `threshold (${pair.calibration}). Mid-exam must be the more lenient of the two.`,
    };
  }
  return null;
}

/** Whether a result may change what happens to the candidate. */
export function mayEnforce(config: IdentityThresholdConfig = IDENTITY_THRESHOLDS): boolean {
  return config.enforcement === "enforced" && config.validated && assertUsable(config) === null;
}

/** Whether the matcher should run at all. */
export function shouldSample(config: IdentityThresholdConfig = IDENTITY_THRESHOLDS): boolean {
  return config.enforcement !== "off" && assertUsable(config) === null;
}

export function thresholdsFor(
  cohort: CohortId = DEFAULT_COHORT,
  config: IdentityThresholdConfig = IDENTITY_THRESHOLDS
): ThresholdPair {
  return config.thresholds[cohort] ?? config.thresholds[DEFAULT_COHORT];
}

/** What goes in the session manifest so a decision can be re-audited.
 *
 *  The version and the numbers, never a score and never anything derived from
 *  a face. This records what the system was configured to do, not what it saw. */
export function manifestRecord(config: IdentityThresholdConfig = IDENTITY_THRESHOLDS) {
  return {
    identity_threshold_version: config.version,
    // Which is the difference between "we observed this" and "we acted on
    // this". A reviewer re-reading an old session must be able to tell.
    identity_enforcement: config.enforcement,
    identity_thresholds_validated: config.validated,
    identity_exam_consecutive_low_samples: config.examConsecutiveLowSamples,
    identity_exam_sample_interval_sec: config.examSampleIntervalSec,
    identity_cohorts: Object.keys(config.thresholds).sort(),
  };
}
