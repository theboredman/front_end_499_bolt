import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { FLASH_EVENT, FLASH_MS, NOTICE_MS, flashEvent, useClockSyncFlash } from "./clockSync";

// The clapperboard's frontend half (research plan §3, features.toml
// `capture.clock_sync`).
//
// Everything here is about ONE property: the flash fires exactly once, and the
// timestamp it reports is the one the recordings will agree with. A second
// flash gives the detector a second candidate step and it picks the largest, so
// the measurement would silently attach to whichever the camera saw better —
// with no error anywhere to say which instant was used.

describe("flashEvent", () => {
  it("carries no attributes at all", () => {
    // CONSTRAINT: invariant 5 — the log records timing and category only. The
    // timestamp IS the payload here, so there is nothing else to carry, and an
    // empty `attrs` is what the backend's `assert_no_content` sees.
    expect(flashEvent(4000)).toEqual({ t_ms: 4000, type: FLASH_EVENT, attrs: {} });
  });

  it("uses the type name the backend looks for", () => {
    // Kept in step with `analysis.clock_sync.FLASH_EVENT` by hand; a mismatch
    // means the flash is painted, the videos brighten, and the backend reports
    // the session unsynchronised with no clue why.
    expect(FLASH_EVENT).toBe("clock_sync_flash");
  });
});

describe("useClockSyncFlash", () => {
  function setup(armed: boolean) {
    const onFlash = vi.fn();
    let now = 0;
    const view = renderHook(
      ({ armed }: { armed: boolean }) =>
        useClockSyncFlash({ armed, sessionMs: () => now, onFlash }),
      { initialProps: { armed } }
    );
    return { view, onFlash, setNow: (v: number) => (now = v) };
  }

  it("does nothing until both recorders are running", () => {
    vi.useFakeTimers();
    const { view, onFlash } = setup(false);
    act(() => void vi.advanceTimersByTime(NOTICE_MS + FLASH_MS + 1000));
    expect(view.result.current).toBe("idle");
    expect(onFlash).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("announces before it paints", () => {
    // CONSTRAINT: the participant is told a beat before the screen goes white.
    // A single non-repeating luminance step is not a WCAG 2.3.1 flash sequence,
    // but springing it on someone is still avoidable and avoided.
    vi.useFakeTimers();
    const { view } = setup(true);
    expect(view.result.current).toBe("notice");
    act(() => void vi.advanceTimersByTime(NOTICE_MS));
    expect(view.result.current).toBe("flash");
    vi.useRealTimers();
  });

  it("clears itself so the exam page is not left behind a white overlay", () => {
    vi.useFakeTimers();
    const { view } = setup(true);
    act(() => void vi.advanceTimersByTime(NOTICE_MS + FLASH_MS + 1));
    expect(view.result.current).toBe("done");
    vi.useRealTimers();
  });

  it("fires exactly once even when re-armed", () => {
    // CONSTRAINT: one instant per session. A pause and resume flips `running`,
    // which flips `armed`; without the fired-once guard that would paint a
    // second white step mid-session and hand the detector two candidates.
    vi.useFakeTimers();
    const onFlash = vi.fn();
    const view = renderHook(
      ({ armed }: { armed: boolean }) =>
        useClockSyncFlash({ armed, sessionMs: () => 4000, onFlash }),
      { initialProps: { armed: true } }
    );
    act(() => void vi.advanceTimersByTime(NOTICE_MS + FLASH_MS + 1));
    act(() => view.rerender({ armed: false }));
    act(() => view.rerender({ armed: true }));
    act(() => void vi.advanceTimersByTime(NOTICE_MS + FLASH_MS + 1));
    expect(onFlash).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("reports the session time, not a raw performance.now() reading", () => {
    // CONSTRAINT: research plan §3 — every t_ms is session-relative. A wall
    // clock or page-load-relative value carries no offset and cannot be lined
    // up against the recordings at all, which is the failure
    // `events.assert_session_relative` exists to catch on the backend.
    vi.useFakeTimers();
    const onFlash = vi.fn();
    renderHook(() =>
      useClockSyncFlash({ armed: true, sessionMs: () => 4321, onFlash })
    );
    act(() => void vi.advanceTimersByTime(NOTICE_MS + FLASH_MS + 1));
    expect(onFlash).toHaveBeenCalledWith(4321);
    vi.useRealTimers();
  });
});
