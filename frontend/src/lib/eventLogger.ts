// Structured, metadata-only event logging for the exam portal.
//
// IMPORTANT SCOPE NOTE: this runs inside a single browser tab, so it can only
// see what that tab is legitimately allowed to see — tab visibility, copy/
// paste, keystroke timing, and idle time. It CANNOT see other native
// applications, other browser tabs' domains, or file-save events outside
// this page — that visibility requires either a browser extension (tabs API)
// or the OS-level desktop agent (see the separate Python monitoring system:
// screen_recorder.py + event_logger.py). The two are complementary, not
// duplicates: this module covers "did the candidate leave/return to the
// exam tab and how did they type", the desktop agent covers "what else were
// they doing on the machine".
//
// Never logged: the character typed, clipboard contents, or any page text.

import { useEffect, useRef } from "react";

export type MetadataEventType =
  | "tab_hidden"
  | "tab_visible"
  | "window_blur"
  | "window_focus"
  | "copy"
  | "paste"
  | "text_insertion"
  | "keystroke"
  | "idle_start"
  | "idle_end"
  // --- accounted-for absence (Frontend Spec §8.1) --------------------------
  //
  // These three exist so that time the session was NOT being observed is
  // explicit in the log rather than inferred from a hole in it. The screen
  // recording runs continuously (invariant 2), so every one of these spans has
  // footage behind it and no events beside it; without a row saying why, that
  // asymmetry reads as a capture bug.
  //
  // They are emitted by the pause handler and the draft-restore path directly,
  // NOT through `useEventLogger` — that hook is detached while paused, which is
  // precisely why it cannot be the thing that reports the pause.
  | "pause_start"
  | "pause_end"
  // --- identity continuity (Identity Spec §4.5, invariant 12) --------------
  //
  // On the same monotonic timebase as the pause events, so a flag can be lined
  // up against what the participant was doing and against the screen recording.
  //
  // `identity_multiple_faces` is NOT a variety of match failure and must not be
  // folded into one. "Someone else is in the room" is a fact about the room;
  // "this face does not match" is a claim about a person. A reviewer needs to
  // tell them apart, and a candidate who had a flatmate walk past deserves a
  // different conversation from one accused of substitution.
  | "identity_match_ok"
  | "identity_match_low"
  | "identity_absent"
  | "identity_multiple_faces"
  // A span nobody watched: the tab was closed, navigated away from, or crashed.
  // Distinct from `pause_end` because a pause is time we observed the start and
  // end of, and this is not. See `while_paused` below.
  | "session_gap"
  // --- cross-stream synchronisation (research plan §3) ---------------------
  //
  // The session time at which the exam page painted a full-screen white step.
  // Both recordings see that instant, so it is what lets each recorder's
  // claimed offset be checked against something rather than against the other.
  // `backend/problemproof/analysis/clock_sync.py` reads it; without this row a
  // brightness step found in the videos cannot be placed on the session clock
  // and the session is reported unsynchronised.
  //
  // Carries no attributes at all, deliberately — the timestamp IS the payload.
  | "clock_sync_flash";

