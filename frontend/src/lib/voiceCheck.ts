// Microphone measurement for the calibration voice check.
//
// Records nothing. It taps the live audio track with a Web Audio AnalyserNode,
// samples the level a few dozen times a second, and reduces the run to six
// numbers. Those numbers are what gets posted — no audio ever leaves the
// machine, which is the same promise the consent screen makes about video.
//
// The *thresholds* deliberately do not live here. They are applied in
// backend/problemproof/calibration/quality.py, so a candidate cannot pass the
// gate by editing client-side JavaScript.

import type { VoiceMetrics } from "./calibration";

/** How often the level is sampled. ~20 ms hops give ~500 samples over a
 *  10-second task, which is enough for stable percentiles without keeping a
 *  large array around. */
const HOP_MS = 20;

/** A level sample counts as "voiced" once it stands this far above the room's
 *  own noise floor. Ratio rather than an absolute, so a quiet room with a
 *  quiet speaker is judged the same way as a loud room with a loud one — the
 *  absolute-level check is a separate flag, applied server-side. */
const VOICING_OVER_NOISE = 2.5;

/** Below this a sample is silence regardless of the noise floor, which stops a
 *  near-silent room from making its own hiss look like speech. */
const VOICING_FLOOR = 0.008;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

export type VoiceRecorder = {
  /** Stop sampling and reduce the run to the numbers the backend judges. */
  finish: () => VoiceMetrics;
  /** Current smoothed level, 0..1 — for the live meter during the task. */
  level: () => number;
  /** Tear down without producing metrics (task aborted, component unmounted). */
  cancel: () => void;
};

/** Start measuring the microphone on `stream`.
 *
 * Returns null when the stream carries no audio track at all — a caller that
 * gets null should treat the check as failed, not skipped: no microphone is
 * exactly the condition the voice check exists to catch. */
export function startVoiceMeasurement(stream: MediaStream | null): VoiceRecorder | null {
  const track = stream?.getAudioTracks()[0];
  if (!track) return null;

  const AC: typeof AudioContext | undefined =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;

  const ctx = new AC();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  // No smoothing: percentiles over the raw per-hop RMS are what separate
  // speech peaks from the noise floor, and smoothing would blur them together.
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser); // never connected to destination — no echo
  void ctx.resume?.();

  const buf = new Uint8Array(analyser.fftSize);
  const levels: number[] = [];
  let peak = 0;
  let clipped = 0;
  let samples = 0;
  let latest = 0;

  const startedAt = performance.now();

  const timer = window.setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const c = (buf[i] - 128) / 128; // -1..1
      const a = Math.abs(c);
      sumSq += c * c;
      if (a > peak) peak = a;
      // 8-bit time-domain data saturates at 0/255, so a rail-to-rail sample is
      // how clipping presents here.
      if (buf[i] === 0 || buf[i] === 255) clipped++;
      samples++;
    }
    latest = Math.sqrt(sumSq / buf.length);
    levels.push(latest);
  }, HOP_MS);

  let torndown = false;
  const teardown = () => {
    if (torndown) return;
    torndown = true;
    window.clearInterval(timer);
    try {
      source.disconnect();
      analyser.disconnect();
    } catch {
      /* already disconnected */
    }
    void ctx.close();
  };

  return {
    level: () => latest,
    cancel: teardown,
    finish: (): VoiceMetrics => {
      const durationSec = (performance.now() - startedAt) / 1000;
      teardown();

      const sorted = [...levels].sort((a, b) => a - b);
      // 20th percentile is the room between words; the 90th is the speaking
      // level. Taking the max would hand the whole verdict to one door slam.
      const noiseRms = percentile(sorted, 0.2);
      const speechRms = percentile(sorted, 0.9);

      const voicingThreshold = Math.max(noiseRms * VOICING_OVER_NOISE, VOICING_FLOOR);
      const voiced = levels.filter((l) => l > voicingThreshold).length;

      return {
        duration_sec: durationSec,
        speech_rms: speechRms,
        noise_rms: noiseRms,
        peak,
        clipped_ratio: samples > 0 ? clipped / samples : 0,
        voiced_ratio: levels.length > 0 ? voiced / levels.length : 0,
        sample_count: levels.length,
      };
    },
  };
}

/** The metrics to post when there is no microphone at all.
 *
 * Fails closed: a duration of zero is the condition `assess_voice` reads as
 * "no microphone signal was recorded". Sending nothing at all would be
 * indistinguishable from a video task and would slip past the gate. */
export const NO_MICROPHONE_METRICS: VoiceMetrics = {
  duration_sec: 0,
  speech_rms: 0,
  noise_rms: 0,
  peak: 0,
  clipped_ratio: 0,
  voiced_ratio: 0,
  sample_count: 0,
};
