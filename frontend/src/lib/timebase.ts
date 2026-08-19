// The exam's clock arithmetic (Frontend Spec §8.1), as pure functions.
//
// Why this is a module and not a few refs inside Exam.tsx
// ------------------------------------------------------
// This is the arithmetic that decides how long a candidate is recorded as
// having worked, and the arithmetic that got it wrong before: `elapsed` used to
// be its own counter that stopped on pause while the event log's clock kept
// running, so after a five-minute break the two disagreed by five minutes with
// the offset written down nowhere. Getting it wrong again would not throw, or
// warn, or fail to render. It would quietly report the wrong duration.
//
// So it lives where it can be tested against its own edge cases rather than
// exercised by hand through a UI that needs a webcam and a screen share to
// reach. Exam.tsx holds one `PauseLedger` in a ref and does no timing maths of
// its own.
//
// One clock, and subtractions from it
// -----------------------------------
// There is exactly one monotonic reading — `rawMs`, session-relative
// milliseconds since the sitting began. Everything the participant sees is
// derived from it by subtraction. No second counter exists, which is the only
// structural guarantee that a second counter cannot drift.

/** What is known about time that was not spent solving.
 *
 *  `pausedMs` and `unknownMs` are kept apart on purpose. Both are time the
 *  participant was not working, but only one of them is a measurement: a pause
 *  we watched open and close is observed, while a span the tab disappeared
 *  through is a gap we can bound but never actually saw. Collapsing them would
 *  let a crash masquerade as a coffee break. */
export type PauseLedger = {
  /** Σ spans we watched start AND end. */
  pausedMs: number;
  /** Σ spans nobody watched. */
  unknownMs: number;
  /** t_ms of an unmatched `pause_start`, or null when the clock is running. */
  pauseOpenAtMs: number | null;
};

export const emptyLedger = (): PauseLedger => ({
  pausedMs: 0,
  unknownMs: 0,
  pauseOpenAtMs: null,
});

/** Observed solving time, in ms — the number shown to the participant.
 *
 *  Derived, never counted. An open pause is subtracted live, which is what
 *  makes the display freeze during a pause without a second clock existing to
 *  be frozen. Clamped at zero: a restored draft whose wall-clock gap overshoots
 *  the monotonic reading should read `00:00`, not a negative duration. */
export function activeMs(rawMs: number, ledger: PauseLedger): number {
  const openPause = ledger.pauseOpenAtMs === null ? 0 : rawMs - ledger.pauseOpenAtMs;
  return Math.max(0, rawMs - ledger.pausedMs - ledger.unknownMs - openPause);
}

/** Open a pause span.
 *
 *  Re-opening an already-open pause is a no-op rather than an overwrite. The
 *  earlier opening is the honest one — it is when observation actually stopped
 *  — and moving the marker forward would silently convert unobserved time into
 *  solving time. */
export function withPauseOpened(ledger: PauseLedger, tMs: number): PauseLedger {
  if (ledger.pauseOpenAtMs !== null) return ledger;
  return { ...ledger, pauseOpenAtMs: tMs };
}

/** Close an open pause span, banking it as measured time.
 *
 *  Returns the closed span's length so the caller can emit `pause_end` with it,
 *  or null when there was nothing open — which is the caller's signal NOT to
 *  emit an event. A `pause_end` with no `pause_start` would be worse than no
 *  row at all. */
export function withPauseClosed(
  ledger: PauseLedger,
  tMs: number
): { ledger: PauseLedger; closedMs: number | null } {
  if (ledger.pauseOpenAtMs === null) return { ledger, closedMs: null };
  const closedMs = Math.max(0, tMs - ledger.pauseOpenAtMs);
  return {
    ledger: { ...ledger, pausedMs: ledger.pausedMs + closedMs, pauseOpenAtMs: null },
    closedMs,
  };
}

/** Resolve a restored draft: how much time went unobserved, and was the session
 *  paused when contact was lost.
 *
 *  `savedRawMs` is the monotonic reading at the last draft write; `awayMs` is
 *  how long ago that was. Their sum is the current reading, which is why the
 *  caller rebases its clock origin to match rather than restarting at zero —
 *  every t_ms already in the log has to stay valid.
 *
 *  An unmatched `pause_start` is booked as unknown IN FULL, including the
 *  stretch before contact was lost that we did in fact observe. A pause nobody
 *  watched close is not a measured pause, and splitting it at the last draft
 *  write would assert a boundary that corresponds to nothing the participant
 *  did. No `pause_end` is produced; the gap subsumes it. */
export function withGapResolved(
  ledger: PauseLedger,
  savedRawMs: number,
  awayMs: number
): { ledger: PauseLedger; nowMs: number; unknownMs: number; whilePaused: boolean } {
  const nowMs = savedRawMs + Math.max(0, awayMs);
  const whilePaused = ledger.pauseOpenAtMs !== null;
  const gapFrom = ledger.pauseOpenAtMs ?? savedRawMs;
  const unknownMs = Math.max(0, nowMs - gapFrom);

  return {
    ledger: {
      pausedMs: ledger.pausedMs,
      unknownMs: ledger.unknownMs + unknownMs,
      // Closed by the gap. Leaving it open would subtract the same span twice:
      // once through `unknownMs`, once again as a live open pause.
      pauseOpenAtMs: null,
    },
    nowMs,
    unknownMs,
    whilePaused,
  };
}

/** How long the session went unobserved, given a restored draft.
 *
 *  Two clocks, because neither one alone survives both cases.
 *
 *    Same document — navigated to /candidate and back, so the component
 *    remounted but the page did not. `performance.now()` never reset and the
 *    difference is exact.
 *
 *    New document — reload, crash, reopened tab. `performance.now()` restarted
 *    at zero and is therefore SMALLER than the saved reading, which is how the
 *    case is detected at all. Only wall clock survived, so it stands in — and
 *    because wall clock can be changed under us, its result is booked as
 *    unknown time rather than trusted as a duration. */
export function awayMs(
  saved: { perfNowAtSave?: number; savedAtWall?: number },
  now: { perfNow: number; wall: number }
): number {
  const sameDocument = typeof saved.perfNowAtSave === "number" && now.perfNow >= saved.perfNowAtSave;
  if (sameDocument) return Math.round(now.perfNow - (saved.perfNowAtSave as number));
  return Math.max(0, now.wall - (saved.savedAtWall ?? now.wall));
}
