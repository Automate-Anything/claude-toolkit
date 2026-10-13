"""HTTP client for app-server's internal voice-agent API.

Mirrors app-server/src/voiceAgent/routes/rt.ts exactly:
  GET  /api/internal/voice-agent/sessions/{id}            claim -> context
  POST /api/internal/voice-agent/sessions/{id}/tool-call  {name, arguments, step}
  POST /api/internal/voice-agent/sessions/{id}/events     {type, ...}
  PUT  /api/internal/voice-agent/sessions/{id}/recording  raw audio/wav
  POST /api/internal/voice-agent/sessions/{id}/end        end payload
"""

from __future__ import annotations

from typing import Any

import httpx
import structlog

from ..config import settings

logger = structlog.get_logger(__name__)

_BASE = "/api/internal/voice-agent"


class SessionClaimError(Exception):
    def __init__(self, status: int, reason: str) -> None:
        super().__init__(f"session claim failed: {status} {reason}")
        self.status = status
        self.reason = reason


def _headers() -> dict[str, str]:
    return {"X-Voice-Agent-Secret": settings.voice_agent_shared_secret}


class BillingClient:
    """One shared AsyncClient for the process (keep-alive to app-server)."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.billing_server_url.rstrip("/"),
            headers=_headers(),
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=30.0, pool=5.0),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def claim_session(self, session_id: str) -> dict[str, Any]:
        r = await self._client.get(f"{_BASE}/sessions/{session_id}", timeout=10.0)
        if r.status_code != 200:
            reason = "unknown"
            try:
                reason = str(r.json().get("error", reason))
            except Exception:
                pass
            raise SessionClaimError(r.status_code, reason)
        return r.json()

    async def tool_call(self, session_id: str, name: str, arguments: dict[str, Any], step: int) -> dict[str, Any]:
        """Never raises: a transport failure becomes an {ok: False, error} result
        the model can narrate ("our team has been notified" lives server-side)."""
        try:
            r = await self._client.post(
                f"{_BASE}/sessions/{session_id}/tool-call",
                json={"name": name, "arguments": arguments, "step": step},
                timeout=httpx.Timeout(connect=5.0, read=45.0, write=10.0, pool=5.0),
            )
            if r.status_code != 200:
                return {"ok": False, "result": None, "error": f"tool endpoint {r.status_code}", "latency_ms": 0}
            return r.json()
        except Exception as e:  # noqa: BLE001
            logger.error("tool_call_transport_error", session_id=session_id, tool=name, error=str(e))
            return {"ok": False, "result": None, "error": f"transport: {e}", "latency_ms": 0}

    async def event(self, session_id: str, payload: dict[str, Any]) -> None:
        try:
            await self._client.post(f"{_BASE}/sessions/{session_id}/events", json=payload, timeout=5.0)
        except Exception as e:  # noqa: BLE001
            logger.warning("event_post_failed", session_id=session_id, error=str(e))

    async def report_error(self, session_id: str, provider: str, error_class: str, message: str) -> None:
        """Surface a live-call provider failure into app-server's alert
        pipeline. voice-rt has no reportError of its own; this `error` event is
        the ONLY way a Deepgram/OpenAI/ElevenLabs failure (incl. the "ran out of
        money": error_class auth_failure/quota_exhausted) reaches on-call. Never
        raises: reporting a failure must never cause one."""
        try:
            await self._client.post(
                f"{_BASE}/sessions/{session_id}/events",
                json={
                    "type": "error",
                    "provider": provider,
                    "error_class": error_class,
                    "message": (message or "")[:500],
                },
                timeout=5.0,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("error_report_post_failed", session_id=session_id, provider=provider, error=str(e))

    async def upload_recording(self, session_id: str, wav_bytes: bytes) -> str | None:
        try:
            r = await self._client.put(
                f"{_BASE}/sessions/{session_id}/recording",
                content=wav_bytes,
                headers={"Content-Type": "audio/wav"},
                timeout=httpx.Timeout(connect=5.0, read=120.0, write=120.0, pool=5.0),
            )
            if r.status_code != 200:
                logger.error("recording_upload_failed", session_id=session_id, status=r.status_code, body=r.text[:300])
                return None
            return str(r.json().get("path") or "") or None
        except Exception as e:  # noqa: BLE001
            logger.error("recording_upload_error", session_id=session_id, error=str(e))
            return None

    async def end(self, session_id: str, payload: dict[str, Any]) -> bool:
        # Three attempts: the end payload is the call's durable record.
        for attempt in range(3):
            try:
                r = await self._client.post(f"{_BASE}/sessions/{session_id}/end", json=payload, timeout=20.0)
                if r.status_code in (200, 202):
                    return True
                logger.error("end_post_rejected", session_id=session_id, status=r.status_code, body=r.text[:300], attempt=attempt)
                if r.status_code == 404:
                    return False
            except Exception as e:  # noqa: BLE001
                logger.error("end_post_error", session_id=session_id, error=str(e), attempt=attempt)
        return False


billing = BillingClient()
