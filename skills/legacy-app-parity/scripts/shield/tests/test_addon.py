"""Unit tests for shield_addon with mitmproxy's own test helpers (no network).
Run: <shield venv python> -m unittest discover -s tests -v   (from scripts/shield)"""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from mitmproxy import http  # noqa: E402
from mitmproxy.test import taddons, tflow  # noqa: E402

import shield_addon  # noqa: E402

SAFE = dict(listen_host="127.0.0.1", rawtcp=False, http3=False, ssl_insecure=False, connection_strategy="lazy",
            anticomp=True, upstream_cert=False)


def make_shield(tmp):
    cfg = {"version": 1, "targets": ["app.crm.test"], "log_dir": os.path.join(tmp, "logs")}
    return shield_addon.Shield(cfg, "run-test", tmp)


def flow(method="GET", host="app.crm.test", path="/clients", body=b"", headers=None, scheme="https"):
    f = tflow.tflow(resp=False)
    f.request.method = method
    f.request.scheme = scheme
    f.request.host = host
    f.request.port = 443
    f.request.path = path
    f.request.headers.clear()
    f.request.headers["host"] = host
    for k, v in (headers or {}).items():
        f.request.headers[k] = v
    f.request.content = body
    return f


def respond(f, body: bytes, ctype: str, status=200, headers=None):
    f.response = http.Response.make(status, body, {"content-type": ctype, **(headers or {})})
    return f


