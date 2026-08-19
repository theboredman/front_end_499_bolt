# ProblemProof — Identity, Authentication & Access Control Specification

**Version:** 1.0 (Deployment Baseline)
**Scope:** How every role registers, authenticates, verifies identity, is authorised, and is recovered — across the Candidate Portal, Organisation Portal, Internal Admin Portal, and the public credential verifier.
**Companion documents:** ProblemProof Full System Document (architecture, Layers 1–5), ProblemProof User Role Plan (role visibility matrix), ProblemProof Research Plan (§2–4, capture and privacy constraints).

---

## 0. Design Principles

These constrain every decision in this document. They are inherited from the Full System Document's Privacy Architecture and are not negotiable at implementation time.

1. **Identity is verified continuously, not just at login.** Layer 1 specifies liveness and identity verification throughout the session, because a login-only check does not prevent someone else sitting the exam after authentication.
2. **Biometric data is never an authentication credential stored server-side.** Face data is processed on-device; only extracted signals leave the machine. Identity confirmation uses those signals *transiently*, and the platform never holds a face template it could be breached for.
3. **Account identity and credential identity are separate.** A platform account is a login. A **DID (Decentralised Identifier)** is what the credential is anchored to. A person can lose or migrate their account without losing their credential.
4. **Least privilege by default.** New users get the narrowest role. Elevation is explicit, logged, and reversible.
5. **Every consequential action is auditable.** Credential issuance, dispute resolution, role changes, and data exports all write immutable audit records.

---

## 1. Identity Model

Three distinct identifiers exist. Conflating them is the most common design failure in credentialing systems.

| Identifier | Scope | Lifetime | Purpose |
|---|---|---|---|
| `account_id` | Platform login | Deletable | Authenticates a human to a portal |
| `candidate_id` | Assessment subject | Durable across sessions | Anchors baseline calibration profile and session history |
| `did:` (DID) | Credential subject | Permanent | Cryptographic subject of every issued Verifiable Credential |

**Relationships:**
- One `account_id` maps to exactly one `candidate_id` for candidate-role users.
- One `candidate_id` owns exactly one DID, generated at first credential issuance.
- Organisation users (`Org Admin`, `Reviewer`) have an `account_id` and an `org_id` membership, but no `candidate_id` unless they also take sessions.
- Deleting an `account_id` under right-to-erasure removes personal data but leaves the on-chain credential hash intact — the DID persists with no personal data attached to it on-chain.

**Baseline profile as continuity anchor.** The per-candidate baseline (`candidates/{candidate_id}/baseline.json`) is deliberately not session-scoped. It is compared against at every subsequent session and at 18-month recertification. This gives a *soft* continuity check — a signal that the same person is sitting successive sessions — but it is **not** an identity credential, and must never be treated as one. Research Plan RQ2 explicitly investigates whether these representations are invertible to identity; until that returns a negative result, the system must assume they might be and protect them accordingly.

---

## 2. Authentication by Role

### 2.1 Method Matrix

| Role | Primary method | MFA | Session lifetime | Notes |
|---|---|---|---|---|
| Candidate (B2C) | Email + password, or OAuth (Google/GitHub/LinkedIn) | Optional, strongly prompted | 30 days refresh, 1 hour access | Self-registered |
| Candidate (B2B, invited) | Magic link from org invite → sets password or OAuth | Optional | Same | Invite binds to `org_id` for that assessment only |
| Designated Reviewer | Email + password, or org SSO | **Required** | 12 hours access, 7 days refresh | Reviewer actions are consequential |
| Second Reviewer | Same as Reviewer + scoped grant token | **Required** | Grant expires with the dispute case | Cannot access anything outside the assigned case |
| Org Admin | Email + password, or org SSO | **Required** | 12 hours | Controls billing and seats |
| Internal Ops/Admin | Internal SSO only (separate IdP) | **Required, hardware key preferred** | 8 hours, no long refresh | Never shares an auth path with customer portals |
| Internal Labeler | Internal SSO, scoped role | **Required** | 8 hours | Read-only on pseudonymised sessions |
| Public Verifier | None | — | — | Unauthenticated public page |

### 2.2 Enterprise SSO

Enterprise-tier organisations get SAML 2.0 or OIDC SSO, as promised in the pricing tier. Implementation requirements:

