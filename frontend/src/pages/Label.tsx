import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  LABEL_SOURCES,
  PHASES,
  PHASE_COLORS,
  addCut,
  emptyBoundaries,
  fmtTime,
  fromSegments,
  loadOwnLabels,
  removeCut,
  saveLabels,
  screenRecordingUrl,
  setPhase,
  toSegments,
  validateTiling,
  type Boundaries,
  type LabelSource,
  type Phase,
} from "../lib/labeling";
import { apiFetch } from "../lib/api";

// Retrospective cued-recall labelling (research plan §4).
//
// §4 chose this over concurrent think-aloud deliberately: narrating a process
// while solving changes the process you are trying to measure. So the
// participant labels afterwards, watching their own recording at 2×.
//
// The annotator sees no other annotator's boundaries. That is enforced by the
// loader (backend/problemproof/labels.py) rather than by this page hiding
// something it received — two passes that influenced each other are not
// independent, and κ computed over them measures nothing.

const mono = "var(--mono)";

const C = {
  pageBg: "#EEF1F6",
  panel: "#FFFFFF",
  subtle: "#F5F7FB",
  inset: "#F0F3F8",
  border: "#E3E8F0",
  ink: "#1B2432",
  muted: "#5A6678",
  faint: "#8A94A4",
  teal: "#0E9C8E",
  rec: "#D3546B",
};

//: §4 specifies 2×. The others are there because a dense passage sometimes
//: needs 1× and a long idle stretch is quicker at 4×.
const SPEEDS = [1, 1.5, 2, 3, 4];

