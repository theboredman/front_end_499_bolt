import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Header from "../components/Header";
import {
  BelowGateState,
  ErrorState,
  LoadingState,
  ProcessProfileView,
} from "../components/States";
import { fetchProfile, fetchSession, fmtClock, fmtDate, type ProcessProfile, type SessionSummary } from "../lib/sessions";
import {
  decide as postDecision,
  fetchAudit,
  fetchEvidence,
  fetchValidation,
  openReview,
  refreezeAnnotation,
  releasePerformance,
  requestRevision,
  STATE_LABEL,
  STATE_NEXT,
  type AuditEntry,
  type Decision,
  type EvidenceManifest,
  type ValidationRecord,
} from "../lib/validation";

/** Dispute severity, computed and PREVIEWED before submission.
 *
 *  Frontend Spec §7.2: the reviewer sees the consequence of their action before
 *  they take it. Discovering afterwards that an adjustment invited a second
 *  reviewer, or attached a permanent note to someone's credential, is the kind
 *  of surprise that makes reviewers stop adjusting things — which costs
 *  precisely the signal the human validation layer exists to add.
 *
 *  This is a PREVIEW, not the rule. `problemproof/validation.severity_for` is
 *  the rule and the server recomputes on every decision, because a client that
 *  could name its own severity could file a full dispute as a minor note.
 *  `tests/test_validation_lifecycle_contract.py` reads this file to check the
 *  two have not drifted apart — so if you change the threshold here, change it
 *  there in the same commit or the suite will say so.
 */
export type Severity = "minor" | "moderate" | "major";

export function severityFor(delta: number, disputed: boolean): Severity {
  if (disputed) return "major";
  if (Math.abs(delta) >= 2) return "moderate";
  return "minor";
}

export const SEVERITY_CONSEQUENCE: Record<Severity, string> = {
  minor: "Your scores override and a note is attached to the credential. No one else is involved.",
  moderate: "A second independent reviewer will be invited before anything is issued.",
  major: "The session goes to full dispute resolution and issuance is held until it concludes.",
};

