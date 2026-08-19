import { describe, expect, it } from "vitest";
import { summariseCalibration } from "./identitySampler";
import type { MatchSample } from "./identity";

// One verdict is sent for a whole calibration run, so how the run is reduced
// decides what the gate sees. Getting this wrong is invisible: an averaged run
// still produces a plausible score.

const s = (over: Partial<MatchSample> = {}): MatchSample => ({
  tMs: 0,
  faceCount: 1,
  score: 0.9,
  ...over,
});

describe("reducing a calibration run to one verdict", () => {
  it("takes the WORST sample, not the average", () => {
    // Calibration is checking a single claim — that the person here is the
    // enrolled one. A run containing a stretch that did not match has not
    // established that, however good its other frames were, and an average
    // would bury exactly the window worth looking at.
    const worst = summariseCalibration([s({ score: 0.95 }), s({ score: 0.2 }), s({ score: 0.93 })]);
    expect(worst!.score).toBe(0.2);
  });

  it("lets multiple faces outrank the scores", () => {
    // A calibration recorded with someone else present is not a clean
    // baseline whatever the similarity said, and it is a different finding
    // from a low match.
    const v = summariseCalibration([s({ score: 0.99 }), s({ faceCount: 2, score: 0.99 })]);
    expect(v!.faceCount).toBe(2);
  });

  it("reports absence when no frame yielded a score", () => {
    const v = summariseCalibration([s({ faceCount: 0, score: null }), s({ faceCount: 0, score: null })]);
    expect(v).not.toBeNull();
    expect(v!.score).toBeNull();
  });

  it("returns null when nothing was sampled at all", () => {
    // Sent as NO verdict rather than a failed one — "we did not measure" must
    // leave the gate untouched, or a candidate without a reference on this
    // device would be refused for not having enrolled here.
    expect(summariseCalibration([])).toBeNull();
  });

  it("ignores unmeasurable frames when some frames did measure", () => {
    const v = summariseCalibration([s({ faceCount: 0, score: null }), s({ score: 0.7 })]);
    expect(v!.score).toBe(0.7);
  });
});
