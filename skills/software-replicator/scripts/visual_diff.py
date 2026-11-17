#!/usr/bin/env python3
"""
visual_diff.py - pixel-compare the old screenshot with the new one and drive the
rebuild to a visual match.

Capture both at the SAME viewport, the SAME state (resting, hover, focus, error...),
and the SAME data, then:

  python3 visual_diff.py OLD.png NEW.png [--out diff.png] [--json out.json]
      [--tolerance 0.005] [--channel 16] [--md]

It reports the percent of pixels that differ (ignoring tiny anti-aliasing jitter),
a mean difference, the grid cells where they differ most (so you know WHERE to fix),
and writes a highlighted diff image (the new screenshot with differing pixels in
red). Exit code 0 if the difference is within --tolerance (a match), 1 if not,
2 on a usage/size problem. The goal is ~0: a true visual match.

Needs Pillow:  pip install pillow   (if missing, it says so and exits 2, and you
fall back to comparing the two screenshots by eye, which you do anyway).
"""
import argparse
import json
import sys

try:
    from PIL import Image, ImageChops
except ImportError:
    sys.stderr.write("visual_diff.py needs Pillow. Install it with: pip install pillow\n"
                     "Until then, compare the two screenshots by eye and fix every visible difference.\n")
    sys.exit(2)


def load_rgb(path):
    try:
        im = Image.open(path).convert("RGBA")
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("cannot open %s: %s\n" % (path, e))
        sys.exit(2)
    # Flatten onto white so transparent pixels compare predictably.
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    return Image.alpha_composite(bg, im).convert("RGB")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--out", help="write a highlighted diff PNG here (default: alongside NEW as *-diff.png)")
    ap.add_argument("--json", help="write the structured result here")
    ap.add_argument("--tolerance", type=float, default=0.005,
                    help="max fraction of pixels allowed to differ and still count as a match (default 0.005 = 0.5%%)")
    ap.add_argument("--channel", type=int, default=16,
                    help="per-channel difference (0-255) below which a pixel counts as the same; absorbs anti-aliasing (default 16)")
    ap.add_argument("--grid", type=int, default=24, help="grid resolution for locating the worst regions (default 24)")
    ap.add_argument("--md", action="store_true", help="print a short markdown summary line as well")
    a = ap.parse_args()

    old = load_rgb(a.old)
    new = load_rgb(a.new)

    size_note = None
    if old.size != new.size:
        size_note = "sizes differ: old %sx%s, new %sx%s. Capture both at the same viewport. Comparing the overlapping area only." % (
            old.size[0], old.size[1], new.size[0], new.size[1])
        w = min(old.size[0], new.size[0])
        h = min(old.size[1], new.size[1])
        old = old.crop((0, 0, w, h))
        new = new.crop((0, 0, w, h))
    w, h = old.size
    total = w * h

    diff = ImageChops.difference(old, new)
    # A pixel "differs" if any channel differs by more than --channel.
    mask = diff.convert("L").point(lambda p: 255 if p > a.channel else 0)
    # Max per-channel diff per pixel for a stricter mask (point on L of max channel):
    r, g, b = diff.split()
    maxc = ImageChops.lighter(ImageChops.lighter(r, g), b)
    mask = maxc.point(lambda p: 255 if p > a.channel else 0)
    changed = sum(mask.histogram()[1:])  # non-zero pixels
    pct = changed / float(total) if total else 0.0

    # mean difference across all channels (0-255), a feel for how far off it is
    hist = diff.convert("L").histogram()
    mean = sum(i * c for i, c in enumerate(hist)) / float(total) if total else 0.0

    # Worst regions: grid cells ranked by how much they differ.
    gx = max(1, min(a.grid, w))
    gy = max(1, min(a.grid, h))
    cells = []
    cw, ch = w / gx, h / gy
    mask_px = mask.load()
    for cy in range(gy):
        for cx in range(gx):
            x0, y0 = int(cx * cw), int(cy * ch)
            x1, y1 = int((cx + 1) * cw), int((cy + 1) * ch)
            diffcount = 0
            for yy in range(y0, y1):
                for xx in range(x0, x1):
                    if mask_px[xx, yy]:
                        diffcount += 1
            area = max(1, (x1 - x0) * (y1 - y0))
            frac = diffcount / float(area)
            if frac > 0.02:
                cells.append({"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, "pct": round(frac * 100, 1)})
    cells.sort(key=lambda c: c["pct"], reverse=True)
    regions = cells[:12]

    # Highlighted diff image: the new screenshot with differing pixels tinted red.
    out_path = a.out or (a.new.rsplit(".", 1)[0] + "-diff.png")
    highlight = new.copy()
    red = Image.new("RGB", (w, h), (255, 0, 0))
    highlight = Image.composite(red, highlight, mask)
    try:
        highlight.save(out_path)
    except Exception as e:  # noqa: BLE001
        out_path = None
        sys.stderr.write("could not write diff image: %s\n" % e)

    match = pct <= a.tolerance
    result = {
        "schema": "software-replicator/visual-diff@1",
        "old": a.old, "new": a.new, "size": [w, h],
        "percent_different": round(pct * 100, 3),
        "pixels_different": changed, "pixels_total": total,
        "mean_difference": round(mean, 2),
        "channel_threshold": a.channel, "tolerance_percent": round(a.tolerance * 100, 3),
        "match": match, "diff_image": out_path, "worst_regions": regions,
        "size_note": size_note,
    }
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)

    verdict = "MATCH" if match else "DIFFERENT"
    print("%s: %.3f%% of pixels differ (%d of %d), mean diff %.1f/255, tolerance %.3f%%" % (
        verdict, result["percent_different"], changed, total, mean, result["tolerance_percent"]))
    if size_note:
        print("  " + size_note)
    if out_path:
        print("  diff image: %s (differing pixels in red)" % out_path)
    if regions:
        print("  worst regions (fix these first):")
        for rg in regions:
            print("    %4d,%-4d  %dx%d  %.1f%% different" % (rg["x"], rg["y"], rg["w"], rg["h"], rg["pct"]))
    if a.md:
        print("\n- Visual diff %s vs %s: **%s**, %.3f%% different (target <= %.3f%%)." % (
            a.old, a.new, verdict, result["percent_different"], result["tolerance_percent"]))
    sys.exit(0 if match else 1)


if __name__ == "__main__":
    main()
