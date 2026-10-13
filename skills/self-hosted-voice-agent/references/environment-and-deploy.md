# Environment variables and deployment (read from reference-impl)

Files: `voice-rt/src/config.py`, `voice-rt/render.yaml`, `voice-rt/Dockerfile`,
`voice-rt/requirements.txt`, `voice-rt/src/main.py`, and the `config.*` references
in `app-server/voiceAgent/*.ts`. The app server's `config/env.ts` (where its env
names map to `config.*` and get their defaults) is NOT in the reference
implementation; app-server names below come from the plan's config list and the
code's `config.*` usage.

> Owner rule: an agent never commits, pushes or deploys on its own initiative, and
> never sets a production env var without being asked. Every "set" and "deploy"
> below is a step the owner does or explicitly asks for.

---

## 1. voice-rt (Python runtime)

Loaded by `pydantic_settings.BaseSettings` from the process env and an optional
`.env` file (UTF-8; unknown keys ignored; names are case-insensitive, so field
`billing_server_url` reads `BILLING_SERVER_URL`).

| Env var | Default in `config.py` | `render.yaml` | Used for |
|---|---|---|---|
| `BILLING_SERVER_URL` | `http://localhost:3001` | secret (`sync: false`) | Base URL of the app server (the brain): claim, tool calls, events, recording, end. |
| `VOICE_AGENT_SHARED_SECRET` | `""` | secret | `X-Voice-Agent-Secret` both directions. Empty = every control call 401s and every claim fails. |
| `SIGNALWIRE_SPACE_URL` | `""` | secret | Carrier space host. `https://` is added if missing; the runtime derives `<space>/api/laml` as the Twilio-compatible REST root. |
| `SIGNALWIRE_PROJECT_ID` | `""` | secret | Passed to the serializer as `account_sid`. |
| `SIGNALWIRE_API_TOKEN` | `""` | secret | Passed to the serializer as `auth_token`. |
| `DEEPGRAM_API_KEY` | `""` | secret | STT (chained engine). |
| `CARTESIA_API_KEY` | `""` | secret | TTS (chained engine, the default voice path). |
| `ELEVENLABS_API_KEY` | `""` | secret | TTS fallback when a voice has no Cartesia id. |
| `OPENAI_API_KEY` | `""` | secret | LLM (chained) AND the whole speech-to-speech engine. |
| `ANTHROPIC_API_KEY` | `""` | secret | Declared, unused by the reference pipeline. |
| `GOOGLE_API_KEY` | `""` | secret | Declared, unused by the reference pipeline. |
| `MAX_CONCURRENT_CALLS` | `40` | `"40"` | Per-process capacity guard. Above it the media socket closes with 1013 and the carrier runs the `<Hangup/>` after `<Connect>`, so set it to what one instance can carry and scale before you hit it. |
| `PORT` | `8000` | not set | Only logged. The Dockerfile hard-codes `--port 8000`. |
| `LOG_LEVEL` | `INFO` | `INFO` | structlog filter level. |
| `NODE_ENV` | `development` | `production` | `development` = pretty console logs; anything else = JSON logs. |

Missing SignalWire credentials are not fatal: the serializer's auto hang-up is simply
off (`auto_hang_up` is True only when project id, token and space are all set), and
the app server also ends the leg over REST after agent-ended calls.

Values the runtime falls back to if the session context leaves them empty (from
`pipeline/build.py`): STT model `nova-3-general`, LLM model `gpt-4.1`, S2S model
`gpt-realtime-2.1`, S2S voice `marin`, Cartesia model `sonic-3.6`, ElevenLabs voice
`EXAVITQu4vr4xnSDxMaL` with model `eleven_flash_v2_5`, max call duration 3600 s,
turn-taking mode `balanced`.

## 2. App server (the brain)

