# The Pipecat pipeline, tools, audio and telemetry (read from reference-impl)

Pipecat version: `pipecat-ai==1.11.0`. Class and frame names below are that
release's; re-verify every one on an upgrade.

Files: `voice-rt/src/pipeline/build.py`, `tools.py`, `observers.py`,
`recording.py`, `ambient.py`, `voice-rt/src/calls/routes.py`, `session.py`.

---

## 1. Call lifecycle inside voice-rt (`calls/routes.py`)

1. Accept the socket, capacity check, telephony handshake, read `session_id`, claim
   the context (details in `endpoints-and-payloads.md`, section 5).
2. `engine = context.voice.engine` (default `chained`). Create a `CallSession`,
   register it in the per-process registry, bind `session_id` and `call_sid` into
   structlog context.
3. `max_duration = settings.max_duration_seconds` (fallback 3600).
4. Build the pipeline. If the engine is `s2s_openai` and the BUILD throws, post an
   `engine_fallback` event, set `engine = "chained"` and build again (connect-time
   fallback only). If a chained build throws, post an `error` event
   (`provider: "pipeline_build"`, `error_class: "provider_error"`) and re-raise.
5. Transport event `on_client_connected`: start the recorder, `kick_off()` (the first
   line), post `started`.
6. Transport event `on_client_disconnected`: stamp the end time; if no end reason yet,
   set `ended_by = "transfer"` when a transfer was requested, else `"caller"`; cancel
   the runner.
7. Start two tasks: the max-duration guard (sleeps, then `request_end("timeout")` and
   `worker.cancel(reason="max duration")`) and the heartbeat (every 60 s posts
   `{"type":"heartbeat","state","turns"}`).
8. `runner.add_workers(worker)` then `runner.run()`.
9. Exceptions: `WebSocketDisconnect` is logged as a normal end. Any other exception
   sets `session.error`, posts an `error` event classified by
   `classify_provider_error`, and ends with `"error"`.
10. `finally`, every step isolated in its own try so one failure cannot skip the end
    report: cancel guard and heartbeat, stamp end time, stop the recorder, build the
    WAV and upload it, POST the end payload (3 attempts), close the socket, unregister,
    log `call_ended` with `ended_by`, duration, turns and tool count.

## 2. Transport and serializer (`build.py`)

```python
TwilioFrameSerializer(
    stream_sid=session.stream_sid,
    call_sid=session.call_sid or None,
    account_sid=SIGNALWIRE_PROJECT_ID or None,
    auth_token=SIGNALWIRE_API_TOKEN or None,
    base_url="https://<space>/api/laml" or None,
    params=TwilioFrameSerializer.InputParams(auto_hang_up=have_creds),
)

FastAPIWebsocketTransport(websocket=ws, params=FastAPIWebsocketParams(
    audio_in_enabled=True,
    audio_out_enabled=True,
    add_wav_header=False,
    serializer=<the serializer>,
    audio_out_mixer={None: AmbientMixer(session)} or None,
))
```

- SignalWire is Twilio compatible on the wire AND on REST, so the Twilio serializer
  works unchanged once `base_url` points at the space's `/api/laml` root. The
  serializer appends `/2010-04-01/Accounts/{sid}/Calls/{call_sid}.json` and its auto
  hang-up POSTs `Status=completed` on EndFrame/CancelFrame.
- `audio_out_mixer` must be a MAPPING keyed by output destination (`None` = the only
  output) in 1.11.0, not a bare mixer object.
- Rates: `TELEPHONY_RATE = 8000` (chained), `REALTIME_RATE = 24000` (S2S). The
  serializer resamples 8 kHz mu-law to and from the pipeline rate.

Worker and runner:

```python
PipelineWorker(pipeline, params=PipelineParams(
    audio_in_sample_rate=rate, audio_out_sample_rate=rate,
    enable_metrics=True, enable_usage_metrics=True),
  idle_timeout_secs=120, observers=[CallObserver(session)])
WorkerRunner(handle_sigint=False, handle_sigterm=False, force_gc=True)
```

