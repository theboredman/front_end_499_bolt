# ProblemProof — Frontend Specification

**Version:** 1.1 (amended 2026-08-15 per `docs/audit-phase0.md` and the Phase 0 Response)

> **Reading note.** This is a target document. Any sentence written in the present indicative about
> current behaviour is a claim to verify, not a fact — v1.0 contained five such sentences that were
> false, three of them because intent was reconstructed from a function name rather than from running
> the code. Sections corrected in v1.1 are marked **Current divergence**. There may be more.

**Scope:** The complete client-side system across all three portals plus the public credential verifier — architecture, design system, screen-by-screen specification, capture layer, state model, and the gap between what exists today and what ships.
**Companion documents:** Full System Document (Layers 1–5), User Role Plan (visibility matrix), Identity & Access Specification (auth, RBAC), Research Plan (§2–4, capture constraints).

---

## Part I — Architecture

### 1. Stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | React 18 + TypeScript | Already in place; the capture layer depends on precise lifecycle control that a heavier meta-framework would obscure |
| Routing | React Router (`BrowserRouter`) | Client-side routing without a server-render step, which matters because the exam route must not remount |
| Build | Vite | Fast HMR; the calibration flow is painful to iterate on with slow rebuilds |
| Styling | CSS custom properties + utility classes in a global stylesheet, inline styles for one-off layout | See §4 — the current mixed approach needs consolidating, not replacing |
| State | React Context for cross-route capture state; local component state elsewhere; no global store | Deliberate — see §6 |
| Media | `MediaRecorder`, `getDisplayMedia`, `getUserMedia` — native browser APIs, no wrapper library | Wrappers abstract away exactly the surface-type and track-ended details the evidence model depends on |