- **SCIM 2.0 provisioning** for automatic user lifecycle — when an org deprovisions an employee in their IdP, that Reviewer loses access immediately rather than at next password rotation. This matters because a departed Reviewer retains signing authority over credential issuance otherwise.
- **Just-in-time provisioning** creates the account on first SSO login with the role mapped from an IdP group claim, defaulting to `Reviewer` (never `Org Admin`) if the claim is absent or unrecognised.
- **SSO enforcement toggle** — once an org enables SSO enforcement, password login is disabled for that domain, closing the bypass.
- SSO applies only to organisation users. Candidates always authenticate through the platform, even when invited by an SSO-enabled org, because the candidate's data ownership rights are personal and must not be mediated by the assessing organisation's IdP.

### 2.3 Token Handling

- Access tokens: JWT, short-lived, carrying `account_id`, `role`, `org_id` (where applicable), and scopes. Never carrying personal data.
- Refresh tokens: opaque, stored server-side with revocation support, rotated on use, bound to device fingerprint hash.
- Session invalidation triggers: role change, password change, SSO deprovisioning, MFA reset, explicit "sign out everywhere", and detection of concurrent use from geographically implausible locations.
- All tokens are invalidated when an account is under an active erasure request.

---

## 3. Registration & Onboarding Flows

### 3.1 Candidate — Self-Registered (B2C Train)

1. Sign up with email or OAuth provider.
2. Verify email via one-time link (24-hour expiry).
3. Accept Terms and the **Capture Consent Notice** — this is a distinct, separately recorded consent, not bundled into ToS. It must state plainly: whole-screen recording, webcam capture, what is and is not logged, retention period, and the right to withdraw.
4. Complete **device and environment check** — camera, microphone, screen-share permission, network stability.
5. Complete **Personal Baseline Calibration** — the short calibration task sequence. This is a hard gate: no session may start without a stored baseline profile, because every later signal is scored in the frame that calibration produces.
6. Account is now session-ready. `candidate_id` issued; DID not yet generated (deferred to first credential issuance).

### 3.2 Candidate — Org-Invited (B2B Assess)

1. Org Admin or Reviewer sends an invite; the platform emails a magic link scoped to `org_id` + `assessment_id`.
2. Candidate creates or signs into their own account. **If they already have an account, the existing `candidate_id` and baseline are reused** — they do not recalibrate per employer, and their existing history stays private from the new org.
3. Consent notice is shown again, scoped to this assessment: what this specific organisation will receive, and what it will not.
4. Device check; baseline calibration only if none exists or the stored one has expired.
5. Assessment unlocked, time-boxed per the org's configuration.

**Critical boundary:** the invite grants the *org* access to the outputs of that one assessment. It does not grant access to the candidate's account, prior sessions, other orgs' assessments, or their broader profile.

### 3.3 Organisation — New Account

1. Sales-assisted or self-serve signup depending on tier (Starter is self-serve; Enterprise is contracted).
2. **Organisation verification** before any assessment can be commissioned:
   - Verified work-domain email (no free-mail domains for the admin account)
   - Domain ownership proof via DNS TXT record or email at the domain's postmaster
   - Legal entity name and registration number, captured for the validator signature record
   - For Enterprise: contract execution and named legal signatory
3. First user becomes `Org Admin`. This is the only self-assigned admin; all subsequent admins are promoted by an existing admin.
4. Org Admin invites Reviewers by email; each invited Reviewer completes their own signup and MFA enrolment before gaining any access.
5. Optional SSO/SCIM configuration.

Organisation verification is not bureaucratic overhead — the validator's digital signature is what makes the credential legally defensible. An unverified organisation signing credentials would undermine the entire trust model.

### 3.4 Reviewer — Activation

1. Receives invite from Org Admin.
2. Creates account or authenticates via org SSO.
3. **MFA enrolment is mandatory and blocking** — no review access until complete.
4. Acknowledges the **Reviewer Responsibility Statement**: what their signature means, that disputes are recorded transparently, and that they are handling another person's assessment data under the org's data-processing obligations.
5. Gains `Reviewer` scope for their `org_id`.

### 3.5 Internal Staff

Provisioned only through the internal IdP by an existing platform administrator. Role assignment (`ops`, `support`, `labeler`, `platform_admin`) is explicit, time-bounded where appropriate, and reviewed quarterly. No self-registration path exists.

---

## 4. Identity Verification

There are three separate verification questions, and they need three separate mechanisms. Most systems answer only the first and assume it covers the rest.

### 4.1 "Is this a real, reachable person?" — Account Verification

