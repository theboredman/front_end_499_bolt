# ProblemProof — Results

**Generated:** 2026-08-16
**Sources:** `backend/problemproof/features.toml` (registry of record), the session corpus under `backend/data/sessions/`, and the test suites. Every number below was read from the repository on the date above, not carried over from a previous write-up.

---

## 1. The headline

**No feature has produced a validated result. Zero of 28 sit at or above the `pilot` release gate.**

That is not a hedge, it is the finding. The system is built; it has not been measured. One research session in the corpus is complete enough to analyse, and nothing anywhere has been labelled, so almost every validating metric in the registry has no denominator yet.

| Status | Count | Meaning |
|---|---|---|
| `validated` | **0** | Meets its gate on held-out real data |
| `pilot` | **0** | Validated on real pilot sessions, small n |
| `synthetic` | 11 | Runs; validated only on synthetic data |
| `stub` | 5 | Code path exists, output is a placeholder |
| `spec` | 13 | Decided and specified, no code |
| `rejected` | 2 | Deliberately not shipping |

Counted from `features.toml` on 2026-08-19 (31 features). The previous table
here read 10 / 1 / 15 / 2, which was stale in two directions: one feature had
been promoted to `synthetic` without this document being re-counted, and the
Layer 0 and Layer 4 features below are new. `validation.dashboard` moved from
`spec` to `stub` because it is now built; it stays below `synthetic` because
the surface it renders has nothing to render.

The one number that *was* measured against a real gate — `capture.webcam_signals` — **fails it** (§4.1). That is the most informative result in this document, because it is the only place where reality has been allowed to contradict an assumption.

**What is genuinely finished is the engineering and the epistemic scaffolding**: 1027 backend tests, 190 frontend tests, a release gate that provably refuses to serve unvalidated features to a validating organisation, and a registry in which every feature carries its own metric, gate, and blocker. The discipline works. It has nothing to be disciplined about yet.

---

## 2. How to read this document

Each feature is reported as:

- **Built** — what actually exists and runs.
- **Measured** — what has been observed. Usually "nothing yet", and where that is the case it says so rather than substituting a synthetic figure.
- **Gate** — the pre-registered threshold from `features.toml`, quoted verbatim. These were written before the data existed, which is what makes them worth anything.
- **Verdict** — one of: *not started* / *runs, unmeasured* / *measured, fails gate* / *measured, meets gate*.

**Synthetic ≠ result.** Ten features are marked `synthetic`: they execute end-to-end and produce plausible output on generated data. That demonstrates the code path, not the claim. A synthetic result cannot fail, which is precisely why it cannot count.

---

## 3. The evidence base

This determines everything below, so it comes first.

### 3.1 Session corpus

33 directories under `backend/data/sessions/`:

| Kind | Count | Contents |
|---|---|---|
| Synthetic placeholders (`session_000`–`session_014`) | 15 | `graph.json` only — no signals, events, or recordings |
| Real captures (timestamp-named) | 17 | Partial; most missing manifest, events, or both |
| Legacy desktop-agent capture (`004`) | 1 | Older layout: `event_log.jsonl`, `feature_vectors.csv`, `screen_recording.mp4` |
| **Complete enough to analyse** | **1** | `1786715504070` |

**Labelled sessions: 0.** No `labels.*.json` exists anywhere in the corpus.

Of the 17 real captures: 10 have `events.jsonl`, 12 have `signals.parquet`, 7 have `screen.webm`, and **1 has a `session_manifest.json`**. `feature_assembly.REQUIRED_FILES` demands manifest + events, so by the pipeline's own readiness check the usable corpus is **n = 1**.

### 3.2 The one complete session — `1786715504070`

| Property | Value |
|---|---|
| Duration | 20.02 min (signals) / 19.18 min (event log) |
| Signals | 6,006 rows @ 5.0 Hz, 73 columns |
| Event log | 1,289 events |
| Screen recording | 31.3 MB `screen.webm` |
| Webcam recording | 94.1 MB `webcam.webm` |
| Labels | none |
| `t0_epoch_ms` | `null` — the true session origin was never captured |

Event composition:

| Type | Count |
|---|---|
| `keystroke` | 1,230 |
| `window_blur` / `window_focus` | 13 / 13 |
| `tab_hidden` / `tab_visible` | 8 / 8 |
| `phase_marker_clicked` | 5 |
| `idle_start` / `idle_end` | 4 / 4 |
| `copy` | 2 |
| `verification_action` | 2 |

Two things to note. **95% of the event log is keystrokes** — the behavioural richness the analysis layer assumes is thin in practice, and a phase detector trained on this distribution is largely reading typing rhythm. And `paste` never fires, while `copy` fires twice, which is worth checking against the recording before anything is inferred from clipboard behaviour.

---

## 4. Layer 1 — Capture

### 4.0a `profile.cv_extraction` — CV to skill knowledge graph (RQ5) · `stub`

