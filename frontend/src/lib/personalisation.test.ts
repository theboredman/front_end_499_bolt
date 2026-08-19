import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPreparedAssessment,
  readPreparedAssessment,
  reviewGraph,
  storePreparedAssessment,
  uploadCv,
  type Question,
} from "./personalisation";

// The personalisation client.
//
// CONSTRAINT running through this file: there is no request shape that approves
// a parser suggestion without saying the word "approve".
//
// A convenience-minded client would offer `saveGraph(graph)` and let the server
// diff it. That makes approval a side effect of a form round-trip — the client
// sends back what it was given, and whatever happens to be in its `approved`
// list becomes the approved list. An assessment is built only from approved
// claims, so that shape is one stale render away from asking somebody about a
// skill they never claimed. It is also what RQ5 measures, so making approval
// the default would set that measurement to 1.0 by construction.

const captured: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  captured.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, approved: { nodes: [], edges: [] }, metrics: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearPreparedAssessment();
});

function body(): Record<string, unknown> {
  return JSON.parse(String(captured[0].init?.body));
}

describe("reviewGraph", () => {
  it("names the action on every call", async () => {
    await reviewGraph("cand-1", { action: "approve", node_ids: ["skill-1"] });
    expect(body().action).toBe("approve");
    expect(body().node_ids).toEqual(["skill-1"]);
  });

  it("sends a correction as an edit rather than a replacement", async () => {
    // CONSTRAINT: RQ5 counts "extracted skills edited". The server keeps what
    // the parser originally said, and it can only do that if the client sends
    // the edit as an edit instead of just posting the new label.
    await reviewGraph("cand-1", {
      action: "approve",
      node_ids: ["skill-1"],
      edited: { "skill-1": "PostgreSQL 15" },
    });
    expect(body().edited).toEqual({ "skill-1": "PostgreSQL 15" });
  });

  it("sends a participant's own addition as add_claim, not as an approval", async () => {
    // A skill the parser missed is not evidence about the parser. Sending it as
    // an approval would credit the parser with a node it never produced and
    // inflate RQ5's recall with the participant's own corrections.
    await reviewGraph("cand-1", { action: "add_claim", node_type: "Skill", label: "Elixir" });
    expect(body().action).toBe("add_claim");
    expect(body().node_ids).toBeUndefined();
  });

  it("never sends an actor — the server takes it from the token", async () => {
    // An approval is a claim that a specific person confirmed something. A
    // client that could name its own actor could manufacture one.
    await reviewGraph("cand-1", { action: "approve", node_ids: ["skill-1"] });
    expect(Object.keys(body())).not.toContain("actor");
  });
});

describe("uploadCv", () => {
  it("posts the file as multipart and nothing else", async () => {
    // The CV is personal data. It goes to one endpoint, as a file, and nothing
    // in this client reads its contents or copies them anywhere.
    const file = new File(["Skills\nPython\n"], "cv.txt", { type: "text/plain" });
    await uploadCv("cand-1", file);
    expect(captured[0].url).toContain("/candidates/cand-1/cv");
    expect(captured[0].init?.body).toBeInstanceOf(FormData);
    expect([...(captured[0].init?.body as FormData).keys()]).toEqual(["cv"]);
  });

  it("encodes the candidate id rather than interpolating it raw", async () => {
    const file = new File(["x"], "cv.txt");
    await uploadCv("a/b", file);
    expect(captured[0].url).toContain("a%2Fb");
  });
});

describe("the prepared assessment", () => {
  const question = {
    question_id: "q1",
    family_key: "system-under-constraint@v1",
    tier: "T2",
    question_type: "open_design",
    duration_minutes: 45,
    tool_policy: "unrestricted",
    prompt: "Pick a system…",
    deliverables: [],
    rubric: { dimensions: [], tier: "T2", scored_blind: true, note: "" },
    generator_id: "template-v1",
    generator_kind: "template",
  } as Question;

  it("round-trips through sessionStorage", () => {
    storePreparedAssessment({ sessionId: "1785006990207", question });
    expect(readPreparedAssessment()?.sessionId).toBe("1785006990207");
    expect(readPreparedAssessment()?.question.family_key).toBe("system-under-constraint@v1");
  });

  it("returns null when nothing was prepared", () => {
    // /exam falls back to its default problem in this case and says so. It must
    // not throw, and it must not be handed a half-built object.
    expect(readPreparedAssessment()).toBeNull();
  });

  it("survives a corrupt entry rather than throwing into the exam page", () => {
    sessionStorage.setItem("pp_prepared_assessment", "{not json");
    expect(readPreparedAssessment()).toBeNull();
  });
});
