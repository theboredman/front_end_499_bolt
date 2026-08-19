# ProblemProof — Research & Implementation Plan

**Four modules, four research questions, one shared dataset.**
Reframed from product spec → empirical study. Semester-scale (14 weeks).

---

## 0. The Reframe

The original document describes a product with five layers. As a research project that
does not work: every layer individually is solved engineering, and "we built the pipeline"
is not a contribution.

The reframe holds the same four modules but attaches a **falsifiable question** to each.
The unifying thesis:

> **Latent-space multimodal modeling of AI-assisted problem solving, under a privacy budget.**
> Every existing dataset of human problem-solving process predates LLM assistants. We
> characterise what solving-with-AI looks like behaviourally, and we measure how much of
> that signal survives when you refuse to transmit raw face video.

Two things make this defensible rather than derivative:

1. **The post-LLM gap is real and time-limited.** Nobody has a labeled corpus of
   AI-mediated problem solving. That window closes in roughly 18 months.
2. **The privacy claim becomes testable.** JEPA-family encoders predict in representation
   space and never reconstruct pixels. If you can show those representations are not
   invertible to identity, "signals leave the device, not video" stops being marketing and
   becomes a measured result.

---

## 1. The Four Research Questions

| # | Owner | Module | Research question | Novelty claim |
|---|---|---|---|---|
| RQ1 | Tasfiah | Baseline calibration | Does within-subject alignment remove trait-level variance without destroying task signal? | Fairness intervention with a measured effect size, not an assertion |
| RQ2 | Galib | Webcam extraction | Are on-device latent representations of facial dynamics invertible to identity? | Turns a privacy promise into a measurement |
| RQ3 | Amatul | Event log | Does verification latency after accepting AI output predict solution correctness? | A behavioural metric that only exists post-LLM |
| RQ4 | Marium | Phase detection | What is the marginal contribution of the webcam over the event log alone? | The ablation that decides whether Layer 1 should exist |

**RQ4 is the paper's spine.** Both outcomes are publishable:

- Event-log-only recovers ≥90% of fused F1 → *"the invasive modality is not worth its cost."*
  Counterintuitive, and it kills a bad product decision before you build it.
- Webcam adds substantially → you have empirically justified a design everyone else asserts.

---

## 2. Implementation Spec — Per Module

Each module is built against the shared data contracts in §3, so all four can be developed
in parallel against synthetic data before any real session is recorded.

---

### 2.1 Tasfiah — Personal Baseline Calibration

**Build**

A three-part calibration battery, run immediately before the real session (~4 min total):

| Task | Duration | What it establishes |
|---|---|---|
| Rest / fixation cross | 30 s | True resting blink rate, motion floor |
| Neutral reading passage | 90 s | Reading-state blink suppression, gaze sweep pattern |
| Trivially easy problem | 90 s | Motor/interaction pace under no cognitive load |

The third task matters most and is the one people skip: it separates *"this person types
slowly"* from *"this person is thinking hard."*

**Method**

Do not invent a normalization scheme. Use **Euclidean Alignment**, the standard cross-subject
transfer baseline from BCI/EEG:

1. Per subject, compute the covariance matrix of the calibration feature vectors.
2. Whiten by the inverse square root of the mean covariance.
3. Apply the same transform to that subject's session features.

Then, optionally, a **subject embedding**: a small MLP over calibration features → 32-d
vector, trained contrastively (same-subject windows are positives). Feed it to Marium's
model as a FiLM conditioning vector.

**Stack:** `numpy`, `scipy`, `pyriemann` (has EA implemented), `scikit-learn`.

**Evaluation**

| Metric | What it answers |
|---|---|
| ICC(2,1) per feature, pre vs. post alignment | How much variance is subject identity? |
| Variance decomposition: subject / task / residual | Did alignment move variance from subject → task? |
| Downstream F1 with vs. without alignment | Did it help or just smooth everything flat? |
| Max group gap across expressiveness terciles | The fairness result — does it shrink? |

The failure mode to watch: alignment that removes *all* between-person variance is not
fairness, it is destroying signal. Report both numbers together.

**Deliverable:** `calibrate.py` → `baseline_profile.json` conforming to §3.

---

### 2.2 Galib — Webcam Capture & On-Device Signal Extraction

**Build two extractors in parallel.** You need both — one is the paper's baseline, one is
the paper's contribution.

