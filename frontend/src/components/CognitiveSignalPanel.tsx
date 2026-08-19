import { useEffect, useRef, useState } from "react";
import {
  getJobStatus,
  getSignals,
  recallExtractionJob,
  signalsDownloadUrl,
  type JobStatus,
  type SignalRow,
} from "../lib/webcamExtraction";

const mono = "var(--mono)";

const FEATURES: { key: keyof SignalRow; label: string; color: string }[] = [
  { key: "blink_rate_hz", label: "BLINK RATE", color: "#2E8FBE" },
  { key: "ear_mean", label: "EYE ASPECT RATIO", color: "#0E9C8E" },
  { key: "gaze_dispersion", label: "GAZE DISPERSION", color: "#6D4FD0" },
  { key: "gaze_screen_fraction", label: "ON-SCREEN FRACTION", color: "#B5760E" },
  { key: "head_pose_stability", label: "HEAD POSE SD", color: "#C64459" },
  { key: "motion_energy", label: "MOTION ENERGY", color: "#3FA268" },
];

const CHART_W = 600;

/** One feature over the session timeline. Gaps (NaN -> null) break the line
 * rather than being interpolated or drawn as zero — a missing face must stay
 * visibly missing. */
function Sparkline({ rows, feature, label, color }: { rows: SignalRow[]; feature: keyof SignalRow; label: string; color: string }) {
  const height = 34;
  const pad = 2;
  const values = rows.map((r) => r[feature] as number | null);
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));

  const n = rows.length;
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (CHART_W - 2 * pad);

  let body: React.ReactNode;
  if (finite.length === 0) {
    body = (
      <div style={{ fontFamily: mono, fontSize: 9, color: "var(--faint)", padding: "8px 0" }}>no data in this recording</div>
    );
  } else {
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const span = max - min || 1;
    const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);

    const segments: { x: number; y: number }[][] = [];
    let current: { x: number; y: number }[] = [];
    values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      current.push({ x: x(i), y: y(v) });
    });
    if (current.length) segments.push(current);

    body = (
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_W} ${height}`}
        preserveAspectRatio="none"
        style={{ height, flex: 1, background: "var(--subtle, #F5F7FB)", border: "1px solid var(--border, #E3E8F0)", borderRadius: 4 }}
      >
        {segments.map((seg, i) => (
          <polyline key={i} points={seg.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={color} strokeWidth={1.4} />
        ))}
      </svg>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
      <div style={{ width: 130, fontFamily: mono, fontSize: 8.5, color: "var(--faint)", letterSpacing: ".04em", flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
    </div>
  );
}

/** face_valid_fraction as a colour strip: teal where the face was resolved,
 * hatched where it wasn't — so a bad recording is obvious before reading any
 * of the feature rows below it. */
function ValidityBand({ rows }: { rows: SignalRow[] }) {
  const height = 12;
  const n = Math.max(1, rows.length);
  const bw = CHART_W / n;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <div style={{ width: 130, fontFamily: mono, fontSize: 8.5, color: "var(--faint)", letterSpacing: ".04em", flexShrink: 0 }}>
        FACE DETECTED
      </div>
      <svg width="100%" viewBox={`0 0 ${CHART_W} ${height}`} preserveAspectRatio="none" style={{ height, flex: 1, display: "block" }}>
        <defs>
          <pattern id="pp-invalid-hatch" width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="#F3C9CC" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="#E5484D" strokeWidth="1.5" />
          </pattern>
        </defs>
        {rows.map((r, i) => {
          const valid = r.face_valid_fraction ?? 0;
          const fill = valid >= 0.5 ? `rgba(14,156,142,${0.25 + valid * 0.6})` : "url(#pp-invalid-hatch)";
          return <rect key={i} x={i * bw} y={0} width={bw + 0.5} height={height} fill={fill} />;
        })}
      </svg>
    </div>
  );
}

type Phase = "checking" | "unavailable" | "polling" | "ready" | "error";

/** Extractor A's output for a completed session — see docs/extractor_a.md.
 * Renders nothing if no extraction was ever started for this session (e.g.
 * older sessions recorded before this existed, or no backend reachable), so
 * it never turns a missing feature into visible breakage on the report page. */
export default function CognitiveSignalPanel({ sessionId }: { sessionId: string }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [job, setJob] = useState<JobStatus | null>(null);
  const [rows, setRows] = useState<SignalRow[] | null>(null);
  const [error, setError] = useState("");
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      try {
        const signals = await getSignals(sessionId);
        if (cancelled) return;
        setRows(signals);
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("unavailable");
      }
    };

    const poll = async (jobId: string) => {
      try {
        const status = await getJobStatus(jobId);
        if (cancelled) return;
        setJob(status);
        if (status.status === "done") {
          await finish();
        } else if (status.status === "error") {
          setError(status.error || "extraction failed");
          setPhase("error");
        } else {
          pollTimer.current = window.setTimeout(() => poll(jobId), 1500);
        }
      } catch {
        if (!cancelled) setPhase("unavailable");
      }
    };

    // Exam.tsx uploads the recording and registers the job *after*
    // navigating here (on purpose — extraction must never block
    // navigation), so the job id can land in localStorage a beat after this
    // component mounts. Retry for a short grace period before giving up.
    const findJob = (attemptsLeft: number) => {
      if (cancelled) return;
      const jobId = recallExtractionJob(sessionId);
      if (jobId) {
        setPhase("polling");
        poll(jobId);
        return;
      }
      if (attemptsLeft > 0) {
        pollTimer.current = window.setTimeout(() => findJob(attemptsLeft - 1), 500);
        return;
      }
      // No job ever showed up — try once in case signals already exist
      // (e.g. re-visiting the page later), otherwise stay hidden.
      finish();
    };
    findJob(20); // ~10s grace period

    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [sessionId]);

  if (phase === "checking" || phase === "unavailable") return null;

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="mono-label" style={{ marginBottom: 12 }}>
        Webcam cognitive signal · Extractor A
      </div>

      {phase === "polling" && (
        <div style={{ fontFamily: mono, fontSize: 11, color: "var(--muted)" }}>
          Analyzing webcam recording…{" "}
          {job?.progress ? `${job.progress[0]}${job.progress[1] ? ` / ${job.progress[1]}` : ""} frames` : ""}
        </div>
      )}

      {phase === "error" && (
        <div style={{ fontFamily: mono, fontSize: 11, color: "#E5484D" }}>Extraction failed: {error}</div>
      )}

      {phase === "ready" && rows && rows.length > 0 && (
        <>
          <p style={{ fontSize: 12, lineHeight: 1.6, color: "var(--muted)", margin: "0 0 14px" }}>
            Blink rate, gaze, head-pose stability and motion energy, sampled at 5&nbsp;Hz from the session recording.
            Gaps mean the face wasn't resolved in that window — not zero activity. The band below shows where.
          </p>
          <ValidityBand rows={rows} />
          {FEATURES.map((f) => (
            <Sparkline key={f.key} rows={rows} feature={f.key} label={f.label} color={f.color} />
          ))}
          <a
            href={signalsDownloadUrl(sessionId)}
            style={{ fontFamily: mono, fontSize: 10, color: "var(--teal)", display: "inline-block", marginTop: 10 }}
          >
            ↓ Download signals.parquet
          </a>
        </>
      )}

      {phase === "ready" && (!rows || rows.length === 0) && (
        <div style={{ fontFamily: mono, fontSize: 11, color: "var(--faint)" }}>
          No signal data was extracted from this recording.
        </div>
      )}
    </div>
  );
}
