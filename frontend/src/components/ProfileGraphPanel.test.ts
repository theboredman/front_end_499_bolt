import { describe, expect, it } from "vitest";

import { layoutProfileGraph, NODE_TYPE_ORDER } from "./ProfileGraphPanel";
import type { ProfileGraph } from "../lib/personalisation";

// The load-bearing part of this component is the merge, not the SVG — the
// diagram is only honest if it draws the SAME distinction the rest of the
// feature enforces: extracted (suggested) and approved (confirmed) are
// different things, and a node's visual status here must match what
// `problemproof/profile/schema.py` actually recorded, not what happens to be
// convenient to compute.

function graph(overrides: Partial<ProfileGraph> = {}): ProfileGraph {
  return {
    candidate_id: "c1",
    extracted: { nodes: [], edges: [] },
    approved: { nodes: [], edges: [] },
    extraction: null,
    review_events: [],
    metrics: {
      extracted_total: 0,
      approved_from_extraction: 0,
      edited: 0,
      rejected: 0,
      participant_added: 0,
      reviewed: false,
    },
    updated_at: null,
    ...overrides,
  } as ProfileGraph;
}

const skill = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "Skill" as const,
  label,
  detail: null,
  provenance: "skills" as const,
  confidence: 0.9,
  ...extra,
});

describe("layoutProfileGraph — the merge", () => {
  it("draws an extracted-only node as suggested", () => {
    const g = graph({ extracted: { nodes: [skill("s1", "Python")], edges: [] } });
    const layout = layoutProfileGraph(g);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].status).toBe("suggested");
  });

  it("draws an approved node as approved, even though it also appears in extracted", () => {
    const g = graph({
      extracted: { nodes: [skill("s1", "Python")], edges: [] },
      approved: { nodes: [skill("s1", "Python", { origin: "extracted" })], edges: [] },
    });
    const layout = layoutProfileGraph(g);
    expect(layout.nodes).toHaveLength(1); // one node, not two — same id
    expect(layout.nodes[0].status).toBe("approved");
  });

  it("shows the APPROVED (possibly edited) label, not the original extracted one", () => {
    // CONSTRAINT: schema.approve keeps the original in extracted_label and
    // rewrites the live label to what the participant corrected it to. The
    // graph must show what is true now, with the correction traceable via
    // extracted_label rather than silently lost.
    const g = graph({
      extracted: { nodes: [skill("s1", "Postgres")], edges: [] },
      approved: {
        nodes: [skill("s1", "PostgreSQL 15", { origin: "extracted", extracted_label: "Postgres" })],
        edges: [],
      },
    });
    const layout = layoutProfileGraph(g);
    expect(layout.nodes[0].label).toBe("PostgreSQL 15");
    expect(layout.nodes[0].extracted_label).toBe("Postgres");
  });

  it("includes a participant's own addition, which has no extracted counterpart", () => {
    const g = graph({
      approved: { nodes: [skill("claim-0-skill", "Elixir", { origin: "participant" })], edges: [] },
    });
    const layout = layoutProfileGraph(g);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].status).toBe("approved");
    expect(layout.nodes[0].origin).toBe("participant");
  });

  it("carries an LLM-cleanup correction through to the rendered node", () => {
    // The same shape as esco_id/esco_similarity: additive fields on the node
    // that the layout must pass through untouched, since the panel's hover
    // tooltip and Account.tsx's SuggestionRow both read them directly off
    // whatever this function returns.
    const g = graph({
      extracted: {
        nodes: [skill("s1", "Python", { cleanup_original: "Pythom", cleanup_provenance: "nim" })],
        edges: [],
      },
    });
    const layout = layoutProfileGraph(g);
    expect(layout.nodes[0].label).toBe("Python");
    expect(layout.nodes[0].cleanup_original).toBe("Pythom");
  });

  it("a rejected node (extracted, never approved) still renders as suggested", () => {
    // Rejection does not remove the node from `extracted` (schema.reject
    // keeps it on record) and this graph draws whatever it is given — nothing
    // here filters out a rejected node. That is a deliberate non-goal: the
    // graph is not the place rejection is decided or hidden, the list below
    // is.
    const g = graph({ extracted: { nodes: [skill("s1", "COBOL")], edges: [] } });
    const layout = layoutProfileGraph(g);
    expect(layout.nodes[0].status).toBe("suggested");
  });
});

