// Ships one exam session's Stream B evidence to the backend: the screen
// recording, the metadata event log, and the 1 Hz feature rows derived from it.
//
// This originally triggered browser downloads because no backend endpoint
// existed. It now uploads to the same session folder that holds the webcam
// recording and its signals (backend/problemproof/api/capture.py), so one
// session_id gathers every stream.
//
// `downloadSessionEvidence` keeps the original local-download behaviour, for
// working offline or handing a reviewer a copy directly.

import { apiFetch } from "./api";
import type { LoggedEvent, FeatureRow } from "./eventLogger";
import { summarizeEvents, featuresToCsv } from "./eventLogger";

export type SessionExportInput = {
  sessionId: string;
  startedAtIso: string;
  durationMs: number;
  screenChunks: Blob[];
  metadataEvents: LoggedEvent[];
};

export type SessionExportResult = {
  featureRows: FeatureRow[];
  uploaded: boolean;
};

/** Chunks arrive time-ordered from MediaRecorder, so concatenation
 *  reconstructs the full recording. */
function combineChunks(screenChunks: Blob[]): Blob {
  return new Blob(screenChunks, { type: screenChunks[0].type || "video/webm" });
}

/** Upload the whole-sitting screen recording.
 *
 *  Separate from `uploadSessionEvidence` because the recording is owned by the
 *  capture provider, not by the exam page — it started during calibration and
 *  spans routes. See lib/screenCapture.tsx. */
export async function uploadScreenRecording(sessionId: string, recording: Blob): Promise<void> {
  const form = new FormData();
  form.append("video", recording, "screen.webm");
  const res = await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/screen`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`screen upload failed (${res.status})`);
}

export async function uploadSessionEvidence(
  input: SessionExportInput
): Promise<SessionExportResult> {
  const { sessionId, durationMs, screenChunks, metadataEvents } = input;
  const featureRows = summarizeEvents(metadataEvents, durationMs, 1000);

  if (screenChunks.length > 0) {
    const form = new FormData();
    form.append("video", combineChunks(screenChunks), "screen.webm");
    await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/screen`, {
      method: "POST",
      body: form,
    });
  }

  await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: metadataEvents, features: featureRows }),
  });

  return { featureRows, uploaded: true };
}

/** Local-download fallback, in the layout the desktop agent produces. */
export function downloadSessionEvidence(input: SessionExportInput): SessionExportResult {
  const { sessionId, startedAtIso, durationMs, screenChunks, metadataEvents } = input;

  if (screenChunks.length > 0) {
    downloadBlob(combineChunks(screenChunks), `${sessionId}_screen_recording.webm`);
  }

  downloadText(JSON.stringify(metadataEvents, null, 2), `${sessionId}_event_log.json`, "application/json");

  const featureRows = summarizeEvents(metadataEvents, durationMs, 1000);
  downloadText(featuresToCsv(featureRows), `${sessionId}_feature_vectors.csv`, "text/csv");

  const metadata = {
    session_id: sessionId,
    started_at_iso: startedAtIso,
    duration_ms: durationMs,
    screen_chunk_count: screenChunks.length,
    event_count: metadataEvents.length,
    feature_row_count: featureRows.length,
  };
  downloadText(JSON.stringify(metadata, null, 2), `${sessionId}_session_metadata.json`, "application/json");

  return { featureRows, uploaded: false };
}

/** Upload if the backend is reachable, otherwise fall back to a local download
 *  so the evidence is never simply lost. */
export async function exportSessionEvidence(
  input: SessionExportInput
): Promise<SessionExportResult> {
  try {
    return await uploadSessionEvidence(input);
  } catch {
    return downloadSessionEvidence(input);
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadText(text: string, filename: string, mime: string) {
  downloadBlob(new Blob([text], { type: mime }), filename);
}