export default function OrgReview() {
  const { sessionId = "" } = useParams();
  const [session, setSession] = useState<SessionSummary | null | "missing">(null);
  const [profile, setProfile] = useState<ProcessProfile | null>(null);
  const [validation, setValidation] = useState<ValidationRecord | null>(null);
  const [evidence, setEvidence] = useState<EvidenceManifest | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [delta, setDelta] = useState(0);
  const [disputed, setDisputed] = useState(false);
  const [notes, setNotes] = useState("");
  const [revisionReason, setRevisionReason] = useState("");

  const load = useCallback(() => {
    setError("");
    Promise.all([fetchSession(sessionId), fetchProfile(sessionId), fetchValidation(sessionId)])
      .then(([s, p, v]) => {
        // 404 covers both "no such session" and "another tenant's" — the
        // client must not try to tell them apart either.
        setSession(s ?? "missing");
        setProfile(p);
        setValidation(v);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "unknown error"));
    fetchAudit(sessionId).then(setAudit).catch(() => setAudit([]));
  }, [sessionId]);

  useEffect(load, [load]);

  const run = async (fn: () => Promise<{ validation: ValidationRecord }>) => {
    setBusy(true);
    setActionError("");
    try {
      const { validation: next } = await fn();
      setValidation(next);
      fetchAudit(sessionId).then(setAudit).catch(() => undefined);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "that action failed");
    } finally {
      setBusy(false);
    }
  };

  /** Fetching the manifest is what writes the audit record. It is called from a
   *  click rather than on mount, so the log records a reviewer choosing to look
   *  rather than a page having rendered. */
  const openEvidence = async () => {
    setActionError("");
    try {
      setEvidence(await fetchEvidence(sessionId));
      fetchAudit(sessionId).then(setAudit).catch(() => undefined);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "evidence unavailable");
    }
  };

  const severity = severityFor(delta, disputed);
  const state = validation?.state ?? null;
  const inReview = state === "organization_review";

  return (
    <div className="page">
      <Header active="org" />

      <main id="content" tabIndex={-1} className="container">
        <Link to="/org" className="nav-link" style={{ fontSize: 12.5 }}>
          ← Back to the queue
        </Link>

        {error && (
          <ErrorState
            title="This record could not be loaded."
            fix={`The server returned: ${error}. Try again, or return to the queue.`}
            onRetry={load}
          />
        )}

        {!error && session === null && <LoadingState label="Loading the record…" />}

        {!error && session === "missing" && (
          <ErrorState
            title="Record not found"
            fix="There is nothing at this address. It may have been removed, or the link may be wrong. Return to the queue to see current submissions."
          />
        )}

        {!error && session && session !== "missing" && (
          <>
            <div style={{ margin: "18px 0 32px" }}>
              <div className="eyebrow">Validator dashboard</div>
              <h1 className="page-title">{session.problem ?? session.session_id}</h1>
              <p className="page-sub">
                Submitted {fmtDate(session.submitted_at)} ·{" "}
                <span style={{ fontFamily: "var(--mono)" }}>
                  {session.duration_ms ? fmtClock(session.duration_ms / 1000) : "—"}
                </span>
              </p>
            </div>

            <LifecycleBar record={validation} />

            {/* Below-gate first, before any scoring UI: the reviewer needs to
                know what is missing before they start forming a judgement. */}
            {profile && <BelowGateState withheld={profile.below_gate} releaseGate={profile.release_gate} />}

            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, alignItems: "start" }}>
              <section>
                <div className="eyebrow">Profile</div>
                {!profile && <LoadingState label="Loading the profile…" />}
                {profile && profile.sections.length > 0 && (
                  <ProcessProfileView sections={profile.sections} />
                )}
                {profile && profile.sections.length === 0 && (
                  <div className="card" style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                    {profile.assembled
                      ? "Every section of this profile is withheld. Each one is listed above with what it is blocked on — this is the release gate working, not a fault in the record."
                      : "No profile has been assembled: this record has not reached `validated` yet. The analyses listed above are withheld for a separate reason, and both have to clear before anything is shown."}
                  </div>
                )}
              </section>

              <aside>
                <div className="eyebrow">Evidence</div>
                <div className="card" style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
                  {evidence ? (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      <li>Screen recording: {evidence.screen_recording ? "attached" : "not captured"}</li>
                      <li>Event log: {evidence.event_log ? "attached" : "not captured"}</li>
                      <li>Webcam signals: {evidence.webcam_signals ? "extracted" : "not extracted"}</li>
                      <li>Question and rubric: {evidence.question ? "stored" : "not recorded"}</li>
                    </ul>
                  ) : (
                    <>
                      Opening the evidence records an access against your account.
                      <div style={{ marginTop: 12 }}>
                        <button className="btn btn-ghost" onClick={openEvidence}>
                          Open evidence
                        </button>
                      </div>
                    </>
                  )}
                  {/* Not a claim any more: `GET /evidence` writes the audit
                      record, and the trail below is that log. */}
                  <div style={{ marginTop: 10, fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)" }}>
                    Your access to this evidence is logged.
                  </div>
                </div>
              </aside>
            </div>

            <section style={{ marginTop: 40 }}>
              <div className="eyebrow">Your assessment</div>
              <div className="card">
                {actionError && (
                  <div
                    role="alert"
                    style={{ marginBottom: 16, fontSize: 13, color: "var(--red)", lineHeight: 1.6 }}
                  >
                    {actionError}
                  </div>
                )}

                {!validation && (
                  <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                    This session has not been submitted for validation. The participant decides whether a
                    record goes to an organisation — a captured session is not a submission.
                  </p>
                )}

                {state === "participant_submitted" && (
                  <>
                    <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                      Opening the review freezes the annotation as it stands right now. Your decision will be
                      recorded against that version, and it cannot change underneath you afterwards.
                    </p>
                    <button className="btn btn-primary" disabled={busy} onClick={() => run(() => openReview(sessionId))}>
                      Open review
                    </button>
                  </>
                )}

                {inReview && (
                  <>
                    <label style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                      <span className="mono-label">Score adjustment</span>
                      <input
                        type="range"
                        min={-4}
                        max={4}
                        step={1}
                        value={delta}
                        onChange={(e) => setDelta(Number(e.target.value))}
                        aria-label="Score adjustment, minus four to plus four"
                      />
                      <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                        {delta > 0 ? `+${delta}` : delta}
                      </span>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, fontSize: 13 }}>
                      <input type="checkbox" checked={disputed} onChange={(e) => setDisputed(e.target.checked)} />
                      I dispute this profile rather than adjusting it
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                      <span className="mono-label">Notes</span>
                      <textarea
                        className="search-input"
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="What led you to this decision?"
                      />
                    </label>

                    <div className="card tint" role="status" aria-live="polite" style={{ marginBottom: 18 }}>
                      <div className="mono-label" style={{ marginBottom: 6 }}>
                        This is a {severity} dispute
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.6 }}>
                        {SEVERITY_CONSEQUENCE[severity]}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            postDecision(sessionId, {
                              decision: pickDecision(delta, disputed),
                              score_delta: delta,
                              notes: notes.trim() || undefined,
                            })
                          )
                        }
                      >
                        Submit assessment
                      </button>
                    </div>

                    <hr style={{ border: 0, borderTop: "1px solid var(--border-soft)", margin: "22px 0 18px" }} />

                    <label style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                      <span className="mono-label">Or ask for the annotation to be revised</span>
                      <input
                        className="search-input"
                        value={revisionReason}
                        onChange={(e) => setRevisionReason(e.target.value)}
                        placeholder="What needs to change, and why?"
                      />
                    </label>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        className="btn btn-ghost"
                        disabled={busy || !revisionReason.trim()}
                        onClick={() => run(() => requestRevision(sessionId, revisionReason.trim()))}
                      >
                        Request a revision
                      </button>
                      {(validation?.revision_requests.length ?? 0) > 0 && (
                        <button
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => run(() => refreezeAnnotation(sessionId))}
                        >
                          Freeze the revised annotation
                        </button>
                      )}
                    </div>
                    <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "10px 0 0", lineHeight: 1.5 }}>
                      A revision does not send the session back. It stays with you, and freezing creates a new
                      version — the one you have already read is never rewritten.
                    </p>
                  </>
                )}

                {state === "validated" && (
                  <>
                    <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                      Recorded as <strong>{validation?.decision}</strong> ({validation?.severity}) against
                      annotation version {validation?.annotation_version}. Releasing makes the participant's
                      profile assemblable — it does not override the release gate, which still withholds every
                      analysis listed above.
                    </p>
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => run(() => releasePerformance(sessionId))}
                    >
                      Release the profile
                    </button>
                  </>
                )}

                {state === "performance_released" && (
                  <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                    Released. The participant can see whatever the release gate permits — which is currently
                    the below-gate state and nothing else.
                  </p>
                )}
              </div>
            </section>

            {audit.length > 0 && <AuditTrail entries={audit} />}
          </>
        )}
      </main>
    </div>
  );
}

