#!/usr/bin/env python3
"""
ip_scan.py - vendor-copy gate. Proves the new app did not absorb the old
vendor's protected material: product and company names, logos and images
(by file hash), and long passages of their help or instruction text.

Matching the LAYOUT, workflow, field order and short functional labels
("Save", "Customer #", "Due date") is expected and is not flagged. Long
sentences are the vendor's writing; rewrite them in your own words.

Usage:
  python3 ip_scan.py --repo . --terms "VendorCo,ProductName"
        [--parity-dir docs/parity] [--min-words 8] [--md out.md]

Sources of "their material":
  --terms                      names you list (vendor, product, module names)
  _raw/inventory/old/*.json    long text blocks and headings from old screens
  _raw/assets/ (any files)     their images, icons, fonts, scripts; compared by SHA-256
Scans every git-tracked file in --repo except docs/parity/ itself.
Exit 1 when anything is found. Stdlib only, Python 3.9+.
"""
import argparse
import glob
import hashlib
import json
import os
import re
import subprocess
import sys


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def norm(s):
    return re.sub(r'\s+', ' ', (s or '')).strip().lower()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--repo', default='.')
    ap.add_argument('--terms', default='')
    ap.add_argument('--parity-dir', default='docs/parity')
    ap.add_argument('--min-words', type=int, default=8)
    ap.add_argument('--md')
    a = ap.parse_args()
    repo = os.path.abspath(a.repo)
    pdir = os.path.join(repo, a.parity_dir)
    raw = os.path.join(pdir, '_raw')

    terms = [t.strip() for t in a.terms.split(',') if t.strip()]
    passages = set()
    for fp in glob.glob(os.path.join(raw, 'inventory', 'old', '*.json')):
        try:
            with open(fp, encoding='utf-8') as f:
                inv = json.load(f)
        except Exception:  # noqa: BLE001
            continue
        for t in inv.get('textBlocks', []) + inv.get('headings', []):
            s = norm(t.get('text'))
            if len(s.split()) >= a.min_words:
                passages.add(s)
    asset_hashes = {}
    for fp in glob.glob(os.path.join(raw, 'assets', '**', '*'), recursive=True):
        if os.path.isfile(fp):
            asset_hashes[sha(fp)] = os.path.relpath(fp, repo)

    files = subprocess.run(['git', '-C', repo, 'ls-files'], capture_output=True, text=True).stdout.splitlines()
    rel_pdir = os.path.relpath(pdir, repo).replace(os.sep, '/') + '/'
    hits = []
    term_res = [(t, re.compile(r'(?<![A-Za-z0-9])' + re.escape(t) + r'(?![A-Za-z0-9])', re.I)) for t in terms]
    for rel in files:
        if rel.startswith(rel_pdir) or rel.startswith('.git/'):
            continue
        path = os.path.join(repo, rel)
        if not os.path.isfile(path):
            continue
        if asset_hashes:
            h = sha(path)
            if h in asset_hashes:
                hits.append('IDENTICAL FILE: %s is byte-for-byte the vendor asset %s' % (rel, asset_hashes[h]))
        if os.path.getsize(path) > 3_000_000:
            continue
        try:
            with open(path, encoding='utf-8') as f:
                text = f.read()
        except (UnicodeDecodeError, OSError):
            continue
        for t, rx in term_res:
            for m in rx.finditer(text):
                line = text.count('\n', 0, m.start()) + 1
                hits.append('NAME: "%s" in %s:%d' % (t, rel, line))
                break
        if passages:
            low = norm(text)
            for p in passages:
                if p in low:
                    hits.append('COPIED TEXT: "%s..." in %s' % (p[:70], rel))
    lines = ['# Vendor-copy scan', '',
             '- Terms checked: %s' % (', '.join(terms) or '(none given)'),
             '- Long passages from old screens: %d' % len(passages),
             '- Vendor asset hashes: %d' % len(asset_hashes),
             '- Files scanned: %d' % len(files), '',
             '## Findings (%d)' % len(hits)]
    lines += ['- ' + h for h in hits] or ['- none']
    report = '\n'.join(lines) + '\n'
    if a.md:
        with open(a.md, 'w', encoding='utf-8') as f:
            f.write(report)
    else:
        sys.stdout.write(report)
    sys.exit(1 if hits else 0)


if __name__ == '__main__':
    main()