- Email verification at signup (all roles)
- Optional phone verification for higher-assurance B2B assessments
- Bot/abuse controls: rate limiting, disposable-domain blocking, progressive challenge on suspicious signup patterns

### 4.2 "Is this the person the credential will be issued to?" — Session Identity Verification

Applies at the start of every assessment session. Assurance level is configurable by the commissioning organisation:

| Assurance level | Mechanism | Typical use |
|---|---|---|
| **L1 — Self-attested** | Account authentication only | B2C Train practice sessions |
| **L2 — Presence-verified** | Live capture check + liveness detection at session start; baseline profile continuity comparison | Standard B2B assessment |
| **L3 — Document-verified** | L2 plus government-ID match at session start, via a third-party IDV provider | High-stakes hiring, university credit, certification bodies |

**L3 implementation constraint:** ID documents are processed by the IDV vendor and **never stored by ProblemProof**. The platform stores only a verification result token, the assurance level achieved, and a timestamp. Holding scanned identity documents would create a data-breach liability entirely disproportionate to the benefit.

> **Corrected 2026-08-15.** This constraint previously closed with "and would sit badly against a privacy architecture that refuses to store face video." That architecture does not exist. The session's webcam recording — video and audio — is uploaded at submit (`uploadWebcam` → `routes.py upload_webcam` → `storage.webcam_path`) and retained. The rule against storing ID documents stands on its own merits; it does not need a companion claim that is false.

The assurance level achieved is recorded in the Process Profile and surfaced on the credential, so a third party reading the credential knows how strongly identity was established. A credential that does not disclose its own assurance level is misleading.

### 4.3 "Is it still the same person, forty minutes in?" — Continuous Verification

This is the Layer 1 requirement, and it is what distinguishes ProblemProof from any assessment tool that checks identity once at the door.

- Continuous liveness detection throughout the session — **target state: running on-device, emitting signals rather than video**
- Face-presence continuity: gaps, substitutions, or the presence of additional faces are recorded as events (the calibration gate already detects "more than one person is present" rather than silently discarding extra detections)
- Baseline-profile drift monitoring against the stored calibration profile
- Screen-surface verification: whole-screen capture is required and verified after the fact; a window- or tab-scoped share is rejected, because it would systematically exclude exactly the behaviour being studied

> **Current divergence (2026-08-15).** This list is the target, and three of its four items are not what runs.
>
> - **Nothing in this system runs on-device.** `FaceMeshPreview` is a `<video>` element and does no processing; MediaPipe FaceLandmarker runs server-side in Python (`extractors/webcam/landmarker.py`), and the frontend carries no ML dependency at all. Extractor B, the on-device encoder that would make the claim true, is status `spec` and blocked on GPU budget. Calibration frames are POSTed as base64 and the session webcam clip is uploaded and stored.
> - **Liveness detection does not exist.** The calibration gate detects faces, capture quality, and multiple faces. It does not detect presentation attacks. Any flow specified as depending on liveness — including biometric enrollment — is depending on something unbuilt.
> - **Face-presence continuity partially exists**: `multiple_faces` and walked-away detection are real (`calibration/quality.py`). Substitution detection is not, because it requires identity matching, which is the subject of §4.5.
> - Screen-surface verification is accurate as written and implemented.
>
> Only the last item should be read in the present tense.

**Handling anomalies:** a continuity anomaly **flags** the session for human review. It does not auto-fail the candidate and does not auto-void the session. Someone stretching, adjusting their camera, or briefly leaving frame is not an impersonation attempt, and a system that terminates sessions on that basis will generate far more false accusations than caught fraud. Flagged sessions surface in the Reviewer's queue with the anomaly timeline attached, and the candidate is told a flag was raised and given the opportunity to respond — consistent with the dispute resolution protocol's transparency commitment.

### 4.4 "Is this credential real?" — Credential Verification (Public)

No authentication required. Anyone holding the credential URL or QR code can:
- Confirm the credential is authentic and unmodified via hash verification
- View the Process Profile summary
- Confirm which organisation validated it, and see that organisation's verification status
- Confirm the issuance timestamp and check expiry/freshness (18-month indicator)

They cannot see raw session data, evidence clips, or the full profile without the credential holder's explicit permission. Extended sharing is a candidate-initiated action that mints a scoped, expiring share link.

### 4.5 Face-match identity continuity

**Status: built and running, in shadow mode. Registered `synthetic`.** MediaPipe locates and crops the face; ONNX Runtime Web computes the embedding; the decision logic runs in full. What it may not do is act — see Enforcement levels below. `identity.face_match` remains below the release gate, so nothing reaches a validating organisation.

