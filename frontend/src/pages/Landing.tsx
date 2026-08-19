import { Link } from "react-router-dom";
import Header from "../components/Header";

const LAYERS = [
  {
    tag: "01",
    name: "Capture",
    accent: "#3F4CE0",
    detail: "Webcam, screen and input events are recorded in parallel, timestamped to a single master clock so nothing can be reordered after the fact.",
  },
  {
    tag: "02",
    name: "Extract",
    accent: "#6A4FCB",
    detail: "Footage is reduced to structured signals — attention, typing rhythm, pauses — and the recording is kept as the evidence a human checks those signals against.",
  },
  {
    tag: "03",
    name: "Model",
    accent: "#9553B0",
    detail: "Branches, dead ends and recoveries are assembled into a Process Graph: the actual solving trajectory, not just the final answer.",
  },
  {
    tag: "04",
    name: "Calibrate",
    accent: "#C85A82",
    detail: "Every profile is scored against the participant's own baseline — not population norms — removing bias against different thinking styles.",
  },
  {
    tag: "05",
    name: "Certify",
    accent: "#FF6A4D",
    detail: "The verified process record is issued as a shareable, time-boxed credential that employers can inspect.",
  },
];

// Every claim here has to be traceable to code that runs. The previous version
// described on-device extraction with no raw video transmitted, which is the
// design in the Full Document and not the system: there is no in-browser
// extractor, and the session's webcam and screen recordings are uploaded at
// submit and stored (routes.py upload_webcam → storage.webcam_path).
//
// The claim that replaced it is narrower and actually enforced: the EVENT LOG
// cannot carry content, because `assert_no_content` and `FORBIDDEN_ATTRS` in
// backend/problemproof/events.py reject it at the schema boundary and
// test_events_schema.py holds them to it. A promise a test can break is worth
// more on this page than a broader one nobody checks.
const PRIVACY = [
  {
    label: "Told in advance",
    title: "Whole screen, webcam, microphone",
    accent: "#3F4CE0",
    body: "The recordings are uploaded when you submit and stored against your session — they are what a human reviewer checks the analysis against. You see this in full before anything starts.",
  },
  {
    label: "No content, by schema",
    title: "The event log cannot hold what you wrote",
    accent: "#9553B0",
    body: "Timings, counts and lengths only — never the characters you type, what you copied, the pages you visited or your window titles. The schema rejects those fields; it isn't a policy anyone has to remember.",
  },
  {
    label: "Personal baseline",
    title: "Scored against yourself, not a norm",
    accent: "var(--color-graphite-ink)",
    body: "Each profile is calibrated to your own pace and expressiveness, so introverted and neurodivergent thinkers aren't penalised.",
  },
];

export default function Landing() {
  return (
    <div className="page">
      <Header active="home" />

      {/* hero */}
      <section id="content" tabIndex={-1} style={{ maxWidth: 900, margin: "0 auto", padding: "96px 32px 96px", textAlign: "center" }}>
        <h1 style={{ fontSize: 60, lineHeight: 1.05, fontWeight: 500, margin: "0 0 20px", letterSpacing: "-.02em" }}>
          In the AI era, the only skill that can't be automated is the ability to{" "}
          <em
            style={{
              fontFamily: "var(--display)",
              fontStyle: "italic",
              fontWeight: 400,
              color: "var(--color-cognition-blue)",
            }}
          >
            think through a problem.
          </em>
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--muted)", maxWidth: 560, margin: "0 auto 32px" }}>
          ProblemProof records <em style={{ fontStyle: "normal", fontWeight: 500, color: "var(--text)" }}>how you solve</em> a problem —
          phases, dead ends, recoveries — and turns that process into a credential employers can verify. Use any tools you like; the
          thinking is what's certified.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 14 }}>
          <Link to="/onboarding" className="btn btn-primary">
            Start a session
          </Link>
          <a href="#how" className="btn btn-ghost">
            How it works ↓
          </a>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="container" style={{ paddingTop: 24 }}>
        <div className="eyebrow">How it works</div>
        <h2 style={{ fontSize: 32, fontWeight: 600, margin: "0 0 32px", letterSpacing: "-.01em", maxWidth: 620, lineHeight: 1.15 }}>
          Five layers turn raw problem-solving into a verifiable credential.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          {LAYERS.map((l) => (
            <div key={l.tag} className="card" style={{ padding: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span className="dot" style={{ color: l.accent, width: 8, height: 8 }} />
                <span className="mono-label" style={{ color: l.accent }}>{l.tag}</span>
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>{l.name}</h3>
              <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>{l.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* privacy */}
      <section style={{ background: "var(--surface)" }}>
        <div className="container" style={{ paddingBottom: 64 }}>
          <div className="eyebrow">What is recorded</div>
          <h2 style={{ fontSize: 32, fontWeight: 600, margin: "0 0 32px", letterSpacing: "-.01em", maxWidth: 620, lineHeight: 1.15 }}>
            You are told exactly what is captured, before any of it is.
          </h2>
          <div className="cell-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {PRIVACY.map((p) => (
              <div key={p.label}>
                <div className="mono-label" style={{ marginBottom: 10 }}>{p.label}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: p.accent, marginBottom: 6 }}>{p.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55 }}>{p.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* final CTA */}
      <section style={{ padding: "80px 32px 96px", textAlign: "center" }}>
        <h2 style={{ fontSize: 32, fontWeight: 600, margin: "0 0 12px", letterSpacing: "-.01em", lineHeight: 1.15 }}>Certify the thinking. Not the tool.</h2>
        <p style={{ fontSize: 15, color: "var(--muted)", margin: "0 0 28px" }}>Take a monitored problem-solving session and see your own process record.</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 14 }}>
          <Link to="/onboarding" className="btn btn-primary">
            I'm a candidate
          </Link>
          <Link to="/org" className="btn btn-ghost">
            I'm an employer
          </Link>
        </div>
      </section>

      <footer
        style={{
          padding: "24px 32px",
          textAlign: "center",
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: ".14em",
          color: "var(--faint)",
        }}
      >
        PROBLEMPROOF · CSE499 CAPSTONE · VERIFYING HUMAN THINKING IN THE AI ERA
      </footer>
    </div>
  );
}
