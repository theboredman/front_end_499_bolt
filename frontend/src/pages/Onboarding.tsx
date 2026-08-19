import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import FaceMeshPreview, { type CamStatus } from "../components/FaceMeshPreview";
import CalibrationSession from "../components/CalibrationSession";
import { getCandidateId } from "../lib/calibration";
import { IDENTITY_THRESHOLDS } from "../lib/identityConfig";

const STEPS = [
  { name: "Consent", sub: "What is recorded", accent: "#0E9C8E" },
  { name: "Camera check", sub: "Webcam access", accent: "#34A0D3" },
  { name: "Calibration", sub: "Personal baseline", accent: "#C4841A" },
  { name: "Ready", sub: "Enter session", accent: "#54B87E" },
];

// CLAUDE.md invariant 11: this copy is a factual claim about data handling, and
// it is checked against the code that moves the data, not against the intended
// architecture. The previous version described the latter — on-device
// extraction with no raw video transmitted — which is the design in the Full
// Document but is not what runs. Extractor A runs server-side on an uploaded
// clip; there is no in-browser extractor. Anything added here must be traceable
// to a call in lib/: uploadWebcam, uploadScreenRecording, exportSessionEvidence,
// submitCalibrationFrame.
const CONSENT_ITEMS = [
  {
    label: "What is recorded",
    body:
      "Your entire screen, as video, from the calibration step until you submit — including anything visible on it outside this page. " +
      "Your webcam and microphone for the length of the session. A log of timings and counts. The code you write in the editor.",
    accent: "#0E9C8E",
  },
  {
    label: "What is never recorded",
    body:
      "The characters you type — only the time between keystrokes. What you copy or paste — only how many characters moved. " +
      "The addresses of pages you visit, the titles of your windows, and the contents of your files.",
    accent: "#34A0D3",
  },
  {
    label: "Where it goes",
    body:
      "The recordings and the event log are uploaded to ProblemProof when you submit, and stored there against this session. " +
      "Until then your work in progress is kept in this browser, so a crash doesn't lose it.",
    accent: "#C4841A",
  },
  // Shown only when face matching can actually run. Invariant 11 binds in both
  // directions: describing biometric matching while the matcher is disabled
  // would be a false claim in the opposite direction from the ones corrected in
  // c64a6e3 — telling people we process their face when we do not. The copy and
  // the behaviour are gated on the same flag so they cannot drift apart.
  ...(IDENTITY_THRESHOLDS.validated
    ? [
        {
          label: "Identity matching",
          body:
            "Your face is matched against the reference you enrolled, in your browser. The comparison never leaves " +
            "your machine — only a score reaches us, never a face template. You can decline: the session runs either " +
            "way, and the credential records which applied.",
          accent: "#D3546B",
        },
      ]
    : []),
  {
    label: "During the calibration step",
    body:
      "Webcam frames are sent to be measured and are not kept. The microphone is measured here in your browser and only the " +
      "resulting numbers are sent — no audio leaves your machine during that check.",
    accent: "#7C5CE0",
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [cam, setCam] = useState<CamStatus>("pending");
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [candidateId] = useState(getCandidateId);

  const isLast = step === STEPS.length - 1;
  const camFailed = step === 1 && (cam === "denied" || cam === "unsupported");
  // Calibration is a hard gate, not a best-effort warm-up: the alignment
  // transform it produces is the frame every later session signal is scored
  // in, so a session without one has nothing to score against. That makes the
  // camera a hard requirement too — there is no "continue without" path from
  // either step, and Exam itself re-checks for a stored baseline (see
  // components/RequireCalibration.tsx) so the rule survives a direct URL.
  const camBlocking = step === 1 && cam !== "live";
  const calibrationBlocking = step >= 2 && !calibrationDone;

  const next = () => {
    if (camBlocking || calibrationBlocking) return;
    if (isLast) navigate("/exam");
    else setStep((s) => s + 1);
  };

  const content = [
    {
      title: "Before we record anything, here's exactly what's captured.",
      blurb: `ProblemProof records how you work through a problem. That is more than most tools record — read all ${CONSENT_ITEMS.length} points before you agree to it.`,
      nextLabel: "I understand — continue",
    },
    {
      title: "Let's check your camera.",
      blurb: "The webcam runs during the session so your process record is tied to a real, present person. It is required — the session cannot run without it.",
      nextLabel: cam === "live" ? "Camera working — next" : camFailed ? "Camera required — grant access to continue" : "Waiting for camera…",
    },
    {
      title: "Calibration for this sitting.",
      blurb:
        "A microphone check and three short tasks learn your natural resting pace and expressiveness, so later scoring is calibrated to you specifically. This runs before every exam and is never reused from a previous sitting — it verifies the person, camera and room you are in right now. Every check is graded on capture quality and repeated until it passes.",
      nextLabel: calibrationDone ? "Calibrated — next" : "Complete every check above to continue",
    },
    {
      title: "You're set. Time to think.",
      blurb: "There's no single right answer, and using any tools — including AI — is allowed. What's recorded is how you get there.",
      nextLabel: "Begin session →",
    },
  ][step];

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
          SESSION SETUP · STEP {step + 1} / {STEPS.length}
        </span>
        <Link to="/candidate" className="nav-link" aria-label="Exit setup and return to my sessions">
          Exit ✕
        </Link>
      </header>

      <main id="content" tabIndex={-1} className="container" style={{ maxWidth: 960, display: "grid", gridTemplateColumns: "230px 1fr", gap: 44, alignItems: "start" }}>
        {/* step rail */}
        <aside style={{ position: "sticky", top: 100 }}>
          <div className="eyebrow" style={{ marginBottom: 18 }}>Setup</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <div
                  key={s.name}
                  aria-current={active ? "step" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    padding: "11px 12px",
                    borderLeft: `2px solid ${active ? s.accent : "transparent"}`,
                    background: active ? "var(--surface)" : "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      border: `1px solid ${active ? s.accent : done ? "var(--teal)" : "#D2DAE3"}`,
                      background: active ? s.accent : done ? "var(--teal)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: active || done ? "#fff" : "var(--faint)",
                      flexShrink: 0,
                    }}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: active ? "var(--text)" : done ? "var(--text-body)" : "var(--faint)" }}>
                      {s.name}
                    </span>
                    <span className="mono-label" style={{ fontSize: 8.5, color: active ? s.accent : "#B0B9C6" }}>{s.sub}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </aside>

        {/* panel */}
        <section key={step} className="pp-fade" style={{ minHeight: 400 }}>
          <div className="eyebrow" style={{ color: STEPS[step].accent }}>Step {step + 1} · {STEPS[step].name}</div>
          <h1 style={{ fontSize: 28, lineHeight: 1.25, fontWeight: 600, margin: "0 0 12px", letterSpacing: "-.01em" }}>{content.title}</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--muted)", maxWidth: 520, margin: "0 0 26px" }}>{content.blurb}</p>

          <div style={{ marginBottom: 32 }}>
            {step === 0 && (
              <div className="cell-grid" style={{ gridTemplateColumns: "1fr" }}>
                {CONSENT_ITEMS.map((c) => (
                  <div key={c.label} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                    <span style={{ width: 8, height: 8, background: c.accent, marginTop: 5, flexShrink: 0 }} />
                    <div>
                      <span className="mono-label" style={{ display: "block", marginBottom: 5 }}>{c.label}</span>
                      <div style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.5 }}>{c.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {step === 1 && (
              <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 22, alignItems: "start" }}>
                <FaceMeshPreview height={200} onStatus={setCam} />
                <div className="card" style={{ fontSize: 13, lineHeight: 1.6, color: "var(--muted)" }}>
                  {cam === "pending" && "Your browser should be asking for camera permission now. Choose Allow to continue."}
                  {cam === "live" && (
                    <span>
                      <strong style={{ color: "var(--teal)" }}>Camera is working.</strong> Nothing is being recorded yet. Recording
                      starts at the calibration step, and the session's webcam video is uploaded when you submit.
                    </span>
                  )}
                  {camFailed && (
                    <span>
                      <strong style={{ color: "var(--red)" }}>No camera available.</strong> A session cannot be started without one:
                      calibration and the process record both depend on it. Grant camera access in your browser's site permissions and
                      reload this page.
                    </span>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              cam === "live" ? (
                <CalibrationSession candidateId={candidateId} onDone={() => setCalibrationDone(true)} />
              ) : (
                <div className="card tint" style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--red)" }}>Camera unavailable.</strong> Calibration
                  needs a webcam to establish a baseline, and the session needs that baseline —
                  go back a step and grant camera access.
                </div>
              )
            )}

            {step === 3 && (
              <div className="card tint">
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <span className="dot" style={{ background: "var(--green)", width: 8, height: 8 }} />
                  <span className="mono-label" style={{ color: "var(--teal)", fontWeight: 600 }}>Setup complete</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18 }}>
                  {[
                    ["Problem", "Idempotent batch retry"],
                    ["Est. duration", "20–30 min"],
                    ["Capture", "Webcam + microphone + editor + event log"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span className="mono-label" style={{ display: "block", marginBottom: 6, fontSize: 8.5 }}>{k}</span>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              ← Back
            </button>
            <button className={`btn ${isLast ? "btn-dark" : "btn-primary"}`} onClick={next} disabled={camBlocking || calibrationBlocking}>
              {content.nextLabel}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
