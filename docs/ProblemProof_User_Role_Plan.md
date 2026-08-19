# ProblemProof — User Role Plan

*What each role sees, does, and is restricted from — mapped to the existing architecture (Layers 1–5), privacy rules, and validation workflow in the Full System Document.*

---

## 1. Role Summary

| # | Role | Portal | Who they are |
|---|------|--------|---------------|
| 1 | **Candidate** | Candidate Portal | Individual taking a session — B2C (self-directed) or B2B (sponsored by an org) |
| 2 | **Org Admin** | Org Portal (Admin view) | Owner of an organisation's ProblemProof account — billing, seats, problem library |
| 3 | **Designated Reviewer** | Org Portal (Reviewer view) | Confirms/disputes AI assessments via the validator dashboard |
| 4 | **Second Reviewer** | Org Portal (Reviewer view, invited) | Brought in only for "Moderate" disputes — same view as Reviewer, scoped to one case |
| 5 | **Internal Ops/Admin** | Internal Admin Portal | ProblemProof's own team — platform health, problem library, support, escalations |
| 6 | **Internal Labeler/Researcher** | Label Tool (internal) | Annotates sessions to train the phase-detection model |
| 7 | **Public Verifier** | No login — credential link/QR | Anyone checking if a shared credential is real |

Roles 2–4 share one portal with permission-based views, not separate builds. Roles 5–6 are internal-only and never exposed to customers.

---

## 2. Candidate

**Purpose:** Take a monitored session, review their own process record, hold their credentials.

**Sees:**
- Onboarding & calibration flow (baseline task, consent notice, device checks)
- The problem statement and workspace (code editor / task area) during the session
- Their own phase-marker rail (self-paced retrospective tagging, not real-time labels)
- Post-session **Process Record**: timeline of their own events, "where the time went" category breakdown (AI tool / docs / reference / etc. — categories only, never URLs or content), webcam-derived signal panel
- Their own **Process Profile** narrative and evidence trail once generated
- Credential status: pending / confirmed / disputed, and the issued credential once live
- Session history across all past attempts, and recertification prompts after 18 months
- Data controls: download their full data package, request erasure, adjust raw-recording retention window

**Cannot see:**
- Any other candidate's session, profile, or credential
- The organisation's internal review notes, reviewer scoring, or dispute deliberation
- Raw comparative/benchmark data used by orgs across candidates
- Internal admin tooling, problem library management, or bias/fairness dashboards

**Key screens:** Landing → Onboarding/Calibration → Exam (monitored session) → Verify/Process Record → Candidate dashboard (history) → Credential view.

---

## 3. Org Admin

**Purpose:** Manage the organisation's account — the business relationship, not individual case review.

**Sees:**
- Billing, plan tier (Starter / Growth / Enterprise), seat management, SSO configuration (Enterprise)
- Problem library selection for their org — standard tracks, domain-specific sets, or (Enterprise) custom problems submitted for ProblemProof review
- Roster of designated Reviewers and their permissions
- Aggregate analytics: assessments run, average duration, dispute rate, credential issuance rate (org-level only, not comparative across other orgs)
- All submitted candidate records for their org — same review data a Reviewer sees, plus admin controls

**Cannot see:**
- Other organisations' data, pricing, or usage
- A candidate's raw webcam footage or full session video beyond what the platform designates as validator evidence
- ProblemProof's internal model performance, problem decay/gameability flags, or internal ops tooling

**Key screens:** Org dashboard (billing/seats/library) + everything in the Reviewer view below, since Org Admin is Reviewer permissions plus account settings.

---

## 4. Designated Reviewer

**Purpose:** The human-in-the-loop check — Layer 4 of the architecture. Confirms or disputes the AI-generated Process Profile before a credential is issued.

**Sees:**
- Received candidate submissions for their org: Process Profile, annotated evidence clips, Process Graph visualisation
- Full qualitative narrative with evidence trail (e.g. "broke the problem into 4 sub-tasks within 3 minutes")
- Screen-recording evidence tied to specific claims in the profile (validator-only evidence, per the credential data table)
- Confirm / dispute controls, with dispute severity logic surfaced (minor / moderate / major) and what happens next at each level
- Candidate's process timeline and category breakdown (same shape the candidate sees, org-framed)