## 3. Engine B: chained (the default)

Stage order, exactly as built:

1. `transport.input()`
2. STT: `DeepgramSTTService(api_key, sample_rate=8000, settings=DeepgramSTTService.Settings(model=<settings.stt_model or "nova-3-general">, language="multi", smart_format=True, punctuate=True))`
3. User aggregator (VAD plus turn detection, below)
4. LLM: `OpenAILLMService(api_key, settings=OpenAILLMService.Settings(model=<settings.llm_model or "gpt-4.1">, temperature=0.4, max_completion_tokens=400))`
5. TTS: Cartesia, or ElevenLabs as fallback (below)
6. `transport.output()` (the ambient mixer runs here)
7. Recorder (`AudioBufferProcessor`), if it initialized
8. Assistant aggregator

Then the whole list is wrapped by the backchannel processor when enabled.

Context: `LLMContext([{"role":"system","content": prompt_for_state("starter")}], tools=<ToolsSchema>)`,
aggregators from `LLMContextAggregatorPair(context, user_params=...)`.

### Turn detection and interruption

```python
LLMUserAggregatorParams(
    vad_analyzer=SileroVADAnalyzer(params=TURN_TAKING[settings.turn_taking_mode]),
    user_turn_strategies=UserTurnStrategies(
        stop=[TurnAnalyzerUserTurnStopStrategy(turn_analyzer=LocalSmartTurnAnalyzerV3())]),
)
```

| Preset | `stop_secs` | `start_secs` | `confidence` | `min_volume` |
|---|---|---|---|---|
| `fast` | 0.15 | 0.15 | 0.7 | 0.5 |
| `balanced` (default, and what the app server always sends) | 0.2 | 0.2 | 0.7 | 0.6 |
| `patient` | 0.4 | 0.2 | 0.7 | 0.6 |

- Silero decides "voice stopped" after `stop_secs`; Smart Turn v3 (local CPU model)
  then decides whether the caller is actually done. Lower `stop_secs` = faster, more
  likely to cut a caller off. `patient` suits slow speakers.
- Interruption (barge-in) is NOT configured explicitly anywhere in the reference: no
  interruption parameters are passed, so it is Pipecat's default behavior for this
  aggregator setup. Hosted-platform knobs such as "interruption sensitivity" and
  "endpointing seconds" map onto these presets; the reference never ported specific
  values.
- Input denoising (a Pipecat input audio filter in front of STT) is not wired.
- `idle_timeout_secs=120` on the worker is the only idle cutoff. A hosted platform's
  "end call after N seconds of silence" is not covered by the reference implementation.

### TTS selection (`_build_tts`)

If `voice.cartesia.voice_id` is present:

```python
CartesiaTTSService(api_key=CARTESIA_API_KEY, sample_rate=8000,
  settings=CartesiaTTSService.Settings(voice=<voice_id>, model=<model or "sonic-3.6">,
    generation_config=GenerationConfig(
      speed=clamp(cartesia.speed, 0.6, 1.5, fallback 0.9),
      emotion=cartesia.emotion or "neutral",
      volume=clamp(cartesia.volume, 0.5, 2.0, fallback 1.0))))
```

