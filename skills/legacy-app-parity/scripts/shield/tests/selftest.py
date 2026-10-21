#!/usr/bin/env python3
"""
selftest.py - end-to-end proof of the parity shield on this machine.

Starts a fake CRM over HTTPS (seeded with canary client data), starts the real
shield with shieldctl in a throwaway home folder, opens a real headless Chrome
behind it, and checks:

  writes      the fake CRM received only reads: no POST/PUT/PATCH/DELETE/custom
              methods, no beacons, no form posts, no websocket, no risky GETs
  privacy     no canary appears in the DOM, input values, the accessibility tree,
              network response bodies seen by the browser, console messages,
              or any shield log or output file; credentials never logged
  layout      interface labels survive masking
  gate        shield_check.js reports ok on shielded pages and NOT ok where the
              mask could not load (strict CSP) or the browser is not shielded
  magic host  https://parity-shield.invalid/status answers only through the shield
  stability   the same value masks the same way within a run
  fail-safe   a second start is refused while the profile is open; with the proxy
              killed, nothing reaches the CRM

Run with the shield venv python:  python tests/selftest.py [--chrome PATH]
"""
import argparse
import datetime
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SHIELD = os.path.dirname(HERE)
sys.path.insert(0, SHIELD)
sys.path.insert(0, HERE)

import cdp_mini  # noqa: E402
import fake_site  # noqa: E402

