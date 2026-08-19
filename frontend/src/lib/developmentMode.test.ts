// The browser half of PP_MODE. See backend/tests/test_development_mode.py for
// the contract this has to match, and backend/problemproof/api/dev.py for why
// the door exists at all.
//
// Two properties matter here, and both are about failing closed:
//
//   * the mode comes from the SERVER, not from a VITE_ variable of its own.
//     Two variables could disagree, and the disagreement that matters is a
//     "strict" badge sitting over a session that skipped calibration.
//   * anything unclear means deployment. Unreachable backend, malformed
//     response, missing field — all of them hide the bypass rather than
//     offering it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearExamTicket,
  getServerMode,
  mintDevelopmentTicket,
  readCalibrationProvenance,
  readExamTicket,
} from "./calibration";

function respondWith(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
  });
}

beforeEach(() => {
  sessionStorage.clear();
  clearExamTicket();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getServerMode", () => {
  it("reports development when the backend says so", async () => {
    vi.stubGlobal("fetch", respondWith({ status: "ok", mode: "development" }));
    expect(await getServerMode()).toBe("development");
  });

  it("reports deployment when the backend says so", async () => {
    vi.stubGlobal("fetch", respondWith({ status: "ok", mode: "deployment" }));
    expect(await getServerMode()).toBe("deployment");
  });

  it("falls back to deployment when the backend is unreachable", async () => {
    // The failure direction is the whole point: a UI that cannot ask what mode
    // it is in must not offer a bypass button on the guess that it might be
    // allowed to.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await getServerMode()).toBe("deployment");
  });

  it("falls back to deployment when the field is missing or unrecognised", async () => {
    vi.stubGlobal("fetch", respondWith({ status: "ok" }));
    expect(await getServerMode()).toBe("deployment");

    vi.stubGlobal("fetch", respondWith({ status: "ok", mode: "dev" }));
    expect(await getServerMode()).toBe("deployment");
  });
});

describe("mintDevelopmentTicket", () => {
  it("banks the ticket it is given, so the guard can consume it normally", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ exam_ticket: "tkt-dev-1", expires_at: 1, minted_by: "development_bypass" })
    );

    expect(await mintDevelopmentTicket("cand-1")).toBe(true);
    expect(readExamTicket()).toBe("tkt-dev-1");
  });

  it("banks nothing when the route is not mounted", async () => {
    // Which is what a deployment looks like from here: the route 404s because
    // it does not exist, not because the request was wrong.
    vi.stubGlobal("fetch", respondWith({ detail: "Not Found" }, false));

    expect(await mintDevelopmentTicket("cand-1")).toBe(false);
    expect(readExamTicket()).toBeNull();
  });
});

describe("readCalibrationProvenance", () => {
  it("is null before anything has been through the gate", () => {
    expect(readCalibrationProvenance()).toBeNull();
  });
});
