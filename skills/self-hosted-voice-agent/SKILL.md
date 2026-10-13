---
name: self-hosted-voice-agent
description: How to build and run your OWN realtime AI phone agent on a self-hosted Python Pipecat runtime instead of a hosted voice platform such as Retell, with SignalWire as the carrier, taken from one real product's working implementation (code included under reference-impl). Covers the two systems never to conflate (the AI brain versus the human telephony layer), the four seams to replace a hosted platform, the session handshake, the exact HTTP contract between the app server and the runtime, the SignalWire Connect/Stream media bridge, the Pipecat pipeline (Deepgram STT, OpenAI LLM, Cartesia TTS, Silero VAD plus Smart Turn, or OpenAI Realtime speech-to-speech), the shared tool library and multi-prompt state machine, voices and Cartesia voice cloning, ambience and backchannel, inbound and outbound and campaigns, mid-call push, recording, post-call and billing, the two-layer gate with per-number cutover, cost math, security rules and every landmine hit so far. Read it BEFORE any work on a self-hosted phone agent or on replacing a hosted one. Use when the user mentions Pipecat, self-hosted voice, replacing Retell, a voice runtime or voice-rt, a media stream, SignalWire stream or Connect Stream, STT, TTS, turn detection, barge-in, voice cloning, Cartesia, Deepgram, OpenAI Realtime, outbound AI calls, voice campaigns, mid-call control, per-minute voice cost, or "make the phone agent cheaper / more flexible / more human".
---

# Self-hosted voice agent: how it works, and how to replace a hosted platform

> ## Adapt before use
> This is ONE real product's implementation (a multi-location booking SaaS that moved
> its phone AI off Retell onto its own Pipecat runtime, with SignalWire as carrier).
> It describes how things SHOULD be wired; nothing here exists in your repo until you
> build it. Table, file, route, env and service names (`voice-rt`, `app-server`,
> `voice_numbers`, `retell_prompt_flags`, `/api/internal/voice-agent/...`) are
> EXAMPLES of the shape: grep the current repo before citing any of them, and when
> this doc and the code disagree, **the code wins**. The build-status claims in
> `reference-impl/plans/` are a snapshot of one moment (September to October 2026),
> not the state of any repo you are in. Model names, prices and library versions are
> a snapshot too; re-verify them. Keep a phased plan doc in your repo next to this
> skill and update the names once your system exists.

**What is in this skill folder**
- This file: the architecture, the decisions, the lessons, the landmines.
- `references/endpoints-and-payloads.md`: every route both directions, headers,
  request and response JSON, status codes, the exact cXML, the WebSocket handshake.
- `references/environment-and-deploy.md`: every env var with its default, the
  Dockerfile, pinned requirements, hosting, process model, the first-call runbook.
- `references/pipeline-and-audio.md`: the Pipecat pipeline stage by stage with every
  setting, turn detection, the tools bridge, state switch, first line, inject,
  ambience mix, recording, observers and error classification.
- `references/data-and-voices.md`: DB columns from the migrations, tables the code
  uses, the Cartesia voice catalogue with public voice ids, voice resolution, cloning.
- `reference-impl/`: the real code, scrubbed. Map at the end of this file.

Related skills: `retell-phone-agent` (the hosted platform being replaced),
`signalwire-docs` (look up call models and cXML before touching the bridge),
`phone-number-provisioning`, `voice-agent-prompting`, `security-rls-permissions`,
`error-alert-system`, `database-write-safety`.

> **Owner rule.** An agent never commits, pushes or deploys on its own initiative.
> The product's plan contains lines like "deploy: push the working tree to dev". In
> this library that is an owner action: do it only when the owner asks in the
> conversation. The same goes for applying migrations and setting production env vars.

---

## 1. The one thing to understand first: TWO systems, never conflate them

| System | What it does | Status in a migration |
|---|---|---|
| **The AI phone-agent BRAIN** (the hosted voice platform) | Runs the ENTIRE realtime loop of a live call: STT, LLM, turn taking, tool calling, TTS | **Replaced** by your Pipecat runtime |
| **Human telephony** (the carrier, here SignalWire) | PSTN numbers, inbound routing, IVR, queues, softphone, transfer and conference, recording, voicemail | **Kept and reused** as the carrier and media on-ramp |

"The AI that answers and books for callers" is the brain (replace). "Routing, queues,
softphone, transfer, IVR, voicemail" is the carrier layer (keep). IVR and voicemail
greetings (generated TTS) and voicemail transcription are ALSO separate from the AI
agent; do not touch them when working on the brain.

The naming collides: in the reference product, `voice_agent_shift_events` (in
`reference-impl/sql`) tracks HUMAN call-center agents' presence, while `voiceAgent/`
is the AI. Read the code, not the name.

## 2. What the hosted platform does, and the FOUR seams to replace it

A hosted platform touches your app at three moments; in between it owns the call:
1. **Call setup:** its inbound webhook hits your handler, which runs a decision tree
   (tenant lookup, gates, enrichment) and returns prompts, dynamic variables and a
   voice. Ideally nothing is baked per tenant into the platform, just a couple of
   GLOBAL agents.
2. **Mid-call:** the agent calls YOUR tool HTTP endpoints.
3. **Call end:** it posts a call-analyzed event to your post-call handler.

The four seams (the whole integration surface), with what the reference built:

