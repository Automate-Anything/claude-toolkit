#!/usr/bin/env python3
"""
scaffold.py - set up the parity workspace inside the NEW app's repository.

Creates docs/parity/ with the working templates and docs/parity/_raw/ for
screenshots, inventories, network bodies and scripts captured from the old
system. _raw/ holds real customer data, so it is added to .gitignore and the
script PROVES git ignores it before you capture anything.

Never overwrites an existing file. Safe to re-run.

Usage:
  python3 scaffold.py [--repo PATH] [--parity-dir docs/parity] [--system "Old system name"]
Stdlib only, Python 3.9+.
"""
import argparse
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.join(HERE, '..', 'assets', 'templates')
RAW_DIRS = ['shots/old', 'shots/new', 'inventory/old', 'inventory/new', 'snapshots/old', 'snapshots/new',
            'net', 'js', 'tokens', 'diff', 'report', 'exports/old', 'exports/new']


def git(repo, *args):
    return subprocess.run(['git', '-C', repo] + list(args), capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--repo', default='.')
    ap.add_argument('--parity-dir', default='docs/parity')
    ap.add_argument('--system', default='the old system')
    a = ap.parse_args()

    repo = os.path.abspath(a.repo)
    top = git(repo, 'rev-parse', '--show-toplevel')
    if top.returncode != 0:
        sys.stderr.write('%s is not inside a git repository. Run this in the NEW app\'s repo.\n' % repo)
        sys.exit(2)
    repo = top.stdout.strip()
    pdir = os.path.join(repo, a.parity_dir)
    raw = os.path.join(pdir, '_raw')

    created = []
    for d in [pdir, os.path.join(pdir, 'screens')] + [os.path.join(raw, x) for x in RAW_DIRS]:
        if not os.path.isdir(d):
            os.makedirs(d)
            created.append(os.path.relpath(d, repo) + '/')

    for fn in sorted(os.listdir(TEMPLATES)):
        src = os.path.join(TEMPLATES, fn)
        if fn == 'screen.md':
            dst = os.path.join(pdir, 'screens', '_TEMPLATE.md')
        else:
            dst = os.path.join(pdir, fn)
        if os.path.exists(dst):
            continue
        if fn.endswith('.md'):
            with open(src, encoding='utf-8') as f:
                text = f.read().replace('{{SYSTEM}}', a.system)
            with open(dst, 'w', encoding='utf-8') as f:
                f.write(text)
        else:
            shutil.copyfile(src, dst)
        created.append(os.path.relpath(dst, repo))

    rel_raw = os.path.relpath(raw, repo).replace(os.sep, '/') + '/'
    gi = os.path.join(repo, '.gitignore')
    existing = ''
    if os.path.exists(gi):
        with open(gi, encoding='utf-8') as f:
            existing = f.read()
    if rel_raw not in existing.splitlines() and ('/' + rel_raw) not in existing.splitlines():
        with open(gi, 'a', encoding='utf-8') as f:
            if existing and not existing.endswith('\n'):
                f.write('\n')
            f.write('\n# legacy-app-parity: raw captures from the old system contain real customer data\n%s\n' % rel_raw)
        created.append('.gitignore (+ %s)' % rel_raw)

    probe = os.path.join(rel_raw, 'shots', 'old', 'probe.png')
    ignored = git(repo, 'check-ignore', '-q', probe).returncode == 0
    tracked = git(repo, 'ls-files', rel_raw).stdout.strip()

    print('Parity workspace: %s' % os.path.relpath(pdir, repo))
    for c in created:
        print('  created ' + c)
    if not created:
        print('  (everything already existed, nothing changed)')
    if ignored and not tracked:
        print('OK: git ignores %s, raw captures will never be committed.' % rel_raw)
    else:
        if not ignored:
            print('STOP: git does NOT ignore %s. Fix .gitignore before capturing anything.' % rel_raw)
        if tracked:
            print('STOP: files under %s are already tracked by git:\n%s\nRemove them from the index (git rm --cached) before continuing.' % (rel_raw, tracked))
        sys.exit(1)


if __name__ == '__main__':
    main()
