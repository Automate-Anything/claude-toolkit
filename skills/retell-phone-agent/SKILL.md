---
name: retell-phone-agent
description: How to build AI phone agents on Retell, inbound and outbound, and every gotcha learned from real calls. Covers the outbound create-phone-call payload, the two-agent (phone-menu navigator + conversation) architecture, shaping the data before a call, dynamic variables, injecting the whole prompt per call from your own database, capturing results mid-call and post-call, the inbound gate that decides allow/reject before Retell connects (do-not-call, dedup, litigator lookup), the webhook signature scheme, lost-webhook self-heal, the auto-dialer, and cost caps. This is a pattern to IMPLEMENT per repository; verify any file/table/function name against the current repo first. Read it BEFORE touching anything that places, answers, shapes, captures, or debugs a Retell call. Use when the user mentions Retell, the phone agent, an AI call, create-phone-call, dynamic variables, the inbound webhook, override_agent_id, agent_swap, press_digit, DTMF, IVR navigation, post-call analysis, "no fields captured", "call looped", "call ended on hold", "no variables in Retell", a busy signal on an AI number, litigator / DNC / dedup blocking, or the auto-caller.
---

# Retell phone agents (inbound and outbound)

> ## Adapt before use
> This describes how things SHOULD be wired, taken from production systems that
> place and answer real calls on Retell. Nothing here exists in a repo until you
> build it. Names like `startCall`, `buildCallBody`, `inbound_calls`, `agent_prompts`
> are EXAMPLES of the shape, not real identifiers: grep the current repo before
> citing any of them, and when this doc and the code disagree, the code wins.
> Once the real system exists in this repo, update this file with the real file
> and table names. Re-check Retell's current API docs before relying on an exact
> field name; providers change.

Related skills: `voice-agent-prompting` (how the prompt itself is written),
`self-hosted-voice-agent` (replacing Retell with your own stack),
`phone-number-provisioning` (buying and wiring the numbers),
`voice-mishear-aliases` (recovering misheard words), `error-alert-system`.

**The alerting rule applies here.** A call that is BLOCKED by design (missing
info, outside hours, on the do-not-call list, requires a human) is not a system
error and must not alert as one. A real infra failure (provider threw, DB down,
lost webhook) must alert AND must never silently strand a call.

---

## 0. The two shapes, in one breath

**Outbound.** Intake -> a pipeline extracts and resolves the data -> assemble ONE
context object and render the prompts from it -> a start-call function picks the
number to dial and re-checks every guard -> the provider layer flattens everything
into a `create-phone-call` payload -> Retell runs the call -> Retell POSTs events
to your webhook and the agent POSTs captured data to your function endpoint
mid-call -> you finalize the call, learn from it, and deliver the result.

**Inbound.** Retell POSTs every inbound call to your webhook BEFORE connecting.
You decide allow or reject, and on allow you hand back the agent, the prompt and
the variables. Your gate sits IN FRONT of Retell.

In both shapes Retell owns the realtime loop (speech-to-text, the LLM, turn
taking, tool calling, text-to-speech). You touch the call at exactly three
moments: setup, mid-call tool calls, and call end.

Suggested module split (example shape):
- an orchestrator: number priority, guards, prompt rebuild
- a provider module that builds the exact payload (exported, so it can be inspected without dialing)
- a variables module: context -> flat `{{var}}` map
- a context assembler: the single source the prompts render from
- prompt builders
- per-counterparty profiles (menu paths, hours, caps)
- a thin webhook route (signature check only) plus an event handler module
- a function route for mid-call capture
- an auto-dialer: who gets dialed, when, retries, dedupe

---

## 1. The Retell-side config lives OUTSIDE git (check this FIRST on any capture bug)

The agents, LLMs, tools and their exact shapes are configured in Retell (through
the API: update-retell-llm, update-agent, or the dashboard), NOT in your repo.
Changing them silently breaks capture with nothing in the code to show it.
Before debugging "no fields captured" or "call ended on hold", dump the LLM tools
and agent settings through the SDK or API and verify them.

