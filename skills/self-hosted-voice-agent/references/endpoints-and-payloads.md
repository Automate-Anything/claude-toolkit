# Endpoints, payloads and carrier markup (read from reference-impl)

Every route, header, field and status code below is read from the reference
implementation. Paths are the reference product's mount points; rename them to
your app. Where the reference implementation does not show something, it says so.

Files: `voice-rt/src/calls/routes.py`, `voice-rt/src/api/billing.py`,
`app-server/voiceAgent/routes/{rt,laml,admin,outbound,voices}.ts`,
`app-server/voiceAgent/{laml,rtClient,types,sessionStore}.ts`.

---

## 1. The hops at a glance

| # | From | To | Route | Auth |
|---|---|---|---|---|
| 1 | Carrier (SignalWire) | app server | the existing LaML inbound webhook (`/api/voice/inbound-laml` in the reference) | carrier webhook (existing) |
| 2 | app server | Carrier | cXML response `<Connect><Stream>` | n/a |
| 3 | Carrier | voice-rt | WebSocket `GET /ws` (media stream) | single-use `session_id` |
| 4 | voice-rt | app server | `GET /api/internal/voice-agent/sessions/{id}` (claim) | `X-Voice-Agent-Secret` |
| 5 | voice-rt | app server | `POST .../sessions/{id}/tool-call` | `X-Voice-Agent-Secret` |
| 6 | voice-rt | app server | `POST .../sessions/{id}/events` | `X-Voice-Agent-Secret` |
| 7 | voice-rt | app server | `PUT .../sessions/{id}/recording` | `X-Voice-Agent-Secret` |
| 8 | voice-rt | app server | `POST .../sessions/{id}/end` | `X-Voice-Agent-Secret` |
| 9 | app server | voice-rt | `GET /health` | none |
| 10 | app server | voice-rt | `POST /sessions/{id}/inject`, `POST /sessions/{id}/hangup`, `GET /sessions` | `X-Voice-Agent-Secret` |
| 11 | Carrier | app server | `POST /api/voice/laml/voice-agent/transfer?session_id=` | none shown (public cXML route) |
| 12 | Carrier | app server | `POST /api/voice/laml/voice-agent/outbound-answer?session_id=` | none shown (public cXML route) |
| 13 | crons, scripts | app server | `POST /api/internal/voice-agent/outbound`, `POST /api/internal/voice-agent/campaign` | `Internal-Secret` |
| 14 | superadmin UI | app server | `/api/voice-agent/admin/*` | `requireSuperAdmin` middleware |
| 15 | operator UI | app server | `/api/voice-agent/voices/*` | operator `Authorization: Bearer <token>` |

---

## 2. Shared-secret auth (both directions)

- Header name: `X-Voice-Agent-Secret`. Same value on both services
  (`VOICE_AGENT_SHARED_SECRET`).
- Comparison is constant time on both sides (length check, then XOR over every char).
- app server (`requireVoiceAgentSecret` in `routes/rt.ts`): secret unset returns
  `503 {"error":"voice agent secret not configured"}` (fails closed); wrong or
  missing header returns `401 {"error":"invalid voice agent secret"}`.
- voice-rt (`require_secret` in `calls/routes.py`): secret unset OR mismatch returns
  `401 {"detail":"invalid voice agent secret"}`. voice-rt logs
  `voice_agent_shared_secret_missing` at startup if unset.
- The outbound and campaign routes use a DIFFERENT header, `Internal-Secret`, checked
  against `config.internalApiSecret` (503 if unset, 401 on mismatch). The env var name
  behind `internalApiSecret` is not covered by the reference implementation.

## 3. The session id

- Minted by the app server: `vrt_` + a random UUID with the dashes removed
  (`newSessionId()` in `sessionStore.ts`), so 32 lowercase hex chars after the prefix.
- Every `/api/internal/voice-agent/sessions/:id/*` route validates it against
  `^vrt_[0-9a-f]{32}$` and returns `400 {"error":"bad session id"}` otherwise.
- Single use: the first claim flips `connected_at`; a second claim is refused.

