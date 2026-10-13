# Self-Hosted Voice Agent Platform (replace Retell with our own Pipecat stack)

> Agent-facing SOT. Read this BEFORE any work on replacing Retell / building the
> self-hosted phone agent. Every claim here was verified against the LIVE code,
> Pipecat/Retell docs, and the separate `Voice-AI-Agent-Builder-Platform` repo
> (2026-09-20). Where a fact needs re-verification before you act on it, it is
> flagged `VERIFY`.
>
> Owner: the founder. Created 2026-09-20. Status: BUILDING (code landed 2026-09-22, gated OFF,
> not yet run against a live call). Sibling skill:
> `.claude/skills/self-hosted-voice-agent/SKILL.md` (the how-to map).

---

## 0a. THE SWITCH (how to turn it on when everything is built) -- READ THIS FIRST

The self-hosted voice agent is DORMANT by default and cannot touch a real customer until
YOU deliberately open two independent gates. Both must be open, per call. Either one closed
sends the caller to the merchant's human fallback number (never dead air) and Retell keeps
answering every other number exactly as today.

**Gate layer 1: the master switch (env var on app-server / Render).**
- `VOICE_AGENT_ENABLED=true` turns the feature on platform-wide. Unset or anything other
  than `true` = OFF. This is the kill switch: flip it off and every self-hosted number
  instantly reverts to the human fallback on the next call.
- Set it on the environment you are testing (staging = the `dev` Render app-server;
  prod = the `app-server-prod` Render service). Env: app-server > Environment.

**Gate layer 2: which companies/locations are allowed (superadmin portal, no deploy).**
- Superadmin portal > Retell page > Flags tab > the flag `self_hosted_voice_agent`.
- Add the company (or location) you want to test. Only listed companies/locations can be
  answered by the self-hosted runtime. Everyone else stays on Retell.
- This is the same flag mechanism the AI already uses for prompt targeting; it stores the
  allow-list in `retell_prompt_flags`, no new table.

**Then, per number (superadmin portal, reversible):**
- Superadmin portal > Retell page > Self-hosted tab. It shows runtime health + the gate
  status. Find the AI number and click "Switch to self-hosted". It removes the Retell
  registration and binds the number to the media-stream path. "Back to Retell" reverts it.
- The button is disabled while the master switch is off, so you cannot half-cut a number.

**Also required before a call can connect (one-time infra, see the 11b runbook):**
- The `voice-rt` Render service deployed, with `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`,
  `OPENAI_API_KEY`, `SIGNALWIRE_*`, and a shared `VOICE_AGENT_SHARED_SECRET`.
