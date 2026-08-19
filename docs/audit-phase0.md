# Phase 0 — Frontend audit against `ProblemProof_Frontend_Spec.md`

**Date:** 2026-08-15
**Scope:** `frontend/src` (33 files, ~6,900 lines) against the Frontend Spec v1.0, cross-read with `docs/SYSTEM.md`, `docs/BACKEND.md`, `docs/DATAFLOW.md`, `docs/FEATURES.md` as current-state.
**Code changes this session:** none.
**Adjudicated by:** [audit-phase0-response.md](audit-phase0-response.md) — all findings accepted; spec amended to v1.1 and `CLAUDE.md` invariants rewritten. **The "Recommended order" at the end of this document is superseded by the revised phase order in §5 of the response.**

**Test baseline (before and after — unchanged, nothing was edited):**
`backend/tests` — **596 passed**. Two modules fail at *collection*, pre-existing and environmental:
`test_external_ai_detection.py` and `test_timestamp_contract.py` both import
`extractors/screen/window_tracker.py` → `import win32gui` → `ImportError: DLL load failed`.
This is a broken `pywin32` install on this machine, not a code fault. Everything else, including all
frontend-asserting contract tests, passes.

---

## 1. What exists and matches the spec

The capture layer is the strongest part of the codebase and matches its contract closely.

