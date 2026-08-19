import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fmtTime,
  loadCuePoints,
  saveNarrationPass,
  screenRecordingUrl,
  uploadNarrationAudio,
  type CuePoint,
  type NarrationEntry,
} from "../lib/labeling";
import { useNarrationRecorder } from "../lib/narrationRecorder";

// Cued retrospective reporting — the protocol itself (research plan §4,
// van Gog, Paas, van Merriënboer & Witte 2005, JEP:Applied 11(4) 237-244).
//
// The method is a VERBALIZATION protocol. The participant watches their own
// recording and says what they were doing and why. Its measured advantage over
// concurrent think-aloud is specifically in metacognitive content — noticing
// being stuck, deciding to switch approach, judging whether the work was done.
// So the recorded narration is the data this page collects.
//
// WHAT THIS PAGE MUST NEVER SHOW
// ------------------------------
// PHASES, PHASE_COLORS, or any list of the six categories. validation.
// cued_recall claims these labels are participant-derived "because the phase
// taxonomy is the thing under test" — and a participant shown six boxes puts
// their experience in one of the six boxes. The taxonomy would then agree with
// itself by construction and could never be discovered to be wrong.
//
// Mapping narration onto phases is a later, separate researcher step. It
// writes labels.cued_recall.json through the normal labels route; nothing here
// guesses a phase, and nothing here imports the phase vocabulary.
//
// The questions are open and fixed: "What were you doing here?" and "Why?" —
// never "Were you stuck here?", which supplies the answer and collects
// agreement with it. They come from the server so the wording recorded in the
// data is the wording that was actually on screen.

const mono = "var(--mono)";

const C = {
  pageBg: "#EEF1F6",
  panel: "#FFFFFF",
  subtle: "#F5F7FB",
  border: "#E3E8F0",
  ink: "#1B2432",
  muted: "#5A6678",
  faint: "#8A94A4",
  teal: "#0E9C8E",
  rec: "#D3546B",
};

//: Normal or reduced speed, per §4 — recalling *why* takes longer than
//: placing a cut, which is why the boundary editor's 2× default is wrong here.
const SPEEDS = [0.5, 0.75, 1, 1.5];

//: Human-readable gloss per cue reason. Describes what the RECORD shows, never
//: what it meant — "you were away from the exam window", not "you were stuck".
//: The participant supplies the meaning; that is the whole point.
const REASON_LABEL: Record<string, string> = {
  verification: "you checked your work here",
  large_paste: "a large paste landed here",
  long_pause: "there was a pause here",
  left_window: "you were away from the exam window",
  interval_floor: "a quiet stretch",
  recording_end: "the recording ends here",
};

type Answering = { cue: CuePoint; index: number; audioStartMs: number };

