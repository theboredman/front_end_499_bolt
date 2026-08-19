// The real face matcher: MediaPipe FaceDetector for locating and cropping,
// ONNX Runtime Web for the recognition embedding.
//
// Kept out of `identity.ts` so that the decision logic — the part that can
// actually harm somebody — stays importable and testable without pulling in
// several megabytes of WASM. Nothing here decides anything; it turns a video
// frame into a vector and compares two vectors.
//
// Why the embedding model is not bundled
// --------------------------------------
// The detector's weights come from Google's published MediaPipe models and are
// fetched at a pinned version. The RECOGNITION weights are deliberately an
// operator choice, served from your own origin (`modelUrl`, default
// `/models/face-embedding.onnx`).
//
// That is not incompleteness, it is the one decision that should not be made
// by whoever wrote this file. A face-recognition model's demographic error
// profile is a property of its weights, and it is precisely the property this
// deployment has not measured. NIST FRVT reports error rates for specific,
// named algorithms; an unattributed ONNX pulled off the internet has no
// published characteristics at all, so bundling one would replace "we have not
// measured this" with "we cannot, even in principle, look it up". Choosing the
// model, and being able to name it in a validation report, is the operator's
// call.
//
// Any model taking a 1x3x112x112 NCHW float tensor and emitting a single
// embedding vector works — MobileFaceNet and the ArcFace family are the usual
// choices. See docs/identity-model-setup.md.

import { FilesetResolver, FaceDetector } from "@mediapipe/tasks-vision";
// The `/wasm` subpath, not the package root. The root pulls every execution
// provider, including the WebGPU/JSEP build whose WASM binary alone is 26MB —
// shipped to a candidate who will never use it, since this runs on the plain
// WASM backend. Importing the narrow entry point is a one-line change that
// removes the largest artefact in the build.
import * as ort from "onnxruntime-web/wasm";
// Vite emits these as fingerprinted assets and hands back their real URLs.
//
// Without this ONNX Runtime looks for its own runtime binaries at a default
// path that does not exist here, the dev server answers with index.html
// (SPA fallback), and the runtime tries to compile an HTML page as
// WebAssembly. The resulting error names a magic-word mismatch and mentions
// neither the missing file nor the path it wanted, which is how a build
// configuration problem comes to look like a corrupt model.
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import ortMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import {
  EMBED_SIZE,
  cosineSimilarity,
  cropBoxFor,
  l2Normalise,
  toModelTensor,
  type FaceBox,
} from "./faceMath";
import { IDENTITY_THRESHOLDS, type IdentityThresholdConfig } from "./identityConfig";
import type { FaceEmbedding, FaceMatcher } from "./identity";

//: Pinned. An identity check whose behaviour changes when a CDN updates is not
//: a check — a threshold fitted against one detector version does not
//: necessarily hold against the next.
const MEDIAPIPE_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const FACE_DETECTOR_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

export type DetectionResult = {
  /** Faces found in the frame. Length matters: more than one is a finding in
   *  its own right, and a separate one from "this face does not match". */
  faces: FaceBox[];
  /** The embedding of the largest face, or null when there was none. */
  embedding: FaceEmbedding | null;
};

export class FaceMatcherLoadError extends Error {}

/** ONNX files begin with the protobuf field header 0x08. An HTML page begins
 *  with `<`. */
const HTML_FIRST_BYTE = 0x3c;

/**
 * Check the model URL actually serves a model before handing it to the runtime.
 *
 * A dev server answers a missing path with index.html rather than a 404, so a
 * model that is simply not installed arrives as a 200 with an HTML body. ONNX
 * Runtime then reports `expected magic word 00 61 73 6d, found 3c 21 64 6f` —
 * which is `<!do`, the start of `<!doctype html>`. That message is accurate and
 * tells the reader nothing they can act on.
 *
 * Fetching two bytes first turns it into a sentence naming the file and the fix.
 */
async function assertModelPresent(url: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new FaceMatcherLoadError(
      `No recognition model at ${url} — the request failed (${e instanceof Error ? e.message : e}).`
    );
  }
  if (!res.ok) {
    throw new FaceMatcherLoadError(
      `No recognition model at ${url} — the server returned ${res.status}. ` +
        `Install one there; see docs/identity-model-setup.md.`
    );
  }
  const buffer = await res.clone().arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(1, buffer.byteLength));
  if (head[0] === HTML_FIRST_BYTE) {
    throw new FaceMatcherLoadError(
      `No recognition model at ${url} — that path returned an HTML page, which means the file is not ` +
        `there and the dev server fell back to index.html. Put an ONNX model at ` +
        `frontend/public${url} and reload; see docs/identity-model-setup.md.`
    );
  }
}

/** Point the runtime at the binaries Vite emitted, and keep it single-threaded.
 *
 *  Threaded WASM needs SharedArrayBuffer, which needs cross-origin isolation
 *  headers (COOP/COEP) that this app does not send. Left on, the runtime either
 *  fails to start or silently falls back — and a silent fallback in the middle
 *  of an identity check is worse than a slower one. */