- On app-server: `VOICE_RT_URL` (the runtime's URL) + the SAME
  `VOICE_AGENT_SHARED_SECRET`.
- Optional tier pick: `VOICE_AGENT_DEFAULT_ENGINE=chained` (Standard) or `s2s_openai`
  (Lifelike / OpenAI Realtime, the most human voice).

**The one-line mental model:** `VOICE_AGENT_ENABLED=true` (Render) + company in the
`self_hosted_voice_agent` flag (portal) + number switched to self-hosted (portal) = that
company's number is answered by our runtime. Remove any one of the three = back to Retell,
instantly, on the next call.

**Where it is enforced (so it cannot leak):** `app-server/src/voiceAgent/gate.ts`
(`evaluateVoiceAgentGate`), checked at (1) switching a number to pipecat, (2) enabling AI
as pipecat, and (3) EVERY inbound call in `voiceAgent/session.ts`. Fails closed on any
error. To fully retire it later: set `VOICE_AGENT_ENABLED` unset and the feature is inert
regardless of flags or number state.

---

## 0. TL;DR for a zero-context agent

- Today the AI phone agent = **Retell**. Retell runs the ENTIRE realtime media loop
  (STT + LLM + turn-taking + tool-calling + TTS). Our `app-server/src/retell/`
  code only runs at **call setup** (inject prompt + dynamic variables + voice + context
  on Retell's inbound webhook) and at **call end** (post-call analysis). During the
  live call we can only act if Retell calls one of our tool webhooks.
- We are replacing Retell's realtime loop with a **self-hosted Pipecat pipeline**
  (STT -> LLM -> tools -> TTS) that plugs into the **SignalWire** telephony we ALREADY
  own, via SignalWire's Twilio-compatible cXML `<Connect><Stream>` media-stream path.
- The AI "brain" and the tools it calls are **already ours** and provider-agnostic:
  `app-server/src/ai/chat-agent/runChatAgent.ts` already runs an OpenAI tool-calling
  loop with a shared tool set, and the tool HTTP endpoints (`/api/calendar-functions`,
  `/api/ai/*`) are called by Retell today and can be reused verbatim. The prompt system
  (`retell_prompts` 7 slots + `promptResolver` + per-call dynamic vars) is ours.
- The NEW thing we must build/run: a **Python voice runtime** (one process per call,
  holding the media WebSocket), a dispatcher/warm-pool to spawn it, and the glue that
  swaps SignalWire's inbound bridge from Retell's SIP gateway to our own media server.
- Three owner goals this delivers: (1) **full mid-call flexibility** (we own the loop),
  (2) a **shared tool library** reusable agent-to-agent (Retell has none), (3) **much
  cheaper** (self-hosted ~$0.04-$0.13/min vs Retell ~$0.13-$0.31/min all-in).
- Plus owner asks: **voice cloning** (upload your voice) via the ElevenLabs API, and
  **inbound + outbound** both first-class.

### ⛔ GUIDING PRINCIPLE: copy from the separate repo wherever it is good; build only the delta
The owner's explicit rule: `C:\dev\Voice-AI-Agent-Builder-Platform` is a real, working,
production-leaning Pipecat build. **Reuse everything from it that is good; do NOT rebuild
from scratch anything it already does well.** For EVERY phase and EVERY component below,
the first step is: "does the separate repo already do this, and is its version good?" If
yes, PORT it (adapt names/tenancy to our repo) rather than writing new code. Only build
fresh when (a) the repo does not have it (shared tool library, voice cloning), or (b) its
version is genuinely not good enough (re-verify against Pipecat's current API; it targeted
0.0.108). This is not just about the Python runtime (section 9): it applies to the flow
engine, node executors, prompt-agent tool dispatcher, provider failover, barge-in/turn
presets, campaign/outbound orchestration, agent versioning, RAG/KB, and the widget. Treat
the repo as a parts bin, not a reference to admire. Section 9 has the port/adapt/skip list.

### Two owner beliefs corrected by the research (do not carry them into the build)
1. "In Retell we can only act at call start or when Retell calls us." **Partly wrong.**
   Retell has `PATCH /v2/update-live-call/{call_id}` (inject context + trigger response
   mid-call). We must MATCH this for parity; self-hosting EXCEEDS it because we own the
   loop and can do anything per frame.
2. "In Retell I have to set up each agent by hand in the dashboard." **The dashboard is
   friction, not an API limit** (Retell has full provisioning APIs). Our real win is
   **agent-config-as-data** (one place, version-controlled, applied to N agents) +
   the shared tool library, NOT "Retell has no API."

---

## 1. The current architecture (verified in code)

### 1.1 The two systems (do not conflate them)
| System | What it is | Keep or replace |
|---|---|---|
| **AI phone-agent BRAIN = Retell** | STT+LLM+turn-taking+tool-calling+TTS for the live call | **REPLACE** with self-hosted Pipecat |
| **Human telephony = SignalWire** | PSTN numbers, inbound routing, IVR, queues, softphone, transfer/conference, recording, voicemail (`app-server/src/voice/`, mid-migration SWML -> Relay SDK) | **KEEP + REUSE** (our carrier/media on-ramp) |

### 1.2 The live inbound flow today (the path we are replacing)
1. PSTN caller dials a SignalWire number with AI enabled.
2. SignalWire runs AI-forward SWML (`app-server/src/voice/providers/aiForward.ts`,
   `buildRetellForwardSwml`): a SIP `connect` to Retell's shared LiveKit SIP gateway
   `sip:+<E164>@5t4n6j0wnrl.sip.livekit.cloud:5060;transport=tcp` (**TCP mandatory**).
3. Retell matches the number (registered via `import-phone-number` with an
   `inbound_webhook_url`) and POSTs `call_inbound` to
   `POST /api/retell/webhooks/inbound-call`.
4. `app-server/src/retell/inboundCall/handler.ts` runs the decision tree: anonymous
   reject -> tenant lookup -> config/vars/funds -> lifecycle/lockout/active gates ->
   test/prod number gating -> parallel enrichment (contact, schedule, KB, next appt,
   recent visits, packages, alerts, preferred tech, flags) -> render 7 prompts + dynamic
   variables + voice bundle -> respond `live` / `transfer` / `hangup`.
5. Retell runs the conversation; mid-call it calls OUR tools over HTTP (see 1.4).
6. Call ends -> Retell fires `call_analyzed` -> `postCallAnalysis.ts` writes
   `call_history`, stores the recording, backfills contact name, emails a summary.
7. Nightly, `retellUsageSync.ts` pulls minutes from Retell `/v3/list-calls` and writes
   `usage` rows (`usage_type='retell'`); `jobs/billing.ts` drains them against the wallet.

### 1.3 The four clean seams to replace Retell (this is the whole integration surface)
1. **The SIP/media bridge** (`voice/providers/aiForward.ts`): swap the `connect` target
   from Retell's LiveKit gateway to OUR media WebSocket (via a cXML `<Connect><Stream>`).
2. **The setup orchestrator** (`retell/inboundCall/handler.ts`): already produces prompt
   + dynamic vars + voice bundle + enrichment. Our runtime consumes the SAME context via
   a new "session bootstrap" endpoint. Reuse the decision tree wholesale.
3. **The tool endpoints** (`/api/calendar-functions`, `/api/ai/*`): provider-agnostic
   HTTP, reused verbatim. Our Pipecat tools call them exactly as Retell does.
4. **Post-call ingestion** (`retell/postCallAnalysis.ts`): feed it OUR end-of-call payload
   instead of Retell's. `call_history` already has `agent_type`/`provider` columns.

### 1.4 The tools the agent can call today (this IS the shared tool library, already)
All authenticated with the shared `Internal-Secret` header; the phone agent and chat
agent DELIBERATELY share the same implementations so they cannot drift.
- **`POST /api/calendar-functions`** (dispatched by `calendar-functions/handlers.ts` by
  `body.action`): `check_availability[_recurring]`, `book_appointment` /
  `book_appointment_direct` (conflict-checked) / `book_appointment_recurring`,
  `cancel_appointment` / `cancel_all_recurring`, `update_appointment` /
  `update_reoccurring_appointment`, `rebook_from_canceled`, `add_to_waitlist`,
  `send_purchase_link`, `send_membership_purchase_link`, `send_gift_card_link`,
  `check_payment_status`.
- **`/api/ai/*`**: `resolve-caller-identity` (`set_caller_identity` disambiguation),
  `contacts-upsert`, `find-appointments`, `appointments-by-date`, `knowledge-base`.
- **Shared logic** in `app-server/src/ai/tools/`: `bookings/`, `contacts/`,
  `knowledge-base/`, `packages/`, `purchase/`, `waitlist/`.
- **The Operations Agent** (`app-server/src/operationsAgent/`) is a SEPARATE, more
  mature tool library: `VERB_REGISTRY` + `READ_TOOLS`, propose->confirm->execute,
  write-AS-THE-CALLER RLS, three-gate security, searchable catalog. This is the model our
  unified tool library should converge on (see 4).

### 1.5 Current audio stack
- **Phone agent: NO self-hosted STT/TTS.** All inside Retell. TTS = ElevenLabs
  (`11labs-*`), default `11labs-Cimo`; `voice_model`/speed/language/temp/volume only
  settable via the superadmin `retell_voice_overrides` test harness. STT/LLM/turn-taking
  are invisible to us in realtime; we only get the transcript in the post-call payload.
- **Separate (NOT the phone agent):** IVR/voicemail greetings use OpenAI TTS
  (`voice/routes/ivr.ts`); voicemail + inbound voice-note transcription use OpenAI Whisper
  (`inbound/voicePipeline.ts`, `voice/voicemailPostProcess.ts`). No Deepgram, no Realtime.

### 1.6 The DB tables in play (all verified live)
`retell_settings` (singleton global config; live_agent_id `<retell-agent-id>`,
inactive_agent_id `<retell-agent-id>`), `retell_prompts` (7 slots +
fragments), `retell_prompt_flags`, `retell_voice_overrides` (voice test harness),
`retell_numbers` (legacy/BYO), `retell_inbound_call_logs` (per-call decision audit),
`voice_numbers` (SignalWire number + AI overlay cols `ai_provider`/`ai_agent_id`/
`ai_sip_termination_uri`/`ai_active`/suspension cols), `location_prompt_variables`
(per-location operator settings incl. the ONLY operator voice field `ai_voice_id`),
`call_history` (provider-agnostic: `agent_type`, `provider`, `metadata`),
`communication_map` (dialed-number -> tenant, number stored WITHOUT `+`), `voice_pricing`
(per-minute rates), `usage` (`usage_type='retell'`).

### 1.7 Wire-format quirks Retell agents are configured against (carry forward carefully)
- The deliberate typo `cnformation_agent_prompt` (do NOT "fix" it while Retell is live).
- Numbers stored WITHOUT a leading `+` in `communication_map.communication_value`.
- `set_caller_identity` writes `{{contact_id}}` back via Retell response variables.
- `promptResolver` template engine: `[[if x]]..[[else]]..[[endif]]`, `{{var}}`, `[[slot]]`
  fragments; NO negation, and it mis-parses nested `[[if]]`. Our runtime must render the
  SAME templates identically (or we re-implement the renderer 1:1 in Python -- see 5.3).

---

## 2. The target architecture

```
   PSTN caller
        |
   SignalWire number (WE OWN)  ---- inbound cXML webhook ----> app-server
        |                                                       (session bootstrap:
        |  <Connect><Stream wss://voice-rt/ws?session=...>       tenant lookup, gates,
        v                                                        prompt+vars+voice+ctx
   voice-rt (NEW Python Pipecat runtime, one process per call)   -> stashed in Redis)
        |   transport.input (mulaw 8k)
        |   -> Silero VAD + Smart Turn v3  (turn detection, local CPU, free)
        |   -> STT (Deepgram nova / Whisper)
        |   -> LLM (OpenAI/Anthropic/Gemini) with the SHARED TOOL LIBRARY
        |        tools call app-server /api/calendar-functions + /api/ai/* (HTTP)
        |   -> TTS (ElevenLabs streaming, incl. CLONED voices) / Cartesia
        |   transport.output (mulaw 8k)
        v
   back to the caller
        |
   call end -> voice-rt POSTs our own end-of-call payload -> app-server
              -> postCallAnalysis (reused) -> call_history + recording + summary + usage
```

### 2.1 Where the new runtime lives
A NEW deployable **Python + FastAPI + Pipecat** service (`voice-rt/`), separate from
app-server (Node). It CANNOT live inside app-server: Pipecat is Python and the
GIL forces **one process per concurrent call**. Deploy pattern (pick in Phase 0):
- **Warm worker pool on one host** (fast, dense) OR **container-per-call** (isolated,
  slower cold start) OR a managed runtime (Modal/Cerebrium/Pipecat Cloud) as a fallback.
- Sizing: ~0.5-1 vCPU + 1-2 GB RAM per concurrent call; Silero+Smart Turn run on that
  CPU (no GPU). ~50 concurrent calls ~= 25-50 vCPU / 50-100 GB.
- Host: Render (matches our infra) or Fly.io (the separate repo already runs the runtime
  on Fly with a Dockerfile we can adapt). DECIDE in Phase 0; do NOT assume.

### 2.2 What stays in app-server (Node, unchanged seams)
- Tenant lookup, gates, enrichment, prompt rendering, dynamic variables, voice bundle
  (the `handler.ts` decision tree -- refactored into a reusable "buildSessionContext").
- All tool HTTP endpoints (the tools the LLM calls).
- Post-call ingestion, billing, number lifecycle, suspension/restore, SignalWire glue.
- Superadmin config surfaces (prompts, flags, voice) -- extended, not replaced.

### 2.3 The session handshake (how a call boots)
1. SignalWire inbound webhook -> app-server builds the FULL session context (reusing
   the `handler.ts` decision tree) and stashes it in **Redis** keyed by a `session_id`,
   then returns cXML `<Connect><Stream url="wss://voice-rt/ws?session_id=..."/>`.
   (This mirrors exactly how the separate repo stashes input vars in Redis by call_id.)
2. SignalWire opens the media WebSocket to `voice-rt`.
3. `voice-rt` reads `session_id` -> fetches the context from Redis -> builds the Pipecat
   pipeline with the resolved prompt, tools, voice, and dynamic vars -> runs the call.
4. On call end, `voice-rt` POSTs the transcript + recording + metrics to a NEW
   app-server endpoint that feeds the reused post-call ingestion.

> Why bootstrap in app-server, not voice-rt: ALL the tenant/gate/enrichment logic
> (and its live-DB access, RLS helpers, funds checks, multi-contact disambiguation) is
> already correct in Node and battle-tested. Re-implementing it in Python would fork a
> huge, security-sensitive surface. Keep ONE brain for "who is calling and what may the
> agent do"; voice-rt is only the media loop + LLM turn.

---

## 3. Component choices (with the reasoning, owner-quality bar)

| Layer | Choice | Why | Alternatives / knobs |
|---|---|---|---|
| Framework | **Pipecat** (BSD-2) | Mature, shared tool library, SignalWire via Twilio cXML path, free CPU turn model, inbound+outbound, BYO everything | LiveKit Agents (heavier, infra-centric), Vocode (less momentum) |
| Telephony | **SignalWire** (already ours) via cXML `<Connect><Stream>` + `TwilioFrameSerializer` | Zero carrier migration; keeps numbers, E911, porting | Twilio/Telnyx are first-class serializers if we ever multi-carrier |
| Turn detection | **Silero VAD + Smart Turn v3** (local CPU, ~12ms) | Kills the "agent interrupts the caller" problem; free; 23 languages | VAD-only (worse feel) |
| **Voice engine** | **Per-agent: (A) OpenAI Realtime S2S OR (B) chained** (see 3.2) | Owner wants the most human voices; S2S is the leader, and Pipecat makes it a per-agent knob sharing the same tools | A = premium/most-human; B = deterministic/self-serve-clone/cheap-predictable |
| STT (engine B only) | **Deepgram** (nova) default; Whisper self-host later | Lowest-latency streaming; cheap | AssemblyAI, Gladia, local Whisper |
| LLM (engine B only) | **OpenAI/Anthropic/Gemini** via Pipecat, pick per-agent | Reuse our existing model plumbing + telemetry | LLMSwitcher for failover/A-B; Ollama self-host later |
| TTS (engine B only) | **ElevenLabs streaming** (incl. cloned voices) default; Cartesia cheaper | Matches today's `11labs-*` voices; self-serve cloning; word timestamps | Cartesia (~half cost), self-host Kokoro/Piper (compute-only) |
| S2S model (engine A) | **`gpt-realtime-2.1`** (flagship) / `-2.1-mini` (cost) | Most human, lowest latency, tools supported, mid-session steer | Voices marin/cedar; OpenAI Custom Voice (sales-gated) for clones |
| On-rails flows | **Pipecat Flows** for booking/intake/payment | Guarantees the agent asks the right things in order, can't call the wrong tool at a step | Single-context agent for open-ended chat |
| Session state | **Redis** | Already the separate-repo pattern; per-call transient bootstrap + resume | -- |

### 3.2 THE VOICE ENGINE IS A PER-AGENT CHOICE (owner ask: the most human, futuristic voices)

Owner goal: "the best and most futuristic, insanely human voices possible." The most human
option today is a **speech-to-speech** model, and OpenAI's Realtime API is the leader.
Pipecat makes this ADDITIVE, not a rebuild: the voice engine is chosen PER AGENT / per
pipeline, and BOTH engines share the SAME tool library. So we offer two engines and pick
per agent:

| Engine | What it is | Use it for | Tradeoff |
|---|---|---|---|
| **A. Speech-to-speech: OpenAI Realtime** (`gpt-realtime-2.1`, mini for cost) via Pipecat `OpenAIRealtimeLLMService` | ONE model does audio-in -> audio-out; preserves emotion/prosody/laughter; native barge-in; lowest latency | The premium, "insanely human" tier; agents that want the most natural voice + lowest latency | For THAT call, STT/LLM/TTS are FUSED in one model. You cannot swap in Deepgram/ElevenLabs mid-pipeline. The swappability moves UP a level (choose engine per agent), it is not lost. Model change needs a reconnect (connection-level). |
| **B. Chained: Deepgram STT -> LLM -> ElevenLabs/Cartesia TTS** | Three swappable stages | Agents needing deterministic tool control, self-serve voice cloning TODAY (ElevenLabs), predictable component pricing, or a specific TTS voice | Slightly higher latency; emotion from the caller's audio is flattened by the transcribe step |

**Both engines register the SAME shared tool library** (Pipecat exposes `tools` in the
Realtime session config exactly like the chained LLM does). So building engine A does NOT
fork the tools. The `voice_agents` config row carries an `engine: 's2s_openai' | 'chained'`
field; `voice-rt` builds the matching pipeline. This is the recommended shape: Pipecat +
SignalWire stay constant; the engine is a per-agent knob.

**Facts that shape the build (verified 2026-09-22):**
- The owner's "Agent One" is not a real product. He means the **OpenAI Realtime API** +
  the `gpt-realtime-*` models. (AgentKit / Agent Builder is a SEPARATE text/workflow
  product line, mostly irrelevant here, and Agent Builder is being deprecated 2026-11-30.
  Do NOT build on Agent Builder.)
- **Most human preset voices:** `marin` (female) and `cedar` (male), Realtime-exclusive;
  plus alloy/ash/ballad/coral/echo/sage/shimmer/verse. Emotion/tone/pace/accent are steered
  by the instructions prompt.
- **Voice cloning ("upload my voice"):** OpenAI **Custom Voices** exists and works with the
  Realtime API (30s sample + a mandatory verbatim consent recording), BUT it is
  **sales-gated** (eligible customers only, max 20 voices/org, not self-serve). So: pursue
  OpenAI Custom Voices for the S2S tier, but the SELF-SERVE clone path TODAY is
  **ElevenLabs** (chained engine). Offer cloning on BOTH tiers, sourced from whichever
  provider that tier uses. See 5.2.
- **Telephony fit:** keep SignalWire as carrier + Pipecat as orchestrator; SignalWire media
  stream -> Pipecat -> OpenAI Realtime WebSocket (option C). OpenAI ALSO has native SIP
  (`sip:{project-id}@sip.api.openai.com`), but that cedes the audio path to OpenAI and
  bypasses Pipecat/our tools control, so it is NOT our default; the Pipecat path keeps
  control + the shared tools.
- **Mid-session steering:** Pipecat `LLMUpdateSettingsFrame` changes instructions/config
  mid-call without reconnect (model change needs reconnect). This covers the Retell
  update-live-call parity for the S2S tier too.

### 3.2.1 How we SELL the two engines (owner decision 2026-09-22: offer both)

Offering both engines is the plan, but NOT as a raw "engine A vs B" toggle (a salon owner
does not know what "speech-to-speech" means). Ship it as a PRODUCT:

- **Two named tiers, priced per-minute differently:** "Standard voice" (engine B, chained,
  cheaper) and "Lifelike voice" / "Premium AI voice" (engine A, OpenAI Realtime S2S). The
  engine is an implementation detail behind the tier. Put a play-the-difference audio sample
  on the plan/settings screen so the operator HEARS why the premium tier costs more.
- **The customer chooses the tier per agent, and it is hot-swappable** (both engines share
  one prompt + one tool library, so flipping the tier is a config change, not a rebuild).
  `voice_agents.engine` carries it. Billing meters the two tiers at different per-minute
  rates (extend `voice_pricing` with a tier dimension).
- **Automatic fallback (reliability win over Retell):** if the S2S engine has a bad moment
  (OpenAI blip / latency spike / error), the call degrades to the chained engine rather than
  dropping. Same tools, same prompt, so the caller barely notices. Build this into voice-rt
  as a per-call failover (the separate repo already has a `failover/` pattern to port).
- **Do NOT gate launch on voice cloning.** The "my exact voice on the most-human engine"
  combo may not exist day one (OpenAI clone is sales-gated; ElevenLabs self-serve clone is
  engine B). Ship the premium tier on the excellent presets (cedar/marin) and add cloning as
  a fast-follow. A gated feature must not hold the rebuild.

### 3.2.2 What makes it the BEST agent (build these in, not just the voice)

The voice is table stakes. These are the real differentiators vs Retell, build from the start:
1. **Breadth of SAFE action.** The phone agent reaches the SAME shared tool library as the
   Operations Agent, under the caller's real RLS (see 4 + 7). Book, reschedule, take a
   deposit via payment link, check a package/membership balance, join a waitlist, answer from
   the knowledge base, warm-transfer to a human. The differentiator is safe breadth, not voice.
2. **Latency is a feature.** Target <=800ms voice-to-voice; S2S + Smart Turn v3 is where we
   beat Retell's shared-infra spikes. Measure per call; surface it in observability.
3. **Knows the caller before "hello."** Lean into the enrichment we already do (contact,
   history, packages, alerts, preferred tech): "Hi Maria, rebooking your color with Jen?"
   Perceived intelligence beats a nicer voice.
4. **Conversational realism:** barge-in, backchannel ("mm-hm"), and NEVER dead-air on a tool
   call ("let me pull that up"). This is separate from the voice model and matters as much.
5. **Outbound is first-class, not an afterthought.** Reminders that can actually rebook,
   waitlist fills, no-show win-back, review requests. Outbound drives the customer's revenue,
   which drives OUR retention. (Elevated in the phasing; see 5.1.)
6. **The owner-facing builder is the moat.** Agent-config-as-data + the shared tool library
   means a new agent is a row + a list of tool ids, NOT dashboard ceremony (Retell's pain).
   End state: the Operations Agent itself builds/edits a phone agent by chat ("make me a
   receptionist that books and offers the fall promo"). That is the futuristic story.

### 3.3 Cost model (the build-vs-buy math, from research)
- **Self-hosted all-in:** aggressive (Gemini Flash + Cartesia/self-host TTS + Deepgram +
  our carrier) ~**$0.04-$0.06/min**; premium (Claude/GPT + ElevenLabs cloned + Deepgram)
  ~**$0.09-$0.13/min**.
- **Retell all-in for the same quality:** ~**$0.13-$0.31/min** (their $0.055/min
  voice-infra markup sits ON TOP of the same LLM/TTS/telephony we'd pay anyway), plus
  $2/mo/number and $8/mo per concurrent call over 20, plus per-min add-ons (denoise,
  guardrails, PII, QA).
- **Savings:** ~$0.05-$0.10/min of pure platform margin removed. At 50K min/mo, on the
  order of **$2.5K-$5K/mo saved**; the offset is engineering + always-on voice-rt compute.
- **The biggest per-minute lever is TTS.** ElevenLabs ~$0.06-$0.10/min; Cartesia ~half;
  self-host Kokoro/Piper ~= compute only. Voice quality vs cost is an owner call per tier.
- **OpenAI Realtime (S2S engine, engine A) cost:** `gpt-realtime-2.1-mini` ~$0.02-$0.05/min
  cached (cheaper than a chained Deepgram+ElevenLabs stack); flagship `gpt-realtime-2.1`
  ~$0.06-$0.11/min cached (comparable, and it BUNDLES the LLM). ⛔ Costs balloon to
  $0.18-$0.46/min WITHOUT prompt caching, so caching discipline is mandatory on the S2S
  tier. Pricing is token-based (audio in $32/1M, audio out $64/1M for flagship; ~600
  input + ~1200 output tokens per talk-minute). This gives the owner a premium tier that is
  the MOST human AND not more expensive than the chained premium tier.

---

## 4. The shared tool library (the owner's #1 architectural ask)

**Goal:** define a tool ONCE, reuse it across EVERY agent (phone, chat, and any future
agent), version it once, and never redefine per-agent the way Retell forces.

**We already have two tool systems; converge on one contract.**
- The chat/phone tools (`ai/tools/*` + the `/api/calendar-functions` + `/api/ai/*` HTTP).
- The Operations Agent's `VERB_REGISTRY`/`READ_TOOLS` (richer: propose->confirm->execute,
  write-as-caller RLS, three-gate, catalog).

### 4.1 Design: a Tool Registry as data + a thin per-runtime adapter
1. **One canonical tool definition** (name, description, JSON-schema params, handler
   pointer, permission, side-effect class read/write, confirm-required?). Store the
   CATALOG as data (a `voice_agent_tools` table + code registry), NOT inline-per-agent.
2. **Agents reference tools by id** (an agent = config + a LIST of tool ids + a prompt +
   a voice + a flow). Adding a tool to an agent = adding an id, not copying a definition.
3. **The handler is HTTP** (the tools already are). Pipecat's Python tool wrappers call
   the same app-server endpoints. So the "handler" is provider-agnostic and shared by
   the chat agent (Node loop) and the phone agent (Python loop) alike.
4. **Mid-call tool swapping** is native (Pipecat `LLMSetToolsFrame`) -- e.g. expose
   `take_payment` only after the caller agrees to book. Flows scopes tools per node.
5. **Security parity:** where a tool WRITES, it must honor the caller's RLS/permissions
   exactly as the Operations Agent does (write-as-the-caller or replicate the rule). The
   phone agent's "caller" is the calling CUSTOMER (usually anon/limited) OR, for outbound
   staff-driven calls, the operator -- get this scoping right per tool (see 7 Security).

### 4.2 Concretely, in this repo
- New table `voice_agents` (the agent-config-as-data: name, mode prompt|flow, model,
  voice_id, tool_ids[], flow_id?, guardrails, language, per-agent overrides).
- New table `voice_agent_tools` (the shared library: id, name, description, params jsonb,
  handler_kind http|verb, endpoint/action, permission, confirm_required, side_effect).
  Seed it from the EXISTING tool list in 1.4 so day-one parity is exact.
- `voice-rt` loads an agent's `tool_ids`, resolves each to a definition, wraps it as a
  Pipecat function, and dispatches to the HTTP handler. ONE library, N agents, both
  runtimes.

---

## 5. Feature-parity checklist (must match Retell before cutover)

Build every row; a gap here = a regression a real customer feels.
- [ ] Inbound call answered by the agent (the core loop).
- [ ] Per-call dynamic prompt + variables (reuse `handler.ts` context).
- [ ] The full tool set in 1.4 (booking/cancel/update/availability/waitlist/purchase/
      giftcard/membership/payment-status/caller-identity/KB).
- [ ] Knowledge-base RAG mid-call (we have KB tools; wire retrieval into the prompt/tool).
- [ ] Warm + cold transfer to a human (reuse the SignalWire transfer/conference work in
      `voice-relay-migration.md`; on transfer, disable Pipecat `auto_hang_up`).
- [ ] Fallback/inactive path (funds out, AI off, blocked number) -> transfer or hangup,
      exactly as `buildTransferResponse` does today.
- [ ] Post-call analysis: transcript, sentiment, ~25 extracted fields, recording to
      `phone_call_recordings`, contact-name backfill, summary email (reuse
      `postCallAnalysis.ts`; feed our payload).
- [ ] Billing per-minute from OUR call records (replace the Retell `/v3/list-calls` pull).
- [ ] Multi-contact-per-phone disambiguation (`set_caller_identity`).
- [ ] Voice selection (the curated `AI_VOICES` + the `retell_voice_overrides` bundle
      shape -> becomes our own voice config; see 6).
- [ ] Test mode / prod blocklist gating (reuse the handler gates).
- [ ] **Mid-call server push (Retell parity):** an endpoint to inject context + trigger a
      response into a LIVE call (we own the loop, so this is trivial: push a frame).
- [ ] **Outbound calling** (see 5.1).
- [ ] Concurrency: match/exceed Retell's 20 (no per-slot fee for us; we size compute).
- [ ] Latency: target <=800ms voice-to-voice p99 (Retell's SLA) -- MEASURE it (see 8).
- [ ] Voice engine selectable per agent (chained default first; OpenAI Realtime S2S added
      in Phase 3 for the most-human tier) -- see 3.2. Both share the tool library.

### 5.1 Outbound (new capability; Retell has it, we mostly don't)
Today outbound exists only as in-call transfers + a queue-overflow bridge. Build:
- **One outbound call:** app-server originates via SignalWire REST -> on answer,
  SignalWire opens the media stream to voice-rt with a session context we stashed. This
  powers: appointment reminders that can converse, waitlist offers, no-show win-back,
  review requests, and the Operations Agent placing a call on the operator's behalf.
- **Batch/campaign outbound:** a queue (BullMQ or our existing job infra) that paces
  dials, respects quiet hours + TCPA + opt-out (reuse the SMS opt-out + marketing-hours
  rules), and records outcomes. (Design-align with `sms` opt-out + the campaign model.)

### 5.2 Voice cloning (owner ask: "upload my voice") -- offer on BOTH engines
- **Self-serve TODAY = ElevenLabs (chained engine B).** ElevenLabs supports
  Instant/Professional cloning via API (upload up to 25 audio files; any natural speech,
  no fixed script). Pipecat streams any `voice_id` incl. clones. Build: an operator/superadmin
  UI uploads audio -> ElevenLabs create-voice API -> store `voice_id` -> selectable voice.
  This is the path that works immediately with no gatekeeper.
- **Premium/most-human = OpenAI Custom Voices (S2S engine A).** Works with the Realtime API
  (30s sample + a MANDATORY verbatim consent recording), but is **sales-gated** (eligible
  customers only, max 20 voices/org, API-only, not self-serve). Pursue the OpenAI approval
  in parallel; until granted, the S2S tier uses the preset voices (cedar/marin are the most
  human). Once approved, a cloned voice drives the S2S agent for the "insanely human, it's
  literally my voice" experience.
- Consent + guardrails apply to BOTH: capture whose voice, an explicit consent record
  (OpenAI requires a fixed spoken phrase; do the same for ElevenLabs), per-company vs
  platform library scope, the provider voice caps (ElevenLabs 100/account raise via support;
  OpenAI 20/org), and cost. DECIDE scope in Phase 3.
- This also satisfies the Retell "custom voice" open item in `RETELL_VOICE_SYSTEM_SOT.md`
  (Level 2 add-voice), but now WE own the registration, not Retell.

### 5.3 The prompt renderer decision (VERIFY before Phase 2)
`promptResolver.ts` is a Node template engine with known quirks (no negation, nested-if
mis-parse). Two options: (a) render the prompt in app-server (Node) at bootstrap and
pass voice-rt the FINISHED string (PREFERRED -- one renderer, no fork, voice-rt stays
dumb), or (b) re-implement the renderer in Python 1:1 (risk: drift). **Prefer (a):** the
session bootstrap already runs in Node, so render there and hand voice-rt the final text.

---

## 6. Migration & cutover (per-number, reversible, never a flag-day)

Mirror the proven `voice-relay-migration.md` cutover discipline.
- **Add `voice_numbers.ai_provider`** already exists ('retell' today). Introduce
  `'pipecat'` as the second value. The number's `ai_provider` decides which SIP/stream
  bridge `aiForward.ts` emits.
- **Per-number cutover:** flip ONE number to `'pipecat'`, point its inbound bridge at
  voice-rt, place a test call, verify the full loop + post-call + billing, watch for a
  week, then widen. Reversible by flipping back to `'retell'` and re-pointing the bridge.
- **Order:** a dev/booth number first, then low-traffic customers, then high-traffic.
- **Keep Retell running** the whole time (both paths coexist). Do NOT delete any Retell
  code, table, or the two global agents until a full cohort has run clean for weeks AND
  the owner authorizes it (DROPs need explicit owner permission per the DB gate).
- **Maintenance banner** if any window has code deployed before its DB migration.

---

## 7. Security (non-negotiable, per `security-rls-permissions` + `internal-ai-agent`)

- **Tool writes honor the caller's real RLS.** The phone agent's "caller" is usually the
  CUSTOMER (anon/limited) -- tools must be scoped so the agent can only do what that
  customer could (e.g. book/cancel THEIR own appt), never company-wide. For outbound
  staff-initiated calls, the caller is the OPERATOR -> write-as-the-caller with their JWT.
  Get this per-tool; a service-role write that bypasses RLS is the classic IDOR here.
- **The media WebSocket must authenticate the session** (`session_id` is single-use,
  short-TTL, minted by app-server, validated on WS connect). Never accept an
  unauthenticated stream (that would let anyone drive an agent as any tenant).
- **The app-server <-> voice-rt link** uses the shared `Internal-Secret` (same as the
  existing tool endpoints) + a signed session token. voice-rt holds NO Supabase
  service-role key for tenant data; it asks app-server, which enforces scope.
- **Recording consent + PII:** match today's behavior (recording announce where required,
  transcript storage). Reuse `voice/recording.ts` patterns and the recording bucket.
- Any new `SECURITY DEFINER` RPC follows the DB gate (verify ownership in-body, revoke
  anon/authenticated unless truly needed).

---

## 8. How we prove it works (verification bar, per `report-verification` + owner rules)

- **Latency MEASURED, not assumed:** instrument voice-to-voice p50/p95/p99 per call
  (mirror `call_history.metadata` latency fields Retell gave us). Target <=800ms p99.
- **A/B against Retell on the same numbers/scripts** before cutover (Retell has A/B; we
  compare call feel, interruption rate, tool success, transcript quality).
- **Every tool call logged** (success/failure, args, result) as today.
- **Full-loop test per cutover number:** real inbound call -> books a real (test) appt ->
  post-call row + recording + summary + usage all correct.
- **Cost per call captured** (`total_cost_cents`) from OUR component costs, so the billing
  page and the P&L stay truthful.
- Cold typecheck the Node changes; the Python runtime gets its own test suite (pytest,
  as the separate repo has).

---

## 9. What to reuse from the separate `Voice-AI-Agent-Builder-Platform` repo

It is a real, production-leaning Pipecat build on SignalWire (~60k LOC). It is a
STANDALONE monorepo (web + Fastify API + Python runtime, its own Supabase/`workspaces`
multi-tenancy). The owner wants ONE system in THIS repo, not a second product. So:
- **PORT (highest value):** the **Python Pipecat runtime** (`apps/runtime/`): the
  `TwilioTransport` (mulaw<->PCM codec, resampler, Silero VAD at the transport),
  barge-in/interruption handling, turn-taking presets, provider failover, the pipeline
  factory, careful WebSocket teardown, coaching/monitor. This is the expensive, correct
  part and matches our SignalWire (it already uses SignalWire through the Twilio-compat
  API despite the stale "twilio" naming). Adapt it into `voice-rt/`.
- **ADAPT the ideas:** the flow engine + node registry (a visual builder later), the
  prompt-agent tool-execution model (a good base for our shared library), agent
  versioning/flow-diff, the RAG/KB pipeline.
- **DO NOT bring:** its `workspaces`/`workspace_members` multi-tenancy (we use our
  Supabase RLS + company/location + subscription model), its three-host topology as-is,
  its Windows/OneDrive/ngrok dev tooling, its stale docs/naming.
- **It LACKS what the owner wants most:** a shared tool library, and voice cloning. Those
  are net-new here (sections 4 and 5.2).
- **Biggest integration cost, acknowledged:** it drags in a separately-hosted Python
  service. That is unavoidable for any serious Pipecat build; the separate repo has
  already solved it well, so we port rather than reinvent.

> Before porting a file, read it in full and re-verify against Pipecat's CURRENT API
> (it targeted Pipecat 0.0.108 with at least one version-specific workaround). Pin the
> Pipecat version in `voice-rt/` and note it here.

### 9.1 The granular port/adapt/skip inventory (act on this file-by-file)
Paths are in `C:\dev\Voice-AI-Agent-Builder-Platform\`. Read each in full before porting.

**PORT nearly as-is (the expensive, correct media engineering):**
- `apps/runtime/src/pipeline/factory.py` -- the pipeline assembly (transport -> barge_in
  -> stt -> flow_processor -> voice_switcher -> sentence_aggregator -> tts -> normalizer
  -> hold_music -> output). This is the shape of `voice-rt`.
- `apps/runtime/src/pipeline/transport.py` -- the SignalWire/Twilio Media Streams transport.
- `apps/runtime/src/audio/codec.py` + `audio/resampler.py` -- mulaw<->PCM + resampling.
- `apps/runtime/src/calls/routes.py` -- inbound handler + the careful WebSocket teardown
  (disconnect watcher raced against the pipeline runner). Its after-hours voicemail +
  route-alternate are TODO stubs; fill those from OUR existing voice/ logic.
- `apps/runtime/src/calls/outbound.py` + the Redis input-var stash pattern -- our outbound.
- `apps/runtime/src/failover/` (provider failover), the turn-taking presets, barge-in.
- `apps/runtime/src/pipeline/processors/{stt,tts}.py` -- but re-decide providers (see 3).
  Note: their STT subclass works around a Pipecat 0.0.108 Deepgram language-enum bug;
  confirm whether the pinned version still needs it.

**ADAPT the design (good ideas, reshape to our repo):**
- `apps/runtime/src/engine/flow_runner.py` + `engine/node_executors/*` + web
  `features/builder/lib/nodeRegistry.ts` (18 node types) -- the flow engine + visual
  builder. Maps onto Pipecat Flows. In-scope now or later per open question 5.
- `apps/runtime/src/engine/prompt_agent.py` (`_execute_tool`, native tool-calling, 5-round
  loop) + web `features/prompt-agent/components/{ToolsTab,ToolEditorModal}.tsx` -- the
  BEST base for our shared tool library (section 4). It has the typed-tool -> function-call
  -> HTTP/transfer/callback dispatcher; we add the "as data, referenced by id, one library"
  layer it lacks.
- Agent versioning + flow-diff (`apps/api/src/routes/agent-versions.ts`, `agent-lock.ts`).
- RAG/KB: `kb_chunks` + `match_kb_chunks` RPC pattern (we already have KB tools; align).
- `packages/widget` (embeddable web-call widget, Daily WebRTC) -- for a web voice widget.

**SKIP / replace (do NOT bring):**
- Its `workspaces` / `workspace_members` multi-tenancy -> use OUR company/location +
  Supabase RLS + subscription model.
- Its three-host topology as-is, and the Windows/OneDrive/ngrok dev tooling (`dev.bat`).
- Its stale docs + "twilio" naming (it is SignalWire under the Twilio-compat API).
- Its Drizzle schema -> our tables (`voice_agents`, `voice_agent_tools`, reuse call_history).

**MISSING there, build fresh (the owner's two favorites + one more):**
- The shared tool library AS DATA (section 4). Base it on their prompt-agent dispatcher.
- Voice cloning (section 5.2). Their repo uses fixed ElevenLabs voice_ids only.
- The session bootstrap that reuses OUR Node `handler.ts` decision tree (section 2.3);
  theirs does tenant/hours lookup in Python, which we deliberately keep in Node.

---

## 10. Phased build plan (each phase independently shippable + reversible)

Legend: [TODO] [DOING] [DONE] [BLOCKED].

### Phase 0 -- Foundations & decisions (no customer impact) [DONE in code 2026-09-22, untested live]
- [x] DECIDED: host = Render (Docker web service, `voice-rt/render.yaml`), same as the
      Evolution WhatsApp service; concurrency = one uvicorn process running N asyncio
      pipelines (Pipecat 1.x is asyncio-native), `MAX_CONCURRENT_CALLS` guard, scale
      by instance size/count (any instance can serve any call).
- [x] Pipecat pinned `1.11.0`; `voice-rt/` FastAPI + Pipecat runtime with `/health` + Dockerfile.
- [ ] Prove the SignalWire `<Connect><Stream>` media path on ONE scratch number (needs
      the runtime deployed + keys; see 11b runbook).
- [x] Session bootstrap: NO Redis (none in this stack, single app-server instance);
      in-memory `sessionStore.ts`, single-use claim, TTL sweep with alerts.
- [x] voice-rt <-> app-server auth: `X-Voice-Agent-Secret` (constant-time), `/api/internal/voice-agent/*`.

### Phase 1 -- Minimal end-to-end AI call (dev number only) [DONE in code, untested live]
- [x] `handler.ts` refactored into `resolveInboundCall()` (one brain) + Retell adapter.
- [x] voice-rt pipeline (engine B): transport -> Deepgram -> Silero + Smart Turn v3 ->
      OpenAI -> ElevenLabs -> transport; multi-prompt state machine (7 states).
- [x] FULL tool set wired: chat `TOOL_DEFS` + voice-only tools, ONE definition in Node,
      voice-rt proxies every call (`/tool-call`). Parity with what Retell calls today.
- [x] End-of-call payload -> `/sessions/:id/end` -> LLM analysis -> reused `postCallAnalysis`
      (+ recording upload to the same bucket, + usage row).
- [x] `ai_provider='pipecat'` handling in every LaML branch (direct, IVR transfer_ai,
      overflow, ring-out, post-conference); SWML/Relay paths fall through + page.
- [ ] Full-loop test on a dev number (needs keys + deploy + migration; runbook in 11b).

### Phase 2 -- Parity hardening [PARTIAL]
- [x] Cold transfer to the human fallback (`transfer_call` -> modify-call -> `<Dial>`);
      inactive path = direct `<Dial>` to the fallback (no AI leg billed); blocked/test
      gating (inherited from `resolveInboundCall`). [ ] Warm transfer.
- [x] Knowledge base: in the prompt at call start (as Retell). [ ] Mid-call RAG refresh.
- [x] Multi-contact disambiguation (`set_caller_identity`, shared resolver).
- [x] Mid-call server push: `/api/voice-agent/admin/sessions/:id/inject` (instruct +
      trigger, or say verbatim) + hang-up; superadmin UI.
- [x] Billing from our own call records (usage row per call; Retell pull untouched for
      Retell calls).
- [ ] Pipecat Flows for the booking/intake/payment on-rails flow.
- [ ] A/B vs Retell on matched scripts; close every gap in the section-5 checklist.
- [x] Automatic S2S -> chained fallback at CONNECT TIME (voice-rt `calls/routes.py`): if the
      OpenAI Realtime engine fails to build, rebuild once on the chained engine before audio
      flows, emit an `engine_fallback` event. A mid-conversation swap is deliberately NOT
      done (it would tear the live audio bridge); a Realtime failure after audio starts ends
      the call normally and the next call retries S2S.
- [x] Tiered billing BUILT (plan column `retell_rate_per_min_premium`, migration
      `20260922_120000` applied; Lifelike usage tagged `[tier:premium]`, billing.ts splits
      + prices premium at `retell_rate_per_min_premium ?? retell_rate_per_min`; no change to
      any current customer until a premium rate is set). See section 5's tier row for detail.

### Phase 3 -- The owner differentiators [TODO]
- [ ] The shared **tool library as data** (`voice_agent_tools` + `voice_agents`), seeded
      from 1.4; agents reference tools by id; mid-call tool scoping via Flows/LLMSetTools.
- [x] **Second voice engine (S2S): OpenAI Realtime** via Pipecat `OpenAIRealtimeLLMService`
      (built in code, untested live; selected globally by `VOICE_AGENT_DEFAULT_ENGINE`
      until `voice_agents.engine` exists). Same tool library registered on it. State
      switch via `LLMUpdateSettingsFrame`. [ ] Per-agent selection. [ ] Prompt-caching
      cost check on real calls.
- [ ] **Two named tiers + tiered billing:** "Standard" (engine B) / "Lifelike" (engine A),
      priced per-minute differently (`voice_pricing` gains a tier dimension), with a
      play-the-difference sample on the settings/plan screen. Hot-swappable per agent.
- [ ] **Automatic S2S -> chained fallback** mid-call (reliability win over Retell): on
      OpenAI blip/latency/error, degrade to the chained engine, same prompt + tools, caller
      barely notices. Port the separate repo's `failover/` pattern.
- [ ] **Voice cloning on BOTH engines:** ElevenLabs create-voice (self-serve, engine B) +
      pursue OpenAI Custom Voices approval (sales-gated, engine A). Consent capture + scope
      + cost decided here.
- [x] **Outbound single call:** `voiceAgent/outbound.ts` (`startOutboundCall`) + the
      `/laml/voice-agent/outbound-answer` cXML + `/api/internal/voice-agent/outbound`
      (Internal-Secret) + superadmin `/outbound-test` + the Operations Agent verb
      `place_voice_call` (operator says "call Maria and remind her...", propose->confirm).
      Gated by the SAME test gate. voice-rt `kick_off` is direction-aware (outbound agent
      speaks first).
- [x] **Voice Do-Not-Call (TCPA-correct, separate channel from SMS):** new table
      `voice_call_opt_outs` + `is_call_opted_out(company,phone,scope)` (migration
      `20260922_110000_voice_call_opt_outs.sql`, APPLIED + verified; mirrors sms_opt_outs
      shape/RLS/ACL). `startOutboundCall` blocks an opted-out number (fails SAFE on a
      lookup error). New voice tool `mark_do_not_call` lets the agent record an opt-out
      mid-call ('marketing' or 'all'). [ ] Operator DNC UI + resubscribe (next).
- [x] BATCH/CAMPAIGN outbound BUILT (its own subsystem, not bolted on SMS). Tables
      `voice_campaigns` + `voice_campaign_recipients` (migration `20260922_130000`, APPLIED,
      self-contained location-scoped RLS). `voiceAgent/campaigns.ts`: `createVoiceCampaign`
      (contact list -> recipients, dedup, from-number verify) + `runVoiceCampaignsJob` (cron
      every minute, registered in jobs/index.ts): dials up to `max_concurrency` per campaign
      measured against the live session store, within quiet hours (called-tz, TCPA 8-21
      default), skips opted-out numbers (voice DNC), retries no-answers to `max_attempts`,
      reconciles finished 'calling' rows, closes the campaign when drained. Reuses the SHARED
      `startOutboundCall` (gate + DNC + tools + post-call all apply). Internal endpoint
      `POST /api/internal/voice-agent/campaign`. Inert unless the test gate is open.
      Ops Agent verb `launch_voice_campaign` DONE (operator says "call my no-shows and offer
      to rebook", propose->confirm->creates+starts). [ ] Operator campaign page + DNC page:
      DELIBERATELY NOT built (owner 2026-09-23: the operator frontend stays as-is; a company
      flipped on via the superadmin portal silently uses the new system for anything touching
      the AI phone; superadmin drives testing). So no operator UI is in scope.

### CAPTURE DURABILITY (owner 2026-09-23: "every phone call fully recorded, everything into the system")
Verified field-by-field that a self-hosted call writes the SAME `call_history` shape a live
Retell call does (pulled a real Retell row): id/company/direction/status/duration/transcript/
summary/recording_bucket_id/timestamps/from/to/call_sid/contact/location/total_cost_cents +
metadata.{user_sentiment,call_successful,tool_calls,latency,llm_token_usage,disconnection_reason,
ai_extracted_user_name,in_voicemail,product_costs} -- all via the SHARED processPostCallAnalysis.
Three durability gaps closed (Retell can't lose a call; our runtime could):
- **Missing recording alerts:** `finalizeVoiceAgentCall` fires `voice_agent_missing_recording`
  when a real conversation (>=3s, not error/timeout) has no recording_bucket_path.
- **Orphaned-call reconcile:** if voice-rt dies without POSTing /end, the sessionStore sweeper
  detects a live session silent >5min and calls `reconcileOrphanedSession`, which SYNTHESIZES a
  minimal end payload and writes the call_history row (so the call is NEVER missing) + alerts
  `voice_agent_orphaned_call`.
- **Heartbeat:** voice-rt pings /events every 60s during a live call so a healthy long call
  keeps last_event_at fresh and is never falsely orphaned (only a truly dropped runtime goes
  stale). The teardown (calls/routes.py finally) already isolates each step so recording upload
  + end report always run on any exit.
- [ ] Agent-config-as-data so a new agent is a row, not a dashboard setup.

### Phase 4 -- Cutover & scale [TODO]
- [ ] Per-number cutover (dev -> low -> high traffic), each watched a week, reversible.
- [ ] Concurrency/autoscaling (warm pool sizing, dispatcher, reconnection).
- [ ] Latency tuning to <=800ms p99; region placement.
- [ ] Superadmin observability: live call monitor, per-call cost, tool success dashboard.

### Phase 5 -- Retire Retell (owner-authorized) [TODO]
- [ ] After a full cohort runs clean for weeks AND the owner says so: stop registering new
      numbers with Retell; migrate remaining numbers; then (with explicit owner DROP
      permission) retire Retell code/tables/agents. Archive, do not rush.

### Phase 6 (later, optional) -- Our own model [TODO]
- [ ] Once we have a large corpus of real spa/salon/customer-service call transcripts,
      evaluate fine-tuning/self-hosting a domain model (Ollama/vLLM) for cost + quality.
      This is a Pipecat one-line LLM swap when ready. Do NOT block the rebuild on it.

---

## 11. Open questions to settle (answer via Self-Answer Test first; only genuine product calls reach the owner)
1. voice-rt host + concurrency model (Phase 0 decision -- pick the cheapest that hits
   latency; likely warm pool on Render/Fly).
2. Default voice engine + tiers per plan: which agents/plans get the OpenAI Realtime S2S
   premium tier vs the chained tier; default STT/LLM/TTS for chained (ElevenLabs vs
   Cartesia); and whether S2S is the default for everyone once caching is proven cheap.
   Also: apply for OpenAI Custom Voices eligibility (sales-gated) if cloned S2S voice is wanted.
3. Voice-cloning scope: per-company library vs platform, consent capture, who can upload.
4. Outbound TCPA/quiet-hours/opt-out rules (reuse SMS marketing rules; confirm they map).
5. Whether the visual flow builder (from the separate repo) is in-scope now or later.

---

## 11b. WHAT IS BUILT (2026-09-22) and the runbook to first call

### The code map (verify against the tree; the code is truth)
**app-server (Node, the brain), all typecheck-clean (warm + cold):**
- `src/retell/inboundCall/handler.ts`: refactored into `resolveInboundCall()` (the
  provider-agnostic decision tree + enrichment + prompt render) and the thin
  `handleInboundCall()` Retell adapter. ONE brain for both providers.
- `src/voiceAgent/` (NEW):
  - `types.ts` (session/context/end-payload contracts, the 7 states, the
    state-switch tool names the live prompts use),
  - `sessionStore.ts` (in-memory, single-use claim, TTL sweep + alerts),
  - `session.ts` (`answerInboundWithPipecat`: resolve -> live/transfer/hangup cXML;
    `buildVoiceAgentSession`; `{{dynamic_var}}` substitution; decision audit into
    `retell_inbound_call_logs`),
  - `tools.ts` (the SHARED tool library: chat `TOOL_DEFS` + voice-only
    `set_caller_identity` / `transfer_call` / `end_call` / `*_agent_transfer`;
    `dispatchVoiceTool` reuses the chat `dispatchTool`),
  - `voices.ts` (Retell voice id -> ElevenLabs voice / OpenAI Realtime voice; VERIFY
    the mapping by ear before cutover),
  - `laml.ts` (`<Connect><Stream>` with `session_id` as a `<Parameter>`, transfer
    `<Dial>`, hangup), `rtClient.ts` (health / inject / hangup -> voice-rt),
  - `postCall.ts` (LLM post-call analysis, reuses `processPostCallAnalysis`, usage
    row `usage_type='retell'`, our component cost in cents),
  - `provider.ts` (`switchAiProvider`, per-number reversible cutover),
  - `routes/rt.ts` (`/api/internal/voice-agent/*`, secret `X-Voice-Agent-Secret`),
    `routes/admin.ts` (`/api/voice-agent/admin/*`, superadmin),
    `routes/laml.ts` (`/api/voice/laml/voice-agent/transfer`).
- `src/contacts/resolveCallerIdentity.ts` (NEW): the shared resolver; the HTTP route
  `ai/routes/resolve-caller-identity.ts` now calls it.
- Generalized readers (`'retell'` -> any provider): `phoneNumbers/enableRole.ts`
  (`provider` arg, pipecat path binds the LaML resource, disable/canEnable),
  `phoneNumbers/routes.ts` (badge + `media_stream` mode), `phoneNumbers/callableFloor.ts`,
  `retell/inboundCall/tenantLookup.ts`, `voice/inboundLaml.ts` (5 branches: direct
  dispatch, IVR `transfer_ai`, overflow-only, queue ring-out, post-conference),
  `voice/routes/webhooks.ts` + `voice/ivrWalker.ts` (pipecat on the SWML/Relay path
  falls through to humans + pages), `inbound/types.ts` (`ChatChannel` + `'voice'`),
  `ai/chat-agent/tools.ts` (`'voice'` -> `source_ref_type 'retell_call'`),
  `retell/postCallAnalysis.ts` (agentType/provider/bucket-path aware).
- Config: `config/env.ts` (VOICE_RT_URL, VOICE_RT_PUBLIC_WS_URL,
  VOICE_AGENT_SHARED_SECRET, VOICE_AGENT_DEFAULT_PROVIDER, VOICE_AGENT_DEFAULT_ENGINE,
  VOICE_AGENT_REALTIME_MODEL, VOICE_AGENT_LLM_MODEL, VOICE_AGENT_STT_MODEL,
  OPENAI_API_KEY_VOICE_AGENT), `render.yaml`, `.env.example`, `index.ts` mounts.
- Frontend: `src/lib/phoneNumbersApi.ts` (types), `src/pages/operations/Communications.tsx`
  (connected check counts pipecat). Superadmin: `superadmin-portal/src/pages/retell/SelfHostedTab.tsx`
  ("Self-hosted" tab on the Retell page: runtime health, per-number provider switch,
  live calls with Instruct / Say verbatim / Hang up).
- Migration (WRITTEN, NOT APPLIED, needs owner OK, tier 3):
  `supabase/migrations/20260922_100000_voice_numbers_ai_provider_pipecat.sql`
  (widens `voice_numbers_ai_provider_check` to allow `'pipecat'`).

**voice-rt (Python, NEW top-level dir, the media loop), Pipecat 1.11.0 API:**
- `Dockerfile`, `render.yaml` (Render Docker web service `app-voice-rt`,
  same host as everything else), `requirements.txt` (pinned `pipecat-ai==1.11.0`).
- `src/main.py` (FastAPI, `/health`), `src/config.py`, `src/api/billing.py`
  (claim / tool-call / events / recording / end),
- `src/calls/session.py` (per-call state + registry), `src/calls/routes.py`
  (`/ws` media stream: handshake -> claim -> build -> run -> isolated teardown;
  `/sessions/:id/inject`, `/hangup`, `/sessions`),
- `src/pipeline/build.py` (engine A `s2s_openai` = OpenAI Realtime; engine B
  `chained` = Deepgram -> OpenAI -> ElevenLabs; Silero + Smart Turn v3; state
  switch; inject; kick-off), `tools.py` (schemas from app-server -> Pipecat
  `FunctionSchema`, local vs server routing), `observers.py` (TTFB + usage),
  `recording.py` (stereo WAV via AudioBufferProcessor, guarded).

### Runbook: from here to the first real call (owner actions in bold)
1. **Approve + apply the migration** (`20260922_100000_voice_numbers_ai_provider_pipecat.sql`)
   via `py scripts/execute_sql.py`, then `pnpm gen-types`.
2. **Create the Render service** from `voice-rt/render.yaml` (Docker, region oregon)
   and set its env: `BILLING_SERVER_URL` (dev-api or api), `VOICE_AGENT_SHARED_SECRET`
   (new random secret), `SIGNALWIRE_SPACE_URL/PROJECT_ID/API_TOKEN` (same as
   app-server), **`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`** (the
   three accounts we need), `MAX_CONCURRENT_CALLS`.
3. **On app-server (staging first)** set `VOICE_RT_URL=https://<voice-rt>.onrender.com`,
   `VOICE_AGENT_SHARED_SECRET` (same value), leave `VOICE_AGENT_DEFAULT_PROVIDER=retell`,
   `VOICE_AGENT_DEFAULT_ENGINE=chained` for the first call.
4. Superadmin portal -> Retell -> Self-hosted: runtime shows Reachable.
5. **Pick a scratch AI number** (dev/booth, LaML-bound; `SIGNALWIRE_VOICE_LAML_WEBHOOK_RESOURCE_ID`
   must be set on that environment) and click "Switch to self-hosted".
6. Call it. Expected: the agent greets per the starter prompt; booking works through
   the same tools; `call_history` row (`agent_type='ai'`, `provider='pipecat'`) +
   recording + summary email + `usage` row appear at hang-up; the decision is in
   `retell_inbound_call_logs` with `request_body.provider='pipecat'`.
7. Then set `VOICE_AGENT_DEFAULT_ENGINE=s2s_openai` and call again for the Lifelike tier.
8. "Back to Retell" on the same tab reverts the number.

### VERIFY on the first test call (things the docs could not settle; each is flagged in code)
- Pipecat: `LLMContext(tools=ToolsSchema(...))` acceptance; `ctx.messages` is the LIVE
  list (in-place state switch) else the fallback frame path; `AudioBufferProcessor`
  import path; OpenAI Realtime sample rate (24 kHz set; adjust if audio is pitched);
  `LLMMessagesAppendFrame` reaching the Realtime service for `inject`.
- SignalWire: `<Parameter>` echoes as `customParameters.session_id` in the stream
  `start` message (fallback: `?session_id=` query, wired); compat REST base
  `https://<space>/api/laml` for the serializer's auto hang-up.
- Voices: the Retell id -> ElevenLabs id mapping in `voices.ts` is by ear; tune it.
- Latency: p50/p95 land in `call_history.metadata.latency`; target <=800ms p99.

- 2026-09-23 (deploy + audit + fixes): DEPLOYED voice-rt to Render (`<render-service-id>`,
  dev branch, `/health` ok, Pipecat 1.11.0). Set on app-server dev: `VOICE_RT_URL`,
  `VOICE_AGENT_SHARED_SECRET` (same value both sides), `VOICE_AGENT_DEFAULT_ENGINE=s2s_openai`,
  `OPENAI_API_KEY_VOICE_AGENT` (minted via Admin API, project `<openai-project-id>`).
  voice-rt has `OPENAI_API_KEY`, `SIGNALWIRE_*`, `BILLING_SERVER_URL=https://dev-api.example.com`,
  `VOICE_AGENT_SHARED_SECRET`, `MAX_CONCURRENT_CALLS=40`. STILL MISSING (owner adds at office):
  `DEEPGRAM_API_KEY` + `ELEVENLABS_API_KEY` on voice-rt (chained/Standard tier only; s2s/Lifelike
  needs neither). Proved the voice-rt<->billing auth handshake live (correct secret reaches the
  handler = 400 "bad session id"; wrong/no secret = 401). System still INERT: `VOICE_AGENT_ENABLED`
  unset, no `self_hosted_voice_agent` flag row, 0 numbers on pipecat.
  Ran a full read-only code audit (subagent) of app-server/voiceAgent + voice-rt. FIXED three
  findings (typecheck-clean, tsc exit 0):
  - B1 (blocker, TCPA): `mark_do_not_call` wrote `session.from_number` always, which on an OUTBOUND
    call is OUR number, so a customer asking to stop was never suppressed. Now picks
    `direction==='outbound' ? to_number : from_number` (both stored as bare E.164 digits = what
    `is_call_opted_out` matches), and also stamps `source_call_session_id`. tools.ts.
  - G1 (campaign gap): `reconcileCalling` reset unanswered recipients to 'pending' unless
    attempts>=99, ignoring `max_attempts` (default 2). Now takes `campaign`, marks 'failed'
    (valid status, CHECK verified) once `attempts>=max_attempts`; removed dead `next` placeholder.
    campaigns.ts.
  - G2 (first-call robustness): `voiceRtStreamUrl` now appends `?session_id=` as a fallback
    alongside the `<Parameter>` primary, so if a Pipecat version exposes SignalWire customParameters
    under a different attr than voice-rt reads (`call_data.body`), the runtime still recovers the id
    from the query (routes.py:75 already reads it) and claims instead of dropping. laml.ts.
  Audit verdict on everything else: contracts (both directions, field-by-field), auth header/secret,
  tool dispatch parity (all 14 TOOL_DEFS + voice-only tools), durability wiring (finalize / orphan
  reconcile / 60s heartbeat, idempotent on finalized_at), DB (all tables/columns/RPC/constraints
  live-verified), config keys, and error reporting are COMPLETE and correct. No stubs/TODOs/
  NotImplemented in either tree; the 8 `VERIFY` comments are first-call TUNING notes (voice timbre,
  s2s 24kHz rate, in-place prompt swap, Pipecat module paths), not unfinished logic. Remaining true
  gaps are deferred-by-design (voice cloning, Pipecat Flows, tools-as-data, A/B harness, operator
  DNC/campaign UI [owner: no operator UI]) or need a live call (voice timbre tuning, latency).

- 2026-09-23 (creds complete + provider-failure alerting). ALL provider keys now set on voice-rt:
  `OPENAI_API_KEY` (s2s + chained LLM), `ELEVENLABS_API_KEY` (chained TTS), `DEEPGRAM_API_KEY`
  (chained STT, validated live: key auths, model `nova-3-general` accepted). voice-rt redeployed +
  healthy. Both tiers are now fully credentialed; nothing left to add. Local mirror in `.env.local`.
  WIRED PROVIDER FAILURES INTO THE ALERT PIPELINE (owner: "if we run out of money on any service we
  must be notified"). The gap: voice-rt is a separate Python process; a live-call provider failure
  (Deepgram/OpenAI/ElevenLabs auth or quota = the "out of money" case) only wrote a Python log and
  never reached reportError. Fix, both sides, deployed + typecheck/py-compile clean:
  - voice-rt: `api/billing.py` `report_error()` (POSTs a new `error` event, never throws);
    `pipeline/observers.py` classifies provider ErrorFrames (auth_failure/quota_exhausted/
    rate_limited/provider_error, conservative default), labels the provider, reports once per
    (provider,class) per call (guarded ErrorFrame import so a Pipecat move degrades not crashes);
    `calls/routes.py` also reports the connect-time build failure and the generic pipeline exception.
  - app-server: `voiceAgent/routes/rt.ts` `/events` now handles `type:'error'` ->
    `reportError` with `voice_agent_provider_failure:critical` for auth/quota (structurally
    non-silenceable, pages immediately: a dead provider = that company's AI line is DOWN) and
    background otherwise; and `type:'engine_fallback'` -> silent+escalateAfter:10 (one s2s->chained
    fallback is benign, a flood surfaces). Mirrors callOpenAi's classification + [CRITICAL] subjects.

- 2026-10-05 (ambient sound, Retell-parity + better). Owner wants the call to SOUND like a real
  front desk: subtle background room tone the whole call, and keyboard TYPING while the agent works
  a tool ("let me pull that up") instead of dead air. BUILT in voice-rt as a custom
  `AmbientMixer(BaseAudioMixer)` (`voice-rt/src/pipeline/ambient.py`), attached to the output
  transport via `audio_out_mixer={None: mixer}` (1.11.0 wants a Mapping[str|None,BaseAudioMixer],
  NOT a bare mixer, verified against the fastapi params reference). Synthesized with numpy at the
  live output rate (8k chained / 24k s2s) so there are NO WAV assets and NO `soundfile` dep and no
  resample bug (SoundfileMixer does not resample). Room tone = cascaded box-filtered noise +slow
  drift, vol 0.03; typing = sparse irregular keystroke bursts, vol 0.14, ramped in/out, gated by
  new `CallSession.tool_working` which `pipeline/tools.py` sets True around the app-server
  tool round trip (the slow part). Works on BOTH engines (mixer sits on the transport). Per-call
  off switch: context settings `ambient_sound=false`. Import guarded (like ErrorFrame): a Pipecat
  API move degrades to no-ambience, never a crashed call. Verified: py-compile clean; synthesis
  executed locally at 8k+24k (valid int16, clips clean, ~17 keys/3s, sub-200ms one-time setup).
  Not yet run on a live call (part of the single end-to-end test the owner wants before go-live).

## 12. Status log
- 2026-09-20: Plan created. Four investigations complete (existing code map, separate-repo
  assessment, Pipecat research, Retell pricing/features). No code written. Companion skill
  drafted at `.claude/skills/self-hosted-voice-agent/SKILL.md`.
- 2026-09-22: Added (per owner) two things: (1) a top-level GUIDING PRINCIPLE + a granular
  file-by-file port/adapt/skip inventory (9.1) so we copy everything good from the separate
  repo and only build the delta; (2) the OpenAI Realtime speech-to-speech engine as a
  per-agent voice engine (3.2) for the most-human voices, with OpenAI Custom Voices
  (sales-gated) + ElevenLabs (self-serve) cloning on both engines, cost + Pipecat
  integration facts, and Phase 3 tasks. Corrected "Agent One" = OpenAI Realtime API (not a
  real product name; AgentKit/Agent Builder is separate + Agent Builder deprecating
  2026-11-30). Still no code written.
- 2026-09-22: Owner confirmed OFFER BOTH engines. Decisions added (3.2.1 + 3.2.2): sell as
  two named per-minute tiers (Standard=chained / Lifelike=S2S), hot-swappable per agent,
  play-the-difference sample; automatic S2S->chained fallback mid-call; do NOT gate launch on
  cloning; and the six "best agent" differentiators (safe action breadth, latency-as-feature,
  caller-known-before-hello, barge-in/backchannel/no-dead-air, outbound first-class, the
  owner-facing builder as the moat). Phase 2 gains tiered billing + auto-fallback.
- 2026-09-22 (build session, owner: "get this rolling", host on Render like everything
  else, no voice cloning now, no keys yet): BUILT Phase 0 + Phase 1 + most of Phase 2 +
  the Phase 3 S2S engine in code, typecheck-clean (app-server warm+cold, main app,
  superadmin-portal), Python compiles. NOT yet run against a live call (no Deepgram /
  ElevenLabs / OpenAI keys, runtime not deployed, migration not applied). See 11b for
  the code map, the runbook, and the VERIFY list. Deliberately NOT built yet: Pipecat
  Flows, tiered billing (`voice_pricing` tier), automatic S2S->chained fallback
  mid-call, outbound (single + batch), tools-as-data tables (`voice_agents` /
  `voice_agent_tools`), voice cloning (owner: later), the A/B harness. Decisions made
  by common sense + our conventions: session state in app-server memory (single
  instance, no Redis in this stack); tools stay defined ONCE in Node, voice-rt only
  proxies; usage metered as `usage_type='retell'` so plans/quotas/billing page work
  day one; voice bookings carry `source_ref_type='retell_call'` so every reader keeps
  working; `retell_inbound_call_logs` reused as the audit log; the self-hosted agent
  requires the LaML inbound path (only cXML can `<Connect><Stream>`), enforced at
  enable/switch time and paged if a number drifts to SWML.
- 2026-09-22 (build session 2): applied migration `20260922_100000` (ai_provider pipecat,
  verified live). Built the two-layer TEST GATE (env `VOICE_AGENT_ENABLED` + the
  `self_hosted_voice_agent` flag; enforced at switch/enable/every-call; fails closed; see
  section 0a). Built OUTBOUND end to end (`startOutboundCall`, outbound-answer cXML, internal
  endpoint, superadmin test dial, Ops Agent verb `place_voice_call`, direction-aware kickoff).
  Built connect-time S2S->chained fallback in voice-rt (no mid-call swap, by design). Built
  TCPA-correct VOICE DO-NOT-CALL (table `voice_call_opt_outs` + `is_call_opted_out`, migration
  `20260922_110000` applied+verified; outbound blocks opted-out numbers failing safe; voice
  tool `mark_do_not_call`; Ops Agent verb `manage_call_consent`; types.ts regen'd). All green
  (app-server warm+cold, main app incl. DB static check, superadmin, Python compiles,
  dash/marker/mojibake clean). STILL not run live (voice-rt deploy + keys pending). NOT built
  (needs product input or its own subsystem): batch/campaign pacing + quiet-hours, operator
  DNC page, tiered customer PRICING (per-call engine already recorded so it's a pure pricing
  add later), Pipecat Flows, tools-as-data agent config, voice cloning (owner: later), A/B harness.
