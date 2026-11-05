#!/usr/bin/env python3
"""
state_diff.py - what did ONE action change on a screen?

Take an inventory (inventory.js, ideally with includeValues true on sandbox
data) BEFORE an action, perform the action (pick a dropdown value, tick a box,
type in a field, click Calculate), take another inventory AFTER, then run this.
The difference IS the behavior: fields that became enabled, disabled, required,
visible, hidden, re-filled, re-calculated, options that changed (cascading
dropdowns), messages that appeared.

Usage:
  python3 state_diff.py BEFORE.json AFTER.json [--action "picked State = Texas"] [--md out.md]
Stdlib only, Python 3.9+.
"""
import argparse
import json
import re
import sys
import unicodedata


def norm(s):
    s = unicodedata.normalize('NFKC', s or '').lower()
    return re.sub(r'\s+', ' ', s).strip(' :*')


def load(path):
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    if isinstance(d, dict) and 'elements' not in d:
        for k in ('result', 'value', 'data'):
            if isinstance(d.get(k), dict) and 'elements' in d[k]:
                return d[k]
    if not isinstance(d, dict) or 'elements' not in d:
        sys.stderr.write('%s is not an inventory.js result\n' % path)
        sys.exit(2)
    return d


def keyed(inv):
    out, counts = {}, {}
    for e in inv['elements']:
        if e.get('role') == 'hidden':
            base = ('hidden', e.get('name') or e.get('id') or '')
        else:
            base = (e.get('role'), norm(e.get('label')) or ('name:' + (e.get('name') or e.get('id') or '')), e.get('framePath', ''))
        n = counts.get(base, 0)
        counts[base] = n + 1
        out[base + (n,)] = e
    return out


FIELDS = [('visible', 'visibility'), ('disabled', 'enabled/disabled'), ('readOnly', 'read-only'), ('required', 'required'),
          ('value', 'value'), ('checked', 'checked'), ('selected', 'selection'), ('hasValue', 'filled'), ('options', 'options'),
          ('maxLength', 'max length')]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('before')
    ap.add_argument('after')
    ap.add_argument('--action', default='(action not described)')
    ap.add_argument('--md')
    a = ap.parse_args()
    b, c = load(a.before), load(a.after)
    kb, kc = keyed(b), keyed(c)
    lines = ['# State change: %s' % a.action, '',
             '- Before: %s' % b.get('meta', {}).get('url'), '- After: %s' % c.get('meta', {}).get('url'), '']
    if b.get('meta', {}).get('url') != c.get('meta', {}).get('url'):
        lines += ['**The action navigated or posted back** (URL changed). Record it as a page transition as well as the field changes below.', '']
    if not (b.get('meta', {}).get('options', {}).get('includeValues') and c.get('meta', {}).get('options', {}).get('includeValues')):
        lines += ['_Values were not captured (includeValues false), so value and recalculation changes are invisible. Use includeValues true on sandbox data._', '']
    changes = []
    for k, e in kb.items():
        if k not in kc:
            if e.get('role') != 'hidden' and e.get('visible'):
                changes.append('REMOVED: %s "%s"' % (e.get('role'), e.get('label')))
            continue
        f = kc[k]
        for field, word in FIELDS:
            if e.get(field) != f.get(field) and not (e.get(field) in (None, False, '') and f.get(field) in (None, False, '')):
                flips = {'disabled': ('DISABLED', 'ENABLED'), 'visible': ('SHOWN', 'HIDDEN'), 'required': ('REQUIRED', 'OPTIONAL'),
                         'readOnly': ('READ-ONLY', 'EDITABLE'), 'checked': ('CHECKED', 'UNCHECKED')}
                if field in flips and isinstance(f.get(field), bool) or field in flips and f.get(field) is None:
                    on, off = flips[field]
                    changes.append('BECAME %s: %s "%s"' % (on if f.get(field) else off, e.get('role'), e.get('label')))
                elif field == 'options':
                    gone = [x for x in (e.get('options') or []) if x not in (f.get('options') or [])]
                    new = [x for x in (f.get('options') or []) if x not in (e.get('options') or [])]
                    changes.append('OPTIONS CHANGED on "%s": %d removed, %d added (e.g. -%s / +%s)' % (e.get('label'), len(gone), len(new), gone[:3], new[:3]))
                else:
                    changes.append('%s CHANGED on %s "%s": %r -> %r' % (word.upper(), e.get('role'), e.get('label'), e.get(field), f.get(field)))
    for k, f in kc.items():
        if k not in kb and f.get('role') != 'hidden' and f.get('visible'):
            changes.append('APPEARED: %s "%s"' % (f.get('role'), f.get('label')))
    old_text = {norm(t.get('text')) for t in b.get('textBlocks', []) + b.get('headings', [])}
    new_text = {norm(t.get('text')) for t in c.get('textBlocks', []) + c.get('headings', [])}
    for t in c.get('textBlocks', []) + c.get('headings', []):
        if norm(t.get('text')) not in old_text:
            changes.append('TEXT APPEARED: "%s" (often a validation or confirmation message: record its exact wording and position)' % t.get('text'))
    for t in b.get('textBlocks', []) + b.get('headings', []):
        if norm(t.get('text')) not in new_text:
            changes.append('TEXT DISAPPEARED: "%s"' % t.get('text'))
    lines += ['## Changes (%d)' % len(changes)] + (['- ' + x for x in changes] or ['- none detected. If something visibly changed, it may be in a cross-origin frame, a canvas, or a value (capture with includeValues).'])
    report = '\n'.join(lines) + '\n'
    if a.md:
        with open(a.md, 'w', encoding='utf-8') as fh:
            fh.write(report)
    else:
        sys.stdout.write(report)


if __name__ == '__main__':
    main()
