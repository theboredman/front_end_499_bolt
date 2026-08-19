import { useState } from "react";
import type { ApprovedNode, ExtractedNode, NodeType, ProfileGraph } from "../lib/personalisation";

// The personalised skill graph — visualised, per candidate, once their CV has
// been analysed.
//
// Same design language as `ProcessGraphPanel` (the phase-transition graph):
// hand-drawn SVG, positions computed by a deterministic formula rather than a
// physics simulation, every node directly labelled, a hover tooltip carrying
// detail, shape (not colour alone) carrying the one distinction that matters.
// No graph library — this codebase has none, and a six-type, few-dozen-node
// graph does not need one.
//
// The one thing this graph MUST keep visible
// --------------------------------------------
// Extracted and approved are separate everywhere else in this feature —
// `profile_graph.json`, the review list above this panel, the API response —
// and they stay separate here. A node is drawn SOLID if the participant
// approved it and HOLLOW+DASHED if it is still a suggestion nobody confirmed.
// That is not a styling choice; it is the same structural rule
// `problemproof/profile/schema.py` enforces server-side, rendered. A graph
// that drew every extracted node solid would visually claim the whole thing
// as confirmed the moment a CV was parsed, before anyone reviewed anything —
// exactly the failure the extracted/approved split exists to prevent.
//
// Colour
// ------
// One hue per node TYPE (not per status — status is shape, per the rule
// above), fixed order, never cycled. The six hues are `lib/labeling.ts`'s
// PHASE_COLORS, reused rather than re-picked: they are already validated
// (`node scripts/validate_palette.js`, CVD ΔE and normal-vision floors both
// pass) and a second unvalidated palette in the same codebase would be a
// second thing to keep passing. Phases and node types never appear in the
// same view, so reusing the hues carries no risk of the two meanings
// colliding for a reader.
//
// The validator's one WARN — contrast against the surface is below 3:1 for
// three of the six hues — obligates visible labels rather than colour alone
// to carry identity. Every node already carries its label directly (sans, per
// the type rule: a label is something the CV's author wrote), and the column
// header names the type in mono, so identity never depends on the contrast
// warning being fixed.
//
// The list above this panel IS the table view
// ----------------------------------------------
// `references/color-formula.md`'s accessibility pass asks for a table view
// alongside any categorical chart, with no colour at all. This graph does not
// duplicate one: `SuggestionRow` / `ApprovedSection`, rendered immediately
// below it, already carry the same nodes as plain rows with no colour
// dependency, and are what a screen-reader user or a colour-blind reader
// falls back to. The caption at the foot of this panel says so explicitly
// rather than leaving it to be discovered.

/** The canonical node-type order for this whole feature — column order here,
 *  and (imported from here rather than redefined) list-sort and add-claim
 *  dropdown order in `Account.tsx`'s Skills section. One definition, so the
 *  two views cannot quietly drift onto different orderings of the same six
 *  types. */
export const NODE_TYPE_ORDER: NodeType[] = [
  "Skill",
  "Project",
  "Experience",
  "Education",
  "Certification",
  "Evidence",
];

// `lib/labeling.ts`'s PHASE_COLORS, in the same fixed order as
// NODE_TYPE_ORDER above — not the same MEANING (a phase and a node type are
// unrelated categorical dimensions that never share a view), just the same
// pre-validated six hues, so this graph does not need its own palette
// validated separately.
const NODE_TYPE_COLOR: Record<NodeType, string> = {
  Skill: "#2a78d6",
  Project: "#eb6834",
  Experience: "#1baf7a",
  Education: "#eda100",
  Certification: "#e87ba4",
  Evidence: "#008300",
};

export type GraphStatus = "approved" | "suggested";

export type GraphNodeView = {
  id: string;
  type: NodeType;
  label: string;
  status: GraphStatus;
  provenance: string;
  confidence: number;
  esco_similarity?: number;
  cleanup_original?: string;
  origin?: "extracted" | "participant";
  extracted_label?: string;
  x: number;
  y: number;
};

