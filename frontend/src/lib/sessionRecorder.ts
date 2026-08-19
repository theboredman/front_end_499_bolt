import { useEffect, useRef, useState } from "react";

const PREFERRED_MIME_TYPES = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "video/webm"];

function pickMimeType(): string | undefined {
  return PREFERRED_MIME_TYPES.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
}

/**
 * Records the full session's webcam stream as one continuous clip for
 * Extractor A (docs/extractor_a.md). Mirrors the exam clock: paused while
 * `active` is false, recording while it's true — so the uploaded video's
 * timeline matches the session's own elapsed-time clock.
 *
 * Recording starts the first time a real `stream` is supplied and keeps
 * running until `stop()` is called once, at submit time.
 */
export function useSessionRecorder(stream: MediaStream | null, active: boolean) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopResolveRef = useRef<((blob: Blob | null) => void) | null>(null);
  // Whether a recorder actually exists and has started. A non-null stream is
  // not proof of one — `MediaRecorder` construction can throw on an
  // unsupported mime type and this hook returns quietly when it does, leaving
  // the session without webcam signals. The clock-sync flash waits on this
  // rather than on `stream`, because flashing before the recorder exists
  // produces an instant only one of the two recordings contains.
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!stream || recorderRef.current) return;
    const mimeType = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 500_000 });
    } catch {
      return; // MediaRecorder unsupported — this session just won't have webcam signals
    }
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "video/webm" });
      stopResolveRef.current?.(blob.size > 0 ? blob : null);
      stopResolveRef.current = null;
    };
    // 1s timeslices so chunks accumulate steadily rather than only at stop().
    rec.start(1000);
    recorderRef.current = rec;
    setRecording(true);
  }, [stream]);

  // Mirror the exam clock. The exam always starts running (active=true), so
  // the recorder's own initial "recording" state already matches — this only
  // has to handle later pause/resume toggles.
  useEffect(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (active && rec.state === "paused") rec.resume();
    else if (!active && rec.state === "recording") rec.pause();
  }, [active]);

  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
    };
  }, []);

  const stop = (): Promise<Blob | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      rec.stop();
    });
  };

  return { stop, recording };
}
