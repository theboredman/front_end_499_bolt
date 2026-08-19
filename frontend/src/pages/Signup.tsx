import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell, FormError, PasswordField, TextField, passwordMeetsRules } from "../components/AuthShell";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";

type Invite = { org_id: string; org_name: string; email: string | null; assessment_id: string | null };

export default function Signup() {
  const { user, loading, signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get("invite");

  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  /** Set when the email is already registered. Not an error so much as a
   *  wrong turn — the account exists and they should sign in, carrying the
   *  invitation with them. */
  const [emailTaken, setEmailTaken] = useState(false);
  const [busy, setBusy] = useState(false);

  // Resolve the invitation before anything is agreed to. A candidate who
  // cannot see which organisation will receive their process record is not in
  // a position to consent to producing one.
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    void apiFetch(`/api/auth/invite/${encodeURIComponent(inviteToken)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setInviteError("This invitation link is invalid or has expired. Ask the organisation to send a new one.");
          return;
        }
        const body = (await res.json()) as Invite;
        setInvite(body);
        if (body.email) setEmail(body.email);
      })
      .catch(() => {
        if (!cancelled) setInviteError("The invitation could not be checked. Check your connection and reload.");
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  if (!loading && user) return <Navigate to="/candidate" replace />;

  const passwordOk = passwordMeetsRules(password);
  const canSubmit = Boolean(email) && passwordOk && !busy && !inviteError;

  const signinHref = `/login?${new URLSearchParams({
    ...(inviteToken ? { invite: inviteToken } : {}),
    ...(email ? { email } : {}),
  })}`;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setEmailTaken(false);
    try {
      await signup(email, password, inviteToken ?? undefined);
      navigate("/candidate", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "That account could not be created.";
      if (message.includes("already exists")) setEmailTaken(true);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        inviteToken
          ? undefined
          : "Practice sessions and your own credentials. Takes about a minute."
      }
      footer={
        <>
          Already have an account? <Link to={signinHref}>Sign in</Link>.
        </>
      }
    >
      {inviteToken && !invite && !inviteError && (
        <p className="page-sub" role="status">Checking your invitation…</p>
      )}

      {inviteError && <FormError>{inviteError}</FormError>}

      {/* Who is asking, stated plainly and before the form. */}
      {invite && (
        <div className="card tint" style={{ marginBottom: 24 }}>
          <div className="mono-label" style={{ marginBottom: 8 }}>You were invited by</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{invite.org_name}</div>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
            They will receive the process record for the session you complete — and nothing from any other
            session. You will see exactly what is recorded before anything starts.
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }} noValidate>
        <FormError>{error}</FormError>

        {/* The likeliest wrong turn on this page, handled as a route onward
            rather than as a failure. */}
        {emailTaken && (
          <div className="card tint" role="alert" style={{ fontSize: 13, lineHeight: 1.6 }}>
            <strong>You already have an account with this email.</strong>
            <div style={{ margin: "6px 0 12px", color: "var(--muted)" }}>
              {invite
                ? `Sign in and we'll connect your account to ${invite.org_name}.`
                : "Sign in to continue where you left off."}
            </div>
            <Link className="btn btn-primary small" to={signinHref}>
              Sign in instead →
            </Link>
          </div>
        )}

        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus={!invite?.email}
          required
          value={email}
          readOnly={Boolean(invite?.email)}
          onChange={(e) => setEmail(e.target.value)}
          hint={
            invite?.email
              ? `Set by your invitation. Ask ${invite.org_name} to reissue it for a different address.`
              : undefined
          }
        />

        <PasswordField
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          autoFocus={Boolean(invite?.email)}
          showRules
        />

        <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
          {busy ? "Creating your account…" : "Create account"}
        </button>

        {!busy && !canSubmit && !inviteError && (
          <span style={{ fontSize: 11.5, color: "var(--faint)", marginTop: -8 }}>
            {!email ? "Enter your email to continue." : "Your password needs to meet both rules above."}
          </span>
        )}
      </form>
    </AuthShell>
  );
}
