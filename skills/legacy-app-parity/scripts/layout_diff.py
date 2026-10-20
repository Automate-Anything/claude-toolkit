#!/usr/bin/env python3
"""
layout_diff.py - compare one screen's inventory from the OLD system with the
same screen in the NEW app, and list every difference a staff member would feel.

Pixels change when the skin is modernized, so this does not diff pixels. It
checks what drives retraining:
  * presence   every visible control in the old screen exists in the new one
  * labels     same words (approved renames come from --renames)
  * placement  each control keeps its position RELATIVE to its neighbours
               (left/right inside a row, above/below inside a column), and does
               not jump to another part of the screen
  * tab order  Tab moves through fields in the same sequence
  * rules      required, max length, input type, select options and their order,
               access keys
  * tables     same columns in the same order
  * text       titles and prominent labels still present

Inputs are the JSON files written by inventory.js (same viewport, same data).

Usage:
  python3 layout_diff.py OLD.json NEW.json [--renames renames.json]
      [--drift 0.08] [--far 0.25] [--include-hidden] [--md out.md] [--json out.json]

Exit code: 0 no blocking differences, 1 blocking differences, 2 bad input.
Stdlib only, Python 3.9+.
"""
import argparse
import difflib
import json
import math
import re
import sys
import unicodedata

GROUPS = {
    'button': 'action', 'link': 'action', 'menuitem': 'action', 'menuitemcheckbox': 'action',
    'menuitemradio': 'action', 'tab': 'action', 'clickable': 'action', 'treeitem': 'action',
    'option': 'action', 'generic': 'action',
    'textbox': 'text', 'searchbox': 'text', 'spinbutton': 'text',
    'combobox': 'choice', 'listbox': 'choice',
    'checkbox': 'check', 'switch': 'check',
    'radio': 'radio', 'slider': 'slider', 'file': 'file',
}


def norm(s):
    s = unicodedata.normalize('NFKC', s or '').lower()
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'^[^\w]+|[^\w]+$', '', s, flags=re.UNICODE)
    return s


def group_of(e):
    return GROUPS.get(e.get('role') or '', 'action')


def center(e):
    r = e['rect']
    return (r['x'] + r['w'] / 2.0, r['y'] + r['h'] / 2.0)


def describe(e):
    lab = e.get('label') or e.get('name') or e.get('id') or '(unlabelled)'
    bits = ['%s "%s"' % (e.get('role'), lab)]
    if e.get('section'):
        bits.append('in "%s"' % e['section'])
    if e.get('menuPath'):
        bits.append('menu "%s"' % e['menuPath'])
    return ' '.join(bits)


def load(path):
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write('cannot read %s: %s\n' % (path, exc))
        sys.exit(2)
    # evaluate_script output saved with filePath may be wrapped; unwrap common shapes.
    if isinstance(data, dict) and 'elements' not in data:
        for k in ('result', 'value', 'data'):
            if isinstance(data.get(k), dict) and 'elements' in data[k]:
                data = data[k]
                break
    if not isinstance(data, dict) or 'elements' not in data:
        sys.stderr.write('%s is not an inventory.js result\n' % path)
        sys.exit(2)
    return data


def prepare(inv, include_hidden):
    els = []
    seen_row_actions = set()
    for e in inv.get('elements', []):
        if e.get('role') == 'hidden' or 'rect' not in e:
            continue
        if not include_hidden and not e.get('visible'):
            continue
        if e.get('rowAction'):
            # Row actions repeat once per data row; the row count depends on data.
            k = (group_of(e), norm(e.get('label')), e.get('colIndex'))
            if k in seen_row_actions:
                continue
            seen_row_actions.add(k)
        e = dict(e)
        e['_label'] = norm(e.get('label'))
        e['_group'] = group_of(e)
        e['_menu'] = norm(e.get('menuPath'))
        els.append(e)
    # Reading order (rows top to bottom, then left to right) for stable occurrence numbering.
    els.sort(key=lambda e: (round(center(e)[1] / 12.0), center(e)[0]))
    return els


def bbox(els):
    if not els:
        return (0, 0, 1, 1)
    xs = [e['rect']['x'] for e in els] + [e['rect']['x'] + e['rect']['w'] for e in els]
    ys = [e['rect']['y'] for e in els] + [e['rect']['y'] + e['rect']['h'] for e in els]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return (x0, y0, max(1, x1 - x0), max(1, y1 - y0))


