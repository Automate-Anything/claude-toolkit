"""Ambient background audio for the voice agent: a subtle front-desk room tone
under the whole call, plus keyboard typing WHILE the agent is working a tool
call (the "let me pull that up" moment), so dead air sounds like a real
receptionist looking something up instead of a silent bot.

Matches Retell's "ambient sound" feature and exceeds it with the
tool-triggered typing. Implemented as a BaseAudioMixer so it sits on the output
transport and mixes under the agent's TTS/realtime audio before it hits the
wire (verified against Pipecat 1.11.0 SoundfileMixer: start/stop/process_frame/
mix signatures, and the np.clip(int16) mix math).

Why synthesized (numpy) instead of SoundfileMixer + WAV files:
  * No `soundfile` dependency and no asset files to bundle/resample. The mixer
    must match the transport sample rate exactly and SoundfileMixer does NOT
    resample; our two engines run at 8 kHz (chained) and 24 kHz (s2s), so a
    file approach would need two rate-specific copies of each clip. Generating
    at the live rate removes that whole class of bug.
  * The typing layer is driven by live CallSession state (tool_working), which
    is simpler and tighter than threading Mixer control frames per tool call.
"""

from __future__ import annotations

import os
import wave

import numpy as np
import structlog
from pipecat.audio.mixers.base_audio_mixer import BaseAudioMixer
from pipecat.frames.frames import MixerControlFrame

from ..calls.session import CallSession

logger = structlog.get_logger(__name__)

# Levels approved by ear (the other-agent recipe + our own A/B): the office bed
# is clearly present but well under the voice; typing is prominent during the
# lookup pause. 0.0 = silent, 1.0 = as loud as the agent's voice.
# Owner feedback 2026-10-06: the bed was far too loud on an actual phone call.
# Its ONLY job is a faint "you're on a live line" presence under the voice, not a
# soundscape. Dropped low. Typing is also eased down so it reads as someone at a
# desk, not a loud keyboard in your ear. Tunable; adjust by ear on a real call.
ROOM_TONE_VOLUME = 0.035     # faint office presence, whole call
TYPING_VOLUME = 0.22         # soft keyboard, only while a tool call runs
TYPING_RAMP_SECONDS = 0.25   # fade typing in/out so it never pops

_ASSET_DIR = os.path.join(os.path.dirname(__file__), "assets")


def _load_wav(path: str) -> np.ndarray | None:
    """Load a mono int16 WAV as float32, or None if missing/unreadable."""
    try:
        with wave.open(path, "rb") as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2:
                return None
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
        if data.size == 0:
            return None
        return data
    except Exception:  # noqa: BLE001
        return None


def _crossfade_loop(buf: np.ndarray, sample_rate: int) -> np.ndarray:
    """Cross-fade the tail into the head so a short clip loops with no seam."""
    xf = int(sample_rate * 0.25)
    if xf <= 0 or buf.size <= 2 * xf:
        return buf
    fade = np.linspace(0, 1, xf, dtype=np.float32)
    out = buf.copy()
    out[:xf] = out[:xf] * fade + out[-xf:] * (1 - fade)
    return out[:-xf]


