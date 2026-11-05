#!/usr/bin/env python3
"""
parity_report.py - build ONE html page that shows every screen side by side:
the old system's screenshot next to the new app's (or next to several design
directions in Phase 4), with the layout_diff verdict and its blocking items.

Folder convention (made by scaffold.py):
  <parity>/_raw/shots/old/<SCREEN_ID>.png      old system
  <parity>/_raw/shots/new/<SCREEN_ID>.png      new app
  <parity>/_raw/shots/<any-other>/<ID>.png     extra columns, e.g. faithful/,
                                               refreshed/, modern/ in Phase 4
  <parity>/_raw/diff/<SCREEN_ID>.json          layout_diff.py --json output
  <parity>/site-map.md                         table rows "| S01 | Name | ..."

Usage:
  python3 parity_report.py [--parity-dir docs/parity] [--out FILE] [--embed]

The page lives under _raw/ by default because screenshots show real records.
--embed inlines the images (one portable file, larger). Stdlib only.
"""
import argparse
import base64
import html
import json
import os
import re
import sys

IMG_EXT = ('.png', '.jpg', '.jpeg', '.webp')


def screen_names(site_map):
    names = {}
    if not os.path.exists(site_map):
        return names
    with open(site_map, encoding='utf-8') as f:
        for line in f:
            m = re.match(r'^\|\s*(S\d+[\w-]*)\s*\|\s*([^|]+)\|', line)
            if m:
                names[m.group(1)] = m.group(2).strip()
    return names


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--parity-dir', default='docs/parity')
    ap.add_argument('--out')
    ap.add_argument('--embed', action='store_true')
    a = ap.parse_args()

    raw = os.path.join(a.parity_dir, '_raw')
    shots = os.path.join(raw, 'shots')
    if not os.path.isdir(shots):
        sys.stderr.write('no %s folder; run scaffold.py and save screenshots there first\n' % shots)
        sys.exit(2)
    out = a.out or os.path.join(raw, 'report', 'index.html')
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

    cols = sorted(d for d in os.listdir(shots) if os.path.isdir(os.path.join(shots, d)))
    cols = [c for c in ('old', 'new') if c in cols] + [c for c in cols if c not in ('old', 'new')]
    ids = set()
    for c in cols:
        for fn in os.listdir(os.path.join(shots, c)):
            if fn.lower().endswith(IMG_EXT):
                ids.add(os.path.splitext(fn)[0])
    names = screen_names(os.path.join(a.parity_dir, 'site-map.md'))

    def img_src(path):
        if a.embed:
            ext = os.path.splitext(path)[1].lower().lstrip('.')
            mime = 'image/jpeg' if ext in ('jpg', 'jpeg') else 'image/' + ext
            with open(path, 'rb') as f:
                return 'data:%s;base64,%s' % (mime, base64.b64encode(f.read()).decode('ascii'))
        return os.path.relpath(path, os.path.dirname(os.path.abspath(out)))

    def find(col, sid):
        for ext in IMG_EXT:
            p = os.path.join(shots, col, sid + ext)
            if os.path.exists(p):
                return p
        return None

    rows, sections = [], []
    totals = {'PASS': 0, 'FAIL': 0, 'none': 0}
    for sid in sorted(ids):
        diff = None
        dp = os.path.join(raw, 'diff', sid + '.json')
        if os.path.exists(dp):
            with open(dp, encoding='utf-8') as f:
                diff = json.load(f)
        verdict = diff['verdict'] if diff else 'not compared'
        totals[verdict if verdict in totals else 'none'] += 1
        b = diff['counts']['blocking'] if diff else '-'
        w = diff['counts']['warnings'] if diff else '-'
        cls = 'pass' if verdict == 'PASS' else ('fail' if verdict == 'FAIL' else 'na')
        rows.append('<tr><td><a href="#%s">%s</a></td><td>%s</td><td class="%s">%s</td><td>%s</td><td>%s</td></tr>' % (
            html.escape(sid), html.escape(sid), html.escape(names.get(sid, '')), cls, html.escape(verdict), b, w))
        figs = []
        for c in cols:
            p = find(c, sid)
            if p:
                src = img_src(p)
                figs.append('<figure><figcaption>%s</figcaption><a href="%s" target="_blank"><img loading="lazy" src="%s" alt="%s %s"></a></figure>' % (
                    html.escape(c), html.escape(src), html.escape(src), html.escape(sid), html.escape(c)))
            else:
                figs.append('<figure class="empty"><figcaption>%s</figcaption><div>no screenshot</div></figure>' % html.escape(c))
        items = ''
        if diff:
            bl = ''.join('<li>%s</li>' % html.escape(x['text']) for x in diff.get('blocking', []))
            wl = ''.join('<li>%s</li>' % html.escape(x['text']) for x in diff.get('warnings', []))
            items = ('<div class="lists"><div><h4>Blocking (%d)</h4><ul>%s</ul></div>'
                     '<details><summary>Warnings (%d)</summary><ul>%s</ul></details></div>') % (
                len(diff.get('blocking', [])), bl or '<li>none</li>', len(diff.get('warnings', [])), wl or '<li>none</li>')
        sections.append('<section id="%s"><h2>%s <span>%s</span> <em class="%s">%s</em></h2><div class="grid" style="--cols:%d">%s</div>%s</section>' % (
            html.escape(sid), html.escape(sid), html.escape(names.get(sid, '')), cls, html.escape(verdict), len(cols), ''.join(figs), items))

    page = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parity Report</title>
<style>
:root{--bg:#f6f5f2;--fg:#1d1d1b;--muted:#6b6a65;--card:#fff;--line:#dedcd6;--pass:#1f7a4a;--fail:#b3261e;--na:#8a6d1a}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--muted:#a3a29c;--card:#22221f;--line:#3a3934;--pass:#5cc58c;--fail:#ff8a80;--na:#e0c060}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;z-index:2}
h1{margin:0;font-size:18px}main{padding:16px;max-width:1800px;margin:0 auto}
table{border-collapse:collapse;width:100%%;background:var(--card);margin-bottom:24px}td,th{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left}
.pass{color:var(--pass);font-weight:600}.fail{color:var(--fail);font-weight:600}.na{color:var(--na)}
section{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px;margin-bottom:20px}
h2{font-size:16px;margin:0 0 10px}h2 span{color:var(--muted);font-weight:400}h2 em{font-style:normal;margin-left:8px}
.grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:10px}
@media (max-width:900px){.grid{grid-template-columns:1fr}}
figure{margin:0}figcaption{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px}
img{width:100%%;height:auto;border:1px solid var(--line);display:block}.empty div{border:1px dashed var(--line);padding:40px;text-align:center;color:var(--muted)}
.lists{display:grid;gap:8px;margin-top:10px}h4{margin:0}ul{margin:4px 0 0 18px;padding:0}summary{cursor:pointer}
</style></head><body>
<header><h1>Parity Report</h1><div>%d screens, %d pass, %d fail, %d not compared. Columns: %s</div></header>
<main><table><thead><tr><th>Screen</th><th>Name</th><th>Verdict</th><th>Blocking</th><th>Warnings</th></tr></thead><tbody>%s</tbody></table>%s</main>
</body></html>''' % (len(ids), totals['PASS'], totals['FAIL'], totals['none'], html.escape(', '.join(cols)), ''.join(rows), ''.join(sections))
    with open(out, 'w', encoding='utf-8') as f:
        f.write(page)
    print('wrote %s (%d screens, columns: %s)' % (out, len(ids), ', '.join(cols)))


if __name__ == '__main__':
    main()
