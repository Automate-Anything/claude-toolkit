"""The tool bridge: app-server's tool schemas -> Pipecat function schemas.

voice-rt defines NO tools of its own. app-server sends the shared library
(chat-agent tools + voice-only tools) as OpenAI function schemas plus a
`tool_routing` map; this module wraps each one in a Pipecat FunctionSchema
whose handler either acts locally (state switch, end_call, transfer_call
announce) or POSTs the call back to app-server and feeds the JSON result
to the model. One library, both runtimes, zero drift.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Awaitable, Callable

import structlog
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.frames.frames import TTSSpeakFrame
from pipecat.services.llm_service import FunctionCallParams

from ..api.billing import billing
from ..calls.session import STATES, CallSession, ToolCallLog

logger = structlog.get_logger(__name__)

STATE_SWITCH = {
    "booking_agent_transfer": "booking",
    "cancel_agent_transfer": "cancel",
    "update_agent_transfer": "update",
    "cnformation_agent_transfer": "confirmation",
    "question_agent_transfer": "questions",
    "name_agent_transfer": "name",
}

TRANSFER_ANNOUNCE = "One moment while I transfer you."

SwitchState = Callable[[CallSession, str], Awaitable[None]]


def _coerce_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            v = json.loads(raw)
            return v if isinstance(v, dict) else {}
        except Exception:
            return {}
    return {}


async def _wait_bot_quiet(session: CallSession, max_seconds: float) -> None:
    """Wait until the bot has finished speaking (bounded)."""
    deadline = time.monotonic() + max_seconds
    # Give TTS a beat to start if it has not yet.
    await asyncio.sleep(0.3)
    while time.monotonic() < deadline:
        if not session.bot_speaking:
            return
        await asyncio.sleep(0.1)


def build_tools(session: CallSession, switch_state: SwitchState) -> ToolsSchema:
    ctx = session.context
    defs: list[dict[str, Any]] = ctx.get("tools") or []
    routing: dict[str, str] = ctx.get("tool_routing") or {}
    schemas: list[FunctionSchema] = []

    for d in defs:
        fn = d.get("function") or {}
        name = str(fn.get("name") or "")
        if not name:
            continue
        params = fn.get("parameters") or {}
        properties = params.get("properties") or {}
        required = params.get("required") or []
        description = str(fn.get("description") or "")
        route = routing.get(name, "server")

        async def handler(params: FunctionCallParams, _name: str = name, _route: str = route) -> None:
            t0 = time.monotonic()
            args = _coerce_args(params.arguments)
            session.tool_steps += 1
            step = session.tool_steps
            t_ms = session.t_ms()

            try:
                if _route == "local_state_switch" or _name in STATE_SWITCH:
                    target = STATE_SWITCH.get(_name, "starter")
                    if target not in STATES:
                        target = "starter"
                    await switch_state(session, target)
                    result: dict[str, Any] = {"ok": True, "switched_to": target}
                    session.tool_calls.append(ToolCallLog(_name, args, True, int((time.monotonic() - t0) * 1000), t_ms))
                    session.add_transcript("tool", f"{_name} -> {target}", tool_name=_name, tool_ok=True)
                    # The new state's prompt should drive the next turn: return
                    # the result and let the model continue in-turn.
                    await params.result_callback(result)
                    return

                if _route == "local_end_call" or _name == "end_call":
                    session.tool_calls.append(ToolCallLog(_name, args, True, 0, t_ms))
                    session.add_transcript("tool", "end_call", tool_name=_name, tool_ok=True)
                    await params.result_callback({"ok": True})
                    # Let the goodbye finish, then end the pipeline. The runner
                    # loop reports ended_by='agent' and app-server hangs the
                    # PSTN leg up via REST (belt and braces with auto_hang_up).
                    asyncio.create_task(_graceful_end(session, "agent"))
                    return

                if _route == "transfer_call" or _name == "transfer_call":
                    session.transfer_requested = True
                    # Announce, wait for the audio to finish, THEN redirect the
                    # leg (the redirect kills the media stream immediately).
                    if session.worker is not None:
                        await session.worker.queue_frame(TTSSpeakFrame(TRANSFER_ANNOUNCE))
                    await _wait_bot_quiet(session, 6.0)
                    # The redirect hands this same call SID to a human. Stop the
                    # serializer from completing it when the stream closes.
                    if session.serializer is not None:
                        session.serializer.suppress_hang_up = True
                    r = await billing.tool_call(session.session_id, _name, args, step)
                    ok = bool(r.get("ok"))
                    session.tool_calls.append(ToolCallLog(_name, args, ok, int((time.monotonic() - t0) * 1000), t_ms, r.get("error")))
                    session.add_transcript("tool", "transfer_call" + ("" if ok else f" FAILED: {r.get('error')}"), tool_name=_name, tool_ok=ok)
                    if ok:
                        session.request_end("transfer")
                    else:
                        session.transfer_requested = False
                        if session.serializer is not None:
                            session.serializer.suppress_hang_up = False
                    await params.result_callback(r.get("result") if ok else {"error": r.get("error") or "transfer failed"})
                    return

                # Everything else: the shared library on app-server. This
                # is the round trip that takes real time (DB/calendar/payment),
                # so flag the session as "working" to swell the keyboard-typing
                # ambience while the caller waits, instead of dead air.
                session.tool_working = True
                try:
                    r = await billing.tool_call(session.session_id, _name, args, step)
                finally:
                    session.tool_working = False
                ok = bool(r.get("ok"))
                latency = int(r.get("latency_ms") or (time.monotonic() - t0) * 1000)
                session.tool_calls.append(ToolCallLog(_name, args, ok, latency, t_ms, r.get("error")))
                session.add_transcript(
                    "tool",
                    f"{_name}({json.dumps(args)[:400]}) -> {'ok' if ok else 'error: ' + str(r.get('error'))}",
                    tool_name=_name,
                    tool_ok=ok,
                )
                if ok:
                    await params.result_callback(r.get("result"))
                else:
                    await params.result_callback({"error": r.get("error") or "tool failed", "kind": "internal_error"})
            except Exception as e:  # noqa: BLE001
                logger.error("tool_handler_error", session_id=session.session_id, tool=_name, error=str(e))
                session.tool_calls.append(ToolCallLog(_name, args, False, int((time.monotonic() - t0) * 1000), t_ms, str(e)))
                try:
                    await params.result_callback({"error": "internal error", "kind": "internal_error"})
                except Exception:  # noqa: BLE001
                    pass

        schemas.append(
            FunctionSchema(
                name=name,
                description=description,
                properties=properties,
                required=list(required),
                handler=handler,
            )
        )

    return ToolsSchema(standard_tools=schemas)


async def _graceful_end(session: CallSession, ended_by: str) -> None:
    await _wait_bot_quiet(session, 8.0)
    session.request_end(ended_by)
    worker = session.worker
    if worker is not None:
        try:
            await worker.stop_when_done()
        except Exception as e:  # noqa: BLE001
            logger.warning("stop_when_done_failed", session_id=session.session_id, error=str(e))
