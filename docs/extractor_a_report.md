# Extractor A — Project Report

**Component:** Hand-crafted webcam signal extraction (ProblemProof, Layer 1 / Stream A)
**Report date:** 2026-07-26
**Status:** Built, tested, and running end to end on real recordings.

This report covers three things: **what we built**, **what we actually got out of it**
(measured, from real sessions on this machine), and **how to read the graphs** that
appear on the Verify page.

For the developer-facing usage notes — API signatures, how to run the stack, file
layout — see [`extractor_a.md`](./extractor_a.md). This document is the "what and why".

---

## 1. Summary

Extractor A converts a recorded webcam video into a **5 Hz table of behavioural
signals** — how often the person blinked, how open their eyes were, how much their
gaze wandered, how steady their head was, and how much their face moved. It emits
**no emotion labels and no scores**; only low-level geometric and motion measurements.

The point of the whole ProblemProof system is to judge *how a person thinks through a
problem*. Extractor A produces the raw physiological half of that evidence. Everything
downstream (phase segmentation, Process Graph, authenticity scoring) is a separate,
later layer and **does not exist yet** — this component deliberately stops at "here is
the honest signal."

| | |
|---|---|
| Input | `webcam.webm` from the browser's `MediaRecorder` |
| Output | `signals.parquet` — 73 columns, one row per 200 ms |
| Model | MediaPipe Face Landmarker (float16, 3.58 MB) |
| Compute | CPU only — **0 MB peak VRAM**, 3.24× realtime |
| Tests | **71 tests, all passing** (verified by running `pytest` today) |
| Verified on | 4 real webcam sessions recorded through the actual UI |

---

## 2. What we did

### 2.1 The problem we were solving

A webcam recording is a wall of pixels. To be useful as evidence about cognition it
has to become a small, time-aligned, honest table of numbers. "Honest" is the hard
part, and it drove nearly every design decision below: it is very easy to produce a
feature table that *looks* clean and is quietly wrong.

### 2.2 The pipeline

Seven stages, each in its own module so it can be tested in isolation:

```
webcam.webm
   │
   ├─ timebase.py   decode frames, read the real timestamp off each one
   │
   ├─ landmarker.py MediaPipe → 478 face landmark points + a head transform matrix
   │
   ├─ geometry.py   points → eye-aspect-ratio, gaze direction, head rotation
   │
   ├─ blink.py      EAR stream → blink events → trailing-window blink rate
   │
   ├─ motion.py     frame → stabilised face crop → frame-to-frame motion energy
   │
   └─ pipeline.py   bin everything to 200 ms rows, emit the table + a report
                            │
                      signals.parquet
```

### 2.3 The five decisions that actually mattered

These are the places where the obvious implementation is wrong, and we did the harder
correct thing instead. Each is backed by a known-answer test.

**1. Time comes from the video, never from a frame counter.**
The naive way to timestamp frame *n* is `n / fps`. This is wrong for webcams: a "30 fps"
camera silently drops to 15 fps when the room dims (the driver lengthens exposure), but
the header still claims 30. `MediaRecorder` output is variable-rate by construction.
The error accumulates — 0.5% rate error is **12 seconds of drift** over a 40-minute
session, and the drift is worst at the end. We read each frame's presentation timestamp
(PTS) from the container instead. If a container has no usable PTS, extraction **fails
loudly** rather than inventing a timeline.

**2. Landmarks are scaled per-axis, not uniformly.**
MediaPipe returns coordinates in 0–1, but x is normalised against image *width* and y
against image *height*. A 640×480 frame is 4:3, so one uniform scale factor stretches
the vertical axis by 33% and corrupts every distance ratio computed from it — including
EAR, which is exactly a ratio of vertical to horizontal distance.

**3. Blink thresholds are the subject's own, and there are two of them.**
Published EAR cut-offs (the familiar ~0.2) come from specific cameras and specific
faces. Eye shape varies enormously; a fixed constant reads some people as permanently
blinking and others as never blinking. We calibrate from the subject's own EAR
distribution (5th and 85th percentile). And detection uses **hysteresis** — eyes close
below one threshold and only reopen above a higher one — because a single threshold on
a signal that hovers near it fires a burst of spurious blinks every time noise crosses
the line.