**Built (2026-08-19).** `problemproof/profile/` — a deterministic, sectioned, dictionary-and-pattern extractor over PDF, DOCX and TXT; a typed graph contract with closed node and relation vocabularies; a store whose re-upload path is non-destructive. The skill section of `/account` (merged from a standalone `/profile` on 2026-08-20) renders suggestions and confirmed claims as two different things. 21 tests.

**Visualised, per candidate, once their CV is analysed (2026-08-20).** `frontend/src/components/ProfileGraphPanel.tsx` — a node-link diagram of the candidate's own graph, rendered from the same `extracted`/`approved` response the list below it already used. Hand-drawn SVG, positioned by a deterministic formula (columns by node type, rows within a column), the same style already established by `ProcessGraphPanel` for the phase-transition graph — no graph library, none exists in this frontend. Colour is the six-hue `PHASE_COLORS` palette reused for node type (already validated: `node scripts/validate_palette.js`, CVD and normal-vision floors both pass); the one distinction that matters — approved vs. still-suggested — is carried by shape (solid vs. hollow-dashed), never colour alone, because it is the same extracted/approved boundary the schema enforces server-side. 16 tests, 12 on the pure layout/merge function (including that an LLM-cleanup correction, added §4.0a below, flows through the merge the same way an ESCO match does) and 4 rendering smoke tests.

One geometry bug was caught by actually rendering a realistic graph and reading the coordinates, rather than reasoning about the code: `extraction.py` emits both `USED_IN` and `EVIDENCED_BY` for every skill a project or experience mentions, so a skill evidenced by a project produces two edges between the same pair. Drawn separately they land exactly on top of each other — the second invisible. Fixed by merging edges between the same pair before drawing, carrying every relation name into one tooltip instead of one hidden arc.

**The property that carries the research question.** `extracted` and `approved` are separate fields, and nothing crosses between them except `schema.approve`, which records who did it and when. There is no code path and no request shape that promotes a suggestion by default. That matters twice over: an assessment is built only from the approved set, and this feature's own metric *is* the gap between the two sets — a design where approval was the default would report precision 1.0 by construction.

**Deliberately not a language model.** The reason is `removed-emotion-monitor.md`'s recorded result: a generative model asked to describe an input it was given asserted evidence absent from that input in 42 of 50 cases. A model that invents a skill from a CV produces a claim about somebody's employment history with nothing behind it, and this feature's precision would then be a hallucination rate under a different name. The recall cost is real and `review_metrics` counts it as `participant_added`.

**Checked against a second implementation in this repository, and confirmed (2026-08-20).** `KG/` is a standalone pipeline that builds a fuller resume graph using exactly the declined architecture — NIM LLM extraction plus a spaCy NER cross-check. Reading it through did not reopen the decision: `KG/`'s LLM pass sends each candidate's full CV text to a third-party API, the same privacy shape as the already-removed emotion monitor.

**One piece of `KG/` was adopted: ESCO-grounded matching, because it stays on-device.** `problemproof/profile/esco.py` — local sentence-transformer embeddings against a bundled, trimmed copy of the ESCO v1.1.1 taxonomy (13,896 concepts, `data/esco_skills.csv`), tried only on Skills-section items the dictionary misses. Off by default (`PP_ESCO_SKILL_MATCHING` unset); the confirmed false-attractor denylist ("numpy"→"numerology", "KNN"→"Vyper") is ported verbatim from `KG/`'s own tuning so the two catalogues don't diverge on terms already proven bad. 27 new tests (`test_esco_matching.py`, `test_extraction_esco_integration.py`, plus two in `test_personalisation_api.py` for the opt-in wiring), every one against an injected fake embedding function — none downloads a model or needs `sentence-transformers` installed. An accepted match adds a genuinely measured `esco_similarity`, kept separate from the stated-prior `confidence`.

**The confidences are stated priors, not measurements.** 0.6 to 0.9 per extraction route, constant, so a systematically bad route shows up as a bad precision for one provenance rather than as noise. `ExtractionReport.confidence_provenance` reads `stated-priors-not-fitted` and the UI labels them `prior`, not `confidence`.

**A third tier, LLM-assisted cleanup, is the one piece that leaves the machine — confirmed explicitly before being built (2026-08-20).** `problemproof/profile/llm_cleanup.py`, tried only on Skills-section items that miss both the dictionary and ESCO, via NVIDIA NIM. This is a direct request against the position taken two entries above ("deliberately not a language model") and against the ESCO-only choice made minutes earlier in the same working session when offered the full-pipeline alternative — surfaced back explicitly rather than built silently, and confirmed with a materially narrower scope than either alternative: only the isolated skill phrase itself is sent, never CV prose, a name, an employer, or a date.

