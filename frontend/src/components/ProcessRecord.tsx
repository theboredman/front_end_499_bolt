import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

// The process record: what the capture layer actually observed and inferred,
// shown back to the participant after submission.
//
// Two things are kept visible that a summary would naturally hide:
//
// 1. Provenance. Events are split into what was *observed* (the portal saw it)
//    and what was *inferred* (reconstructed from foreground window and
//    clipboard length). An inferred accept is a claim with an error rate, and
//    presenting it identically to an observed one would overstate what the
//    system knows.
//
// 2. Category granularity. Site activity is shown as `reference`,
//    `documentation`, `ai_tool` — never a URL, a page title or a search query.
//    That is the research plan's line (§2.3: "domain category", never "full
//    URL or page content") and this view is where a participant would notice
//    if it had been crossed.

type LoggedEvent = {
  t_ms: number;
  type: string;
  source?: string;
  attrs?: Record<string, unknown>;
};

const CATEGORY_LABELS: Record<string, string> = {
  ai_tool: "AI tool",
  reference: "Reference",
  documentation: "Documentation",
  qa_forum: "Q&A forum",
  code_hosting: "Code hosting",
  video: "Video",
  entertainment: "Entertainment",
  social: "Social",
  messaging: "Messaging",
  email: "Email",
  uncategorised: "Uncategorised",
};

function fmt(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function ProcessRecord({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<LoggedEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/sessions/${encodeURIComponent(sessionId)}/events`)
      .then((res) => {
        if (!res.ok) throw new Error(`no event log (${res.status})`);
        return res.json();
      })
      .then((data: LoggedEvent[]) => !cancelled && setEvents(data))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "unavailable"));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (error) {
    return (
      <div className="card" style={{ fontSize: 12.5, color: "var(--muted)" }}>
        Process record unavailable — {error}. The session was saved locally.
      </div>
    );
  }
  if (!events) {
    return <div className="card" style={{ fontSize: 12.5, color: "var(--muted)" }}>Loading process record…</div>;
  }

  const siteVisits = events.filter((e) => e.type === "site_visit");
  const categoryTime: Record<string, number> = {};
  siteVisits.forEach((e, i) => {
    const category = String(e.attrs?.category ?? "uncategorised");
    const next = siteVisits[i + 1];
    const until = next ? next.t_ms : e.t_ms + 30_000;
    categoryTime[category] = (categoryTime[category] ?? 0) + (until - e.t_ms);
  });
  const ranked = Object.entries(categoryTime).sort((a, b) => b[1] - a[1]);

  const inferred = events.filter((e) => e.source === "inferred");
  const observed = events.filter((e) => e.source === "portal");
  const searches = events.filter((e) => e.type === "search_activity_detected");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card">
        <div className="mono-label" style={{ marginBottom: 12 }}>WHERE THE TIME WENT</div>
        {ranked.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            No browsing activity recorded. The desktop agent supplies this; it runs separately
            from the exam portal.
          </div>
        )}
        {ranked.map(([category, ms]) => {
          const share = ms / ranked.reduce((sum, [, v]) => sum + v, 0);
          return (
            <div key={category} style={{ marginBottom: 9 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                <span>{CATEGORY_LABELS[category] ?? category}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{fmt(ms)}</span>
              </div>
              <div style={{ height: 5, background: "var(--inset, #F0F3F8)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${share * 100}%`, height: "100%", background: category === "ai_tool" ? "#6D4FD0" : "var(--teal)" }} />
              </div>
            </div>
          );
        })}
        <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--faint, #9AA4B4)", lineHeight: 1.6, marginTop: 12 }}>
          Categories only. No URL, page title or search text was recorded — {searches.length} search
          {searches.length === 1 ? "" : "es"} detected, engine noted, query never read.
        </div>
      </div>

      <div className="card">
        <div className="mono-label" style={{ marginBottom: 12 }}>OBSERVED vs INFERRED</div>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          {[
            ["Observed directly", observed.length, "var(--teal)"],
            ["Reconstructed", inferred.length, "#B5760E"],
          ].map(([label, count, colour]) => (
            <div key={String(label)} style={{ flex: 1, background: "var(--subtle, #F5F7FB)", border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: ".12em", color: "var(--faint, #9AA4B4)", marginBottom: 4 }}>
                {String(label).toUpperCase()}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: String(colour) }}>{count}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
          Reconstructed events — which AI tool was open, and whether a large paste followed it —
          are inferred from your foreground window and clipboard length, not read from the
          recording. They carry a measured accuracy rather than being treated as certain.
        </div>
      </div>

      <div className="card">
        <div className="mono-label" style={{ marginBottom: 12 }}>EVENT LOG · {events.length}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 280, overflowY: "auto" }}>
          {events.slice(0, 200).map((e, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "baseline",
                fontFamily: "var(--mono)",
                fontSize: 10,
                padding: "4px 8px",
                borderRadius: 6,
                background: e.source === "inferred" ? "#FFF8EC" : "transparent",
              }}
            >
              <span style={{ color: "var(--faint, #9AA4B4)", minWidth: 42 }}>{fmt(e.t_ms)}</span>
              <span style={{ color: "var(--ink, #1B2432)", minWidth: 170 }}>{e.type}</span>
              <span style={{ color: "var(--muted)" }}>
                {e.attrs?.category ? String(e.attrs.category) : ""}
                {e.attrs?.tool_id ? String(e.attrs.tool_id) : ""}
                {e.attrs?.char_count ? `${e.attrs.char_count} chars` : ""}
                {e.attrs?.kind ? String(e.attrs.kind) : ""}
              </span>
              {e.source === "inferred" && (
                <span style={{ marginLeft: "auto", color: "#B5760E", fontSize: 9 }}>inferred</span>
              )}
            </div>
          ))}
        </div>
        {events.length > 200 && (
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--faint, #9AA4B4)", marginTop: 8 }}>
            Showing the first 200 of {events.length}.
          </div>
        )}
      </div>
    </div>
  );
}
