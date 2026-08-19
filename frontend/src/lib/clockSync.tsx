import { useEffect, useRef, useState } from "react";
import type { MetadataEvent } from "./eventLogger";

// The clapperboard: one full-screen white step, painted once, at a session time
// we record.
//
// What it is for
// --------------
// Two recordings run in parallel — the whole-screen capture started during
// calibration and the webcam clip started here — and research plan §3 requires
// both to be placed on the same session clock. Each recorder's own claim about
// its offset is only a claim. The flash is an instant that appears in BOTH
// recordings and whose session time is written into the event log, so the two
// claims can be checked against something rather than against each other.
//
// `backend/problemproof/analysis/clock_sync.py` does the checking: it finds the
// brightness step in each recording's own media time, converts each into an
// offset against the logged session time, and reports how far apart the two
// answers are. Above 100 ms the session is refused for cross-stream analysis.
//
// Why there is no clap
// --------------------
// `features.toml` describes the check as "a clap plus a full-screen white
// flash". The clap cannot work here: `getDisplayMedia` is requested with
// `audio: false`, so the screen recording has no audio track and a clap would
// appear in exactly one of the two streams. Asking a participant to perform one
// would be a ritual that synchronises nothing. The visual half does work in
// both — the screen recording sees the white directly, the webcam sees the room
// brighten — so the clapperboard here is visual only.
//
// Whether the webcam registers it is room-dependent, and the backend reports
// "not detected" rather than guessing. A session whose flash only landed in one
// stream is refused for fusion, which is the honest outcome: nothing was
// measured.
//
// Photosensitivity
// ----------------
// One step to white and back, once per sitting, with no repetition. WCAG 2.3.1
// concerns sequences of three or more flashes in a second; a single
// non-repeating luminance change is not one, which is why this is safe to paint
// without asking. It is still announced a beat beforehand rather than sprung on
// the participant, and it never repeats — if the sync fails, it fails, and the
// session is marked unfusable. Firing again to try for a better residual would
// turn a single step into exactly the sequence the guideline is about.

/** The event type the backend looks for. Must match
 *  `analysis.clock_sync.FLASH_EVENT`. */
export const FLASH_EVENT = "clock_sync_flash" as const;

/** How long the white is held.
 *
 *  Long enough to survive both recorders' frame rates: the screen capture is
 *  requested at 5 fps ideal, so a flash shorter than 200 ms can fall entirely
 *  between two frames and be recorded by neither. 400 ms guarantees at least
 *  one whole frame at 5 fps with margin for a dropped one. */
export const FLASH_MS = 400;

/** How long the warning sits on screen before the white.
 *
 *  Not a delay for its own sake: it is what makes the step announced rather
 *  than sudden, and it also gives the webcam recorder's first chunks time to
 *  land so the flash is not sitting in the container's very first frame where
 *  a truncated header could lose it. */
export const NOTICE_MS = 1_200;

/** The flash colour.
 *
 *  A literal rather than a design token, and the one place in this codebase
 *  where that is correct. Every token in the stylesheet is a *design* decision
 *  and may be re-themed; this is a *measurement* parameter. The detector looks
 *  for the largest luminance step in the recording, so the signal has to be the
 *  brightest value the display can produce. A themed near-white would shrink
 *  the step, and a dark theme swapping it would delete the measurement while
 *  leaving the code that performs it in place. */
export const FLASH_COLOR = "#FFFFFF";

export type FlashPhase = "idle" | "notice" | "flash" | "done";

type Options = {
  /** Fire once this turns true — both recorders running, session started. */
  armed: boolean;
  /** Session-relative milliseconds. The same clock every event uses. */
  sessionMs: () => number;
  /** Emits the row that tells the backend when the white was painted. */
  onFlash: (tMs: number) => void;
};

/**
 * Runs the flash exactly once per mount and reports when it was painted.
 *
 * The timestamp is taken inside `requestAnimationFrame`, not next to the
 * `setState` that requests the white. A state update schedules a render; the
 * paint happens afterwards, and on a loaded main thread "afterwards" can be
 * tens of milliseconds later. Against a 100 ms residual budget that is not a
 * rounding error — it is a quarter of the budget spent on measuring React
 * instead of measuring the recorders. The rAF callback runs immediately before
 * the frame that carries the white is composited, which is the closest this
 * environment gets to the instant the recorders actually see.
 */
export function useClockSyncFlash({ armed, sessionMs, onFlash }: Options) {
  const [phase, setPhase] = useState<FlashPhase>("idle");
  const firedRef = useRef(false);

  // Held in a ref so a re-created `onFlash` cannot re-arm the effect and fire
  // a second flash. A second flash would also be a second candidate step for
  // the detector to pick, and it picks the largest — so the measurement would
  // silently attach to whichever one the camera happened to see better.
  const onFlashRef = useRef(onFlash);
  onFlashRef.current = onFlash;
  const sessionMsRef = useRef(sessionMs);
  sessionMsRef.current = sessionMs;

  useEffect(() => {
    if (!armed || firedRef.current) return;
    firedRef.current = true;

    setPhase("notice");
    const timers: number[] = [];

    timers.push(
      window.setTimeout(() => {
        setPhase("flash");
        requestAnimationFrame(() => {
          onFlashRef.current(sessionMsRef.current());
        });
        timers.push(window.setTimeout(() => setPhase("done"), FLASH_MS));
      }, NOTICE_MS)
    );

    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [armed]);

  return phase;
}

/**
 * The overlay itself. Rendered by the exam page above everything else.
 *
 * `aria-live="polite"` on the notice and nothing on the white: a screen-reader
 * user needs to know the recordings are being synchronised, and does not need
 * the white rectangle announced.
 */
export function ClockSyncFlash({ phase }: { phase: FlashPhase }) {
  if (phase === "idle" || phase === "done") return null;

  const isFlash = phase === "flash";
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: isFlash ? FLASH_COLOR : "var(--color-ink)",
        // No transition. A fade would smear the step across several frames and
        // turn a single detectable onset into a ramp the detector rejects.
        pointerEvents: "none",
      }}
      aria-hidden={isFlash}
    >
      {!isFlash && (
        <p
          aria-live="polite"
          style={{
            color: "var(--color-paper)",
            font: "var(--type-body)",
            maxWidth: "34ch",
            textAlign: "center",
          }}
        >
          Synchronising the two recordings. The screen will flash white once.
        </p>
      )}
    </div>
  );
}

/** The event row, shaped so it passes `assert_no_content` unchanged: a type,
 *  a session-relative timestamp, and no attributes at all.
 *
 *  Typed as a `MetadataEvent` rather than cast into one at the call site. The
 *  cast compiled; it also meant `clock_sync_flash` was absent from
 *  `MetadataEventType`, so nothing would have stopped the backend's event
 *  vocabulary and the frontend's drifting apart — which is the exact class of
 *  bug the TypeScript mirror exists to catch. */
export function flashEvent(tMs: number): MetadataEvent {
  return { t_ms: tMs, type: FLASH_EVENT, attrs: {} };
}
