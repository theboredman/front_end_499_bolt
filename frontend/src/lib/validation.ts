// API client for Layer 4 — the organisational validation lifecycle.
//
// Talks to backend/problemproof/api/validation_routes.py.
//
// Two things this file deliberately does NOT do.
//
// It does not compute severity as the source of truth. `severityFor` in
// OrgReview.tsx renders a preview so the reviewer sees the consequence before
// committing (Frontend Spec §7.2), and the server recomputes from the decision
// and the adjustment. The preview is a copy of the rule; the rule lives in
// `problemproof/validation.severity_for`, and a test reads this repo's frontend
// source to check the two have not drifted apart. So nothing here sends a
// severity field — a client that could name its own would be able to file a
// full dispute as a minor note.
//
// It does not model the lifecycle as anything the client can advance directly.
// There is a function per ACTION — open, decide, request a revision, refreeze,
// release — and no `setState`. The server's `transition` is the only writer,
// and a client with a state setter would be one bug away from marking a
// disputed record validated.

import { apiFetch } from "./api";

/** The four states, in order. Mirrors `validation.LIFECYCLE`. */
export const LIFECYCLE = [
  "participant_submitted",
  "organization_review",
  "validated",
  "performance_released",
] as const;

export type LifecycleState = (typeof LIFECYCLE)[number];
export type Decision = "confirmed" | "adjusted" | "disputed";
export type Severity = "minor" | "moderate" | "major";

export type ValidationRecord = {
  schema_version: number;
  session_id: string;
  state: LifecycleState;
  organization_id: string | null;
  reviewer_id: string | null;
  /** Which frozen annotation version this review is against. A decision with
   *  no version behind it is a statement about a record that can still change,
   *  and the server refuses to record one. */
  annotation_version: number | null;
  decision: Decision | null;
  severity: Severity | null;
  score_delta: number | null;
  notes: string | null;
  evidence_references: string[];
  revision_requests: {
    at: number;
    reviewer_id: string;
    reason: string;
    against_version: number | null;
  }[];
  history: { state: LifecycleState; at: number; actor: string; note: string }[];
  updated_at: number;
};

export type EvidenceManifest = {
  session_id: string;
  screen_recording: boolean;
  event_log: boolean;
  webcam_signals: boolean;
  question: boolean;
  annotation_version: number | null;
  access_is_logged: boolean;
};

export type AuditEntry = {
  at: number;
  actor: string;
  org_id: string | null;
  action: string;
  session_id: string;
  detail: Record<string, unknown>;
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : detail;
    } catch {
      /* non-JSON body — keep the status */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch(path, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  }).then(json<T>);
}

const base = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}`;

/** The participant's own act. A captured session is not automatically
 *  submitted for anyone to validate. */
export function submitForValidation(sessionId: string) {
  return post<{ validation: ValidationRecord }>(`${base(sessionId)}/submit-for-validation`);
}

/** The record, or null when this session has never been submitted.
 *
 *  404 here is the normal starting state — most sessions in the queue have
 *  never entered the lifecycle — so it is not surfaced as an error. */
export async function fetchValidation(sessionId: string): Promise<ValidationRecord | null> {
  const res = await apiFetch(`${base(sessionId)}/validation`);
  if (res.status === 404) return null;
  return (await json<{ validation: ValidationRecord }>(res)).validation;
}

/** Take a submitted session into review. Freezes the annotation server-side.
 *
 *  The freeze happens here rather than at decision time so the reviewer forms
 *  their judgement against a record that cannot move while they read it. */
export function openReview(sessionId: string) {
  return post<{ validation: ValidationRecord }>(`${base(sessionId)}/review/open`);
}

export function decide(
  sessionId: string,
  body: { decision: Decision; score_delta: number; notes?: string; evidence_references?: string[] }
) {
  return post<{ validation: ValidationRecord }>(`${base(sessionId)}/review/decide`, body);
}

export function requestRevision(sessionId: string, reason: string) {
  return post<{ validation: ValidationRecord }>(`${base(sessionId)}/review/request-revision`, {
    reason,
  });
}

export function refreezeAnnotation(sessionId: string) {
  return post<{ validation: ValidationRecord }>(`${base(sessionId)}/review/refreeze`);
}

export function releasePerformance(sessionId: string) {
  return post<{ validation: ValidationRecord }>(`${base(sessionId)}/review/release`);
}

/** What evidence exists — and the request that makes "your access is logged"
 *  a true sentence rather than a decorative one. The audit entry is this
 *  route's side effect, and the reason to call it on opening the review. */
export function fetchEvidence(sessionId: string) {
  return apiFetch(`${base(sessionId)}/evidence`).then(json<EvidenceManifest>);
}

export async function fetchAudit(sessionId: string): Promise<AuditEntry[]> {
  const res = await apiFetch(`${base(sessionId)}/validation/audit`);
  if (res.status === 404) return [];
  return (await json<{ entries: AuditEntry[] }>(res)).entries;
}

/** Human-readable state, for a queue row or a status chip. */
export const STATE_LABEL: Record<LifecycleState, string> = {
  participant_submitted: "Awaiting review",
  organization_review: "In review",
  validated: "Validated",
  performance_released: "Released",
};

/** What a session in this state is waiting on, said plainly.
 *
 *  A queue that shows a status and not what it is waiting for makes the
 *  reviewer work out their own next action from a noun. */
export const STATE_NEXT: Record<LifecycleState, string> = {
  participant_submitted: "Nobody has opened this yet.",
  organization_review: "Open and awaiting a decision.",
  validated: "Decided. The profile has not been released to the participant yet.",
  performance_released: "The participant can see their profile.",
};
