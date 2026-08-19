import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import FaceMeshPreview, { type CamStatus } from "../components/FaceMeshPreview";
import AudioMeter from "../components/AudioMeter";
import ConfirmDialog from "../components/ConfirmDialog";
import { DRAFT_KEY, claimSession, clearDraft, fmtClock, type SessionEvent } from "../lib/sessions";
import { useSessionRecorder } from "../lib/sessionRecorder";
import { rememberExtractionJob, startExtraction, uploadWebcam } from "../lib/webcamExtraction";
import { useScreenCapture } from "../lib/screenCapture";
import { readCalibrationProvenance } from "../lib/calibration";
import { useEventLogger, textInsertionEvent, type LoggedEvent, type MetadataEvent } from "../lib/eventLogger";
import { ClockSyncFlash, flashEvent, useClockSyncFlash } from "../lib/clockSync";
import { readPreparedAssessment } from "../lib/personalisation";
import { exportSessionEvidence, uploadScreenRecording } from "../lib/exportSession";
import { DEFAULT_COHORT, IDENTITY_THRESHOLDS } from "../lib/identityConfig";
import { initialExamMatchState, judgeExamSample, type ExamMatchState } from "../lib/identity";
import { createSampler, frameFromVideo, type IdentitySampler } from "../lib/identitySampler";
import { useAuth } from "../lib/auth";
import {
  activeMs,
  awayMs,
  emptyLedger,
  withGapResolved,
  withPauseClosed,
  withPauseOpened,
  type PauseLedger,
} from "../lib/timebase";

const mono = "var(--mono)";

// The exam portal reads from the shared tokens rather than a private palette.
//
// It previously declared its own thirteen colours and carried 37 hardcoded hex
// literals — the largest single violation of Frontend Spec §4's "nothing
// hardcodes a hex outside the token block", and the reason `C.rec` and `--red`
// were two different reds for the same semantic role. Restyling to the
// instrument-panel language was the moment to collapse them.
const C = {
  pageBg: "var(--bg)",
  panel: "var(--surface)",
  subtle: "#F7F8FA",
  inset: "#F1F2F6",
  border: "var(--border)",
  borderStrong: "#DCDFE7",
  ink: "var(--color-graphite-ink)",
  ink2: "var(--text-body)",
  muted: "var(--color-slate)",
  faint: "var(--faint)",
  teal: "var(--color-cognition-blue)",
  tealInk: "var(--teal-dark)",
  // The recording indicator is a genuine signal peak — coral, per the
  // reference's rule that coral marks a moment rather than decorating one.
  rec: "var(--color-coral-ink)",
};

const PROBLEM_NAME = "Idempotent batch retry";

//: The problem shown when no assessment was prepared at /assessment.
//
// Kept, rather than making /assessment mandatory. A participant who reaches
// /exam directly still gets a real, valid problem and a real session — and the
// panel says plainly that it is the default one rather than theirs, because a
// generic problem rendered as though it were personalised would misdescribe
// the record.
const DEFAULT_PROBLEM = {
  headline:
    "Failed rows in the ingest pipeline must be retried — without ever creating duplicates.",
  body:
    "A nightly batch writes rows to a downstream sink. Some rows fail mid-batch. On retry, " +
    "the naive re-run double-writes rows that already landed. Design an approach that " +
    "re-runs only the true failures and can prove nothing was written twice.",
  constraints: [
    "Sink offers upsert + existing_ids, no transactions.",
    "Requirements are deliberately underspecified.",
    "Any tools, docs or AI permitted.",
  ],
};

const PHASES = [
  { num: "1", name: "Understanding", accent: "var(--color-cognition-blue)" },
  { num: "2", name: "Decomposition", accent: "var(--color-cognition-blue)" },
  { num: "3", name: "Exploration", accent: "#6A4FCB" },
  { num: "4", name: "Execution", accent: "var(--color-coral-ink)" },
  { num: "5", name: "Recovery", accent: "var(--color-flag-ink)" },
  { num: "6", name: "Verification", accent: "var(--color-mint-ink)" },
];

// The editor is a single buffer, so `targetFile` on ai_output_accepted is
// constant for now. It stays in the schema because a multi-file editor is the
// obvious next step and the event shape should not have to change for it.
const EDITOR_FILENAME = "solution.py";

const STARTER_CODE = `# Retry failed rows without ever double-writing.
# The sink offers: sink.upsert(id, payload) and sink.existing_ids(ids).
# Write your approach below — any tools, docs or AI are permitted.

def retry_batch(rows, sink):
    ...
`;

type SavedDraft = {
  code: string;
  elapsed: number;
  phase: number;
  maxPhase: number;
  keystrokes: number;
  events: SessionEvent[];
  // --- timebase (Frontend Spec §8.1) ---------------------------------------
  //
  // Enough to rebuild the monotonic clock on remount, and to work out how long
  // the session went unobserved in between. `elapsed` above is now a derived
  // display value, so it is saved for the resume banner only and is never read
  // back as the source of truth.
  /** `sessionMs()` at the moment of the write. */
  rawMs?: number;
  /** Σ matched pause spans at the moment of the write. */
  pausedMs?: number;
  /** Σ unobserved spans at the moment of the write. */
  unknownMs?: number;
  /** t_ms of an unmatched `pause_start`, or null if the clock was running. */
  pauseOpenAtMs?: number | null;
  /** `performance.now()` at the write. Same document ⇒ the clock is continuous
   *  and the time away is exact; a smaller value on restore means a new
   *  document, and the wall clock has to stand in. */
  perfNowAtSave?: number;
  /** `Date.now()` at the write. The only measure of time away that survives a
   *  reload, and the reason a crash can be accounted for at all. */
  savedAtWall?: number;
  /** The metadata log itself. Persisted so that an unmatched `pause_start`
   *  survives a crash and can be resolved into a `session_gap` on return —
   *  without it there is nothing to leave unmatched. Metadata only, same
   *  content rules as the live log. */
  metadataEvents?: LoggedEvent[];
};

