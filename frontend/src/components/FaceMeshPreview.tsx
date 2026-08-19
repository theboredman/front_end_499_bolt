import { useEffect, useRef, useState } from "react";

/** `ended` = the camera was live and then stopped — unplugged, claimed by
 *  another application, or revoked from the browser's own controls.
 *
 *  It is deliberately distinct from `denied`: the participant did nothing
 *  wrong, and the fix ("reload to reconnect") is different from the one for a
 *  permission refusal. It is equally deliberately distinct from `live`, which
 *  is what this used to keep reporting — CLAUDE.md invariant 7, a non-null
 *  stream is not proof of a live track. */
export type CamStatus = "pending" | "live" | "denied" | "unsupported" | "ended";

type FaceMeshPreviewProps = {
  height?: number;
  footerLabel?: string;
  onStatus?: (status: CamStatus) => void;
  /** Receive the live MediaStream (null again when it stops) — e.g. for recording. */
  onStream?: (stream: MediaStream | null) => void;
  /** Also capture the microphone (the preview stays muted either way). */
  captureAudio?: boolean;
  /** Hand back the <video> element itself.
   *
   *  So a consumer can read frames from the stream this component already
   *  owns. The alternative — a second getUserMedia for identity sampling —
   *  would mean two live captures of the same camera, a second permission
   *  surface, and two views of the participant that could disagree. */
  onVideoElement?: (el: HTMLVideoElement | null) => void;
};

export default function FaceMeshPreview({
  height = 150,
  // Not "PROCESSED ON-DEVICE": this component renders a <video> and nothing
  // else. There is no in-browser extractor — Extractor A runs server-side on
  // the uploaded clip — so a label claiming local processing described the
  // intended architecture rather than this one.
  footerLabel = "CAMERA · LIVE PREVIEW",
  onStatus,
  onStream,
  captureAudio = false,
  onVideoElement,
}: FaceMeshPreviewProps) {
  const mono = "'IBM Plex Mono', monospace";
  const videoRef = useRef<HTMLVideoElement>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onStreamRef = useRef(onStream);
  onStreamRef.current = onStream;
  const [status, setStatus] = useState<CamStatus>("pending");
  const [stream, setStream] = useState<MediaStream | null>(null);

  const update = (s: CamStatus) => {
    setStatus(s);
    onStatusRef.current?.(s);
  };

  // Request the camera once on mount.
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      update("unsupported");
      return;
    }
    let cancelled = false;
    let acquired: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({
        // 480p is plenty: the preview is ~300px wide, and Extractor A's
        // landmark mesh does not benefit from a higher capture resolution.
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: captureAudio,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        acquired = s;
        setStream(s);
        update("live");
        onStreamRef.current?.(s);
      })
      .catch(() => {
        if (!cancelled) update("denied");
      });
    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
      onStreamRef.current?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onVideoElementRef = useRef(onVideoElement);
  onVideoElementRef.current = onVideoElement;

  // Publish the element once, and withdraw it on unmount so a consumer cannot
  // keep sampling from a detached video.
  useEffect(() => {
    onVideoElementRef.current?.(videoRef.current);
    return () => onVideoElementRef.current?.(null);
  }, []);

  // Attach the stream to the (always-mounted) <video> once both exist.
  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      const play = video.play();
      if (play) play.catch(() => {});
    }
  }, [stream]);

  // A track that ends is the webcam half of invariant 7. The screen capture
  // provider has surfaced this since it was written; the camera never did, so
  // an unplugged webcam left "Capturing video + audio" on screen for the rest
  // of the session while the clip recorded nothing.
  //
  // Every track is watched, not just video: losing the microphone alone still
  // means the recording is no longer what the participant was told it was.
  useEffect(() => {
    if (!stream) return;
    const tracks = stream.getTracks();

    const onEnded = () => {
      update("ended");
      // Hand back null so consumers holding the stream stop treating it as a
      // live source. `useSessionRecorder` keys off the stream identity, so this
      // is also what prevents it recording silence into the evidence clip.
      onStreamRef.current?.(null);
    };

    // A track can end between acquisition and this effect running.
    if (tracks.some((t) => t.readyState === "ended")) {
      onEnded();
      return;
    }

    tracks.forEach((t) => t.addEventListener("ended", onEnded));
    return () => tracks.forEach((t) => t.removeEventListener("ended", onEnded));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  const live = status === "live";

  return (
    <div
      style={{
        border: "1px solid #1A2230",
        background: "radial-gradient(120% 90% at 50% 35%, #131A24 0%, #0B0F15 70%)",
        height,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* real webcam feed — always mounted so the stream can attach */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: "scaleX(-1)",
          opacity: live ? 1 : 0,
        }}
      />

      {/* scanline overlay */}
      <div
        className="pp-scan-line"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: 2,
          background: "linear-gradient(90deg,transparent,#34D3C755,transparent)",
          top: 0,
          zIndex: 2,
        }}
      />

      {!live && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "0 16px",
          }}
        >
          <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: status === "pending" ? "#8FD6C9" : "#C4841A", lineHeight: 1.6 }}>
            {status === "pending" && "REQUESTING CAMERA ACCESS…"}
            {status === "denied" && "CAMERA BLOCKED — ALLOW ACCESS IN YOUR BROWSER"}
            {status === "unsupported" && "CAMERA NOT AVAILABLE ON THIS DEVICE"}
            {status === "ended" && "CAMERA DISCONNECTED — RELOAD TO RECONNECT"}
          </span>
        </div>
      )}

      <div style={{ position: "absolute", left: 8, bottom: 8, fontFamily: mono, fontSize: 7.5, letterSpacing: ".1em", color: "#8FD6C9", zIndex: 3 }}>
        {footerLabel}
      </div>

      {/* Announce camera state changes to screen readers. */}
      <span className="sr-only" role="status" aria-live="polite">
        {status === "pending" && "Requesting camera access."}
        {status === "live" && "Camera connected."}
        {status === "denied" && "Camera blocked. Allow camera access in your browser to continue."}
        {status === "unsupported" && "No camera available on this device."}
        {status === "ended" && "Camera disconnected. The session is no longer being recorded. Reload the page to reconnect."}
      </span>
    </div>
  );
}