**Deliberately not used:** no Redux/Zustand (state is either session-scoped or server-owned), no component library (the interface is unusual enough that fighting a library's assumptions costs more than it saves), no CSS-in-JS runtime (the exam page cannot afford style recalculation during capture).

### 2. Application Shell

```
<ScreenCaptureProvider>          ← above the router, deliberately
  <BrowserRouter>
    <AuthProvider>               ← to be added (see §7)
      <Routes>
        /                        Landing
        /login, /signup          Auth (to be added)
        /onboarding              Onboarding + calibration
        /exam                    Exam  [guarded: RequireCalibration]
        /verify                  Process record
        /candidate               Candidate dashboard
        /employer                Organisation portal — CURRENT path
        /org/*                   Organisation portal — renamed and built out in Phase 4
        /admin/*                 Internal admin (separate bundle — see §7.3)
        /label/:sessionId        Phase labelling (internal)
        /cued-recall/:sessionId  Retrospective cued-recall narration (internal/research)
        /c/:credentialId         Public credential verifier (to be added)
      </Routes>
    </AuthProvider>
  </BrowserRouter>
</ScreenCaptureProvider>
```

**Why `ScreenCaptureProvider` sits above the router.** `getDisplayMedia()` requires a user gesture and cannot be silently re-acquired. If the recorder lived inside the exam page, every navigation would tear it down and re-request permission — producing either a second prompt mid-session or a gap in the recording exactly where a route change occurred. Holding the stream above the router keeps one continuous recording that starts during calibration and runs through into the exam. The exam page therefore has **no start button at all**: by the time the participant arrives, recording is already running.

This is the single most important structural decision in the frontend. Any refactor that moves capture state down into a page breaks the evidence record.

### 3. Route Guards

| Guard | Applies to | Checks |
|---|---|---|
| `RequireCalibration` | `/exam` | A single-use exam ticket in `sessionStorage`, consumed via `authorizeExam` |
| `RequireAuth` | all authenticated routes | Valid session token; redirects to `/login` preserving intended destination |
| `RequireRole` | `/org/*`, `/admin/*`, `/label/*` | Role and, for org routes, tenancy match |

**`RequireCalibration` → `/exam`.** Consumes a single-use exam ticket from `sessionStorage`, minted by a calibration run that passed every quality check, and short-lived. It must never consult a stored baseline profile.

The distinction is the whole point of the guard. A stored profile establishes that *someone* calibrated *sometime*. A fresh ticket establishes that the person currently in front of this camera passed quality checks minutes ago. Only the second is a claim about the sitting about to begin. `sessionStorage` rather than `localStorage` is load-bearing: the ticket must not survive a tab close.

> **Corrected in v1.1.** v1.0 specified a `getExistingBaseline` check. That was the design before 2026-08-09 and was deliberately removed; `getExistingBaseline` survives for direct profile inspection and its docstring says in bold that nothing in the calibration or exam flow may branch on it. `backend/tests/test_calibration_ui_contract.py` asserts the guard calls `authorizeExam` and does *not* mention `getExistingBaseline`.

Role guards fail **closed** and render a neutral not-found rather than "you lack permission for /org/settings" — the latter confirms the route exists and leaks structure.

---

## Part II — Design System

### 4. Tokens

The **target** token set. All values are to live as CSS custom properties on `:root`, and no hex is to be hardcoded outside this table. This is a requirement, not a description of the current stylesheet.

> **Current divergence (2026-08-15).** Six tokens named below do not exist: `--ink`, `--blue`, `--rec`, `--inset`, `--panel`, `--borderStrong`. ~135 hardcoded hex literals remain across eleven `.tsx` files. `Exam.tsx` declares a private 13-colour palette object and accounts for 37 of them. `C.rec` (`#E5484D`) and `--red` (`#D3546B`) are two different reds for one semantic role — the recording indicator. Consolidation is scheduled in Phase 7; until then, new code uses tokens and does not add to the count.

**Colour**

| Token | Value | Use |
|---|---|---|
| `--teal` | `#0E9C8E` | Primary action, capture-active, confirmed states |
| `--ink` / `--text` | `#12161D` | Primary text, dark buttons |
| `--text-body` | mid neutral | Body copy |
| `--muted` | mid grey | Secondary text, table cells |
| `--faint` | light grey | Disabled, inactive, metadata |
| `--amber` | `#C4841A` | Emphasis, warnings that are not errors |
| `--red` / `--rec` | `#D3546B` | Recording indicator, blocking errors |
| `--green` | success confirmations |
| `--violet` | `#7C5CE0` | Extraction/analysis layer accent |
| `--blue` | `#34A0D3` | Calibration layer accent |
| `--surface`, `--inset`, `--panel`, `--border`, `--borderStrong` | neutrals | Structure |
| `--teal-tint`, `--teal-border` | tinted teal | Status chips, informational cards |

The five layer accents (teal / violet / amber / blue / red) are not decorative — each maps to one architecture layer (Capture, Extract, Model, Calibrate, Certify) and is used consistently wherever that layer's output is shown. A reader who learns the mapping on the landing page can navigate by colour thereafter.

**Type**

| Role | Family | Use |
|---|---|---|
| Body (`--sans`) | IBM Plex Sans | All prose, labels, controls |
| Mono (`--mono`) | IBM Plex Mono | Timestamps, durations, event types, phase codes, all machine-generated values |

Both are currently loaded from Google Fonts. **Self-host the font files before the public verifier ships.** This is a correctness requirement, not a performance nicety: `/c/:credentialId` is read by people deciding whether to trust a stranger's credential, and a third-party request in that page's waterfall makes a trust artefact depend on Google being reachable. It also complicates the CSP in §14.

The sans/mono split is load-bearing rather than stylistic: **anything the system measured is set in mono, anything a human wrote is set in sans.** A duration, an event type, a session ID, a category token — mono. A narrative sentence from the analysis engine, a reviewer's note, a problem statement — sans. This gives participants a reliable visual cue for what is observation versus what is interpretation, which matters in a product whose entire claim is evidentiary.

> **Current divergence.** `PROBLEM_NAME` renders in mono in the exam header. A problem statement is written by a human, not measured by the system — it should be sans. Fix with the token work.

Scale: 44 (hero) / 26 (page title) / 19 (section) / 16.5 (lead) / 14.5 (body) / 13 (compact) / 12.5 (metadata) / 10.5–9 (mono labels, letter-spaced `.16em`–`.2em`, uppercase).

**Spacing and shape:** 4px base unit. Radius 0 for structural elements (tables, dividers, evidence surfaces), 7–12px for interactive chrome (buttons, chips, panels). The mix is intentional — evidence surfaces read as records, controls read as software.

### 5. Component Inventory

**Existing, keep:**

| Component | Role |
|---|---|
| `Header` | Site chrome with active-route indication |
| `Logo` | Mark |
| `RequireCalibration` | Route guard |
| `CalibrationSession` | The full baseline calibration flow — camera/mic acquisition, task sequence, quality grading, retry loop |
| `ProcessRecord` | Observed-vs-inferred event log with category time breakdown |
| `CognitiveSignalPanel` | Webcam-derived signal display |
| `ProcessGraphPanel` | Solving-trajectory visualisation |
| `CuedRecall` (`/cued-recall/:sessionId`) | The retrospective cued-recall narration protocol (Research Plan §4): playback with cue points derived from the participant's own event log, spoken answers posted to `POST /sessions/{id}/narration`. Omitted from v1.0 entirely. It is the labelling protocol on which six other features are blocked — do not refactor it away |

**To build:**

| Component | Role | Used by |
|---|---|---|
| `AuthShell`, `LoginForm`, `MFAChallenge` | Authentication surfaces | All portals |
| `ConsentNotice` | Versioned, separately-recorded capture consent — not bundled into ToS | Onboarding |
| `IdentityCheck` | L2/L3 session-start verification, assurance-level aware | Onboarding, Exam entry |
| `LivenessIndicator` | Ambient continuous-verification status during session | Exam |
| `ProcessProfileView` | The Layer 3 multi-dimensional report with evidence links | Candidate, Reviewer |
| `EvidenceClip` | Timestamped clip player bound to a specific profile claim | Reviewer |
| `DimensionScore` | One profile dimension with score, narrative, and evidence trail | `ProcessProfileView` |
| `ReviewPanel` | Confirm / adjust / dispute controls with severity preview | Reviewer |
| `DisputeFlow` | Minor / Moderate / Major branching, per the resolution protocol | Reviewer |
| `CredentialCard` | Issued credential with freshness indicator and share control | Candidate, public verifier |
| `ShareControl` | Mints scoped, expiring share links | Candidate |
| `DataControls` | Export, erasure request, retention window adjustment | Candidate |
| `SeatManager`, `BillingPanel`, `SSOConfig` | Org account administration | Org Admin |
| `ProblemPicker` | Problem library selection by track and tier | Org |
| `AnomalyTimeline` | Continuity flags surfaced for human review | Reviewer |
| `BelowGateState` | Names which analyses are not yet released and why — see §7.2 | Org portal |
| `EmptyState`, `ErrorState`, `LoadingState` | Standardised — currently ad hoc | Everywhere |

### 6. State Model

Three tiers, and the boundaries between them are not negotiable:

1. **Capture state** — `ScreenCaptureProvider` context. Lives above the router because it must survive navigation. Holds stream refs, recorder, chunk buffer, status, start timestamp. Never serialised, never persisted.
2. **Session state** — component-local within the exam, flushed to the backend on submit. Event log, elapsed time, editor contents, phase markers.
3. **Server state** — everything else. Sessions, profiles, credentials, org data. Fetched per view, not mirrored into a client store.

**The current prototype persists sessions to `localStorage`, and that must not ship.** It was correct for a device-local prototype and is wrong for a multi-tenant product: it makes the employer view show sessions submitted on the same browser, which is a demo convenience, not a data model. Migration path is in §9.

**Draft resilience.** The exam keeps a local draft so a crash or accidental navigation does not lose work, and the candidate dashboard surfaces a "session in progress — resume" affordance. This stays, but the draft is work-in-progress only; it is never the record of truth.

**The participant's solution is content, and is scoped separately from the process record.**

v1.0 was silent on `CompletedSession.code`. It should not have been. The editor buffer is legitimately part of the record — an organisation validating a process credential may need to see what was produced. But it is the one place in the system where full content is stored, so it does not inherit the process record's access rules by default.

Rules: it is never in the public credential; it is visible to the candidate always, to the validating organisation for the assessment they commissioned, and to internal ops only under support access with an audit record. It is excluded from aggregate analytics and from the Data Intelligence product entirely.

Invariant 5 governs the *event log*; this rule governs the *artefact*. They are not the same object and must not be reasoned about together.

---

## Part III — Portals, Screen by Screen

### 7.1 Candidate Portal

**`/` Landing.** Hero states the thesis: in the AI era the one skill that cannot be automated is thinking through a problem. Below it, the five-layer architecture as a numbered sequence — numbering is justified here because the layers genuinely are ordered and data flows through them in order. Then the three privacy commitments (on-device processing, personal baseline, selective retention), stated plainly because they are the product's main objection-handler. Dual CTA: start a session / employer view.

**`/signup`, `/login`.** Email + password or OAuth. B2B candidates arrive via magic link carrying `org_id` + `assessment_id`; the form recognises this and shows which organisation invited them, because a candidate should never be uncertain who will receive their data.

**`/account` — identity and skill profile.** *(Skill section added 2026-08-19 — v1.1 of this spec did not describe the personalisation layer at all; the report did. Merged into `/account` the same day, superseding the standalone `/profile` route this section originally described.)*

Two sections, and they answer the same underlying question — "who am I to this system" — which is why they live on one page rather than two. The upper section is identity: display name, pronouns, time zone, biometric enrolment. All optional; the account works with none of it filled in.

The lower section, **Skills**, is the CV-derived skill profile. CV upload, then a **node-link visualisation of the whole graph** *(2026-08-20)*, then two clearly separated regions: **Suggestions to review** and **Your approved skills**. Nothing crosses between the last two except a click that says Approve. No checkbox is pre-ticked, there is no "approve all", and closing the page approves nothing.

The diagram is personalised — it is built from this candidate's own graph and nobody else's — and appears as soon as their CV has been analysed, which for most candidates is before they have approved anything at all. It has to carry the extracted/approved distinction for that reason: a diagram that drew every extracted node the same way, the moment a CV was parsed and before anyone reviewed it, would visually claim the whole thing as confirmed. Nodes are grouped in columns by type; approved nodes are solid, suggested ones are hollow and dashed — shape, not colour alone, since colour here identifies node type (a six-hue palette already validated for the phase-transition graph, reused) and the approval boundary has to survive a colourblind or greyscale reading regardless of hue. The list immediately below carries the same nodes with no colour or shape to read, and the panel names it as the fallback rather than assuming the diagram is legible to everyone.

That separation is not a courtesy. An assessment is built only from the approved set, so a suggestion that drifted into it would put somebody in front of a question about a skill they never claimed — while looking exactly like a personalised question, because it *is* derived from their CV. It is also RQ5's entire metric: a UI where approval was the default would set that measurement to 1.0 by construction.

Per the type rule, the parser's provenance and confidence render in mono (things the system measured about its own reading) and the skill labels in sans (they came out of the candidate's own document). The confidence is labelled **prior**, not confidence, because it is a stated constant per extraction route and calling it a confidence would imply a fitted probability.

