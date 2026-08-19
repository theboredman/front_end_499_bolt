import { describe, expect, it } from "vitest";
import { addCut, emptyBoundaries, removeCut, setPhase, toSegments, type Boundaries } from "./labeling";

// CLAUDE.md invariant 8: segments always tile the session, and the tiling is
// STRUCTURAL — gaps are meant to be unrepresentable, not merely rejected by a
// validator. These tests are the check on that claim, because a tiling bug
// would not throw. It would silently hand the inter-rater reliability
// calculation two passes that disagree about how much session there was.

const DURATION = 600_000; // 10 minutes

/** The property under test, stated once: segments abut, start at 0, end at the
 *  duration, and between them cover every millisecond exactly once. */
function tiles(b: Boundaries, durationMs: number): boolean {
  const segs = toSegments(b, durationMs, "expert_a");
  if (segs.length === 0) return durationMs === 0;
  if (segs[0].start_ms !== 0) return false;
  if (segs[segs.length - 1].end_ms !== durationMs) return false;
  return segs.every((s, i) => i === 0 || s.start_ms === segs[i - 1].end_ms);
}

describe("segment tiling", () => {
  it("tiles with no cuts at all — one segment spanning the session", () => {
    const b = emptyBoundaries();
    expect(tiles(b, DURATION)).toBe(true);
    expect(toSegments(b, DURATION, "expert_a")).toHaveLength(1);
  });

  it("still tiles after a cut", () => {
    const b = addCut(emptyBoundaries(), 120_000, DURATION);
    expect(tiles(b, DURATION)).toBe(true);
    expect(toSegments(b, DURATION, "expert_a")).toHaveLength(2);
  });

  it("still tiles after cuts added out of order", () => {
    let b = emptyBoundaries();
    for (const t of [400_000, 90_000, 250_000, 30_000]) b = addCut(b, t, DURATION);
    expect(tiles(b, DURATION)).toBe(true);
    expect(toSegments(b, DURATION, "expert_a")).toHaveLength(5);
  });

  it("still tiles after a cut is removed", () => {
    let b = addCut(emptyBoundaries(), 120_000, DURATION);
    b = addCut(b, 300_000, DURATION);
    b = removeCut(b, 0);
    expect(tiles(b, DURATION)).toBe(true);
    expect(toSegments(b, DURATION, "expert_a")).toHaveLength(2);
  });

  it("still tiles after every cut is removed again", () => {
    let b = emptyBoundaries();
    for (const t of [100_000, 200_000, 300_000]) b = addCut(b, t, DURATION);
    while (b.cuts.length) b = removeCut(b, 0);
    expect(tiles(b, DURATION)).toBe(true);
  });

  it("keeps one phase per slot through every edit", () => {
    // The list lengths drifting apart is how a segment would end up with an
    // undefined phase, which serialises as a hole in the pass.
    let b = emptyBoundaries();
    for (const t of [100_000, 200_000, 300_000]) b = addCut(b, t, DURATION);
    expect(b.phases).toHaveLength(b.cuts.length + 1);
    b = removeCut(b, 1);
    expect(b.phases).toHaveLength(b.cuts.length + 1);
    expect(toSegments(b, DURATION, "expert_a").every((s) => Boolean(s.phase))).toBe(true);
  });
});

describe("cuts that would break the tiling are refused", () => {
  it("refuses a cut at or before the start", () => {
    expect(addCut(emptyBoundaries(), 0, DURATION).cuts).toEqual([]);
    expect(addCut(emptyBoundaries(), -5_000, DURATION).cuts).toEqual([]);
  });

  it("refuses a cut at or past the end", () => {
    expect(addCut(emptyBoundaries(), DURATION, DURATION).cuts).toEqual([]);
    expect(addCut(emptyBoundaries(), DURATION + 1_000, DURATION).cuts).toEqual([]);
  });

  it("refuses a duplicate cut within a second of an existing one", () => {
    const b = addCut(emptyBoundaries(), 120_000, DURATION);
    // A zero-length segment is not a gap, but it is a row that means nothing.
    expect(addCut(b, 120_400, DURATION).cuts).toEqual([120_000]);
  });
});

describe("phase assignment", () => {
  it("gives a new slot the phase of the slot it was split out of", () => {
    // A cut is a subdivision until the annotator says otherwise; inventing a
    // default here would put a phase in the pass that nobody chose.
    let b = setPhase(emptyBoundaries(), 0, "Exploration");
    b = addCut(b, 120_000, DURATION);
    expect(b.phases).toEqual(["Exploration", "Exploration"]);
  });

  it("keeps the earlier phase when a boundary is removed and slots merge", () => {
    let b = addCut(emptyBoundaries(), 120_000, DURATION);
    b = setPhase(b, 0, "Understanding");
    b = setPhase(b, 1, "Recovery");
    b = removeCut(b, 0);
    expect(b.phases).toEqual(["Understanding"]);
  });

  it("ignores a phase set on a slot that does not exist", () => {
    const b = emptyBoundaries();
    expect(setPhase(b, 4, "Recovery")).toEqual(b);
  });
});