Keep a checked-in document (not the IDs themselves in a skill) that lists what
each agent must look like, so drift is detectable. What to verify:

- **The agent prompt field is a single variable and NOTHING else**, for example
  `{{ivr_prompt}}`, `{{interview_prompt}}` or `{{inbound_prompt}}`. See section 2.
- **`begin_message` MUST be "" on an outbound agent.** An inbound-style greeting
  leaks as filler on an outbound call and gives the bot away.
- **The custom capture tool has three settings that MUST be right or capture is lost:**
  - `args_at_root: false`. Otherwise Retell's request has no `call` object, your
    endpoint returns 400 "Missing call", and EVERY capture is lost. This broke
    the first real call.
  - `required: []`. No required fields.
  - LLM `tool_call_strict_mode: false`. Strict mode forced every field, so the
    model wrote the literal string "unknown" into blanks.
- **Tool args:** the captured fields in snake_case, the counterparty's name, a
  reference number, a redirect number, a `call_outcome` enum, flags for "was
  challenged as AI" and "was refused", plus injected constants such as
  `{{our_call_id}}` so your endpoint can map the save.
- **Both agents carry the cost caps:** `end_call_after_silence_ms` generous (5
  minutes) and `max_call_duration_ms` (20 minutes). A shorter silence cap (it was
  60 to 90 seconds) killed a call during a normal hold, mid-answer. Send both
  per call as well (section 4). Belt and suspenders.
- **Post-call analysis fields are named EXACTLY like the tool args.** The webhook
  uses them as the fallback capture when the tool never fired.
- **Draft agents and overrides:** `create-phone-call` with `override_agent_id`
  uses the agent's latest version, so API patches apply immediately. `get-call`
  does NOT echo `agent_override` back, so do not use it to confirm what you sent.
- **A seeded prompt must not reference tools that do not exist on this agent.**
  A prompt copied from another system that names tools (an on-call-start hook, a
  transfer tool) makes the agent call functions that 404. Strip tool sections
  when you seed a prompt.

---

## 2. The prompt rides in as a dynamic variable (prompts live in YOUR database)

The Retell agent's prompt is literally one variable. You inject the full prompt
body per call as a dynamic variable. Consequences:

- Prompt edits live in your own DB, versioned, not in the Retell dashboard.
- Versioning shape that works (example): one row per version, a partial unique
  index allowing exactly one deployed version per agent. Save = a new immutable
  version. Deploy = flip which one is live. The handler sends the deployed one.
- **Rebuild the prompts at call time. Never replay a prompt stored at intake.**
  A prompt fix then never applies to records created before it. This bit us: an
  old record kept repeating a line the fix had already removed. With a rebuild at
  dial time, any prompt change applies on the NEXT call of any record, with no
  re-intake.
- **Nothing that decides lives in a prompt.** Money, approvals, who gets through,
  what may be dialed: rows and code. The prompt says how the agent talks, never
  what it may do.

---

## 3. Dynamic variables: the rules that bite

- **ALL VALUES MUST BE STRINGS.** Flatten the whole context into a flat
  `Record<string, string>`. Objects and nulls do not survive.
- **A blank value is emitted as a single space `" "`, never `""`.** Retell chokes
  on empty-string dynamic variables in some agent configs.
- Inject your own call id (`{{our_call_id}}`) so the function endpoint can map a
  save even when the request arrives without a `call` object. Cross-check it
  against Retell's `call_id`.