export default function Exam() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [code, setCode] = useState(STARTER_CODE);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  const [phase, setPhase] = useState(0);
  const [maxPhase, setMaxPhase] = useState(0);
  const [intensity, setIntensity] = useState(0);
  const [keystrokes, setKeystrokes] = useState(0);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  // Reported by the preview, which owns the tracks. Invariant 7: the rail
  // below reads this rather than `camStream != null`, because a stopped track
  // leaves the stream object behind and the old check went on saying
  // "Capturing video + audio" for the rest of the session.
  const [camStatus, setCamStatus] = useState<CamStatus>("pending");
  const [confirm, setConfirm] = useState<null | "reset" | "submit" | "exit">(null);

  const [metadataEventCount, setMetadataEventCount] = useState(0);


  // Kept in refs rather than state: these can grow into hundreds of entries
  // per session and are only read at submit time, not rendered live.
  const screenChunksRef = useRef<Blob[]>([]);
  const metadataEventsRef = useRef<LoggedEvent[]>([]);
  const sessionStartMsRef = useRef(performance.now());

  // --- pause accounting (Frontend Spec §8.1) --------------------------------
  //
  // `elapsed` is DERIVED from this ledger every tick and is never incremented.
  // Two clocks that advance independently is exactly how the display and the
  // event log drifted apart before. The arithmetic lives in lib/timebase.ts so
  // it can be tested against its own edge cases; this page holds the ledger and
  // does no timing maths of its own.
  const ledgerRef = useRef<PauseLedger>(emptyLedger());

  // --- identity continuity (Identity Spec §4.5) -----------------------------
  //
  // All optional. `samplerRef` stays null whenever matching cannot run, and
  // every use is guarded, so a session behaves exactly as before when there is
  // no reference on this device or no model installed.
  const samplerRef = useRef<IdentitySampler | null>(null);
  const matchStateRef = useRef<ExamMatchState>(initialExamMatchState());
  const matchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const matchVideoRef = useRef<HTMLVideoElement | null>(null);
  const matchInFlight = useRef(false);
  const [identityFlagged, setIdentityFlagged] = useState(false);

  const elapsedRef = useRef(elapsed);
  const runningRef = useRef(running);
  const lastTickRef = useRef(performance.now());
  const keyTimesRef = useRef<number[]>([]); // wall-clock ms of recent keystrokes
  const lastTypedRef = useRef(0);
  const eventSeq = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  elapsedRef.current = elapsed;
  runningRef.current = running;

  const logEvent = useCallback((kind: string, text: string, color: string) => {
    setEvents((prev) => [...prev, { id: eventSeq.current++, at: elapsedRef.current, kind, text, color }]);
  }, []);

  // Restore a prior in-progress session, then record the session start.
  //
  // Restoring is where the timebase is most easily corrupted, so it is done in
  // one place and in one order: rebase the monotonic clock onto the saved
  // session, account for the time away, then restore the visible state.
  useEffect(() => {
    let restored = false;
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") as SavedDraft | null;
      if (saved && typeof saved.elapsed === "number" && saved.code) {
        // How long was this session unobserved? Two cases, and they need
        // different clocks.
        //
        //   Same document (navigated to /candidate and back): performance.now()
        //   never reset, so the time away is exact.
        //
        //   New document (reload, crash, reopened tab): performance.now()
        //   restarted at zero, so it is smaller than the saved reading and
        //   useless as a difference. Date.now() is the only measure that
        //   survived. It is wall clock and therefore subject to the system
        //   clock being changed under us — which is why it is the fallback and
        //   not the primary, and why the result is booked as *unknown* time
        //   rather than trusted as a duration.
        const savedRaw = saved.rawMs ?? Math.round((saved.elapsed ?? 0) * 1000);
        const away = awayMs(saved, { perfNow: performance.now(), wall: Date.now() });

        const resolved = withGapResolved(
          {
            pausedMs: saved.pausedMs ?? 0,
            unknownMs: saved.unknownMs ?? 0,
            pauseOpenAtMs: saved.pauseOpenAtMs ?? null,
          },
          savedRaw,
          away
        );
        ledgerRef.current = resolved.ledger;

        // Rebase so `sessionMs()` continues the saved session's numbering
        // instead of restarting at zero. Every t_ms already in the log stays
        // valid, which is the whole point of a session-relative base.
        sessionStartMsRef.current = performance.now() - resolved.nowMs;

        if (Array.isArray(saved.metadataEvents)) {
          metadataEventsRef.current = saved.metadataEvents;
          setMetadataEventCount(saved.metadataEvents.length);
        }

        if (resolved.unknownMs > 0) {
          onMetadataEvent({
            t_ms: resolved.nowMs,
            type: "session_gap",
            attrs: { unknown_ms: resolved.unknownMs, while_paused: resolved.whilePaused },
          });
          logEvent(
            "GAP",
            resolved.whilePaused
              ? `Resumed after ${fmtClock(resolved.unknownMs / 1000)} away — paused when contact was lost, so the whole span is recorded as unobserved`
              : `Resumed after ${fmtClock(resolved.unknownMs / 1000)} away — recorded as unobserved`,
            "var(--color-coral-ink)"
          );
        }

        setCode(saved.code);
        setPhase(saved.phase ?? 0);
        setMaxPhase(saved.maxPhase ?? saved.phase ?? 0);
        setKeystrokes(saved.keystrokes ?? 0);
        if (Array.isArray(saved.events)) {
          setEvents(saved.events);
          eventSeq.current = saved.events.reduce((m, e) => Math.max(m, e.id + 1), 0);
        }
        setElapsed(activeSec());
        restored = true;
      }
    } catch {
      /* corrupt/absent — start fresh */
    }
    if (!restored) {
      logEvent("SESSION", "Session started · clock running", C.teal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Identity sampling.
  //
  // Every `examSampleIntervalSec`, not every frame: a recognition inference is
  // ~40ms and this page is already encoding video, logging events and running
  // the editor (Frontend Spec §12 — the exam page is the constraint). Sampling
  // is skipped entirely while paused, because a paused session is one nobody
  // is claiming to be observing.
  //
  // `matchInFlight` drops a sample rather than queueing it. If an inference has
  // not finished by the time the next tick arrives, the right behaviour is to
  // miss that sample — a backlog of stale frames would push every later
  // timestamp away from the moment it actually described.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void createSampler(user.id).then((sampler) => {
      if (cancelled) sampler?.close();
      else samplerRef.current = sampler;
    });
    return () => {
      cancelled = true;
      samplerRef.current?.close();
      samplerRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const sampler = samplerRef.current;
      const video = matchVideoRef.current;
      if (!sampler || !video || !runningRef.current || matchInFlight.current) return;

      if (!matchCanvasRef.current) matchCanvasRef.current = document.createElement("canvas");
      const frame = frameFromVideo(video, matchCanvasRef.current);
      if (!frame) return;

      matchInFlight.current = true;
      const tMs = sessionMs();
      void sampler
        .sample(frame, tMs)
        .then((sample) => {
          if (!sample) return;
          const judged = judgeExamSample(
            matchStateRef.current,
            sample,
            DEFAULT_COHORT,
            IDENTITY_THRESHOLDS
          );
          matchStateRef.current = judged.state;
          if (judged.event) onMetadataEvent(judged.event);
          // Only an ENFORCED flag is surfaced. In shadow the event is recorded
          // and the candidate is told nothing, because nothing has been
          // decided about them.
          if (judged.flagRaised) {
            setIdentityFlagged(true);
            logEvent("IDENTITY", "Camera continuity flag raised · a person will review this", C.rec);
          }
        })
        .finally(() => {
          matchInFlight.current = false;
        });
    }, IDENTITY_THRESHOLDS.examSampleIntervalSec * 1000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Master clock + typing-intensity meter.
  //
  // The clock RECOMPUTES `elapsed` from the monotonic base every tick rather
  // than adding to it. A dropped tick, a throttled background tab or a long
  // frame therefore costs nothing: the next tick lands on the correct value
  // instead of inheriting the shortfall forever. The intensity meter still
  // needs a delta, so it keeps its own `lastTick` — it is a decay animation,
  // not a measurement, and nothing downstream reads it.
  useEffect(() => {
    lastTickRef.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      if (!runningRef.current) return;

      setElapsed(activeSec());

      // keystrokes in the last 4 seconds → typing intensity
      const cutoff = now - 4000;
      keyTimesRef.current = keyTimesRef.current.filter((t) => t >= cutoff);
      const target = Math.min(100, keyTimesRef.current.length * 6);
      setIntensity((v) => v + (target - v) * Math.min(1, dt * 1.6));
    }, 120);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the draft as it evolves.
  //
  // `elapsed` is deliberately NOT a dependency. It changes every 120 ms, and
  // depending on it made this effect serialise the whole growing draft to
  // localStorage roughly eight times a second for the length of the session
  // (Frontend Spec §12). The timing fields are read from refs at write time
  // instead, so a write still records an accurate clock — it just happens when
  // something the participant did changes, rather than on every tick.
  /** Snapshot the in-progress session, including everything needed to rebuild
   *  the timebase on return. Called by the effect below, and again on the way
   *  out of the page so that a deliberate exit is timestamped at the moment it
   *  happened rather than at the last keystroke before it. */
  const writeDraft = () => {
    const payload: SavedDraft = {
      code,
      elapsed: elapsedRef.current,
      phase,
      maxPhase,
      keystrokes,
      events,
      rawMs: sessionMs(),
      pausedMs: ledgerRef.current.pausedMs,
      unknownMs: ledgerRef.current.unknownMs,
      pauseOpenAtMs: ledgerRef.current.pauseOpenAtMs,
      perfNowAtSave: performance.now(),
      savedAtWall: Date.now(),
      metadataEvents: metadataEventsRef.current,
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      /* storage unavailable — non-fatal */
    }
  };

  useEffect(() => {
    writeDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, phase, maxPhase, keystrokes, events, running]);

  // Full-session recording for Extractor A (hand-crafted webcam signals —
  // blink rate, gaze, head pose, motion — see docs/extractor_a.md). One
  // continuous clip, uploaded once at submit.
  //
  // This is the only sanctioned webcam path: physical signals, no inferred
  // state category. A live emotion classifier previously ran alongside it and
  // was removed — see docs/removed-emotion-monitor.md.
  const webcamRecorder = useSessionRecorder(camStream, running);

  // The recording was started during calibration and has been running ever
  // since. This page only reads its status and stops it at submit — there is
  // deliberately no control here.
  const screen = useScreenCapture();

  // Structured event log: metadata only (see lib/eventLogger.ts for exactly
  // what this can and can't see from inside a single browser tab).
  const onMetadataEvent = useCallback((e: MetadataEvent) => {
    metadataEventsRef.current.push(e);
    setMetadataEventCount(metadataEventsRef.current.length);
  }, []);
  useEventLogger({
    active: running,
    sessionOriginMs: sessionStartMsRef.current,
    onEvent: onMetadataEvent,
  });

  /** Session-relative milliseconds — the §3 timestamp base. Never emit a raw
   *  performance.now() reading: it is relative to page load, which is a
   *  different instant with an offset nobody records.
   *
   *  Monotonic. It does NOT stop for a pause: it is the axis the screen
   *  recording, the webcam clip and the event log are all indexed against, and
   *  a clock that stopped would put every later timestamp out of register with
   *  footage that kept rolling. */
  const sessionMs = () => Math.round(performance.now() - sessionStartMsRef.current);

  // The question prepared at /assessment, if there was one.
  //
  // Read once into a ref rather than state: it does not change during a
  // sitting, and re-reading it on each render would let a second tab's
  // preparation appear mid-session and change what the participant is being
  // asked halfway through.
  //
  // Its session id is REUSED at submit. Minting a fresh one there would file
  // the recording in a different directory from the `question.json` and
  // `exam_spec.json` that describe it, and the process record would then be
  // evidence of solving a problem stored somewhere else.
  const preparedRef = useRef(readPreparedAssessment());
  const prepared = preparedRef.current;

  // The clapperboard (research plan §3, features.toml `capture.clock_sync`).
  //
  // Fired once, when BOTH recorders are confirmed running — the whole-screen
  // capture started back in calibration, and the webcam clip started on this
  // page. An instant that lands in only one recording synchronises nothing, so
  // this waits on `webcamRecorder.recording` rather than on the camera stream
  // existing: `MediaRecorder` construction can fail on an unsupported mime
  // type, and a non-null stream is not proof a recorder came up.
  //
  // The row it emits is what gives the flash a session time. Without it the two
  // recordings agree with each other on an instant neither can place on the
  // session clock, and `analysis/clock_sync.py` reports the session unmeasured.
  const flashPhase = useClockSyncFlash({
    armed: webcamRecorder.recording && screen.status === "recording" && running,
    sessionMs: () => sessionMs(),
    onFlash: (tMs) => onMetadataEvent(flashEvent(tMs)),
  });

  /** Seconds of *observed solving* — the number shown to the participant.
   *
   *  Derived, never counted: raw − paused − unobserved, with any pause still
   *  open subtracted live so the display freezes during a pause without a
   *  second clock existing to freeze. This is the whole of §8.1's second rule;
   *  if this function is ever replaced by an accumulator, the drift comes back. */
  const activeSec = () => activeMs(sessionMs(), ledgerRef.current) / 1000;

  /** Close an open pause span and bank it.
   *
   *  Called from resume and from submit — anywhere the session stops being
   *  paused for a reason we witnessed. A pause closed here is *measured* time
   *  and counts toward the ledger's `pausedMs`; one that is never closed is handled
   *  on restore instead, and counts as unknown. */
  const closePause = (t: number) => {
    const { ledger, closedMs } = withPauseClosed(ledgerRef.current, t);
    ledgerRef.current = ledger;
    // `closedMs === null` means nothing was open. Emitting a `pause_end` with
    // no `pause_start` would be worse than emitting no row at all.
    if (closedMs !== null) {
      onMetadataEvent({ t_ms: t, type: "pause_end", attrs: { paused_ms: closedMs } });
    }
  };

  /** Log an event the portal observed directly.
   *
   *  `source: "portal"` marks these as *observed*, not reconstructed. They are
   *  the only AI-taxonomy events with that status now that the in-app
   *  assistant is gone: everything about the participant's actual AI use is
   *  inferred from OS-level capture and carries a measured precision and
   *  recall. See backend/problemproof/events.py. */
  const logPortalEvent = useCallback((event: Exclude<LoggedEvent, MetadataEvent>) => {
    metadataEventsRef.current.push(event);
    setMetadataEventCount(metadataEventsRef.current.length);
  }, []);

  // The one AI-taxonomy event still observed rather than inferred. The
  // participant writes their solution here whatever tools they used to get it,
  // so a Run is directly visible — which is what keeps verification_latency
  // measurable at all when the generation side is only reconstructed.
  const runCode = () => {
    logPortalEvent({ type: "verification_action", t_ms: sessionMs(), source: "portal", attrs: { kind: "run" } });
    logEvent("VERIFY", "Ran the code", "var(--color-mint-ink)");
  };

  // Auto-grow the textarea with its content.
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, [code]);

  const onCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!runningRef.current) return; // typing is disabled while paused
    const next = e.target.value;
    // Text that appeared faster than the keyboard could have produced it. The
    // `paste` event covers the clipboard route; this catches the rest —
    // drag-drop, autocomplete, an IME commit, a selection replaced — and is
    // what makes "inserted" separable from "typed" at all. A length, never the
    // text itself.
    const insertion = textInsertionEvent(code.length, next.length, sessionMs());
    if (insertion) onMetadataEvent(insertion);

    setCode(next);
    const now = performance.now();
    keyTimesRef.current.push(now);
    lastTypedRef.current = now;
    setKeystrokes((k) => k + 1);
  };

  // Apply a programmatic edit and restore the caret/selection after render,
  // so Tab-to-indent behaves like a normal keystroke.
  const applyCode = (next: string, selStart: number, selEnd: number) => {
    setCode(next);
    const now = performance.now();
    keyTimesRef.current.push(now);
    lastTypedRef.current = now;
    setKeystrokes((k) => k + 1);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.selectionStart = selStart;
        ta.selectionEnd = selEnd;
      }
    });
  };

  // Keep Tab inside the editor: indent instead of moving focus.
  const onCodeKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!runningRef.current || e.key !== "Tab") return;
    e.preventDefault();
    const INDENT = "    ";
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = code;

    // Simple caret, forward tab → insert an indent at the caret.
    if (!e.shiftKey && start === end) {
      applyCode(value.slice(0, start) + INDENT + value.slice(end), start + INDENT.length, start + INDENT.length);
      return;
    }

    // Otherwise operate on whole lines spanned by the selection/caret.
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(lineStart, end);
    const newBlock = e.shiftKey ? block.replace(/^( {1,4}|\t)/gm, "") : block.replace(/^/gm, INDENT);
    const next = value.slice(0, lineStart) + newBlock + value.slice(end);
    applyCode(next, lineStart, lineStart + newBlock.length);
  };

  // Pause and resume, emitted DIRECTLY rather than through `useEventLogger`.
  //
  // The logger is detached while paused (`active: running`), so it is
  // structurally incapable of reporting the pause it is being suspended by —
  // asking it to would mean the one event that explains a hole in the log is
  // the one event the hole swallows.
  //
  // The side effects also sit outside the state updater. React 18 StrictMode
  // invokes updaters twice in development, and an updater that emitted an event
  // would log every pause twice — the same bug shape
  // `test_the_task_transition_is_not_inside_a_state_updater` pins down in
  // CalibrationSession.
  const togglePause = () => {
    const t = sessionMs();
    if (runningRef.current) {
      ledgerRef.current = withPauseOpened(ledgerRef.current, t);
      onMetadataEvent({ t_ms: t, type: "pause_start", attrs: {} });
      logEvent("PAUSE", "Session paused · screen recording continues", "var(--color-coral-ink)");
      setRunning(false);
    } else {
      closePause(t);
      logEvent("RESUME", "Session resumed", "var(--color-coral-ink)");
      setRunning(true);
    }
    lastTickRef.current = performance.now();
  };

  // NOT A LABEL SOURCE. Research plan §4 chose retrospective cued recall over
  // any concurrent method precisely to avoid the reactivity problem: asking
  // someone to classify their own phase while solving changes the process being
  // measured. These clicks are a navigation aid for the candidate — a way to
  // orient in the problem — and nothing downstream may read them as ground
  // truth.
  //
  // Three things keep that structural rather than a matter of discipline:
  //   1. The event type is `phase_marker_clicked`, not any phase vocabulary the
  //      analysis layer recognises. `labels.PHASES` is a different list of
  //      different strings.
  //   2. It is written to events.jsonl, never to labels.json. The only writer
  //      of labels.json is the /label route via problemproof.labels.save_labels.
  //   3. `analysis.feature_assembly.EVENT_TYPES` does not include it, so it
  //      cannot even become a model feature by accident.
  //
  // The real labels come from /label/:sessionId, afterwards.
  const markPhase = (i: number) => {
    setPhase(i);
    setMaxPhase((m) => Math.max(m, i));
    const p = PHASES[i];
    logPortalEvent({
      type: "phase_marker_clicked",
      t_ms: sessionMs(),
      source: "portal",
      attrs: { marker_index: i },
    });
    logEvent("NAV", `Marked ${p.name} · navigation only, not a label`, p.accent);
  };

  const submit = async () => {
    // One id for every stream: the webcam clip, the screen recording and the
    // event log all land in the same session folder on the backend.
    //
    // When an assessment was prepared, that directory ALREADY exists and holds
    // `exam_spec.json` and `question.json`. Reusing its id is what keeps the
    // recording and the problem it was a recording of in the same place.
    const sessionId = prepared?.sessionId ?? String(Date.now());

    // Submitting while paused closes the pause first. The participant is
    // present and acting, so the span ends here and is measured — this is the
    // one exit from a pause that is not a resume. Without it the final span
    // would be left unmatched and later booked as unknown, which would be a
    // false claim: we watched it end.
    closePause(sessionMs());

    // Record ownership before anything is uploaded. The session record now
    // lives on the server against this account rather than in this browser
    // (Frontend Spec §9) — claiming first means the evidence that follows
    // lands in a directory that already has a tenant, rather than sitting
    // unowned for however long the uploads take.
    //
    // The owner comes from the auth token server-side; nothing identifying is
    // sent from here. Failure is non-fatal and deliberately not surfaced: the
    // candidate has finished, and the local draft is retained below so the
    // work is recoverable rather than lost.
    let claimed = true;
    try {
      await claimSession(sessionId, {
        problem: prepared?.question.family_key ?? PROBLEM_NAME,
        duration_ms: Math.round(activeSec() * 1000),
        paused_ms: ledgerRef.current.pausedMs,
        unknown_ms: ledgerRef.current.unknownMs,
        pause_count: metadataEventsRef.current.filter((e) => e.type === "pause_start").length,
        submitted_at_epoch_ms: Date.now(),
        // Banked by the guard when this sitting's ticket was consumed. A
        // session with no calibration behind it must not be indistinguishable
        // from one with a full run behind it — the manifest is what carries
        // that past the moment the ticket was spent.
        calibration: readCalibrationProvenance(),
      });
    } catch {
      claimed = false;
    }

    // The draft is cleared only once the session has an owner. If the claim
    // failed, the draft is the only remaining copy of forty minutes of work
    // and throwing it away to keep the happy path tidy would be the worst
    // possible trade.
    if (claimed) clearDraft();

    // Best-effort: hand the recorded webcam clip to Extractor A and move on.
    // Extraction takes minutes (see docs/vram_budget.md), so this must never
    // block navigation — Verify.tsx polls for the result independently.
    webcamRecorder
      .stop()
      .then((blob) => {
        if (!blob) return;
        return uploadWebcam(sessionId, blob)
          .then(() => startExtraction(sessionId))
          .then((jobId) => rememberExtractionJob(sessionId, jobId));
      })
      .catch(() => {
        /* no backend reachable, or recording never started — Verify.tsx
           shows "no signal data" rather than surfacing this to a candidate
           who has already submitted. */
      });

    // Stream B, same deal: upload if the backend is reachable, fall back to a
    // local download if not, and never block the candidate on either.
    if (metadataEventsRef.current.length > 0 || screenChunksRef.current.length > 0) {
      void exportSessionEvidence({
        sessionId,
        startedAtIso: new Date().toISOString(),
        // RAW span, not active time. The 1 Hz feature rows are binned on t_ms,
        // which is monotonic and includes pauses — handing this the active
        // duration would truncate the table short of the last events in it.
        //
        // Pause spans are excluded downstream by reading the pause events, not
        // by shortening the axis (§8.1 rule 4). Both feature tables carry a
        // `paused` column read off those events — `summarizeEvents` here and
        // `feature_extractor.extract_features` for the desktop agent — and
        // `backend/problemproof/pause_spans.py` is what the training matrix and
        // the κ computation exclude on.
        //
        // This comment previously asserted that exclusion as fact while nothing
        // downstream read a pause event; the analysis half of §8.1 rule 4 was
        // unimplemented. Do not re-shorten the axis to compensate.
        durationMs: sessionMs(),
        screenChunks: screenChunksRef.current,
        metadataEvents: metadataEventsRef.current,
      }).catch(() => {
        /* evidence could be neither uploaded nor downloaded — same reasoning
           as above, this is not the moment to alarm the candidate. */
      });
    }

    // The whole-sitting recording ends here, at submit, having run since
    // calibration. Uploading it must not block navigation.
    void screen
      .stop()
      .then((blob) => (blob ? uploadScreenRecording(sessionId, blob) : null))
      .catch(() => {
        /* no backend, or nothing recorded — Verify.tsx shows what it has. */
      });

    navigate("/verify");
  };

  const reset = () => {
    clearDraft();
    setCode(STARTER_CODE);
    setElapsed(0);
    setPhase(0);
    setMaxPhase(0);
    setIntensity(0);
    setKeystrokes(0);
    eventSeq.current = 0;
    setEvents([]);
    setRunning(true);
    lastTickRef.current = performance.now();
    keyTimesRef.current = [];
    screenChunksRef.current = [];
    metadataEventsRef.current = [];
    setMetadataEventCount(0);
    sessionStartMsRef.current = performance.now();
    // The pause ledger is part of the timebase and resets with it. Carrying a
    // previous run's totals forward would subtract them from a clock that no
    // longer contains them, and the derived elapsed would start out wrong.
    ledgerRef.current = emptyLedger();
    logEvent("SESSION", "Session reset · clock running", C.teal);
  };

  const codeLines = useMemo(() => code.split("\n"), [code]);
  const pct = Math.round(intensity);
  const barColor = pct >= 70 ? C.rec : pct >= 40 ? "var(--color-coral-ink)" : C.teal;
  const recentlyTyped = performance.now() - lastTypedRef.current < 2500;
  const activity = !running ? "Paused" : recentlyTyped ? "Typing" : "Thinking";
  const shownEvents = events.slice().reverse();

  // Camera state, read from the track rather than from the stream object.
  const camLive = camStatus === "live";
  const camLabel = {
    pending: "Waiting for camera + mic…",
    live: running ? "Capturing video + audio" : "Capture paused",
    denied: "Camera blocked — nothing is being captured",
    unsupported: "No camera on this device — nothing is being captured",
    ended: "CAMERA DISCONNECTED — NOT CAPTURING",
  }[camStatus];

  const screenLabel = {
    idle: "NOT RECORDING",
    requesting: "AWAITING PERMISSION",
    "wrong-surface": "WRONG SHARE TYPE",
    recording: "RECORDING · ENTIRE SCREEN",
    stopped: "STOPPED",
    error: "ERROR",
  }[screen.status];
  const screenColor =
    screen.status === "recording" ? C.rec : screen.status === "stopped" || screen.status === "idle" ? C.faint : "var(--color-coral-ink)";

  const Label = ({ children, color = C.muted }: { children: React.ReactNode; color?: string }) => (
    <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".2em", color, textTransform: "uppercase", marginBottom: 10 }}>{children}</div>
  );

  return (
    <div className="exam-page">
      <a href="#content" className="skip-link">
        Skip to editor
      </a>

      {/* One white step, once, so both recordings share a visible instant.
          Above everything else in the tree because the screen capture records
          the whole display and must see it unobstructed. */}
      <ClockSyncFlash phase={flashPhase} />

      {/* A session entered through the development bypass has no calibration
          behind it: nobody was verified, no baseline was fitted, and the
          signals recorded here are scored against nothing. Said plainly and
          permanently, because the alternative is a recording that looks
          exactly like a real one. Mono, per the type rule — this is a fact the
          system measured about itself, not prose. */}
      {readCalibrationProvenance() === "bypassed_development" && (
        <div
          role="status"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: ".14em",
            textAlign: "center",
            padding: "6px 12px",
            background: "var(--surface)",
            color: "var(--amber)",
            borderBottom: "1px solid var(--amber)",
          }}
        >
          PP_MODE=DEVELOPMENT · CALIBRATION BYPASSED · NOT VALID EVIDENCE
        </div>
      )}

      {/* Capture status, announced (Frontend Spec §10).
          A sighted participant learns the screen share stopped from a colour
          and a label in the right rail. Without this, a screen-reader user
          learns it never, and goes on working in a session that has stopped
          producing the evidence the whole exercise depends on — which is the
          same silent-degradation failure invariant 7 exists to prevent, just
          for a different reader.

          `assertive`, not `polite`: this interrupts, because continuing to
          work unrecorded is exactly what it needs to stop. */}
      <span className="sr-only" role="status" aria-live="assertive">
        {screen.status === "recording" && "Screen recording is running, entire screen."}
        {screen.status === "stopped" && "Screen sharing has stopped. The rest of this session is not being recorded."}
        {screen.status === "wrong-surface" && "Wrong share type. Share your entire screen to be recorded."}
        {screen.status === "error" && "Screen recording error. This session is not being recorded."}
        {camStatus === "ended" && " Camera disconnected. The webcam recording for the rest of this session is empty."}
      </span>
      {/* top bar */}
      <header className="exam-header">
        <Link
          to="/candidate"
          aria-label="Exit session and return to my sessions"
          title="Exit session"
          onClick={(e) => {
            e.preventDefault();
            setConfirm("exit");
          }}
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, background: C.teal }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: "#fff" }} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>ProblemProof</span>
        </Link>
        <div style={{ width: 1, height: 22, background: C.borderStrong }} />
        <span style={{ fontFamily: mono, fontSize: 12.5, color: C.ink2 }}>
          {prepared ? `${prepared.question.family_key} · ${prepared.question.tier}` : PROBLEM_NAME}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 11px",
              borderRadius: 999,
              background: running ? "#FDEEEB" : C.inset,
              border: `1px solid ${running ? "#F7D5CD" : C.border}`,
            }}
          >
            <span className={running ? "pp-rec-dot" : ""} style={{ width: 8, height: 8, borderRadius: "50%", background: running ? C.rec : C.faint }} />
            <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".16em", color: running ? C.rec : C.faint }}>
              {running ? "REC" : "PAUSED"}
            </span>
          </div>
          <span style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: C.ink, letterSpacing: ".02em", minWidth: 66 }}>{fmtClock(elapsed)}</span>
          <button
            className="exam-btn"
            onClick={togglePause}
            aria-label={
              running
                ? "Pause session — stops the clock, the screen recording continues"
                : "Resume session and restart the clock"
            }
            title={running ? "Pause the session — the screen recording continues" : "Resume the session"}
          >
            {running ? "❚❚ Pause" : "▶ Resume"}
          </button>
          <button
            className="exam-btn"
            onClick={() => setConfirm("reset")}
            aria-label="Reset session — clears code, timer and event log"
            title="Reset the session"
          >
            ↺ Reset
          </button>
          <button
            className="exam-btn submit"
            onClick={() => setConfirm("submit")}
            aria-label="Submit and end the session"
            title="Submit the session"
          >
            Submit session ↗
          </button>
        </div>
      </header>

      {/* body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "330px 1fr 320px", gap: 14, padding: 14, background: C.pageBg, minHeight: 0 }}>
        {/* left — problem + phases */}
        <aside style={{ background: C.panel, borderRadius: 14, border: `1px solid ${C.border}`, overflowY: "auto", padding: "22px 22px 30px" }}>
          <Label color={C.tealInk}>Problem</Label>
          {prepared ? (
            <>
              {/* Sans, per the type rule: the prompt is prose meant for a human,
                  even though a program assembled it. The family key beneath it
                  is mono, because that IS a measured, machine-assigned
                  identifier and the thing comparisons group on. */}
              <p style={{ fontSize: 13.5, lineHeight: 1.7, color: C.ink, margin: "0 0 16px", whiteSpace: "pre-wrap" }}>
                {prepared.question.prompt}
              </p>
              <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.subtle, padding: "12px 14px", marginBottom: 14 }}>
                <Label>What to produce</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 11.5, color: C.ink2, lineHeight: 1.4 }}>
                  {prepared.question.deliverables.map((d) => (
                    <div key={d} style={{ display: "flex", gap: 8 }}>
                      <span style={{ color: "var(--color-coral-ink)" }}>·</span>
                      <span>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.subtle, padding: "12px 14px", marginBottom: 22 }}>
                <Label>Scored on</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 11.5, color: C.ink2, lineHeight: 1.4 }}>
                  {prepared.question.rubric.dimensions.map((d) => (
                    <div key={d.id} style={{ display: "flex", gap: 8 }}>
                      <span style={{ color: "var(--color-coral-ink)" }}>·</span>
                      <span>{d.id.replace(/_/g, " ")}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: C.faint, marginTop: 10 }}>
                  {prepared.question.family_key} · {prepared.question.tier} ·{" "}
                  {prepared.question.duration_minutes} min
                </div>
              </div>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 17, lineHeight: 1.35, fontWeight: 700, margin: "0 0 12px", color: C.ink }}>
                {DEFAULT_PROBLEM.headline}
              </h1>
              <p style={{ fontSize: 12.5, lineHeight: 1.65, color: C.ink2, margin: "0 0 16px" }}>
                {DEFAULT_PROBLEM.body}
              </p>
              <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.subtle, padding: "12px 14px", marginBottom: 14 }}>
                <Label>Constraints</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 11.5, color: C.ink2, lineHeight: 1.4 }}>
                  {DEFAULT_PROBLEM.constraints.map((c) => (
                    <div key={c} style={{ display: "flex", gap: 8 }}>
                      <span style={{ color: "var(--color-coral-ink)" }}>·</span>
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Said plainly. A generic problem rendered as though it were
                  personalised would misdescribe the record this session
                  produces. */}
              <p style={{ fontFamily: mono, fontSize: 10.5, color: C.faint, margin: "0 0 22px", lineHeight: 1.5 }}>
                DEFAULT PROBLEM — no assessment was prepared for this sitting, so this is
                the standard one rather than a question built from your own skills.
              </p>
            </>
          )}

          <Label color={C.tealInk}>Problem-solving phase</Label>
          <div style={{ fontSize: 10.5, color: C.faint, marginBottom: 14, lineHeight: 1.4 }}>
            Mark the phase you're working in — it's logged to your process trail.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {PHASES.map((p, i) => {
              const active = i === phase;
              const passed = i < phase;
              return (
                <button
                  key={p.num}
                  onClick={() => markPhase(i)}
                  className="phase-btn"
                  aria-pressed={active || passed}
                  aria-current={active ? "step" : undefined}
                  aria-label={`Phase ${p.num}: ${p.name} — ${active ? "in progress" : passed ? "marked" : "not started"}`}
                  style={{
                    borderRadius: 9,
                    background: active ? "#F0F6F5" : "transparent",
                    boxShadow: active ? `inset 2px 0 0 ${p.accent}` : "none",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      border: `1px solid ${active ? p.accent : passed ? "#C7D0DC" : C.border}`,
                      background: active ? p.accent : passed ? "#EAEFF5" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: mono,
                      fontSize: 10,
                      fontWeight: 700,
                      color: active ? "#fff" : passed ? C.muted : C.faint,
                      flexShrink: 0,
                    }}
                  >
                    {p.num}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: active ? C.ink : passed ? C.ink2 : C.faint }}>{p.name}</span>
                    <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".06em", color: active ? p.accent : C.faint }}>
                      {active ? "IN PROGRESS" : passed ? "MARKED" : "NOT STARTED"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* center — editor */}
        <main id="content" tabIndex={-1} style={{ background: C.panel, borderRadius: 14, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${C.border}`, background: C.subtle }}>
            <span style={{ display: "flex", gap: 6 }}>
              {["#E5484D", "#E9A93D", "var(--color-mint-ink)"].map((d) => (
                <span key={d} style={{ width: 10, height: 10, borderRadius: "50%", background: d, opacity: 0.85 }} />
              ))}
            </span>
            <span style={{ fontFamily: mono, fontSize: 11.5, color: C.tealInk, marginLeft: 4 }}>retry_batch.py</span>
            <span style={{ fontFamily: mono, fontSize: 10, color: C.faint, marginLeft: "auto" }}>capture {running ? "on" : "paused"}</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0, background: C.panel, position: "relative" }}>
            {!running && (
              <div
                style={{
                  position: "absolute",
                  top: 12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 14px",
                  borderRadius: 999,
                  background: "var(--accent-tint)",
                  border: "1px solid #F0D9B0",
                  color: "var(--color-cognition-blue)",
                  fontFamily: mono,
                  fontSize: 11,
                  fontWeight: 600,
                  boxShadow: "0 2px 8px rgba(27,36,50,.08)",
                  pointerEvents: "none",
                }}
              >
                ❚❚ Paused — the clock is stopped, the screen recording is not
              </div>
            )}
            <div style={{ display: "flex", minHeight: "100%" }}>
              <div
                aria-hidden
                style={{
                  flexShrink: 0,
                  textAlign: "right",
                  padding: "16px 12px 16px 8px",
                  fontFamily: mono,
                  fontSize: 13,
                  lineHeight: "22px",
                  color: "#B7C0CE",
                  background: C.subtle,
                  borderRight: `1px solid ${C.border}`,
                  userSelect: "none",
                }}
              >
                {codeLines.map((_, i) => (
                  <div key={i}>{String(i + 1).padStart(2, "0")}</div>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                value={code}
                onChange={onCodeChange}
                onKeyDown={onCodeKeyDown}
                aria-label="Solution code editor"
                spellCheck={false}
                disabled={!running}
                style={{
                  flex: 1,
                  resize: "none",
                  overflow: "hidden",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: C.ink,
                  fontFamily: mono,
                  fontSize: 13,
                  lineHeight: "22px",
                  padding: "16px 16px 16px 14px",
                  caretColor: C.teal,
                  whiteSpace: "pre",
                }}
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "9px 16px", borderTop: `1px solid ${C.border}`, background: C.subtle, fontFamily: mono, fontSize: 10.5, color: C.faint }}>
            <span>{codeLines.length} lines</span>
            <span>·</span>
            <span>{EDITOR_FILENAME}</span>
            <span>·</span>
            <span>autosaved locally</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost small" onClick={runCode} disabled={!running}>
              ▶ Run
            </button>
          </div>

        </main>

        {/* right — webcam + audio + screen capture + activity + event log */}
        <aside style={{ background: C.panel, borderRadius: 14, border: `1px solid ${C.border}`, overflowY: "auto", padding: 16 }}>
          <Label>Proctoring · live capture</Label>
          <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${C.border}`, marginBottom: 8 }}>
            <FaceMeshPreview
              height={150}
              captureAudio
              footerLabel={camLive ? "CAMERA FEED · LIVE" : "CAMERA FEED"}
              onStream={setCamStream}
              onStatus={setCamStatus}
              onVideoElement={(el) => {
                matchVideoRef.current = el;
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
            <span
              className={camLive && running ? "pp-rec-dot" : ""}
              style={{ width: 7, height: 7, borderRadius: "50%", background: camLive ? C.rec : camStatus === "ended" ? C.rec : C.faint }}
            />
            <span style={{ fontFamily: mono, fontSize: 9.5, color: camStatus === "ended" ? C.rec : C.muted, letterSpacing: ".04em" }}>
              {camLabel}
            </span>
          </div>
          {identityFlagged && (
            <div
              role="alert"
              style={{
                border: `1px solid ${C.rec}`,
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 14,
                fontSize: 11,
                lineHeight: 1.55,
                color: C.ink2,
              }}
            >
              <strong style={{ color: C.rec }}>Camera continuity flag raised.</strong> A person will review
              this. Your session is continuing normally and nothing has been decided. Flags are often raised
              by lighting, camera angle, or someone passing behind you.
            </div>
          )}

          {camStatus === "ended" && (
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.rec, lineHeight: 1.5, marginBottom: 14 }}>
              The webcam recording for the rest of this session is empty. Reload to reconnect the camera.
            </div>
          )}

          {/* real-time audio */}
          <Label>Audio input</Label>
          <div style={{ marginBottom: 18 }}>
            <AudioMeter stream={camStream} active={running} />
          </div>

          {/* Screen recording — started during calibration, running since.
              Deliberately no control here: it is one continuous recording for
              the whole sitting, and a stop/start button would put gaps in the
              evidence record exactly where the participant chose. */}
          <Label>Screen recording · evidence capture</Label>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <span className={screen.status === "recording" ? "pp-rec-dot" : ""} style={{ width: 7, height: 7, borderRadius: "50%", background: screenColor }} />
            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".14em", color: screenColor }}>{screenLabel}</span>
          </div>
          {screen.error && (
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.rec, lineHeight: 1.5, marginBottom: 8 }}>{screen.error}</div>
          )}
          <div style={{ fontFamily: mono, fontSize: 9, color: C.faint, lineHeight: 1.5, marginBottom: 18 }}>
            {metadataEventCount} metadata events logged · {screen.chunkCount} recording segments.
            Recording started at calibration and stops when you submit.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".14em", color: C.muted }}>TYPING INTENSITY</span>
              <span style={{ fontFamily: mono, fontSize: 10, color: barColor }}>{pct}%</span>
            </div>
            <div style={{ height: 7, background: C.inset, border: `1px solid ${C.border}`, borderRadius: 4, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: barColor, transition: "width .3s ease" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            {[
              ["ACTIVITY", activity, C.ink],
              ["KEYSTROKES", String(keystrokes), "var(--color-mint-ink)"],
            ].map(([k, v, c]) => (
              <div key={k} style={{ flex: 1, background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 9, padding: "9px 11px" }}>
                <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".12em", color: C.faint, marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: c }}>{v}</div>
              </div>
            ))}
          </div>

          <Label>Event log</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {shownEvents.length === 0 && (
              <div style={{ fontFamily: mono, fontSize: 10, color: C.faint, padding: "8px 2px" }}>No events yet — start solving.</div>
            )}
            {shownEvents.map((e) => (
              <div
                key={e.id}
                className="event-row"
                style={{ borderRadius: 8, background: C.subtle, border: `1px solid ${C.border}`, borderLeft: `3px solid ${e.color}` }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: ".1em", color: e.color }}>{e.kind}</span>
                  <span style={{ fontFamily: mono, fontSize: 8.5, color: C.faint }}>{fmtClock(e.at)}</span>
                </div>
                <div style={{ fontSize: 11, color: C.ink2, marginTop: 3, lineHeight: 1.4 }}>{e.text}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {confirm === "reset" && (
        <ConfirmDialog
          title="Reset this session?"
          message="This clears your code, timer, phases and event log, and starts a fresh session. This can't be undone."
          confirmLabel="Reset session"
          cancelLabel="Keep working"
          tone="danger"
          onConfirm={() => {
            reset();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "submit" && (
        <ConfirmDialog
          title="Submit and end the session?"
          message="Your process record is finalized and you'll move to the report. You can't change the session after submitting."
          confirmLabel="Submit session"
          cancelLabel="Not yet"
          onConfirm={() => {
            setConfirm(null);
            submit();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "exit" && (
        <ConfirmDialog
          title="Leave the session?"
          message={
            "Your progress is autosaved on this device — you can resume right where you left off from My sessions. " +
            "Time away is recorded as unobserved, and the screen recording keeps running until you submit."
          }
          confirmLabel="Leave session"
          cancelLabel="Stay here"
          onConfirm={() => {
            setConfirm(null);
            // Stamp the draft on the way out. Without this the last write is
            // whenever the participant last typed, and every second between
            // that and the click is booked as unobserved — time they were in
            // fact sitting here.
            writeDraft();
            navigate("/candidate");
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