class Options(unittest.TestCase):
    def test_safe_options_pass_and_unsafe_fail(self):
        """Same option set the launcher builds (DumpMaster), then each unsafe value."""
        from mitmproxy import options
        from mitmproxy.tools.dump import DumpMaster

        async def check(extra):
            m = DumpMaster(options.Options(listen_host="127.0.0.1", mode=["regular"]), with_termlog=False, with_dumper=False)
            m.options.update(**{k: v for k, v in SAFE.items() if k != "listen_host"})
            m.options.update(**extra)
            return shield_addon.check_options(m.options)

        self.assertEqual(asyncio.run(check({})), [])
        for bad in (dict(rawtcp=True), dict(ignore_hosts=["x"]), dict(stream_large_bodies="1m"), dict(ssl_insecure=True),
                    dict(listen_host=""), dict(http3=True), dict(connection_strategy="eager"), dict(allow_hosts=["y"])):
            self.assertTrue(asyncio.run(check(bad)), bad)

    def test_configure_hook_sets_fatal(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = make_shield(tmp)
            with taddons.context(s) as tctx:
                tctx.configure(s, listen_host="")
                self.assertTrue(s.fatal)

    def test_fatal_blocks_everything(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = make_shield(tmp)
            s.fatal = "unsafe proxy options"
            f = flow("GET", path="/clients")
            s.requestheaders(f)
            self.assertEqual(f.response.status_code, 403)


class Requests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = make_shield(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_both(self, f):
        self.s.requestheaders(f)
        if f.response is None or f.metadata.get("shield_served"):
            pass
        asyncio.run(self.s.request(f))
        return f

    def test_read_allowed_and_unmarked(self):
        f = self.run_both(flow("GET", path="/clients"))
        self.assertIsNone(f.response)
        self.assertNotIn("shield_blocked", f.metadata)

    def test_write_blocked_and_logged_as_dry_run(self):
        f = self.run_both(flow("POST", path="/api/clients/1", body=b'{"firstName":"Zebulon"}',
                               headers={"content-type": "application/json", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty"}))
        self.assertEqual(f.response.status_code, 403)
        self.assertEqual(f.response.headers["X-Parity-Shield"], "blocked")
        logs = os.path.join(self.tmp.name, "logs")
        with open(os.path.join(logs, "blocks.jsonl")) as fh:
            entry = json.loads(fh.readline())
        self.assertEqual(entry["kind"], "write")
        with open(os.path.join(logs, "dryrun", "00001.body"), "rb") as fh:
            body = fh.read()
        self.assertNotIn(b"Zebulon", body)
        self.assertIn(b"firstName", body)
        for name in os.listdir(logs):
            p = os.path.join(logs, name)
            if os.path.isfile(p):
                self.assertEqual(os.stat(p).st_mode & 0o777, 0o600, name)

    def test_navigation_block_is_html_and_never_401(self):
        f = self.run_both(flow("POST", path="/Client.aspx", body=b"a=1",
                               headers={"content-type": "application/x-www-form-urlencoded", "sec-fetch-mode": "navigate",
                                        "sec-fetch-dest": "document"}))
        self.assertEqual(f.response.status_code, 403)
        self.assertIn(b"read-only shield", f.response.content)

    def test_exception_in_decision_ends_blocked(self):
        with mock.patch.object(self.s, "_decide", side_effect=RuntimeError("boom")):
            f = flow("GET", path="/clients")
            self.s.requestheaders(f)
            self.assertEqual(f.response.status_code, 403)
            f2 = flow("GET", path="/clients")
            asyncio.run(self.s.request(f2))
            self.assertEqual(f2.response.status_code, 403)
        with open(os.path.join(self.tmp.name, "logs", "errors.log")) as fh:
            line = fh.read()
        self.assertIn("RuntimeError", line)
        self.assertNotIn("boom", line)  # exception text never logged

    def test_magic_status_served_locally(self):
        f = flow("GET", host="parity-shield.invalid", path="/status")
        self.s.requestheaders(f)
        self.assertEqual(f.response.status_code, 200)
        self.assertEqual(json.loads(f.response.content)["run"], "run-test")
        f = flow("GET", path="/__parity_shield/mask.js")
        self.s.requestheaders(f)
        self.assertIn(b"__parityMask", f.response.content)
        self.assertNotIn(b"__SALT__", f.response.content)
        f = flow("POST", host="parity-shield.invalid", path="/status", body=b"x")
        self.s.requestheaders(f)
        self.assertEqual(f.response.status_code, 405)

    def test_login_window_control_file(self):
        ctl = os.path.join(self.tmp.name, "control.json")
        import time
        with open(ctl, "w") as fh:
            json.dump({"login": {"host": "app.crm.test", "until": time.time() + 60}}, fh)
        os.chmod(ctl, 0o644)  # group/world readable: ignored (fail closed)
        f = self.run_both(flow("POST", path="/login", body=b"u=a&password=b"))
        self.assertEqual(f.response.status_code, 403)
        os.chmod(ctl, 0o600)
        os.utime(ctl, None)
        self.s._control_mtime = None
        f = self.run_both(flow("POST", path="/login", body=b"u=a&password=b"))
        self.assertIsNone(f.response)
        with open(os.path.join(self.tmp.name, "logs", "login_observed.jsonl")) as fh:
            self.assertNotIn("password", fh.read())


class Responses(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = make_shield(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_json_masked_and_not_cached(self):
        f = respond(flow(path="/api/clients"), json.dumps({"firstName": "Zebulon", "id": 7}).encode(), "application/json")
        self.s.response(f)
        self.assertEqual(f.response.status_code, 200)
        self.assertNotIn(b"Zebulon", f.response.content)
        self.assertIn(b'"id":7', f.response.content)
        self.assertEqual(f.response.headers["cache-control"], "no-store")

    def test_html_masked_and_script_injected_with_nonce(self):
        html = b'<html><head><title>x</title></head><body><input type="text" value="Zebulon"></body></html>'
        f = respond(flow(path="/client"), html, "text/html; charset=utf-8",
                    headers={"content-security-policy": "default-src 'self'; script-src 'nonce-abc123' 'strict-dynamic'"})
        self.s.response(f)
        body = f.response.content
        self.assertNotIn(b"Zebulon", body)
        self.assertIn(b'<script src="/__parity_shield/mask.js?r=run-test" nonce="abc123"></script>', body)
        self.assertIn("/__parity_shield/", f.response.headers["content-security-policy"])

    def test_meta_csp_patched(self):
        html = b'<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"></head><body></body></html>'
        f = respond(flow(path="/client"), html, "text/html")
        self.s.response(f)
        self.assertIn(b"script-src 'self' https://app.crm.test/__parity_shield/", f.response.content)

    def test_images_from_record_paths_withheld_static_allowed(self):
        f = respond(flow(path="/documents/5/scan.png"), b"\x89PNG\r\n\x1a\n...", "image/png")
        self.s.response(f)
        self.assertEqual(f.response.status_code, 403)
        f = respond(flow(path="/assets/logo.png"), b"\x89PNG\r\n\x1a\n...", "image/png")
        self.s.response(f)
        self.assertEqual(f.response.status_code, 200)

    def test_pdf_and_sse_withheld(self):
        for path, body, ct in (("/statement/3", b"%PDF-1.4", "application/pdf"), ("/events", b"data: x\n\n", "text/event-stream")):
            f = respond(flow(path=path), body, ct)
            self.s.response(f)
            self.assertEqual(f.response.status_code, 403, path)

    def test_code_passthrough(self):
        js = b'!function(){var a={firstName:"literal in code"}}();'
        f = respond(flow(path="/static/app.3f9a.js"), js, "application/javascript")
        self.s.response(f)
        self.assertEqual(f.response.content, js)

    def test_mask_failure_withholds(self):
        f = respond(flow(path="/api/clients"), b'{"firstName":"Zebulon"}', "application/json")
        with mock.patch.object(self.s.masker, "mask_json_text", side_effect=ValueError("bad")):
            self.s.response(f)
        self.assertEqual(f.response.status_code, 502)
        self.assertNotIn(b"Zebulon", f.response.content)

    def test_location_and_disposition_masked(self):
        f = respond(flow(path="/x"), b"", "text/html", status=302,
                    headers={"location": "/clients/77?email=zeb@q.com", "content-disposition": 'attachment; filename="Zebulon Q.pdf"'})
        self.s.response(f)
        self.assertNotIn("zeb@q.com", f.response.headers["location"])
        self.assertIn("/clients/77", f.response.headers["location"])
        self.assertNotIn("Zebulon", f.response.headers["content-disposition"])

    def test_gzip_body_decoded_and_masked(self):
        import gzip
        raw = gzip.compress(json.dumps({"lastName": "Quartermaine"}).encode())
        f = respond(flow(path="/api/c"), raw, "application/json", headers={"content-encoding": "gzip"})
        self.s.response(f)
        self.assertNotIn(b"Quartermaine", f.response.raw_content)
        self.assertNotIn("content-encoding", f.response.headers)


class WebSockets(unittest.TestCase):
    def test_client_frames_dropped_server_frames_masked(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = make_shield(tmp)
            f = tflow.twebsocketflow()
            f.websocket.messages[-1].from_client = True
            s.websocket_message(f)
            self.assertTrue(f.websocket.messages[-1].dropped)
            from mitmproxy.websocket import WebSocketMessage
            from wsproto.frame_protocol import Opcode
            f.websocket.messages.append(WebSocketMessage(Opcode.TEXT, False, json.dumps({"email": "zeb@q.com"}).encode()))
            s.websocket_message(f)
            self.assertNotIn("zeb@q.com", f.websocket.messages[-1].text)


if __name__ == "__main__":
    unittest.main()