**Architecture: on-device only (option A).** The embedding is computed and held client-side; matching runs in the browser; only a score and a decision reach the server. No embedding and no frame is transmitted or stored.

The rationale is narrower than it first appears, and worth stating precisely so nobody over-claims it later. On-device matching does **not** keep faces off the wire — the server already receives calibration frames and stores the session webcam recording. What it achieves is that **no biometric identity template exists anywhere in our infrastructure**. A template is a distinct legal object and a distinct breach exposure from stored video: it is portable, comparable across systems, and directly identifying. Declining to create one is a policy boundary rather than a technical impossibility, since the server holds video from which an embedding could be derived at any time. It is still worth holding.

**Enrollment**

- From a live capture at signup only. An uploaded photograph can be anyone's; any existing uploaded avatar is display-only and is never an enrollment artifact.
- The embedding is stored. The source frame is not.
- Enrollment consent is its own versioned event, separate from capture consent, because agreeing to be recorded and agreeing to be biometrically matched are different agreements. Invariant 11 applies: the consent copy changes in the same commit as the behaviour.
- Declining is not a blocker. The candidate falls back to the assurance level they would otherwise have had, and the level that actually applied is recorded on the session and surfaced on the credential.

**Matching — two failure modes, deliberately asymmetric.** See CLAUDE.md invariant 12. At calibration a low match refuses and mints no exam ticket; mid-exam a low match flags for review and never terminates, auto-fails, or offers recalibration.

**Enforcement levels.** `off` / `shadow` / `enforced`, defaulting to **shadow**.

Shadow runs the matcher and records every score while being structurally unable to act on any of it: `judgeCalibration` returns `observed` rather than `pass`/`refuse`, mid-exam events carry `enforced: false` and raise no flag, and the server checks its own level rather than trusting the outcome the client reported — a client sending `outcome: "refuse"` still cannot lock anyone out. Shadow results do not raise the assurance level, because a credential claiming L2 on a check nobody was allowed to act on is exactly the misleading disclosure §4.2 warns about.

It exists because the alternative is circular: per-cohort thresholds cannot be fitted without real scores, and real scores cannot be collected without running the matcher. `enforced` is refused while `validated` is false, on both sides. Full detail in `docs/identity-model-setup.md`.

**Thresholds.** Two, not one: strict at calibration where a false stop costs minutes, lenient mid-exam where a false flag accuses someone. Config-driven, versioned, and written into the session manifest so a decision can be re-audited against the exact configuration that produced it.

> **Thresholds are unvalidated. Shadow mode is how that changes.**
>
> Face matching has documented demographic error-rate disparities — NIST FRVT Part 3 reports false-match-rate differences across demographic groups spanning orders of magnitude for many algorithms. A single global threshold is not a neutral default; it is a decision to distribute errors unevenly and not measure it.
>
> The config supports per-cohort thresholds so that validation is *possible*, and shadow mode is what produces the data to fit them: every session now records what the matcher saw, without that record costing anyone anything. Until enough shadow scores exist across a demographically diverse consented sample, every number in the config is a placeholder and is labelled as one.

**Open questions requiring resolution before enabling**

1. **Article 9.** Adding identity matching as a processing purpose may make the *already-stored* webcam video biometric data under GDPR Art. 9, regardless of where the embedding is computed. If so, the separate-consent and encryption-at-rest obligations attach to option (A) as well, not only (B). This needs counsel; it is not an engineering judgement.
2. **Liveness.** Enrollment specifies a liveness-checked capture. No liveness detection exists (see §4.3). Until it does, enrollment is "live camera" but not "verified live", and a presentation attack at enrollment would poison the reference embedding for every later session.
3. **Release gate.** Mid-exam flags are meant to reach the reviewer queue. `identity.face_match` is `synthetic`, and `assert_releasable()` blocks sub-gate features at the serialisation boundary, so flags are emitted and then withheld. Under shadow no flag is raised in the first place.

4. **Recognition weights.** Deliberately not bundled: a model's demographic error profile is a property of its weights, and that is exactly what is unmeasured here. NIST FRVT reports rates for named algorithms; an unattributed ONNX has none. See `docs/identity-model-setup.md` §2.

---

## 5. Authorisation Model (RBAC)

### 5.1 Scope Design

Permissions are expressed as `resource:action` scopes, granted by role and constrained by tenancy (`org_id`) or ownership (`candidate_id`). Two checks run on every request:

