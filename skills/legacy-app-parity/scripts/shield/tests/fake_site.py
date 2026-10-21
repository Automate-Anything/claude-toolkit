"""fake_site.py - a fake CRM for the shield self-test. HTTPS on 127.0.0.1 with a
generated test certificate. Seeded with canary client data, it records every
request that reaches it, so the self-test can prove that nothing but reads
ever arrived and that no canary ever reached the browser unmasked."""
import json
import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CANARIES = ["Zebulon", "Quartermaine", "Ophelia", "Vandersnoot", "123-45-6789", "canary-mail", "231-7788",
            "Canary Lane", "000123456789", "021000021", "4111111111111111", "Lost his job"]
CREDENTIAL_CANARY = "Hunter2-CANARY-PW"

CLIENTS = {
    "clients": [{
        "id": 1, "firstName": "Zebulon", "lastName": "Quartermaine", "ssn": "123-45-6789",
        "email": "zebulon.q@canary-mail.com", "phone": "(646) 231-7788", "address": {"street": "1234 Canary Lane"},
        "bankAccountNumber": "000123456789", "routingNumber": "021000021", "card": "4111111111111111",
        "notes": "Lost his job in March", "balance": 1520.55, "status": "Enrolled",
    }],
    "d": json.dumps({"spouseName": "Ophelia Vandersnoot"}),
}

APP = """<!doctype html><html><head><meta charset="utf-8"><title>Client Zebulon Quartermaine - CRM Test</title></head>
<body>
<!-- note for Zebulon Quartermaine, SSN 123-45-6789 -->
<h1>Client details</h1>
<nav><a href="/clients/1">Zebulon Quartermaine</a> | <a href="/clients">Client List</a></nav>
<ul><li><a href="/clients/2">Ophelia Vandersnoot</a></li></ul>
<div class="hdr"><span>QUARTERMAINE, ZEBULON</span></div>
<table><thead><tr><th>Client Name</th><th>SSN</th><th>Status</th></tr></thead>
<tbody><tr><td>Ophelia Vandersnoot</td><td>123-45-6789</td><td>Active</td></tr></tbody></table>
<dl><dt>Email</dt><dd>zebulon.q@canary-mail.com</dd><dt>Phone</dt><dd>(646) 231-7788</dd></dl>
<label for="nm">Full name</label><input id="nm" type="text" value="Zebulon Quartermaine">
<textarea id="ta">Lost his job in March</textarea>
<a id="ml" href="mailto:zebulon.q@canary-mail.com">Email client</a>
<span aria-label="Ophelia Vandersnoot profile">P</span>
<button type="button">Save</button>
<input type="hidden" name="payload" value='{"spouse":"Ophelia Vandersnoot","ssn":"123-45-6789"}'>
<div id="list"></div><pre id="results"></pre>
<form id="f" method="post" action="/api/form" target="fr"><input name="custname" value="Zebulon">
<input type="password" name="password" value="%(cred)s"></form>
<iframe name="fr" style="display:none"></iframe>
<script nonce="N0nce">
(async () => {
  const R = {};
  const t = async (name, fn) => { try { const r = await fn(); R[name] = (r && r.status !== undefined) ? r.status : String(r); } catch (e) { R[name] = 'error'; } };
  const data = await (await fetch('/api/clients')).json();
  console.log('clients', JSON.stringify(data));
  document.getElementById('list').innerHTML = data.clients.map(c => '<div class="value">' + c.firstName + ' ' + c.lastName + '</div>').join('');
  const data2 = await (await fetch('/api/clients')).json();
  window.__stable = data.clients[0].lastName === data2.clients[0].lastName && data.clients[0].lastName.length > 0;
  await t('post', () => fetch('/api/clients/1', {method: 'POST', body: JSON.stringify({firstName: 'Zebulon', password: '%(cred)s'}), headers: {'content-type': 'application/json'}}));
  await t('put', () => fetch('/api/clients/1', {method: 'PUT', body: 'x'}));
  await t('patch', () => fetch('/api/clients/1', {method: 'PATCH', body: 'x'}));
  await t('delete', () => fetch('/api/clients/1', {method: 'DELETE'}));
  await t('custom', () => fetch('/api/clients/1', {method: 'FOO'}));
  await t('override', () => fetch('/api/clients/1', {headers: {'X-HTTP-Method-Override': 'DELETE'}}));
  await t('void_get', () => fetch('/api/void?id=1'));
  await t('delete_get', () => fetch('/api/clients/1/delete'));
  await t('method_param', () => fetch('/api/clients/1?_method=DELETE'));
  await t('keepalive', () => fetch('/api/keepalive-post', {method: 'POST', body: 'k', keepalive: true}));
  R.beacon = String(navigator.sendBeacon('/api/beacon', 'b'));
  await t('thirdparty', () => fetch('https://example.com/collect', {method: 'POST', mode: 'no-cors', body: 'x'}));
  try { const ws = new WebSocket('wss://' + location.host + '/ws'); ws.onerror = () => { R.ws = 'error'; }; ws.onopen = () => { R.ws = 'open'; ws.send('hello'); }; } catch (e) { R.ws = 'threw'; }
  document.getElementById('f').submit();
  await new Promise(r => setTimeout(r, 2000));
  document.getElementById('results').textContent = JSON.stringify(R);
  window.__results = R; window.__done = true;
})();
</script></body></html>"""

CSP_PAGES = {
    "/csp/nonce": ("script-src 'nonce-Abc123' 'strict-dynamic'", True),
    "/csp/hash": ("script-src 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='", True),
    "/csp/strict": ("script-src 'strict-dynamic' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='", False),
    "/csp/meta": (None, True),
}
CSP_BODY = ("<!doctype html><html><head><meta charset='utf-8'>%s<title>Clients</title></head><body><h2>Clients</h2>"
            "<table><thead><tr><th>Client Name</th></tr></thead><tbody><tr><td>Ophelia Vandersnoot</td></tr></tbody></table>"
            "</body></html>")


class Recorder:
    def __init__(self):
        self.lock = threading.Lock()
        self.requests = []

    def add(self, method, path, body_len):
        with self.lock:
            self.requests.append({"method": method, "path": path, "body_len": body_len})


def make_handler(rec: Recorder):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def _send(self, status, body: bytes, ctype="text/plain", extra=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _any(self):
            n = int(self.headers.get("content-length", "0") or 0)
            if n:
                self.rfile.read(n)
            rec.add(self.command, self.path, n)
            path = self.path.split("?")[0]
            if self.command not in ("GET", "HEAD"):
                return self._send(200, b'{"saved":true}', "application/json")
            if path == "/app":
                return self._send(200, (APP % {"cred": CREDENTIAL_CANARY}).encode(), "text/html; charset=utf-8",
                                  {"Content-Security-Policy": "default-src 'self'; script-src 'nonce-N0nce' 'self'; "
                                                              "connect-src 'self' https://example.com wss:; frame-src 'self'"})
            if path == "/api/clients":
                return self._send(200, json.dumps(CLIENTS).encode(), "application/json")
            if path in CSP_PAGES:
                policy, _ = CSP_PAGES[path]
                meta = "" if policy else "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'self'\">"
                extra = {"Content-Security-Policy": policy} if policy else {}
                return self._send(200, (CSP_BODY % meta).encode(), "text/html; charset=utf-8", extra)
            return self._send(404, b"not found")

        do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_FOO = _any

    return H


def start(cert_file: str, key_file: str):
    rec = Recorder()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(rec))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_file, key_file)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1], rec
