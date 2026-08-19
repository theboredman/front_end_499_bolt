# ProblemProof (CSE499)

ProblemProof is a capstone project (CSE499) exploring how to verify a candidate's
*genuine* problem-solving process during a coding exam, rather than just
grading their final answer. As a candidate works, the platform tracks their
process through distinct phases — Understanding, Decomposition, Exploration,
Execution, Recovery, and Verification — and produces a record employers can
use to check that the work reflects authentic, unassisted reasoning.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/SYSTEM.md](docs/SYSTEM.md) | **Start here.** Full system guide: every feature, how it was built, how to run the project end to end, and what is real vs. not yet. |
| [docs/BACKEND.md](docs/BACKEND.md) | Code reference for the backend: every module and function, what it holds and why. Read before changing one. |
| [docs/DATAFLOW.md](docs/DATAFLOW.md) | How the pieces connect: every hop from a sensor to a stored file, named at the function level, frontend and backend. |
| [docs/research-plan.md](docs/research-plan.md) | The specification. Where the code disagrees with it, the plan wins. |
| [docs/Main_Idea.md](docs/Main_Idea.md) | The concept and business document. |
| [docs/removed-emotion-monitor.md](docs/removed-emotion-monitor.md) | Negative result: why the live emotion classifier was removed. |

## Repository structure

```
CSE499/
├── frontend/     React + TypeScript client (Vite)
├── backend/      FastAPI service + capture/analysis modules
├── docs/         Design specs and module reports
└── Papers/       Background research (e.g. ACL findings papers)
```

### `frontend/`

The client application, built with React 18, TypeScript, and Vite.

Routes (see [App.tsx](frontend/src/App.tsx)):

| Path           | Page        | Purpose                                   |
| -------------- | ----------- | ------------------------------------------ |
| `/`            | Landing     | Marketing / entry page                     |
| `/onboarding`  | Onboarding  | Candidate/employer onboarding + calibration |
| `/candidate`   | Candidate   | Candidate dashboard                        |
| `/employer`    | Employer    | Employer dashboard                         |
| `/exam`        | Exam        | The live coding exam and phase tracking    |
| `/verify`      | Verify      | Post-exam verification report              |

All backend clients in [src/lib/](frontend/src/lib/) share one base URL from
[api.ts](frontend/src/lib/api.ts) (`VITE_PP_API_URL`, default
`http://localhost:8000`).

### `backend/`

One FastAPI app serves every layer. Run it with `python main.py` from
`backend/`.

| Module | Layer | Contributor |
| --- | --- | --- |
| [extractors/webcam/](backend/problemproof/extractors/webcam/) | Stream A — blink, gaze, head pose, motion → `signals.parquet` @ 5 Hz | Galib |
| [extractors/screen/](backend/problemproof/extractors/screen/) | Stream B — screen recording + metadata event log | Amatul |
| [calibration/](backend/problemproof/calibration/) | Personal baseline calibration (Euclidean Alignment) | Tasfiah |
| [analysis/](backend/problemproof/analysis/) | Phase detection + process graph | Marium |

Stream B has two halves that see different things and are both kept: the
in-browser logger ([eventLogger.ts](frontend/src/lib/eventLogger.ts)) sees
focus changes and typing rhythm inside the exam tab, while the desktop agent
sees OS-level application switching.

Everything meets at the session store,
[storage.py](backend/problemproof/storage.py):

```
backend/data/
├── candidates/{candidate_id}/baseline.json
└── sessions/{session_id}/
    ├── webcam.webm  signals.parquet     # Stream A
    ├── screen.webm  events.jsonl  features.csv   # Stream B (browser)
    ├── manifest.json
    └── desktop/                         # Stream B (desktop agent)
```

A baseline is candidate-scoped, not session-scoped: it is reused across every
session that candidate sits.

### `Papers/`

Reference papers informing the project's approach.

## Getting started

Frontend:

```bash
cd frontend
npm install
npm run dev
```

- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build locally
- `npm run lint` — run ESLint

Backend:

```bash
cd backend
pip install -r requirements.txt
python main.py          # serves on http://localhost:8000
pytest                  # 115 tests, no display or webcam required
```

The desktop capture agent needs a real display and is run separately, joining
a session the browser already started:

```bash
python -m cli.screen_agent --session-id <id> --duration 3600
```