export default function CuedRecall() {
  const { sessionId = "" } = useParams();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [videoError, setVideoError] = useState("");

  const [cues, setCues] = useState<CuePoint[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [cueError, setCueError] = useState("");
  const nextCueRef = useRef(0);

  const [started, setStarted] = useState(false);
  const [answering, setAnswering] = useState<Answering | null>(null);
  const [entries, setEntries] = useState<NarrationEntry[]>([]);
  const [typedNote, setTypedNote] = useState("");
  const [finished, setFinished] = useState(false);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  const mic = useNarrationRecorder();

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed, durationMs]);

  // The cue schedule comes from the participant's own event log, so it cannot
  // be built until the recording's duration is known.
  useEffect(() => {
    if (!sessionId || !durationMs || cues.length) return;
    let cancelled = false;
    void loadCuePoints(sessionId, durationMs)
      .then((schedule) => {
        if (cancelled) return;
        setCues(schedule.cue_points);
        setQuestions(schedule.questions);
      })
      .catch((e) => {
        if (!cancelled) setCueError(e instanceof Error ? e.message : "could not load cue points");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, durationMs, cues.length]);

  const openCue = useCallback((cue: CuePoint, index: number) => {
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
    setCurrentMs(cue.video_ms);
    setAnswering({ cue, index, audioStartMs: mic.elapsedMs() });
  }, [mic]);

  // Cue points fire off the video's own playhead rather than a wall clock, so
  // they track the chosen playback speed and any manual scrubbing.
  const onTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const ms = e.currentTarget.currentTime * 1000;
    setCurrentMs(ms);
    if (answering || finished) return;
    const next = cues[nextCueRef.current];
    if (next && ms >= next.video_ms) {
      openCue(next, nextCueRef.current);
    }
  };

  const onEnded = () => {
    if (answering || finished) return;
    const last = cues[cues.length - 1];
    if (last && nextCueRef.current < cues.length) {
      openCue(last, cues.length - 1);
    }
  };

  /** Record the answer and move on. The audio span is what makes this an
   *  answer rather than a click: it points at what the participant actually
   *  said, which the server checks is non-empty. */
  const confirmAnswer = () => {
    if (!answering) return;
    const note = typedNote.trim();
    setEntries((prev) => [
      ...prev,
      {
        video_ms: Math.round(answering.cue.video_ms),
        audio_start_ms: answering.audioStartMs,
        audio_end_ms: mic.elapsedMs(),
        cue_reason: answering.cue.reason,
        cue_detail: answering.cue.detail,
        ...(note ? { typed_note: note } : {}),
      },
    ]);
    setTypedNote("");
    nextCueRef.current = answering.index + 1;
    const wasLast = answering.index >= cues.length - 1;
    setAnswering(null);
    if (wasLast) setFinished(true);
    else void videoRef.current?.play();
  };

  /** Nothing starts until the microphone is live. */
  const startPass = async () => {
    const ok = await mic.arm();
    if (!ok) return;
    setStarted(true);
    void videoRef.current?.play();
  };

  const onSubmit = async () => {
    setSaveState("saving");
    setSaveError("");
    try {
      const blob = await mic.stop();
      if (!blob || blob.size === 0) {
        throw new Error(
          "No narration audio was captured, so this pass cannot be saved. " +
            "The recording is the data this protocol collects."
        );
      }
      await uploadNarrationAudio(sessionId, blob);
      await saveNarrationPass(sessionId, entries, mic.elapsedMs(), Math.round(durationMs));
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof Error ? e.message : "save failed");
    }
  };

  const micBlocked = mic.state === "denied" || mic.state === "unsupported";

  return (
    <div style={{ minHeight: "100vh", background: C.pageBg, color: C.ink, padding: "24px 28px" }}>
      <a href="#content" className="skip-link">
        Skip to the recording
      </a>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 19, margin: 0, letterSpacing: "-.01em" }}>Cued recall</h1>
            <div style={{ fontFamily: mono, fontSize: 10.5, color: C.muted, marginTop: 5 }}>
              session {sessionId} · watch your own recording and talk through what you were doing
            </div>
          </div>
          <Link to="/" style={{ fontFamily: mono, fontSize: 10.5, color: C.muted }}>
            ← back
          </Link>
        </div>

        {/* The microphone is a precondition, not a nicety. If it is refused the
            pass does not degrade to clicking — it stops. */}
        {micBlocked && (
          <div
            style={{
              marginBottom: 16,
              padding: 14,
              borderRadius: 10,
              background: "#FDEEF0",
              border: `1px solid ${C.rec}`,
              fontFamily: mono,
              fontSize: 11.5,
              lineHeight: 1.65,
              color: C.rec,
            }}
          >
            <strong style={{ letterSpacing: ".08em" }}>CANNOT RUN THIS PASS</strong>
            <div style={{ marginTop: 6 }}>{mic.error}</div>
          </div>
        )}

        <main id="content" tabIndex={-1} style={{ background: "#000", borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
          <video
            ref={videoRef}
            src={sessionId ? screenRecordingUrl(sessionId) : undefined}
            style={{ width: "100%", display: "block", maxHeight: 460 }}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (isFinite(v.duration)) setDurationMs(v.duration * 1000);
              v.playbackRate = speed;
            }}
            onTimeUpdate={onTimeUpdate}
            onEnded={onEnded}
            onError={() => setVideoError("No screen recording found for this session.")}
            controls={false}
          />
        </main>

        {videoError && (
          <div style={{ fontFamily: mono, fontSize: 11, color: C.rec, marginTop: 10 }}>{videoError}</div>
        )}
        {cueError && (
          <div style={{ fontFamily: mono, fontSize: 11, color: C.rec, marginTop: 10, lineHeight: 1.5 }}>
            {cueError}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          {!started ? (
            <button
              type="button"
              className="btn btn-primary small"
              onClick={() => void startPass()}
              disabled={!durationMs || !cues.length || micBlocked || mic.state === "requesting"}
            >
              {mic.state === "requesting" ? "Waiting for microphone…" : "▶ Start · records your voice"}
            </button>
          ) : (
            <span style={{ fontFamily: mono, fontSize: 11, color: mic.state === "recording" ? C.rec : C.muted }}>
              {mic.state === "recording" ? "● recording your narration" : "narration stopped"}
            </span>
          )}

          <span style={{ fontFamily: mono, fontSize: 11, color: C.muted }}>
            {fmtTime(currentMs)} / {fmtTime(durationMs)}
          </span>

          <span style={{ flex: 1 }} />

          <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".14em", color: C.faint }}>SPEED</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={s === speed ? "btn btn-dark small" : "btn btn-ghost small"}
            >
              {s}×
            </button>
          ))}
        </div>

        <div style={{ fontFamily: mono, fontSize: 9, color: C.faint, marginTop: 8, lineHeight: 1.6 }}>
          {cues.length
            ? `${cues.length} points to talk through, taken from what happened during your session. Speak your answer — the typing box is optional.`
            : "Loading the points from your session…"}
        </div>

        {answering && (
          <div
            style={{
              marginTop: 16,
              background: C.panel,
              borderRadius: 12,
              border: `1px solid ${C.border}`,
              padding: 16,
            }}
          >
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".2em", color: C.faint, marginBottom: 10 }}>
              {fmtTime(answering.cue.video_ms)} ·{" "}
              {(REASON_LABEL[answering.cue.reason] ?? "this moment").toUpperCase()}
            </div>

            {/* The questions, verbatim from the server. Open and non-leading:
                they ask for an account, they do not offer one. */}
            {questions.map((q) => (
              <div key={q} style={{ fontSize: 17, marginBottom: 6, letterSpacing: "-.01em" }}>
                {q}
              </div>
            ))}

            <div style={{ fontFamily: mono, fontSize: 10, color: C.muted, margin: "10px 0 12px", lineHeight: 1.6 }}>
              Say it out loud — your voice is being recorded. Take as long as you need, then continue.
            </div>

            <textarea
              value={typedNote}
              onChange={(e) => setTypedNote(e.target.value)}
              placeholder="Optional: type anything you'd rather write than say"
              rows={2}
              style={{
                width: "100%",
                boxSizing: "border-box",
                fontFamily: mono,
                fontSize: 12,
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.subtle,
                color: C.ink,
                resize: "vertical",
                marginBottom: 10,
              }}
            />
            <button type="button" className="btn btn-primary" onClick={confirmAnswer}>
              {answering.index >= cues.length - 1 ? "Finish" : "Continue"}
            </button>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".2em", color: C.muted, marginBottom: 8 }}>
            TALKED THROUGH · {entries.length}
            {cues.length ? ` / ${cues.length}` : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {entries.map((e, i) => (
              <div
                key={`${e.video_ms}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 9px",
                  borderRadius: 7,
                  background: C.subtle,
                  border: `1px solid ${C.border}`,
                }}
              >
                <span style={{ fontFamily: mono, fontSize: 9, color: C.faint, width: 52 }}>
                  {fmtTime(e.video_ms)}
                </span>
                <span style={{ fontFamily: mono, fontSize: 10, color: C.muted }}>
                  {Math.max(0, Math.round((e.audio_end_ms - e.audio_start_ms) / 1000))}s spoken
                </span>
                {e.typed_note && (
                  <span style={{ fontFamily: mono, fontSize: 10, color: C.muted }}>— {e.typed_note}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-dark"
          style={{ width: "100%", marginTop: 16 }}
          onClick={() => void onSubmit()}
          disabled={!finished || saveState === "saving" || saveState === "saved"}
        >
          {saveState === "saving" ? "Uploading narration…" : `Submit pass · ${entries.length} points`}
        </button>

        {saveState === "saved" && (
          <div style={{ fontFamily: mono, fontSize: 10, color: C.teal, marginTop: 8 }}>
            Saved. Your narration is the record — a researcher reads it later.
          </div>
        )}
        {saveState === "error" && (
          <div style={{ fontFamily: mono, fontSize: 10, color: C.rec, marginTop: 8, lineHeight: 1.5 }}>
            {saveError}
          </div>
        )}
      </div>
    </div>
  );
}
