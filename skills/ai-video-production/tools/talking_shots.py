"""The couple's talking shots for the story film, version 3, made the way the client's notes require: her face is
animated alone (OmniHuman 1.5 with a mask over her side of the still), her husband is generated listening (Seedance
image-to-video from the same still, mouth closed, a smile, a nod), and for the two-shots the halves are composited
with a feathered split. His one line is made the same way with the mask on his side.

  python talking_shots.py plan        prints the shots, the cost line, nothing bought
  python talking_shots.py go          masks, uploads, submits everything, waits, composites -> prove/takes/S3-*.mp4
  python talking_shots.py composite   only the ffmpeg composites (after the takes are in)
"""
import json, os, struct, subprocess, sys, time, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

W = vid.WORK
FF = os.path.join(vid.BIN, "ffmpeg.exe")
FP = os.path.join(vid.BIN, "ffprobe.exe")
SMALL = os.path.join(W, "prove", "stills", "small")
TAKES = os.path.join(W, "prove", "takes")
PY = sys.executable

# where the split between her and him falls in each still (fraction of the width from the left), and which side is hers
SPLIT = {"COUPLE-A": (0.50, "left"), "COUPLE-WIDE": (0.50, "left"), "WOMAN-CU": (0.64, "left"), "WOMAN-PROFILE": (0.42, "right"), "WOMAN-END": (0.50, "left"), "MAN-CU": (0.30, "right")}

# the segments: audio file, the still, whether he needs his own listening take (the two-shots), his direction
PLAN = [
    ("S3-1", "line-v4/line-1", "WOMAN-CU", False, ""),
    ("S3-2", "line-v4/line-2", "COUPLE-A", True, "he listens with a fond smile, glances at the phone in her hand and back at her face, one slow nod"),
    ("S3-3", "line-v4/line-3", "WOMAN-PROFILE", False, ""),
    ("S3-4", "line-v4/line-4", "COUPLE-WIDE", True, "he listens, a small laugh with his shoulders at the end, a nod"),
    ("S3-5", "line-v4/line-5", "WOMAN-CU", False, ""),
    ("S3-6", "line-v4/line-6", "COUPLE-A", True, "he listens, raises his eyebrows once, amused, shakes his head slightly"),
    ("S3-7", "line-v4/line-7", "WOMAN-PROFILE", False, ""),
    ("S3-8", "line-v4/line-8", "WOMAN-END", True, "his head rests against hers, he pats her hand twice and keeps looking at the camera, moved"),
    ("S3-W", "man-lines/line-1", "MAN-CU", False, ""),
]
HER = "The woman talks to the camera, warm and amused, natural blinks and small head movement, small natural gestures with the phone; the camera holds still."
HIM = "The man talks to the camera, quiet, amused, shaking his head a little; the camera holds still."


