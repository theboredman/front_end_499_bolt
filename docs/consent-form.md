# Informed consent — ProblemProof pilot study

> **Status: draft for institutional review.** This is the text the study proposes
> to put in front of participants. It has not been reviewed or approved by
> anyone. Nothing here substitutes for whatever North South University's ethics
> process requires, and no session may be recorded before that process has
> finished. Fields in `[SQUARE BRACKETS]` must be filled in before use.
>
> The technical claims in §2 and §3 are checkable against the code, and should be
> re-checked whenever the capture layer changes — see
> [§8](#8-for-the-study-team-keeping-this-document-true).

---

**Study title:** [TITLE]
**Researcher:** [NAME], [DEPARTMENT], North South University
**Contact:** [EMAIL] · [PHONE]
**Supervisor:** [NAME], [EMAIL]
**Ethics approval:** [BODY], reference [NUMBER], dated [DATE]

---

## 1. What this study is

We are studying how people solve programming problems, and how the process
changes when AI assistants are part of it. We are interested in the *shape* of
the work — when you explore, when you write, when you check your work, when you
go back — not in whether you solve the problem or how well.

**Your performance is not being assessed.** This is not an exam, it does not
affect any grade, and no result from it goes to any instructor in a form that
identifies you.

If you take part, you will:

1. Solve one programming problem, for **30–40 minutes**, using your own computer,
   your own editor, and whatever AI tools you normally use — or none, if that is
   what you normally do. We will not tell you to use AI and we will not tell you
   to avoid it.
2. Afterwards, watch your own session back and mark the phases you think you were
   in. This takes about [DURATION].

Total time: about [TOTAL].

## 2. What is recorded

| | |
| --- | --- |
| **Screen recording** | Continuous video of your screen for the whole session. **This shows everything visible on the screen, including anything you type and anything an AI tool shows you.** It is the most sensitive item in this list. |
| **Webcam video** | Continuous video of your face. Used to derive head pose, gaze direction and blink rate. |
| **Keystroke timing** | The *interval* between keypresses, in milliseconds. Not which keys. |
| **Clipboard lengths** | How many characters you copied or pasted, and when. Not what they were. |
| **Application and window activity** | Which application is in front, when you switch, and a coarse category for browser tabs (`documentation`, `qa_forum`, `ai_tool`, `social`, …). |
| **File activity** | The names of files created or changed in your working folder. Not their contents. |
| **Your code** | The solution you write in our editor. |

## 3. What is never recorded

The event log physically cannot hold these. The list of banned field names is in
the source code (`backend/problemproof/events.py`, `FORBIDDEN_ATTRS`) and is
enforced at runtime — a bug in our code cannot cause them to be stored.

- **Which keys you press.** Only the timing between them. The key identity is
  compared against a fixed list of shortcuts (copy, paste, save) and discarded in
  the same instruction; it is never written anywhere.
- **What you copy or paste.** Only how many characters.
- **What you type into an AI tool, and what it replies.** Only that a tool was
  open, which one, and for how long.
- **The web addresses you visit, or the titles of pages.** Only a category, and a
  one-way hash of the title that cannot be turned back into the title.
- **What you search for.** Only that a search happened, and on which engine.
- **The contents of files outside our editor.** Only their names.
- **Anything at all when the recording is not running.** Recording starts when you
  press start and stops when you press stop. Nothing is installed that persists
  afterwards, and you remove the software yourself at the end.

### The honest caveat about the screen recording

Everything above describes the *event log*. The **screen recording is a video and
it captures whatever is on your screen**, including text you typed into an AI
tool and text it sent back, and including anything else you happen to open.

This is not a loophole — the recording exists precisely so that a human can watch
it and check whether our automatic measurements are correct, which is the point
of this pilot. But you should decide to take part knowing that it exists and what
it contains.

Practically:

- Close anything you would not want on video **before** you press start:
  messaging apps, email, personal accounts, anything with notifications.
- If something private appears on screen, **say so at the time**. We will note the
  timestamp and cut that stretch out of the recording before anyone analyses it.
- You may ask to watch your own recording at any point, before or after
  annotation.

## 4. Who sees what

| Who | Sees |
| --- | --- |
| The researcher named above | Everything |
| Two phase annotators | Your screen recording |
| One event annotator | Your screen recording |
| Anyone else | Aggregate numbers only, with no way to identify you |

Annotators are [DESCRIBE: e.g. postgraduate students in the department, under the
same confidentiality undertaking]. They are shown recordings identified by a code
number, not your name.

**Published outputs contain no video, no screenshots, no code you wrote, and no
information that could identify you.** They contain counts, durations and
statistics pooled across all participants.

## 5. How it is stored, and for how long

- Recordings are stored on [WHERE — encrypted disk / institutional storage], not
  on any commercial cloud service, and not on a personal laptop.
- Your name is kept in one file linking it to your participant code. That file is
  stored [WHERE], separately from the recordings, and is destroyed on [DATE].
- After that, the recordings cannot be connected to you by anyone, including us.
- Recordings are deleted on [DATE]. Derived numbers — the timings and counts,
  with no video — are kept [FOR HOW LONG / indefinitely] for reanalysis.

## 6. Your rights

**Taking part is voluntary.** You do not have to. Nobody will be told whether you
did, and it will not affect your standing, your grades, or your relationship with
anyone at the university.

**You can stop at any time, for any reason, without giving one.** Say "stop" or
close the laptop. Nothing further will be asked of you.

**You can have your data deleted.** Email [CONTACT] with your participant code
any time up to [DELETION DEADLINE — the point where data has been pooled and
individual deletion is no longer possible]. We will delete your recordings and
your rows, confirm in writing that we have, and no explanation is required. After
that date your data has been aggregated with everyone else's and can no longer be
separated out — this is why the deadline exists, and it is the reason to raise
any concern early rather than late.

**You can ask us to cut a stretch out** without withdrawing entirely, if
something private appeared on screen. Tell us roughly when, and we will remove
it.

**You can ask what we found.** A plain summary of the results will be sent to any
participant who wants one.

## 7. Risks, and what we do about them

- **The screen recording is the main one.** See §3. Close private things first;
  tell us if something appears; you can have it cut.
- **Being watched changes how you work.** It probably will. We cannot remove this,
  and it is a stated limitation of the study rather than something we claim to
  have controlled for.
- **Discomfort at seeing your own session.** The annotation pass involves watching
  yourself work. Some people find this uncomfortable. You may skip it and still
  take part in the rest.
- **The webcam records your face** for the whole session. It is not used for
  emotion recognition, identification, or anything about your appearance — only
  head pose, gaze direction and blinks. [IF TRUE: The video itself is deleted
  after the numeric signals are extracted, on [WHEN].]

There is no physical risk and no deception. Nothing about the task is hidden from
you.

---

## 8. Consent

Please initial each box.

| | |
| --- | --- |
| ☐ | I have read and understood this document, and have had the chance to ask questions. |
| ☐ | I understand that my **screen will be video recorded**, including anything visible on it, and that this includes what I type into AI tools and what they reply. |
| ☐ | I understand that my **face will be video recorded** by webcam. |
| ☐ | I understand what is not recorded: my keystrokes, my clipboard contents, my search queries, and the addresses of pages I visit. |
| ☐ | I understand that taking part is voluntary, that I may stop at any time without giving a reason, and that this will not affect my grades or standing. |
| ☐ | I understand that I may request deletion of my data up to [DELETION DEADLINE], without giving a reason. |
| ☐ | I agree that anonymised, aggregated results may be published. |
| ☐ | I agree to take part. |

Optional — you can take part without agreeing to these:

| | |
| --- | --- |
| ☐ | I agree that my recordings may be kept for future research beyond this study. |
| ☐ | I would like to be sent a summary of the results. Email: ____________________ |

**Participant name:** ______________________  **Signature:** ______________  **Date:** __________

**Researcher name:** ______________________  **Signature:** ______________  **Date:** __________

*Participant keeps one copy. The researcher keeps one copy.*

---

## 8. For the study team: keeping this document true

§3 is a claim about the code, and it will stop being true the first time someone
adds a field to the event log without thinking about this file.

The guarantees above rest on:

- `events.FORBIDDEN_ATTRS` and `events.assert_no_content` — the runtime check
  that no content-bearing attribute reaches the log
- `event_logger._hash_title` — window titles are hashed, never stored
- `event_logger._on_key_press` — key identity is compared against a shortcut list
  and dropped in the same frame
- `config.SITE_CATEGORY_TITLE_MARKERS` — browser activity becomes a category, not
  a URL

Re-read this section against the code before each recording round, and treat any
new event attribute as a change to the consent form until proven otherwise.

Two things this document does **not** cover and that someone must handle
separately:

1. **Institutional approval.** Screen recording plus keystroke timing plus webcam
   on human participants needs whatever NSU's ethics process requires, in hand
   and referenced at the top of this form, before session one.
2. **The annotators' undertaking.** Three people will watch participants' screens.
   They need their own confidentiality agreement; participants are told in §4
   that one exists.
