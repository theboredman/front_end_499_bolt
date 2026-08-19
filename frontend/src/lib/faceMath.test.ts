import { describe, expect, it } from "vitest";
import {
  averageEmbedding,
  cosineSimilarity,
  cropBoxFor,
  enrolmentCoherence,
  l2Normalise,
  toModelTensor,
} from "./faceMath";

// The arithmetic behind a biometric decision. Its failure mode is not an
// exception — it is a plausible number between 0 and 1 that means something
// slightly different from what the threshold was fitted against.

const vec = (...xs: number[]) => new Float32Array(xs);

describe("cosine similarity", () => {
  it("is 1 for a vector against itself, exactly", () => {
    // Floating point can produce 1.0000000000000002, which would read as an
    // out-of-range score in a log and could exceed a threshold of 1.
    const v = vec(0.3, -0.7, 0.1, 0.9);
    expect(cosineSimilarity(v, v)).toBe(1);
  });

  it("is -1 for opposed vectors and 0 for orthogonal ones", () => {
    expect(cosineSimilarity(vec(1, 0), vec(-1, 0))).toBeCloseTo(-1, 6);
    expect(cosineSimilarity(vec(1, 0), vec(0, 1))).toBeCloseTo(0, 6);
  });

  it("ignores magnitude, which is what makes it a similarity", () => {
    expect(cosineSimilarity(vec(1, 2, 3), vec(10, 20, 30))).toBeCloseTo(1, 6);
  });

  it("returns NULL rather than a low score when it cannot compare", () => {
    // The single most important behaviour here. "I could not measure" and
    // "I measured, and it is not them" are the two findings this whole system
    // exists to keep apart — collapsing them turns a broken camera into an
    // accusation.
    expect(cosineSimilarity(vec(1, 0), vec(1, 0, 0))).toBeNull();
    expect(cosineSimilarity(vec(0, 0), vec(1, 0))).toBeNull();
    expect(cosineSimilarity(new Float32Array(0), new Float32Array(0))).toBeNull();
  });
});

describe("L2 normalisation", () => {
  it("produces a unit vector", () => {
    const n = l2Normalise(vec(3, 4));
    expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 6);
  });

  it("returns zeros rather than NaNs for a degenerate vector", () => {
    // NaNs propagate silently through every later comparison; zeros are caught
    // by cosineSimilarity's null path.
    const n = l2Normalise(vec(0, 0, 0));
    expect(Array.from(n)).toEqual([0, 0, 0]);
    expect(Array.from(n).some(Number.isNaN)).toBe(false);
  });
});

describe("crop box", () => {
  it("is square, so the face is not stretched by the aspect ratio", () => {
    const c = cropBoxFor({ x: 100, y: 100, width: 80, height: 120 }, 640, 480);
    expect(c.width).toBeCloseTo(c.height, 6);
  });

  it("adds margin around a tight detector box", () => {
    // Recognition models are trained on crops with forehead and chin. A tight
    // box shifts every embedding — consistently, so tight-vs-tight still
    // matches, which is exactly why the bug survives casual testing.
    const c = cropBoxFor({ x: 100, y: 100, width: 100, height: 100 }, 640, 480, 0.25);
    expect(c.width).toBeGreaterThan(100);
  });

  it("stays inside the frame for a face at the edge", () => {
    const c = cropBoxFor({ x: 0, y: 0, width: 100, height: 100 }, 640, 480);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(640);
    expect(c.y + c.height).toBeLessThanOrEqual(480);
  });

  it("never returns a zero-sized crop", () => {
    const c = cropBoxFor({ x: 639, y: 479, width: 1, height: 1 }, 640, 480);
    expect(c.width).toBeGreaterThan(0);
    expect(c.height).toBeGreaterThan(0);
  });
});

