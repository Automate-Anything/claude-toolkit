"""Builds the Pipecat pipeline for one call. Two engines, one tool library:

  chained    : transport.input -> STT (Deepgram) -> user aggregator (Silero VAD
               + Smart Turn v3) -> LLM (OpenAI) -> TTS (ElevenLabs) ->
               transport.output -> recorder -> assistant aggregator
  s2s_openai : transport.input -> user aggregator -> OpenAI Realtime (audio in,
               audio out, tools) -> transport.output -> recorder -> assistant
               aggregator

The multi-prompt STATE machine (starter/booking/cancel/...) is a system-prompt
swap: `switch_state` replaces the context's system message (chained) or the
session instructions (s2s) and lets the model continue.

API verified against Pipecat 1.11.0 (2026-09-22). See requirements.txt.
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import WebSocket
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    Frame,
    LLMMessagesAppendFrame,
    LLMMessagesUpdateFrame,
    LLMRunFrame,
    LLMUpdateSettingsFrame,
    TTSSpeakFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
from pipecat.turns.user_stop import TurnAnalyzerUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.workers.runner import WorkerRunner

from ..calls.session import CallSession
from ..config import settings
from .observers import CallObserver
from .recording import Recorder
from .tools import build_tools

logger = structlog.get_logger(__name__)

# Guarded: if a Pipecat release moves BaseAudioMixer or the mixer API, calls
# still run and only the ambience is lost (logged), instead of crashing every
# call. VERIFY the import + audio_out_mixer mapping shape on a Pipecat upgrade.
try:
    from .ambient import AmbientMixer  # type: ignore
except Exception as _amb_e:  # noqa: BLE001
    AmbientMixer = None  # type: ignore[assignment,misc]
    logger.error("ambient_mixer_unavailable", error=str(_amb_e))

# Silero stop_secs presets. Smart Turn v3 decides "actually done"; the VAD
# stop only sets how quickly we ask it. Ported from the separate repo's
# TURN_TAKING_MODES and re-tuned for the 1.x defaults (0.2s recommended).
TURN_TAKING = {
    "fast": VADParams(stop_secs=0.15, start_secs=0.15, confidence=0.7, min_volume=0.5),
    "balanced": VADParams(stop_secs=0.2, start_secs=0.2, confidence=0.7, min_volume=0.6),
    "patient": VADParams(stop_secs=0.4, start_secs=0.2, confidence=0.7, min_volume=0.6),
}

TELEPHONY_RATE = 8000
REALTIME_RATE = 24000


class Built:
    def __init__(self, worker: PipelineWorker, runner: WorkerRunner, transport: FastAPIWebsocketTransport, recorder: Recorder) -> None:
        self.worker = worker
        self.runner = runner
        self.transport = transport
        self.recorder = recorder


class CarrierSerializer(TwilioFrameSerializer):
    """The Twilio serializer with a switch to skip the auto hang-up.

    auto_hang_up completes the call by its call SID when the pipeline ends. On a
    transfer the same leg has just been redirected to a human, so completing it
    would cut the caller off mid-transfer. The transfer tool sets
    `suppress_hang_up` BEFORE it asks app-server to redirect the leg, and
    clears it again if the transfer fails. Every other end still hangs up.
    """

    suppress_hang_up: bool = False

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if self.suppress_hang_up and isinstance(frame, (EndFrame, CancelFrame)):
            return None
        return await super().serialize(frame)


def _serializer(session: CallSession) -> CarrierSerializer:
    # SignalWire is Twilio-compatible on the wire AND on the REST side. With
    # `base_url` pointed at the space's /api/laml root, the serializer's
    # auto hang-up (on EndFrame/CancelFrame) POSTs Status=completed to
    # SignalWire, not Twilio. app-server ALSO ends the leg on agent-ended
    # calls (idempotent), so a missing SignalWire credential here is not fatal.
    have_creds = bool(settings.signalwire_project_id and settings.signalwire_api_token and settings.signalwire_laml_base_url)
    serializer = CarrierSerializer(
        stream_sid=session.stream_sid,
        call_sid=session.call_sid or None,
        account_sid=settings.signalwire_project_id or None,
        auth_token=settings.signalwire_api_token or None,
        base_url=settings.signalwire_laml_base_url or None,
        params=TwilioFrameSerializer.InputParams(auto_hang_up=have_creds),
    )
    session.serializer = serializer
    return serializer


def _user_params(session: CallSession) -> LLMUserAggregatorParams:
    mode = str((session.context.get("settings") or {}).get("turn_taking_mode") or "balanced")
    vad = SileroVADAnalyzer(params=TURN_TAKING.get(mode, TURN_TAKING["balanced"]))
    return LLMUserAggregatorParams(
        vad_analyzer=vad,
        user_turn_strategies=UserTurnStrategies(
            stop=[TurnAnalyzerUserTurnStopStrategy(turn_analyzer=LocalSmartTurnAnalyzerV3())]
        ),
    )


async def switch_state(session: CallSession, target: str) -> None:
    """Swap the system prompt to the target state (Retell multi-prompt parity)."""
    if target == session.state:
        return
    session.state = target
    prompt = session.prompt_for_state(target)
    worker = session.worker
    if worker is None:
        return
    if session.engine == "s2s_openai":
        from pipecat.services.openai.realtime.llm import OpenAIRealtimeLLMService

        await worker.queue_frame(LLMUpdateSettingsFrame(delta=OpenAIRealtimeLLMService.Settings(system_instruction=prompt)))
    else:
        # A state switch fires INSIDE a tool call: the assistant's tool_call
        # message is in the context and its result is about to be appended.
        # Replacing the whole message list here could orphan that pair (the
        # provider rejects a tool result without its call), so mutate the
        # system message IN PLACE and let the turn continue unchanged. The
        # frame-based replace is only the fallback if the context does not
        # expose its live list (VERIFY on first test call: the second state's
        # behavior must change after "booking_agent_transfer").
        ctx: LLMContext = session.llm_context
        live = ctx.messages
        swapped = False
        try:
            if live and isinstance(live[0], dict) and live[0].get("role") in ("system", "developer"):
                live[0]["content"] = prompt
                swapped = ctx.messages[0].get("content") == prompt
        except Exception as e:  # noqa: BLE001
            logger.warning("in_place_prompt_swap_failed", error=str(e))
        if not swapped:
            messages = list(live)
            if messages and isinstance(messages[0], dict) and messages[0].get("role") in ("system", "developer"):
                messages[0] = {"role": "system", "content": prompt}
            else:
                messages.insert(0, {"role": "system", "content": prompt})
            await worker.queue_frame(LLMMessagesUpdateFrame(messages=messages, run_llm=False))
    logger.info("state_switched", session_id=session.session_id, state=target)
    from ..api.billing import billing

    await billing.event(session.session_id, {"type": "state", "state": target})


async def inject(session: CallSession, additional_context: str | None, trigger_response: bool, speak_verbatim: str | None) -> None:
    worker = session.worker
    if worker is None:
        return
    if speak_verbatim:
        await worker.queue_frame(TTSSpeakFrame(speak_verbatim))
    if additional_context:
        await worker.queue_frame(
            LLMMessagesAppendFrame(
                messages=[{"role": "system", "content": f"[Live update from the business, follow it now] {additional_context}"}],
                run_llm=bool(trigger_response),
            )
        )


def _build_tts(session: CallSession, voice_bundle: dict[str, Any], lang_short: str) -> Any:
    """Pick the chained-tier TTS. Cartesia sonic-3.6 is the real voice (owner's
    picked voices + cloning + the most-human model); ElevenLabs stays as a fallback
    when a voice resolves only to an ElevenLabs id. The resolved bundle carries a
    `cartesia` block {voice_id, model, speed} when the merchant's voice is a Cartesia
    voice (the default now)."""
    cartesia = voice_bundle.get("cartesia") or {}
    cart_voice = cartesia.get("voice_id")
    if cart_voice:
        from pipecat.services.cartesia.tts import CartesiaTTSService

        model = str(cartesia.get("model") or "sonic-3.6")
        # generation_config = the delivery controls (owner wanted mellow/human, not
        # "wild"): speed (0.6-1.5), emotion tone guide, volume (0.5-2.0). Values
        # come from app-server's resolved voice config (mellow defaults there).
        # Guarded import: if a Pipecat release renames GenerationConfig, we fall back
        # to the voice's own default delivery rather than crash the call.
        def _f(v: object, d: float, lo: float, hi: float) -> float:
            try:
                return max(lo, min(hi, float(v)))  # type: ignore[arg-type]
            except Exception:  # noqa: BLE001
                return d
        gen = None
        try:
            from pipecat.services.cartesia.tts import GenerationConfig  # type: ignore

            gen = GenerationConfig(
                speed=_f(cartesia.get("speed"), 0.9, 0.6, 1.5),
                emotion=str(cartesia.get("emotion") or "neutral"),
                volume=_f(cartesia.get("volume"), 1.0, 0.5, 2.0),
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("cartesia_generation_config_unavailable", error=str(e))
        tts_settings = (
            CartesiaTTSService.Settings(voice=str(cart_voice), model=model, generation_config=gen)
            if gen is not None
            else CartesiaTTSService.Settings(voice=str(cart_voice), model=model)
        )
        tts = CartesiaTTSService(
            api_key=settings.cartesia_api_key,
            sample_rate=TELEPHONY_RATE,
            settings=tts_settings,
        )
        session.models["tts"] = model
        return tts

    from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

    el = voice_bundle.get("elevenlabs") or {}
    tts = ElevenLabsTTSService(
        api_key=settings.elevenlabs_api_key,
        sample_rate=TELEPHONY_RATE,
        settings=ElevenLabsTTSService.Settings(
            voice=str(el.get("voice_id") or "EXAVITQu4vr4xnSDxMaL"),
            model=str(el.get("model") or "eleven_flash_v2_5"),
            stability=float(el.get("stability", 0.5)),
            similarity_boost=float(el.get("similarity_boost", 0.75)),
            speed=float(el.get("speed", 1.0)),
        ),
    )
    session.models["tts"] = str(el.get("model") or "eleven_flash_v2_5")
    return tts


def _build_chained(session: CallSession, transport: FastAPIWebsocketTransport, recorder: Recorder) -> tuple[Pipeline, LLMContext, Any, Any]:
    from pipecat.services.deepgram.stt import DeepgramSTTService
    from pipecat.services.openai.llm import OpenAILLMService

    cfg = session.context.get("settings") or {}
    voice_bundle = session.context.get("voice") or {}
    language = voice_bundle.get("language") or "en-US"
    lang = language[0] if isinstance(language, list) else language
    lang_short = str(lang).split("-")[0] or "en"

    # Deepgram STT. Multilingual (owner 2026-10-05: automatic, no toggle): Nova-3
    # with language='multi' detects the caller's language per utterance; the LLM is
    # instructed to reply in the caller's language and Cartesia sonic-3.6 speaks it
    # (same model, 44 languages). We still pass the merchant's primary language as a
    # hint when they are on a single-language plan.
    stt_model = str(cfg.get("stt_model") or "nova-3-general")
    stt = DeepgramSTTService(
        api_key=settings.deepgram_api_key,
        sample_rate=TELEPHONY_RATE,
        settings=DeepgramSTTService.Settings(
            model=stt_model,
            language="multi",
            smart_format=True,
            punctuate=True,
        ),
    )
    session.models["stt"] = stt_model

    llm = OpenAILLMService(
        api_key=settings.openai_api_key,
        settings=OpenAILLMService.Settings(
            model=str(cfg.get("llm_model") or "gpt-4.1"),
            temperature=0.4,
            max_completion_tokens=400,
        ),
    )
    session.models["llm"] = str(cfg.get("llm_model") or "gpt-4.1")

    tts = _build_tts(session, voice_bundle, lang_short)

    tools = build_tools(session, switch_state)
    context = LLMContext(
        [{"role": "system", "content": session.prompt_for_state("starter")}],
        tools=tools,
    )
    user_agg, assistant_agg = LLMContextAggregatorPair(context, user_params=_user_params(session))

    stages: list[Any] = [transport.input(), stt, user_agg, llm, tts, transport.output()]
    if recorder.processor is not None:
        stages.append(recorder.processor)
    stages.append(assistant_agg)

    # Backchanneling (community BSD-2 pipecat-backchannel): soft "mhm"/"yeah" in
    # the bot's own Cartesia voice while the caller is still talking, so silence
    # does not feel dead. Owner wants it INFREQUENT: low fire_probability + a long
    # cooldown + a longer speak-before-eligible window. Fully guarded: if the
    # package or its wiring is unavailable, the call runs normally without it.
    # Only when the merchant hasn't disabled it (settings.backchannel !== false).
    stages = _maybe_backchannel(session, stages, tts)

    return Pipeline(stages), context, user_agg, assistant_agg


def _maybe_backchannel(session: CallSession, stages: list[Any], tts: Any) -> list[Any]:
    cfg = session.context.get("settings") or {}
    if cfg.get("backchannel") is False:
        return stages
    try:
        from pipecat_backchannel import Backchannel, BackchannelParams  # type: ignore

        bc = Backchannel(
            params=BackchannelParams(
                min_speech_before_eligible_s=2.5,  # only after the caller has been talking a while
                fire_probability=0.3,              # occasional, not constant (owner: "not so often")
                cooldown_s=12,                     # long gap between backchannels
            ),
        )
        wrapped = bc(stages)
        # Prewarm the clip cache in this call's TTS voice, in the background, so a
        # cold cache never blocks the call opening. Best-effort.
        async def _prewarm() -> None:
            try:
                await bc.prewarm(tts=tts)
            except Exception as e:  # noqa: BLE001
                logger.warning("backchannel_prewarm_failed", session_id=session.session_id, error=str(e))
        import asyncio
        asyncio.create_task(_prewarm())
        session.backchannel = bc  # keep a handle (e.g. to disable mid-call)
        return list(wrapped)
    except Exception as e:  # noqa: BLE001
        logger.warning("backchannel_unavailable", session_id=session.session_id, error=str(e))
        return stages


def _build_s2s(session: CallSession, transport: FastAPIWebsocketTransport, recorder: Recorder) -> tuple[Pipeline, LLMContext, Any, Any]:
    from pipecat.services.openai.realtime.events import (
        AudioConfiguration,
        AudioInput,
        AudioOutput,
        InputAudioNoiseReduction,
        InputAudioTranscription,
        SemanticTurnDetection,
        SessionProperties,
    )
    from pipecat.services.openai.realtime.llm import OpenAIRealtimeLLMService

    rt = (session.context.get("voice") or {}).get("openai_realtime") or {}
    model = str(rt.get("model") or "gpt-realtime-2.1")
    session.models["llm"] = model
    session.models["tts"] = model
    session.models["stt"] = model

    tools = build_tools(session, switch_state)
    llm = OpenAIRealtimeLLMService(
        api_key=settings.openai_api_key,
        settings=OpenAIRealtimeLLMService.Settings(
            model=model,
            system_instruction=session.prompt_for_state("starter"),
            session_properties=SessionProperties(
                audio=AudioConfiguration(
                    input=AudioInput(
                        transcription=InputAudioTranscription(),
                        turn_detection=SemanticTurnDetection(eagerness="medium"),
                        noise_reduction=InputAudioNoiseReduction(type="near_field"),
                    ),
                    output=AudioOutput(voice=str(rt.get("voice") or "marin"), speed=1.0),
                ),
                max_output_tokens=2048,
            ),
        ),
    )
    context = LLMContext(
        [{"role": "developer", "content": session.prompt_for_state("starter")}],
        tools=tools,
    )
    # Realtime mode is auto-detected by the aggregator pair.
    user_agg, assistant_agg = LLMContextAggregatorPair(context)

    stages: list[Any] = [transport.input(), user_agg, llm, transport.output()]
    if recorder.processor is not None:
        stages.append(recorder.processor)
    stages.append(assistant_agg)
    return Pipeline(stages), context, user_agg, assistant_agg


def build(session: CallSession, websocket: WebSocket) -> Built:
    is_s2s = session.engine == "s2s_openai"
    rate = REALTIME_RATE if is_s2s else TELEPHONY_RATE
    recorder = Recorder(sample_rate=rate)

    # Front-desk ambience (room tone + typing while a tool runs), mixed under
    # the outgoing audio by the output transport. It matches the output rate
    # (8 kHz chained / 24 kHz s2s) by synthesizing at that rate. Disable via
    # the per-call settings flag `ambient_sound=false` in the session context.
    cfg = (session.context.get("settings") or {})
    ambient_on = cfg.get("ambient_sound", True) is not False and AmbientMixer is not None
    # 1.11.0 wants a Mapping[str | None, BaseAudioMixer] keyed by output
    # destination; None is the default/only output on this transport.
    mixer = {None: AmbientMixer(session)} if ambient_on else None

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=_serializer(session),
            audio_out_mixer=mixer,
        ),
    )

    if is_s2s:
        pipeline, context, user_agg, assistant_agg = _build_s2s(session, transport, recorder)
    else:
        pipeline, context, user_agg, assistant_agg = _build_chained(session, transport, recorder)

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            # The Twilio serializer resamples 8 kHz mu-law to/from these rates.
            # The Realtime service speaks 24 kHz natively (VERIFY on first S2S
            # test call: adjust here if audio pitches/speeds wrong).
            audio_in_sample_rate=rate,
            audio_out_sample_rate=rate,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        idle_timeout_secs=120,
        observers=[CallObserver(session)],
    )
    runner = WorkerRunner(handle_sigint=False, handle_sigterm=False, force_gc=True)

    session.worker = worker
    session.runner = runner
    session.llm_context = context
    session.audio_buffer = recorder

    # ── transcript capture ───────────────────────────────────────────────
    @user_agg.event_handler("on_user_turn_message_added")
    async def _on_user(_agg: Any, message: Any) -> None:
        content = getattr(message, "content", None)
        if isinstance(content, str) and content.strip():
            session.add_transcript("user", content.strip())
            session.turns += 1

    @assistant_agg.event_handler("on_assistant_turn_stopped")
    async def _on_assistant(_agg: Any, message: Any) -> None:
        content = getattr(message, "content", None)
        if isinstance(content, str) and content.strip():
            suffix = " [interrupted]" if getattr(message, "interrupted", False) else ""
            session.add_transcript("assistant", content.strip() + suffix)

    return Built(worker=worker, runner=runner, transport=transport, recorder=recorder)


async def kick_off(session: CallSession) -> None:
    """First turn: the model opens per the starter prompt (Retell 'begin_message'
    equivalent), or a fixed greeting when the context provides one.

    Direction matters: on an INBOUND call the customer dialed us, so we greet
    them ("Thanks for calling ..."). On an OUTBOUND call WE dialed them, so the
    agent opens by saying who is calling and why (the outbound directive in the
    starter prompt already instructs this); the nudge just tells the model the
    line is now live."""
    worker = session.worker
    if worker is None:
        return
    greeting = (session.context.get("settings") or {}).get("greeting")
    if greeting:
        await worker.queue_frame(TTSSpeakFrame(str(greeting), append_to_context=True))
        return
    direction = str(session.context.get("direction") or "inbound")
    nudge = (
        "The person you called has just answered. Open the call now: say who you are, "
        "where you are calling from, and why, in one or two short sentences, as instructed above."
        if direction == "outbound"
        else "The call just connected. Greet the caller now, in one short sentence, as instructed above."
    )
    if session.engine != "s2s_openai":
        ctx: LLMContext = session.llm_context
        ctx.add_message({"role": "system", "content": nudge})
    await worker.queue_frame(LLMRunFrame())
