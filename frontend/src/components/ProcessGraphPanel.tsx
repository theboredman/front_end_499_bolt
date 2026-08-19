import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { PHASES, PHASE_COLORS, type Phase } from "../lib/labeling";

// The Process Graph (research plan §2.4 Build E) — the participant's actual
// solving trajectory as a directly-follows graph.
//
// Form: the four graph features are scalars, so they are stat tiles, not a
// chart. The trajectory itself is a node-link diagram — the job is structure
// and identity (which phases, which transitions, which of them go backwards),
// and no bar or line form carries that.
//
// Colour: categorical, assigned per phase in a fixed order, never cycled and
// never reordered by frequency. But colour is NOT the identity channel here —
// every node is directly labelled with its phase name. That is deliberate: a
// six-hue palette cannot clear the all-pairs separation floors, and in a
// node-link diagram any two nodes can end up beside each other. Rather than
// pretend otherwise, the name is on the node and colour reinforces it. A table
// view below carries the same data without colour at all.

type Edge = { from: string; to: string; count: number; mean_dur_ms: number };

type ProcessGraph = {
  nodes: string[];
  edges: Edge[];
  features: {
    n_transitions: number;
    cycle_count: number;
    phase_entropy: number;
    backtrack_ratio: number;
  };
  label_source?: string;
  duration_ms?: number;
};

// Canonical forward order. Recovery sits off the line because it is not a
// stage of the sequence — it is where the sequence went wrong.
const LANE: Phase[] = [
  "Understanding",
  "Decomposition",
  "Exploration",
  "Execution",
  "Verification",
];

const W = 780;
const H = 320; // headroom for the Recovery label's descenders below its node
const LANE_Y = 132;
const RECOVERY_Y = 240;
const R = 30;

/** Control point for an edge's arc.
 *
 *  Offset **perpendicular** to the edge rather than by a fixed vertical lift.
 *  A fixed lift draws a→b and b→a as the same curve whenever the two nodes
 *  differ in y, which made Execution↔Recovery — the backtrack-and-return that
 *  matters most on this diagram — render as a single ambiguous arc.
 *
 *  The perpendicular is deliberately NOT sign-flipped for backtracks. Reversing
 *  an edge already flips `dx`/`dy`, so the offset flips with it and the pair
 *  separates on its own; multiplying by another −1 cancels that and puts both
 *  directions back on the same side. Forward-vs-backtrack is carried by the
 *  dash pattern instead, which also survives greyscale and print.
 */
function arcControlPoint(ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = Math.min(70, 26 + len * 0.16);
  return { x: (ax + bx) / 2 + nx * bow, y: (ay + by) / 2 + ny * bow };
}

function nodeX(index: number, count: number) {
  const margin = 72;
  if (count <= 1) return W / 2;
  return margin + (index * (W - 2 * margin)) / (count - 1);
}

