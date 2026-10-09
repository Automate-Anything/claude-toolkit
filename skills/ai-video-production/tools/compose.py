"""Write the film's HyperFrames composition from an edit list: the takes as muted video, and the designed layer:
glass speech bubbles that pop up beside whoever is talking, a tag on top of each (You; the brand wordmark; who is
on the other end of a call), the wordmark over the picture once, and the card. The sound is NOT in this
composition: it is mixed separately by mix.py (one voice at a time, everything else ducked) and muxed after.

  python compose.py edit/edl-v2.json            (FILM_PROJECT=film-vertical for the vertical project)
"""
import io, json, os, shutil, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

# the brand: change these for your film (fonts are the two TTF files in the project folder's fonts/)
BRAND = {"mark": "Brand", "tagline": "Your tagline here.", "line": "One line under the tagline.", "address": "example.com",
         "small": "The people in this film are generated. What the product does is real."}

PROJ = os.path.join(vid.WORK, "..", "hyperframes", "video-projects", os.environ.get("FILM_PROJECT", "film"))
TAKES = os.path.join(vid.WORK, "prove", "takes")
AUDIO = os.path.join(vid.WORK, "audio")
FP = os.path.join(vid.BIN, "ffprobe.exe")


def dur(path):
    r = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)

# where the bubble sits per take (the empty side of the frame), chosen by eye from the contact sheets
SIDE = {"DAUGHTER-1": "right", "LADDER-1": "left", "DAD-1": "left", "DAUGHTER-2": "right", "NEIGHBOR-1": "right", "ENVELOPE-1": "right", "TOUCH-1": "right",
        "GP-1": "left", "COUCH-1": "right", "SLEEP-1": "left", "PLAY-1": "right", "PLAY-2": "right",
        "DAUGHTER-1V": "right", "DAUGHTER-2V": "right", "NEIGHBOR-1V": "left", "GP-1V": "left", "COUCH-1V": "right", "PLAY-1V": "right",
        "T1-CU": "right", "T1-A": "right", "GARDEN-1": "right", "T2-PR": "left", "T2-W": "left", "SINK-1": "right", "T3-A": "right", "T3-CU": "right", "RTHUMB-1": "left", "T4-A": "right", "LEAN-1": "left",
        "GARDEN-1S": "right", "SINK-1S": "right", "DAUGHTER-SOFA-1S": "right", "TOUCH-1S": "right", "LADDER-1S": "left", "S3-2-C": "left"}
WHO = {"claims": "Insurance", "caller": "Caller", "warranty": "Robocall", "pharmacy": "Pharmacy"}
# which shots belong to one scene: a bubble may outlive its shot only into the next shot of the same scene
SCENE = {"DAUGHTER-1": "daughter", "THUMB-1": "daughter", "DAUGHTER-2": "daughter", "CAR-OUT-1": "daughter", "NEIGHBOR-1": "neighbor", "LADDER-1": "neighbor", "DAD-1": "dad", "ENVELOPE-1": "dad", "TOUCH-1": "dad",
         "GP-1": "gp", "COUCH-1": "couch", "SLEEP-1": "sleep", "PLAY-1": "play", "PLAY-2": "play",
         "DAUGHTER-1V": "daughter", "DAUGHTER-2V": "daughter", "NEIGHBOR-1V": "neighbor", "GP-1V": "gp", "COUCH-1V": "couch", "PLAY-1V": "play",
         "T1-CU": "talk1", "T1-A": "talk1", "GARDEN-1": "garden", "T2-PR": "talk2", "T2-W": "talk2", "SINK-1": "sink", "T3-A": "talk3", "MAN-1": "talk3", "T3-CU": "talk3",
         "RTHUMB-1": "thumb", "T4-A": "talk4", "LEAN-1": "lean",
         "S3-1": "s1", "S3-2-C": "s2", "S3-3": "s3", "GARDEN-1S": "garden", "S3-4-C": "s4", "SINK-1S": "sink", "S3-5": "s5", "DAUGHTER-SOFA-1S": "sofa", "S3-6-C": "s6", "TOUCH-1S": "soninlaw",
         "S3-7": "s7", "LADDER-1S": "neighbor", "S3-8-C": "s8", "S3-W": "s9"}
MIN_LIFE = 2.2
YOU = ("you", "daughter", "neighbor", "dad", "woman", "man", "woman")


