// Session records.
//
// Completed sessions live on the SERVER, scoped to the requesting user's
// tenancy. They used to live in this browser's localStorage, which is why the
// employer view showed whatever had been submitted in the same browser — a
// demo convenience, not a data model (Frontend Spec §6, §9).
//
// The local DRAFT stays. It is work in progress, it exists so a crash does not
// lose forty minutes of thinking, and it is never the record of truth. The
// distinction is the whole of the migration: the draft is local because losing
// it is the only harm it can do; the record is remote because it is evidence
// and it belongs to an account rather than to a machine.

import { apiFetch } from "./api";

export type SessionEvent = {
  id: number;
  at: number; // elapsed seconds when it happened
  kind: string;
  text: string;
  color: string;
};

/** A session summary as the server reports it. Metadata only — the solution
 *  artefact is fetched separately and scoped separately (Frontend Spec §6). */
export type SessionSummary = {
  session_id: string;
  submitted_at: number | null;
  duration_ms: number | null;
  paused_ms: number | null;
  unknown_ms: number | null;
  problem: string | null;
  assurance_level: string | null;
  org_id: string | null;
  has_screen: boolean;
  has_events: boolean;
  has_signals: boolean;
  /** Where this record is in the Layer 4 lifecycle, or null when the
   *  participant has never submitted it for validation.
   *
   *  Null is the normal case, not an error: capturing a session is not
   *  submitting it. Comes from the listing rather than a per-row fetch — a
   *  queue of forty rows would otherwise make forty requests to answer the one
   *  question a reviewer opens the queue to ask. */
  validation_state: string | null;
};

export const DRAFT_KEY = "pp_exam_session";

/** Sessions the signed-in user may see. Never a local read. */
export async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await apiFetch("/api/sessions");
  if (!res.ok) throw new Error(res.status === 401 ? "not signed in" : `could not load sessions (${res.status})`);
  return (await res.json()).sessions as SessionSummary[];
}

/** One session, or null when it does not exist OR is not this user's.
 *
 *  The two are indistinguishable on purpose and the server returns 404 for
 *  both — see backend/problemproof/api/sessions.py. A client that reported
 *  them differently would reintroduce the enumeration oracle the API avoids.
 */
export async function fetchSession(sessionId: string): Promise<SessionSummary | null> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`could not load session (${res.status})`);
  return (await res.json()) as SessionSummary;
}

/** Attach a freshly captured session to the signed-in user.
 *
 *  The owner is taken from the token server-side; this sends no identity of
 *  its own, because a client that could name its own owner could file a
 *  session into somebody else's tenancy. */
export type SessionTiming = {
  problem: string;
  /** Observed solving time: raw minus paused minus unobserved. */
  duration_ms: number;
  paused_ms: number;
  unknown_ms: number;
  pause_count: number;
  /** Wall clock at submit — the END of the sitting, never `t0_epoch_ms`. */
  submitted_at_epoch_ms: number;
  /** How this sitting got through the exam gate: "complete", or
   *  "bypassed_development" when a development backend minted a ticket with no
   *  calibration behind it. Omitted means "not reported", never "it was fine" —
   *  the convention the fields above already follow. The browser is the only
   *  party that still knows, because the ticket carrying the answer was
   *  consumed and deleted at entry. */
  calibration?: "complete" | "bypassed_development" | null;
};

/** Attach a freshly captured session to the signed-in user, with its timing.
 *
 *  The owner is taken from the token server-side; this sends no identity of
 *  its own, because a client that could name its own owner could file a
 *  session into somebody else's tenancy.
 *
 *  The timing goes with it because the browser is the only thing that knows
 *  it — the server sees uploads at submit and has no view of when the sitting
 *  began or how much of it was paused. */
export async function claimSession(
  sessionId: string,
  timing: SessionTiming,
  assessmentId?: string | null
): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...timing, assessment_id: assessmentId ?? null }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`could not record session ownership (${res.status})`);
}

/** Claim a session id BEFORE the sitting, so the exam spec and question have a
 *  directory to land in.
 *
 *  Deliberately separate from `claimSession` and deliberately sends no timing.
 *  None of the timing exists yet — the sitting has not happened — and the
 *  backend's rule is that an absent field means "not reported" while a zero
 *  means "measured as zero". Posting zeros here would write a manifest saying
 *  this session took no time and was never paused, which is the kind of
 *  plausible-looking wrong number `write_session_manifest` refuses to invent
 *  for `t0_epoch_ms`.
 *
 *  `claimSession` at submit then merges the real timing into the same manifest.
 *  A 409 is fine and expected there: the session already has this owner. */
export async function reserveSession(sessionId: string, assessmentId?: string | null): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assessment_id: assessmentId ?? null }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`could not reserve the session (${res.status})`);
}

export type BelowGate = {
  feature: string;
  status: string;
  blocked_on: string | null;
  /** Which part of the profile is missing, and its heading. Additive — an
   *  older response without them still renders, naming the feature only. */
  section?: string;
  title?: string;
  /** Straight from the registry. Never a string in this codebase: a hardcoded
   *  reason drifts from the actual status the first time a feature moves, and
   *  keeps reading plausibly while it does. */
  reason?: string;
};

/** One released part of the profile. `status` travels with it, always.
 *
 *  A number rendered without its registry status looks exactly as
 *  authoritative as a validated one — a phase boundary from a model trained on
 *  45 sessions renders like a keyframe count. That is the failure the registry
 *  exists to prevent, and it can only be prevented at the point of display. */
export type ProfileSection = {
  section: string;
  title: string;
  feature: string;
  status: string;
  /** The only sentence the interface may say about this feature. */
  claim: string;
  evidence: string[];
  data: Record<string, unknown>;
};

export type ProcessProfile = {
  session_id: string;
  /** False when the session has not been validated by an organisation. Not an
   *  error — most sessions are in this state — and distinct from "validated
   *  but everything is below the gate", which is what `below_gate` describes. */
  assembled: boolean;
  validation_state: string | null;
  reason: string | null;
  /** Retained empty for clients that read it before `sections` existed. */
  dimensions: unknown[];
  sections: ProfileSection[];
  below_gate: BelowGate[];
  release_gate: string;
};

export async function fetchProfile(sessionId: string): Promise<ProcessProfile | null> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/profile`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`could not load the profile (${res.status})`);
  return (await res.json()) as ProcessProfile;
}

// --- the local draft --------------------------------------------------------

export function hasDraft(): boolean {
  try {
    return localStorage.getItem(DRAFT_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

// --- formatting -------------------------------------------------------------

export function fmtClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

export function fmtDate(value: string | number | null) {
  if (value === null) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