`GenerationConfig` is imported inside a try: if a Pipecat release renames it, the
service is built without it (the voice's default delivery) instead of failing.

Otherwise ElevenLabs:

```python
ElevenLabsTTSService(api_key=ELEVENLABS_API_KEY, sample_rate=8000,
  settings=ElevenLabsTTSService.Settings(
    voice=<elevenlabs.voice_id or "EXAVITQu4vr4xnSDxMaL">,
    model=<elevenlabs.model or "eleven_flash_v2_5">,
    stability=<0.5>, similarity_boost=<0.75>, speed=<1.0>))
```

The computed language (`lang_short`) is NOT passed to either TTS. Cartesia speaks the
language of the text it is given.

### Backchannel (`_maybe_backchannel`)

- Package `pipecat-backchannel` (community, BSD-2). Chained engine only (it needs a
  separate TTS). Skipped when `settings.backchannel is False`. English only.

```python
bc = Backchannel(params=BackchannelParams(
    min_speech_before_eligible_s=2.5,   # only after the caller has talked a while
    fire_probability=0.3,               # occasional
    cooldown_s=12))                     # long gap between "mhm"s
stages = list(bc(stages))
asyncio.create_task(bc.prewarm(tts=tts))  # synth the clips in the bot's own voice, in the background
```

- Fully guarded: any import or wiring failure logs `backchannel_unavailable` and the
  call runs without it.

## 4. Engine A: speech-to-speech (`s2s_openai`)

Stage order: `transport.input()`, user aggregator, `OpenAIRealtimeLLMService`,
`transport.output()`, recorder, assistant aggregator. No STT, no TTS, no Silero,
no Smart Turn: turn detection is the model's own.

```python
OpenAIRealtimeLLMService(api_key=OPENAI_API_KEY, settings=OpenAIRealtimeLLMService.Settings(
  model=<voice.openai_realtime.model or "gpt-realtime-2.1">,
  system_instruction=prompt_for_state("starter"),
  session_properties=SessionProperties(
    audio=AudioConfiguration(
      input=AudioInput(
        transcription=InputAudioTranscription(),
        turn_detection=SemanticTurnDetection(eagerness="medium"),
        noise_reduction=InputAudioNoiseReduction(type="near_field")),
      output=AudioOutput(voice=<voice.openai_realtime.voice or "marin">, speed=1.0)),
    max_output_tokens=2048)))
```

- Context: `LLMContext([{"role":"developer","content": <starter prompt>}], tools=...)`;
  `LLMContextAggregatorPair(context)` with no user params (realtime mode is detected).
- Runs at 24 kHz (`REALTIME_RATE`); the code flags this as VERIFY on the first S2S call.
- The voice is the model's preset; a Cartesia or cloned voice cannot be used here.
- Begin message, "say verbatim" and the transfer announcement all use `TTSSpeakFrame`.
  This engine has no TTS stage, so those three are unverified on S2S. Test them.

## 5. The multi-prompt state machine

- States: `starter, booking, cancel, update, confirmation, questions, name`.
- `prompt_for_state(state)` = the multilingual directive + the
  `disambiguation_instruction` (when non-empty) + the state's rendered prompt (falls
  back to `starter`), joined by blank lines. The directive, verbatim:

  > Always reply in the same language the caller is speaking. If they switch languages
  > mid-call, switch with them. Keep names, services, and times accurate when you
  > translate. Default to English until the caller speaks another language.

- `switch_state(target)`:
  - S2S: queue `LLMUpdateSettingsFrame(delta=OpenAIRealtimeLLMService.Settings(system_instruction=<prompt>))`.
  - Chained: mutate `context.messages[0]["content"]` IN PLACE when the first message is
    `system` or `developer`. The switch fires inside a tool call, so replacing the whole
    message list could orphan the pending tool_call/tool_result pair (the provider
    rejects a result without its call). Only if the in-place edit does not stick, queue
    `LLMMessagesUpdateFrame(messages=<copy with new system>, run_llm=False)`.
  - Then post a `state` event. No hand-off sentence is added (see SKILL.md).

## 6. Tools bridge (`tools.py`)

voice-rt defines NO tools. For each OpenAI-format schema in `context.tools` it builds
`FunctionSchema(name, description, properties, required, handler)` and returns
`ToolsSchema(standard_tools=[...])`. The route comes from `context.tool_routing[name]`
(default `server`).

