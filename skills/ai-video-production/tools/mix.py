"""The film's sound from an edit list, one voice at a time: the takes' own sound in sequence, the call voices at their
times, the music from the moment the hold begins; the takes' sound and the music DUCK under every voice
(sidechain), the lines never overlap (checked, and shifted with a gap if they would), then loudness to -14 LUFS.

  python mix.py edit/edl-v2.json out/film-v3.wav [--music audio/music/hold-grown.mp3] [--music-at 15]
  python mix.py --mux <video.mp4> <mix.wav> <out.mp4>
"""
import io, json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

FF = os.path.join(vid.BIN, "ffmpeg.exe")
FP = os.path.join(vid.BIN, "ffprobe.exe")
TAKES = os.path.join(vid.WORK, "prove", "takes")
AUDIO = os.path.join(vid.WORK, "audio")


def dur(path):
    r = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def build(edl_path, out, music, music_at):
    edl = json.load(open(edl_path, encoding="utf-8"))
    inputs, fc, alabels = [], [], []
    i = 0
    for s in edl["shots"]:
        d = s["dur"]
        # a shot may borrow its sound from another take (a reaction shot under a line that continues)
        src = s.get("audio") or {"take": s["take"], "in": s["in"]}
        p = os.path.join(TAKES, src["take"] + ".mp4")
        if s["take"] in ("burst", "CARD") or not os.path.exists(p):
            inputs += ["-f", "lavfi", "-t", str(d), "-i", "anullsrc=r=48000:cl=stereo"]
            fc.append("[%d:a]asetpts=PTS-STARTPTS[a%d]" % (i, i))
        else:
            inputs += ["-ss", str(src["in"]), "-t", str(d), "-i", p]
            fc.append("[%d:a]aresample=48000,asetpts=PTS-STARTPTS,apad=whole_dur=%s,atrim=0:%s[a%d]" % (i, d, d, i))
        alabels.append("[a%d]" % i)
        i += 1
    fc.append("".join(alabels) + "concat=n=%d:v=0:a=1[bed]" % len(alabels))
    # the voices, sequenced: never two at once
    cues = []
    for s in edl["shots"]:
        for c in s.get("call", []):
            fn = os.path.join(AUDIO, c["audio"].replace("/", os.sep) + ".mp3")
            if os.path.exists(fn):
                cues.append([c["at"], min(dur(fn), c.get("len") or 999), fn, c])
    cues.sort(key=lambda x: x[0])
    last_end = -1
    for cue in cues:
        if cue[0] < last_end + 0.25:
            print("  shifted %-22s %.2f -> %.2f (would have overlapped)" % (os.path.basename(cue[2]), cue[0], last_end + 0.25))
            cue[0] = round(last_end + 0.25, 2)
            cue[3]["at"] = cue[0]
        last_end = cue[0] + cue[1]
    vl = []
    for k, (at, ln, fn, c) in enumerate(cues):
        inputs += ["-t", str(ln), "-i", fn]
        # a cut line gets a short fade so it does not click
        fc.append("[%d:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=out:st=%s:d=0.12,adelay=%d|%d,volume=1.4[v%d]" % (i, round(ln - 0.12, 3), int(at * 1000), int(at * 1000), k))
        vl.append("[v%d]" % k)
        i += 1
    total = sum(s["dur"] for s in edl["shots"])
    if vl:
        fc.append("".join(vl) + "amix=inputs=%d:normalize=0:dropout_transition=0,apad=whole_dur=%s[voices]" % (len(vl), total))
    else:
        inputs += ["-f", "lavfi", "-t", str(total), "-i", "anullsrc=r=48000:cl=stereo"]
        fc.append("[%d:a]anull[voices]" % i)
        i += 1
    fc.append("[voices]asplit=3[vo][sc1][sc2]")
    # the bed ducks under the voices; the music too
    fc.append("[bed][sc1]sidechaincompress=threshold=0.02:ratio=8:attack=40:release=500:makeup=1[bedd]")
    if music and os.path.exists(music):
        inputs += ["-i", music]
        fc.append("[%d:a]aresample=48000,aformat=channel_layouts=stereo,adelay=%d|%d,volume=0.30,apad=whole_dur=%s[mus]" % (i, int(music_at * 1000), int(music_at * 1000), total))
        i += 1
        fc.append("[mus][sc2]sidechaincompress=threshold=0.02:ratio=6:attack=60:release=700:makeup=1[musd]")
        fc.append("[bedd][musd][vo]amix=inputs=3:normalize=0:dropout_transition=0[mixed]")
    else:
        fc.append("[sc2]anullsink")
        fc.append("[bedd][vo]amix=inputs=2:normalize=0:dropout_transition=0[mixed]")
    fc.append("[mixed]loudnorm=I=-14:TP=-1.0:LRA=11[aout]")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    script = out + ".filter.txt"
    io.open(script, "w", encoding="utf-8", newline="\n").write(";\n".join(fc))
    cmd = [FF, "-v", "error", "-y"] + inputs + ["-/filter_complex", script, "-map", "[aout]", "-t", str(total), "-c:a", "pcm_s16le", out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-1200:])
        return 1
    # write the sequenced times back so the bubbles match the sound
    io.open(edl_path, "w", encoding="utf-8", newline="\n").write(json.dumps(edl, indent=1))
    print("wrote %s (%.1f s), %d voice cues, none overlapping" % (out, dur(out), len(cues)))
    return 0


def mux(video, wav, out):
    r = subprocess.run([FF, "-v", "error", "-y", "-i", video, "-i", wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out], capture_output=True, text=True)
    print(r.stderr[-400:] if r.returncode else "wrote %s (%.1f s)" % (out, dur(out)))
    return r.returncode


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "--mux":
        sys.exit(mux(a[1], a[2], a[3]))
    music = a[a.index("--music") + 1] if "--music" in a else None
    music_at = float(a[a.index("--music-at") + 1]) if "--music-at" in a else 15.0
    sys.exit(build(a[0], a[1], music, music_at))