---

## 4. Carrier markup the app server returns (cXML, Twilio compatible)

All documents are `<?xml version="1.0" encoding="UTF-8"?><Response>...</Response>`
served with `Content-Type: text/xml; charset=utf-8`. Values are XML escaped.

**The AI leg** (`buildStreamTwiml(sessionId)` in `laml.ts`), shown pretty-printed:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://<voice-rt-host>/ws?session_id=vrt_<32 hex>">
      <Parameter name="session_id" value="vrt_<32 hex>"/>
    </Stream>
  </Connect>
  <Hangup/>
</Response>
```

- The real output is one line with no whitespace between tags.
- The WebSocket base is `VOICE_RT_PUBLIC_WS_URL` if set, else `VOICE_RT_URL` with
  `https:` swapped to `wss:` (or `http:` to `ws:`). If neither is set the builder
  returns null and the caller falls back to a human (see SKILL.md, inbound).
- `session_id` rides twice on purpose: as a `<Parameter>` (the carrier echoes it in
  the stream `start` message as a custom parameter) and on the URL query as a fallback
  in case the Pipecat version exposes custom parameters under a different attribute.
- When the stream closes, `<Connect>` returns and the document continues, so the
  trailing verb decides what happens after the AI leg. Default is `<Hangup/>`; the
  builder takes an `after` option for a different tail.
- `<Connect><Stream>` is cXML only. A number answered by SWML or the Relay SDK cannot
  open this stream.

**Cold transfer to a human** (`buildTransferTwiml`):

```xml
<Response><Dial callerId="+<caller E.164>" timeout="30">+<target E.164></Dial><Hangup/></Response>
```

A target without a leading `+` gets one added. Default timeout 30 seconds.

**Hang up** (`buildHangupTwiml`): `<Response><Hangup/></Response>`.

**Public cXML routes** (`routes/laml.ts`, mounted under `/api/voice`):

| Route | Behavior |
|---|---|
| `POST /laml/voice-agent/transfer?session_id=` | The live transfer target. Session found and it has `transfer_to_number`: returns the transfer `<Dial>` with `callerId` = `+<session.from_number>`. Otherwise `<Hangup/>`. Reached via the carrier's modify-call (redirect) on the caller's leg, which ends the media stream. |
| `POST /laml/voice-agent/outbound-answer?session_id=` | Fetched when an outbound call is answered. Session missing or ended: `<Hangup/>`. Stream URL unavailable: reports `voice_agent_runtime_unconfigured` and hangs up. Else returns the AI-leg document above. Answering-machine detection is NOT enabled. |

The transfer redirect URL is built as
`<app public base URL>/api/voice/laml/voice-agent/transfer?session_id=<id>`
(`transferRedirectUrl`). The outbound answer URL is
`<app public base URL>/api/voice/laml/voice-agent/outbound-answer?session_id=<id>`.

## 5. The media WebSocket (voice-rt `GET /ws`)

Order of operations in `media_stream()`:

1. `websocket.accept()`.
2. Capacity check: if live sessions in this process >= `MAX_CONCURRENT_CALLS`, close
   with code `1013`, reason `capacity`.
3. `parse_telephony_websocket(websocket)` (from `pipecat.runner.utils`) reads the
   carrier's `connected` and `start` messages. On failure: close `1008`,
   reason `bad handshake`.
4. `session_id` = `call_data.body["session_id"]` (the custom parameters) else the
   `?session_id=` query. `stream_sid` = `call_data.stream_id`, `call_sid` =
   `call_data.call_id`. Missing session id: close `1008`, reason `missing session`.
5. Claim from the app server (section 6.1). Refused: close `1008` with the app
   server's error string as the reason (`not_found`, `already_claimed`, `ended`).
   Transport error: close `1008`, reason `claim error`.
6. Build and run the pipeline (see `pipeline-and-audio.md`). On the carrier side the
   close makes `<Connect>` return, so the trailing `<Hangup/>` runs and the caller is
   never parked.

Audio on the wire: 8 kHz mu-law, 20 ms frames, handled by Pipecat's
`TwilioFrameSerializer`. uvicorn runs with `--ws-per-message-deflate false`
(compressing tiny mu-law frames only adds latency).

---

## 6. voice-rt to app server (`/api/internal/voice-agent`)

One shared `httpx.AsyncClient` per process with keep-alive; default timeouts
connect 5 s, read 30 s, write 30 s, pool 5 s.

### 6.1 Claim: `GET /sessions/{id}`

- 200: the `VoiceRtSessionContext` JSON (below). Client timeout 10 s.
- 404 `{"error":"not_found"}`; 410 `{"error":"already_claimed"}` or
  `{"error":"ended"}`. voice-rt raises `SessionClaimError(status, reason)` and closes
  the WebSocket with that reason.

`VoiceRtSessionContext` (from `types.ts`), example values:

```json
{
  "session_id": "vrt_0123456789abcdef0123456789abcdef",
  "direction": "inbound",
  "call_sid": "<carrier call sid>",
  "from_number": "15551230000",
  "to_number": "15551239999",
  "company_id": "<uuid>",
  "location_id": "<uuid or null>",
  "timezone": "America/New_York",
  "prompts": {
    "starter": "<fully rendered text>", "booking": "...", "cancel": "...",
    "update": "...", "confirmation": "...", "questions": "...", "name": "..."
  },
  "disambiguation_instruction": "",
  "initial_state": "starter",
  "voice": {
    "engine": "chained",
    "source_voice_id": "allie",
    "gender": "female",
    "cartesia": { "voice_id": "2747b6cf-fa34-460c-97db-267566918881", "model": "sonic-3.6",
                  "speed": 0.88, "emotion": "neutral", "volume": 0.9 },
    "elevenlabs": { "voice_id": "EXAVITQu4vr4xnSDxMaL", "model": "eleven_flash_v2_5",
                    "speed": 1.0, "stability": 0.5, "similarity_boost": 0.75 },
    "openai_realtime": { "voice": "marin", "model": "<VOICE_AGENT_REALTIME_MODEL>" },
    "language": "en-US"
  },
  "settings": {
    "turn_taking_mode": "balanced",
    "max_duration_seconds": 600,
    "stt_model": "<VOICE_AGENT_STT_MODEL>",
    "llm_model": "<VOICE_AGENT_LLM_MODEL>",
    "greeting": "Example Business, this is Allie speaking, how can I help you?"
  },
  "tools": [ { "type": "function", "function": { "name": "...", "description": "...", "parameters": { } } } ],
  "tool_routing": { "booking_agent_transfer": "local_state_switch", "end_call": "local_end_call",
                    "transfer_call": "transfer_call", "checkAvailability": "server" },
  "can_transfer_to_human": true
}
```

Notes:
- Numbers are bare digits (no `+`) in the context.
- `cartesia` is present only when the selected voice resolves to a Cartesia voice.
- `prompts` always has all seven keys; missing slots are empty strings.
- `settings.ambient_sound` and `settings.backchannel` are READ by voice-rt (default on)
  but the app server's `VoiceRtSettings` type never sets them. Add them to the type if
  you want per-call control.
- Outbound sessions: `direction: "outbound"`, `greeting: null`,
  `max_duration_seconds: 1800`, `call_sid` empty until the originate returns.

### 6.2 Tool call: `POST /sessions/{id}/tool-call`

Request:
```json
{ "name": "checkAvailability", "arguments": { "...": "..." }, "step": 3 }
```
`step` is voice-rt's per-call tool counter (starts at 1).

Response (`VoiceToolCallResult`):
```json
{ "ok": true, "result": { }, "error": null, "latency_ms": 412 }
```

- 404 `{"ok":false,"error":"unknown session"}` if the session does not exist or was
  never claimed; 400 `{"ok":false,"error":"name required"}`.
- Client timeouts: connect 5 s, read 45 s, write 10 s.
- The client never raises: a non-200 becomes
  `{"ok":false,"result":null,"error":"tool endpoint <status>","latency_ms":0}`, a
  transport failure becomes `{"ok":false,...,"error":"transport: <msg>"}`. The model
  then receives `{"error": "...", "kind": "internal_error"}`.

### 6.3 Events: `POST /sessions/{id}/events`

Every event refreshes `session.live.last_event_at` (this is what keeps a live call
from being swept as orphaned). Response `{"ok":true}`; unknown session `404 {"ok":false}`.
Client timeout 5 s; failures are logged, never raised.

| `type` | Sent by voice-rt when | Extra fields | App server action |
|---|---|---|---|
| `started` | on `on_client_connected`, after the greeting is queued | none | refresh only |
| `heartbeat` | every 60 s while the call runs | `state`, `turns` | refresh only |
| `state` | after a state switch | `state` (one of the seven) | `session.live.state = state` |
| `engine_fallback` | S2S build failed, rebuilt as chained | `from`, `to`, `reason` (<= 200 chars) | `reportError` type `voice_agent_engine_fallback`, silent, `escalateAfter: 10` |
| `error` | provider failure (build, pipeline exception, ErrorFrame) | `provider`, `error_class`, `message` (<= 500 chars) | `auth_failure` / `quota_exhausted`: `voice_agent_provider_failure:critical` (pages, cannot be silenced). Else `voice_agent_provider_failure`. |
| `turn` | never sent by the reference voice-rt | `turns` | `session.live.turns = turns` |

`error_class` values: `auth_failure`, `quota_exhausted`, `rate_limited`,
`provider_error` (see `classify_provider_error` in `pipeline-and-audio.md`).

### 6.4 Recording: `PUT /sessions/{id}/recording`

- Body: raw WAV bytes, `Content-Type: audio/wav`. Client timeouts read/write 120 s.
- Stored in the storage bucket `phone_call_recordings` at
  `{company_id}/{session_id}.wav` (`.mp3` if the content type mentions mpeg/mp3),
  `upsert: true`.
- 200 `{"ok":true,"path":"<company_id>/<session_id>.wav"}`; 400 empty body; 404
  unknown session; 500 upload failed (reported as `voice_agent_recording_upload_error`).
- If the call was already finalized (recording arrived late), the app server updates
  `call_history.recording_bucket_id` where `company_id` matches and
  `call_sid = session_id`.
- The route expects `req.body` to be a Buffer, so it must be mounted behind a raw body
  parser. That mount is not covered by the reference implementation.

### 6.5 End: `POST /sessions/{id}/end`

Request (`VoiceRtEndPayload`, built by `CallSession.end_payload()`):

```json
{
  "ended_by": "caller",
  "started_at": "2026-10-06T15:04:05.123456+00:00",
  "ended_at": "2026-10-06T15:07:12.654321+00:00",
  "duration_seconds": 187.53,
  "transcript": [
    { "role": "assistant", "content": "Example Business, this is Allie speaking...", "t_ms": 900 },
    { "role": "user", "content": "Hi, I want to book...", "t_ms": 4200 },
    { "role": "tool", "content": "<tool log line, see note>", "t_ms": 9100,
      "tool_name": "checkAvailability", "tool_ok": true }
  ],
  "tool_calls": [
    { "name": "checkAvailability", "args": { }, "ok": true, "latency_ms": 412, "t_ms": 9100, "error": null }
  ],
  "final_state": "booking",
  "engine": "chained",
  "latency": { "ttfb_p50_ms": 610.2, "ttfb_p95_ms": 980.4, "ttfb_max_ms": 1302.0, "turns": 9 },
  "usage": {
    "stt_seconds": 187.53, "tts_characters": 1840,
    "llm_input_tokens": 52000, "llm_output_tokens": 900,
    "s2s_audio_input_tokens": 0, "s2s_audio_output_tokens": 0,
    "models": { "stt": "nova-3-general", "llm": "gpt-4.1", "tts": "sonic-3.6" }
  },
  "error": null,
  "recording_bucket_path": "<company_id>/<session_id>.wav"
}
```

- `ended_by`: `caller | agent | transfer | error | timeout`.
- `stt_seconds` equals the call duration on the chained engine, 0 on S2S.
- An interrupted assistant turn has ` [interrupted]` appended to its content.
- A `tool` transcript row's content is the tool name, its JSON args (cut to 400
  chars) and the word ok or the error; a state switch logs the name and target state;
  an inject logs `[inject] <text>`. The app server keeps only `user` and `assistant`
  rows in the readable transcript (`User:` / `Agent:` lines) and stores the full list
  in `call_history` metadata.
- Response: `202 {"ok":true}` immediately, then `finalizeVoiceAgentCall` runs async.
  400 `{"ok":false,"error":"invalid end payload"}` if `transcript` is not an array;
  404 unknown session.
- Client: 3 attempts, 20 s timeout each; accepts 200 or 202; stops early on 404.

---

## 7. App server to voice-rt (control API)

Client: `rtClient.ts`. Base `VOICE_RT_URL`; throws `VoiceRtUnavailableError` if unset.
Sends `Content-Type: application/json` and `X-Voice-Agent-Secret`. Default timeout
5 s (health 4 s). A non-2xx throws `voice-rt <METHOD> <path> failed: <detail|error>`.

| Route | Request | Response |
|---|---|---|
| `GET /health` (no auth) | none | `{"status":"ok","service":"voice-rt","version":"0.1.0","pipecat_version":"1.11.0","active_calls":0,"capacity":40}` |
| `POST /sessions/{id}/inject` | `{"additional_context": str?, "trigger_response": bool = false, "speak_verbatim": str?}` | `{"ok":true}`; 400 if neither text field; 404 `no live session` |
| `POST /sessions/{id}/hangup` | `{"reason": "operator"}` (default) | `{"ok":true}`; 404 `no live session` |
| `GET /sessions` | none | `{"sessions":[{"session_id","call_sid","engine","state","turns","started_at","duration_seconds"}]}` (not called by the reference app server) |

The registry behind inject, hangup and sessions is IN PROCESS. With more than one
voice-rt instance behind a load balancer, a control call can land on an instance that
does not hold the call. See the landmine in SKILL.md.

---

## 8. Superadmin API (`/api/voice-agent/admin`, behind `requireSuperAdmin`)

| Route | Notes |
|---|---|
| `GET /health` | `{master_enabled, gate_flag_key, targeted:{companies, locations}, configured, voice_rt_url, default_provider, default_engine, live_sessions_here, reachable, runtime, error?}`. `targeted` is read from `retell_prompt_flags` (`company_ids`, `location_ids` where `key = 'self_hosted_voice_agent'`). |
| `GET /numbers` | Up to 1000 voice numbers with a non-null `ai_provider` and not deleted, newest `ai_enabled_at` first, joined with company and location names. |
| `PUT /numbers/:voiceNumberId/provider` | Body `{"provider":"retell"|"pipecat"}`. Runs `switchAiProvider`. Errors return `{error, code}` with the error's HTTP status. |
| `GET /sessions` | The app server's in-memory sessions (`pending` / `live` / `ended`). |
| `POST /outbound-test` | Body `{company_id, location_id?, to_number, from_number, objective?}`. Default objective: a short "can you hear me, does it sound natural" test call. `reason: "superadmin_test"`. |
| `POST /sessions/:id/inject` | Trims `additional_context` to 4000 chars and `speak_verbatim` to 1000. 404 if no live session. 503 if voice-rt unconfigured, 502 on a voice-rt error. |
| `POST /sessions/:id/hangup` | Calls voice-rt hangup with reason `superadmin` AND ends the carrier leg (`lamlEndCall`). Returns `{ok, runtime, carrier}`. |

## 9. Outbound and campaign API (`Internal-Secret`)

`POST /api/internal/voice-agent/outbound`

```json
{ "company_id": "<uuid>", "location_id": "<uuid, optional>", "to_number": "any format",
  "from_number": "+1555...", "objective": "Remind them of tomorrow's 3pm visit and offer to reschedule.",
  "reason": "reminder", "variables": { "appointment_time": "3pm" } }