**Cannot see:**
- Raw webcam video or biometric data (never sent to the platform's server, let alone the org — only extracted signals)
- Candidate's personal data outside the assessment context (contact info beyond what candidate explicitly shared for hiring)
- Other organisations' candidates or review activity
- The candidate's private notes, self-tagged reflections, or data-control settings

**Key screens:** Org portal → Received records list → Validator dashboard (per-candidate review + confirm/dispute) → Dispute resolution flow.

**Note on Second Reviewer:** identical view, scoped to a single flagged case, triggered only by a Moderate dispute. Doesn't need a separate portal — an invite-based, time-boxed grant of Reviewer permissions on one record.

---

## 5. Internal Ops/Admin (ProblemProof team)

**Purpose:** Run the platform. Not exposed to customers.

**Sees:**
- Problem library management: add/retire problems, monitor "problem decay" flags (when a Process Graph distribution narrows, signalling the problem has become gameable), review Enterprise-submitted custom problems
- Platform health: calibration failure rates, capture/session error logs, model version and phase-detection accuracy metrics
- Dispute queue oversight: assign second reviewers for Moderate disputes, review Major disputes flagged as inconclusive, track re-assessment offers
- Support tooling: look up a session/account for troubleshooting, reissue or correct credential metadata, handle erasure requests
- Aggregate, anonymised cross-org analytics (for Data Intelligence product and internal reporting)
- (v1.5+) Validator bias detection dashboards, neurodivergence archetype model performance, Process Authenticity score tuning

**Cannot see (by design, per Privacy Architecture):**
- Raw face video (never leaves the candidate's device — on-device processing, signals only reach the server)
- Full keystrokes, clipboard contents, file contents, or search query text — even internally, only categories/timing/frequency are ever captured
- Anything after a candidate's right-to-erasure request removes it (on-chain credential hash persists with no personal data attached)

**Key screens:** Internal admin dashboard — Problem Library, Platform Health, Dispute Queue, Support/Account Lookup, Analytics. Access gated separately from customer portals, ideally with its own auth/SSO for the internal team.

---

## 6. Internal Labeler/Researcher

**Purpose:** Retrospective cued-recall labelling to train and validate the phase-detection model (research plan §4). Exists today as `/label/:sessionId`.

**Sees:**
- A specific session's event log and phase markers for labelling
- Enough context to annotate accurately — timing, category data, phase transitions

**Cannot see:**
- Candidate identity beyond what's needed for the labelling task (should be anonymised/pseudonymised where possible)
- Org-side review notes or dispute outcomes
- Billing, account, or platform-ops data

**Key screens:** Label tool only. Kept separate from the Internal Admin portal since it's a research function, not an operations one — different access list, different purpose.

---

## 7. Public Verifier (no account)

**Purpose:** Anyone who receives a shared credential (URL or QR code) and wants to confirm it's real.

**Sees:**
- Confirmation the credential is authentic and unmodified (hash check)
- Process Profile **summary** (on-chain content only)
- Which organisation validated it, and the issue timestamp

**Cannot see:**
- Raw session video, webcam data, or biometric signals (never on-chain, never shared without explicit candidate permission)
- Full Process Profile detail, evidence clips, or reviewer notes — those require the candidate's explicit consent to share beyond the summary

**Key screens:** None — a public, unauthenticated credential-verification page. No portal, no login.

---

## 8. Access Model at a Glance

| Data / Feature | Candidate | Reviewer | Org Admin | Internal Ops | Public Verifier |
|---|---|---|---|---|---|
| Own session Process Record | ✅ | — | — | ✅ (support) | — |
| Candidate's submitted profile (their org) | — | ✅ | ✅ | ✅ | — |
| Raw webcam video | ❌ (never leaves device) | ❌ | ❌ | ❌ | ❌ |
| Screen-recording evidence clips | own only | ✅ (their org) | ✅ (their org) | ✅ (support) | ❌ |
| Confirm/dispute assessment | ❌ | ✅ | ✅ | escalation only | ❌ |
| Billing / seats / SSO | ❌ | ❌ | ✅ | ✅ | ❌ |
| Problem library management | ❌ | ❌ | select only | ✅ full | ❌ |
| Cross-org analytics | ❌ | ❌ | own org only | ✅ | ❌ |
| Issued credential summary | ✅ | ✅ (their org) | ✅ (their org) | ✅ | ✅ (public part only) |

---

## 9. Build Sequencing (ties to roadmap)

- **v0.5 MVP:** Candidate portal + Org portal (single Reviewer-equivalent role) — matches "validator dashboard" and first credential issuance milestone. Internal Admin can be minimal/ugly at this stage but must exist for dispute handling and support.
- **v1.0:** Add Org Admin permission split (billing/seats/SSO) as real multi-seat orgs onboard.
- **v1.5:** Second Reviewer / multi-validator consensus flow inside the Org portal; bias/fairness dashboards inside Internal Admin.
- **v2.0:** ATS integrations and ops tooling for ecosystem partners layer on top of the same role model — no new portal, new API-level access instead.
