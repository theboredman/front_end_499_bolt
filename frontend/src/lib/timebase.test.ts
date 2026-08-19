import { describe, expect, it } from "vitest";
import {
  activeMs,
  awayMs,
  emptyLedger,
  withGapResolved,
  withPauseClosed,
  withPauseOpened,
} from "./timebase";

// The arithmetic that decides how long a candidate is recorded as having
// worked. Its failure mode is not a crash — it is a plausible wrong number, so
// every case below is one that would have looked fine in the UI.

describe("activeMs", () => {
  it("is the raw clock when nothing has been subtracted", () => {
    expect(activeMs(20_000, emptyLedger())).toBe(20_000);
  });

  it("subtracts an open pause live, so the display freezes without a second clock", () => {
    const ledger = withPauseOpened(emptyLedger(), 10_000);
    expect(activeMs(10_000, ledger)).toBe(10_000);
    // 30s later the raw clock has advanced and the shown time has not.
    expect(activeMs(40_000, ledger)).toBe(10_000);
  });

  it("never goes negative when a restored gap overshoots the raw reading", () => {
    // A wall clock that jumped forward can produce this. `00:00` is wrong but
    // legible; a negative duration is neither.
    expect(activeMs(5_000, { pausedMs: 0, unknownMs: 90_000, pauseOpenAtMs: null })).toBe(0);
  });
});

describe("pause spans we watched open and close", () => {
  it("banks the span and reports its length for the pause_end row", () => {
    const opened = withPauseOpened(emptyLedger(), 10_000);
    const { ledger, closedMs } = withPauseClosed(opened, 15_000);

    expect(closedMs).toBe(5_000);
    expect(ledger.pausedMs).toBe(5_000);
    expect(ledger.pauseOpenAtMs).toBeNull();
    // solve 10s, pause 5s, solve 10s
    expect(activeMs(25_000, ledger)).toBe(20_000);
  });

  it("reports null when nothing was open, so no orphan pause_end is emitted", () => {
    const { ledger, closedMs } = withPauseClosed(emptyLedger(), 15_000);
    expect(closedMs).toBeNull();
    expect(ledger.pausedMs).toBe(0);
  });

  it("keeps the earlier opening when a pause is opened twice", () => {
    // Moving the marker forward would convert unobserved time into solving
    // time — the exact direction of error this whole module exists to prevent.
    const once = withPauseOpened(emptyLedger(), 10_000);
    const twice = withPauseOpened(once, 40_000);
    expect(twice.pauseOpenAtMs).toBe(10_000);
  });

  it("closes the span at submit, because submitting while paused is witnessed", () => {
    const opened = withPauseOpened(emptyLedger(), 10_000);
    const { ledger } = withPauseClosed(opened, 15_000);
    expect(activeMs(15_000, ledger)).toBe(10_000);
    expect(ledger.pausedMs).toBe(5_000);
    expect(ledger.unknownMs).toBe(0);
  });
});

describe("spans nobody watched", () => {
  it("books an unmatched pause_start as unknown IN FULL, never as paused", () => {
    // Paused at 10s, then the tab died. Five minutes later they come back.
    const opened = withPauseOpened(emptyLedger(), 10_000);
    const r = withGapResolved(opened, 10_000, 300_000);

    expect(r.whilePaused).toBe(true);
    expect(r.unknownMs).toBe(300_000);
    // The critical assertion: a pause nobody watched close is not a measured
    // pause. Any non-zero value here is a claimed observation that was never
    // made.
    expect(r.ledger.pausedMs).toBe(0);
    expect(r.ledger.unknownMs).toBe(300_000);
    // The 10s solved before the pause survives.
    expect(activeMs(r.nowMs, r.ledger)).toBe(10_000);
  });

  it("books time away while running as unknown from the last draft write", () => {
    const r = withGapResolved(emptyLedger(), 20_000, 60_000);

    expect(r.whilePaused).toBe(false);
    expect(r.unknownMs).toBe(60_000);
    expect(activeMs(r.nowMs, r.ledger)).toBe(20_000);
  });

  it("closes the open pause so the same span is not subtracted twice", () => {
    const opened = withPauseOpened(emptyLedger(), 10_000);
    const r = withGapResolved(opened, 10_000, 300_000);
    // Left open, activeMs would subtract the span again as a live pause and
    // report 0 rather than 10s.
    expect(r.ledger.pauseOpenAtMs).toBeNull();
  });

  it("accumulates across repeated departures", () => {
    const first = withGapResolved(emptyLedger(), 20_000, 60_000);
    const second = withGapResolved(first.ledger, first.nowMs, 30_000);

    expect(second.ledger.unknownMs).toBe(90_000);
    expect(activeMs(second.nowMs, second.ledger)).toBe(20_000);
  });

  it("preserves already-banked paused time through a gap", () => {
    const opened = withPauseOpened(emptyLedger(), 10_000);
    const { ledger } = withPauseClosed(opened, 15_000);
    const r = withGapResolved(ledger, 25_000, 60_000);

    expect(r.ledger.pausedMs).toBe(5_000);
    expect(r.ledger.unknownMs).toBe(60_000);
    expect(activeMs(r.nowMs, r.ledger)).toBe(20_000);
  });
});

describe("awayMs", () => {
  it("uses the exact monotonic difference when the document survived", () => {
    // Navigated to /candidate and back: performance.now() never reset.
    expect(awayMs({ perfNowAtSave: 5_000, savedAtWall: 1_000_000 }, { perfNow: 65_000, wall: 9_999_999 })).toBe(60_000);
  });

  it("falls back to wall clock when performance.now() has restarted", () => {
    // A reload: the new reading is SMALLER than the saved one, which is how
    // the case is detected at all.
    expect(awayMs({ perfNowAtSave: 5_000, savedAtWall: 1_000_000 }, { perfNow: 12, wall: 1_120_000 })).toBe(120_000);
  });

  it("never returns a negative span when the wall clock moved backwards", () => {
    expect(awayMs({ perfNowAtSave: 5_000, savedAtWall: 2_000_000 }, { perfNow: 12, wall: 1_000_000 })).toBe(0);
  });

  it("treats a draft with no timing fields as no time away", () => {
    // Drafts written before pause accounting existed. Inventing a gap for them
    // would rewrite the duration of an old session on first resume.
    expect(awayMs({}, { perfNow: 1_000, wall: 5_000 })).toBe(0);
  });
});

describe("the regression this module exists for", () => {
  it("keeps the display and the event log on one timebase across a long pause", () => {
    // The original bug: `elapsed` stopped on pause while the log's clock ran
    // on, so after five minutes they disagreed by five minutes and nothing
    // recorded the offset.
    const opened = withPauseOpened(emptyLedger(), 10_000);
    const { ledger } = withPauseClosed(opened, 310_000);
    const raw = 320_000;

    // Shown to the participant.
    expect(activeMs(raw, ledger)).toBe(20_000);
    // Reconstructed by a consumer reading only the raw clock and the log.
    expect(raw - ledger.pausedMs - ledger.unknownMs).toBe(20_000);
  });
});
