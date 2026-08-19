# ProblemProof — System Guide

What the system is, what each part does, how it was built, and how to run it.

- Specification: [`research-plan.md`](research-plan.md) — where this document and the code disagree, the plan wins.
- Concept document: [`Main_Idea.md`](Main_Idea.md)
- Code reference: [`BACKEND.md`](BACKEND.md) — every backend module and function, for when you are about to change one.
- Dataflow: [`DATAFLOW.md`](DATAFLOW.md) — which function calls which, over which wire, producing which file.

---

## Table of contents

1. [What the system does](#1-what-the-system-does)
2. [Architecture at a glance](#2-architecture-at-a-glance)
3. [The data contracts](#3-the-data-contracts)
4. [Feature by feature](#4-feature-by-feature)
5. [Running the project](#5-running-the-project)
6. [The full session walkthrough](#6-the-full-session-walkthrough)
7. [Testing](#7-testing)
8. [Design decisions worth knowing](#8-design-decisions-worth-knowing)
9. [Current state: real vs. not yet](#9-current-state-real-vs-not-yet)
10. [Repository map](#10-repository-map)

---

## 1. What the system does

ProblemProof records a person solving a hard, open-ended problem and analyses
*how they solved it* rather than what they produced. The premise is that in an
AI-saturated world the output is cheap to fake and the process is not.

It captures two synchronised streams — the webcam (the person) and the screen
plus a structured event log (the work) — segments the session into
problem-solving phases, and produces an evidence-linked profile.

### The four research questions

The codebase is organised around these, not around product features. Each is
owned by one team member and answered by one module.

| # | Owner | Question | Answered by |
|---|---|---|---|
| RQ1 | Tasfiah | Does within-subject alignment remove trait variance without destroying task signal? | `problemproof/calibration/` |
| RQ2 | Galib | Are on-device latent representations of facial dynamics invertible to identity? | `problemproof/extractors/webcam/` |
| RQ3 | Amatul | Does verification latency after accepting AI output predict solution correctness? | `problemproof/extractors/screen/` |
| RQ4 | Marium | What does the webcam add over the event log alone? | `problemproof/analysis/` |
| RQ5 | shared | Can a CV be turned into a skill graph a participant recognises as theirs? | `problemproof/profile/` |
| RQ6 | shared | Do questions generated from an approved subgraph target the right skills at the right difficulty? | `problemproof/assessment/` |
| RQ7 | shared | Do organisational reviewers agree with each other, and how often do they send an annotation back? | `problemproof/validation.py` |

RQ4 is the spine. Both outcomes publish: if the event log alone recovers ≥90%
of fused F1, the invasive modality is not worth its cost — which kills a bad
product decision before it is built.

---

## 2. Architecture at a glance

```
┌──────────────────────── BROWSER (React + Vite) ────────────────────────┐
│  ScreenCaptureProvider — one whole-screen recording, above the router   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ /onboarding  consent · calibration · SCREEN RECORDING STARTS     │  │
│  │ /exam        editor + Run. No AI panel, no recording controls    │  │
│  │ /verify      the process record · RECORDING STOPS at submit      │  │
│  │ /label/:id   retrospective cued-recall phase labelling           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└──────────────┬─────────────────────────────────────────────────────────┘
               │ HTTP (one origin)
┌──────────────▼─────────────────────────────────────────────────────────┐
│                   BACKEND — one FastAPI app, port 8000                 │
│   api/routes.py       Extractor A: upload → extract → poll → signals   │
│   api/capture.py      Stream B intake: screen recording + event log    │
│   api/labeling.py     serve recording, store labels                    │
│   api/calibration.py  baseline calibration (/api/*)                    │
├────────────────────────────────────────────────────────────────────────┤
│                            storage.py                                  │
│         data/sessions/{id}/   +   data/candidates/{id}/                │
├────────────────────────────────────────────────────────────────────────┤
│  extractors/webcam   extractors/screen   calibration   analysis        │
│  (Stream A)          (Stream B)          (RQ1)         (RQ2/RQ4)       │
└────────────────────────────────────────────────────────────────────────┘
               ▲
   ┌───────────┴────────────────────────────┐
   │  DESKTOP AGENT (CLI, own machine)      │  foreground window,
   │  cli/screen_agent.py                   │  clipboard length,
   │  → extractors/screen/inference.py      │  keystroke timing
   └────────────────────────────────────────┘         │
                                                      ▼
                                        source="inferred" events,
                                        precision/recall measured by
                                        analysis/event_validation.py
```

**There is no in-portal AI assistant.** The participant uses whatever tools and
websites they like, in their own browser. Nothing about that use is directly
observed — it is reconstructed from OS-level capture, and the screen recording
is the evidence a human annotator checks the reconstruction against. That
distinction runs through the whole design; see
[§4.3](#43-reconstructing-ai-use-rq3-the-novel-schema).

**One server.** Calibration was originally a second FastAPI app on the same
port; it is now a router on the same factory. All frontend clients share one
base URL from `lib/api.ts`.

## 3. The data contracts

Frozen in research plan §3. Four people building separately produce four
incompatible formats unless the schemas are fixed first — the plan calls this
the single highest-risk item.

### Session directory

```
backend/data/
├── candidates/{candidate_id}/
│   ├── baseline.json               # calibration profile, reused across sessions
│   ├── candidate_owner.json        # who this directory belongs to (§4.10)
│   ├── cv_source.{pdf,docx,txt}    # the consented source document
│   └── profile_graph.json          # skill/evidence graph: extracted vs approved
└── sessions/{session_id}/
    ├── exam_spec.json              # approved nodes + settings for this sitting
    ├── question.json               # generated prompt, rubric, family, generator
    ├── validation.json             # Layer 4 lifecycle, decision, audit refs
    ├── annotations/v{n}/           # frozen, content-hashed annotation versions
    ├── performance_profile.json    # Layer 3 release — only after validation
    ├── session_manifest.json       # t0_epoch_ms, clock_offsets, AI metrics
    ├── webcam.webm                 # Stream A recording
    ├── signals.parquet             # Extractor A output, 5 Hz
    ├── screen.webm                 # Stream B recording (browser)
    ├── events.jsonl                # structured event log
    ├── features.csv                # Stream B features, 1 Hz
    ├── labels.expert_a.json        # one file per annotator
    ├── labels.expert_b.json
    ├── graph.json                  # §3 process graph, built from the labels
    └── desktop/                    # OS-level agent output, own layout
```

### `session_manifest.json`

```json
{
  "session_id": "...", "subject_id": "...", "problem_id": "...", "condition": "...",
  "t0_epoch_ms": 1785006990207,
  "clock_offsets": { "webcam_ms": null, "screen_ms": 0, "events_ms": 0 },
  "stream_timebases": {
    "webcam": { "kind": "pause_compensated", "base_offset_ms": 0.0,
                "total_skipped_ms": 90000.0,
                "knots": [{ "media_ms": 120000, "session_ms": 120000,
                            "skipped_ms": 90000 }] }
  },
  "clock_sync": { "method": "visual-flash", "residual_ms": 34.0,
                  "max_residual_ms": 100.0, "measured": true,
                  "within_gate": true, "streams": [ ... ] }
}
```

`t0_epoch_ms` is the session origin every stream's timestamps count from. Each
recorder writes its own offset. **This is load-bearing** — see
[§8](#the-timestamp-base-is-the-whole-ballgame).

**`webcam_ms` is `null`, and that is the value, not a gap.** The webcam
`MediaRecorder` pauses when the exam clock pauses; the screen recorder does not
and must not, because a participant who pauses to deal with something private
is still being recorded and is told so (§8.1 rule 5). Webcam media time
therefore omits every paused span, so the map to session time has a step at
each pause and no scalar can express it. `stream_timebases.webcam` carries the
piecewise map; `analysis/clock_sync.media_to_session_ms` applies it. The field
previously held `0` on every session, which on a session paused for 90 seconds
was wrong by 90,000 and looked exactly like a measured alignment.

**`clock_sync` is the clapperboard result** (§4.9). A session with no
`clock_sync` block, or one whose residual exceeds 100 ms, is refused for
cross-stream analysis by `feature_assembly.session_readiness` — it stays usable
as evidence and is excluded from the corpus.

### `signals.parquet` — owned by `extractors/webcam/schema.py`

5 Hz (one row per 200 ms bin). Columns:

`t_ms`, `blink_rate_hz`, `ear_mean`, `ear_std`, `gaze_dispersion`,
`gaze_screen_fraction`, `head_pose_stability`, `motion_energy`,
`face_valid_fraction`, `latent_0` … `latent_63`

The 64 latents are reserved for Extractor B and emitted as all-NaN, so the
column set never changes when Extractor B lands. `face_valid_fraction` is an
addition to §3 as written: without it a consumer cannot distinguish "the
subject held still" from "we lost the face for four seconds".

**No emotion category is emitted, ever.** See [§8](#no-emotion-categories).

### `events.jsonl` — owned by `problemproof/events.py`

One JSON object per line:

```json
{ "t_ms": 74000, "type": "ai_output_accepted", "source": "inferred",
  "attrs": { "char_count": 412, "target_file": "solution.py",
             "tool_id": "chatgpt", "inferred_from": "paste_after_ai_foreground" } }
```

`t_ms` is **session-relative milliseconds**, never wall clock.

`source` is load-bearing, not decoration:

| | Meaning |
|---|---|
| `portal` | Observed directly by our own UI. As reliable as the code that emitted it. Only the editor's Run button and the phase rail qualify. |
| `inferred` | Reconstructed from OS-level capture. Carries a **measured** precision and recall per event type from `analysis/event_validation.py`. |

`inferred` is restricted by `events.INFERRABLE_TYPES` to what capture can
actually establish. An inferred `prompt_submit` is rejected by the contract: no
deterministic signal distinguishes sending a prompt from scrolling the page.

### `labels.{source}.json` — owned by `problemproof/labels.py`

```json
[ { "start_ms": 0, "end_ms": 120000, "phase": "Understanding", "source": "expert_a" } ]
```

Six phases: Understanding, Decomposition, Exploration, Execution, Verification,
Recovery. Three sources: `cued_recall` (participant), `expert_a`, `expert_b`.

Segments must **tile** the session — no gaps, no overlaps. Enforced on write.

### `graph.json` — owned by `analysis/process_graph.py`

```json
{ "nodes": ["Understanding", "Exploration", "Execution"],
  "edges": [{ "from": "Exploration", "to": "Execution",
              "count": 1, "mean_dur_ms": 280000.0 }],
  "features": { "n_transitions": 5, "cycle_count": 1,
                "phase_entropy": 2.2516, "backtrack_ratio": 0.4 } }
```

`features` is an addition to §3's line, sanctioned by §2.4's "Graph features"
list — the same kind of documented extension as `face_valid_fraction`.
`mean_dur_ms` is the mean duration of the *originating* phase segment; a
transition is instantaneous, so that is the only quantity the field can hold.

Built from `labels.*.json`, so a session with no labels has no graph — an empty
one would look like a participant who did nothing.

---

## 4. Feature by feature

### 4.1 Stream A — webcam signal extraction (RQ2)

**What it does.** Turns a session recording into a 5 Hz table of physical
signals: blink rate, eye aspect ratio, gaze dispersion, gaze-on-screen
fraction, head-pose stability, motion energy.

**How it was built.** MediaPipe Face Landmarker (478-point mesh including
iris) at capture rate, features pooled to 5 Hz bins. Head pose comes from the
facial transformation matrix via `scipy` SO(3) geodesics.

Deliberate choices:

- `output_face_blendshapes=False`. Blendshapes are the direct on-ramp to
  emotion-category inference, which §2.2 forbids.
- Container PTS (via `av`) is the frame timebase — the only trustworthy one.
- Blink rate is computed over a 30 s trailing window and *sampled* at 5 Hz. A
  blink lasts 100–400 ms, comparable to one bin, so a per-bin blink count is a
  coin flip rather than a rate.
- Invalid bins are emitted as NaN, never interpolated, so gaps stay visible.
- CPU-only. MediaPipe's Python API has no CUDA path; peak VRAM is 0 MB
  (see [`vram_budget.md`](vram_budget.md)).

**How it runs.** Library entrypoint `extract_signals()`; CLI at
`cli/webcam_extract.py`; API at `POST /sessions/{id}/extract`, which runs it as
a background job because extraction takes minutes.

### 4.2 Stream B — screen recording and structured event log (RQ3)

Stream B is now the *primary* source of everything known about tool use, not a
complement to an instrumented panel. Three parts:

**The screen recording** — one continuous whole-screen capture, started during
calibration and stopped at submit. It is *evidence*, not input: nothing parses
it automatically. It is what a human annotator watches when measuring how good
the reconstruction is (§4.8), and what a validating organisation reviews.

Enforced properties, in `lib/screenCapture.tsx`:

| Property | How |
|---|---|
| Starts at calibration | The "Share screen & start calibration" click acquires it before the camera tasks — a participant who declines finds out before sitting through 45 seconds |
| Whole screen only | `displaySurface: "monitor"` is only a *hint*; the choice is **verified** afterwards via `track.getSettings().displaySurface` and rejected otherwise |
| Survives navigation | The provider sits above `<BrowserRouter>`. In a page component it would be torn down on every route change, and `getDisplayMedia` cannot be re-acquired silently |
| No exam-portal control | The exam page reads status only. A stop/start button would let gaps appear in the evidence record exactly where the participant chose |
| Stops at submit | Uploaded to `/sessions/{id}/screen` |

A window- or tab-scoped share would show only the exam portal — the one place
nothing interesting happens, since the AI tools, documentation and searches are
all elsewhere. It would produce an evidence file that systematically excludes
the behaviour being studied, silently. Hence verification rather than trust.

**The in-browser event log** — what a single tab can legitimately see: focus
changes, typing rhythm, copy/paste, idle. It emits exactly one AI-taxonomy
event, `verification_action` from the editor's Run button, typed
`source: "portal"` as a literal so it cannot construct anything inferred.

**The desktop agent** — the OS-level half, and where tool use actually becomes
visible. It records, all metadata-only:

- foreground window → application, and whether it is a known AI tool
- **clipboard length** on copy/paste — §2.3 Build A: *"Clipboard events: length
  and timestamp only"*. The length is what makes an accept inferrable
- keystroke *timing*; key identity is discarded in the callback
- **site category** per browser tab change

Site categories answer "what was the participant doing" without answering "what
exactly were they looking at":

`ai_tool` · `reference` (Wikipedia) · `documentation` (MDN, language docs) ·
`qa_forum` (Stack Overflow) · `code_hosting` · `video` · `entertainment` ·
`social` · `messaging` · `email` · `uncategorised`

The window title is matched against markers in the same stack frame it is read
in, and only a truncated SHA-256 of it is logged. **No URL, no page title, no
search query** — §2.3 captures "domain category" and "query initiated (yes/no),
tool used", never "full URL or page content" or "query text". `uncategorised`
is recorded rather than dropped: "in a browser on something we could not
classify" is a real observation, and dropping it would make the category counts
look more complete than they are.

### 4.3 Reconstructing AI use (RQ3, the novel schema)

§2.3 Build B is the part that does not exist in ProgSnap2, Blackbox, or any
prior corpus. RQ3 asks whether verification latency after accepting AI output
predicts solution correctness.

**Why there is no in-portal assistant.** An assistant we built would measure our
assistant rather than AI-assisted problem solving, and would push participants
away from the tools they actually use. The problem statement permits any tool,
so participants use their own — and everything about that use is therefore
*reconstructed*, not observed.

**The seven event types** (`problemproof/events.py`):

| Event | Attributes | Obtainable? |
|---|---|---|
| `ai_session_open` | `tool_id` | **inferred** — foreground window |
| `ai_session_close` | `tool_id`, `duration_ms` | **inferred** — foreground window |
| `ai_output_accepted` | `char_count`, `target_file` | **inferred** — clipboard length + window state |
| `verification_action` | `kind: run \| test \| dwell \| lint` | **observed** — the editor's Run button |
| `ai_output_rejected` | `reason` | no producer |
| `prompt_submit` | `prompt_length` | **not obtainable** |
| `response_received` | `response_length`, `latency_ms` | **not obtainable** |

`prompt_submit` and `response_received` sit in `events.UNCAPTURED_TYPES`. They
stay in the schema because §2.3 defines them and a browser extension could
supply them later — but nothing emits them, so a consumer can distinguish
*"did not happen"* from *"cannot be seen"*.

**How an accept is inferred** (`extractors/screen/inference.py`):

> a paste of ≥ 120 characters, within 30 s of a known AI tool holding the
> foreground

Both thresholds are named constants with the reasoning written next to them.
120 characters because short pastes are dominated by ordinary editing — a
variable name, a URL, a line moved within the file — and counting those as
delegation would inflate `delegation_ratio` with the participant's own work.
30 seconds because that covers copy → alt-tab → click → paste without sweeping
in an unrelated later paste. The module reports every rejection (too small, no
recent AI tool, clipboard unreadable) so a session can be audited without
re-running it, and each inferred event carries `inferred_from` — the evidence
for its own existence.

**Why deterministic signals rather than reading the recording.** OCR or a
vision-language model could in principle recover more. Two reasons not to:

1. Error compounds — region detection × OCR accuracy × matching heuristic, each
   needing its own validation before the product of them means anything.
2. This project already has a negative result on exactly that architecture. A
   vision-language model asked to describe screen content asserted evidence
   absent from its input in **42 of 50** cases
   ([`removed-emotion-monitor.md`](removed-emotion-monitor.md)). Reaching for
   the same tool to label events, without first proving it does not fabricate,
   would repeat the mistake with a different noun.

**The derived metrics:**

| Metric | Definition | Status |
|---|---|---|
| `verification_latency` | t(first `verification_action`) − t(`ai_output_accepted`) | The RQ3 metric. Survives because Run is *observed* in our own editor regardless of where the code came from — we see the check even when we could not see the generation. |
| `delegation_ratio` | AI-origin chars / total chars in final artifact | Numerator comes from inferred accepts, so it inherits their precision and recall. Report with those numbers or not at all. `delegation_ratio_raw` is kept unclamped: above 1 means output was accepted then largely deleted, which is real verification behaviour. |
| ~~`regeneration_depth`~~ | ~~prompts per accepted output~~ | **Removed.** It counted prompts, and no deterministic signal detects one — a foreground AI tool plus keystrokes is equally a prompt being typed, a search being refined, or a reply being read. Not reported rather than estimated. |

`observed_ai_fraction` states how much AI time was directly observed rather
than reconstructed. With no in-portal assistant it is 0.0 whenever AI was used
at all — which is the honest number, and the reason §4.8 exists.

### 4.4 Personal baseline calibration (RQ1)

**Why.** People differ in natural pace, blink rate and expressiveness. Scoring
everyone against a population average penalises introverts, neurodivergent
candidates, and whole cultures of expression.

**How it was built.** A short calibration session (three tasks: rest, reading,
a trivial problem) captures per-second facial features via the MediaPipe Face
Landmarker task API in IMAGE mode — the same API and the same model file
Extractor A uses, since frames arrive as independent HTTP requests rather than
a decoded stream. Those yield a
Euclidean Alignment transform — R^(−1/2) for the regularised covariance — that
maps later session features into the candidate's own frame.

The transform is computed by eigendecomposition rather than a general
fractional matrix power. For a regularised covariance, which is symmetric
positive-definite by construction, `V diag(w^-1/2) V^T` is exact and real,
whereas the general routine goes through Schur + SVD and can return complex
values needing `.real` taken off them.

**The three tasks must differ behaviourally.** RQ1 asks whether alignment
removes trait variance *without destroying task signal*, which requires the
calibration window to contain more than one kind of behaviour — resting,
reading, and light cognitive load have distinct gaze and blink signatures.

Tasks therefore carry a `content` field holding the material the participant
must actually look at (the reading passage, the question to consider). A task
whose label refers to something and does not supply it silently degrades into a
second rest task, which narrows the baseline covariance the transform is fitted
on. The passage lives in the backend task definition so it is identical for
every participant and cannot drift from a second copy in the UI, and it is
deliberately neutral — calibration runs before the session, so a passage about
retries or debugging would prime the participant on the problem they are about
to be assessed on.

**Candidate-scoped, not session-scoped.** A baseline is reused across every
session that person sits and compared against at recertification, so it lives
in `data/candidates/{id}/`, not inside any one session.

**Calibration is a hard gate, and every frame is graded.**
`calibration/quality.py` judges each frame *before* it is allowed to reach
`FeatureExtractor.update()`, and each task before the candidate may move past
it. This is the one place in the system where a bad recording is worse than no
recording: the transform becomes the frame every later signal is scored in, so
a baseline captured in the dark or with a second person in shot does not fail —
it silently biases everything downstream.

The blocking conditions, all with per-candidate remedial messages:

| Class | Flags |
|---|---|
| Presence | `multiple_faces` (a second person in the room), `no_face` |
| Lighting | `too_dark`, `too_bright`, `low_contrast` (backlit silhouette), `uneven_lighting` (hard side light) |
| Framing | `off_center`, `too_far`, `too_close`, `face_cropped` |
| Voice | `mic_unavailable`, `mic_silent`, `voice_too_quiet`, `voice_clipped`, `background_noise`, `speech_too_short` |

A task passes only with ≥10 clean one-second windows from ≥75% clean frames and
no flag persisting across ≥10% of the run. A failing task is **discarded
server-side and sat again** — there is no partial credit and no attempt limit,
because an unusable baseline is not an acceptable outcome. Flags are also
streamed back per frame so a candidate sitting in the dark learns it during the
task, not after it.

A fourth task, `voice_check`, runs *first*: the candidate reads a phonetically
broad sentence aloud while the browser measures level statistics (percentile
speech/noise levels, peak, clipping, voiced fraction) with a Web Audio
`AnalyserNode`. Only those six numbers are posted — no audio leaves the machine
— and the thresholds are applied server-side, so the gate cannot be relaxed by
editing the page. It contributes **no feature rows**, so the alignment
transform is still fitted on exactly the three behavioural states above; it
runs first so a muted microphone surfaces in ten seconds rather than after 45
seconds of face tasks.

`/api/calibration/complete` refuses to write a profile until every task is
marked passed, and the profile records how it was captured (attempts and clean
ratio per task) so a later odd-looking session can be traced back to a baseline
that scraped through. On the client, `RequireCalibration` guards `/exam`
against a bookmark or a reload — onboarding is a sequence of buttons, `/exam`
is a URL.

### 4.5 Phase detection and the process graph (RQ4)

**Framing.** Temporal Action Segmentation — six phases as action classes over
a minutes-long sequence. Saying those words inherits the field's baselines,
metrics and known failure modes.

**Pipeline.** `feature_assembly` joins the event log and webcam signals onto a
common 1 Hz grid → `segmentation_model` (windowed classifier) →
`tas_metrics` (F1@10/25/50, edit score) → `run_ablation` (event-only /
webcam-only / fused, leave-one-subject-out) → `process_graph` (phase timeline →
directly-follows graph with `cycle_count`, `phase_entropy`, `backtrack_ratio`).

**Most of this layer is deliberately not reachable from the frontend** — the
ablation and the two gates are research tools you run from a terminal, and
nobody sitting an exam needs an ablation table.

The exception is the **process graph**, which Main_Idea calls "a cognitive
fingerprint" and puts in Layer 3, the Process Profile a validating organisation
reviews. It is wired: `graph.json` is written into the session directory per §3,
served by `GET /sessions/{id}/graph`, and rendered by `ProcessGraphPanel` on
`/verify`. Until a session is labelled the route 404s and the panel says so with
a link to the labeller — an empty graph would read as a participant who did
nothing rather than one nobody has annotated.

**The diagram.** Phases sit on a canonical left-to-right lane with Recovery
below it, because Recovery is not a stage of the sequence — it is where the
sequence went wrong. Each transition is an arc whose thickness is its frequency;
backtracks are dashed. Each direction bows to its own side, so a
backtrack-and-return renders as two arcs rather than one.

Three things about it are deliberate and worth not undoing:

- **Every node carries its phase name.** No six-hue categorical palette clears
  the all-pairs separation floors, and in a node-link diagram any two nodes can
  end up adjacent. Rather than pretend otherwise, identity is the label and
  colour only reinforces it.
- **Backtracks are dashed, not just coloured** — shape survives greyscale,
  print and colourblindness.
- **A table view carries the same data with no colour at all**, which the
  palette's contrast warning obliges rather than merely suggests.

The phase palette was replaced in the course of this. The previous one failed
validation twice: Recovery↔Verification at ΔE 5.5 under deuteranopia, and
Understanding↔Decomposition at ΔE 9.5 with *normal* colour vision — below the
15 floor, i.e. hard for everyone. Those two sit adjacent on the labelling
timeline, so the defect was live in the labeller too. Both modes of the
replacement pass.

Column names come from `extractors/webcam/schema.py` rather than being
restated, and latent width is discovered per session so the same assembler
handles 8 (synthetic) and 64 (real).

### 4.6 Cued-recall labelling (§4)

`labels.json` is the file every analysis module depends on and nothing else
produces. Without it the κ gate cannot run, and the κ gate decides whether the
phase taxonomy is real at all.

**Why retrospective.** §4 chose cued recall over concurrent think-aloud
deliberately: narrating a process while solving changes the process being
measured. The participant watches their own recording afterwards at 2×.

**The tool.** `/label/:sessionId` plays `screen.webm` at 2× (1×–4× available),
with a scrubbable timeline, boundary placement, and per-segment phase
assignment. Keyboard: space to play/pause, `B` to cut, `1`–`6` to assign.

**Tiling is structural.** The editor's state is boundaries plus a phase per
slot; segments are *derived*. Adding a boundary splits a segment, removing one
merges two — gaps are unrepresentable, not merely validated against. The server
re-checks anyway, because a gap resamples as phase 0 (Understanding), so two
annotators leaving the same gap would appear to agree there.

**Blinding is structural too.** `load_labels` takes one source and opens one
file, so no caller argument and no caller bug returns another annotator's
boundaries. Pairing lives in `load_for_reliability`, whose only caller is the
reliability module.

### 4.7 The reliability gate (§4)

`analysis/reliability.py` computes per-session and pooled Cohen's κ between two
annotators, plus a per-phase confusion matrix.

**The matrix is the point, not the scalar.** §4's stop rule is κ < 0.6 and its
prescribed remedy is merging the phases the annotators confuse — "κ = 0.52"
tells you to stop, only the matrix tells you what to merge. The module ranks
confused pairs by total disagreement.

Pooled κ is computed from the summed confusion matrix rather than averaged
across sessions, so a 3-minute session does not weigh the same as a 40-minute
one. Below threshold it prints §4's warning to stderr and **exits 1**, so it
gates a pipeline rather than being something someone must remember to read.

---

### 4.8 Event capture validation (§2.3)

**This is what makes a reconstructed event log usable as evidence rather than
an assertion.** §2.3's evaluation table:

> | Event capture precision/recall, per event type | Hand-annotate 5 sessions from video, diff against auto log |

The failure it prevents is quiet. If `ai_output_accepted` has recall 0.55, then
nearly half of all accepts never happened as far as the analysis is concerned —
and `verification_latency` is computed only over the ones that were caught. It
would not look broken. It would look like a tighter distribution with a smaller
n, and it would be wrong in a direction nobody could see from the output.

`analysis/event_validation.py`:

- greedy nearest-in-time matching per event type, 3 s tolerance (an annotator
  scrubbing a recording cannot place a boundary to the millisecond)
- **per-event-type** precision, recall and F1, pooled across sessions
- a floor per type, and **non-zero exit** when one fails — the same shape as
  the κ gate, for the same reason

Floors are not a universal constant; they are a judgement about how much error
the downstream claim can absorb:

| Event type | Precision | Recall | Why |
|---|---|---|---|
| `ai_output_accepted` | 0.80 | 0.70 | Feeds verification_latency and delegation_ratio |
| `ai_session_open` / `close` | 0.85 | 0.80 | Feeds external_ai_fraction |
| `verification_action` | 0.90 | 0.90 | Observed, not inferred — should be near-perfect |
| anything else | 0.70 | 0.70 | A missed `app_switch` costs a count in a feature column |

The annotator writes `events.annotated.jsonl` **from the recording**, never
from the automatic log — an annotator shown the log would be confirming it, not
checking it. The harness also reports when annotators recorded event types
nothing can capture, which is not an extractor failure but is worth knowing.

```bash
python -m problemproof.analysis.event_validation data/sessions
```

### 4.9 Cross-stream clock synchronisation (§3)

Two recordings run in parallel and §3 requires both on the same session clock.
Each recorder's claim about its own offset is only a claim; the clapperboard is
what tests it.

**What it is.** The exam page paints the whole screen white once, for 400 ms,
and logs `clock_sync_flash` with the session time it was painted at. The screen
recording sees the white directly; the webcam sees the room brighten.
`analysis/clock_sync.py` finds the brightness step in each recording's own
container PTS, converts each into a measured offset against the logged session
time, and reports how far apart the two answers are. Above 100 ms the session
is refused for fusion.

**The residual is not zero by construction.** Deriving both offsets from the
flash and differencing them would give zero on every session, including a
broken one. The flash is the independent instant; what is measured is each
recorder's *declared* offset against it, and the residual is the spread between
those errors.

**There is no clap.** `features.toml` describes the check as a clap plus a
flash. `getDisplayMedia` is requested with `audio: false`, so the screen
recording has no audio track and a clap lands in exactly one of the two
streams — it would synchronise nothing, and asking a participant to perform one
would be a ritual. The check is visual only, and the registry entry now says so.

**An undetected flash is reported, not guessed.** Whether a webcam in an
ordinarily-lit room registers a monitor flash is an empirical question nobody
has answered yet. `find_flash` returns `None` rather than the largest ordinary
fluctuation, so a session where the flash landed in one stream only is reported
unmeasured and refused for fusion. That is the honest outcome: nothing was
measured, so nothing may be fused.

**Not yet a measurement.** `capture.clock_sync` stays `stub`. Zero sessions on
disk carry a `clock_sync_flash` event, so the residual distribution the gate is
stated over has no samples. The detector, the arithmetic, the refusal and the
flash are implemented and tested — including against encoded video — and none
of that is a promotion.

```bash
python -m problemproof.analysis.clock_sync data/sessions/<id> --write
```

### 4.10 The personalisation layer (RQ5, RQ6)

Layer 0: the step that decides what a session is *about*, before any capture
happens. Numbered 0 rather than renumbering the five layers Main_Idea names.

**What it does.** A participant uploads a CV. A parser proposes skills,
projects, experience and qualifications. The participant approves, corrects or
rejects each one. An assessment is then built from **the approved set only**,
and a question and rubric are generated from it.

**The one property everything else rests on.** `extracted` and `approved` are
separate fields in `profile_graph.json`, not one list with a flag. Nothing
crosses between them except `schema.approve`, which records who did it and
when. There is no code path — and, in the API, no request shape — that promotes
a suggestion by default, on save, on timeout, or because a form round-tripped
it unchanged.

That is not caution for its own sake. RQ5's metric *is* the gap between the two
sets, so a design where approval was the default would report a precision of
1.0 by construction. And downstream, `assessment.spec.build_spec` refuses a
selection containing an unapproved node — building an assessment from a parser
suggestion asks somebody to be assessed on a skill they never said they had.

**The parser is deterministic, not a language model.** Sectioned, dictionary
and pattern based, with a stated confidence prior per extraction route. The
reason is the one recorded in
[`removed-emotion-monitor.md`](removed-emotion-monitor.md): a generative model
asked to describe an input it was given asserted evidence absent from that
input in 42 of 50 cases. A model that invents a skill from a CV produces a
claim about somebody's employment history with nothing behind it, and RQ5 would
then be measuring hallucination rate under a different name. The recall cost is
real, and `review_metrics` counts what participants had to add by hand.

This decision was checked, not just kept, against `KG/` — a second, standalone
codebase in this repository that builds a fuller resume knowledge graph using
exactly the declined architecture: an LLM pass over NVIDIA NIM plus a spaCy NER
cross-check. Reading it confirmed the call: `KG/`'s LLM extraction sends each
candidate's whole CV to a third-party API, the same privacy shape as the
emotion monitor already removed for uploading raw capture to a third party.

**One piece of `KG/` was worth adopting (2026-08-20): ESCO-grounded matching,
because it runs entirely on-device.** `profile/esco.py` is a second, optional
skill matcher — local sentence-transformer embeddings against a bundled copy
of the public ESCO taxonomy (~13,900 occupational and soft-skill concepts) —
tried only on Skills-section items the ~100-term hand-typed dictionary misses.
Off by default (`PP_ESCO_SKILL_MATCHING` unset); every test in the suite runs
without it and without `sentence-transformers` installed, because `EscoMatcher`
takes its embedding function as an injectable argument rather than importing
the model at module load.

It does not replace the dictionary. ESCO is a labour-market taxonomy with
little fine-grained tech vocabulary, so a threshold loose enough to catch
genuine matches for "team leadership" or "financial forecasting" also produces
confident nonsense for tech terms — "numpy" scores above "numerology" in the
taxonomy's own embedding space. `esco.DENYLIST_LABELS` ports the confirmed
false attractors `KG/`'s own tuning found, so the two catalogues don't quietly
diverge on terms already proven bad. The two matchers are complementary: the
dictionary is tried first and is authoritative for anything it recognises;
ESCO extends coverage into occupational and soft-skill vocabulary the
dictionary structurally cannot have. Rejected on both stays an honest, raw,
unmapped skill node — never forced onto a taxonomy concept it doesn't fit.

An accepted ESCO match adds `esco_id` and a genuinely **measured** cosine
similarity (`esco_similarity`) to the node, kept as a separate field from the
stated-prior `confidence` above rather than folded into it — the two describe
different things and conflating them would misreport both. See
`problemproof/profile/data/PROVENANCE.md` for the taxonomy's provenance and
exactly what was and was not adopted from `KG/`.

**A third tier, LLM-assisted cleanup, is the one piece that leaves the machine
(2026-08-20).** `problemproof/profile/llm_cleanup.py`, tried only on
Skills-section items that miss BOTH the dictionary and ESCO — the residue,
typically typos and formatting neither an exact-match nor a taxonomy-embedding
matcher handles well ("Pythom", "post gre sql"). It sends NVIDIA NIM the
isolated skill phrase itself and nothing else — never CV prose, a name, an
employer, or a date.

This was confirmed explicitly with the candidate-privacy question already
settled in this section: earlier, offered the choice between "ESCO-only,
stays local" and "the full LLM pipeline `KG/` uses, sends the whole CV," the
answer was ESCO-only, for the same reason the emotion monitor was removed. A
few minutes later, asked directly for "LLM cleanup," that tension was
surfaced back explicitly rather than silently built — the scope agreed on is
materially narrower than what was declined: short, already-isolated phrases
only, off by default (`PP_NIM_SKILL_CLEANUP` unset), and every proposed
correction checked before being shown.

**A correction is never trusted on the model's word.** `clean_batch` runs
every proposal through a similarity guard (stdlib `difflib`, no new
dependency) before accepting it. A typo fix keeps the string close to the
original; a model that quietly substitutes a different skill — "Go" becoming
"Google," a wrong expansion wearing the shape of a correction — does not, and
is rejected back to the raw string. This is the same risk the removed emotion
monitor is the recorded negative result for, at a smaller scale: an LLM
"correcting" a skill string can assert a different skill than the one the
candidate wrote, confidently, and the guard is what stands between that and a
participant's profile. Even a correction that clears the guard is still an
**extracted**-tier suggestion, not an approved claim — the same review, edit,
and reject path as everything else this module produces — and it carries the
original alongside it (`cleanup_original`), the same shape `schema.approve`
already uses for a participant's own edits, so a reviewer can always see, and
undo, what a correction replaced.

Offline-testable the same way as ESCO: `clean_batch` takes the NIM call as an
injected function, and every test in the suite — including the API-level test
that inspects real outgoing prompts for a name, an email, and an employer, and
confirms none of them appear — supplies a fake. No test needs a network call
or an API key.

**The graph is visualised, per candidate, right where they review it
(2026-08-20).** `ProfileGraphPanel.tsx`, in the Skills section of `/account`,
draws the candidate's own `extracted`/`approved` graph as a node-link diagram —
columns by node type, hand-drawn SVG, same construction as `ProcessGraphPanel`
(the phase-transition graph). No graph library; this frontend has never had
one and a six-type, few-dozen-node graph does not need one.

The one distinction the diagram must not lose is the one the whole feature is
built around: a node is drawn **solid** if approved and **hollow, dashed** if
still a suggestion — shape, never colour alone, because colour is reused (the
same validated six-hue `PHASE_COLORS` palette, repurposed for node type rather
than phase) and a colourblind or greyscale reading must still see the
approval boundary. The list immediately below the diagram carries the same
nodes with no colour or shape to read, and the panel says so, rather than
treating the diagram as sufficient on its own.

One geometry bug is worth recording because it was only found by rendering a
realistic graph and reading the actual coordinates, not by reasoning about the
code: `extraction.py` emits both `USED_IN` and `EVIDENCED_BY` for every skill a
project or experience mentions, so the two edges share endpoints and drew
identically on top of each other. Fixed by merging edges between the same pair
before drawing.

**No CV content leaves the candidate directory.** `cv_source.*` is stored so a
participant can see what a suggestion was read out of. Only short labels reach
the graph (`schema.assert_no_cv_prose` enforces a ceiling, the same instrument
as `events.assert_no_content`), and only a fixed allowlist of fields reaches a
generator. `tests/test_generator_payload_is_clean.py` inspects the outgoing
payload itself rather than trusting the intention.

**Question families are what make sessions comparable.** A family fixes target
competency, difficulty definition per tier, duration range, required
deliverables and rubric dimensions; the scenario adapts to the participant's
skills. The family key (`id@vN`) is stored on `question.json`, so a session
whose family is unknown cannot be placed in a comparison — which is better than
quietly comparing it anyway. Difficulty tiers T1–T4 and the domain tracks come
from Main_Idea's Problem Library Architecture, and every family declares all
seven of Main_Idea's problem-validity properties (`validate_family` refuses one
that does not).

**The generator is a template, and the registry says so.** `QuestionGenerator`
is a Protocol with two implementations. `TemplateGenerator` is deterministic,
is the default, and is what every test uses — no test needs a network or an API
key. `ProviderGenerator` exists so the boundary is real and is **not wired**:
no provider client is constructed anywhere, and `default_generator()` raises
rather than pretending if `PP_QUESTION_PROVIDER` is set. The known weakness is
that two participants at the same tier in the same family see the same frame
with their own skills in it, and `inter_question_similarity` in the RQ6 gate is
the measurement that will say what that costs.

**Candidate-scoped personal data has an owner.** A candidate id is a
browser-local UUID with no authentication behind it, which was fine when the
only thing behind one was a covariance matrix. A CV-derived graph is not, so
`candidate_owner.json` is claimed on first CV upload and never re-ownered, and
`tenancy.authorize_candidate` gates every read. It is deliberately narrower
than `authorize_session`: a reviewer may read their organisation's sessions,
and nobody's skill graph.

**Neither feature is measurable at build time.** `profile.cv_extraction` and
`assessment.question_generation` are both `stub`, both blocked on real
participants. RQ5's metric is a comparison against a participant-approved
graph and RQ6's is a set of blinded expert ratings; a synthetic CV compared
against a synthetic approval measures the fixture.

### 4.11 Organisational validation (RQ7, Layer 4)

The step between a captured session and anything a participant is shown. An
organisation reviews the record and decides whether it stands.

**Four states, one direction.**

```
participant_submitted → organization_review → validated → performance_released
```

`validation.transition` is the only writer of `state`, and it refuses a jump, a
repeat and a reversal — each with its own message, because they are different
mistakes. A reversal in particular is not an edit to an old decision; it is a
new decision about the record, and recording it as an edit would lose which of
the two actually happened.

**Submitting is the participant's act.** A captured session is not
automatically submitted for anyone to validate. `claim` records ownership at
the end of capture; `submit-for-validation` is a separate, later choice, and
conflating them would make every recording a submission.

**The annotation is frozen when review opens, not when a decision is made.**
`freeze_annotation` copies every `labels.*.json` into `annotations/v{n}/` and
records a SHA-256 of each. The reviewer therefore forms a judgement against a
record that cannot move while they read it — if it could, the decision would
attach to a version nobody saw. `verify_version` re-checks the hashes, so a
frozen version edited on disk afterwards is *detectable* rather than merely
forbidden.

The live `labels.*.json` are untouched by any of this, which is what keeps the
label tool's two structural guarantees intact: segments tile by construction,
and annotators load only their own pass. Nothing in `validation.py` calls
`load_labels` or names a source — the freeze copies bytes.

**A revision does not move the state backwards.** It is the same review
continuing against a record that is about to change, not the session leaving
the organisation. `refreeze_annotation` then creates `v2`; `v1` is never
rewritten, and `history` records which version each step was against. A queue
somebody works from has to be right about where work is, and a state that went
backwards on every revision request would make it wrong.

**A dispute does not validate anything.** `record_decision` with
`decision="disputed"` records the dispute and leaves the state at
`organization_review`. A disputed record has not been validated by anybody, and
`is_validated` is what Layer 3 reads before assembling a participant-facing
profile — so marking it validated would be the most consequential untruth this
module could tell.

**Severity is the server's.** Computed from the decision and the adjustment by
`severity_for`. The frontend previews it before submission — Frontend Spec §7.2:
a reviewer must never discover the consequence of their action afterwards — but
the preview is a copy of the rule. A client that could name its own severity
could file a full dispute as a minor note, so nothing in the request body sets
it. A test reads `OrgReview.tsx` to check the two thresholds have not drifted.

**Organisation review and the blinded expert passes do not read each other.**
The expert passes evaluate the *taxonomy* (Cohen's κ, research plan §4);
organisation review controls *participant-facing release*. An organisation
shown the inter-rater agreement is reading a research diagnostic as a
candidate's quality score; an expert pass that knew a session had already been
confirmed is no longer independent, and κ over it measures the confirmation.
Enforced structurally in both directions by an AST-level test — a text search
would fire on the paragraphs in each module explaining the rule.

**Evidence access is audited, and the page's claim about that is now true.**
The reviewer surface says "your access to this evidence is logged". Before
`GET /sessions/{id}/evidence` existed, that sentence was true of nothing. It
lists what is present rather than serving any of it, so the entry lands when
somebody starts looking rather than once per byte. Reading the trail is
deliberately *not* audited — a log that grows every time somebody checks it
buries the entries worth reading.

**Not yet a measurement.** `validation.organization_review` is `stub`. Every
number in its gate — reviewer agreement, turnaround, revision rate — is a
property of humans doing reviews, and zero reviews have happened. A lifecycle
that has never carried a real decision has measured nothing about reviewers.

### 4.12 The performance profile (Layer 3)

What a participant is actually shown, and the two conditions that have to hold
before anything is.

**Both, and neither substitutes for the other.**

| | Says |
|---|---|
| the feature is at or above the release gate | the analysis has met its evidence standard **as a method** |
| the session reached `validated` | a human organisation stood behind **this particular record** |

A profile assembled on one alone is either an unvalidated method applied to a
reviewed record, or a validated record described by numbers nobody has shown to
mean anything. `performance_profile.assemble` refuses before validation and
checks the gate per section.

**The gate runs at assembly, which is the serialisation boundary.** Not at
compute time. `analysis/` keeps running, keeps writing `graph.json` and
`signals.parquet`, and stays readable by anything that opens the session
directory. This module decides what crosses into a participant-facing artefact,
and it is the only place that decision is made — a second enforcement point
would be two rules that can disagree.

**Eight sections, each naming the feature that governs it.** Assessment
context, rubric outcome, phase composition, process structure, verification and
recovery, AI/tool interaction, personal baseline, validation record. The
mapping is a declared table, so "which gate governs this number" is answerable
by reading one list rather than tracing a call path. A section with no feature
behind it would be a number with no evidence standard, which is the thing the
registry exists to prevent — a test asserts every section names a feature that
is actually in the registry.

**Withheld is never empty-by-omission**, and there are three states, not two:

| State | Means |
|---|---|
| not assembled | the record has not been validated. A person is the blocker, not a measurement |
| withheld | validated, and the analysis behind a section has not met its standard |
| released | the section renders, carrying its registry status and its evidence references |

`AwaitingValidationState` and `BelowGateState` are separate components for that
reason: the remedies differ, and collapsing them would tell a reader to wait for
the wrong thing. The reason string always comes from the registry — a hardcoded
sentence would drift from the actual status the first time a feature moved, and
would keep reading plausibly while it did.

**Today every session lands in one of the first two states.** Zero features sit
at or above `pilot`, so a correctly built dashboard renders the withheld notice
and nothing else. That is the expected output of this layer, and
`test_performance_profile.py` asserts it rather than working around it.

**Nothing forbidden reaches a profile.** `assert_profile_clean` walks the whole
object and refuses any affect or emotion label (§2.2, Barrett et al., and the
removed emotion monitor is the recorded reason), captured content, biometric
representation, or CV prose. Two passes — an exact-name blocklist and a
substring scan — because the exact list can only enumerate what we already
thought of. Checked at assembly and again at write.

One near-miss is worth knowing about, because it is the kind of thing that gets
"fixed" by loosening the list. The assessment context carries the problem
statement under `statement`, **not** `prompt`. `prompt` is forbidden because in
this system it means text a participant sent to an AI tool — captured content,
never recorded. The problem statement is text we generated and gave to them,
and they are entitled to see it. Same word in English, opposite provenance; the
field names are what keep them apart.

## 5. Running the project

### Prerequisites

- Python 3.11 (the repo's `llms_new` conda environment)
- Node 18+
- A webcam for calibration and Stream A; a real desktop for the OS-level agent

### Backend

```bash
cd backend
pip install -r requirements.txt
python main.py                 # http://localhost:8000
```

`GET /health` → `{"status": "ok"}`. Interactive API docs at `/docs`.

### Configuration — one `.env` for the whole project

```bash
cp .env.example .env      # at the repository root
```

Both halves read that one file: the backend loads it at its entrypoints
(`problemproof/env.py`), and Vite reads it via `envDir: ".."`. Real environment
variables win over it, so container-injected values override without editing.

**Secrets are safe in it, with one rule: never prefix a secret with `VITE_`.**
Vite bundles every `VITE_`-prefixed variable into client JavaScript; everything
else stays server-side. There are no secrets in the template today — the AI
model backend was removed with the panel — but the rule is enforced by a test
so that adding one later cannot leak it by accident.

| Variable | Default | Purpose |
|---|---|---|
| `PP_DATA_ROOT` | `backend/data` | Where sessions and candidates are stored |
| `PP_HOST` / `PP_PORT` | `127.0.0.1` / `8000` | Bind address |
| `PP_RELOAD` | unset | Set to enable auto-reload |
| `PP_CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `PP_FACE_LANDMARKER_MODEL` | bundled | Override the `.task` model path |
| `PP_QUESTION_PROVIDER` | unset | Named provider for question generation; unset uses the deterministic template generator, which is what every test runs against |
| `PP_ESCO_SKILL_MATCHING` | unset | Set to exactly `on` to enable ESCO-grounded skill matching (needs `sentence-transformers`; raises rather than silently falling back if it can't run) |

There is no AI model backend to configure. Participants use their own tools;
that use is reconstructed from capture (§4.3).

### Frontend

```bash
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

| Script | Does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) then production build |
| `npm run preview` | Serve the production build |
| `npm run lint` | ESLint |

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_PP_API_URL` | `http://localhost:8000` | Backend base URL |
Only `VITE_`-prefixed variables reach the browser, and they live in the same
root `.env` as everything else. There is no AI model backend to configure —
see [§4.3](#43-reconstructing-ai-use-rq3-the-novel-schema).

### The desktop capture agent

Needs a real display — screen capture and input tracking cannot run headless.

```bash
cd backend
python -m cli.screen_agent --session-id 1785067393164 --duration 3600 \
                           --workspace-dir ./candidate_workspace
```

Pass `--session-id` to join a session the browser already started, so the
desktop capture lands beside that session's webcam recording. Omit it and the
agent mints its own. A consent notice prints before capture begins.

### Extracting webcam signals from a recording

```bash
cd backend
python -m cli.webcam_extract data/sessions/<id>/webcam.webm \
                             --out data/sessions/<id>/signals.parquet
```

### The analysis pipeline

```bash
cd backend

# event capture validation — needs hand-annotated sessions (§2.3)
python -m problemproof.analysis.event_validation data/sessions

# reliability gate — needs two annotators on the same sessions (§4)
python -m problemproof.analysis.reliability data/sessions

# clapperboard residual — needs a session recorded with the flash (§4.9)
python -m problemproof.analysis.clock_sync data/sessions/<id> --write

# process graphs — one per labelled session, written into the session dir
python -m problemproof.analysis.process_graph

# the RQ4 ablation — defaults to the real session store
python -m problemproof.analysis.run_ablation
```

To exercise the code path before real data exists:

```bash
python -m problemproof.analysis.gen_synthetic_data
python -m problemproof.analysis.run_ablation --synthetic
python -m problemproof.analysis.process_graph problemproof/analysis/data
```

A synthetic run prints a banner and **refuses to interpret its own numbers** —
see [§9](#9-current-state-real-vs-not-yet).

### Calibration pipeline (standalone)

```bash
cd backend
python -m problemproof.calibration.pipeline pipeline   # synthetic, no camera
python -m problemproof.calibration.pipeline week1      # live webcam check
python -m problemproof.calibration.pipeline extract --duration 90 --subject_id p01
```

---

## 6. The full session walkthrough

1. **Onboarding** (`/onboarding`) — consent, camera + microphone permission,
   then calibration. The first click **starts the whole-screen recording**,
   which runs from here until submit. A microphone check followed by three
   short tasks (rest, reading a supplied passage, light cognitive load) posts
   four frames per second to `/api/calibration/frame`; each task is then graded
   by `/api/calibration/task/complete` and repeated until it passes;
   `/api/calibration/complete` derives and stores the alignment transform under
   `data/candidates/{id}/baseline.json`. None of this can be skipped — no
   camera, no microphone or no passing calibration means no session (§4.4).

2. **Start the desktop agent** — `python -m cli.screen_agent --session-id <id>`.
   Without it there is no window tracking, no clipboard length and no site
   categories, so nothing about tool use can be reconstructed.

3. **The session** (`/exam`) — the participant solves the problem using
   whatever tools they like. Running concurrently:
   - the whole-screen recording, started in step 1, still going
   - `useSessionRecorder` — one continuous webcam clip
   - `useEventLogger` — in-tab metadata at session-relative `t_ms`
   - the desktop agent — foreground window, clipboard length, site category
   - the phase rail, which is a **navigation aid, not a label source**

   The exam portal has no AI panel and no recording controls.

4. **Submit** — one `session_id` for every stream. The screen recording stops
   and uploads; the webcam clip uploads and extraction starts as a background
   job; the event log uploads. None of it blocks navigation.

5. **Verify** (`/verify`) — the **process record**: where the time went by site
   category, observed-vs-inferred event counts, and the event log with inferred
   rows marked. Plus `CognitiveSignalPanel` polling the extraction job.

6. **Reconstruct** — `inference.py` turns the raw capture log into
   `source="inferred"` AI events.

7. **Validate the reconstruction** — a human annotates the recording, then
   `event_validation.py` reports per-event-type precision/recall (§4.8). Until
   this clears, no metric derived from inferred events is reportable.

8. **Label** (`/label/:sessionId`) — retrospective cued recall at 2×, then two
   experts independently as `expert_a` / `expert_b`.

9. **Gate** — `reliability.py`. If pooled κ ≥ 0.6, proceed; if not, merge the
   confused phases and re-run.

10. **Analyse** — `run_ablation.py`.

## 7. Testing

```bash
cd backend
pytest                          # 861 tests: 860 pass, 1 skips (see below)
pytest tests/test_events_schema.py -v
```

```bash
cd frontend
npm run build                   # tsc -b is the type-level test
```

Tests assert **contracts and placement**, not just status codes. The largest
suites:

| Suite | Tests | Covers |
|---|---|---|
| `test_geometry.py` | 41 | Head pose, EAR, gaze maths |
| `test_events_schema.py` | 39 | Content prohibition; `inferred` restricted to what capture establishes |
| `test_labels_contract.py` | 29 | Tiling, multi-source coexistence, blinding |
| `test_storage.py` | 27 | Path traversal rejection, session/candidate scopes |
| `test_external_ai_detection.py` | 21 | Tool detection, hashed titles, no content in external events |
| `test_ai_metrics.py` | 20 | Derived metrics; no session-level column in the feature table |
| `test_reliability.py` | 19 | κ correctness, confusion matrix, the stop rule |
| `test_labeling_api.py` | 18 | Tiling enforcement and annotator blinding |
| `test_env_config.py` | 16 | One root `.env`; no secret carries the `VITE_` prefix |
| `test_calibration_api.py` | 26 | EA maths, baseline storage, route contracts, the per-task gate |
| `test_calibration_quality.py` | 33 | Every blocking flag — presence, lighting, framing, voice — and the task verdict |
| `test_timestamp_contract.py` | 12 | Session-relative `t_ms` across all producers |
| `test_calibration_landmarks.py` | 12 | Face detection uses an API that exists, detects a real face, and can see a second one |
| `test_no_synthetic_results.py` | 10 | Synthetic data cannot be presented as a result |
| `test_process_graph.py` | 16 | §3 edge keys, aggregation, written into the session directory |
| `test_graph_api.py` | 15 | Serving the graph; the validated palette; arcs that do not overlap |
| `test_calibration_ui_contract.py` | 17 | Camera attaches via effect; no side effects in state updaters; no path around the gate |
| `test_phase_rail_is_not_a_label.py` | 6 | The rail cannot reach `labels.json` |

Several tests read the **frontend source** to check the TypeScript mirror still
agrees with the Python contract — event type names, snake_case attributes, the
`source: "portal"` literal, and that no log call uses a raw `performance.now()`.

The desktop agent's analysis half (`feature_extractor`, `inference`, `validate`)
imports no capture library, which is why it stays testable in CI while screen
capture does not.

**Not yet covered by tests:** `lib/screenCapture.tsx`,
`analysis/event_validation.py`, and the site categoriser. All three are
exercised manually but have no committed test file.
`extractors/screen/inference.py` has `tests/test_accept_inference.py` and
`tests/test_accept_inference_is_wired.py`.

## 8. Design decisions worth knowing

### No emotion categories

The exam portal once ran a live emotion classifier over webcam clips. It was
removed. Three reasons, recorded in full in
[`removed-emotion-monitor.md`](removed-emotion-monitor.md):

1. §2.2 forbids emitting emotion categories, citing Barrett et al. (2019) —
   facial configuration does not map reliably or specifically to emotional
   state, and this output fed a record meant to support hiring decisions.
2. It uploaded raw webcam clips to a third-party endpoint whose URL the
   *candidate* pasted in, which is the inverse of the on-device privacy
   commitment.
3. It did not work. Against 50 DAiSEE clips the model cited evidence absent
   from its input — vocal tone, gestures "throughout the video" — in 42/50
   responses, having received a single still frame and no audio.

The implementation is preserved on branch `archive/emotion-llama`.

**This also settled the screen-analysis question.** Using a vision-language
model to label what is happening on screen is the same architecture that
produced reason 3 — a model narrating a video it was never shown. Event
detection therefore uses deterministic signals (foreground window, clipboard
length, keystroke timing) and the recording is evidence a human annotates
against, not model input.

### The timestamp base is the whole ballgame

§3 requires each stream's `t_ms` relative to the session's `t0_epoch_ms`, with
each recorder writing its own `clock_offsets` entry.

The desktop agent originally emitted wall-clock `ts_unix`. No offset applies to
an unmapped wall-clock value, so that stream cannot be aligned with the webcam
afterwards — **and §3's clapperboard test would not catch it**, because that
measures residual drift between two streams already on the session clock. The
failure is silent: the log parses, sorts, and produces a feature table that
looks fine. It is only wrong when fused.

Every producer now converts at write time. `events.assert_session_relative`
rejects anything outside `[0, duration]`, and a dedicated test suite pins it.

### Provenance is in the data, not in a comment

`source` distinguishes `portal` (observed) from `inferred` (reconstructed).
An analysis that treats them identically is asserting the reconstruction is
perfect — which is exactly the claim §4.8 exists to test. The restriction is
enforced two ways: `events.INFERRABLE_TYPES` rejects an inferred
`prompt_submit` at runtime, and the TypeScript union types the browser's one
event as `source: "portal"` literal so it cannot construct an inferred one at
all.

### The whole screen, verified rather than requested

`displaySurface: "monitor"` is a hint browsers may ignore. A window-scoped
share would capture only the exam portal — the one place nothing interesting
happens — and would do so silently. So the choice is checked afterwards
(`track.getSettings().displaySurface`) and rejected if wrong.

### No content, at category granularity

Site activity is logged as `reference`, `documentation`, `ai_tool` — never a
URL, page title or search query. §2.3 captures "domain category" and "query
initiated (yes/no), tool used"; Main_Idea §10 commits to "timing and frequency
— not keystrokes, not text". Clipboard **length** is captured because §2.3
Build A sanctions exactly that, and it is what makes an accept inferrable.

### A metric with no signal is removed, not estimated

`regeneration_depth` counted prompts. Nothing deterministic detects a prompt,
so it is gone rather than approximated from AI-tool focus episodes. The two
uncapturable event types are listed in `events.UNCAPTURED_TYPES` so a consumer
can tell "did not happen" from "cannot be seen".

### No session-level metric in the feature table

`verification_latency` and `delegation_ratio` are computed over the whole
session. Repeating them per row of `feature_vectors.csv` would
hand the segmentation model a feature derived from that interval's *future* —
`delegation_ratio` most obviously, since its denominator is the final artifact.
They live in the session manifest. The CSV keeps only time-varying counts.

### One file per label source

`labels.{source}.json` rather than one array with all sources appended. Two
annotators on one session is the normal case for the κ gate, so a shared file
means read-modify-write on every save and one pass can silently drop another.
It also makes blinding structural rather than procedural.

### The phase rail is not a label

The exam portal's live phase buttons emit `phase_marker_clicked` carrying
`marker_index` — an integer, with no member of the phase vocabulary in the
payload. It is absent from `EVENT_TYPES` so it cannot become a model feature,
it writes to `events.jsonl`, and `labels.json` has exactly one writer. All four
properties are pinned by tests.

§4 chose retrospective cued recall precisely to avoid concurrent methods
changing the process being measured, so these clicks are navigation only.

### Everything untrusted is validated at the boundary

`session_id` and `candidate_id` arrive as URL path parameters. `storage.py`
validates both against `[A-Za-z0-9_-]` before building any path, and rejects
traversal-shaped input rather than resolving it.

---

## 9. Current state: real vs. not yet

Being precise about this matters more than it sounds.

### What works on real data today

- **Extractor A**, end to end. `backend/data/sessions` holds 7 real webcam
  recordings, 5 with real extracted `signals.parquet`. Re-running extraction
  produces genuine measurements.
- Every API route, the labelling tool, the reliability module, the inference
  module and the validation harness are implemented and exercised.

### What has no real data yet

| | Sessions with it |
|---|---|
| `signals.parquet` | 5 of 7 |
| `events.jsonl` | **0** |
| `events.annotated.jsonl` | **0** |
| `session_manifest.json` | **0** |
| Labels | **0** |
| `clock_sync` residual (§4.9) | **0** |

`events.annotated.jsonl` at zero is why `AcceptConfig.provenance` is still
`unfitted-intuition`: `fit_accept_thresholds` has nothing to fit against and
exits 2. The accept inference now runs in the capture pipeline, so an
agent-captured session produces `ai_output_accepted` rows and a
`verification_latency` — but the count they rest on is refused at read time
(`inference.read_accept_count`) until the thresholds behind it have been
validated against annotation.

**Zero sessions are trainable**, and zero have been through either gate. The
binding constraints are human: labels come from a ~30-minute cued-recall pass
per session, event validation from hand-annotating 5 sessions, and per §4
recording participants at all requires IRB approval first. The existing
recordings are 12–104 seconds — test captures, not the 40-minute sessions §4
specifies.

### Two gates stand between capture and any claim

| Gate | Module | Stop rule |
|---|---|---|
| Event capture accuracy | `analysis/event_validation.py` | Per-event-type precision/recall floor; exits non-zero |
| Phase construct validity | `analysis/reliability.py` | Pooled Cohen's κ < 0.6; exits non-zero |

Neither has run on real data, because neither has real data to run on. Until
they do, `verification_latency` and `delegation_ratio` are code paths rather
than findings.

### Synthetic data is quarantined, not hidden

`gen_synthetic_data.py` exists so the pipeline can be exercised before
collection. Three guards keep its output from being mistaken for a result:

1. `latent_*` columns are **pure noise** — they previously carried
   `0.3 * PHASES.index(phase)`, which made the webcam modality look
   informative when the informativeness came from that one line.
2. `run_ablation` defaults to the real session store, needs `--synthetic` to
   opt in, prints a banner, and **refuses to print an interpretation** of a
   synthetic run.
3. The calibration pipeline no longer labels synthetic output "HEADLINE
   RESULT (this is the RQ1 answer)".

**Still true:** `PHASE_PROFILES` makes blink rate and motion energy
phase-correlated by construction. That is what makes the synthetic timeline a
plausible story at all, so it is kept — but the webcam-only column is still not
a measurement even with the latents neutralised.

### Known contract divergences

- `baseline_profile.json` — §3 specifies `subject_id` and a 32-dimensional
  `subject_embedding`. The calibration module writes `candidate_id` and no
  embedding. **Unresolved.**
- `labels.{source}.json` — §3 names the file `labels.json` with `source`
  inside. The split-file layout is a deliberate, documented deviation.
- ~~`graph.json` edge key `from_` and location `analysis/out/`~~ — **fixed.**
  The key is `from` per §3, the file is written into the session directory, and
  it is served to `/verify`.
- `source: "portal" | "inferred"` and `ai_session_close` — extensions to §2.3,
  documented as such in `events.py`. The plan assumes an instrumented surface
  and so needs neither.

### Out of scope

V-JEPA / Extractor B latents, distillation, the invertibility experiment,
MS-TCN++, `pm4py` / `grakel`, FrameHopper keyframe skipping. All downstream of
having real labelled data.

## 10. Repository map

```
CSE499/
├── .env.example                    ONE config file for the whole project
├── backend/
│   ├── main.py                     uvicorn entrypoint
│   ├── requirements.txt            one environment for every layer
│   ├── cli/
│   │   ├── webcam_extract.py       Extractor A CLI
│   │   └── screen_agent.py         desktop capture agent CLI
│   ├── problemproof/
│   │   ├── env.py                  loads the root .env at entrypoints
│   │   ├── storage.py              session + candidate paths, traversal guard
│   │   ├── events.py               §2.3 event contract; portal vs inferred
│   │   ├── labels.py               §3 labels contract + tiling rule
│   │   ├── api/
│   │   │   ├── app.py              factory; mounts four routers
│   │   │   ├── routes.py           Extractor A
│   │   │   ├── capture.py          Stream B intake
│   │   │   ├── labeling.py         recording + labels
│   │   │   ├── calibration.py      baseline calibration
│   │   │   └── jobs.py             background job runner
│   │   ├── extractors/
│   │   │   ├── webcam/             Stream A — schema.py owns the contract
│   │   │   └── screen/             Stream B — agent, config, event_logger,
│   │   │                           inference.py, feature_extractor, validate
│   │   ├── validation.py           RQ7 — Layer 4 lifecycle, frozen annotation
│   │   │                           versions, the reviewer audit trail
│   │   ├── performance_profile.py  Layer 3 — assembly, the gate at the
│   │   │                           serialisation boundary, content prohibition
│   │   ├── profile/               RQ5 — CV to skill graph; schema.py keeps
│   │   │                           extracted and approved apart; esco.py is
│   │   │                           the optional ESCO-taxonomy matcher
│   │   ├── assessment/            RQ6 — question families, exam spec, the
│   │   │                           generator boundary
│   │   ├── calibration/            RQ1 — Euclidean Alignment;
│   │   │                           quality.py owns the capture gate
│   │   └── analysis/               segmentation, ablation, process_graph,
│   │                               reliability.py, event_validation.py
│   ├── tests/                      861 tests
│   └── data/                       sessions + candidates (gitignored)
├── frontend/
│   └── src/
│       ├── App.tsx                 ScreenCaptureProvider wraps the router
│       ├── pages/                  Landing, Onboarding, Candidate, Employer,
│       │                           Exam, Verify, Label
│       ├── components/             FaceMeshPreview, AudioMeter,
│       │                           CalibrationSession, RequireCalibration,
│       │                           CognitiveSignalPanel,
│       │                           ProcessRecord, ProcessGraphPanel
│       └── lib/                    api, screenCapture, eventLogger, labeling,
│                                   calibration, voiceCheck, sessionRecorder,
│                                   webcamExtraction, exportSession, sessions
├── docs/
│   ├── research-plan.md            THE SPEC
│   ├── SYSTEM.md                   this document
│   ├── Main_Idea.md                concept document
│   ├── extractor_a.md              Extractor A design note
│   ├── vram_budget.md              measured VRAM, per module
│   └── removed-emotion-monitor.md  negative result
└── Papers/                         background research
```

### Frontend routes

| Path | Page | Purpose |
|---|---|---|
| `/` | Landing | Entry page |
| `/onboarding` | Onboarding | Consent, camera check, calibration — **screen recording starts here** |
| `/candidate` | Candidate | Candidate dashboard |
| `/account` | Account | Identity (display name, pronouns, biometric enrolment) **and** the skill profile: review what the CV parser proposed, approve/correct/reject. Merged 2026-08-19 — see below |
| `/profile` | — | Redirects to `/account`. The CV/skill-graph review lived here through Phase 1; both pages answered "who am I to this system" under different names |
| `/assessment` | Assessment | Choose skills, family, difficulty, duration, tool policy; see the generated question |
| `/org` | OrgQueue | Submission queue with lifecycle state per row |
| `/org/review/:sessionId` | OrgReview | Validator dashboard: lifecycle, evidence, decision, audit trail |
| `/employer`, `/employer/review/:id` | — | Redirect to the `/org` equivalents |
| `/exam` | Exam | The session. No AI panel, no recording controls |
| `/verify` | Verify | The process record — **recording stops at submit** |
| `/label/:sessionId` | Label | Cued-recall phase labelling |

### API routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `POST` | `/sessions/{id}/webcam` | Upload Stream A recording |
| `POST` | `/sessions/{id}/extract` | Start extraction; returns `job_id` |
| `GET` | `/jobs/{job_id}` | Poll extraction status |
| `GET` | `/sessions/{id}/signals` | Feature table (`?format=json\|parquet`) |
| `POST` | `/sessions/{id}/screen` | Upload the whole-sitting screen recording |
| `GET` | `/sessions/{id}/screen` | Stream recording (Range-capable, for the labeller) |
| `POST` | `/sessions/{id}/events` | Upload event log + 1 Hz features |
| `GET` | `/sessions/{id}/events` | Read event log (the process record) |
| `POST` | `/sessions/{id}/labels?source=` | Store one annotator's pass |
| `GET` | `/sessions/{id}/labels?source=` | Read own pass (blinded) |
| `GET` | `/sessions/{id}/label-sources` | Which sources exist (names only) |
| `GET` | `/sessions/{id}/graph` | The §3 process graph, once the session is labelled |
| `POST` | `/candidates/{id}/cv` | Upload a CV and extract a graph. Approves nothing |
| `GET` | `/candidates/{id}/profile-graph` | Both halves of the graph, plus the RQ5 counts |
| `PUT` | `/candidates/{id}/profile-graph` | One review action: approve, reject, or add_claim |
| `GET` | `/assessment/families` | The families and the settings vocabulary |
| `POST` | `/sessions/{id}/exam-spec` | Record the skill selection and settings |
| `GET` | `/sessions/{id}/exam-spec` | Read it back |
| `POST` | `/sessions/{id}/question` | Generate from the approved subgraph. Takes no body |
| `GET` | `/sessions/{id}/question` | The stored question and rubric |
| `POST` | `/api/sessions/{id}/submit-for-validation` | The participant's own act. Enters the lifecycle |
| `GET` | `/api/sessions/{id}/validation` | The lifecycle record. The participant can read their own |
| `POST` | `/api/sessions/{id}/review/open` | Freeze the annotation and take the session into review |
| `POST` | `/api/sessions/{id}/review/decide` | Confirm, adjust or dispute. Severity is recomputed server-side |
| `POST` | `/api/sessions/{id}/review/request-revision` | Records the request. Changes no state |
| `POST` | `/api/sessions/{id}/review/refreeze` | Freeze the revised annotation as a NEW version |
| `POST` | `/api/sessions/{id}/review/release` | The last transition. Does not override the release gate |
| `GET` | `/api/sessions/{id}/evidence` | What evidence exists — and the audit record that it was read |
| `GET` | `/api/sessions/{id}/validation/audit` | The trail, scoped to the caller's organisation |
| `GET` | `/api/health` | Calibration liveness |
| `GET` | `/api/calibration/tasks` | The voice check + three calibration tasks, with their material |
| `POST` | `/api/calibration/start` | Begin a calibration session |
| `POST` | `/api/calibration/frame` | Submit one frame; returns its quality flags |
| `POST` | `/api/calibration/task/complete` | Grade one finished task — pass, or retry with reasons |
| `POST` | `/api/calibration/complete` | Derive and store the baseline (refuses unless every task passed) |
| `GET` | `/api/baseline/{candidate_id}` | Read a stored baseline |
| `POST` | `/api/session/align` | Align a feature vector to a baseline |
