"""Call recording: capture both tracks in-process and hand app-server a WAV.

Uses Pipecat's AudioBufferProcessor (stereo: caller left, agent right). The
import is guarded: if a Pipecat release renames it, calls still run, only the
recording is lost, and that is logged loudly so it gets fixed.
"""

from __future__ import annotations

import io
import wave
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

try:  # VERIFY on Pipecat upgrades: module path as of 1.x
    from pipecat.processors.audio.audio_buffer_processor import AudioBufferProcessor  # type: ignore
except Exception as _e:  # noqa: BLE001
    AudioBufferProcessor = None  # type: ignore[assignment]
    logger.error("audio_buffer_processor_unavailable", error=str(_e))


class Recorder:
    """Collects PCM chunks from the buffer processor's on_audio_data event."""

    def __init__(self, sample_rate: int) -> None:
        self.sample_rate = sample_rate
        self.num_channels = 2
        self._chunks: list[bytes] = []
        self.processor: Any = None
        if AudioBufferProcessor is not None:
            try:
                self.processor = AudioBufferProcessor(
                    sample_rate=sample_rate,
                    num_channels=2,
                    # Flush every ~20s so a long call does not hold minutes of
                    # audio in one buffer.
                    buffer_size=sample_rate * 2 * 2 * 20,
                )

                @self.processor.event_handler("on_audio_data")
                async def _on_audio(_buffer: Any, audio: bytes, sample_rate: int, num_channels: int) -> None:
                    self.sample_rate = sample_rate
                    self.num_channels = num_channels
                    self._chunks.append(audio)

            except Exception as e:  # noqa: BLE001
                logger.error("audio_buffer_processor_init_failed", error=str(e))
                self.processor = None

    async def start(self) -> None:
        if self.processor is None:
            return
        try:
            await self.processor.start_recording()
        except Exception as e:  # noqa: BLE001
            logger.warning("recording_start_failed", error=str(e))

    async def stop(self) -> None:
        if self.processor is None:
            return
        try:
            await self.processor.stop_recording()
        except Exception as e:  # noqa: BLE001
            logger.warning("recording_stop_failed", error=str(e))

    def to_wav(self) -> bytes | None:
        if not self._chunks:
            return None
        pcm = b"".join(self._chunks)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(self.num_channels)
            w.setsampwidth(2)
            w.setframerate(self.sample_rate)
            w.writeframes(pcm)
        return buf.getvalue()
