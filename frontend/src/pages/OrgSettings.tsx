import { useCallback, useEffect, useState, type FormEvent } from "react";
import Header from "../components/Header";
import Avatar from "../components/Avatar";
import { TextField } from "../components/AuthShell";
import { ErrorState, LoadingState } from "../components/States";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";

type OrgProfile = {
  id: string;
  name: string;
  display_name: string;
  shown_name: string;
  website: string;
  description: string;
  contact_email: string;
};

type Member = {
  id: string;
  email: string;
  shown_name: string;
  pronouns: string;
  role: string;
  is_you: boolean;
};

/** What an org may assign. `staff` and `labeller` are ours, not a customer's —
 *  the server refuses them, and offering them here would be a control that
 *  fails. */
const ASSIGNABLE = ["candidate", "reviewer", "org_admin"] as const;

const ROLE_LABEL: Record<string, string> = {
  org_admin: "Admin",
  reviewer: "Reviewer",
  candidate: "Candidate",
  staff: "Staff",
};

/** `/org/settings` — organisation profile and roster. Org Admin only. */
export default function OrgSettings() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [roleError, setRoleError] = useState("");

  /** Change a member's role.
   *
   *  The server owns every rule here — assignable set, tenancy, and the
   *  last-administrator guard — so this reports what it says rather than
   *  duplicating the logic. A second copy of "you cannot demote the last
   *  admin" would be a second thing to keep in step. */
  const changeRole = async (userId: string, role: string) => {
    setRoleBusy(userId);
    setRoleError("");
    try {
      const res = await apiFetch(`/api/org/members/${encodeURIComponent(userId)}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.detail === "string" ? body.detail : `the server returned ${res.status}`);
      }
      load();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setRoleBusy(null);
    }
  };

  const [displayName, setDisplayName] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const load = useCallback(() => {
    setError("");
    Promise.all([
      apiFetch("/api/org/profile").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      apiFetch("/api/org/members").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ])
      .then(([p, m]) => {
        setProfile(p);
        setMembers(m.members);
        setDisplayName(p.display_name ?? "");
        setWebsite(p.website ?? "");
        setDescription(p.description ?? "");
        setContactEmail(p.contact_email ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "unknown error"));
  }, []);

  useEffect(load, [load]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setError("");
    try {
      const res = await apiFetch("/api/org/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName,
          website,
          description,
          contact_email: contactEmail,
        }),
      });
      if (!res.ok) throw new Error(`the server returned ${res.status}`);
      setProfile(await res.json());
      setStatus("saved");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "unknown error");
    }
  };

  const [copiedLink, setCopiedLink] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");

  const copyInvite = () => {
    if (!profile) return;
    const link = `${window.location.origin}/signup?org=${encodeURIComponent(profile.id)}&role=candidate`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const filteredMembers = (members ?? []).filter((m) => {
    if (!memberQuery.trim()) return true;
    const q = memberQuery.toLowerCase();
    return m.shown_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.role.toLowerCase().includes(q);
  });

  return (
    <div className="page">
      <Header active="org-settings" />
      <main id="content" tabIndex={-1} className="container" style={{ maxWidth: 740 }}>
        <div className="eyebrow">{user?.org_name ?? "Organisation"}</div>
        <h1 className="page-title">Organisation Settings & Team</h1>

        {error && (
          <ErrorState title="Settings could not be loaded." fix={`The server returned: ${error}.`} onRetry={load} />
        )}
        {!error && !profile && <LoadingState label="Loading settings…" />}

        {profile && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "24px 0 32px" }}>
              <Avatar id={profile.id} name={displayName || profile.name} size={52} />
              <div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{displayName || profile.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--faint)" }}>
                  Registered as <span style={{ fontFamily: "var(--mono)" }}>{profile.name}</span>
                </div>
              </div>
            </div>

            {/* Candidate Invitation Hub */}
            <section style={{ marginBottom: 36, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
              <div className="eyebrow" style={{ color: "var(--color-cognition-blue)" }}>Candidate Assessment Link</div>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: "6px 0 10px" }}>Invite Candidates to Verified Sessions</h2>
              <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55, margin: "0 0 14px" }}>
                Share this direct onboarding link with candidates. When they complete an assessment session, their verifiable proof stream will land directly in your review queue.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/signup?org=${encodeURIComponent(profile.id)}&role=candidate`}
                  style={{
                    flex: 1,
                    minWidth: 260,
                    padding: "8px 12px",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    color: "var(--text)",
                  }}
                />
                <button type="button" className="btn btn-primary small copy-btn" onClick={copyInvite}>
                  {copiedLink ? "✓ Link Copied" : "📋 Copy Assessment Link"}
                </button>
              </div>
            </section>

            <section style={{ marginBottom: 44 }}>
              <div className="eyebrow">Profile Details</div>
              <p className="page-sub" style={{ marginBottom: 20 }}>
                Candidates see this on the invitation, before they agree to anything. Someone deciding whether
                to hand over a recording of themselves working is entitled to know who is asking.
              </p>

              <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <TextField
                  label="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={120}
                  hint={`Shown to candidates. Your registered name, "${profile.name}", stays on issued credentials and cannot be changed here.`}
                />
                <TextField
                  label="Website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  maxLength={120}
                  placeholder="https://example.com"
                />
                <TextField
                  label="What you assess for"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={120}
                  hint="One line, shown on the invitation."
                />
                <TextField
                  label="Contact for candidates"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  maxLength={120}
                  hint="Where a candidate can reach a person at your organisation about their assessment."
                />

                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <button className="btn btn-primary" type="submit" disabled={status === "saving"}>
                    {status === "saving" ? "Saving…" : "Save changes"}
                  </button>
                  {status === "saved" && (
                    <span role="status" style={{ fontSize: 12.5, color: "var(--teal)" }}>
                      Saved.
                    </span>
                  )}
                </div>
              </form>
            </section>

            <section>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div className="eyebrow">Team Roster</div>
                  <p className="page-sub" style={{ margin: 0 }}>
                    Members attached to this organization. Manage roles and reviewer privileges.
                  </p>
                </div>
                <div className="search-input" style={{ width: 220 }}>
                  <span>🔍</span>
                  <input
                    type="text"
                    placeholder="Search members…"
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                  />
                </div>
              </div>

              {roleError && (
                <div role="alert" className="card" style={{ borderColor: "var(--red)", color: "var(--red)", fontSize: 13, marginBottom: 14 }}>
                  {roleError}
                </div>
              )}
              {!members && <LoadingState label="Loading people…" />}
              {members && (
                <div className="table" role="table" aria-label="Organisation members">
                  <div className="table-head" role="row" style={{ gridTemplateColumns: "1.4fr 1.4fr 0.8fr" }}>
                    <span role="columnheader">Name</span>
                    <span role="columnheader">Email</span>
                    <span role="columnheader">Role</span>
                  </div>
                  {filteredMembers.map((m) => {
                    const isBusy = roleBusy === m.id;
                    return (
                      <div key={m.id} className="table-row" role="row" style={{ gridTemplateColumns: "1.4fr 1.4fr 0.8fr" }}>
                        <span role="cell" style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <Avatar id={m.id} name={m.shown_name} size={24} />
                          <span style={{ fontWeight: 500 }}>
                            {m.shown_name}
                            {m.is_you && (
                              <span style={{ fontSize: 11, color: "var(--faint)", marginLeft: 6 }}>(you)</span>
                            )}
                          </span>
                        </span>
                        <span role="cell" style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>
                          {m.email}
                        </span>
                        <span role="cell">
                          <select
                            value={m.role}
                            disabled={isBusy}
                            onChange={(e) => changeRole(m.id, e.target.value)}
                            aria-label={`Role for ${m.shown_name}`}
                            style={{
                              padding: "4px 8px",
                              fontSize: 12,
                              borderRadius: 6,
                              border: "1px solid var(--border)",
                              background: "var(--surface)",
                              color: "var(--text)",
                              fontFamily: "var(--mono)",
                            }}
                          >
                            {ASSIGNABLE.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r] ?? r}
                              </option>
                            ))}
                          </select>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
