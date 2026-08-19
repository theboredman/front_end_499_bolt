// Client for the Extractor A backend (see docs/extractor_a.md).
//
// There is no user-facing "paste a tunnel URL" field here: Extractor A runs
// in-process on the normal backend (0 MB peak VRAM, no notebook, no tunnel —
// see docs/vram_budget.md), so the endpoint is just a build-time/env default.
// The recording never leaves the project's own backend.

import { apiFetch, getApiBase } from "./api";

export type JobStatusValue = "queued" | "running" | "done" | "error";

export type JobStatus = {
  status: JobStatusValue;
  progress: [number, number | null] | null;
  result: Record<string, unknown> | null;
  error: string | null;
};

// One row of the 5 Hz signals.parquet table, decoded from JSON (NaN -> null).
export type SignalRow = {
  t_ms: number;
  blink_rate_hz: number | null;
  ear_mean: number | null;
  ear_std: number | null;
  gaze_dispersion: number | null;
  gaze_screen_fraction: number | null;
  head_pose_stability: number | null;
  motion_energy: number | null;
  face_valid_fraction: number;
};

async function expectOk(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what} failed (${res.status})`);
  return res;
}

export async function uploadWebcam(sessionId: string, clip: Blob): Promise<void> {
  const form = new FormData();
  const ext = clip.type.includes("mp4") ? "mp4" : "webm";
  form.append("video", clip, `webcam.${ext}`);
  await expectOk(
    await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/webcam`, { method: "POST", body: form }),
    "webcam upload"
  );
}

export async function startExtraction(sessionId: string): Promise<string> {
  const res = await expectOk(
    await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/extract`, { method: "POST" }),
    "starting extraction"
  );
  const data = (await res.json()) as { job_id: string };
  return data.job_id;
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await expectOk(await apiFetch(`/jobs/${encodeURIComponent(jobId)}`), "job status");
  return res.json();
}

export async function getSignals(sessionId: string): Promise<SignalRow[]> {
  const res = await expectOk(
    await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/signals`),
    "fetching signals"
  );
  return res.json();
}

export function signalsDownloadUrl(sessionId: string): string {
  return `${getApiBase()}/sessions/${encodeURIComponent(sessionId)}/signals?format=parquet`;
}

// The job id lives only in the tab that started extraction; Verify.tsx (often
// reached after a fresh navigation) reads it back from here to resume polling.
const JOB_ID_PREFIX = "pp_extraction_job_";

export function rememberExtractionJob(sessionId: string, jobId: string) {
  try {
    localStorage.setItem(JOB_ID_PREFIX + sessionId, jobId);
  } catch {
    /* storage unavailable — Verify will fall back to polling signals directly */
  }
}

export function recallExtractionJob(sessionId: string): string | null {
  try {
    return localStorage.getItem(JOB_ID_PREFIX + sessionId);
  } catch {
    return null;
  }
}