A correction is never trusted on the model's word. `clean_batch` runs every proposal through a similarity guard (stdlib `difflib`) before accepting it — a typo fix keeps the string close to the original, a model that substitutes a different skill ("Go" → "Google") does not, and is rejected back to the raw text. The failure mode is the same one `removed-emotion-monitor.md` is the recorded negative result for, at a smaller scale, and the guard is what stands between it and a participant's profile. An accepted correction is still an **extracted**-tier suggestion — the same review/edit/reject path as everything else — and carries the original alongside it (`cleanup_original`) so a reviewer can see, and undo, what was replaced.

Off by default (`PP_NIM_SKILL_CLEANUP` unset). 31 new tests: 18 on the pure guard/parsing logic (`test_llm_cleanup.py`), 10 on where it plugs into extraction and where it deliberately does not (`test_extraction_llm_cleanup_integration.py`), 3 at the API level — including one that captures the real outgoing prompts from a CV containing a name, an email and an employer, and asserts none of them appear. Every test supplies an injected fake call function; none needs a network call or an API key.

**Gate.** `precision >= 0.80 and recall >= 0.70 on real participant CVs, with the edited-or-removed proportion reported alongside`

**Verdict: runs, unmeasured.** The metric is defined as a comparison against a participant-approved graph and zero participants have reviewed one. Nothing here is measurable at build time by construction — a synthetic CV compared against a synthetic approval measures the fixture. Adding ESCO matching or LLM cleanup does not change this: both are extraction routes inside the same feature, gated by the same unmet metric. The LLM tier's own diagnostic — acceptance rate against the similarity guard, and eventually the rate a participant reverts an accepted correction — is the number that would say whether the guard's threshold is set well, and it too has no data yet.

**Blocked on.** Real participants.

### 4.0b `assessment.question_generation` — Question and rubric generation (RQ6) · `stub`

**Built (2026-08-19).** `problemproof/assessment/` — three versioned question families, `exam_spec.json` and `question.json` contracts, a `QuestionGenerator` protocol with a deterministic template implementation and an unwired provider one, and rubric generation stored alongside the question. `/assessment` is the setup surface and `/exam` renders the result. 29 tests, all offline.

**Template-based, and the registry says so.** `.env` configures no provider and `default_generator()` returns `TemplateGenerator`. That is the shipped behaviour, not a degraded mode. `default_generator()` **raises** if `PP_QUESTION_PROVIDER` is set with no client wired, rather than quietly falling back — wiring one is a change somebody makes knowingly, in a commit that also edits this entry.

**What a family fixes, and why.** Target competency, difficulty definition per tier, duration range, required deliverables, rubric dimensions. Personalised questions are by construction different questions, so without something held constant a process record from one participant and one from another are records of solving unrelated problems and every comparison the product makes is confounded. The family key (`id@vN`) is stored on `question.json`.

**The known weakness is the thing the gate measures.** The template cannot invent a novel situation, so two participants at the same tier in the same family see the same frame with their own skills in it. `inter_question_similarity` is in the gate for exactly that reason.

**The generator payload is provably clean.** Built as an allowlist, field by field. `tests/test_generator_payload_is_clean.py` walks the actual outgoing dict to arbitrary depth and asserts no unapproved node, no CV prose, no personal identifier, and no key outside a declared set — it inspects the payload rather than reading the source.

**Gate.** `blinded raters agree the question targets the selected skills and matches the stated tier on >= 80% of generated questions, with inter-question similarity low enough that two participants are not effectively answering the same question`

**Verdict: runs, unmeasured.** Every part of the gate is a human judgement about questions generated for real people from real approved graphs. Neither exists.

**Blocked on.** Real participants and blinded expert raters.

### 4.1 `capture.webcam_signals` — Webcam signal extraction (Extractor A) · `synthetic`

**Built.** MediaPipe FaceLandmarker → blink, gaze, head-pose and motion features at 5 Hz, server-side. Runs on real video; 6,006 rows produced from the one complete session.

**Measured** — the only real-gate measurement in the project:

| Signal | Mean | NaN rate |
|---|---|---|
| `face_valid_fraction` | **0.8162** | — |
| `blink_rate_hz` | 0.7728 | 2.0% |
| `gaze_screen_fraction` | 0.2898 | 8.9% |
| `head_pose_stability` | 8.2910 | 9.0% |
| `motion_energy` | 0.3505 | 11.3% |

Face detected in 5,471 of 6,006 windows.

**Gate.** `face_valid_fraction >= 0.85 on pilot sessions`

**Verdict: measured, FAILS gate.** 0.8162 against a 0.85 threshold, on n = 1.

#### The absence hypothesis is falsified — and the metric is measuring the wrong thing

This was the open question in the previous revision: is the shortfall the participant leaving frame, in which case excluding those windows would be legitimate? It is now answered, by `analysis/face_validity.py` run against the session.

| | Value |
|---|---|
| `face_valid_fraction` (what the gate reads) | **0.8162** |
| Presence, 3s tolerance — *was anyone there?* | **97.29%** |
| Detection reliability while present — *did the detector see them?* | **0.8389** |
| Total undetected time | 107s of 1201s |
| Dropout runs | 97 · median **0.2s** · longest 17.6s |
| Share of shortfall from *partially* valid windows | **51.5%** |