| Seam | Hosted version | Self-hosted version in reference-impl |
|---|---|---|
| 1. Media bridge | carrier SIP-connects to the platform's gateway (`voice/aiForward.ts`) | cXML `<Connect><Stream>` to your WebSocket (`voiceAgent/laml.ts`, `voice/inboundLaml.ts`) |
| 2. Setup orchestrator | platform webhook handler | the same decision tree refactored into a provider-agnostic `resolveInboundCall()` plus a thin adapter per provider; `buildVoiceAgentSession()` turns it into the runtime context (`voiceAgent/session.ts`) |
| 3. Tool endpoints | platform calls your HTTP tools | the runtime proxies every tool call to ONE app-server endpoint that runs the SAME shared dispatcher (`voiceAgent/tools.ts`) |
| 4. Post-call ingestion | platform's call-analyzed webhook | runtime posts an end payload; the app server runs its own LLM analysis and feeds the SAME post-call writer (`voiceAgent/postCall.ts`) |

## 3. What you already own (do NOT rebuild) and what is new

**Reuse:**
- **The prompt system.** Prompt slots plus fragments, a template resolver, per-call
  dynamic variables. Render prompts in the main backend and hand the runtime FINISHED
  text (one renderer, no Python fork). The reference substitutes `{{var}}` tokens in
  Node (`substituteDynamicVars`; unknown tokens stay literal, as the hosted platform did).
- **The tools.** If a chat agent (SMS, WhatsApp, webchat) already shares tool handlers
  with the phone agent, that IS the shared library. The phone agent gets
  `TOOL_DEFS + VOICE_ONLY_TOOL_DEFS` and dispatches through the chat agent's
  `dispatchTool`. Add a capability to the chat library and the phone agent has it on
  the next call, with zero runtime change.
- **The chat-agent loop.** The voice agent is the same brain with a media front end.
- **Billing and schema.** Call history, usage and pricing tables that are provider
  agnostic.
- **Number lifecycle, suspension, carrier glue, E911, recording storage.**

**New (the actual build):**
- **The runtime (`voice-rt`):** Python, FastAPI, Pipecat, a separate deployable.
- **The session handshake:** the app server builds the full context, stashes it, and
  returns `<Connect><Stream>`; the runtime claims it on WebSocket connect.
- **Outbound,** single and campaign; the agent speaks first on outbound.
- **Voice catalogue and cloning** (Cartesia), with consent capture.
- **Mid-call server push** (inject context, say verbatim, hang up). Trivial once you
  own the loop.
- **Durability the hosted platform gave you for free:** orphaned-call reconcile,
  heartbeat, missing-recording alert.

## 4. Guiding principle: copy what already works, build only the delta

If a working Pipecat build exists anywhere you can reach, treat it as a parts bin.
For EVERY component ask "does that build already do this well?" If yes, PORT it
(adapt names and tenancy); build fresh only when it lacks the thing or its version is
genuinely not good enough. Keep a file-by-file port / adapt / skip inventory in the
plan doc (the product's is in `reference-impl/plans/...PLATFORM_PLAN.md` section 9.1).
- **Port:** transport (mu-law to PCM, resampler, VAD at the transport), barge-in, turn
  presets, failover, the pipeline factory, careful teardown.
- **Adapt the ideas:** a flow engine and node registry, the tool-execution model,
  agent versioning, RAG.
- **Do not bring:** another product's tenancy model, its multi-host topology, its dev
  tooling, stale docs and naming. You want ONE system in this repo.
- **Re-verify every ported file against Pipecat's CURRENT API and pin the version.**
  The parts bin targeted Pipecat 0.0.108; the reference runtime is written against
  1.11.0 and uses that release's names (`PipelineWorker`, `WorkerRunner`,
  `LLMContext`, `LLMContextAggregatorPair`, the `<Service>.Settings(...)` config
  objects). Check each against the version you pin.

---

## 5. Architecture as built

```
[PSTN caller]
     |
[SignalWire number]  posts the inbound LaML webhook to:
     |
[app server, the brain]  resolveInboundCall (tenant, gates, enrichment, rendered prompts,
     |                   voice, tools); stores the session in memory as vrt_<32 hex>;
     |                   answers with cXML <Connect><Stream url="wss://voice-rt/ws?session_id=...">
     |                   plus <Parameter name="session_id">
     |
[SignalWire] opens a bidirectional 8 kHz mu-law WebSocket to:
     |
[voice-rt, Pipecat]  calls the app server (X-Voice-Agent-Secret):
                       GET  /api/internal/voice-agent/sessions/{id}   claim, single use
                       POST .../sessions/{id}/tool-call                every tool, proxied
                       POST .../sessions/{id}/events                   state, heartbeat, errors
                       PUT  .../sessions/{id}/recording                stereo WAV
                       POST .../sessions/{id}/end                      transcript, usage, latency
                     is called by the app server:
                       GET /health, POST /sessions/{id}/inject, POST /sessions/{id}/hangup
```

### 5.1 The session handshake

1. The carrier posts the inbound webhook. The app server runs the decision tree and
   gets `hangup`, `transfer` or `live`.
2. For `live` (and only after the gate passes, section 9) it builds a
   `VoiceAgentSession` (server-only: contact, dynamic variables, the tool-dispatch
   payload, transfer number) and a `VoiceRtSessionContext` (the subset the runtime
   needs: rendered prompts per state, voice config, tool schemas and routing,
   settings including the begin message). No secrets, no DB access in the context.
3. It returns `<Connect><Stream>` with `session_id` both as a `<Parameter>` and on the
   URL query, followed by `<Hangup/>`.
4. The carrier opens the WebSocket. voice-rt reads the `start` message, takes
   `session_id`, and claims the context over HTTP with the shared secret. The claim is
   single use: a replayed id gets 410 and the socket closes, so the carrier runs the
   trailing `<Hangup/>` and the caller is never parked.