**4. Head-pose spread is measured on the rotation manifold, not on Euler angles.**
The standard deviation of yaw/pitch/roll is meaningless near ±180°: a head oscillating
across the wraparound point reports enormous "instability" while barely moving. We
compute the Karcher (intrinsic) mean rotation and take the RMS geodesic distance about
it. There is a test (`test_rotation_sd_survives_euler_wraparound`) that fails for the
naive version and passes for this one.

**5. Motion energy runs on a stabilised, intensity-normalised face crop.**
On raw frames, the subject shifting in their chair translates every pixel and swamps
any facial movement — the signal would become a bad head-position sensor, almost
perfectly correlated with `head_pose_stability` instead of carrying new information.
We warp the face to a canonical eye/mouth layout first (rotation, scale, translation
only — *not* a full affine, because shear would absorb the genuine expression change
we are trying to measure), then standardise brightness so auto-exposure hunting doesn't
register as a whole-face "movement" that never happened.

### 2.4 The honesty rules

Three rules that shape the output more than any algorithm:

- **Gaps stay gaps.** A 200 ms bin with no detectable face emits `NaN` across every
  feature — never interpolated, never forward-filled, never zero. Zero would read as
  "perfectly still", which is the opposite of the truth.
- **`face_valid_fraction` quantifies every gap**, so a consumer can always tell "held
  still" apart from "we lost tracking."
- **Unmeasured is not zero.** A standard deviation from a single sample is `0.0` by
  mathematical convention, which reads as "perfectly steady." We emit `NaN` instead.

### 2.5 Where it runs

We measured peak VRAM before deciding where to host this (documented in
[`vram_budget.md`](./vram_budget.md)): **0 MB**. MediaPipe's Python API has no CUDA
path at all — it logged `Created TensorFlow Lite XNNPACK delegate for CPU`. So Extractor
A runs in-process in the normal FastAPI backend; no notebook, no tunnel, no separate
compute host.

The real cost is wall-clock, not memory: **3.24× realtime**, so a 40-minute session
takes ~12 minutes to extract. That is far too long to hold an HTTP request open, which
is why extraction is a **background job with polled progress** — the user submits, gets
navigated to the report page immediately, and the panel fills in when the job finishes.

---

## 3. What we get

### 3.1 The output table

`signals.parquet`, one row per 200 ms bin, 73 columns:

| Column | Unit | Meaning |
|---|---|---|
| `t_ms` | ms (int64) | Bin left edge, on session time |
| `blink_rate_hz` | Hz | Blinks per second, trailing 30 s window |
| `ear_mean` | ratio | Mean eye-aspect-ratio — how open the eyes are |
| `ear_std` | ratio | Within-bin variability of EAR |
| `gaze_dispersion` | degrees | Angular spread of gaze over a trailing 2 s |
| `gaze_screen_fraction` | 0–1 | Fraction of frames with gaze inside the screen cone |
| `head_pose_stability` | degrees | Geodesic spread of head rotation over 2 s |
| `motion_energy` | a.u. | Mean frame-to-frame change on the stabilised face crop |
| `face_valid_fraction` | 0–1 | Fraction of frames in this bin that resolved a face |
| `latent_0..latent_63` | — | **Reserved for Extractor B. All NaN today.** |

The 64 latent columns are placeholders so that when a learned-feature extractor is
built later it can join on `t_ms` without a schema migration. They are currently, and
correctly, entirely empty.

### 3.2 Measured results from real sessions

Four sessions recorded through the actual UI and extracted through the actual backend.
These are the real numbers, not illustrations:

| Session | Duration | Rows | Face valid (mean) | Fully-blank bins |
|---|---|---|---|---|
| `1785008240982` | 32.2 s | 162 | 80.6% | 19 |
| `1785008654946` | 12.6 s | 64 | 94.7% | 0 |
| `1785010232590` | 17.4 s | 88 | 93.5% | 0 |
| `1785010668936` | 23.2 s | 117 | 95.1% | 0 |

Feature ranges across those sessions (median values):

