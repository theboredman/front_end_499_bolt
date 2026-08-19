# Phase 0 Response — Spec Amendments & Decisions

**Date:** 2026-08-15
**Responds to:** [audit-phase0.md](audit-phase0.md)
**Amends:** `ProblemProof_Frontend_Spec.md` v1.0 → v1.1, `CLAUDE.md` invariants

The audit found five substantive errors in the spec and two planning errors. All are accepted. Below: adjudication of every finding, the corrected invariant block, spec amendments, and a revised phase order.

**Status:** all amendments in §2–§5 have been applied to `CLAUDE.md` and `ProblemProof_Frontend_Spec.md` (now v1.1). This document is the decision record; the two amended files are authoritative.

---

## 1. Adjudication

| # | Finding | Verdict | Action |
|---|---|---|---|
| 5(a) | Invariant 4 reversed — ticket model, not stored profile | **Spec wrong.** Code is right and its reasoning is better | Replace invariant 4; amend §3 |
| 2.4 | Consent copy claims local-only storage; uploads happen at submit | **Correct, and highest severity** | Fix now, outside any phase |
| 5(d) | Two clocks disagree after pause; gap unrecorded | **Correct. Spec sanctioned pause without addressing it** | Decision in §4 below |
| 5(b) | Release gate empties the org portal phase | **Correct, and reveals a planning error** | Revised phase order, §5 |
| 5(c) | `/cued-recall` absent from spec | **Spec incomplete** | Added to §2 and §5 |
| 5(e) | §12 accurate as requirement, wrong as description; draft writes ~8×/s | **Correct** | Reworded; draft fix pulled forward |
| 3 | No frontend test runner exists | **Spec assumed one** | First commit of Phase 1 |
| 2.2 | ~135 hardcoded hex; six named tokens don't exist | **Spec written as descriptive, is aspirational** | Reworded; token work scheduled |
| 2.3 | IBM Plex, not system stack | **Spec wrong descriptively** | Amended; self-hosting required |
| 4 | `CompletedSession.code` — content in shared store, spec silent | **Genuine gap** | New rule, §3.4 |
| 4 | Webcam track-ended not surfaced | **Invariant 7 gap** | Invariant 7 extended |
| 2.5 | Skip links missing on 3 routes | **Spec wrong descriptively** | Amended |
| 5(f) | `PROBLEM_NAME` in mono | **Correct** | Fix with token work |
| 1 | Phase rail can't be a label source — undocumented property | **Spec incomplete** | Added as invariant 9 |

Two findings pushed back on slightly — see §6.

---

## 2. Corrected `CLAUDE.md` invariant block

Applied. The block now runs to eleven invariants; 4 and 7 are rewritten, 9–11 are new.

```markdown
4. `/exam` is gated by a single-use, short-lived exam ticket in
   `sessionStorage`, consumed via `authorizeExam`. The guard must NEVER consult
   a stored baseline profile.

   A stored profile says the candidate calibrated at some point, in some room,
   with some camera — possibly last month, possibly as someone else. Only a
   ticket minted minutes ago by a run that passed every quality check is a
   claim about the person currently in front of the camera.

   `getExistingBaseline` exists for other purposes and its docstring says so in
   bold. Nothing in the calibration or exam flow may branch on it.
   `backend/tests/test_calibration_ui_contract.py` asserts both halves of this.

7. Capture status is honest, for BOTH streams. If the user stops sharing from
   the browser bar, or the camera track ends mid-session, surface it
   immediately. A non-null stream ref is not proof of a live track — check
   track state, not object existence.

9. The phase rail is not a label source. `phase_marker_clicked` carries
   `marker_index`, never a phase name. Participant self-marking and annotator
   ground truth are separate data, and collapsing them would contaminate the
   labelling protocol. Guarded by
   `backend/tests/test_phase_rail_is_not_a_label.py`.

10. Pause stops the clock, not the recording. Pause spans are recorded as
    first-class `pause_start` / `pause_end` events on the monotonic timebase,
    so the gap in the event log is explicit rather than inferred. `elapsed` is
    a DERIVED display value — `sessionMs()` minus accumulated pause duration —
    never an independent counter. See Frontend Spec §8.1.

11. Consent copy is a factual claim about data handling. Any change to where
    session data goes requires updating the consent text in the same commit.
```

Invariant 2 additionally now carries "This includes during pause — see invariant 10."

---

## 3. Spec amendments

All applied in v1.1.

### 3.1 §2 — route table

`/cued-recall/:sessionId` added. `/employer` (current) and `/org/*` (Phase 4 rename) both listed, so no phase treats `/employer` as absent and rebuilds it.

### 3.2 §3 — route guards

The `RequireCalibration` row and the paragraph beneath it replaced with the ticket model, plus a **Corrected in v1.1** note recording that v1.0 specified `getExistingBaseline` and why that was the pre-2026-08-09 design.

### 3.3 §4 — design tokens

Section reframed as the **target** token set. Added a **Current divergence** block naming the six missing tokens, the ~135 hardcoded hex literals, and the two-different-reds problem. Typography corrected to IBM Plex Sans / Mono with a self-hosting requirement before the verifier ships. `PROBLEM_NAME`-in-mono noted.

### 3.4 §6 — the solution artefact

New rule. The editor buffer is the one place in the system storing full content, so it does not inherit the process record's access rules by default: never in the public credential; candidate always; validating org for the assessment they commissioned; internal ops only under audited support access; excluded from aggregate analytics and the Data Intelligence product entirely. Invariant 5 governs the event log, this rule governs the artefact, and they are not the same object.

### 3.5 §8.1 — pause semantics

New subsection. Written out in §4 below.

### 3.6 §10 — accessibility