5. voice-rt builds the pipeline, speaks the begin message, runs the call, and on any
   exit uploads the recording and posts the end payload. The app server acks with 202
   and finalizes asynchronously.

**Where the session lives.** The original design (and the earlier version of this
skill) said Redis keyed by `session_id`. The reference build uses an IN-MEMORY map in
the app server (`sessionStore.ts`) because that stack had no Redis and ran ONE
app-server instance; the pre-connect window is about a second, and the durable record
is the call-history row written at the end. If you run several app-server instances,
you need a shared store (Redis or a table) with the same single-use claim semantics.

Session store lifecycle and timers: `pending` (cXML returned) to `live` (claimed) to
`ended` (end posted). A sweeper runs every 60 s: pending older than 3 minutes is
removed and reported (`voice_agent_session_unclaimed`, check the runtime URL and
health); ended older than 10 minutes is removed; live older than 3 hours is a leak
(reported); live with NO event for 5 minutes is treated as a dead runtime and
reconciled into call history (section 12).

### 5.2 The runtime process model

The original design said "the Python GIL forces ONE process per concurrent call, so
build a dispatcher and warm pool". The reference build decided otherwise: ONE uvicorn
process runs MANY calls, each as an asyncio task with its own WebSocket and pipeline
(Pipecat 1.x is asyncio native; STT, LLM and TTS are network I/O; Silero and Smart
Turn are small CPU models). A `MAX_CONCURRENT_CALLS` guard (default 40) closes new
sockets with code 1013 above capacity. Scale by instance size and count. Measure CPU
per call on your host before choosing; if a single process saturates, move to
process-per-call or a worker pool. No dispatcher or warm pool exists in the reference.

---

## 6. The stack and the two engines

- **Pipecat** (BSD-2), pinned `pipecat-ai==1.11.0` with extras
  `websocket,deepgram,openai,elevenlabs,cartesia,anthropic,google`.
- **SignalWire** as carrier, through its Twilio-compatible cXML and REST: Pipecat's
  `TwilioFrameSerializer` with `base_url = https://<space>/api/laml`. `<Connect><Stream>`
  is **cXML only**, so a number on the self-hosted agent must be bound to the LaML
  inbound path. Enforce that at switch time and alert on drift. Use `signalwire-docs`
  before touching it.
- **Turn detection:** Silero VAD plus Smart Turn v3 (`LocalSmartTurnAnalyzerV3`, local
  CPU, free). Both models are warmed into the Docker image at build time.

**The voice engine is selectable** (`chained` or `s2s_openai`). In the reference it is
ONE global env var (`VOICE_AGENT_DEFAULT_ENGINE`); per-agent selection (a column on an
agent row) is designed but not built. Both engines share the prompts and the tools.

| Engine | Pipeline | Voice | Notes |
|---|---|---|---|
| **chained** (the real default) | Deepgram STT (`nova-3-general`, `language="multi"`) then Silero plus Smart Turn then OpenAI LLM (`gpt-4.1` fallback, temperature 0.4, max 400 tokens) then Cartesia TTS (`sonic-3.6`) | Cartesia catalogue and clones; ElevenLabs only as a fallback | Full control of speed, tone, voice and cloning. Deterministic tool control. Predictable per-component cost. |
| **s2s_openai** | OpenAI Realtime (`gpt-realtime-2.1` fallback) does audio in, audio out, tools, semantic turn detection (eagerness `medium`), near-field noise reduction | OpenAI presets (`marin`, `cedar` judged most human) | Lowest latency, fused model: you cannot swap STT or TTS for that call. The owner judged it "not human enough" after live tests and kept chained as default. Keep it as an option; do not delete it. Enforce prompt caching or cost balloons (the reference does nothing explicit for caching yet). |

Full settings: `references/pipeline-and-audio.md`.

**Sell the engines as product tiers, not a raw toggle:** "Standard voice" (chained) and
"Lifelike / Premium voice" (speech-to-speech), priced per minute differently, with a
play-the-difference sample on the settings screen. The reference already tags usage
rows by tier (section 12).

**Fallback.** Built: a CONNECT-TIME fallback. If the S2S pipeline fails to construct
(bad key, model unavailable), voice-rt rebuilds once as chained before any audio
flows and posts an `engine_fallback` event. A mid-call engine swap is deliberately NOT
built: it would tear down the live audio bridge and sound worse than it prevents; a
Realtime failure after audio starts ends the call (reported) and the next call tries
S2S again.

**Do not gate launch on voice cloning, and do not build on a provider's hosted
agent-builder product or its native SIP entry point.** Native SIP into a model
provider cedes the audio path and bypasses your tools.

**What makes it the BEST agent** (build these in, the voice is table stakes):
1. breadth of SAFE action through the shared tool library under the caller's real
   permissions (book, reschedule, payment link, balance, waitlist, knowledge base,
   transfer);
2. latency as a feature (target 800 ms or less voice to voice; measure it);
3. it knows the caller before "hello" (reuse the enrichment);
4. barge-in, backchannel, never dead air on a tool call (typing ambience);
5. outbound as a first-class feature (reminders that rebook, waitlist fill, win-back,
   review requests);
6. the owner-facing builder is the moat: a new agent should be a row plus tool ids.

---

## 7. Tools: one library, defined once, proxied by the runtime

- **Tools are defined ONCE in the main backend. The runtime defines none.** The app
  server sends OpenAI-format function schemas plus a `tool_routing` map in the session
  context; voice-rt wraps each in a Pipecat `FunctionSchema` whose handler either acts
  locally or POSTs `{name, arguments, step}` to `/tool-call` and feeds the JSON result
  back to the model.
