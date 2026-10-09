"""Instruments for reading a take: contact sheet, duration, audio presence, loudness, speech transcript.

  python review.py <take.mp4> [--cols 6 --rows 2]
Writes <name>-sheet.jpg beside the review folder and prints ffprobe facts. Transcription (ElevenLabs Scribe) with --words.
"""
import io, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

FF = os.path.join(vid.BIN, "ffmpeg.exe")
FP = os.path.join(vid.BIN, "ffprobe.exe")


def probe(path):
    r = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,nb_frames", "-of", "json", path], capture_output=True, text=True)
    j = json.loads(r.stdout)
    v = next((s for s in j["streams"] if s["codec_type"] == "video"), {})
    a = [s for s in j["streams"] if s["codec_type"] == "audio"]
    return {"seconds": round(float(j["format"]["duration"]), 2), "w": v.get("width"), "h": v.get("height"), "fps": v.get("r_frame_rate"), "frames": v.get("nb_frames"), "audio": bool(a)}


def loudness(path):
    r = subprocess.run([FF, "-v", "info", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    ms = re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr); m = ms[-1] if ms else None
    ps = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", r.stderr); p = ps[-1] if ps else None
    return (m, p)


def sheet(path, out, cols=6, rows=2):
    info = probe(path)
    n = cols * rows
    every = max(1, int(info["frames"] or 1) // n)
    subprocess.run([FF, "-v", "error", "-y", "-i", path, "-vf", "select='not(mod(n\\,%d))',scale=426:-1,tile=%dx%d" % (every, cols, rows), "-frames:v", "1", out], check=False)
    return out


def transcribe(path):
    key = vid._E.get("ELEVENLABS_API_KEY")
    wav = path + ".wav"
    subprocess.run([FF, "-v", "error", "-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000", wav], check=False)
    r = subprocess.run(["curl", "-sS", "-m", "120", "https://api.elevenlabs.io/v1/speech-to-text", "-H", "xi-api-key: " + key, "-F", "model_id=scribe_v2", "-F", "file=@" + wav, "-F", "tag_audio_events=true"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    try:
        j = json.loads(r.stdout)
        os.remove(wav)
        return j.get("text", ""), [(w.get("text"), w.get("start"), w.get("end")) for w in j.get("words", []) if w.get("type") == "word"]
    except Exception:
        return r.stdout[:200], []


if __name__ == "__main__":
    a = sys.argv[1:]
    words = "--words" in a
    paths = [x for x in a if not x.startswith("--")]
    for p in paths:
        name = os.path.splitext(os.path.basename(p))[0]
        info = probe(p)
        lu = loudness(p) if info["audio"] else (None, None)
        out = os.path.join(vid.WORK, "prove", "review", name + "-sheet.jpg")
        sheet(p, out)
        line = "%s: %.2f s, %sx%s, %s frames, audio %s, %s LUFS, peak %s dBFS -> %s" % (name, info["seconds"], info["w"], info["h"], info["frames"], "yes" if info["audio"] else "NO", lu[0], lu[1], os.path.relpath(out, vid.WORK))
        if words and info["audio"]:
            text, ws = transcribe(p)
            line += "\n   heard: %s" % text.strip()
            if ws:
                line += "\n   words: " + " ".join("%s@%.2f" % (w, s) for w, s, e in ws)
        print(line)