**Excluding absent windows moves 0.8162 to 0.8389. The gate still fails.** So the decision about whether to exclude them does not change the outcome, and the project can stop treating it as blocking.

The stronger finding is what the numbers show underneath. Only 8.9% of windows are fully invalid; **78.6% are partially valid** — the face is found in some frames of the window and missed in others. A partially valid window cannot be absence: somebody was there for it. That half of the shortfall (51.5%) belongs to the detector by construction. And the dropouts that do occur are overwhelmingly momentary — median 0.2 seconds, a single window — which is a blink or a head turn, not a person leaving.

The participant was present for essentially the whole session (97.3% at 3s tolerance, 99.2% at 10s). What `face_valid_fraction` measures is **per-frame detector reliability**, a property of the capture and the landmarker. What the gate's wording implies it measures — that the participant was in frame 85% of the time — is a property of the participant. They are different quantities with different remedies: presence is fixed by instructing the participant, reliability by fixing lighting, framing, or the model.

**Recommendation.** Report the two separately and decide which the gate applies to. `analysis/face_validity.py` computes both and is tested against constructed cases where a flickering detector and a participant who walked away produce an *identical* `face_valid_fraction` — which is the argument for the split, stated as a test.

The 0.85 threshold itself was set before any real data existed. It should not be moved to accommodate a failure, but once the metric is split it will need setting on evidence rather than intuition — and the number appropriate to detector reliability is not necessarily the one appropriate to presence.

`gaze_screen_fraction` of 0.29 is also striking — nominally the participant looked at the screen under a third of the time. On n = 1 this is an observation, not a finding, and the likeliest explanation is a gaze estimator that has not been validated rather than a participant staring out of the window.

**Blocked on.** Real sessions.

### 4.2 `capture.event_log` — Structured event log · `synthetic`

**Built.** In-tab metadata logger (`frontend/src/lib/eventLogger.ts`) mirrored by a Python contract (`backend/problemproof/events.py`), with `assert_no_content` enforcing that no field can carry content. 1,289 events captured on the real session.

**Measured.** Nothing against the gate. The precision/recall figures require a hand annotation pass against video that has not been done.

**Gate.** `precision and recall >= 0.90 per event type that a running component can actually emit`

**Verdict: runs, unmeasured.**

The content-exclusion property *is* verified — by schema tests rather than by a study, which is the appropriate instrument for that particular claim. Reliability of the event stream is not.

**Fixed 2026-08-19: the accept inference now has a production call site.** `inference.annotate_log` was never called by `agent.run`, so an agent-captured session's log contained `paste_event` rows and zero `ai_output_accepted` rows, and both `verification_latency` and `delegation_ratio` returned `None` on every session — the metric RQ3 rests on, reporting "no data" on sessions that had the data, with nothing raising. `agent.finalize_session` now runs consolidate → annotate → derive, and `tests/test_accept_inference_is_wired.py` asserts it starting from what the capture layer writes rather than from a hand-placed accept.

**The accept count is still refused at read time.** `fit_accept_thresholds` needs sessions carrying `events.annotated.jsonl`, and zero sessions have one, so `AcceptConfig.provenance` remains `unfitted-intuition`. The report is persisted next to the metrics with `accepts_reportable: false` and its reason, and `inference.read_accept_count` raises rather than serving a count produced by thresholds nobody has validated. So RQ3 is unblocked as a code path and still blocked as a finding — which is a smaller distance than before, and it is worth being precise that it is not zero.

**Blocked on.** Hand annotation pass; a decision on whether the desktop agent is part of the protocol at all.

### 4.3 `capture.latent_encoder` — On-device latent encoder (Extractor B) · `spec`

**Built.** Nothing. The 64 `latent_0..latent_63` columns exist in `signals.parquet` and are **entirely NaN** — the schema reserves the space, the encoder does not exist.

**Gate.** `latents add >= 3 F1@25 over MediaPipe-only, or they are cut`

**Verdict: not started.**

This is the feature the product's original privacy claim rested on: on-device extraction so that raw video never leaves the machine. It does not exist, the video does leave the machine, and the user-facing copy has been corrected to say so (see §8).

**Blocked on.** Real sessions; GPU budget.

### 4.4 `capture.clock_sync` — Dual-stream clock synchronisation · `stub`

**Built (2026-08-19).** The clapperboard is implemented end to end and has never been run on a real session.

- `analysis/clock_sync.py` — a BT.601 luma trace against container PTS, flash-onset detection, per-stream offset measurement against each recorder's *declared* offset, and the pairwise residual. `fusion_refusal` is the read-time gate; `feature_assembly.session_readiness` calls it, so an unsynchronised or misaligned session is excluded from the analysis corpus rather than fused.
- `frontend/src/lib/clockSync.tsx` — one 400 ms full-screen white step, painted once per sitting, announced a beat beforehand, timestamped inside `requestAnimationFrame` so the recorded instant is the paint rather than the `setState`. It logs `clock_sync_flash` with its session time.
- `tests/test_clock_sync.py` — 29 tests, including detection against actual encoded webm files rather than only synthetic traces.

