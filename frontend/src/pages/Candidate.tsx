import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../components/Header";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { fetchSessions, fmtClock, fmtDate, hasDraft, type SessionSummary } from "../lib/sessions";
import { useAuth } from "../lib/auth";
import StatCard from "../components/StatCard";
import MiniTrendChart from "../components/MiniTrendChart";

const COLS = "1.4fr 1fr 0.8fr 0.9fr 0.9fr";

export default function Candidate() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState("");
  const draft = hasDraft();

  const load = useCallback(() => {
    setError("");
    setSessions(null);
    fetchSessions()
      .then(setSessions)
      .catch((e) => setError(e instanceof Error ? e.message : "unknown error"));
  }, []);

  useEffect(load, [load]);

  const [query, setQuery] = useState("");
  const totalSec = (sessions ?? []).reduce((sum, s) => sum + (s.duration_ms ?? 0) / 1000, 0);
  const avgSec = sessions && sessions.length > 0 ? totalSec / sessions.length : 0;

  const filteredSessions = (sessions ?? []).filter((s) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (s.problem ?? "").toLowerCase().includes(q) || (s.session_id ?? "").toLowerCase().includes(q);
  });

  // Real per-session durations in seconds, oldest first, for the sparkline.
  // Only sessions with a real duration_ms contribute; nulls are omitted
  // rather than treated as zero (a zero would flatten the trend falsely).
  const durationTrend = (sessions ?? [])
    .filter((s) => s.duration_ms != null && s.duration_ms > 0)
    .map((s) => s.duration_ms! / 1000)
    .reverse();

  return (
    <div className="page">
      <Header active="candidate" />

      <main id="content" tabIndex={-1} className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 24, marginBottom: 28 }}>
          <div>
            <div className="eyebrow">Candidate Portal</div>
            <h1 className="page-title">{user ? `Welcome back, ${user.shown_name}` : "My sessions"}</h1>
            <p className="page-sub">Every session you complete is verified and recorded on your immutable ledger.</p>
          </div>
          <Link to="/onboarding" className="btn btn-primary">
            Start a new session →
          </Link>
        </div>

        {/* The draft is still local, and still says so — it is the one thing
            here that a cleared browser would lose. */}
        {draft && (
          <div className="card tint" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>You have a session in progress.</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                Saved in this browser so a crash can't lose it — pick up where you left off.
              </div>
            </div>
            <Link to="/exam" className="btn btn-dark small">
              Resume session →
            </Link>
          </div>
        )}

        {error && (
          <ErrorState
            title="Your sessions could not be loaded."
            fix={`The server returned: ${error}. Check your connection and try again — nothing has been lost.`}
            onRetry={load}
          />
        )}

        {!error && sessions === null && <LoadingState label="Loading your sessions…" />}

        {!error && sessions !== null && sessions.length === 0 && (
          <EmptyState
            title="No completed sessions yet"
            body="Take a monitored problem-solving session and your process record — phases, timing and activity — will show up here."
            action={
              <Link to="/onboarding" className="btn btn-primary small">
                Start your first session
              </Link>
            }
          />
        )}

        {!error && sessions !== null && sessions.length > 0 && (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-label">Sessions Completed</div>
                <div className="metric-value">{sessions.length}</div>
                <div className="metric-sub">100% Process Verified</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Total Time Solving</div>
                <div className="metric-value">{fmtClock(totalSec)}</div>
                <div className="metric-sub">Active solving timebase</div>
              </div>
              <StatCard
                label="Avg Duration"
                value={avgSec > 0 ? fmtClock(avgSec) : "—"}
                note="Across all problems"
              />
              <div className="metric-card">
                <div className="metric-label">Duration Trend</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 32 }}>
                  <MiniTrendChart data={durationTrend} />
                  {durationTrend.length < 2 && (
                    <span style={{ fontSize: 12, color: "var(--faint)" }}>
                      {durationTrend.length === 1 ? "Need 2+ sessions for a trend" : "No sessions yet"}
                    </span>
                  )}
                </div>
                {durationTrend.length >= 2 && (
                  <div className="metric-sub">Last {durationTrend.length} sessions</div>
                )}
              </div>
              <div className="metric-card">
                <div className="metric-label">Last Session Date</div>
                <div className="metric-value" style={{ fontSize: 18, marginTop: 4 }}>{fmtDate(sessions[0].submitted_at)}</div>
                <div className="metric-sub">{sessions[0].problem ?? "Problem"}</div>
              </div>
            </div>

            <div className="filter-bar">
              <div className="search-input">
                <span>🔍</span>
                <input
                  type="text"
                  placeholder="Search problem or session ID…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)" }}>
                Showing {filteredSessions.length} of {sessions.length} sessions
              </div>
            </div>

            <div className="table" role="table" aria-label="Session history">
              <div className="table-head" role="row" style={{ gridTemplateColumns: COLS }}>
                <span role="columnheader">Problem</span>
                <span role="columnheader">Date</span>
                <span role="columnheader">Duration</span>
                <span role="columnheader">Assurance</span>
                <span role="columnheader">Report</span>
              </div>
              {filteredSessions.map((s) => (
                <div key={s.session_id} className="table-row" role="row" style={{ gridTemplateColumns: COLS }}>
                  <span role="cell" style={{ fontWeight: 500 }}>{s.problem ?? "—"}</span>
                  <span role="cell" style={{ color: "var(--muted)" }}>{fmtDate(s.submitted_at)}</span>
                  <span role="cell" style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>
                    {s.duration_ms ? fmtClock(s.duration_ms / 1000) : "—"}
                  </span>
                  <span role="cell" style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>
                    <span className="role-badge reviewer">{s.assurance_level ?? "L2"}</span>
                  </span>
                  <span role="cell">
                    <Link
                      to={`/verify?id=${s.session_id}`}
                      className="nav-link"
                      style={{ color: "var(--teal)", fontWeight: 600 }}
                      aria-label={`View report for ${s.problem ?? s.session_id}`}
                    >
                      View report →
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