describe("layoutProfileGraph — edges", () => {
  it("drops an edge whose endpoint is not in the merged node set", () => {
    const g = graph({
      extracted: {
        nodes: [skill("s1", "Python")],
        edges: [{ from: "s1", to: "project-1", relation: "USED_IN" }],
      },
    });
    const layout = layoutProfileGraph(g);
    expect(layout.edges).toHaveLength(0);
  });

  it("dedupes an edge that appears in both extracted and approved", () => {
    const nodes = [
      skill("s1", "Python"),
      { id: "p1", type: "Project" as const, label: "Recorder", detail: null, provenance: "projects" as const, confidence: 0.8 },
    ];
    const edge = { from: "s1", to: "p1", relation: "USED_IN" };
    const g = graph({
      extracted: { nodes, edges: [edge] },
      approved: { nodes, edges: [edge] },
    });
    const layout = layoutProfileGraph(g);
    expect(layout.edges).toHaveLength(1);
  });

  it("merges USED_IN and EVIDENCED_BY between the same pair into one drawn edge", () => {
    // CONSTRAINT: extraction.py emits BOTH relations for every skill a
    // project/experience entry mentions — the same two nodes, twice. Drawn as
    // two separate curves they land exactly on top of each other (same
    // control-point math, same endpoints) and the second is invisible. Caught
    // by actually rendering a realistic graph and looking at the coordinates,
    // not by reasoning about the code in the abstract.
    const python = skill("s1", "Python");
    const recorder = { id: "p1", type: "Project" as const, label: "Recorder", detail: null, provenance: "projects" as const, confidence: 0.8 };
    const g = graph({
      extracted: {
        nodes: [python, recorder],
        edges: [
          { from: "s1", to: "p1", relation: "USED_IN" },
          { from: "s1", to: "p1", relation: "EVIDENCED_BY" },
        ],
      },
    });
    const layout = layoutProfileGraph(g);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].relations).toEqual(["USED_IN", "EVIDENCED_BY"]);
  });

  it("marks an edge bothApproved only when BOTH endpoints are approved", () => {
    const python = skill("s1", "Python");
    const recorder = { id: "p1", type: "Project" as const, label: "Recorder", detail: null, provenance: "projects" as const, confidence: 0.8 };
    const g = graph({
      extracted: { nodes: [python, recorder], edges: [{ from: "s1", to: "p1", relation: "USED_IN" }] },
      approved: { nodes: [python], edges: [] }, // only the skill approved, not the project
    });
    const layout = layoutProfileGraph(g);
    expect(layout.edges[0].bothApproved).toBe(false);
  });
});

describe("layoutProfileGraph — columns", () => {
  it("orders present columns by NODE_TYPE_ORDER, skipping absent types", () => {
    const g = graph({
      extracted: {
        nodes: [
          { id: "e1", type: "Education" as const, label: "BSc CS", detail: null, provenance: "education" as const, confidence: 0.85 },
          skill("s1", "Python"),
        ],
        edges: [],
      },
    });
    const layout = layoutProfileGraph(g);
    expect(layout.columns.map((c) => c.type)).toEqual(["Skill", "Education"]);
    // Skill sorts before Education in NODE_TYPE_ORDER, so its column comes
    // first regardless of the order nodes were supplied in.
    expect(NODE_TYPE_ORDER.indexOf("Skill")).toBeLessThan(NODE_TYPE_ORDER.indexOf("Education"));
  });

  it("every node gets a finite, in-bounds position", () => {
    const g = graph({
      extracted: {
        nodes: [skill("s1", "Python"), skill("s2", "Rust"), skill("s3", "Go")],
        edges: [],
      },
    });
    const layout = layoutProfileGraph(g);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(layout.width);
    }
  });

  it("an empty graph produces no nodes and no columns without throwing", () => {
    const layout = layoutProfileGraph(graph());
    expect(layout.nodes).toEqual([]);
    expect(layout.columns).toEqual([]);
  });
});