| Feature | Session 1 | Session 2 | Session 3 | Session 4 |
|---|---|---|---|---|
| `blink_rate_hz` | 0.56 | 0.78 | 1.17 | 1.27 |
| `ear_mean` | 0.354 | 0.346 | 0.304 | 0.255 |
| `ear_std` | 0.016 | 0.012 | 0.016 | 0.014 |
| `gaze_dispersion` (°) | 10.9 | 5.1 | 21.6 | 28.4 |
| `gaze_screen_fraction` | 0.00 | 0.15 | 0.00 | 0.00 |
| `head_pose_stability` (°) | 5.4 | 3.0 | 3.7 | 3.9 |
| `motion_energy` | 0.355 | 0.438 | 0.348 | 0.311 |

**What works well.** Bin spacing is exactly 200 ms in every session. Face tracking held
93–95% in three of four recordings. The latent columns are all-NaN as designed, `t_ms`
is `int64` as specified, and gaps propagate correctly — session 1 lost the face for 19
bins (~3.8 s) and those bins are blank rather than filled in.

**Two findings that need honest flagging:**

- **Blink rate looks too high.** 0.56–1.27 Hz is 34–76 blinks per minute. Resting human
  blink rate is roughly 15–20/min. The likely causes are self-calibrated thresholds on
  very short recordings (a 13-second session gives the percentile calibration almost
  nothing to work with) and partial lid closures being counted as full blinks. **This
  needs validation against manually counted blinks before the number is trusted in
  absolute terms.** Relative *changes within* a session are more defensible than the
  absolute level.
- **`gaze_screen_fraction` is effectively not working yet.** Three of four sessions have
  a median of exactly 0.00 — i.e. "never looking at the screen" — for someone who was
  demonstrably sitting at their screen doing an exam. This is not a bug so much as an
  uncalibrated assumption: with no measured camera/screen geometry, the code approximates
  the display as a 25° cone about the camera axis. That approximation is clearly wrong
  for this rig. Fixing it properly requires the nine-point gaze calibration that belongs
  to the not-yet-built personal baseline profile.

The large `gaze_dispersion` values in sessions 3 and 4 (21–28°) should be read with the
same caution — the underlying gaze estimate is noisy, and head rotation is composed into
it by design.

### 3.3 Verification

Running the suite today:

```
tests/test_geometry.py: 41
tests/test_storage.py:  13
tests/test_api.py:       8
tests/test_jobs.py:      7
tests/test_cli.py:       2
                        ── 71 tests, all passing
```

The geometry tests are **known-answer** tests, not smoke tests: a fixed direction
repeated must give dispersion of exactly 0.0; alternating ±5° must give exactly 5.0;
the Euler-wraparound case must survive. These are the tests that would catch the five
"obvious but wrong" implementations described in §2.3.

*(Note: the older `extractor_a.md` states "81 tests" in one place and "43 passed" in
another. Both are stale — 71 is the measured count.)*

---

## 4. What the graphs mean

The Verify page renders Extractor A's output as one validity band plus six sparklines,
in `CognitiveSignalPanel.tsx`. Here is how to read each one.

### 4.0 Reading rules that apply to every graph

Three things about these charts that will mislead you if you don't know them:

1. **Each sparkline is auto-scaled to its own minimum and maximum.** There is no fixed
   y-axis. A signal that barely moved is stretched to fill the full height exactly like
   one that swung wildly. **You cannot compare heights between two graphs, or the same
   graph across two sessions.** Read *shape* — where it rises, falls, or breaks — not
   amplitude.
2. **A break in the line is missing data, not zero.** Gaps are deliberately not
   interpolated. Check the validity band above to see whether a break means "face lost"
   or "signal genuinely unavailable in this window."
3. **The x-axis is session time, left to right.** Bins are a uniform 200 ms, so
   horizontal position maps linearly to elapsed time. There are no tick labels — this is
   a shape-reading instrument, not a measuring one.

### 4.1 FACE DETECTED (validity band)

**What it shows.** `face_valid_fraction` per bin, as a colour strip. Solid teal where
a face was found (darker = higher fraction of frames in that bin); **red diagonal
hatching** where fewer than half the frames resolved a face.

**Read this first.** Every other graph is only as trustworthy as this band. Red hatching
means the person left frame, turned away, the lighting failed, or frames were dropped.
Any feature reading during a hatched region is either absent or based on very few
samples.