**A third, optional signal shows when a suggestion's spelling was corrected by the LLM cleanup tier** *(2026-08-20)*: a labelled line under the correction, "spelling-corrected from '…'", naming exactly what it replaced. Not a claim to hide — the tier is off by default, sends only the isolated phrase itself (never the CV, a name, an employer, or a date), and every correction shown has already passed a similarity guard server-side. The point of surfacing the original alongside the correction is the same reason `extracted_label` is kept on an approved node's edit history: a correction a reviewer cannot see the source of is not one they can judge, and this is the one field in the whole Skills section that involved a third party.

`/profile` redirects here rather than 404ing, for anyone who bookmarked it while the two were separate. The header's avatar link is the only nav entry pointing at this page — a second "My profile" link was removed at the same time, since it duplicated the destination under a different name.

**`/assessment` — assessment setup.** Skill selection from the approved graph, then family, difficulty tier, question type, duration and tool policy. The vocabulary is fetched from `GET /assessment/families`, never declared in the frontend — a client with its own copy of the tier list drifts the first time one is added, and the drift surfaces as a participant choosing a tier the server then refuses.

The generated question and its rubric are shown before the sitting starts, along with which generator produced it. A participant reading a template-generated question is entitled to know that is what it is, and the registry entry for that feature says the same thing; the two must not disagree.

