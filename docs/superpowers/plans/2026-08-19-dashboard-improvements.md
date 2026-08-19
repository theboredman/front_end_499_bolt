# Dashboard Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve all four ProblemProof dashboards using only data that already exists — no mock numbers, no fabricated fields, no APIs that don't exist yet.

**Architecture:** Create shared visualization components (StatCard, MiniTrendChart, PhaseBar) as reusable machinery, then enhance each dashboard with features backed by real fields already returned by the server. Anything needing data the system doesn't measure yet is deferred or rendered as an honest empty/below-gate state.

**Tech Stack:** React 18, TypeScript, CSS custom properties

**Spec:** `docs/superpowers/specs/2026-08-19-dashboard-improvements-design.md`

## Global Constraints

- **No mock data.** No hardcoded numbers, no fabricated percentages, no invented
  trend arrays. If a feature needs data the system doesn't produce yet, it renders
  an empty state or is omitted entirely. This is the project's core principle:
  "The evidence record is the product. Code that weakens it is a bug even if it
  passes tests."
- Use existing CSS classes from `index.css`: `metric-card`, `metric-value`,
  `metric-label`, `metric-sub`, `card`, `table`, `btn`, `btn-ghost`, `btn-primary`
- Use existing CSS tokens: `--surface`, `--border`, `--text`, `--muted`, `--faint`,
  `--accent`, `--teal` (= --color-cognition-blue), `--color-flag-ink`,
  `--color-coral-ink`, `--color-mint-ink`. Do NOT use non-existent tokens like
  `--color-indigo`, `--color-teal`, `--color-amber`.
- Mono font (`var(--mono)`) for anything the system MEASURED. Sans (`var(--sans)`)
  for labels and human-written text.
- No `git commit` steps — the user has asked us not to commit.
- Accessibility: skip links, keyboard nav, `role="img"` with `aria-label` on
  visualizations, text alternatives for charts.

---

## Task 1: Create StatCard Component

**Files:**
- Create: `frontend/src/components/StatCard.tsx`

**Interfaces:**
- Consumes: `label: string`, `value: ReactNode`, `note?: string`, `alarm?: boolean`
- Produces: `<StatCard label="..." value={...} note="..." />`

**Note on trends:** The original spec called for a `trend` prop with a percentage.
Trends require a comparison baseline the system doesn't compute yet (no
period-over-period endpoint). Removed to avoid fabricating percentages. The
prop can be added later when real trend data exists.

- [ ] **Step 1: Create StatCard.tsx**

```tsx
import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  note?: string;
  alarm?: boolean;
}

export default function StatCard({ label, value, note, alarm }: StatCardProps) {
  return (
    <div
      className="metric-card"
      style={alarm ? { borderColor: "var(--color-flag-ink)" } : undefined}
    >
      <div className="metric-label">{label}</div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: alarm ? "var(--color-flag-ink)" : "var(--text)",
          fontFamily: "var(--mono)",
          lineHeight: 1.15,
        }}
      >
        {value}
      </div>
      {note && <div className="metric-sub">{note}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors

---

## Task 2: Create MiniTrendChart Component

**Files:**
- Create: `frontend/src/components/MiniTrendChart.tsx`

**Interfaces:**
- Consumes: `data: number[]` (real values only), `height?: number`, `color?: string`
- Produces: `<MiniTrendChart data={realDurations} />`

- [ ] **Step 1: Create MiniTrendChart.tsx**

```tsx
interface MiniTrendChartProps {
  data: number[];
  height?: number;
  color?: string;
}

/** SVG sparkline. Renders null when fewer than 2 data points — a single
 *  value is not a trend, and showing a flat line for one session would
 *  imply a direction that doesn't exist. */
