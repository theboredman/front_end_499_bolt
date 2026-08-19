// One sampler, used by both the calibration flow and the exam page.
//
// Shared deliberately. The two surfaces do different things with a score — one
// gates entry, the other flags for review — but they must PRODUCE it
// identically, or a threshold fitted against calibration scores would not
// transfer to exam scores and the asymmetry in invariant 12 would be comparing
// two different measurements.
//
// The whole module is best-effort by design. `create` returns null whenever
// matching cannot run — off, no reference on this device, model missing — and
// every caller treats null as "not sampling" rather than as a failure. Nobody
// is blocked from calibrating or sitting an exam because a model file is
// absent or they enrolled in a different browser.

import { cosineSimilarity } from "./faceMath";
import type { MatchSample } from "./identity";
import { IDENTITY_THRESHOLDS, shouldSample, type IdentityThresholdConfig } from "./identityConfig";
import { loadReference } from "./identityStore";

export type IdentitySampler = {
  /** Measure one frame. Null when the frame yielded nothing comparable —
   *  which is NOT the same as a low score and must never be treated as one. */
  sample(frame: ImageData, tMs: number): Promise<MatchSample | null>;
  close(): void;
};

/**
 * Build a sampler, or return null if identity matching cannot run here.
 *
 * Null covers every "we are not doing this" case and is deliberately not
 * distinguished by the return type: a caller that had to branch on the reason
 * would end up encoding policy at the call site, and there are two call sites.
 * Reasons are logged for the developer, not surfaced to the candidate mid-flow.
 */
export async function createSampler(
  userId: string,
  config: IdentityThresholdConfig = IDENTITY_THRESHOLDS
): Promise<IdentitySampler | null> {
  if (!shouldSample(config)) return null;

  const stored = await loadReference(userId);
  // Enrolled in another browser, or never enrolled. Both are ordinary states
  // (the reference is device-local by design) and neither is a match failure.
  if (!stored) return null;
  if (stored.modelUrl !== config.modelUrl) return null;

  let matcher: Awaited<ReturnType<typeof import("./faceMatcher").createFaceMatcher>>;
  try {
    const { createFaceMatcher } = await import("./faceMatcher");
    matcher = await createFaceMatcher(config);
  } catch (e) {
    // A missing or broken model must not stop a session. It stops MATCHING.
    console.warn("[identity] matching unavailable:", e instanceof Error ? e.message : e);
    return null;
  }

  const reference = { kind: "face-embedding" as const, values: stored.embedding };

  return {
    async sample(frame, tMs) {
      try {
        const { faces, embedding } = await matcher.detect(frame);
        if (!embedding) {
          // Nobody in frame. Reported as a sample with a null score so the
          // caller can emit `identity_absent`, which is a different finding
          // from a low match.
          return { tMs, faceCount: faces.length, score: null };
        }
        const score = cosineSimilarity(embedding.values, reference.values);
        return { tMs, faceCount: faces.length, score };
      } catch {
        // A single failed inference is not evidence about the person.
        return null;
      }
    },
    close() {
      matcher.close();
    },
  };
}

/** Pull an ImageData frame from a playing <video>, or null if it is not ready.
 *
 *  Shared so both surfaces size the canvas the same way. A mismatch here would
 *  change the crop geometry between calibration and exam, which shifts every
 *  embedding and therefore every score.
 */
export function frameFromVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): ImageData | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Reduce a calibration run's samples to the single verdict the server is sent.
 *
 * The worst sample decides, not the average. Calibration is the strict side of
 * invariant 12 and it is checking one claim — that the person in front of this
 * camera is the enrolled one — so a run containing a stretch that did not match
 * has not established that claim, however good its other frames were. An
 * average would let a good majority bury exactly the window worth looking at.
 *
 * Returns null when nothing was measurable, which the caller sends as no
 * verdict at all rather than as a failure.
 */
export function summariseCalibration(samples: MatchSample[]): MatchSample | null {
  const scored = samples.filter((s) => s.score !== null);
  const multi = samples.find((s) => s.faceCount > 1);
  // More than one face anywhere in the run is its own finding and outranks the
  // scores — a calibration recorded with someone else present is not a clean
  // baseline whatever the similarity said.
  if (multi) return multi;
  if (scored.length === 0) {
    return samples.length > 0 ? { tMs: samples[0].tMs, faceCount: 0, score: null } : null;
  }
  return scored.reduce((worst, s) => ((s.score as number) < (worst.score as number) ? s : worst));
}
