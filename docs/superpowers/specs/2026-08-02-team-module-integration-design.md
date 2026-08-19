# Team Module Integration — Design

Date: 2026-08-02
Status: approved

## Problem

Four people built four layers of ProblemProof in four separate clones of this
repo. Three of them (`Teams Part/Amatul`, `Teams Part/Tasfiah`,
`Teams Part/Marium`) are near-duplicate copies of the whole project with one
module added each. Nothing imports anything from anyone else, two of them ship
a FastAPI app that binds port 8000, and one module exists twice byte-for-byte.

This spec defines the merge into a single system.

## What each teammate contributed

| Person | Module | Architecture layer |
|---|---|---|
| Amatul | Screen recording + structured metadata event logging (desktop agent *and* in-browser logger) | Layer 1, Stream B |
| Tasfiah | Personal Baseline Calibration — MediaPipe FaceMesh → Euclidean Alignment → per-candidate baseline profile, exposed as an API | Layer 3 |
| Marium | Phase detection + process graph — segmentation, TAS metrics (F1@10/25/50, edit), LOSO ablation, directly-follows graph | Layer 2 |
| Galib | Extractor A — webcam signals (blink, gaze, head pose, motion energy), job runner, session storage, CLI | Layer 1, Stream A |

`Teams Part/Marium/*.py` and `Teams Part/Tasfiah/backend/phase_detection/*.py`
are byte-identical. Tasfiah had already packaged Marium's work. It is merged
once, into `problemproof/analysis/`, and both are credited.

## Decisions

1. **Full integration**, not co-location. Their modules become part of the
   `problemproof` package behind the existing app factory and entrypoint.
2. **Shared session store.** All modules read and write through `storage.py`
   so one `session_id` yields one folder containing every stream.
3. **Baselines are candidate-scoped**, not session-scoped. A baseline is a
   durable per-person asset reused across sessions and at recertification, so
   it gets its own `data/candidates/{id}/` scope rather than being forced into
   the session layout.
4. **`Teams Part/` is deleted** once the merge verifies. It is untracked, so
   nothing leaves git history, and four near-duplicate frontends in the working
   tree invite editing the wrong file.
5. **Both of Amatul's Stream B implementations are kept.** Her code documents
   them as complementary, not duplicate: the in-tab logger sees focus changes
   and typing rhythm within the exam page; the desktop agent sees OS-level app
   switching. Neither can see what the other sees.

## Target backend structure

```
backend/
├── main.py                    # unchanged — the only uvicorn entrypoint
├── requirements.txt           # merged and pinned (one file, not four)
├── cli/
│   ├── webcam_extract.py      # unchanged
│   └── screen_agent.py        # NEW: launches the desktop capture agent
└── problemproof/
    ├── storage.py             # EXTENDED — see below
    ├── api/
    │   ├── app.py             # mounts all three routers
    │   ├── routes.py          # /health, /sessions/{id}/{webcam,extract,signals}, /jobs/{id}
    │   ├── calibration.py     # NEW: /api/calibration/*, /api/baseline/*
    │   └── capture.py         # NEW: /sessions/{id}/{screen,events}
    ├── extractors/
    │   ├── webcam/            # unchanged
    │   └── screen/            # NEW: 8 modules; main.py renamed agent.py
    ├── calibration/
    │   └── pipeline.py        # NEW: was baseline_pipeline.py
    └── analysis/              # NEW: 6 modules (phase detection + process graph)
```

Tasfiah's `backend/app.py` stops being an application and becomes an
`APIRouter`. Its `allow_origins=["*"]` CORS block is dropped — the existing
factory already configures CORS from `PP_CORS_ORIGINS`, and a wildcard is
strictly worse. Amatul's `main.py` is renamed `agent.py` so it cannot be
confused with the server entrypoint.

Route prefixes do not collide: existing routes are unprefixed, calibration
routes all sit under `/api/`.

## Storage layout

```
data/
├── candidates/{candidate_id}/
│   └── baseline.json                        # calibration output
└── sessions/{session_id}/
    ├── webcam.webm                          # Stream A recording
    ├── signals.parquet                      # Extractor A, 5 Hz
    ├── screen.webm                          # Stream B recording
    ├── events.jsonl                         # metadata event log
    ├── features.csv                         # Stream B features, 1 Hz
    └── manifest.json                        # session meta incl. candidate_id
```