**What it means for the session.** Occasional thin red slivers are normal (a big head
turn). Wide red blocks mean that stretch of the session has no cognitive evidence at
all — which is itself worth knowing, and is exactly why we refuse to fill it in.

### 4.2 BLINK RATE

**What it shows.** Blinks per second, computed over a **trailing 30-second window** and
sampled every 200 ms.

**Why a window and not per-bin.** A blink lasts 100–400 ms and a bin is 200 ms, so
"blinks starting in this bin" is a coin flip that can only ever read 0 Hz or 5 Hz — not
a rate. The 30 s window is what makes the number a rate at all. The consequence: the
line is **smooth and slow-moving by construction**, and adjacent points share almost all
their underlying data. Do not read fast wiggles into it; there are none to read.

**The first ~5 seconds are always blank.** The rate requires at least 5 seconds of
*observed eye time* before it emits anything, so every session opens with a gap. This is
also why the "finite" percentage for blink rate is lower than for other features (59–78%
in our sessions) — short recordings spend a large fraction of their length filling the
window.

**How to interpret it.** In the cognitive literature, blink rate falls during focused
visual attention and rises during internally-directed thought or fatigue. So a *drop*
plausibly marks concentrated reading or watching; a *rise* plausibly marks thinking
away from the screen, or tiring. **Treat this as a hypothesis to test, not a
conclusion** — and given §3.2, treat the direction of change as far more meaningful
than the absolute level.

### 4.3 EYE ASPECT RATIO

**What it shows.** `ear_mean` — the ratio of the eye's vertical opening to its
horizontal width, averaged over the bin. Higher = eyes more open.

**How to interpret it.** This is the raw signal blink detection is built from, shown
directly so you can sanity-check it. A slow downward drift over a long session is the
classic drowsiness/fatigue signature. Sharp narrow dips are blinks (partly smoothed out
by 200 ms binning). A sustained low plateau means squinting or heavy lids.

**Caveat.** The absolute value is person-specific — eye shape varies enormously. 0.25
for one person is wide open and for another is half-closed. Only compare a person
against themselves.

### 4.4 GAZE DISPERSION

**What it shows.** How much the gaze direction spread out over the trailing 2 seconds,
in **degrees**. Measured properly as angular spread about the mean direction on the
sphere — not as the standard deviation of x/y/z separately, which isn't
rotation-invariant and reports fake spread near coordinate singularities.

**How to interpret it.** Low = the eyes are locked on one place (reading a fixed block
of text, staring at one error message). High = scanning, searching, looking around the
screen or the room. In the intended ProblemProof reading, sustained low dispersion is a
candidate marker of focused engagement, and bursts of high dispersion are candidate
markers of exploration or being lost.

**Caveat.** Head rotation is composed into the gaze vector on purpose — so this rises
when the person turns their head, not only when their eyes move. And per §3.2, the
underlying gaze estimate is noisy on this hardware; the shape is more informative than
the number of degrees.

### 4.5 ON-SCREEN FRACTION

**What it shows.** The fraction of frames in the bin where gaze fell inside the assumed
screen cone. 1.0 = looking at the screen the whole bin; 0.0 = looking away.

**Read this one sceptically.** This is currently the weakest signal in the set. Without
a measured camera/screen geometry, "the screen" is approximated as a 25° cone around
the camera axis, and our measurements show that approximation failing — three of four
real sessions report a median of 0.00. **Right now this graph should be read as a
relative, within-session indicator at best, and preferably not relied on at all until
gaze calibration is implemented.** It is left visible rather than hidden because hiding
a broken signal is worse than labelling it.

### 4.6 HEAD POSE SD

**What it shows.** How much the head's 3-D orientation varied over the trailing 2
seconds, in **degrees** of rotation. Computed as geodesic spread on the rotation
manifold, so it is correct across the ±180° wraparound where Euler-angle standard
deviation breaks.

**How to interpret it.** This is the "thinking posture" signal from the system design.
Near-zero = stillness, which in the deep-thought hypothesis marks concentrated
reasoning. Sustained elevation = restlessness, shifting, looking around — hypothesised
to accompany confusion or disengagement. A single sharp spike is usually just a
deliberate head turn (glancing at a second monitor, someone entering the room).

