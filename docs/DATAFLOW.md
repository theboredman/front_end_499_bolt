# ProblemProof — Dataflow

Every byte's path from a sensor to a stored artefact, named at the function level.

- [`SYSTEM.md`](SYSTEM.md) — what the system does.
- [`BACKEND.md`](BACKEND.md) — what each backend module holds.
- **This document** — how they connect. Which function calls which, over which wire, producing which file.

Notation used throughout:

```
  fn()          a function or React hook
  ──►           a direct call
  ══►           an HTTP request (labelled with method + path)
  ┄┄►           a deferred / polled / background hop
  [file]        something written to disk
  {state}       something held in memory or localStorage
```

---

## Table of contents

1. [The four streams](#1-the-four-streams)
2. [Two clocks, and why one of them is the whole ballgame](#2-two-clocks-and-why-one-of-them-is-the-whole-ballgame)
3. [Stage 1 — Onboarding and calibration](#3-stage-1--onboarding-and-calibration)
4. [Stage 2 — The exam session](#4-stage-2--the-exam-session)
5. [Stage 3 — Submit: the fan-out](#5-stage-3--submit-the-fan-out)
6. [Stage 4 — Extraction](#6-stage-4--extraction)
7. [Stage 5 — Verify: reading it back](#7-stage-5--verify-reading-it-back)
8. [Stage 6 — Labelling](#8-stage-6--labelling)
9. [Stage 7 — Analysis](#9-stage-7--analysis)
10. [The desktop agent, in parallel](#10-the-desktop-agent-in-parallel)
11. [Whole-system map](#11-whole-system-map)
12. [Where the flow breaks today](#12-where-the-flow-breaks-today)

---

## 1. The four streams

Four independent producers write into **one session directory**, joined only by `session_id` and a shared clock.

```
                         ┌──────────────────────────────────────┐
   webcam ──────────────►│ A  video          → signals.parquet  │  5 Hz
                         ├──────────────────────────────────────┤
   whole screen ────────►│ B₁ recording      → screen.webm      │  evidence
   in-tab listeners ────►│ B₁ event log      → events.jsonl     │  1 Hz features
                         ├──────────────────────────────────────┤
   OS foreground/kbd ───►│ B₂ desktop agent  → desktop/*        │  1 Hz features
                         ├──────────────────────────────────────┤
   human annotator ─────►│ L  labels         → labels.*.json    │  ground truth
                         └──────────────────────────────────────┘
                                          │
                                          ▼
                              analysis/ → graph.json
```

B₁ and B₂ are **complementary, not duplicates.** The in-tab logger sees "did they leave the exam tab, and how do they type"; the desktop agent sees "what else was on the machine". Neither can see the other's half — a browser tab cannot enumerate native apps, and the agent cannot see inside the page.

A fifth artefact, `candidates/{id}/baseline.json`, is produced **before** any session and reused across all of them.

---

## 2. Two clocks, and why one of them is the whole ballgame

Every stream must land on **session-relative milliseconds**, or the fusion in §3 is meaningless. There are two distinct origins in play, and confusing them is the failure this design works hardest to prevent.

```
  performance.now()        ── relative to PAGE LOAD.      Never written to disk.
  performance.now() − origin ─ relative to SESSION START. This is t_ms.
```

Frontend side, `Exam.tsx` holds `sessionStartMsRef` and every emitter subtracts it:

```
  useEventLogger({ sessionOriginMs })
        └─ emit() ──► { t_ms: Math.round(performance.now() − originRef.current), … }

  Exam.sessionMs() ──► logPortalEvent({ t_ms: sessionMs(), … })
```

Backend side, `events.assert_session_relative()` refuses anything outside `[0, duration]`. A producer that leaked wall clock shows up as a value near 1.7e12.

**Why this specific check exists.** An unmapped timestamp has no `clock_offsets` entry applied to it, so it silently desynchronises its stream from the others. §3's clapperboard validation cannot catch it either — the residual it measures already assumes both streams are on the session clock. The error produces no exception and a perfectly plausible-looking fused table.

Stream A is the exception, and gets its time from the container rather than any clock:

```
  timebase.decode_with_pts(path, clock_offset_ms=..., session_time=...)
        └─ session_ms = session_time(container PTS)          ← webcam, since 2026-08-19
           session_ms = container PTS + clock_offset_ms      ← legacy / no timebase recorded
```

`session_time` comes from `stream_timebases.webcam` in the manifest, via
`analysis/clock_sync.media_to_session_ms`. It is a function rather than a number
because the webcam recorder pauses with the exam clock while the screen recorder
keeps running, so media time skips every paused span. Adding a scalar instead
puts every frame after the first pause earlier on the session clock than it
belongs, by the accumulated pause duration — `signals.parquet` then joins
`events.jsonl` at the wrong seconds with every column populated.

Never `frame_index / nominal_fps`. A "30 fps" webcam drops to 15 in a dim room while the header still says 30, and half a percent of rate error is 12 seconds of drift across a 40-minute session — two orders of magnitude past §3's <100 ms target, growing monotonically, so the end of the session is the least trustworthy part. `decode_with_pts` raises `TimebaseError` rather than synthesising a timebase.

---

## 2a. Stage 0 — Personalisation and assessment setup

Runs before any capture. Nothing here touches the screen recorder or the
webcam; the recording starts at calibration, which is the next stage.

```
/profile
  file input ──► personalisation.uploadCv(candidateId, file)
                    │  multipart, one field, 4 MB cap
                    ▼
        POST /candidates/{id}/cv
                    │  tenancy.claim_candidate  ← first upload claims the dir
                    │  storage.cv_source_path   ← the file stays here, always
                    ▼
        profile.extraction.extract_from_file
                    │  read_text → sectionise → nodes with provenance + prior
                    ▼
        profile.store.replace_extraction
                    │  replaces `extracted`, KEEPS `approved` + review_events
                    ▼
        data/candidates/{id}/profile_graph.json
```

The graph comes back with `extracted` and `approved` as two separate objects,
all the way to the component that renders them. Nothing in the client flattens
them into one list with a flag, because that shape is one stale render away
from sending a parser's guess as a confirmed claim.

```
  participant clicks Approve / Not mine / Add
                    ▼
        PUT /candidates/{id}/profile-graph   { action, node_ids, edited? }
                    │  actor = the token's user id, never the body
                    ▼
        profile.schema.approve | reject | add_claim
```

```
/assessment
  GET /assessment/families        ← the tiers, families and policies. The
                                    client declares none of them itself.
  reserveSession(id)              ← claims the session directory with NO timing;
                                    the sitting has not happened, and zeros
                                    would be a measurement of nothing
  POST /sessions/{id}/exam-spec   ← refuses an unapproved node, an empty
                                    selection, a duration outside the family's
                                    range for that tier
  POST /sessions/{id}/question    ← takes NO body. Everything the generator sees
                                    is derived server-side, so there is no field
                                    a client could add to widen its input
                    ▼
        assessment.spec.generator_payload      ← the allowlist
                    ▼
        assessment.generator.TemplateGenerator ← deterministic, offline
                    ▼
        data/sessions/{id}/question.json       ← prompt, rubric, family key
```

The question is stored in `sessionStorage` as the prepared assessment, and
`/exam` reads it and **reuses its session id**. Minting a fresh one at submit
would file the recording in a different directory from the `question.json` that
describes it, and the process record would be evidence of solving a problem
stored somewhere else.

A participant who reaches `/exam` without preparing one still gets a session.
The panel renders the standard problem and says, in mono, that it is the
default rather than theirs — a generic problem rendered as though it were
personalised would misdescribe the record.

---

## 3. Stage 1 — Onboarding and calibration

Route `/onboarding`, component `Onboarding.tsx`, four steps. Nothing here can be skipped: no camera, no microphone, or no passing calibration means no session.

### 3.1 The gate itself

```
  Onboarding.tsx
    ├ step 0  consent
    ├ step 1  FaceMeshPreview ──► onStatus(cam)      camBlocking  = cam !== "live"
    ├ step 2  CalibrationSession ──► onDone()        calibrationBlocking = !calibrationDone
    └ step 3  navigate("/exam")

  App.tsx
    <Route path="/exam" element={ <RequireCalibration><Exam/></RequireCalibration> } />
```

`RequireCalibration` re-checks server-side, because onboarding is a sequence of buttons and `/exam` is a URL:

```
  RequireCalibration.useEffect()
      ├─ pingCalibrationApi()        ══► GET /api/health
      └─ getExistingBaseline(id)     ══► GET /api/baseline/{candidate_id}
                                            └─ 200 → render <Exam/>
                                               404 → "Calibration required"
```

It asks the **server for a stored profile**, not a localStorage flag — so clearing site data or moving machines re-runs calibration instead of inheriting a "done" tick.

### 3.2 Session start and the screen recording

The first click starts the recording that runs until submit:

```
  CalibrationSession.beginCalibration()
      │
      ├─ screen.start()                      ScreenCaptureProvider (above the router)
      │     └─ getDisplayMedia({ displaySurface: "monitor" })
      │           └─ verify track.getSettings().displaySurface === "monitor"
      │                 └─ MediaRecorder.start(CHUNK_MS = 5000) ──► {chunksRef}
      │
      ├─ getUserMedia({ video, audio })      camera AND microphone, one request
      │     └─ setStream(acquired)  ─┐
      │                              └─► useEffect([stream, phase]) ──► video.srcObject
      │
      └─ startCalibration(candidateId)       ══► POST /api/calibration/start
                                                   └─ { session_id, tasks, required_task_ids }
```

Three deliberate choices in that block:

- **The provider lives above the router.** `getDisplayMedia` needs a user gesture and cannot be re-acquired silently, so a recorder inside `Exam.tsx` would be torn down on navigation — meaning either a second permission prompt mid-session or a gap in the recording exactly where the route changed.
- **Whole screen is verified, not requested.** A window or tab share shows only the exam portal, which is the one place nothing interesting happens: the participant's AI tools, docs and searches are all elsewhere. `displaySurface: "monitor"` is a request browsers may ignore, so the setting is read back and a wrong surface is rejected.
- **The stream goes into React state, not a ref.** At the moment `getUserMedia` resolves the phase is still `requesting_cam` and the `<video>` is unmounted, so an imperative `videoRef.current.srcObject = …` is silently skipped and the preview stays black. State re-renders; an effect keyed on `[stream, phase]` attaches once the element exists.

### 3.3 The per-frame loop

Four frames a second, for the duration of each task:

```
  runTask(taskList, index)
      ├─ setInterval(250 ms) ──► captureAndSendFrame(task.id)
      └─ setInterval(250 ms) ──► countdown from `endsAt` (a deadline, not a decrement)

  captureAndSendFrame(taskId)
      canvas.drawImage(video) → toDataURL("image/jpeg", 0.7)
          │
          └─ submitCalibrationFrame()        ══► POST /api/calibration/frame
                                                    { session_id, task, image_base64 }
```

Server side, per frame:

```
  api/calibration.submit_frame(req)
      │
      ├─ _decode_base64_image()             cv2.imdecode
      ├─ _detect_faces(rgb)                 FaceLandmarker, IMAGE mode, num_faces=3
      ├─ quality.assess_frame(frame, faces) ──► [QualityFlag, …]
      │
      ├─ bucket["frames"] += 1
      ├─ _record_flags(bucket, flags)
      │
      ├─ IF flags ────────────────────────► return {accepted: false, flags}
      │                                     ▲ the frame is NEVER measured
      │
      ├─ bucket["clean_frames"] += 1
      ├─ FeatureExtractor.update(faces[0]) ──► None, or an 8-feature dict
      │
      └─ IF window closed:
             frames_in_window < 2  ──────► drop  (sparse_window)
             span > 2.0 s          ──────► drop  (stretched window)
             else                  ──────► bucket["rows"].append(feats)
```

**Why the gate sits before `FeatureExtractor.update()` rather than after.** The rows become the covariance the Euclidean-Alignment transform is fitted from, and that transform becomes the frame every later session signal is scored in. A frame filtered out afterwards has already contributed. This is the one place in the system where a bad recording is *worse* than no recording: it does not fail, it silently biases everything downstream.

**Why a stretched window is dropped rather than scaled.** Rejected frames never reach the extractor, so a run of bad capture holds the aggregation window open. `blink_rate_hz` divides the blink count by the *nominal* window length, so a window stretched over four seconds reports a quarter of the true rate — a plausible number that is simply wrong. The frames inside it are not contiguous either, so scaling would not fix it.

The response flows back into the live banner:

```
  .then(result)
      accepted  → cleanStreak++ ; ≥4 consecutive → setLiveFlags([])
      rejected  → cleanStreak = 0 ; setLiveFlags(result.flags)
```

Four consecutive clean frames (one second) clears the banner. Without that hysteresis it flickers at 4 Hz every time the candidate blinks or shifts.

### 3.4 The voice task

Audio never leaves the machine. The browser measures; the server judges.

```
  runTask()  [task.modality === "voice"]
      └─ startVoiceMeasurement(streamRef.current)     lib/voiceCheck.ts
             AnalyserNode(fftSize 2048, smoothing 0)
             setInterval(20 ms) ──► RMS per hop ──► levels[]  (+ peak, clipped)

  judgeTask()
      └─ recorder.finish() ──► {
             speech_rms:  percentile(levels, 0.90)     the speaking level
             noise_rms:   percentile(levels, 0.20)     the room between words
             peak, clipped_ratio, voiced_ratio, duration_sec, sample_count
         }
      └─ completeCalibrationTask(sid, task, metrics)  ══► POST /api/calibration/task/complete
```

- **Percentiles, not max.** Taking the maximum hands the entire verdict to one door slam.
- **Six numbers, not audio.** No recording is made, which keeps the same promise the consent screen makes about video.
- **The thresholds are server-side** (`quality.assess_voice`), so the gate cannot be relaxed by editing the page.
- **No audio track → `NO_MICROPHONE_METRICS`**, whose `duration_sec: 0` is read as `mic_unavailable`. Sending nothing would be indistinguishable from a video task and would slip past the gate — the check fails closed.

### 3.5 The task verdict and retry loop

```
  countdown hits 0 ──► advancingRef latch ──► stopCapture() ──► judgeTask()
      │
      └─ completeCalibrationTask()  ══► POST /api/calibration/task/complete
             │
             api/calibration.complete_task(req)
                 ├─ assess_voice(metrics)          if modality == "voice"
                 └─ quality.evaluate_task(
                        frames, clean_frames, clean_windows, flag_counts,
                        voice_flags, require_windows = contributes_baseline)
                        │
                        ├─ dominant_flags()  → only flags ≥10% of the task
                        ├─ fail if any dominant flag
                        ├─ fail if clean_frame_ratio < 0.75
                        └─ fail if clean_windows < 10   (video tasks only)
             │
             ├─ passed      → state["passed"] = True
             └─ must_retry  → attempts++ ; state["current"] = _new_attempt_bucket()
                                                              ▲ the attempt is DISCARDED
      │
      ├─ must_retry → setPhase("retry")  ──► retryTask() ──► runTask(tasks, taskIndex)
      └─ passed     → next task, or finishCalibration()
```

A retry starts from an empty bucket on both sides. Carrying the failed attempt's tallies forward would mean a candidate who fixes their lighting still fails on the darkness of the run before.

### 3.6 Completion

```
  finishCalibration()
      └─ completeCalibration(sid)   ══► POST /api/calibration/complete
             │
             api/calibration.complete_calibration(req)
                 ├─ outstanding = [t for t in REQUIRED_TASK_IDS if not passed]
                 │      └─ non-empty → 400 "calibration is incomplete"
                 │
                 ├─ rows = tasks where contributes_baseline   (voice_check excluded)
                 ├─ len(rows) < MIN_CALIBRATION_WINDOWS → 400
                 │
                 ├─ center      = X_calib.mean(axis=0)
                 ├─ R_inv_sqrt  = compute_ea_transform(X_calib − center)
                 └─ write ──► [data/candidates/{id}/baseline.json]
                                { feature_names, feature_means, feature_covariance,
                                  alignment_matrix, n_calibration_windows,
                                  calibrated_at, quality: {per-task attempts + ratio} }
```

Two properties of that final step:

- **The completeness check is server-side.** The UI enforces the same rule, but the UI is JavaScript on the candidate's machine.
- **`voice_check` contributes no rows,** so the EA transform is still fitted on exactly the three behavioural states RQ1 is defined over — rest, reading, light cognitive load. It runs *first* so a muted microphone surfaces in ten seconds rather than after 45 seconds of face tasks.

---

## 4. Stage 2 — The exam session

Route `/exam`. Four producers run concurrently; none of them writes anything until submit.

```
  Exam.tsx  (sessionStartMsRef = performance.now())
      │
      ├─ useScreenCapture()      already recording since calibration ──► {chunksRef}
      │
      ├─ FaceMeshPreview ──► onStream(s) ──► useSessionRecorder(s, running)
      │        └─ MediaRecorder.start(1000)  ──► {chunksRef}
      │           pause/resume mirrors the exam clock, so the clip's timeline
      │           matches elapsed time rather than wall time
      │
      ├─ useEventLogger({ active, sessionOriginMs, onEvent })
      │        listeners: visibilitychange, blur/focus, copy, paste, keydown,
      │                   mousemove/mousedown/scroll, + a 1 s idle check
      │        └─ onEvent ──► metadataEventsRef.current.push(e)
      │
      └─ user actions
           Run button   ──► logPortalEvent({ type: "verification_action",
                                             source: "portal", attrs: {kind: "run"} })
           phase rail   ──► logPortalEvent({ type: "phase_marker_clicked",
                                             attrs: { marker_index: i } })
```

### What the browser may and may not assert

The portal emits exactly **one** AI-taxonomy event: `verification_action`, with `source: "portal"` written as a literal.

That is the load-bearing one. `verification_action` fires from our own editor regardless of where the accepted code came from, so the *check* is observed even when the *generation* was not — which is why `verification_latency` survives a design with no in-portal assistant, and therefore why RQ3 survives. Everything on the generation side is reconstructed backend-side from OS capture; the browser has no business asserting it and cannot.

### The phase rail is not a label

Clicking the rail emits `marker_index: 3`, never `phase: "Execution"`. Three independent barriers:

1. The attribute carries no member of the phase vocabulary, so there is nothing for a downstream consumer to mistake for a label even if it went looking.
2. It is written to `events.jsonl`, never `labels.json` — the only writer of the latter is the `/label` route via `labels.save_labels`.
3. `analysis.feature_assembly.EVENT_TYPES` excludes it, so it cannot become a model feature by accident.

§4 chose retrospective cued recall over any concurrent method precisely to avoid reactivity: asking someone to classify their phase *while solving* changes the process being measured. `tests/test_phase_rail_is_not_a_label.py` holds all three barriers in place.

---

## 5. Stage 3 — Submit: the fan-out

One click, one `session_id`, five hops — none of which may block navigation.

```
  Exam.submit()
      sessionId = String(Date.now())          ← the join key for every stream
      │
      ├─ saveSession(...) ──► {localStorage "pp_completed_sessions"}
      ├─ clearDraft()
      │
      ├─ webcamRecorder.stop() ┄┄► uploadWebcam(sid, blob)   ══► POST /sessions/{id}/webcam
      │       └┄► startExtraction(sid)                       ══► POST /sessions/{id}/extract
      │             └┄► rememberExtractionJob(sid, jobId) ──► {localStorage}
      │
      ├─ exportSessionEvidence({ sessionId, durationMs, screenChunks, metadataEvents })
      │       ├─ summarizeEvents(events, durationMs, 1000) ──► FeatureRow[]
      │       ├─ POST /sessions/{id}/screen     (multipart)
      │       └─ POST /sessions/{id}/events     { events, features }
      │             └─ on any failure ──► downloadSessionEvidence()  local files
      │
      ├─ screen.stop() ┄┄► uploadScreenRecording(sid, blob)  ══► POST /sessions/{id}/screen
      │
      └─ navigate("/verify")     ◄── fires immediately, not awaited
```

Every network hop is `void`-ed with a swallowed `.catch()`. Extraction takes minutes; a candidate who has already submitted should not be held on a spinner, and `Verify.tsx` polls independently. `exportSessionEvidence` falls back to a local download rather than losing the evidence outright.

Server side these land as:

```
  routes.upload_webcam()    ──► shutil.copyfileobj ──► [sessions/{id}/webcam.webm]
  capture.upload_screen()   ──► shutil.copyfileobj ──► [sessions/{id}/screen.webm]
  capture.upload_events()   ──► one JSON object per line ──► [sessions/{id}/events.jsonl]
                            └─► csv.DictWriter        ──► [sessions/{id}/features.csv]
```

The client's own 1 Hz feature rows are stored rather than re-derived server-side, which keeps the session folder self-describing.

> Note the **two writers of `screen.webm`**: `exportSessionEvidence` writes it if `screenChunks` is non-empty, and `screen.stop()` writes it again. The second is the authoritative one — it holds the whole sitting since calibration, while `screenChunksRef` in `Exam.tsx` only accumulates if the exam page itself collected chunks. Same path, so the later write wins.

---

## 6. Stage 4 — Extraction

Triggered by submit, run on a background thread, polled from `/verify`.

```
  routes.start_extraction(session_id)
      └─ _jobs.submit(run)  ──► {job_id}          JobRunner: one daemon thread,
                                                  strictly serial — two sessions
                                                  must not contend for the CPU
  ┄┄ worker thread ┄┄
      run(progress)
        └─ extract_signals(video_path, progress=progress)
        └─ result.signals.to_parquet(storage.signals_path(sid))
        └─ return result.report.as_dict()
```

Inside `extract_signals` — one decode, then binning:

```
  _estimate_total_frames()            progress denominator only, never timing
      │
  _decode_pass()
      └─ for frame in decode_with_pts(path, clock_offset_ms):
             FaceLandmarkerRunner.detect(image, pts_ms)      VIDEO mode
                 │
                 ├─ invalid ──► append NaN row, valid=False, prev_crop = None
                 │                                    ▲ a gap breaks the motion pair
                 └─ valid   ──► geometry.denormalize(landmarks, w, h)
                                geometry.rotation_from_transform_matrix()
                                _eye_metrics()  → EAR + unit gaze
                                motion.stabilised_crop() → motion.motion_energy()
      │
      ├─ summarise_timebase(raw_pts, nominal_fps)  → warnings
      │
      ├─ thresholds_from_profile(baseline_profile)      ← the calibration artefact
      │      └─ None → thresholds_from_session(ear)     self-calibrate
      ├─ BlinkDetector.update(t, ear) per frame  → blink_times[]
      ├─ blink_rate_series(blinks, valid_times, centres, window_ms=30000)
      │
      └─ for each 200 ms bin:
             n_valid == 0 ──► schema.empty_row(t_ms)      never interpolated
             else         ──► ear_mean, ear_std (NaN if <2 samples),
                              motion_energy, gaze_screen_fraction,
                              gaze_dispersion + head_pose_stability
                              over the trailing 2 s window
      │
      └─ [sessions/{id}/signals.parquet]   t_ms + 7 features + face_valid_fraction
                                           + latent_0…latent_63 (all NaN, reserved)
```

This is where the baseline from Stage 1 is consumed: `thresholds_from_profile` reads the candidate's own blink thresholds out of `baseline.json`. `report.blink_threshold_source` records which path was taken, so a reader can tell a profile-calibrated session from a self-calibrated one.

Three refusals to invent data, all visible in the output:

| Situation | Emitted | Not emitted |
|---|---|---|
| No face in the bin | `empty_row`, `face_valid_fraction = 0.0` | an interpolated value |
| One EAR sample in the bin | `ear_std = NaN` | `0.0`, which reads as "perfectly steady" |
| Fewer than 2 gaze points in the window | `gaze_dispersion = NaN` | a dispersion over one point |

---

## 7. Stage 5 — Verify: reading it back

Route `/verify`. Session metadata comes from localStorage; signals and the graph come from the backend.

```
  Verify.tsx
      ├─ getSession(params.get("id"))  ──► {localStorage}   duration, keystrokes, events, code
      │
      ├─ <CognitiveSignalPanel sessionId>
      │      findJob(attemptsLeft)                      job first, signals second
      │        recallExtractionJob(sid) ──► {localStorage}
      │          │
      │          ├─ found ──► poll(jobId)   ══► GET /jobs/{job_id}
      │          │              queued/running ┄┄► setTimeout 1500 ms, poll again
      │          │              done           ┄┄► finish()
      │          │              error          ──► show status.error
      │          │
      │          ├─ absent, attempts remain ┄┄► setTimeout 500 ms, findJob(n−1)
      │          └─ absent, gave up ────────► finish()
      │
      │      finish() ──► getSignals(sid)   ══► GET /sessions/{id}/signals
      │                     200 → render the 5 Hz series
      │                     throw → phase "unavailable"
      │
      └─ <ProcessGraphPanel sessionId>
             apiFetch(`/sessions/{id}/graph`)  ══► GET /sessions/{id}/graph
                   200 → nodes, edges, cycle count, entropy, backtrack ratio
                   404 → "appears once this session has been labelled"
```

**The retry loop on `findJob` is not defensive padding — it closes a real race.** `Exam.submit()` navigates to `/verify` *immediately* and registers the job id only after the upload and `POST /extract` round-trip complete. So the panel routinely mounts before `recallExtractionJob` can return anything. It retries at 500 ms intervals before falling through to a direct `getSignals`, which is the path taken when the page is revisited later and the parquet already exists.

The job id lives only in the tab that started extraction, which is why it goes through localStorage at all.

The graph 404 is deliberate and its message says why: the graph is derived from `labels.*.json`, and **an empty graph would render as a participant who did nothing** rather than one nobody has annotated yet.

---

## 8. Stage 6 — Labelling

Route `/label/:sessionId`. The only path that writes ground truth.

```
  Label.tsx
      ├─ <video src={screenRecordingUrl(sid)}>  ══► GET /sessions/{id}/screen
      │        │                                      └─ 206 Partial Content
      │        └─ scrubbing issues Range requests; without 206 the browser
      │           re-downloads the whole recording on every seek
      │
      ├─ loadOwnLabels(sid, source)   ══► GET /sessions/{id}/labels?source=
      │        └─ fromSegments() ──► {Boundaries}      resume a half-finished pass
      │
      ├─ editing ──► addCut / removeCut / setPhase   on {Boundaries}
      │        └─ toSegments(b, durationMs, source) ──► LabelSegment[]
      │        └─ validateTiling(segments, durationMs) ──► inline error
      │
      └─ saveLabels(sid, source, segments, durationMs) ══► POST /sessions/{id}/labels?source=
               │
               labeling.post_labels()
                   └─ labels.save_labels()
                         └─ labels.validate_labels()   ← the authoritative check
                               starts at 0 · no gaps · no overlaps · ends within 1 s
                         └─ [sessions/{id}/labels.{source}.json]
```

### Why tiling is enforced twice

The client copy exists for the annotator's time — a validation error 30 minutes into a pass is not usable feedback. The server copy is the one protecting the data.

And why it is enforced at all: `feature_assembly.labels_to_1hz` walks the segments into a per-second array **initialised to zeros**, so a gap does not read as "unlabelled" — it reads as phase 0, `Understanding`. Two annotators who both leave the same 40-second gap would appear to *agree* there, inflating κ with agreement neither expressed. An overlap is the mirror: the later segment silently wins, so the file and the training data disagree. Neither failure raises anything; both produce a plausible confusion matrix.

### Two structural defences

**Gaps are unrepresentable in the editor, not merely validated against.** State is a list of cut points plus a phase per slot; segments are *derived*. `n` boundaries always produce exactly `n+1` abutting segments covering `[0, duration]`.

**Blinding is structural.** `loadOwnLabels` takes one source; the route passes it to `labels.load_labels`, which opens one file. There is no argument a caller can pass — and no bug a caller can have — that returns another annotator's boundaries. Two passes that influenced each other are not independent, and κ over them measures nothing.

---

## 8a. Stage 5 — Organisational validation (Layer 4)

```
/verify                     participant decides to share the record
  POST /api/sessions/{id}/submit-for-validation
        │  owner-only. Capturing a session is not submitting it.
        ▼
  validation.initialise → state = participant_submitted
```

```
/org                        the queue, with lifecycle state per row
        │  `_summary` carries `validation_state`, so a forty-row queue does
        │  not make forty requests to answer "what needs me"
        ▼
/org/review/:sessionId
  POST /review/open
        │  freeze_annotation  →  annotations/v1/{labels.*.json, version.json}
        │                        SHA-256 per file; live labels untouched
        ▼
  validation.transition → organization_review, annotation_version = 1

  GET /evidence            ← writes the audit entry. THIS is what makes
                             "your access is logged" a true sentence.

  POST /review/request-revision   → recorded; state unchanged
  POST /review/refreeze           → annotations/v2/; v1 never rewritten

  POST /review/decide
        │  severity recomputed server-side from decision + delta
        │  disputed → stays in organization_review, NOT validated
        ▼
  validation.transition → validated

  POST /review/release
        ▼
  validation.transition → performance_released
```

Every arrow above appends to `data/audit/validation.jsonl`. Reading that log
does not.

`validation.is_validated` is what Layer 3 reads before assembling a
participant-facing profile. It is one of two conditions — the other is the
registry's release gate — and neither substitutes for the other.

---

## 8b. Stage 6 — Performance profile release (Layer 3)

```
GET /api/sessions/{id}/profile
        │
        ├─ performance_profile.assemble(session_id, reg)
        │       │
        │       ├─ validation.is_validated?  ── no ──► ProfileError
        │       │                                      │
        │       │   assembled: false, validation_state, reason
        │       │   below_gate STILL populated from gated_sections(reg),
        │       │   because what the gate withholds is a fact about the
        │       │   FEATURES, not about this sitting
        │       │
        │       └─ per section:
        │              reg.assert_releasable(feature_id)
        │                 ├─ RegistryError ──► withheld, reason FROM THE REGISTRY
        │                 └─ ok ──► _build_section
        │                              ├─ no data ──► withheld, DIFFERENT reason
        │                              └─ data ──► section + status + evidence
        │
        └─ assert_profile_clean(profile)   ← affect, content, biometrics, CV prose
```

Three states reach the client, and the frontend has a component per state:

```
  assembled: false                 → AwaitingValidationState
  assembled, sections empty        → BelowGateState (never a blank region)
  assembled, sections populated    → ProcessProfileView, status per section
```

Today every session lands in one of the first two. Zero features sit at or
above `pilot`, so a correctly built dashboard renders the withheld notice and
nothing else — the expected output of this layer, not a fault in it.

---

## 9. Stage 7 — Analysis

Offline, CLI-driven. Nothing here is served during a session.

```
  [sessions/*/]
      ├─ signals.parquet ──┐
      ├─ events.jsonl ─────┼──► feature_assembly.load_session()
      ├─ labels.*.json ────┤        ├─ events_to_1hz()   counts + time-since-last
      └─ session_manifest ─┘        ├─ labels_to_1hz()   the zero-initialised array
                                    └─ build_session_matrix() ──► (X, y) at 1 Hz
                                          │
        ┌───────────────────────────────┬─┴────────────────────┬────────────────────┐
        ▼                               ▼                      ▼                    ▼
  run_ablation.run()            process_graph                reliability.run()   event_validation
   LOSO over subjects            .build_graph_from_labels()    cohens_kappa()      .evaluate()
   select_columns(config)             │                       confusion_matrix()  match_events()
   segmentation_model                 └─ write_graph()        top_confusions()    precision_recall()
     .make_windows(±3)                    └─ [graph.json]           │                   │
     .train_classifier()                        │             κ per session       per-event-type
     .smooth_labels(min_run=3)                  │             + pooled            precision/recall
        │                                       ▼                                 vs. hand annotation
        └─► tas_metrics                  GET /sessions/{id}/graph
              .f1_at_overlap()                  └─► ProcessGraphPanel
              .edit_score()
```

`graph.json` is written **into the session directory** per §3. It previously landed in `analysis/out/{sid}_graph.json` keyed by whatever id the synthetic generator produced — making the one artefact describing a participant's solving trajectory the only one not stored with that participant's session.

`fit_accept_thresholds.sweep()` is a separate offline loop over `inference.AcceptConfig`, producing the precision/recall frontier from which a human picks the operating point.

> **Read `analysis/README.md` before citing any number out of this package.** The segmentation model is a windowed RandomForest standing in for MS-TCN++, and the synthetic generator hard-codes a correlation between the fake `latent_*` columns and the phase label. The metrics, LOSO loop and graph logic are real; the ablation's verdict that "webcam adds signal" is an artefact of the generator until it is re-run on real sessions.

---

## 10. The desktop agent, in parallel

A separate process on the participant's own machine, joined to the browser's streams only by `session_id`.

```
  python -m cli.screen_agent --session-id <id>
      └─ agent.run()
           print(CONSENT_NOTICE)
           Session(user_id, session_id)
           │
           ├─ ScreenRecorder.start()      mss + cv2.VideoWriter, 20 fps
           │      └─ [desktop/screen_recording.mp4]
           │      └─ [desktop/frame_timestamps.json]   ← the real per-frame times;
           │                                             the MP4 header records the
           │                                             *target* fps regardless
           │
           └─ EventLogger.start()         four threads
                  _window_poll_loop   0.5 s ─► app_switch, tab_change,
                                               search_activity_detected
                                               └─ _track_ai_tool() ─► ai_session_open/close
                  _flush_loop         2.0 s ─► buffer → [desktop/event_log.jsonl]
                  _idle_check_loop          ─► idle_start / idle_end
                  keyboard + mouse          ─► keystroke (interval only),
                                               copy_event / paste_event (char_count),
                                               save_shortcut_pressed
      ── on stop ──
           consolidate_event_log()   [event_log.jsonl] → [event_log.json]
           derive_ai_metrics(events)
           finalize(ai_metrics)      → [desktop/session_metadata.json]
           extract_features(...)     → [desktop/feature_vectors.csv]
```

### What the agent may claim

Only three types may carry `source="inferred"`, because they are the only ones OS-level capture can establish:

```
  ai_session_open / ai_session_close    foreground window is a known AI tool
  ai_output_accepted                    a paste of N chars shortly after that tool
```

`prompt_submit` and `response_received` are **not emitted at all.** A foreground AI tool plus keystrokes is equally a prompt being typed, a search being refined, or a reply being read while the participant fidgets. `events.validate_event()` rejects an inferred one outright, and `regeneration_depth` — which counted prompts per accept — is gone with them.

### Why not read the screen recording

OCR or a vision-language model could in principle recover more. Two reasons not to: error compounds across region detection × OCR accuracy × matching heuristic, each needing its own validation before the product means anything; and this project already has a negative result on exactly that architecture — a VLM asked to describe screen content asserted evidence absent from its input in 42 of 50 cases. The recording is therefore **evidence, not input**: it is what the human annotator watches when measuring how good the reconstruction is.

### The inference hop, as designed

```
  event_log.json  ──► inference.annotate_log(raw_events, AcceptConfig)
                          ├─ _ai_intervals()          open/close → (start, end, tool)
                          └─ for each paste_event:
                                char_count is None      → pastes_with_unknown_length
                                char_count < 120        → pastes_rejected_too_small
                                no AI within 30 s       → pastes_rejected_no_recent_ai
                                else → ai_output_accepted, source="inferred"
                     ──► merged log + InferenceReport
```

**This hop is not wired in** — see [§12](#12-where-the-flow-breaks-today).

---

## 11. Whole-system map

```
╔══════════════════════════ BROWSER ══════════════════════════╗
║  ScreenCaptureProvider ── one recording, above the router    ║
║                                                              ║
║  /onboarding                                                 ║
║    FaceMeshPreview ─► cam status                             ║
║    CalibrationSession                                        ║
║      beginCalibration ─ screen.start ─ getUserMedia(v+a)     ║
║      captureAndSendFrame  ×4/s ═══════╗                      ║
║      startVoiceMeasurement ─ finish() ║                      ║
║      judgeTask ═══════════════════════╣                      ║
║      finishCalibration ═══════════════╣                      ║
║                                       ║                      ║
║  /exam  (behind RequireCalibration) ══╣ GET /api/baseline/…  ║
║    useSessionRecorder ── webcam clip  ║                      ║
║    useEventLogger ────── events[]     ║                      ║
║    Run ─► verification_action         ║                      ║
║    submit() ══════════════════════════╣                      ║
║                                       ║                      ║
║  /verify   CognitiveSignalPanel ══════╣                      ║
║            ProcessGraphPanel ═════════╣                      ║
║  /label    Label.tsx ═════════════════╣                      ║
╚═══════════════════════════════════════╬══════════════════════╝
                                        ║ HTTP, one origin (lib/api.ts)
╔═══════════════════════════════════════╬══════════════════════╗
║                FastAPI — create_app() ▼                       ║
║                                                               ║
║  calibration.py   /api/calibration/{start,frame,task/complete,║
║                                     complete}                 ║
║                   /api/baseline/{id}   /api/session/align     ║
║                        └─ quality.assess_frame / assess_voice ║
║                        └─ pipeline.compute_ea_transform       ║
║                                                               ║
║  routes.py        POST /sessions/{id}/webcam                  ║
║                   POST /sessions/{id}/extract ─► JobRunner    ║
║                        └─┄► extract_signals() ─► parquet      ║
║                   GET  /jobs/{id}  ·  GET .../signals         ║
║                                                               ║
║  capture.py       POST /sessions/{id}/{screen,events}         ║
║  labeling.py      GET  /sessions/{id}/screen  (206 Range)     ║
║                   GET/POST .../labels?source=                 ║
║                        └─ labels.validate_labels()            ║
║                   GET  .../graph  ·  .../label-sources        ║
╚═══════════════════════════════════════╤═══════════════════════╝
                                        │ storage.py
                    ┌───────────────────┴────────────────────┐
                    ▼                                        ▼
        data/candidates/{id}/                    data/sessions/{id}/
            baseline.json                            webcam.webm
                 │                                   signals.parquet
                 │  blink thresholds                 screen.webm
                 └──────────────────────────────►    events.jsonl
                                                     features.csv
        ┌── python -m cli.screen_agent ──────────►   desktop/
        │                                            labels.*.json
        │                                            graph.json
        └── python -m problemproof.analysis.* ───────────┘
```

---

## 12. Where the flow breaks today

Verifiable against the code as it stands.

### The accept inference is not connected

```
  agent.run()
      consolidate_event_log()  ──►  derive_ai_metrics(events)
                                ▲
                                └── inference.annotate_log() is NOT called here
```

`annotate_log` has **no production call site.** `consolidate_event_log` only converts the `.jsonl` stream into a `.json` array, and the only non-test caller of `infer_ai_events` is `analysis/fit_accept_thresholds.py`, which calls it to sweep thresholds.

Consequence: an agent-captured log contains `paste_event` rows but no `ai_output_accepted` rows, so `derive_ai_metrics` sees zero accepts and both `verification_latency` and `delegation_ratio` come out `None`. `tests/test_ai_events_end_to_end.py` constructs the inferred accepts by hand, which is why the test passes while the pipeline does not produce them.

The fix is one line in the teardown — `events, report = annotate_log(events)` between consolidation and `derive_ai_metrics` — but the `InferenceReport` should be persisted with it, since `provenance` is currently `UNFITTED` and an accept count must not be readable without it. Run `fit_accept_thresholds` first.

### Nothing writes `session_manifest.json` for a real session

The only writer in the repo is `analysis/gen_synthetic_data.py`. Neither the browser submit path nor the desktop agent produces one:

```
  browser submit ──► webcam.webm, screen.webm, events.jsonl, features.csv     no manifest
  desktop agent  ──► desktop/session_metadata.json   ← its own file, its own name
  synthetic gen  ──► session_manifest.json           ← the only one
```

The agent's `session_metadata.json` *does* carry `t0_epoch_ms`, but under a different name in a different directory, so `_read_manifest` does not find it.

This has a concrete consequence, not just a theoretical one. `feature_assembly.session_readiness()` lists `session_manifest.json` first among its checks, and `load_all_sessions` **skips any session that fails readiness** — so every real captured session is currently dropped from the analysis corpus before anything else is evaluated. The reason is printed rather than silent, which is how you would notice.

A second consequence: `routes.start_extraction` calls `extract_signals(video_path, progress=progress)` with no `clock_offset_ms`, so it always defaults to `0.0`. That is *correct today* — the webcam clip and the event log share one `performance.now()` origin — and stops being correct the moment a stream with an independent clock is joined. The desktop agent's is exactly that stream.

### `/api/session/align` has no caller

`lib/calibration.ts` exports `alignSessionFeatures`, and nothing imports it. The route maps a live session feature vector into the candidate's personal frame — which is the *point* of RQ1's transform — but today the baseline is consumed only by `blink.thresholds_from_profile` during extraction, i.e. for its blink thresholds and nothing else.

So the alignment matrix is computed, stored, and never applied. Aligning `signals.parquet` against it is the missing hop between Stage 4 and Stage 7:

```
  signals.parquet ──► [MISSING] apply_alignment(X, R_inv_sqrt, center) ──► feature_assembly
```

Note the two feature vocabularies do not currently match, so this is not a one-line wiring job. Only four names are shared:

| | Columns |
|---|---|
| Both | `blink_rate_hz`, `ear_mean`, `ear_std`, `head_pose_stability` |
| `calibration.FEATURES` only (8 total) | `head_movement`, `mouth_open_mean`, `eyebrow_raise_mean`, `smile_width_mean` |
| `schema.FEATURE_COLUMNS` only (7 total) | `gaze_dispersion`, `gaze_screen_fraction`, `motion_energy` |

`/api/session/align` rejects a vector whose length disagrees with the stored profile, so an attempt to wire it up naively fails loudly rather than silently mismatching — but reconciling the two vocabularies is the actual work.

### `screen.webm` is written twice

`exportSessionEvidence` and `screen.stop()` both POST to `/sessions/{id}/screen`. Same path, last write wins, and the last write is the correct one (the whole sitting rather than the exam page's own chunks) — but only by ordering, not by design.