let runtimeConfigured = false;
function configureRuntime(): void {
  if (runtimeConfigured) return;
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
  ort.env.wasm.numThreads = 1;
  runtimeConfigured = true;
}

/**
 * Load the detector and the recognition model.
 *
 * Throws rather than degrading. A matcher that silently falls back to "no faces
 * detected" would make every session look like the candidate was absent, which
 * is a finding about a person produced by a missing file.
 */
export async function createFaceMatcher(
  config: IdentityThresholdConfig = IDENTITY_THRESHOLDS
): Promise<FaceMatcher & { detect(frame: ImageData): Promise<DetectionResult>; close(): void }> {
  let detector: FaceDetector;
  try {
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_DETECTOR_MODEL },
      runningMode: "IMAGE",
    });
  } catch (e) {
    throw new FaceMatcherLoadError(
      `Face detector failed to load: ${e instanceof Error ? e.message : e}`
    );
  }

  configureRuntime();
  // Before the runtime, so a missing model reads as a missing model.
  await assertModelPresent(config.modelUrl);

  let session: ort.InferenceSession;
  try {
    session = await ort.InferenceSession.create(config.modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  } catch (e) {
    throw new FaceMatcherLoadError(
      `Recognition model failed to load from ${config.modelUrl}: ` +
        `${e instanceof Error ? e.message : e}. See docs/identity-model-setup.md.`
    );
  }

  // One reusable canvas. Allocating a 112x112 canvas per sample would churn
  // GPU memory during a 40-minute session sampling every 15 seconds.
  const canvas = document.createElement("canvas");
  canvas.width = EMBED_SIZE;
  canvas.height = EMBED_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new FaceMatcherLoadError("2D canvas is unavailable in this browser");

  const source = document.createElement("canvas");
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) throw new FaceMatcherLoadError("2D canvas is unavailable in this browser");

  let dimChecked = false;

  async function detect(frame: ImageData): Promise<DetectionResult> {
    source.width = frame.width;
    source.height = frame.height;
    sourceCtx!.putImageData(frame, 0, 0);

    const detections = detector.detect(source).detections ?? [];
    const faces: FaceBox[] = detections
      .map((d) => d.boundingBox)
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((b) => ({ x: b.originX, y: b.originY, width: b.width, height: b.height }));

    if (faces.length === 0) return { faces, embedding: null };

    // The largest face is the one at the keyboard. A face in a poster on the
    // wall behind them is smaller, and the count above already records that
    // more than one was present.
    const largest = faces.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    const crop = cropBoxFor(largest, frame.width, frame.height);

    ctx!.drawImage(
      source,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      EMBED_SIZE,
      EMBED_SIZE
    );
    const rgba = ctx!.getImageData(0, 0, EMBED_SIZE, EMBED_SIZE).data;

    // Dims must match the layout, not just the element count. An NHWC model
    // handed [1,3,112,112] reads the tensor along the wrong axes and returns a
    // well-formed embedding of nothing in particular.
    const dims: number[] =
      config.modelLayout === "nchw"
        ? [1, 3, EMBED_SIZE, EMBED_SIZE]
        : [1, EMBED_SIZE, EMBED_SIZE, 3];
    const input = new ort.Tensor(
      "float32",
      toModelTensor(rgba, EMBED_SIZE, config.modelLayout, config.modelNormalisation),
      dims
    );
    const feeds: Record<string, ort.Tensor> = { [session.inputNames[0]]: input };
    const output = await session.run(feeds);
    const raw = output[session.outputNames[0]].data as Float32Array;

    if (!dimChecked) {
      dimChecked = true;
      if (raw.length !== config.embeddingDim) {
        // Loud, once. A wrong-shaped model still produces numbers, and those
        // numbers still compare — as uniformly poor scores that would read as
        // "this candidate does not match themselves".
        throw new FaceMatcherLoadError(
          `Model at ${config.modelUrl} emits ${raw.length}-d embeddings, expected ` +
            `${config.embeddingDim}. This is the wrong model, or embeddingDim is wrong.`
        );
      }
    }

    return {
      faces,
      embedding: { kind: "face-embedding", values: l2Normalise(new Float32Array(raw)) },
    };
  }

  return {
    available: true,
    async embed(frame: ImageData) {
      return (await detect(frame)).embedding;
    },
    compare(a: FaceEmbedding, b: FaceEmbedding) {
      const sim = cosineSimilarity(a.values, b.values);
      if (sim === null) {
        // "Could not measure" must never arrive as a low score — that is the
        // difference between a fact about the room and a claim about a person.
        throw new Error("embeddings are not comparable");
      }
      return sim;
    },
    detect,
    close() {
      detector.close();
      void session.release?.();
    },
  };
}
