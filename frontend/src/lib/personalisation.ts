// API client for the personalisation layer: CV, profile graph, exam spec, question.
//
// Talks to backend/problemproof/api/personalisation.py.
//
// One rule runs through this file: `extracted` and `approved` stay separate,
// all the way to the component that renders them. It would be convenient to
// flatten them into one list with an `approved: boolean` — and that is exactly
// the shape the backend contract refuses to store, because it puts the UI one
// boolean away from rendering a parser's guess as a claim about a person. The
// types below mirror the split so a component cannot render one as the other
// by accident.

import { apiFetch } from "./api";

export type NodeType =
  | "Skill"
  | "Project"
  | "Experience"
  | "Education"
  | "Certification"
  | "Evidence";

export type ProvenanceSection =
  | "skills"
  | "experience"
  | "projects"
  | "education"
  | "certifications"
  | "summary"
  | "unsectioned";

/** A node the parser proposed. Not a claim about the person. */
export type ExtractedNode = {
  id: string;
  type: NodeType;
  label: string;
  detail: string | null;
  /** Which CV section it was read out of. */
  provenance: ProvenanceSection;
  /** The parser's stated prior for this extraction route — NOT a fitted
   *  probability, and labelled as such wherever it is shown. */
  confidence: number;
  /** Present only when this Skill's label came from an accepted ESCO
   *  taxonomy match rather than the dictionary — a candidate phrase the
   *  ~100-term dictionary didn't recognise, matched against the ~13,900
   *  concepts in the (locally embedded, no CV content sent anywhere) ESCO
   *  taxonomy instead. A MEASURED cosine similarity, not the same thing as
   *  `confidence` above — see backend/problemproof/profile/esco.py. */
  esco_id?: string;
  esco_similarity?: number;
  /** Present only when this Skill's label was corrected by the OPTIONAL,
   *  off-by-default LLM cleanup tier (NVIDIA NIM) — tried only on phrases
   *  that missed both the dictionary and ESCO, and only ever given the
   *  isolated skill phrase itself, never CV prose. `cleanup_original` is
   *  what it replaced, kept for the same reason `extracted_label` is kept on
   *  an approved node: so a reviewer can see, and reject, what a correction
   *  replaced. Every corrected label already passed a similarity guard
   *  server-side (`problemproof/profile/llm_cleanup.py`) before reaching
   *  here — this is not raw, unchecked model output. */
  cleanup_original?: string;
  cleanup_provenance?: string;
};

/** A node the participant confirmed. `origin` is what separates a confirmed
 *  suggestion from something they added themselves, and the RQ5 metric depends
 *  on the distinction, so it is carried rather than collapsed. */
export type ApprovedNode = ExtractedNode & {
  origin?: "extracted" | "participant";
  /** What the parser originally said, when the participant corrected it. */
  extracted_label?: string;
};

export type GraphEdge = { from: string; to: string; relation: string };

export type ExtractionReport = {
  source_format: string;
  characters_read: number;
  lines_read: number;
  sections_found: string[];
  unsectioned: boolean;
  nodes_by_type: Record<string, number>;
  nodes_by_provenance: Record<string, number>;
  confidence_provenance: string;
  warnings: string[];
};

export type ReviewMetrics = {
  extracted_total: number;
  approved_from_extraction: number;
  edited: number;
  rejected: number;
  participant_added: number;
  reviewed: boolean;
};

export type ProfileGraph = {
  candidate_id: string;
  extracted: { nodes: ExtractedNode[]; edges: GraphEdge[] };
  approved: { nodes: ApprovedNode[]; edges: GraphEdge[] };
  extraction: ExtractionReport | null;
  review_events: { action: string; node_ids: string[]; actor: string; at: number }[];
  metrics: ReviewMetrics;
  updated_at: number | null;
};

export type QuestionFamily = {
  id: string;
  version: number;
  key: string;
  name: string;
  domain: string;
  target_competency: string;
  difficulty_definitions: Record<string, string>;
  duration_minutes: Record<string, [number, number]>;
  required_deliverables: string[];
  rubric_dimensions: string[];
  validity_properties: string[];
};

export type AssessmentVocabulary = {
  families: QuestionFamily[];
  tiers: string[];
  question_types: string[];
  tool_policies: string[];
  rubric_dimensions: string[];
};

