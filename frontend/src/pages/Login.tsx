import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell, FormError, PasswordField, TextField } from "../components/AuthShell";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";

type FromState = { from?: { pathname?: string } };

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  // An invitation can arrive here two ways: the candidate clicked the link and
  // already has an account, or signup sent them over because their email was
  // taken. Either way the token has to survive the trip, or the organisation
  // that invited them never sees their session.
  const inviteToken = params.get("invite");
  const [orgName, setOrgName] = useState<string | null>(null);

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    void apiFetch(`/api/auth/invite/${encodeURIComponent(inviteToken)}`)
      .then(async (res) => {
        if (!cancelled && res.ok) {
          const body = await res.json();
          setOrgName(body.org_name);
          if (body.email) setEmail((current) => current || body.email);
        }
      })
      .catch(() => {
        /* the invitation is a bonus here, not a precondition — signing in
           still works without it, so a failed lookup is not worth an error */
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const destination = (location.state as FromState | null)?.from?.pathname ?? "/candidate";
  if (!loading && user) return <Navigate to={destination} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password, inviteToken ?? undefined);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const signupHref = inviteToken
    ? `/signup?invite=${encodeURIComponent(inviteToken)}`
    : "/signup";

  return (
    <AuthShell
      title="Sign in"
      subtitle={
        orgName
          ? `${orgName} invited you. Sign in and this session will be shared with them.`
          : "Your sessions and credentials live on your account, not on this device."
      }
      footer={
        <>
          New here? <Link to={signupHref}>Create an account</Link>.
        </>
      }
    >
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }} noValidate>
        <FormError>{error}</FormError>

        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />

        {/* The label does not vanish while submitting — a button that becomes
            a bare spinner leaves the user unsure what they pressed. */}
        <button className="btn btn-primary" type="submit" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        {/* Says why the button is unavailable, rather than leaving a dead
            control the user pokes at. */}
        {!busy && (!email || !password) && (
          <span style={{ fontSize: 11.5, color: "var(--faint)", marginTop: -8 }}>
            Enter your email and password to continue.
          </span>
        )}
      </form>
    </AuthShell>
  );
}
