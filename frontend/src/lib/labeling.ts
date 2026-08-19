// Client for the cued-recall labelling tool (research plan §4).
//
// The tiling rule lives here as well as on the server, because the annotator
// needs to see a gap the moment they create one — a validation error 30
// minutes later is not usable feedback. The server check is the one that
// protects the data; this one protects the annotator's time.

import { apiFetch, getApiBase } from "./api";

/** §2.4 / §4's six phases, in order. */
export const PHASES = [
  "Understanding",
  "Decomposition",
  "Exploration",
  "Execution",
  "Verification",
  "Recovery",
] as const;

export type Phase = (typeof PHASES)[number];

/** §3's `source` vocabulary. `cued_recall` is the participant's own pass. */
export const LABEL_SOURCES = ["cued_recall", "expert_a", "expert_b"] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

// Categorical palette — identity, so hues are assigned in a FIXED order and
// never cycled. Colour follows the phase, never its rank or its frequency.
//
// The previous palette failed validation on two counts: Recovery↔Verification
// were ΔE 5.5 under deuteranopia, and Understanding↔Decomposition were ΔE 9.5
// even with normal colour vision — below the 15 floor, i.e. hard to tell apart
// for everyone, not just colourblind readers. Those two sit adjacent on the
// labelling timeline, which is exactly where it mattered.
//
// These are the first six slots of a validated categorical theme, in slot
// order. Both modes pass the lightness band, chroma floor, CVD separation and
// normal-vision floor on the adjacent pairlist.
//
// NOTE for the process graph: in a node-link diagram any two nodes can sit
// beside each other, and no six-hue palette clears the all-pairs floors. So
// colour there is reinforcement only — every node is directly labelled with
// its phase name, and identity never rests on colour alone.
export const PHASE_COLORS: Record<Phase, string> = {
  Understanding: "#2a78d6", // blue
  Decomposition: "#eb6834", // orange
  Exploration: "#1baf7a",   // aqua
  Execution: "#eda100",     // yellow
  Verification: "#e87ba4",  // magenta
  Recovery: "#008300",      // green
};

/** Same six hues re-stepped for a dark surface — the same palette, not a
 *  separate one. Dark mode is selected, never an automatic flip. */
export const PHASE_COLORS_DARK: Record<Phase, string> = {
  Understanding: "#3987e5",
  Decomposition: "#d95926",
  Exploration: "#199e70",
  Execution: "#c98500",
  Verification: "#d55181",
  Recovery: "#008300",
};

/** One segment, in the §3 labels.json shape. */
export type LabelSegment = {
  start_ms: number;
  end_ms: number;
  phase: Phase;
  source: LabelSource;
};

export function screenRecordingUrl(sessionId: string): string {
  return `${getApiBase()}/sessions/${encodeURIComponent(sessionId)}/screen`;
}

/** Load this annotator's own pass so a half-finished session can be resumed.
 *
 *  Takes a single source and the server returns only that file — an annotator
 *  is never shown another's boundaries, because two passes that influenced
 *  each other are not independent and κ over them measures nothing. */
export async function loadOwnLabels(
  sessionId: string,
  source: LabelSource
): Promise<LabelSegment[] | null> {
  const res = await apiFetch(
    `/sessions/${encodeURIComponent(sessionId)}/labels?source=${encodeURIComponent(source)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`loading labels failed (${res.status})`);
  return res.json();
}

export async function saveLabels(
  sessionId: string,
  source: LabelSource,
  labels: LabelSegment[],
  sessionDurationMs: number
): Promise<void> {
  const res = await apiFetch(
    `/sessions/${encodeURIComponent(sessionId)}/labels?source=${encodeURIComponent(source)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels, session_duration_ms: sessionDurationMs }),
    }
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `saving labels failed (${res.status})`);
  }
}

// --- the cued-recall narration protocol -------------------------------------
//
// Distinct from saveLabels above, and deliberately not a labels writer at all.
// The participant watches their own recording and *says* what they were doing
// and why; that recording is the data. There is no phase in anything below.
//
// The reason is the one validation.cued_recall states: the phase taxonomy is
// the thing under test. A participant shown the six categories picks one of
// the six, so the resulting "agreement" measures the interface rather than the
// participant, and the taxonomy can never be found wrong. Mapping narration
// onto phases is a later researcher step whose output goes through saveLabels
// like any other pass.
//
// PHASES and PHASE_COLORS above are for the boundary editor at /label. They
// must not be imported into the cued-recall flow.

/** One moment the participant will be asked about, derived server-side from
 *  their own event log (long pauses, window excursions, verification actions,
 *  large pastes) with a fixed interval underneath as a floor. */
export type CuePoint = {
  video_ms: number;
  reason: string;
  detail: string;
};

export type CueSchedule = {
  cue_points: CuePoint[];
  /** The exact wording asked at each cue, from the server so the questions
   *  cannot drift between what was asked and what was recorded. */
  questions: string[];
};

