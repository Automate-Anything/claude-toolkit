#!/usr/bin/env python3
"""
net_schema.py - turn the old system's captured network traffic into a data-model
catalog WITHOUT any customer values: every endpoint (IDs in paths collapsed to
{id}), its methods, query parameter names, request fields, response shape with
value TYPES only, status codes, and which screen action fired it.

Two input styles (use either or both):

  1. An index file written while you work, one JSON object per line:
       {"screen": "S03", "action": "click Save", "reqid": 41, "method": "POST",
        "url": "https://old.example.com/Customer.aspx?id=88", "status": 302,
        "resourceType": "document", "request_file": "net/S03-41.request",
        "response_file": "net/S03-41.response"}
     request_file / response_file are the files the Chrome DevTools MCP
     get_network_request tool wrote via requestFilePath / responseFilePath
     (paths relative to the index file).
  2. A HAR file exported from a browser.

Usage:
  python3 net_schema.py [--index _raw/net/index.jsonl] [--har capture.har]
                        [--md ../data-model.md] [--json _raw/net/schema.json]

Values never reach the output, except short identifier-like values of
framework action fields (__EVENTTARGET, action, cmd, ...), which name the
button or command that posted, not a person. Stdlib only, Python 3.9+.
"""
import argparse
import json
import os
import re
import sys
from collections import OrderedDict
from urllib.parse import parse_qsl, urlsplit

ACTION_FIELDS = re.compile(r'^(__EVENTTARGET|__EVENTARGUMENT|action|cmd|command|mode|op|operation|method|task|event|submit|btn\w*|button\w*)$', re.I)
IDENT_VALUE = re.compile(r'^[A-Za-z0-9_$:.\-/]{1,60}$')
FRAMEWORK_FIELDS = re.compile(r'^(__VIEWSTATE\w*|__EVENTVALIDATION|__PREVIOUSPAGE|__LASTFOCUS|__RequestVerificationToken|csrf\w*|_token|authenticity_token|javax\.faces\.ViewState)$', re.I)