class AmbientMixer(BaseAudioMixer):
    """Mixes a synthesized front-desk ambience under the outgoing audio.

    - Room tone plays continuously at a low level for the life of the call.
    - Keyboard typing swells in only while `session.tool_working` is True, so
      the agent sounds like it is actually looking something up during the
      otherwise-silent tool round trip.
    """

    def __init__(self, session: CallSession) -> None:
        self._session = session
        self._sample_rate = 8000
        self._enabled = True
        # Precomputed loops (filled in start(), once we know the rate).
        self._room: np.ndarray = np.zeros(0, dtype=np.float32)
        self._typing: np.ndarray = np.zeros(0, dtype=np.float32)
        self._room_pos = 0
        self._typing_pos = 0
        # Current typing gain, ramped toward the target so it never clicks on.
        self._typing_gain = 0.0

    async def start(self, sample_rate: int) -> None:
        self._sample_rate = sample_rate
        # Prefer the real CC0 recordings bundled at the call's rate; fall back to
        # synthesis only if a file is missing (so a call never loses ambience).
        rate_tag = 8000 if sample_rate <= 8000 else 24000
        office = _load_wav(os.path.join(_ASSET_DIR, f"office_{rate_tag}.wav"))
        typing = _load_wav(os.path.join(_ASSET_DIR, f"typing_{rate_tag}.wav"))
        source = "files"
        if office is None:
            office = self._make_room_tone(sample_rate)
            source = "synth"
        if typing is None:
            typing = self._make_typing_loop(sample_rate)
            source = "synth"
        # Normalize each to its own peak so the VOLUME constants are meaningful
        # regardless of the source clip's recording level.
        office = office / (float(np.max(np.abs(office))) + 1e-9) * 32767.0
        typing = typing / (float(np.max(np.abs(typing))) + 1e-9) * 32767.0
        self._room = _crossfade_loop(office.astype(np.float32), sample_rate)
        self._typing = typing.astype(np.float32)
        self._room_pos = 0
        self._typing_pos = 0
        logger.info("ambient_mixer_started", session_id=self._session.session_id, sample_rate=sample_rate, source=source)

    async def stop(self) -> None:
        return None

    async def process_frame(self, frame: MixerControlFrame) -> None:
        # A global kill switch if we ever want to mute ambience by control frame.
        # Enable/disable only; the typing swell is driven by session state.
        enable = getattr(frame, "enable", None)
        if isinstance(enable, bool):
            self._enabled = enable

    async def mix(self, audio: bytes) -> bytes:
        if not self._enabled or self._room.size == 0:
            return audio
        try:
            voice = np.frombuffer(audio, dtype=np.int16).astype(np.float32)
            n = voice.shape[0]
            if n == 0:
                return audio

            bed = self._take(self._room, self._room_pos, n) * ROOM_TONE_VOLUME
            self._room_pos = (self._room_pos + n) % self._room.size

            # Ramp the typing gain toward its target (on while a tool runs).
            target = TYPING_VOLUME if getattr(self._session, "tool_working", False) else 0.0
            step = (1.0 / max(1, int(TYPING_RAMP_SECONDS * self._sample_rate))) * n
            if self._typing_gain < target:
                self._typing_gain = min(target, self._typing_gain + step)
            elif self._typing_gain > target:
                self._typing_gain = max(target, self._typing_gain - step)

            mixed = voice + bed
            if self._typing_gain > 0.0001 and self._typing.size:
                keys = self._take(self._typing, self._typing_pos, n) * self._typing_gain
                self._typing_pos = (self._typing_pos + n) % self._typing.size
                mixed = mixed + keys

            out = np.clip(mixed, -32768, 32767).astype(np.int16)
            return out.tobytes()
        except Exception as e:  # noqa: BLE001 - mixing must never break the call
            logger.warning("ambient_mix_error", session_id=self._session.session_id, error=str(e))
            return audio

    # ── synthesis ────────────────────────────────────────────────────────────

    @staticmethod
    def _take(loop: np.ndarray, pos: int, n: int) -> np.ndarray:
        """n samples from a loop starting at pos, wrapping around."""
        if loop.size == 0:
            return np.zeros(n, dtype=np.float32)
        idx = (np.arange(pos, pos + n) % loop.size)
        return loop[idx]

    @staticmethod
    def _make_room_tone(sample_rate: int) -> np.ndarray:
        """~4 s of soft, low-passed noise: the hum/air of an occupied room.

        int16-scaled float. Low-passed (a simple one-pole) so it reads as warm
        air, not hiss, and gently amplitude-modulated so it is not a dead static
        loop. Scaled so that at ROOM_TONE_VOLUME it is just perceptible."""
        rng = np.random.default_rng(7)
        length = int(sample_rate * 4)
        white = rng.standard_normal(length).astype(np.float32)
        # Low-pass by cascaded moving-average (vectorized; no per-sample Python
        # loop, so call setup stays fast). A few cumulative-sum box filters
        # approximate a gentle one-pole and read as warm room air, not hiss.
        lp = white
        win = max(2, int(sample_rate * 0.004))  # ~4 ms box
        kernel = np.ones(win, dtype=np.float32) / win
        for _ in range(3):
            lp = np.convolve(lp, kernel, mode="same").astype(np.float32)
        lp = lp / (np.max(np.abs(lp)) + 1e-9)
        # Slow amplitude drift so the room "breathes".
        t = np.linspace(0, 2 * np.pi * 3, length, dtype=np.float32)
        drift = 0.85 + 0.15 * np.sin(t)
        tone = lp * drift
        # Make the loop seamless: crossfade the tail into the head.
        xf = int(sample_rate * 0.2)
        if xf > 0 and length > 2 * xf:
            fade = np.linspace(0, 1, xf, dtype=np.float32)
            tone[:xf] = tone[:xf] * fade + tone[-xf:] * (1 - fade)
            tone = tone[:-xf]
        return (tone * 32767.0).astype(np.float32)

    @staticmethod
    def _make_typing_loop(sample_rate: int) -> np.ndarray:
        """~3 s of sparse, irregular keyboard clicks (int16-scaled float).

        Each key is a very short noise burst with a fast decay; spacing is
        randomized so it sounds like real typing, not a metronome."""
        rng = np.random.default_rng(13)
        length = int(sample_rate * 3)
        buf = np.zeros(length, dtype=np.float32)
        click_len = max(1, int(sample_rate * 0.012))  # ~12 ms per key
        decay = np.exp(-np.linspace(0, 6, click_len)).astype(np.float32)
        pos = 0
        while pos < length - click_len:
            burst = rng.standard_normal(click_len).astype(np.float32) * decay
            # Slight per-key level variation.
            burst *= 0.6 + 0.4 * rng.random()
            buf[pos:pos + click_len] += burst
            # Irregular gap between keystrokes: ~90 to 240 ms.
            gap = int(sample_rate * (0.09 + 0.15 * rng.random()))
            pos += click_len + gap
        buf = buf / (np.max(np.abs(buf)) + 1e-9)
        return (buf * 32767.0).astype(np.float32)
