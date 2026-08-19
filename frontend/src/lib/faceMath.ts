// The arithmetic behind face matching, separated from the model that produces
// the vectors.
//
// Split out for two reasons. It is testable without loading 5MB of weights, and
// it is the half that decides whether two embeddings are "the same person" —
// which is the half that can be wrong in ways nobody notices, because a
// slightly incorrect similarity still returns a plausible number between 0
// and 1.

/** Face-recognition models are trained at 112x112. */
export const EMBED_SIZE = 112;

/** A detected face box, in source-image pixels. */
export type FaceBox = { x: number; y: number; width: number; height: number };

/**
 * Expand a detector box into the square crop a recognition model expects.
 *
 * Detectors return a tight box around the facial features; recognition models
 * are trained on crops that include some forehead, chin and cheek margin. Feed
 * a tight box to one and every embedding shifts — consistently, so matching a
 * tight crop against a tight crop still works, but enrolment and session crops
 * come from different detector confidences and the mismatch shows up as a
 * lower score for the same person.
 *
 * Square, because a non-square crop stretched to 112x112 distorts the face by
 * the aspect ratio, and the distortion differs between a portrait webcam and a
 * landscape one.
 */
export function cropBoxFor(
  box: FaceBox,
  imageWidth: number,
  imageHeight: number,
  margin = 0.25
): FaceBox {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const side = Math.max(box.width, box.height) * (1 + margin);

  // Clamped to the frame. A face at the edge yields a smaller crop rather than
  // one padded with whatever the canvas happens to contain.
  const half = side / 2;
  const left = Math.max(0, cx - half);
  const top = Math.max(0, cy - half);
  const right = Math.min(imageWidth, cx + half);
  const bottom = Math.min(imageHeight, cy + half);

  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * L2-normalise in place-safe fashion.
 *
 * Cosine similarity is only a similarity if both vectors are unit length.
 * Skipping this is the classic face-matching bug: scores still look like
 * numbers, still order roughly correctly, and are silently scaled by each
 * embedding's magnitude — so a threshold fitted on one set of captures does not
 * transfer to another.
 */
export function l2Normalise(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  // A zero vector has no direction; normalising it would divide by zero and
  // produce NaNs that propagate into every later comparison.
  if (norm === 0 || !Number.isFinite(norm)) return new Float32Array(v.length);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/**
 * Cosine similarity of two unit-length embeddings, in [-1, 1].
 *
 * Returns null rather than a number when the vectors cannot be compared —
 * different lengths, or either one degenerate. A caller that receives null must
 * treat it as "no result", never as a low score: "I could not measure" and
 * "I measured, and it is not them" are the two findings this system exists to
 * keep apart.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return null;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  if (!Number.isFinite(sim)) return null;
  // Floating point can nudge a self-comparison to 1.0000000000000002, which
  // would look like an out-of-range score in a log.
  return Math.min(1, Math.max(-1, sim));
}

/** How the model expects its pixels arranged.
 *
 *  `nchw` is planar — all reds, then all greens, then all blues. `nhwc` is
 *  interleaved — r,g,b per pixel. PyTorch/insightface exports are usually the
 *  first; TensorFlow/Keras exports the second.
 *
 *  This matters more than it looks. A model fed the wrong layout does not
 *  error: it consumes the tensor happily and emits a well-formed embedding of
 *  the right dimension that encodes nothing about the face. Every score is then
 *  plausible and meaningless, which is indistinguishable from a threshold that
 *  needs tuning. Read the layout off the graph rather than guessing. */
export type TensorLayout = "nchw" | "nhwc";

/** How pixel values are scaled before the model sees them.
 *
 *  A property of the trained weights, not a preference. `sym` is
 *  `(x - 127.5) / 128` (insightface/ArcFace convention); `unit` is `x / 255`,
 *  common in TensorFlow ports. Wrong choice degrades the embedding rather than
 *  destroying it, so it shows up as poor discrimination, not an error. */
export type Normalisation = "sym" | "unit";

/**
 * Convert an RGBA crop into the float tensor a recognition model expects.
 *
 * Alpha is dropped: recognition models take three channels, and a crop from a
 * canvas is always fully opaque anyway.
 */
export function toModelTensor(
  rgba: Uint8ClampedArray,
  size = EMBED_SIZE,
  layout: TensorLayout = "nchw",
  normalisation: Normalisation = "sym"
): Float32Array {
  const pixels = size * size;
  if (rgba.length < pixels * 4) {
    throw new Error(`expected ${pixels * 4} RGBA bytes for a ${size}x${size} crop, got ${rgba.length}`);
  }
  const out = new Float32Array(3 * pixels);
  const scale = (v: number) => (normalisation === "sym" ? (v - 127.5) / 128 : v / 255);

  if (layout === "nchw") {
    for (let i = 0; i < pixels; i++) {
      out[i] = scale(rgba[i * 4]);
      out[pixels + i] = scale(rgba[i * 4 + 1]);
      out[2 * pixels + i] = scale(rgba[i * 4 + 2]);
    }
  } else {
    for (let i = 0; i < pixels; i++) {
      out[i * 3] = scale(rgba[i * 4]);
      out[i * 3 + 1] = scale(rgba[i * 4 + 1]);
      out[i * 3 + 2] = scale(rgba[i * 4 + 2]);
    }
  }
  return out;
}

/**
 * Combine several enrolment embeddings into one reference.
 *
 * Enrolment takes a handful of frames rather than one. A single frame bakes in
 * whatever that instant held — a blink, a half-turn, a shadow — and every later
 * session is then scored against that accident. Averaging unit vectors and
 * re-normalising gives the centroid of the captured poses, which is both more
 * stable and closer to what the person generally looks like.
 *
 * Returns null when there is nothing usable, so a caller cannot enrol an empty
 * reference and then wonder why every session scores near zero.
 */
export function averageEmbedding(embeddings: Float32Array[]): Float32Array | null {
  const usable = embeddings.filter((e) => e.length > 0);
  if (usable.length === 0) return null;
  const dim = usable[0].length;
  if (usable.some((e) => e.length !== dim)) return null;

  const sum = new Float32Array(dim);
  for (const e of usable) {
    const unit = l2Normalise(e);
    for (let i = 0; i < dim; i++) sum[i] += unit[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= usable.length;
  const centroid = l2Normalise(sum);
  return centroid.every((x) => x === 0) ? null : centroid;
}

/**
 * How tightly the enrolment frames agree with each other.
 *
 * Reported at enrolment so a poor reference can be rejected at the one moment
 * it is cheap to fix. A low spread means the frames captured one consistent
 * face; a high spread means the person moved, the lighting changed, or — the
 * case that matters — more than one person appeared across the capture.
 */
export function enrolmentCoherence(embeddings: Float32Array[]): number | null {
  if (embeddings.length < 2) return null;
  const centroid = averageEmbedding(embeddings);
  if (!centroid) return null;
  const sims: number[] = [];
  for (const e of embeddings) {
    const s = cosineSimilarity(l2Normalise(e), centroid);
    if (s !== null) sims.push(s);
  }
  if (sims.length === 0) return null;
  return sims.reduce((a, b) => a + b, 0) / sims.length;
}