- Also pass `metadata: { callId }` on the call. Map webhooks back authoritatively
  by your stored external id (Retell's `call_id`), cross-checked against the
  metadata.
- Some variables must stay LIVE Retell variables (filled or updated by Retell
  mid-call) rather than being resolved by you. See the two-bucket rule in
  `voice-agent-prompting`.

---

## 4. Outbound: shaping the data BEFORE the call (most of the value is here)

By the time you dial, the record has been groomed so the agent sounds like a
professional who already has the file open. Protect this part.

### 4a. Number priority (who is actually dialed)
Pick the number in this order:
1. an explicit **test override** ("call a different number", admin only);
2. a **human-entered** number, or a number a counterparty told the agent to call
   instead (a redirect). A person's explicit choice always wins;
3. a **verified phone-book number**: a number a PAST call proved reaches a human
   in the right department. This beats the pipeline number. Real case: the
   number printed on the customer's card was stale; the verified line should win;
4. the **pipeline-resolved** number, tagged with its source.

The tags matter. Stamp the source on every number (card, directory, verified,
entered) so the orchestrator can tell a pipeline number from a human one. An
untagged number with no resolved number to compare against is treated as
human-entered.

### 4b. ID entry rule: keypad versus speech (critical for menu success)
Compute a spoken instruction from the ID itself: all numeric (or a known prefix
the menu accepts on the keypad) -> **enter it on the keypad, do not speak it**.
Alphanumeric -> keypad the digits, say letters phonetically, confirm read-backs,
escape to a human if it keeps failing. Spoken IDs get misheard. The keypad is
the reliable path.

### 4c. What the agent already knows shapes what it says
If the system checked another source before calling (a portal, a prior lookup),
pass that state in and let it drive the script:
- has the numbers: confident "yes, I have it pulled up", may cite a figure, but
  does NOT lead with it. Only when the other side raises it.
- checked but empty: "I checked there but the info was not in there for this one".
- no access, or skipped: **never mention it unless asked**. Then a plain, true
  answer ("I tried logging in and could not get it from there").

### 4d. The create-phone-call payload
POST to Retell's create-phone-call endpoint (v2 at the time of writing). The body:
- `from_number`: a **per-location caller ID** where you have one (each location
  with its own local number), falling back to a global default.
- `to_number`: normalized to E.164.
- `override_agent_id`: the agent to start with (from settings, not hard-coded).
- `retell_llm_dynamic_variables`: the flat string map from section 3.
- `metadata: { callId }`.
- `agent_override: { agent: {...} }`. **This REPLACES the agent block for this
  call, so it must carry EVERY per-call setting.** A dashboard-only value will
  not apply once you override. It carries:
  - `voice_id`, and `voice_model` ONLY when it is compatible with the voice's
    provider (an ElevenLabs voice needs an ElevenLabs model, a Cartesia voice a
    Cartesia model, an OpenAI voice an OpenAI TTS model, and so on). An invalid
    (voice, model) pair makes Retell REJECT the call, which the user experiences
    as dead air. Write a `voiceModelMatchesVoice` check. When unsure, drop the model.
  - `voice_speed` (clamp 0.5 to 2; skip sending when it is 1),
  - `ambient_sound` plus `ambient_sound_volume` (a call-center ambience at about
    0.5 makes it sound like a real office),
  - `max_call_duration_ms` and `end_call_after_silence_ms`: the COST CAPS, always sent.

Retell is an ASYNC platform. Placing a call returns "accepted" with an external
id; the outcome arrives later by webhook. Model that explicitly (for example
`{ mode: "async", externalId }`).

A `402` / "credit balance exhausted" is surfaced as a friendly, typed error with
a user message. It does NOT raise a critical alert: it is expected and
self-service (only the account owner can top up credit).

Export the payload builder and add an admin "payload inspector" that
reconstructs the identical body WITHOUT dialing. It pays for itself the first
time a call misbehaves.

---

## 5. The two-agent call flow (menu navigator + conversation)

1. **The menu agent** navigates the phone tree using a per-counterparty profile
   (the "magic word" that reaches the right department, the ordered menu steps,
   keypad entry). It speaks only to machines: presses digits with `press_digit`,
   says short menu options, stays silent on holds and recordings.
2. **Handoff.** The instant a LIVE human OR a conversational bot starts the real
   conversation, the menu agent calls an `agent_swap` tool (keep the current
   voice) to the conversation agent. Only the conversation agent has the capture
   tool, so if the menu agent kept going the data would be lost.
3. **The conversation agent** does the human conversation: gives identity when
   asked, asks its questions one at a time, and calls the capture tool MID-CALL
   as it hears each value (the reliable capture path). At the end it saves the
   other person's name and the reference number.

Give the menu agent the capture tool too, for one purpose: reporting a bail-out
outcome (for example "the system rejected our ID") before it ends the call.

**Transcript labeling:** label turns before the swap fired as the menu agent and
turns after as the conversation agent. Labeling everything as the conversation
agent once hid a 20-minute menu loop.

---

## 6. Capturing the result (two paths plus a self-heal)

- **Mid-call (primary):** the capture tool POSTs to your function endpoint.
  Verify the Retell signature, map to your call row, drop junk values
  ("unknown", "n/a"), merge captured fields (decide which side wins on conflict
  and write it down), store name, reference, redirect number and outcome.
- **Post-call (fallback):** the webhook reads `call_analysis.custom_analysis_data`
  (the same snake_case names as the tool args). This is how a call that DROPPED
  before the agent saved still keeps its data.
- **"Reached a human" is derived from TOOL CALLS** (did the swap or the capture
  tool fire), not from "there is a transcript". Menu bots produce transcripts too.
- **Lost-webhook self-heal.** Put the webhook body in an event-handler module;
  keep the route a thin signature verifier. A reconciler runs on every cron tick:
  any call still in a live state (dialing, in menu, in conversation) after about
  25 minutes is checked against Retell and finalized through the SAME handler.
  This exists because a memory-limit restart once ate a `call_analyzed` webhook
  and stranded a call. Size the instance properly as well; the reconciler is the
  backstop, not the fix.
- **Idempotency.** Retell delivers the terminal webhook more than once (both
  agents, `call_ended` plus `call_analyzed`). Give transcript turns a stable
  sequence base so re-delivery is a no-op (`ON CONFLICT DO NOTHING`). Any
  follow-up action triggered by a webhook (an automatic re-dial to a redirect
  number) uses an atomic claim.
- **Where the artifacts are:** the recording URL, transcript, transcript object
  and `call_analysis` (summary, sentiment, success flag, voicemail flag) arrive
  in the call-ended / `call_analyzed` payload under the call object. Store the
  raw event, then extract the fields you report on.

---

## 7. Inbound: the gate in front of Retell

### 7a. The decision flow
Order matters: cheapest and most authoritative first, the paid lookup last.

1. **Parse the body, then LOG the hit**, even one you are about to reject (7c).
2. **Signature check** (section 8). Reject 401 if enforced and invalid.
3. **Anonymous / no caller ID: reject first.** A blank `from_number` otherwise
   skips every list and falls through to allow.
4. **Your own do-not-call list.** Free and authoritative. Reject.
5. **Dedup** against a prior-calls list. Free. Reject with reason `duplicate`,
   which also skips the paid lookup. On ALLOW, record the caller so the list
   maintains itself.
6. **The paid blocklist / litigator lookup**, with a per-agent policy (which
   categories block). Reject if blocked.
7. **Allow.**

Every path writes a row to the inbound-call log.

**Fail OPEN on your own outages** (DB down, lookup error): never drop a
legitimate caller because YOU broke. Report the failure; let the call through.

### 7b. The response shape
Reject: `reject: true` knocks the call down. Allow:

```
{ "call_inbound": {
    "override_agent_id": "<the agent you chose>",
    "dynamic_variables": { "from_number": "...", "inbound_prompt": "<deployed prompt body>" },
    "metadata": { "inbound_log_id": "<your log row id>" }
} }
```

### 7c. Landmines (each cost real debugging)

- **Log the hit BEFORE you reject.** The original bug: a signature reject
  returned before writing the log row, so a rejected or misconfigured call left
  ZERO trace and debugging was blind. Parse, insert a log row (decision `error`,
  reason `bad_signature:<why>`), THEN return 401. Keep it that way: an empty log
  must mean "Retell never called us" and nothing else.
- **An empty log means Retell is not pointed at you.** Zero rows after a test
  call means the inbound webhook is not set on the Retell NUMBER (it is per
  number / per SIP trunk, NOT per agent), or it points elsewhere. Prove your side
  with a direct probe: a GET to the route returns ok, an unsigned POST returns
  401. If those work, the gap is Retell config, not your code. The agent that
  answers in Retell's own log may differ from the one you registered; the
  `override_agent_id` fixes that, but only if the webhook fires at all.
- **Retell sends NO agent id on the inbound webhook** when the number is
  deliberately bound to no agent (you pick it). So an allow response MUST always
  set `override_agent_id` from your own agents table. Otherwise Retell has no
  agent to connect, drops the call with NO history entry, and the caller hears a
  busy signal while your UI shows "allowed". Do not make sending the agent
  conditional on Retell having sent one.
- **Linking call-ended back to the inbound decision row.** The inbound webhook
  has no call id yet, so your log row starts with a null provider call id. Send
  your row id in `metadata` on allow; Retell echoes it on call-ended. JOIN ON
  THE METADATA ID, not the call id. Also stamp the provider call id back on the
  row at call-ended so joins work both ways.
- **Nothing works for a live call until it is deployed AND the number points at
  the deployed URL.** After a test call read the log: signature valid plus
  decision allow means working; `bad_signature:*` means the scheme is still off;
  no row means Retell is not pointed at you.

### 7d. Phone number normalization
Key every list on ONE normalized form. For a US-only system: 10 digits, strip
non-digits, drop a leading 1 from an 11-digit number. Do-not-call, dedup and the
paid lookup all use the same function so every formatting of the same number
matches. (For dialing, normalize to E.164 instead. Do not mix the two.)

### 7e. Paid blocklist / litigator lookup quirks
From a production integration with a litigator-scrub vendor; expect the same
class of quirks from any of them:
- **Do not trust the documented response type.** The `code` field came back as a
  STRING ("none", a single code) where the docs implied an array. Normalize
  string, comma-separated string and array through one helper.
- Know the full vocabulary of both the codes (pre-litigation, plaintiff,
  attorney, anti-telemarketing and so on) and the overall message (good,
  blacklisted, suppressed, federal DNC, state DNC), and make which ones block a
  per-agent toggle, defaulting to litigators only.
- The vendor publishes test numbers that return a blocked and a clean result.
  Use them in tests instead of real numbers.
- Fail OPEN on a lookup error, and report it.

---

## 8. The Retell webhook signature scheme (this cost real debugging)

Read Retell's "secure webhook" doc before writing a verifier. The scheme is NOT
a plain HMAC of the body. Get ANY part wrong and you 401 every real call, which
shows up as "no variables in Retell", empty logs, and the caller hearing the
number's default agent (a busy signal, or a stale flow agent).

- The `X-Retell-Signature` header value is **`v={timestampMs},d={hexDigest}`**.
  Parse both parts. Do not treat the whole value as the digest.
- Digest = **HMAC-SHA256(rawBody + timestamp, API key)**. The timestamp is signed
  TOO, not only the body. The secret is the API key; there is no separate
  webhook secret.
- **Freshness:** reject if the timestamp is more than 5 minutes from now (replay guard).
- Use the **raw body string** (read the request as text). Never re-serialized JSON.
- This mirrors the SDK's `verify(rawBody, apiKey, signature)`. If unsure, install
  the SDK and call that instead of hand-rolling.

**The meta-lesson, for every provider:** READ THE PROVIDER'S AUTH DOCS before
writing a verifier. And do NOT "verify" a verifier by signing the test with your
own (possibly wrong) method. That only proves the code agrees with itself. Test
against the provider's exact documented format, or a captured real request.

---

## 9. Every trick and gotcha learned on real calls

Each came from a real failure. Do not undo one without understanding why.

**Phone menus and keypad tones**
- **Keypad tones get dropped.** A menu read an ID back as 8 or 9 of 10 digits and
  said "not found"; the ID was correct. Fix: raise the `press_digit` delay (800
  to 1500 ms, so it starts after the prompt finishes), AND have the prompt compare
  the read-back digit by digit and re-enter in two 5-digit chunks (or say the
  digits slowly) before concluding anything. **Never blame the other side's data
  for a "not found" until the read-back matches what you sent.**
- **Never answer a machine's yes/no or menu prompt with a sentence.** Saying "I
  am a provider" to "say yes or press one" loops forever. Press the digit or say
  the exact option word.
- **The ID-rejected ladder:** re-enter the first ID once, then try the alternate
  ID, then escape to a person once, then save the outcome `id_rejected` and end
  the call. Never repeat the same thing more than twice. `id_rejected` is its own
  stage and is NEVER auto-retried (dialing again hits the same wall). A person
  confirms the IDs.

**Sounding human and getting past gatekeeping**
- **Never go silent after "are you AI?"** Dead air is the biggest tell; someone
  said "hello?" into the silence and hung up. First ask: light, keep moving.
  Second or sincere ask: honest ("I am an automated assistant from the office, I
  have the IDs here, can we keep going?"). Then try a supervisor, offer to hold,
  "it is routine". Never claim to be human.
- **Never promise "someone from our office will call you back."** Nobody does.
  The client pays so that no human has to. Remove any such line.
- **One person saying no is not the company saying no.** A `refused` outcome
  under the attempt cap becomes a retry, and the auto-dialer re-dials to reach a
  DIFFERENT person. Only after 3 attempts does it go to a human caller.
- **Answer only what was asked.** "Can I get your name?" gets the name, not name
  plus company plus reason in one breath. That info-dump is a script tell. Do not
  repeat the same sentence. Say addresses naturally (street number as a number,
  ZIP as digits). Never leave a direct question hanging.
- **Do not lead with what you already know** (4c).

**Per-counterparty quirks (keep them in profiles, not in the base prompt)**
- Some companies' bots will NOT read the answer aloud. One demanded a fax number
  and hung up without one, with its people behind a passcode. Ladder: try
  "representative" once; if it insists, give the client's own fax number from
  settings so the result is faxed to the client (a real result), then save
  `partial`. With no fax on file, save `refused` and name what it demanded.
- Every company has a magic phrase. One wanted "coverage and benefits", not
  "eligibility". Store the phrase per company.
- Profiles carry the hours when humans answer. Outside them only the menu
  answers, so the orchestrator refuses to auto-dial (a wasted call).
- Profiles carry the explicit not-found branch of that company's menu.

**Timing, cost, reliability**
- **The silence cap must be generous** (5 minutes). A normal "let me look that
  up" hold killed a call at 90 seconds.
- **Cost caps are always sent per call** (20 minutes max) so a looped or held
  call ends itself.
- **Lost webhooks happen.** Build the reconciler (section 6) on day one.

**Data quality**
- If captured values can belong to two categories (in-network versus out-of-
  network, per person versus per family), a single flat field set will mix them.
  Split the categories in the tool schema up front, or flag the gap loudly
  wherever captured values are read or relayed.

---

## 10. The auto-dialer: who gets dialed, and when

Make the selection a PURE function so it can be tested without dialing.

- **Only auto-dial records that came in unattended** (for example by email). A
  record a person is driving by hand is never auto-dialed; they click the button.
- **One call per tick**, oldest never-called first, then retries by longest wait.
- **Auto-retry** retryable outcomes (`retry`, `partial`) after a backoff (60
  minutes), up to a cap (3), then a person takes it.
- **Never retried:** verified/done, needs-human-caller, needs-review, id-rejected.
- **Dedupe:** skip a record if another record for the same subject and
  counterparty is already done or was called within a window (24 hours).
- **Business hours** are gated up front AND again inside the start-call function.
- Run it from a cron hitting an authenticated route, with a kill switch env var.

---

## 11. When you change something here, verify it the real way

- **Never trust a green typecheck as "it works" for a call change.** Place a real
  test call (the admin "call a different number" override, to your own phone)
  and read the transcript.
- On a "no fields captured" bug, dump the Retell LLM tools FIRST (section 1)
  before touching your code. The tool shape is the usual culprit.
- On a "call looped" or "ended weird" bug, read the actual transcript and the
  Retell `disconnection_reason`.
- On an inbound "nothing happened" bug, read the inbound log first (7c).
- Run the repo's error-wiring check; see `error-alert-system`.