def normalized_center(e, box):
    cx, cy = center(e)
    return ((cx - box[0]) / box[2], (cy - box[1]) / box[3])


def match(old, new, renames):
    """Return (pairs, unmatched_old, unmatched_new). Each pair is (o, n, how)."""
    pairs = []
    used_o, used_n = set(), set()

    def run(keyfn, how, allow=lambda o, n: True):
        buckets = {}
        for idx, n in enumerate(new):
            if idx in used_n:
                continue
            k = keyfn(n, 'new')
            if k is None:
                continue
            buckets.setdefault(k, []).append(idx)
        for oi, o in enumerate(old):
            if oi in used_o:
                continue
            k = keyfn(o, 'old')
            if k is None or k not in buckets:
                continue
            for ni in buckets[k]:
                if ni not in used_n and allow(o, new[ni]):
                    pairs.append((o, new[ni], how))
                    used_o.add(oi)
                    used_n.add(ni)
                    break

    def renamed(e, side):
        lab = e['_label']
        if side == 'old' and lab in renames:
            return renames[lab]
        return lab

    run(lambda e, s: (e['_group'], e['_label'], e['_menu']) if e['_label'] else None, 'exact')
    run(lambda e, s: (e['_group'], e['_label']) if e['_label'] else None, 'label')
    run(lambda e, s: (e['_group'], renamed(e, s)) if e['_label'] else None, 'renamed')
    run(lambda e, s: (e['_group'], 'name:' + e['name']) if e.get('name') else None, 'name')
    run(lambda e, s: ('any', e['_label']) if e['_label'] else None, 'control-changed')

    # Fuzzy label match inside the same group: a changed label is still the same control.
    for oi, o in enumerate(old):
        if oi in used_o or not o['_label']:
            continue
        best, best_ni = 0.0, None
        for ni, n in enumerate(new):
            if ni in used_n or n['_group'] != o['_group'] or not n['_label']:
                continue
            r = difflib.SequenceMatcher(None, o['_label'], n['_label']).ratio()
            if r > best:
                best, best_ni = r, ni
        if best_ni is not None and best >= 0.72:
            pairs.append((o, new[best_ni], 'fuzzy'))
            used_o.add(oi)
            used_n.add(best_ni)

    return pairs, [o for i, o in enumerate(old) if i not in used_o], [n for i, n in enumerate(new) if i not in used_n]


def overlap(a0, a1, b0, b1):
    return max(0.0, min(a1, b1) - max(a0, b0))


def relation_violations(pairs, neighbours=25):
    """For each matched control, compare its left/right and above/below relation
    with its nearest neighbours in the OLD layout against the NEW layout."""
    flagged = {}
    pts = [center(o) for o, _, _ in pairs]
    for i, (o, n, _) in enumerate(pairs):
        dists = sorted(((math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]), j) for j in range(len(pairs)) if j != i))[:neighbours]
        for _, j in dists:
            o2, n2, _ = pairs[j]
            ro, ro2 = o['rect'], o2['rect']
            same_row = overlap(ro['y'], ro['y'] + ro['h'], ro2['y'], ro2['y'] + ro2['h']) > 0.5 * min(ro['h'], ro2['h'])
            same_col = overlap(ro['x'], ro['x'] + ro['w'], ro2['x'], ro2['x'] + ro2['w']) > 0.5 * min(ro['w'], ro2['w'])
            (ox, oy), (ox2, oy2) = center(o), center(o2)
            (nx, ny), (nx2, ny2) = center(n), center(n2)
            if same_row and not same_col and abs(ox - ox2) > 2:
                if (ox < ox2) != (nx < nx2):
                    flagged.setdefault(i, []).append(('left of' if ox < ox2 else 'right of', j))
            elif same_col and not same_row and abs(oy - oy2) > 2:
                if (oy < oy2) != (ny < ny2):
                    flagged.setdefault(i, []).append(('above' if oy < oy2 else 'below', j))
    return flagged


def lis_keep(seq):
    """Indices (into seq) of a longest increasing subsequence."""
    if not seq:
        return set()
    tails, tails_idx, prev = [], [], [-1] * len(seq)
    import bisect
    for i, v in enumerate(seq):
        k = bisect.bisect_left(tails, v)
        if k == len(tails):
            tails.append(v)
            tails_idx.append(i)
        else:
            tails[k] = v
            tails_idx[k] = i
        prev[i] = tails_idx[k - 1] if k > 0 else -1
    keep, i = set(), tails_idx[-1]
    while i >= 0:
        keep.add(i)
        i = prev[i]
    return keep


