import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Header from "../components/Header";
import Avatar from "../components/Avatar";
import { TextField } from "../components/AuthShell";
import { ErrorState, LoadingState } from "../components/States";
import ProfileGraphPanel, { NODE_TYPE_ORDER } from "../components/ProfileGraphPanel";
import { apiFetch } from "../lib/api";
import BiometricEnrolment from "../components/BiometricEnrolment";
import { IDENTITY_THRESHOLDS } from "../lib/identityConfig";
import { clearReference, loadReference, reconcile, type EnrolmentReality } from "../lib/identityStore";
import { useAuth } from "../lib/auth";
import { getCandidateId } from "../lib/calibration";
import {
  fetchProfileGraph,
  reviewGraph,
  uploadCv,
  type ApprovedNode,
  type ExtractedNode,
  type NodeType,
  type ProfileGraph,
} from "../lib/personalisation";

/** `/account` — your own profile: who you are, and what you've told us you can do.
 *
 *  Two things live on one page on purpose. This page used to be identity
 *  settings only (display name, pronouns, biometric enrolment) while a
 *  separate `/profile` route held the CV-derived skill graph — two pages both
 *  answering "who am I to this system", under two different names, linked from
 *  two different places. Merged 2026-08-19: one page, one identity, one avatar
 *  link in the header.
 *
 *  Everything in the identity section is optional. An account works perfectly
 *  well with none of it filled in, and the page says so rather than presenting
 *  empty fields as an incomplete task with a progress bar attached.
 *
 *  The skill section carries its own, stricter rule — see `SkillsSection`
 *  below — because unlike a display name, what lands there can end up
 *  assessed. Suggestions and confirmed claims are rendered as two different
 *  things, and nothing crosses between them except a click that says
 *  "approve".
 */
