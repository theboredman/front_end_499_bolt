// Authentication state and route guards.
//
// `AuthProvider` sits INSIDE the router, unlike `ScreenCaptureProvider` which
// sits above it (invariant 1). The difference is deliberate and worth stating,
// because the two look symmetrical and are not: capture state must survive
// navigation because a torn-down MediaRecorder cannot be silently re-acquired,
// whereas auth state is derived from a token and can be rebuilt on any mount.
// Nothing is lost by remounting it, and being inside the router lets the guards
// use `useLocation` to preserve where the user was going.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import { apiFetch, clearToken, getToken, setToken } from "./api";

export type Role = "candidate" | "reviewer" | "labeller" | "org_admin" | "staff";

export type CurrentUser = {
  id: string;
  email: string;
  role: Role;
  org_id: string | null;
  org_name: string | null;
  display_name: string;
  /** Never empty — falls back to the email's local part server-side, so no
   *  surface has to write that fallback itself. */
  shown_name: string;
  pronouns: string;
  timezone: string;
  biometric: {
    enrolment: "none" | "enrolled" | "declined";
    consent_version: string;
    decided_at: number;
    /** Whether the matcher runs at all on this deployment. */
    available: boolean;
    /** "off" | "shadow" | "enforced". The UI needs the difference: under
     *  shadow the check runs and decides nothing, which is neither
     *  "unavailable" nor "protecting you". */
    enforcement: "off" | "shadow" | "enforced";
    current_consent_version: string;
  };
};

type AuthValue = {
  user: CurrentUser | null;
  /** True until the initial /me has settled. Guards must WAIT on this rather
   *  than treating "no user yet" as "not signed in" — redirecting during the
   *  first render would bounce every authenticated user to /login on reload. */
  loading: boolean;
  login: (email: string, password: string, invite?: string) => Promise<void>;
  signup: (email: string, password: string, invite?: string) => Promise<void>;
  orgSignup: (email: string, password: string, orgName: string) => Promise<void>;
  logout: () => void;
  /** Re-read /me. Used after a profile edit so the header updates too. */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (detail?.message) return detail.message;
  return fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch("/api/auth/me");
      if (res.ok) {
        setUser((await res.json()) as CurrentUser);
      } else {
        // An expired or revoked token is indistinguishable from none, and is
        // discarded rather than retried — a token that no longer works will not
        // start working.
        clearToken();
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const complete = async (res: Response, fallback: string) => {
    if (!res.ok) throw new Error(await readError(res, fallback));
    const body = await res.json();
    setToken(body.token);
    await refresh();
  };

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      async login(email, password, invite) {
        await complete(
          await apiFetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, invite: invite ?? null }),
          }),
          "That email and password combination is not recognised."
        );
      },
      async signup(email, password, invite) {
        await complete(
          await apiFetch("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, invite: invite ?? null }),
          }),
          "That account could not be created."
        );
      },
      async orgSignup(email, password, orgName) {
        await complete(
          await apiFetch("/api/auth/org/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, org_name: orgName }),
          }),
          "That organisation could not be created."
        );
      },
      logout() {
        clearToken();
        setUser(null);
      },
      refresh,
    }),
    [user, loading, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Nothing, rendered while the initial /me is in flight. */
function Settling() {
  return (
    <div className="page">
      <main id="content" tabIndex={-1} className="container" style={{ maxWidth: 480, paddingTop: 96 }}>
        <div className="mono-label">Checking your session…</div>
      </main>
    </div>
  );
}

/** Requires any authenticated user. Preserves the intended destination. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Settling />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

/** The neutral not-found that role refusals render.
 *
 *  Says nothing about roles, permissions, or the route it is standing in for.
 *  "You lack permission for /org/settings" confirms that /org/settings exists
 *  and that somebody else can reach it, which is structure worth having if you
 *  are mapping an application you should not be inside (Frontend Spec §3).
 *  This is byte-identical to what a genuinely unknown URL renders. */
export function NotFound() {
  return (
    <div className="page">
      <main id="content" tabIndex={-1} className="container" style={{ maxWidth: 560, paddingTop: 96 }}>
        <h1 className="page-title">Page not found</h1>
        <p className="page-sub">
          There is nothing at this address. Check the link, or go back to <a href="/">the start</a>.
        </p>
      </main>
    </div>
  );
}

/** Requires one of `roles`. Fails CLOSED: anything other than an explicit
 *  match renders the neutral not-found, including the still-loading case
 *  resolving to no user. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Settling />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!roles.includes(user.role)) return <NotFound />;
  return <>{children}</>;
}
