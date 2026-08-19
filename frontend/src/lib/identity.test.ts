import { describe, expect, it } from "vitest";
import {
  ENROLLMENT_CONSENT_VERSION,
  assertNoBiometricContent,
  decline,
  disabledMatcher,
  effectiveAssurance,
  enroll,
  initialExamMatchState,
  judgeCalibration,
  judgeExamSample,
  type FaceEmbedding,
  type FaceMatcher,
  type MatchSample,
} from "./identity";
import {
  IDENTITY_THRESHOLDS,
  assertUsable,
  manifestRecord,
  mayEnforce,
  shouldSample,
  type IdentityThresholdConfig,
} from "./identityConfig";

// CLAUDE.md invariant 12. The two matching paths fail in opposite directions
// and the tests are written to catch them being made symmetric — which is the
// change most likely to be made by someone who has not read why they differ.

/** A config that is usable, so the decision logic can be exercised at all. The
 *  shipped one refuses to run, which is the subject of its own test below. */
const testConfig: IdentityThresholdConfig = {
  version: "test-1",
  enforcement: "enforced",
  validated: true,
  validationNote: "synthetic, for tests only",
  examConsecutiveLowSamples: 3,
  examSampleIntervalSec: 15,
  modelUrl: "/models/test.onnx",
  embeddingDim: 512,
  modelLayout: "nchw",
  modelNormalisation: "sym",
  minEnrolmentCoherence: 0.75,
  thresholds: { default: { calibration: 0.6, exam: 0.4 } },
};

/** The shipped posture: real matcher, unvalidated thresholds, decisions
 *  observed but never enforced. */
const shadowConfig: IdentityThresholdConfig = { ...testConfig, enforcement: "shadow", validated: false };

const sample = (over: Partial<MatchSample> = {}): MatchSample => ({
  tMs: 1_000,
  faceCount: 1,
  score: 0.9,
  ...over,
});

describe("the shipped configuration runs but cannot act", () => {
  it("refuses to ENFORCE unvalidated thresholds", () => {
    // The control that keeps an unvalidated biometric decision away from real
    // candidates. If this ever returns null for an enforced+unvalidated
    // config, the whole safety argument in Identity Spec §4.5 is void.
    const refusal = assertUsable({ ...shadowConfig, enforcement: "enforced" });
    expect(refusal).not.toBeNull();
    expect(refusal!.reason).toBe("unvalidated_enforcement");
  });

  it("permits SHADOW on unvalidated thresholds — that is how they get validated", () => {
    // Not an oversight. Per-cohort thresholds cannot be fitted without real
    // scores, and real scores cannot be collected without running the matcher,
    // so "wait until validated" is circular. Shadow breaks the circle.
    expect(assertUsable(shadowConfig)).toBeNull();
    expect(shouldSample(shadowConfig)).toBe(true);
    expect(mayEnforce(shadowConfig)).toBe(false);
  });

  it("is what ships", () => {
    expect(IDENTITY_THRESHOLDS.enforcement).toBe("shadow");
    expect(IDENTITY_THRESHOLDS.validated).toBe(false);
    expect(mayEnforce(IDENTITY_THRESHOLDS)).toBe(false);
  });

  it("refuses a config whose mid-exam threshold is stricter than calibration", () => {
    // Inverted, it would flag people mid-exam that it would have admitted at
    // the door — invariant 12 upside down.
    const inverted = { ...testConfig, thresholds: { default: { calibration: 0.4, exam: 0.6 } } };
    expect(assertUsable(inverted)!.reason).toBe("inverted_thresholds");
  });

  it("allows equal thresholds, which is degenerate but not inverted", () => {
    const equal = { ...testConfig, thresholds: { default: { calibration: 0.5, exam: 0.5 } } };
    expect(assertUsable(equal)).toBeNull();
  });
});