`storage.py` gains `candidate_dir()`, `baseline_path()`, `screen_path()`,
`events_path()` and `features_path()`, each reusing the existing
`_validate()` traversal guard. `candidate_id` is validated by the same rule as
`session_id` — it reaches the server as a URL path parameter and is equally
untrusted.

`exportSession.ts` already anticipates this: its header states the
`downloadBlob` calls should be swapped for uploads "once a backend endpoint
exists; nothing else in this file would need to change." So the browser posts
to `/sessions/{id}/screen` and `/sessions/{id}/events`. The desktop agent's
`BASE_OUTPUT_DIR` points at `storage.session_dir()` and it gains a
`--session-id` flag so it writes into the folder the browser session created.

### Contract reconciliations

The `signals.parquet` schema is frozen and shared. Three mismatches exist
between what `analysis/feature_assembly.py` assumes and what Extractor A
actually writes:

1. It reads `signals.csv`; Extractor A writes `signals.parquet`. Marium flagged
   this herself ("pyarrow unavailable here… trivial swap"); `pyarrow==24.0.0`
   is pinned, so the loader switches to `read_parquet`.
2. It reads `session_manifest.json`; `storage.manifest_path()` is
   `manifest.json`. Storage wins; the loader updates.
3. It hard-codes `latent_0..7`; the frozen schema reserves `latent_0..63`.
   `WEBCAM_COLS` derives from `schema.FEATURE_COLUMNS` and
   `schema.LATENT_COLUMNS` instead of restating them — that is the point of a
   frozen contract.

`labels.json` (phase ground truth) has no producer in any module; it is human
annotation. The analysis pipeline therefore stays on synthetic data. Real
sessions drop in later with no code change.

## Frontend

Additive except for one page. `package.json` is identical across all clones, so
no dependency merge is needed.

New files: `lib/calibration.ts`, `components/CalibrationSession.tsx`
(Tasfiah); `lib/screenRecorder.ts`, `lib/eventLogger.ts`,
`lib/exportSession.ts` (Amatul).

- `Onboarding.tsx` — take Tasfiah's version wholesale; only she changed it.
  Adds a Calibration step to the wizard, blocking only when a camera is live.
- `Verify.tsx` — take the main version; only it changed.
- `Exam.tsx` — genuine three-way merge, but the edits touch disjoint regions:
  Extractor A recording and upload on one side, screen recording UI and event
  logger on the other. The single overlap is that both hoisted
  `const sessionId = String(Date.now())`, which is the same change and
  collapses to one line.

`webcamExtraction.ts` reads `VITE_PP_API_URL`; `calibration.ts` reads
`VITE_CALIBRATION_API_URL`. Both default to `localhost:8000`. Since there is
now one server, both move to a shared `lib/api.ts` exporting a single
`API_BASE`.

## Dependencies

One `requirements.txt`. Existing pins are the floor. Added: `mss`, `pynput`,
`watchdog`, `psutil`, `pywin32; sys_platform=='win32'` (capture) and
`networkx` (process graph). Tasfiah's unpinned `mediapipe`, `opencv-python`,
`scipy`, `scikit-learn` resolve to the existing pins.

Note: calibration uses the legacy `mp.solutions.face_mesh` API while Extractor
A uses the newer Face Landmarker task. Both are valid in `mediapipe==0.10.35`
but load separate models — acceptable on CPU, not free.

## Verification

What can be verified in a headless environment:

- The existing 5 pytest files still pass.
- Amatul's `test_synthetic_session.py` folds into `backend/tests/`; it
  deliberately avoids `mss`/`pynput` and runs headless.
- New tests cover the extended storage paths (including traversal rejection)
  and calibration route registration.
- `npm run build` typechecks the merged frontend.

What cannot: live screen capture needs a real desktop, and calibration needs a
webcam. Those paths are verified by import and wiring only. The completion
report states exactly which checks ran rather than implying green across the
board.