export default function MiniTrendChart({
  data,
  height = 32,
  color = "var(--teal)",
}: MiniTrendChartProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const width = 80;
  const padding = 2;

  const points = data
    .map((val, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((val - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors

---

## Task 3: Create PhaseBar Component

**Files:**
- Create: `frontend/src/components/PhaseBar.tsx`

**Interfaces:**
- Consumes: `phases: { name: string; value: number; color: string }[]`
- Produces: `<PhaseBar phases={...} />`

**Important:** PhaseBar is built as reusable machinery. It is NOT wired into any
dashboard in this plan because no real phase data exists — labels are a blocked
feature (FEATURES.md: 0 labels, status `spec`/`synthetic`). Wiring it with
fabricated percentages would violate the project's evidence rules. When the
label endpoint ships real data, this component is ready to render it.

- [ ] **Step 1: Create PhaseBar.tsx**

```tsx
interface PhaseData {
  name: string;
  value: number;
  color: string;
}

interface PhaseBarProps {
  phases: PhaseData[];
}

/** Horizontal stacked bar showing phase distribution. Each segment is
 *  proportional to its value. Empty when there is no data — callers should
 *  check before rendering, or let the zero-total case render as a bare
 *  track, which is honest about the absence. */
export default function PhaseBar({ phases }: PhaseBarProps) {
  const total = phases.reduce((sum, p) => sum + p.value, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex",
          height: 12,
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--border)",
        }}
        role="img"
        aria-label={`Phase distribution${total > 0 ? "" : " — no data yet"}`}
      >
        {phases.map((phase, i) => {
          const pct = total > 0 ? (phase.value / total) * 100 : 0;
          return pct > 0 ? (
            <div
              key={i}
              style={{ width: `${pct}%`, background: phase.color }}
              title={`${phase.name}: ${pct.toFixed(1)}%`}
            />
          ) : null;
        })}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 16px",
          fontSize: 11,
        }}
      >
        {phases.map((phase, i) => {
          const pct = total > 0 ? (phase.value / total) * 100 : 0;
          return pct > 0 ? (
            <span
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 4 }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: phase.color,
                }}
              />
              <span style={{ color: "var(--muted)" }}>{phase.name}</span>
              <span style={{ fontFamily: "var(--mono)", color: "var(--faint)" }}>
                {pct.toFixed(0)}%
              </span>
            </span>
          ) : null;
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors

---

## Task 4: Enhance Candidate Dashboard with Real Duration Trend

**Files:**
- Modify: `frontend/src/pages/Candidate.tsx`

**What's real:** `SessionSummary[]` already loads with `duration_ms` on each
row. A sparkline of per-session durations is a real visualization of real data.
No trend percentage (no baseline to compare against). No phase breakdown (no
labels exist). No credential link (no list endpoint).

**Interfaces:**
- Consumes: `SessionSummary[]` from `sessions.ts`, `MiniTrendChart`, `StatCard`
- `SessionSummary` type (from `sessions.ts:26-46`):
  ```ts
  type SessionSummary = {
    session_id: string;
    submitted_at: number | null;
    duration_ms: number | null;
    paused_ms: number | null;
    unknown_ms: number | null;
    problem: string | null;
    assurance_level: string | null;
    org_id: string | null;
    has_screen: boolean;
    has_events: boolean;
    has_signals: boolean;
    validation_state: string | null;
  };
  ```

- [ ] **Step 1: Read current Candidate.tsx**

Read: `frontend/src/pages/Candidate.tsx`
Understand the existing metric-grid (around line 60-90) and the imports at top.

- [ ] **Step 2: Add imports at the top**

Add after existing imports (line 6):

```tsx
import StatCard from "../components/StatCard";
import MiniTrendChart from "../components/MiniTrendChart";
```

- [ ] **Step 3: Add duration trend data derivation**

After the `filteredSessions` computation (around line 30-34), add:

```tsx
// Real per-session durations in seconds, oldest first, for the sparkline.
// Only sessions with a real duration_ms contribute; nulls are omitted
// rather than treated as zero (a zero would flatten the trend falsely).
const durationTrend = (sessions ?? [])
  .filter((s) => s.duration_ms != null && s.duration_ms > 0)
  .map((s) => s.duration_ms! / 1000)
  .reverse(); // oldest first for left-to-right reading
```

- [ ] **Step 4: Add a stat card with sparkline to the metric-grid**

Find the metric-grid section (around line 60-90). Add alongside existing metric
cards — use StatCard for the average, and add a new card with the sparkline:

```tsx
<StatCard
  label="Avg Duration"
  value={avgSec > 0 ? fmtClock(avgSec) : "—"}
  note="Across all sessions"
/>
<div className="metric-card">
  <div className="metric-label">Duration Trend</div>
  <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 32 }}>
    <MiniTrendChart data={durationTrend} />
    {durationTrend.length < 2 && (
      <span style={{ fontSize: 12, color: "var(--faint)" }}>
        {durationTrend.length === 1
          ? "Need 2+ sessions for a trend"
          : "No sessions yet"}
      </span>
    )}
  </div>
  {durationTrend.length >= 2 && (
    <div className="metric-sub">Last {durationTrend.length} sessions</div>
  )}
</div>
```

- [ ] **Step 5: Verify it compiles and renders**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors

Manually check: the Candidate page should show the metric cards, and if there
are 2+ sessions with real durations, a sparkline appears. If fewer, the honest
"Need 2+ sessions" text shows instead.

---

## Task 5: Enhance Org Queue with Sorting

**Files:**
- Modify: `frontend/src/pages/OrgQueue.tsx`

**What's real:** `SessionSummary[]` already loads with `submitted_at`,
`duration_ms`, and `assurance_level`. Sorting by these real fields is a pure
client-side operation — no new API needed. No identity-warning severity (field
doesn't exist on the summary). No queue-time metrics (no endpoint). No bulk
actions (no batch endpoint).

**Interfaces:**
- Consumes: `SessionSummary[]`, existing `levelFilter` state, existing `query` state
- `COLS` is currently `"1.1fr 0.9fr 0.85fr 0.7fr 0.7fr 0.9fr 0.8fr"` (line 9) —
  may need adjustment if a sort header is added, but sorting via a dropdown
  avoids adding a column.

- [ ] **Step 1: Read current OrgQueue.tsx**

Read: `frontend/src/pages/OrgQueue.tsx`
Understand the filter-bar (around line 119), the `filtered` computation (around
line 39-50), and the table rendering (around line 160+).

- [ ] **Step 2: Add sort state**

After `const [levelFilter, setLevelFilter] = useState<string>("all");` (around
line 34), add:

```tsx
const [sortBy, setSortBy] = useState<"date" | "duration" | "assurance">("date");
```

- [ ] **Step 3: Add sorting to the filtered results**

After the `filtered` computation (around line 39-50), sort the filtered list.
Rename the existing `filtered` to `filteredUnsorted` and add:

```tsx
const sorted = [...filteredUnsorted].sort((a, b) => {
  if (sortBy === "date") {
    return (b.submitted_at ?? 0) - (a.submitted_at ?? 0);
  }
  if (sortBy === "duration") {
    return (b.duration_ms ?? 0) - (a.duration_ms ?? 0);
  }
  // assurance: alphabetical, nulls last
  return (a.assurance_level ?? "zzz").localeCompare(
    b.assurance_level ?? "zzz"
  );
});
```

Then update the table to render `sorted` instead of `filtered`.

- [ ] **Step 4: Add sort dropdown to the filter bar**

Find the filter-bar section (around line 119). After the existing level-filter
select, add:

```tsx
<select
  className="search-input"
  value={sortBy}
  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
  style={{ minWidth: 140 }}
  aria-label="Sort sessions"
>
  <option value="date">Sort: Date (newest)</option>
  <option value="duration">Sort: Duration (longest)</option>
  <option value="assurance">Sort: Assurance level</option>
</select>
```

- [ ] **Step 5: Verify it compiles and renders**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors

Manually check: the Org Queue page should show the sort dropdown, and changing
it should reorder the table rows by the selected field.

---

## Task 6: Enhance Admin Dashboard with Real-Derived Alerts

**Files:**
- Modify: `frontend/src/admin/AdminApp.tsx`

**What's real:** The admin overview already fetches real counts: orgs, users,
sessions (total / analysable / labelled). Alerts derived from these real counts
are honest. A trend chart of sessions over time would need a time-series
endpoint that doesn't exist — omitted. Export buttons need backend support —
omitted. Quick actions (disable org, promote user) need endpoints that may or
may not exist — check before wiring; if they don't exist, omit.

**Interfaces:**
- Consumes: existing `Overview` type and `fetchOverview` function in AdminApp.tsx
- Need to read AdminApp.tsx to find the exact `Overview` shape and overview tab
  rendering location.

- [ ] **Step 1: Read AdminApp.tsx**

Read: `frontend/src/admin/AdminApp.tsx`
Find: the `Overview` type, the overview tab rendering (where metric cards are
shown), and what real counts are available.

- [ ] **Step 2: Add AlertsPanel function**

After the existing OverviewTab function (or nearby), add a function that derives
alerts from real overview data:

```tsx
function AlertsPanel({ overview }: { overview: Overview | null }) {
  if (!overview) return null;

  const alerts: { level: "error" | "warning"; msg: string }[] = [];

  if (overview.orgs === 0) {
    alerts.push({ level: "error", msg: "No organisations on the platform." });
  }
  if (overview.sessions?. analysable === 0) {
    alerts.push({
      level: "warning",
      msg: "No analysable sessions — analysis pipeline has no input.",
    });
  }
  // Add more real-derived alerts as the overview shape allows.

  if (alerts.length === 0) return null;

  return (
    <div
      className="card"
      style={{ borderColor: "var(--color-flag-ink)", marginBottom: 24 }}
    >
      <div className="mono-label" style={{ marginBottom: 10 }}>
        Alerts
      </div>
      {alerts.map((a, i) => (
        <div
          key={i}
          style={{
            fontSize: 13,
            color: a.level === "error" ? "var(--color-flag-ink)" : "var(--color-coral-ink)",
            marginBottom: 4,
          }}
        >
          {a.level === "error" ? "●" : "○"} {a.msg}
        </div>
      ))}
    </div>
  );
}
```

**Note:** The exact field names (`overview.orgs`, `overview.sessions.analysable`)
must be verified against the real `Overview` type in AdminApp.tsx. Adjust the
property access to match what actually exists.

- [ ] **Step 3: Render AlertsPanel in the overview tab**

In the overview tab rendering, after the metric cards, add:

```tsx
<AlertsPanel overview={overview} />
```

- [ ] **Step 4: Import MiniTrendChart (only if a real time-series exists)**

Check whether the admin overview or any admin endpoint returns time-series data
(sessions per day, etc). If yes, add a trend card using `MiniTrendChart` with
that real data. If no such data exists, skip this step entirely — do not
fabricate a trend array.

- [ ] **Step 5: Verify it compiles and renders**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors

Manually check: the Admin overview should show an alerts panel when real counts
indicate problems (e.g., 0 orgs, 0 analysable sessions). When counts are healthy,
the panel is absent — not shown as an empty box.

---

## Task 7: Verify No Mock Data Leaked Through

- [ ] **Step 1: Grep for hardcoded numbers in new/modified files**

Run: `cd frontend && grep -rn "[0-9]" src/components/StatCard.tsx src/components/MiniTrendChart.tsx src/components/PhaseBar.tsx`
Expected: only structural numbers (font sizes, padding, SVG coordinates) — no
data values like `25`, `40`, `2.3`, `5`, `[12, 19, ...]`.

- [ ] **Step 2: Grep for non-existent CSS tokens**

Run: `cd frontend && grep -rn "color-indigo\|color-teal\|color-amber" src/components/ src/pages/Candidate.tsx src/pages/OrgQueue.tsx src/admin/AdminApp.tsx`
Expected: no matches.

- [ ] **Step 3: Check no fake fields are referenced**

Run: `cd frontend && grep -rn "identity_warning\|queue_time\|avg_time_in_queue" src/pages/OrgQueue.tsx`
Expected: no matches.

- [ ] **Step 4: Run full type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Run existing tests**

Run: `cd backend && python -m pytest tests/ -x -q`
Expected: all existing tests still pass (backend tests assert frontend properties
too — these are invariant checks).

---

## Deferred Work (needs real data or backend endpoints)

These items from the original spec are NOT built in this plan. They are listed
here so the work is not forgotten when the dependencies arrive:

| Feature | Blocked by | When to revisit |
|---|---|---|
| Phase distribution bars on Candidate | Labels feature (0 labels, blocked) | When label endpoint ships real phase data |
| Credential history on Account | No `GET /api/credentials` list endpoint | When credential listing API exists |
| Settings panel on Account | No settings API | When settings endpoints are built |
| Queue-time metrics on Org Queue | No queue-age computation endpoint | When queue stats endpoint exists |
| Identity-warning severity on Org Queue | No `identity_warning` field on SessionSummary | When field is wired through from backend |
| Bulk actions on Org Queue | No batch endpoint | When batch review API exists |
| Platform trend charts on Admin | No time-series admin endpoint | When admin metrics endpoint returns time series |
| Export buttons on Admin tables | No export endpoints | When export APIs are built |

When each dependency arrives, the shared components (StatCard, MiniTrendChart,
PhaseBar) are already built and ready to render the real data.