export type RubricDimension = {
  id: string;
  anchor: string;
  scale: { value: number; label: string }[];
};

export type Question = {
  question_id: string;
  family_key: string;
  tier: string;
  question_type: string;
  duration_minutes: number;
  tool_policy: string;
  prompt: string;
  deliverables: string[];
  rubric: { dimensions: RubricDimension[]; tier: string; scored_blind: boolean; note: string };
  /** Shown to the participant rather than hidden. Somebody reading a
   *  template-generated question is entitled to know that is what it is. */
  generator_id: string;
  generator_kind: "template" | "provider";
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* a non-JSON body — keep the status */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function uploadCv(candidateId: string, file: File) {
  const body = new FormData();
  body.append("cv", file);
  return json<{
    candidate_id: string;
    extraction: ExtractionReport;
    reconciliation: { still_extracted: string[]; now_unsupported: string[]; newly_extracted: string[] };
    extracted_nodes: number;
    approved_nodes: number;
  }>(
    await apiFetch(`/candidates/${encodeURIComponent(candidateId)}/cv`, {
      method: "POST",
      body,
    })
  );
}

export async function fetchProfileGraph(candidateId: string): Promise<ProfileGraph | null> {
  const res = await apiFetch(`/candidates/${encodeURIComponent(candidateId)}/profile-graph`);
  // 404 means no CV has been uploaded — the normal starting state, not an
  // error to surface as one.
  if (res.status === 404) return null;
  return json<ProfileGraph>(res);
}

/** Approve, reject, or add. Deliberately one action per call.
 *
 *  There is no "save the graph" call, because a whole-graph save makes
 *  approval a side effect of a form round-trip. Every call here names what it
 *  is doing. */
export async function reviewGraph(
  candidateId: string,
  body:
    | { action: "approve"; node_ids: string[]; edited?: Record<string, string> }
    | { action: "reject"; node_ids: string[] }
    | { action: "add_claim"; node_type: NodeType; label: string; detail?: string }
) {
  return json<{ candidate_id: string; approved: ProfileGraph["approved"]; metrics: ReviewMetrics }>(
    await apiFetch(`/candidates/${encodeURIComponent(candidateId)}/profile-graph`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export async function fetchAssessmentVocabulary() {
  return json<AssessmentVocabulary>(await apiFetch("/assessment/families"));
}

export async function createExamSpec(
  sessionId: string,
  body: {
    candidate_id: string;
    selected_node_ids: string[];
    family_key: string;
    tier: string;
    question_type: string;
    duration_minutes: number;
    tool_policy: string;
  }
) {
  return json<{ session_id: string; exam_spec: Record<string, unknown> }>(
    await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/exam-spec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export async function generateQuestion(sessionId: string) {
  return json<{ session_id: string; question: Question }>(
    await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/question`, { method: "POST" })
  );
}

export async function fetchQuestion(sessionId: string): Promise<Question | null> {
  const res = await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/question`);
  if (res.status === 404) return null;
  return (await json<{ question: Question }>(res)).question;
}

// --- the prepared assessment, handed from /assessment to /exam --------------
//
// sessionStorage, matching the exam ticket rather than the auth token. An
// assessment prepared in one tab and picked up tomorrow in another would attach
// a recording to a question chosen in a different sitting, and the session id
// it names would be stale. Scoped to the tab means it dies with the sitting it
// was prepared for.

const PREPARED_KEY = "pp_prepared_assessment";

export type PreparedAssessment = { sessionId: string; question: Question };

export function storePreparedAssessment(prepared: PreparedAssessment) {
  try {
    sessionStorage.setItem(PREPARED_KEY, JSON.stringify(prepared));
  } catch {
    /* storage unavailable — the exam falls back to its default problem */
  }
}

export function readPreparedAssessment(): PreparedAssessment | null {
  try {
    const raw = sessionStorage.getItem(PREPARED_KEY);
    return raw ? (JSON.parse(raw) as PreparedAssessment) : null;
  } catch {
    return null;
  }
}

export function clearPreparedAssessment() {
  try {
    sessionStorage.removeItem(PREPARED_KEY);
  } catch {
    /* non-fatal */
  }
}