describe("calibration — the safe failure", () => {
  it("passes a match at or above the strict threshold", () => {
    const d = judgeCalibration(sample({ score: 0.6 }), "default", testConfig);
    expect(d.outcome).toBe("pass");
  });

  it("REFUSES below threshold, so no exam ticket can be minted", () => {
    const d = judgeCalibration(sample({ score: 0.59 }), "default", testConfig);
    expect(d.outcome).toBe("refuse");
    expect(d.outcome === "refuse" && d.reason).toBe("below_threshold");
  });

  it("refuses when nobody is in frame", () => {
    const d = judgeCalibration(sample({ faceCount: 0, score: null }), "default", testConfig);
    expect(d.outcome === "refuse" && d.reason).toBe("no_face");
  });

  it("keeps multiple faces as its own reason, not a match failure", () => {
    // A fact about the room, not a claim about a person. A reviewer reading
    // "below_threshold" when two people were visible would be misinformed.
    const d = judgeCalibration(sample({ faceCount: 2 }), "default", testConfig);
    expect(d.outcome === "refuse" && d.reason).toBe("multiple_faces");
  });

  it("applies the STRICTER of the two thresholds", () => {
    // 0.5 sits between exam (0.4) and calibration (0.6): admitted mid-exam,
    // refused at the door. If this ever passes, the paths have been collapsed.
    const d = judgeCalibration(sample({ score: 0.5 }), "default", testConfig);
    expect(d.outcome).toBe("refuse");
  });
});

describe("mid-exam — the accusing failure", () => {
  it("offers no way to terminate, fail, or recalibrate", () => {
    // Structural, not a policy: a caller cannot end a session on a match result
    // because the judgement carries nothing to end one with. A recalibration
    // route here would be an enrollment path for whoever is at the camera now.
    const j = judgeExamSample(initialExamMatchState(), sample({ score: 0.1 }), "default", testConfig);
    const keys = Object.keys(j);
    expect(keys.sort()).toEqual(["event", "flagRaised", "state"]);
    for (const forbidden of ["terminate", "fail", "recalibrate", "void", "abort"]) {
      expect(JSON.stringify(j).toLowerCase()).not.toContain(forbidden);
    }
  });

  it("does not flag on a single low sample", () => {
    // People turn their heads and sit in changing light.
    const j = judgeExamSample(initialExamMatchState(), sample({ score: 0.1 }), "default", testConfig);
    expect(j.flagRaised).toBe(false);
    expect(j.event).toBeNull();
    expect(j.state.consecutiveLow).toBe(1);
  });

  it("flags only after a run of consecutive low samples", () => {
    let state = initialExamMatchState();
    let last = judgeExamSample(state, sample({ score: 0.1, tMs: 1_000 }), "default", testConfig);
    state = last.state;
    last = judgeExamSample(state, sample({ score: 0.1, tMs: 2_000 }), "default", testConfig);
    state = last.state;
    expect(last.flagRaised).toBe(false);

    last = judgeExamSample(state, sample({ score: 0.1, tMs: 3_000 }), "default", testConfig);
    expect(last.flagRaised).toBe(true);
    expect(last.event!.type).toBe("identity_match_low");
    expect(last.event!.attrs.consecutive_low).toBe(3);
  });

  it("resets the run when a good sample intervenes", () => {
    let state = initialExamMatchState();
    state = judgeExamSample(state, sample({ score: 0.1 }), "default", testConfig).state;
    state = judgeExamSample(state, sample({ score: 0.1 }), "default", testConfig).state;
    state = judgeExamSample(state, sample({ score: 0.95 }), "default", testConfig).state;
    expect(state.consecutiveLow).toBe(0);

    const j = judgeExamSample(state, sample({ score: 0.1 }), "default", testConfig);
    expect(j.flagRaised).toBe(false);
  });

  it("does not count an absent face toward a substitution run", () => {
    // Someone who stood up is not someone else. Counting absence toward the
    // run would accuse people of leaving the room.
    let state = initialExamMatchState();
    state = judgeExamSample(state, sample({ score: 0.1 }), "default", testConfig).state;
    state = judgeExamSample(state, sample({ score: 0.1 }), "default", testConfig).state;

    const away = judgeExamSample(state, sample({ faceCount: 0, score: null }), "default", testConfig);
    expect(away.event!.type).toBe("identity_absent");
    expect(away.state.consecutiveLow).toBe(0);
    expect(away.flagRaised).toBe(false);
  });

  it("keeps multiple faces on its own channel and out of the run", () => {
    let state = initialExamMatchState();
    state = judgeExamSample(state, sample({ score: 0.1 }), "default", testConfig).state;

    const j = judgeExamSample(state, sample({ faceCount: 2 }), "default", testConfig);
    expect(j.event!.type).toBe("identity_multiple_faces");
    expect(j.event!.attrs.face_count).toBe(2);
    // A colleague walking past is not evidence the candidate was swapped, so
    // the run is left where it was rather than advanced.
    expect(j.state.consecutiveLow).toBe(1);
    expect(j.flagRaised).toBe(false);
  });

  it("is LENIENT relative to calibration on the same score", () => {
    // 0.5: refused at the door, admitted mid-exam. The asymmetry itself.
    expect(judgeCalibration(sample({ score: 0.5 }), "default", testConfig).outcome).toBe("refuse");
    const j = judgeExamSample(initialExamMatchState(), sample({ score: 0.5 }), "default", testConfig);
    expect(j.event!.type).toBe("identity_match_ok");
  });
});