| Route | Handler behavior |
|---|---|
| `local_state_switch` (or a name in the state-switch map) | `switch_state(target)`, log it, return `{"ok":true,"switched_to":<state>}` so the model continues in the same turn. |
| `local_end_call` (or `end_call`) | Return `{"ok":true}`, then in the background wait for the bot to stop speaking (up to 8 s), `request_end("agent")`, `worker.stop_when_done()`. |
| `transfer_call` | Set `transfer_requested`; queue `TTSSpeakFrame("One moment while I transfer you.")`; wait until the bot is quiet (up to 6 s); POST the tool call (the app server redirects the leg). Success: `request_end("transfer")`, return the server's result. Failure: clear the flag, return `{"error": ...}`. |
| `server` (everything else) | Set `session.tool_working = True` (the ambient mixer swells the typing), POST `/tool-call`, clear the flag in `finally`. Success returns `result`; failure returns `{"error": <msg or "tool failed">, "kind": "internal_error"}`. |

- "Wait until quiet" sleeps 0.3 s, then polls `session.bot_speaking` every 0.1 s.
- Args arriving as a JSON string are parsed; anything unparseable becomes `{}`.
- A handler exception returns `{"error":"internal error","kind":"internal_error"}`.
- The state-switch map (names are load-bearing; the typo is deliberate and matches
  the live prompts): `booking_agent_transfer` to `booking`, `cancel_agent_transfer`
  to `cancel`, `update_agent_transfer` to `update`, `cnformation_agent_transfer` to
  `confirmation`, `question_agent_transfer` to `questions`, `name_agent_transfer` to
  `name`.

## 7. First line, mid-call push, hang-up

`kick_off()` runs on client connect:

- If `settings.greeting` is set: queue `TTSSpeakFrame(greeting, append_to_context=True)`
  and return. The line is spoken verbatim before any LLM turn.
- Else (outbound): on chained, append a system message, then queue `LLMRunFrame()`.
  Outbound nudge, verbatim: "The person you called has just answered. Open the call
  now: say who you are, where you are calling from, and why, in one or two short
  sentences, as instructed above." Inbound nudge (used only when no greeting):
  "The call just connected. Greet the caller now, in one short sentence, as
  instructed above." On S2S the nudge message is not added; only `LLMRunFrame()`.

`inject(additional_context, trigger_response, speak_verbatim)`:
- `speak_verbatim`: queue `TTSSpeakFrame(text)`.
- `additional_context`: queue `LLMMessagesAppendFrame(messages=[{"role":"system","content":"[Live update from the business, follow it now] <text>"}], run_llm=trigger_response)`.
- Both can be sent in one call. The inject is logged into the transcript as a tool row.

Hang-up (control API): `request_end("agent")` then `worker.cancel(reason)`.

## 8. Ambient office and typing mix (`ambient.py`)

`AmbientMixer(BaseAudioMixer)` on the output transport, so it sits under every
outgoing audio frame on BOTH engines.

- `start(sample_rate)`: picks the asset set by rate (`8000` if rate <= 8000, else
  `24000`), loads `assets/office_<rate>.wav` and `assets/typing_<rate>.wav` (must be
  mono 16-bit, else ignored). A missing file falls back to synthesis (below).
- Each source is normalized to its own PEAK (scaled so max abs = 32767). This is peak
  normalization of the beds, not loudness normalization of the voice.
- The office bed is made loopable with a 0.25 s crossfade of tail into head; typing
  loops as is.
- Volumes (0.0 silent, 1.0 = as loud as the voice), tuned on a real phone call:

| Constant | Value | Meaning |
|---|---|---|
| `ROOM_TONE_VOLUME` | 0.035 | faint office presence, whole call (was 0.12: far too loud on a phone) |
| `TYPING_VOLUME` | 0.22 | soft keyboard, only while a server tool runs (was 0.55) |
| `TYPING_RAMP_SECONDS` | 0.25 | fade in and out so it never clicks |

- `mix(audio)`: for each int16 chunk of n samples, add `room[pos:pos+n] * 0.035`; ramp
  the typing gain toward 0.22 when `session.tool_working` else 0.0, by
  `n / (0.25 * rate)` per chunk; add `typing[pos:pos+n] * gain` while gain > 0.0001;
  `np.clip(sum, -32768, 32767).astype(int16)`. Any exception returns the voice
  unmixed (mixing must never break a call).
