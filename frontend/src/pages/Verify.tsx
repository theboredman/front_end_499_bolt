import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import CognitiveSignalPanel from "../components/CognitiveSignalPanel";
import ProcessRecord from "../components/ProcessRecord";
import ProcessGraphPanel from "../components/ProcessGraphPanel";
import {
  AwaitingValidationState,
  BelowGateState,
  EmptyState,
  ErrorState,
  LoadingState,
  ProcessProfileView,
} from "../components/States";
import { fetchProfile, fetchSession, fmtClock, fmtDate, type ProcessProfile, type SessionSummary } from "../lib/sessions";

export default function Verify() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const [session, setSession] = useState<SessionSummary | null | "missing">(null);
  const [profile, setProfile] = useState<ProcessProfile | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!id) {
      setSession("missing");
      return;
    }
    setError("");
    Promise.all([fetchSession(id), fetchProfile(id)])
      .then(([s, p]) => {
        setSession(s ?? "missing");
        setProfile(p);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "unknown error"));
  }, [id]);

  useEffect(load, [load]);

  return (
    <div className="page">
      <Header />

      <main id="content" tabIndex={-1} className="container" style={{ maxWidth: 720 }}>
        {error && (
          <ErrorState
            title="This process record could not be loaded."
            fix={`The server returned: ${error}. Your session data is safe — try again, or open it from My sessions.`}
            onRetry={load}
          />
        )}

        {!error && session === null && <LoadingState label="Loading your process record…" />}

        {!error && session === "missing" && (
          <EmptyState
            title="No session record found"
            body="There is nothing at this address. Complete a problem-solving session and its full process record will appear here."
            action={
              <Link to="/onboarding" className="btn btn-primary small">
                Start a session
              </Link>
            }
          />
        )}

        {!error && session && session !== "missing" && (
          <>
            <div style={{ textAlign: "center", marginBottom: 36 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 14px",
                  border: "1px solid var(--teal-border)",
                  background: "var(--teal-tint)",
                  marginBottom: 20,
                }}
              >
                <span className="dot" style={{ background: "var(--green)" }} />
                <span className="mono-label" style={{ color: "var(--teal)", fontWeight: 600, fontSize: 10 }}>
                  Session recorded
                </span>
              </div>
              <h1 style={{ fontSize: 26, fontWeight: 600, margin: "0 0 8px", letterSpacing: "-.01em" }}>Process record</h1>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--faint)" }}>
                {session.problem ?? session.session_id} · submitted {fmtDate(session.submitted_at)}
              </div>
            </div>

            <div className="cell-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 24, textAlign: "center" }}>
              {[
                ["Duration", session.duration_ms ? fmtClock(session.duration_ms / 1000) : "—"],
                ["Assurance", session.assurance_level ?? "—"],
                ["Evidence", [session.has_screen && "screen", session.has_events && "events", session.has_signals && "signals"].filter(Boolean).join(" · ") || "none"],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: "18px 12px" }}>
                  <div className="mono-label" style={{ fontSize: 8.5, marginBottom: 8 }}>{k}</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Three distinct states, never one blank area.
                  not assembled   the record has not been validated — a person
                                  is the blocker, not a measurement
                  withheld        validated, and the analyses behind the
                                  sections have not met their evidence standard
                  released        the sections themselves, each carrying its
                                  registry status
                Today every session lands in one of the first two. */}
            {profile && !profile.assembled && (
              <AwaitingValidationState state={profile.validation_state} reason={profile.reason} />
            )}
            {profile && profile.assembled && <ProcessProfileView sections={profile.sections} />}
            {profile && <BelowGateState withheld={profile.below_gate} releaseGate={profile.release_gate} />}

            <ProcessGraphPanel sessionId={session.session_id} />
            <ProcessRecord sessionId={session.session_id} />
            <CognitiveSignalPanel sessionId={session.session_id} />

            <div style={{ textAlign: "center", marginTop: 32 }}>
              <Link to="/candidate" className="btn btn-dark">
                Back to my sessions
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
