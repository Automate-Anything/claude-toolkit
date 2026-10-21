"""
shield_addon.py - the mitmproxy addon that enforces read-only access and masks
client identifiers. Loaded only by shield_run.py (never with `mitmdump -s`,
which would hot-reload and fail open if the file broke).

Every hook is block-first: its first act puts a block (or a withheld response)
in place, and only a completed allow decision or a completed mask removes it.
An exception anywhere therefore ends blocked, never forwarded.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import time
import traceback
from datetime import datetime, timezone

from mitmproxy import ctx, http
from mitmproxy.net import encoding

import shield_core as core

HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = "1"

REQUIRED_OPTIONS = {
    "listen_host": "127.0.0.1",
    "mode": ["regular"],
    "stream_large_bodies": None,
    "ignore_hosts": [],
    "allow_hosts": [],
    "tcp_hosts": [],
    "udp_hosts": [],
    "rawtcp": False,
    "http3": False,
    "ssl_insecure": False,
    "connection_strategy": "lazy",
    "anticomp": True,
    "upstream_cert": False,
    "scripts": [],
    "client_replay": [],
    "server_replay": [],
    "map_local": [],
    "map_remote": [],
    "modify_body": [],
    "modify_headers": [],
    "save_stream_file": None,
    "hardump": "",
    "validate_inbound_headers": True,
}


def check_options(options) -> list[str]:
    problems = []
    for name, want in REQUIRED_OPTIONS.items():
        if not hasattr(options, name):
            problems.append("option %s missing in this mitmproxy version" % name)
            continue
        have = getattr(options, name)
        if isinstance(want, list):
            have = list(have or [])
        if have != want:
            problems.append("option %s must be %r" % (name, want))
    return problems


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def path_shape(path: str) -> str:
    """Route shape for logs: numbers and anything that could be a name become
    placeholders, plain lowercase route words stay."""
    out = []
    for seg in path.split("?")[0].split("/"):
        if not seg:
            out.append(seg)
        elif seg.isdigit():
            out.append("{n}")
        elif re.fullmatch(r"[a-z][a-z0-9_\-.]{0,40}", seg):
            out.append(seg)
        else:
            out.append("{s}")
    return "/".join(out) or "/"


class Shield:
    def __init__(self, cfg: dict, run_id: str, home: str):
        self.run_id = run_id
        self.home = home
        self.started = _now_iso()
        self.fatal: str | None = None
        self.cfg: dict = {}
        self.masker = core.Masker()
        self.dom_salt = secrets.token_hex(16)  # independent of the proxy key
        self.counts = {"allowed": 0, "blocked": 0, "masked": 0, "withheld": 0, "errors": 0}
        self.recent: dict = {}
        self.warnings: list[str] = []
        self.dry_id = 0
        self.login = core.LoginWindow()
        self._control_mtime = None
        self._buckets: dict = {}
        try:
            self.cfg = core.validate_config(cfg)
        except Exception as e:  # noqa: BLE001
            self.fatal = "config invalid: %s" % type(e).__name__
        try:
            with open(os.path.join(HERE, "mask.js"), encoding="utf-8") as f:
                self.mask_js = f.read()
        except OSError:
            self.mask_js = None
            self.fatal = self.fatal or "mask.js missing"
        self.log_dir = os.path.expanduser(self.cfg.get("log_dir", os.path.join(home, "logs")))
        try:
            os.makedirs(os.path.join(self.log_dir, "dryrun"), mode=0o700, exist_ok=True)
        except OSError:
            self.fatal = self.fatal or "log_dir not writable"
        self.static_paths = re.compile(self.cfg.get("static_paths", r"^/(static|assets|dist|build|fonts|img|images/ui|css|js)/"), re.I)

    # ------------------------------------------------------------------ logs
    def _append(self, name: str, obj) -> None:
        try:
            path = os.path.join(self.log_dir, name)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as f:
                f.write((json.dumps(obj) if not isinstance(obj, str) else obj) + "\n")
        except OSError:
            pass

    def _err(self, e: BaseException) -> None:
        self.counts["errors"] += 1
        tb = traceback.extract_tb(e.__traceback__)
        where = "%s:%s" % (os.path.basename(tb[-1].filename), tb[-1].lineno) if tb else "?"
        self._append("errors.log", "%s %s at %s" % (_now_iso(), type(e).__name__, where))

    # ----------------------------------------------------------- mitmproxy hooks
    def configure(self, updated):
        problems = check_options(ctx.options)
        if problems:
            self.fatal = "unsafe proxy options: " + "; ".join(problems)

    def tcp_start(self, flow):
        flow.kill()

    def udp_start(self, flow):
        flow.kill()

    def dns_request(self, flow):
        flow.kill()

    def requestheaders(self, flow: http.HTTPFlow):
        self._block(flow, "checking", "pending")
        try:
            if self._serve(flow):
                return
            if self.fatal:
                self._block(flow, "shield disabled: %s" % self.fatal, "fatal")
                return
            d = self._decide(flow, self._declared_len(flow))
            if d.allow:
                flow.response = None
                flow.metadata.pop("shield_blocked", None)
            else:
                self._block(flow, d.reason, d.kind)
        except Exception as e:  # noqa: BLE001
            self._err(e)
            self._block(flow, "internal error", "fatal")

    async def request(self, flow: http.HTTPFlow):
        if flow.metadata.get("shield_served"):
            return
        self._block(flow, "checking", "pending")
        try:
            if self.fatal:
                self._block(flow, "shield disabled: %s" % self.fatal, "fatal")
                self._record_block(flow, "fatal", self.fatal)
                return
            d = self._decide(flow, len(flow.request.raw_content or b""))
            if not d.allow:
                self._block(flow, d.reason, d.kind)
                self._record_block(flow, d.kind, d.reason)
                return
            await self._pace(flow)
            flow.response = None
            flow.metadata.pop("shield_blocked", None)
            flow.metadata["shield_allowed"] = d.kind
            self.counts["allowed"] += 1
            if d.kind == "login":
                self._append("login_observed.jsonl", {"t": _now_iso(), "method": flow.request.method,
                                                      "host": flow.request.pretty_host, "path": flow.request.path.split("?")[0]})
            elif d.kind == "pinned":
                self._append("traffic.jsonl", {"t": _now_iso(), "PINNED_WRITE": True, "method": flow.request.method,
                                               "host": flow.request.pretty_host, "path": path_shape(flow.request.path)})
        except Exception as e:  # noqa: BLE001
            self._err(e)
            self._block(flow, "internal error", "fatal")

    def response(self, flow: http.HTTPFlow):
        if flow.metadata.get("shield_served") or flow.metadata.get("shield_blocked"):
            return
        resp = flow.response
        if resp is None:
            return
        raw = resp.raw_content or b""
        orig_status = resp.status_code
        orig_headers = resp.headers.copy()
        self._withhold(resp, 502, "response withheld while masking")
        try:
            masked = self._mask_response(flow, raw, orig_status, orig_headers)
            if masked is not None:
                status, headers, body = masked
                resp.status_code = status
                resp.headers = headers
                resp.raw_content = body
            self._append("traffic.jsonl", {"t": _now_iso(), "method": flow.request.method, "host": flow.request.pretty_host,
                                           "path": path_shape(flow.request.path), "status": orig_status,
                                           "kind": flow.metadata.get("shield_kind", "?")})
        except Exception as e:  # noqa: BLE001
            self._err(e)
            self.counts["withheld"] += 1
            self._withhold(resp, 502, "response withheld: masking failed")

    def websocket_message(self, flow: http.HTTPFlow):
        msg = flow.websocket.messages[-1]
        if msg.from_client:
            msg.drop()
            self._append("blocks.jsonl", {"t": _now_iso(), "kind": "ws-client", "host": flow.request.pretty_host,
                                          "path": path_shape(flow.request.path), "bytes": len(msg.content)})
            return
        try:
            if msg.is_text:
                text = msg.text
                try:
                    msg.text = self.masker.mask_json_text(text)
                except ValueError:
                    msg.text = self.masker.mask_text(text)
            else:
                msg.drop()
        except Exception as e:  # noqa: BLE001
            self._err(e)
            msg.drop()

    # --------------------------------------------------------------- helpers
    def _declared_len(self, flow) -> int:
        h = flow.request.headers
        if "transfer-encoding" in h:
            return 1
        try:
            return int(h.get("content-length", "0") or 0)
        except ValueError:
            return 1

    def _refresh_login(self):
        path = os.path.join(self.home, "control.json")
        try:
            st = os.stat(path)
        except OSError:
            self.login = core.LoginWindow()
            return
        if st.st_uid != os.getuid() or (st.st_mode & 0o077):
            self.login = core.LoginWindow()
            return
        if st.st_mtime == self._control_mtime:
            return
        self._control_mtime = st.st_mtime
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f).get("login") or {}
            until = min(float(data.get("until", 0)), time.time() + 300)
            self.login = core.LoginWindow(str(data.get("host", "")), until)
        except (OSError, ValueError, AttributeError):
            self.login = core.LoginWindow()

    def _decide(self, flow, body_len: int) -> core.Decision:
        self._refresh_login()
        r = flow.request
        req = core.Request(method=r.method, host=r.pretty_host, path=r.path.split("?")[0],
                           query=r.path.split("?", 1)[1] if "?" in r.path else "",
                           headers={k.lower(): v for k, v in r.headers.items(multi=True)},
                           body_len=body_len, scheme=r.scheme)
        return core.decide(req, self.cfg, time.time(), self.login)

    def _is_target(self, host: str) -> bool:
        return any(core.host_matches(host, t) for t in self.cfg.get("targets", []))

    async def _pace(self, flow):
        host = flow.request.pretty_host
        if not self._is_target(host) or self.static_paths.search(flow.request.path.split("?")[0]):
            return
        rate = float(self.cfg.get("rate_per_sec", 4))
        burst = float(self.cfg.get("burst", 12))
        tokens, last = self._buckets.get(host, (burst, time.monotonic()))
        now = time.monotonic()
        tokens = min(burst, tokens + (now - last) * rate)
        if tokens < 1:
            wait = (1 - tokens) / rate
            await asyncio.sleep(wait)
            now = time.monotonic()
            tokens = 1
        self._buckets[host] = (tokens - 1, now)

    def _block(self, flow, reason: str, kind: str) -> None:
        flow.metadata["shield_blocked"] = {"reason": reason, "kind": kind}
        h = flow.request.headers
        dest = h.get("sec-fetch-dest", "")
        mode = h.get("sec-fetch-mode", "")
        base = {"X-Parity-Shield": "blocked", "Cache-Control": "no-store"}
        if "ping-to" in h or h.get("content-type", "").startswith("text/ping"):
            flow.response = http.Response.make(204, b"", base)
            return
        if mode == "navigate" or dest in ("document", "iframe", "frame"):
            page = ("<!doctype html><html><head><meta charset=utf-8><title>Blocked by parity shield</title></head>"
                    "<body style='font-family:system-ui;padding:24px'><h1>Blocked by the read-only shield</h1>"
                    "<p>%s %s was not sent. Nothing changed in the system.</p><p>Reason: %s</p></body></html>"
                    % (flow.request.method, path_shape(flow.request.path), reason))
            flow.response = http.Response.make(403, page.encode(), {**base, "Content-Type": "text/html; charset=utf-8"})
            return
        body = json.dumps({"error": "blocked_by_parity_shield", "reason": reason}).encode()
        flow.response = http.Response.make(403, body, {**base, "Content-Type": "application/json"})

    def _withhold(self, resp, status: int, note: str) -> None:
        resp.status_code = status
        resp.headers = http.Headers(**{"Content-Type": "text/plain; charset=utf-8", "X-Parity-Shield": "withheld",
                                       "Cache-Control": "no-store"})
        resp.raw_content = ("parity shield: %s" % note).encode()

    def _record_block(self, flow, kind: str, reason: str) -> None:
        self.counts["blocked"] += 1
        r = flow.request
        key = (r.method, r.pretty_host, path_shape(r.path), reason)
        now = time.time()
        rec = self.recent.get(key)
        if rec and now - rec[1] < 60:
            rec[0] += 1
            rec[2] = now
            if rec[0] == 20:
                self.warnings.append("retry loop: %s %s blocked 20 times in a minute" % (r.method, path_shape(r.path)))
                self.warnings = self.warnings[-20:]
            if rec[0] % 10:
                return
        else:
            self.recent[key] = [1, now, now]
        entry = {"t": _now_iso(), "method": r.method, "host": r.pretty_host, "path": path_shape(r.path),
                 "query_keys": sorted({k for k, _ in r.query.items(multi=True)}) if r.query else [],
                 "kind": kind, "reason": reason, "repeats": self.recent[key][0]}
        if kind == "write" and r.raw_content:
            self.dry_id += 1
            body_file = "dryrun/%05d.body" % self.dry_id
            masked = core.mask_dryrun_body(r.raw_content, r.headers.get("content-type", ""), self.masker, r.path.split("?")[0])
            try:
                fd = os.open(os.path.join(self.log_dir, body_file), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(masked)
                entry["dry_run"] = self.dry_id
                self._append("dryrun/index.jsonl", {"screen": "", "action": "dry-run %d" % self.dry_id, "reqid": self.dry_id,
                                                    "method": r.method, "url": "%s://%s%s" % (r.scheme, r.pretty_host, path_shape(r.path)),
                                                    "status": 0, "resourceType": "dry-run",
                                                    "requestContentType": r.headers.get("content-type", ""),
                                                    "request_file": os.path.basename(body_file)})
            except OSError:
                pass
        elif kind == "write":
            self.dry_id += 1
            entry["dry_run"] = self.dry_id
        self._append("blocks.jsonl", entry)

    # ---------------------------------------------------------- served paths
    def _status(self) -> dict:
        return {"shield": "fatal" if self.fatal else "enforce", "fatal": self.fatal, "run": self.run_id,
                "started": self.started, "version": VERSION, "config_sha": core.config_sha(self.cfg) if self.cfg else None,
                "targets": self.cfg.get("targets", []), "counts": self.counts, "warnings": self.warnings[-5:],
                "login_window": {"open": bool(self.login.host) and time.time() < self.login.until,
                                 "host": self.login.host, "until": self.login.until}}

    def _serve(self, flow) -> bool:
        r = flow.request
        host = r.pretty_host.lower()
        path = r.path.split("?")[0]
        if host != core.MAGIC_HOST and not path.startswith(core.MAGIC_PREFIX):
            return False
        flow.metadata["shield_served"] = True
        flow.metadata.pop("shield_blocked", None)
        hdr = {"Cache-Control": "no-store", "X-Parity-Shield": "served", "Access-Control-Allow-Origin": "*"}
        if r.method not in ("GET", "HEAD"):
            flow.response = http.Response.make(405, b"", hdr)
        elif path.endswith("/mask.js") and path.startswith(core.MAGIC_PREFIX):
            js = ((self.mask_js or "throw new Error('mask.js missing');").replace("__SALT__", self.dom_salt)
                  .replace("__RUN__", self.run_id).replace("__UI_WORDS__", json.dumps(sorted(core.UI_WORDS))))
            flow.response = http.Response.make(200, js.encode(), {**hdr, "Content-Type": "application/javascript; charset=utf-8"})
        elif path in ("/status", core.MAGIC_PREFIX + "status", "/"):
            body = json.dumps(self._status(), indent=1).encode()
            flow.response = http.Response.make(200, body, {**hdr, "Content-Type": "application/json"})
        else:
            flow.response = http.Response.make(404, b"not found", hdr)
        return True

    # ---------------------------------------------------------------- masking
    def _mask_response(self, flow, raw: bytes, status: int, headers):
        r = flow.request
        path = r.path.split("?")[0]
        host = r.pretty_host
        enc = headers.get("content-encoding", "")
        body = encoding.decode(raw, enc) if enc and raw else raw
        ctype = headers.get("content-type", "")
        kind = core.sniff(body, ctype, path)
        flow.metadata["shield_kind"] = kind
        is_static = any(core.host_matches(host, s) for s in self.cfg.get("static_hosts", [])) or bool(self.static_paths.search(path))

        def passthrough():
            return status, headers, raw

        new_headers = headers.copy()
        new_headers.pop("content-encoding", None)
        new_headers.pop("content-length", None)
        new_headers.pop("etag", None)
        new_headers.pop("last-modified", None)
        new_headers["cache-control"] = "no-store"
        if "location" in new_headers:
            new_headers["location"] = self.masker.mask_url(new_headers["location"])
        if "content-disposition" in new_headers:
            new_headers["content-disposition"] = re.sub(
                r"(filename\*?=)(\"?)([^\";]*)\2", lambda m: m.group(1) + m.group(2) + self.masker.fpe(m.group(3)) + m.group(2),
                new_headers["content-disposition"])

        if kind in ("js", "code"):
            if kind == "js" and not (core.CODE_EXT.search(path) or is_static):
                text = self._decode_text(body, ctype)
                masked = self.masker._mask_inline_script(text)
                return status, self._utf8(new_headers), masked.encode("utf-8")
            return passthrough()
        if kind == "empty":
            return status, new_headers, b""
        if kind == "image":
            if is_static:
                return passthrough()
            self.counts["withheld"] += 1
            return 403, http.Headers(**{"Content-Type": "text/plain", "X-Parity-Shield": "withheld-image",
                                        "Cache-Control": "no-store"}), b"image withheld by parity shield"
        if kind in ("binary", "sse"):
            if is_static and kind == "binary":
                return passthrough()
            self.counts["withheld"] += 1
            return 403, http.Headers(**{"Content-Type": "text/plain", "X-Parity-Shield": "withheld-%s" % kind,
                                        "Cache-Control": "no-store"}), b"content withheld by parity shield"

        text = self._decode_text(body, ctype)
        if kind == "json":
            masked = self.masker.mask_json_text(text)
        elif kind == "html":
            masked = self._inject(self.masker.mask_html(text), new_headers, flow)
        elif kind == "xml":
            masked = self.masker.mask_xml(text)
        elif kind == "csv":
            masked = self.masker.mask_csv(text)
        else:
            masked = self.masker.mask_text(text)
        self.counts["masked"] += 1
        return status, self._utf8(new_headers), masked.encode("utf-8")

    @staticmethod
    def _decode_text(body: bytes, ctype: str) -> str:
        m = re.search(r"charset=([\w\-]+)", ctype or "", re.I)
        charset = m.group(1) if m else "utf-8"
        try:
            return body.decode(charset)
        except (LookupError, UnicodeDecodeError):
            return body.decode("utf-8", "replace")

    @staticmethod
    def _utf8(headers):
        ct = headers.get("content-type", "")
        if ct:
            headers["content-type"] = re.sub(r"charset=[\w\-]+", "charset=utf-8", ct, flags=re.I) if "charset=" in ct.lower() else ct
        return headers

    def _inject(self, html: str, headers, flow) -> str:
        r = flow.request
        origin = "%s://%s" % (r.scheme, r.host_header or r.pretty_host)
        src_expr = origin + core.MAGIC_PREFIX
        nonce = None

        def patch_policy(policy: str):
            nonlocal nonce
            directives = [d.strip() for d in policy.split(";") if d.strip()]
            names = [d.split()[0].lower() for d in directives]
            targets = [i for i, n in enumerate(names) if n in ("script-src", "script-src-elem")]
            if not targets:
                targets = [i for i, n in enumerate(names) if n == "default-src"]
            for i in targets:
                m = re.search(r"'nonce-([^']+)'", directives[i])
                if m and not nonce:
                    nonce = m.group(1)
                directives[i] = directives[i] + " " + src_expr
            return "; ".join(directives)

        csp_values = headers.get_all("content-security-policy")
        if csp_values:
            headers.set_all("content-security-policy", [patch_policy(v) for v in csp_values])

        def meta_tag(m):
            tag = m.group(0)
            if not re.search(r"http-equiv\s*=\s*['\"]?content-security-policy", tag, re.I):
                return tag
            return re.sub(r"(\bcontent\s*=\s*)(['\"])(.*?)\2",
                          lambda c: c.group(1) + c.group(2) + patch_policy(c.group(3)) + c.group(2), tag, count=1, flags=re.I | re.S)
        html = re.sub(r"<meta\b[^>]*>", meta_tag, html, flags=re.I)
        tag = '<script src="%smask.js?r=%s"%s></script>' % (core.MAGIC_PREFIX, self.run_id,
                                                            (' nonce="%s"' % nonce) if nonce else "")
        m = re.search(r"<head\b[^>]*>", html, re.I)
        if m:
            return html[:m.end()] + tag + html[m.end():]
        m = re.search(r"<html\b[^>]*>", html, re.I)
        if m:
            return html[:m.end()] + tag + html[m.end():]
        m = re.match(r"\s*<!doctype[^>]*>", html, re.I)
        if m:
            return html[:m.end()] + tag + html[m.end():]
        return tag + html