- `process_frame(MixerControlFrame)`: honors an `enable` bool as a kill switch.
- Synthesis fallback: room tone = 4 s of white noise low-passed by three ~4 ms box
  filters with a slow 3-cycle amplitude drift (0.85 to 1.0), crossfaded 0.2 s; typing
  = 3 s of ~12 ms decaying noise bursts with 90 to 240 ms random gaps and per-key level
  0.6 to 1.0. Fixed RNG seeds (7 and 13).
- Assets: real CC0 recordings converted to mono at 8 kHz and 24 kHz
  (`ffmpeg -ac 1 -ar <rate>`): an office ambience clip (about 13.6 s per the product
  skill) and a keyboard typing clip. Per-call off switch: `settings.ambient_sound=false`.
- The import is guarded in `build.py`: if the mixer import fails, calls run without
  ambience and `ambient_mixer_unavailable` is logged.

## 9. Recording (`recording.py`)

- `AudioBufferProcessor(sample_rate=<pipeline rate>, num_channels=2, buffer_size=rate*2*2*20)`
  placed after `transport.output()`. Stereo: caller left, agent right. The buffer flushes
  about every 20 s through `on_audio_data`, and the chunks are kept in memory.
- `start_recording()` on client connect, `stop_recording()` in teardown, then a 16-bit
  WAV is assembled with the `wave` module and PUT to the app server.
- Guarded import and init: if it fails, the call runs unrecorded and the app server's
  missing-recording alert fires for any real conversation.

## 10. Observers, latency and error classification (`observers.py`)

`CallObserver(BaseObserver).on_push_frame`:

- `BotStartedSpeakingFrame` / `BotStoppedSpeakingFrame` toggle `session.bot_speaking`.
- `ErrorFrame`: provider label from the processor name (`deepgram`, `elevenlabs`,
  `cartesia`, `openai_realtime`, `openai`, else the raw name); class from the message;
  report once per `(provider, class)` per call via an `error` event.
- `MetricsFrame`:
  - `TTFBMetricsData` from any processor whose name contains `TTS`, `Realtime` or
    `LLM` is appended (in ms) to ONE list. The p50/p95/max in the end payload therefore
    mix LLM and TTS time-to-first-byte; it is NOT a true voice-to-voice latency.
  - `LLMUsageMetricsData`: prompt and completion tokens go to the S2S audio counters on
    `s2s_openai`, else to the LLM counters; the model name is recorded.
  - `TTSUsageMetricsData`: adds to `tts_characters`; records the model.

`classify_provider_error(text)` (lowercased substring match, first hit wins):

| Class | Any of |
|---|---|
| `auth_failure` | `401`, `unauthorized`, `invalid api key`, `invalid_api_key`, `authentication`, `forbidden`, `403`, `invalid token` |
| `quota_exhausted` | `quota`, `insufficient`, `payment`, `billing`, `out of credit`, `credits`, `exceeded your current`, `not enough`, `balance` |
| `rate_limited` | `429`, `rate limit`, `rate_limit`, `too many requests` |
| `provider_error` | anything else (still alerts, never benign) |

## 11. Per-call state (`CallSession`)

Fields worth knowing: `state` (starts `starter`), `ended_by`
(`caller|agent|transfer|error|timeout`, first `request_end` wins), `transcript`,
`tool_calls`, `turns` (incremented per user message), `tool_steps`, `ttfb_ms`,
usage counters, `models`, `bot_speaking`, `transfer_requested`, `end_requested`,
`tool_working`, `recording_bucket_path`, and the Pipecat handles (`worker`, `runner`,
`llm_context`, `audio_buffer`, `backchannel`). The process registry is a plain dict
keyed by `session_id`; `active_count()` is the capacity guard.