**Caveat.** Stillness and disengagement look similar here. Someone staring blankly and
someone reasoning hard both sit still. This signal only becomes meaningful when
cross-referenced with what was happening on screen — which is Layer 2, and isn't built.

### 4.7 MOTION ENERGY

**What it shows.** Mean pixel-level change between consecutive frames, measured on the
**stabilised, brightness-normalised face crop** — so it is *residual* facial movement
with gross head motion already removed.

**How to interpret it.** Because stabilisation strips out translation, scale and roll,
what remains is expression change, lid and jaw activity, and micro-movement. Low =
a still face. High = active expression, talking, mouthing words, or rapid eye/lid
activity.

**Why it isn't redundant with HEAD POSE SD.** Without stabilisation it would be — the
two would track each other almost perfectly, because chair-shifting dominates raw pixel
difference. Stabilisation is precisely what makes this an independent channel: *the head
was steady but the face was busy* is a state only this pair of graphs together can
express.

**Caveat.** Units are arbitrary (a.u.) — normalised image units, meaningful only in
comparison to itself.

### 4.8 Reading them together

The graphs are designed to be read as a set, not individually. Some example
combinations, stated as **hypotheses the system is built to eventually test**, not as
validated findings:

| Pattern | Candidate reading |
|---|---|
| Low gaze dispersion + low head SD + low motion | Locked-in focused reading |
| Low head SD + rising blink rate + gaze away | Internal thinking, eyes off-screen |
| High gaze dispersion + high head SD | Scanning, searching, possibly lost |
| High motion energy + low head SD | Expressive reaction while seated still |
| Falling EAR over many minutes | Fatigue accumulating |

**Nothing in the current system draws these conclusions automatically.** The panel shows
raw signals only. The Verify page says so explicitly in its "How to read this" text —
the Process Authenticity score that would cross-reference these signals against the
process timeline is not connected in this prototype.

---

## 5. Known limits

Stated plainly, because a signal with an unstated caveat is worse than no signal.

**In this component:**

1. **Blink rate is unvalidated in absolute terms** (§3.2) — needs a manual-count
   comparison.
2. **`gaze_screen_fraction` is uncalibrated** (§3.2, §4.5) and currently unreliable.
3. **Camera exposure/white balance is not pinned at capture.** `motion.py` documents
   the frontend as the primary defence against auto-exposure artefacts, with per-frame
   normalisation as a backstop — but `FaceMeshPreview.tsx` does not actually set those
   `MediaTrackConstraints`. Only the backstop is in place. Flagged, not silently fixed.
4. **All measured sessions are short** (12–32 s). Long-session behaviour — drift,
   fatigue signatures, memory over a 40-minute recording — is untested in practice.
5. **One extraction job at a time**, on a single background thread. Justified for now
   (extraction is CPU-bound, so a second concurrent job would just contend), but it is
   not a production queue.

**Beyond this component** (the rest of the ProblemProof stack, none of it built):

- No session manifest, so no clock offset and no way to join against a screen-recording
  stream. `extract_signals()` accepts `clock_offset_ms` but nothing supplies it.
- No personal baseline calibration profile — the hook exists (`thresholds_from_profile`),
  nothing populates it. This is also what would fix the gaze cone.
- No Workflow Analysis Engine, Process Graph, or Process Profile (Layers 2–3).
- No Process Authenticity score — the cross-reference this component's output was
  designed to feed.
- No organisational validation or blockchain credential (Layers 4–5).
- No Extractor B — the `latent_0..latent_63` columns have no producer.

---

## 6. Conclusion

Extractor A is complete as scoped and verified end to end: a real webcam recording made
in the browser travels through upload, background extraction, and back to a rendered
chart on the report page, with 71 passing tests behind the maths and measured evidence
(0 MB VRAM, 3.24× realtime) behind the deployment decision.

The engineering quality of the signal is good — correct timebase, correct geometry,
correct handling of missing data, and no fabricated values anywhere. The *scientific*
validity of two of the seven signals is not yet established: blink rate needs
ground-truth validation, and on-screen fraction needs gaze calibration before it means
anything. Both are documented rather than hidden, which is the standard the rest of the
component was built to.

The natural next step is the personal baseline calibration profile — it is a
prerequisite for fixing the gaze cone, it would replace per-session blink self-calibration
with something stable, and the code hooks for it already exist.
