import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import ProfileGraphPanel from "./ProfileGraphPanel";
import type { ProfileGraph } from "../lib/personalisation";

// The extracted/approved distinction is tested at the logic level in
// `ProfileGraphPanel.test.ts` (layoutProfileGraph). This file only checks that
// the component renders without throwing and that the two states — nothing to
// show, something to show — each produce visible, non-empty output. Per
// Frontend Spec §11's below-gate rule applied here too: a region with nothing
// in it must never render as a blank area with no explanation.

const EMPTY: ProfileGraph = {
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
};

const POPULATED: ProfileGraph = {
  ...EMPTY,
  extracted: {
    nodes: [
      { id: "s1", type: "Skill", label: "Python", detail: null, provenance: "skills", confidence: 0.9 },
      { id: "s2", type: "Skill", label: "Team Leadership", detail: null, provenance: "skills", confidence: 0.9, esco_similarity: 0.81 },
    ],
    edges: [],
  },
  approved: {
    nodes: [{ id: "s1", type: "Skill", label: "Python", detail: null, provenance: "skills", confidence: 0.9 }],
    edges: [],
  },
};

describe("ProfileGraphPanel", () => {
  it("never renders a blank region when there is nothing to show", () => {
    render(<ProfileGraphPanel graph={EMPTY} />);
    expect(screen.getByText(/nothing to visualise yet/i)).toBeTruthy();
  });

  it("renders every node's label when there is something to show", () => {
    render(<ProfileGraphPanel graph={POPULATED} />);
    expect(screen.getAllByText("Python").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Team Leadership").length).toBeGreaterThan(0);
  });

  it("names the accessible fallback rather than assuming the diagram is enough", () => {
    render(<ProfileGraphPanel graph={POPULATED} />);
    expect(screen.getByText(/list below carries the same nodes/i)).toBeTruthy();
  });

  it("labels the SVG for assistive technology", () => {
    const { container } = render(<ProfileGraphPanel graph={POPULATED} />);
    const svg = container.querySelector("svg[role='img']");
    expect(svg?.getAttribute("aria-label")).toMatch(/skill graph/i);
  });
});