def rel_copy(src, sub):
    d = os.path.join(PROJ, "assets", sub)
    os.makedirs(d, exist_ok=True)
    dst = os.path.join(d, os.path.basename(src))
    if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src):
        shutil.copyfile(src, dst)
    return "assets/%s/%s" % (sub, os.path.basename(src))


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def tag_html(who):
    if who == "assistant":
        return '<span class="tag mark">' + BRAND["mark"] + '</span>'
    if who in YOU:
        return '<span class="tag">You</span>'
    return '<span class="tag">%s</span>' % esc(WHO.get(who, who.capitalize()))


def build(edl_path):
    edl = json.load(open(edl_path, encoding="utf-8"))
    W, H = edl["size"]
    vertical = H > W
    total = round(sum(s["dur"] for s in edl["shots"]), 3)
    els, tl = [], []
    n = 0
    shots = edl["shots"]

    def scene_end(idx):
        # the time at which the scene of shot idx ends (the first later shot of another scene)
        sc = SCENE.get(shots[idx]["take"])
        end = shots[idx]["at"] + shots[idx]["dur"]
        for s in shots[idx + 1:]:
            if sc is None or SCENE.get(s["take"]) != sc:
                break
            end = s["at"] + s["dur"]
        return end

    last_at = [-9.0]

    def fit(at, life, idx):
        # a bubble never crosses into another scene; if that leaves too little time to read it, it comes up earlier
        end = scene_end(idx)
        if at + life > end:
            life = round(end - at, 2)
            if life < MIN_LIFE:
                at = round(max(shots[idx]["at"] + 0.2, last_at[0] + 1.2, end - MIN_LIFE), 2)
                life = round(end - at, 2)
        last_at[0] = at
        return at, life

    def bubble(text, who, kind, at, life, side):
        nonlocal n
        n += 1
        tag = "" if kind in ("nobody", "note") else tag_html(who)
        els.append('<div id="t%d" class="clip bub %s %s" data-start="%s" data-duration="%s" data-track-index="%d">%s<span class="txt">%s</span></div>' % (n, kind, side, at, life, 400 + n, tag, esc(text)))
        # pops up like a speech bubble: one curve, no overshoot; a sent line leaves upward, the rest fade; hard kill at the end
        tl.append('tl.from("#t%d", {opacity: 0, scale: 0.92, y: 16, duration: 0.4, ease: "power2.out"}, %s);' % (n, at))
        if kind == "sent":
            tl.append('tl.to("#t%d", {y: -40, opacity: 0, duration: 0.35, ease: "power2.in"}, %s);' % (n, round(at + life - 0.35, 2)))
        else:
            tl.append('tl.to("#t%d", {opacity: 0, duration: 0.45, ease: "power2.in"}, %s);' % (n, round(at + life - 0.45, 2)))
        tl.append('tl.set("#t%d", {opacity: 0}, %s);' % (n, round(at + life, 2)))

    for idx, s in enumerate(shots):
        t0, d, take = s["at"], s["dur"], s["take"]
        last_at[0] = -9.0
        if take == "CARD":
            els.append(('<div id="card" class="clip card" data-start="%s" data-duration="%s" data-track-index="0"><div class="card-in"><div class="mark">' + BRAND["mark"] + '</div><div class="tag2">' + BRAND["tagline"] + '</div><div class="line">' + BRAND["line"] + '</div><div class="addr">' + BRAND["address"] + '</div><div class="small">' + BRAND["small"] + '</div></div></div>') % (t0, d))
            for k, sel in enumerate((".mark", ".tag2", ".line", ".addr", ".small")):
                tl.append('tl.from("#card %s", {opacity: 0, y: 10, duration: 0.5, ease: "power2.out"}, %s);' % (sel, round(t0 + 0.3 + 0.45 * k, 2)))
            continue
        if take == "burst":
            parts = [("DAUGHTER-2", 2.0), ("NEIGHBOR-1", 1.2), ("DAD-1", 2.2), ("COUCH-1", 2.4), ("SLEEP-1", 3.0), ("PLAY-2", 3.2)]
            step = d / len(parts)
            for k, (tk, ms) in enumerate(parts):
                p = rel_copy(os.path.join(TAKES, tk + ".mp4"), "takes")
                n += 1
                els.append('<div class="wrap" style="z-index:1"><video id="b%d" data-start="%s" data-duration="%s" data-media-start="%s" data-track-index="%d" src="%s" muted playsinline style="transform:scale(1.6)"></video></div>' % (n, round(t0 + k * step, 3), round(step, 3), ms, 10 + k, p))
            continue
        p = rel_copy(os.path.join(TAKES, take + ".mp4"), "takes")
        n += 1
        els.append('<div class="wrap"><video id="v%d" data-start="%s" data-duration="%s" data-media-start="%s" data-track-index="0" src="%s" muted playsinline></video></div>' % (n, t0, d, s["in"], p))
        side = SIDE.get(take, "right")
        other = "left" if side == "right" else "right"
        bubbles = s.get("bubble")
        if isinstance(bubbles, dict):
            bubbles = [bubbles]
        for b in bubbles or []:
            kind = b.get("kind", "sent")
            life = 3.4 if kind not in ("nobody", "note") else (2.6 if kind == "nobody" else 4.0)
            who = b.get("who", "assistant" if kind == "reply" else "you")
            at, life = fit(b["at"], b.get("life", life), idx)
            bubble(b["text"], who, kind, at, life, b.get("side") or (side if kind != "reply" else other))
            if b.get("first"):
                n += 1
                els.append('<div id="f%d" class="clip firstword" data-start="%s" data-duration="0.34" data-track-index="%d">%s</div>' % (n, at, 400 + n, esc(b["first"])))
        for c in s.get("call", []):
            # a call line is a bubble too: the assistant's on the far side, the other party's beside the person; the tag says who
            who = c["who"]
            fn = os.path.join(AUDIO, c["audio"].replace("/", os.sep) + ".mp3")
            spoken = min(dur(fn), c.get("len") or 999) if os.path.exists(fn) else len(c["text"]) * 0.075
            life = round(max(2.2, min(7.0, spoken + 0.4)), 2)
            at, life = fit(c["at"], life, idx)
            bubble(c["text"], who, "reply" if who == "assistant" else "other", at, life, c.get("side") or (other if who == "assistant" else side))
        bk = s.get("book")
        if bk:
            n += 1
            per = bk["dur"] / len(bk["pages"])
            pages = []
            for k, pg in enumerate(bk["pages"]):
                pages.append('<div class="page" id="p%d_%d"><div class="pt">%s</div>%s%s</div>' % (n, k, esc(pg["title"]), "".join('<div class="pl">%s</div>' % esc(x) for x in pg.get("lines", [])), ('<div class="pb">%s</div>' % esc(pg["badge"])) if pg.get("badge") else ""))
                st = round(bk["at"] + k * per, 2)
                tl.append('tl.fromTo("#p%d_%d", {opacity: 0, y: 46}, {opacity: 1, y: 0, duration: 0.38, ease: "power2.out"}, %s);' % (n, k, st))
                if k < len(bk["pages"]) - 1:
                    tl.append('tl.to("#p%d_%d", {opacity: 0, y: -36, duration: 0.3, ease: "power2.in"}, %s);' % (n, k, round(st + per - 0.3, 2)))
            els.append('<div id="k%d" class="clip book %s" data-start="%s" data-duration="%s" data-track-index="%d">%s</div>' % (n, bk.get("side") or side, bk["at"], bk["dur"], 400 + n, "".join(pages)))
            tl.append('tl.from("#k%d", {opacity: 0, scale: 0.94, y: 20, duration: 0.45, ease: "power2.out"}, %s);' % (n, bk["at"]))
            tl.append('tl.to("#k%d", {opacity: 0, duration: 0.4, ease: "power2.in"}, %s);' % (n, round(bk["at"] + bk["dur"] - 0.4, 2)))
            tl.append('tl.set("#k%d", {opacity: 0}, %s);' % (n, round(bk["at"] + bk["dur"], 2)))
        wm = s.get("wordmark")
        if wm:
            n += 1
            # the wordmark stands on the empty side of the frame, never on a face
            els.append(('<div id="w%d" class="clip wordmark %s" data-start="%s" data-duration="%s" data-track-index="130"><span class="glass-mark">' + BRAND["mark"] + '</span></div>') % (n, wm.get("pos") or side, wm["at"], wm["dur"]))
            tl.append('tl.from("#w%d", {opacity: 0, scale: 0.96, duration: 0.5, ease: "power2.out"}, %s);' % (n, wm["at"]))
            tl.append('tl.to("#w%d", {opacity: 0, duration: 0.5, ease: "power2.in"}, %s);' % (n, round(wm["at"] + wm["dur"] - 0.5, 2)))
            tl.append('tl.set("#w%d", {opacity: 0}, %s);' % (n, round(wm["at"] + wm["dur"], 2)))

    # the site's Liquid Glass recipe (services/home/site.mjs .stage), a little more opaque so type reads over moving picture
    # (single % here: this string is substituted as a value, not run through the formatter)
    glass = ("background: linear-gradient(165deg, rgba(255,255,255,0.86) 0%, rgba(255,255,255,0.70) 45%, rgba(255,255,255,0.60) 100%); "
             "-webkit-backdrop-filter: blur(26px) saturate(1.4); backdrop-filter: blur(26px) saturate(1.4); border: 1px solid rgba(255,255,255,0.9); "
             "box-shadow: inset 0 2px 0 rgba(255,255,255,1), inset 0 -3px 6px rgba(0,0,0,0.07), inset 2px 0 0 rgba(255,255,255,0.5), 0 2px 4px rgba(0,0,0,0.06), 0 30px 60px -30px rgba(0,0,0,0.45);")
    v = {"W": W, "H": H, "glass": glass, "total": total, "els": "\n".join(els), "tl": "\n".join(tl),
         # wide: left and right bubbles share one row and can never meet (5 + 44 < 50); tall: the far side sits one row up
         "bottom": int(H * (0.14 if not vertical else 0.20)), "maxw": int(W * (0.44 if not vertical else 0.84)), "edge": int(W * 0.05),
         "rows": "" if not vertical else ".bub.left { bottom: %dpx; }" % int(H * 0.20 + 300),
         "wmedge": int(W * (0.08 if not vertical else 0.05)), "top": int(H * (0.08 if not vertical else 0.17)), "wmtop": int(H * 0.07), "wmsmall": int(W * 0.075),
         "booktop": int(H * (0.12 if not vertical else 0.2)), "bookw": int(W * (0.27 if not vertical else 0.7)), "bookh": int(H * (0.54 if not vertical else 0.42)), "bookt": 96, "bookl": 40, "notefs": 36 if not vertical else 40,
         "fs": 44 if not vertical else 46, "tagfs": 20 if not vertical else 22, "markfs": 44 if not vertical else 46,
         "firstfs": int(W * 0.135), "wmfs": int(W * 0.15), "cardmark": int(W * 0.125), "cardtag": int(W * 0.033)}
    html = """<!doctype html>
<html><head><meta charset="utf-8"><title>the assistant: the film</title>
<style>
@font-face { font-family: "UriDisplay"; src: url("fonts/display.ttf"); font-style: italic; font-weight: 500; }
@font-face { font-family: "UriText"; src: url("fonts/text.ttf"); font-weight: 200 800; }
html, body { margin: 0; background: #0A0A0A; }
[data-composition-id="film"] { position: relative; width: %(W)dpx; height: %(H)dpx; overflow: hidden; background: #0A0A0A; font-family: "UriText"; }
.wrap { position: absolute; inset: 0; }
.wrap video { position: absolute; inset: 0; width: 100%%; height: 100%%; object-fit: cover; }
.clip { position: absolute; }
/* a speech bubble: glass, a tag on top, a tail toward the one who is talking */
.bub { bottom: %(bottom)dpx; max-width: %(maxw)dpx; padding: 16px 28px 20px; border-radius: 28px; color: #0A0A0A; z-index: 20; display: flex; flex-direction: column; gap: 4px; transform-origin: bottom center; %(glass)s }
.bub.left { left: %(edge)dpx; } .bub.right { right: %(edge)dpx; }
.bub .txt { font-size: %(fs)dpx; line-height: 1.22; letter-spacing: -0.01em; font-weight: 500; font-variant-numeric: tabular-nums; }
.bub .tag { font-size: %(tagfs)dpx; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #555555; line-height: 1.4; }
.bub .tag.mark { font-family: "UriDisplay"; font-style: italic; font-weight: 500; text-transform: none; letter-spacing: 0; font-size: %(markfs)dpx; line-height: 1; color: #0A0A0A; margin-bottom: 4px; }
/* the tail is the corner nearest the speaker, squared, the way a message bubble points */
.bub.left { border-bottom-left-radius: 6px; } .bub.right { border-bottom-right-radius: 6px; }
.bub.nobody { background: rgba(255,255,255,0.58); border-radius: 28px; }
.bub.nobody .txt { font-weight: 400; font-style: italic; color: #141414; }
/* a note about the assistant, at the top of the frame, out of the way of the call */
.bub.note, .bub.note.left, .bub.note.right { bottom: auto; top: %(top)dpx; background: rgba(255,255,255,0.58); border-radius: 28px; transform-origin: top center; }
.bub.note .txt { font-weight: 400; color: #141414; font-size: %(notefs)dpx; }
%(rows)s
.book { top: %(booktop)dpx; width: %(bookw)dpx; height: %(bookh)dpx; border-radius: 34px; z-index: 22; overflow: hidden; %(glass)s }
.book.left { left: %(edge)dpx; } .book.right { right: %(edge)dpx; }
.book .page { position: absolute; inset: 0; padding: 44px 40px; display: flex; flex-direction: column; gap: 14px; color: #0A0A0A; opacity: 0; }
.book .pt { font-family: "UriDisplay"; font-style: italic; font-weight: 500; font-size: %(bookt)dpx; line-height: 1; margin-bottom: 14px; }
.book .pl { font-size: %(bookl)dpx; line-height: 1.3; font-weight: 500; }
.book .pb { margin-top: auto; font-size: 22px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #555555; }
.firstword { inset: 0; display: flex; align-items: center; justify-content: center; font-family: "UriDisplay"; font-style: italic; font-weight: 500; font-size: %(firstfs)dpx; color: #F2F2F2; z-index: 30; text-shadow: 0 2px 40px rgba(0,0,0,0.5); }
.wordmark { inset: 0; display: flex; align-items: center; justify-content: center; z-index: 30; box-sizing: border-box; }
.wordmark.top { align-items: flex-start; padding-top: %(wmtop)dpx; } .wordmark.top .glass-mark { font-size: %(wmsmall)dpx; padding: 16px 56px 30px; border-radius: 40px; }
.wordmark.left { justify-content: flex-start; padding-left: %(wmedge)dpx; } .wordmark.right { justify-content: flex-end; padding-right: %(wmedge)dpx; }
.glass-mark { font-family: "UriDisplay"; font-style: italic; font-weight: 500; font-size: %(wmfs)dpx; line-height: 1; color: #0A0A0A; padding: 30px 90px 54px; border-radius: 56px; %(glass)s }
.card { inset: 0; background: linear-gradient(165deg, #FFFFFF 0%%, #E9E9E9 100%%); z-index: 50; }
.card-in { width: 100%%; height: 100%%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; box-sizing: border-box; padding: 120px; color: #0A0A0A; text-align: center; }
.card .mark { font-family: "UriDisplay"; font-style: italic; font-weight: 500; font-size: %(cardmark)dpx; line-height: 0.9; margin-bottom: 30px; }
.card .tag2 { font-family: "UriDisplay"; font-style: italic; font-weight: 500; font-size: %(cardtag)dpx; }
.card .line { font-size: 34px; font-weight: 500; color: #555555; }
.card .addr { font-size: 30px; margin-top: 24px; }
.card .small { font-size: 22px; color: #8C8C8C; margin-top: 70px; }
</style></head>
<body>
<div id="root" data-composition-id="film" data-start="0" data-duration="%(total)s" data-width="%(W)d" data-height="%(H)d">
%(els)s
<script src="assets/gsap.min.js"></script>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
%(tl)s
window.__timelines["film"] = tl;
</script>
</div>
</body></html>
""" % v
    os.makedirs(PROJ, exist_ok=True)  # the renderer also needs hyperframes.json, fonts/ and assets/gsap.min.js here
    io.open(os.path.join(PROJ, "index.html"), "w", encoding="utf-8", newline="\n").write(html)
    io.open(os.path.join(PROJ, "meta.json"), "w", encoding="utf-8", newline="\n").write(json.dumps({"name": os.path.basename(PROJ), "fps": edl["fps"], "width": W, "height": H, "duration": total}, indent=2) + "\n")
    print("wrote %s: %d elements, %d tweens, %.1f s" % (os.path.basename(PROJ), len(els), len(tl), total))


if __name__ == "__main__":
    build(sys.argv[1])