**Extractor A — hand-crafted (the baseline a reviewer will demand)**

MediaPipe Face Landmarker @ 30 fps, 640×480, features pooled to 5 Hz:

- `blink_rate_hz`, `ear_mean`, `ear_std` (eye aspect ratio → blink detection)
- `gaze_dispersion` (angular SD over window), `gaze_screen_fraction` (iris landmarks)
- `head_pose_stability` (SD of yaw/pitch/roll via `solvePnP`)
- `motion_energy` (mean absolute frame difference, face crop only)

**Extractor B — learned latent**

V-JEPA 2.1 as frozen teacher. Version matters here: V-JEPA 2 was tuned for global scene
semantics, while 2.1's whole contribution is **dense** features with spatial-temporal
consistency. Gaze and blink are local facial dynamics, so 2.1 is the right tool and 2 is not.

- Face crop → V-JEPA 2.1 encoder → patch embeddings → pool to one 64-d vector per 1 s window.
- ViT-G will not run on a laptop. **Distil** to a small student (MobileNetV4 or a tiny ViT),
  L2 loss on L2-normalised teacher embeddings, trained on your own collected video.

**The actual research contribution — invertibility**

Train an adversarial decoder (small U-Net) to reconstruct the face crop from the emitted
embedding. Then measure whether it worked:

| Metric | Interpretation |
|---|---|
| ArcFace / InsightFace cosine similarity (original vs. reconstructed) | <0.15 ≈ chance, >0.4 ≈ identifiable |
| LPIPS, SSIM | Perceptual reconstruction quality |
| Same, at multiple encoder depths | Where does identity information actually die? |
| Same, with additive noise at increasing σ | The privacy–utility curve |

The deliverable claim: *"we transmit representations from which identity cannot be recovered
above X, while retaining Y% of downstream phase-detection F1."*

**Hard constraint on the schema:** do **not** emit `frustration`, `confusion`, or any emotion
category. Facial-configuration → emotion inference does not survive review (Barrett et al.,
2019), and consumer webcam conditions make it worse. Emit the low-level signals above and
let Marium's model learn whatever mapping exists.

**Stack:** `mediapipe`, `opencv-python`, `torch`, `transformers` (V-JEPA 2.1 checkpoints),
`insightface`, `lpips`.

**Deliverable:** `webcam_extract.py` emitting `signals.parquet`; invertibility report with
the privacy–utility curve; latency/model-size table on target hardware.

---

### 2.3 Amatul — Screen Recording & Structured Event Log

Two independent outputs. The video is for human review; the event log is what the model eats.

**Build A — the event capture layer**

- Keystroke *timing* via `pynput` — timestamps only, content discarded at the callback, never
  buffered.
- Active-window → app name via `psutil` + platform API, polled at 2 Hz.
- Clipboard events: length and timestamp only.
- Browser events (tab open/close, domain category, AI-tool detection) realistically need a
  small extension. If that is too much, constrain the study to a controlled browser profile
  and scrape from the browser's own history DB post-session.

**Build B — the AI-interaction taxonomy (this is the novel schema)**

This is the part that does not exist in ProgSnap2, Blackbox, or any prior corpus:

| Event | Attributes captured | Never captured |
|---|---|---|
| `ai_session_open` | tool_id, t_ms | — |
| `prompt_submit` | prompt_length, t_ms | prompt text |
| `response_received` | response_length, latency_ms | response text |
| `ai_output_accepted` | char_count, target_file | the content |
| `ai_output_rejected` | regenerate \| abandon | — |
| `verification_action` | kind: run \| test \| dwell \| lint | — |

Derived metrics — these are the paper:

- **`verification_latency`** = t(first `verification_action`) − t(`ai_output_accepted`)
- **`delegation_ratio`** = AI-origin chars in final artifact / total chars
- **`regeneration_depth`** = prompts issued per accepted output

**Build C — screen video with redundancy skipping**