describe("no biometric content escapes (invariants 5 and 12)", () => {
  const embedding: FaceEmbedding = { kind: "face-embedding", values: new Float32Array([0.1, 0.2, 0.3]) };

  it("emits only a score, a threshold and a version on a match event", () => {
    const j = judgeExamSample(initialExamMatchState(), sample({ score: 0.95 }), "default", testConfig);
    expect(Object.keys(j.event!.attrs).sort()).toEqual(["match_score", "match_threshold", "threshold_version"]);
  });

  it("passes every emitted identity event through the content check", () => {
    const samples: MatchSample[] = [
      sample({ score: 0.95 }),
      sample({ faceCount: 0, score: null }),
      sample({ faceCount: 3 }),
      sample({ score: 0.05 }),
      sample({ score: 0.05 }),
      sample({ score: 0.05 }),
    ];
    let state = initialExamMatchState();
    for (const s of samples) {
      const j = judgeExamSample(state, s, "default", testConfig);
      state = j.state;
      if (j.event) expect(() => assertNoBiometricContent(j.event!.attrs)).not.toThrow();
    }
  });

  it("rejects a field named for a biometric artifact", () => {
    expect(() => assertNoBiometricContent({ embedding: "x" })).toThrow(/biometric field/);
    expect(() => assertNoBiometricContent({ face_landmarks: 1 })).toThrow(/biometric field/);
    expect(() => assertNoBiometricContent({ template_id: "x" })).toThrow(/biometric field/);
  });

  it("rejects a vector even under an innocent name", () => {
    // The field that leaks an embedding will not be the one called `embedding`.
    expect(() => assertNoBiometricContent({ reading: [0.1, 0.2, 0.3] })).toThrow(/must never reach an event payload/);
    expect(() => assertNoBiometricContent({ reading: new Float32Array([0.1]) })).toThrow(/must never reach an event payload/);
  });

  it("keeps the embedding out of the manifest record", () => {
    const record = manifestRecord(testConfig);
    const serialised = JSON.stringify(record).toLowerCase();
    for (const banned of ["embedding", "score", "face", "vector", "template"]) {
      expect(serialised).not.toContain(banned);
    }
    // What it does record: enough to re-audit a decision later.
    expect(record.identity_threshold_version).toBe("test-1");
    expect(record.identity_thresholds_validated).toBe(true);
  });

  it("never serialises an embedding, since it is not JSON-representable as one", () => {
    expect(JSON.stringify({ embedding }).includes("0.1,0.2,0.3")).toBe(false);
  });
});

