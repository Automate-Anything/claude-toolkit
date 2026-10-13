"""Observers: latency + usage metrics, and bot-speaking state.

Transcripts are captured from the aggregator events (see build.py); this
module only watches frames that fly through the pipeline.
"""

from __future__ import annotations

import asyncio

import structlog
from pipecat.frames.frames import BotStartedSpeakingFrame, BotStoppedSpeakingFrame, MetricsFrame
from pipecat.metrics.metrics import LLMUsageMetricsData, TTFBMetricsData, TTSUsageMetricsData
from pipecat.observers.base_observer import BaseObserver, FramePushed

from ..api.billing import billing
from ..calls.session import CallSession

logger = structlog.get_logger(__name__)

# Guarded: if a Pipecat release moves ErrorFrame, calls still run and only the
# error-frame alert path is lost (logged loudly), rather than crashing every call
# on an import error. VERIFY the path on a Pipecat upgrade.
try:
    from pipecat.frames.frames import ErrorFrame  # type: ignore
except Exception as _e:  # noqa: BLE001
    ErrorFrame = None  # type: ignore[assignment,misc]
    logger.error("error_frame_import_unavailable", error=str(_e))


def classify_provider_error(text: str) -> str:
    """Map a provider ErrorFrame's message to the same classes callOpenAi uses,
    so the "ran out of money" case (auth_failure / quota_exhausted) pages and is
    never silenced. Conservative: an unrecognized error defaults to provider_error
    (still alerts, just not as :critical), never to a benign class."""
    t = (text or "").lower()
    if any(k in t for k in ("401", "unauthorized", "invalid api key", "invalid_api_key", "authentication", "forbidden", "403", "invalid token")):
        return "auth_failure"
    if any(k in t for k in ("quota", "insufficient", "payment", "billing", "out of credit", "credits", "exceeded your current", "not enough", "balance")):
        return "quota_exhausted"
    if any(k in t for k in ("429", "rate limit", "rate_limit", "too many requests")):
        return "rate_limited"
    return "provider_error"


def provider_from_processor(name: str) -> str:
    """Best-effort provider label from the Pipecat processor class name on the frame."""
    n = (name or "").lower()
    if "deepgram" in n:
        return "deepgram"
    if "elevenlabs" in n or "eleven_labs" in n:
        return "elevenlabs"
    if "cartesia" in n:
        return "cartesia"
    if "realtime" in n:
        return "openai_realtime"
    if "openai" in n:
        return "openai"
    return name or "unknown"


class CallObserver(BaseObserver):
    """Accumulates TTFB per turn, token/char usage, and the bot-speaking flag."""

    def __init__(self, session: CallSession) -> None:
        super().__init__()
        self._s = session
        # Report each (provider, class) at most once per call, so a provider that
        # errors on every frame pages once, not hundreds of times.
        self._reported: set[str] = set()

    async def on_push_frame(self, data: FramePushed) -> None:  # type: ignore[override]
        frame = data.frame
        s = self._s
        if isinstance(frame, BotStartedSpeakingFrame):
            s.bot_speaking = True
            return
        if isinstance(frame, BotStoppedSpeakingFrame):
            s.bot_speaking = False
            return
        if ErrorFrame is not None and isinstance(frame, ErrorFrame):
            # A provider (STT/LLM/TTS) failed mid-call. This is where an
            # out-of-money / bad-key failure surfaces at runtime; funnel it to
            # app-server's alert pipeline so on-call is notified.
            try:
                src = str(getattr(data, "source", "") or getattr(frame, "processor", "") or "")
                provider = provider_from_processor(src)
                error_class = classify_provider_error(str(getattr(frame, "error", "") or ""))
                key = f"{provider}:{error_class}"
                if key not in self._reported:
                    self._reported.add(key)
                    logger.error("provider_error_frame", session_id=s.session_id, provider=provider, error_class=error_class, error=str(getattr(frame, "error", ""))[:300])
                    asyncio.create_task(billing.report_error(s.session_id, provider, error_class, str(getattr(frame, "error", ""))))
            except Exception as e:  # noqa: BLE001
                logger.warning("error_frame_report_skip", session_id=s.session_id, error=str(e))
            return
        if not isinstance(frame, MetricsFrame):
            return
        for d in frame.data:
            try:
                if isinstance(d, TTFBMetricsData):
                    # TTS TTFB is the closest per-turn "time to first audio"
                    # signal in a chained pipeline; the LLM TTFB is the
                    # thinking time. Keep the largest per processor family
                    # under a single list; the p50/p95 are what we watch.
                    proc = str(getattr(d, "processor", "") or "")
                    val = float(d.value) * 1000.0
                    if "TTS" in proc or "Realtime" in proc or "LLM" in proc:
                        s.ttfb_ms.append(val)
                elif isinstance(d, LLMUsageMetricsData):
                    v = d.value
                    prompt = int(getattr(v, "prompt_tokens", 0) or 0)
                    completion = int(getattr(v, "completion_tokens", 0) or 0)
                    if s.engine == "s2s_openai":
                        s.s2s_audio_input_tokens += prompt
                        s.s2s_audio_output_tokens += completion
                    else:
                        s.llm_input_tokens += prompt
                        s.llm_output_tokens += completion
                    model = getattr(d, "model", None)
                    if model:
                        s.models["llm"] = str(model)
                elif isinstance(d, TTSUsageMetricsData):
                    s.tts_characters += int(d.value or 0)
                    model = getattr(d, "model", None)
                    if model:
                        s.models["tts"] = str(model)
            except Exception as e:  # noqa: BLE001
                logger.debug("metrics_parse_skip", error=str(e))
