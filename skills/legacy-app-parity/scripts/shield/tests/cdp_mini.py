"""cdp_mini.py - a tiny Chrome DevTools Protocol client (stdlib only) for the
self-test: enough WebSocket to send commands and collect events."""
import base64
import json
import os
import socket
import struct
import time
import urllib.request
from urllib.parse import urlsplit


class CDP:
    def __init__(self, debug_port: int, timeout: float = 30.0):
        targets = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/json" % debug_port, timeout=5).read())
        page = next(t for t in targets if t.get("type") == "page")
        u = urlsplit(page["webSocketDebuggerUrl"])
        self.sock = socket.create_connection((u.hostname, u.port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ("GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n") % (u.path, u.hostname, u.port, key)
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        if b" 101 " not in buf.split(b"\r\n", 1)[0]:
            raise RuntimeError("CDP websocket handshake failed")
        self._rest = buf.split(b"\r\n\r\n", 1)[1]
        self._id = 0
        self.events = []

    def _recv_exact(self, n):
        while len(self._rest) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("CDP socket closed")
            self._rest += chunk
        out, self._rest = self._rest[:n], self._rest[n:]
        return out

    def _recv_frame(self):
        b1, b2 = self._recv_exact(2)
        fin, op, ln = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", self._recv_exact(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", self._recv_exact(8))[0]
        if b2 & 0x80:
            mask = self._recv_exact(4)
            data = bytes(c ^ mask[i % 4] for i, c in enumerate(self._recv_exact(ln)))
        else:
            data = self._recv_exact(ln)
        return fin, op, data

    def _recv_message(self):
        parts, opcode = [], None
        while True:
            fin, op, data = self._recv_frame()
            if op == 9:
                self._send_frame(10, data)
                continue
            if op == 8:
                raise ConnectionError("CDP closed")
            if op != 0:
                opcode = op
            parts.append(data)
            if fin:
                return opcode, b"".join(parts)

    def _send_frame(self, op, payload: bytes):
        head = bytes([0x80 | op])
        n = len(payload)
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        self.sock.sendall(head + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload)))

    def call(self, method, params=None, timeout=30.0):
        self._id += 1
        mid = self._id
        self._send_frame(1, json.dumps({"id": mid, "method": method, "params": params or {}}).encode())
        end = time.time() + timeout
        while time.time() < end:
            _, data = self._recv_message()
            msg = json.loads(data)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError("%s: %s" % (method, msg["error"].get("message")))
                return msg.get("result", {})
            if "method" in msg:
                self.events.append(msg)
        raise TimeoutError(method)

    def evaluate(self, expression, await_promise=True, timeout=30.0):
        r = self.call("Runtime.evaluate", {"expression": expression, "awaitPromise": await_promise,
                                           "returnByValue": True}, timeout=timeout)
        if r.get("exceptionDetails"):
            raise RuntimeError("evaluate failed: %s" % r["exceptionDetails"].get("text"))
        return r.get("result", {}).get("value")

    def navigate(self, url, settle=1.5):
        self.call("Page.navigate", {"url": url})
        end = time.time() + 20
        while time.time() < end:
            try:
                if self.evaluate("document.readyState", timeout=5) == "complete":
                    break
            except RuntimeError:
                pass
            time.sleep(0.2)
        time.sleep(settle)

    def drain(self, seconds=0.5):
        """Collect pending events without ever stopping mid-frame."""
        import select
        end = time.time() + seconds
        while time.time() < end:
            if not self._rest:
                readable, _, _ = select.select([self.sock], [], [], 0.1)
                if not readable:
                    continue
            _, data = self._recv_message()
            msg = json.loads(data)
            if "method" in msg:
                self.events.append(msg)

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass
