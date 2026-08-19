import { useEffect, useRef, useState } from "react";
import { useScreenCapture } from "../lib/screenCapture";
import {
  clearExamTicket,
  pingCalibrationApi,
  startCalibration,
  submitCalibrationFrame,
  completeCalibrationTask,
  completeCalibration,
  type CalibrationTask,
  type QualityFlag,
  type TaskVerdict,
  type VoiceMetrics,
} from "../lib/calibration";
import { startVoiceMeasurement, NO_MICROPHONE_METRICS, type VoiceRecorder } from "../lib/voiceCheck";
import { DEFAULT_COHORT, IDENTITY_THRESHOLDS } from "../lib/identityConfig";
import { judgeCalibration, type MatchSample } from "../lib/identity";
import {
  createSampler,
  frameFromVideo,
  summariseCalibration,
  type IdentitySampler,
} from "../lib/identitySampler";

type Phase =
  | "checking"       // pinging the API
  | "unavailable"    // backend not reachable -- calibration cannot run, so nothing can
  | "intro"          // ready to start the task sequence
  | "requesting_cam" // asking for camera + microphone permission
  | "running"        // task sequence in progress
  | "judging"        // task timer ended, waiting on the backend's verdict
  | "retry"          // the task did not meet the quality bar -- sit it again
  | "aborted"        // a capture stream dropped -- the whole sequence restarts
  | "complete"       // just finished, saved
  | "error";

type Props = {
  candidateId: string;
  /** Called only once a full, passing calibration has been saved *in this
   *  sitting*. There is no path through this component that calls it
   *  otherwise — no prior baseline, no partial run, no skip. */
  onDone: () => void;
};

/** Frames post every 250 ms, so this surfaces a broken endpoint about a second
 *  in — early enough to stop and fix, rather than after the full sequence. */
const FAILURE_ALERT_THRESHOLD = 4;

/** Consecutive accepted frames before the live problem banner clears. Without
 *  it the banner flickers at the 4 Hz frame rate every time the candidate
 *  blinks or shifts. One second of clean capture is the all-clear. */
const CLEAR_BANNER_AFTER_CLEAN_FRAMES = 4;

// Identity matching runs alongside the quality frames rather than as its own
// capture. Those frames already exist and are already being drawn to a canvas,
// so the cost is one extra local inference on a subset of them — not a second
// camera pass, and nothing the participant has to sit through separately.
//
// Sampled every Nth frame, not every frame. The quality loop runs at 4/sec and
// a recognition inference is ~40ms; matching every frame would spend more time
// embedding than calibrating, for a measurement that does not change that fast.
const MATCH_EVERY_NTH_FRAME = 8;

