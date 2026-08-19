import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Logo from "./Logo";

// Shared chrome and field primitives for /login and /signup (Frontend Spec §5:
// AuthShell, LoginForm).
//
// These screens are the first thing a candidate meets, often after clicking a
// link from an employer, sometimes on a phone, occasionally while nervous about
// an assessment. Everything here is aimed at removing the small frustrations
// that make someone abandon at the door: not being able to see what they typed,
// being told a password rule only after submitting, losing an invitation by
// clicking the wrong link, or getting an error they cannot act on.

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="page">
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="logo-link">
          <Logo />
        </Link>
      </header>

      <main id="content" tabIndex={-1} className="container" style={{ maxWidth: 440, paddingTop: 56 }}>
        <h1 className="page-title" style={{ marginBottom: subtitle ? 8 : 20 }}>
          {title}
        </h1>
        {subtitle && <p className="page-sub" style={{ marginBottom: 28 }}>{subtitle}</p>}
        {children}
        {footer && <div style={{ marginTop: 28, fontSize: 13, color: "var(--muted)" }}>{footer}</div>}
      </main>
    </div>
  );
}

/** An error the user can act on, announced and focused.
 *
 *  Focus moves here on failure. Without it a screen-reader user submits, hears
 *  nothing, and has no idea the form rejected them — and a sighted user on a
 *  long page can miss it too. `role="alert"` announces; `tabIndex={-1}` plus
 *  the focus call is what actually moves them to it. */
export function FormError({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [children]);

  if (!children) return null;
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="card"
      style={{
        borderColor: "var(--red)",
        color: "var(--red)",
        fontSize: 13,
        lineHeight: 1.6,
        padding: "12px 14px",
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

export function TextField({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  const id = `field-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="mono-label">{label}</span>
      <input id={id} className="exam-input" aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint && (
        <span id={`${id}-hint`} style={{ fontSize: 11.5, color: "var(--faint)", lineHeight: 1.5 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/** The rules a new password must meet, checked live.
 *
 *  Shown as the user types rather than enforced on submit. Being told "at least
 *  12 characters" only after filling the form and pressing the button is the
 *  single most common way a signup gets abandoned, and it is entirely
 *  avoidable — the rule is knowable before they start. */
export const PASSWORD_RULES = [
  { id: "length", label: "At least 12 characters", test: (p: string) => p.length >= 12 },
  { id: "variety", label: "Letters and something that isn't a letter", test: (p: string) => /[a-z]/i.test(p) && /[^a-z]/i.test(p) },
] as const;

export function passwordMeetsRules(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password));
}

export function PasswordField({
  label = "Password",
  value,
  onChange,
  autoComplete,
  showRules = false,
  autoFocus,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  /** Live requirement checklist. On for signup, off for sign-in — telling a
   *  returning user their existing password is "too short" is noise about a
   *  rule they cannot act on. */
  showRules?: boolean;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const id = "field-password";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={id} className="mono-label">
        {label}
      </label>

      <div style={{ position: "relative", display: "flex" }}>
        <input
          id={id}
          className="exam-input"
          style={{ flex: 1, paddingRight: 76 }}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          value={value}
          aria-describedby={showRules ? `${id}-rules` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
          onBlur={() => setCapsLock(false)}
        />
        {/* Typing a password you cannot see, on a phone, with a 12-character
            minimum, is a needless failure mode. The button is a real control
            with a real label rather than a bare icon. */}
        <button
          type="button"
          className="btn btn-ghost small"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", padding: "4px 10px" }}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      {/* Caps Lock is the classic invisible cause of "my password is wrong". */}
      {capsLock && (
        <span role="status" style={{ fontSize: 11.5, color: "var(--amber)" }}>
          Caps Lock is on.
        </span>
      )}

      {showRules && (
        <ul id={`${id}-rules`} style={{ listStyle: "none", padding: 0, margin: "4px 0 0", display: "flex", flexDirection: "column", gap: 4 }}>
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(value);
            return (
              <li
                key={rule.id}
                style={{ fontSize: 11.5, color: met ? "var(--teal)" : "var(--faint)", display: "flex", gap: 7 }}
              >
                {/* A tick is not the only signal — the wording changes too, so
                    the state does not depend on colour or on the glyph alone. */}
                <span aria-hidden>{met ? "✓" : "○"}</span>
                <span>
                  {rule.label}
                  <span className="sr-only">{met ? " — met" : " — not yet met"}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