def kind_of(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'boolean'
    if isinstance(v, int):
        return 'integer'
    if isinstance(v, float):
        return 'number'
    if isinstance(v, str):
        s = v.strip()
        if s == '':
            return 'string(empty)'
        if re.match(r'^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$', s):
            return 'string(date-iso)'
        if re.match(r'^/Date\(\-?\d+([+-]\d{4})?\)/$', s):
            return 'string(date-msjson)'
        if re.match(r'^\d{1,2}/\d{1,2}/\d{2,4}( \d{1,2}:\d{2}(:\d{2})?( ?[AP]M)?)?$', s, re.I):
            return 'string(date-slash)'
        if re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', s):
            return 'string(email)'
        if re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', s, re.I):
            return 'string(uuid)'
        if re.match(r'^https?://', s):
            return 'string(url)'
        if re.match(r'^[+(]?[\d\s().\-]{7,}$', s) and sum(c.isdigit() for c in s) >= 7:
            return 'string(phone-like)'
        if re.match(r'^-?\$?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\$?\d+\.\d{2}$', s):
            return 'string(money-like)'
        if re.match(r'^-?\d+(\.\d+)?$', s):
            return 'string(numeric)'
        if s.lower() in ('true', 'false', 'y', 'n', 'yes', 'no', 'on', 'off'):
            return 'string(flag)'
        if len(s) > 200:
            return 'string(long-text)'
        return 'string'
    return type(v).__name__


def shape(v, depth=0):
    """Value-free structure: dict -> {key: shape}, list -> [merged item shape]."""
    if depth > 12:
        return '...'
    if isinstance(v, dict):
        return OrderedDict((k, shape(x, depth + 1)) for k, x in v.items())
    if isinstance(v, list):
        merged = None
        for item in v[:50]:
            merged = merge(merged, shape(item, depth + 1))
        return [merged] if merged is not None else ['(empty list)']
    return kind_of(v)


def merge(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if isinstance(a, dict) and isinstance(b, dict):
        out = OrderedDict()
        for k in list(a.keys()) + [k for k in b.keys() if k not in a]:
            if k in a and k in b:
                out[k] = merge(a[k], b[k])
            else:
                v = a.get(k, b.get(k))
                out[k] = ('optional ' + v) if isinstance(v, str) and not v.startswith('optional') else v
        return out
    if isinstance(a, list) and isinstance(b, list):
        return [merge(a[0] if a else None, b[0] if b else None)]
    if a == b:
        return a
    kinds = sorted(set(str(a).split(' | ')) | set(str(b).split(' | ')))
    return ' | '.join(kinds)


def template_path(path):
    segs = []
    for s in path.split('/'):
        if re.match(r'^\d+$', s):
            segs.append('{id}')
        elif re.match(r'^\d+\.\w{1,5}$', s):
            segs.append('{id}' + s[s.index('.'):])
        elif re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', s, re.I):
            segs.append('{uuid}')
        elif re.match(r'^[0-9a-f]{16,}$', s, re.I) or re.match(r'^[A-Za-z0-9_\-]{20,}$', s) and re.search(r'\d', s):
            segs.append('{token}')
        else:
            segs.append(s)
    return '/'.join(segs)


def read_text(path):
    if not path or not os.path.exists(path):
        return None
    with open(path, 'rb') as f:
        raw = f.read()
    for enc in ('utf-8', 'latin-1'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return None


def html_forms(text):
    """Field names of every <form> in a server-rendered page (old systems post forms)."""
    forms = []
    for m in re.finditer(r'<form\b([^>]*)>(.*?)</form>', text, re.I | re.S):
        attrs, body = m.group(1), m.group(2)
        action = re.search(r'action\s*=\s*["\']?([^"\'\s>]*)', attrs, re.I)
        method = re.search(r'method\s*=\s*["\']?(\w+)', attrs, re.I)
        names = []
        for f in re.finditer(r'<(input|select|textarea|button)\b([^>]*)>', body, re.I):
            nm = re.search(r'\bname\s*=\s*["\']?([^"\'\s>]+)', f.group(2), re.I)
            tp = re.search(r'\btype\s*=\s*["\']?(\w+)', f.group(2), re.I)
            if nm:
                names.append('%s(%s)' % (nm.group(1), (tp.group(1) if tp else f.group(1)).lower()))
        forms.append({'action': template_path(urlsplit(action.group(1)).path) if action else '', 'method': (method.group(1) if method else 'GET').upper(), 'fields': names})
    return forms


def body_shape(text, content_type=''):
    if text is None:
        return None, {}
    t = text.strip()
    ct = (content_type or '').lower()
    notes = {}
    if t.startswith('{') or t.startswith('[') or 'json' in ct:
        try:
            return {'format': 'json', 'shape': shape(json.loads(t))}, notes
        except ValueError:
            pass
    if t.startswith(')]}\'') or t.startswith('while(1);'):
        try:
            return {'format': 'json (guarded)', 'shape': shape(json.loads(t.split('\n', 1)[1]))}, notes
        except (ValueError, IndexError):
            pass
    if '<html' in t[:2000].lower() or '<!doctype html' in t[:200].lower() or 'html' in ct:
        title = re.search(r'<title[^>]*>(.*?)</title>', t, re.I | re.S)
        forms = html_forms(t)
        return {'format': 'html', 'title': re.sub(r'\s+', ' ', title.group(1)).strip()[:120] if title else '', 'forms': forms}, notes
    if t.startswith('<?xml') or t.startswith('<'):
        tags = []
        for m in re.finditer(r'<([A-Za-z_][\w:.\-]*)', t):
            if m.group(1) not in tags:
                tags.append(m.group(1))
            if len(tags) >= 60:
                break
        return {'format': 'xml', 'elements': tags}, notes
    if '=' in t and '\n' not in t[:500] and ('urlencoded' in ct or re.match(r'^[\w.%\-\[\]]+=', t)):
        fields = OrderedDict()
        for k, v in parse_qsl(t, keep_blank_values=True):
            if FRAMEWORK_FIELDS.match(k):
                fields[k] = '(framework state)'
                notes['framework'] = True
            elif ACTION_FIELDS.match(k) and IDENT_VALUE.match(v or ''):
                fields[k] = 'action=' + v
            else:
                fields[k] = kind_of(v)
        return {'format': 'form-urlencoded', 'fields': fields}, notes
    if 'multipart/form-data' in ct or t.startswith('------'):
        names = re.findall(r'name="([^"]+)"', t)
        return {'format': 'multipart', 'fields': list(OrderedDict.fromkeys(names))}, notes
    return {'format': 'text', 'length': len(t)}, notes


def entries_from_index(path):
    base = os.path.dirname(os.path.abspath(path))
    out = []
    with open(path, encoding='utf-8') as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                sys.stderr.write('index line %d is not JSON, skipped\n' % n)
                continue
            rq = os.path.join(base, e['request_file']) if e.get('request_file') else None
            rs = os.path.join(base, e['response_file']) if e.get('response_file') else None
            out.append({
                'screen': e.get('screen', ''), 'action': e.get('action', ''),
                'method': (e.get('method') or 'GET').upper(), 'url': e.get('url', ''),
                'status': e.get('status'), 'type': e.get('resourceType', ''),
                'req_ct': e.get('requestContentType', ''), 'res_ct': e.get('responseContentType', ''),
                'req': read_text(rq), 'res': read_text(rs),
            })
    return out


def entries_from_har(path):
    with open(path, encoding='utf-8') as f:
        har = json.load(f)
    out = []
    for e in har.get('log', {}).get('entries', []):
        rq, rs = e.get('request', {}), e.get('response', {})
        post = rq.get('postData') or {}
        content = rs.get('content') or {}
        text = content.get('text')
        if text and content.get('encoding') == 'base64':
            text = None
        out.append({
            'screen': '', 'action': '', 'method': rq.get('method', 'GET').upper(), 'url': rq.get('url', ''),
            'status': rs.get('status'), 'type': e.get('_resourceType', ''),
            'req_ct': post.get('mimeType', ''), 'res_ct': content.get('mimeType', ''),
            'req': post.get('text'), 'res': text,
        })
    return out


SKIP_EXT = re.compile(r'\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|webp)(\?|$)', re.I)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--index')
    ap.add_argument('--har')
    ap.add_argument('--md', help='write the markdown catalog here (default stdout)')
    ap.add_argument('--json', help='write the structured catalog here')
    ap.add_argument('--include-static', action='store_true', help='keep .js/.css/image requests')
    a = ap.parse_args()
    if not a.index and not a.har:
        ap.error('give --index and/or --har')

    entries = []
    if a.index:
        entries += entries_from_index(a.index)
    if a.har:
        entries += entries_from_har(a.har)

    eps = OrderedDict()
    for e in entries:
        if not a.include_static and SKIP_EXT.search(urlsplit(e['url']).path or ''):
            continue
        u = urlsplit(e['url'])
        key = (u.netloc, template_path(u.path))
        ep = eps.setdefault(key, {'host': u.netloc, 'path': key[1], 'methods': OrderedDict(), 'screens': [], 'actions': []})
        m = ep['methods'].setdefault(e['method'], {'query': [], 'status': [], 'request': None, 'response': None, 'calls': 0})
        m['calls'] += 1
        for k, _ in parse_qsl(u.query, keep_blank_values=True):
            if k not in m['query']:
                m['query'].append(k)
        if e['status'] is not None and e['status'] not in m['status']:
            m['status'].append(e['status'])
        if e['screen'] and e['screen'] not in ep['screens']:
            ep['screens'].append(e['screen'])
        if e['action'] and e['action'] not in ep['actions']:
            ep['actions'].append(e['action'])
        for side, text, ct in (('request', e['req'], e['req_ct']), ('response', e['res'], e['res_ct'])):
            b, _ = body_shape(text, ct)
            if b is None:
                continue
            prev = m[side]
            if prev and prev.get('format') == b.get('format') == 'json':
                prev['shape'] = merge(prev['shape'], b['shape'])
            elif prev and prev.get('format') == b.get('format') == 'form-urlencoded':
                for k, v in b['fields'].items():
                    if k not in prev['fields']:
                        prev['fields'][k] = v
                    elif prev['fields'][k] != v and not str(prev['fields'][k]).startswith('action='):
                        prev['fields'][k] = merge(prev['fields'][k], v)
                    elif str(v).startswith('action=') and v not in str(prev['fields'][k]):
                        prev['fields'][k] = str(prev['fields'][k]) + ' | ' + v
            elif not prev:
                m[side] = b

    lines = ['# Data model from network traffic', '',
             'Generated by net_schema.py from %d captured requests. Values are removed; only names and types are kept.' % len(entries), '']
    framework = False
    for ep in eps.values():
        lines.append('## %s' % ep['path'])
        lines.append('')
        if ep['screens'] or ep['actions']:
            lines.append('- Seen on: %s%s' % (', '.join(ep['screens']) or '-', (' | actions: ' + '; '.join(ep['actions'][:8])) if ep['actions'] else ''))
        for meth, m in ep['methods'].items():
            lines.append('- **%s** x%d, status %s%s' % (meth, m['calls'], ', '.join(str(s) for s in m['status']) or '?',
                                                       (', query: ' + ', '.join(m['query'])) if m['query'] else ''))
            for side in ('request', 'response'):
                b = m[side]
                if not b:
                    continue
                if b['format'].startswith('json'):
                    lines.append('  - %s (%s):' % (side, b['format']))
                    lines.append('')
                    lines.append('    ```json')
                    for ln in json.dumps(b['shape'], indent=2).splitlines():
                        lines.append('    ' + ln)
                    lines.append('    ```')
                    lines.append('')
                elif b['format'] == 'form-urlencoded':
                    if any(str(v) == '(framework state)' for v in b['fields'].values()):
                        framework = True
                    lines.append('  - %s fields: %s' % (side, ', '.join('%s:%s' % (k, v) for k, v in b['fields'].items())))
                elif b['format'] == 'html':
                    # The page <title> can carry a customer name, so it stays in the JSON (raw, git-ignored) only.
                    lines.append('  - %s: server-rendered page' % side)
                    for fm in b.get('forms', []):
                        lines.append('    - form %s %s: %s' % (fm['method'], fm['action'] or '(same page)', ', '.join(fm['fields'][:80])))
                elif b['format'] == 'multipart':
                    lines.append('  - %s multipart fields: %s' % (side, ', '.join(b['fields'])))
                elif b['format'] == 'xml':
                    lines.append('  - %s XML elements: %s' % (side, ', '.join(b['elements'])))
                else:
                    lines.append('  - %s: %s, %s chars' % (side, b['format'], b.get('length', '?')))
        lines.append('')
    if framework:
        lines += ['## Note on framework fields', '',
                  'Requests carry framework state (for example ASP.NET __VIEWSTATE / __EVENTVALIDATION or a CSRF token). '
                  'These are plumbing, not data. The `action=` values on __EVENTTARGET and similar fields name the control '
                  'that posted, which maps each server action to its button.', '']
    report = '\n'.join(lines) + '\n'
    if a.md:
        with open(a.md, 'w', encoding='utf-8') as f:
            f.write(report)
    else:
        sys.stdout.write(report)
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump({'schema': 'legacy-app-parity/net-schema@1', 'endpoints': list(eps.values())}, f, indent=2)


if __name__ == '__main__':
    main()