Screen recordings are >95% static, far more redundant than natural video. Apply the
FrameHopper pattern (your own advisor's paper — cite it):

- Record at 5 fps via `ffmpeg`.
- Perceptual hash each frame (`imagehash.phash`); drop frames whose Hamming distance from the
  last kept frame is below threshold.
- Store kept keyframes + a timestamp index. Report compression ratio — expect 20–50×.

**Evaluation**

| Metric | Method |
|---|---|
| Event capture precision/recall, per event type | Hand-annotate 5 sessions from video, diff against auto log |
| Storage reduction | Keyframes kept / total frames |
| **Does `verification_latency` predict correctness?** | Spearman ρ; logistic regression vs. baselines: time-on-task, total edits, num AI calls |

That last row is RQ3. If verification latency beats time-on-task at predicting solution
quality, you have a cheap, privacy-free proxy for reasoning quality — and that finding
stands on its own even if every other module fails.

**Stack:** `pynput`, `psutil`, `ffmpeg-python`, `imagehash`, `pandas`, `statsmodels`.

**Deliverable:** `events.jsonl`, `screen_keyframes/`, event-capture validation report.

---

### 2.4 Marium — Phase Detection & Process Graph

**Frame this as Temporal Action Segmentation.** Your six phases are action classes over a
minutes-long sequence. Say the words "temporal action segmentation" in the paper and you
inherit the field's baselines, metrics, and known failure modes for free.

**Build A — feature assembly**

Resample event log + webcam signals onto a common 1 Hz grid using the master timestamp.
Output a (T × D) matrix per session. Event types become one-hot counts per bin plus
inter-event timing features.

**Build B — the segmentation model**

- **MS-TCN++** first. Small, well-documented, survives small datasets. This is your baseline.
- **ASFormer** second, if time allows.
- Keep the standard MS-TCN smoothing loss (truncated MSE over log-probs) — over-segmentation
  is *the* chronic TAS failure and you will hit it.

**Build C — long-tail handling**

Your class distribution will be brutally skewed: Execution dominates, Recovery and
Verification are rare. But those rare classes are the diagnostically interesting ones.
Apply group-wise logit adjustment or class-balanced focal loss, and **always report per-class
recall**, not just MoF. "The rare classes are the ones we care about" is a clean motivation
paragraph.

**Build D — the ablation (RQ4, the headline)**

Same architecture, same folds, three feature configurations:

| Config | Features | Privacy cost |
|---|---|---|
| A | Event log only | None |
| B | Webcam signals only | High |
| C | Fused | High |

Report F1@{10,25,50}, edit score, MoF, per-class recall, for all three.
**Leave-one-subject-out cross-validation** — with n≈45 anything else leaks subject identity
and inflates everything.

**Build E — Process Graph**

Phase timeline → directly-follows graph. Use `pm4py`; the process-mining literature gives
you the formalism (traces, conformance, trace clustering) at no cost.

- Nodes = phases; edges = transitions with counts and mean durations
- Detect cycles (iteration loops), terminal branches with no forward progress (dead ends),
  and backtracks (Execution → Understanding)
- Graph features: `n_transitions`, `cycle_count`, `phase_entropy`, `backtrack_ratio`
- Test: do graph-structural features beat scalar features (total time, edit count) at
  predicting blind-rated solution quality? Weisfeiler-Lehman kernel via `grakel` if you want
  a similarity space.

**Optional efficiency contribution — adaptive depth.** A looped/universal transformer over
the segmentation head: one pass for steady execution stretches, more passes near ambiguous
boundaries. Report FLOPs saved vs. F1 retained. Keep this in a subsection. If it becomes
the headline, the paper reads as "we applied a trendy block to a niche task."

**Stack:** `torch`, `pm4py`, `networkx`, `grakel`, `scikit-learn`.

**Deliverable:** trained models, the three-row ablation table, process graphs per session.

---

## 3. Shared Data Contracts — Freeze These In Week 1

Four people building separately will produce four incompatible formats unless the schemas are
fixed before anyone writes model code. This is the single highest-risk item in the plan.

```
session_manifest.json
  { session_id, subject_id, problem_id, condition,
    t0_epoch_ms, clock_offsets: {webcam_ms, screen_ms, events_ms} }

signals.parquet          # Galib
  t_ms | blink_rate_hz | ear_mean | ear_std | gaze_dispersion
       | gaze_screen_fraction | head_pose_stability | motion_energy
       | latent_0 ... latent_63

events.jsonl             # Amatul
  { t_ms, type, attrs: {...} }        # one JSON object per line

baseline_profile.json    # Tasfiah
  { subject_id, feature_means, feature_covariance,
    alignment_matrix, subject_embedding: [32] }

labels.json              # from the annotation protocol
  [ { start_ms, end_ms, phase, source: "cued_recall"|"expert_a"|"expert_b" } ]

graph.json               # Marium
  { nodes: [...], edges: [{from, to, count, mean_dur_ms}] }
```

**Clock synchronisation.** One NTP-synced monotonic clock. Each recorder writes its own
offset to the manifest at start. Target accuracy <100 ms.

Validate it with a **clapperboard test**: at session start, the participant claps once in
front of the camera while a full-screen white flash fires. Both streams see the same instant.
Measure the residual offset. Run this every session; if drift exceeds 100 ms, the session is
unusable for fusion and you want to know that on day one, not in week 12.

---

## 4. The Shared Dependency — Data Collection

Nothing above is valid without labels, and labels are the hardest part.

**Sessions:** 45 target (allows ~40 usable after dropouts and sync failures).
Two problems, 40 min each, designed per the doc's §9 principles.

**Labeling — retrospective cued recall.** Immediately post-session, the participant watches
their own screen recording at 2× and marks phase boundaries in a simple UI (~30 min). This
is the standard in learning analytics and it avoids the reactivity problem of concurrent
think-aloud, where narrating changes the process you are trying to measure.

**Reliability gate.** Two independent expert annotators label 15 sessions. Compute Cohen's κ.

> **If κ < 0.6, stop.** The phase construct is unfalsifiable and no amount of model
> engineering fixes it. Redefine the phases — probably by merging the ones the annotators
> confuse — and re-run the check. Discovering this in week 9 is survivable. Discovering it
> in week 13 is not.

**Criterion variable.** Two blind raters score final solution quality 1–7. Without this,
"quality of thinking" is circular and every correlation you report is unanchored.

**Optional — the coached condition (RQ5, high risk / high reward).** Randomise a subset into
*solve genuinely* vs. *solve genuinely but also perform good process* (hand this group the
actual rubric). Test whether a cross-modal discrepancy score separates them above chance.
This directly tests the original document's boldest claim. Only attempt it if the core study
is on schedule by week 7.

**Ethics.** Get IRB/institutional approval before recording anything. Webcam + screen capture
on human subjects, plus the consent-under-power-asymmetry problem the original document
raises itself in §18, is the first thing a reviewer checks.

---

## 5. Timeline

| Weeks | Milestone |
|---|---|
| 1–2 | Contracts frozen (§3). IRB submitted. Problem design + calibration battery drafted. |
| 3–5 | Four modules built independently against **synthetic** data conforming to §3. |
| 6 | Integration. Clapperboard sync validation. 3 pilot sessions end-to-end. |
| 7–9 | Data collection — 45 sessions. |
| 9–10 | Cued-recall labeling. Expert annotation. **κ gate.** |
| 10–12 | Modeling. The ablation. Invertibility experiment. |
| 13–14 | Writeup. |

---

## 6. Cut List

If you fall behind, cut in this order:

1. Looped-transformer adaptive depth
2. Process-graph learning (keep descriptive graphs, drop the kernel/embedding work)
3. The coached-performance condition
4. V-JEPA distillation → fall back to MediaPipe features only

**Never cut:** the three-row ablation, the κ reliability check, the event log.
Those three are the paper.

---

## 7. Target Venues

The highest-value output is probably not a system paper. It is a **released, labeled dataset
of AI-assisted problem-solving sessions** — it does not exist, the window is closing, and
resource/dataset papers face a much friendlier bar than "we built a system."

The ablation becomes the analysis section of that same paper.

- **LAK** (Learning Analytics & Knowledge) — best fit for the multimodal + labeling protocol
- **EDM** (Educational Data Mining) — best fit for the dataset contribution
- **CHI Late-Breaking Work** — best fit if the privacy/invertibility result is strong
- **VL/HCC** or **ICSE SEET** — if you lean toward the programming-process framing

---

## 8. Title You're Writing Toward

> **Latent Process Modeling for AI-Assisted Problem Solving:**
> *Privacy-Preserving Multimodal Phase Segmentation at the Edge*

Contribution sentence:

> We eliminate raw facial video transmission entirely and reduce transmitted data by X%,
> while retaining Y% of fused-modality segmentation F1 — and we show the transmitted
> representations are not invertible to identity above chance.

Limitation sentence, stated up front because it buys credibility:

> Our sample of N≈40 sessions from a single institution limits generalisation, and our phase
> taxonomy is validated only for software-adjacent problem domains.