// The research plan §3 envelope, frozen: one JSON object per line, with
// `t_ms` **relative to session start**, never wall clock or a raw
// performance.now() reading. See backend/problemproof/events.py for why the
// timestamp base matters more than the field names do.
export type MetadataEvent = {
  t_ms: number;
  type: MetadataEventType;
  attrs: {
    interval_ms?: number; // only on "keystroke": time since the previous keystroke
    idle_duration_ms?: number; // only on "idle_end"
    // On "copy" and "paste": how many characters moved. `null` means the
    // length could not be read, which is deliberately distinct from 0 — the
    // desktop agent's `_clipboard_length` uses the same convention, and the
    // accept inference treats an unreadable length as a miss rather than
    // guessing at it.
    //
    // A length, never the text. §2.3 Build A sanctions "clipboard events:
    // length and timestamp only", and `assert_no_content` in
    // backend/problemproof/events.py accepts an integer under this name while
    // rejecting anything that could carry a payload.
    char_count?: number | null;
    // Only on "text_insertion": signed change in editor length. Positive is an
    // insertion, negative a deletion.
    char_delta?: number;
    // Only on "pause_end": the length of the span this closes. Redundant with
    // the two t_ms values by design — a consumer reading one row should not
    // have to scan backwards for its opening partner to know the duration.
    paused_ms?: number;
    // Only on "session_gap": how long the session went unobserved.
    unknown_ms?: number;
    // --- identity attrs ----------------------------------------------------
    //
    // A number and the number it was compared against. Nothing else is
    // permissible here: invariant 5 covers biometric content as surely as it
    // covers keystrokes, and an embedding in an event payload would be a face
    // template in the event log by another name. There is deliberately no
    // field that could hold a vector, a frame, a crop, or a landmark set.
    //
    /** Only on identity_match_*: cosine similarity to the enrollment
     *  embedding, rounded. A scalar comparison result, not a representation —
     *  one number per sample cannot reconstruct a face. */
    match_score?: number;
    /** The threshold in force when this sample was judged. Recorded per event
     *  rather than looked up later, because the config can change and a past
     *  decision has to stay re-auditable against the numbers that produced it. */
    match_threshold?: number;
    /** Which config produced the threshold. */
    threshold_version?: string;
    /** Only on identity_match_low: how many consecutive low samples this flag
     *  represents. One low sample is noise; a run of them is a finding. */
    consecutive_low?: number;
    /** Whether this row was acted on, or merely observed.
     *
     *  In shadow mode the matcher runs and records what it would have decided
     *  without being allowed to decide it. Without this flag a shadow
     *  observation and a real accusation are the same row in the log, and a
     *  reviewer reading it months later could not tell which had happened. */
    enforced?: boolean;
    /** Only on identity_multiple_faces: how many faces were visible. A count,
     *  never a position or a descriptor. */
    face_count?: number;
    // Only on "session_gap": whether a pause was open when contact was lost.
    //
    // When true, the gap SUBSUMES that pause — the whole span from pause_start
    // to recovery is counted as unknown, and no `pause_end` is emitted for it.
    // An unmatched pause_start is time nobody watched end, and banking it as
    // paused would be claiming an observation that was never made. The flag
    // preserves the fact that the participant had at least *started* a pause,
    // which is weak evidence about the gap's nature but not proof of its length.
    while_paused?: boolean;
  };
};

// --- AI-interaction taxonomy (research plan §2.3, Build B) -----------------
//
// Mirror of backend/problemproof/events.py — that module is the contract, this
// is its TypeScript face, and backend/tests/test_events_schema.py checks the
// two against each other.
//
// There is no in-portal AI assistant. The participant uses whatever tools and
// websites they like, in their own browser, and everything about that use is
// reconstructed afterwards from OS-level capture — foreground window, clipboard
// lengths, keystroke timing — against a continuous screen recording kept as the
// evidence a human annotator checks the reconstruction against.
//
//   source: "portal"    observed directly by this UI. Only the editor's Run
//                       button and the phase rail qualify.
//   source: "inferred"  reconstructed from capture, and carrying a *measured*
//                       precision and recall per event type from
//                       backend/problemproof/analysis/event_validation.py.
//
// Note which events the browser can construct at all. It emits exactly one
// AI-taxonomy event — verification_action, typed `source: "portal"` as a
// literal. Everything inferred is produced backend-side from the capture log;
// the browser has no business asserting it, and cannot.
//
// No field here holds content. Lengths, counts, durations, enums and short
// identifiers only.

export type AiEventSource = "portal" | "inferred";

/** Short identifier for the tool — "chatgpt", "claude", … Never a window title
 *  or URL; the desktop agent maps process/title hashes to these. */