This route generates the question and **`/exam` only reads it**. The exam page has no controls by design (invariant 2), and generating a question is a multi-step choice; doing it there would mean adding a control to the one screen that must not have any.

**`/onboarding` — four steps, left rail with step accents.**

1. *What gets recorded.* The consent surface. Explicit about screen, webcam, microphone, and the event log — and equally explicit about exclusions: never keystroke contents, never clipboard contents, never full URLs, never file contents. This is recorded as its own consent event with a version, separate from ToS acceptance.
2. *Camera check.* Blocking. The webcam is required — the process record depends on tying the session to a present person. Failure state names the fix ("grant camera access in your browser's site permissions and reload"), never just reports the failure.
3. *Baseline calibration.* `CalibrationSession`. Microphone check plus three short tasks establishing natural resting pace and expressiveness. Every check is graded on capture quality and repeated until it passes — a badly-captured baseline is worse than none, because it silently distorts every subsequent score. **Screen recording starts here**, from the click that advanced the step, since it needs a user gesture and must be running before the exam mounts.
4. *Ready.* Problem name, estimated duration, capture summary. Then "Begin session →".

**`/exam` — the monitored session.** Full-bleed, chrome-minimal. The problem panel renders the question prepared at `/assessment` when there is one, and the standard problem otherwise — labelled, in mono, as the default rather than theirs. A generic problem rendered as though it were personalised would misdescribe the record the session produces. Top bar carries: problem name, recording indicator (REC dot, live), elapsed clock in mono, pause control, and exit (confirm-gated — leaving mid-session is consequential and must not be one click).

