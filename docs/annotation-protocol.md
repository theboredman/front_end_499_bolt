# AI-event annotation protocol

You are watching a screen recording and writing down what the participant did with
AI. Your file is the ground truth that `analysis/event_validation.py` measures the
automatic event log against.

**The most important instruction in this document is [§4](#4-capture_route--the-field-that-makes-recall-mean-something).**
The automatic detector can only see AI output that arrived through the clipboard
with Ctrl/Cmd+V. It is blind to inline completions taken with Tab, to right-click
pastes, and to AI output the participant retyped by hand. Those are exactly the
events we need you to mark. If you only mark what you think the tool caught, the
recall number comes out flattering and means nothing, and the pilot has failed
without anyone noticing.

You are not checking the automatic log. **Do not open `events.jsonl`.** An
annotator who has seen it is confirming it, not measuring it.

---

## 1. What you produce

One file per session, `events.annotated.jsonl`, in that session's directory
beside `screen.webm`. One JSON object per line, no commas between lines, no
wrapping array:

```jsonl
{"t_ms": 47000, "type": "ai_session_open", "attrs": {"tool_id": "chatgpt"}}
{"t_ms": 61500, "type": "prompt_submit", "attrs": {"prompt_length": null}}
{"t_ms": 74200, "type": "response_received", "attrs": {"response_length": null, "latency_ms": null}}
{"t_ms": 88900, "type": "ai_output_accepted", "attrs": {"char_count": 340, "target_file": "solution.py", "capture_route": "clipboard_paste", "tool_id": "chatgpt"}}
{"t_ms": 91000, "type": "ai_session_close", "attrs": {"tool_id": "chatgpt", "duration_ms": 44000}}
```

`t_ms` is **milliseconds from the start of the recording**, not wall clock and
not a timecode string. `01:28.9` into the video is `88900`.

Never write prompt text, response text, code, window titles or URLs into any
field. The event log is metadata only and the schema will reject content
(`backend/problemproof/events.py`, `FORBIDDEN_ATTRS`). If you find yourself
wanting to record *what* was asked, the answer is that we do not record that.

---

## 2. `ai_output_accepted` — the event that matters most

**An accept is: AI-generated text ends up in the participant's working code.**

That is the whole definition. It does not matter how it got there. It does not
matter whether the participant then edited it, or deleted it two minutes later.
It does not matter whether it was three lines or fifty. If text that the AI
produced became part of what the participant was writing, that is an accept, and
it gets a line in your file.

Mark it when:

- they copy from a chat window and paste into the editor
- they accept an inline completion (Copilot, Cursor, Supermaven, JetBrains AI)
  with Tab or Enter or a click
- they use an editor's "apply", "insert", "accept diff" or "keep" button
- they right-click → Paste, or use Edit → Paste from the menu
- they read the AI output and **type it in themselves**, in whole or in
  recognisable part
- they drag text from the chat panel into the editor
- an agent mode (Cursor Composer, Copilot Agent, Claude Code) writes to a file
  and they keep the result

Do **not** mark it when:

- they copy AI output somewhere that is not their working code — into a scratch
  document, a chat message, a browser search box
- they read AI output and it changes their mind, but no AI text enters the code.
  A participant who reads an explanation and then writes their own solution has
  not accepted output. This is a real judgement call and you will make it several
  times per session; the test is whether the *text* transferred, not whether the
  *idea* did.
- the editor shows a ghost-text completion and they keep typing past it, or press
  Escape

### Timestamp it at the paste, not at the decision

The moment to record is when the text **appears in the editor** — the frame where
the buffer changes. Not when they highlighted it, not when they pressed Ctrl+C,
not when you can tell from their face they have decided to use it.

This matters because `verification_latency` is measured from the accept to the
next verification action. Timestamping at the decision instead of the insertion
inflates every latency in the dataset by however long the participant spent
switching windows, which is neither a constant nor a small number.

If the insertion is not visible — the editor is behind another window, the
participant is scrolled elsewhere — timestamp the first frame where you can
confirm the text is there, and add `"timing_confidence": "low"` to `attrs`.

### `char_count`

Estimate it. Count the visible characters of inserted text, to the nearest 10 for
anything under 200 characters and the nearest 50 above that. If you genuinely
cannot see the inserted text, write `null` — not `0`, and not a guess.

An accept with `char_count: null` still counts as an accept for recall. It is
excluded from the size distribution, which is the correct trade: a fabricated
length is worse than a missing one.

---

## 3. Sessions: `ai_session_open` and `ai_session_close`

An AI session is open from the moment the participant can see AI output to the
moment they cannot.

**Open** when the tool becomes visible and attended: they alt-tab to the ChatGPT
tab, they open the Copilot side panel, they click into the Cursor chat pane.

**Close** when it stops being visible or attended: they switch to another tab or
window, they collapse the panel, they close the tab.

`duration_ms` is `close_t_ms − open_t_ms`. Compute it; do not leave it out.

### The background-window case

A tool that is *visible but not being used* is the hard case, and it comes up
constantly — a chat panel docked on the right of the editor for twenty minutes
while the participant types.

**Rule: visible and readable counts as open, regardless of focus.**

A docked panel showing a response the participant can glance at is an open
session for its whole visible lifetime, even if the keyboard focus is in the
editor the entire time. Record one long open/close pair, not one per glance.

Two consequences to accept deliberately:

- A participant who leaves a panel open all session has one `ai_session_open` at
  minute 2 and one `ai_session_close` at the end. That is correct. `external_ai_seconds`
  will be large for them, and it should be.
- A tool that is genuinely hidden — minimised, on another virtual desktop, behind
  a maximised editor — is **closed**, even though the process is running.

Where you cannot tell whether a window is visible (multi-monitor session, only
one monitor captured), record what you can see and add
`"visibility_confidence": "low"` to `attrs`.

### If two tools overlap

Record both, as separate open/close pairs with different `tool_id`s. Do not
collapse them.

Use these `tool_id` values, matching
`backend/problemproof/extractors/screen/config.py`: `chatgpt`, `claude`,
`gemini`, `copilot`, `perplexity`, `deepseek`, `cursor`, `ollama`. Anything else,
write a short lowercase name of your own and tell the study lead so it gets added
to the config.

---

## 4. `capture_route` — the field that makes recall mean something

**Every `ai_output_accepted` must carry `attrs.capture_route`.**

The desktop agent detects an accept by watching for Ctrl/Cmd+V and reading the
clipboard length. That is one route out of six. The other five leave no signal
at all, so they are missed at every possible threshold setting — and if you do
not tag them, a recall of 0.6 is indistinguishable from a detector that works
fine on a participant who happens to use Copilot.

| `capture_route` | What you saw | Detectable? |
| --- | --- | --- |
| `clipboard_paste` | Ctrl+V or Cmd+V | yes — the only one |
| `inline_completion` | ghost text accepted with Tab/Enter/click | no |
| `right_click_paste` | right-click → Paste, or Edit → Paste menu | no |
| `retyped` | they read the output and typed it themselves | no |
| `drag_drop` | dragged from chat panel into the editor | no |
| `other` | an "Apply"/"Insert"/"Keep" button, an agent writing the file | no |

If you cannot tell which of `clipboard_paste` and `right_click_paste` it was —
the text appeared and you did not see the hands or the menu — use `other` and add
`"route_confidence": "low"`. **Do not default to `clipboard_paste`.** Guessing
toward the detectable route is the single easiest way to make this pilot produce
a wrong answer, because it moves misses out of the ceiling and into the
detector's error column.

`analysis/fit_accept_thresholds.py` reports the recall ceiling from these tags.
That number — "no threshold can exceed 0.62 because 38% of accepts came in
through Copilot's Tab key" — is the finding. The threshold sweep is secondary.

---

## 5. Annotate `prompt_submit` and `response_received` too

Nothing in the system captures these. There is no deterministic signal that
separates "sent a prompt" from "scrolled the page", so the extractor emits
neither, on purpose (`events.UNCAPTURED_TYPES`).

Annotate them anyway.

`event_validation.py` counts them separately and reports them as missed
*by design* rather than as extractor failures. That count is the honest measure
of what this study design cannot see, and it belongs in the limitations section
as a number rather than a sentence. "Screen and OS capture recovered accepts and
tool sessions but no prompt-level interaction (n = 214 prompts observed, 0
captured)" is a real statement about the method. "Prompt-level data was not
available" is a hedge.

- **`prompt_submit`**: the participant sends a message to an AI tool — Enter, or
  the send button. Also counts: submitting an inline edit instruction (Cursor
  Ctrl+K), a `/`-command to an agent, a regeneration. `prompt_length` is `null`
  — do not estimate it, and do not read the prompt.
- **`response_received`**: the frame where the response has finished streaming.
  For a long streamed answer, use the moment the text stops growing, not the
  first token. `response_length` and `latency_ms` are both `null`.

If the participant fires off six prompts in ninety seconds, that is six lines.

---

## 6. `verification_action`

Mark these too — they are the other half of `verification_latency`, and unlike
prompts they *are* captured, so they carry a real precision and recall.

`attrs.kind` must be one of:

- `run` — executed the code (Run button, `python solution.py`, a REPL send)
- `test` — ran a test suite, or ran against provided examples
- `lint` — a linter, type checker or formatter invoked deliberately
- `dwell` — read the code without running it for **10 seconds or more**, with no
  editing, after an accept. Scrolling through it counts; staring at an unchanged
  screen while clearly reading counts.

`dwell` is the soft one. Apply the 10-second floor strictly and do not mark dwell
during an obvious pause for thought before writing new code — it is specifically
*re-reading existing code*.

---

## 7. Procedure

1. Watch the session end to end once, without writing anything. You need to know
   what the participant's setup is — which editor, whether there is an inline
   completion tool, where the chat window lives — before the timestamps mean
   anything.
2. Watch again and annotate, pausing freely. Scrubbing backwards to fix a
   boundary is expected.
3. Spot-check ten timestamps by seeking to them and confirming the frame shows
   what your line says.
4. Validate before you hand it in:

   ```
   cd backend
   python -c "import json,sys; [json.loads(l) for l in open(sys.argv[1],encoding='utf-8') if l.strip()]" \
       data/sessions/<id>/events.annotated.jsonl
   ```

Expect roughly 2–3× the session length. A 35-minute session is a ~90-minute
annotation pass, longer for a participant who uses inline completions heavily,
because every Tab press needs a judgement.

### Things to write down outside the file

Keep a short note per session for anything the format cannot hold: a stretch
where the screen was unreadable, a moment you were unsure whether something was
an accept, a tool you did not recognise. These go to the study lead, not into
`attrs`.

---

## 8. Relationship to the phase-label passes

This is a different job from `labels.expert_a.json` / `labels.expert_b.json`.
Phase labelling tiles the session into the six phases and is done by two
annotators independently for the κ gate. AI-event annotation is done **once**,
by one annotator, and is not blinded against anything except the automatic log.

If you are doing both jobs on the same session, do the phase pass first. Event
annotation requires you to attend to the AI tool closely enough that it will bias
where you put the phase boundaries.