export default function Label() {
  const { sessionId = "" } = useParams();
  const [params, setParams] = useSearchParams();

  const sourceParam = params.get("source");
  const source: LabelSource = (LABEL_SOURCES as readonly string[]).includes(sourceParam ?? "")
    ? (sourceParam as LabelSource)
    : "cued_recall";

  const videoRef = useRef<HTMLVideoElement>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [speed, setSpeed] = useState(2); // §4's default
  const [playing, setPlaying] = useState(false);
  const [videoError, setVideoError] = useState("");

  const [boundaries, setBoundaries] = useState<Boundaries>(() => emptyBoundaries());
  const [activeSlot, setActiveSlot] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [resumed, setResumed] = useState(false);

  const segments = useMemo(
    () => toSegments(boundaries, durationMs, source),
    [boundaries, durationMs, source]
  );
  const tilingError = durationMs > 0 ? validateTiling(segments, durationMs) : null;

  // Resume this annotator's own half-finished pass. loadOwnLabels asks for one
  // source and the server returns only that file.
  useEffect(() => {
    if (!sessionId || durationMs === 0 || resumed) return;
    let cancelled = false;
    loadOwnLabels(sessionId, source)
      .then((stored) => {
        if (cancelled || !stored?.length) return;
        setBoundaries(fromSegments(stored));
      })
      .catch(() => {
        /* nothing stored yet, or backend unreachable — start fresh */
      })
      .finally(() => {
        if (!cancelled) setResumed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, source, durationMs, resumed]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed, durationMs]);

  const seekTo = useCallback((ms: number) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = Math.min(Math.max(ms, 0), v.duration * 1000) / 1000;
  }, []);

  const cutHere = () => {
    setBoundaries((b) => addCut(b, currentMs, durationMs));
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  const onSave = async () => {
    if (tilingError) return;
    setSaveState("saving");
    setSaveError("");
    try {
      await saveLabels(sessionId, source, segments, Math.round(durationMs));
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof Error ? e.message : "save failed");
    }
  };

  // Keyboard: space toggles playback, B cuts, 1–6 assign a phase to the slot
  // the playhead is in. Labelling a 40-minute session is ~30 min of work (§4),
  // so reaching for the mouse on every boundary matters.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === "b") {
        cutHere();
      } else if (/^[1-6]$/.test(e.key)) {
        setBoundaries((b) => setPhase(b, activeSlot, PHASES[Number(e.key) - 1]));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeSlot, currentMs, durationMs]);

  // Which slot the playhead sits in, so 1–6 targets the segment on screen.
  useEffect(() => {
    const edges = [0, ...boundaries.cuts, durationMs];
    for (let i = 0; i < boundaries.phases.length; i++) {
      if (currentMs >= edges[i] && currentMs < edges[i + 1]) {
        setActiveSlot(i);
        return;
      }
    }
  }, [currentMs, boundaries, durationMs]);

  const onTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seekTo(ratio * durationMs);
  };

  // User Role Plan §6: an annotator sees a participant code, never a name.
  // Stable across sessions, so two sessions by the same participant are
  // recognisable as such — which is the context §6 allows — while the mapping
  // back to a person lives only in the account store annotators cannot read.
  const [pseudonym, setPseudonym] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void apiFetch(`/sessions/${encodeURIComponent(sessionId)}/subject`)
      .then(async (r) => {
        if (!cancelled && r.ok) setPseudonym((await r.json()).pseudonym);
      })
      .catch(() => {
        /* the label tool works without it */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div style={{ minHeight: "100vh", background: C.pageBg, color: C.ink, padding: "24px 28px" }}>
      <a href="#content" className="skip-link">
        Skip to the timeline
      </a>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 19, margin: 0, letterSpacing: "-.01em" }}>Phase labelling</h1>
            <div style={{ fontFamily: mono, fontSize: 10.5, color: C.muted, marginTop: 5 }}>
              {pseudonym ?? "participant unknown"} · session {sessionId} · retrospective cued recall
            </div>
          </div>
          <Link to="/" style={{ fontFamily: mono, fontSize: 10.5, color: C.muted }}>
            ← back
          </Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18 }}>
          <main id="content" tabIndex={-1}>
            <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
              <video
                ref={videoRef}
                src={sessionId ? screenRecordingUrl(sessionId) : undefined}
                style={{ width: "100%", display: "block", maxHeight: 460 }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (isFinite(v.duration)) setDurationMs(v.duration * 1000);
                  v.playbackRate = speed;
                }}
                onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setVideoError("No screen recording found for this session.")}
                controls={false}
              />
            </div>

            {videoError && (
              <div style={{ fontFamily: mono, fontSize: 11, color: C.rec, marginTop: 10 }}>{videoError}</div>
            )}

            {/* transport */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary small" onClick={togglePlay}>
                {playing ? "❚❚ Pause" : "▶ Play"}
              </button>
              <button type="button" className="btn btn-ghost small" onClick={() => seekTo(currentMs - 5000)}>
                −5s
              </button>
              <button type="button" className="btn btn-ghost small" onClick={() => seekTo(currentMs + 5000)}>
                +5s
              </button>

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
                  title={s === 2 ? "Research plan §4 specifies 2×" : undefined}
                >
                  {s}×
                </button>
              ))}
            </div>

            {/* timeline */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".2em", color: C.muted, marginBottom: 8 }}>
                TIMELINE · CLICK TO SEEK
              </div>
              <div
                onClick={onTimelineClick}
                style={{
                  position: "relative",
                  height: 46,
                  borderRadius: 8,
                  overflow: "hidden",
                  border: `1px solid ${C.border}`,
                  background: C.inset,
                  cursor: "pointer",
                  display: "flex",
                }}
              >
                {segments.map((seg, i) => {
                  const width = durationMs ? ((seg.end_ms - seg.start_ms) / durationMs) * 100 : 0;
                  return (
                    <div
                      key={`${seg.start_ms}-${i}`}
                      title={`${seg.phase} · ${fmtTime(seg.start_ms)}–${fmtTime(seg.end_ms)}`}
                      style={{
                        width: `${width}%`,
                        background: PHASE_COLORS[seg.phase],
                        opacity: i === activeSlot ? 1 : 0.62,
                        borderRight: i < segments.length - 1 ? "2px solid #FFF" : undefined,
                      }}
                    />
                  );
                })}
                {durationMs > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${(currentMs / durationMs) * 100}%`,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: C.ink,
                    }}
                  />
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-primary small" onClick={cutHere} disabled={!durationMs}>
                  Add boundary here (B)
                </button>
                {PHASES.map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    className="btn btn-ghost small"
                    onClick={() => setBoundaries((b) => setPhase(b, activeSlot, p as Phase))}
                    style={{ borderLeft: `3px solid ${PHASE_COLORS[p]}` }}
                  >
                    {i + 1} · {p}
                  </button>
                ))}
              </div>
              <div style={{ fontFamily: mono, fontSize: 9, color: C.faint, marginTop: 8, lineHeight: 1.6 }}>
                Space plays/pauses · B adds a boundary at the playhead · 1–6 assign a phase to the
                segment the playhead is in. Segments always tile the session — adding a boundary
                splits a segment, removing one merges two, so gaps are not possible.
              </div>
            </div>
          </main>

          {/* right — source, segments, save */}
          <aside style={{ background: C.panel, borderRadius: 12, border: `1px solid ${C.border}`, padding: 16 }}>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".2em", color: C.muted, marginBottom: 8 }}>
              ANNOTATOR
            </div>
            <select
              value={source}
              onChange={(e) => {
                setParams({ source: e.target.value });
                setBoundaries(emptyBoundaries());
                setResumed(false);
                setSaveState("idle");
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                fontFamily: mono,
                fontSize: 11.5,
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.subtle,
                color: C.ink,
                marginBottom: 8,
              }}
            >
              {LABEL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div style={{ fontFamily: mono, fontSize: 9, color: C.faint, lineHeight: 1.6, marginBottom: 18 }}>
              You are shown only your own pass. Other annotators' boundaries are never loaded —
              independence is what makes the reliability check meaningful.
            </div>

            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".2em", color: C.muted, marginBottom: 8 }}>
              SEGMENTS · {segments.length}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 300, overflowY: "auto", marginBottom: 14 }}>
              {segments.map((seg, i) => (
                <div
                  key={`${seg.start_ms}-${i}`}
                  onClick={() => seekTo(seg.start_ms)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "7px 9px",
                    borderRadius: 7,
                    background: i === activeSlot ? C.inset : C.subtle,
                    border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${PHASE_COLORS[seg.phase]}`,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontFamily: mono, fontSize: 10, color: C.ink }}>{seg.phase}</span>
                  <span style={{ fontFamily: mono, fontSize: 9, color: C.faint }}>
                    {fmtTime(seg.start_ms)}–{fmtTime(seg.end_ms)}
                  </span>
                  {i > 0 && (
                    <button
                      type="button"
                      title="Remove this boundary (merges with the previous segment)"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBoundaries((b) => removeCut(b, i - 1));
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: C.faint,
                        cursor: "pointer",
                        fontFamily: mono,
                        fontSize: 12,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            {tilingError && (
              <div style={{ fontFamily: mono, fontSize: 10, color: C.rec, lineHeight: 1.5, marginBottom: 10 }}>
                {tilingError}
              </div>
            )}

            <button
              type="button"
              className="btn btn-dark"
              style={{ width: "100%" }}
              onClick={() => void onSave()}
              disabled={!!tilingError || saveState === "saving" || !durationMs}
            >
              {saveState === "saving" ? "Saving…" : `Save as ${source}`}
            </button>

            {saveState === "saved" && (
              <div style={{ fontFamily: mono, fontSize: 10, color: C.teal, marginTop: 8 }}>
                Saved · {segments.length} segments
              </div>
            )}
            {saveState === "error" && (
              <div style={{ fontFamily: mono, fontSize: 10, color: C.rec, marginTop: 8, lineHeight: 1.5 }}>
                {saveError}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