export type GraphEdgeView = {
  from: string;
  to: string;
  /** Every relation recorded between this pair, not just one.
   *
   *  `extraction.py` emits BOTH `USED_IN` and `EVIDENCED_BY` for every skill
   *  a project or experience entry mentions — the same two nodes, two
   *  relations. Drawn as two separate curves they land exactly on top of each
   *  other (same control-point math, same endpoints) and the second is
   *  invisible; drawn as one curve carrying both names in its tooltip, the
   *  diagram shows what a reader actually needs — that the two are related —
   *  without a phantom duplicate arc pretending to be two facts. */
  relations: string[];
  bothApproved: boolean;
};

export type ProfileGraphLayout = {
  width: number;
  height: number;
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  columns: { type: NodeType; x: number; count: number }[];
};

const MARGIN_X = 90;
const MARGIN_Y = 40;
const COLUMN_MIN_GAP = 150;
const ROW_GAP = 46;
export const NODE_R = 16;

/**
 * Merge `extracted` and `approved` into one node per id, lay them out in
 * columns by type, and dedupe the edges. Pure and exported so the merge
 * logic — which IS the load-bearing part — is testable without rendering
 * anything.
 *
 * The merge rule: an id present in `approved` is drawn as its APPROVED
 * version (which may carry an edited label — `schema.approve` keeps the
 * original in `extracted_label`) with status "approved". An id present only
 * in `extracted` is drawn as-is with status "suggested". A participant's own
 * addition (`origin: "participant"`) has no `extracted` counterpart at all
 * and is included from `approved` alone.
 */
