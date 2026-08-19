import { useEffect, useRef, useState } from "react";
import { averageEmbedding, enrolmentCoherence } from "../lib/faceMath";
import { IDENTITY_THRESHOLDS } from "../lib/identityConfig";
import { saveReference } from "../lib/identityStore";

// Live enrolment capture.
//
// This is the piece that was missing while the account page still said
// "Enrolled": the button recorded a consent decision and no face was ever
// captured, so the panel claimed a state the system could not back. Consent is
// now recorded only AFTER a usable reference exists on this device — see
// `onEnrolled`, which the parent calls the server from.
//
// Several frames, not one. A single frame bakes in whatever that instant held —
// a blink, a half-turn, a shadow — and every later session is then scored
// against that accident. The frames are also checked for agreement before
// anything is stored: a reference assembled from inconsistent captures produces
// poor scores forever afterwards, and the one cheap moment to catch that is
// here.

const FRAME_COUNT = 5;
const FRAME_INTERVAL_MS = 700;

type Phase = "idle" | "loading-model" | "camera" | "capturing" | "done" | "error";

export default function BiometricEnrolment({
  onEnrolled,
  onCancel,
  userId,
}: {
  userId: string;
  /** Called once a reference is stored locally. The parent records consent
   *  server-side only from here — never before. */
  onEnrolled: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [captured, setCaptured] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const fail = (message: string) => {
    setPhase("error");
    setError(message);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  };

  const run = async () => {
    setError("");
    setCaptured(0);

    // The model first. Failing here before the camera opens means we never ask
    // someone to sit for a capture we cannot use.
    setPhase("loading-model");
    let matcher: Awaited<ReturnType<typeof import("../lib/faceMatcher").createFaceMatcher>>;
    try {
      const { createFaceMatcher } = await import("../lib/faceMatcher");
      matcher = await createFaceMatcher();
    } catch (e) {
      fail(
        e instanceof Error && /model/i.test(e.message)
          ? `The face-recognition model could not be loaded. ${e.message}`
          : `Face matching could not start: ${e instanceof Error ? e.message : e}`
      );
      return;
    }

    setPhase("camera");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch {
      matcher.close();
      fail("The camera is not available. Grant camera access in your browser's site permissions and try again.");
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      matcher.close();
      fail("The preview could not start.");
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});

    // A beat before the first frame: cameras auto-expose for a second or so,
    // and the first frame of a stream is routinely darker than the rest.
    await new Promise((r) => setTimeout(r, 600));

    setPhase("capturing");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      matcher.close();
      fail("This browser cannot read frames from the camera.");
      return;
    }

    const embeddings: Float32Array[] = [];
    try {
      for (let i = 0; i < FRAME_COUNT; i++) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = await matcher.detect(frame);

        // A fact about the room, and a blocking one at enrolment: a reference
        // captured with two people present may not be the right person's.
        if (result.faces.length > 1) {
          matcher.close();
          fail(`${result.faces.length} people are visible. Enrol alone, then try again.`);
          return;
        }
        if (result.embedding) {
          embeddings.push(result.embedding.values);
          setCaptured(embeddings.length);
        }
        await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
      }
    } finally {
      matcher.close();
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (embeddings.length < 3) {
      fail(
        `Only ${embeddings.length} of ${FRAME_COUNT} frames found a face. Move somewhere better lit, ` +
          "face the camera directly, and try again."
      );
      return;
    }

    const coherence = enrolmentCoherence(embeddings);
    const reference = averageEmbedding(embeddings);
    if (!reference || coherence === null) {
      fail("The captured frames could not be combined into a reference. Try again.");
      return;
    }
    if (coherence < IDENTITY_THRESHOLDS.minEnrolmentCoherence) {
      // Caught here, where it costs thirty seconds, rather than at every
      // future session where it costs a false flag.
      fail(
        `The captured frames did not agree closely enough (${coherence.toFixed(2)} against a minimum of ` +
          `${IDENTITY_THRESHOLDS.minEnrolmentCoherence}). Hold still, keep your whole face in frame, and try again.`
      );
      return;
    }

    try {
      await saveReference({
        userId,
        embedding: reference,
        coherence,
        consentVersion: IDENTITY_THRESHOLDS.version,
        createdAt: Date.now(),
        modelUrl: IDENTITY_THRESHOLDS.modelUrl,
      });
    } catch {
      fail("The reference could not be stored in this browser. Private browsing blocks this.");
      return;
    }

    setPhase("done");
    await onEnrolled();
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="mono-label" style={{ marginBottom: 10 }}>Enrol</div>

      <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 14px" }}>
        We take {FRAME_COUNT} frames over a few seconds and combine them into one reference. The frames are
        measured and discarded — the reference stays in this browser and is never uploaded.
      </p>

      {/* Kept mounted so the stream has somewhere to attach the moment it
          arrives; hidden until there is something to show. */}
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          width: "100%",
          maxWidth: 280,
          borderRadius: 12,
          display: phase === "camera" || phase === "capturing" ? "block" : "none",
          marginBottom: 14,
          transform: "scaleX(-1)",
        }}
      />

      {phase === "capturing" && (
        <div role="status" style={{ fontFamily: "var(--mono)", fontSize: 11.5, marginBottom: 12 }}>
          Captured {captured} of {FRAME_COUNT}…
        </div>
      )}
      {phase === "loading-model" && (
        <div role="status" style={{ fontFamily: "var(--mono)", fontSize: 11.5, marginBottom: 12 }}>
          Loading the model…
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="card"
          style={{ borderColor: "var(--color-flag-ink)", color: "var(--color-flag-ink)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          className="btn btn-primary small"
          onClick={run}
          disabled={phase === "loading-model" || phase === "camera" || phase === "capturing"}
        >
          {phase === "error" ? "Try again" : phase === "idle" ? "Start capture" : "Capturing…"}
        </button>
        <button className="btn btn-ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
