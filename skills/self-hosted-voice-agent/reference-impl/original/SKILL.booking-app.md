---
name: self-hosted-voice-agent
description: >-
  The map of how the LIVE PHONE AI AGENT works and how we are replacing Retell with our OWN
  self-hosted Pipecat voice stack. Read this BEFORE any work on the AI phone agent: the realtime
  media loop, replacing/augmenting Retell, the SignalWire media-stream bridge, the self-hosted
  Python voice runtime (voice-rt), the shared tool library the agent calls mid-call, voice cloning,
  inbound + outbound calling, per-call prompt/context injection, mid-call server push, per-minute
  billing, and the per-number cutover. It explains the TWO systems that must never be conflated (the
  Retell AI brain vs the SignalWire human telephony layer), the FOUR clean seams to replace Retell,
  what is already ours and reusable (prompt system, tools, billing schema, the chat-agent loop), what
  is new (a Python process-per-call runtime + dispatcher), the build-vs-buy cost math, and the
  security rules. It is the "how it works + how to rebuild it" map; the phased build tracker/SOT is
  docs/plans/SELF_HOSTED_VOICE_AGENT_PLATFORM_PLAN.md (read BOTH). Use when the user mentions the
  phone agent, voice agent, Retell, replacing Retell, Pipecat, self-hosted voice, a media stream, STT/
  TTS/turn-detection for calls, voice cloning, outbound AI calls, mid-call control, a phone-agent tool,
  or "make the phone agent cheaper / more flexible."
---

# Self-Hosted Voice Agent: how it works, and how we replace Retell

> This is the MAP. The live tracker + phased plan is
> `docs/plans/SELF_HOSTED_VOICE_AGENT_PLATFORM_PLAN.md`. Read both. Verify every
> file/table/id against the LIVE code and DB before acting (this domain has moving parts
> and a live migration; the code is truth).

## The one thing to understand first: TWO systems, never conflate them

| System | What it does | Status |
|---|---|---|
| **AI phone-agent BRAIN = Retell** | Runs the ENTIRE realtime loop for a live call: STT + LLM + turn-taking + tool-calling + TTS | **Being replaced** by our self-hosted Pipecat stack |
| **Human telephony = SignalWire** | The PSTN numbers, inbound routing, IVR, queues, softphone, transfer/conference, recording, voicemail (`app-server/src/voice/`) | **Kept + reused** as our carrier/media on-ramp |

A request about "the AI that answers and books for callers" is the Retell brain (replace).
A request about "routing, queues, softphone, transfer, IVR, voicemail" is SignalWire (keep).
The IVR/voicemail greetings (OpenAI TTS) and voicemail transcription (Whisper) are ALSO
separate from the AI agent -- do not touch them when working the AI brain.

## What Retell does today, and the FOUR seams to replace it