**The known residual named in the previous review is fixed.** `clock_offsets.webcam_ms` is now `null` and `stream_timebases.webcam` carries a piecewise `pause_compensated` map derived from the same pause events everything else reads. `decode_with_pts` and `extract_signals` take a `session_time` callable, and `POST /sessions/{id}/extract` builds it from the manifest. Previously `0` was written there on every session; on a session paused for 90 seconds that was wrong by 90,000 ms and indistinguishable from a measurement.

**Two corrections to the plan**, both made from the code rather than the document:

- **The clap is dropped.** `getDisplayMedia` is requested with `audio: false`, so the screen recording has no audio track and a clap lands in exactly one of the two streams. It cannot synchronise anything.
- **The residual is measured against declared offsets, not between two flash-derived ones.** Deriving both from the flash and differencing them gives zero on every session, including a broken one.

**Gate.** `< 100 ms on >= 95% of sessions`

**Verdict: runs, unmeasured.** Zero sessions on disk carry a `clock_sync_flash` event, so the distribution the gate is stated over has no samples. Status stays `stub`: an implementation is not a measurement.

A second question is also unmeasured — whether a webcam in an ordinarily-lit room registers a monitor flash at all. `find_flash` returns `None` rather than a guess when it does not, so the failure mode is a refused session rather than a wrong number, but the detection rate is unknown until sessions exist.

**Blocked on.** A session recorded with the flash.

### 4.5 `capture.keyframe_reduction` — Screen keyframe reduction · `spec`

**Built.** Nothing. `screen_recorder.py` writes a continuous MP4 with no reduction step.

**Gate.** `reduction >= 10x with no reviewer-reported loss of context`

**Verdict: not started.** At 31.3 MB for 20 minutes, storage is not yet the binding constraint.

### 4.6 `privacy.invertibility` — Latent invertibility experiment (RQ2) · `spec`

**Built.** Nothing, and it cannot be built: the experiment attacks latents that `capture.latent_encoder` would produce.

**Gate.** `re-identification not above chance`

**Verdict: not started.** Blocked on `capture.latent_encoder`.

This is one of the project's four research questions and it is fully blocked by a dependency that is itself blocked on GPU budget. Worth flagging in planning terms: RQ2 cannot be answered on the current trajectory.

---

## 5. Layer 2 — Analysis

Every feature in this layer is blocked on labels, of which there are zero. This section is short because there is nothing to report, and padding it would misrepresent that.

| Feature | Status | Gate | Verdict |
|---|---|---|---|
| `analysis.phase_detection` | `synthetic` | Per-class recall reported for all six phases, not just MoF | Runs on synthetic data only. No real result. |
| `analysis.process_graph` | `synthetic` | Graph features beat scalars, or the graph is descriptive only | 15 synthetic `graph.json` files exist. No real session has one. |
| `analysis.verification_latency` | `synthetic` | Beats time-on-task at predicting correctness | Only 2 `verification_action` events in the entire real corpus. |
| `analysis.delegation_ratio` | `synthetic` | Released alongside `verification_latency` once both have real-session validation | Blocked additionally on a silent-zero fix and an artifact upload path. |
| `analysis.fusion` | `spec` | UAR reported alongside WAR so rare states cannot hide | Not started. |
| `analysis.long_tail` | `spec` | Rare-class recall within 15 points of Execution recall | Not started. |
| `analysis.segment_gate` | `spec` | No F1 loss beyond 2 points at ≥ 50% compute saved | Blocked on `phase_detection`. |

**The binding constraint for this entire layer is a single missing artifact: labelled sessions.** Six features unblock the moment one exists.

`analysis.verification_latency` deserves a specific note: with 2 verification actions in 20 minutes of real capture, the metric has essentially no signal to work with at current event density. That may be a property of the problem used rather than of the metric, but it should be checked before more is invested.

---

## 6. Layer 3 — Profile, calibration, fairness

### 6.1 `calibration.quality_gate` · `synthetic`

**Built and running for real.** A 714-line per-frame gate (`calibration/quality.py`) rejecting dark, off-centre, cropped, occluded, moving-camera and multi-person frames before they reach the feature extractor. Every flag blocks; there is no advisory tier. It runs live in the calibration flow today.

**Measured.** No `clean_frame_ratio` distribution across real calibration sessions has been compiled, and no false-reject rate has been established against manually reviewed borderline frames.

**Gate.** `false-reject rate on manual review below threshold`

**Verdict: runs, unmeasured.** Note the asymmetry of risk: this gate can currently reject a legitimate candidate's calibration with no measured false-reject rate behind it. That is a fairness exposure, not just a missing number.

### 6.2 `calibration.euclidean_alignment` · `synthetic`