| Env var (from the plan's config list) | `config.*` in code | Used for |
|---|---|---|
| `VOICE_AGENT_ENABLED` | `voiceAgentEnabled` | Master switch, layer 1 of the gate. Must be exactly `true` per the plan; anything else is off. |
| `VOICE_RT_URL` | `voiceRtUrl` | voice-rt base URL (control calls, health). Unset: inbound falls back to a human, outbound and provider switch refuse. |
| `VOICE_RT_PUBLIC_WS_URL` | `voiceRtPublicWsUrl` | Optional public `wss://` base for the stream URL. Default: `VOICE_RT_URL` with the scheme swapped. |
| `VOICE_AGENT_SHARED_SECRET` | `voiceAgentSharedSecret` | Same value as voice-rt. |
| `VOICE_AGENT_DEFAULT_PROVIDER` | `voiceAgentDefaultProvider` | Shown on the admin health card only. |
| `VOICE_AGENT_DEFAULT_ENGINE` | `voiceAgentDefaultEngine` | `chained` or `s2s_openai`, applied to every session (there is no per-agent engine yet). |
| `VOICE_AGENT_REALTIME_MODEL` | `voiceAgentRealtimeModel` | S2S model name sent in `voice.openai_realtime.model`. |
| `VOICE_AGENT_LLM_MODEL` | `voiceAgentLlmModel` | Chained LLM, sent in `settings.llm_model`. |
| `VOICE_AGENT_STT_MODEL` | `voiceAgentSttModel` | Chained STT, sent in `settings.stt_model`. |
| `OPENAI_API_KEY_VOICE_AGENT` | `openaiVoiceAgentApiKey` | Post-call analysis. Unset = calls are still recorded with an empty summary. |
| `CARTESIA_API_KEY` | `cartesiaApiKey` | Voice preview and cloning routes. |
| `SIGNALWIRE_VOICE_LAML_WEBHOOK_RESOURCE_ID` | `signalwireVoiceLamlWebhookResourceId` | The LaML inbound resource a number must be bound to before it can be switched to the self-hosted agent. |
| `SIGNALWIRE_SIP_TERMINATION_URI` | read via `process.env` in `aiForward.ts` | Only for switching a number BACK to the hosted platform (Retell). |
| `RETELL_SIP_INBOUND_HOST`, `RETELL_SIP_INBOUND_TRANSPORT` | read via `process.env` in `aiForward.ts` | The hosted platform's SIP gateway override (transport must be TCP). Retell side only. |
| app public base URL | `billingServerUrl` | Used to build the transfer and outbound-answer cXML URLs. Env name not covered by the reference implementation. |
| internal API secret | `internalApiSecret` | `Internal-Secret` header on the outbound and campaign routes. Env name not covered by the reference implementation. |

Defaults for every app-server variable above: not covered by the reference
implementation (they live in the missing `env.ts`). The product skill calls `chained`
the real default engine; the plan's log shows the dev environment once set to
`s2s_openai`. Decide and write the default down in your repo.

---

## 3. The voice-rt image (`Dockerfile`)

- Base `python:3.12-slim`; env `PYTHONDONTWRITEBYTECODE=1`, `PYTHONUNBUFFERED=1`,
  `PIP_NO_CACHE_DIR=1`; workdir `/app`.
- `pip install -r requirements.txt`, then WARM the models into the image so the first
  call on a fresh instance does not download them:
  - `from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3; LocalSmartTurnAnalyzerV3()`
  - `from pipecat.audio.vad.silero import SileroVADAnalyzer; SileroVADAnalyzer()`
- Copies `src/` (including `src/pipeline/assets/*.wav`). No ffmpeg in the image.
- `EXPOSE 8000`; command:
  `uvicorn src.main:app --host 0.0.0.0 --port 8000 --ws-per-message-deflate false --timeout-keep-alive 75`.

## 4. Pinned dependencies (`requirements.txt`)

```
pipecat-ai[websocket,deepgram,openai,elevenlabs,cartesia,anthropic,google]==1.11.0
fastapi>=0.115.6,<1
uvicorn[standard]>=0.34.0,<1
pydantic>=2.10.0,<3
pydantic-settings>=2.7.0,<3
httpx>=0.28.0,<1
structlog>=24.1.0
numpy>=1.26.0
pipecat-backchannel>=0.3.3,<0.4
```

Pipecat renames APIs between minor releases. Pin exactly and bump deliberately; every
guarded import in the runtime (ambient mixer, `GenerationConfig`, `ErrorFrame`,
`AudioBufferProcessor`, backchannel) exists so an upgrade that moves one of them
degrades a feature instead of crashing every call.

## 5. Hosting (`render.yaml`, snapshot)

- One Docker web service (`type: web`, `runtime: docker`, `plan: standard`,
  `rootDir: voice-rt`, `healthCheckPath: /health`). The reference used Render in the
  `oregon` region, next to the app server. Any container host with WebSockets works.
- Sizing note from the file: about 0.5 to 1 vCPU and about 150 MB RAM per concurrent
  call (Silero and Smart Turn on CPU; STT, LLM and TTS are remote). One `standard`
  instance (1 CPU / 2 GB) runs "a handful" of concurrent calls. The plan's earlier
  estimate was 1 to 2 GB per call for a process-per-call design. Measure your own.
- `/health` returns `{status, service, version, pipecat_version, active_calls, capacity}`.
  It is unauthenticated; it reveals only counts.

## 6. Process model

- One uvicorn worker, one Python process, MANY calls: each call is an asyncio task
  holding its own WebSocket and Pipecat pipeline. Pipecat 1.x is asyncio native and
  STT/LLM/TTS are network I/O, so the GIL is not the bottleneck; Smart Turn and Silero
  run on CPU via onnxruntime.
- Scale by instance size or count. The call bootstrap works on any instance (context
  lives in the app server). The live-call control API does NOT: the registry is per
  process (see the landmine in SKILL.md).
- The app server holds sessions in memory, which assumes ONE app-server instance.

## 7. Runbook to the first real call (owner actions)

1. Apply the provider-widening migration (owner approval required; see
   `data-and-voices.md`), then regenerate DB types.
2. Create the voice-rt service from `render.yaml`; set `BILLING_SERVER_URL`, a new
   random `VOICE_AGENT_SHARED_SECRET`, the three `SIGNALWIRE_*` values,
   `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `OPENAI_API_KEY` (and `ELEVENLABS_API_KEY`
   only if you keep the fallback), `MAX_CONCURRENT_CALLS`.
3. On the app server (staging first): `VOICE_RT_URL`, the same
   `VOICE_AGENT_SHARED_SECRET`, `VOICE_AGENT_DEFAULT_ENGINE=chained` for the first
   call, `OPENAI_API_KEY_VOICE_AGENT`, `CARTESIA_API_KEY`,
   `SIGNALWIRE_VOICE_LAML_WEBHOOK_RESOURCE_ID`.
4. Admin health card shows the runtime reachable. A wrong or missing secret on a
   claim route returns 401; the right secret with a fake id returns
   `400 bad session id` (a cheap live check of the auth handshake).
5. Open the gate for ONE test business: `VOICE_AGENT_ENABLED=true` plus the business
   in the `self_hosted_voice_agent` flag.
6. Switch ONE LaML-bound scratch number to the self-hosted provider.
7. Call it. Expect: the begin message; tools work; at hang-up a `call_history` row
   (`agent_type='ai'`, `provider='pipecat'`), recording, summary email, `usage` row;
   the decision row in `retell_inbound_call_logs` with `request_body.provider='pipecat'`.
8. Then `VOICE_AGENT_DEFAULT_ENGINE=s2s_openai` and call again for the premium engine.
9. Revert the number with the switch back to the hosted provider.
