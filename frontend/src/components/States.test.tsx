import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AwaitingValidationState, BelowGateState, ProcessProfileView } from "./States";
import type { BelowGate, ProfileSection } from "../lib/sessions";

// Frontend Spec §7.2 / §11.
//
// CONSTRAINT: the profile area must NEVER render as an empty region. An empty
// dashboard tells a pilot organisation the product is broken; a state naming
// what is withheld and why tells them the gate is working. The gate is a
// credibility feature and has to be visible as one.
//
// Today every session lands in one of two non-empty states — awaiting
// validation, or validated with everything below the gate — so these are the
// two that actually ship.

const WITHHELD: BelowGate[] = [
  {
    feature: "analysis.phase_detection",
    status: "synthetic",
    blocked_on: "real labelled sessions",
    section: "phase_composition",
    title: "Phase composition",
    reason: "analysis.phase_detection is `synthetic`, below the release gate `pilot`.",
  },
  {
    feature: "analysis.process_graph",
    status: "synthetic",
    blocked_on: "labels",
    section: "process_structure",
    title: "Process structure",
    reason: "analysis.process_graph is `synthetic`, below the release gate `pilot`.",
  },
];

describe("BelowGateState", () => {
  it("names every withheld analysis, its status and its blocker", () => {
    render(<BelowGateState withheld={WITHHELD} releaseGate="pilot" />);

    expect(screen.getByText("Phase composition")).toBeTruthy();
    expect(screen.getByText("analysis.phase_detection")).toBeTruthy();
    expect(screen.getByText("real labelled sessions")).toBeTruthy();
    expect(screen.getAllByText("synthetic").length).toBe(2);
  });

  it("names the release gate itself", () => {
    // The reader has to be able to tell WHICH bar these features are under,
    // not just that they are under one.
    const { container } = render(<BelowGateState withheld={WITHHELD} releaseGate="pilot" />);
    expect(container.textContent).toContain("pilot");
    expect(container.textContent).toContain("Nothing below it reaches a validating organisation");
  });

  it("says these analyses are not in any credential", () => {
    // The consequential half. A validator needs to know the withheld analyses
    // are absent from the credential too, not merely hidden from this screen.
    const { container } = render(<BelowGateState withheld={WITHHELD} releaseGate="pilot" />);
    expect(container.textContent).toContain("not in any credential");
  });

  it("renders nothing when nothing is withheld", () => {
    // The only case where an empty region is correct: there is nothing to
    // explain, because everything cleared.
    const { container } = render(<BelowGateState withheld={[]} releaseGate="pilot" />);
    expect(container.firstChild).toBeNull();
  });

  it("survives a response without the additive fields", () => {
    // `section`, `title` and `reason` were added after this component shipped.
    // An older or partial response must still render rather than throwing.
    render(
      <BelowGateState
        withheld={[{ feature: "analysis.fusion", status: "spec", blocked_on: null }]}
        releaseGate="pilot"
      />
    );
    expect(screen.getByText("analysis.fusion")).toBeTruthy();
  });
});

describe("AwaitingValidationState", () => {
  it("distinguishes not-submitted from with-a-reviewer", () => {
    // CONSTRAINT: two absences that would otherwise look identical, with
    // different remedies — one waits on the participant, one on a reviewer.
    const { container: notSubmitted } = render(
      <AwaitingValidationState state={null} reason={null} />
    );
    expect(notSubmitted.textContent).toContain("Not submitted for validation");

    const { container: inReview } = render(
      <AwaitingValidationState state="organization_review" reason={null} />
    );
    expect(inReview.textContent).toContain("With a reviewer now");
  });

  it("prefers the server's reason over its own fallback", () => {
    // The reason names the actual lifecycle state. A local string would drift
    // from it the first time a state was added.
    const { container } = render(
      <AwaitingValidationState state="participant_submitted" reason="session X is 'participant_submitted'." />
    );
    expect(container.textContent).toContain("session X is 'participant_submitted'.");
  });

  it("is never empty even with nothing to report", () => {
    const { container } = render(<AwaitingValidationState state={null} reason={null} />);
    expect(container.textContent?.length ?? 0).toBeGreaterThan(60);
  });
});

describe("ProcessProfileView", () => {
  const section: ProfileSection = {
    section: "verification_and_recovery",
    title: "Verification and recovery",
    feature: "analysis.verification_latency",
    status: "pilot",
    claim: "Time from accepting AI output to checking it.",
    evidence: ["session_manifest.json", "events.jsonl"],
    data: { verification_latency_s: 8.0, verified_accepts: 1 },
  };

  it("renders every metric with its registry status beside it", () => {
    // CONSTRAINT: a number without its status looks exactly as authoritative
    // as a validated one. A phase boundary from a model trained on 45 sessions
    // renders like a keyframe count unless the status travels with it.
    render(<ProcessProfileView sections={[section]} />);
    expect(screen.getByText("Verification and recovery")).toBeTruthy();
    expect(screen.getByText("pilot")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("shows the evidence references behind the section", () => {
    const { container } = render(<ProcessProfileView sections={[section]} />);
    expect(container.textContent).toContain("session_manifest.json");
  });

  it("shows the registry's claim, not prose of its own", () => {
    const { container } = render(<ProcessProfileView sections={[section]} />);
    expect(container.textContent).toContain(section.claim);
  });

  it("renders nothing when there are no released sections", () => {
    // Correct here: the caller pairs this with AwaitingValidationState or
    // BelowGateState, and one of those always renders. Two components both
    // explaining an absence would say the same thing twice.
    const { container } = render(<ProcessProfileView sections={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
