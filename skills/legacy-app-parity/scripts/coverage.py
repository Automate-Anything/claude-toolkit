#!/usr/bin/env python3
"""
coverage.py - answer "have we really seen EVERY screen?" and "how far along are we?".

Reads the old system's inventories (_raw/inventory/old/*.json from inventory.js)
and reports:
  * the crawl frontier: same-site links found on mapped screens whose page
    pattern has not been inventoried yet (query VALUES ignored, keys kept)
  * links that look DANGEROUS to open by URL (delete, void, send, logout...).
    Old systems often do real work on a plain GET link. Never visit these
    outside the sandbox safety tiers.
  * click-only targets (postbacks, javascript: links, onclick handlers,
    popups) that a URL crawl cannot reach: open each by clicking
  * menu entries whose label does not appear anywhere in site-map.md yet
  * progress counts: screens inventoried old/new, specs written, diff verdicts

Usage:
  python3 coverage.py [--parity-dir docs/parity] [--md out.md]
Stdlib only, Python 3.9+.
"""
import argparse
import glob
import json
import os
import re
import sys
from urllib.parse import parse_qsl, urljoin, urlsplit

DANGER = re.compile(r'delete|remove|destroy|purge|void|cancel|refund|logout|log ?off|sign ?out|send|e-?mail|sms|text message|'
                    r'approve|post(?!al)|pay|charge|submit|archive|close ?out|reset|wipe|import|merge|batch|run|process|finali[sz]e',
                    re.I)


def pattern(url, host_hint=None):
    u = urlsplit(url)
    keys = sorted(k for k, _ in parse_qsl(u.query, keep_blank_values=True))
    path = re.sub(r'/\d+(?=/|$)', '/{id}', u.path.lower())
    return '%s%s%s' % (u.netloc.lower() or (host_hint or ''), path, ('?' + '&'.join(k + '=' for k in keys)) if keys else '')


def load(path):
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
    except Exception:  # noqa: BLE001
        return None
    if isinstance(d, dict) and 'elements' not in d:
        for k in ('result', 'value', 'data'):
            if isinstance(d.get(k), dict) and 'elements' in d[k]:
                return d[k]
    return d if isinstance(d, dict) and 'elements' in d else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--parity-dir', default='docs/parity')
    ap.add_argument('--md')
    a = ap.parse_args()
    raw = os.path.join(a.parity_dir, '_raw')

    old_files = sorted(glob.glob(os.path.join(raw, 'inventory', 'old', '*.json')))
    new_files = sorted(glob.glob(os.path.join(raw, 'inventory', 'new', '*.json')))
    if not old_files:
        sys.stderr.write('no inventories in %s yet\n' % os.path.join(raw, 'inventory', 'old'))
        sys.exit(2)

    visited, host = {}, None
    links = {}
    click_only = []
    menus = []
    for fp in old_files:
        inv = load(fp)
        if not inv:
            continue
        sid = os.path.splitext(os.path.basename(fp))[0]
        url = inv.get('meta', {}).get('url', '')
        host = host or urlsplit(url).netloc.lower()
        visited.setdefault(pattern(url), []).append(sid)
        for e in inv.get('elements', []):
            label = e.get('label') or e.get('name') or ''
            href = (e.get('href') or '').strip()
            onclick = e.get('onclick') or ''
            if href and not href.startswith(('javascript:', '#', 'mailto:', 'tel:')):
                absu = urljoin(url, href)
                if urlsplit(absu).netloc.lower() == host:
                    p = pattern(absu)
                    links.setdefault(p, {'labels': set(), 'from': set(), 'danger': False})
                    links[p]['labels'].add(label)
                    links[p]['from'].add(sid)
                    if DANGER.search(label) or DANGER.search(urlsplit(absu).path) or DANGER.search(urlsplit(absu).query):
                        links[p]['danger'] = True
            elif href.startswith('javascript:') or onclick or e.get('role') == 'clickable':
                code = href if href.startswith('javascript:') else onclick
                kind = 'postback' if '__doPostBack' in code else ('popup' if 'window.open' in code or 'showModalDialog' in code else 'script')
                if e.get('role') in ('textbox', 'combobox', 'checkbox', 'radio'):
                    continue
                click_only.append((sid, label, kind, bool(DANGER.search(label))))
            if e.get('menuPath') or e.get('role') in ('menuitem', 'menuitemcheckbox', 'menuitemradio') or 'nav' in (e.get('landmarks') or '') or 'navigation' in (e.get('landmarks') or ''):
                full = ((e.get('menuPath') + ' > ') if e.get('menuPath') else '') + label
                if label and full not in menus:
                    menus.append(full)

    site_map = ''
    sm = os.path.join(a.parity_dir, 'site-map.md')
    if os.path.exists(sm):
        with open(sm, encoding='utf-8') as f:
            site_map = f.read().lower()

    frontier = {p: v for p, v in links.items() if p not in visited}
    specs = glob.glob(os.path.join(a.parity_dir, 'screens', '*.md'))
    verdicts = {'PASS': 0, 'FAIL': 0}
    for dp in glob.glob(os.path.join(raw, 'diff', '*.json')):
        try:
            with open(dp, encoding='utf-8') as f:
                v = json.load(f).get('verdict')
            if v in verdicts:
                verdicts[v] += 1
        except Exception:  # noqa: BLE001
            pass

    L = ['# Coverage', '',
         '- Old screens inventoried: %d (distinct page patterns: %d)' % (len(old_files), len(visited)),
         '- New screens inventoried: %d' % len(new_files),
         '- Screen specs written: %d' % len(specs),
         '- Layout diffs: %d pass, %d fail' % (verdicts['PASS'], verdicts['FAIL']),
         '- Unvisited same-site link patterns: %d (%d look dangerous)' % (len(frontier), sum(1 for v in frontier.values() if v['danger'])),
         '- Click-only targets seen: %d' % len(click_only), '']
    L.append('## Frontier: safe-looking links not mapped yet')
    safe = [(p, v) for p, v in sorted(frontier.items()) if not v['danger']]
    L += ['- %s  (labels: %s; found on %s)' % (p, ', '.join(sorted(x for x in v['labels'] if x))[:120] or '-', ', '.join(sorted(v['from']))) for p, v in safe] or ['- none']
    L += ['', '## DANGEROUS-looking links: do NOT open by URL', 'Open only through the UI, in the sandbox, at the right safety tier. Many old systems delete, send or log out on a plain link.']
    dang = [(p, v) for p, v in sorted(frontier.items()) if v['danger']]
    L += ['- %s  (labels: %s; found on %s)' % (p, ', '.join(sorted(x for x in v['labels'] if x))[:120] or '-', ', '.join(sorted(v['from']))) for p, v in dang] or ['- none']
    L += ['', '## Click-only targets (no URL to crawl; open each by clicking)']
    seen = set()
    for sid, label, kind, d in click_only:
        k = (label, kind)
        if k in seen or not label:
            continue
        seen.add(k)
        L.append('- %s: "%s" (%s)%s' % (sid, label, kind, '  DANGER: write or outbound action, sandbox tier only' if d else ''))
    if len(L) and L[-1].startswith('## Click-only'):
        L.append('- none')
    L += ['', '## Menu entries not mentioned in site-map.md yet']
    missing = [m for m in menus if m.split(' > ')[-1].lower() not in site_map]
    L += ['- ' + m for m in missing] or ['- none']
    report = '\n'.join(L) + '\n'
    if a.md:
        with open(a.md, 'w', encoding='utf-8') as f:
            f.write(report)
    else:
        sys.stdout.write(report)


if __name__ == '__main__':
    main()