def table_key(t):
    return [norm(h) for h in t.get('headers', []) if norm(h)]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('old')
    ap.add_argument('new')
    ap.add_argument('--renames', help='JSON {"old label": "new label"} of APPROVED label changes')
    ap.add_argument('--drift', type=float, default=0.2, help='normalized distance that counts as a noticeable shift (warning)')
    ap.add_argument('--far', type=float, default=0.4, help='normalized distance that counts as moved to another part of the screen (blocking)')
    ap.add_argument('--include-hidden', action='store_true', help='also require hidden controls (closed menus) to exist')
    ap.add_argument('--md', help='write the markdown report here (default: stdout)')
    ap.add_argument('--json', help='write the machine-readable result here')
    a = ap.parse_args()

    old_inv, new_inv = load(a.old), load(a.new)
    renames = {}
    if a.renames:
        with open(a.renames, encoding='utf-8') as f:
            renames = {norm(k): norm(v) for k, v in json.load(f).items()}

    old = prepare(old_inv, a.include_hidden)
    new = prepare(new_inv, a.include_hidden)
    pairs, missing, extra = match(old, new, renames)
    blocking, warnings, info = [], [], []

    ov, nv = old_inv.get('meta', {}).get('viewport'), new_inv.get('meta', {}).get('viewport')
    if ov and nv and (ov.get('w') != nv.get('w') or ov.get('h') != nv.get('h')):
        warnings.append({'kind': 'viewport', 'text': 'Viewports differ (old %sx%s, new %sx%s). Re-capture both at the staff screen size before trusting placement results.' % (ov.get('w'), ov.get('h'), nv.get('w'), nv.get('h'))})

    for o in missing:
        blocking.append({'kind': 'missing', 'text': 'MISSING in new: %s (old position x=%s y=%s)' % (describe(o), o['rect']['x'], o['rect']['y'])})
    for n in extra:
        warnings.append({'kind': 'extra', 'text': 'EXTRA in new (not in old): %s. Fine if intended, but it must not sit where staff expect something else.' % describe(n)})

    for o, n, how in pairs:
        if how in ('fuzzy', 'name') and o['_label'] != n['_label']:
            blocking.append({'kind': 'label', 'text': 'LABEL CHANGED: "%s" -> "%s" (%s). If approved, add it to renames.json.' % (o.get('label'), n.get('label'), o.get('role'))})
        if how == 'renamed':
            info.append({'kind': 'renamed', 'text': 'approved rename "%s" -> "%s"' % (o.get('label'), n.get('label'))})
        if how == 'control-changed':
            warnings.append({'kind': 'control', 'text': 'CONTROL TYPE CHANGED: "%s" was %s, now %s. Check it still works the same with mouse AND keyboard.' % (o.get('label'), o.get('role'), n.get('role'))})
        elif o.get('role') != n.get('role') and how != 'control-changed':
            info.append({'kind': 'role', 'text': '"%s" %s -> %s' % (o.get('label'), o.get('role'), n.get('role'))})
        if o.get('required') != n.get('required') and (o.get('required') or n.get('required')):
            blocking.append({'kind': 'rule', 'text': 'REQUIRED differs on "%s": old %s, new %s' % (o.get('label'), bool(o.get('required')), bool(n.get('required')))})
        om, nm = o.get('maxLength'), n.get('maxLength')
        if om and (not nm or nm != om):
            item = {'kind': 'rule', 'text': 'MAX LENGTH on "%s": old %s, new %s' % (o.get('label'), om, nm or 'none')}
            (blocking if nm and nm < om else warnings).append(item)
        if o.get('type') and n.get('type') and o['type'] != n['type']:
            if o['_group'] == 'action' and {o['type'], n['type']} & {'submit', 'button', 'reset', 'image'}:
                warnings.append({'kind': 'rule', 'text': 'BUTTON TYPE on "%s": old %s, new %s (a submit button sends the form, also when Enter is pressed in a field; check it does exactly what the old one did)' % (o.get('label'), o['type'], n['type'])})
            else:
                warnings.append({'kind': 'rule', 'text': 'INPUT TYPE on "%s": old %s, new %s (date and number pickers change how people type)' % (o.get('label'), o['type'], n['type'])})
        if o.get('accesskey') and o.get('accesskey') != n.get('accesskey'):
            blocking.append({'kind': 'shortcut', 'text': 'ACCESS KEY on "%s": old Alt+%s, new %s' % (o.get('label'), o['accesskey'], ('Alt+' + n['accesskey']) if n.get('accesskey') else 'none')})
        if o.get('options') and n.get('options') is not None:
            oo = [norm(x) for x in o['options']]
            no = [norm(x) for x in n['options']]
            gone = [x for x in oo if x not in no]
            added = [x for x in no if x not in oo]
            if gone:
                blocking.append({'kind': 'options', 'text': 'OPTIONS missing in "%s": %s' % (o.get('label'), ', '.join(gone[:15]))})
            common_o = [x for x in oo if x in no]
            common_n = [x for x in no if x in oo]
            if common_o != common_n:
                blocking.append({'kind': 'options', 'text': 'OPTION ORDER differs in "%s" (people pick by position and by typing the first letter)' % o.get('label')})
            if added:
                warnings.append({'kind': 'options', 'text': 'OPTIONS added in "%s": %s' % (o.get('label'), ', '.join(added[:15]))})
        if bool(o.get('disabled')) != bool(n.get('disabled')):
            warnings.append({'kind': 'state', 'text': 'DISABLED state differs on "%s": old %s, new %s' % (o.get('label'), bool(o.get('disabled')), bool(n.get('disabled')))})
        if bool(o.get('readOnly')) != bool(n.get('readOnly')):
            warnings.append({'kind': 'state', 'text': 'READ-ONLY differs on "%s"' % o.get('label')})

    # Same record on both sides? Fields filled on one side only mean the captures
    # show different data, which makes the comparison unfair.
    filled_mismatch = []
    for o, n, _ in pairs:
        if o['_group'] in ('text', 'choice') or o.get('type') in ('checkbox', 'radio'):
            ov_, nv_ = o.get('value', o.get('hasValue')), n.get('value', n.get('hasValue'))
            if ov_ is not None and nv_ is not None and bool(ov_) != bool(nv_):
                filled_mismatch.append(o.get('label'))
            elif 'value' in o and 'value' in n and o['value'] != n['value']:
                filled_mismatch.append(o.get('label'))
    if filled_mismatch:
        warnings.append({'kind': 'data', 'text': 'DATA DIFFERS: %d field(s) hold different content on the two sides (%s). Capture both with the same record, or treat this comparison as NOT_COMPARABLE (DATA_MISMATCH). If the same record really was loaded, the new screen is not showing data it should.' % (len(filled_mismatch), ', '.join('"%s"' % x for x in filled_mismatch[:6]))})

    # Page-wide keyboard handlers written into the old markup (F-keys, Enter, Esc).
    def keys_in(inv):
        found = {}
        for h in inv.get('pageKeyHandlers', []):
            code = h.get('code', '')
            for m in re.finditer(r'(?:keyCode|which|charCode)\s*===?\s*(\d+)', code):
                found[int(m.group(1))] = code
            for m in re.finditer(r'\bkey\s*===?\s*[\'"](\w+)[\'"]', code):
                found[m.group(1)] = code
        return found
    names = {13: 'Enter', 27: 'Esc', 9: 'Tab'}
    names.update({112 + i: 'F%d' % (i + 1) for i in range(12)})
    old_keys, new_keys = keys_in(old_inv), keys_in(new_inv)
    for k in old_keys:
        label = names.get(k, k) if isinstance(k, int) else k
        if k not in new_keys and label not in new_keys:
            warnings.append({'kind': 'shortcut', 'text': 'SHORTCUT to verify: the old page handles %s (keyCode %s) in its markup: "%s". Not found in the new page markup. New apps often attach key handlers in code, which the inventory cannot see: press %s on the new screen (press_key) and confirm it does the same thing.' % (label, k, old_keys[k][:80], label)})

    # Placement relative to neighbours. Every flipped relation is an edge between
    # two controls. Blame the end with more flipped edges (the one that moved);
    # equal counts on both ends means the two swapped places.
    flagged = relation_violations(pairs)
    edges = {}
    for i, rel in flagged.items():
        for r, j in rel:
            key = (min(i, j), max(i, j))
            if key not in edges:
                edges[key] = (i, r, j)
    degree = {}
    for a_, b_ in edges:
        degree[a_] = degree.get(a_, 0) + 1
        degree[b_] = degree.get(b_, 0) + 1
    moved, swaps = {}, []
    for (a_, b_), (i, r, j) in sorted(edges.items()):
        if degree[a_] == degree[b_]:
            swaps.append('"%s" and "%s" swapped places (old: "%s" was %s "%s")' % (
                pairs[a_][0].get('label'), pairs[b_][0].get('label'), pairs[i][0].get('label'), r, pairs[j][0].get('label')))
        else:
            mover, other = (a_, b_) if degree[a_] > degree[b_] else (b_, a_)
            rel_text = r if mover == i else {'left of': 'right of', 'right of': 'left of', 'above': 'below', 'below': 'above'}[r]
            moved.setdefault(mover, []).append('was %s "%s"' % (rel_text, pairs[other][0].get('label')))
    for i, rels in sorted(moved.items()):
        more = ' and %d more' % (len(rels) - 4) if len(rels) > 4 else ''
        blocking.append({'kind': 'placement', 'text': 'MOVED relative to neighbours: "%s" (%s%s)' % (pairs[i][0].get('label'), ', '.join(rels[:4]), more)})
    for s in swaps:
        blocking.append({'kind': 'placement', 'text': 'ORDER CHANGED: ' + s})

    # A re-spaced modern skin shifts everything a little; that is expected when the
    # neighbour relations above hold. Only a large jump is reported per control.
    obox, nbox = bbox([p[0] for p in pairs]), bbox([p[1] for p in pairs])
    small_shifts = []
    for o, n, _ in pairs:
        (ox, oy), (nx, ny) = normalized_center(o, obox), normalized_center(n, nbox)
        d = math.hypot(ox - nx, oy - ny)
        if d > a.far:
            blocking.append({'kind': 'placement', 'text': 'MOVED to another part of the screen: "%s" (%.0f%% of the screen away)' % (o.get('label'), d * 100)})
        elif d > a.drift:
            warnings.append({'kind': 'drift', 'text': 'SHIFTED: "%s" by %.0f%% of the screen. Same neighbours, but check it still feels in the same spot.' % (o.get('label'), d * 100)})
        elif d > 0.05:
            small_shifts.append(d)
    if small_shifts:
        info.append({'kind': 'drift', 'text': '%d controls shifted by up to %.0f%% of the screen with their neighbours unchanged (normal for a re-spaced skin)' % (len(small_shifts), max(small_shifts) * 100)})

    # Tab order: compare the sequence, and say what each out-of-place field now follows.
    tab_pairs = [(o, n) for o, n, _ in pairs if o.get('tabOrder') is not None and n.get('tabOrder') is not None]
    tab_pairs.sort(key=lambda p: p[0]['tabOrder'])
    keep = lis_keep([p[1]['tabOrder'] for p in tab_pairs])
    new_seq = sorted(tab_pairs, key=lambda p: p[1]['tabOrder'])
    for k, (o, n) in enumerate(tab_pairs):
        if k not in keep:
            before_old = tab_pairs[k - 1][0].get('label') if k > 0 else '(start of page)'
            j = new_seq.index((o, n))
            before_new = new_seq[j - 1][0].get('label') if j > 0 else '(start of page)'
            blocking.append({'kind': 'tab', 'text': 'TAB ORDER: pressing Tab now reaches "%s" after "%s" (old: after "%s")' % (o.get('label'), before_new, before_old)})
    for o, n, _ in pairs:
        if o.get('tabOrder') is not None and n.get('tabOrder') is None and o['_group'] in ('text', 'choice', 'check', 'radio'):
            blocking.append({'kind': 'tab', 'text': 'TAB ORDER: "%s" can no longer be reached with Tab' % o.get('label')})

    # Data tables.
    new_tables = list(new_inv.get('tables', []))
    for t in old_inv.get('tables', []):
        ok = table_key(t)
        if not ok:
            continue
        best, best_t = 0.0, None
        for nt in new_tables:
            nk = table_key(nt)
            if not nk:
                continue
            j = len(set(ok) & set(nk)) / float(len(set(ok) | set(nk)))
            if j > best:
                best, best_t = j, nt
        title = t.get('caption') or t.get('section') or ', '.join(t.get('headers', [])[:3])
        if best_t is None or best < 0.4:
            blocking.append({'kind': 'table', 'text': 'DATA TABLE missing: "%s" with columns %s' % (title, ', '.join(t.get('headers', [])))})
            continue
        nk = table_key(best_t)
        gone = [h for h in ok if h not in nk]
        if gone:
            blocking.append({'kind': 'table', 'text': 'COLUMNS missing in "%s": %s' % (title, ', '.join(gone))})
        common_o = [h for h in ok if h in nk]
        common_n = [h for h in nk if h in ok]
        if common_o != common_n:
            blocking.append({'kind': 'table', 'text': 'COLUMN ORDER differs in "%s": old %s / new %s' % (title, ' | '.join(common_o), ' | '.join(common_n))})
        added = [h for h in nk if h not in ok]
        if added:
            warnings.append({'kind': 'table', 'text': 'COLUMNS added in "%s": %s' % (title, ', '.join(added))})
        lost_sort = [h for h in t.get('sortableHeaders', []) if norm(h) not in [norm(x) for x in best_t.get('sortableHeaders', [])]]
        if lost_sort and best_t.get('sortableHeaders') is not None:
            warnings.append({'kind': 'table', 'text': 'SORTING may be lost on "%s" columns: %s (verify by clicking)' % (title, ', '.join(lost_sort))})

    # Titles and prominent text.
    new_texts = {norm(h.get('text')) for h in new_inv.get('headings', []) + new_inv.get('textBlocks', [])}
    new_texts |= {e['_label'] for e in new}
    control_labels = {e['_label'] for e in old}  # label changes are already reported per control
    for h in old_inv.get('headings', []) + old_inv.get('textBlocks', []):
        t = norm(h.get('text'))
        if t and t not in new_texts and t not in control_labels and len(t) <= 60:
            warnings.append({'kind': 'text', 'text': 'TEXT not found in new: "%s" (a title or label staff may look for; ignore if it is record data)' % h.get('text')})
    if norm(old_inv.get('meta', {}).get('title')) != norm(new_inv.get('meta', {}).get('title')):
        info.append({'kind': 'title', 'text': 'page title "%s" -> "%s"' % (old_inv.get('meta', {}).get('title'), new_inv.get('meta', {}).get('title'))})

    # De-duplicate identical lines.
    def dedupe(items):
        seen, outl = set(), []
        for it in items:
            if it['text'] not in seen:
                seen.add(it['text'])
                outl.append(it)
        return outl
    blocking, warnings, info = dedupe(blocking), dedupe(warnings), dedupe(info)

    total_old = len(old)
    verdict = 'PASS' if not blocking else 'FAIL'
    lines = [
        '# Layout diff',
        '',
        '- Old: %s (%s)' % (old_inv.get('meta', {}).get('url'), a.old),
        '- New: %s (%s)' % (new_inv.get('meta', {}).get('url'), a.new),
        '- Verdict: **%s** - %d blocking, %d warnings, %d of %d old controls matched (%.0f%%)' % (
            verdict, len(blocking), len(warnings), len(pairs), total_old, (100.0 * len(pairs) / total_old) if total_old else 100.0),
        '',
        '## Blocking (fix, or get an approved exception recorded in decisions.md)',
    ]
    lines += ['- ' + b['text'] for b in blocking] or ['- none']
    lines += ['', '## Warnings (look at each one)']
    lines += ['- ' + w['text'] for w in warnings] or ['- none']
    if info:
        lines += ['', '## Notes'] + ['- ' + i['text'] for i in info]
    report = '\n'.join(lines) + '\n'

    if a.md:
        with open(a.md, 'w', encoding='utf-8') as f:
            f.write(report)
    else:
        sys.stdout.write(report)
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump({
                'schema': 'legacy-app-parity/layout-diff@1',
                'old': a.old, 'new': a.new, 'verdict': verdict,
                'counts': {'oldControls': total_old, 'newControls': len(new), 'matched': len(pairs),
                           'blocking': len(blocking), 'warnings': len(warnings)},
                'blocking': blocking, 'warnings': warnings, 'notes': info,
            }, f, indent=2)
    sys.exit(1 if blocking else 0)


if __name__ == '__main__':
    main()