The pause control carries its own semantics — see §8.1. In particular it must state that pausing stops the clock but **not** the screen recording, since a participant who pauses to deal with something private is still being recorded.

Body: the working surface (editor / task area) as primary, with a right rail showing the live event stream and current inferred state (Thinking / Typing / Paused). Showing participants their own event stream in real time is a deliberate transparency choice — it makes the capture legible rather than surveillant, and it costs nothing in signal quality because the events shown are the same ones that would be recorded regardless.

Screen-share status is always visible and honest: `RECORDING · ENTIRE SCREEN`, `WRONG SHARE TYPE`, `STOPPED`. If the participant stops sharing from the browser's own bar, that is surfaced immediately — not silently left showing "recording" — with plain text that the rest of the session is not being recorded.

Phase marking is **self-paced and retrospective-friendly**, never a real-time demand that changes the behaviour being measured.

**`/verify?id=` — process record.** Status chip, problem, submission time. Four headline stats in mono (duration, keystrokes, phases marked, events logged). Then `ProcessRecord` (category time breakdown, observed-vs-inferred event log), `CognitiveSignalPanel`, `ProcessGraphPanel`, and — once Layer 3 lands — `ProcessProfileView` with the narrative and evidence trail.

The observed/inferred distinction must remain visible. An inferred AI-tool accept is a reconstruction with a measured error rate; rendering it identically to an observed event overstates what the system knows. Provenance is shown per event, not buried in a footnote.

**`/candidate` — dashboard.** Session history table, aggregate stats, resume-draft banner, credential list with freshness indicators, and `DataControls`. Recertification prompts appear here at the 18-month mark.

**`/c/:credentialId` — public verifier.** No authentication, no navigation chrome, no upsell. Verification result, Process Profile summary, validating organisation and its verification status, issuance timestamp, freshness state. Nothing else. This page is read by people who have never heard of the product and are deciding whether to trust it; every element that is not verification evidence weakens it.

### 7.2 Organisation Portal (`/org/*`)

Currently a single `Employer` page listing local submissions. It becomes a role-aware portal.

**`/org` — queue.** Received submissions with lifecycle status per row (not submitted / awaiting review / in review / validated / released), read from the listing response rather than fetched per row — a forty-row queue must not make forty requests to answer the one question a reviewer opens it to ask.

> **Built 2026-08-19.** Flagged-first sorting is not implemented; continuity anomalies have no producer yet. Two copy corrections shipped with it: the queue claimed evidence packets were "cryptographically sealed", which was true of nothing, and claimed reviewer access was "immutably logged" before any route wrote such a log.

**`/org/review/:sessionId` — validator dashboard.** The core reviewer surface, and the one that carries the most product risk. Layout: profile dimensions in the primary column, each with score, narrative, and inline evidence links; evidence clip player in the secondary column, seeking to the timestamp behind whichever claim is selected.

Controls: confirm, adjust score, dispute. **Dispute severity is computed and previewed before submission** — the reviewer sees "this adjustment is a Minor dispute; your scores will override and a note will be attached to the credential" or "this is a Moderate dispute; a second independent reviewer will be invited". Reviewers should never discover the consequence of their action after taking it.

> **Built 2026-08-19.** The preview is a copy of the rule, not the rule: `problemproof.validation.severity_for` recomputes on every decision, because a client that could name its own severity could file a full dispute as a minor note. `tests/test_validation_lifecycle_contract.py` reads `OrgReview.tsx` to check the thresholds have not drifted apart. The page also carries a lifecycle bar, a revision-request control, and the access-and-decision trail.

Evidence access is logged. The reviewer is told so, on the page. A surveillance product that surveils its reviewers without saying so has an obvious credibility problem.

> **Built 2026-08-19.** `GET /api/sessions/{id}/evidence` is what writes the entry, and the panel calls it from a click rather than on mount — so the log records a reviewer choosing to look, not a page having rendered. Before this route existed the sentence on the page was true of nothing, which is the worse version of the problem this paragraph describes.

**Below-gate rendering.** The release gate (`registry.assert_releasable()`, gate level `pilot`) blocks unvalidated features at the serialisation boundary, and the org portal is definitionally the validating-organisation surface that gate exists to protect. As of 2026-08-15 **zero features sit at `pilot` or above**, so a validator dashboard built today renders nothing — correctly.