def dur(path):
    r = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def size(path):
    r = subprocess.run([FP, "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], capture_output=True, text=True)
    w, h = r.stdout.strip().split("\n")[0].split(",")[:2]
    return int(w), int(h)


def png_mask(w, h, split, side, path, feather=80):
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    x0 = int(w * split)
    row = bytearray(w)
    for x in range(w):
        v = 255 if x < x0 - feather else (0 if x > x0 + feather else int(255 * (1 - (x - (x0 - feather)) / (2 * feather))))
        row[x] = v if side == "left" else 255 - v
    raw = b"".join(b"\x00" + bytes(row) for _ in range(h))
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    return path


def upload(path):
    r = subprocess.run([PY, os.path.join(vid.TOOLS, "fal.py"), "upload", path], capture_output=True, text=True)
    u = r.stdout.strip().split("\n")[-1]
    if not u.startswith("http"):
        raise SystemExit("upload failed: " + r.stdout[-300:])
    return u


def plan(buy):
    small = json.load(open(os.path.join(W, "receipts", "fal", "small-still-urls.json")))
    jobs_fal, jobs_hf, total_oh, total_sd = [], [], 0.0, 0.0
    masks = {}
    for name, audio, still, two, him in PLAN:
        a = os.path.join(W, "audio", audio + ".mp3")
        d = dur(a)
        split, side = SPLIT[still]
        speaker = "him" if name == "S3-W" else "her"
        mk = os.path.join(SMALL, "%s-mask-%s.png" % (still, speaker))
        if buy:
            w, h = size(os.path.join(SMALL, still + ".jpg"))
            png_mask(w, h, split, side, mk)
            masks[mk] = upload(mk)
            audio_url = upload(a)
        jobs_fal.append({"name": name, "endpoint": "fal-ai/bytedance/omnihuman/v1.5", "payload": {"image_url": small[still], "audio_url": audio_url if buy else "(audio)", "mask_url": masks.get(mk, "(mask)"), "resolution": "720p", "prompt": HIM if speaker == "him" else HER, "_seconds": round(d, 2)}})
        total_oh += d * 0.16
        if two:
            sd = max(4, min(30, int(d + 0.99)))
            jobs_hf.append({"name": name + "-HIM", "slug": "bytedance/seedance-2.5/image-to-video", "payload": {"image_url": small[still], "duration": sd, "resolution": "720p", "generate_audio": False,
                            "prompt": "Photoreal live-action, the camera locked off and perfectly still, the same light and room as the start frame, real skin texture, natural colour, no on-screen text. The shot begins on the start frame and continues from it without any cut. The woman stays almost still. The man: " + him + "; his mouth stays closed, he never speaks. No subtitles, no captions, no logos. Nobody speaks."}})
            total_sd += sd * 0.4622
    print("%d talking takes (about $%.2f on fal), %d listening takes (about $%.2f on Higgsfield)" % (len(jobs_fal), total_oh, len(jobs_hf), total_sd))
    return jobs_fal, jobs_hf


def go():
    jobs_fal, jobs_hf = plan(True)
    vid.save_json(os.path.join(W, "prove", "prompts", "story10-talk-v3.json"), jobs_fal)
    vid.save_json(os.path.join(W, "prove", "prompts", "story11-listen-v3.json"), jobs_hf)
    env = dict(os.environ, VIDEO_DAY_CAP="200")
    subprocess.run([PY, os.path.join(vid.TOOLS, "fal.py"), "batch", os.path.join(W, "prove", "prompts", "story10-talk-v3.json"), "--cap", "4.00"], env=env)
    subprocess.run([PY, os.path.join(vid.TOOLS, "higgsfield.py"), "batch", os.path.join(W, "prove", "prompts", "story11-listen-v3.json"), "--cap", "8.00"], env=env)
    subprocess.run([PY, os.path.join(vid.TOOLS, "fal.py"), "wait"] + [j["name"] for j in jobs_fal] + ["--minutes", "14", "--out", TAKES], env=env)
    subprocess.run([PY, os.path.join(vid.TOOLS, "higgsfield.py"), "wait"] + [j["name"] for j in jobs_hf] + ["--minutes", "14", "--out", TAKES], env=env)
    composite()


def composite():
    """For the two-shots: his side from the listening take, her side from the talking take, a feathered split."""
    for name, audio, still, two, him in PLAN:
        if not two:
            continue
        her = os.path.join(TAKES, name + ".mp4")
        his = os.path.join(TAKES, name + "-HIM.mp4")
        if not (os.path.exists(her) and os.path.exists(his)):
            print("missing for", name)
            continue
        split, side = SPLIT[still]
        mask = os.path.join(SMALL, "%s-mask-her.png" % still)
        if not os.path.exists(mask):
            w, h = size(os.path.join(SMALL, still + ".jpg"))
            png_mask(w, h, split, side, mask)
        d = dur(her)
        out = os.path.join(TAKES, name + "-C.mp4")
        fc = "[0:v]scale=1280:720,fps=24,format=gbrp[him];[1:v]scale=1280:720,fps=24,format=gbrp[her];[2:v]scale=1280:720,format=gray[m];[him][her][m]maskedmerge,format=yuv420p[v]"
        r = subprocess.run([FF, "-v", "error", "-y", "-stream_loop", "-1", "-i", his, "-i", her, "-loop", "1", "-i", mask, "-filter_complex", fc, "-map", "[v]", "-map", "1:a", "-t", str(d), "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-shortest", out], capture_output=True, text=True)
        print(name, "->", os.path.basename(out) if not r.returncode else r.stderr[-300:])


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "go":
        go()
    elif a and a[0] == "composite":
        composite()
    else:
        plan(False)
