import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { ErrorState, LoadingState } from "../components/States";
import { getCandidateId } from "../lib/calibration";
import { reserveSession } from "../lib/sessions";
import {
  createExamSpec,
  fetchAssessmentVocabulary,
  fetchProfileGraph,
  generateQuestion,
  storePreparedAssessment,
  type AssessmentVocabulary,
  type ProfileGraph,
  type Question,
} from "../lib/personalisation";

// `/assessment` — choose the skills and the shape of the sitting, then see the
// question that produces.
//
// Why the vocabulary is fetched rather than declared here
// -------------------------------------------------------
// The tiers, the families, the question types and the tool policies all come
// from `GET /assessment/families`. A frontend with its own copy drifts from the
// backend's the first time one is added, and the drift surfaces as a
// participant choosing a tier the server then refuses — an error with no
// visible cause on the screen where it happens.
//
// Why the question is generated here and not at /exam
// ---------------------------------------------------
// `/exam` has no controls by design: the screen recording is already running by
// the time it mounts (invariant 2) and every button on it is a way for a gap to
// appear in the evidence record. Generating a question is a choice with several
// steps, so it happens before the recording starts, and the exam page reads the
// result.

const DURATION_STEP = 5;

export default function Assessment() {
  const navigate = useNavigate();
  const candidateId = getCandidateId();

  const [graph, setGraph] = useState<ProfileGraph | null | undefined>(undefined);
  const [vocab, setVocab] = useState<AssessmentVocabulary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState<Question | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [familyKey, setFamilyKey] = useState("");
  const [tier, setTier] = useState("T2");
  const [questionType, setQuestionType] = useState("open_design");
  const [toolPolicy, setToolPolicy] = useState("unrestricted");
  const [duration, setDuration] = useState(45);

  const load = useCallback(() => {
    setError("");
    Promise.all([fetchProfileGraph(candidateId), fetchAssessmentVocabulary()])
      .then(([g, v]) => {
        setGraph(g);
        setVocab(v);
        if (v.families.length && !familyKey) setFamilyKey(v.families[0].key);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "unknown error"));
    // familyKey is deliberately not a dependency: re-running this on every
    // family change would refetch the vocabulary each time the participant
    // picked one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  useEffect(load, [load]);

  const family = useMemo(
    () => vocab?.families.find((f) => f.key === familyKey) ?? null,
    [vocab, familyKey]
  );

  // The duration range belongs to the family and tier, so it moves when either
  // does. Clamping here rather than only validating on submit means the
  // participant never picks a number the server will refuse.
  const range = family?.duration_minutes[tier] ?? [25, 70];
  useEffect(() => {
    setDuration((d) => Math.min(Math.max(d, range[0]), range[1]));
  }, [range[0], range[1]]);

  const approvedSkills = (graph?.approved.nodes ?? []).filter((n) => n.type === "Skill");
  const otherApproved = (graph?.approved.nodes ?? []).filter((n) => n.type !== "Skill");
  const selectedSkillCount = selected.filter((id) =>
    approvedSkills.some((n) => n.id === id)
  ).length;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const prepare = async () => {
    setBusy(true);
    setError("");
    try {
      // One session id for every stream, minted here because the assessment is
      // the first thing that exists about this sitting. `/exam` reuses it, so
      // the question and the recording land in the same directory.
      const id = String(Date.now());
      await reserveSession(id);
      await createExamSpec(id, {
        candidate_id: candidateId,
        selected_node_ids: selected,
        family_key: familyKey,
        tier,
        question_type: questionType,
        duration_minutes: duration,
        tool_policy: toolPolicy,
      });
      const generated = await generateQuestion(id);
      setSessionId(id);
      setQuestion(generated.question);
      storePreparedAssessment({ sessionId: id, question: generated.question });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not prepare the assessment");
    } finally {
      setBusy(false);
    }
  };

  if (graph === undefined && !error) {
    return (
      <div className="page">
        <Header active="assessment" />
        <main id="content" tabIndex={-1} className="container">
          <LoadingState label="Loading your profile…" />
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <Header active="assessment" />

      <main id="content" tabIndex={-1} className="container">
        <div className="eyebrow">Candidate Portal</div>
        <h1 className="page-title">Set up your assessment</h1>
        <p className="page-sub">
          Choose what this sitting is about. The question is written from the skills you
          approved and nothing else — not from your CV, and not from suggestions you left
          unapproved.
        </p>

        {error && (
          <ErrorState
            title="Could not set up the assessment"
            fix={error}
            onRetry={load}
          />
        )}

        {approvedSkills.length === 0 ? (
          <div className="card">
            <p style={{ margin: "0 0 12px", fontSize: 14 }}>
              You have no approved skills yet, so there is nothing to build a question
              around.
            </p>
            <Link className="btn btn-primary" to="/account">
              Review your profile →
            </Link>
          </div>
        ) : question ? (
          <QuestionPreview
            question={question}
            onStart={() => navigate("/onboarding")}
            onDiscard={() => {
              setQuestion(null);
              setSessionId(null);
            }}
            sessionId={sessionId}
          />
        ) : (
          <>
            <section className="card" style={{ marginBottom: 18 }}>
              <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Which skills</h2>
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--muted)" }}>
                Pick at least one skill. The first one you pick is what the problem is set in.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {approvedSkills.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className={selected.includes(node.id) ? "btn btn-primary" : "btn btn-ghost"}
                    aria-pressed={selected.includes(node.id)}
                    onClick={() => toggle(node.id)}
                  >
                    {selected.includes(node.id) ? "✓ " : ""}
                    {node.label}
                  </button>
                ))}
              </div>
              {otherApproved.length > 0 && (
                <>
                  <p style={{ margin: "18px 0 8px", fontSize: 13, color: "var(--muted)" }}>
                    Context we can mention, if it helps set the scene:
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {otherApproved.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        className={selected.includes(node.id) ? "btn btn-primary" : "btn btn-ghost"}
                        aria-pressed={selected.includes(node.id)}
                        onClick={() => toggle(node.id)}
                      >
                        {selected.includes(node.id) ? "✓ " : ""}
                        <span className="mono-label" style={{ marginRight: 6 }}>
                          {node.type}
                        </span>
                        {node.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>

            {vocab && family && (
              <section className="card" style={{ marginBottom: 18 }}>
                <h2 style={{ fontSize: 17, margin: "0 0 14px" }}>Shape of the problem</h2>

                <Field label="Family" hint={family.target_competency}>
                  <select
                    className="search-input"
                    value={familyKey}
                    onChange={(e) => setFamilyKey(e.target.value)}
                  >
                    {vocab.families.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.name} · {f.domain}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Difficulty" hint={family.difficulty_definitions[tier]}>
                  <select className="search-input" value={tier} onChange={(e) => setTier(e.target.value)}>
                    {vocab.tiers.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Question type">
                  <select
                    className="search-input"
                    value={questionType}
                    onChange={(e) => setQuestionType(e.target.value)}
                  >
                    {vocab.question_types.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Duration"
                  hint={`This family scopes ${tier} problems for ${range[0]}–${range[1]} minutes. The problem is deliberately larger than the window — how you handle that is part of what is recorded.`}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <input
                      type="range"
                      min={range[0]}
                      max={range[1]}
                      step={DURATION_STEP}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontFamily: "var(--mono)", fontSize: 14, minWidth: "7ch" }}>
                      {duration} min
                    </span>
                  </span>
                </Field>

                <Field
                  label="Tools"
                  hint="A stated policy, not an enforced one. Nothing here can stop anyone using anything — your screen is recorded and a reviewer sees it."
                >
                  <select
                    className="search-input"
                    value={toolPolicy}
                    onChange={(e) => setToolPolicy(e.target.value)}
                  >
                    {vocab.tool_policies.map((p) => (
                      <option key={p} value={p}>
                        {p.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="mono-label" style={{ marginTop: 18, marginBottom: 6 }}>
                  You will be scored on
                </div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: "var(--text-body)" }}>
                  {family.rubric_dimensions.map((d) => (
                    <li key={d} style={{ marginBottom: 2 }}>
                      {d.replace(/_/g, " ")}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <button
              className="btn btn-primary"
              disabled={busy || selectedSkillCount === 0}
              onClick={prepare}
            >
              {busy ? "Writing your question…" : "Generate the question →"}
            </button>
            {selectedSkillCount === 0 && (
              <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)" }}>
                Pick at least one skill first.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <span className="mono-label" style={{ display: "block", marginBottom: 6 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span
          style={{ display: "block", marginTop: 6, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

function QuestionPreview({
  question,
  sessionId,
  onStart,
  onDiscard,
}: {
  question: Question;
  sessionId: string | null;
  onStart: () => void;
  onDiscard: () => void;
}) {
  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="mono-label" style={{ marginBottom: 10 }}>
          {question.family_key} · {question.tier} · {question.duration_minutes} min
          {sessionId ? ` · session ${sessionId}` : ""}
        </div>
        {/* Sans, per the type rule: the prompt is prose meant for a human, even
            though a program assembled it. */}
        <p style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 15, lineHeight: 1.65 }}>
          {question.prompt}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="mono-label" style={{ marginBottom: 10 }}>
          How this will be scored
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>{question.rubric.note}</p>
        <div style={{ display: "grid", gap: 12 }}>
          {question.rubric.dimensions.map((d) => (
            <div key={d.id}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                {d.id.replace(/_/g, " ")}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.5 }}>{d.anchor}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Said plainly rather than buried. A participant reading a
          template-generated question is entitled to know that is what it is —
          the registry entry for this feature says the same thing, and the two
          must not disagree. */}
      <div className="card tint" style={{ marginBottom: 18 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          <span style={{ fontFamily: "var(--mono)" }}>{question.generator_id}</span> — this
          question was assembled from a fixed family template with your approved skills in
          it, not written by a language model. The family is what keeps sittings comparable
          with each other.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={onStart}>
          Continue to calibration →
        </button>
        <button className="btn btn-ghost" onClick={onDiscard}>
          Change the settings
        </button>
      </div>
      <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--muted)", maxWidth: "62ch" }}>
        Calibration comes next, and your screen recording starts there — before the problem
        opens, and it runs until you submit.
      </p>
    </>
  );
}