RESULTS = []
CLEANUP = []  # always run, even when a check crashes: no stray browsers or proxies


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print("%s  %s%s" % ("PASS" if ok else "FAIL", name, ("  (%s)" % detail) if detail and not ok else ""), flush=True)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def make_certs(d):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    import ipaddress
    now = datetime.datetime.now(datetime.timezone.utc)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "parity selftest CA")])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name).public_key(ca_key.public_key())
          .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=5))
          .not_valid_after(now + datetime.timedelta(days=1))
          .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
          .sign(ca_key, hashes.SHA256()))
    key = ec.generate_private_key(ec.SECP256R1())
    leaf = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "127.0.0.1")]))
            .issuer_name(ca_name).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=5)).not_valid_after(now + datetime.timedelta(days=1))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
            .sign(ca_key, hashes.SHA256()))
    paths = {k: os.path.join(d, k) for k in ("ca.pem", "leaf.pem", "leaf.key")}
    with open(paths["ca.pem"], "wb") as f:
        f.write(ca.public_bytes(serialization.Encoding.PEM))
    with open(paths["leaf.pem"], "wb") as f:
        f.write(leaf.public_bytes(serialization.Encoding.PEM))
    with open(paths["leaf.key"], "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return paths


def canaries_in(text):
    return [c for c in fake_site.CANARIES if c in text]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chrome")
    ap.add_argument("--keep", action="store_true", help="keep the temp folder for inspection")
    a = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix="parity-selftest-")
    os.environ["PARITY_SHIELD_HOME"] = os.path.join(tmp, "home")
    os.environ.setdefault("PARITY_SHIELD_VENV", os.path.dirname(os.path.dirname(sys.executable)))
    import shieldctl  # noqa: E402  (reads the env above)

    certs = make_certs(tmp)
    srv, port, rec = fake_site.start(certs["leaf.pem"], certs["leaf.key"])
    CLEANUP.append(srv.shutdown)
    if not a.keep:
        CLEANUP.append(lambda: shutil.rmtree(tmp, ignore_errors=True))
    origin = "https://127.0.0.1:%d" % port
    cfg = {"version": 1, "proxy_port": free_port(), "debug_port": free_port(), "targets": ["127.0.0.1"],
           "log_dir": os.path.join(tmp, "logs"), "upstream_ca": certs["ca.pem"]}
    cfg_path = os.path.join(tmp, "shield.json")
    with open(cfg_path, "w") as f:
        json.dump(cfg, f)

    info = None
    cdp = None
    try:
        info = shieldctl.start(cfg_path, headless=True, chrome=a.chrome, url="about:blank")
        CLEANUP.insert(0, lambda: shieldctl.stop_run(info))
        check("shield and shielded Chrome started", True)
        cdp = cdp_mini.CDP(info["debug_port"])
        for dom in ("Page", "Runtime", "Network", "Accessibility"):
            cdp.call(dom + ".enable")

        # magic host
        cdp.navigate("https://parity-shield.invalid/status", settle=0.5)
        txt = cdp.evaluate("document.body ? document.body.innerText : ''")
        try:
            st = json.loads(txt)
        except ValueError:
            st = {}
        check("magic status host answers through the shield", st.get("run") == info["run_id"] and st.get("shield") == "enforce", txt[:120])

        # main page
        before = len(rec.requests)
        cdp.navigate(origin + "/app", settle=0.5)
        end = time.time() + 20
        while time.time() < end and not cdp.evaluate("!!window.__done"):
            time.sleep(0.3)
        check("test page finished its write attempts", cdp.evaluate("!!window.__done"))
        with open(os.path.join(SHIELD, "shield_check.js")) as f:
            check_js = f.read()
        gate = cdp.evaluate("(%s)()" % check_js)
        check("shield_check ok on a shielded page", gate and gate.get("ok") is True, json.dumps(gate)[:200])
        results = cdp.evaluate("window.__results || {}") or {}
        statuses = {k: v for k, v in results.items() if k not in ("beacon", "thirdparty", "ws")}
        check("every write attempt got 403 from the shield", statuses and all(v == 403 for v in statuses.values()), json.dumps(results))
        check("websocket never opened", results.get("ws") != "open", str(results.get("ws")))
        check("same value masked the same way within a run", cdp.evaluate("window.__stable === true"))

        cdp.drain(1.5)
        arrived = rec.requests[before:]
        writes = [r for r in arrived if r["method"] not in ("GET", "HEAD")]
        risky = [r for r in arrived if any(w in r["path"] for w in ("/void", "/delete", "_method", "/ws", "/api/form", "/beacon"))]
        check("fake CRM received no writes", not writes, json.dumps(writes)[:300])
        check("fake CRM received no risky reads", not risky, json.dumps(risky)[:300])
        reads = [r["path"] for r in arrived]
        check("normal reads still reached the CRM", "/app" in reads and "/api/clients" in reads, json.dumps(reads)[:200])

        # privacy, every channel the agent could read
        dom = cdp.evaluate("""(() => {
            const parts = [document.title, document.documentElement.outerHTML];
            document.querySelectorAll('input,textarea').forEach(e => parts.push(e.value));
            document.querySelectorAll('*').forEach(e => { if (e.shadowRoot) parts.push(e.shadowRoot.innerHTML); });
            return parts.join('\\n'); })()""")
        check("no canary in DOM, titles or input values", not canaries_in(dom), ", ".join(canaries_in(dom)))
        check("interface labels survive masking", all(x in dom for x in ("Client Name", "Full name", "Save", "Client details")))
        check("contact links neutralised", "mailto:" not in dom)
        ax = json.dumps(cdp.call("Accessibility.getFullAXTree"))
        check("no canary in the accessibility tree", not canaries_in(ax), ", ".join(canaries_in(ax)))
        bodies, leaky = [], []
        for ev in list(cdp.events):
            if ev.get("method") == "Network.responseReceived" and "127.0.0.1" in ev["params"]["response"]["url"]:
                try:
                    b = cdp.call("Network.getResponseBody", {"requestId": ev["params"]["requestId"]}, timeout=5)
                except (RuntimeError, TimeoutError):
                    continue
                body = b.get("body", "")
                if b.get("base64Encoded"):
                    import base64
                    body = base64.b64decode(body).decode("utf-8", "replace")
                bodies.append(body)
                if canaries_in(body):
                    leaky.append("%s %s" % (ev["params"]["response"]["url"].split("127.0.0.1")[-1], canaries_in(body)))
        check("no canary in network bodies the browser received", bodies and not leaky, "; ".join(leaky)[:300])
        console = json.dumps([ev["params"] for ev in cdp.events if ev.get("method") == "Runtime.consoleAPICalled"])
        check("console captured the page's log", "clients" in console)
        check("no canary in console messages", not canaries_in(console), ", ".join(canaries_in(console)))

        # CSP variants: the gate must tell the truth
        for path, (_, expect_ok) in fake_site.CSP_PAGES.items():
            cdp.navigate(origin + path, settle=1.0)
            g = cdp.evaluate("(%s)()" % check_js) or {}
            page_dom = cdp.evaluate("document.documentElement.outerHTML")
            if expect_ok:
                check("gate ok and data masked under CSP %s" % path, g.get("ok") is True and not canaries_in(page_dom),
                      json.dumps(g)[:160])
            else:
                check("gate reports NOT ok when the mask cannot load (%s)" % path, g.get("ok") is False, json.dumps(g)[:160])

        # second start refused while the profile is open
        try:
            shieldctl.start(cfg_path, headless=True, chrome=a.chrome, url="about:blank")
            check("second start refused while running", False, "it started")
        except SystemExit:
            check("second start refused while running", True)
    finally:
        if cdp:
            cdp.close()

    # unprotected browser: magic host fails, same-origin gate says not ok
    plain_port = free_port()
    plain_profile = os.path.join(tmp, "plain-profile")
    chrome = shieldctl.find_chrome(a.chrome)
    plain = subprocess.Popen([chrome, "--headless=new", "--disable-gpu", "--user-data-dir=" + plain_profile,
                              "--remote-debugging-port=%d" % plain_port, "--ignore-certificate-errors",
                              "--no-first-run", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
    CLEANUP.insert(0, lambda: os.killpg(os.getpgid(plain.pid), signal.SIGKILL) if plain.poll() is None else None)
    try:
        for _ in range(40):
            try:
                pc = cdp_mini.CDP(plain_port)
                break
            except OSError:
                time.sleep(0.25)
        pc.call("Page.enable")
        pc.navigate("https://parity-shield.invalid/status", settle=0.5)
        href = pc.evaluate("location.href + ' ' + (document.body ? document.body.innerText.slice(0, 80) : '')")
        check("magic host unreachable from an unshielded browser", info and info["run_id"] not in (href or ""), href)
        pc.navigate(origin + "/csp/meta", settle=0.5)
        g = pc.evaluate("(%s)()" % check_js) or {}
        check("gate NOT ok in an unshielded browser", g.get("ok") is False, json.dumps(g)[:160])
        pc.close()
    finally:
        os.killpg(os.getpgid(plain.pid), signal.SIGTERM)

    # fail-safe: proxy killed, nothing reaches the CRM
    if info:
        os.killpg(os.getpgid(info["proxy_pid"]), signal.SIGTERM)
        time.sleep(1.0)
        before = len(rec.requests)
        try:
            c2 = cdp_mini.CDP(info["debug_port"])
            c2.call("Page.enable")
            c2.navigate(origin + "/app", settle=1.0)
            c2.close()
        except Exception:  # noqa: BLE001
            pass
        check("with the proxy down nothing reaches the CRM", len(rec.requests) == before)
        shieldctl.stop_run(info)

    # every file the shield wrote: no canary, no credential
    leaks = []
    for root, _, files in os.walk(tmp):
        if "plain-profile" in root or "chrome-profile" in root or root.endswith("/cache") or "/cache/" in root:
            continue
        for fn in files:
            p = os.path.join(root, fn)
            if fn.endswith((".pem", ".key", ".p12", ".cer")) or fn == "shield.json":
                continue
            try:
                with open(p, "rb") as f:
                    data = f.read().decode("utf-8", "replace")
            except OSError:
                continue
            hits = canaries_in(data) + ([fake_site.CREDENTIAL_CANARY] if fake_site.CREDENTIAL_CANARY in data else [])
            if hits:
                leaks.append("%s: %s" % (os.path.relpath(p, tmp), ", ".join(hits)))
    check("no canary or credential in any shield log or output", not leaks, "; ".join(leaks)[:300])
    log_dir = cfg["log_dir"]
    blocks = open(os.path.join(log_dir, "blocks.jsonl")).read() if os.path.exists(os.path.join(log_dir, "blocks.jsonl")) else ""
    check("blocked attempts were logged", "write" in blocks and "danger-get" in blocks)
    check("third-party write was blocked and logged", "example.com" in blocks)

    failed = [r for r in RESULTS if not r[1]]
    print("\n%d checks, %d passed, %d failed" % (len(RESULTS), len(RESULTS) - len(failed), len(failed)))
    if a.keep:
        print("kept: " + tmp)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    try:
        main()
    finally:
        for fn in CLEANUP:
            try:
                fn()
            except Exception:  # noqa: BLE001
                pass