- **Routing values:** `local_state_switch` (swap the system prompt in the runtime),
  `local_end_call` (let the goodbye finish, then end), `transfer_call` (announce, wait
  for the audio to finish, then ask the app server to redirect the leg), `server`
  (everything else).
- **Voice-only tools** (in `voiceAgent/tools.ts`): `set_caller_identity` (pick which
  contact is calling when several share a number; pins the contact for every later
  tool), `transfer_call` (offered ONLY when a human transfer number exists, so the
  model never calls a dead end), `end_call`, `mark_do_not_call` (scope `marketing` or
  `all`), `check_availability_recurring` (an alias), and six state-switch tools.
  Aliases map phone-prompt names to chat-library names (`set_call_location` to
  `set_conversation_location`).
- **Tool names are load-bearing.** The live prompt bodies call tools by exact strings
  (in the reference: `checkAvailability`, `CreateAppointment`, `CancelAppointment`,
  `UpdateAppointment`, `findAppointments`, `ListAppointments`, `AddToWaitlist`,
  `SendPurchaseLink`, `SendGiftCardLink`, `SendMembershipPurchaseLink`,
  `CheckPaymentStatus`, `UpsertNameInContacts`, `verifyDayMatchesDate`). Renaming one
  means re-reading every prompt slot. The chat tool schemas themselves
  (`ai/chat-agent/tools.ts`) are not covered by the reference implementation.
- **Per-currency wording:** the same `toolDefsForCurrency` wrap the chat agent uses
  rewords money parameters for a non-USD location.
- **Never dead air on a tool:** while a `server` tool is in flight the runtime sets
  `tool_working`, and the ambience mixer fades in keyboard typing.
- **Failures never hang the model:** a transport error or non-200 becomes
  `{"error": ..., "kind": "internal_error"}` for the model to narrate.

