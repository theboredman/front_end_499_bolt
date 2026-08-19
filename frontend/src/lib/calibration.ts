// Personal Baseline Calibration — API client.
// Talks to problemproof/api/calibration.py. Mirrors the localStorage-first,
// no-auth style of sessions.ts: candidates are identified by a UUID kept in
// the browser, not a real login.
//
// Calibration is per sitting. Nothing here reads a stored profile to decide
// whether calibration is needed — it always is. The only thing that unlocks
// /exam is a fresh, single-use exam ticket, and it is kept in sessionStorage
// precisely so that closing the tab throws it away.

import { apiFetch } from "./api";

const CANDIDATE_ID_KEY = "pp_candidate_id";
const EXAM_TICKET_KEY = "pp_exam_ticket";
const CALIBRATION_PROVENANCE_KEY = "pp_calibration_provenance";

/** A stable per-browser candidate id, generated once and reused.
 *
 * This identifies *who* across sittings — it is the key the backend files
 * baseline profiles and their archive under. It grants nothing on its own:
 * possessing a candidate id that has calibrated before does not open an exam,
 * because entry is gated on a fresh ticket rather than on stored state.
 *
 * The backend only accepts [A-Za-z0-9_-], which crypto.randomUUID() satisfies. */
export function getCandidateId(): string {
  try {
    let id = localStorage.getItem(CANDIDATE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CANDIDATE_ID_KEY, id);
    }
    return id;
  } catch {
    // storage unavailable (private browsing, etc.) -- fall back to a
    // session-only id so calibration can still run once.
    return "anon-" + Math.random().toString(36).slice(2);
  }
}

// --- the exam ticket ------------------------------------------------------
//
// sessionStorage, never localStorage. The distinction is the feature: a
// localStorage ticket would survive closing the tab, reopening it tomorrow,
// and walking into a different room — which is exactly the staleness the
// per-sitting rule exists to prevent. sessionStorage is scoped to the tab, so
// the ticket dies with the sitting it was issued for.

export function storeExamTicket(ticket: string) {
  try {
    sessionStorage.setItem(EXAM_TICKET_KEY, ticket);
  } catch {
    /* storage unavailable — the guard will simply refuse entry, which is the
       correct failure direction for a gate. */
  }
}

export function readExamTicket(): string | null {
  try {
    return sessionStorage.getItem(EXAM_TICKET_KEY);
  } catch {
    return null;
  }
}

export function clearExamTicket() {
  try {
    sessionStorage.removeItem(EXAM_TICKET_KEY);
  } catch {
    /* nothing to do */
  }
}

// --- development mode -----------------------------------------------------
//
// `PP_MODE=development` on the backend mounts `/api/dev/exam-ticket`, which
// mints an exam ticket with no calibration run behind it, so the exam flow can
// be worked on from a machine where calibration cannot pass. See
// backend/problemproof/api/dev.py.
//
// The mode is read from the SERVER rather than from a `VITE_` variable of this
// bundle's own. Two variables can disagree, and the disagreement that matters
// is a "strict" badge sitting over a session that skipped calibration — the
// exact thing the badge exists to rule out.

export type ServerMode = "development" | "deployment";

/** Which mode the backend is running in. `deployment` unless it clearly says
 *  otherwise.
 *
 *  Every unclear answer — unreachable, malformed, field absent, spelled
 *  differently — resolves to `deployment`, which hides the bypass. A UI that
 *  cannot ask what mode it is in must not offer a bypass on the guess that it
 *  might be allowed to. */
export async function getServerMode(): Promise<ServerMode> {
  try {
    const res = await apiFetch("/api/health");
    if (!res.ok) return "deployment";
    const body = await res.json();
    return body?.mode === "development" ? "development" : "deployment";
  } catch {
    return "deployment";
  }
}

/** Ask a development backend for an exam ticket with no calibration behind it.
 *
 *  Returns whether one was banked. False covers the deployment case without
 *  needing a separate check: the route is not mounted there, so the request
 *  404s because there is nothing to call, and nothing is stored. */
