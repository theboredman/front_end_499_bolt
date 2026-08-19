import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getApiBase } from "../lib/api";

// `/c/:credentialId` — the public credential verifier (Frontend Spec §7.1).
//
// No authentication, no navigation, no product marketing, no footer CTA.
//
// This page is read by people who have never heard of ProblemProof and are
// deciding whether to trust a stranger's claim. Every element that is not
// verification evidence competes with the evidence for their attention and
// weakens it — a marketing link here reframes the page from "a record you can
// check" to "an advert that mentions a record", which is exactly the reading
// that makes someone distrust it.
//
// It deliberately shares no code path with the authenticated surfaces: it uses
// `fetch` directly rather than `apiFetch`, because `apiFetch` attaches a bearer
// token and this page must never send one. A verifier that behaved differently
// for a signed-in reader would be reporting on the reader, not the credential.

type Verification = {
  credential_id: string;
  verified: boolean;
  issued_at: string | null;
  expires_at: string | null;
  fresh: boolean;
  validating_org: { name: string; verified: boolean } | null;
  summary: string | null;
};

export default function PublicVerifier() {
  const { credentialId = "" } = useParams();
  const [result, setResult] = useState<Verification | null | "unverifiable">(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBase()}/api/credentials/${encodeURIComponent(credentialId)}/verify`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setResult("unverifiable");
          return;
        }
        setResult((await res.json()) as Verification);
      })
      .catch(() => {
        if (!cancelled) setResult("unverifiable");
      });
    return () => {
      cancelled = true;
    };
  }, [credentialId]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "64px 24px" }}>
      <a href="#content" className="skip-link">
        Skip to the verification result
      </a>
      <main id="content" tabIndex={-1} style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="mono-label" style={{ marginBottom: 24 }}>Credential verification</div>

        {result === null && <div className="mono-label">Checking…</div>}

        {result === "unverifiable" && (
          <div className="card" role="status" style={{ borderColor: "var(--red)" }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 10px", color: "var(--red)" }}>
              This credential could not be verified.
            </h1>
            {/* States the fact and stops. Speculating about why — expired,
                revoked, never existed — would be guessing about a real
                person's record in front of someone assessing them. */}
            <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.65, margin: 0 }}>
              No valid credential exists at this address. If you were given this link directly, ask the holder
              to reissue it.
            </p>
          </div>
        )}

        {result && result !== "unverifiable" && (
          <>
            <div
              className="card"
              style={{ borderColor: result.verified ? "var(--teal-border)" : "var(--red)", marginBottom: 20 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span
                  className="dot"
                  style={{ background: result.verified ? "var(--green)" : "var(--red)", width: 9, height: 9 }}
                />
                {/* Colour is never the sole carrier — the words say it too. */}
                <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                  {result.verified ? "Verified" : "Not verified"}
                </h1>
              </div>
              <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.65, margin: 0 }}>
                {result.verified
                  ? "This credential is authentic and has not been modified since it was issued."
                  : "This credential's contents do not match its signature and should not be relied on."}
              </p>
            </div>

            <dl style={{ margin: 0 }}>
              {[
                ["Issued", result.issued_at ?? "—"],
                ["Freshness", result.fresh ? "Current" : "Past its 18-month recertification point"],
                [
                  "Validated by",
                  result.validating_org
                    ? `${result.validating_org.name}${result.validating_org.verified ? " (verified organisation)" : " (unverified organisation)"}`
                    : "—",
                ],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                  <dt className="mono-label">{k}</dt>
                  <dd style={{ margin: 0, fontSize: 13.5, textAlign: "right" }}>{v}</dd>
                </div>
              ))}
            </dl>

            {result.summary && (
              <div style={{ marginTop: 28 }}>
                <div className="mono-label" style={{ marginBottom: 10 }}>Process profile summary</div>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-body)", margin: 0 }}>{result.summary}</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
