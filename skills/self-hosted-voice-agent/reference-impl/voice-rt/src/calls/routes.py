"""The media WebSocket (one per call) and the small control API.

Lifecycle of a call:
  1. SignalWire opens /ws (cXML <Connect><Stream> from app-server).
  2. We read the `connected` + `start` messages (parse_telephony_websocket),
     pull `session_id` from the stream's custom parameters, and CLAIM the
     session from app-server (single-use; a replayed id is refused).
  3. Build the pipeline for the session's engine, run it, kick off the
     greeting.
  4. On stream end (caller hung up, transfer redirect, agent end_call, max
     duration): stop, upload the recording, POST the end payload. Every
     cleanup step is isolated so one failure cannot skip the end report
     (ported from the separate repo's hard-won teardown).
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from pipecat.runner.utils import parse_telephony_websocket

from ..api.billing import SessionClaimError, billing
from ..config import settings
from ..pipeline import build as pipeline_build
from ..pipeline.observers import classify_provider_error
from . import session as registry
from .session import CallSession

logger = structlog.get_logger(__name__)

router = APIRouter()

WS_CLOSE_CAPACITY = 1013
WS_CLOSE_POLICY = 1008


def _secret_ok(provided: str | None) -> bool:
    expected = settings.voice_agent_shared_secret
    if not expected or provided is None or len(provided) != len(expected):
        return False
    mismatch = 0
    for a, b in zip(provided, expected):
        mismatch |= ord(a) ^ ord(b)
    return mismatch == 0


def require_secret(x_voice_agent_secret: str | None = Header(default=None)) -> None:
    if not _secret_ok(x_voice_agent_secret):
        raise HTTPException(status_code=401, detail="invalid voice agent secret")


@router.websocket("/ws")
async def media_stream(websocket: WebSocket) -> None:
    await websocket.accept()

    if registry.active_count() >= settings.max_concurrent_calls:
        logger.error("capacity_exceeded", active=registry.active_count(), max=settings.max_concurrent_calls)
        await websocket.close(code=WS_CLOSE_CAPACITY, reason="capacity")
        return

    # 1. Read connected + start; get streamSid/callSid + our session id.
    try:
        _transport_type, call_data = await parse_telephony_websocket(websocket)
    except Exception as e:  # noqa: BLE001
        logger.error("stream_handshake_failed", error=str(e))
        await websocket.close(code=WS_CLOSE_POLICY, reason="bad handshake")
        return

    custom = getattr(call_data, "body", None) or {}
    session_id = str((custom.get("session_id") if isinstance(custom, dict) else None) or websocket.query_params.get("session_id") or "")
    stream_sid = str(getattr(call_data, "stream_id", "") or "")
    call_sid = str(getattr(call_data, "call_id", "") or "")
    if not session_id:
        logger.error("stream_missing_session_id", stream_sid=stream_sid, call_sid=call_sid)
        await websocket.close(code=WS_CLOSE_POLICY, reason="missing session")
        return

    # 2. Claim the session (context, prompts, tools, voice).
    try:
        context = await billing.claim_session(session_id)
    except SessionClaimError as e:
        logger.error("session_claim_refused", session_id=session_id, status=e.status, reason=e.reason)
        await websocket.close(code=WS_CLOSE_POLICY, reason=e.reason)
        return
    except Exception as e:  # noqa: BLE001
        logger.error("session_claim_error", session_id=session_id, error=str(e))
        await websocket.close(code=WS_CLOSE_POLICY, reason="claim error")
        return

    engine = str((context.get("voice") or {}).get("engine") or "chained")
    session = CallSession(
        session_id=session_id,
        context=context,
        call_sid=call_sid or str(context.get("call_sid") or ""),
        stream_sid=stream_sid,
        engine=engine,
    )
    registry.register(session)
    structlog.contextvars.bind_contextvars(session_id=session_id, call_sid=session.call_sid)
    logger.info("call_started", engine=engine, from_number=context.get("from_number"), to_number=context.get("to_number"))

    built = None
    max_duration = int((context.get("settings") or {}).get("max_duration_seconds") or 3600)

    async def _max_duration_guard() -> None:
        await asyncio.sleep(max_duration)
        logger.warning("max_duration_reached", seconds=max_duration)
        session.request_end("timeout")
        if session.worker is not None:
            try:
                await session.worker.cancel(reason="max duration")
            except Exception:  # noqa: BLE001
                pass

    guard_task: asyncio.Task | None = None
    heartbeat_task: asyncio.Task | None = None

    async def _heartbeat() -> None:
        # Ping app-server every 60s so it knows this call is still alive.
        # app-server's sweeper reconciles a live session into call_history
        # if it goes silent for 5 min (a crashed/dropped runtime), so a healthy
        # long call MUST keep this beat going or it would be falsely orphaned.
        while True:
            await asyncio.sleep(60)
            await billing.event(session_id, {"type": "heartbeat", "state": session.state, "turns": session.turns})

    try:
        # 3. Build + run. If the S2S (OpenAI Realtime) engine fails to construct
        # (bad key, model unavailable, SDK error), fall back ONCE to the chained
        # engine BEFORE any audio flows, so a Realtime outage degrades the tier
        # instead of dropping the call. This is a CONNECT-TIME fallback only: a
        # true mid-conversation engine swap would tear down the live audio
        # bridge and sound worse than it prevents, so we do not attempt it. A
        # Realtime failure AFTER audio starts ends the call normally (reported),
        # and the number's next call still tries S2S first.
        try:
            built = pipeline_build.build(session, websocket)
        except Exception as build_err:  # noqa: BLE001
            if session.engine == "s2s_openai":
                logger.error("s2s_build_failed_falling_back_to_chained", error=str(build_err))
                await billing.event(session_id, {"type": "engine_fallback", "from": "s2s_openai", "to": "chained", "reason": str(build_err)[:200]})
                session.engine = "chained"
                # Point the runtime at the chained voice config; app-server
                # still bills the tier it selected, but the caller gets a working
                # call. The mismatch is visible in the engine_fallback event.
                built = pipeline_build.build(session, websocket)
            else:
                # Chained-engine build failed (or s2s failed and this is not the
                # fallback path). A bad/expired provider key often shows up right
                # here, before any audio, so surface it to the alert pipeline.
                await billing.report_error(session_id, "pipeline_build", "provider_error", str(build_err))
                raise

        @built.transport.event_handler("on_client_connected")
        async def _on_connected(_t: Any, _c: Any) -> None:
            await built.recorder.start()
            await pipeline_build.kick_off(session)
            await billing.event(session_id, {"type": "started"})

        @built.transport.event_handler("on_client_disconnected")
        async def _on_disconnected(_t: Any, _c: Any) -> None:
            if session.disconnected_mono is None:
                session.disconnected_mono = time.monotonic()
                session.ended_at = datetime.now(timezone.utc)
            if not session.end_requested:
                session.request_end("transfer" if session.transfer_requested else "caller")
            try:
                await built.runner.cancel()
            except Exception:  # noqa: BLE001
                pass

        guard_task = asyncio.create_task(_max_duration_guard())
        heartbeat_task = asyncio.create_task(_heartbeat())
        await built.runner.add_workers(built.worker)
        await built.runner.run()
    except WebSocketDisconnect:
        logger.info("stream_disconnected")
    except Exception as e:  # noqa: BLE001
        logger.error("call_pipeline_error", error=str(e), exc_info=True)
        session.error = str(e)
        # A call that died on an exception (not a clean disconnect) is a real
        # failure a human should see. Classify it so an auth/quota cause pages.
        await billing.report_error(session_id, "pipeline", classify_provider_error(str(e)), str(e))
        if not session.end_requested:
            session.request_end("error")
    finally:
        if guard_task is not None and not guard_task.done():
            guard_task.cancel()
        if heartbeat_task is not None and not heartbeat_task.done():
            heartbeat_task.cancel()
        if session.disconnected_mono is None:
            session.disconnected_mono = time.monotonic()
        if session.ended_at is None:
            session.ended_at = datetime.now(timezone.utc)
        if not session.end_requested:
            session.request_end("caller")

        # Each step isolated: a failure in one must never skip the end report.
        if built is not None:
            try:
                await built.recorder.stop()
            except Exception as e:  # noqa: BLE001
                logger.warning("recorder_stop_error", error=str(e))
            try:
                wav = built.recorder.to_wav()
                if wav:
                    path = await billing.upload_recording(session_id, wav)
                    session.recording_bucket_path = path
            except Exception as e:  # noqa: BLE001
                logger.error("recording_upload_step_error", error=str(e))
        try:
            ok = await billing.end(session_id, session.end_payload())
            if not ok:
                logger.error("end_report_failed", session_id=session_id)
        except Exception as e:  # noqa: BLE001
            logger.error("end_report_error", error=str(e))
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass
        registry.unregister(session_id)
        logger.info(
            "call_ended",
            ended_by=session.ended_by,
            duration=round(session.duration_seconds(), 1),
            turns=session.turns,
            tools=len(session.tool_calls),
        )
        structlog.contextvars.clear_contextvars()


# ── control API (app-server -> voice-rt) ───────────────────────────────


class InjectBody(BaseModel):
    additional_context: str | None = None
    trigger_response: bool = False
    speak_verbatim: str | None = None


class HangupBody(BaseModel):
    reason: str = "operator"


@router.post("/sessions/{session_id}/inject")
async def inject_session(session_id: str, body: InjectBody, x_voice_agent_secret: str | None = Header(default=None)) -> dict[str, Any]:
    require_secret(x_voice_agent_secret)
    s = registry.get(session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="no live session")
    if not body.additional_context and not body.speak_verbatim:
        raise HTTPException(status_code=400, detail="additional_context or speak_verbatim required")
    await pipeline_build.inject(s, body.additional_context, body.trigger_response, body.speak_verbatim)
    s.add_transcript("tool", f"[inject] {body.speak_verbatim or body.additional_context}", tool_name="inject", tool_ok=True)
    return {"ok": True}


@router.post("/sessions/{session_id}/hangup")
async def hangup_session(session_id: str, body: HangupBody, x_voice_agent_secret: str | None = Header(default=None)) -> dict[str, Any]:
    require_secret(x_voice_agent_secret)
    s = registry.get(session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="no live session")
    s.request_end("agent")
    if s.worker is not None:
        try:
            await s.worker.cancel(reason=body.reason)
        except Exception as e:  # noqa: BLE001
            logger.warning("hangup_cancel_failed", error=str(e))
    return {"ok": True}


@router.get("/sessions")
async def list_sessions(x_voice_agent_secret: str | None = Header(default=None)) -> dict[str, Any]:
    require_secret(x_voice_agent_secret)
    return {"sessions": registry.active_summaries()}
