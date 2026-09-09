---
name: media-review
description: How to process a VIDEO or AUDIO file someone provides (a WhatsApp voice note, a screen-recording of a bug, a walkthrough clip, a support-ticket attachment). Transcribes speech locally and extracts only the MEANINGFULLY DIFFERENT frames, so you get the full content without burning tokens on every frame. Use when the user drops a video/audio path, says "watch this", "listen to this", "they sent me a video/voice note", or a request carries a media attachment.
---

# Media Review: process videos and audios without burning tokens

This skill bundles a self-contained tool: **`media_review.py`** (next to this file). It runs
locally, with no external API and no cost, and does two things:

1. **Transcribes the audio** with faster-whisper (CPU int8, `small` model by default) into a
   timestamped transcript.
2. **Extracts only scene-change frames** with ffmpeg (`select='eq(n,0)+gt(scene,T)'`), so a
   1-minute screen recording yields a handful of distinct screenshots instead of ~1,800 frames.

> ⛔ THE RULE THIS TOOL EXISTS FOR: never dump a video into frame-by-frame Reads. That burns a
> huge number of tokens on near-identical frames. Run the tool, Read the transcript, and Read
> only the extracted frames (they are already capped and downscaled).

## Prerequisites (install once per machine)

The script shells out to `ffmpeg` and imports `faster-whisper`:

```bash
pip install faster-whisper
# ffmpeg must be on PATH: winget install Gyan.FFmpeg  (Windows) /
#   brew install ffmpeg (macOS) / apt install ffmpeg (Linux)
```

The first run downloads the whisper model once (cached afterward), so expect a slower first run.

## How to run

```bash
py "<path-to-this-skill>/media_review.py" "<path-to-media-file>" [flags]
```

| Flag | Default | When to change it |
|---|---|---|
| `--out DIR` | `<stem>_review/` next to the input | keep outputs in a scratchpad when the input lives there |
| `--model` | `small` | `medium` for hard accents/noisy audio (slower); `base` for a quick pass |
| `--scene` | `0.3` | LOWER (e.g. `0.15`) when a screen recording changes subtly and you got too few frames; HIGHER (e.g. `0.45`) when you got near-duplicates |
| `--max-frames` | `20` | rarely change; it is the token-budget cap |
| `--width` | `1280` | already fine for reading UI text |
| `--no-frames` | off | audio files / voice notes (no video track) |
| `--no-audio` | off | silent screen recordings |
| `--language en` | auto-detect | pass `en` when auto-detect misfires on short clips |

Outputs land in the out dir:
- `transcript.txt` - timestamped lines, header shows detected language + model.
- `frames/NNN.jpg` - the distinct frames, chronological.

## The workflow

1. Run the tool on the file (both audio + frames for a normal video).
2. `Read` `transcript.txt` first - the words usually carry most of the meaning.
3. `Read` the frames (they are images; the Read tool renders them). For a long list, read the
   first/last plus any the transcript timestamps point at.
4. Extract the actionable content (feedback items, bug repro steps, the screen shown) into your
   working notes / tracker. The transcript is verbatim data; quote it when the exact wording
   matters (a person's reply, a customer complaint).

## Where media shows up

- **Relayed chat media** (a customer's feedback video or voice note forwarded to you): process
  as above, then log the extracted items wherever you track work.
- **Support attachments** (a video uploaded through a help/ticket channel): download the
  attachment locally first, then run this tool on it; treat the transcript as the customer's own
  words.
- **Bug evidence** referenced from an error report or alert: frames give you the exact screen
  state; pair them with the report's metadata (route, console errors) to reproduce.

## Gotchas (each cost real time once)

- **ffmpeg 9 removed `-vsync`** - the script already uses `-fps_mode vfr`. If you ever call
  ffmpeg yourself, do the same.
- **Windows cp1252 console** - the script reconfigures stdout to UTF-8; if you print transcript
  text from your own Python, do `sys.stdout.reconfigure(encoding='utf-8')` first.
- **Short/quiet clips can misdetect the language** - re-run with `--language en` (or the right
  code) if the transcript is gibberish.
- **First run downloads the whisper model** (one-time, cached); expect a slower first run.
- **Audio-only files**: pass `--no-frames`, or ffmpeg errors on the missing video stream.