```

- 400 if `company_id` is not a UUID, numbers missing, or `objective` empty.
- 200 `{"ok":true,"session_id":"vrt_...","provider_call_sid":"<sid>","status":"<carrier status>"}`.
- Errors `{"error": "<message>", "code": "<code>"}`:

| code | HTTP | Meaning |
|---|---|---|
| `gate_closed` | 409 | master switch off or company not targeted |
| `runtime_unconfigured` | 409 | `VOICE_RT_URL` unset |
| `bad_to_number` | 400 | not normalizable to E.164 |
| `optout_check_failed` | 502 | DNC lookup failed (fails safe: no call) |
| `opted_out` | 409 | customer opted out for this scope |
| `from_not_found` | 404 | from number not an active number of this company |
| `from_not_self_hosted` | 409 | from number not `ai_provider='pipecat'` or AI suspended |
| `originate_failed` | 502 | carrier rejected the originate |

`POST /api/internal/voice-agent/campaign`

```json
{ "company_id": "<uuid>", "location_id": "<uuid, optional>", "name": "No-show win-back",
  "objective": "...", "from_number": "+1555...", "contact_ids": ["<uuid>", "..."],
  "consent_scope": "marketing", "max_concurrency": 3, "quiet_hours_start": 8,
  "quiet_hours_end": 21, "max_attempts": 2, "start_now": true }