**Built.** Per-sitting baseline fitting and the alignment transform; profiles are written under `data/candidates/`.

**Measured.** No ICC(2,1), no variance decomposition, no downstream F1 comparison.

**Gate.** `subject variance drops AND downstream F1 does not`

**Verdict: runs, unmeasured.** The downstream half cannot even be attempted until phase detection has real labels.

### 6.3 `profile.*` — analyze-then-judge, metric rubric, judge consistency, label routing · all `spec`

**Built.** Nothing. Four features, no code.

**Verdict: not started.** `profile.analyze_then_judge` blocks two of the other three, and is itself blocked on labels and on a validator rubric that does not exist.

This is the layer that produces the actual product — the Process Profile a credential attests to. **It is entirely unbuilt.** The org portal renders a below-gate notice naming these features rather than an empty page (§7.2), which is the correct behaviour, but it should be clear that the reviewer-facing product currently has nothing to review.

### 6.4 `fairness.bias_measurement` · `spec` · and `fairness.input_firewall` · `spec`

**Built.** Nothing.

**Gates.** `gap shrinks post-alignment AND task variance is preserved`; `delta not distinguishable from zero`

**Verdict: not started.** Blocked on real sessions across demographic groups, which is the same blocker now shared by `identity.face_match`.

**This is the project's largest unaddressed risk.** The fairness claim — that scoring against a personal baseline removes bias against different thinking styles — is currently an argument, not a measurement. Two features that would test it are unbuilt, and a third (`identity.face_match`) has just been added with a documented demographic-disparity hazard and no way to measure it.

---

## 7. Layers 4–5 — Validation and credential

### 7.1 `validation.cued_recall` · `synthetic`

**Built and running.** The full protocol: playback with cue points derived from the participant's own event log, spoken answers posted to `POST /sessions/{id}/narration`. Route, backend contract and tests all exist.

**Measured.** Nothing. **No participant has narrated a session.**

**Gate.** `coverage >= 95% of session duration on real sessions`

**Verdict: runs, unmeasured.** This is the critical path (§9).

### 7.2 `validation.kappa_gate` · `synthetic`

**Built.** Inter-rater reliability machinery, plus the structural guarantees it depends on: segments tile the session by construction, and annotators never see another's pass.

**Measured.** No kappa. Zero annotators have produced zero passes.

**Gate.** `kappa above threshold, or the phase taxonomy is revised before modelling`

**Verdict: not started in substance.** Note what this gate implies: the six-phase taxonomy is *itself* under test. If annotators cannot agree on it, the taxonomy changes — and every model trained on it changes with it. Nothing downstream should be treated as settled until this returns a number.

### 7.3 `validation.dashboard` · `stub` · blocked on a feature reaching `pilot`

**Built.** `/org` queue with lifecycle state per row, and `/org/review/:sessionId` with the lifecycle bar, the below-gate state, the evidence panel, the decision controls, and the access-and-decision trail.

**Gate.** `must refuse to display any feature below release_gate`

**Verdict: gate met structurally, and the display path has never been exercised with real content.** `BelowGateState` reads withheld features from the registry rather than a hardcoded list. Since every analysis is below gate, the dashboard renders the notice and nothing else — which is correct output, not a defect, and also means nothing has ever been put in front of a validating organisation through it. Moved from `spec` to `stub` on 2026-08-19: it is built, and "stub" here means the surface has nothing to surface.

**Two copy corrections in the same pass.** The queue said "every evidence packet is cryptographically sealed" — true of nothing: no signing, hashing or encryption of an evidence packet exists. It now states what is true (tenant isolation at the data-access layer, and content hashing of a frozen annotation version). It also said reviewer access was "immutably logged", which was aspirational until `GET /sessions/{id}/evidence` existed to write the entry.

### 7.3a `validation.organization_review` (RQ7) · `stub` · **new**

**Built (2026-08-19).** `problemproof/validation.py` and `problemproof/api/validation_routes.py`, with 37 tests.

- A four-state one-way lifecycle. `transition` is the only writer of `state` and refuses a jump, a repeat and a reversal.
- The reviewed annotation is frozen into a content-hashed version **when review opens**, not when a decision is made, so the reviewer judges a record that cannot move while they read it. `verify_version` re-checks the hashes, making "immutable" detectable rather than merely forbidden.
- A revision creates a new version and leaves the original; a revision request changes no state.
- A `disputed` decision does **not** validate the session.
- Severity is computed server-side; the frontend preview is a copy of the rule, and a test reads the frontend source to check they have not drifted.
- Every consequential action, and every evidence read, is appended to `data/audit/validation.jsonl`. Reading the trail is not audited.
- Organisation review and the two blinded expert passes do not read each other, asserted in both directions by an AST-level test.

**Gate.** `reviewer agreement (Cohen's kappa on the confirm/adjust/dispute decision) >= 0.6 across independently double-reviewed sessions, with the revision rate reported alongside`