**The multi-prompt state machine (hosted-platform parity).** Seven states
(`starter, booking, cancel, update, confirmation, questions, name`), each a rendered
prompt. A state-switch tool replaces the system prompt and the model continues in the
same turn: on chained, the first context message is edited IN PLACE (replacing the
whole list mid-tool-call can orphan the tool_call/result pair and the provider rejects
it); on S2S, an `LLMUpdateSettingsFrame` with new instructions. The switch IS the
agent-to-agent hand-off. The product skill says the new state's prompt should open
with a hand-off line ("you are picking up an ongoing call, do not repeat the greeting,
address the last request immediately"); the reference code adds no such line, so put
it in the state prompts or add it in `switch_state`.

**Agent-config-as-data (designed, not built).** A canonical tool definition (name,
description, JSON schema, handler pointer, permission, side-effect class,
confirm-required) stored as data; agents reference tools by id; scope tools mid-call
with Pipecat's set-tools frame or Pipecat Flows per node. The reference ships the
code-defined library only (`voice_agents` and `voice_agent_tools` do not exist).

---

## 8. How it sounds (the values tuned by ear on real calls)

**Begin message.** A fixed first line spoken verbatim the instant the call connects,
before any LLM turn (an LLM left to open on its own improvises, for example inventing
a business name). The app server renders
`"<business name>, this is <receptionist name> speaking, how can I help you?"`
(`renderBeginMessage`; business name = the location name, or the company name on a
number shared by several locations; fallbacks "our office" and "the front desk") into
`settings.greeting`. voice-rt queues `TTSSpeakFrame(greeting, append_to_context=True)`.
Outbound sends `greeting: null`, so the model opens with who, where from and why. To
make the line editable per location, store a template field and read it in
`renderBeginMessage`.

**Voice delivery (Cartesia `generation_config`).** The first live test sounded "wild",
too energetic. Settled defaults: speed 0.88 (slightly slow, unhurried), emotion
`neutral` (`content` is the warmer option), volume 0.9. A per-location speed override
rides on the voice bundle's `voice_speed`. To tune, change the three `DEFAULT_CARTESIA_*`
constants in `voiceAgent/voices.ts`.

**Voices.** Ten Cartesia `sonic-3.6` voices grouped by gender, defaults Allie (female)
and Cory (male), including accented voices (Spanish voices reading English) that read
as more human. Full table with public voice ids: `references/data-and-voices.md`.
Loudness lesson: Cartesia voices differ a lot in level (Allie about 9.5 dB louder than
Cory); normalize to a common target (about -16 LUFS) before mixing ambience. The
reference runtime does NOT do this yet.

**Multilingual, automatic, no toggle.** Deepgram runs with `language="multi"`, every
state prompt is prefixed with a directive to reply in the caller's language, and
`sonic-3.6` speaks 44 languages with the same voice. The runtime does not pass a
language to Cartesia.

**Ambience.** A custom `AmbientMixer` on the output transport mixes a real CC0 office
bed under the whole call (volume 0.035; 0.12 was far too loud on a real phone) and
keyboard typing that swells only while a tool runs (0.22, 0.25 s ramps). Its only job
is a faint "you are on a live line". Per-call off switch `settings.ambient_sound=false`.

**Backchannel.** The community `pipecat-backchannel` package (not built from scratch,
not a Pipecat built-in) says "mhm" in the bot's own voice while the caller talks. Tuned
INFREQUENT ("not so often, it's annoying"): eligible after 2.5 s of caller speech,
probability 0.3, 12 s cooldown. Chained engine only, English only, off switch
`settings.backchannel=false`.

**Turn taking.** Presets `fast` (stop 0.15 s), `balanced` (0.2 s, always sent today),
`patient` (0.4 s). Lower stop = snappier and more likely to cut the caller off. To
match a tuned hosted agent, port its interruption sensitivity and endpointing into a
preset. Still open in the reference: denoising (a Pipecat input filter before STT),
end-on-silence, and explicit interruption settings.

**Max call length.** Inbound 10 minutes (the hosted agent was 7), outbound 30 minutes;
the runtime falls back to 1 hour if unset.

---

## 9. Inbound routing and the gate (how it is turned on, and back off)

**Two layers, both must be open for every call**, else the caller goes to the human
fallback (the location's transfer number, or a hang-up). Fails CLOSED.
1. **Master switch:** `VOICE_AGENT_ENABLED=true` on the app server. Off = the whole
   feature is inert. This is the kill switch.
2. **Targeting:** the business (company or location id) is listed in an existing
   per-tenant flag (`self_hosted_voice_agent` in `retell_prompt_flags` in the
   reference; reusing an existing flag system saved a table and a UI).

`evaluateVoiceAgentGate(companyId, locationId)` returns `{allowed, reason}` with
reasons `master_off`, `company_not_targeted`, `flag_lookup_error`. A flag read error
is reported and closes the gate. `shouldUseSelfHosted()` is the ONE routing helper
everything keys off, so "turn it on for everyone" is a one-line change (return true)
and then retiring the hosted platform.

**Where it is enforced:** switching a number to self-hosted, enabling AI on a number
with the self-hosted provider, EVERY inbound answer (a closed gate on a switched number
pages `voice_agent_gate_closed` and sends the caller to the human), every outbound
call, campaign creation, and the operator voice picker and cloning routes.

**Per-number cutover (reversible, never a flag day).** `switchAiProvider(number,
'pipecat')` requires the gate, `VOICE_RT_URL`, and the LaML inbound resource id; binds
the number to the LaML inbound resource; best-effort unregisters it from the hosted
platform; sets `ai_provider='pipecat'` and clears the hosted agent id and SIP URI.
Switching back re-imports the number into the hosted platform. Error codes:
`not_found`, `inactive`, `ai_not_enabled`, `gate_closed`, `runtime_unconfigured`,
`laml_unconfigured`, `laml_bind_failed`, `retell_register_failed`, `db_write_failed`.

**The inbound branches** (`voice/inboundLaml.ts`), each handing the caller's leg to
`answerInboundWithPipecat`:
1. Direct AI dispatch when the number's stored `ai_provider='pipecat'` and AI is active.
2. IVR "talk to the AI" node.
3. Queue overflow to AI. The self-hosted agent cannot be dialed INTO a conference (it
   is a stream on the caller's own leg, not a SIP endpoint), so the code ends the
   conference and the post-conference action hands the leg to the runtime.
4. Overflow-only path, and 5. the post-conference ring-out action.
A suspended number (`ai_active=false`) skips AI dispatch entirely, because a hosted
SIP dial is billable on connect.

`answerInboundWithPipecat` never throws: hangup or transfer resolutions return
`<Hangup/>` or a `<Dial>` to the fallback human (no AI leg, no minutes billed); a
missing runtime URL pages and transfers; any exception reports and falls back to the
location's transfer number found by the dialed number, else hangs up. Every decision
is written to the decision audit table with the provider recorded.

**Admin screen** (superadmin): runtime health and gate status, the per-number provider
switch, live sessions with Instruct (inject plus trigger), Say verbatim, and Hang up
(runtime hang-up AND a carrier REST hang-up, belt and braces), and an outbound test
dial to your own phone.

---

## 10. Outbound and campaigns

**One outbound call** (`startOutboundCall`), used by an internal route for crons and
scripts, the admin test dial, and the operations agent's "place a call" verb
(propose, confirm, execute). In order: gate; runtime configured; normalize the number;
**do-not-call check** (`is_call_opted_out(company, phone, scope)`, default scope
`marketing`; a lookup error BLOCKS the call); the from-number must be this company's
active number on the self-hosted provider with AI not suspended; enrichment (contact
find-or-create, schedule, knowledge base, preferred staff member); dynamic variables
with from and to swapped; the starter prompt gets an outbound directive prepended
(who you are, that you called them, the objective, be brief, handle "stop calling");
`greeting: null`; then originate through the carrier REST with
`url = <app>/api/voice/laml/voice-agent/outbound-answer?session_id=...`. On answer the
carrier fetches that URL and gets the same `<Connect><Stream>`; from there it is
identical to inbound. Answering-machine detection is not enabled. Originate failures
report silently with `escalateAfter: 25` (single carrier rejections are routine at
scale; a spike pages).

**Campaigns** (`campaigns.ts`): a contact list plus one objective. Create verifies the
gate and from-number, resolves contacts to unique phone digits (up to 5000), inserts
the campaign (defaults: concurrency 3, quiet hours 8 to 21, 2 attempts) and recipients
in chunks of 500. A per-minute cron processes every `sending` campaign: settles
finished calls (answered = not a timeout and longer than 3 s; otherwise retry until
`max_attempts`, then `failed`), checks quiet hours, dials up to the concurrency
headroom measured against LIVE sessions, claims each row `pending` to `calling`
atomically, and calls `startOutboundCall` (so gate, DNC, tools and post-call all
apply). `opted_out`, `gate_closed`, `bad_to_number`, `from_not_self_hosted` mark the
row `skipped`; other errors retry. The cron registration is not in reference-impl.

**Do-not-call, TCPA-correct.** Voice opt-out is a SEPARATE channel from SMS (its own
table). The `mark_do_not_call` tool writes the CUSTOMER's number: the caller on
inbound, the callee on outbound. An early version wrote `from_number` always, which on
outbound is your own number, so a customer asking to stop was never suppressed.

---

## 11. Mid-call server push

Hosted platforms have an "update live call" endpoint (inject context and trigger a
response); you must at least match it, and owning the loop lets you exceed it.
voice-rt `POST /sessions/{id}/inject` takes `additional_context` (appended as a system
message prefixed "[Live update from the business, follow it now]", with `run_llm` =
`trigger_response`) and/or `speak_verbatim` (spoken by TTS as-is), and
`POST /sessions/{id}/hangup`. The app server's admin routes wrap them. Payload details:
`references/endpoints-and-payloads.md`.

---

## 12. Post-call, recording, billing and durability

**Recording.** Pipecat `AudioBufferProcessor`, stereo (caller left, agent right),
16-bit WAV, uploaded by voice-rt to the app server, stored in the same bucket as the
hosted platform's recordings at `{company_id}/{session_id}.wav` so the existing player
works. A late upload is linked to the already-written history row.

**Post-call analysis.** One OpenAI JSON call (`gpt-4.1-mini`, temperature 0.2, max 600
tokens, transcript cut at 60,000 chars) returns `summary`, `call_successful`,
`user_sentiment` (Positive, Neutral, Negative), `user_name` (only if spoken, never
invented), `in_voicemail`. The prompt is the operator's exact hosted-platform
extraction prompts ported verbatim, so self-hosted calls score identically: summaries
in fixed sentence patterns per outcome; "successful" means no tool failure, no wrong
info, no agent-caused frustration, and a voluntary exit counts as success even if the
task was not completed. It never throws; on failure the call is still recorded with an
empty summary.

**Finalize** (idempotent on the session): end the carrier leg over REST when the agent,
a timeout or an error ended the call; alert `voice_agent_missing_recording` when a real
conversation (3 s or more, not error or timeout) has no recording; write the history
row through the SAME post-call writer the hosted path uses (`agent_type='ai'`,
`provider='pipecat'`); insert a `usage` row.

**Billing.** Minutes are metered under the EXISTING usage type the plans and billing
job already drain (`usage_type='retell'` in the reference), so quotas, included
minutes and the billing page work on day one. The tier rides as a stable description
prefix: `[tier:premium]` for S2S, `[tier:standard]` for chained. Per the plan, the
billing job parses that prefix and prices premium at a separate per-minute plan rate
when one is set (the billing job is not in reference-impl). A duplicate-key insert is
ignored, so a retried finalize cannot double bill.

**Your own cost per call** (`estimateCostCents`, wholesale rates as of 2026-09, written
to `total_cost_cents`): STT $0.0077 per minute of STT seconds; TTS $0.10 per 1,000
characters (an ElevenLabs Flash rate, applied even when Cartesia is the TTS: update
it); chained LLM $2 / $8 per 1M input / output tokens; Realtime audio $32 / $64 per 1M
tokens; carrier $0.0085 per minute; compute $0.004 per minute.

**Durability (a hosted platform cannot lose a call; your runtime can):**
- voice-rt's teardown isolates every step, so recording upload and the end report run
  on any exit; the end POST retries 3 times.
- A 60 s heartbeat keeps a long call from looking dead.
- A live session silent for 5 minutes is reconciled: the app server synthesizes a
  minimal end payload (`ended_by='error'`), writes the history row and alerts
  `voice_agent_orphaned_call`.

**Provider failures reach on-call.** voice-rt has no error reporter of its own; it
posts `error` events. `auth_failure` and `quota_exhausted` (the "ran out of money" or
"key revoked" case) page as critical and can never be silenced, because the AI line is
down for that business. One report per provider and class per call. A connect-time
engine fallback is tracked silently and escalates after 10.

---

## 13. Cost (the build-versus-buy math)

Snapshot figures from the research that justified the build; re-price before quoting.
- Self-hosted all-in about **$0.04 to $0.13 per minute** (aggressive to premium).
  Hosted all-in about **$0.13 to $0.31 per minute** (the platform's voice-infra markup
  sits on top of the same LLM, TTS and telephony), plus a monthly fee per number and a
  fee per concurrent call above the included limit. Savings about $0.05 to $0.10 per
  minute: roughly $2.5K to $5K a month at 50K minutes a month. The offset is
  engineering time plus always-on runtime compute.
- **The biggest lever is TTS.** Premium TTS about $0.06 to $0.10 per minute, Cartesia
  about half, self-hosted open models about compute only.
- **S2S needs prompt caching:** roughly $0.02 to $0.11 per minute cached versus $0.18
  to $0.46 uncached (audio $32 in / $64 out per 1M tokens for the flagship model).

**Two beliefs the research corrected:** (1) "we can only act at call start or when the
platform calls us": wrong, hosted platforms have an update-live-call endpoint, and
self-hosting exceeds it; (2) "I have to set up each agent in the platform dashboard":
that is UX friction, not an API limit; the real win is agent-config-as-data plus the
shared tool library.

---

## 14. Security rules

- **Authenticate the media WebSocket** with a single-use, short-TTL session id minted
  by the app server. An unauthenticated stream lets anyone drive any tenant's agent.
- **Shared secret on every internal hop** (`X-Voice-Agent-Secret`), constant-time
  compare, and an UNSET secret must refuse (the app server returns 503, never "open").
- **The runtime holds NO database key** and no tenant data access. Everything goes
  through the app server, scoped by the session it was minted for.
- **One brain for "who is calling and what may the agent do."** Tenant, gate and
  enrichment logic stay in the main backend. Do not fork them into Python.
- **Tool writes honor the caller's real permissions.** The phone caller is usually the
  CUSTOMER (anonymous or limited): scope the agent to what that customer could do;
  an outbound staff-initiated call writes as the operator. A service-role write that
  bypasses row-level security is the classic IDOR here (`security-rls-permissions`).
- **Consent:** clone only with a recorded consent statement; never place an outbound
  call to an opted-out number; fail safe when consent cannot be checked; keep the
  recording announcement behavior the carrier layer already has.
- **Never put secrets in the session context.** The reference context carries prompts,
  voice ids, tool schemas and settings only.

---

## 15. Landmines (each one bit, or will)

- **Do not touch wire-format quirks while the old platform is live.** In the
  reference: a deliberate typo in a state-switch tool name the live prompts call
  (`cnformation_agent_transfer`), numbers stored without a leading `+`, a tool that
  wrote the contact id back through response variables. Leave them until cutover ends.
- **Keep the reporting columns compatible during the transition.** Voice bookings keep
  the same source-reference type the hosted calls used, minutes stay under the existing
  usage type, decisions go to the same audit table with the provider recorded.
  Changing these mid-migration breaks reports nobody connected to the voice work.
- **`<Connect><Stream>` is cXML only.** A number that drifts to SWML or Relay cannot
  reach the runtime. Bind at switch time; alert on drift.
- **The flag does not override every inbound path.** The product skill and the parity
  plan say a targeted business goes self-hosted on ALL AI paths regardless of the
  number's stored provider. In the code, the IVR and overflow paths honor the flag, but
  the DIRECT dispatch branch checks only the stored `ai_provider`. Switch the number
  too, or route the direct branch through the same helper.
- **Transfer and auto hang-up (fixed in the reference).** After the redirect the
  stream closes, the pipeline is cancelled, and a serializer with credentials POSTs
  `Status=completed` for the SAME call sid, which drops the caller mid-transfer. The
  fix: `CarrierSerializer` in `build.py` subclasses `TwilioFrameSerializer` and skips
  the hang-up on `EndFrame`/`CancelFrame` while `suppress_hang_up` is set; the transfer
  tool in `tools.py` sets it BEFORE asking the app server to redirect the leg and clears
  it if the transfer fails. Every other end still hangs up. Tested against
  pipecat-ai 1.11.0 (the serializer reads the flag per frame); still verify on the
  first live transfer. The app server already skips its own hang-up for
  `ended_by: "transfer"`.
- **The live-call control API is per process, so the runtime is pinned to ONE
  instance.** voice-rt's session registry is in-memory, so with several runtime
  instances behind one URL, inject and hang-up hit the wrong instance and 404.
  `render.yaml` sets `numInstances: 1` with the reason. Scale UP (a bigger plan, a
  higher `MAX_CONCURRENT_CALLS`) before scaling OUT; scaling out first needs
  per-instance routing for the control endpoints and a shared registry.
- **The app-server session store is per process.** Fine for one instance; a second
  instance needs a shared store with the same single-use claim.
- **`TTSSpeakFrame` on the S2S engine.** Begin message, Say verbatim and the transfer
  announcement use it, and the S2S pipeline has no TTS stage. Untested there.
- **The latency number is not voice-to-voice.** The runtime's p50/p95 mix LLM and TTS
  time-to-first-byte. Measure true voice-to-voice (caller stops to first agent audio)
  before claiming the 800 ms target.
- **Operator voice routes must prove `location_id` (fixed in the reference).** It comes
  from the query string, and `PUT /select` writes with a service client, so before the
  fix one company could change another's voice. The shared auth helper in
  `routes/voices.ts` now checks the location belongs to the caller's company AND that
  the caller can access it (`canAccessLocation`: owner/super_admin, or a
  `user_locations` row), and returns 403 otherwise. Any route that takes a caller-given
  id needs the same check.
- **Quiet hours use the campaign location's timezone** (default `America/New_York`),
  not each callee's, although the file header says "called party". Contacts carry no
  timezone column.
- **Two "say one sentence first" instructions on transfer.** The tool description tells
  the model to say "One moment while I transfer you" and the runtime ALSO queues that
  line. Expect a duplicate unless you drop one.
- **A cloned voice can exist upstream but not in your DB** if the insert fails after
  Cartesia succeeds. No clean-up exists.
- **Guard every Pipecat import that is not core** (mixer, `GenerationConfig`,
  `ErrorFrame`, `AudioBufferProcessor`, backchannel) so an upgrade degrades a feature
  instead of crashing every call, and log loudly when it does.
- **Per-number cutover only, reversible, never a flag day.** Keep the old platform
  running until a cohort has been clean for weeks AND the owner authorizes retiring it.
  DROPs of the old platform's tables or agents need explicit owner permission.
- **Typecheck-clean is not "works".** The reference was compile-clean long before any
  live call. Keep a VERIFY list until a real call exercises each item.

---

## 16. Build status in the reference (snapshot, not your repo)

Built in code: inbound end to end, both engines, connect-time fallback, the full tool
set, multi-prompt state machine, gate and per-number switch, outbound single and
campaign, voice do-not-call, mid-call push and admin UI, recording, post-call analysis,
usage and tier tag, orphan reconcile and heartbeat, provider-failure alerting, Cartesia
voices, picker and cloning, ambience, backchannel, begin message.

Not built: per-agent engine selection and agent-config-as-data, Pipecat Flows, warm
transfer, mid-call RAG refresh, mid-call engine swap, TTS loudness normalization,
input denoising, end-on-silence, answering-machine detection, A/B harness against the
hosted platform, a dispatcher or warm pool, a test suite.

The VERIFY list the reference carried into its first live calls: `LLMContext`
accepting a `ToolsSchema`; the in-place system-prompt swap actually changing behavior
after a state switch; the `AudioBufferProcessor` import path; the S2S 24 kHz rate;
`LLMMessagesAppendFrame` reaching the Realtime service; the carrier echoing the
`<Parameter>` as a custom parameter; the `/api/laml` REST root for hang-up; the voice
mapping by ear; real latency.

## 17. The portable checklist (stand it up in another repo)

1. Read `reference-impl/` end to end and write your port / adapt / skip list.
2. Runtime: FastAPI plus pinned Pipecat plus `pipecat-backchannel` plus numpy; one
   process, N asyncio calls, `MAX_CONCURRENT_CALLS`; warm Silero and Smart Turn in the
   image (`references/environment-and-deploy.md`).
3. Media socket `/ws`: handshake, read `session_id` (parameter, then query), claim over
   the shared secret, build, run, isolated teardown (recording upload and end report
   always run).
4. In your existing backend: a session bootstrap that returns rendered prompts, voice
   block (with speed, emotion, volume), tools plus routing, the begin message and
   settings; a tool-call endpoint on your shared dispatcher; an events endpoint; a
   recording upload; an end endpoint that reuses your post-call writer
   (`references/endpoints-and-payloads.md`).
5. Carrier: cXML `<Connect><Stream>` with the `<Parameter>` and query fallback, plus
   `TwilioFrameSerializer(base_url=<carrier compat REST root>)` for hang-up.
6. Gate it per business, switch one scratch number, test EVERY tool on a real call,
   then widen.
7. Tune by ear on a real phone and bake the numbers in: voice speed, emotion, volume;
   ambience volumes; backchannel frequency; turn-taking preset; the begin message.

---

## 18. Map of reference-impl (which file to read for what)

| Question | File |
|---|---|
| How the runtime starts, health, logging | `voice-rt/src/main.py`, `voice-rt/src/config.py` |
| Env vars, image, deps, hosting | `voice-rt/{Dockerfile,render.yaml,requirements.txt}` |
| The media socket, claim, fallback, teardown, control API | `voice-rt/src/calls/routes.py` |
| Per-call state, prompt assembly, end payload, registry | `voice-rt/src/calls/session.py` |
| HTTP client to the app server, timeouts, retries | `voice-rt/src/api/billing.py` |
| The pipeline, both engines, state switch, inject, first line | `voice-rt/src/pipeline/build.py` |
| Tool schemas to Pipecat, routing, transfer, end call | `voice-rt/src/pipeline/tools.py` |
| Latency, usage, error classification | `voice-rt/src/pipeline/observers.py` |
| Stereo recording | `voice-rt/src/pipeline/recording.py` |
| Office and typing ambience, and its WAV assets | `voice-rt/src/pipeline/ambient.py`, `voice-rt/src/pipeline/assets/` |
| Context, session and end-payload contracts | `app-server/voiceAgent/types.ts` |
| The gate | `app-server/voiceAgent/gate.ts` |
| Building a session, begin message, inbound seam, fallbacks | `app-server/voiceAgent/session.ts` |
| In-memory store, single-use claim, sweeper timers | `app-server/voiceAgent/sessionStore.ts` |
| Calls from the app server to the runtime | `app-server/voiceAgent/rtClient.ts` |
| The cXML builders | `app-server/voiceAgent/laml.ts` |
| Voice-only tools, routing map, dispatch, DNC write | `app-server/voiceAgent/tools.ts` |
| Voice resolution and the legacy voice map | `app-server/voiceAgent/voices.ts` |
| The Cartesia catalogue | `app-server/voiceAgent/cartesiaVoices.ts` |
| Post-call analysis, cost, usage row, orphan reconcile | `app-server/voiceAgent/postCall.ts` |
| Per-number provider switch | `app-server/voiceAgent/provider.ts` |
| Outbound single call | `app-server/voiceAgent/outbound.ts` |
| Campaigns and the cron runner | `app-server/voiceAgent/campaigns.ts` |
| Internal runtime routes | `app-server/voiceAgent/routes/rt.ts` |
| Public cXML routes (transfer, outbound answer) | `app-server/voiceAgent/routes/laml.ts` |
| Superadmin routes | `app-server/voiceAgent/routes/admin.ts` |
| Outbound and campaign routes | `app-server/voiceAgent/routes/outbound.ts` |
| Operator voice picker, preview, cloning | `app-server/voiceAgent/routes/voices.ts` |
| Where inbound calls branch to the AI | `app-server/voice/inboundLaml.ts` (search `pipecat`) |
| The hosted platform's SIP forward being replaced | `app-server/voice/aiForward.ts` |
| Migrations | `sql/` (see `references/data-and-voices.md`) |
| The product's own skill this one was built from | `original/SKILL.booking-app.md` |
| Phased tracker, decisions, build log, VERIFY list | `plans/SELF_HOSTED_VOICE_AGENT_PLATFORM_PLAN.md` |
| Cartesia, parity checklist, tuning log | `plans/VOICE_AGENT_PARITY_AND_VOICE_SYSTEM.md` |

Not in reference-impl (you will need your own): the app server's `env.ts`, the chat
tool library and dispatcher, the inbound decision tree (`resolveInboundCall`), the
shared post-call writer, the carrier helpers (`lamlModifyCallUrl`, `lamlEndCall`,
`cxmlOriginate`, `importExistingVoiceNumber`), route mounting and the raw body parser,
the cron registration, the frontend picker and admin tab, and the migrations for
opt-outs, campaigns and tiered pricing.