/** Which decision a slider position and a checkbox amount to.
 *
 *  `confirmed` and `adjusted` are different claims — one says the record stands
 *  as it is, the other says it stands with a correction — and collapsing them
 *  would lose the difference in the audit trail and in RQ7's agreement metric.
 */
function pickDecision(delta: number, disputed: boolean): Decision {
  if (disputed) return "disputed";
  return delta === 0 ? "confirmed" : "adjusted";
}

function LifecycleBar({ record }: { record: ValidationRecord | null }) {
  const states = ["participant_submitted", "organization_review", "validated", "performance_released"] as const;
  const reached = record ? states.indexOf(record.state) : -1;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="mono-label" style={{ marginBottom: 10 }}>
        Lifecycle
      </div>
      <ol style={{ display: "flex", gap: 8, listStyle: "none", margin: 0, padding: 0, flexWrap: "wrap" }}>
        {states.map((s, i) => {
          const done = i <= reached;
          return (
            <li
              key={s}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                padding: "6px 12px",
                borderRadius: 999,
                border: `1px solid ${done ? "var(--accent-border)" : "var(--border)"}`,
                background: done ? "var(--accent-tint)" : "transparent",
                color: done ? "var(--accent)" : "var(--faint)",
              }}
              aria-current={i === reached ? "step" : undefined}
            >
              {/* Shape as well as colour — a checkmark, not just a tint.
                  Colour is never the sole carrier of meaning. */}
              {done ? "✓ " : "· "}
              {STATE_LABEL[s]}
            </li>
          );
        })}
      </ol>
      {record && (
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
          {STATE_NEXT[record.state]}
          {record.annotation_version !== null && (
            <>
              {" "}
              <span style={{ fontFamily: "var(--mono)" }}>
                annotation v{record.annotation_version}
              </span>
              {record.revision_requests.length > 0 &&
                ` · ${record.revision_requests.length} revision request${
                  record.revision_requests.length === 1 ? "" : "s"
                }`}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  return (
    <section style={{ marginTop: 40 }}>
      <div className="eyebrow">Access and decision trail</div>
      <div className="card">
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
          Every action on this record, including reads of the evidence. Your organisation's entries only.
        </p>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {entries.map((e, i) => (
            <li
              key={`${e.at}-${i}`}
              style={{ display: "flex", gap: 12, fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)" }}
            >
              <span style={{ minWidth: "16ch" }}>{new Date(e.at * 1000).toISOString().slice(0, 19)}</span>
              <span style={{ minWidth: "20ch", color: "var(--text-body)" }}>{e.action}</span>
              <span>{e.actor}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