export type AiToolId = string;

export type VerificationKind = "run" | "test" | "dwell" | "lint";

export type AiEvent =
  // The only AI-taxonomy event this UI observes directly: the participant
  // writes their solution here whatever tools produced it, so a Run is visible.
  // It is what keeps verification_latency measurable when the generation side
  // is only reconstructed.
  { type: "verification_action"; t_ms: number; source: "portal"; attrs: { kind: VerificationKind } };

export type AiEventType = AiEvent["type"];

// --- Navigation, explicitly not a label ------------------------------------
//
// The exam portal's phase rail. Research plan §4 chose retrospective cued
// recall over any concurrent method to avoid the reactivity problem — asking
// someone to classify their phase while solving changes the process being
// measured — so these clicks are a navigation aid and nothing more.
//
// `marker_index` rather than a phase name, on purpose. The attribute carries no
// member of the phase vocabulary at all, so there is nothing here for a
// downstream consumer to mistake for a label even if it went looking. Real
// labels come from /label/:sessionId and live in labels.{source}.json.
export type NavEvent = {
  type: "phase_marker_clicked";
  t_ms: number;
  source: "portal";
  attrs: { marker_index: number };
};

/** Every event the exam portal can emit. Named `LoggedEvent` rather than
 *  `SessionEvent` because `lib/sessions.ts` already owns that name for the
 *  human-readable activity rail, which is a different thing entirely. */
export type LoggedEvent = MetadataEvent | AiEvent | NavEvent;

type EventLoggerOptions = {
  active: boolean;
  /** performance.now() reading at session start. Every emitted `t_ms` is
   *  measured from here, so the log is session-relative per §3 — a raw
   *  performance.now() value is relative to page load, which is not the same
   *  instant and would carry an unrecorded offset. */
  sessionOriginMs: number;
  idleThresholdMs?: number; // default 30s, matches the desktop agent's default
  onEvent: (e: MetadataEvent) => void;
};

/** The largest editor-length change a single keypress can account for.
 *
 *  A character insert is +1 and a backspace is -1. Anything bigger arrived in
 *  one step without the keyboard producing it a character at a time: a paste,
 *  a drag-drop, an autocomplete or IME commit, or a selection replaced
 *  wholesale. That is the distinction `text_insertion` exists to record, and
 *  it is the one the event log could not previously make — it held inter-key
 *  timing and no notion of document size at all, so a 400-character insertion
 *  and a single typed character were the same one `keystroke` row.
 */
export const SINGLE_KEYPRESS_DELTA = 1;

/** A `text_insertion` event, or null when the change is ordinary typing.
 *
 *  Returning null for |delta| <= 1 is what keeps the log readable: a session
 *  of 1230 keystrokes would otherwise carry 1230 events restating what the
 *  `keystroke` rows already say. Only changes the keyboard cannot explain are
 *  worth a row.
 *
 *  Lives here rather than in the editor page so that the threshold and the
 *  attribute name stay next to the contract they belong to.
 */
export function textInsertionEvent(
  prevLength: number,
  nextLength: number,
  t_ms: number,
): MetadataEvent | null {
  const delta = nextLength - prevLength;
  if (Math.abs(delta) <= SINGLE_KEYPRESS_DELTA) return null;
  return { t_ms, type: "text_insertion", attrs: { char_delta: delta } };
}