export default function ProcessGraphPanel({ sessionId }: { sessionId: string }) {
  const [graph, setGraph] = useState<ProcessGraph | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/sessions/${encodeURIComponent(sessionId)}/graph`)
      .then(async (res) => {
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.detail ?? `no process graph (${res.status})`);
        }
        return res.json();
      })
      .then((g: ProcessGraph) => !cancelled && setGraph(g))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "unavailable"));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const positions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    LANE.forEach((phase, i) => {
      pos[phase] = { x: nodeX(i, LANE.length), y: LANE_Y };
    });
    pos.Recovery = { x: W / 2, y: RECOVERY_Y };
    return pos;
  }, []);

  if (error) {
    return (
      <div className="card">
        <div className="mono-label" style={{ marginBottom: 10 }}>PROCESS GRAPH</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
          Not available yet. The process graph is built from the phase labels, so it
          appears once this session has been labelled — an empty graph would read as a
          participant who did nothing rather than one nobody has annotated.
        </div>
        <a
          href={`/label/${encodeURIComponent(sessionId)}`}
          className="btn btn-ghost small"
          style={{ marginTop: 12, display: "inline-block" }}
        >
          Label this session
        </a>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="card" style={{ fontSize: 12.5, color: "var(--muted)" }}>
        Loading process graph…
      </div>
    );
  }

  const present = new Set(graph.nodes);
  const maxCount = Math.max(1, ...graph.edges.map((e) => e.count));

  // A backtrack is a transition to an earlier canonical stage, or anything
  // touching Recovery. Drawn dashed, so the meaning is carried by shape rather
  // than colour.
  const isBacktrack = (e: Edge) => {
    if (e.from === "Recovery" || e.to === "Recovery") return true;
    const a = LANE.indexOf(e.from as Phase);
    const b = LANE.indexOf(e.to as Phase);
    return a >= 0 && b >= 0 && b < a;
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="mono-label">PROCESS GRAPH</div>
        <button
          type="button"
          className="btn btn-ghost small"
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? "Show diagram" : "Show as table"}
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
        The order phases actually happened in, and where the work doubled back.
        {graph.label_source && (
          <> Built from the <strong>{graph.label_source}</strong> label pass.</>
        )}
      </div>

      {/* Four scalars — stat tiles, not a chart. */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        {[
          ["Transitions", graph.features.n_transitions, "Phase changes over the session"],
          ["Cycles", graph.features.cycle_count, "Loops in the trajectory"],
          ["Phase entropy", graph.features.phase_entropy.toFixed(2), "How evenly time was spread"],
          ["Backtrack ratio", graph.features.backtrack_ratio.toFixed(2), "Share of transitions going backwards"],
        ].map(([label, value, hint]) => (
          <div
            key={String(label)}
            title={String(hint)}
            style={{
              flex: "1 1 130px",
              background: "var(--subtle, #F5F7FB)",
              border: "1px solid var(--border)",
              borderRadius: 9,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: ".12em", color: "var(--faint, #9AA4B4)", marginBottom: 5 }}>
              {String(label).toUpperCase()}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink, #1B2432)" }}>{value}</div>
          </div>
        ))}
      </div>

      {showTable ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <caption style={{ captionSide: "top", textAlign: "left", fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".14em", color: "var(--faint, #9AA4B4)", paddingBottom: 8 }}>
            TRANSITIONS
          </caption>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 9.5 }}>
              <th style={{ padding: "6px 8px" }}>From</th>
              <th style={{ padding: "6px 8px" }}>To</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Count</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Mean duration</th>
              <th style={{ padding: "6px 8px" }}>Direction</th>
            </tr>
          </thead>
          <tbody>
            {graph.edges.map((e, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 8px" }}>{e.from}</td>
                <td style={{ padding: "6px 8px" }}>{e.to}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "var(--mono)" }}>{e.count}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "var(--mono)" }}>
                  {Math.round(e.mean_dur_ms / 1000)}s
                </td>
                <td style={{ padding: "6px 8px", color: isBacktrack(e) ? "var(--amber, #B5760E)" : "var(--muted)" }}>
                  {isBacktrack(e) ? "backtrack" : "forward"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ position: "relative", overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
               aria-label="Directed graph of phase transitions for this session">
            <defs>
              <marker id="pp-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                      markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--muted, #6B7688)" />
              </marker>
            </defs>

            {/* Edges first, so nodes sit above them. */}
            {graph.edges.map((e, i) => {
              const a = positions[e.from];
              const b = positions[e.to];
              if (!a || !b) return null;

              const back = isBacktrack(e);
              // Each direction bows to its own side, so a backtrack-and-return
              // pair reads as two arcs rather than one. Backtracks are dashed —
              // shape, not colour, so it survives greyscale and print.
              const mid = arcControlPoint(a.x, a.y, b.x, b.y);
              const path =
                a.x === b.x && a.y === b.y
                  ? `M ${a.x - 16} ${a.y - R} A 22 22 0 1 1 ${a.x + 16} ${a.y - R}`
                  : `M ${a.x} ${a.y} Q ${mid.x} ${mid.y} ${b.x} ${b.y}`;

              return (
                <path
                  key={i}
                  d={path}
                  fill="none"
                  stroke="var(--muted, #6B7688)"
                  strokeWidth={Math.max(2, (e.count / maxCount) * 5)}
                  strokeDasharray={back ? "6 4" : undefined}
                  opacity={0.72}
                  markerEnd="url(#pp-arrow)"
                  onMouseEnter={() =>
                    setHover({
                      x: mid.x,
                      y: mid.y,
                      text: `${e.from} → ${e.to} · ${e.count}× · ${Math.round(e.mean_dur_ms / 1000)}s mean${back ? " · backtrack" : ""}`,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: "pointer" }}
                >
                  <title>{`${e.from} → ${e.to}, ${e.count} time${e.count === 1 ? "" : "s"}${back ? ", backtrack" : ""}`}</title>
                </path>
              );
            })}

            {/* Nodes. Every one carries its phase name — identity is never
                colour alone. Phases that did not occur are drawn faint so the
                absence is visible rather than silently missing. */}
            {PHASES.map((phase) => {
              const pos = positions[phase];
              const occurred = present.has(phase);
              return (
                <g key={phase} opacity={occurred ? 1 : 0.28}>
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={R}
                    fill={occurred ? PHASE_COLORS[phase] : "transparent"}
                    stroke={occurred ? "var(--panel, #FFF)" : "var(--border, #E3E8F0)"}
                    strokeWidth={2}
                    strokeDasharray={occurred ? undefined : "4 3"}
                  />
                  <text
                    x={pos.x}
                    y={pos.y + (phase === "Recovery" ? R + 17 : -R - 10)}
                    textAnchor="middle"
                    style={{ fontFamily: "var(--mono)", fontSize: 10.5, fill: "var(--ink, #1B2432)" }}
                  >
                    {phase}
                  </text>
                </g>
              );
            })}
          </svg>

          {hover && (
            <div
              style={{
                position: "absolute",
                left: `${(hover.x / W) * 100}%`,
                top: (hover.y / H) * 100 + "%",
                transform: "translate(-50%, -140%)",
                background: "var(--ink, #1B2432)",
                color: "#fff",
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                padding: "6px 9px",
                borderRadius: 6,
                pointerEvents: "none",
                whiteSpace: "nowrap",
              }}
            >
              {hover.text}
            </div>
          )}
        </div>
      )}

      <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--faint, #9AA4B4)", lineHeight: 1.6, marginTop: 10 }}>
        Dashed arcs are backtracks — a return to an earlier phase, or anything through Recovery.
        Thickness is how often the transition happened; each direction bows to its own side, so a
        loop reads as two arcs. Faded circles are phases that never occurred.
      </div>
    </div>
  );
}