1. **Does this role hold this scope?** (role check)
2. **Does this specific resource belong to this actor's tenant or self?** (ownership check)

Skipping the second check is how multi-tenant systems leak data between customers. It must be enforced at the data-access layer, not in individual route handlers where it will eventually be forgotten.

### 5.2 Permission Matrix

| Scope | Candidate | Reviewer | Org Admin | Internal Ops | Labeler |
|---|---|---|---|---|---|
| `session:create` | own | — | — | — | — |
| `session:read` | own | org-scoped | org-scoped | support-scoped | pseudonymised |
| `profile:read` | own | org-scoped | org-scoped | ✅ | — |
| `evidence:read` | own | org-scoped | org-scoped | support-scoped | — |
| `assessment:validate` | — | ✅ | ✅ | escalation only | — |
| `dispute:raise` | own (response) | ✅ | ✅ | ✅ | — |
| `dispute:assign_second` | — | — | — | ✅ | — |
| `credential:issue` | — | ✅ (signs) | ✅ (signs) | ✅ (reissue) | — |
| `credential:share` | own | — | — | — | — |
| `org:billing` | — | — | ✅ | ✅ | — |
| `org:members` | — | — | ✅ | ✅ | — |
| `problem:select` | — | ✅ | ✅ | ✅ | — |
| `problem:manage` | — | — | custom submit | ✅ | — |
| `data:export` | own | — | org aggregate | ✅ | — |
| `data:erase` | own request | — | — | ✅ execute | — |
| `label:write` | — | — | — | — | ✅ |
| `platform:health` | — | — | — | ✅ | — |

### 5.3 Separation of Duties

Certain combinations must be structurally impossible:

- An Internal Ops user cannot both assign a second reviewer and act as that reviewer.
- A Reviewer cannot validate an assessment for a candidate they are recorded as having invited *and* be the sole signatory, in orgs where multi-validator consensus is enabled (v1.5+).
- No role can modify a Process Profile's underlying evidence. Reviewers adjust scores and append notes; the captured record is immutable. This is what makes the evidence trail defensible.

---

## 6. Credential Issuance & DID Binding

1. Reviewer confirms the assessment (Step 5a of the Validation Workflow).
2. If the candidate has no DID, one is generated and bound to their `candidate_id`. Key custody options: platform-custodied (default, recoverable) or self-custodied (advanced users, non-recoverable — must be explicitly chosen with a clear warning).
3. The credential is assembled as a W3C Verifiable Credential containing only the on-chain-approved elements: session data hash, validated Process Profile summary, validator's digital signature, timestamp, and the DID. Raw video, biometric data, and webcam footage are **never** included.
4. The organisation's signature is applied using the org's issuing key, held in an HSM or managed KMS. Key compromise here would let an attacker forge validated credentials, so this key never lives in application memory or configuration.
5. Credential is anchored on-chain; the candidate is notified and can share it.

**Disputed path (5b):** the credential is still issued, with reviewer notes appended and the dispute reflected transparently. A dispute is a documented disagreement, not a suppression mechanism.

**Reissuance:** only Internal Ops can reissue, only for demonstrable technical fault, and every reissuance writes an audit record linking old and new credential.

---

## 7. Account Recovery

| Scenario | Path | Constraint |
|---|---|---|
| Candidate forgot password | Email reset link, 1-hour expiry | Invalidates all sessions |
| Candidate lost MFA device | Backup codes, or identity re-verification at the assurance level of their highest-issued credential | Never a support-only override |
| Candidate lost self-custodied DID key | Not recoverable | Stated explicitly at the point of choosing self-custody |
| Reviewer lost access | Org Admin re-invites | Org Admin cannot reset another user's MFA directly |
| Org Admin lost access | Verified support process: domain-control proof plus contract signatory confirmation | Multi-step, never single-email |
| Sole Org Admin departed org | Escalated support process requiring legal-entity verification | Orgs are prompted to maintain two admins for exactly this reason |
| Internal staff | Internal IdP recovery, hardware-key re-enrolment | No exceptions, no shared credentials |

**Support must never be able to authenticate as a user.** Impersonation-for-support, if implemented at all, must be consent-gated (the user approves a time-boxed session), fully audit-logged, and unavailable for any action that signs a credential.

---

## 8. Security Controls

