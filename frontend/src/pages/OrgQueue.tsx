import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../components/Header";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useAuth } from "../lib/auth";
import { fetchSessions, fmtClock, fmtDate, type SessionSummary } from "../lib/sessions";
import { STATE_LABEL, type LifecycleState } from "../lib/validation";

const COLS = "1.1fr 0.9fr 0.85fr 0.7fr 0.7fr 0.9fr 0.8fr";

/** `/org` — the submission queue (Frontend Spec §7.2).
 *
 *  Everything shown here arrives already scoped by the server to this
 *  reviewer's organisation. There is no client-side filter by org, deliberately:
 *  a filter is a thing that can be wrong, and a listing that had to be filtered
 *  would already have contained another tenant's rows.
 */
export default function OrgQueue() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    setSessions(null);
    fetchSessions()
      .then(setSessions)
      .catch((e) => setError(e instanceof Error ? e.message : "unknown error"));
  }, []);

  useEffect(load, [load]);

  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "duration" | "assurance">("date");

  const totalSec = (sessions ?? []).reduce((sum, s) => sum + (s.duration_ms ?? 0) / 1000, 0);
  const l2Count = (sessions ?? []).filter((s) => (s.assurance_level ?? "").toUpperCase() === "L2").length;

  const filteredUnsorted = (sessions ?? []).filter((s) => {
    if (levelFilter !== "all" && (s.assurance_level ?? "").toLowerCase() !== levelFilter.toLowerCase()) {
      return false;
    }
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (s.problem ?? "").toLowerCase().includes(q) || (s.session_id ?? "").toLowerCase().includes(q);
  });

  const sorted = [...filteredUnsorted].sort((a, b) => {
    if (sortBy === "date") {
      return (b.submitted_at ?? 0) - (a.submitted_at ?? 0);
    }
    if (sortBy === "duration") {
      return (b.duration_ms ?? 0) - (a.duration_ms ?? 0);
    }
    return (a.assurance_level ?? "zzz").localeCompare(b.assurance_level ?? "zzz");
  });

  return (
    <div className="page">
      <Header active="org" />

      <main id="content" tabIndex={-1} className="container">
        <div style={{ marginBottom: 28 }}>
          <div className="eyebrow">{user?.org_name ?? "Organisation"}</div>
          <h1 className="page-title">Candidate Evaluation Queue</h1>
          {/* Corrected 2026-08-19. This read "every evidence packet is
              cryptographically sealed", which was not true of anything: no
              signing, hashing or encryption of an evidence packet exists.
              What IS true is tenant isolation (enforced at the data-access
              layer and tested), and content hashing of a frozen annotation
              version. Copy on a validator surface is a factual claim about
              data handling, and this one was a claim about machinery that does
              not exist. */}
          <p className="page-sub">
            Process records submitted to your organisation, isolated to your tenant at the data-access
            layer. Opening a review freezes the annotation into a content-hashed version, so your decision
            is recorded against a record that cannot change afterwards.
          </p>
        </div>

        <div className="card tint" style={{ marginBottom: 24, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
          <strong>Reviewer access is logged.</strong> Opening the evidence on a record appends an entry
          naming you, the action and the time, to an append-only log this application never deletes from.
          You can read your organisation's trail on any record you can open.
        </div>

        {error && (
          <ErrorState
            title="The queue could not be loaded."
            fix={`The server returned: ${error}. Check your connection and try again.`}
            onRetry={load}
          />
        )}

        {!error && sessions === null && <LoadingState label="Loading the queue…" />}

        {!error && sessions !== null && sessions.length === 0 && (
          <EmptyState
            title="No submissions yet"
            body="When a candidate you invited completes a session, their process record appears here for review. Invite candidates from your organisation settings."
            action={
              <Link to="/org/settings" className="btn btn-primary small">
                Invite a candidate →
              </Link>
            }
          />
        )}

        {!error && sessions !== null && sessions.length > 0 && (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-label">Submissions in Queue</div>
                <div className="metric-value">{sessions.length}</div>
                <div className="metric-sub">Tenant-isolated records</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Total Evidence Observed</div>
                <div className="metric-value">{fmtClock(totalSec)}</div>
                <div className="metric-sub">Continuous biometric & screen logs</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">High Assurance (L2)</div>
                <div className="metric-value">{l2Count} / {sessions.length}</div>
                <div className="metric-sub">{sessions.length ? Math.round((l2Count / sessions.length) * 100) : 0}% verified</div>
              </div>
            </div>

            <div className="filter-bar">
              <div className="search-input">
                <span>🔍</span>
                <input
                  type="text"
                  placeholder="Filter by session ID or problem…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)" }}>Assurance:</span>
                <button
                  type="button"
                  className={`btn small ${levelFilter === "all" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setLevelFilter("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`btn small ${levelFilter === "L2" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setLevelFilter("L2")}
                >
                  L2
                </button>
                <select
                  className="search-input"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  style={{ minWidth: 140 }}
                  aria-label="Sort sessions"
                >
                  <option value="date">Sort: Date (newest)</option>
                  <option value="duration">Sort: Duration (longest)</option>
                  <option value="assurance">Sort: Assurance level</option>
                </select>
              </div>
            </div>

            <div className="table" role="table" aria-label="Received records">
              <div className="table-head" role="row" style={{ gridTemplateColumns: COLS }}>
                <span role="columnheader">Session</span>
                <span role="columnheader">Problem</span>
                <span role="columnheader">Submitted</span>
                <span role="columnheader">Duration</span>
                <span role="columnheader">Assurance</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Action</span>
              </div>
              {sorted.map((s) => (
                <div key={s.session_id} className="table-row" role="row" style={{ gridTemplateColumns: COLS }}>
                  <span role="cell" style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600 }}>
                    {s.session_id}
                  </span>
                  <span role="cell" style={{ color: "var(--muted)" }}>{s.problem ?? "—"}</span>
                  <span role="cell" style={{ color: "var(--muted)", fontSize: 12 }}>{fmtDate(s.submitted_at)}</span>
                  <span role="cell" style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>
                    {s.duration_ms ? fmtClock(s.duration_ms / 1000) : "—"}
                  </span>
                  <span role="cell">
                    <span className={`role-badge ${s.assurance_level === "L2" ? "reviewer" : "candidate"}`}>
                      {s.assurance_level ?? "L2"}
                    </span>
                  </span>
                  <span role="cell" style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)" }}>
                    {s.validation_state
                      ? STATE_LABEL[s.validation_state as LifecycleState] ?? s.validation_state
                      : "Not submitted"}
                  </span>
                  <span role="cell">
                    <Link
                      to={`/org/review/${s.session_id}`}
                      className="nav-link"
                      style={{ color: "var(--teal)", fontWeight: 600 }}
                      aria-label={`Review session ${s.session_id}`}
                    >
                      Review evidence →
                    </Link>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