| Spec | Where | Status |
|---|---|---|
| §2 `ScreenCaptureProvider` above the router | [App.tsx:15-16](../frontend/src/App.tsx#L15-L16) | Exact. Provider wraps `BrowserRouter`. |
| §2 / §8 Recording starts in calibration, no start button on exam | [CalibrationSession.tsx:243](../frontend/src/components/CalibrationSession.tsx#L243) starts it; [Exam.tsx:169-171](../frontend/src/pages/Exam.tsx#L169-L171) only reads status | Exact, and commented as deliberate. |
| §8 Whole-screen requested *and verified*; undefined accepted | [screenCapture.tsx:70-102](../frontend/src/lib/screenCapture.tsx#L70-L102) | Exact, including the `if (surface && surface !== "monitor")` shape that lets undefined through. |
| §8 One continuous recording, never re-requested | [screenCapture.tsx:63](../frontend/src/lib/screenCapture.tsx#L63) — `if (recorderRef.current) return true` | Exact. |
| §8 5-second chunks | `CHUNK_MS = 5_000` | Exact. |
| §12 5 fps ideal / 10 max, 800 kbps | [screenCapture.tsx:73](../frontend/src/lib/screenCapture.tsx#L73), `videoBitsPerSecond: 800_000` | Exact, to the number. |
| §8 Honest status on track `ended` | [screenCapture.tsx:121-124](../frontend/src/lib/screenCapture.tsx#L121-L124) | Exact. Sets `stopped` + names the consequence. |
| §7.1 Status strings `RECORDING · ENTIRE SCREEN` / `WRONG SHARE TYPE` / `STOPPED` | [Exam.tsx:407-414](../frontend/src/pages/Exam.tsx#L407-L414) | Verbatim match. |
| §8 Content exclusion | [eventLogger.ts](../frontend/src/lib/eventLogger.ts) — `char_count`, `char_delta`, `interval_ms`, `idle_duration_ms` only | Holds. Clipboard/selection strings are measured and dropped in-frame; no field carries content. |
| §8 Unified session-relative clock | `sessionMs()`, `t_ms` from `sessionOriginMs` | Holds *for the event log* — but see finding **5(d)**, the exam has a second, conflicting clock. |
| §7.1 Observed vs inferred provenance | [ProcessRecord.tsx:86-168](../frontend/src/components/ProcessRecord.tsx#L86-L168) | Holds. Split counts, per-row tint, explicit `inferred` tag, explanatory copy. |
| §7.4 Segments tile by construction | [labeling.ts:206-256](../frontend/src/lib/labeling.ts#L206-L256) | Holds. State is boundaries; segments are derived, so `n` cuts give exactly `n+1` abutting slots. |
| §7.4 Annotators see only their own pass | [labeling.ts:75-79](../frontend/src/lib/labeling.ts#L75-L79) | Holds, enforced server-side by single-source load. |
| §10 Focus rings, `prefers-reduced-motion`, ARIA tables, `aria-current="step"` | [index.css:492-501](../frontend/src/index.css#L492-L501), [:602-612](../frontend/src/index.css#L602-L612), tables in Candidate/Employer/Verify | Present. `prefers-reduced-motion` does disable the `pp-rec-dot` pulse. |
| §11 Error copy names the fix | Onboarding camera failure, `wrong-surface` message | Holds. Both name the specific action. |

Also worth recording: the phase rail is structurally prevented from becoming a label source
(`phase_marker_clicked` carries `marker_index`, not a phase name), and this is guarded by
`backend/tests/test_phase_rail_is_not_a_label.py`. The spec doesn't mention this property; it should.

---

## 2. What exists but diverges

**2.1 Route names.** Spec §2 says `/org/*`; code has `/employer` ([App.tsx:21](../frontend/src/App.tsx#L21),
[Header.tsx:22](../frontend/src/components/Header.tsx#L22)). Cosmetic, but it's the rename Phase 3 depends on.

**2.2 Design tokens are half-implemented, and the exam page bypasses them entirely.**
`:root` defines 20 tokens. Six the spec names do not exist: `--ink`, `--blue`, `--rec`, `--inset`,
`--panel`, `--borderStrong`. Meanwhile [Exam.tsx:16-30](../frontend/src/pages/Exam.tsx#L16-L30) declares
a *private 13-colour palette object* and the file carries **37 hardcoded hex literals**. Eleven of the
thirteen `.tsx` files hardcode hex; the totals:

```
37  pages/Exam.tsx          11  components/ProcessGraphPanel.tsx    8  pages/Landing.tsx
12  components/AudioMeter   11  components/CognitiveSignalPanel     6  components/Logo.tsx
11  components/ProcessRecord 10 pages/Label.tsx, pages/CuedRecall   6  FaceMeshPreview
                                 9  pages/Onboarding.tsx            5  CalibrationSession
```

§4's "nothing hardcodes a hex outside this table" is currently false by ~135 occurrences. Worse, the exam's
`C.rec = #E5484D` and the global `--red = #D3546B` are different reds for the same semantic role.

**2.3 Fonts.** §4 specifies "System UI sans stack" / "System mono stack". The code loads IBM Plex Sans
and Mono from Google Fonts ([index.html:6-9](../frontend/index.html#L6-L9)). This is a deliberate-looking
choice that reads better than the spec's, but it is an external network dependency — which matters for
§14's CSP and for the public verifier's "load fast, work everywhere" requirement.

**2.4 The onboarding consent step does not say what §7.1 step 1 requires — and part of what it does say
is now false.** [Onboarding.tsx:15-31](../frontend/src/pages/Onboarding.tsx#L15-L31) lists three items. It
never states the exclusions (never keystroke contents, never clipboard contents, never full URLs, never
file contents), it is not versioned, and it is not recorded as a separate consent event. Beyond the missing
`ConsentNotice` component, the existing copy asserts:

> "Everything is saved in your own browser's local storage."

That was true when written. It is not true now: [Exam.tsx:339-375](../frontend/src/pages/Exam.tsx#L339-L375)
uploads the webcam clip, the screen recording, and the event log to the backend at submit. **A consent
screen that understates where data goes is the highest-severity item in this audit**, ahead of anything
architectural. It should be corrected independently of Phase 2, not waited on.

**2.5 Skip links are not on every page.** §10 says they already are. Present on Landing/Candidate/
Employer/Verify (via `Header`) and Onboarding/Exam (inline). **Absent** on `/label/:sessionId`,
`/cued-recall/:sessionId`, and the `RequireCalibration` refusal page.

**2.6 No capture-status live region.** §10 lists it as "to add", so this is expected — but note the only
`aria-live` in the whole frontend is in [FaceMeshPreview.tsx:150](../frontend/src/components/FaceMeshPreview.tsx#L150).
A screen-reader user is currently not told when screen sharing stops.

**2.7 Empty/error states are ad hoc.** As the spec says. A shared `.empty` class plus per-page markup.

**2.8 Stale comment.** [Onboarding.tsx:47](../frontend/src/pages/Onboarding.tsx#L47) says "Exam itself
re-checks for a stored baseline". It does not — it consumes a ticket. See finding 5(a).

---

## 3. What the spec describes that doesn't exist

**Everything auth.** No `/login`, `/signup`, `AuthProvider`, `RequireAuth`, `RequireRole`, MFA challenge,
magic-link handling, or any notion of a user. Identity today is `pp_candidate_id`, a `crypto.randomUUID()`
in localStorage ([calibration.ts:24-37](../frontend/src/lib/calibration.ts#L24-L37)) that "grants nothing
on its own".

**Everything multi-tenant.** `loadSessions()` reads `localStorage["pp_completed_sessions"]`
([sessions.ts:27-34](../frontend/src/lib/sessions.ts#L27-L34)). Candidate, Employer and Verify all read it.
There is no server session list, no tenancy, and `apiFetch` sends no credentials
([api.ts:36-38](../frontend/src/lib/api.ts#L36-L38)) — no auth header, no `credentials: "include"`,
no token refresh, no error normalisation. §9 describes a wrapper that does four things; the real one does one.

**Routes:** `/org/*`, `/admin/*`, `/c/:credentialId`. None exist.

**Components:** all 20 in §5's "to build" table. None exist.

**Build:** one Vite target ([vite.config.ts](../frontend/vite.config.ts)). §14's three bundles do not exist.

**Testing:** there is **no frontend test runner at all** — no vitest, no jest, no test script in
[package.json](../frontend/package.json). Every frontend invariant that is checked today is checked by
Python tests that read `.tsx` files as text (`test_calibration_ui_contract.py`,
`test_phase_rail_is_not_a_label.py`). That technique is genuinely clever and has caught real bugs, but
§13's Unit / Integration / Capture / Tenancy / Accessibility layers have nowhere to live. **Phase 1's
required tenancy test cannot be written on the frontend side until a runner is added.**

---

## 4. Invariant violations in the current code

Invariants 1, 2, 3, 5, 6, 7, 8 all hold — verified individually above.

**Invariant 4 is violated, deliberately, and the invariant is the thing that's wrong.** See 5(a).

No other violations found. Two things worth flagging as *near* misses, not breaches:

- Invariant 5 (content exclusion) holds in the event log, but `CompletedSession.code` stores the full
  editor buffer ([sessions.ts:21](../frontend/src/lib/sessions.ts#L21)) and Employer renders sessions
  containing it. That's the participant's *solution*, which is legitimately part of the record — but it is
  content, it currently lives unscoped in a shared store, and the spec never says who may read it.
- Invariant 7 (honest status) holds for the screen stream. There is no equivalent for the webcam: if the
  camera track ends mid-exam, [Exam.tsx:677-680](../frontend/src/pages/Exam.tsx#L677-L680) keeps showing
  "Capturing video + audio" as long as `camStream` is non-null, because a stopped track doesn't null the ref.

---

## 5. Where the spec is wrong, unimplementable, or conflicts with the code

You asked for disagreement. There is a substantial amount.

### (a) Spec §3 and CLAUDE.md invariant 4 are reversed. Do not implement them.

Both say `RequireCalibration` must check for a stored baseline profile via `getExistingBaseline`.
**The codebase deliberately removed exactly that check on 2026-08-09** and replaced it with a single-use,
short-lived exam ticket held in `sessionStorage`.

The reasoning is in [calibration.ts:179-189](../frontend/src/lib/calibration.ts#L179-L189) and it is better
than the spec's: a stored profile says the candidate calibrated *at some point, in some room, with some
camera — possibly last month, possibly as someone else*. Only a ticket minted minutes ago by a run that
passed every quality check is a claim about the person currently in front of the camera.

This is not a matter of taste. `backend/tests/test_calibration_ui_contract.py:277-295` asserts:

```python
assert "authorizeExam" in guard, "the guard must consume an exam ticket"
assert "getExistingBaseline" not in guard, (
    "a stored baseline must not gate /exam — that is the reuse path this rule removed")
```

Implementing the spec as written **breaks a passing test and re-opens the carry-over hole the ticket
model was built to close.** Note also that `getExistingBaseline` still exists in `calibration.ts:232`,
carrying a docstring that says in bold *"Not an entry check. Nothing in the calibration or exam flow may
branch on this."* The spec author read the function name and inferred the old design.

**Recommendation:** amend Frontend Spec §3 and CLAUDE.md invariant 4 to the ticket model before any phase
runs. The correct invariant is: *the guard consumes a fresh single-use ticket; it must never consult a
stored profile, and the ticket must live in `sessionStorage`, never `localStorage`.* I have not made this
edit — it's your call, and CLAUDE.md tells me to surface conflicts rather than pick a side.

### (b) The release gate makes Phase 3's org portal ship an empty room.

`FEATURES.md` (generated 2026-08-14): release gate is `pilot`. **Zero features are at `pilot` or above.**
25 are below it. `registry.assert_releasable()` enforces this "at the serialisation boundary", and
`backend/problemproof/api/gate.py` blocks sub-gate features from API responses.

The spec's v0.5 milestone ships `ProcessProfileView` with evidence links and a validator dashboard to
organisations. But `profile.analyze_then_judge` is status `spec`, blocked on labels; `analysis.phase_detection`
is blocked on labels; `validation.dashboard` is status `spec`. The org portal is *definitionally* the
"validating organisation" surface the gate exists to protect.

So Phase 3 can build the interface, and it will correctly render nothing. **The spec never says what the
org portal shows while its data sources are below gate** — and "an empty dashboard" and "a dashboard with
a prominent below-gate banner" are very different products. This needs a decision before Phase 3, not during.

### (c) `/cued-recall/:sessionId` is missing from the spec entirely.

A 414-line route ([CuedRecall.tsx](../frontend/src/pages/CuedRecall.tsx)) implementing the research plan §4
protocol, with a backend contract (`POST /sessions/{id}/narration`) and its own test module
(`backend/tests/test_cued_recall.py`). It appears in **neither** §2's route table **nor** §5's component
inventory. Since it is the labelling protocol that unblocks six other features, a refactor working from
§2 alone would delete the project's critical path. §2 and §5 need it added.

### (d) The exam runs two clocks that disagree after any pause, and the spec sanctions the pause.

§7.1 lists a pause control in the top bar, and it exists. But:

- `elapsed` **stops** while paused ([Exam.tsx:136](../frontend/src/pages/Exam.tsx#L136) — `if (!runningRef.current) return`)
- `sessionMs()` = `performance.now() - sessionStartMs` **does not** ([Exam.tsx:188](../frontend/src/pages/Exam.tsx#L188))
- the event logger is **detached** while paused (`useEventLogger({ active: running })`)
- the **screen recording keeps running** — correctly, per invariant 2

After a five-minute pause, the human-readable rail says `12:30` and the metadata log says `t_ms: 1050000`
for the same instant. Nothing records the offset. Worse, the screen recording contains five minutes of
footage with no corresponding event log, and §8's "unified clock — this synchronisation is what makes
cross-stream statements possible at all" is quietly broken for that stretch.

This is arguably the most consequential unflagged issue in the audit, because it degrades the evidence
record silently rather than loudly. The spec should either (i) record pause spans as first-class events in
the manifest, or (ii) drop the pause control. It currently does neither and does not acknowledge the tension.

### (e) §12's performance rules are violated by the exam page as built.

- **"No per-keystroke React re-render of the editor tree":** `onCodeChange` calls `setCode`, `setKeystrokes`,
  and pushes to a ref — re-rendering the whole 791-line `Exam` tree including the event list, both asides,
  and the `FaceMeshPreview` subtree, on every character.
- **"Virtualise the event stream beyond ~200 rows":** [Exam.tsx:405](../frontend/src/pages/Exam.tsx#L405)
  renders `events.slice().reverse()` in full, unvirtualised.
- **Undocumented, and worse than both:** the draft-persist effect
  ([Exam.tsx:150-157](../frontend/src/pages/Exam.tsx#L150-L157)) depends on `elapsed`, which updates every
  **120 ms**. So `JSON.stringify` of the entire draft — code, all events, counters — runs to `localStorage`
  roughly **eight times a second**, synchronously on the main thread, for the whole session. In a 40-minute
  session that is ~20,000 serialisations of a growing object, on the one page the spec says cannot afford it.

§12 is therefore accurate as a *requirement* and wrong as a *description*. Phase 6 item 3 is real work,
and the draft-write frequency should be fixed sooner than Phase 6.

### (f) Minor: §4's type rule is broken on the exam page in the one place it's most visible.

§4 explicitly gives "a problem statement" as a sans example. `PROBLEM_NAME` renders in mono in the exam
header ([Exam.tsx:445](../frontend/src/pages/Exam.tsx#L445)). Small, but it's the rule the spec calls
load-bearing rather than stylistic.

---

## Recommended order

1. **Fix the consent copy** (2.4). Not a phase; it's a correctness fix on a live claim about data handling.
2. **Resolve 5(a)** — amend the spec and CLAUDE.md to the ticket model. Everything downstream inherits this.
3. **Decide 5(b)** — what the org portal renders while its features are below gate. Blocks Phase 3's meaning.
4. **Add `/cued-recall` to the spec** (5c), so no later phase deletes it.
5. **Add a frontend test runner** as the first commit of Phase 1 — the required tenancy test has nowhere to live otherwise.
6. Then Phase 1 as written.
7. Pull the pause/clock decision (5d) and the draft-write frequency (5e) forward out of Phase 6.
