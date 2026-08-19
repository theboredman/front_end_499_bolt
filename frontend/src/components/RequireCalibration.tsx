import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Logo from "./Logo";
import {
  authorizeExam,
  getCandidateId,
  getServerMode,
  mintDevelopmentTicket,
  type AuthorizeFailure,
} from "../lib/calibration";

type Gate = "checking" | "allowed" | "refused";

/** Blocks the exam route until this sitting's calibration has been verified.
 *
 * The gate is a single-use exam ticket, consumed here. It is deliberately NOT
 * the presence of a stored baseline profile, which is what this component used
 * to check: a profile says the candidate calibrated at some point, in some
 * room, and that is not a claim about the person now in front of this camera.
 * Only a ticket minted minutes ago, by a run that passed every quality check,
 * is.
 *
 * The check consumes the ticket, so it must run once per entry. React 18
 * StrictMode double-invokes effects in development, which would otherwise burn
 * the ticket on mount and refuse the very session that just calibrated — hence
 * the module-level in-flight guard below.
 *
 * There is no "continue anyway" affordance in any state, including when the
 * backend is unreachable. A gate that opens when its check cannot run is not a
 * gate.
 *
 * The one exception is a backend running `PP_MODE=development`, which offers a
 * button to mint a ticket with no calibration behind it — and even that is not
 * a "continue anyway": it goes through this same gate, with a real single-use
 * ticket, and the session is permanently stamped as bypassed and excluded from
 * the analysis corpus. The mode comes from the server, never from this bundle,
 * and every unclear answer resolves to `deployment`. See
 * backend/problemproof/api/dev.py. */
export default function RequireCalibration({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate>("checking");
  const [failure, setFailure] = useState<AuthorizeFailure | null>(null);
  // Asked of the SERVER, and only once entry has actually been refused —
  // there is nothing to offer on the happy path. Defaults to "deployment", so
  // a backend that never answers hides the button rather than offering one
  // that could not work anyway. See `getServerMode`.
  const [devMode, setDevMode] = useState(false);
  const [minting, setMinting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Already through the gate in this tab's lifetime — navigating away to
    // /candidate and back mid-sitting must not need a second ticket, and could
    // not get one, because the first entry consumed it.
    if (entry.granted) {
      setGate("allowed");
      return;
    }

    // One authorize per tab, shared across StrictMode's double invocation. A
    // second call would legitimately return `already_consumed` and lock out a
    // candidate who had done nothing wrong.
    entry.inFlight ??= authorizeExam();

    void entry.inFlight.then((result) => {
      if (result === null) entry.granted = true;
      if (cancelled) return;
      if (result === null) {
        setGate("allowed");
      } else {
        setFailure(result);
        setGate("refused");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (gate !== "refused") return;
    let cancelled = false;
    void getServerMode().then((mode) => {
      if (!cancelled) setDevMode(mode === "development");
    });
    return () => {
      cancelled = true;
    };
  }, [gate]);

  /** Mint a ticket with no calibration behind it, then go through the normal
   *  door with it.
   *
   *  The reload is the point, not a convenience. It would be one line shorter
   *  to set the gate open here, and that line would remove the single-use
   *  consume that is the only thing making a ticket mean anything. Reloading
   *  sends the new ticket through `authorizeExam` exactly as a calibrated one
   *  goes — same route, same consume, same recorded provenance. */
  async function bypassForDevelopment() {
    setMinting(true);
    const minted = await mintDevelopmentTicket(getCandidateId());
    if (minted) {
      window.location.reload();
      return;
    }
    setMinting(false);
  }

  if (gate === "allowed") return <>{children}</>;

  return (
    <div className="page">
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="logo-link">
          <Logo />
        </Link>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".16em", color: "var(--faint)" }}>
          SESSION LOCKED
        </span>
        <Link to="/candidate" className="nav-link">
          My sessions
        </Link>
      </header>
      <main id="content" tabIndex={-1} className="container" style={{ maxWidth: 620, paddingTop: 80 }}>
        {gate === "checking" ? (
          <div className="card tint">
            <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.35 }}>
              Verifying this sitting's calibration…
            </div>
          </div>
        ) : (
          <div className="card tint">
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 10, lineHeight: 1.35 }}>
              Calibration required before the session.
            </div>
            <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.65, margin: "0 0 8px" }}>
              {failure?.message}
            </p>
            <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.65, margin: "0 0 18px" }}>
              Calibration is run once per sitting and is never carried over from a previous one —
              it verifies the person, the camera and the room you are in right now.
            </p>
            <Link className="btn btn-primary small" to="/onboarding">
              Calibrate now →
            </Link>
            {devMode && (
              <div
                style={{
                  marginTop: 22,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    letterSpacing: ".16em",
                    color: "var(--faint)",
                    marginBottom: 8,
                  }}
                >
                  PP_MODE=DEVELOPMENT
                </div>
                <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 12px" }}>
                  This backend is running in development mode, so the session can be started
                  without calibrating. Nothing is verified about the person at the camera, and the
                  session is recorded as bypassed and excluded from analysis.
                </p>
                <button className="btn small" onClick={bypassForDevelopment} disabled={minting}>
                  {minting ? "Minting…" : "Skip calibration (development)"}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/** Entry state for this tab's JS lifetime. Module scope rather than a ref
 *  because StrictMode's second invocation gets a fresh ref.
 *
 *  Deliberately in memory and nowhere else: a reload clears it, and the ticket
 *  it was granted against has already been consumed server-side, so a reloaded
 *  tab is correctly refused and sent back to calibrate. Persisting this would
 *  recreate exactly the carry-over the ticket exists to prevent. */
const entry: { granted: boolean; inFlight: Promise<AuthorizeFailure | null> | null } = {
  granted: false,
  inFlight: null,
};
