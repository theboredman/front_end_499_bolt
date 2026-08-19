import { describe, expect, it } from "vitest";
import { summarizeEvents, textInsertionEvent, type LoggedEvent } from "./eventLogger";

const ev = (t_ms: number, type: string, attrs: Record<string, unknown> = {}) =>
  ({ t_ms, type, attrs }) as unknown as LoggedEvent;

// Frontend Spec §8.1 rule 4. The browser half of the same rule the backend's
// `pause_spans.py` implements: a paused interval produces `idle_percentage:
// 100` and no keystrokes, which is byte-for-byte what a minute of hard
// thinking produces. Without a column separating them, the feature table
// cannot tell absence from cognition.
describe("summarizeEvents — paused intervals", () => {
  it("marks every interval a pause touches", () => {
    const rows = summarizeEvents(
      [ev(5_000, "pause_start"), ev(9_000, "pause_end", { paused_ms: 4_000 })],
      12_000
    );
    expect(rows.filter((r) => r.paused).map((r) => r.interval_index)).toEqual([5, 6, 7, 8]);
  });

  it("leaves an ordinary interval unmarked", () => {
    const rows = summarizeEvents([ev(1_000, "keystroke", { interval_ms: 120 })], 5_000);
    expect(rows.every((r) => r.paused === 0)).toBe(true);
  });

  it("runs an unmatched pause_start to the end of the session", () => {
    // A pause nobody watched close is not a measured pause. Ending it early
    // would hand the intervening seconds back as solving time.
    //
    // Intervals 3, 4 and 5 — not 6. Spans are half-open, so a span ending at
    // 6000 does not touch the interval that begins there. Same convention as
    // `pause_spans.paused_mask`, deliberately: two mirrored implementations
    // that round differently would disagree about a session's length.
    const rows = summarizeEvents([ev(3_000, "pause_start")], 6_000);
    expect(rows.filter((r) => r.paused).map((r) => r.interval_index)).toEqual([3, 4, 5]);
  });

  it("ignores a pause_end with no pause_start", () => {
    // It cannot say when its pause began; assuming zero would mark everything
    // before it as paused.
    const rows = summarizeEvents([ev(4_000, "pause_end", { paused_ms: 2_000 })], 6_000);
    expect(rows.every((r) => r.paused === 0)).toBe(true);
  });

  it("counts a session gap as time nobody was solving through", () => {
    const rows = summarizeEvents([ev(8_000, "session_gap", { unknown_ms: 3_000 })], 10_000);
    expect(rows.filter((r) => r.paused).map((r) => r.interval_index)).toEqual([5, 6, 7]);
  });

  it("keeps idle_percentage as measured rather than folding pause into it", () => {
    // The two say different things and a consumer needs both: idle is what was
    // observed, paused is why nothing was.
    const rows = summarizeEvents(
      [ev(2_000, "idle_start"), ev(3_000, "pause_start"), ev(5_000, "pause_end", { paused_ms: 2_000 })],
      6_000
    );
    expect(rows[3].idle_percentage).toBe(100);
    expect(rows[3].paused).toBe(1);
  });
});

// CLAUDE.md invariant 5: the log records timing, frequency and coarse category
// only. The type system enforces most of that; what it cannot enforce is that
// the values put in those fields are lengths rather than the thing measured, so
// the content check below is on the serialised output.

