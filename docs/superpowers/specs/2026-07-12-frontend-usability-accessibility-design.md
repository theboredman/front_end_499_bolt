# Frontend Usability & Accessibility Hardening — Design

**Date:** 2026-07-12
**Project:** ProblemProof (CSE499) — `frontend/`
**Goal:** Make the existing React frontend more user-friendly, focusing on clarity/guidance, accessibility, and look-and-feel polish. The exam flow (Onboarding → Exam → Verify) is the priority, but every page benefits.

## Context

The frontend is already visually polished: a coherent design system in `src/index.css` (IBM Plex fonts, teal/neutral palette, phased-process theming), good copy, and a thoughtful onboarding flow. The usability problems are not visual — they are **safety, clarity, and accessibility gaps** hiding inside an otherwise-finished shell.

This is a targeted hardening pass (chosen over a full design-system refactor or an accessibility-only pass). No new dependencies, no inline-style → CSS refactor, no mobile/responsive rework.

## Problems being fixed

**Safety / clarity (highest impact, exam-centric):**
- **No confirmation on destructive/final actions.** `Exam.tsx` Reset (`reset()`, ~line 243) instantly wipes the whole session; Submit (`submit()`, ~line 226) instantly ends it and navigates away. A misclick loses everything.
- Icon-only buttons (`❚❚ Pause`, `↺ Reset`, `✕ Exit`, `↗ Submit`) have no tooltips or accessible names.
- The code editor `<textarea>` is unlabelled, and **Tab escapes the editor** instead of indenting — painful in a coding exam. When paused, typing silently does nothing with no explanation.

**Accessibility:**
- No global `:focus-visible` styling — keyboard users cannot see focus.
- Icon-only buttons expose only the glyph to screen readers.
- No `prefers-reduced-motion` handling — REC blink, camera scanline, and row/fade animations always run.
- Phase buttons don't announce state to assistive tech.
- Camera-status changes aren't announced (no live region).
- The hand-built grid "tables" (Candidate, Employer, Verify) lack table semantics.
- Some 8–9px labels using `--faint` (#9aa4b2 on white) fall under WCAG contrast when used as readable text.

**Look & feel:** unify focus rings; keep motion but make it respectful.

## Decisions locked in

- **Proctoring internals stay fully visible** in the exam right rail (API URL input, raw `model said` output, crop-mode warnings). No reorganizing or hiding — accessibility + confirmation improvements only around them.
- No toast/notification system — existing visible feedback (event log, phase highlight, screen changes) plus the new confirmations are enough. Avoids UI noise.

## Changes

### 1. Global accessibility layer — `src/index.css`
- `:focus-visible` ring (2px `--teal`, 2px offset) on all interactive elements: `.btn`, `.exam-btn`, `.nav-link`, `.phase-btn`, `a`, `input`, `textarea`. Remove default outline only when a visible replacement is provided.
- `@media (prefers-reduced-motion: reduce)`: neutralize `ppRec`, `ppScan`, `ppRow`, `ppFade`, and interaction transitions (set animation/transition to none or minimal).
- `.sr-only` utility (visually hidden, screen-reader accessible).
- `.skip-link` — visually hidden until focused, then pinned top-left; jumps to `#content`.
- `.pp-modal-overlay` + `.pp-modal` styles for the confirm dialog (centered card, backdrop, subtle entrance that respects reduced-motion).
- Contrast/size floor: where `--faint` is used as *readable* text, switch those usages to `--muted` (passes contrast); keep `--faint` for genuinely decorative/timestamp text. Lift the smallest label sizes to a legible floor (~10px) in shared classes (`.mono-label`, `.table-head`). No palette overhaul.

### 2. `ConfirmDialog` component — `src/components/ConfirmDialog.tsx` (new)
Accessible modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`/`aria-describedby`, Esc cancels, initial focus on the safe (cancel) button, click-backdrop cancels. Props: `title`, `message`, `confirmLabel`, `cancelLabel`, `tone` (neutral/danger), `onConfirm`, `onCancel`. Used in `Exam.tsx` for:
- **Reset:** "This clears your code, timer, and event log. Start over?"
- **Submit:** "Submit and end the session? This can't be changed after."
- **Exit** (logo/back link while session active): "Leave the session? Your progress is autosaved — you can resume anytime."

### 3. Exam header — accessible icon buttons — `src/pages/Exam.tsx`
Add `aria-label` + `title` to Pause/Resume, Reset, Submit, and Exit. Visible glyphs and labels stay. Reset/Submit/Exit route through `ConfirmDialog` instead of firing directly.

### 4. Keyboard-friendly editor — `src/pages/Exam.tsx`
- `aria-label="Solution code editor"` on the `<textarea>`.
- `onKeyDown`: Tab inserts 4 spaces at the caret (and Shift+Tab de-indents the current line) instead of moving focus; preserve caret/selection and keep it counting as activity where appropriate.
- When `disabled` (paused), show a small "Paused — resume to keep typing" hint overlay so the disabled state is explained.

### 5. Semantics & live regions
- Phase buttons (`Exam.tsx`): `aria-pressed`/`aria-current="step"` reflecting active/marked state; ensure the text label conveys state, not color alone.
- Camera-status text becomes an `aria-live="polite"` region in `FaceMeshPreview` (used by Onboarding + Exam) so connect/deny/unsupported transitions are announced.
- Grid "tables" in `Candidate.tsx`, `Employer.tsx`, `Verify.tsx`: add `role="table"` on the container, `role="row"`, `role="columnheader"`, `role="cell"` on the head/rows/cells so screen readers read them as tabular data.

### 6. Cross-page wiring
- `Header.tsx` renders the `.skip-link` before the nav; each page's primary `<main>`/content region gets `id="content"` and `tabIndex={-1}`.
- Onboarding: `aria-current="step"` on the active step in the rail; Exit `✕` gets an `aria-label`.
- Landing / Candidate / Employer / Verify inherit the global focus + reduced-motion + contrast improvements automatically; only the small structural/semantic additions above are page-specific.

## Testing / verification

Manual verification (no automated test harness exists in the repo):
- **Keyboard:** Tab through each page; confirm a visible focus ring on every interactive element and that the skip link appears on first Tab and jumps to content.
- **Editor:** Tab indents / Shift+Tab de-indents; focus stays in the editor; paused state shows the hint and blocks typing.
- **Confirmations:** Reset, Submit, and Exit each open a dialog; Cancel/Esc aborts with no state change; Confirm performs the action.
- **Reduced motion:** with OS "reduce motion" on, the REC dot, scanline, and row animations are static.
- **Screen reader (spot check):** icon buttons announce their names; phase buttons announce state; camera status is announced on change; tables read as rows/columns.
- **Build:** `npm run build` (type-check + build) and `npm run lint` pass.
- **Regression:** every page still renders and the exam flow (onboarding → exam → submit → verify) works end to end.

## Out of scope
- Reorganizing/hiding proctoring internals.
- Inline-style → CSS-class refactor.
- Mobile / responsive redesign.
- New runtime dependencies.
- Backend changes.