export default function Account() {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [timezone, setTimezone] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  /** What is true on THIS device, which the server cannot know. */
  const [reality, setReality] = useState<EnrolmentReality | null>(null);

  // The server knows whether consent was given; only this browser knows whether
  // a usable reference exists. Rendering the server's answer alone is what let
  // the panel say "Enrolled" when nothing had been captured.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void loadReference(user.id).then((local) => {
      if (!cancelled) {
        setReality(reconcile(user.biometric.enrolment, local, IDENTITY_THRESHOLDS.modelUrl));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  /** Record consent server-side. For "enrolled" this is called ONLY by
   *  BiometricEnrolment, after a reference has been stored locally — the
   *  server's record must never claim an enrolment that has no reference
   *  behind it. */
  const decideBiometric = async (decision: "enrolled" | "declined") => {
    setBiometricBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/auth/me/biometric", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail?.message ?? `the server returned ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setBiometricBusy(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name ?? "");
    setPronouns(user.pronouns ?? "");
    setTimezone(user.timezone ?? "");
  }, [user]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setError("");
    try {
      const res = await apiFetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName, pronouns, timezone }),
      });
      if (!res.ok) throw new Error(`the server returned ${res.status}`);
      await refresh();
      setStatus("saved");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "unknown error");
    }
  };

  if (!user) return null;

  return (
    <div className="page">
      <Header active="account" />
      {/* 720 rather than the identity section's old 560: the skill graph below
          needs room for a row of chips and an inline correction field, and a
          narrower column would wrap them onto their own lines constantly. */}
      <main id="content" tabIndex={-1} className="container" style={{ maxWidth: 720 }}>
        <div className="eyebrow">Your account</div>
        <h1 className="page-title">Profile</h1>
        <p className="page-sub">
          Who you are, and — if you've uploaded a CV — what you've told us you can do. The identity fields
          below are all optional; the skills further down are used to build your assessments.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "28px 0 8px" }}>
          <Avatar id={user.id} name={displayName || user.shown_name} size={56} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{displayName || user.shown_name}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--faint)" }}>{user.email}</div>
          </div>
        </div>

        {/* Says what it is and why it isn't a photo, once, where the question
            would otherwise occur to someone. */}
        <p style={{ fontSize: 11.5, color: "var(--faint)", lineHeight: 1.55, margin: "0 0 28px" }}>
          Your initials, not a photo. This product matches faces against a capture taken live during a session,
          and an uploaded picture could belong to anyone — so there is nowhere here to upload one.
        </p>

        {error && (
          <ErrorState
            title="That didn't save."
            fix={`The server returned: ${error}. Your changes are still on screen — try again.`}
          />
        )}

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <TextField
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
            hint="What you'd like to be called. Leave it blank and we'll use the first part of your email."
          />

          <TextField
            label="Pronouns"
            value={pronouns}
            onChange={(e) => setPronouns(e.target.value)}
            maxLength={120}
            placeholder="they/them"
            // The honest reason for the field, stated plainly: the alternative
            // to asking is guessing from a name, which is how systems
            // misgender people.
            hint="Used when a report or a reviewer refers to you. Left blank, we use they/them rather than guess."
          />

          <TextField
            label="Time zone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            maxLength={120}
            placeholder="Europe/London"
            hint="Session times are shown in this zone."
          />

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button className="btn btn-primary" type="submit" disabled={status === "saving"}>
              {status === "saving" ? "Saving…" : "Save profile"}
            </button>
            {/* Announced, so the confirmation is not purely visual. */}
            {status === "saved" && (
              <span role="status" style={{ fontSize: 12.5, color: "var(--teal)" }}>
                Saved.
              </span>
            )}
          </div>
        </form>

        {/* Identity matching (Identity Spec §4.5).
            Four states, and three of them used to render identically as
            "Enrolled". The reference is device-local, so "consented" and
            "usable here" are different facts and the panel says which. */}
        <section style={{ marginTop: 40 }}>
          <div className="eyebrow">Identity matching</div>
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span
                className="dot"
                style={{
                  color:
                    reality?.state === "ready"
                      ? "var(--color-mint-ink)"
                      : reality?.state === "declined"
                        ? "var(--color-slate)"
                        : reality?.state === "reference_missing" || reality?.state === "model_changed"
                          ? "var(--color-coral-ink)"
                          : "var(--faint)",
                  width: 8,
                  height: 8,
                }}
              />
              {/* Colour is never the only carrier — the words say it too. */}
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>
                {reality === null
                  ? "Checking this device…"
                  : reality.state === "ready"
                    ? "Enrolled on this device"
                    : reality.state === "reference_missing"
                      ? "Enrolled, but not on this device"
                      : reality.state === "model_changed"
                        ? "Enrolled, but the reference is out of date"
                        : reality.state === "declined"
                          ? "You declined"
                          : "Not enrolled"}
              </span>
            </div>

            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.65, margin: "0 0 14px" }}>
              Face matching compares you against a reference captured live at enrolment, so a session can
              show the same person stayed at the keyboard throughout. The comparison runs in your browser —
              only a score reaches us, never a face template.
            </p>

            {/* The state that used to be invisible. It is the ordinary
                consequence of keeping the reference on the device, and the
                remedy is one capture. */}
            {reality?.state === "reference_missing" && (
              <div className="card tint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
                You agreed to identity matching, but the reference lives in the browser you enrolled on and
                is not in this one. Nothing is wrong — enrol again here and matching will work on this
                device too.
              </div>
            )}
            {reality?.state === "model_changed" && (
              <div className="card tint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
                The matching model has changed since you enrolled, so the stored reference can no longer be
                compared against it. Enrol again to replace it.
              </div>
            )}

            {!user.biometric.available && (
              <div className="card tint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
                <strong>Not switched on.</strong> Identity matching is not running on this deployment.
              </div>
            )}

            {user.biometric.enforcement === "shadow" && (
              <div className="card tint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
                <strong>Recording only, not deciding.</strong> The check runs and its result is stored with
                your session, but it cannot stop you starting a session or raise a flag about you. That is
                deliberate: face-matching error rates differ measurably between demographic groups, ours have
                not been measured per group yet, and the recorded results are how that measurement gets made.
                Nothing here is used to judge you in the meantime.
              </div>
            )}

            {user.biometric.enforcement === "enforced" && (
              <div className="card tint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
                <strong>Active.</strong> A poor match at the start of a session will ask you to run the check
                again. During a session it can raise a flag for a person to review — never an automatic
                failure, and you will be told if one is raised.
              </div>
            )}

            {enrolling ? (
              <BiometricEnrolment
                userId={user.id}
                onCancel={() => setEnrolling(false)}
                onEnrolled={async () => {
                  // Consent is recorded only now, with a reference behind it.
                  await decideBiometric("enrolled");
                  const local = await loadReference(user.id);
                  setReality(reconcile("enrolled", local, IDENTITY_THRESHOLDS.modelUrl));
                  setEnrolling(false);
                }}
              />
            ) : (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {user.biometric.available && reality?.state !== "ready" && (
                  <button className="btn btn-primary small" onClick={() => setEnrolling(true)}>
                    {reality?.state === "reference_missing" || reality?.state === "model_changed"
                      ? "Enrol on this device"
                      : "Enrol"}
                  </button>
                )}
                {reality?.state === "ready" && (
                  <button
                    className="btn btn-ghost small"
                    onClick={async () => {
                      await clearReference(user.id);
                      await decideBiometric("declined");
                      setReality({ state: "declined" });
                    }}
                    disabled={biometricBusy}
                  >
                    Remove my reference
                  </button>
                )}
                {reality?.state !== "declined" && reality?.state !== "ready" && (
                  <button
                    className="btn btn-ghost small"
                    onClick={() => decideBiometric("declined")}
                    disabled={biometricBusy}
                  >
                    Record that I decline
                  </button>
                )}
              </div>
            )}

            {reality?.state === "ready" && (
              <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "12px 0 0", lineHeight: 1.5 }}>
                Reference agreement {reality.coherence.toFixed(2)}. Removing it deletes the reference from
                this browser and records that you decline.
              </p>
            )}
          </div>
        </section>

        <div className="card" style={{ marginTop: 36, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
          <div className="mono-label" style={{ marginBottom: 8 }}>Who sees this</div>
          Your name and pronouns are visible to reviewers at an organisation you have accepted an invitation
          from, for the sessions you completed for them. They are never shown to the researchers who label
          session recordings — that surface sees a participant code instead.
        </div>

        <SkillsSection />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skills — CV upload and the review of what was extracted from it
// ---------------------------------------------------------------------------
//
// The one design rule here
// ------------------------
// Suggestions and confirmed claims are rendered as two different things, in
// two different places, and nothing crosses between them except by a click
// that says "approve". No checkbox is pre-ticked, no "approve all" exists, and
// closing the page approves nothing.
//
// That is not caution for its own sake. An assessment is built only from the
// approved set, so a suggestion that drifted into it would put somebody in
// front of a question about a skill they never claimed — while looking
// exactly like a personalised question, because it IS derived from their CV.
// And the gap between the two sets is the thing RQ5 measures, so a UI that
// made approval the default would set that measurement to 1.0 by construction
// and report it as a result.
//
// Type rule (CLAUDE.md): mono for what the system MEASURED — confidence
// numbers, section names, counts. Sans for what a person WROTE — the skill
// labels themselves, which came out of the candidate's own document.

function SkillsSection() {
  const candidateId = getCandidateId();
  const [graph, setGraph] = useState<ProfileGraph | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setError("");
    fetchProfileGraph(candidateId)
      .then((g) => setGraph(g))
      .catch((e) => setError(e instanceof Error ? e.message : "unknown error"));
  }, [candidateId]);

  useEffect(load, [load]);

  const onUpload = async (file: File) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await uploadCv(candidateId, file);
      const kept = result.reconciliation.now_unsupported.length;
      setNotice(
        result.extracted_nodes === 0
          ? "Nothing could be read out of that file. If it is a scanned PDF it is an image, not text — a Word or plain-text version will extract far better."
          : `Read ${result.extracted_nodes} suggestion${result.extracted_nodes === 1 ? "" : "s"}. None of them is on your profile until you approve it.` +
              (kept ? ` ${kept} claim${kept === 1 ? "" : "s"} you had already approved are no longer in the document; they are kept, and only you can remove them.` : "")
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const act = async (body: Parameters<typeof reviewGraph>[1]) => {
    setBusy(true);
    setError("");
    try {
      await reviewGraph(candidateId, body);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save that");
    } finally {
      setBusy(false);
    }
  };

  const approvedIds = new Set((graph?.approved.nodes ?? []).map((n) => n.id));
  const pending = (graph?.extracted.nodes ?? []).filter((n) => !approvedIds.has(n.id));

  return (
    <section style={{ marginTop: 48 }}>
      <div className="eyebrow">Skills</div>
      <h2 style={{ fontSize: 21, margin: "0 0 6px" }}>Your skill profile</h2>
      <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>
        Upload a CV and we read skills out of it. Everything we read is a <strong>suggestion</strong>{" "}
        until you say otherwise — your assessment is built only from the claims you approve, so anything
        you leave alone is simply not used.
      </p>

      <UploadCard busy={busy} fileRef={fileRef} onUpload={onUpload} hasGraph={!!graph} />

      {notice && (
        <div className="card tint" style={{ marginBottom: 20 }} role="status">
          <p style={{ margin: 0, fontSize: 14 }}>{notice}</p>
        </div>
      )}

      {error && <ErrorState title="Could not load your skills" fix={error} onRetry={load} />}

      {graph === undefined && <LoadingState label="Loading your skills…" />}

      {graph === null && !error && (
        <div className="card" style={{ marginTop: 8 }}>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
            No CV uploaded yet. Nothing about your skills is stored here until you upload one.
          </p>
        </div>
      )}

      {graph && (
        <>
          {/* The graph first — an overview of the whole thing, personalised
              to this candidate's own CV, before the item-by-item review below
              asks for a decision on each node individually. */}
          <ProfileGraphPanel graph={graph} />

          {graph.extraction && <ExtractionSummary report={graph.extraction} metrics={graph.metrics} />}

          <div style={{ marginTop: 28 }}>
            <h3 style={{ fontSize: 17, margin: "0 0 4px" }}>Suggestions to review</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--muted)" }}>
              Read out of your document by a pattern matcher, not a person and not an AI. It misses
              things and it gets things wrong — correcting it here is the point of this section.
            </p>
            {pending.length === 0 ? (
              <div className="card">
                <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>Nothing left to review.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {sortNodes(pending).map((node) => (
                  <SuggestionRow
                    key={node.id}
                    node={node}
                    busy={busy}
                    edited={editing[node.id]}
                    onEdit={(value) => setEditing((e) => ({ ...e, [node.id]: value }))}
                    onApprove={() =>
                      act({
                        action: "approve",
                        node_ids: [node.id],
                        ...(editing[node.id] && editing[node.id] !== node.label
                          ? { edited: { [node.id]: editing[node.id] } }
                          : {}),
                      })
                    }
                    onReject={() => act({ action: "reject", node_ids: [node.id] })}
                  />
                ))}
              </div>
            )}
          </div>

          <ApprovedSection
            nodes={graph.approved.nodes}
            busy={busy}
            onRemove={(id) => act({ action: "reject", node_ids: [id] })}
            onAdd={(type, label) => act({ action: "add_claim", node_type: type, label })}
          />

          {graph.approved.nodes.some((n) => n.type === "Skill") && (
            <div style={{ marginTop: 28 }}>
              <Link to="/assessment" className="btn btn-primary">
                Set up an assessment →
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function sortNodes<T extends { type: NodeType; confidence: number; label: string }>(nodes: T[]): T[] {
  return [...nodes].sort(
    (a, b) =>
      NODE_TYPE_ORDER.indexOf(a.type) - NODE_TYPE_ORDER.indexOf(b.type) ||
      b.confidence - a.confidence ||
      a.label.localeCompare(b.label)
  );
}

function UploadCard({
  busy,
  fileRef,
  onUpload,
  hasGraph,
}: {
  busy: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (file: File) => void;
  hasGraph: boolean;
}) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ maxWidth: "58ch" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            {hasGraph ? "Upload a newer CV" : "Upload your CV"}
          </div>
          {/* Consent copy is a factual claim about data handling (invariant 11).
              Every sentence below describes what the code actually does. */}
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
            PDF, Word or plain text, up to 4 MB. The file is stored so you can see what a
            suggestion was read out of, and it is never sent to a question generator — only
            the short skill labels you approve are. Re-uploading replaces the suggestions and
            keeps every approval you have already made.
          </p>
        </div>
        <div>
          <label className="btn btn-dark" style={{ cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Working…" : "Choose file"}
            <input
              ref={fileRef as React.RefObject<HTMLInputElement>}
              type="file"
              accept=".pdf,.docx,.txt"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
              }}
              style={{ display: "none" }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function ExtractionSummary({
  report,
  metrics,
}: {
  report: NonNullable<ProfileGraph["extraction"]>;
  metrics: ProfileGraph["metrics"];
}) {
  return (
    <div className="card tint" style={{ marginTop: 20 }}>
      <div className="mono-label" style={{ marginBottom: 10 }}>
        What the parser did
      </div>
      <div className="metric-grid">
        <Metric label="suggestions" value={metrics.extracted_total} />
        <Metric label="approved" value={metrics.approved_from_extraction} />
        <Metric label="corrected" value={metrics.edited} />
        <Metric label="you added" value={metrics.participant_added} />
      </div>
      <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
        Sections found:{" "}
        <span style={{ fontFamily: "var(--mono)" }}>
          {report.sections_found.length ? report.sections_found.join(" · ") : "none"}
        </span>
      </p>
      {report.warnings.map((warning) => (
        <p key={warning} style={{ margin: "8px 0 0", fontSize: 13, color: "var(--color-coral-ink)" }}>
          {warning}
        </p>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function SuggestionRow({
  node,
  busy,
  edited,
  onEdit,
  onApprove,
  onReject,
}: {
  node: ExtractedNode;
  busy: boolean;
  edited: string | undefined;
  onEdit: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const value = edited ?? node.label;
  return (
    <div className="card" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <span
        className="mono-label"
        style={{ minWidth: 96, color: "var(--faint)" }}
        aria-label={`type ${node.type}`}
      >
        {node.type}
      </span>

      <label style={{ flex: "1 1 220px" }}>
        <span className="sr-only">Label for this suggestion</span>
        <input
          className="search-input"
          style={{ width: "100%" }}
          value={value}
          disabled={busy}
          onChange={(e) => onEdit(e.target.value)}
        />
      </label>

      {/* Mono, because both of these are things the system measured about its
          own reading — not things a person wrote. And labelled `prior`, not
          `confidence`, because it is a stated constant per extraction route
          and calling it a confidence would imply a fitted probability. */}
      <span
        style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}
        title="A stated prior for this kind of extraction, not a measured probability."
      >
        {node.provenance} · prior {node.confidence.toFixed(2)}
        {/* Present only when the dictionary missed this phrase and the ESCO
            taxonomy matched it instead — a DIFFERENT, measured number (cosine
            similarity against a taxonomy concept), never merged with the
            prior above into one figure. */}
        {node.esco_similarity !== undefined && (
          <span title="Matched against the ESCO skills taxonomy, run locally — nothing about this CV was sent anywhere to produce this number.">
            {" "}
            · ESCO {node.esco_similarity.toFixed(2)}
          </span>
        )}
      </span>

      {/* Present only when the optional, off-by-default NIM cleanup tier
          corrected this phrase. Shown as its own line, sans (the corrected
          text is still something a person wrote, an LLM just fixed the
          spelling of it) with the original alongside — a correction you
          cannot see the source of is not one you can judge, and this is the
          one field in the whole pipeline that involved a third party. */}
      {node.cleanup_original && (
        <span
          style={{
            display: "block",
            width: "100%",
            fontSize: 11.5,
            color: "var(--muted)",
            marginTop: -4,
          }}
          title="Corrected by an LLM (NVIDIA NIM) from a spelling/formatting check the dictionary and ESCO both missed. Only this short phrase was sent — never your CV, your name, or anything else about you. Every correction is checked against the original before being shown; if it looked like a different skill rather than a typo fix, it would have been left alone."
        >
          spelling-corrected from “{node.cleanup_original}”
        </span>
      )}

      <span style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={onApprove}>
          Approve
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={onReject}>
          Not mine
        </button>
      </span>
    </div>
  );
}

function ApprovedSection({
  nodes,
  busy,
  onRemove,
  onAdd,
}: {
  nodes: ApprovedNode[];
  busy: boolean;
  onRemove: (id: string) => void;
  onAdd: (type: NodeType, label: string) => void;
}) {
  const [type, setType] = useState<NodeType>("Skill");
  const [label, setLabel] = useState("");

  return (
    <section style={{ marginTop: 32 }}>
      <h3 style={{ fontSize: 17, margin: "0 0 4px" }}>Your approved skills</h3>
      <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--muted)" }}>
        Claims you have confirmed. Only these are used to build an assessment.
      </p>

      {nodes.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
            Nothing approved yet. Approve a suggestion above, or add something the parser
            missed.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {sortNodes(nodes).map((node) => (
            <span
              key={node.id}
              className="card"
              style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 12px" }}
            >
              <span className="mono-label" style={{ color: "var(--faint)" }}>
                {node.type}
              </span>
              <span style={{ fontSize: 14 }}>{node.label}</span>
              {/* Shape, not colour alone — CLAUDE.md's accessibility rule. The
                  bracketed word carries the meaning on its own. */}
              {node.origin === "participant" && (
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>
                  [you added]
                </span>
              )}
              {node.extracted_label && (
                <span
                  style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}
                  title={`The parser read this as "${node.extracted_label}"`}
                >
                  [corrected]
                </span>
              )}
              <button
                className="btn btn-ghost"
                style={{ padding: "2px 10px", fontSize: 12 }}
                disabled={busy}
                onClick={() => onRemove(node.id)}
                aria-label={`Remove ${node.label} from your profile`}
              >
                Remove
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          onAdd(type, label.trim());
          setLabel("");
        }}
      >
        <label>
          <span className="sr-only">Type of claim to add</span>
          <select
            className="search-input"
            value={type}
            onChange={(e) => setType(e.target.value as NodeType)}
            disabled={busy}
          >
            {NODE_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: "1 1 240px" }}>
          <span className="sr-only">Something the parser missed</span>
          <input
            className="search-input"
            style={{ width: "100%" }}
            placeholder="Something we missed…"
            value={label}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button className="btn btn-dark" type="submit" disabled={busy || !label.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}