export function layoutProfileGraph(graph: ProfileGraph): ProfileGraphLayout {
  const approvedById = new Map<string, ApprovedNode>(graph.approved.nodes.map((n) => [n.id, n]));
  const merged = new Map<string, { node: ExtractedNode | ApprovedNode; status: GraphStatus }>();

  for (const node of graph.extracted.nodes) {
    const approved = approvedById.get(node.id);
    merged.set(node.id, approved ? { node: approved, status: "approved" } : { node, status: "suggested" });
  }
  for (const node of graph.approved.nodes) {
    if (!merged.has(node.id)) merged.set(node.id, { node, status: "approved" });
  }

  const byType = new Map<NodeType, { node: ExtractedNode | ApprovedNode; status: GraphStatus }[]>();
  for (const entry of merged.values()) {
    const bucket = byType.get(entry.node.type) ?? [];
    bucket.push(entry);
    byType.set(entry.node.type, bucket);
  }
  for (const bucket of byType.values()) {
    bucket.sort((a, b) => a.node.label.localeCompare(b.node.label));
  }

  const presentTypes = NODE_TYPE_ORDER.filter((t) => (byType.get(t)?.length ?? 0) > 0);
  const columnGap = presentTypes.length > 1 ? COLUMN_MIN_GAP : 0;
  const maxRows = Math.max(1, ...presentTypes.map((t) => byType.get(t)!.length));

  const width = presentTypes.length <= 1
    ? MARGIN_X * 2
    : MARGIN_X * 2 + columnGap * (presentTypes.length - 1);
  const height = Math.max(160, MARGIN_Y * 2 + ROW_GAP * (maxRows - 1));

  const nodes: GraphNodeView[] = [];
  const columns: ProfileGraphLayout["columns"] = [];

  presentTypes.forEach((type, columnIndex) => {
    const bucket = byType.get(type)!;
    const x = presentTypes.length <= 1 ? width / 2 : MARGIN_X + columnIndex * columnGap;
    columns.push({ type, x, count: bucket.length });

    // Centred vertically as a block, rather than always starting at the top —
    // a column of 2 skills should not look like it is anchored to a column of
    // 15 experiences above it.
    const blockHeight = ROW_GAP * (bucket.length - 1);
    const startY = height / 2 - blockHeight / 2;

    bucket.forEach((entry, rowIndex) => {
      const n = entry.node;
      nodes.push({
        id: n.id,
        type: n.type,
        label: n.label,
        status: entry.status,
        provenance: n.provenance,
        confidence: n.confidence,
        esco_similarity: n.esco_similarity,
        cleanup_original: n.cleanup_original,
        origin: (n as ApprovedNode).origin,
        extracted_label: (n as ApprovedNode).extracted_label,
        x,
        y: startY + rowIndex * ROW_GAP,
      });
    });
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // Grouped by (from, to) -- NOT (from, to, relation) -- so multiple
  // relations between the same pair (USED_IN and EVIDENCED_BY are emitted
  // together for every project/experience-mentioned skill) merge into one
  // drawn curve instead of overlapping identically. See GraphEdgeView.relations.
  const byPair = new Map<string, GraphEdgeView>();
  for (const edge of [...graph.extracted.edges, ...graph.approved.edges]) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue; // an endpoint outside the merged set -- defensive, should not happen
    const key = `${edge.from} ${edge.to}`;
    const existing = byPair.get(key);
    if (existing) {
      if (!existing.relations.includes(edge.relation)) existing.relations.push(edge.relation);
      continue;
    }
    byPair.set(key, {
      from: edge.from,
      to: edge.to,
      relations: [edge.relation],
      bothApproved: from.status === "approved" && to.status === "approved",
    });
  }
  const edges = [...byPair.values()];

  return { width, height, nodes, edges, columns };
}

/** Perpendicular bow, same construction as `ProcessGraphPanel.arcControlPoint`
 *  — offset perpendicular to the edge rather than a fixed vertical lift, so it
 *  degenerates sensibly for a same-column pair (RELATED_TO between two
 *  skills, say) as well as a cross-column one. */
function arcControlPoint(ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = Math.min(50, 14 + len * 0.1);
  return { x: (ax + bx) / 2 + nx * bow, y: (ay + by) / 2 + ny * bow };
}

function truncate(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export default function ProfileGraphPanel({ graph }: { graph: ProfileGraph }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const layout = layoutProfileGraph(graph);

  if (layout.nodes.length === 0) {
    return (
      <div className="card" style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 20 }}>
        Nothing to visualise yet — the parser found no nodes in this document.
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="mono-label" style={{ marginBottom: 10 }}>
        Your skill graph
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 14px" }}>
        Everything read out of your CV, grouped by type. Solid, filled nodes are claims you have
        approved; hollow, dashed nodes are still suggestions — approve or correct them below.
      </p>

      <div style={{ position: "relative", overflow: "auto", maxHeight: 420 }}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width="100%"
          height={Math.min(420, layout.height)}
          role="img"
          aria-label={`Skill graph with ${layout.nodes.length} nodes across ${layout.columns.length} types. The list below carries the same nodes without relying on this diagram.`}
        >
          <defs>
            <marker id="pp-profile-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                    markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--muted, #6B7688)" />
            </marker>
          </defs>

          {/* Column headers: mono, per the type rule — a category the system
              assigned, not something a person wrote. */}
          {layout.columns.map((col) => (
            <text
              key={col.type}
              x={col.x}
              y={16}
              textAnchor="middle"
              style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".08em", fill: "var(--faint, #9AA4B4)" }}
            >
              {col.type.toUpperCase()} ({col.count})
            </text>
          ))}

          {/* Edges first, so nodes sit above them. Faded when either end is
              still a suggestion — the relationship inherits the same
              provisional status its endpoints carry. */}
          {layout.edges.map((edge, i) => {
            const a = layout.nodes.find((n) => n.id === edge.from);
            const b = layout.nodes.find((n) => n.id === edge.to);
            if (!a || !b) return null;
            const mid = arcControlPoint(a.x, a.y, b.x, b.y);
            const path = `M ${a.x} ${a.y} Q ${mid.x} ${mid.y} ${b.x} ${b.y}`;
            return (
              <path
                key={i}
                d={path}
                fill="none"
                stroke="var(--muted, #6B7688)"
                strokeWidth={1.5}
                opacity={edge.bothApproved ? 0.6 : 0.28}
                markerEnd="url(#pp-profile-arrow)"
                onMouseEnter={() =>
                  setHover({
                    x: mid.x,
                    y: mid.y,
                    text: `${a.label} —${edge.relations.join(" / ")}→ ${b.label}`,
                  })
                }
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              >
                <title>{`${a.label} ${edge.relations.join(" / ")} ${b.label}`}</title>
              </path>
            );
          })}

          {/* Nodes. Status is SHAPE (solid vs hollow+dashed), never colour
              alone — the one distinction in this graph that must survive
              greyscale, print, and colour blindness, because it is the same
              extracted/approved boundary the whole feature is built around. */}
          {layout.nodes.map((node) => {
            const approved = node.status === "approved";
            const color = NODE_TYPE_COLOR[node.type];
            return (
              <g
                key={node.id}
                opacity={approved ? 1 : 0.7}
                onMouseEnter={() =>
                  setHover({
                    x: node.x,
                    y: node.y,
                    text: [
                      node.label,
                      `${node.type} · ${node.provenance} · prior ${node.confidence.toFixed(2)}`,
                      node.esco_similarity !== undefined ? `ESCO match ${node.esco_similarity.toFixed(2)}` : null,
                      node.cleanup_original ? `spelling-corrected from "${node.cleanup_original}"` : null,
                      node.extracted_label ? `originally "${node.extracted_label}"` : null,
                      approved
                        ? node.origin === "participant"
                          ? "added by you"
                          : "approved"
                        : "suggested — not yet approved",
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  })
                }
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "default" }}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={NODE_R}
                  fill={approved ? color : "transparent"}
                  stroke={color}
                  strokeWidth={approved ? 2 : 1.5}
                  strokeDasharray={approved ? undefined : "3 3"}
                />
                <text
                  x={node.x}
                  y={node.y + NODE_R + 12}
                  textAnchor="middle"
                  style={{ fontFamily: "var(--sans)", fontSize: 10, fill: "var(--ink, #1B2432)" }}
                >
                  {truncate(node.label)}
                </text>
                <title>{node.label}</title>
              </g>
            );
          })}
        </svg>

        {hover && (
          <div
            style={{
              position: "absolute",
              left: `${(hover.x / layout.width) * 100}%`,
              top: `${(hover.y / layout.height) * 100}%`,
              transform: "translate(-50%, -140%)",
              background: "var(--ink, #1B2432)",
              color: "#fff",
              fontFamily: "var(--sans)",
              fontSize: 11,
              padding: "6px 10px",
              borderRadius: 6,
              pointerEvents: "none",
              whiteSpace: "nowrap",
              maxWidth: 320,
              zIndex: 1,
            }}
          >
            {hover.text}
          </div>
        )}
      </div>

      {/* The legend. Two rows: status (shape) and type (colour) — kept apart
          because they are two different encodings, and merging them into one
          row would imply they are the same kind of fact. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14, fontSize: 11, color: "var(--muted)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <svg width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="6" fill="var(--faint, #9AA4B4)" />
          </svg>
          Approved
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <svg width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="6" fill="transparent" stroke="var(--faint, #9AA4B4)" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
          Suggested
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
        {layout.columns.map((col) => (
          <span key={col.type} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <svg width="10" height="10" aria-hidden="true">
              <circle cx="5" cy="5" r="5" fill={NODE_TYPE_COLOR[col.type]} />
            </svg>
            {col.type}
          </span>
        ))}
      </div>

      <p style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--faint)", lineHeight: 1.6, margin: "12px 0 0" }}>
        The list below carries the same nodes with no colour or shape to read — use it if this
        diagram is hard to see.
      </p>
    </div>
  );
}