Retell only touches us at two moments; in between it owns the call:
1. **Call setup:** on Retell's inbound webhook, `app-server/src/retell/inboundCall/
   handler.ts` runs a decision tree (tenant lookup -> gates -> enrichment) and returns the
   prompt + dynamic variables + voice bundle. Nothing is baked per-tenant into Retell;
   there are just two GLOBAL agents (live + inactive-transfer).
2. **Mid-call:** the agent calls OUR tool HTTP endpoints (booking/cancel/etc.).
3. **Call end:** Retell fires `call_analyzed` -> `postCallAnalysis.ts`.

The four clean seams (this is the whole integration surface to swap):
1. **SIP/media bridge** -- `voice/providers/aiForward.ts` (`buildRetellForwardSwml`):
   swap the SIP `connect` from Retell's LiveKit gateway to OUR media WebSocket via a cXML
   `<Connect><Stream>`.
2. **Setup orchestrator** -- `retell/inboundCall/handler.ts`: reuse the decision tree; it
   already produces prompt + vars + voice + enrichment. Refactor into `buildSessionContext`.
3. **Tool endpoints** -- `/api/calendar-functions` + `/api/ai/*`: provider-agnostic HTTP,
   reused verbatim. Our Pipecat tools call them exactly as Retell does.
4. **Post-call ingestion** -- `retell/postCallAnalysis.ts`: feed it OUR end-of-call payload;
   `call_history` already has `agent_type`/`provider` columns.

## What is already ours (do NOT rebuild)

- **The prompt system:** `retell_prompts` (7 slots + fragments) + `promptResolver.ts`
  template engine + per-call `dynamic_variables`. PREFER rendering the prompt in Node at
  bootstrap and handing the runtime the finished string (one renderer, no Python fork).
- **The tools = a shared library, already.** The phone agent and chat agent SHARE
  `app-server/src/ai/tools/*` and the HTTP endpoints. The Operations Agent
  (`app-server/src/operationsAgent/`) is the richer model to converge on: `VERB_REGISTRY`
  + `READ_TOOLS`, propose->confirm->execute, write-AS-THE-CALLER RLS, three-gate, catalog.
- **The chat-agent loop** (`ai/chat-agent/runChatAgent.ts`) already runs an OpenAI
  tool-calling loop for SMS/WhatsApp/webchat. The voice agent is the SAME brain with a media
  front-end. This de-risks the rebuild enormously.
- **Billing/schema:** `call_history`, `usage`, `voice_pricing` are provider-agnostic.
- **Number lifecycle, suspension/restore, SignalWire glue, E911, recording** -- all reused.

## What is NEW (the actual build)

- **`voice-rt/`** -- a Python + FastAPI + **Pipecat** runtime, a SEPARATE deployable (Python
  GIL forces ONE process per concurrent call). Pipeline:
  `transport.input (mulaw 8k) -> Silero VAD + Smart Turn v3 -> STT (Deepgram/Whisper) ->
   LLM (with the shared tools) -> TTS (ElevenLabs incl. cloned voices / Cartesia) ->
   transport.output`.
- **A dispatcher / warm-pool** to spawn a voice-rt process per call + autoscaling.
- **The session handshake:** app-server builds the full context, stashes it in **Redis**
  by `session_id`, returns cXML `<Connect><Stream url="wss://voice-rt/ws?session_id=...">`;
  voice-rt reads it on WS connect and runs the call.
- **Outbound** (single + batch/campaign) -- today only in-call transfer + queue-overflow.
- **Voice cloning** on BOTH engines: ElevenLabs create-voice (self-serve TODAY, engine B) +
  OpenAI Custom Voices (works with Realtime/engine A but SALES-GATED, 20/org, consent
  recording required). Consent capture + scope + cost per Phase 3.
- **Mid-call server push** (inject context + trigger a response) -- Retell parity; trivial
  once we own the loop.

## ⛔ GUIDING PRINCIPLE: copy everything good from the separate repo; build only the delta

The owner's rule: `C:\dev\Voice-AI-Agent-Builder-Platform` is a real, working Pipecat build.
For EVERY component, first ask "does the repo already do this well?" If yes, PORT it (adapt
names/tenancy). Build fresh ONLY when the repo lacks it (shared tool library, voice cloning)
or its version is genuinely not good enough. Treat the repo as a parts bin. The plan's
section 9.1 has the file-by-file port/adapt/skip inventory. Re-verify ports against Pipecat's
current API (the repo targeted 0.0.108).

## The stack (with the why)

- **Pipecat** (BSD-2, mature): shared tool library, SignalWire via the Twilio-compatible cXML
  serializer path, free CPU turn model, inbound+outbound, BYO everything.
- **SignalWire** (already ours): cXML `<Connect><Stream>` + `TwilioFrameSerializer`, mulaw 8k.
- **Silero VAD + Smart Turn v3** (local CPU, ~12ms, free): kills agent-interrupts-caller.
- **THE VOICE ENGINE IS A PER-AGENT CHOICE** (`voice_agents.engine`), both share the tools:
  - **(A) Speech-to-speech: OpenAI Realtime** (`gpt-realtime-2.1` / `-2.1-mini`) via Pipecat
    `OpenAIRealtimeLLMService`. The MOST HUMAN, lowest-latency tier (owner's "insanely human
    voices" ask). One model does audio->audio; STT/LLM/TTS are FUSED for that call (you give
    up mid-pipeline swapping FOR that agent, but it is a per-agent knob, not platform lock-in).
    Voices marin/cedar are the most human; tools + mid-session steer supported. ⛔ Enforce
    prompt caching or cost balloons ($0.02-$0.11/min cached; $0.18-$0.46 uncached).
  - **(B) Chained:** **Deepgram** STT / **OpenAI/Anthropic/Gemini** LLM / **ElevenLabs** TTS
    (Cartesia cheaper). Deterministic tool control, self-serve cloning today, predictable cost.
- **Pipecat Flows** for on-rails booking/intake/payment (guarantees order + correct tools).
- **Redis** for per-call session bootstrap.

**Sell the two engines as PRODUCT TIERS, not a raw toggle** (owner decision 2026-09-22, offer
both): "Standard voice" (engine B) and "Lifelike/Premium voice" (engine A), priced per-minute
differently (`voice_pricing` gains a tier dimension), hot-swappable per agent (both share the
prompt + tool library), with a play-the-difference sample on the settings screen. Build
**automatic S2S -> chained fallback** mid-call (OpenAI blip/latency -> degrade, don't drop; a
reliability win over Retell; port the repo's `failover/`). Do NOT gate launch on voice cloning
(the OpenAI clone is sales-gated); ship the premium tier on presets (cedar/marin), clone later.

**What makes it the BEST agent (build in, not just the voice):** (1) breadth of SAFE action
via the shared tool library under the caller's real RLS (book/reschedule/deposit-link/balance/
waitlist/KB/warm-transfer); (2) <=800ms latency as a feature (S2S + Smart Turn); (3) knows the
caller before "hello" (reuse enrichment); (4) barge-in + backchannel + never dead-air on a tool
call; (5) outbound first-class (reminders that rebook, waitlist fill, win-back, reviews);
(6) the owner-facing builder is the moat: a new agent is a row + tool ids, and eventually the
Operations Agent builds a phone agent by chat. See plan 3.2.1 + 3.2.2.

> The owner's "Agent One" = the **OpenAI Realtime API** (not a real product name). AgentKit /
> Agent Builder is a separate text/workflow product line, mostly irrelevant here, and Agent
> Builder is deprecating 2026-11-30. Do NOT build on Agent Builder. OpenAI native SIP exists
> but cedes the audio path + bypasses our tools; keep the Pipecat + SignalWire media path.

## Cost (the build-vs-buy math)

- Self-hosted all-in ~**$0.04-$0.13/min** (aggressive to premium). Retell all-in
  ~**$0.13-$0.31/min** (their voice-infra markup sits on top of the same LLM/TTS/telephony),
  plus $2/mo/number and $8/mo per concurrent call over 20. Savings ~$0.05-$0.10/min of pure
  margin; ~$2.5K-$5K/mo at 50K min/mo. The offset is engineering + always-on voice-rt compute.
- **Biggest lever is TTS.** ElevenLabs ~$0.06-$0.10/min; Cartesia ~half; self-host Kokoro/
  Piper ~= compute only. Voice quality vs cost is an owner call per plan tier.

## Two owner beliefs the research corrected (do not carry them into the build)

1. "We can only act at call start or when Retell calls us." Partly wrong: Retell has
   `PATCH /v2/update-live-call` (inject context + trigger response). We MUST match it;
   self-hosting EXCEEDS it (we own every frame).
2. "I have to set up each agent in the Retell dashboard." That is UX friction, not an API
   limit. Our real win is **agent-config-as-data** (a row, not a dashboard) + the shared
   tool library.

## The shared tool library (owner's #1 ask)

Define a tool ONCE, reuse across EVERY agent, version once. Design:
- Canonical tool definition (name, description, JSON-schema params, handler pointer,
  permission, side-effect class, confirm-required?) stored as DATA (`voice_agent_tools`),
  not inline-per-agent (that is exactly Retell's weakness).
- Agents (`voice_agents`) reference tools by id: agent = config + tool_ids[] + prompt +
  voice + optional flow. Add a tool = add an id.
- Handlers are HTTP (already provider-agnostic), shared by the Node chat loop and the Python
  voice loop. Mid-call scoping via Pipecat `LLMSetToolsFrame` / Flows per node.
- **Security parity:** a WRITE tool honors the caller's RLS. The phone caller is usually the
  CUSTOMER (anon/limited) -> scope so the agent can only do what that customer could; outbound
  staff calls -> write-as-the-operator. A service-role write that bypasses RLS is the classic
  IDOR here. Follow `internal-ai-agent` + `security-rls-permissions`.

## Reusing the separate `Voice-AI-Agent-Builder-Platform` repo

It is a real production-leaning Pipecat build on SignalWire (`C:\dev\Voice-AI-Agent-Builder-
Platform`), but a STANDALONE product with its own `workspaces` multi-tenancy. We want ONE
system in THIS repo.
- **PORT:** its Python Pipecat runtime (`apps/runtime/`) -- transport (mulaw<->PCM codec,
  resampler, Silero at transport), barge-in, turn presets, failover, pipeline factory,
  careful teardown, coaching. It already uses SignalWire (via Twilio-compat, despite "twilio"
  naming). Adapt into `voice-rt/`.
- **ADAPT ideas:** flow engine + node registry, the prompt-agent tool-execution model,
  agent versioning, RAG/KB.
- **DO NOT bring:** its `workspaces` tenancy (we use company/location + Supabase RLS +
  subscription), its multi-host topology as-is, its Windows/OneDrive/ngrok dev tooling, stale
  docs/naming.
- **It LACKS** the two owner favorites: shared tool library and voice cloning (net-new here).
- Re-verify every ported file against Pipecat's CURRENT API (it targeted 0.0.108); pin the
  version.

## Landmines (each will bite)

- **Do not touch the wire-format quirks while Retell is live:** the deliberate typo
  `cnformation_agent_prompt`, numbers stored WITHOUT `+` in `communication_map`,
  `set_caller_identity` writing `{{contact_id}}` via response variables.
- **One brain for "who is calling + what may the agent do."** Keep tenant/gate/enrichment in
  Node (`buildSessionContext`); voice-rt is only the media loop. Do NOT fork that logic to
  Python.
- **Authenticate the media WebSocket** (single-use short-TTL `session_id`); an unauthenticated
  stream = anyone drives any tenant's agent.
- **voice-rt holds NO Supabase service-role key** for tenant data; it asks app-server,
  which enforces scope.
- **Per-number cutover only, reversible, never a flag-day** (mirror `voice-relay-migration.md`).
  Keep Retell running until a cohort is clean for weeks AND the owner authorizes retiring it.
- **DROPs** (Retell tables/agents) need explicit owner permission per the DB gate.
- **Measure latency** (voice-to-voice p99, target <=800ms); do not assume it.
- **Concurrency = one process per call.** Size compute; there is no free lunch like Retell's
  managed concurrency (but also no $8/slot fee).

## THE TEST GATE (how it is turned on) -- built 2026-09-22

Two layers, BOTH must be open per call, else the caller goes to the human fallback:
1. **Master switch** `VOICE_AGENT_ENABLED=true` on app-server (Render). Default off = the
   whole feature is inert (kill switch).
2. **Per-company** the `self_hosted_voice_agent` prompt flag (`retell_prompt_flags`, superadmin
   Retell -> Flags) lists the allowed company_ids / location_ids.
Then per-number: superadmin Retell -> Self-hosted tab -> "Switch to self-hosted" (reversible).
Enforced in `voiceAgent/gate.ts` (`evaluateVoiceAgentGate`) at switch-time, enable-time, and
EVERY inbound/outbound call; fails closed. Full go-live steps: plan section 0a + 11b.

## What is BUILT (2026-09-22) and where it lives (verify against the tree)

Status: Phase 0 + 1 + most of 2 + the S2S engine are IN CODE and typecheck-clean, but
NOT yet run against a live call (no Deepgram/ElevenLabs/OpenAI keys, runtime not
deployed, migration not applied). The plan's section 11b has the code map, the
step-by-step runbook to the first call, and the VERIFY list. Short map:

- **app-server (the brain):** `src/retell/inboundCall/handler.ts` now exports
  `resolveInboundCall()` (provider-agnostic core) + `handleInboundCall()` (Retell
  adapter). `src/voiceAgent/`: `types.ts`, `sessionStore.ts` (in-memory, single-use
  claim), `session.ts` (`answerInboundWithPipecat` -> live `<Connect><Stream>` /
  transfer `<Dial>` / hangup), `tools.ts` (the shared library: chat `TOOL_DEFS` +
  `set_caller_identity`/`transfer_call`/`end_call`/`*_agent_transfer`; dispatch reuses
  the chat `dispatchTool`), `voices.ts` (Retell id -> ElevenLabs / OpenAI voice),
  `laml.ts`, `rtClient.ts`, `postCall.ts` (LLM analysis + reused `processPostCallAnalysis`
  + usage row), `provider.ts` (`switchAiProvider`), `routes/{rt,admin,laml}.ts`.
  `src/contacts/resolveCallerIdentity.ts` is the shared identity resolver.
  Env: `VOICE_RT_URL`, `VOICE_AGENT_SHARED_SECRET`, `VOICE_AGENT_DEFAULT_PROVIDER`,
  `VOICE_AGENT_DEFAULT_ENGINE`, `OPENAI_API_KEY_VOICE_AGENT` (+ model overrides).
- **voice-rt/ (the media loop, Python, Pipecat 1.11.0 pinned):** `src/main.py`,
  `src/config.py`, `src/api/billing.py`, `src/calls/{session,routes}.py`,
  `src/pipeline/{build,tools,observers,recording}.py`, `Dockerfile`, `render.yaml`.
  It holds NO Supabase key; every tenant read/write goes through app-server.
- **Superadmin:** Retell page -> "Self-hosted" tab (`superadmin-portal/src/pages/retell/
  SelfHostedTab.tsx`): runtime health, per-number provider switch, live calls with
  Instruct / Say verbatim / Hang up.
- **DB:** `supabase/migrations/20260922_100000_voice_numbers_ai_provider_pipecat.sql`
  widens `voice_numbers_ai_provider_check` to allow `'pipecat'`. APPLIED to live DB
  2026-09-22 (owner-approved; invisible to deployed code, which only writes 'retell'/NULL).
- **Outbound:** `voiceAgent/outbound.ts` (`startOutboundCall`), the
  `/laml/voice-agent/outbound-answer` cXML, `/api/internal/voice-agent/outbound`
  (Internal-Secret) for crons/scripts, the superadmin `/outbound-test`, and the Operations
  Agent verb `place_voice_call` (`operationsAgent/verbs/placeVoiceCall.ts`, propose->confirm,
  calls startOutboundCall in-process). Gated identically. voice-rt speaks first on outbound.
- **Fallback:** connect-time S2S -> chained in voice-rt `calls/routes.py` (no mid-call swap).

Conventions you must keep when extending: tools are defined ONCE in Node (voice-rt only
proxies); the self-hosted agent needs the LaML inbound path (`<Connect><Stream>` is
cXML-only), enforced at enable/switch and paged on drift; voice bookings carry
`source_ref_type='retell_call'`; minutes are metered as `usage_type='retell'` until the
tiered-billing phase; decisions are logged to `retell_inbound_call_logs` with
`request_body.provider='pipecat'`; the seven state prompts and the six
`*_agent_transfer` tool names come straight from the live `retell_prompts` bodies.

---

# PART 2: THE COMPLETE OPERATIONAL REFERENCE (how it actually sounds and behaves)

> Added 2026-10-13 after the full build + live-tuning pass. PART 1 above is the
> architecture map; THIS part is the portable "build it in another repo" recipe:
> every provider, every knob (speed/tone/voices/backchanneling/ambience/typing/
> begin-message), the exact values we landed on by ear, and how the tools work.
> Values are pulled from the live code; re-verify against the files named before
> copying them, since tuning numbers drift as they are improved.

## 2.1 The two engines (pick per agent; chained is the real default)

| Engine | Pipeline | Voice source | When |
|---|---|---|---|
| **chained** (DEFAULT) | transport.input -> Deepgram STT -> Silero VAD + Smart Turn v3 -> OpenAI LLM -> Cartesia TTS -> transport.output | Cartesia sonic-3.6 (the picked voices + cloning) | The real product. Full control of speed/tone/voice/cloning. |
| **s2s_openai** | transport.input -> OpenAI Realtime (audio-in -> audio-out, fused) -> transport.output | OpenAI Realtime (marin/cedar), NOT swappable | Kept as an option. Owner judged it "not human enough"; default is `chained`. Do NOT delete it. |

Set via `VOICE_AGENT_DEFAULT_ENGINE` (app-server env) = `chained` | `s2s_openai`.
Telephony audio is 8 kHz mu-law on the wire; chained runs the pipeline at 8 kHz,
s2s at 24 kHz (`TELEPHONY_RATE`/`REALTIME_RATE` in `voice-rt/src/pipeline/build.py`).

## 2.2 Every provider + its env var (voice-rt reads these; app-server holds its own set)

`voice-rt/src/config.py`:
- **Deepgram** (STT, chained) `DEEPGRAM_API_KEY`. Model `nova-3-general`, `language="multi"` (auto language detect = the multilingual mechanism).
- **Cartesia** (TTS, chained + cloning) `CARTESIA_API_KEY`. Model `sonic-3.6`. Cartesia-Version header `2024-11-13`.
- **OpenAI** (LLM for chained, AND the whole s2s engine) `OPENAI_API_KEY`.
- **ElevenLabs** (fallback TTS only) `ELEVENLABS_API_KEY`.
- **SignalWire** (telephony, the serializer's REST hang-up) `SIGNALWIRE_SPACE_URL/PROJECT_ID/API_TOKEN`.
- Anthropic/Google keys declared for future LLM choices; unused today.
- `BILLING_SERVER_URL`, `VOICE_AGENT_SHARED_SECRET` (the voice-rt<->billing link), `MAX_CONCURRENT_CALLS`.
app-server post-call LLM uses `OPENAI_API_KEY_VOICE_AGENT`; Cartesia cloning/preview use `CARTESIA_API_KEY` (env.ts `config.cartesiaApiKey`).

## 2.3 VOICE SPEED + TONE (the "it was too wild, make it mellow" controls)

Cartesia sonic-3.6 takes a per-request `generation_config` with THREE knobs:
- **speed**: 0.6 to 1.5 (1.0 default). Lower = slower/unhurried.
- **emotion**: a tone-guide string (60+: neutral, content, calm, excited, sad...). Guidance, not strict; unknown values are interpreted, not errored.
- **volume**: 0.5 to 2.0 (1.0 default).

**The values we landed on by ear** (app-server `voiceAgent/voices.ts`, mellow/human, NOT energetic):
```
DEFAULT_CARTESIA_SPEED   = 0.88   // slightly slow, unhurried
DEFAULT_CARTESIA_EMOTION = 'neutral'  // calm, no excitement ('content' = warmer by-ear option)
DEFAULT_CARTESIA_VOLUME  = 0.9   // eased below default so it is not loud on a phone
```
Flow: `resolveVoiceRtVoice` (billing) emits a `cartesia:{voice_id,model,speed,emotion,volume}` block ->
voice-rt `_build_tts` passes it as `GenerationConfig(speed,emotion,volume)` to `CartesiaTTSService.Settings`
(`from pipecat.services.cartesia.tts import CartesiaTTSService, GenerationConfig`, GUARDED import so a
rename degrades to default delivery, never a crashed call). A merchant speed override rides on the
voice bundle's `voice_speed`. To tune by ear: change the three DEFAULT_* constants; redeploy app-server.

## 2.4 THE VOICES (the pickable catalog + cloning)

`app-server/src/voiceAgent/cartesiaVoices.ts`, all Cartesia sonic-3.6, ids pulled live + ear-verified:
- Female: **Allie** (default) `2747b6cf-...`, Fernanda (Mexican accent) `b4b8e2af-...`, Daniela (Mexican accent) `5c5ad5e7-...`, Emma `f6ff7c0c-...`, Harper (US Southern) `d6c52d6f-...`, Jacqueline `9626c31c-...`.
- Male: **Cory** (default) `41468051-...`, Mateo (Mexican accent) `2fc4f1ec-...`, Archie (British) `ef191366-...`, Jameson `a5136bf9-...`.
- Accented voices read-English-with-accent are Cartesia's Spanish voices used on English text (the "slightly imperfect = more human" trick).
- IMPORTANT loudness lesson: Cartesia returns different voices at very different loudness (Allie ~9.5 dB louder than Cory). ALWAYS loudness-normalize voices to a common target (~-16 LUFS) before mixing ambience, or one voice sounds hot and the bed sits wrong. We proved this with ffmpeg `loudnorm=I=-16:TP=-1.5:LRA=11`.

**Voice cloning ("create your own voice")**: Cartesia `POST /voices/clone` (multipart: clip, name,
language). INSTANT, returns a voice id usable immediately. Clip <=16 MB, any common audio format. We
accept the sample base64 (record in-browser via MediaRecorder, or upload), POST it, store the returned
id in `voice_agent_cloned_voices` (per company, with a consent record), and it joins the picker list as
`cartesia:<id>:<gender>`. Routes: `app-server/src/voiceAgent/routes/voices.ts` (GET list, PUT select,
POST sample preview, POST clone). UI: `src/pages/locations/components/ai-settings/SelfHostedVoicePicker.tsx`
(gated: renders nothing unless the company is switched on).

## 2.5 BACKGROUND NOISE (the ambience bed) + TYPING SIGNAL

`voice-rt/src/pipeline/ambient.py` = a custom `AmbientMixer(BaseAudioMixer)` on the output transport
(`audio_out_mixer={None: mixer}` on FastAPIWebsocketParams; 1.11 wants a Mapping, NOT a bare mixer).
- **Source**: REAL CC0 recordings (not synthesized), bundled at both rates in `voice-rt/src/pipeline/assets/`:
  office ambience (Internet Archive "SSE_Library_AMBIENCE", OFFICE/..._CS_USC.wav) + keyboard typing
  (BigSoundBank s0229). Converted mono 8k + 24k via `ffmpeg -ac 1 -ar <rate>`. Cross-faded loop (the office
  clip is ~13.6s; a seam on a long quiet call is covered by the crossfade).
- **The VOLUMES we landed on** (on a PHONE the bed must be FAINT; its only job is "you're on a live line"):
```
ROOM_TONE_VOLUME   = 0.035  // faint office presence, whole call (was 0.12, far too loud on a real call)
TYPING_VOLUME      = 0.22   // soft keyboard, ONLY while a tool call runs
TYPING_RAMP_SECONDS= 0.25   // fade in/out so it never pops
```
- **The typing signal is tool-gated**: typing swells ONLY while `session.tool_working` is True.
  app-server's tool round-trip is wrapped in `session.tool_working = True ... finally False`
  (`voice-rt/src/pipeline/tools.py`), so the caller hears "someone looking it up" during the otherwise-dead
  tool pause, not constant typing. Mix math is numpy `np.clip(voice + bed*ROOM + typing*gain, -32768, 32767)`.
- Per-call off switch: context `settings.ambient_sound=false`. Guarded import so a mixer failure = no
  ambience, never a dropped call.

## 2.6 BACKCHANNELING ("mhm"/"yeah" while the caller talks)

NOT built from scratch and NOT a Pipecat built-in. We use the community **`pipecat-backchannel`**
(BSD-2, `>=0.3.3,<0.4`, compatible with pipecat 1.x). It synthesizes the affirmation clips IN THE BOT'S
OWN TTS voice (Cartesia), caches them, and injects them without triggering the LLM.
- Wired in `voice-rt/src/pipeline/build.py` `_maybe_backchannel()`: `Backchannel(params=BackchannelParams(...))`,
  then `bc(stages)` wraps the chained stage list, then `bc.prewarm(tts=...)` in a background task so a cold
  cache never blocks the call opening. Guarded (unavailable -> no backchannel). Chained engine ONLY (needs a
  separate TTS; s2s has none). Toggle off via `settings.backchannel=false`. English only.
- **The INFREQUENCY values we landed on** (owner: "not so often, it's annoying"):
```
min_speech_before_eligible_s = 2.5   // only after the caller has been talking a while
fire_probability             = 0.3   // occasional, not constant
cooldown_s                   = 12    // long gap between backchannels
```

## 2.7 THE BEGIN MESSAGE (static first line, spoken the instant the call connects)

Retell had a "begin message": a fixed first line with variables, spoken BEFORE the LLM so it is
deterministic (the LLM left to open on its own improvises, e.g. invents "Barber Shop"). Pipecat does this
natively: a fixed `TTSSpeakFrame` at kick-off.
- app-server `voiceAgent/session.ts` `renderBeginMessage(locationName, receptionistName)` ->
  `"{business_name}, this is {receptionist} speaking, how can I help you?"` (business name = LOCATION name;
  shared-channel calls use the company name). Set into `context.settings.greeting`.
- voice-rt `build.py` `kick_off()`: `if greeting: queue_frame(TTSSpeakFrame(greeting, append_to_context=True)); return`
  (speaks it verbatim and returns, before any LLM turn). If greeting is null it falls through to an
  LLM-nudge open (the old improvising behavior). To make the first line editable per location, store a
  template field and read it here, falling back to this default.

## 2.8 TURN-TAKING / INTERRUPTION / ENDPOINTING (the "how fast it yields" knobs)

`voice-rt/src/pipeline/build.py`: Silero VAD + Smart Turn v3 (`LocalSmartTurnAnalyzerV3`, local CPU, free).
Smart Turn decides "actually done"; the VAD `stop_secs` sets how fast we ASK. Presets (`TURN_TAKING`):
```
fast:     stop_secs=0.15  (snappy, may cut the caller off)
balanced: stop_secs=0.2   (DEFAULT)
patient:  stop_secs=0.4   (waits longer, good for slow/elderly callers)
```
Selected by `settings.turn_taking_mode`. Interruption/barge-in is handled by Pipecat's turn controller
(broadcast_interruption flushes the output queue). Retell's "interruption sensitivity 0.9" and
"endpointing 0.16s" map here: lower stop_secs = more sensitive/faster endpointing. To match a tuned Retell
agent, port its numbers to a preset. Denoising (Retell "remove noise + background speech") = add a Pipecat
input audio filter (RNNoise / Koala / AIC) in front of STT; not yet wired, it is the next knob.

## 2.9 POST-CALL EXTRACTION (summary / success / sentiment / name)

app-server `voiceAgent/postCall.ts` `analyzeCall()` runs ONE OpenAI JSON call (via `callOpenAi`,
feature `voice_agent_post_call`) using the operator's EXACT Retell prompts (ported verbatim): the summary
rules keyed to `{{business_type}}`, the call_successful criteria (voluntary-exit = success,
incomplete != failure, frustration-only), the sentiment instruction, and user_name fill-in-if-spoken.
Writes the SAME `call_history` shape as Retell via the shared `processPostCallAnalysis`, so recording +
summary + sentiment + usage row + summary email all work unchanged. Durability extras Retell lacks:
missing-recording alert, orphaned-call reconcile (crashed runtime still gets a row), 60s heartbeat.

## 2.10 THE TOOLS (how the agent DOES things, and how to add one)

The phone agent's tools are the SAME shared library the SMS/WhatsApp/webchat receptionist uses, defined
ONCE in `app-server/src/ai/chat-agent/tools.ts` (`TOOL_DEFS` + `dispatchTool`). voice-rt NEVER defines a
tool; it proxies every call back to `POST /api/internal/voice-agent/sessions/:id/tool-call`, which runs
`dispatchVoiceTool` -> `dispatchTool`. So adding a receptionist capability = add it to the chat library and
the phone agent gets it on the next call, zero voice-rt change.
- **Tool NAMES are load-bearing**: the live prompt bodies call `checkAvailability`, `CreateAppointment`,
  `CancelAppointment`, `UpdateAppointment`, `findAppointments`, `ListAppointments`, `AddToWaitlist`,
  `SendPurchaseLink`, `SendGiftCardLink`, `SendMembershipPurchaseLink`, `CheckPaymentStatus`,
  `UpsertNameInContacts`, `verifyDayMatchesDate` by those exact strings. Rename = re-read every prompt slot.
- **Voice-only tools** (`VOICE_ONLY_TOOL_DEFS` in `voiceAgent/tools.ts`): `set_caller_identity`,
  `transfer_call`, `end_call`, `mark_do_not_call`, plus the 6 state-switch tools
  (`booking_agent_transfer` / `cancel_agent_transfer` / `update_agent_transfer` /
  `cnformation_agent_transfer` [deliberate typo, matches Retell] / `question_agent_transfer` /
  `name_agent_transfer`). Routing map (`voiceToolRouting`): `local_state_switch` (swap the system prompt in
  voice-rt), `local_end_call`, `transfer_call` (SignalWire modify-call to a human), else `server` (proxy to
  billing).
- **Multi-prompt state machine** = 7 prompt slots (starter/booking/cancel/update/confirmation/questions/
  name) from the live `retell_prompts` table, rendered with dynamic vars. A state-switch tool replaces the
  system prompt (chained: in-place edit of the LLMContext system message; s2s: `LLMUpdateSettingsFrame`).
  The hand-off instruction should tell the new state "you are picking up an ongoing call, do not repeat the
  greeting, address the last request immediately" (Retell parity).
- **Agent-to-agent handoff** (Retell's transfer tool): same mechanism, the state switch IS the handoff.

## 2.11 COST (per-minute component math, for the P&L)

`voiceAgent/postCall.ts` `estimateCostCents` (our wholesale cost, ~2026-09): Deepgram Nova ~$0.0077/min,
ElevenLabs Flash ~$0.10/1k chars, chained LLM $2/$8 per 1M tok, OpenAI Realtime audio $32/$64 per 1M tok,
SignalWire ~$0.0085/min, + ~$0.004/min compute. Written to `call_history.total_cost_cents`. Self-hosted
all-in ~$0.04-$0.13/min vs Retell ~$0.13-$0.31/min.

## 2.12 THE GATE (per-company test switch -> remove it for everyone)

ONE helper `shouldUseSelfHosted(companyId, locationId)` (`voiceAgent/gate.ts`) = master env
`VOICE_AGENT_ENABLED=true` AND the company is in the `self_hosted_voice_agent` flag
(`retell_prompt_flags`, flipped from the superadmin Retell page). Inbound routing (`voice/inboundLaml.ts`
+ the SWML path in `voice/routes/webhooks.ts`) keys off this one helper, so a flagged company goes
self-hosted on ALL its AI paths regardless of the number's `ai_provider`. Phase 2 (owner says "it's good,
turn it on for everyone") = make the helper `return true` and retire Retell. Fails SAFE to Retell on any
error. A number ALSO must be LaML-bound (not Retell SIP) to open the media stream; the per-number "Switch
to self-hosted" (`switchAiProvider` in `voiceAgent/provider.ts`) does that re-bind + unregisters Retell.

## 2.13 To stand this up in a DIFFERENT repo / company (the portable checklist)

1. New Python service (`voice-rt/`): FastAPI + `pipecat-ai[websocket,deepgram,openai,elevenlabs,cartesia]==1.11.x`
   + `pipecat-backchannel` + numpy. One process, N asyncio calls, `MAX_CONCURRENT_CALLS` guard. Deploy on
   Render/Fly (Docker; warm the Silero + Smart-Turn models at build).
2. The media WS `/ws`: handshake -> read `session_id` (cXML `<Parameter>` + `?session_id=` fallback) ->
   claim session from the brain over a shared secret -> build the pipeline -> run -> isolated teardown
   (recording upload + end report always run).
3. The "brain" (your existing backend): a session-bootstrap endpoint that returns {prompts, dynamic vars,
   resolved voice (cartesia block with speed/emotion/volume), tools + routing, begin-message greeting,
   settings}; a tool-call endpoint that dispatches your shared tool library; an end endpoint that writes
   your call record (reuse your existing post-call analysis).
4. Telephony: your carrier's Twilio-compatible cXML `<Connect><Stream url="wss://voice-rt/ws">` +
   `TwilioFrameSerializer(base_url=<carrier compat REST root>)` for auto hang-up.
5. Tune by ear and bake the numbers in: voice speed/emotion/volume (2.3), ambience volumes (2.5),
   backchannel frequency (2.6), turn-taking preset (2.8), the begin message (2.7).
6. Gate it per-company first (2.12), test every tool on a real call, THEN widen.

## Related skills / docs

- `docs/plans/SELF_HOSTED_VOICE_AGENT_PLATFORM_PLAN.md` -- the phased tracker (source of truth).
- `docs/plans/VOICE_AGENT_PARITY_AND_VOICE_SYSTEM.md` -- the Cartesia/voices/ambience/backchannel ledger.
- `docs/plans/RETELL_VOICE_SYSTEM_SOT.md` -- the current Retell pipeline + voice-override harness.
- `docs/plans/voice-relay-migration.md` -- SignalWire SDK transfer/conference (reuse for transfer).
- `internal-ai-agent` + `ai-agent-platform-infrastructure` -- the agent/tool/billing patterns.
- `signalwire-docs` -- SignalWire call models + cXML/compat (use for the media-stream bridge).
- `agent-phone-actions` -- provisioning numbers/AI from a script (reuse for cutover tooling).