describe("enrollment", () => {
  const workingMatcher: FaceMatcher = {
    available: true,
    async embed() {
      return { kind: "face-embedding", values: new Float32Array([1, 0, 0]) };
    },
    compare() {
      return 1;
    },
  };
  const frame = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as unknown as ImageData;

  it("refuses an uploaded file outright, before touching the matcher", async () => {
    // An uploaded photo can be anyone's. Enrolling from one would let every
    // later check pass as the person in the photo.
    const r = await enroll(frame, "uploaded-file", workingMatcher, testConfig);
    expect("refusal" in r && r.refusal.reason).toBe("not_live");
  });

  it("refuses an incoherent configuration", async () => {
    const bad = { ...testConfig, thresholds: { default: { calibration: 0.4, exam: 0.6 } } };
    const r = await enroll(frame, "live-capture", workingMatcher, bad);
    expect("refusal" in r && r.refusal.reason).toBe("config");
  });

  it("ALLOWS enrolment under shadow — the reference is what produces the scores", async () => {
    const r = await enroll(frame, "live-capture", workingMatcher, shadowConfig);
    expect("state" in r && r.state.status).toBe("enrolled");
  });

  it("refuses when no matcher is available — the shipped state", async () => {
    const r = await enroll(frame, "live-capture", disabledMatcher, testConfig);
    expect("refusal" in r && r.refusal.reason).toBe("matcher_unavailable");
  });

  it("records the consent version with the enrollment", async () => {
    const r = await enroll(frame, "live-capture", workingMatcher, testConfig);
    expect("state" in r && r.state.status).toBe("enrolled");
    expect("state" in r && r.state.status === "enrolled" && r.state.consentVersion).toBe(ENROLLMENT_CONSENT_VERSION);
  });
});

describe("declining enrollment leaves the session runnable", () => {
  it("does not block, and records that matching did not apply", () => {
    const declined = decline();
    const a = effectiveAssurance("L2", declined);
    expect(a.achieved).toBe("L2");
    expect(a.matchingApplied).toBe(false);
    expect(a.reason).toContain("declined");
  });

  it("distinguishes declining from never having been asked", () => {
    // "L2 because they declined" is a different fact from "L2 because nobody
    // asked", and a credential that conflates them misleads its reader.
    const declined = effectiveAssurance("L2", decline());
    const none = effectiveAssurance("L2", { status: "none" });
    expect(declined.reason).not.toBe(none.reason);
    expect(declined.achieved).toBe(none.achieved);
  });

  it("records the consent version that was declined", () => {
    expect(decline().consentVersion).toBe(ENROLLMENT_CONSENT_VERSION);
  });
});


describe("shadow mode observes without acting", () => {
  it("never refuses calibration, however low the score", () => {
    const d = judgeCalibration(sample({ score: 0.01 }), "default", shadowConfig);
    expect(d.outcome).toBe("observed");
    expect(d.outcome === "observed" && d.wouldHaveRefused).toBe(true);
    expect(d.outcome === "observed" && d.reason).toBe("below_threshold");
    // The score is still recorded — it is the artefact the validation study needs.
    expect(d.score).toBe(0.01);
  });

  it("reports `observed` rather than `pass`, so a caller cannot mistake the two", () => {
    const d = judgeCalibration(sample({ score: 0.99 }), "default", shadowConfig);
    expect(d.outcome).toBe("observed");
    expect(d.outcome === "observed" && d.wouldHaveRefused).toBe(false);
  });

  it("emits the mid-exam event but raises no flag", () => {
    let state = initialExamMatchState();
    let last = judgeExamSample(state, sample({ score: 0.01 }), "default", shadowConfig);
    state = last.state;
    last = judgeExamSample(state, sample({ score: 0.01 }), "default", shadowConfig);
    state = last.state;
    last = judgeExamSample(state, sample({ score: 0.01 }), "default", shadowConfig);

    // The row exists, because the score is the measurement.
    expect(last.event).not.toBeNull();
    expect(last.event!.type).toBe("identity_match_low");
    // But nothing is accused of anything.
    expect(last.flagRaised).toBe(false);
    expect(last.state.flagsRaised).toBe(0);
    expect(last.event!.attrs.enforced).toBe(false);
  });

  it("marks an enforced flag as enforced, so the log distinguishes them", () => {
    let state = initialExamMatchState();
    for (let i = 0; i < 2; i++) {
      state = judgeExamSample(state, sample({ score: 0.01 }), "default", testConfig).state;
    }
    const j = judgeExamSample(state, sample({ score: 0.01 }), "default", testConfig);
    expect(j.flagRaised).toBe(true);
    expect(j.event!.attrs.enforced).toBe(true);
  });
});
