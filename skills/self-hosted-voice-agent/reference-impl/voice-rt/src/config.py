"""Runtime configuration for voice-rt, loaded from environment variables.

voice-rt holds NO database credentials. Everything tenant-scoped comes from
app-server over the shared-secret link (see api/billing.py).
"""

from __future__ import annotations

import logging

import structlog
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env",), env_file_encoding="utf-8", extra="ignore")

    # The brain. Session bootstrap, tool calls, end-of-call all go here.
    billing_server_url: str = "http://localhost:3001"
    voice_agent_shared_secret: str = ""

    # SignalWire Twilio-compatible REST (the serializer's auto hang-up).
    signalwire_space_url: str = ""
    signalwire_project_id: str = ""
    signalwire_api_token: str = ""

    # Engine B (chained STT -> LLM -> TTS)
    deepgram_api_key: str = ""
    elevenlabs_api_key: str = ""
    cartesia_api_key: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    google_api_key: str = ""

    # Capacity guard.
    max_concurrent_calls: int = 40

    # App
    port: int = 8000
    log_level: str = "INFO"
    node_env: str = "development"

    @property
    def signalwire_laml_base_url(self) -> str:
        """Root of the Twilio-compatible API on this SignalWire space.

        Pipecat's TwilioFrameSerializer appends
        `/2010-04-01/Accounts/{sid}/Calls/{call_sid}.json` to `base_url`.
        SignalWire serves the compat API under `/api/laml`.
        """
        space = self.signalwire_space_url.strip()
        if not space:
            return ""
        if not space.startswith("http"):
            space = f"https://{space}"
        return f"{space.rstrip('/')}/api/laml"


settings = Settings()


def configure_logging() -> None:
    """structlog: JSON in production (Render log drains), pretty console in dev."""
    is_dev = settings.node_env == "development"
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer() if is_dev else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, settings.log_level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