- **Password policy:** minimum length over complexity theatre; screening against known-breached password corpora; no forced rotation absent evidence of compromise.
- **MFA:** TOTP and WebAuthn/passkeys. SMS accepted only as a fallback, never as the sole factor for credential-signing roles.
- **Rate limiting:** per-account and per-IP on authentication, magic links, invites, and credential-verification endpoints.
- **Audit logging (immutable, append-only):** authentication events, role changes, credential issuance and dispute actions, evidence access, data exports, erasure executions, and every internal-staff access to customer data.
- **Anomaly detection:** impossible-travel logins, bulk evidence access by a single Reviewer, unusual export volume.
- **Secrets:** all keys in a managed secret store; issuing keys in HSM/KMS; nothing in environment files committed to source control.
- **Encryption:** TLS 1.3 in transit; at-rest encryption for all session storage; raw recordings encrypted with the user's key such that the platform cannot access them without consent.
- **Retention:** raw recordings auto-deleted 30 days post-validation by default, with a user-configurable shorter window. Deletion must be verified, not merely scheduled.

---

## 9. Privacy & Regulatory Alignment

The architecture must satisfy GDPR (EU), PDPA (Bangladesh/ASEAN), and PDPO (Hong Kong) by design. Access-control implications:

| Requirement | Implementation |
|---|---|
| Lawful basis | Explicit, granular, separately-recorded consent for capture — never bundled into Terms of Service |
| Purpose limitation | Org access is scoped to the specific assessment they commissioned; no browsing of a candidate's wider history |
| Data minimisation | Event logs capture timing and frequency only — never keystrokes, clipboard contents, file contents, full URLs, or query text |
| Right of access | Candidate self-service export of their complete data package in a standard format |
| Right to erasure | Self-service request; executes across session storage; on-chain hash persists carrying no personal data |
| Withdrawal of consent | Available mid-session; capture stops, partial session is discarded rather than analysed |
| Biometric special-category data | On-device processing; signals not raw video reach the server; no stored face templates |
| Data residency | Region-pinned storage for orgs with residency obligations (Enterprise tier) |
| Processor obligations | DPA with each organisation; ProblemProof is processor for org-commissioned assessments, controller for B2C Train |

**Consent under power asymmetry** deserves explicit attention: a candidate being assessed for a job they need is not freely consenting in the same sense as a B2C user. The Research Plan flags this directly. Mitigations to implement rather than assume: the org must offer a stated alternative assessment path; the candidate must be able to withdraw without the org being told *why*; and refusal must not be reported to the org as a negative signal.

---

## 10. Deployment Checklist

**Environments:** local → staging (synthetic data only, never production sessions) → production. No production candidate data in any lower environment, ever.

**Pre-launch gates:**

- [ ] MFA enforced and blocking for all credential-signing roles
- [ ] Tenancy isolation verified by automated test — a Reviewer from Org A cannot read any Org B resource by ID manipulation
- [ ] Org domain verification live; no unverified org can commission an assessment
- [ ] Consent capture recorded separately from ToS acceptance, with versioning
- [ ] Issuing keys in HSM/KMS; no key material in application config
- [ ] Audit log append-only and independently readable
- [ ] Retention job for 30-day raw-recording deletion running and verified end-to-end
- [ ] Self-service data export and erasure functional before first paying customer
- [ ] Internal Admin portal on separate auth path from customer portals
- [ ] Label tool access list separate from Internal Admin access list
- [ ] Public credential verifier functional without login, exposing only the on-chain summary
- [ ] Rate limiting on all auth and verification endpoints
- [ ] Anomaly-flag handling reviewed with a human in the loop — no automated session termination
- [ ] DPA template and privacy policy legally reviewed for each target market

---

## 11. Build Sequencing

| Phase | Identity & access scope |
|---|---|
| **v0.5 — MVP** | Email/password + OAuth for candidates; email/password + mandatory MFA for a single org role; L1/L2 assurance; internal admin on separate auth; consent capture; audit logging |
| **v1.0 — Production** | Org Admin / Reviewer permission split; L3 document verification via IDV vendor; DID generation and credential issuance; self-service export and erasure; recovery flows hardened |
| **v1.5 — Intelligence** | Enterprise SSO + SCIM; second-reviewer scoped grants; multi-validator consensus with separation-of-duties enforcement; bias-detection access controls |
| **v2.0 — Platform** | API keys and OAuth client credentials for ATS integrations; scoped machine-to-machine access; data-residency pinning; on-premise deployment auth model |

---

*Document owner: ProblemProof engineering. Review cadence: before each major release, and on any change to the credential issuance path.*