describe("model tensor", () => {
  const px = 112 * 112;
  const rgba = (() => {
    const a = new Uint8ClampedArray(px * 4);
    a[0] = 255; a[1] = 0; a[2] = 127; // pixel 0 = R255 G0 B127
    a[4] = 10; a[5] = 20; a[6] = 30; // pixel 1
    return a;
  })();

  it("packs NCHW as planar: all reds, then greens, then blues", () => {
    const t = toModelTensor(rgba, 112, "nchw", "sym");
    expect(t.length).toBe(3 * px);
    expect(t[0]).toBeCloseTo((255 - 127.5) / 128, 6);
    expect(t[px]).toBeCloseTo((0 - 127.5) / 128, 6);
    expect(t[2 * px]).toBeCloseTo((127 - 127.5) / 128, 6);
  });

  it("packs NHWC as interleaved: r,g,b per pixel", () => {
    // The layout the installed ArcFace actually declares. Feeding it planar
    // data does not error — it returns a well-formed embedding of nothing in
    // particular, which is why this is a test and not a comment.
    const t = toModelTensor(rgba, 112, "nhwc", "sym");
    expect(t[0]).toBeCloseTo((255 - 127.5) / 128, 6);
    expect(t[1]).toBeCloseTo((0 - 127.5) / 128, 6);
    expect(t[2]).toBeCloseTo((127 - 127.5) / 128, 6);
    // Second pixel follows immediately, rather than a plane away.
    expect(t[3]).toBeCloseTo((10 - 127.5) / 128, 6);
  });

  it("produces genuinely different tensors for the two layouts", () => {
    const a = toModelTensor(rgba, 112, "nchw", "sym");
    const b = toModelTensor(rgba, 112, "nhwc", "sym");
    expect(Array.from(a.slice(0, 8))).not.toEqual(Array.from(b.slice(0, 8)));
  });

  it("applies the configured normalisation", () => {
    const sym = toModelTensor(rgba, 112, "nhwc", "sym");
    const unit = toModelTensor(rgba, 112, "nhwc", "unit");
    expect(sym[0]).toBeCloseTo((255 - 127.5) / 128, 6);
    expect(unit[0]).toBeCloseTo(1, 6);
  });

  it("throws on a short buffer rather than emitting a partial tensor", () => {
    expect(() => toModelTensor(new Uint8ClampedArray(16))).toThrow(/expected/);
  });
});

describe("enrolment reference", () => {
  it("averages several frames into a unit centroid", () => {
    const avg = averageEmbedding([vec(1, 0, 0), vec(0.9, 0.1, 0), vec(0.95, 0.05, 0)]);
    expect(avg).not.toBeNull();
    expect(Math.hypot(...Array.from(avg!))).toBeCloseTo(1, 6);
  });

  it("returns null rather than an empty reference", () => {
    // Enrolling an empty reference would make every later session score near
    // zero, which reads as "not the same person" rather than "nothing enrolled".
    expect(averageEmbedding([])).toBeNull();
    expect(averageEmbedding([new Float32Array(0)])).toBeNull();
  });

  it("refuses to average vectors of different lengths", () => {
    expect(averageEmbedding([vec(1, 0), vec(1, 0, 0)])).toBeNull();
  });

  it("reports high coherence for consistent frames and low for inconsistent", () => {
    const consistent = enrolmentCoherence([vec(1, 0, 0), vec(0.99, 0.1, 0), vec(0.98, 0.05, 0.02)]);
    const inconsistent = enrolmentCoherence([vec(1, 0, 0), vec(0, 1, 0), vec(0, 0, 1)]);
    expect(consistent!).toBeGreaterThan(0.95);
    expect(inconsistent!).toBeLessThan(0.7);
  });

  it("has no coherence to report from a single frame", () => {
    // One frame always agrees with itself, and reporting 1.0 would present a
    // single-frame enrolment as the most coherent kind.
    expect(enrolmentCoherence([vec(1, 0, 0)])).toBeNull();
  });
});
