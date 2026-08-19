# Extractor A — hand-crafted webcam signal extraction

Status as of 2026-07-26: **built and wired end to end** — extraction library,
FastAPI service, CLI, and frontend integration into the Exam → Verify flow.
Confirmed working with a real webcam recording through the full path (record
in the browser → upload → background extraction → chart on the report page).
Positioned per `docs/Main_Idea.md` as Layer 1 ("Dual-Stream Capture") Stream
A — the raw behavioural signal, not the Layer 2/3 analysis or scoring on top
of it (see [What's still not built](#whats-still-not-built)).

## What it is

Extractor A turns a recorded webcam video into a 5 Hz feature table
(`signals.parquet`): blink rate, eye-aspect-ratio stats, gaze dispersion,
gaze-on-screen fraction, head-pose stability, and motion energy — plus a
`face_valid_fraction` validity column and 64 reserved (currently all-NaN)
`latent_*` columns for a future learned-feature extractor ("Extractor B").

It deliberately emits **no emotion category of any kind** — only low-level
geometric/motion signals, computed from MediaPipe Face Landmarker output.

## Where it lives

```
backend/problemproof/extractors/webcam/
├── __init__.py      # public API: extract_signals, ExtractionResult, ExtractionReport, schema constants
├── schema.py         # the signals.parquet column contract (frozen — see file docstring)
├── landmarker.py      # thin wrapper over MediaPipe Face Landmarker (VIDEO mode)
├── geometry.py        # pure-math: EAR, angular gaze dispersion, geodesic SO(3) dispersion
├── blink.py            # hysteresis blink detection + trailing-window blink rate
├── motion.py            # stabilised, intensity-normalised face crop + motion energy
├── timebase.py           # PTS-based frame timing (never frame_index / nominal_fps)
└── pipeline.py            # extract_signals(): wires the above into one pass over a video

backend/problemproof/storage.py        # session_id -> backend/data/sessions/{id}/{webcam.webm,signals.parquet,manifest.json}
backend/problemproof/api/
├── jobs.py       # in-process job runner — one background worker thread, no queue/broker
├── routes.py      # POST /sessions/{id}/webcam, POST /sessions/{id}/extract, GET /jobs/{id}, GET /sessions/{id}/signals, GET /health
└── app.py           # FastAPI app factory + CORS

backend/cli/webcam_extract.py    # thin CLI: video in, signals.parquet out
backend/main.py                    # uvicorn entrypoint

frontend/src/lib/webcamExtraction.ts   # API client (upload / start / poll / fetch)
frontend/src/lib/sessionRecorder.ts     # full-session MediaRecorder, mirrors the exam pause/resume clock
frontend/src/components/CognitiveSignalPanel.tsx  # renders the signals on the Verify page

backend/tests/{test_geometry,test_storage,test_jobs,test_api,test_cli}.py   # 81 tests total
backend/models/face_landmarker.task  # the model file (already downloaded, 3.58 MB)
docs/vram_budget.md               # Phase 1 VRAM measurement and the light-path decision
```

## Correctness properties (verified, not just claimed)

These were deliberate constraints and are each backed by a known-answer test
in `test_geometry.py`:

- Landmark coordinates are normalised to a **non-square** image; x scales by
  width, y by height — never a single uniform factor.
- Blink detection uses **hysteresis** (separate close/open thresholds), and
  those thresholds are calibrated from the subject's own EAR distribution
  (`blink.thresholds_from_session`) unless a `baseline_profile.json` supplies
  them (`blink.thresholds_from_profile` — not populated by anything yet, but
  the hook is wired).
- `blink_rate_hz` is a **trailing ~30 s window**, sampled at 5 Hz — not a
  per-200 ms-bin statistic.
- `gaze_dispersion` is angular SD about the mean direction on the unit sphere.
- `head_pose_stability` is geodesic SD on SO(3) (handles the ±180° yaw
  wraparound correctly; SD of Euler angles does not — see
  `test_rotation_sd_survives_euler_wraparound`).
- `motion_energy` runs on a similarity-warped (rotation/scale/translation
  only, no shear), intensity-normalised face crop, so it isn't dominated by
  the subject shifting in their chair or the room's auto-exposure hunting.
- Timestamps come from container PTS (`timebase.decode_with_pts`), never
  `frame_index / nominal_fps`. A container with no usable PTS raises
  `TimebaseError` rather than fabricating one.
- Missing-face bins emit NaN across every feature column, never
  interpolated or forward-filled; `face_valid_fraction` quantifies the gap.

**Known gap:** `motion.py`'s docstring says the frontend pins camera exposure
and white balance at capture (`FaceMeshPreview.tsx`) as the primary defence,
with per-frame normalisation as a backstop. As of this writing
`FaceMeshPreview.tsx` does **not** set those `MediaTrackConstraints` — only
the backstop is in place. Flagged, not silently fixed.

## Running the full stack

```bash
# Terminal 1 — backend
conda activate llms_new
cd backend
python main.py                 # http://127.0.0.1:8000, PP_PORT / PP_HOST override

# Terminal 2 — frontend
cd frontend
npm run dev                    # http://localhost:5173
```

Then: open `/exam`, allow the camera, work for a bit, click **Submit
session**. The recording uploads and extraction starts in the background
(never blocks navigation); the **Verify** page picks up the job by session id
from `localStorage`, polls it, and renders the signals once done — face
detection as a validity band, then blink rate / EAR / gaze dispersion /
on-screen fraction / head-pose SD / motion energy as sparklines with visible
gaps, plus a `signals.parquet` download link. Older sessions with no
recording just don't show the panel — it's additive, not a hard dependency.

No compute-endpoint setting exists in the UI for this (unlike the
Emotion-LLaMA panel's tunnel-URL field) — Extractor A runs in-process on the
normal backend per the Phase 1 decision, so the endpoint is only a build-time
default (`VITE_PP_API_URL`, falls back to `http://localhost:8000`).

## API contract

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/sessions/{id}/webcam` | multipart `video` field; saves `webcam.webm`/`.mp4` |
| `POST` | `/sessions/{id}/extract` | starts a background job; `{job_id}`. 404 if nothing was uploaded yet |
| `GET` | `/jobs/{job_id}` | `{status: queued\|running\|done\|error, progress: [done, total\|null], result, error}` |
| `GET` | `/sessions/{id}/signals` | `?format=json` (default, NaN → `null`) or `?format=parquet` (raw file) |
| `GET` | `/health` | liveness check |

`session_id` is caller-supplied (the frontend uses `String(Date.now())`, the
same id `sessions.ts` already keys completed sessions by) and is validated
against a `[A-Za-z0-9_-]+` allowlist in `storage.py` before touching the
filesystem — path-traversal attempts (`../..`, embedded slashes) are rejected
with a 4xx rather than resolved.

Extraction jobs run **strictly one at a time** on a single background worker
thread (`api/jobs.py`) — no Celery/Redis. Justified by the workload: CPU-bound
extraction at ~3.2× realtime (docs/vram_budget.md), so a second session
queues rather than contending for the CPU mid-extraction.

## Library usage (unchanged)

### 1. Environment

Use the `llms_new` conda environment — it already has every pinned dependency
from `backend/requirements.txt` installed:

```bash
conda activate llms_new
pip install -r backend/requirements.txt   # no-op if already installed
```

CPU-only is expected and correct: MediaPipe Face Landmarker's Python API has
no CUDA path (see `docs/vram_budget.md` — measured peak VRAM is 0 MB).

### 2. Run the tests

```bash
cd backend
python -m pytest -q
# 43 passed
```

`pytest.ini` sets `pythonpath = .`, so this must be run with the working
directory at `backend/` (there's no installed package / `pyproject.toml` yet).

### 3. Call it from Python

```python
from problemproof.extractors.webcam import extract_signals

result = extract_signals("path/to/session_recording.webm")

result.signals   # pandas DataFrame, 5 Hz, columns = schema.SIGNAL_COLUMNS
result.report    # ExtractionReport: face_valid_fraction, n_blinks,
                  # blink_threshold_source, warnings, etc.

result.signals.to_parquet("signals.parquet")   # persistence is the caller's job —
                                                 # extract_signals() never writes files
```

Optional arguments:

- `clock_offset_ms` — added to every container PTS; intended to come from a
  future session manifest's `clock_offsets.webcam_ms`. Defaults to `0.0`.
- `baseline_profile` — a dict matching a future §2.1 `baseline_profile.json`
  (`{"blink_thresholds": {"close": ..., "open": ...}}`). Falls back to
  per-session self-calibration when omitted or when the profile doesn't
  contain usable thresholds.
- `model` — override path to the Face Landmarker `.task` bundle. Defaults to
  `backend/models/face_landmarker.task`
  (`problemproof.extractors.webcam.landmarker.model_path()`); override with
  the `PP_FACE_LANDMARKER_MODEL` env var if needed. If the file is missing,
  call `landmarker.ensure_model()` first to download it.
- `progress` — callback `progress(frames_done, frames_total_or_None)`.

Every value in `result.report` that would otherwise be a non-finite float is
`None` after `report.as_dict()` — JSON has no NaN, so this is the safe way to
serialise the report.

## What's still not built

Per `docs/Main_Idea.md`'s five-layer architecture, this integration is Layer
1 Stream A only — the raw behavioural signal, captured and visible. Still
missing, in rough order of what the doc describes next:

- **No session manifest.** `clock_offset_ms` and a real `manifest.json` (for
  joining against a second, screen-recording stream — Main_Idea.md's Stream
  B) aren't populated by anything; `extract_signals` accepts the argument but
  nothing supplies it yet.
- **No `baseline_profile.json` / personal calibration** (Main_Idea.md §"Personal
  Baseline Calibration"). Blink thresholds self-calibrate per-session instead
  (`blink.thresholds_from_session`) — the hook for a real profile exists
  (`thresholds_from_profile`) but nothing populates one.
- **No Workflow Analysis Engine, Process Graph, or Process Profile** (Layers
  2–3). The Verify page shows raw signals, not phase segmentation or the
  qualitative narrative Main_Idea.md describes.
- **No Process Authenticity score** — the cross-reference between these
  webcam micro-signals and the macro process timeline that Main_Idea.md's
  anti-gaming layer depends on. The "How to read this" copy on Verify.tsx
  says this explicitly rather than implying it's connected.
- **No Organisational Validation or Blockchain Credential** (Layers 4–5) —
  there's no validator dashboard, no dispute workflow, no DID/credential
  issuance anywhere in this repo.
- Extractor B (a V-JEPA-style learned-latent extractor feeding the reserved
  `latent_0..latent_63` columns) does not exist in this repo in any form.

These are large, separate pieces of work — not implied by "integrate
Extractor A with the frontend," which is what this pass scoped itself to.
