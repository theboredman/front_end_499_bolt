# Implementation log — 2026-08-19

What was built to close the gap between the senior design report and this
repository, what was deliberately **not** built, and which report claims are
now true that were not before.

This file exists to correct the report. It is written to be quotable: every
claim below is one you can check against a file or a test, and where something
is still not real it says so in the same sentence.

---

## The short version

| | Before | After |
|---|---|---|
| Backend tests | 861 collected (3 documents disagreed: 371 / 425 / 646) | **968 collected — 967 pass, 1 skip** |
| Frontend tests | 142 | **173** |
| Registry features | 30 | **31** |
| Features at or above the release gate | **0** | **0** |

That last row is the one to read first. Nothing was promoted. Six things were
built and all six were registered below the gate, because none of them has been
measured — and the point of this exercise was to stop claiming things that have
not been.

---

## 1. What got built

### Phase 0 — correctness

**The accept inference now runs in the capture pipeline.**
`inference.annotate_log` had no production call site: `agent.run` went straight
from `consolidate_event_log()` — which only reshapes the `.jsonl` into an array
— to `derive_ai_metrics(events)`. So an agent-captured session's log held
`paste_event` rows and zero `ai_output_accepted` rows, and both
`verification_latency` and `delegation_ratio` returned `None` on every session.
Nothing raised. The metric RQ3 rests on reported "no data" on sessions that had
the data.

The teardown is now `agent.finalize_session`, extracted from `run` so it can be
exercised without a display — which is why this stage went untested and unwired
for as long as it did. `tests/test_accept_inference_is_wired.py` starts from
what the capture layer writes (a `paste_event` with a `char_count`) and never
from a hand-placed accept.

**`analysis/clock_sync.py` implements the clapperboard.** A BT.601 luma trace
against container PTS, flash-onset detection, per-stream offset measurement
against each recorder's *declared* offset, and the pairwise residual.
`fusion_refusal` is called by `feature_assembly.session_readiness`, so an
unsynchronised or misaligned session is excluded from the analysis corpus
rather than fused. The exam page paints the flash and logs `clock_sync_flash`
with the session time it was painted at.

**The webcam timebase is piecewise.** `clock_offsets.webcam_ms` is now `null`
and `stream_timebases.webcam` carries a `pause_compensated` map derived from
the same pause events everything else reads. `decode_with_pts` and
`extract_signals` take a `session_time` callable, and `POST
/sessions/{id}/extract` builds it from the manifest.

### Phase 1 — the personalisation layer

`problemproof/profile/` (CV → skill graph) and `problemproof/assessment/`
(approved subgraph → question and rubric), with `/profile` and `/assessment` on
the frontend and the question surfaced in `/exam`.

The load-bearing property: `extracted` and `approved` are **separate fields**,
and nothing crosses between them except `schema.approve`, which records an
actor and a timestamp. There is no code path and no request shape that promotes
a suggestion by default.

Question **families** fix target competency, per-tier difficulty, duration
range, deliverables and rubric dimensions; the scenario adapts. The family key
(`id@vN`) is stored on `question.json`, which is what makes two sessions
comparable at all.

### Phase 2 — Layer 4 organisational validation

`problemproof/validation.py` and `problemproof/api/validation_routes.py`. A
four-state one-way lifecycle, the reviewed annotation frozen into a
content-hashed immutable version when review *opens*, revisions creating new
versions, severity computed server-side, and an append-only audit trail
covering every consequential action including evidence access.

### Phase 3 — the performance profile

`problemproof/performance_profile.py`. Eight sections, each naming the registry
feature that governs it; assembly refuses before validation and checks the gate
per section at the serialisation boundary; `assert_profile_clean` refuses
affect labels, captured content, biometric representations and CV prose.

---

## 2. What was registered below the gate, and why

**Nothing was promoted.** Six features are new or moved, all `stub`.

| Feature | Status | Why it is not higher |
|---|---|---|
| `profile.cv_extraction` (RQ5) | `stub` | Its metric is node precision against a **participant-approved** graph. Zero participants have reviewed one. A synthetic CV compared against a synthetic approval measures the fixture. |
| `assessment.question_generation` (RQ6) | `stub` | Every part of its gate is a blinded expert rating of questions generated for real people. Neither the people nor the raters exist. |
| `validation.organization_review` (RQ7) | `stub` | Reviewer agreement, turnaround and revision rate are properties of humans doing reviews. Zero reviews have happened. |
| `validation.dashboard` | `spec` → `stub` | It is built. It stays below `synthetic` because the surface it renders has nothing to render. |
| `capture.clock_sync` | `stub` (unchanged) | The detector, the arithmetic and the refusal are implemented and tested against encoded video. **Zero sessions on disk carry a `clock_sync_flash` event**, so the residual distribution the gate is stated over has no samples. |
| `capture.event_log` | `synthetic` (unchanged) | The accept inference is wired, but the thresholds behind it are still `unfitted-intuition`. See §4. |

An implementation is not a measurement. That rule was applied without exception.

---

## 3. Which gates are now measurable that were not

Three, and each was previously unmeasurable for a structural reason rather than
a scheduling one.

**RQ3's `verification_latency`.** It could not be measured because nothing
produced the accepts it is computed over. Now the pipeline produces them, so
the metric returns a number on any session with an accept, and the remaining
blocker is the annotation pass — which is a data problem, not a code one.

**`capture.clock_sync`'s residual.** Previously there was no code that could
compute it. Now there is, plus a flash to measure against, so the gate becomes
measurable the first time a session is recorded with the current build.

**RQ7's reviewer agreement.** Previously there was no record of a decision to
agree about. `validation.json` now records the decision, the reviewer, the
organisation and the annotation version, so agreement between two reviewers on
one session is computable the moment two reviewers exist.

RQ5 and RQ6 are *newly defined* rather than newly measurable: the code exists
and produces the artefacts the metrics are computed from, and both still need
participants.

---

## 4. What could not be built honestly

**The accept thresholds are not fitted.** The brief said to run
`analysis/fit_accept_thresholds.py` first and record the fitted thresholds so
provenance is real. It cannot run: it needs sessions carrying both
`events.jsonl` and `events.annotated.jsonl`, and **zero sessions have the
second**. It exits 2 and says so.

Rather than stub a number, the refusal was made explicit.
`AcceptConfig.provenance` stays `unfitted-intuition`; the report is persisted
next to the metrics with `accepts_reportable: false` and a reason; and
`inference.read_accept_count` raises `ProvenanceError` rather than serving a
count produced by thresholds nobody has validated. The count is computed and
stored — below-gate features keep running and keep writing to disk — and
refused at read time.

**The clapperboard has no clap.** `features.toml` described the check as a clap
plus a full-screen white flash. `getDisplayMedia` is requested with `audio:
false`, so the screen recording has no audio track and a clap lands in exactly
one of the two streams. It would synchronise nothing, and asking a participant
to perform one would be a ritual. The check is visual only, and the registry
entry now says so instead of describing a test the architecture cannot perform.

A second thing about it is also unmeasured and is recorded as such: whether a
webcam in an ordinarily-lit room registers a monitor flash at all. `find_flash`
returns `None` rather than a best guess, so the failure mode is a refused
session rather than a wrong number — but the detection rate is unknown.

**Question generation is template-based, not LLM-generated.** `.env` configures
no provider and `default_generator()` returns the deterministic
`TemplateGenerator`. That is the shipped behaviour, not a degraded mode. A
`QuestionGenerator` protocol and an unwired `ProviderGenerator` exist so the
boundary is real and every test runs offline; `default_generator()` **raises**
if `PP_QUESTION_PROVIDER` is set with no client wired, rather than pretending.

The known cost is that two participants at the same tier in the same family see
the same frame with their own skills in it. `inter_question_similarity` is in
the RQ6 gate for exactly that reason.

**The CV parser is deliberately not a model.** It is sectioned, dictionary and
pattern based, with a stated confidence prior per extraction route. The reason
is this project's own recorded negative result
(`removed-emotion-monitor.md`: a generative model asked to describe an input it
was given asserted evidence absent from that input in 42 of 50 cases). A model
that invents a skill from a CV produces a claim about somebody's employment
history with nothing behind it, and RQ5 would then be measuring hallucination
rate under a different name. The recall cost is real and `review_metrics`
counts it as `participant_added`.

---

## 5. Report claims that are now true and were not

- **"An agent-captured session produces `ai_output_accepted` events."** True.
  It was false in the running system and true only in a test that constructed
  them by hand.
- **"`verification_latency` is computed for a session."** True on a session
  with accepts. It returned `None` on every session.
- **"Cross-stream clock synchronisation is validated per session."** True of
  the *mechanism*: the flash is painted, logged and detectable, and a session
  that fails is refused for fusion. **Not yet true of any session** — none has
  been recorded with it.
- **"A CV produces a reviewable skill graph."** True.
- **"Approval is a distinct recorded act."** True, and structural rather than
  procedural.
- **"An approved subgraph plus settings produces a versioned question and
  rubric."** True.
- **"The organisational validation lifecycle exists."** True.
- **"A submitted annotation cannot be mutated."** True, and content-hashed so a
  version edited on disk afterwards is detectable rather than merely forbidden.
- **"Reviewer evidence access is logged."** True. The reviewer surface had said
  so since before any route wrote such a log.
- **"The profile refuses to include any sub-gate feature."** True, and it also
  refuses to assemble before validation.

## Report claims that are still not true

- **Anything describing a *measurement* from RQ5, RQ6 or RQ7.** All three are
  code with no data.
- **"Questions are generated by a language model."** They are generated from a
  template.
- **"The clock-sync residual is under 100 ms on N% of sessions."** No session
  has a residual.
- **"`delegation_ratio` is reported."** The pipeline computes it; the accept
  count behind it is refused at read time until the thresholds are fitted.
- **Anything presenting a `synthetic`-status number as a finding.** Eleven
  features are `synthetic`; a synthetic result cannot fail, which is precisely
  why it cannot count.

---

## 6. Corrections made to the repository's own documents

Several of these were not in the brief. They were found while working and are
the same class of problem the brief exists to fix.

- **The test count.** `SYSTEM.md` §7 said 371, its own repository map said 425,
  `RESULTS.md` said 646. It is 968.
- **`RESULTS.md` claimed two test modules fail at collection.** Neither does;
  both pass. The remaining artefact is one skip and a `faulthandler` traceback
  from a handled pywin32 import failure.
- **`RESULTS.md`'s registry status table was stale** — 10/1/15/2 against an
  actual 11/1/14/2, before any of this work.
- **The org queue claimed "every evidence packet is cryptographically
  sealed."** True of nothing: no signing, hashing or encryption of an evidence
  packet exists. Corrected to what is true — tenant isolation at the
  data-access layer, and content hashing of a frozen annotation version.
- **The org queue claimed reviewer access was "immutably logged"** before any
  route wrote such a log. Now true.
- **`requirements.txt` annotated `httpx` as "outbound calls to NVIDIA NIM
  (api/assistant.py)"** — a module deleted long ago.
- **`clock_offsets.webcam_ms: 0`** was not a measurement; it was the shape of a
  field mistaken for its value, and on a session paused for 90 seconds it was
  wrong by 90,000 ms while looking exactly like a measured alignment.

---

## 7. Two near-misses worth keeping

Both are cases where the obvious implementation would have been quietly wrong.

**The problem statement was almost called `prompt`.** The assessment-context
section of the performance profile originally carried it under `prompt`, which
is in `FORBIDDEN_FIELDS` — so the section would have tripped its own content
check the moment the feature was promoted, and only then. It is `statement`
now. `prompt` in this system means text a participant sent to an AI tool;
the problem statement is text we generated and gave to them.

**`below_gate` was almost session-dependent.** The first version of the profile
endpoint returned an empty `below_gate` for a session that had not been
validated, because nothing had been assembled and so nothing had been withheld.
That is technically precise and produces exactly the failure Frontend Spec §7.2
describes: a reviewer opening an unvalidated record would see a blank dashboard
with no explanation. What the gate withholds is a fact about the *features*, not
about a sitting, so `gated_sections()` is session-independent and the list is
always populated.

---

## 8. Addendum — personalisation layer follow-on work (2026-08-20)

Three further changes, all inside `problemproof/profile/`, none touching
Phases 0–3 above. Recorded here because the last of the three is exactly the
kind of thing this file exists to make traceable: a request that reopened a
decision this document had already recorded.

### 8.1 A second codebase in this repository, read and partly adopted

`KG/` is a standalone resume→knowledge-graph pipeline in this repository,
built separately from ProblemProof: an LLM pass (NVIDIA NIM) plus a spaCy NER
cross-check, reconciled into confidence-tagged entities, normalised against
the public ESCO taxonomy, and rendered in a standalone D3 viewer. Asked to
check it and update `problemproof/profile/` accordingly, the honest answer
had two halves.