export default function CalibrationSession({ candidateId, onDone }: Props) {
  // One recording for the whole sitting, started here and running until the
  // session is submitted. The exam portal has no start button — by the time the
  // participant gets there this is already running. See lib/screenCapture.tsx.
  const screen = useScreenCapture();

  const [phase, setPhase] = useState<Phase>("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [abortReason, setAbortReason] = useState("");
  const [tasks, setTasks] = useState<CalibrationTask[]>([]);
  const [taskIndex, setTaskIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [completeSummary, setCompleteSummary] = useState<Record<string, number> | null>(null);
  const [verdict, setVerdict] = useState<TaskVerdict | null>(null);

  // The stream lives in state, not a ref, so that acquiring it re-renders and
  // an effect can attach it. Attaching imperatively inside the getUserMedia
  // callback does not work here: at that moment the phase is "requesting_cam"
  // and the <video> element is not mounted, so videoRef.current is null and the
  // assignment is silently skipped. This mirrors FaceMeshPreview, which gets
  // this right.
  const [stream, setStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  // Identity matching. All optional: `samplerRef` stays null whenever matching
  // cannot run — off, not enrolled, enrolled elsewhere, model missing — and
  // every use below is guarded, so calibration behaves exactly as before.
  const samplerRef = useRef<IdentitySampler | null>(null);
  const matchSamplesRef = useRef<MatchSample[]>([]);
  const matchFrameCounter = useRef(0);
  const matchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const captureTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const voiceRecorderRef = useRef<VoiceRecorder | null>(null);
  // Guards the task transition against React 18 StrictMode, which invokes
  // state updaters twice in development to surface impurity.
  const advancingRef = useRef(false);
  // Latches an abort. Losing a device ends several tracks at once, and each
  // one fires `ended` — without this the candidate gets three stacked notices
  // for one unplugged webcam.
  const abortedRef = useRef(false);

  // Live capture counters. Shown during the run so a failure is visible while
  // it is happening rather than as a rejected task at the end of it.
  const framesSentRef = useRef(0);
  const framesFailedRef = useRef(0);
  const cleanStreakRef = useRef(0);
  // Per-attempt tally of what has gone wrong, so the banner can show the
  // condition that actually dominates the run rather than whatever the last
  // frame happened to trip. Mirrors the backend's `dominant_flags`, which is
  // what the verdict will be built from.
  const flagTallyRef = useRef<Map<string, { flag: QualityFlag; count: number }>>(new Map());
  const [liveStatus, setLiveStatus] = useState({ sent: 0, accepted: 0, windows: 0 });
  const [liveFlags, setLiveFlags] = useState<QualityFlag[]>([]);
  const [frameError, setFrameError] = useState("");

  // ---- initial check: is the backend up? ----
  //
  // That is the whole check. This effect used to also fetch the candidate's
  // stored profile and, if one existed, offer to skip straight past
  // calibration. It does not any more: calibration is per sitting, so a prior
  // baseline is not a reason to skip and there is nothing to look up. The one
  // question worth asking is whether the run can happen at all.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const reachable = await pingCalibrationApi();
      if (cancelled) return;
      setPhase(reachable ? "intro" : "unavailable");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  // ---- attach the stream once BOTH it and the <video> exist ----
  //
  // Runs after every render, so it fires again when the phase change mounts the
  // video element. Without this the camera light comes on but the preview stays
  // black, because the stream was acquired while the element did not exist.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    if (video.srcObject === stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {
      /* autoplay can be refused; the element is muted+playsInline so this is
         rare, and the frame grab reads from the stream regardless. */
    });
  }, [stream, phase]);

  // ---- a dropped capture stream aborts the whole sequence ----
  //
  // Not just the current task. If the camera is unplugged, the microphone is
  // revoked, or screen sharing is stopped part-way through, every task recorded
  // before that point was recorded under conditions that no longer hold and
  // that nobody watched end. Resuming from the current task would bank those
  // earlier passes on trust. Restarting from task 1 is the only version of this
  // that is actually a gate.
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    if (phase !== "running" && phase !== "judging" && phase !== "retry") return;

    const tracks = stream.getTracks();
    const onEnded = (kind: string) => () =>
      abortCalibration(
        `${kind} stopped part-way through calibration. The whole sequence has to be ` +
          "recorded in one go, so it will start again from the beginning."
      );

    const handlers = tracks.map((t) => {
      const handler = onEnded(t.kind === "audio" ? "The microphone" : "The camera");
      t.addEventListener("ended", handler);
      return [t, handler] as const;
    });

    return () => {
      handlers.forEach(([t, handler]) => t.removeEventListener("ended", handler));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stream]);

  // Screen sharing is owned by the provider, so it is watched by status rather
  // than by track event. It started before the camera did and must outlast the
  // whole sitting.
  useEffect(() => {
    if (phase !== "running" && phase !== "judging" && phase !== "retry") return;
    if (screen.status === "recording") return;
    abortCalibration(
      "Screen sharing stopped part-way through calibration. It is the evidence " +
        "record for the whole sitting, so calibration will start again from the beginning."
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.status, phase]);

  // ---- cleanup camera + timers on unmount ----
  //
  // Nothing is persisted along the way, which is what makes a page reload
  // mid-calibration start over rather than resume: the session id, the task
  // index and every counter live in refs and state, and all of them die here.
  useEffect(() => {
    return () => {
      stopCapture();
      voiceRecorderRef.current?.cancel();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCapture() {
    if (captureTimerRef.current) window.clearInterval(captureTimerRef.current);
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
    captureTimerRef.current = null;
    countdownTimerRef.current = null;
  }

  /** Tear the whole sitting down. The next run starts from task 1.
   *
   * The server-side session is simply abandoned rather than cancelled — it
   * holds no passed tasks that anything can act on, `/calibration/complete`
   * requires every task to have passed in one session, and the session expires
   * on its own TTL. */
  function abortCalibration(reason: string) {
    if (abortedRef.current) return; // one abort per sitting; tracks end in a burst
    abortedRef.current = true;

    stopCapture();
    voiceRecorderRef.current?.cancel();
    voiceRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    sessionIdRef.current = null;

    setTasks([]);
    setTaskIndex(0);
    setVerdict(null);
    setLiveFlags([]);
    setAbortReason(reason);
    setPhase("aborted");
  }

  async function recheckBackend() {
    setPhase("checking");
    const reachable = await pingCalibrationApi();
    setPhase(reachable ? "intro" : "unavailable");
  }

  async function beginCalibration() {
    abortedRef.current = false;
    // Any ticket still in this tab belongs to an earlier sitting. Dropping it
    // now means an abandoned run cannot leave a usable one behind, and that at
    // no point between here and `finishCalibration` does a ticket exist that
    // this run did not earn.
    clearExamTicket();

    // Screen first: it needs the click that got us here, and a participant who
    // declines should find out before sitting through the camera tasks.
    if (screen.status !== "recording") {
      const started = await screen.start();
      if (!started) {
        setErrorMsg(
          screen.error ||
            "Screen recording is required for this session and could not be started."
        );
        setPhase("error");
        return;
      }
    }

    setPhase("requesting_cam");
    try {
      // Camera and microphone in one request. The microphone is not optional:
      // one of the calibration checks is whether your voice is audible in the
      // room you are actually sitting in, and there is no way to run it on a
      // stream without an audio track.
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: {
          // Left on: the check should judge the microphone as the exam will
          // hear it, and every browser applies these by default.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = acquired;
      // Hand it to state; the effect above attaches it once the <video> mounts.
      setStream(acquired);
    } catch {
      setErrorMsg(
        "Camera and microphone access are both required for calibration, and at " +
          "least one was refused or is unavailable. Grant both in your browser's " +
          "site permissions, then try again."
      );
      setPhase("error");
      return;
    }

    try {
      const { session_id, tasks: taskList } = await startCalibration(candidateId);
      sessionIdRef.current = session_id;
      setTasks(taskList);
      setTaskIndex(0);
      setPhase("running");
      runTask(taskList, 0);
    } catch {
      setErrorMsg("Could not start a calibration session with the backend.");
      setPhase("error");
    }
  }

  function runTask(taskList: CalibrationTask[], index: number) {
    const task = taskList[index];
    setRemaining(task.duration_sec);
    setVerdict(null);
    setLiveFlags([]);
    setFrameError("");
    advancingRef.current = false;

    // Counters are per attempt, matching the backend: a retry is judged on its
    // own frames, not on the ones from the run that failed.
    framesSentRef.current = 0;
    framesFailedRef.current = 0;
    cleanStreakRef.current = 0;
    flagTallyRef.current.clear();
    setLiveStatus({ sent: 0, accepted: 0, windows: 0 });

    if (task.modality === "voice") {
      voiceRecorderRef.current = startVoiceMeasurement(streamRef.current);
    }

    captureTimerRef.current = window.setInterval(() => captureAndSendFrame(task.id), 250);

    // The countdown owns its own clock rather than deriving the transition
    // inside a setState updater. React 18 StrictMode invokes updaters twice in
    // development, and the previous version advanced the task from inside one —
    // which started two capture loops per task and could POST /complete twice.
    // Side effects belong outside the updater; the updater only computes state.
    const endsAt = performance.now() + task.duration_sec * 1000;

    countdownTimerRef.current = window.setInterval(() => {
      const secondsLeft = Math.ceil((endsAt - performance.now()) / 1000);
      setRemaining(Math.max(0, secondsLeft));

      if (secondsLeft > 0 || advancingRef.current) return;

      // Latch, so a late tick that slipped through cannot advance twice.
      advancingRef.current = true;
      stopCapture();
      void judgeTask(taskList, index);
    }, 250);
  }

  /** Ask the backend whether the task that just ended counted.
   *
   * The verdict is not negotiable here. A rejected task has already had its
   * frames discarded server-side, so the retry starts from nothing — which is
   * the whole point of gating per task rather than at the end. */
  async function judgeTask(taskList: CalibrationTask[], index: number) {
    const task = taskList[index];
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    let voiceMetrics: VoiceMetrics | null = null;
    if (task.modality === "voice") {
      const recorder = voiceRecorderRef.current;
      voiceRecorderRef.current = null;
      // No recorder means no audio track reached us at all. That is a failing
      // condition, not a reason to skip the check, so it is reported as such.
      voiceMetrics = recorder ? recorder.finish() : NO_MICROPHONE_METRICS;
    }

    setPhase("judging");
    try {
      const result = await completeCalibrationTask(sessionId, task.id, voiceMetrics);
      if (result.must_retry) {
        setVerdict(result);
        setPhase("retry");
        return;
      }
      const nextIndex = index + 1;
      if (nextIndex < taskList.length) {
        setTaskIndex(nextIndex);
        setPhase("running");
        runTask(taskList, nextIndex);
      } else {
        await finishCalibration();
      }
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : "Could not check the quality of that task."
      );
      setPhase("error");
    }
  }

  function retryTask() {
    // `runTask` rebuilds everything this attempt needs, including a new
    // VoiceRecorder for a voice task. That is what makes a voice retry a
    // genuine re-recording: `judgeTask` already dropped the previous recorder,
    // and the metrics it produced were a local that went out of scope with it,
    // so there is no path by which a failed run's levels are resubmitted.
    setPhase("running");
    runTask(tasks, taskIndex);
  }

  function captureAndSendFrame(taskId: string) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const sessionId = sessionIdRef.current;
    if (!video || !canvas || !sessionId || video.videoWidth === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);

    // Identity sample, off the critical path. The quality frame has already
    // been drawn and encoded above; this neither delays that nor blocks on its
    // own result, so a slow inference cannot stall the calibration loop.
    matchFrameCounter.current += 1;
    if (samplerRef.current && matchFrameCounter.current % MATCH_EVERY_NTH_FRAME === 0) {
      const sampler = samplerRef.current;
      if (!matchCanvasRef.current) matchCanvasRef.current = document.createElement("canvas");
      const frame = frameFromVideo(video, matchCanvasRef.current);
      if (frame) {
        void sampler.sample(frame, performance.now()).then((sample) => {
          if (sample) matchSamplesRef.current.push(sample);
        });
      }
    }

    submitCalibrationFrame(sessionId, taskId, dataUrl)
      .then((result) => {
        framesSentRef.current += 1;
        const accepted = result.accepted === true;

        if (accepted) {
          cleanStreakRef.current += 1;
          if (cleanStreakRef.current >= CLEAR_BANNER_AFTER_CLEAN_FRAMES) setLiveFlags([]);
        } else {
          cleanStreakRef.current = 0;
          if (result.flags && result.flags.length > 0) {
            for (const flag of result.flags) {
              const seen = flagTallyRef.current.get(flag.code);
              // Keep the newest instance: its detail carries the most recent
              // measurement, so the message quotes where the candidate is now.
              flagTallyRef.current.set(flag.code, { flag, count: (seen?.count ?? 0) + 1 });
            }
            // One line, not a list. A frame can trip several conditions at
            // once — dark *and* low-contrast *and* off-centre — and three
            // simultaneous instructions is a banner nobody acts on.
            const dominant = [...flagTallyRef.current.values()].sort(
              (a, b) => b.count - a.count
            )[0];
            setLiveFlags([dominant.flag]);
          }
        }

        setLiveStatus((prev) => ({
          sent: framesSentRef.current,
          accepted: prev.accepted + (accepted ? 1 : 0),
          windows: result.clean_windows ?? prev.windows,
        }));
      })
      .catch((e: unknown) => {
        // An occasional dropped frame is fine — the next tick retries. A frame
        // endpoint that fails *every* time is not, and swallowing it silently
        // is how a broken MediaPipe call presented as "0 usable seconds
        // captured" only after sitting through all the tasks.
        framesFailedRef.current += 1;
        if (framesFailedRef.current === FAILURE_ALERT_THRESHOLD) {
          setFrameError(
            e instanceof Error
              ? `Frames are not being processed: ${e.message}`
              : "Frames are not being processed."
          );
        }
      });
  }

  async function finishCalibration() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    // One verdict for the whole run, from the worst sample — see
    // `summariseCalibration`. Absent when nothing was measurable, in which case
    // no verdict is sent at all and the server treats the sitting as it always
    // did. A missing measurement is not a failed one.
    const worst = summariseCalibration(matchSamplesRef.current);
    const verdict = worst
      ? judgeCalibration(worst, DEFAULT_COHORT, IDENTITY_THRESHOLDS)
      : null;

    try {
      const result = await completeCalibration(sessionId, verdict);
      setCompleteSummary(result.feature_means);
      setPhase("complete");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Calibration failed to save.");
      setPhase("error");
    }
  }

  // Build the sampler once, and tear the model down when the flow unmounts —
  // it holds WASM memory that would otherwise outlive the page.
  useEffect(() => {
    let cancelled = false;
    void createSampler(candidateId).then((sampler) => {
      if (cancelled) sampler?.close();
      else samplerRef.current = sampler;
    });
    return () => {
      cancelled = true;
      samplerRef.current?.close();
      samplerRef.current = null;
    };
  }, [candidateId]);

  // ---- render ----
  if (phase === "checking") {
    return <div className="card" style={{ fontSize: 13, color: "var(--muted)" }}>Checking calibration status…</div>;
  }

  if (phase === "unavailable") {
    return (
      <div className="card tint">
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong style={{ color: "var(--red)" }}>Calibration service not reachable.</strong>{" "}
          The session cannot start without a personal baseline, so this step cannot be
          skipped. Start the backend and check again.
        </div>
        <button className="btn btn-primary small" style={{ marginTop: 14 }} onClick={() => void recheckBackend()}>
          Check again
        </button>
      </div>
    );
  }

  if (phase === "aborted") {
    return (
      <div className="card tint">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span className="dot" style={{ background: "var(--red)", width: 8, height: 8 }} />
          <span className="mono-label" style={{ color: "var(--red)", fontWeight: 600 }}>
            Calibration interrupted
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-body)", marginBottom: 14, lineHeight: 1.6 }}>
          {abortReason}
        </div>
        <button className="btn btn-primary small" onClick={() => setPhase("intro")}>
          Start calibration again
        </button>
      </div>
    );
  }

  if (phase === "intro") {
    return (
      <div className="card">
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 16px" }}>
          A microphone check followed by three short tasks establishes your natural resting
          pace, blink rate, and expressiveness — so the process scoring is calibrated to you,
          not a population average.
        </p>
        <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 16px" }}>
          <strong style={{ color: "var(--amber)" }}>This runs before every sitting.</strong>{" "}
          Calibration is never carried over from a previous session, even your own — it
          verifies the person, the camera and the room as they are right now, and a recording
          from another day is not that.
        </p>
        <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 16px" }}>
          <strong style={{ color: "var(--amber)" }}>Every check must pass before the session
          can begin.</strong>{" "}
          Each task is graded on capture quality — lighting, framing, camera steadiness,
          whether your face is unobstructed, whether you are alone in shot, and whether your
          voice is clear. Anything that falls short is flagged and the task is repeated;
          nothing here can be skipped.
        </p>
        <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 16px" }}>
          You will be asked for your camera and microphone, and to share{" "}
          <strong>your entire screen</strong>. Recording starts now and runs until you submit —
          it is the evidence record for the session, and a single-window share would miss
          everything you do outside this page.
        </p>
        <button className="btn btn-primary small" onClick={() => void beginCalibration()}>
          Share screen &amp; start calibration
        </button>
      </div>
    );
  }

  if (phase === "requesting_cam") {
    return (
      <div className="card" style={{ fontSize: 13, color: "var(--muted)" }}>
        Requesting camera and microphone access… Accept the browser prompt to continue.
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="card tint">
        <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 8 }}>{errorMsg}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.55 }}>
          Calibration is required — the session cannot be started until it completes.
        </div>
        <button className="btn btn-primary small" onClick={() => setPhase("intro")}>
          Try again
        </button>
      </div>
    );
  }

  if (phase === "retry" && verdict) {
    const failedTask = tasks[taskIndex];
    return (
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 22, alignItems: "start" }}>
        <div style={{ border: "1px solid var(--border)", background: "#0B0F15", position: "relative", overflow: "hidden", height: 200 }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
          />
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>
        <div className="card tint">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span className="dot" style={{ background: "var(--red)", width: 8, height: 8 }} />
            <span className="mono-label" style={{ color: "var(--red)", fontWeight: 600 }}>
              Task {taskIndex + 1} flagged · attempt {verdict.attempt} not accepted
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-body)", marginBottom: 14, lineHeight: 1.55 }}>
            {verdict.reason || "This recording did not meet the quality bar."} Fix the points
            below and sit the same task again — the flagged attempt has been discarded.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {verdict.flags.map((flag) => (
              <div key={flag.code} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ width: 8, height: 8, background: "var(--amber)", marginTop: 6, flexShrink: 0 }} />
                <div>
                  <span className="mono-label" style={{ display: "block", marginBottom: 4, fontSize: 8.5 }}>
                    {flag.code.replace(/_/g, " ")}
                  </span>
                  <div style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.5 }}>{flag.message}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted)", marginBottom: 14 }}>
            {verdict.clean_frames}/{verdict.frames} frames usable ·{" "}
            {verdict.clean_windows} clean second{verdict.clean_windows === 1 ? "" : "s"}
          </div>

          <button className="btn btn-primary small" onClick={retryTask}>
            Retry: {failedTask?.label ?? "this task"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "complete" && completeSummary) {
    return (
      <div className="card tint">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span className="dot" style={{ background: "var(--green)", width: 8, height: 8 }} />
          <span className="mono-label" style={{ color: "var(--teal)", fontWeight: 600 }}>
            Calibration complete — all checks passed
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
          Your baseline profile has been saved and will be used to align your exam-session
          signals.
        </div>
        <button className="btn btn-primary small" onClick={onDone}>
          Continue
        </button>
      </div>
    );
  }

  // phase === "running" | "judging"
  const task = tasks[taskIndex];
  const judging = phase === "judging";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 22, alignItems: "start" }}>
      <div style={{ border: "1px solid var(--border)", background: "#0B0F15", position: "relative", overflow: "hidden", height: 200 }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        />
        <canvas ref={canvasRef} style={{ display: "none" }} />
      </div>
      <div className="card">
        <div className="mono-label" style={{ marginBottom: 8 }}>
          Task {taskIndex + 1} of {tasks.length}
          {task?.modality === "voice" && " · read aloud"}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, lineHeight: 1.4 }}>{task?.label}</div>
        {task?.hint && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>{task.hint}</div>
        )}

        {/* The material the instruction refers to. Without this the reading
            task tells the participant to read a passage that is not on screen,
            and the 15 seconds record resting behaviour under the label
            "reading" — see backend/problemproof/api/calibration.py. */}
        {task?.content && (
          <div
            style={{
              fontSize: 14.5,
              lineHeight: 1.72,
              color: "var(--ink, #1B2432)",
              background: "var(--subtle, #F5F7FB)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 16px",
              marginBottom: 16,
              maxWidth: "62ch",
            }}
          >
            {task.content}
          </div>
        )}

        <div style={{ fontSize: 36, fontWeight: 700, color: "var(--teal)", fontFamily: "var(--mono)" }}>
          {judging ? "…" : remaining > 0 ? remaining : "…"}
        </div>
        {judging && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            Checking capture quality…
          </div>
        )}

        {/* Live quality flags. The whole reason the gate reports per frame
            rather than only per task: a candidate sitting in the dark should
            find out during the ten seconds, not after them. */}
        {liveFlags.length > 0 && !judging && (
          <div
            style={{
              marginTop: 12,
              border: "1px solid var(--amber)",
              borderRadius: 8,
              padding: "10px 12px",
              background: "rgba(196,132,26,.07)",
            }}
          >
            {liveFlags.map((flag) => (
              <div key={flag.code} style={{ fontSize: 12.5, color: "var(--amber)", lineHeight: 1.5 }}>
                ⚠ {flag.message}
              </div>
            ))}
          </div>
        )}

        {/* Live capture state. Each task needs a quota of clean one-second
            windows; showing the count as it climbs means a problem is visible
            during the run instead of at the end of it. */}
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted)", marginTop: 10 }}>
          {liveStatus.windows} usable second{liveStatus.windows === 1 ? "" : "s"} captured ·{" "}
          {liveStatus.accepted}/{liveStatus.sent} frames accepted
        </div>

        {frameError && (
          <div style={{ fontSize: 12, color: "var(--red)", lineHeight: 1.5, marginTop: 10 }}>
            {frameError}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
          {tasks.map((_, i) => (
            <span
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: i < taskIndex ? "var(--teal)" : i === taskIndex ? "var(--amber)" : "#D2DAE3",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
