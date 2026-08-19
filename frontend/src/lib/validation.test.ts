import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { severityFor, SEVERITY_CONSEQUENCE } from "../pages/OrgReview";
import { decide, fetchValidation, LIFECYCLE, openReview, requestRevision } from "./validation";

// The Layer 4 client.
//
// Two constraints.
//
// **The client never names a severity.** The reviewer is shown the consequence
// before they commit (Frontend Spec §7.2) — discovering afterwards that an
// adjustment invited a second reviewer is the kind of surprise that makes
// reviewers stop adjusting things, which costs exactly the signal human
// validation exists to add. But the preview is a copy of the rule, and the
// server recomputes: a client that could set severity could file a full dispute
// as a minor note.
//
// **The client cannot set a state.** There is a function per action and no
// `setState`. `validation.transition` is the only writer, and a client with a
// state setter would be one bug away from marking a disputed record validated.

const captured: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  captured.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(JSON.stringify({ validation: { state: "organization_review" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

function body(): Record<string, unknown> {
  return JSON.parse(String(captured[0].init?.body));
}

describe("severityFor — the preview", () => {
  it("matches the server rule at every threshold", () => {
    // Kept in step with `problemproof.validation.severity_for`. A backend test
    // reads this file's source to check the numbers did not drift apart, and
    // this is the behavioural half of the same pairing.
    expect(severityFor(0, false)).toBe("minor");
    expect(severityFor(1, false)).toBe("minor");
    expect(severityFor(-1, false)).toBe("minor");
    expect(severityFor(2, false)).toBe("moderate");
    expect(severityFor(-2, false)).toBe("moderate");
    expect(severityFor(4, false)).toBe("moderate");
    expect(severityFor(0, true)).toBe("major");
  });

  it("states a consequence for every severity", () => {
    // An unlabelled severity is a reviewer being told "this is moderate" with
    // no statement of what moderate does to them or to the candidate.
    for (const s of ["minor", "moderate", "major"] as const) {
      expect(SEVERITY_CONSEQUENCE[s].length).toBeGreaterThan(20);
    }
  });
});

describe("the decision request", () => {
  it("sends the decision and the adjustment, never a severity", async () => {
    await decide("s1", { decision: "disputed", score_delta: 0, notes: "unclear" });
    expect(body()).toEqual({ decision: "disputed", score_delta: 0, notes: "unclear" });
    expect(Object.keys(body())).not.toContain("severity");
  });

  it("never sends a state", async () => {
    await decide("s1", { decision: "confirmed", score_delta: 0 });
    expect(Object.keys(body())).not.toContain("state");
  });

  it("never sends a reviewer id — the server takes it from the token", async () => {
    await decide("s1", { decision: "confirmed", score_delta: 0 });
    expect(Object.keys(body())).not.toContain("reviewer_id");
  });
});

describe("the other actions", () => {
  it("opens a review with no body at all", async () => {
    // Freezing the annotation is the server's job, against whatever the
    // labelling is at that instant. A client that named a version could open a
    // review against a version it chose.
    await openReview("s1");
    expect(captured[0].init?.body).toBeUndefined();
    expect(captured[0].url).toContain("/review/open");
  });

  it("sends only a reason with a revision request", async () => {
    await requestRevision("s1", "Exploration ends too early");
    expect(body()).toEqual({ reason: "Exploration ends too early" });
  });

  it("encodes the session id rather than interpolating it raw", async () => {
    await openReview("a/b");
    expect(captured[0].url).toContain("a%2Fb");
  });
});

describe("fetchValidation", () => {
  it("returns null for a session that was never submitted", async () => {
    // The normal starting state for most of the queue, and not an error:
    // capturing a session is not submitting it.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect(await fetchValidation("s1")).toBeNull();
  });
});

describe("the lifecycle vocabulary", () => {
  it("mirrors the server's order", () => {
    // The order is the transition rule on the server — adjacency in
    // `validation.LIFECYCLE` IS what `transition` allows. A client list in a
    // different order would draw a progress bar that disagrees with what the
    // server will accept.
    expect([...LIFECYCLE]).toEqual([
      "participant_submitted",
      "organization_review",
      "validated",
      "performance_released",
    ]);
  });
});
