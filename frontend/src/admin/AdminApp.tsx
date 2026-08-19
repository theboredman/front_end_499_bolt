import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getApiBase } from "../lib/api";

// Internal admin — a SEPARATE BUNDLE behind SEPARATE AUTHENTICATION.
//
// Not a role branch inside the customer app, and the reason is not tidiness.
// If these surfaces ship in the same JavaScript bundle as the candidate and
// org portals, their route definitions and API calls are readable by any
// customer who opens devtools — the shape of the platform's internal tooling,
// its endpoints, and its parameters, handed over for free. A single guard bug
// then exposes platform-wide capability rather than one tenant's data.
//
// Consequences of that decision, which are the whole point:
//
//   * Its own entry point (admin.html); no shared route table.
//   * Its own token, under its own storage key, in sessionStorage — a customer
//     session is not an admin session and cannot become one, and an admin
//     session dies with the tab.
//   * It imports nothing from the customer app's page tree. `getApiBase` is
//     shared because it is configuration, not surface area. The stylesheet is
//     shared because tokens are not an attack surface either.
//
// What this dashboard deliberately does NOT do: show session content. Staff can
// read any session through the audited data-access path, but account
// administration and reading customer work are different activities and this
// surface is the first one. Counts, roles, and our own access log.

const ADMIN_TOKEN_KEY = "pp_admin_token";

function adminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setAdminToken(token: string | null) {
  try {
    if (token === null) sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    else sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    /* the session lasts for this page only */
  }
}

async function adminFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const token = adminToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${getApiBase()}${path}`, { ...init, headers });
}

// --- types -------------------------------------------------------------------

type Overview = {
  orgs: number;
  users: number;
  users_by_role: Record<string, number>;
  sessions: { total: number; owned: number; unowned: number; analysable: number; labelled: number };
};
type Org = { id: string; name: string; shown_name: string; member_count: number; admin_count: number };
type User = {
  id: string;
  email: string;
  shown_name: string;
  role: string;
  org_name: string | null;
  created_at: number;
  biometric: string;
};
type Health = { release_gate: string; below_gate: { feature: string; status: string; blocked_on: string | null }[] };
type AuditEntry = { at: number; actor: string; role: string; action: string; subject: string };

type Tab = "overview" | "orgs" | "people" | "health" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "orgs", label: "Organisations" },
  { id: "people", label: "People" },
  { id: "health", label: "Platform health" },
  { id: "audit", label: "Audit log" },
];

// --- small building blocks ---------------------------------------------------

function Stat({ label, value, note, alarm }: { label: string; value: ReactNode; note?: string; alarm?: boolean }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="mono-label" style={{ marginBottom: 8 }}>{label}</div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 600,
          lineHeight: 1.1,
          color: alarm ? "var(--color-flag-ink)" : "var(--color-graphite-ink)",
        }}
      >
        {value}
      </div>
      {note && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 6, lineHeight: 1.45 }}>{note}</div>}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="table" role="table">
      <div className="table-head" role="row" style={{ gridTemplateColumns: `repeat(${head.length}, 1fr)` }}>
        {head.map((h) => (
          <span key={h} role="columnheader">{h}</span>
        ))}
      </div>
      {children}
    </div>
  );
}

function Row({ cols }: { cols: ReactNode[] }) {
  return (
    <div className="table-row" role="row" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
      {cols.map((c, i) => (
        <span key={i} role="cell">{c}</span>
      ))}
    </div>
  );
}

const mono: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)" };

// --- app ---------------------------------------------------------------------

export default function AdminApp() {
  const [signedIn, setSignedIn] = useState(Boolean(adminToken()));
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");

  const [overview, setOverview] = useState<Overview | null>(null);
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);

  const load = useCallback(
    async (path: string, set: (v: never) => void) => {
      try {
        const res = await adminFetch(path);
        if (res.status === 401 || res.status === 404) {
          // The role is checked on every route; a token that stops working has
          // stopped being a staff token.
          setAdminToken(null);
          setSignedIn(false);
          return;
        }
        if (res.ok) set((await res.json()) as never);
      } catch {
        setError(`The platform API is unreachable at ${getApiBase()}.`);
      }
    },
    []
  );

  useEffect(() => {
    if (!signedIn) return;
    void load("/api/admin/overview", setOverview as never);
    void load("/api/admin/orgs", ((d: { orgs: Org[] }) => setOrgs(d.orgs)) as never);
    void load("/api/admin/users", ((d: { users: User[] }) => setUsers(d.users)) as never);
    void load("/api/admin/health", setHealth as never);
    void load("/api/admin/audit", ((d: { entries: AuditEntry[] }) => setAudit(d.entries)) as never);
  }, [signedIn, load]);

  const refreshAll = () => {
    setOverview(null);
    setOrgs(null);
    setUsers(null);
    setAudit(null);
    void load("/api/admin/overview", setOverview as never);
    void load("/api/admin/orgs", ((d: { orgs: Org[] }) => setOrgs(d.orgs)) as never);
    void load("/api/admin/users", ((d: { users: User[] }) => setUsers(d.users)) as never);
    void load("/api/admin/audit", ((d: { entries: AuditEntry[] }) => setAudit(d.entries)) as never);
  };

  if (!signedIn) return <SignIn onSignedIn={() => setSignedIn(true)} />;

  return (
    <div className="page">
      <a href="#content" className="skip-link">Skip to content</a>

      <header className="site-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            className="mono-label"
            style={{ color: "var(--color-coral-ink)", border: "1px solid var(--color-coral-ink)", borderRadius: 999, padding: "3px 10px" }}
          >
            Internal
          </span>
          <strong style={{ fontSize: 15 }}>ProblemProof</strong>
        </div>
        <nav className="nav" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nav-link${tab === t.id ? " active" : ""}`}
              style={{ background: "none", border: "none", cursor: "pointer" }}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button
          className="btn btn-ghost small"
          onClick={() => {
            setAdminToken(null);
            setSignedIn(false);
          }}
        >
          Sign out
        </button>
      </header>

      <main id="content" tabIndex={-1} className="container" style={{ maxWidth: 1100 }}>
        {error && (
          <div role="alert" className="card" style={{ borderColor: "var(--color-flag-ink)", color: "var(--color-flag-ink)", marginBottom: 20 }}>
            {error}
          </div>
        )}

        {tab === "overview" && <OverviewTab overview={overview} orgs={orgs} />}
        {tab === "orgs" && <OrgsTab orgs={orgs} onChanged={refreshAll} />}
        {tab === "people" && <PeopleTab users={users} onChanged={refreshAll} />}
        {tab === "health" && <HealthTab health={health} />}
        {tab === "audit" && <AuditTab entries={audit} />}
      </main>
    </div>
  );
}

