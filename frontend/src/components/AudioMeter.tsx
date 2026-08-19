import { useEffect, useRef } from "react";

type AudioMeterProps = {
  stream: MediaStream | null;
  active?: boolean;
  bars?: number;
  height?: number;
};

// Live microphone visualizer: reads the audio track off the same MediaStream
// the exam records from, and renders a real-time frequency-bar spectrum plus an
// RMS level meter. All per-frame updates are written straight to the DOM via
// refs so the 60fps animation never triggers a React re-render.
export default function AudioMeter({ stream, active = true, bars = 34, height = 46 }: AudioMeterProps) {
  const barRefs = useRef<Array<HTMLDivElement | null>>([]);
  const levelRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);

  const audioTrack = stream?.getAudioTracks()[0] ?? null;
  const hasAudio = !!audioTrack;

  useEffect(() => {
    if (!audioTrack || !active) return;

    const AC: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;

    const ctx = new AC();
    const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser); // intentionally NOT connected to destination (no echo)

    const freq = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);
    let raf = 0;
    void ctx.resume?.();

    const draw = () => {
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(time);

      const n = barRefs.current.length;
      const per = Math.max(1, Math.floor((freq.length * 0.7) / n)); // skip the empty top bins
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < per; j++) sum += freq[i * per + j] || 0;
        const v = sum / per / 255; // 0..1
        const el = barRefs.current[i];
        if (el) el.style.transform = `scaleY(${Math.max(0.05, Math.min(1, v * 1.4))})`;
      }

      // RMS loudness from the time-domain signal (speech sits low, so scale up).
      let sumSq = 0;
      for (let i = 0; i < time.length; i++) {
        const c = (time[i] - 128) / 128;
        sumSq += c * c;
      }
      const rms = Math.sqrt(sumSq / time.length);
      const pct = Math.min(100, Math.round(rms * 200));
      if (levelRef.current) levelRef.current.style.width = pct + "%";
      if (pctRef.current) pctRef.current.textContent = pct + "%";
      if (dotRef.current) dotRef.current.style.opacity = pct > 6 ? "1" : "0.3";

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      analyser.disconnect();
      void ctx.close();
      barRefs.current.forEach((el) => el && (el.style.transform = "scaleY(0.05)"));
      if (levelRef.current) levelRef.current.style.width = "0%";
      if (pctRef.current) pctRef.current.textContent = "0%";
    };
  }, [audioTrack, active]);

  const mono = "var(--mono)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            ref={dotRef}
            className={hasAudio && active ? "pp-rec-dot" : ""}
            style={{ width: 7, height: 7, borderRadius: "50%", background: hasAudio ? "#E5484D" : "#B7C0CE", opacity: 0.3 }}
          />
          <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".14em", color: "#6B7688" }}>
            {hasAudio ? (active ? "MIC · LIVE" : "MIC · PAUSED") : "NO MICROPHONE"}
          </span>
        </div>
        <span ref={pctRef} style={{ fontFamily: mono, fontSize: 10, color: "#0B7C70" }}>
          0%
        </span>
      </div>

      {/* frequency spectrum */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          height,
          padding: "0 2px",
          background: "#F0F3F8",
          border: "1px solid #E3E8F0",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {Array.from({ length: bars }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: "70%",
              alignSelf: "center",
              borderRadius: 2,
              background: "linear-gradient(180deg, #34D3C7 0%, #0E9C8E 100%)",
              transform: "scaleY(0.05)",
              transformOrigin: "center",
              transition: "transform .06s linear",
            }}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
          />
        ))}
      </div>

      {/* smoothed level bar */}
      <div style={{ height: 6, background: "#F0F3F8", border: "1px solid #E3E8F0", borderRadius: 4, overflow: "hidden" }}>
        <div
          ref={levelRef}
          style={{ width: "0%", height: "100%", background: "linear-gradient(90deg, #0E9C8E, #34D3C7)", transition: "width .08s linear" }}
        />
      </div>
    </div>
  );
}
