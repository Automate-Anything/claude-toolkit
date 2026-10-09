"""The thread: the type-only film (SCRIPT.md, the last section). Black type on the light ground, no camera.
What a person sends sits to the right; what the assistant sends, to the left; the assistant's first word fills the screen for a beat.
Writes hyperframes/video-projects/type-only/index.html. the assistant's replies are drafts until the real ones are saved.

  python type_only_film.py [--size 1080x1920]
"""
import io, json, os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

LINES = [
    ("me", "answer my phone while I work"),
    ("assistant", "Done.", "I'll pick up as Example Landscaping."),
    ("me", "call the insurance about my claim"),
    ("assistant", "Calling.", "I'll wait on hold. You don't have to."),
    ("me", "pay the electric, every month"),
    ("assistant", "Paid.", "$84, confirmation 8H2K."),
    ("assistant", None, "This one is twice the usual. I have not paid it. Pay it?"),
    ("me", "no. call them."),
    ("me", "forget what I said about my sister"),
    ("assistant", "Forgotten.", None),
    ("assistant", None, "Your Friday flight moved to 6:10. I updated your calendar."),
]


def build(size):
    W, H = size
    proj = os.path.join(vid.WORK, "..", "hyperframes", "video-projects", "type-only" + ("-v" if H > W else ""))
    os.makedirs(os.path.join(proj, "assets"), exist_ok=True)
    os.makedirs(os.path.join(proj, "fonts"), exist_ok=True)
    for f in ("display.ttf", "text.ttf"):
        shutil.copyfile(os.path.join(vid.WORK, "fonts", f), os.path.join(proj, "fonts", f))
    shutil.copyfile(os.path.join(vid.WORK, "..", "hyperframes", "node_modules", "gsap", "dist", "gsap.min.js"), os.path.join(proj, "assets", "gsap.min.js"))
    els, tl = [], []
    t = 0.6
    gap = 2.2
    for i, ln in enumerate(LINES):
        who = ln[0]
        hold = gap if i < 6 else gap * 0.8  # faster each time
        if who == "me":
            els.append('<div id="l%d" class="clip me" data-start="%s" data-duration="%s" data-track-index="%d">%s</div>' % (i, round(t, 2), round(hold, 2), i, ln[1]))
            # typed on: reveal by clip-path over 0.5 s, then a beat, then leaves upward with the send
            tl.append('tl.from("#l%d", {clipPath: "inset(0 100%% 0 0)", duration: %s, ease: "none"}, %s);' % (i, round(min(0.9, 0.05 * len(ln[1])), 2), round(t, 2)))
            tl.append('tl.to("#l%d", {y: -60, opacity: 0, duration: 0.3, ease: "power2.in"}, %s);' % (i, round(t + hold - 0.3, 2)))
            tl.append('tl.set("#l%d", {opacity: 0}, %s);' % (i, round(t + hold, 2)))
        else:
            first, rest = ln[1], ln[2]
            if first:
                els.append('<div id="f%d" class="clip first" data-start="%s" data-duration="1.0" data-track-index="%d">%s</div>' % (i, round(t, 2), 50 + i, first))
                tl.append('tl.from("#f%d", {opacity: 0, scale: 0.96, duration: 0.25, ease: "power2.out"}, %s);' % (i, round(t, 2)))
                tl.append('tl.to("#f%d", {opacity: 0, duration: 0.3, ease: "power2.in"}, %s);' % (i, round(t + 0.7, 2)))
                tl.append('tl.set("#f%d", {opacity: 0}, %s);' % (i, round(t + 1.0, 2)))
            if rest:
                st = t + (0.9 if first else 0.0)
                els.append('<div id="r%d" class="clip assistant" data-start="%s" data-duration="%s" data-track-index="%d">%s</div>' % (i, round(st, 2), round(hold - (0.9 if first else 0), 2), 100 + i, rest))
                tl.append('tl.from("#r%d", {opacity: 0, y: 14, duration: 0.4, ease: "power2.out"}, %s);' % (i, round(st, 2)))
                tl.append('tl.to("#r%d", {opacity: 0, duration: 0.35, ease: "power2.in"}, %s);' % (i, round(t + hold - 0.35, 2)))
                tl.append('tl.set("#r%d", {opacity: 0}, %s);' % (i, round(t + hold, 2)))
        t += hold
    card_at = round(t + 0.4, 2)
    total = round(card_at + 7.0, 2)
    els.append('<div id="card" class="clip card" data-start="%s" data-duration="7" data-track-index="200"><div class="card-in"><div class="mark">%(mark)s</div><div class="tag">Your tagline here.</div><div class="addr">example.com</div></div></div>' % card_at)
    for k, sel in enumerate((".mark", ".tag", ".addr")):
        tl.append('tl.from("#card %s", {opacity: 0, y: 10, duration: 0.5, ease: "power2.out"}, %s);' % (sel, round(card_at + 0.3 + 0.45 * k, 2)))
    fs = 72 if W > H else 64
    html = """<!doctype html>
<html><head><meta charset="utf-8"><title>the assistant: the thread</title>
<style>
@font-face { font-family: "UriDisplay"; src: url("fonts/display.ttf"); font-style: italic; font-weight: 500; }
@font-face { font-family: "UriText"; src: url("fonts/text.ttf"); font-weight: 200 800; }
html, body { margin: 0; background: #F2F2F2; }
[data-composition-id="thread"] { position: relative; width: %dpx; height: %dpx; overflow: hidden; background: linear-gradient(165deg, #FFFFFF 0%%, #E9E9E9 100%%); font-family: "UriText"; color: #0A0A0A; }
.clip { position: absolute; }
.me, .assistant { top: 50%%; transform: translateY(-50%%); font-size: %dpx; line-height: 1.2; letter-spacing: -0.015em; max-width: %dpx; font-variant-numeric: tabular-nums; }
.me { right: %dpx; text-align: right; font-weight: 500; }
.assistant { left: %dpx; text-align: left; font-weight: 400; color: #333333; }
.first { inset: 0; display: flex; align-items: center; justify-content: center; font-family: "UriDisplay"; font-style: italic; font-weight: 500; font-size: %dpx; }
.card { inset: 0; }
.card-in { width: 100%%; height: 100%%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; box-sizing: border-box; padding: 120px; }
.card .mark { font-family: "UriDisplay"; font-style: italic; font-weight: 500; font-size: %dpx; line-height: 0.9; margin-bottom: 26px; }
.card .tag { font-family: "UriDisplay"; font-style: italic; font-weight: 500; font-size: %dpx; }
.card .addr { font-size: 30px; margin-top: 30px; }
</style></head>
<body>
<div id="root" data-composition-id="thread" data-start="0" data-duration="%s" data-width="%d" data-height="%d">
%s
<script src="assets/gsap.min.js"></script>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
%s
window.__timelines["thread"] = tl;
</script>
</div>
</body></html>
""" % (W, H, fs, int(W * 0.7), int(W * 0.08), int(W * 0.08), int(W * 0.14), int(W * 0.13), int(W * 0.035), total, W, H, "\n".join(els), "\n".join(tl))
    io.open(os.path.join(proj, "index.html"), "w", encoding="utf-8", newline="\n").write(html)
    io.open(os.path.join(proj, "meta.json"), "w", encoding="utf-8", newline="\n").write(json.dumps({"name": os.path.basename(proj), "fps": 24, "width": W, "height": H, "duration": total}, indent=2) + "\n")
    shutil.copyfile(os.path.join(vid.WORK, "..", "hyperframes", "video-projects", "film", "hyperframes.json"), os.path.join(proj, "hyperframes.json"))
    print("wrote", proj, "%.1f s" % total)


if __name__ == "__main__":
    a = sys.argv[1:]
    size = tuple(int(x) for x in a[a.index("--size") + 1].split("x")) if "--size" in a else (1920, 1080)
    build(size)
