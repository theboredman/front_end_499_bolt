// Audio capture for the cued-recall narration pass (research plan §4).
//
// The narration is the primary data of van Gog et al.'s protocol — its
// measured advantage over concurrent think-aloud is in metacognitive content,
// which only exists in what the participant *says*. So this recorder fails
// loudly rather than degrading: if the microphone is denied or unavailable,
// the page must refuse to run a pass at all. A pass that quietly collected
// timings without narration would look like a completed pass and contain none
// of what the method is for.
//
// One continuous clip for the whole pass, not one per cue point: the entries
// index into it with offset pairs, so there is no per-cue upload that can fail
// silently and leave a hole in the middle of the record.

import { useCallback, useEffect, useRef, useState } from "react";

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string | undefined {
  return PREFERRED_MIME_TYPES.find(
    (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)
  );
}

export type MicState = "idle" | "requesting" | "ready" | "recording" | "denied" | "unsupported";

export type NarrationRecorder = {
  state: MicState;
  error: string;
  /** Ask for the microphone. Resolves true only if recording actually began. */
  arm: () => Promise<boolean>;
  /** Milliseconds of audio recorded so far — the clock entries index into. */
  elapsedMs: () => number;
  stop: () => Promise<Blob | null>;
};

/** Records one continuous narration clip. `arm()` must succeed before a pass
 *  can start; there is deliberately no path that returns a usable recorder
 *  without a live microphone. */
export function useNarrationRecorder(): NarrationRecorder {
  const [state, setState] = useState<MicState>("idle");
  const [error, setError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const stoppedMsRef = useRef<number | null>(null);
  const stopResolveRef = useRef<((blob: Blob | null) => void) | null>(null);

  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const arm = useCallback(async (): Promise<boolean> => {
    if (recorderRef.current) return true;

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      setError(
        "This browser cannot record audio. The cued-recall pass records what you say, " +
          "so it cannot run here — try Chrome, Edge or Firefox."
      );
      return false;
    }

    setState("requesting");
    setError("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setState("denied");
      setError(
        "Microphone access was refused, so the narration cannot be recorded. " +
          "This pass records what you say about your own session — that recording is the " +
          "point of it, so it will not run without a microphone. Grant access and reload."
      );
      return false;
    }

    const mimeType = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setState("unsupported");
      setError("This browser cannot encode audio for recording. The pass cannot run here.");
      return false;
    }

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      stoppedMsRef.current =
        startedAtRef.current === null ? 0 : performance.now() - startedAtRef.current;
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      stopResolveRef.current?.(blob.size > 0 ? blob : null);
      stopResolveRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };

    // 1s timeslices so chunks accumulate steadily; a browser or tab that dies
    // partway then still leaves most of the narration recoverable.
    rec.start(1000);
    startedAtRef.current = performance.now();
    recorderRef.current = rec;
    streamRef.current = stream;
    setState("recording");
    return true;
  }, []);

  const elapsedMs = useCallback(() => {
    if (stoppedMsRef.current !== null) return Math.round(stoppedMsRef.current);
    if (startedAtRef.current === null) return 0;
    return Math.round(performance.now() - startedAtRef.current);
  }, []);

  const stop = useCallback((): Promise<Blob | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      rec.stop();
    });
  }, []);

  return { state, error, arm, elapsedMs, stop };
}
