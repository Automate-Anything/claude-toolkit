"""Rough cut from an edit list: picture from the takes, the takes' own sound, the call voices laid at their times,
the music under everything, plain captions for the words on screen (the designed layer comes later in HyperFrames).

  python roughcut.py edit/edl-v1.json out/rough-v1.mp4 [--music audio/music/hold-grown.mp3] [--no-captions]
"""
import io, json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

FF = os.path.join(vid.BIN, "ffmpeg.exe")
FP = os.path.join(vid.BIN, "ffprobe.exe")
TAKES = os.path.join(vid.WORK, "prove", "takes")
AUDIO = os.path.join(vid.WORK, "audio")
FONT = os.path.join(vid.WORK, "fonts", "text.ttf").replace("\\", "/").replace(":", "\\:")
DISPLAY = os.path.join(vid.WORK, "fonts", "display.ttf").replace("\\", "/").replace(":", "\\:")


def dur(path):
    r = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def esc(s):
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "'").replace("%", "\\%")


def build(edl_path, out, music=None, captions=True):
    edl = json.load(open(edl_path, encoding="utf-8"))
    W, H = edl["size"]
    fps = edl["fps"]
    segs, missing = [], []
    for s in edl["shots"]:
        t = s["take"]
        if t in ("burst", "CARD"):
            segs.append(("color", s))
            continue
        p = os.path.join(TAKES, t + ".mp4")
        if not os.path.exists(p):
            missing.append(t)
            segs.append(("color", s))
        else:
            segs.append(("take", s))
    inputs, fc, vlabels, alabels = [], [], [], []
    for i, (kind, s) in enumerate(segs):
        d = s["dur"]
        if kind == "take":
            p = os.path.join(TAKES, s["take"] + ".mp4")
            vi = _count(inputs)
            inputs += ["-ss", str(s["in"]), "-t", str(d), "-i", p]
            fc.append("[%d:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,fps=%d,setpts=PTS-STARTPTS[v%d]" % (vi, W, H, W, H, fps, i))
            fc.append("[%d:a]aresample=48000,asetpts=PTS-STARTPTS,apad=whole_dur=%s,atrim=0:%s[a%d]" % (vi, d, d, i))
        else:
            col = "0xF4F4F4" if s["take"] == "CARD" else "0x0A0A0A"
            vi = _count(inputs)
            inputs += ["-f", "lavfi", "-t", str(d), "-i", "color=c=%s:s=%dx%d:r=%d" % (col, W, H, fps), "-f", "lavfi", "-t", str(d), "-i", "anullsrc=r=48000:cl=stereo"]
            fc.append("[%d:v]setpts=PTS-STARTPTS[v%d]" % (vi, i))
            fc.append("[%d:a]asetpts=PTS-STARTPTS[a%d]" % (vi + 1, i))
        vlabels.append("[v%d]" % i)
        alabels.append("[a%d]" % i)
    n = len(segs)
    fc.append("".join(vlabels) + "concat=n=%d:v=1:a=0[vcat]" % n)
    fc.append("".join(alabels) + "concat=n=%d:v=0:a=1[acat]" % n)
    # captions and the wordmark stand-in
    draw = []
    if captions:
        for s in edl["shots"]:
            bubbles = s.get("bubble")
            if isinstance(bubbles, dict):
                bubbles = [bubbles]
            for b in bubbles or []:
                txt = b.get("text", "")
                col = "white@0.55" if b.get("kind") == "nobody" else ("white" if b.get("kind") == "sent" else "0xF2F2F2")
                box = "box=1:boxcolor=black@0.35:boxborderw=18" if b.get("kind") != "nobody" else "box=0"
                x = "w-tw-90" if b.get("kind") == "reply" else "90"
                y = "h-140"
                draw.append("drawtext=fontfile='%s':text='%s':fontsize=44:fontcolor=%s:%s:x=%s:y=%s:enable='between(t,%s,%s)'" % (FONT, esc(txt), col, box, x, y, b["at"], b["at"] + 3.2))
            for c in s.get("call", []):
                draw.append("drawtext=fontfile='%s':text='%s':fontsize=40:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=16:x=(w-tw)/2:y=h-110:enable='between(t,%s,%s)'" % (FONT, esc(c["who"].upper() + ": " + c["text"]), c["at"], c["at"] + 3.0))
            wm = s.get("wordmark")
            if wm:
                draw.append("drawtext=fontfile='%s':text='the brand':fontsize=260:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:enable='between(t,%s,%s)'" % (DISPLAY, wm["at"], wm["at"] + wm["dur"]))
            if s["take"] == "CARD":
                for k, (line, size) in enumerate([("the brand", 200), ("Say it. It's done.", 56), ("One line under the tagline.", 40), ("example.com", 40), ("The people in this film are generated. What the product does is real.", 24)]):
                    y = 260 + k * 110 if k else 180
                    draw.append("drawtext=fontfile='%s':text='%s':fontsize=%d:fontcolor=0x0A0A0A:x=(w-tw)/2:y=%d:enable='between(t,%s,%s)'" % (DISPLAY if k < 2 else FONT, esc(line), size, y + (0 if k == 0 else 80), s["at"] + (0.4 * k), s["at"] + s["dur"]))
    vchain = "[vcat]" + (",".join(draw) if draw else "null") + "[vout]"
    fc.append(vchain)
    # the call voices and the music
    extra_in, amix = [], ["[acat]"]
    base_idx = _count(inputs)
    k = 0
    for s in edl["shots"]:
        for c in s.get("call", []):
            fn = os.path.join(AUDIO, c["audio"] + ".mp3")
            if not os.path.exists(fn):
                missing.append(c["audio"])
                continue
            extra_in += ["-i", fn]
            fc.append("[%d:a]aresample=48000,adelay=%d|%d,volume=1.6[c%d]" % (base_idx + k, int(c["at"] * 1000), int(c["at"] * 1000), k))
            amix.append("[c%d]" % k)
            k += 1
    if music and os.path.exists(music):
        extra_in += ["-i", music]
        fc.append("[%d:a]aresample=48000,adelay=%d|%d,volume=0.22[mus]" % (base_idx + k, 15000, 15000))
        amix.append("[mus]")
        k += 1
    fc.append("".join(amix) + "amix=inputs=%d:normalize=0:dropout_transition=0,alimiter=limit=0.9[aout]" % len(amix))
    total = sum(s["dur"] for s in edl["shots"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    script = out + ".filter.txt"
    io.open(script, "w", encoding="utf-8", newline="\n").write(";\n".join(fc))
    cmd = [FF, "-v", "error", "-y"] + inputs + extra_in + ["-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]", "-t", str(total), "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    print("missing (black or silent stand-ins used):", sorted(set(missing)) or "none")
    print(r.stderr[-1500:] if r.returncode else "wrote %s (%.1f s)" % (out, dur(out)))
    return r.returncode


def _count(inputs):
    return sum(1 for x in inputs if x == "-i")


if __name__ == "__main__":
    a = sys.argv[1:]
    music = a[a.index("--music") + 1] if "--music" in a else None
    sys.exit(build(a[0], a[1], music, "--no-captions" not in a))