// --- sign in -----------------------------------------------------------------

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="page">
      <main id="content" tabIndex={-1} className="container" style={{ maxWidth: 380, paddingTop: 96 }}>
        <div className="mono-label" style={{ color: "var(--color-coral-ink)", marginBottom: 12 }}>Internal</div>
        <h1 className="page-title">Staff sign in</h1>
        <p className="page-sub" style={{ marginBottom: 28 }}>
          This portal is separate from the customer application and from its sign-in.
        </p>

        <form
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const res = await fetch(`${getApiBase()}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
              });
              const body = res.ok ? await res.json() : null;
              // One message for every failure, including "you are not staff".
              // Telling a customer with valid credentials that they merely lack
              // a role confirms this portal is worth attacking.
              if (!body || body.user?.role !== "staff") {
                setError("That email and password combination is not recognised.");
                return;
              }
              setAdminToken(body.token);
              onSignedIn();
            } catch {
              setError(`Cannot reach the server at ${getApiBase()}.`);
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && (
            <div role="alert" className="card" style={{ borderColor: "var(--color-flag-ink)", color: "var(--color-flag-ink)", fontSize: 13, padding: "12px 14px" }}>
              {error}
            </div>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono-label">Email</span>
            <input className="exam-input" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono-label">Password</span>
            <input className="exam-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}

// --- tabs --------------------------------------------------------------------

function OverviewTab({ overview, orgs }: { overview: Overview | null; orgs: Org[] | null }) {
  if (!overview) return <p className="page-sub">Loading…</p>;
  const s = overview.sessions;
  const orphaned = (orgs ?? []).filter((o) => o.admin_count === 0).length;

  return (
    <>
      <div className="eyebrow">Platform</div>
      <h1 className="page-title">Overview</h1>
      <p className="page-sub" style={{ marginBottom: 28 }}>
        Counts only. Reading a customer's session goes through the audited data-access path, not this page.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16, marginBottom: 32 }}>
        <Stat label="Organisations" value={overview.orgs} note={orphaned ? `${orphaned} with no administrator` : undefined} alarm={orphaned > 0} />
        <Stat label="Accounts" value={overview.users} />
        <Stat label="Sessions captured" value={s.total} />
        {/* The honest headline for this platform. RESULTS.md §5: one complete
            session and no labels is the fact governing every research claim
            downstream, so it is shown first rather than buried. */}
        <Stat
          label="Analysable"
          value={s.analysable}
          note="manifest + event log present"
          alarm={s.analysable === 0}
        />
        <Stat
          label="Labelled"
          value={s.labelled}
          note="blocks six Layer 2 features"
          alarm={s.labelled === 0}
        />
        <Stat
          label="Unowned"
          value={s.unowned}
          note="pre-ownership corpus; readable only when PP_ALLOW_UNOWNED_SESSIONS is on"
        />
      </div>

      <div className="eyebrow">Accounts by role</div>
      <Table head={["Role", "Count"]}>
        {Object.entries(overview.users_by_role).map(([role, n]) => (
          <Row key={role} cols={[<span style={{ fontWeight: 500 }}>{role}</span>, <span style={mono}>{n}</span>]} />
        ))}
      </Table>
    </>
  );
}

function OrgsTab({ orgs, onChanged }: { orgs: Org[] | null; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ name: string; email: string; invite: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setCreated(null);
    try {
      const res = await adminFetch("/api/admin/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, admin_email: email }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `the server returned ${res.status}`);
      setCreated({ name: body.org.name, email: body.admin_email, invite: body.invite });
      setName("");
      setEmail("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setBusy(false);
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <div className="eyebrow">Accounts</div>
      <h1 className="page-title">Organisations</h1>
      <p className="page-sub" style={{ marginBottom: 24 }}>
        We never set the administrator's password. Creating an organisation mints an invitation for the
        address you give, and they choose their own — which is what keeps every later action under that
        account unambiguously theirs.
      </p>

      <form onSubmit={submit} className="card" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 24 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px" }}>
          <span className="mono-label">Organisation name</span>
          <input className="exam-input" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 240px" }}>
          <span className="mono-label">First administrator's email</span>
          <input className="exam-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !name || !email}>
          {busy ? "Creating…" : "Create organisation"}
        </button>
      </form>

      {error && (
        <div role="alert" className="card" style={{ borderColor: "var(--color-flag-ink)", color: "var(--color-flag-ink)", marginBottom: 20 }}>
          {error}
        </div>
      )}

      {created && (
        <div role="status" className="card tint" style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{created.name} created.</div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.6 }}>
            Send this to {created.email}. It expires in 14 days and only works for that address.
          </p>
          <div style={{ ...mono, background: "var(--surface)", padding: 12, borderRadius: 10, wordBreak: "break-all", fontSize: 10.5 }}>
            {origin}/signup?invite={created.invite}
          </div>
        </div>
      )}

      {!orgs && <p className="page-sub">Loading…</p>}
      {orgs && orgs.length === 0 && <div className="empty"><h3>No organisations yet</h3><p>Create one above.</p></div>}
      {orgs && orgs.length > 0 && (
        <Table head={["Organisation", "Id", "People", "Administrators"]}>
          {orgs.map((o) => (
            <Row
              key={o.id}
              cols={[
                <span style={{ fontWeight: 500 }}>{o.shown_name}</span>,
                <span style={{ ...mono, fontSize: 10.5 }}>{o.id.slice(0, 12)}…</span>,
                <span style={mono}>{o.member_count}</span>,
                // An org with no admin cannot invite, cannot manage its roster
                // and cannot restore itself — it needs fixing by hand, so it is
                // called out rather than left to be noticed.
                o.admin_count === 0 ? (
                  <span style={{ color: "var(--color-flag-ink)", fontWeight: 600, fontSize: 12.5 }}>none — orphaned</span>
                ) : (
                  <span style={mono}>{o.admin_count}</span>
                ),
              ]}
            />
          ))}
        </Table>
      )}
    </>
  );
}

function PeopleTab({ users, onChanged }: { users: User[] | null; onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("labeller");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      const res = await adminFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `the server returned ${res.status}`);
      setOk(`${body.email} created as ${body.role}.`);
      setEmail("");
      setPassword("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="eyebrow">Accounts</div>
      <h1 className="page-title">People</h1>
      <p className="page-sub" style={{ marginBottom: 24 }}>
        Every account on the platform. Nothing here records when anyone signed in or what they did — a
        directory is not a monitoring surface, and our own reads are in the audit log instead.
      </p>

      <form onSubmit={submit} className="card" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 24 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px" }}>
          <span className="mono-label">Email</span>
          <input className="exam-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 200px" }}>
          <span className="mono-label">Password</span>
          <input className="exam-input" type="password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono-label">Role</span>
          <select className="exam-input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="labeller">Labeller</option>
            <option value="staff">Staff</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !email || password.length < 12}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>

      {/* Org roles are pointedly absent: creating an org_admin here would put
          us inside a customer's tenancy without their knowledge. That goes
          through an invitation the organisation can see. */}
      <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "-12px 0 24px", lineHeight: 1.5 }}>
        Only staff and labeller accounts are created here. Organisation roles arrive by invitation, so the
        organisation can see who was added.
      </p>

      {error && (
        <div role="alert" className="card" style={{ borderColor: "var(--color-flag-ink)", color: "var(--color-flag-ink)", marginBottom: 20 }}>
          {error}
        </div>
      )}
      {ok && <div role="status" className="card tint" style={{ marginBottom: 20 }}>{ok}</div>}

      {!users && <p className="page-sub">Loading…</p>}
      {users && (
        <Table head={["Email", "Role", "Organisation", "Biometric"]}>
          {users.map((u) => (
            <Row
              key={u.id}
              cols={[
                <span style={{ fontWeight: 500 }}>{u.email}</span>,
                <span style={mono}>{u.role}</span>,
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{u.org_name ?? "—"}</span>,
                <span style={mono}>{u.biometric}</span>,
              ]}
            />
          ))}
        </Table>
      )}
    </>
  );
}

function HealthTab({ health }: { health: Health | null }) {
  if (!health) return <p className="page-sub">Loading…</p>;
  return (
    <>
      <div className="eyebrow">Release gate: {health.release_gate}</div>
      <h1 className="page-title">Platform health</h1>
      <p className="page-sub" style={{ marginBottom: 24 }}>
        {health.below_gate.length} features sit below the gate. Nothing below it reaches a validating
        organisation or a credential — <code>assert_releasable()</code> enforces that at the serialisation
        boundary, so this table is what is being withheld and why.
      </p>
      <Table head={["Feature", "Status", "Blocked on"]}>
        {health.below_gate.map((f) => (
          <Row
            key={f.feature}
            cols={[
              <span style={{ ...mono, color: "var(--color-graphite-ink)" }}>{f.feature}</span>,
              <span style={{ ...mono, color: f.status === "spec" ? "var(--color-coral-ink)" : "var(--muted)" }}>{f.status}</span>,
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{f.blocked_on ?? "—"}</span>,
            ]}
          />
        ))}
      </Table>
    </>
  );
}

function AuditTab({ entries }: { entries: AuditEntry[] | null }) {
  return (
    <>
      <div className="eyebrow">Accountability</div>
      <h1 className="page-title">Audit log</h1>
      <p className="page-sub" style={{ marginBottom: 24 }}>
        Every internal read of platform data, most recent first. Append-only — no route deletes from it,
        because a support-access log that support can edit is not a log. Opening this page is not itself
        logged; it would bury the entries that matter under entries about looking at them.
      </p>
      {!entries && <p className="page-sub">Loading…</p>}
      {entries && entries.length === 0 && (
        <div className="empty"><h3>Nothing recorded yet</h3><p>Internal reads will appear here as they happen.</p></div>
      )}
      {entries && entries.length > 0 && (
        <Table head={["When", "Who", "Action", "Subject"]}>
          {entries.map((e, i) => (
            <Row
              key={i}
              cols={[
                <span style={mono}>{new Date(e.at * 1000).toLocaleString()}</span>,
                <span style={{ fontSize: 12.5 }}>{e.actor}</span>,
                <span style={mono}>{e.action}</span>,
                <span style={{ ...mono, fontSize: 10.5 }}>{e.subject}</span>,
              ]}
            />
          ))}
        </Table>
      )}
    </>
  );
}
