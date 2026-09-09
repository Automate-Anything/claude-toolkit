#!/usr/bin/env python3
"""
media_review.py - turn any AUDIO or VIDEO file into agent-reviewable artifacts:
  1. transcript.txt      - faster-whisper transcription with [mm:ss] timestamps
  2. frames/NNN.jpg      - ONLY scene-change frames (not every frame), capped +
                           downscaled, so an agent can Read them without burning
                           tokens. First frame always included.

Local + free: faster-whisper (CPU int8) + ffmpeg. No OpenAI, no app infra.

Usage:
  py scripts/media_review.py <media-file> [--out DIR] [--model small|base|medium]
                             [--scene 0.3] [--max-frames 20] [--width 1280]
                             [--no-frames] [--no-audio] [--language en]

Output dir defaults to <media-dir>/<stem>_review. Prints every artifact path.
"""
import argparse
import os
import subprocess
import sys


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def fmt_ts(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def has_stream(path: str, kind: str) -> bool:
    """kind = 'audio' | 'video'. Uses ffprobe (ships with ffmpeg)."""
    p = run([
        "ffprobe", "-v", "error", "-select_streams", kind[0] + ":0",
        "-show_entries", "stream=codec_type", "-of", "csv=p=0", path,
    ])
    return kind in (p.stdout or "")


def extract_frames(path: str, out_dir: str, scene: float, max_frames: int, width: int) -> list[str]:
    frames_dir = os.path.join(out_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)
    # Scene-change frames only: 'gt(scene,T)' emits a frame when the picture
    # changes by more than T (0..1). eq(n,0) always keeps the first frame so a
    # video that never changes still yields one image. -frames:v caps output.
    sel = f"select='eq(n\\,0)+gt(scene\\,{scene})'"
    vf = f"{sel},scale='min({width},iw)':-2"
    pattern = os.path.join(frames_dir, "%03d.jpg")
    p = run([
        "ffmpeg", "-y", "-v", "error", "-i", path,
        "-vf", vf, "-fps_mode", "vfr", "-frames:v", str(max_frames),
        "-q:v", "4", pattern,
    ])
    if p.returncode != 0:
        print(f"frame extraction failed: {p.stderr.strip()[:400]}", file=sys.stderr)
        return []
    return sorted(
        os.path.join(frames_dir, f) for f in os.listdir(frames_dir) if f.endswith(".jpg")
    )


def transcribe(path: str, out_dir: str, model_name: str, language: str | None) -> str | None:
    # Whisper handles containers directly, but extracting to 16k mono wav first is
    # faster + more reliable for videos.
    wav = os.path.join(out_dir, "_audio16k.wav")
    p = run(["ffmpeg", "-y", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", wav])
    if p.returncode != 0 or not os.path.exists(wav):
        print(f"audio extraction failed: {p.stderr.strip()[:400]}", file=sys.stderr)
        return None
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(wav, language=language, vad_filter=True)
    lines = [f"# language={info.language} (p={info.language_probability:.2f}) model={model_name}"]
    for seg in segments:
        text = seg.text.strip()
        if text:
            lines.append(f"[{fmt_ts(seg.start)}] {text}")
    os.remove(wav)
    out = os.path.join(out_dir, "transcript.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("media")
    ap.add_argument("--out")
    ap.add_argument("--model", default="small")
    ap.add_argument("--scene", type=float, default=0.3)
    ap.add_argument("--max-frames", type=int, default=20)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--no-frames", action="store_true")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--language", default=None, help="e.g. en; omit = auto-detect")
    args = ap.parse_args()

    media = os.path.abspath(args.media)
    if not os.path.exists(media):
        print(f"not found: {media}", file=sys.stderr)
        return 1
    stem = os.path.splitext(os.path.basename(media))[0]
    out_dir = os.path.abspath(args.out) if args.out else os.path.join(os.path.dirname(media), f"{stem}_review")
    os.makedirs(out_dir, exist_ok=True)

    print(f"media: {media}")
    print(f"out:   {out_dir}")

    if not args.no_audio and has_stream(media, "audio"):
        t = transcribe(media, out_dir, args.model, args.language)
        if t:
            print(f"transcript: {t}")
            with open(t, encoding="utf-8") as f:
                preview = f.read()
            print("--- transcript preview (first 1200 chars) ---")
            print(preview[:1200])
    else:
        print("audio: none (or skipped)")

    if not args.no_frames and has_stream(media, "video"):
        frames = extract_frames(media, out_dir, args.scene, args.max_frames, args.width)
        print(f"frames: {len(frames)} scene-change frame(s)")
        for fr in frames:
            print(f"  {fr}")
        if len(frames) >= args.max_frames:
            print(f"  (hit --max-frames cap {args.max_frames}; raise it or lower --scene if pages are missing)")
    else:
        print("video: none (or skipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
