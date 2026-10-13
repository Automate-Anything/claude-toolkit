# voice-rt: self-hosted Pipecat voice runtime. One process, many calls, each
# call on its own asyncio task inside a single uvicorn worker (Pipecat 1.x
# pipelines are asyncio-native; the GIL is not the bottleneck for I/O-bound
# STT/LLM/TTS calls, and Smart Turn v3 + Silero run on CPU via onnxruntime).
# Scale horizontally by adding Render instances; SignalWire streams each call
# to whichever instance answered the cXML fetch (the session context lives in
# app-server, not in this process, so any instance can serve any call).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# ffmpeg is not required (no local audio codecs beyond mu-law, handled by the
# serializer); keep the image small.
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Warm the Smart Turn v3 + Silero ONNX models into the image so the first call
# on a fresh instance does not pay a model download.
RUN python -c "from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3; LocalSmartTurnAnalyzerV3()" \
 && python -c "from pipecat.audio.vad.silero import SileroVADAnalyzer; SileroVADAnalyzer()"

COPY src/ ./src/

EXPOSE 8000

# --ws-per-message-deflate off: compressing 20ms mu-law frames only adds latency.
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--ws-per-message-deflate", "false", "--timeout-keep-alive", "75"]