Skip-link claim corrected to the six routes that have them and the three that don't. Capture-status live region reclassified as Phase 0.5 work and as a capture-honesty defect (invariant 7) that presents as an accessibility one.

### 3.7 §12 — performance

Reframed as requirements. **Current violations** block added covering the per-keystroke tree re-render, the unvirtualised event stream, and the ~8×/second draft serialisation.

### 3.8 §13 — testing

Records that no frontend runner exists, that the Python text-assertion technique is kept for structural invariants, and that Vitest + Testing Library is the first commit of Phase 1.

---

## 4. Decision: pause semantics

The audit is right that this is the most consequential unflagged issue, and right that the spec sanctioned a control it hadn't thought through.

**Keep the pause control. Record pause spans as events.**

Reasoning for keeping it: sessions run 20–40 minutes and people have bodies. Removing pause doesn't remove interruptions — it removes the *record* of them, and pushes participants into walking away with the clock running, which corrupts every duration-derived metric more badly than an explicit pause does. A system measuring problem-solving process should be able to represent "was interrupted" as a distinct state from "thought for five minutes".

**The fix:**

1. `pause_start` and `pause_end` are logged as events on the monotonic timebase, emitted by the pause handler directly rather than through the detached logger.
2. `elapsed` becomes derived: `sessionMs() - Σ(pause durations)`. It stops being an independent counter, which is what let the two clocks drift apart in the first place. The offset is then reconstructible from the log rather than lost.
3. The manifest records total paused duration and pause count.
4. **Analysis must exclude pause spans from idle and thinking inference.** This is the part that matters beyond bookkeeping — a bathroom break currently reads as deep contemplation, and any Persistence Pattern or Recovery Speed metric computed over a paused stretch is measuring absence. Flag to whoever owns the analysis layer; a frontend-only fix leaves the corruption in place downstream.

**And a consent consequence the audit didn't raise:** the screen recording correctly keeps running during pause, per invariant 2. That means a participant who pauses to deal with something private is still being recorded. They are not currently told this. The pause control must say plainly that pausing stops the clock but not the recording — and that belongs in the same commit as the consent-copy fix, not in a later phase.

---

## 5. Revised phase order

The audit's finding 5(b) exposes a planning error: the org portal was sequenced early without noticing that its data sources are gated behind labels, and that the labelling pipeline — `/cued-recall`, `/label`, inter-rater reliability — is the project's actual critical path. Building a validator dashboard before phase detection is above gate produces a correct interface with nothing to render.

**On what the org portal shows while below gate:** an explicit below-gate state, never an empty one. An empty dashboard tells a pilot organisation the product is broken; a state that says which analyses are not yet released, and why, tells them the gate is working. The gate is a credibility feature and should be visible as one. This needs a small `BelowGateState` component and a decision surface in the API response, not just a frontend string.

| Phase | Scope | Change |
|---|---|---|
| **0.5 — Corrections** | Consent copy fix; pause-span events + derived `elapsed`; draft-write debounce; webcam track-ended status; skip links on the three missing routes; capture-status live region | **New.** Pulled forward from 2, 6, and "not scheduled" |
| **1 — Foundations** | Vitest runner *(first commit)*; storage migration off `localStorage`; auth surfaces and guards | Test runner added |
| **2 — Consent & identity** | `ConsentNotice` (versioned, separate event); `IdentityCheck`; `LivenessIndicator` | `ProcessProfileView` moved out |
| **3 — Labelling pipeline** | `/cued-recall` and `/label` hardening; annotator throughput; inter-rater reliability surfacing | **New, moved up.** This is the critical path |
| **4 — Org portal** | Queue, validator dashboard, `ReviewPanel`, `DisputeFlow`, `BelowGateState`, `ProcessProfileView` | Was Phase 3 |
| **5 — Credentials & verifier** | `CredentialCard`, `ShareControl`, public verifier bundle, `DataControls` | Was Phase 4 |
| **6 — Internal admin** | Separate bundle, separate auth | Was Phase 5 |
| **7 — Hardening** | Token consolidation, exam render performance, event virtualisation, full a11y pass | Was Phase 6, reduced |

Phase 0.5 is a single session's work and everything downstream is cleaner for it.

---

## 6. Two mild pushbacks

**On 2.3 (fonts).** The audit describes IBM Plex as "a deliberate-looking choice that reads better than the spec's". Agreed — keep it. But the self-hosting requirement isn't only about CSP: the public verifier is read by people deciding whether to trust a stranger's credential, and a third-party request in that page's waterfall is a dependency on Google being reachable for a trust artefact. Worth treating as a correctness requirement rather than a performance nicety.

**On 4 (webcam track-ended).** The audit files this as a near-miss on invariant 7 rather than a breach. It is a breach. The screen and webcam streams are both evidence; a stale "Capturing video + audio" label is exactly the silent-degradation failure invariant 7 exists to prevent, and the fact that it's the camera rather than the screen doesn't change what the participant is being told. Hence invariant 7's rewording to cover both streams explicitly.

---

## 7. What the spec got wrong, and why it's worth noting

Three of the five spec errors share a cause: the spec was written from reading the code rather than running it, and in each case intent was reconstructed from a name.

- `getExistingBaseline` existing led to the assumption that it gated the exam. Its docstring says the opposite, in bold.
- `elapsed` and `sessionMs()` both looked like clocks, so they were assumed to be the same clock.
- §12 and §10 were written in the present indicative about behaviour that had not been verified, which turned requirements into false descriptions.

The practical rule for the remaining phases: **the spec is a target document, and any sentence in it written in the present tense about current behaviour should be treated as a claim to verify, not a fact.** The v1.1 amendments reword the worst offenders. There may be more.