The dashboard must therefore show an **explicit below-gate state, never an empty one.** An empty dashboard tells a pilot organisation the product is broken; a state naming which analyses are not yet released, and why, tells them the gate is working. The gate is a credibility feature and should be visible as one. This needs the `BelowGateState` component and a decision surface in the API response — the reason must come from the registry, not be a hardcoded frontend string.

**`/employer` — redirect.** `/org` is canonical. `/employer` and `/employer/review/:sessionId` redirect (the second keeping the session id), rather than mounting the same components a second time: two mounts of one page are two places a guard can be changed and one of them forgotten.

**`/org/settings/*` — Org Admin only.** Seats, billing, problem library selection, SSO/SCIM configuration, reviewer roster. Rendered from the same portal with role-gated navigation; a Reviewer simply does not see these routes exist.

### 7.3 Internal Admin (`/admin/*`)

**Deployed as a separate bundle behind separate authentication.** Not a role branch inside the customer app. If it ships in the same JavaScript bundle, its route definitions and API surface are readable by any customer who opens devtools, and a single guard bug exposes platform-wide tooling.

Surfaces: problem library management with decay flags, platform health (calibration failure rates, capture errors, model version and phase-detection accuracy), dispute queue with second-reviewer assignment, support account lookup, aggregate analytics. Visual polish is explicitly low priority; correctness and auditability are not.

### 7.4 Label Tool (`/label/:sessionId`)

Internal research surface, already built. Screen recording player, timeline with segment tiling, six-phase assignment, annotator selector, save/resume.

Two properties to preserve on any change:

- **Segments always tile the session.** Adding a boundary splits, removing merges — gaps are structurally impossible rather than validated against.
- **Annotators see only their own pass.** Other annotators' boundaries are never loaded. Independence is what makes the inter-rater reliability check meaningful; showing a prior pass would contaminate it.

Keyboard-first: space toggles playback, `B` cuts, `1`–`6` assign a phase to the segment under the playhead. Labelling a 40-minute session is roughly 30 minutes of work, so mouse round-trips per boundary are a real cost.

---

## Part IV — Cross-Cutting Concerns

### 8. Capture Layer Contract

The frontend owns Stream B (screen + in-tab event log) and the browser side of Stream A (webcam signals). Non-negotiable behaviours:

| Requirement | Implementation |
|---|---|
| Whole-screen only | `displaySurface: "monitor"` requested, then **verified** post-acquisition via `track.getSettings()`. Window or tab share is rejected with an explanation. Undefined surface is accepted rather than blocking on a capability check, and the gap is recorded in the manifest so it is visible in analysis |
| One continuous recording | Started in calibration, spans routes, stopped at submit. Never re-requested |
| Crash resilience | 5-second chunks — long enough not to fragment a 40-minute session into thousands of blobs, short enough that a crash costs seconds |
| Honest status | Track `ended` events surface immediately; status never silently remains `recording` |
| Content exclusion | The event logger records timing, frequency, and coarse category. Never the character typed, clipboard contents, file paths or contents, or full window titles and URLs. Titles that must be compared across time are one-way hashed and truncated |
| Unified clock | Every webcam signal and screen event shares a master timestamp — this synchronisation is what makes cross-stream statements possible at all |

Any change to this layer requires re-running the capture contract tests. The backend has tests asserting frontend properties (that `/exam` is guarded, that the guard consumes a fresh ticket rather than reading a stored profile) precisely because these are the invariants that break silently.

### 8.1 Pause semantics

**Keep the pause control. Record pause spans as events.**

Sessions run 20–40 minutes and people have bodies. Removing pause does not remove interruptions — it removes the *record* of them, and pushes participants into walking away with the clock running, which corrupts every duration-derived metric more badly than an explicit pause does. A system measuring problem-solving process must be able to represent "was interrupted" as a state distinct from "thought for five minutes".

v1.0 sanctioned the control without specifying its semantics, and the implementation drifted into running two clocks that disagree: `elapsed` stops on pause, `sessionMs()` does not, and the event logger detaches. After a five-minute pause the two timebases are five minutes apart with the offset recorded nowhere, and the screen recording holds five minutes of footage with no corresponding event log — which silently breaks the unified-clock guarantee above, the one that makes cross-stream statements possible at all.

The contract:

1. **`pause_start` and `pause_end` are logged as events** on the monotonic timebase, emitted by the pause handler directly rather than through the detached logger.
2. **`elapsed` is derived**, not counted: `sessionMs() - Σ(pause durations)`. It ceasing to be an independent counter is what prevents the two clocks drifting apart again; the offset becomes reconstructible from the log rather than lost.
3. **The manifest records** total paused duration and pause count.
4. **Analysis must exclude pause spans from idle and thinking inference.** This is the part that matters beyond bookkeeping: a bathroom break currently reads as deep contemplation, and any Persistence Pattern or Recovery Speed metric computed over a paused stretch is measuring absence. A frontend-only fix leaves the corruption in place downstream — this is a requirement on the analysis layer, not a UI detail.
5. **The participant is told that pausing does not stop the recording.** Per invariant 2 the screen capture correctly keeps running while paused, which means someone who pauses to deal with something private is still being recorded and is not currently told so. The pause control must say this plainly. It ships in the same commit as the consent-copy correction, not a later phase.

### 9. API Layer

Single `apiFetch` wrapper handling base URL, credentials, token refresh, and error normalisation. Endpoints follow `/sessions/{id}/...` with session and candidate IDs validated server-side as untrusted path input.

**Migration off `localStorage`.** Current: `loadSessions()` reads device-local storage, so the employer view shows whatever was submitted in that browser. Target: all session listing, profile retrieval, and credential data comes from the server, tenancy-scoped. The local draft mechanism stays; the local *record* goes. This is a prerequisite for the org portal being meaningful at all, and should land before any external pilot.

### 10. Accessibility

Already present and to be maintained: `tabIndex={-1}` main landmarks, ARIA table semantics on data tables, `aria-current="step"` on the onboarding rail, descriptive `aria-label`s on ambiguous links ("View record for {problem}" rather than "View record"), visible focus rings via `:focus-visible`, and `prefers-reduced-motion` on the recording pulse.

> **Corrected in v1.1.** v1.0 claimed skip links on every page. They are present on Landing, Candidate, Employer, Verify, Onboarding and Exam; **absent** on `/label/:sessionId`, `/cued-recall/:sessionId`, and the `RequireCalibration` refusal page. The refusal page matters most — it is a dead end reached by someone who may already be struggling with the flow.

To add: **live-region announcements for capture status changes.** The only `aria-live` region in the frontend is in `FaceMeshPreview`; a screen-reader user is not currently told when screen sharing stops, and so continues a session that is no longer producing evidence. This is Phase 0.5 work, not Phase 7 — it is a capture-honesty defect (invariant 7) that happens to present as an accessibility one.

Also to add: keyboard-complete review and dispute flows, and colour never as sole carrier of meaning — every status chip pairs colour with text.

The accessibility floor is higher here than in ordinary software. The product's fairness claim is that it does not penalise different thinking styles; shipping an interface that penalises different *bodies* would be a straightforward contradiction.

### 11. Error, Empty, and Failure States

Written in the interface's voice, naming what happened and what to do. No apologies, no vagueness.

| State | Treatment |
|---|---|
| Camera unavailable | Blocking, with the specific browser-permission fix named |
| Wrong share surface | Blocking, explaining *why* whole-screen is required — a tab share would miss the AI tools, docs, and searches that are the actual subject |
| Share stopped mid-session | Immediate, honest: the rest of this session is not recorded |
| Backend unreachable during calibration | Recheck affordance, not a dead end |
| Process record unavailable | States that the session was saved locally, so the participant knows work is not lost |
| No sessions yet | Invitation to act, with the CTA — never a shrug |
| No credential found | Public verifier says the credential could not be verified, without speculating why |

### 12. Performance

The exam page is the constraint. During capture, the browser is encoding video, logging events, and running the editor simultaneously. **These are requirements, not a description of current behaviour.** Rules: no layout thrash in the event stream (virtualise beyond ~200 rows), no per-keystroke React re-render of the editor tree, capture frame rate capped (5 fps ideal / 10 max) and bitrate held at 800 kbps, chunk handling off the critical path. Everything else can be slower; this cannot.

> **Current violations (2026-08-15).** Frame rate and bitrate are correct. The other three are not:
>
> - `onCodeChange` re-renders the full 791-line `Exam` tree on every character, including the event list, both asides, and the `FaceMeshPreview` subtree.
> - The event stream renders unvirtualised.
> - The draft-persist effect depends on `elapsed`, which ticks every 120 ms — so `JSON.stringify` of the entire growing draft runs to `localStorage` roughly **eight times per second**, synchronously on the main thread, for the whole session. A 40-minute session performs ~20,000 serialisations of an object that only grows.
>
> The draft write is the worst of the three and the cheapest to fix: debounce to a 5-second interval matching the chunk cadence, or persist on event-count delta rather than clock tick. It is Phase 0.5 work and does not wait for Phase 7.