/** Attaches document/window-level listeners for the lifetime of `active`. */
export function useEventLogger({
  active,
  sessionOriginMs,
  idleThresholdMs = 30_000,
  onEvent,
}: EventLoggerOptions) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const originRef = useRef(sessionOriginMs);
  originRef.current = sessionOriginMs;

  const lastKeystrokeRef = useRef<number | null>(null);
  const lastInputRef = useRef(performance.now());
  const isIdleRef = useRef(false);
  const idleSinceRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const emit = (type: MetadataEventType, attrs: MetadataEvent["attrs"] = {}) => {
      cb.current({ t_ms: Math.round(performance.now() - originRef.current), type, attrs });
    };

    const onVisibility = () => emit(document.hidden ? "tab_hidden" : "tab_visible");
    const onBlur = () => emit("window_blur");
    const onFocus = () => emit("window_focus");

    // Lengths, read in this handler and discarded. The string is measured and
    // goes out of scope in this frame — the same discipline the desktop
    // agent's `_clipboard_length` follows, and the reason neither ever holds
    // clipboard text.
    //
    // Copy and paste need different sources. On a `copy` event the clipboard
    // has not been written yet and `clipboardData` is empty unless a handler
    // fills it, so the length of what is *about* to be copied is the current
    // selection. On `paste` the incoming data is already there to read.
    const onCopy = () => {
      let chars: number | null = null;
      try {
        chars = document.getSelection()?.toString().length ?? null;
      } catch {
        chars = null; // no selection API, or a cross-origin selection
      }
      emit("copy", { char_count: chars });
    };

    const onPaste = (e: ClipboardEvent) => {
      let chars: number | null = null;
      try {
        const text = e.clipboardData?.getData("text");
        chars = text === undefined ? null : text.length;
      } catch {
        chars = null; // no clipboardData, or a non-text payload (image, file)
      }
      emit("paste", { char_count: chars });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const now = performance.now();
      lastInputRef.current = now;
      // Skip pure modifier presses — they aren't part of typing rhythm.
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      const last = lastKeystrokeRef.current;
      if (last !== null) {
        emit("keystroke", { interval_ms: Math.round(now - last) });
      }
      lastKeystrokeRef.current = now;
    };

    const onMouseActivity = () => {
      lastInputRef.current = performance.now();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseActivity);
    window.addEventListener("mousedown", onMouseActivity);
    window.addEventListener("scroll", onMouseActivity);

    const idleCheck = window.setInterval(() => {
      const idleFor = performance.now() - lastInputRef.current;
      if (idleFor >= idleThresholdMs && !isIdleRef.current) {
        isIdleRef.current = true;
        idleSinceRef.current = lastInputRef.current;
        emit("idle_start");
      } else if (idleFor < idleThresholdMs && isIdleRef.current) {
        isIdleRef.current = false;
        emit("idle_end", { idle_duration_ms: Math.round(performance.now() - idleSinceRef.current) });
      }
    }, 1000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseActivity);
      window.removeEventListener("mousedown", onMouseActivity);
      window.removeEventListener("scroll", onMouseActivity);
      window.clearInterval(idleCheck);
    };
  }, [active, idleThresholdMs]);
}

// --- Feature extraction (mirrors the desktop agent's feature_extractor.py,

// scoped down to what this in-page logger can actually measure) -----------

export type FeatureRow = {
  interval_index: number;
  interval_start_ms: number;
  tab_switches: number; // tab_hidden + window_blur events, this interval
  copy_events: number;
  paste_events: number;
  keystroke_count: number;
  avg_keystroke_interval_ms: number | "";
  typing_speed_kps: number;
  idle_percentage: number;
  /** 1 when the participant had paused, or the session went unobserved, for
   *  any part of this interval (Frontend Spec §8.1 rule 4).
   *
   *  Mirrors the desktop agent's column of the same name. Separate from
   *  `idle_percentage` because the two say different things: `idle_percentage`
   *  is what was measured — no input arrived — and `paused` is why. Without it
   *  a paused interval and a minute of hard thinking are the same row. */
  paused: number;
  // The one AI-taxonomy count the browser can produce. Accepts and AI-session
  // counts are reconstructed backend-side from OS-level capture and appear in
  // the desktop agent's feature table, not this one.
  verification_actions: number;
};

