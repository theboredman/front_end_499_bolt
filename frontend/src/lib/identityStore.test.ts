import { describe, expect, it } from "vitest";
import { reconcile } from "./identityStore";

// The bug this file exists for: the account panel rendered the SERVER's answer
// ("did you consent?") as if it answered the user's question ("is this
// working?"). Those come apart the moment someone opens a second browser, and
// the panel said "Enrolled" in a state where no reference existed and no match
// could ever be computed.

const MODEL = "/models/face-embedding.onnx";

const ref = (over: Partial<Parameters<typeof reconcile>[1]> = {}) =>
  ({
    userId: "u1",
    embedding: new Float32Array([1, 0, 0]),
    coherence: 0.93,
    consentVersion: "v1",
    createdAt: 1,
    modelUrl: MODEL,
    ...over,
  }) as NonNullable<Parameters<typeof reconcile>[1]>;

describe("what the panel is allowed to claim", () => {
  it("is ready only when consent AND a local reference agree", () => {
    const r = reconcile("enrolled", ref(), MODEL);
    expect(r.state).toBe("ready");
    expect(r.state === "ready" && r.coherence).toBe(0.93);
  });

  it("distinguishes 'enrolled elsewhere' from 'enrolled'", () => {
    // THE BUG. Consent exists, no reference on this device, nothing can be
    // matched — and the old panel rendered this identically to a working
    // enrolment.
    expect(reconcile("enrolled", null, MODEL).state).toBe("reference_missing");
  });

  it("distinguishes a stale reference from a missing one", () => {
    // An embedding is only comparable against one from the same model. Swap
    // the weights and every stored reference becomes meaningless while staying
    // perfectly well-formed, so the remedy is the same but the cause is not.
    expect(reconcile("enrolled", ref({ modelUrl: "/models/other.onnx" }), MODEL).state).toBe("model_changed");
  });

  it("reports declining as its own state, not as absence", () => {
    // "Refused" and "never asked" lead to different assurance levels, so a
    // panel that showed them alike would misreport the credential.
    expect(reconcile("declined", null, MODEL).state).toBe("declined");
    // Even with a stale reference lying around, a decline is a decline.
    expect(reconcile("declined", ref(), MODEL).state).toBe("declined");
  });

  it("reports not-enrolled when no decision has been made", () => {
    expect(reconcile("none", null, MODEL).state).toBe("not_enrolled");
  });

  it("never claims ready without consent, even if a reference is present", () => {
    // A reference left behind by an earlier enrolment that was later declined
    // must not resurrect matching.
    expect(reconcile("none", ref(), MODEL).state).toBe("not_enrolled");
  });
});