### 13. Testing

| Layer | Coverage |
|---|---|
| Unit | Event summarisation, feature derivation, segment tiling, time formatting |
| Contract | Route guards present and correct; capture invariants asserted from the backend test suite |
| Integration | Full session flow — onboarding → calibration → exam → submit → record |
| Capture | Surface rejection, track-ended handling, chunk continuity across navigation |
| Tenancy | A reviewer from Org A cannot reach any Org B resource by ID manipulation |
| Accessibility | Automated axe pass plus manual keyboard walkthrough of the review and dispute flows |

**No frontend test runner currently exists.** v1.0 assumed one. Frontend invariants are asserted today by Python tests that read `.tsx` files as text (`test_calibration_ui_contract.py`, `test_phase_rail_is_not_a_label.py`). That technique has caught real bugs and should be kept for structural invariants — a text assertion that a guard consumes a ticket is genuinely hard to fake, and it survives refactors that a behavioural test would not.

But it cannot express behavioural tests, and the tenancy isolation test required in Phase 1 has nowhere to live. **Add Vitest + Testing Library as the first commit of Phase 1.** Keep the Python contract tests alongside; the two cover different failure modes.

### 14. Build & Deploy

Three bundles: customer app (candidate + org), internal admin, and the public verifier. The verifier is deliberately separate and minimal — it should load fast, work everywhere, and share no code path with authenticated surfaces.

Environments: local → staging (synthetic sessions only, never production capture data) → production. Environment configuration through build-time variables; no secrets in the client. CSP configured to permit media capture while restricting script sources. Source maps uploaded to error tracking but not served publicly.

---

## Part V — Build Sequence

Revised 2026-08-15. v1.0's sequence contained a planning error: it scheduled the org portal early without noticing that its data sources are gated behind labels, and that the labelling pipeline — `/cued-recall`, `/label`, inter-rater reliability — is the project's actual critical path. Building a validator dashboard before phase detection clears the release gate produces a correct interface with nothing to render (see §7.2).

| Phase | Frontend scope | Change from v1.0 |
|---|---|---|
| **0.5 — Corrections** | Consent copy fix; pause-span events + derived `elapsed` (§8.1); draft-write debounce; webcam track-ended status; skip links on the three missing routes; capture-status live region | **New.** Pulled forward from later phases and from "not scheduled" |
| **1 — Foundations** | Vitest runner *(first commit)*; migrate session storage off `localStorage`; auth surfaces and guards | Test runner added |
| **2 — Consent & identity** | `ConsentNotice` (versioned, separately recorded); `IdentityCheck`; `LivenessIndicator` | `ProcessProfileView` moved out |
| **3 — Labelling pipeline** | `/cued-recall` and `/label` hardening; annotator throughput; inter-rater reliability surfacing | **Moved up.** This is the critical path |
| **4 — Org portal** | Queue, validator dashboard, `ReviewPanel`, `DisputeFlow`, `BelowGateState`, `ProcessProfileView` | Was earlier; now downstream of labels |
| **5 — Credentials & verifier** | `CredentialCard`, `ShareControl`, public verifier bundle (self-hosted fonts), `DataControls` | — |
| **6 — Internal admin** | Separate bundle, separate authentication | — |
| **7 — Hardening** | Token consolidation, exam render performance, event virtualisation, full a11y pass | Reduced — its urgent items moved to 0.5 |

Phase 0.5 is a single session's work and everything downstream is cleaner for it.

---

## Open Questions

1. **Editor surface.** The exam currently assumes a code-shaped working area. Non-engineering tracks (Product, Operations, Design, Research) need a different primary surface, and the event log's meaning changes with it — "keystroke rhythm" reads differently in a document than in code. Track-specific exam layouts need designing before those tracks launch.
2. **Real-time transparency vs. observer effect.** Showing participants their own event stream is defensible and probably improves consent quality, but it is an intervention on the thing being measured. Worth testing whether the live rail changes behaviour before treating it as settled.
3. **Reviewer interface bias.** The order in which profile dimensions are presented, and which are shown expanded by default, will shape reviewer judgement. This is a measurable design decision, not a layout preference, and should be tested rather than chosen.

---

*Document owner: ProblemProof frontend. Review cadence: before each release, and on any change to the capture layer.*
