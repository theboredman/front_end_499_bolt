import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

// One screen recording for the whole sitting: started during calibration,
// running across the route change into the exam, stopped when the session is
// submitted.
//
// Why a provider rather than a hook inside a page
// -----------------------------------------------
// `getDisplayMedia()` needs a user gesture and cannot be re-acquired silently.
// If the recorder lived in Exam.tsx it would be torn down and re-requested on
// every navigation, which means either a second permission prompt mid-session
// or a gap in the recording exactly where a route change happened. Holding the
// stream above the router keeps one continuous recording, and the exam portal
// has no start button at all — by the time the participant reaches it, the
// recording is already running.
//
// Why the whole screen is required
// --------------------------------
// A window or tab share only shows the exam portal, which is the one place
// nothing interesting happens: the participant's AI tools, documentation and
// searches are all *elsewhere*. A tab-scoped recording would produce an
// evidence file that systematically excludes the behaviour being studied, and
// would do so silently. The browser cannot be forced to offer only "Entire
// screen", so the choice is verified after the fact and rejected if wrong.

export type CaptureStatus =
  | "idle"          // nothing requested yet
  | "requesting"    // permission dialog open
  | "wrong-surface" // they picked a window or tab, not the whole screen
  | "recording"
  | "stopped"
  | "error";

type CaptureContextValue = {
  status: CaptureStatus;
  error: string;
  /** Wall-clock ms at which recording began — the origin for chunk timing. */
  startedAtMs: number | null;
  /** Whole-screen recording, started from a user gesture in calibration. */
  start: () => Promise<boolean>;
  /** Stops the tracks and returns the recording. Called at submit. */
  stop: () => Promise<Blob | null>;
  chunkCount: number;
};

const CaptureContext = createContext<CaptureContextValue | null>(null);

/** Chunk interval. Long enough not to fragment a 40-minute recording into
 *  thousands of blobs, short enough that a crash loses seconds, not minutes. */
const CHUNK_MS = 5_000;

export function ScreenCaptureProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [error, setError] = useState("");
  const [chunkCount, setChunkCount] = useState(0);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    if (recorderRef.current) return true; // already running — never re-prompt

    setStatus("requesting");
    setError("");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // A request, not a guarantee: browsers may still offer window and tab
        // options. The check below is what actually enforces it.
        video: { displaySurface: "monitor", frameRate: { ideal: 5, max: 10 } },
        audio: false,
      });
    } catch (e) {
      setStatus("error");
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Screen sharing was declined. The session cannot be recorded without it."
          : "Screen sharing is unavailable in this browser."
      );
      return false;
    }

    const track = stream.getVideoTracks()[0];
    const surface = track?.getSettings?.().displaySurface;

    // Verify rather than trust. `displaySurface` is "monitor" for a whole
    // screen, "window" or "browser" otherwise. Undefined means the browser does
    // not report it — accepted rather than blocking the session on a
    // capability check, and recorded in the manifest so the gap is visible.
    if (surface && surface !== "monitor") {
      stream.getTracks().forEach((t) => t.stop());
      setStatus("wrong-surface");
      setError(
        "Please share your entire screen, not a single window or tab. " +
          "The recording is the evidence record for this session, and a " +
          "window-only capture would miss everything outside the exam page."
      );
      return false;
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm",
      videoBitsPerSecond: 800_000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
        setChunkCount(chunksRef.current.length);
      }
    };

    // The participant can stop sharing from the browser's own bar. That is not
    // an error, but it does end the evidence record, so it is surfaced rather
    // than silently leaving `status` on "recording".
    track.addEventListener("ended", () => {
      setStatus("stopped");
      setError("Screen sharing was stopped. The rest of this session is not recorded.");
    });

    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start(CHUNK_MS);
    setStartedAtMs(Date.now());
    setStatus("recording");
    return true;
  }, []);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return null;

    const finished = new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: chunksRef.current[0].type || "video/webm" })
          : null;
        resolve(blob);
      };
    });

    if (recorder.state !== "inactive") recorder.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());

    recorderRef.current = null;
    streamRef.current = null;
    setStatus("stopped");
    return finished;
  }, []);

  return (
    <CaptureContext.Provider
      value={{ status, error, startedAtMs, start, stop, chunkCount }}
    >
      {children}
    </CaptureContext.Provider>
  );
}

export function useScreenCapture(): CaptureContextValue {
  const ctx = useContext(CaptureContext);
  if (!ctx) {
    throw new Error("useScreenCapture must be used inside <ScreenCaptureProvider>");
  }
  return ctx;
}
