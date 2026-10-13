"""Per-call state for voice-rt + the in-process registry used by the control API.

A `CallSession` is the runtime twin of app-server's VoiceAgentSession: it
holds the context app-server handed us, the multi-prompt STATE the call is
in, the transcript/tool log we accumulate, latency + usage counters, and the
handles (worker, runner, context) the control endpoints need for the mid-call
push and hangup.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

STATES = ("starter", "booking", "cancel", "update", "confirmation", "questions", "name")


@dataclass
class TranscriptEntry:
    role: str  # user | assistant | tool
    content: str
    t_ms: int
    tool_name: str | None = None
    tool_ok: bool | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"role": self.role, "content": self.content, "t_ms": self.t_ms}
        if self.tool_name is not None:
            d["tool_name"] = self.tool_name
            d["tool_ok"] = bool(self.tool_ok)
        return d


@dataclass
class ToolCallLog:
    name: str
    args: Any
    ok: bool
    latency_ms: int
    t_ms: int
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "args": self.args,
            "ok": self.ok,
            "latency_ms": self.latency_ms,
            "t_ms": self.t_ms,
            "error": self.error,
        }


@dataclass
class CallSession:
    session_id: str
    context: dict[str, Any]
    call_sid: str
    stream_sid: str
    engine: str  # chained | s2s_openai
    state: str = "starter"
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_mono: float = field(default_factory=time.monotonic)
    ended_at: datetime | None = None
    disconnected_mono: float | None = None
    ended_by: str = "caller"  # caller | agent | transfer | error | timeout
    error: str | None = None
    transcript: list[TranscriptEntry] = field(default_factory=list)
    tool_calls: list[ToolCallLog] = field(default_factory=list)
    turns: int = 0
    tool_steps: int = 0
    # Latency (ms) per assistant turn: first audio after the user stopped.
    ttfb_ms: list[float] = field(default_factory=list)
    # Usage counters
    tts_characters: int = 0
    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    s2s_audio_input_tokens: int = 0
    s2s_audio_output_tokens: int = 0
    models: dict[str, str | None] = field(default_factory=lambda: {"stt": None, "llm": None, "tts": None})
    # Live flags
    bot_speaking: bool = False
    transfer_requested: bool = False
    end_requested: bool = False
    # True while a server tool call is in flight, so the ambient mixer swells
    # the keyboard-typing layer (the agent "looking it up") instead of dead air.
    tool_working: bool = False
    recording_bucket_path: str | None = None
    # Pipecat handles (set by the pipeline builder)
    worker: Any = None
    serializer: Any = None  # CarrierSerializer; the transfer tool suppresses its hang-up
    runner: Any = None
    llm_context: Any = None
    llm: Any = None
    audio_buffer: Any = None
    backchannel: Any = None
    # Wake-up for the graceful-end waiter
    _end_event: asyncio.Event = field(default_factory=asyncio.Event)

    # ── helpers ──────────────────────────────────────────────────────────
    def t_ms(self) -> int:
        return int((time.monotonic() - self.started_mono) * 1000)

    def add_transcript(self, role: str, content: str, **kw: Any) -> None:
        if not content:
            return
        self.transcript.append(TranscriptEntry(role=role, content=content, t_ms=self.t_ms(), **kw))

    # Automatic multilingual (owner 2026-10-05: no toggle). sonic-3.6 speaks 44
    # languages at the same quality, and Deepgram runs in 'multi' detect mode, so
    # the only missing piece is telling the MODEL to answer in the caller's
    # language. This directive rides on every state prompt, for both engines.
    MULTILINGUAL_DIRECTIVE = (
        "Always reply in the same language the caller is speaking. If they switch "
        "languages mid-call, switch with them. Keep names, services, and times "
        "accurate when you translate. Default to English until the caller speaks "
        "another language."
    )

    def prompt_for_state(self, state: str) -> str:
        prompts: dict[str, str] = self.context.get("prompts") or {}
        body = prompts.get(state) or prompts.get("starter") or ""
        extra = (self.context.get("disambiguation_instruction") or "").strip()
        parts = [self.MULTILINGUAL_DIRECTIVE]
        if extra:
            parts.append(extra)
        parts.append(body)
        return "\n\n".join(p for p in parts if p)

    def duration_seconds(self) -> float:
        end_mono = self.disconnected_mono if self.disconnected_mono is not None else time.monotonic()
        return max(0.0, end_mono - self.started_mono)

    def request_end(self, ended_by: str) -> None:
        if not self.end_requested:
            self.end_requested = True
            self.ended_by = ended_by
        self._end_event.set()

    def latency_summary(self) -> dict[str, Any]:
        vals = sorted(self.ttfb_ms)
        if not vals:
            return {"ttfb_p50_ms": None, "ttfb_p95_ms": None, "ttfb_max_ms": None, "turns": self.turns}

        def pct(p: float) -> float:
            idx = min(len(vals) - 1, max(0, int(round((p / 100.0) * (len(vals) - 1)))))
            return round(vals[idx], 1)

        return {
            "ttfb_p50_ms": pct(50),
            "ttfb_p95_ms": pct(95),
            "ttfb_max_ms": round(vals[-1], 1),
            "turns": self.turns,
        }

    def end_payload(self) -> dict[str, Any]:
        ended = self.ended_at or datetime.now(timezone.utc)
        duration = self.duration_seconds()
        return {
            "ended_by": self.ended_by,
            "started_at": self.started_at.isoformat(),
            "ended_at": ended.isoformat(),
            "duration_seconds": round(duration, 2),
            "transcript": [t.to_dict() for t in self.transcript],
            "tool_calls": [t.to_dict() for t in self.tool_calls],
            "final_state": self.state,
            "engine": self.engine,
            "latency": self.latency_summary(),
            "usage": {
                "stt_seconds": round(duration if self.engine == "chained" else 0.0, 2),
                "tts_characters": self.tts_characters,
                "llm_input_tokens": self.llm_input_tokens,
                "llm_output_tokens": self.llm_output_tokens,
                "s2s_audio_input_tokens": self.s2s_audio_input_tokens,
                "s2s_audio_output_tokens": self.s2s_audio_output_tokens,
                "models": self.models,
            },
            "error": self.error,
            "recording_bucket_path": self.recording_bucket_path,
        }


# ── registry (control API + capacity guard) ─────────────────────────────────

_sessions: dict[str, CallSession] = {}


def register(session: CallSession) -> None:
    _sessions[session.session_id] = session


def unregister(session_id: str) -> None:
    _sessions.pop(session_id, None)


def get(session_id: str) -> CallSession | None:
    return _sessions.get(session_id)


def active_count() -> int:
    return len(_sessions)


def active_summaries() -> list[dict[str, Any]]:
    return [
        {
            "session_id": s.session_id,
            "call_sid": s.call_sid,
            "engine": s.engine,
            "state": s.state,
            "turns": s.turns,
            "started_at": s.started_at.isoformat(),
            "duration_seconds": round(s.duration_seconds(), 1),
        }
        for s in _sessions.values()
    ]