```

Response `{"ok":true,"campaign_id":"<uuid>","recipient_count":N,"skipped":M}`.
Error codes: `gate_closed` 409, `no_objective` 400, `no_recipients` 400,
`from_not_self_hosted` 409, `no_valid_recipients` 400, `create_failed` 500,
`recipients_failed` 500.

## 10. Operator voice API (`/api/voice-agent/voices`, Bearer token)

Auth: `getUserCached(token)`, then `users` row must exist, not `is_blocked`, with a
`company_id`. `location_id` comes from the QUERY STRING. The auth helper now checks it belongs to the caller's company and that the caller can access it (403 otherwise). Before that fix it was not checked against the
company (see the landmine in SKILL.md).

| Route | Request | Response |
|---|---|---|
| `GET /?location_id=` | none | gate closed: `{"enabled":false,"catalog":[],"cloned":[],"selected":null}`. Open: `{"enabled":true,"catalog":[...10 voices],"cloned":[{key:"cartesia:<id>:<gender>", cartesia_id, name, gender, accent:"Your voice", description:"Custom cloned voice."}],"selected":"<ai_voice_id>"}` |
| `PUT /select?location_id=` | `{"voice_key":"allie"}` or `"cartesia:<id>:<gender>"` | `{"ok":true,"selected":"..."}`. Writes `location_prompt_variables.ai_voice_id`. A clone key must exist in this company's `voice_agent_cloned_voices`. |
| `POST /sample` | `{"cartesia_id":"<id>"}` | `audio/wav` bytes (24 kHz). 403 if gate closed, 503 if no Cartesia key. |
| `POST /clone` | `{"audio_base64":"<data URL or base64>","filename":"voice-sample.wav","name":"<= 60 chars","gender":"male|female","language":"en","consent":"<required text>"}` | `{"ok":true,"voice":{"key":"cartesia:<id>:<gender>","cartesia_id","name","gender"}}`. Audio must be 2 KB to 16 MB. |

Upstream Cartesia calls made by the app server (header `Authorization: Bearer
<CARTESIA_API_KEY>`, `Cartesia-Version: 2024-11-13`):

- Sample: `POST https://api.cartesia.ai/tts/bytes` with
  `{"model_id":"sonic-3.6","transcript":"<fixed sample line>","voice":{"mode":"id","id":"<id>"},"language":"en","output_format":{"container":"wav","encoding":"pcm_s16le","sample_rate":24000}}`.
- Clone: `POST https://api.cartesia.ai/voices/clone`, multipart form with `clip` (file;
  type from filename: `.mp3` audio/mpeg, `.webm` audio/webm, else audio/wav), `name`,
  `language`, `description`. Response JSON `id` is the new voice id, usable immediately.
