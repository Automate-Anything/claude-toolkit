"""voice-rt: the self-hosted Pipecat voice runtime for the app.

Replaces Retell's realtime loop. app-server stays the brain (tenant gates,
prompts, the shared tool library, post-call, billing); this service only runs
the media loop: SignalWire media stream <-> STT/LLM/TTS (or OpenAI Realtime).

See docs/plans/SELF_HOSTED_VOICE_AGENT_PLATFORM_PLAN.md and the
`self-hosted-voice-agent` skill in the main repo.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI

from .api.billing import billing
from .calls import session as registry
from .calls.routes import router as calls_router
from .config import configure_logging, settings

VERSION = "0.1.0"


def _pipecat_version() -> str | None:
    try:
        return version("pipecat-ai")
    except PackageNotFoundError:
        return None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    configure_logging()
    logger = structlog.get_logger(__name__)
    logger.info(
        "voice_rt_starting",
        port=settings.port,
        pipecat=_pipecat_version(),
        billing_server=settings.billing_server_url,
        max_concurrent_calls=settings.max_concurrent_calls,
        secret_configured=bool(settings.voice_agent_shared_secret),
    )
    if not settings.voice_agent_shared_secret:
        logger.error("voice_agent_shared_secret_missing", note="control endpoints will refuse every request; app-server claims will fail")
    yield
    await billing.aclose()
    logger.info("voice_rt_stopped")


app = FastAPI(title="the app voice-rt", version=VERSION, lifespan=lifespan)
app.include_router(calls_router)


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "voice-rt",
        "version": VERSION,
        "pipecat_version": _pipecat_version(),
        "active_calls": registry.active_count(),
        "capacity": settings.max_concurrent_calls,
    }