export async function mintDevelopmentTicket(candidateId: string): Promise<boolean> {
  try {
    const res = await apiFetch("/api/dev/exam-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_id: candidateId }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    if (!body?.exam_ticket) return false;
    storeExamTicket(body.exam_ticket);
    return true;
  } catch {
    return false;
  }
}

/** How this sitting got through the gate, in the vocabulary the session
 *  manifest uses.
 *
 *  Recorded at entry and read at submit, because those are different screens
 *  an hour apart and the ticket that carried the answer was consumed and
 *  deleted at the first of them. sessionStorage rather than a module variable
 *  for the same reason the ticket lives there: it has to survive a navigation
 *  within the sitting, and must not survive the sitting.
 *
 *  Null means no session has been entered in this tab — not "calibration was
 *  fine". The backend applies the same distinction. */
export type CalibrationProvenance = "complete" | "bypassed_development";

export function readCalibrationProvenance(): CalibrationProvenance | null {
  try {
    const value = sessionStorage.getItem(CALIBRATION_PROVENANCE_KEY);
    return value === "complete" || value === "bypassed_development" ? value : null;
  } catch {
    return null;
  }
}

function storeCalibrationProvenance(mintedBy: string | undefined) {
  try {
    sessionStorage.setItem(
      CALIBRATION_PROVENANCE_KEY,
      mintedBy === "development_bypass" ? "bypassed_development" : "complete"
    );
  } catch {
    /* storage unavailable — the claim simply omits the field, which the
       backend reads as "not reported" rather than as a clean run. */
  }
}

export type CalibrationTask = {
  id: string;
  label: string;
  duration_sec: number;
  /** Short clarifying line under the instruction. */
  hint?: string | null;
  /** Material the participant must actually look at — the reading passage, the
   *  question to think about. Supplied by the backend so it is identical for
   *  every participant and cannot drift from a second copy here. Null for tasks
   *  that need none (rest). */
  content?: string | null;
  /** "voice" tasks are read aloud and additionally measure the microphone. */
  modality?: "video" | "voice";
  /** Whether this task's windows feed the alignment fit. The voice check does
   *  not — it is an environment test. */
  contributes_baseline?: boolean;
};

/** One blocking problem with the capture, raised by the backend gate.
 *  Every flag blocks: there is no advisory tier in calibration. */
export type QualityFlag = {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
};

/** The backend's verdict on one finished task. `must_retry` means the task is
 *  sat again — its data has already been discarded server-side. */
export type TaskVerdict = {
  passed: boolean;
  must_retry: boolean;
  task: string;
  attempt: number;
  next_attempt: number;
  flags: QualityFlag[];
  clean_windows: number;
  frames: number;
  clean_frames: number;
  clean_frame_ratio: number;
  reason: string;
};

/** Microphone level statistics measured in the browser (see lib/voiceCheck.ts).
 *  Only these numbers are posted — no audio leaves the machine — and the
 *  pass/fail thresholds are applied server-side. */
export type VoiceMetrics = {
  duration_sec: number;
  speech_rms: number;
  noise_rms: number;
  peak: number;
  clipped_ratio: number;
  voiced_ratio: number;
  sample_count: number;
};

export type BaselineProfile = {
  candidate_id: string;
  feature_names: string[];
  feature_means: number[];
  n_calibration_windows: number;
  calibrated_at: number;
};

export type FrameResult = {
  face_detected: boolean;
  window_closed: boolean;
  /** False when the quality gate rejected the frame — it was not measured and
   *  contributes nothing to the baseline. */
  accepted?: boolean;
  /** Why it was rejected, live, so the candidate can fix it mid-task rather
   *  than being told at the end. */
  flags?: QualityFlag[];
  clean_windows?: number;
  row_count?: number;
  features?: Record<string, number>;
  error?: string;
};

export type CompleteResult = {
  status: string;
  candidate_id: string;
  feature_means: Record<string, number>;
  n_calibration_windows: number;
  /** Single-use, short-lived. The only thing that opens /exam. */
  exam_ticket: string;
  /** Unix seconds. */
  expires_at: number;
};

/** Why an exam ticket was refused. Distinct reasons because each needs a
 *  different action: recalibrate, or "a session already started". */
export type AuthorizeFailure = {
  reason: "unknown_or_expired" | "expired" | "already_consumed" | "no_ticket" | "unreachable";
  message: string;
};

/** Quick reachability check -- used to decide whether to offer calibration
 * at all, so a candidate without the backend running isn't blocked. */
export async function pingCalibrationApi(): Promise<boolean> {
  try {
    const res = await apiFetch("/api/health");
    return res.ok;
  } catch {
    return false;
  }
}

/** Consume the exam ticket held in sessionStorage.
 *
 * Returns null on success; an `AuthorizeFailure` otherwise. This replaced a
 * `getExistingBaseline` check, and the difference is the point of the whole
 * per-sitting rule: a stored profile says a candidate calibrated *at some
 * point*, which is not a claim about the person now sitting in front of this
 * camera. Only a ticket minted minutes ago by a run that passed every check is.
 *
 * Succeeds at most once per ticket — the server marks it consumed — so this
 * must be called when entry is actually being granted, not speculatively. */
export async function authorizeExam(): Promise<AuthorizeFailure | null> {
  const ticket = readExamTicket();
  if (!ticket) {
    return {
      reason: "no_ticket",
      message: "No calibration has been completed for this sitting.",
    };
  }

  let res: Response;
  try {
    res = await apiFetch("/api/exam/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exam_ticket: ticket }),
    });
  } catch {
    return {
      reason: "unreachable",
      message: "The calibration service is not reachable, so this session cannot be verified.",
    };
  }

  if (res.ok) {
    // Whether calibration actually ran is a property of the SESSION, and this
    // is the last moment anyone knows it — the ticket is about to be spent and
    // the server deletes it. Kept for the claim at submit.
    const body = await res.json().catch(() => null);
    storeCalibrationProvenance(body?.minted_by);
    // Spent. Holding on to it would only invite a second attempt that is
    // guaranteed to fail with a more confusing message than "not calibrated".
    clearExamTicket();
    return null;
  }

  const body = await res.json().catch(() => null);
  const detail = body?.detail;
  clearExamTicket();
  return {
    reason: detail?.reason ?? "unknown_or_expired",
    message: detail?.message ?? "Calibration is required before the session.",
  };
}