**Verdict: runs, unmeasured.** Every number in the gate — agreement, turnaround, revision rate — is a property of humans doing reviews, and zero reviews have happened. A lifecycle that has never carried a real decision has measured nothing about reviewers.

**Blocked on.** Real reviewers at real organisations.

### 7.4 `identity.face_match` · `spec` · **new**

**Built.** The full decision pipeline, shipped **disabled**: enrollment from live capture only, embeddings held client-side and never transmitted, two asymmetric thresholds, four event types, and a runtime check rejecting any biometric field from an event payload. 33 frontend tests.

**Measured.** Nothing, and it cannot run: `validated: false` in the threshold config makes `assertUsable()` refuse.

**Gate.** `per-cohort error rates measured and disparity within an agreed bound; liveness detection in place`

**Verdict: not started (deliberately).** The shipped thresholds (0.62 / 0.45) are placeholders and labelled as such.

**Three open items block enabling it**: per-cohort validation has no dataset; no liveness detection exists, so an enrollment capture is "live camera" but not "verified live"; and whether adding identity matching as a processing purpose makes the already-stored webcam video Article 9 biometric data is a legal question, not an engineering one.

### 7.5 `credential.vc_did` · `spec` · blocked on nothing

**Built.** A public verifier at `/c/:credentialId` as a separate bundle, with an unauthenticated verify endpoint. **Nothing issues credentials**, so the endpoint has nothing to verify and correctly reports so.

**Gate.** `no personal data on-chain; hash only`

**Verdict: not started.** W3C VC/DID conformance has not been attempted. This is one of two features blocked on nothing — it is pure implementation.

### 7.6 Rejected features

Two, and their rejection is a result worth recording.

| Feature | Gate | Why |
|---|---|---|
| `authenticity.cognitive_load_inference` | `never` | Inferring cognitive load from webcam signals was judged unsupportable. |
| `authenticity.process_authenticity_score` | `never promoted above spec without a purpose-built dataset` | Blocked on "a dataset that does not exist". |

Declining to ship two plausible-sounding features because their evidence base did not exist is a genuine outcome, and more defensible than the alternative.

---

### 7.5 Layer 3 release — `performance_profile.json` · **new**

Not a registered feature of its own: it is the machinery that decides which registered features reach a participant. Built 2026-08-19, 20 tests.

**Built.** `problemproof/performance_profile.py` assembles the profile from eight sections, each naming the registry feature that governs it. Assembly refuses before `validation.is_validated`, and checks `assert_releasable` per section at the serialisation boundary. `assert_profile_clean` walks the whole object and refuses affect labels, captured content, biometric representations and CV prose — twice, at assembly and again at write.

**Three states, not two.** `assembled: false` (the record has not been validated — a person is the blocker), `withheld` (validated, and the analysis behind the section has not met its standard), and `released`. `AwaitingValidationState` and `BelowGateState` are separate components because the remedies differ, and a reader told to wait for the wrong thing is worse off than one told nothing.

**Verdict: correct, and it renders nothing.** Zero features sit at or above `pilot`, so every section is withheld on every session. A dashboard showing the withheld notice and no numbers is the expected output of this layer. `test_performance_profile.py::test_every_section_is_withheld_today` asserts exactly that — if it ever fails because `sections` is non-empty, something was promoted, and the thing to check is whether it was promoted by a measurement.

**One near-miss worth recording.** The assessment-context section originally carried the problem statement under `prompt`, which is in `FORBIDDEN_FIELDS` — so the section would have tripped its own cleanliness check the moment the feature was promoted, and only then. It is `statement` now. `prompt` in this system means text a participant sent to an AI tool; the problem statement is text we generated and gave to them. Same word, opposite provenance.

---

## 8. Engineering results

Distinct from research results, and considerably further along.

| | |
|---|---|
| Backend tests | **1027 collected — 1025 passing, 2 skipped** (54 test modules) |
| Frontend tests | **190 passing** (Vitest) |
| Frontend source | 60 TypeScript/TSX files (excluding tests) |
| Build | 3 bundles — customer app, internal admin, public verifier |

**Counts reconciled 2026-08-19.** Three documents disagreed: `SYSTEM.md` §7 said 371, its own repository map said 425, and this document said 646. The number is 861 collected, from one `pytest` run in `backend/` with nothing excluded.

**The environmental issue is smaller than previously recorded.** This document said two modules (`test_external_ai_detection.py`, `test_timestamp_contract.py`) fail at collection with `ImportError: win32gui`, and that the counts excluded them. Neither is true now: both collect and both pass. `window_tracker.py` catches the broken-pywin32 `ImportError` and reports itself unavailable rather than propagating, so what was a collection failure is now a single skip — `test_capture_imports_without_hardware.py::test_a_working_install_is_untouched`, which asserts a *working* tracker reads the foreground window and has nothing to assert on a machine where pywin32's DLLs do not match the interpreter. Nothing is excluded from the counts above.