/** Spans the participant was not solving through, read off the log.
 *
 *  The browser mirror of `backend/problemproof/pause_spans.py`, and it follows
 *  the same rules for the same reasons: an unmatched `pause_start` runs to the
 *  end of the session (a pause nobody watched close is not a measured pause —
 *  `timebase.withGapResolved`), an orphan `pause_end` yields nothing (it cannot
 *  say when its pause began), and a `session_gap` counts because for the
 *  question "was this person solving" a crash and a coffee break both answer
 *  no. `PauseLedger` keeps their provenance apart upstream of here; this is a
 *  narrower question. */
function pausedSpans(events: LoggedEvent[], sessionDurationMs: number): [number, number][] {
  const ordered = [...events].sort((a, b) => a.t_ms - b.t_ms);
  const spans: [number, number][] = [];
  let openAt: number | null = null;

  for (const e of ordered) {
    if (e.type === "pause_start") {
      // Re-opening an open pause is a no-op, not an overwrite — the earlier
      // opening is when observation actually stopped.
      if (openAt === null) openAt = e.t_ms;
    } else if (e.type === "pause_end") {
      if (openAt !== null) {
        spans.push([openAt, Math.max(openAt, e.t_ms)]);
        openAt = null;
      }
    } else if (e.type === "session_gap") {
      const unknownMs = Number((e.attrs as Record<string, unknown>)?.unknown_ms ?? 0) || 0;
      spans.push([Math.max(0, e.t_ms - unknownMs), e.t_ms]);
    }
  }
  if (openAt !== null) spans.push([openAt, Math.max(openAt, sessionDurationMs)]);

  return spans;
}

export function summarizeEvents(events: LoggedEvent[], sessionDurationMs: number, intervalMs = 1000): FeatureRow[] {
  const nIntervals = Math.max(1, Math.floor(sessionDurationMs / intervalMs) + 1);
  const rows: FeatureRow[] = [];
  let idleActive = false;
  const paused = pausedSpans(events, sessionDurationMs);

  for (let idx = 0; idx < nIntervals; idx++) {
    const from = idx * intervalMs;
    const to = from + intervalMs;
    const bucket = events.filter((e) => e.t_ms >= from && e.t_ms < to);

    const tabSwitches = bucket.filter((e) => e.type === "tab_hidden" || e.type === "window_blur").length;
    const copyEvents = bucket.filter((e) => e.type === "copy").length;
    const pasteEvents = bucket.filter((e) => e.type === "paste").length;
    const keystrokes = bucket.filter((e): e is MetadataEvent => e.type === "keystroke");
    const idleStarts = bucket.filter((e) => e.type === "idle_start");
    const idleEnds = bucket.filter((e) => e.type === "idle_end");
    const verifications = bucket.filter((e) => e.type === "verification_action").length;

    const intervals = keystrokes.map((e) => e.attrs.interval_ms ?? 0);
    const avgInterval = intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : "";

    if (idleStarts.length && !idleEnds.length) idleActive = true;
    else if (idleEnds.length) idleActive = false;

    rows.push({
      interval_index: idx,
      interval_start_ms: from,
      tab_switches: tabSwitches,
      copy_events: copyEvents,
      paste_events: pasteEvents,
      keystroke_count: keystrokes.length,
      avg_keystroke_interval_ms: avgInterval,
      typing_speed_kps: Math.round((keystrokes.length / (intervalMs / 1000)) * 100) / 100,
      idle_percentage: idleActive ? 100 : 0,
      // Any overlap marks the interval, erring toward excluding: an interval
      // half-spent away is not an interval of solving.
      paused: paused.some(([s, e]) => s < to && e > from) ? 1 : 0,
      verification_actions: verifications,
    });
  }

  return rows;
}

export function featuresToCsv(rows: FeatureRow[]): string {
  const headers = Object.keys(rows[0] ?? { interval_index: 0 }) as (keyof FeatureRow)[];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => String(row[h])).join(","));
  }
  return lines.join("\n");
}
