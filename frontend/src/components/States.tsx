// Standardised empty / error / loading / below-gate states (Frontend Spec §11).
//
// Previously ad hoc, per page. The rules they encode:
//
//   Empty screens are invitations to act, not shrugs. Every one carries the
//   action that would fill it.
//
//   Errors name what happened and what to do about it. No apologies, no
//   "something went wrong", no vagueness that leaves the reader unable to act.
//
//   Below-gate is NOT empty. An empty dashboard tells a pilot organisation the
//   product is broken; naming the analyses that are not yet released, and why,
//   tells them the gate is working. It is a credibility feature and should
//   read as one.

import { Fragment, type ReactNode } from "react";
import type { BelowGate, ProfileSection } from "../lib/sessions";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="card" role="status" aria-live="polite">
      <div className="mono-label">{label}</div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  fix,
  onRetry,
}: {
  title: string;
  /** What the reader can do. Required — an error the reader cannot act on is
   *  a status message pretending to be an error. */
  fix: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card" role="alert" style={{ borderColor: "var(--red)" }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "var(--red)" }}>{title}</div>
      <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>{fix}</p>
      {onRetry && (
        <button className="btn btn-ghost small" style={{ marginTop: 14 }} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Analyses withheld by the release gate, named rather than hidden.
 *
 *  The reason comes from the registry via the API, not from a string here, so
 *  it cannot drift from the actual feature status. */
export function BelowGateState({ withheld, releaseGate }: { withheld: BelowGate[]; releaseGate: string }) {
  if (withheld.length === 0) return null;
  return (
    <div className="card tint" style={{ marginBottom: 24 }}>
      <div className="mono-label" style={{ marginBottom: 10 }}>Not yet released</div>
      <p style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.65, margin: "0 0 14px" }}>
        {withheld.length} {withheld.length === 1 ? "part" : "parts"} of this profile are withheld because the
        analysis behind them has not met the evidence standard required to reach a validating organisation.
        They are computed and inspectable internally; they are not shown here, and they are not in any
        credential.
      </p>
      <div className="table" role="table" aria-label="Withheld analyses">
        <div className="table-head" role="row" style={{ gridTemplateColumns: "1.1fr 1.3fr .6fr 1.6fr" }}>
          <span role="columnheader">Section</span>
          <span role="columnheader">Analysis</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Blocked on</span>
        </div>
        {withheld.map((w) => (
          <div key={w.feature} className="table-row" role="row" style={{ gridTemplateColumns: "1.1fr 1.3fr .6fr 1.6fr" }}>
            {/* Sans for the section heading — a human wrote it. Mono for the
                feature id and the status, which the system assigned. */}
            <span role="cell" style={{ fontSize: 12.5 }}>{w.title ?? "—"}</span>
            <span role="cell" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{w.feature}</span>
            <span role="cell" style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--amber)" }}>{w.status}</span>
            <span role="cell" style={{ fontSize: 12.5, color: "var(--muted)" }}>{w.blocked_on ?? "—"}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--faint)", lineHeight: 1.55, margin: "14px 0 0" }}>
        Release gate: <span style={{ fontFamily: "var(--mono)" }}>{releaseGate}</span>. Nothing below it reaches
        a validating organisation.
      </p>
    </div>
  );
}

/** Why there is no profile yet, when the reason is the lifecycle rather than
 *  the gate.
 *
 *  Two different absences that would otherwise look identical. `BelowGateState`
 *  says "this record was validated and the analyses behind it are not
 *  released". This says "the record has not been validated" — the normal state
 *  of most sessions, and not a fault in anything.
 *
 *  Kept apart because the remedies differ: one waits on a measurement, the
 *  other waits on a person. */
export function AwaitingValidationState({
  state,
  reason,
}: {
  state: string | null;
  reason: string | null;
}) {
  const heading: Record<string, string> = {
    participant_submitted: "Submitted, waiting for a reviewer",
    organization_review: "With a reviewer now",
  };
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="mono-label" style={{ marginBottom: 10 }}>No profile yet</div>
      <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>
        {(state && heading[state]) ?? "Not submitted for validation"}
      </p>
      <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.65, margin: 0 }}>
        {reason ??
          "A profile is assembled only after an organisation has validated this record. Until then every number in it would be described as validated by nobody."}
      </p>
    </div>
  );
}

/** The released parts of the profile. Each carries its registry status.
 *
 *  There is no code path here that renders a number without one. That is the
 *  whole point of the component: a phase boundary from a model trained on 45
 *  sessions renders exactly like a keyframe count once it reaches a dashboard,
 *  so the status lives next to the number rather than in a footnote. */
export function ProcessProfileView({ sections }: { sections: ProfileSection[] }) {
  if (sections.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>
      {sections.map((s) => (
        <section key={s.section} className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "baseline",
            }}
          >
            <h3 style={{ fontSize: 16, margin: "0 0 6px" }}>{s.title}</h3>
            <span
              className="mono-label"
              style={{ color: s.status === "validated" ? "var(--green)" : "var(--amber)" }}
              title={`Registry status: ${s.status}`}
            >
              {s.status}
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 12px" }}>{s.claim}</p>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "6px 16px",
              margin: 0,
              fontSize: 13,
            }}
          >
            {Object.entries(s.data).map(([key, value]) => (
              <Fragment key={key}>
                <dt style={{ color: "var(--muted)" }}>{key.replace(/_/g, " ")}</dt>
                {/* Mono for the value: everything in a profile section is
                    something the system measured. */}
                <dd style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 12.5, whiteSpace: "pre-wrap" }}>
                  {typeof value === "object" ? JSON.stringify(value) : String(value)}
                </dd>
              </Fragment>
            ))}
          </dl>
          {s.evidence.length > 0 && (
            <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "12px 0 0", fontFamily: "var(--mono)" }}>
              evidence: {s.evidence.join(" · ")}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
