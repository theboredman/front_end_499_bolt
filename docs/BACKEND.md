# ProblemProof — Backend Reference

Every backend module, what it holds, and why it holds it that way.

- [`SYSTEM.md`](SYSTEM.md) is the *system* guide — what the product does, end to end, across both halves.
- This document is the *code* guide — file by file, function by function, for someone about to change something.
- [`DATAFLOW.md`](DATAFLOW.md) traces how these modules connect end to end, frontend included.
- [`research-plan.md`](research-plan.md) is the spec. Where this document and the plan disagree, the plan wins.

Section references like §2.3 point at the research plan.

---

## Table of contents

1. [Orientation](#1-orientation)
2. [Entrypoints](#2-entrypoints)
3. [The contract layer](#3-the-contract-layer) — `storage`, `events`, `labels`, `env`
4. [The API layer](#4-the-api-layer) — `api/`
4a. [The personalisation layer](#4a-the-personalisation-layer) — `profile/`, `assessment/`
5. [Extractor A — webcam](#5-extractor-a--webcam) — `extractors/webcam/`
6. [Extractor B — screen](#6-extractor-b--screen) — `extractors/screen/`
7. [Calibration — Layer 3](#7-calibration--layer-3) — `calibration/`
8. [Analysis — Layer 2](#8-analysis--layer-2) — `analysis/`
9. [The test suite](#9-the-test-suite)
10. [Conventions that repeat](#10-conventions-that-repeat)
11. [Known gaps and stale references](#11-known-gaps-and-stale-references)

---

## 1. Orientation

### The shape of it

```
backend/
├── main.py                  uvicorn entrypoint — the only thing that runs a server
├── cli/                     two standalone command-line entrypoints
├── problemproof/
│   ├── storage.py           where every file goes.        ← contract
│   ├── events.py            what an event may say.        ← contract
│   ├── labels.py            what a labelling pass is.     ← contract
│   ├── validation.py        Layer 4 lifecycle + frozen versions ← contract
│   ├── performance_profile.py  Layer 3 assembly + the gate    ← contract
│   ├── env.py               the one .env, loaded once
│   ├── api/                 FastAPI routers + job runner
│   ├── extractors/
│   │   ├── webcam/          Stream A — video in, signals.parquet out
│   │   └── screen/          Stream B — OS-level desktop capture agent
│   ├── profile/             RQ5 — CV to skill graph
│   ├── assessment/          RQ6 — question families, spec, generator
│   ├── calibration/         RQ1 — personal baseline + the capture gate
│   └── analysis/            RQ4 — phase segmentation, process graph, validation
├── tests/                   861 tests
└── data/                    sessions + candidates (gitignored)
```

### Four rules the layout enforces

**Contracts are modules, not conventions.** `storage.py`, `events.py`, `labels.py` and `extractors/webcam/schema.py` each own one frozen shape. Nothing else restates a column name, an event type or a path. When four people build separately, the plan calls incompatible formats the single highest-risk item — these four files are the answer to it.

**Libraries return, entrypoints write.** `extract_signals` returns a DataFrame and a report; it never touches disk. Persistence belongs to the caller — the CLI or the job runner. That is what makes the pipeline testable without a filesystem, and it is the reason `tests/` can run 861 tests without a camera.

**Validation happens on write, not on read.** A labelling pass that does not tile, an event carrying a window title, a calibration frame captured in the dark — each is refused at the moment it is produced. Every one of those failures is silent if allowed through: a gap in labels resamples as phase 0 and *inflates* κ with agreement nobody expressed. Errors that produce plausible numbers have to be caught where they are made.

**Heavy imports are lazy.** `cv2`, `mediapipe`, `matplotlib`, `mss`, `pynput` are imported inside the functions that need them. Importing the API must not load a plotting backend or a TFLite graph, or the test suite and `--reload` both pay for it, and the API stops starting on a machine without a webcam.

### Dependency direction

```
api/  ──────► extractors/, calibration/, storage, jobs
cli/  ──────► extractors/, env
analysis/ ──► storage, events, labels          (never imports api/)
extractors/ ► events, storage, schema          (never imports api/)
```

Nothing under `extractors/`, `calibration/` or `analysis/` imports from `api/`. The API is a delivery mechanism; the science is not allowed to depend on it.

---

## 2. Entrypoints

### `main.py` (27 lines)

The uvicorn entrypoint. `python main.py`, or `uvicorn main:app --reload`. Run from `backend/` — there is no installed package, matching `pytest.ini`.

Note the import order: `load_env()` runs **before** `from problemproof.api.app import create_app`, with a deliberate `# noqa: E402`. Routers read configuration at import time, so loading `.env` afterwards would be too late. Host/port/reload come from `PP_HOST`, `PP_PORT`, `PP_RELOAD`.

### `cli/webcam_extract.py` (75 lines)

A thin CLI over `extract_signals`. All logic lives in the library; this file parses arguments, calls the function, writes `signals.parquet`, prints the report. If you find yourself adding logic here, it belongs in `extractors/webcam/pipeline.py`.

| Function | What it does |
|---|---|
| `_parse_args(argv)` | Video path, `--out`, `--clock-offset-ms`, `--baseline-profile`, `--model`. |
| `main(argv)` | Loads `.env`, runs the extraction with a progress callback, writes the parquet, prints `ExtractionReport` including its warnings. |

### `cli/screen_agent.py` (24 lines)

Entrypoint for the desktop capture agent — the OS-level half of Stream B. Delegates immediately to `extractors/screen/agent.main`. Kept as a top-level script because the agent runs on the participant's own machine, separately from the server:

```
python -m cli.screen_agent --session-id <id>
```

Without it there is no window tracking, no clipboard length, no site categories — so nothing about AI tool use can be reconstructed at all.

---

## 3. The contract layer

### `problemproof/storage.py` (148 lines)

**The single answer to "where does this file go?"** No database exists in this repo; everything is plain files, and every path in the system is built here.

```
{data_root()}/sessions/{session_id}/
    webcam.webm             Stream A recording
    signals.parquet         Extractor A output, 5 Hz
    screen.webm             Stream B recording (browser)
    events.jsonl            metadata event log
    features.csv            Stream B features, 1 Hz
    session_manifest.json   §3 manifest: t0_epoch_ms, clock_offsets
    labels.{source}.json    one file per annotator
    graph.json              §3 process graph
    desktop/                OS-level agent output, its own layout

{data_root()}/candidates/{candidate_id}/
    baseline.json           calibration profile
```

| Function | Notes |
|---|---|
| `data_root()` | `PP_DATA_ROOT` overrides; defaults to `backend/data`. The single override point the whole test suite uses via `monkeypatch.setenv`. |
| `_validate(identifier, kind)` | `^[A-Za-z0-9_-]+$` or `ValueError`. |
| `session_dir` / `ensure_session_dir` | |
| `webcam_path`, `signals_path`, `manifest_path` | Stream A. |
| `screen_path`, `events_path`, `features_path` | Stream B, browser half. |
| `graph_path` | |
| `desktop_dir` | Stream B, agent half. |
| `candidate_dir`, `ensure_candidate_dir`, `baseline_path` | Candidate scope. |

**Two decisions worth knowing.**

*Every id is validated before a path is built.* `session_id` and `candidate_id` both arrive as URL path parameters, so both are untrusted. Validating at the point of path construction — rather than trusting each route to remember — means a traversal attempt cannot reach the filesystem through any caller. Routes turn the `ValueError` into a 400.

*A baseline is candidate-scoped, not session-scoped.* It is reused across every session that person sits and compared against at recertification, so it outlives any one session directory. `tests/test_calibration_api.py` asserts `"sessions" not in baseline_path(...).parts`.

*The desktop agent keeps its own directory* under `desktop/` rather than writing alongside the browser's files. The two Stream B sources are complementary, not interchangeable — the in-tab logger sees focus changes and typing rhythm inside the exam page, the agent sees OS-level app switching — and the agent's `validate.py` looks for its own file names.

`MANIFEST_FILENAME` is `session_manifest.json` per §3; `LEGACY_MANIFEST_FILENAME` (`manifest.json`) is read as a fallback so sessions recorded under the old name still load.

### `problemproof/events.py` (359 lines)

**The AI-interaction event contract (§2.3).** Owns the event-type names, the attribute names, and the rule about which events may claim which source. Its mirror is `frontend/src/lib/eventLogger.ts`; `tests/test_events_schema.py` checks the two against each other.

The envelope, frozen by §3, is one JSON object per line:

```json
{ "t_ms": 74000, "type": "ai_output_accepted", "source": "inferred",
  "attrs": { "char_count": 412, "target_file": "solution.py" } }
```

#### Event types

| Constant | Meaning |
|---|---|
| `AI_SESSION_OPEN` | An AI tool came to the foreground. |
| `AI_SESSION_CLOSE` | It lost the foreground. Carries `duration_ms`. |
| `PROMPT_SUBMIT` | A prompt was sent. Length only. |
| `RESPONSE_RECEIVED` | A response came back. Length and latency only. |
| `AI_OUTPUT_ACCEPTED` | AI output was inserted into the editor. |
| `AI_OUTPUT_REJECTED` | Discarded — `reason` is `regenerate` or `abandon`. |
| `VERIFICATION_ACTION` | The candidate checked their work — `kind` is `run`/`test`/`dwell`/`lint`. |

#### Three sets that carry the design's honesty

- **`INFERRABLE_TYPES`** = `{open, close, accepted}`. The only types that may carry `source="inferred"`, because they are the only ones OS-level capture can establish.
- **`UNCAPTURED_TYPES`** = `{prompt_submit, response_received}`. In the schema because §2.3 defines them and a browser extension could supply them later; emitted by nothing today. This lets a consumer tell "absent because it did not happen" from "absent because nothing can see it".
- **`FORBIDDEN_ATTRS`** — names that may never appear on any event.

#### Why `source` exists at all

There is no in-portal AI assistant. An assistant we built would measure *our* assistant rather than AI-assisted problem solving. So nothing about AI use is directly observed — it is reconstructed from OS-level capture, with the screen recording kept as the evidence a human annotator checks that reconstruction against.

```
source="portal"     observed by our own UI. As reliable as the code that emitted it.
source="inferred"   reconstructed. Carries a *measured* precision and recall.
```

Keeping those apart in the data is the point. An analysis that treats an inferred accept as equivalent to an observed one is asserting that the reconstruction is perfect — which is exactly the claim `analysis/event_validation.py` exists to test rather than assume.

#### Functions

| Function | What it enforces |
|---|---|
| `assert_no_content(attrs)` | Two passes: an exact-name blocklist, then a substring scan (`text`, `content`, `prompt`, `response`, `title`, `url`) for fields nobody anticipated, plus a length check — any string over 64 chars is content even under an innocent name. `prompt_length`/`response_length` are explicitly exempt from the substring pass. |
| `assert_session_relative(events, session_duration_ms)` | Every `t_ms` in `[0, duration]`. A producer that leaked wall clock shows up as a value in the 1.7e12 range. **This catch matters** because an unmapped timestamp has no clock offset applied, silently desynchronises its stream, and §3's clapperboard test cannot catch it either — the residual it measures assumes both streams are already on session time. |
| `validate_event(event)` | Source is valid; inferred only for inferrable types; required attrs present; closed vocabularies respected; no content. Non-AI events pass through untouched. |
| `validate_all(events)` | |
| `normalize(event, session_start_unix)` | **Compatibility shim, for reading already-recorded files only.** Converts the three historical envelopes into §3's. All three producers now emit §3 natively. Note the warning in its comment: desktop timestamps recorded before the fix were wall clock and carry no offset, so those sessions are unsafe for fusion no matter what this function does to the field names. |

`EventContractError` is a `ValueError` and is never caught to "clean up" an event. A producer that violates the contract is wrong and must be fixed.

### `problemproof/labels.py` (226 lines)

**The `labels.json` contract (§3) and its tiling rule.** Shape: `[{start_ms, end_ms, phase, source}]`. Six phases; `source` is `cued_recall`, `expert_a` or `expert_b`.

#### Why segments must tile

`analysis.feature_assembly.labels_to_1hz` walks the segments and writes each one's phase into a per-second array **initialised to zeros**. A gap therefore does not read as "unlabelled" — it reads as phase 0, `Understanding`. Two annotators who both leave the same 40-second gap would appear to *agree* there, inflating κ with agreement neither expressed. An overlap is the mirror problem: the later segment silently wins, so what the file says and what the model trains on differ.

Neither failure raises anything. Both produce a plausible confusion matrix. Hence the rule is enforced here, on write, rather than trusted to the UI.

#### Why one file per source

Two annotators labelling the same session is the entire point of the reliability gate, so **concurrent writes are the normal case**. A single shared array would mean read-modify-write on every save, and one annotator finishing while another has the file open would silently drop a whole pass.

It also makes blinding *structural*: `load_labels` takes one source and opens one file, so there is no argument a caller can pass — and no bug a caller can have — that returns another annotator's work.

| Function | Notes |
|---|---|
| `validate_source(source)` | Against §3's vocabulary, then against a regex, because it becomes a filename. |
| `labels_path(session_id, source)` | |
| `validate_labels(labels, session_duration_ms)` | Shape, phase vocabulary, integer bounds, `end > start`, one source per file, sorted, starts at 0, no gaps, no overlaps, ends within 1000 ms of the session end. Errors name the specific segment — an annotator who just spent 30 minutes deserves to know which boundary is wrong. |
| `save_labels(...)` | Validate, then write. Refuses if the file's declared source disagrees with the one it is being written as. |
| `load_labels(session_id, source)` | **The blinding boundary.** |
| `available_sources(session_id)` | Names only, never segments. Not reachable from the labelling route. |
| `load_for_reliability(session_id, a, b)` | The only function that opens two sources — named for its single legitimate caller, so "how could the UI leak another annotator's work?" is answered by checking this function's call sites. |

### `problemproof/env.py` (62 lines)

One `.env` at the repository root, read by both halves — this module for the backend, `envDir: ".."` in `vite.config.ts` for `VITE_`-prefixed variables.

`load_env(path=None)` is called explicitly from entrypoints, **never on package import**, for two reasons: importing a module should not mutate the process environment, and the test suite must not pick up a developer's local `.env` (that is how a suite passes locally and fails in CI). It is idempotent, and real environment variables always win over the file (`override=False`).

---

## 4. The API layer

### `api/app.py` (44 lines)

`create_app()` — one FastAPI app for every layer. Routers stay clear of each other by prefix:

| Router | Owns |
|---|---|
| `routes.py` | `/health`, `/sessions/{id}/{webcam,extract,signals}`, `/jobs/{id}` |
| `capture.py` | `/sessions/{id}/{screen,events}` (POST intake) |
| `labeling.py` | `/sessions/{id}/{screen,labels,graph,label-sources}` (GET/POST) |
| `calibration.py` | `/api/*` |

CORS defaults to the Vite dev origin; `PP_CORS_ORIGINS` overrides (comma-separated).

Calibration was originally a second FastAPI app on the same port. It is now a router on the same factory — `tests/test_calibration_api.py` asserts `/health` and `/api/health` coexist as distinct endpoints rather than colliding.

### `api/routes.py` (82 lines) — Extractor A

Upload → extract as a background job → poll → fetch.

| Route | Behaviour |
|---|---|
| `GET /health` | `{"status": "ok"}`. |
| `POST /sessions/{id}/webcam` | Streams the upload to `storage.webcam_path`. |
| `POST /sessions/{id}/extract` | 404 if no recording. Submits a closure to the job runner that calls `extract_signals`, writes the parquet, and returns `report.as_dict()`. Returns `{job_id}`. |
| `GET /jobs/{job_id}` | Status, progress tuple, result, error. |
| `GET /sessions/{id}/signals?format=` | `json` (NaN → `null`, since JSON has no NaN) or `parquet` (a `FileResponse`). Anything else is a 400. |

### `api/capture.py` (80 lines) — Stream B intake

The browser half of Stream B posts here at submit time.

| Route | Behaviour |
|---|---|
| `POST /sessions/{id}/screen` | Stores `screen.webm`. |
| `POST /sessions/{id}/events` | Writes `events.jsonl`, one JSON object per line. Optionally writes `features.csv` — the client has already binned events into 1 Hz rows, and storing its version keeps the session folder self-describing without the server re-deriving them. |
| `GET /sessions/{id}/events` | Reads the log back. |

`_session_dir` turns `storage`'s `ValueError` into a 400 rather than an unhandled 500.

### `api/labeling.py` (173 lines) — cued-recall labelling (§4)

| Route | Behaviour |
|---|---|
| `GET /sessions/{id}/screen` | **Serves a `206 Partial Content` Range response.** The labelling tool scrubs; without range support the browser re-downloads the whole recording on every seek. A malformed `Range` header is a 416. |
| `GET /sessions/{id}/labels?source=` | This annotator's own pass, or 404 if they have not started. |
| `POST /sessions/{id}/labels?source=` | Validates through `labels.save_labels` and stores. |
| `GET /sessions/{id}/graph` | The §2.4 process graph, if one has been built. |
| `GET /sessions/{id}/label-sources` | Which sources exist — **names only, never segments**. |

The blinding property is worth restating: the only route that returns segments takes exactly one `source` and reaches storage through `labels.load_labels`, which opens one file.

### `api/jobs.py` (85 lines)

No Celery, no Redis, no broker. Extraction is CPU-bound and this is a single-machine deployment.

`JobRunner` starts one daemon thread that pulls from a `queue.Queue` and runs jobs **strictly one at a time** — two sessions submitted together must not contend for the CPU mid-extraction. `submit(fn)` returns a job id; `fn` receives a `progress(done, total_or_None)` callback. All state mutation is under one lock. An exception inside a job is recorded on the `Job` as `status=ERROR` and `error=str(exc)`, never raised into the worker loop — one failed extraction must not take the runner down.

`JobStatus` is `QUEUED | RUNNING | DONE | ERROR`.

### `api/calibration.py` (626 lines)

The largest router; documented in full in [§7](#7-calibration--layer-3).

---

### `problemproof/performance_profile.py`

Layer 3. Assembles `performance_profile.json` — and refuses to, which is most of what it does today.

| Symbol | Notes |
|---|---|
| `SECTIONS` | Eight `Section`s, each naming the registry feature that governs it. A declared table, so "which gate governs this number" is one list rather than a call path. A test asserts every `feature_id` exists in the registry. |
| `assemble(session_id, reg)` | Refuses before `validation.is_validated`. Then checks the gate per section: a failing one lands in `withheld` with the registry's own reason; a passing one with no data for this session lands there too, with a **different** reason — the remedies differ (a measurement vs a pipeline run). |
| `gated_sections(reg)` | Session-independent. What the gate withholds is a fact about the FEATURES, and the reviewer needs it before opening a review — which is before validation and before `assemble` will run at all. Without this split, an unvalidated session renders a blank dashboard with no explanation. |
| `assert_profile_clean(value)` | Walks the whole object. Exact-name blocklist plus substring scan, the same two-pass shape as `events.assert_no_content`. Called by `assemble` AND by `write` — the same check today, and not the same the moment anything is added between them. |
| `FORBIDDEN_FIELDS` | Affect labels, captured content, biometric representations, CV prose. Extend it; never relax it. |
| `_EXEMPT` | `keystroke_count` and `keystroke_interval_ms` — counts *about* forbidden content rather than the content. The exemption list is where a decision to allow something has to be visible. |

**`statement`, not `prompt`.** The assessment context carries the problem statement under `statement`. `prompt` is in `FORBIDDEN_FIELDS` because in this system it means text a participant sent to an AI tool. The problem statement is text we generated and gave to them — opposite provenance, and the participant is entitled to see it. The two nearly collided: the section originally used `prompt` and would have tripped its own cleanliness check the moment the feature was promoted.

### `problemproof/validation.py`

Layer 4: the lifecycle, the immutable annotation version, and the reviewer audit trail. A contract module, beside `events.py` and `labels.py`, for the same reason — one shape, one writer, validated where it is produced.

| Symbol | Notes |
|---|---|
| `LIFECYCLE` | The four states in order. **Adjacency in this tuple IS the transition rule** — there is no second table to fall out of step with it. |
| `transition(...)` | The ONLY writer of `state`. Refuses a jump, a repeat and a reversal, each with its own message: they are different mistakes. |
| `freeze_annotation(...)` | Copies every `labels.*.json` into `annotations/v{n}/` with a SHA-256 per file. Copies rather than references — a reference leaves the decision resting on a file the annotator can still save over. Refuses an unlabelled session and refuses to write into an existing version. |
| `verify_version(...)` | Re-checks the hashes. Returns the list of files that no longer match, so "immutable" is checkable rather than merely forbidden. Returns names, not a boolean — an operator finding a mismatch needs to know which file. |
| `begin_review(...)` | Freezes **then** transitions. The ordering is the point: the reviewer judges a record that cannot move while they read it. |
| `record_decision(...)` | `disputed` records the dispute and does **not** move to `validated`. Refuses a decision with no frozen version behind it. |
| `request_revision(...)` | Records the request; changes no state. A revision is the same review continuing, not the session leaving the organisation. |
| `refreeze_annotation(...)` | New version, previous one untouched. Refuses without a prior request — otherwise it would create a version nobody asked for and silently move the review onto it. |
| `severity_for(decision, delta)` | Server-side and only server-side. `MODERATE_DELTA` is 2 — half a 0–4 rubric scale, past which a reviewer is replacing a judgement rather than adjusting one. |
| `is_validated(session_id)` | A predicate, not a state string, so a caller cannot accidentally accept `organization_review` by writing `!= "participant_submitted"`. Read by Layer 3. |
| `audit(...)`, `audit_for_session(...)` | Append-only, at `data/audit/validation.jsonl`. Separate from `api/admin.audit`, which logs OUR staff accessing customer data — a customer asking "who at my organisation looked at this" must not be handed a log of our support accesses to other tenants. |

**What this module deliberately does not import.** Not `analysis.reliability`, not `labels.load_labels`, and it names no annotator source anywhere. Organisation review and the two blinded expert passes answer different questions of the same session, and letting either see the other's answer contaminates it. `tests/test_validation_lifecycle_contract.py` asserts both directions by parsing the AST — a text search would fire on the paragraphs in each module explaining the rule.

### `problemproof/api/validation_routes.py`

Authorisation is narrower than reading a session, in two directions. **Submitting** is owner-only: a reviewer who could submit on somebody's behalf would start a validation the participant never asked for. **Reviewing** needs `reviewer`/`org_admin` AND the session's tenant — `authorize_session` grants the owner read access, so without the role check on top a candidate could validate their own record and the whole layer would be decorative.

`GET /evidence`'s *side effect* is the point: it writes the audit record that makes the reviewer surface's "your access is logged" a true sentence. `GET /validation/audit` is deliberately not audited itself.

## 4a. The personalisation layer

Layer 0 — what a session is *about*, decided before any capture happens. Two packages, neither importing `api/`.

### `problemproof/profile/schema.py`

**The one contract that matters here.** `extracted` and `approved` are separate fields, and nothing crosses between them except `approve`, which records an actor and a timestamp.

| Symbol | Notes |
|---|---|
| `NODE_TYPES`, `RELATION_TYPES`, `PROVENANCE_SECTIONS` | Closed vocabularies. An invented type is a bug, not a new category. |
| `MAX_LABEL_CHARS` (120) | The ceiling `assert_no_cv_prose` enforces. Same instrument as `events.assert_no_content`, aimed at a different leak. |
| `make_node`, `make_edge`, `validate` | Validated on construction and on write. A dangling edge is **refused**, not dropped: dropping it would quietly change what the graph says about a person. |
| `approve(graph, ids, actor, edited)` | Returns a new graph. Refuses an id the parser never emitted — a claim the participant added themselves is not evidence about the parser and goes through `add_claim`. An edit keeps the parser's original in `extracted_label`, because RQ5 counts edits and overwriting in place would delete the measurement. |
| `reject(...)` | The node **stays** in `extracted`. Deleting it would make the graph agree with the participant and destroy the comparison RQ5 is. |
| `add_claim(...)` | Lands in `approved` with `origin: "participant"` and deliberately not in `extracted`. |
| `review_metrics(graph)` | RQ5's counts. `rejected` counts distinct nodes, not events — counting events would make precision a function of how indecisive the reviewer was. Returns counts, never a ratio. |

### `problemproof/profile/extraction.py`

Deterministic, sectioned, dictionary-based. **Not a language model**, and the module docstring states why: `removed-emotion-monitor.md`'s 42-of-50 fabrication result. A model that invents a skill from a CV makes RQ5 a hallucination-rate measurement under another name. Checked against `KG/` (a standalone LLM+NER resume-graph pipeline elsewhere in this repo) and confirmed the decision rather than reopening it — see the module docstring's "ESCO-grounded coverage" note.

| Symbol | Notes |
|---|---|
| `SKILL_CONFIDENCE` | Stated priors per extraction route, 0.6–0.9. `ExtractionReport.confidence_provenance` is `stated-priors-not-fitted` so nobody reads them as probabilities. |
| `KNOWN_TECHNOLOGIES` | The dictionary, visible and finite. A skill absent from it is a known miss rather than a mystery. |
| `read_text(path)` | PDF via `pypdf`; **DOCX via stdlib `zipfile` + `ElementTree`**, tables included — a good number of CVs lay their skills out in one. Each format fails with its own message because each needs a different remedy. |
| `sectionise(text)` | Groups lines under headings. A document with none is reported as `unsectioned` at the lowest confidence, never guessed at as a skills list. |
| `_find_technologies` | Word-boundary matched, longest first, so `go` inside "Google Cloud" and `r` inside anything do not match. Prose-scanning only — never given to the ESCO matcher; see `esco.py`. |
| `extract_graph(..., skill_matcher=None)` | Returns a whole graph whose `approved` half is empty by construction. `skill_matcher` is optional and unset by default; when given, it is consulted **only** for Skills-section items `KNOWN_TECHNOLOGIES` misses — dictionary first, always. |
| `add_skill(..., esco_id=None, esco_similarity=None)` | The two ESCO fields are additive and separate from `confidence` — a stated prior for the route vs. a measured taxonomy-match score. Not conflated into one number. |
| `ExtractionReport.esco_attempted` / `esco_accepted` | 0/0 when no matcher was supplied — distinct from "supplied but found nothing." |

### `problemproof/profile/esco.py` (new, 2026-08-20)

The optional second skill matcher: local sentence-transformer embeddings against a bundled copy of the public ESCO v1.1.1 taxonomy (`data/esco_skills.csv`, 13,896 concepts, trimmed from `KG/`'s copy — see `data/PROVENANCE.md`). Ported and scoped down from `KG/src/resume_kg/esco.py`.

| Symbol | Notes |
|---|---|
| `EmbedFn` | The injection point. `EscoMatcher.__init__` takes an embed function rather than building one, so every test in this module and in `extraction.py`'s ESCO-integration tests supplies a small deterministic fake — no model download, no network, no `sentence-transformers` install needed to run the suite. |
| `_embed_with_model(name)` | The one place `sentence_transformers` (and the `torch` it pulls in) is imported — lazily, inside the function, same convention as `cv2`/`mediapipe`/`mss`/`pynput` elsewhere in this backend. |
| `DENYLIST_LABELS` | Confirmed lexical-coincidence false attractors ("numpy"→"numerology", "KNN"→"Vyper"), ported verbatim from `KG/src/resume_kg/config.py`, which recorded how each was confirmed. A score-only cutoff cannot filter these — raising the threshold to exclude them would also exclude genuine matches scoring lower. |
| `EscoMatcher.match_many(...)` | Returns `EscoMatch \| None` per input, never forces a low-confidence match — an honest unmapped raw node beats a wrong ESCO id, same principle `KG/`'s README states for its own graph. |
| `_load_or_build(cache_path)` | Rebuilds automatically if the cache was built under a different embedding model — serving a stale cache would degrade match quality with no error anywhere to explain why. |
| `resolve_default_matcher()` | `None` unless `PP_ESCO_SKILL_MATCHING=on` (an explicit sentinel, not any truthy value — same shape as `PP_DEV_BYPASS_RELEASE_GATE`). **Raises** rather than silently falling back if enabled and unavailable. |

**No CV content leaves the machine, with or without this enabled.** Matching runs against phrases already isolated by `extraction.py` (short Skills-list items, never a paragraph of prose) against a **local** taxonomy copy with a **local** model. The one network dependency is a one-time embedding-model download from Hugging Face on first use; after that, the cache makes every run offline.

### `problemproof/assessment/families.py`

| Symbol | Notes |
|---|---|
| `VALIDITY_PROPERTIES` | Main_Idea's seven. `validate_family` refuses a family declaring fewer: a problem missing one produces no observable process, so a session recorded against it measures nothing. |
| `DIFFICULTY_TIERS`, `DOMAIN_TRACKS` | From Main_Idea's Problem Library Architecture. |
| `RUBRIC_DIMENSIONS` | Fixed across families. Ratings are pooled; a family scoring something else would put a different measurement under the same column. |
| `QuestionFamily.key` | `id@vN`. Stored on `question.json`; a bare id would let a v1 session be pooled with v2 sessions whose rubric means something else. |
| `FAMILIES` | Three shipped. Editing one's rubric or difficulty wording is a version bump, not an edit. |

### `problemproof/assessment/spec.py`

Owns `exam_spec.json` **and the generator boundary**.

`generator_payload(spec, graph)` is built as a literal, field by field — an **allowlist**, not a filtered copy. A denylist is wrong every time a field is added upstream, silently, in the direction of leaking. `PAYLOAD_KEYS` and `FORBIDDEN_PAYLOAD_KEYS` are both declared, and `tests/test_generator_payload_is_clean.py` walks the actual outgoing dict against them.

`build_spec` refuses: an unapproved node, an empty selection, a selection with no Skill in it, and a duration outside the family's range for that tier. Each is a case where proceeding would produce a session whose record says something untrue.

### `problemproof/assessment/generator.py`

| Symbol | Notes |
|---|---|
| `QuestionGenerator` | A `Protocol`, not a base class. The two implementations share no code, which is what makes the swap real. |
| `TemplateGenerator` | Deterministic — the same payload gives byte-identical output including the question id, which is a hash of the payload. The default, and what every test uses. |
| `ProviderGenerator` | Takes a client callable rather than building one, so it holds no credentials and has no way to reach a candidate id. A fallback, if configured, is recorded in `generated_by` and `fallback_reason` rather than silently substituted. |
| `default_generator()` | Returns `TemplateGenerator` when `PP_QUESTION_PROVIDER` is unset — which it is, everywhere. **Raises** when it is set, rather than pretending: wiring a provider means editing `features.toml` in the same commit. |
| `build_rubric(payload)` | Generated with the question and stored with it. A rubric regenerated at scoring time is a different rubric, and ratings would stop being comparable with nothing in either file saying so. 0–4 with named labels; an even scale forces a direction. |
| `generate_question(spec, graph, generator)` | Calls `generator_payload` **here**, in one place, so no implementation can widen its own input. |

### `problemproof/api/personalisation.py`

Two scopes and two authorisation functions. `/candidates/*` goes through `tenancy.authorize_candidate` (participant and staff only — a skill graph is not an organisational record); `/sessions/*` reads through `authorize_session` but **writes** through an owner check, because a reviewer choosing which skills to assess after the fact would be authoring the evidence they later validate.

`MAX_CV_BYTES` (4 MB) is enforced while streaming, not after. Every refusal is `_not_found()` — one constructor, so no two refusals differ by a word.

`PUT /candidates/{id}/profile-graph` takes an **action**, never a whole graph. A whole-graph PUT makes approval a side effect of a form round-trip, which is the exact failure `profile.schema` is built to make impossible, arriving through the API instead of through the model.

## 5. Extractor A — webcam

Session video in, 5 Hz `signals.parquet` out. Hand-crafted signals only — §2.2 forbids emotion categories, and no blendshape output is ever requested.

### `extractors/webcam/schema.py` (76 lines) — the contract

Frozen in week 1 and shared with three other modules. Adding a column is survivable; renaming or retyping one is not.

| Constant | Value / meaning |
|---|---|
| `BIN_HZ`, `BIN_MS` | 5 Hz, one row per 200 ms. |
| `BLINK_WINDOW_MS` | 30 000. A blink lasts 100–400 ms, comparable to one bin, so a per-bin blink count is not a rate estimate — it is a 0/1 coin flip. The rate is computed over a long trailing window and *sampled* at 5 Hz. |
| `DISPERSION_WINDOW_MS` | 2 000. Short enough to track within-phase change, long enough that the SD is not pure noise. |
| `N_LATENT` | 64, reserved for Extractor B. Emitted as all-NaN `float64` so the column set and dtypes never change when Extractor B lands. |
| `FEATURE_COLUMNS` | `blink_rate_hz, ear_mean, ear_std, gaze_dispersion, gaze_screen_fraction, head_pose_stability, motion_energy` |
| `VALIDITY_COLUMNS` | `face_valid_fraction` — an addition to §3 as written. Without it a consumer cannot distinguish "the subject held perfectly still" from "we lost the face for four seconds". |

`empty_row(t_ms)` is what a bin with no usable face looks like: every feature NaN, `face_valid_fraction` **0.0 rather than NaN** — the fraction itself is known exactly.

### `extractors/webcam/timebase.py` (188 lines) — where `t_ms` comes from

**CONSTRAINT: timestamps are never `frame_index / nominal_fps`.** Three reasons, all fatal here:

- Webcams do not deliver their nominal rate. A "30 fps" consumer camera drops to 15 the moment the room dims, because the driver extends exposure. The header still says 30.
- `MediaRecorder` output is variable-frame-rate by construction.
- The error is *cumulative*. Half a percent of rate error is 12 seconds of drift across a 40-minute session — two orders of magnitude past §3's <100 ms target, and monotonically growing, so the end of the session is the least trustworthy part.

| Function | Notes |
|---|---|
| `decode_with_pts(path, clock_offset_ms)` | Yields `DecodedFrame(pts_ms, session_ms, image)`. A frame with no timestamp is skipped rather than assigned one. If *no* frame carried a PTS, raises `TimebaseError` — a caller that cannot get real timestamps must fail loudly, because a fabricated timebase corrupts every downstream fusion. |
| `summarise_timebase(pts_ms, nominal_fps)` | Builds `TimebaseReport`: frame count, duration, median dt, effective fps, non-monotonic count, max gap. Warns on non-advancing PTS (damaged container), >5% nominal/effective divergence, and >1 s inter-frame gaps. |
| `probe_nominal_fps(path)` | The container's *claimed* rate. Recorded for comparison only. |
| `bin_edges(first_ms, last_ms, bin_ms)` | Bins are anchored to a whole multiple of `bin_ms` **in session time**, not to the first frame — so two recorders sharing a session clock produce bins that line up exactly rather than being offset by a fraction of a bin. |

### `extractors/webcam/landmarker.py` (157 lines)

Thin wrapper over MediaPipe Face Landmarker.

| Symbol | Notes |
|---|---|
| `model_path()` | `PP_FACE_LANDMARKER_MODEL` overrides the default. One model file on disk, shared with calibration. |
| `ensure_model(path)` | Downloads the bundle if absent. Also runnable as `python -m problemproof.extractors.webcam.landmarker`. |
| `FrameLandmarks` | Per-frame output in plain numpy, with `.valid`. |
| `FaceLandmarkerRunner` | Context manager, **VIDEO running mode** — a decoded stream has a monotonic timestamp, so frame-to-frame tracking has something to track. (Calibration uses IMAGE mode for the opposite reason; see §7.) |

### `extractors/webcam/geometry.py` (290 lines) — pure maths

No I/O, no MediaPipe, no OpenCV. numpy/scipy only, which is why `tests/test_geometry.py` can carry 333 lines of assertions with no fixtures.

| Function | Notes |
|---|---|
| `denormalize(landmarks, width, height)` | Normalised coords → pixels on a **non-square** image. Scaling both axes by the same factor is the classic bug here. |
| `eye_aspect_ratio(eye_pts)` | EAR from six pixel-space points, `p1..p6`. |
| `mean_direction(vectors)` | Mean direction on the sphere: normalise the resultant. |
| `angular_dispersion_deg(vectors)` | Angular SD about that mean, in degrees → `gaze_dispersion`. |
| `karcher_mean_rotation(rotations)` | Fréchet/Karcher mean on SO(3) — the true intrinsic mean, not a componentwise average of quaternions. |
| `geodesic_dispersion_deg(rotations)` | Geodesic SD on SO(3) → `head_pose_stability`. |
| `rotation_from_transform_matrix(matrix)` | Extracts a *proper* rotation from MediaPipe's 4×4 facial transform. |
| `gaze_direction(iris_center, eye_center, eye_width, head_rotation)` | Unit gaze vector, optionally rotated into the world frame. |
| `on_screen(direction, half_angle_deg)` | Whether a gaze direction falls inside the screen cone → `gaze_screen_fraction`. |

Angles on a sphere and rotations in SO(3) do not average componentwise. Doing it the easy way gives a number that looks fine and is wrong by tens of degrees near the wraparound — hence the explicit spherical and geodesic treatments.

### `extractors/webcam/blink.py` (225 lines)

| Symbol | Notes |
|---|---|
| `BlinkThresholds` | A hysteresis pair; `close < open` is enforced in `__post_init__`. A single threshold chatters on every sample that sits on it. |
| `thresholds_from_profile(profile)` | Reads the subject's thresholds from a §2.1 baseline profile — the preferred source. |
| `thresholds_from_session(ear_values)` | Self-calibration from the subject's own EAR distribution, when no profile exists. |
| `BlinkDetector` | Hysteresis state machine over `(t_ms, EAR)` samples. `update` returns True exactly once per completed blink; blinks shorter than `MIN_BLINK_MS` are rejected. |
| `blink_rate_series(blink_times, valid_frame_times, sample_times)` | Rate in Hz over a trailing window, **sampled** at 5 Hz — not a per-bin statistic. Both sequences are windowed by binary search on a half-open `(start, end]` interval. |

Two things `blink_rate_series` refuses to do:

- **The denominator is observed eye time, not wall clock.** Frames where the face was missing cannot contribute blinks, so counting them would dilute the rate toward zero exactly when tracking is worst — i.e. it would report "this person stopped blinking" for "we stopped seeing them".
- **`frame_dt_ms` comes from the median PTS delta of the actual container, never a nominal fps.** A window with less than `min_span_s` of observed time yields NaN rather than a rate computed from three frames.

Adjacent output rows share most of their support. That is expected, and is what makes the series interpretable at 5 Hz at all.

The report records `blink_threshold_source` so a reader can tell a profile-calibrated session from a self-calibrated one.

### `extractors/webcam/motion.py` (140 lines)

| Function | Notes |
|---|---|
| `face_anchors(pixel_landmarks)` | Three stabilisation correspondences in pixel space. |
| `stabilised_crop(image_rgb, pixel_landmarks)` | Warps the face to a canonical pose and standardises intensity. Without stabilisation, "motion energy" would measure the camera and the lighting rather than the person. |
| `motion_energy(previous, current, dt_ms, median_dt_ms)` | Mean absolute difference between consecutive stabilised crops, normalised by the frame interval so a dropped frame does not read as a burst of movement. |

### `extractors/webcam/pipeline.py` (404 lines) — the whole extractor

`extract_signals(video_path, *, clock_offset_ms, baseline_profile, model, progress) -> ExtractionResult`

**Returns; never writes.** The caller persists.

| Piece | Role |
|---|---|
| `ExtractionReport` | Everything a consumer needs to judge whether to trust the table: frame/face counts, `face_valid_fraction`, blink threshold source and values, `has_iris_landmarks`, effective vs nominal fps, duration, clock offset, and a `warnings` list. `as_dict()` maps non-finite floats to `None`, since JSON has no NaN and `None` round-trips honestly as "not measured". |
| `_FrameFeatures` | Per-frame intermediates accumulated during the single decode pass. |
| `_eye_metrics(pixels, head_rot, has_iris)` | Mean EAR across both eyes plus the combined unit gaze direction. Returns NaN gaze when the landmarker gave no iris points. |
| `_decode_pass(...)` | **One decode of the video.** Detect, denormalize, head rotation, EAR, gaze, stabilised crop, motion. A frame with no face still appends a row — with NaN features and `valid=False` — and resets `prev_crop`, because a gap breaks the motion pair. Progress fires every 30 frames. |
| `_estimate_total_frames(path)` | Best-effort, **for progress reporting only**. WebM from `MediaRecorder` usually reports 0 frames, in which case progress is reported without a denominator rather than against a fabricated one. |

The binning stage, after the decode:

1. Blink thresholds from the profile if present, else self-calibrated, else a warning and NaN blink rate throughout.
2. Hysteresis pass over the full EAR series to collect blink times.
3. `bin_edges` at 200 ms; blink rates sampled at the bins' **right edges** — the instant each bin summarises.
4. Per bin: EAR mean/SD, motion mean, on-screen fraction from frames inside the bin; gaze dispersion and head-pose stability from the trailing 2 s window.

Three refusals to invent data:

- **A bin with no usable face emits `empty_row`** — never interpolated, never forward-filled. A consumer must be able to see the gap.
- **`ear_std` is NaN below two samples.** A one-sample SD is 0.0 by convention, which reads as "perfectly steady". It is not — it is unmeasured.
- **Dispersion statistics require ≥2 points in the window**, else NaN.

Warnings the report raises: face resolved in <50% of frames ("probably unusable"), no iris points ("gaze columns are NaN for the whole session"), plus everything from the timebase report.

---

## 6. Extractor B — screen

The OS-level desktop capture agent. Runs on the participant's own machine, not on the server. Needs a real desktop — these modules want display and OS input access and cannot run headless, which is why the analysis half imports none of them.

### `extractors/screen/config.py` (165 lines)

Central configuration, all module-level constants.

| Constant | Notes |
|---|---|
| `BASE_OUTPUT_DIR` | Env-overridable. |
| `RECORDING_FPS` (20), `RECORDING_CODEC` (`mp4v`), `RECORDING_SCALE` | Within the requested 15–30 fps range. |
| `ACTIVE_WINDOW_POLL_INTERVAL_SEC` (0.5) | How often the foreground window is sampled. |
| `IDLE_THRESHOLD_SEC` (30) | No input for this long → idle. |
| `EVENT_FLUSH_INTERVAL_SEC` (2.0) | Buffered events → disk. |
| `BROWSER_PROCESS_NAMES`, `AI_TOOL_PROCESS_NAMES`, `AI_TOOL_TITLE_MARKERS` | How an AI tool is recognised from the foreground window. |
| `SEARCH_ENGINE_TITLE_MARKERS`, `SITE_CATEGORY_TITLE_MARKERS`, `UNCATEGORISED_SITE` | Coarse site categorisation. |
| `EDITOR_TARGET_FILE` (`solution.py`), `FEATURE_INTERVAL_SEC` (1.0) | |
| `CONSENT_NOTICE` | The text shown before capture starts. |

### `extractors/screen/window_tracker.py` (84 lines)

`get_active_window_info()` → `{"process_name", "title"}` or `None`. Best-effort across platforms, with `_get_active_window_windows` (pywin32 + psutil), `_get_active_window_macos`, `_get_active_window_linux`. Returning `None` rather than raising is deliberate: an unavailable tracker degrades the capture, it does not end the session.

### `extractors/screen/event_logger.py` (441 lines)

**Metadata only, never content.** The single most safety-critical file in Stream B.

| Helper | Notes |
|---|---|
| `_hash_title(title)` | One-way, truncated hash. Lets "did the tab change?" be answered without the title ever being stored. |
| `detect_site_category(process_name, title)` | Coarse category for a browser tab, or `None` if not a browser. |
| `detect_ai_tool(process_name, title)` | Identifies an external AI tool from the foreground window. |
| `_clipboard_length()` | Characters on the clipboard, or `None` if unreadable — the length, never the text. |
| `_WorkspaceFileHandler` | watchdog handler → `file_created` / `file_modified`, basename only. |

`EventLogger` runs four threads:

| Loop | Emits |
|---|---|
| `_window_poll_loop` | `app_switch`, `tab_change`, `search_activity_detected`; drives `_track_ai_tool`. |
| `_flush_loop` | Buffered events → `event_log.jsonl` every 2 s, so a crash loses seconds not the session. |
| `_idle_check_loop` | `idle_start` / `idle_end` with `idle_duration_sec`. |
| keyboard/mouse listeners | `keystroke` (interval only — **never which key**), `copy_event`, `paste_event` (with `char_count`), `save_shortcut_pressed`. |

`_track_ai_tool(info)` opens and closes an external AI session as the foreground window changes; `_close_open_ai_tool()` closes any still-open session at end of capture so its duration is not lost. `_log` writes the §3 envelope `{t_ms, type, attrs}` directly — it is a native §3 producer, not a legacy one.

### `extractors/screen/screen_recorder.py` (103 lines)

`ScreenRecorder` — continuous full-screen capture to a compressed MP4 on its own thread, via `mss` + `cv2.VideoWriter`. `start()`/`stop()`, with `_run` as the loop.

Frame timestamps are written separately to `frame_timestamps.json` (unix time per frame), because the MP4's own container timing is written at the *target* fps regardless of what the capture loop actually achieved. That file is Stream B's equivalent of what `timebase.py` gets from PTS on Stream A — and for the same reason: a nominal rate is not a measurement.

### `extractors/screen/session_manager.py` (154 lines)

`Session` owns the on-disk layout and the session id. Path properties: `video_path`, `frame_timestamps_path`, `event_log_jsonl_path`, `event_log_json_path`, `feature_vectors_path`, `metadata_path`.

| Method | Notes |
|---|---|
| `_write_metadata(finalized, ai_metrics)` | |
| `finalize(ai_metrics)` | Closes the session and writes the session-level derived metrics into the manifest. |
| `consolidate_event_log()` | Turns the durable `event_log.jsonl` *stream* into a single JSON array. Two formats on purpose: the stream survives a crash, the array is what the feature extractor reads. |

### `extractors/screen/inference.py` (260 lines) — reconstructing AI use

Derives `source="inferred"` events from three deterministic signals the agent already records: foreground window identity, clipboard length, keystroke timing.

**Why not read the screen recording.** OCR or a vision-language model could in principle recover more. Two reasons not to: error compounds (region detection × OCR accuracy × matching heuristic, each needing its own validation before the product means anything), and this project already has a negative result on exactly that architecture — a VLM asked to describe screen content asserted evidence absent from its input in 42 of 50 cases. The recording is therefore *evidence*, not input: it is what the human annotator watches when measuring how good this reconstruction is.

| Symbol | Notes |
|---|---|
| `MIN_ACCEPT_CHARS` (120) | Below this a paste is ordinary editing — a variable name, a URL, a line moved within the file. Counting those as delegation would inflate `delegation_ratio` with the participant's own work. |
| `ACCEPT_WINDOW_MS` (30 000) | How long after leaving an AI tool a paste can still be attributed to it. **The single most consequential number in the module.** |
| `AcceptConfig` | The two thresholds *plus* `provenance`. Separated from the module so `fit_accept_thresholds.py` can sweep them. |
| `InferenceReport` | Accepts inferred, pastes seen, and each rejection reason counted separately — too small, no recent AI, unknown length. Carries the `AcceptConfig` that produced them. |
| `_ai_intervals(raw_events)` | `(start, end, tool_id)` per stretch an AI tool held the foreground. An open with no close is left open-ended. |
| `_tool_active_within(intervals, t_ms, window_ms)` | "Within" rather than "at", because the accept happens *after* the participant leaves the tool: copy, alt-tab, click, paste. |
| `infer_ai_events(raw_events, config)` | Returns `(events, report)`. Does not modify the input, so the raw signals stay in the file next to the inference — an annotator checking a disputed accept can see the paste and the window state that caused it. |
| `annotate_log(raw_events, config)` | The log with inferred events merged in, time-ordered. **Called by `agent.finalize_session`** — it had no production call site until 2026-08-19. |
| `accept_count_reportable(report)` | `(bool, reason)`. False while `provenance` is `UNFITTED` or unrecorded. |
| `read_accept_count(report)` | The accept count, or `ProvenanceError`. The accessor every consumer outside the module should use; reaching past it to `accepts_inferred` is legal Python and is exactly how an unqualified number gets in front of somebody. |

**Why `provenance` is a field and not a comment.** Fitting the thresholds on the same five sessions the model is evaluated on is a forking path. It is a defensible one — five sessions is what there is — but only if it is declared. `UNFITTED = "unfitted-intuition"` is the default and is deliberately the least flattering label: a run reporting it next to a `delegation_ratio` is telling the reader exactly how much to trust the denominator.

`prompt_submit` and `response_received` are not emitted. A foreground AI tool plus keystrokes is equally a prompt being typed, a search being refined, or a reply being read while the participant fidgets.

### `extractors/screen/feature_extractor.py` (327 lines)

`event_log.json` → `feature_vectors.csv`, one row per `FEATURE_INTERVAL_SEC`, **covering the whole session including intervals with no events** so gaps are visible rather than silently skipped. No dependency on mss/pynput/watchdog/psutil, so it runs and tests anywhere.

`FIELDNAMES` carries app switches, tab changes, copy/paste counts, keystroke count and interval statistics, typing speed, search activity, file saves, active app, idle percentage, plus `ai_accepts`, `verification_actions`, `ai_tool_active`.

**Why the session-level metrics are deliberately *not* per-interval columns:** each is computed over the whole session, so a per-interval copy would hand the segmentation model a feature derived from that interval's future. `delegation_ratio` is the clearest case — its denominator is the final artifact, which does not exist at t=0. They live in the session manifest instead.

| Function | Notes |
|---|---|
| `derive_ai_metrics(events, session_start)` | The §2.3 derived metrics plus their coverage denominators. **Each is `None` when it cannot be computed — never 0.0**, which would read as a measured absence rather than no data. |
| `compute_delegation_ratio(metrics, final_artifact_chars)` | AI-origin characters over total characters. Inherits the inference's precision and recall — report it with those numbers or not at all. |
| `external_ai_fraction(metrics)` | Share of detected AI time spent outside the instrumented panel. With no in-portal assistant this is 1.0 whenever AI was used, and `observed_ai_fraction` is 0.0 — which is the honest number. |
| `extract_features(events, session_start, session_end, interval_sec)` | |
| `write_feature_csv(rows, path)` | |

**`verification_latency` is the one metric hybrid capture does not degrade, and it is why RQ3 survives the design.** `verification_action` is emitted by our own editor regardless of where the accepted code originated, so we observe the check even when we could not observe the generation. An accept with no following verification is excluded from the mean and counted in `unverified_accepts` — it is a real behaviour (submitted without checking), not a gap, and averaging it in as some arbitrary large latency would be an invention.

### `extractors/screen/preflight.py` (423 lines)

**Prove the agent actually captures, on this machine, before session one.** A headless box, a missing macOS accessibility grant or an unreadable clipboard each produce a session that looks recorded and contains nothing.

`Check(name, ok, detail, required)` with `.line()` for a scannable summary.

| Check | Catches |
|---|---|
| `check_pynput()` | Input listeners unavailable. |
| `check_window_tracker()` | The foreground window is what `ai_session_open` is built from. |
| `check_clipboard_read()` | Informational, not a verdict. |
| `check_clipboard_roundtrip(restore)` | Writes a known string and reads it back **through the real path**; restores what was there. |
| `check_display()` | A headless box is the standard way this layer produces nothing. |
| `check_macos_accessibility()` | Named separately because it is the failure mode **with no error message**. |

`live_probe(seconds)` runs the real `EventLogger` against a temp file (via `_ProbeSession`, which exposes just the two attributes the logger needs) and checks what it actually caught. `run(seconds, static_only)` / `main(argv)` drive it.

### `extractors/screen/validate.py` (203 lines)

Two independent things: `validate_session(session_dir, ...)` returns `check -> (passed, detail)` over a finished session's outputs — frame rate against `expected_fps`, feature interval coverage, tolerances — and `print_validation_report(results)` formats it. `simulate_exam_behaviour(duration_sec)` drives real OS interactions to exercise every logged signal at once, so the validator has something to validate without a human sitting an exam.

### `extractors/screen/agent.py` (111 lines)

`run(workspace_dir, duration_sec, user_id, fps, interval, session_id)` — prints `CONSENT_NOTICE`, creates the `Session`, starts `ScreenRecorder` and `EventLogger`, then waits for `--duration` or Ctrl+C (a `SIGINT` handler sets a flag rather than raising, so the `finally` block runs a clean shutdown either way).

Teardown order is load-bearing and commented as such: stop both producers → `consolidate_event_log()` → `derive_ai_metrics(events)` → `finalize(ai_metrics=...)` → `extract_features` → `write_feature_csv`. Consolidation must precede finalize because `external_ai_fraction` is derived from the event log and the manifest carries it.

`delegation_ratio` stays `None` here by design: the desktop agent never sees the submitted artifact — that lives in the browser — so it has no denominator. The browser's own submit path supplies it.

`build_parser()` / `main(argv)` are the CLI surface behind `cli/screen_agent.py`: `--session-id` (omit to mint a new one), `--workspace-dir`, `--duration`, `--user-id` (stored only as a one-way hash), `--fps`, `--interval`.

**Note that `run` does not call `inference.annotate_log`** — see [§11](#11-known-gaps-and-stale-references).

---

## 7. Calibration — Layer 3

People differ in natural pace, blink rate and expressiveness. Scoring everyone against a population average penalises introverts, neurodivergent candidates and whole cultures of expression. This layer records a short calibration session per candidate and derives a Euclidean-Alignment transform mapping their later session features into a personal frame.

### `calibration/pipeline.py` (802 lines) — library *and* CLI

Six subcommands: `week1`, `extract`, `synth`, `align`, `evaluate`, `pipeline`. The last runs end to end on synthetic data with no camera.

`FEATURES` (8 columns) is the calibration feature vector: `blink_rate_hz, ear_mean, ear_std, head_movement, head_pose_stability, mouth_open_mean, eyebrow_raise_mean, smile_width_mean`.

#### Capture

| Symbol | Notes |
|---|---|
| `week1_camera_face_detection()` | Live webcam + mesh overlay. Needs a real camera and a display. |
| `eye_aspect_ratio`, `head_pose`, `_dist`, `_landmark_xy` | Per-frame geometry; `head_pose` is `solvePnP` against a 6-point 3-D model. |
| `BlinkDetector` | EAR threshold with a `consec_frames` debounce. |
| **`FeatureExtractor(frame_w, frame_h, window_sec=1.0)`** | Fed landmarks per frame via `update()`; returns a dict of aggregated features every ~1 s of accumulated frames, else `None`. **This is the class the API drives, one HTTP frame at a time.** |
| `week2_run_live_capture(...)` | Standalone capture loop → CSV. |

#### Alignment

| Function | Notes |
|---|---|
| **`compute_ea_transform(X_calib, reg=1e-6)`** | Returns `R^(-1/2)` for the regularised covariance, by **eigendecomposition rather than `scipy.fractional_matrix_power`**. `R` is a regularised covariance, so it is symmetric positive-definite by construction and `V diag(w^-1/2) V^T` is exact and real; the general routine goes through Schur + SVD, is slower, and can return a complex result needing `.real` taken off it. Eigenvalues are clamped at `reg` — a rank-deficient calibration set can leave a non-positive eigenvalue through floating-point error, and a negative under a −1/2 power is where a NaN transform would come from. |
| `apply_alignment(X, R_inv_sqrt, center)` | |
| `build_baseline_profiles(df, ...)` | Fits EA per subject on calibration-only rows, applies it to all of that subject's rows. |
| `save_baseline_profiles(profiles, out_dir)` | |

#### Evaluation (RQ1)

| Function | Notes |
|---|---|
| `compute_icc_2_1(...)` | ICC(2,1), Shrout & Fleiss two-way random effects, single measure. The headline: lower after EA means trait variance was removed. |
| `compute_variance_decomposition(...)` | Subject / task / interaction / residual shares. |
| `downstream_f1(...)` | Cross-validated macro-F1 — **a pipeline-validation proxy**, to be swapped for the real segmentation model. |
| `tercile_fairness_gap(...)` | Buckets subjects into expressiveness terciles and returns the max F1 gap — the fairness effect size. |
| `run_full_evaluation(...)`, `_plot_icc_comparison`, `_plot_variance_shares` | matplotlib imported lazily inside the plot functions, so the API can import this module without loading a plotting backend. |

#### Synthetic data

`generate_synthetic_dataset` and `run_synthetic_pipeline` exist to exercise the code path with no camera. Both print a banner saying so. **The generator invents the per-subject offsets and task structure that EA then "discovers"**, so an ICC improvement measured here shows the implementation removes variance the generator put in — worth knowing when the code changes, not evidence about real faces. `tests/test_no_synthetic_results.py` enforces that this stays labelled.

### `calibration/quality.py` (551 lines) — the capture gate

Calibration is the one place in the system where a bad recording is **worse** than no recording: the transform becomes the frame every later signal is scored in, so a baseline captured in the dark or with a second person in shot does not fail — it silently biases everything downstream.

Everything here is a pure function of arrays and numbers. No camera, no MediaPipe, no HTTP — which is what makes the thresholds testable in CI on a machine with neither webcam nor microphone.

#### Thresholds

| Group | Constants |
|---|---|
| Lighting | `MIN_FACE_LUMA` 65, `MAX_FACE_LUMA` 205, `MIN_FACE_CONTRAST` 18, `MAX_LIGHTING_IMBALANCE` 0.45 |
| Framing | `MAX_CENTER_OFFSET_X/Y` 0.18, `MIN_FACE_WIDTH_FRAC` 0.16, `MAX_FACE_WIDTH_FRAC` 0.65, `EDGE_MARGIN` 0.02 |
| Voice | `SILENT_RMS` 0.004, `MIN_SPEECH_RMS` 0.025, `MAX_CLIPPED_RATIO` 0.02, `MIN_SNR_DB` 8, `MIN_VOICED_RATIO` 0.35 |
| Task pass | `MIN_CLEAN_WINDOWS_PER_TASK` 10, `MIN_CLEAN_FRAME_RATIO` 0.75, `MIN_FRAMES_PER_WINDOW` 2, `MAX_WINDOW_SPAN_SEC` 2.0, `FLAG_REPORT_RATIO` 0.10 |

These are reasoned defaults, not empirically tuned. They are named constants at the top of the file precisely so the first real sitting can move them.

#### Flags

`QualityFlag(code, message, detail)` — `code` for the frontend to switch on, `message` for the candidate to act on. **There is deliberately no severity field: every flag blocks.** A condition not worth a retry does not belong in calibration's gate; it belongs in the session's own signal-quality track.

| Function | Raises |
|---|---|
| `assess_lighting(frame_bgr, bbox=None)` | `too_dark`, `too_bright`, `low_contrast`, `uneven_lighting`. Falls back to the whole frame when no face was found — a frame too dark to detect a face in should say *why* it failed. The side-lighting check splits the region down the middle and compares means. |
| `assess_framing(bbox)` | `off_center` (with a direction in the message), `too_far`, `too_close`, `face_cropped`. |
| `assess_frame(frame_bgr, faces)` | The full per-frame verdict. `multiple_faces` **short-circuits everything else** — framing advice is meaningless while it is ambiguous whose face is being measured, and "move left" addressed to two people helps nobody. `no_face` is returned *with* the lighting flags, since lighting is usually the reason. |
| `assess_voice(metrics)` | `mic_unavailable`, `mic_silent`, `voice_clipped`, `voice_too_quiet`, `background_noise`, `speech_too_short`. **Fails closed**: every input defaults to a failing value, so a truncated payload fails rather than passing by omission. Clipped and too-quiet are mutually exclusive (`elif`) — a clipped signal is loud by definition and reporting both would be contradictory advice. |

`landmark_bbox`, `_face_region`, `_luma` are the geometry helpers. `_luma` computes Rec. 601 luma directly rather than via cv2, so a headless import does not pull in a native library it otherwise would not need. `_plain` rounds and converts numpy scalars — the detail dict is returned straight over HTTP, and numpy types are not JSON-serialisable.

#### Verdicts

| Function | Notes |
|---|---|
| `dominant_flags(flag_counts, frames)` | The flags worth showing, worst first. A retry screen listing eight things is a retry screen nobody reads, so only conditions that persisted across ≥10% of the task are reported, ordered by how much they spoiled. |
| `evaluate_task(*, frames, clean_frames, clean_windows, flag_counts, voice_flags, require_windows)` | `TaskVerdict`. Fails on: no frames at all; any dominant flag; clean-frame ratio below 75%; too few clean windows. `require_windows=False` is for the voice check, which is an environment test rather than a source of feature rows — its video stream is still watched for a second person, but it is not asked for a window quota. Voice flags are listed **before** video flags: on the voice task the microphone is what is being tested, and burying its verdict under lighting advice inverts the point of the screen. |

### `calibration/__init__.py`

Re-exports `FEATURES`, `FeatureExtractor`, `apply_alignment`, `compute_ea_transform` from `pipeline`, and `assess_frame`, `assess_voice`, `evaluate_task`, `QualityFlag`, `TaskVerdict`, `MIN_FRAMES_PER_WINDOW`, `MAX_WINDOW_SPAN_SEC` from `quality`.

### `api/calibration.py` (626 lines) — the routes

#### Task definitions

`CALIBRATION_TASKS` is the sequence, and it is the single source of truth — the frontend renders whatever is served, and `tests/test_calibration_tasks.py` asserts the served list equals the module constant.

| id | modality | baseline? | duration |
|---|---|---|---|
| `voice_check` | voice | no | 10 s |
| `rest` | video | yes | 15 s |
| `reading` | video | yes | 15 s |
| `trivial_problem` | video | yes | 15 s |

The three baseline states must differ behaviourally: RQ1 asks whether alignment removes trait variance *without destroying task signal*, which requires the calibration window to contain more than one kind of behaviour.

`content` holds the material the participant must actually look at. **A task whose label refers to something and does not supply it degrades into a second rest task** — the reading instruction with no passage records staring at a blank card, narrowing the baseline covariance the transform is fitted on.

`READING_PASSAGE` is ~90 words (≈15 s at 200 wpm silent reading) and deliberately about swifts: calibration runs *before* the session, so a passage about retries, idempotency or debugging would prime the participant on the problem they are about to be assessed on. `tests/test_calibration_tasks.py` checks for those words.

`VOICE_SENTENCE` is phonetically broad — plosives, sibilants, open vowels — so a microphone that only passes one band shows up.

The voice check runs **first** so a muted microphone surfaces in ten seconds rather than after 45 seconds of face tasks, and contributes **no feature rows**, so the EA fit stays exactly the three behavioural states RQ1 is defined over.

#### The landmarker

`_get_landmarker()` builds a `FaceLandmarker` lazily, on first use.

- **IMAGE mode, not VIDEO.** Frames arrive as independent HTTP requests, not a decoded stream, so there is no monotonic timestamp to give VIDEO mode and nothing for its frame-to-frame tracking to track. (Extractor A is the opposite case.)
- **`num_faces=MAX_DETECTED_FACES` (3), not 1.** With `num_faces=1` the detector silently returns the most confident face, so a candidate with someone sitting beside them calibrates as if alone — "multiple people" would be undetectable in principle, not merely unchecked.
- **`output_face_blendshapes=False`** — blendshapes are the on-ramp to emotion-category inference, which §2.2 forbids.
- A missing model file is a clear 503 naming the download command, not an AttributeError.

`_detect_faces(frame_rgb)` returns *every* detected face's landmarks. Returning the whole list is what lets the gate see a second person; `submit_frame` still measures `faces[0]`, and only after the gate has cleared the frame.

> Historical note: this route once used `mp.solutions.face_mesh`, which does not exist in mediapipe 0.10.35 — `mp.solutions` is gone entirely. Every frame raised, every POST 500'd, and because the browser swallowed frame errors the only visible symptom was "0 usable seconds captured" after a full 45-second run. `tests/test_calibration_landmarks.py` pins the fix.

#### Session state

Sessions live in an in-memory `SESSIONS` dict — fine for a single-candidate local run; swap for Redis before it needs to survive a restart or serve concurrent candidates.

| Helper | Notes |
|---|---|
| `_new_attempt_bucket()` | Per-task counters for **one attempt**: rows, frame/clean counts, clean windows, frames-in-window, window open time, flag tallies, its own `FeatureExtractor`. A retry starts a fresh bucket, or a candidate who fixes their lighting still fails on the darkness of the run before. |
| `_task_state(session, task_id)` | Attempts, passed, last verdict, current bucket. |
| `_record_flags(bucket, flags)` | Tallies by code, keeping the most recent detail so the retry screen quotes numbers from the end of the attempt. |
| `_decode_base64_image`, `_baseline_path` | `_baseline_path` turns storage's `ValueError` into a 400. |

#### Routes

| Route | Behaviour |
|---|---|
| `GET /api/health` | Distinct from `/health`. |
| `GET /api/calibration/tasks` | The task list, available without a session, because the frontend shows the passage during the task. |
| `POST /api/calibration/start` | Validates the candidate id **up front** — a bad id fails here, not after 45 seconds of tasks. Returns `session_id`, `tasks`, `required_task_ids`. |
| `POST /api/calibration/frame` | Decode → detect → `assess_frame`. **A flagged frame never reaches `FeatureExtractor.update()`.** Returns `accepted`, `flags`, and the running clean-window count. |
| `POST /api/calibration/task/complete` | `evaluate_task` over the bucket, plus `assess_voice` for the voice task. A failing verdict **discards the attempt** and returns the reasons. No partial credit, no attempt limit. |
| `POST /api/calibration/complete` | Refuses unless **every** required task is marked passed, then fits EA over the baseline tasks' rows and writes the profile. |
| `GET /api/baseline/{candidate_id}` | 404 until calibration runs — onboarding uses this to decide whether to offer it. |
| `POST /api/session/align` | Maps one exam-session feature vector into the candidate's personal frame. |

Three things `submit_frame` refuses to measure:

1. **Any flagged frame.** Rejecting after the fact would still leave it inside the covariance the transform is fitted from.
2. **A window closing on fewer than `MIN_FRAMES_PER_WINDOW` frames.** A per-second mean over one sample is not a measurement.
3. **A window spanning more than `MAX_WINDOW_SPAN_SEC`.** Rejected frames never reach the extractor, so a stretch of bad capture holds the window open until the next clean frame. `blink_rate_hz` divides by the *nominal* window length, so a window stretched over four seconds reports a quarter of the real rate — a plausible-looking number that is simply wrong. Dropped rather than scaled, since the frames inside it are not contiguous either.

The stored profile carries `feature_names`, `feature_means`, `feature_covariance`, `alignment_matrix`, `n_calibration_windows`, `calibrated_at`, and a **`quality` block** recording attempts and clean ratio per task — so when a later session's signals look odd, the first question ("was the baseline under them clean, or scraped through on attempt five?") has an answer on disk.

The server-side completeness check is the half that matters: the UI enforces the same rule, but the UI is JavaScript on the candidate's machine.

---

## 8. Analysis — Layer 2

Segments a session into the six phases and turns the timeline into a process graph.

> **Read `analysis/README.md` before citing any number out of this package.** Two stand-ins: the segmentation model is a windowed RandomForest rather than the MS-TCN++ the plan specifies, and the synthetic generator hard-codes a correlation between the fake `latent_*` columns and the phase label. The metrics, LOSO loop and graph logic are real and reusable; the ablation's verdict that "webcam adds signal" is an artefact of the generator and must be re-run against real sessions before it means anything.

### `analysis/feature_assembly.py` (216 lines)

Resamples the event log and webcam signals onto a common 1 Hz grid.

`PHASES` (6, in §2.4 order), `PHASE_TO_IDX`, `EVENT_TYPES`, `WEBCAM_FEATURE_COLS`, `REQUIRED_FILES`.

| Function | Notes |
|---|---|
| `webcam_cols(signals)` | Which webcam columns this session actually has. |
| `_read_signals(sdir)` | Real sessions carry `signals.parquet`; synthetic ones fall back to CSV. |
| `_read_manifest(sdir)` | §3's name, falling back to the legacy one. |
| `load_session(sdir)` | |
| `events_to_1hz(events, total_s)` | One row per second: counts per event type plus a "seconds since last event" feature. |
| `labels_to_1hz(labels, total_s)` | **The function whose zero-initialised array is why `labels.py` enforces tiling.** |
| `build_session_matrix(sdir)` | `(X, y)` for one session. |
| `session_readiness(sdir)` | What this session is missing, as human-readable reasons — so a half-recorded session says why it was skipped instead of vanishing. |
| `load_all_sessions(data_dir, strict)` | `[(subject_id, session_id, X, y)]` plus the column groups the ablation slices on. |
| `load_labels_any_source(sdir)` | Prefers a completed expert pass. |

### `analysis/segmentation_model.py` (53 lines)

| Function | Notes |
|---|---|
| `make_windows(X, window=3)` | Concatenates `t-window..t+window` per timestep — how a shallow model fakes the temporal receptive field a TCN gets for free. |
| `smooth_labels(y_pred, min_run=3)` | Mode filter collapsing tiny flickers — the over-segmentation failure mode the plan warns about. |
| `train_classifier(X_train, y_train, ...)` | RandomForest, `class_weight="balanced_subsample"`. Small `n_estimators`/`max_depth` for fast CPU iteration on synthetic data; raise both on real data. |

Swap `train_classifier` for MS-TCN++ later — nothing downstream changes, since everything consumes `(y_true, y_pred)` arrays.

### `analysis/tas_metrics.py` (64 lines)

Standard temporal-action-segmentation metrics. `to_segments(y)` collapses a per-frame array into `(label, start, end)`; `f1_at_overlap(y_true, y_pred, overlap)` is segmental F1 at an IoU threshold; `edit_score` is the normalised Levenshtein distance between the two segment-label sequences. Frame accuracy alone rewards a model that flickers correctly on average — these do not.

### `analysis/process_graph.py` (177 lines)

| Function | Notes |
|---|---|
| `build_graph_from_labels(y, phases)` | Directly-follows graph from a per-second label array — ground truth *or* prediction. Produces nodes, edges (`from`/`to`/`count`), cycle count, phase entropy, backtrack ratio against `CANONICAL_ORDER`. |
| `build_graph_for_session(session_dir)` | From stored labels. |
| `write_graph(session_id, graph)` | Writes `graph.json` **into the session directory** per §3. It previously landed in `analysis/out/{sid}_graph.json` — the one artefact describing a participant's solving trajectory was the only one not stored with that participant's session. |

The §3 edge key is `from`, not `from_`.

### `analysis/run_ablation.py` (213 lines)

The LOSO ablation that decides RQ4: does the webcam add anything over the event log alone?

`CONFIGS` names the feature subsets; `select_columns(X, event_cols, webcam_cols, config)` slices them. `run(max_folds, data_dir)` runs leave-one-subject-out, with `max_folds` to cap folds on slow machines. `_is_synthetic(data_dir)` drives the banner — a synthetic run must not be printed as a result.

### `analysis/event_validation.py` (278 lines)

Measures the event log against human annotation — the harness §2.3's evaluation table requires, and the reason `source="inferred"` exists.

| Function | Notes |
|---|---|
| `match_events(auto, annotated, tolerance_ms)` | Greedy nearest-in-time matching **within one event type**. |
| `score_session(...)` | TP/FP/FN per event type for one session. |
| `precision_recall(tp, fp, fn)` | Each value `None` when undefined — never 0.0. |
| `gate_for(etype)` | The per-type threshold an event must clear before it may be reported as a measurement. |
| `evaluate(sessions_root, tolerance_ms)` | Pools counts across every session that has **both** logs. |
| `run(...)` / `main(argv)` | Returns a process exit code, so it can gate CI. |

### `analysis/fit_accept_thresholds.py` (350 lines)

Sweeps `AcceptConfig`'s two thresholds against hand-annotated sessions.

| Function | Notes |
|---|---|
| `load_corpus(sessions_root)` | `[(session_id, raw_events, annotated_accepts)]`. `_strip_inferred` drops accepts a previous inference run merged in, so the sweep is not scoring itself. |
| `score_point(corpus, config, tolerance_ms)` | Pooled TP/FP/FN for one grid point. |
| `sweep(...)` | Every grid point with precision/recall/F1. |
| `frontier(results)` | Points not dominated on both precision and recall. |
| `route_census(corpus)` | How annotated accepts actually reached the editor. |
| `recall_ceiling(counts)` | The best recall *any* threshold could reach — `None` when the corpus is untagged. Tells you when the ceiling, not the threshold, is the problem. |
| `format_grid(...)`, `run(...)`, `main(argv)` | |

Committing a chosen point means editing `inference.DEFAULT_ACCEPT_CONFIG` **and** changing `provenance` to `FITTED`, in the same commit as the sweep output it came from.

### `analysis/clock_sync.py` (new, 2026-08-19)

The clapperboard (§3, `features.toml capture.clock_sync`) and the piecewise webcam timebase. Run it as `python -m problemproof.analysis.clock_sync data/sessions/<id> [--write]`.

| Symbol | Notes |
|---|---|
| `MAX_RESIDUAL_MS` (100) | Above this the session is refused for fusion. Roughly three frames at 30 fps and a tenth of a 1 Hz feature bin. |
| `FLASH_EVENT` | `clock_sync_flash`. Emitted by the exam page with the session time the white was painted at. Without it a brightness step in the videos cannot be placed on the session clock. |
| `MIN_SCREEN_RISE` (40) / `MIN_WEBCAM_RISE` (8) | Separate thresholds because the screen sees the flash and the webcam sees a reflection off a face and a wall. Two numbers rather than one is the honest encoding of that. |
| `luma_trace(path, search_ms)` | BT.601 luma per frame against **container PTS**, bounded to the first 30 s. Same timebase rule as Extractor A — an index-derived time would make the residual measure the fabrication. |
| `find_flash(trace, min_rise)` | The largest rise, returning the **brightened** frame. Taking the earlier frame would bias every stream by one inter-frame interval in the same direction: 200 ms at 5 fps, twice the whole budget. Returns `None` rather than a best candidate. |
| `measure_stream(...)` | `flash_session_ms - detection.pts_ms` is this stream's measured offset, compared against what its recorder **declared**. Deriving both offsets from the flash and differencing them would be zero by construction. |
| `ClockSyncMeasurement.residual_ms` | Worst pairwise disagreement. `None` with fewer than two detections, never 0.0. |
| `fusion_refusal(manifest)` | The read-time gate, called by `feature_assembly.session_readiness`. Says something different for "never measured" and "measured and failed" — the remedies differ. |
| `webcam_timebase(pauses, base_offset_ms)` | The piecewise map, derived from `pause_spans.pause_spans` so it cannot disagree with the manifest's pause ledger. |
| `media_to_session_ms` / `session_to_media_ms` | Apply it. The second returns `None` for a moment inside a pause: no frame exists, and handing back the boundary frame would let a caller attribute a whole pause to one still image. |
| `measure_session(sdir, search_ms)` | Runs it over a session directory. Returns; writes nothing. |

**There is no clap.** `getDisplayMedia` is requested with `audio: false`, so the screen recording has no audio track. A clap lands in one stream and synchronises nothing.

**`clock_offsets.webcam_ms` is `null`.** See §11.

### `analysis/reliability.py` (254 lines)

Inter-annotator reliability for the phase taxonomy (§4). `KAPPA_STOP_THRESHOLD` is the gate.

| Function | Notes |
|---|---|
| `labels_to_1hz(segments, total_s)` | One annotator's segments onto the shared grid. |
| `cohens_kappa(a, b, n_classes)`, `confusion_matrix`, `_kappa_from_matrix` | |
| `session_agreement(session_dir, a, b)` | `(kappa, confusion, n_seconds)`. |
| `format_confusion(matrix, a, b)` | The per-phase matrix — **what §4's remedy actually needs**. A single κ says "you disagree"; the matrix says which two phases to merge. |
| `top_confusions(matrix, limit)` | The pairs to consider merging, largest first. |
| `run(sessions_root, a, b)` / `main(argv)` | Per-session and pooled κ, returning an exit code. |

### `analysis/gen_synthetic_data.py` (273 lines)

Generates sessions matching the shared schema so the pipeline can be exercised before real data exists.

`PHASES`, `PHASE_PROFILES`, `LATENT_DIM`, `AI_PROFILES`, `EXTERNAL_TOOLS`, `EXTERNAL_SHARE_RANGE`. `sample_phase_sequence` builds an ordered-with-loops timeline; `gen_signals` and `gen_events` stand in for the two extractors; `_gen_ai_exchange` and `_gen_external_ai_sessions` produce the AI event structure.

**`PHASE_PROFILES` makes blink rate and motion energy phase-correlated by construction.** That is what makes the synthetic timeline a plausible story at all, so it is kept — but it is also exactly why the ablation's verdict on this data means nothing about real faces.

---

## 9. The test suite

861 tests collected, 860 passing and 1 skipped, all runnable without a camera, microphone or desktop. `pytest.ini` runs from `backend/`; there is no installed package.

The skip is `test_capture_imports_without_hardware.py::test_a_working_install_is_untouched` — pywin32 is installed but its DLLs do not match this interpreter, so `window_tracker` reports itself unavailable and the test skips rather than failing. That is the module's designed behaviour (see its import guard): a broken window tracker is a gap in one signal, not a reason to take down `event_logger` and every analysis module downstream of it. On a machine with working pywin32 the count is 861 passing.

Running the suite on Windows also prints a `Windows fatal exception: code 0xc0000139` traceback from `faulthandler` at collection. It is the same pywin32 DLL failure, dumped by the fault handler as the native import fails and then caught by that guard. Nothing fails to collect and no module is excluded; the dump is noise from a handled exception.

| File | n | Guards |
|---|---|---|
| `test_geometry.py` | 41 | Spherical means, SO(3) geodesics, non-square denormalisation |
| `test_events_schema.py` | 39 | §2.3 taxonomy, the no-content rule, the TypeScript mirror |
| `test_calibration_quality.py` | 33 | Every blocking flag — presence, lighting, framing, voice — and the task verdict |
| `test_labels_contract.py` | 29 | §3 shape, gaps, overlaps, one source per file |
| `test_storage.py` | 27 | Path layout, id validation, traversal refusal |
| `test_calibration_api.py` | 26 | EA maths, baseline storage, route contracts, the per-task gate |
| `test_external_ai_detection.py` | 21 | Foreground-window → tool identification, accept inference |
| `test_ai_metrics.py` | 20 | Derived metrics, and that each is `None` rather than 0.0 when uncomputable |
| `test_reliability.py` | 19 | κ, the confusion matrix, the §4 gate |
| `test_labeling_api.py` | 18 | Tiling enforcement and annotator blinding |
| `test_calibration_ui_contract.py` | 17 | Camera attaches via effect; no side effects in state updaters; no path around the gate |
| `test_env_config.py` | 16 | One root `.env`; no secret carries the `VITE_` prefix |
| `test_process_graph.py` | 16 | §3 edge keys, aggregation, written into the session directory |
| `test_graph_api.py` | 15 | Serving the graph; the validated palette; arcs that do not overlap |
| `test_calibration_landmarks.py` | 12 | Face detection uses an API that exists, detects a real face, and can see a second one |
| `test_timestamp_contract.py` | 12 | Session-relative `t_ms` across all producers |
| `test_calibration_tasks.py` | 10 | Three behavioural states, supplied material, a neutral passage, the voice check's role |
| `test_capture_api.py` | 10 | Stream B intake |
| `test_no_synthetic_results.py` | 10 | Synthetic data cannot be presented as a result |
| `test_api.py` | 8 | Extractor A routes |
| `test_ai_events_end_to_end.py` | 7 | An uploaded log through validation into derived metrics |
| `test_jobs.py` | 7 | Serial execution, error capture, progress |
| `test_phase_rail_is_not_a_label.py` | 6 | The exam's phase rail cannot reach `labels.json` |
| `test_screen_features.py` | 4 | 1 Hz binning, gaps visible |
| `test_cli.py` | 2 | The two entrypoints parse and dispatch |

**Several tests read the frontend source.** There is no frontend test runner, so the TypeScript mirror is checked against the Python contract by parsing it — event type names, snake_case attributes, the `source: "portal"` literal, that no log call uses a raw `performance.now()`, and (since the calibration gate landed) that the UI offers no path around calibration. `test_calibration_ui_contract.py` is the pattern to copy for anything similar.

Structural tests like these are for bugs that are **silent**. A black camera preview, a reading task with no passage, and a state updater with a side effect all shipped together, and none of them raised anything.

---

## 10. Conventions that repeat

**`None`/NaN means unmeasured; `0.0` means measured zero.** `precision_recall` returns `None` when undefined. `derive_ai_metrics` returns `None` rather than 0.0. `ear_std` is NaN below two samples, because a one-sample SD of 0.0 reads as "perfectly steady". `empty_row` sets `face_valid_fraction` to 0.0 — that one *is* known exactly. Never interpolate, never forward-fill.

**Fail closed.** `assess_voice` defaults every input to a failing value, so a truncated payload fails rather than passing by omission. `decode_with_pts` raises rather than synthesising a timebase. `validate_labels` refuses a pass rather than repairing it.

**Provenance travels with the number.** `AcceptConfig.provenance`, `ExtractionReport.blink_threshold_source`, the baseline profile's `quality` block, `source="portal"|"inferred"`. In each case a reader who has only the output can still tell how much to trust it.

**One source of truth per contract, restated nowhere.** Column names live in `schema.py`. Event types live in `events.py`. Paths live in `storage.py`. The calibration passage lives in the backend task definition, so every participant reads the same text and the UI cannot drift from it.

**Untrusted input is validated where the path is built,** not where it arrives — so no route can forget.

**Comments explain the failure that motivated the code.** Most of the long comments in this codebase are pinned to a specific bug: the `mp.solutions` removal, the StrictMode double-advance, the `frame_index/nominal_fps` drift, the graph written outside its session directory. When changing that code, the comment tells you what will break if you undo it.

---

## 11. Known gaps and stale references

Things a reader will otherwise waste time rediscovering. Each is verifiable from the code as it stands today.

### ~~The accept inference is not wired into capture~~ — **fixed 2026-08-19**

`agent.run`'s teardown is now `finalize_session`, and the sequence is consolidate → **annotate** → derive → finalize. An agent-captured session's `event_log.json` carries `ai_output_accepted` rows produced by `inference.infer_ai_events`, and `verification_latency` returns a number on a session that has accepts. `tests/test_accept_inference_is_wired.py` pins it, starting from what the capture layer writes — a `paste_event` with a `char_count` — and never from a hand-placed accept.

Two things changed beyond the one line:

- The teardown was extracted from `run` into `finalize_session(session, interval=None, verbose=False)`. `run` starts a `ScreenRecorder` and an `EventLogger`, which need a real desktop; that is why this stage went untested and unwired for as long as it did.
- `event_log.jsonl` stays the raw capture stream and `event_log.json` is rewritten with the inference merged in, via the new `Session.write_consolidated_log`. An auditor diffs the two to see exactly which rows were reconstructed. `fit_accept_thresholds._strip_inferred` already assumed this layout.

**What is still not done: the thresholds are not fitted.** `fit_accept_thresholds` needs sessions carrying both `events.jsonl` and `events.annotated.jsonl`; **zero sessions on disk have the second**, so the module exits 2 and `AcceptConfig.provenance` remains `UNFITTED`. That is now recorded rather than implicit: `session_metadata.json` carries an `accept_inference` block with the config, the counts, and `accepts_reportable: false` with its reason, and `inference.read_accept_count` raises `ProvenanceError` rather than serving a count produced by unvalidated thresholds. The refusal is at read time, not write time — below-gate features keep running and keep writing to disk (`registry.py`).

### ~~`capture.clock_sync` is a stub that writes zeros~~ — **partly fixed 2026-08-19**

`analysis/clock_sync.py` is new and implements the clapperboard: `luma_trace` builds a brightness trace against container PTS, `find_flash` locates the onset, `measure_stream` turns a detection into an offset measurement against what the recorder declared, and `ClockSyncMeasurement.residual_ms` is the worst pairwise disagreement. `fusion_refusal` is the read-time gate and `feature_assembly.session_readiness` calls it, so an unsynchronised or misaligned session is excluded from the corpus rather than fused. The exam page paints the flash (`frontend/src/lib/clockSync.tsx`) and logs `clock_sync_flash` with the session time it was painted at.

Two corrections to the plan, both made from the code rather than the document:

- **The clap is gone.** `getDisplayMedia` is requested with `audio: false`, so the screen recording has no audio track and a clap lands in one stream only. It cannot synchronise anything. The check is visual.
- **`clock_offsets.webcam_ms` is now `null`, not `0`.** The webcam recorder pauses with the exam clock; the screen recorder does not and must not (invariant 2). Webcam media time therefore omits every paused span. `stream_timebases.webcam` holds the piecewise map (`clock_sync.webcam_timebase`), `decode_with_pts` and `extract_signals` take a `session_time` callable, and `POST /sessions/{id}/extract` builds it from the manifest. On a session paused for 90 s, the old scalar put every frame after the pause 90 s early in `signals.parquet` with nothing to show for it.

**Status stays `stub`, because no measurement exists.** Zero sessions on disk carry a `clock_sync_flash` event, so the residual distribution the gate is stated over has no samples, and whether a webcam in an ordinarily-lit room registers a monitor flash at all is unknown. An implementation is not a promotion.

### Stale references

- ~~`requirements.txt` annotates `httpx` as "outbound calls to NVIDIA NIM"~~ — **fixed 2026-08-19.** The comment now says what `httpx` is actually for (FastAPI's `TestClient`). `pypdf` was added in the same pass for CV text extraction; DOCX deliberately needs no dependency, since a .docx is a zip of XML the stdlib reads.
- `docs/SYSTEM.md` §9 lists `baseline_profile.json` as a known contract divergence: §3 specifies `subject_id` and a 32-dimensional `subject_embedding`; the calibration module writes `candidate_id` and no embedding. Still unresolved.
- `analysis/` retains `Step N (Build X, 2.4)` docstring headers from an earlier build order. They no longer correspond to anything you can act on; the module docstrings below them are current.
- `calibration/pipeline.py`'s docstring documents the CLI as `python baseline_pipeline.py <cmd>`. The file was renamed; invoke it as `python -m problemproof.calibration.pipeline <cmd>`.
