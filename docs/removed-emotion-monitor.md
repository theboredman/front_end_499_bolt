# Removed: the live emotion monitor (Emotion-LLaMA)

**Status:** removed from `main` on 2026-08-02. Full implementation preserved on
branch `archive/emotion-llama`.

This is a negative result, recorded deliberately. The component worked in the
engineering sense — it ran, it returned labels, the UI rendered them — and it
was still wrong to ship. Both the reasoning and the evidence are kept here so
the decision does not get quietly re-litigated later, and so the effort is
legible as a finding rather than as deleted work.

## What was built

A closed loop from the exam portal to a vision-language model:

| Piece | What it did |
| --- | --- |
| `frontend/src/lib/emotionMonitor.ts` | Every ~20 s, recorded a 4 s webcam clip with `MediaRecorder` and POSTed it to a `/predict` endpoint. Serialized requests (single GPU behind it). |
| `EMOTION_LABELS` | Emotion-LLaMA's MER2023 label set: happy, sad, neutral, angry, worried, surprise, fear, contempt, doubt. |
| `parseEmotionLabel()` | Reproduced `eval_emotion.py`'s parse — last word first, then a scan — plus a synonym table (`joy`→`happy`, `anxious`→`worried`, …) for near-misses, falling back to `"unclear"`. |
| Exam portal panel | A tunnel-URL input, a live status dot (OFF / RECORDING CLIP / ANALYZING / WATCHING / ERROR), the current label as a coloured chip, the model's raw reply, and a scrolling log of every label with its timestamp. |
| `emotions[]` on the session | Persisted into the draft and the completed session record, so labels survived reload and reached the verification page. |
| `backend/emotion_llama_kaggle_inference.ipynb` | Served Emotion-LLaMA (MiniGPT-v2 + Llama-2-7b-chat) from Kaggle, exposed to the browser through a Cloudflare tunnel. |
| `backend/emotion_llama_daisee_inference.ipynb` | Offline evaluation of the same model against the DAiSEE validation split. **Kept on `main`** — it is the evidence in §3 below. |

## Why it was removed

### 1. Facial configuration → emotion category does not survive review

The research plan forbids emitting emotion categories (§2.2), citing Barrett et
al. (2019), *Emotional Expressions Reconsidered*. The finding there is that the
mapping from facial configuration to emotional state is neither reliable nor
specific: the same internal state produces different configurations across
people and contexts, and the same configuration means different things. A
system that reads a face and asserts `"worried"` is claiming a mapping the
evidence does not support.

This matters more here than in a general-purpose product, because the output
was not decorative. It fed a record intended to support hiring and
credentialing decisions. An unreliable inference presented next to real
measurements inherits their credibility without earning it.

Extractor A already encodes this constraint and stays: it emits blink rate,
gaze dispersion, head-pose stability and motion energy — observable physical
quantities — and no category. `landmarker.py` keeps
`output_face_blendshapes=False` for the same reason, blendshapes being the
direct on-ramp to category inference.

### 2. It contradicted the project's own privacy claim

The privacy architecture commits to on-device webcam processing, with only
extracted signals leaving the machine and never face video. The emotion monitor
did precisely the opposite: it uploaded raw webcam clips — face and audio — to
a third-party endpoint whose URL the *candidate* pasted into a text box.

The destination was therefore unverifiable by the platform, the transport was
whatever the tunnel provided, and there was no retention story on the far side.
That is not a hardening problem; it is the inverse of the stated design, so the
claim and the code could not both stand.

### 3. It did not work, and the way it failed was instructive

`backend/emotion_llama_daisee_inference.ipynb` evaluated the model against 50
randomly sampled clips (seed 499) from the DAiSEE validation split. Results in
`daisee_report/`. The model received **one still frame per clip, and no audio**.

Of 50 responses:

| Observation | Count |
| --- | --- |
| Cited evidence that did not exist in the input (vocal tone, intonation, gestures "throughout the video", nodding, pacing) | **42 / 50** |
| Specifically asserted audio evidence — there was no audio track | 16 / 50 |
| Read the subject as happy / excited / enthusiastic | 36 / 50 |

DAiSEE engagement ground truth across the sample was spread (23 clips at level
2, 23 at level 3, 4 at level 1) with substantial boredom, confusion and
frustration ratings; the model's near-uniform positive reading did not track it.

A representative failure: for clip `4000332009` (Engagement 2, Confusion 1) the
model described "a speaker" addressing "an audience", praised their "vocal tone
with a rising intonation", noted "varied camera angles", and concluded
enthusiasm. The input was a single static webcam frame of a student sitting
alone.

This is the failure mode that makes the component unsalvageable rather than
merely untuned. The model does not report what it observes; it generates a
plausible narrative about a video it was never given, and the narrative arrives
in the same confident register whether or not there is anything behind it.
Tuning the prompt or the label parser cannot fix that, because the fabrication
is upstream of both.

## What was kept

- **Extractor A** (`backend/problemproof/extractors/webcam/`) and the
  full-session recorder (`useSessionRecorder`). These are the sanctioned webcam
  path: physical signals, no categories.
- **The DAiSEE notebook and report.** They are the evidence above.
- **`archive/emotion-llama`.** The complete implementation, should anyone need
  to see what was actually built.

## If this is revisited

Anything reading the webcam and emitting a state label has to clear all three
bars, not one: a defensible construct (§1), on-device processing (§2), and
measured accuracy on held-out data with a stated error rate (§3). The version
removed here cleared none of them.