The run still prints a `Windows fatal exception: code 0xc0000139` traceback at collection. That is `faulthandler` dumping the same native import failure as it happens, before the guard catches it. It is noise, not a failure.

### 8.1 Verified properties

These are engineering claims that have been tested rather than asserted:

- **Tenancy isolation.** A user cannot reach another organisation's session by ID manipulation. Refusals are 404 with a byte-identical body to a genuine miss, so the API is not an enumeration oracle.
- **The release gate holds.** `assert_releasable` blocks sub-gate features at the serialisation boundary; verified for `identity.face_match`.
- **Content exclusion.** No event field can carry keystroke, clipboard, URL, title, or biometric content — enforced by schema checks, not convention.
- **Bundle separation.** The public verifier's built chunk contains zero occurrences of the auth token key; the customer bundle contains no verifier code.
- **Capture invariants.** Whole-screen verified post-acquisition; one continuous recording across routes; honest status on track end for both streams.
- **Segment tiling.** Gaps between label segments are unrepresentable by construction, tested as a property across add/remove/reorder.

### 8.2 Corrections made during this cycle

Three classes of defect were found and fixed, and the pattern in them is worth recording.

**Nine false claims about data handling.** The UI told participants their webcam footage never left their machine. It does — the session recording is uploaded and stored. The claims described the *intended* architecture (on-device extraction) as though it were the running one. Corrected across the consent surface and the landing page.

**Seam defects invisible to unit tests.** The session summary read manifest keys nothing wrote, so every listing would have rendered "—" with no test failing. Found by writing an end-to-end test of the path a real session takes.

**Defects invisible to the test suite entirely.** Any signed-in user could list the whole unowned research corpus — 33 sessions, several with screen recordings — because a migration flag defaulted to permissive. Found by running the application against the real data directory, not by testing. Default flipped to deny.

The generalisable lesson: **each defect class needed a different instrument.** Unit tests found none of them; an integration test found the second; only running the real system against real data found the third.

---

## 9. The critical path

Deduplicated blockers, ordered by how many features each releases:

| Blocker | Releases |
|---|---|
| **Labels** | 6 — `analysis.fusion`, `long_tail`, `phase_detection`, `process_graph`, `profile.analyze_then_judge`, `profile.label_routing` |
| **Real sessions** | 3 — `analysis.verification_latency`, `capture.latent_encoder`, `capture.webcam_signals` |
| `profile.analyze_then_judge` | 3 — `fairness.input_firewall`, `profile.judge_consistency`, `profile.metric_rubric` |
| Blind quality ratings | 2 — `analysis.process_graph`, `analysis.verification_latency` |
| Real sessions across groups | 2 — `fairness.bias_measurement`, `identity.face_match` |

Everything terminates in the same place:

```
a participant narrates a session   (validation.cued_recall)
        ↓
annotators produce passes          (validation.kappa_gate)
        ↓
labels exist
        ↓
six Layer 2 features unblock
        ↓
profile.analyze_then_judge unblocks
        ↓
three Layer 3 features unblock
        ↓
the org portal has something to show
```

**One participant narrating one session is the highest-leverage action available**, and the session to narrate already exists: `1786715504070`, 20 minutes, complete. Nothing in the tooling blocks it.

---

## 10. What would change these results

Ordered by leverage, not effort:

1. **Run cued recall on `1786715504070`.** Unblocks the labelling chain. Everything downstream waits on this and nothing else does.
2. ~~Resolve the `face_valid_fraction` question.~~ **Done** — see §4.1. Absence is falsified; the metric measures detector reliability, not presence. What remains is a decision, not an analysis: split the metric in `features.toml` and set the two thresholds on evidence. That is a small change and it is not blocked on anything.
3. **Capture enough sessions to make n meaningful.** Every "real sessions" blocker is the same blocker.
4. **Decide on the desktop agent.** It blocks `capture.event_log` and `analysis.delegation_ratio`, and it is a scope decision rather than a technical one.
5. **Build `profile.analyze_then_judge`.** It has the highest downstream fan-out of any unbuilt feature, though it needs labels first.
6. **Recruit annotators.** Nothing produces a kappa without at least two.

`credential.vc_did` is blocked on *nothing* and could be built today — pure implementation against a published spec. It is not on the critical path, which is the argument for not starting with it. `validation.dashboard` was in this sentence too and has since been built.

---

## 11. Honest summary

The system is real and the discipline around it is unusually good: features carry pre-registered metrics and gates, a release gate mechanically prevents unvalidated work from reaching a customer, and two features have been rejected rather than shipped on weak evidence. The infrastructure to *know whether this works* is in place.

What is missing is the knowing. One session, no labels, one measured gate and it fails. Every research question the project poses is currently unanswered, and RQ2 (latent invertibility) is unanswerable on the present trajectory because the encoder it attacks does not exist.

The gap between "built" and "validated" is the entire remaining project, and it is narrower than it looks — it is one narrated session wide, at least to begin with.
