import { Link } from "react-router-dom";
import Logo from "./Logo";
import Avatar from "./Avatar";
import { useAuth } from "../lib/auth";

type HeaderProps = {
  active?: "home" | "candidate" | "account" | "assessment" | "org" | "org-settings";
};

/** Site chrome.
 *
 *  Navigation is role-gated: a candidate is not shown that /org exists, and a
 *  reviewer is not shown /org/settings. This is presentation only — the guards
 *  and the API are what actually enforce access — but it matters that the two
 *  agree. Nav that offers a route the guard then refuses teaches people the
 *  product is broken; nav that hides a route the API would serve teaches them
 *  to guess URLs.
 */
export default function Header({ active }: HeaderProps) {
  const { user, logout } = useAuth();
  const isOrg = user?.role === "reviewer" || user?.role === "org_admin";

  return (
    <>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="logo-link">
          <Logo />
        </Link>

        <nav className="nav">
          {/* No separate "My profile" link here. It used to point at a route
              of its own (the CV/skill-graph review); that page is now the
              second half of /account, which the avatar below already links
              to — so a second nav entry would be two links to one
              destination, under two different names. */}
          {user && !isOrg && (
            <Link to="/candidate" className={`nav-link${active === "candidate" ? " active" : ""}`}>
              My sessions
            </Link>
          )}
          {isOrg && (
            <Link to="/org" className={`nav-link${active === "org" ? " active" : ""}`}>
              Queue
            </Link>
          )}
          {user?.role === "org_admin" && (
            <Link to="/org/settings" className={`nav-link${active === "org-settings" ? " active" : ""}`}>
              Settings
            </Link>
          )}
        </nav>

        {user ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* The avatar and name are one link to the profile, rather than an
                icon that turns out to be a menu. It carries its own active
                state — a ring rather than the nav's underline, since it sits
                outside the <nav> — because /account is a real destination and
                deserves the same "you are here" signal every other link gets,
                not just an implicit one from being currently on the page. */}
            <Link
              to="/account"
              aria-current={active === "account" ? "page" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                textDecoration: "none",
                color: "inherit",
                borderRadius: 999,
                outline: active === "account" ? "2px solid var(--accent-border)" : "2px solid transparent",
                outlineOffset: 3,
              }}
            >
              <Avatar id={user.id} name={user.shown_name} size={28} />
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{user.shown_name}</span>
                  <span className={`role-badge ${user.role}`}>{user.role.replace("_", " ")}</span>
                </span>
                {user.org_name && (
                  <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{user.org_name}</span>
                )}
              </span>
            </Link>
            <button className="btn btn-ghost small" onClick={logout}>
              Sign out
            </button>
          </div>
        ) : (
          <Link to="/login" className="btn btn-primary small">
            Sign in
          </Link>
        )}
      </header>
    </>
  );
}