export async function loadCuePoints(
  sessionId: string,
  durationMs: number
): Promise<CueSchedule> {
  const res = await apiFetch(
    `/sessions/${encodeURIComponent(sessionId)}/cue-points?duration_ms=${Math.round(durationMs)}`
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `loading cue points failed (${res.status})`);
  }
  return res.json();
}

/** One answered cue: where in the session, where in the narration audio, and
 *  any typed supplement. No phase — see the note above. */
export type NarrationEntry = {
  video_ms: number;
  audio_start_ms: number;
  audio_end_ms: number;
  cue_reason: string;
  cue_detail: string;
  typed_note?: string;
};

/** Upload the recorded narration. Must succeed before the pass is saved — the
 *  server rejects a pass whose audio never arrived, because timings without
 *  narration are the click-only artifact this flow exists to stop producing. */
export async function uploadNarrationAudio(sessionId: string, audio: Blob): Promise<void> {
  const body = new FormData();
  body.append("audio", audio, "cued_recall.narration.webm");
  const res = await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/narration-audio`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `uploading narration audio failed (${res.status})`);
  }
}

export async function saveNarrationPass(
  sessionId: string,
  entries: NarrationEntry[],
  audioDurationMs: number,
  sessionDurationMs: number
): Promise<void> {
  const res = await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/narration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entries,
      audio_duration_ms: Math.round(audioDurationMs),
      session_duration_ms: Math.round(sessionDurationMs),
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `saving narration pass failed (${res.status})`);
  }
}

// --- boundaries <-> segments -----------------------------------------------
//
// The editor's state is a list of boundary times plus a phase per resulting
// slot. Segments are derived, never edited directly, which is what makes gaps
// and overlaps unrepresentable rather than merely validated-against: n
// boundaries always produce exactly n+1 abutting segments covering [0, end].

export type Boundaries = {
  /** Interior cut points in ms, sorted, exclusive of 0 and durationMs. */
  cuts: number[];
  /** Phase per slot; always `cuts.length + 1` long. */
  phases: Phase[];
};

export function emptyBoundaries(defaultPhase: Phase = "Understanding"): Boundaries {
  return { cuts: [], phases: [defaultPhase] };
}

export function addCut(b: Boundaries, atMs: number, durationMs: number): Boundaries {
  const t = Math.round(atMs);
  if (t <= 0 || t >= durationMs) return b;
  if (b.cuts.some((c) => Math.abs(c - t) < 1000)) return b; // already a boundary within 1s

  const cuts = [...b.cuts, t].sort((x, y) => x - y);
  const index = cuts.indexOf(t);
  // The new slot inherits the phase of the slot it was split out of, so a cut
  // is purely a subdivision until the annotator says otherwise.
  const phases = [...b.phases];
  phases.splice(index, 0, phases[index]);
  return { cuts, phases };
}

export function removeCut(b: Boundaries, index: number): Boundaries {
  if (index < 0 || index >= b.cuts.length) return b;
  const cuts = b.cuts.filter((_, i) => i !== index);
  // Removing a boundary merges two slots; the earlier phase survives.
  const phases = b.phases.filter((_, i) => i !== index + 1);
  return { cuts, phases };
}

export function setPhase(b: Boundaries, slot: number, phase: Phase): Boundaries {
  if (slot < 0 || slot >= b.phases.length) return b;
  const phases = [...b.phases];
  phases[slot] = phase;
  return { ...b, phases };
}

/** Derive §3 segments. Tiling is structural: slot i runs from boundary i-1 to
 *  boundary i, so the result always covers [0, durationMs] exactly once. */
export function toSegments(
  b: Boundaries,
  durationMs: number,
  source: LabelSource
): LabelSegment[] {
  const edges = [0, ...b.cuts, Math.round(durationMs)];
  const segments: LabelSegment[] = [];
  for (let i = 0; i < b.phases.length; i++) {
    const start = edges[i];
    const end = edges[i + 1];
    if (end > start) {
      segments.push({ start_ms: start, end_ms: end, phase: b.phases[i], source });
    }
  }
  return segments;
}

/** Rebuild editor state from a stored pass, for resuming. */
export function fromSegments(segments: LabelSegment[]): Boundaries {
  const sorted = [...segments].sort((a, b) => a.start_ms - b.start_ms);
  return {
    cuts: sorted.slice(1).map((s) => s.start_ms),
    phases: sorted.map((s) => s.phase),
  };
}

/** The same tiling rule the server enforces, for immediate feedback. */
export function validateTiling(segments: LabelSegment[], durationMs: number): string | null {
  if (segments.length === 0) return "No segments yet.";
  if (segments[0].start_ms !== 0) return "The first segment must start at 0.";
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start_ms !== segments[i - 1].end_ms) {
      return `Gap or overlap at ${fmtTime(segments[i - 1].end_ms)}.`;
    }
  }
  const end = segments[segments.length - 1].end_ms;
  if (Math.abs(end - durationMs) > 1000) {
    return `Labels end at ${fmtTime(end)} but the recording runs to ${fmtTime(durationMs)}.`;
  }
  return null;
}

export function fmtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