describe("textInsertionEvent", () => {
  it("says nothing about ordinary typing", () => {
    // A row per character would restate what the keystroke rows already say —
    // 1230 keystrokes would carry 1230 redundant events.
    expect(textInsertionEvent(100, 101, 5_000)).toBeNull();
    expect(textInsertionEvent(100, 100, 5_000)).toBeNull();
  });

  it("says nothing about a single backspace", () => {
    expect(textInsertionEvent(100, 99, 5_000)).toBeNull();
  });

  it("records text that arrived faster than the keyboard could produce it", () => {
    // This is the distinction the log could not previously make: a 400-char
    // paste and one typed character were the same `keystroke` row.
    const e = textInsertionEvent(100, 500, 5_000);
    expect(e).not.toBeNull();
    expect(e!.type).toBe("text_insertion");
    expect(e!.attrs.char_delta).toBe(400);
  });

  it("records a large deletion as a negative delta", () => {
    const e = textInsertionEvent(500, 100, 5_000);
    expect(e!.attrs.char_delta).toBe(-400);
  });

  it("carries a length and never the text", () => {
    const e = textInsertionEvent(0, 11, 1_000);
    expect(JSON.stringify(e)).not.toContain("hello");
    expect(Object.keys(e!.attrs)).toEqual(["char_delta"]);
  });
});

describe("summarizeEvents", () => {
  const at = (t_ms: number, type: LoggedEvent["type"], attrs = {}): LoggedEvent =>
    ({ t_ms, type, attrs }) as LoggedEvent;

  it("produces one row per interval, covering the session", () => {
    const rows = summarizeEvents([], 5_000, 1_000);
    expect(rows).toHaveLength(6); // 0..5s inclusive
    expect(rows[0].interval_start_ms).toBe(0);
    expect(rows[5].interval_start_ms).toBe(5_000);
  });

  it("produces a row even for a zero-length session", () => {
    // An empty table would make the CSV headerless and the binning ambiguous.
    expect(summarizeEvents([], 0, 1_000)).toHaveLength(1);
  });

  it("bins events into the interval they fall in, exclusive of the upper edge", () => {
    const rows = summarizeEvents(
      [at(0, "keystroke", { interval_ms: 100 }), at(999, "keystroke", { interval_ms: 120 }), at(1_000, "keystroke", { interval_ms: 140 })],
      2_000,
      1_000
    );
    expect(rows[0].keystroke_count).toBe(2);
    expect(rows[1].keystroke_count).toBe(1);
  });

  it("counts tab_hidden and window_blur together as tab switches", () => {
    const rows = summarizeEvents([at(100, "tab_hidden"), at(200, "window_blur"), at(300, "window_focus")], 1_000, 1_000);
    expect(rows[0].tab_switches).toBe(2);
  });

  it("averages keystroke intervals within a bin", () => {
    const rows = summarizeEvents(
      [at(100, "keystroke", { interval_ms: 100 }), at(200, "keystroke", { interval_ms: 300 })],
      1_000,
      1_000
    );
    expect(rows[0].avg_keystroke_interval_ms).toBe(200);
  });

  it("leaves the average blank rather than zero when nothing was typed", () => {
    // 0 would read as instantaneous typing, which is a measurement; "" reads as
    // no measurement, which is the truth.
    expect(summarizeEvents([], 1_000, 1_000)[0].avg_keystroke_interval_ms).toBe("");
  });

  it("holds idle across intervals until an idle_end arrives", () => {
    const rows = summarizeEvents([at(100, "idle_start"), at(3_500, "idle_end", { idle_duration_ms: 3_400 })], 5_000, 1_000);
    expect(rows[0].idle_percentage).toBe(100);
    expect(rows[1].idle_percentage).toBe(100);
    expect(rows[2].idle_percentage).toBe(100);
    expect(rows[4].idle_percentage).toBe(0);
  });

  it("counts the one AI-taxonomy event the browser can observe", () => {
    const rows = summarizeEvents(
      [{ type: "verification_action", t_ms: 500, source: "portal", attrs: { kind: "run" } }],
      1_000,
      1_000
    );
    expect(rows[0].verification_actions).toBe(1);
  });

  it("emits no column that could hold content", () => {
    const rows = summarizeEvents([at(100, "paste", { char_count: 412 })], 1_000, 1_000);
    const forbidden = ["text", "content", "prompt", "response", "title", "url", "path", "body"];
    for (const key of Object.keys(rows[0])) {
      expect(forbidden.some((f) => key.toLowerCase().includes(f))).toBe(false);
    }
    expect(rows[0].paste_events).toBe(1);
  });
});
