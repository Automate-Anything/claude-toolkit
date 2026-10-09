"""Render a film as short pieces, one per shot, and join them (the client).

Each shot of the edit list becomes its own small HyperFrames project and its own short render. A piece is rendered
again only when its part of the edit list (or the composition code) changed. The lock is taken per piece and
released between pieces, so other work on this computer can go in between. Then the pieces are joined and the mix
is laid under them.

  python render_pieces.py <edl.json> <mix.wav> <name>        e.g. edit/edl-story-v3.json out/story-v3-mix.wav story-v3
"""
import hashlib, io, json, os, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

W = vid.WORK
PROJ = os.path.join(W, "..", "hyperframes", "video-projects")
FF = os.path.join(vid.BIN, "ffmpeg.exe")
LOCK = "C:/path/to/a.lock"
PY = sys.executable


def log(msg):
    line = "%s %s" % (time.strftime("%H:%M:%S"), msg)
    print(line, flush=True)


def rebase(shot):
    s = json.loads(json.dumps(shot))
    t0 = s["at"]
    s["at"] = 0.0
    for key in ("bubble", "call"):
        v = s.get(key)
        if isinstance(v, dict):
            v = [v]
            s[key] = v
        for x in v or []:
            x["at"] = round(x["at"] - t0, 3)
    for key in ("wordmark", "book"):
        if s.get(key):
            s[key]["at"] = round(s[key]["at"] - t0, 3)
    return s


def take_lock():
    waited = 0
    while True:
        try:
            os.mkdir(LOCK)
            return
        except FileExistsError:
            if waited % 120 == 0:
                log("waiting for the lock")
            # check every second: with several agents queued, a ten-second poll never wins its turn
            time.sleep(1)
            waited += 1


def main(edl_path, mix, name):
    edl = json.load(open(edl_path, encoding="utf-8"))
    code = hashlib.sha256(open(os.path.join(vid.TOOLS, "compose.py"), "rb").read()).hexdigest()[:12]
    out_dir = os.path.join(W, "out", "pieces", name)
    os.makedirs(out_dir, exist_ok=True)
    env = dict(os.environ)
    env["PATH"] = vid.BIN + os.pathsep + env["PATH"]
    pieces = []
    for i, shot in enumerate(edl["shots"], 1):
        mini = {"note": "piece %d of %s" % (i, name), "fps": edl["fps"], "size": edl["size"], "shots": [rebase(shot)]}
        blob = json.dumps(mini, sort_keys=True)
        h = hashlib.sha256((blob + code).encode()).hexdigest()[:12]
        piece = os.path.join(out_dir, "p%02d-%s.mp4" % (i, shot["take"]))
        stamp = piece + ".hash"
        pieces.append(piece)
        if os.path.exists(piece) and os.path.exists(stamp) and open(stamp).read().strip() == h:
            log("piece %02d %-14s unchanged" % (i, shot["take"]))
            continue
        proj = os.path.join(PROJ, "piece-%s-%02d" % (name, i))
        os.makedirs(os.path.join(proj, "assets"), exist_ok=True)
        os.makedirs(os.path.join(proj, "fonts"), exist_ok=True)
        base = os.path.join(PROJ, os.environ.get("BASE_PROJECT", "film"))  # a project folder holding hyperframes.json, fonts/ and assets/gsap.min.js
        shutil.copyfile(os.path.join(base, "hyperframes.json"), os.path.join(proj, "hyperframes.json"))
        for f in os.listdir(os.path.join(base, "fonts")):
            shutil.copyfile(os.path.join(base, "fonts", f), os.path.join(proj, "fonts", f))
        shutil.copyfile(os.path.join(base, "assets", "gsap.min.js"), os.path.join(proj, "assets", "gsap.min.js"))
        mini_path = os.path.join(out_dir, "p%02d.json" % i)
        io.open(mini_path, "w", encoding="utf-8", newline="\n").write(json.dumps(mini, indent=1))
        e2 = dict(env, FILM_PROJECT="piece-%s-%02d" % (name, i))
        subprocess.run([PY, os.path.join(vid.TOOLS, "compose.py"), mini_path], env=e2, capture_output=True, text=True)
        take_lock()
        t0 = time.time()
        try:
            raw = os.path.join(proj, "renders", "piece.mp4")
            r = subprocess.run("npx hyperframes render --fps 24 --quality standard --workers 1 --output renders/piece.mp4", cwd=proj, env=env, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
        finally:
            try:
                os.rmdir(LOCK)
            except OSError:
                pass
        if not os.path.exists(raw):
            log("piece %02d FAILED: %s" % (i, (r.stdout + r.stderr)[-300:].replace("\n", " ")))
            return 1
        shutil.move(raw, piece)
        open(stamp, "w").write(h)
        log("piece %02d %-14s rendered in %d s (%.1f s of film)" % (i, shot["take"], time.time() - t0, shot["dur"]))
    # join: same encoder settings for every piece, so a re-encode keeps it simple and frame exact
    lst = os.path.join(out_dir, "list.txt")
    io.open(lst, "w", encoding="utf-8", newline="\n").write("".join("file '%s'\n" % p.replace("\\", "/") for p in pieces))
    silent = os.path.join(W, "out", name + "-picture.mp4")
    r = subprocess.run([FF, "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-an", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "24", silent], capture_output=True, text=True)
    if r.returncode:
        log("join FAILED " + r.stderr[-300:])
        return 1
    final = os.path.join(W, "out", name + ".mp4")
    r = subprocess.run([FF, "-v", "error", "-y", "-i", silent, "-i", mix, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final], capture_output=True, text=True)
    if r.returncode:
        log("mux FAILED " + r.stderr[-300:])
        return 1
    prev = os.path.join(W, "out", name + "-720p.mp4")
    subprocess.run([FF, "-v", "error", "-y", "-i", final, "-vf", "scale=1280:720", "-c:v", "libx264", "-crf", "23", "-preset", "fast", "-c:a", "copy", "-movflags", "+faststart", prev])
    dl = os.path.join(os.path.expanduser("~"), "Downloads")
    shutil.copyfile(final, os.path.join(dl, "film-v3-1080p.mp4"))
    shutil.copyfile(prev, os.path.join(dl, "film-v3-720p.mp4"))
    log("DONE %s (%d pieces) and copied to Downloads" % (final, len(pieces)))
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    sys.exit(main(os.path.join(W, a[0]) if not os.path.isabs(a[0]) else a[0], os.path.join(W, a[1]) if not os.path.isabs(a[1]) else a[1], a[2]))