/** Read a stored alignment transform.
 *
 * **Not an entry check.** Nothing in the calibration or exam flow may branch on
 * this — see `authorizeExam`. Kept for inspecting a profile directly. */
export async function getExistingBaseline(candidateId: string): Promise<BaselineProfile | null> {
  try {
    const res = await apiFetch(`/api/baseline/${encodeURIComponent(candidateId)}`);
    if (!res.ok) return null;
    return (await res.json()) as BaselineProfile;
  } catch {
    return null;
  }
}

/** Begin a sitting.
 *
 * Server-side this retires any previous baseline into the archive before the
 * run starts, so an abandoned attempt cannot leave last month's profile in
 * place to be mistaken for this one. */
export async function startCalibration(
  candidateId: string
): Promise<{
  session_id: string;
  tasks: CalibrationTask[];
  required_task_ids: string[];
  archived_previous_baseline: string | null;
}> {
  const res = await apiFetch("/api/calibration/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate_id: candidateId }),
  });
  if (!res.ok) throw new Error(`start_calibration failed (${res.status})`);
  return res.json();
}

/** Close one task and ask the backend whether it counted.
 *
 * The verdict is the backend's alone. A failed task's frames have already been
 * discarded server-side by the time this resolves, so the only way forward is
 * to run the same task again — there is no client-side override. */
export async function completeCalibrationTask(
  sessionId: string,
  task: string,
  voiceMetrics?: VoiceMetrics | null
): Promise<TaskVerdict> {
  const res = await apiFetch("/api/calibration/task/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, task, voice_metrics: voiceMetrics ?? null }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || `complete_task failed (${res.status})`);
  return data as TaskVerdict;
}

export async function submitCalibrationFrame(
  sessionId: string,
  task: string,
  imageBase64: string
): Promise<FrameResult> {
  const res = await apiFetch("/api/calibration/frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, task, image_base64: imageBase64 }),
  });
  if (!res.ok) throw new Error(`submit_frame failed (${res.status})`);
  return res.json();
}

/** The client's face-match verdict for this sitting.
 *
 *  A score and the threshold it was judged against — never an embedding, never
 *  a frame. `observed` is shadow mode: the check ran and is reporting what it
 *  saw, having been given no authority to act on it. */
export type IdentityMatchVerdict = {
  outcome: "pass" | "refuse" | "observed";
  reason?: string | null;
  score?: number | null;
  threshold?: number | null;
  threshold_version?: string | null;
};

/** Fit and store the baseline, and bank the exam ticket it returns.
 *
 * Storing the ticket here rather than at the call site keeps the invariant in
 * one place: a ticket exists in sessionStorage if and only if a calibration run
 * completed in this tab. */
export async function completeCalibration(
  sessionId: string,
  identityMatch?: IdentityMatchVerdict | null
): Promise<CompleteResult> {
  const res = await apiFetch("/api/calibration/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Omitted entirely when there is no verdict, rather than sent as a null
    // outcome — "we did not measure" and "we measured nothing good" are
    // different, and only the first should leave the gate untouched.
    body: JSON.stringify({
      session_id: sessionId,
      ...(identityMatch ? { identity_match: identityMatch } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || `complete_calibration failed (${res.status})`);
  if (data?.exam_ticket) storeExamTicket(data.exam_ticket);
  return data;
}

/** Apply the candidate's stored baseline to a raw feature vector captured
 * during the real exam (Phase 8 -- feeds the phase-detection module). */
export async function alignSessionFeatures(
  candidateId: string,
  features: number[]
): Promise<{ raw_features: Record<string, number>; aligned_features: Record<string, number> }> {
  const res = await apiFetch("/api/session/align", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate_id: candidateId, features }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || `align failed (${res.status})`);
  return data;
}