**Declined: the LLM/NER extraction architecture**, for the reason already on
record in `extraction.py`'s own docstring before this work — `KG/`'s LLM pass
sends each candidate's full CV text to a third party, the same shape of
problem as the removed emotion monitor. Offered explicitly as an option
("full pipeline swap: LLM + NER + ESCO" vs. "ESCO-grounded skill matching
only") the answer was the local-only one.

**Adopted: ESCO-grounded skill matching**, because it is the one piece of
`KG/` that runs entirely on-device. `problemproof/profile/esco.py` — local
sentence-transformer embeddings against a bundled, trimmed copy of the public
ESCO v1.1.1 taxonomy (13,896 concepts, `data/esco_skills.csv`) — is a second,
optional matcher tried only on Skills-section items the ~100-term hand-typed
dictionary misses. Off by default (`PP_ESCO_SKILL_MATCHING`); every test
supplies an injected fake embedding function, so the suite needs no model
download and no `sentence-transformers` install. The confirmed false-attractor
denylist ("numpy"→"numerology", "KNN"→"Vyper") was ported verbatim from
`KG/`'s own tuning rather than re-derived, so the two catalogues do not
quietly diverge on terms already proven bad.

### 8.2 Personalised, and visualised

`ProfileGraphPanel.tsx` renders each candidate's own skill graph as a
node-link diagram, in the Skills section of `/account`, appearing as soon as
their CV is analysed — before most nodes are approved, which is the state it
is actually seen in most of the time. No new dependency: hand-drawn SVG,
positioned by a deterministic formula, the same construction already
established by `ProcessGraphPanel` for the phase-transition graph. The
extracted/approved distinction — the property every other part of this layer
is built around — is carried into the diagram as shape (solid vs.
hollow-dashed), never colour alone, because colour here identifies node type
using the six-hue palette already validated for phase colouring, reused
rather than re-picked.

One geometry bug was caught by actually rendering a realistic graph and
reading the coordinates rather than reasoning about the code in the abstract:
`extraction.py` emits both `USED_IN` and `EVIDENCED_BY` for every skill a
project or experience mentions, so the two edges shared endpoints and one drew
invisibly on top of the other. Fixed by merging edges between the same pair
before drawing.

### 8.3 LLM-assisted cleanup — the decision reopened, and how

A few messages after §8.1's local-only choice was made, the next request was
"use NVIDIA NIM as an LLM backend to clean up the skills." Read plainly, this
reverses the decision in §8.1 — the same third-party transmission that had
just been declined for full extraction, now requested for a narrower purpose.

The response was to say so, plainly, before writing any code, and confirm
scope with the user rather than either silently building it or silently
declining it. The confirmed scope is materially narrower than the option
declined in §8.1: **only the isolated skill phrase itself** — a `Skills`
section list item that already missed both the dictionary and ESCO — is sent
to NIM, batched, never CV prose, a name, an employer, or a date. This was
checked by test, not just by design: `test_personalisation_api.py` captures
the real outgoing prompts from a CV containing a name, an email, and an
employer, and asserts none of them appear.

**A correction is never trusted on the model's word.** `clean_batch`
(`problemproof/profile/llm_cleanup.py`) runs every proposal through a
similarity guard (`difflib.SequenceMatcher`, stdlib, no new dependency) before
accepting it. A typo fix keeps the corrected string close to the original; a
model that substitutes a different skill for a plausible-sounding one — the
test case is literally "Go" → "Google" — does not, and is rejected back to
the raw string. This is the same shape of risk `removed-emotion-monitor.md`
is the project's own recorded negative result for, applied at a smaller
scale, and the guard is what stands between it and a participant seeing an
unearned "correction." Even an accepted correction is still only an
`extracted`-tier suggestion, gated behind the same approve/reject/edit act as
everything else this layer produces, and it carries the string it replaced
(`cleanup_original`) so a reviewer can always see, and undo, what changed.

Off by default (`PP_NIM_SKILL_CLEANUP` unset), same shape as
`PP_ESCO_SKILL_MATCHING` and `PP_QUESTION_PROVIDER`: an explicit sentinel, not
a truthy value, and it raises rather than silently degrading if turned on
without an API key. 31 new tests, all offline — every one supplies an
injected call function; none needs `PP_NIM_API_KEY` or network access to run.

### What this addendum is not

RQ5's gate is unchanged by any of §8.1–8.3: it is still a comparison against
a participant-approved graph, and zero participants have reviewed one. Adding
a second and third extraction route inside the same feature does not create
a new research question or a new gate — both are registered inside
`profile.cv_extraction`'s existing entry, both `blocked_on` real participants,
and neither is measurable at build time by construction.
