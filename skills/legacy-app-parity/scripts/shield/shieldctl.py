#!/usr/bin/env python3
"""
shieldctl.py - run the parity shield: a read-only, privacy-masking browser for
mapping a live system that has no sandbox.

  python3 shieldctl.py setup                         one time: private venv with pinned mitmproxy
  python3 shieldctl.py start --config shield.json    start the shield, then a dedicated Chrome behind it
  python3 shieldctl.py status                        is it running, what has it blocked
  python3 shieldctl.py login --host H                PERSON ONLY: open a short login window for host H
  python3 shieldctl.py login --close                 PERSON ONLY: close it early
  python3 shieldctl.py pin-login --config C          PERSON ONLY: keep the exact login paths just used
  python3 shieldctl.py pin --config C --method POST --host H --path /exact --reason "..." --days 7
                                                     PERSON ONLY: allow one exact write (expires)
  python3 shieldctl.py stop                          stop Chrome and the shield
  python3 shieldctl.py wipe --config C               PERSON ONLY: delete logs and dry-run bodies
  python3 shieldctl.py selftest                      prove the guarantees on this machine
  python3 shieldctl.py mcp                           print how to connect the browser tool

PERSON ONLY commands refuse to run without an interactive terminal, so an AI
agent cannot run them from its shell tool. Stdlib only, Python 3.9+.
"""
import argparse
import datetime
import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shield_core  # noqa: E402  (pure Python, safe to import on 3.9)

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
]


def home() -> str:
    return os.path.expanduser(os.environ.get("PARITY_SHIELD_HOME", "~/.parity-shield"))


def venv_python() -> str:
    venv = os.environ.get("PARITY_SHIELD_VENV") or os.path.join(home(), "venv")
    return os.path.join(os.path.expanduser(venv), "bin", "python")


def die(msg: str, code: int = 1):
    print("shieldctl: " + msg, file=sys.stderr)
    sys.exit(code)


def require_person(action: str) -> None:
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        die("'%s' must be run by a person in their own terminal (no interactive terminal detected)." % action, 5)


def confirm(prompt: str, word: str) -> None:
    ans = input("%s\nType %s to continue: " % (prompt, word)).strip()
    if ans != word:
        die("cancelled")


def write_private(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(path, 0o600)


def load_config(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
        return shield_core.validate_config(cfg)
    except (OSError, ValueError) as e:
        die("config %s: %s" % (path, e), 2)


def port_free(port: int) -> bool:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, TypeError):
        return False


def shield_status(port: int, timeout: float = 3.0):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": "http://127.0.0.1:%d" % port}))
    with opener.open("http://%s/status" % shield_core.MAGIC_HOST, timeout=timeout) as r:
        return json.loads(r.read().decode())


def find_python312():
    for cand in ("python3.13", "python3.12", sys.executable):
        exe = shutil.which(cand) if not os.path.isabs(cand) else cand
        if not exe:
            continue
        try:
            out = subprocess.run([exe, "-c", "import sys;print(sys.version_info[:2]>=(3,12))"], capture_output=True, text=True, timeout=20)
            if out.stdout.strip() == "True":
                return exe
        except (OSError, subprocess.SubprocessError):
            continue
    return None


# --------------------------------------------------------------------------- setup
def cmd_setup(a) -> None:
    py = find_python312()
    if not py:
        die("Python 3.12 or newer is required for the shield (mitmproxy 12). Install it (for example: brew install python@3.12) and rerun setup.")
    venv = os.path.join(home(), "venv")
    os.makedirs(home(), mode=0o700, exist_ok=True)
    if not os.path.exists(venv_python()):
        subprocess.run([py, "-m", "venv", venv], check=True)
    lock = os.path.join(HERE, "requirements.lock")
    subprocess.run([venv_python(), "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r", lock], check=True)
    out = subprocess.run([venv_python(), "-c", "import mitmproxy.version as v;print(v.VERSION)"], capture_output=True, text=True)
    print("shield venv ready at %s (mitmproxy %s)" % (venv, out.stdout.strip()))


# --------------------------------------------------------------------------- start
def spki_of_ca() -> str:
    pem = os.path.join(home(), "mitmproxy", "mitmproxy-ca-cert.pem")
    code = ("import base64,hashlib,sys\n"
            "from cryptography import x509\n"
            "from cryptography.hazmat.primitives import serialization as s\n"
            "c=x509.load_pem_x509_certificate(open(sys.argv[1],'rb').read())\n"
            "d=c.public_key().public_bytes(s.Encoding.DER,s.PublicFormat.SubjectPublicKeyInfo)\n"
            "print(base64.b64encode(hashlib.sha256(d).digest()).decode())\n")
    out = subprocess.run([venv_python(), "-c", code, pem], capture_output=True, text=True)
    if out.returncode != 0 or not out.stdout.strip():
        die("could not read the shield's certificate at %s" % pem)
    return out.stdout.strip()


def write_chrome_prefs(profile: str) -> None:
    default = os.path.join(profile, "Default")
    os.makedirs(default, mode=0o700, exist_ok=True)
    path = os.path.join(default, "Preferences")
    prefs = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                prefs = json.load(f)
        except ValueError:
            prefs = {}
    prefs.setdefault("webrtc", {}).update({"ip_handling_policy": "disable_non_proxied_udp",
                                           "multiple_routes_enabled": False, "nonproxied_udp_enabled": False})
    prefs["credentials_enable_service"] = False
    prefs.setdefault("profile", {})["password_manager_enabled"] = False
    prefs.setdefault("autofill", {}).update({"profile_enabled": False, "credit_card_enabled": False, "enabled": False})
    prefs.setdefault("browser", {})["has_seen_welcome_page"] = True
    with open(path, "w", encoding="utf-8") as f:
        json.dump(prefs, f)


def profile_in_use(profile: str) -> bool:
    lock = os.path.join(profile, "SingletonLock")
    if os.path.islink(lock):
        target = os.readlink(lock)
        try:
            return pid_alive(int(target.rsplit("-", 1)[1]))
        except (IndexError, ValueError):
            return True
    return os.path.exists(lock)


def chrome_flags(cfg: dict, profile: str, cache_dir: str, spki: str, headless: bool) -> list:
    flags = [
        "--user-data-dir=%s" % profile,
        "--disk-cache-dir=%s" % cache_dir,
        "--proxy-server=http://127.0.0.1:%d" % int(cfg.get("proxy_port", 8899)),
        "--proxy-bypass-list=<-loopback>",
        # Chrome resolves no names itself (the proxy does), so anything that tried to
        # skip the proxy fails. 127.0.0.1 is excluded so Chrome can reach the proxy.
        "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
        "--ignore-certificate-errors-spki-list=%s" % spki,
        "--disable-quic",
        "--remote-debugging-port=%d" % int(cfg.get("debug_port", 9333)),
        "--no-first-run", "--no-default-browser-check",
        "--disable-background-networking", "--disable-sync", "--disable-extensions",
        "--no-pings", "--disable-component-update", "--disable-domain-reliability",
        "--disable-features=OptimizationHints,MediaRouter,DialMediaRouteProvider,AutofillServerCommunication",
        "--metrics-recording-only", "--password-store=basic",
    ]
    if headless:
        flags += ["--headless=new", "--disable-gpu"]
    return flags


def find_chrome(explicit):
    for c in ([explicit] if explicit else []) + CHROME_CANDIDATES:
        if c and os.path.exists(c):
            return c
    die("Chrome not found; pass --chrome /path/to/chrome")


def start(cfg_path: str, headless: bool = False, chrome: str = None, url: str = None) -> dict:
    cfg = load_config(cfg_path)
    if not os.path.exists(venv_python()):
        die("run 'shieldctl.py setup' first")
    pport, dport = int(cfg.get("proxy_port", 8899)), int(cfg.get("debug_port", 9333))
    profile = os.path.join(home(), "chrome-profile")
    if profile_in_use(profile):
        die("the shielded Chrome profile is already open. Close it (shieldctl stop) before starting again.")
    for p in (pport, dport):
        if not port_free(p):
            die("port %d is busy. Is the shield already running? Try: shieldctl.py status / stop" % p)
    run_id = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(3)
    run_dir = os.path.join(home(), "runs", run_id)
    os.makedirs(os.path.join(run_dir, "cache"), mode=0o700, exist_ok=True)
    out_path = os.path.join(run_dir, "proxy.out")
    fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    proxy = subprocess.Popen([venv_python(), os.path.join(HERE, "shield_run.py"), "--config", os.path.abspath(cfg_path),
                              "--run-id", run_id, "--home", home()], stdout=fd, stderr=fd, start_new_session=True)
    os.close(fd)
    status = None
    for _ in range(60):
        if proxy.poll() is not None:
            break
        try:
            status = shield_status(pport, 1.0)
            if status.get("run") == run_id:
                break
        except OSError:
            pass
        time.sleep(0.5)
    if not status or status.get("run") != run_id or status.get("shield") != "enforce":
        proxy.terminate()
        with open(out_path, encoding="utf-8", errors="replace") as f:
            tail = f.read()[-800:]
        die("the shield did not come up healthy; Chrome was NOT started.\n" + tail, 3)
    spki = spki_of_ca()
    write_chrome_prefs(profile)
    exe = find_chrome(chrome)
    args = [exe] + chrome_flags(cfg, profile, os.path.join(run_dir, "cache"), spki, headless)
    args.append(url or "https://%s/status" % shield_core.MAGIC_HOST)
    cfd = os.open(os.path.join(run_dir, "chrome.out"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    chrome_p = subprocess.Popen(args, stdout=cfd, stderr=cfd, start_new_session=True)
    os.close(cfd)
    ok = False
    for _ in range(60):
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % dport, timeout=1) as r:
                ok = r.status == 200
                break
        except OSError:
            time.sleep(0.5)
    info = {"run_id": run_id, "proxy_pid": proxy.pid, "chrome_pid": chrome_p.pid, "proxy_port": pport,
            "debug_port": dport, "config": os.path.abspath(cfg_path), "browser_url": "http://127.0.0.1:%d" % dport,
            "started": datetime.datetime.now().isoformat(timespec="seconds"), "headless": headless}
    write_private(os.path.join(home(), "run.json"), json.dumps(info, indent=2))
    if not ok:
        stop_run(info)
        die("Chrome did not open its debugging port; everything was stopped.", 3)
    return info


def cmd_start(a) -> None:
    info = start(a.config, headless=a.headless, chrome=a.chrome)
    print("Shield running (run %s). Shielded Chrome is open." % info["run_id"])
    print("Browser tool connection: %s" % info["browser_url"])
    print("Next: a person runs 'shieldctl.py login --host <login host>' in their own terminal, then logs in")
    print("inside the shielded Chrome window within the window time.")


# --------------------------------------------------------------------------- status / stop
def read_run():
    try:
        with open(os.path.join(home(), "run.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def cmd_status(a) -> None:
    info = read_run()
    if not info:
        die("no shield run recorded", 1)
    try:
        st = shield_status(info["proxy_port"])
    except OSError:
        st = None
    print(json.dumps({"run": info["run_id"], "proxy_running": pid_alive(info["proxy_pid"]),
                      "chrome_running": pid_alive(info["chrome_pid"]), "browser_url": info["browser_url"],
                      "shield": st}, indent=2))


def stop_run(info) -> None:
    for key in ("chrome_pid", "proxy_pid"):
        pid = info.get(key)
        if pid and pid_alive(pid):
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except OSError:
                try:
                    os.kill(pid, signal.SIGTERM)
                except OSError:
                    pass
    for _ in range(20):
        if not any(pid_alive(info.get(k)) for k in ("chrome_pid", "proxy_pid") if info.get(k)):
            break
        time.sleep(0.25)
    try:
        os.remove(os.path.join(home(), "control.json"))
    except OSError:
        pass


def cmd_stop(a) -> None:
    info = read_run()
    if not info:
        die("no shield run recorded", 1)
    stop_run(info)
    print("stopped run %s" % info["run_id"])


# --------------------------------------------------------------------------- person-only
def cmd_login(a) -> None:
    require_person("login")
    path = os.path.join(home(), "control.json")
    if a.close:
        write_private(path, json.dumps({"login": {}}))
        print("login window closed")
        return
    if not a.host:
        die("give --host, the exact host of the login page (for example app.example.com)")
    secs = max(10, min(int(a.seconds), 300))
    confirm("Open a %d-second login window for %s? During it, POSTs to sign-in paths on that host are allowed and logged (bodies are never written)." % (secs, a.host), "LOGIN")
    write_private(path, json.dumps({"login": {"host": a.host, "until": time.time() + secs}}))
    print("Login window open until %s. Log in now in the shielded Chrome window." %
          datetime.datetime.fromtimestamp(time.time() + secs).strftime("%H:%M:%S"))


def save_config(path: str, cfg: dict) -> None:
    shield_core.validate_config(cfg)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def cmd_pin_login(a) -> None:
    require_person("pin-login")
    cfg = load_config(a.config)
    seen = []
    try:
        with open(os.path.join(os.path.expanduser(cfg["log_dir"]), "login_observed.jsonl"), encoding="utf-8") as f:
            for line in f:
                e = json.loads(line)
                key = {"method": e["method"], "host": e["host"], "path": e["path"]}
                if key not in seen:
                    seen.append(key)
    except OSError:
        die("no login has been observed yet")
    for k in seen:
        print("  %(method)s https://%(host)s%(path)s" % k)
    confirm("Keep these exact login paths? They will only work while a login window is open.", "KEEP")
    rules = cfg.setdefault("login_rules", [])
    for k in seen:
        if k not in rules:
            rules.append(k)
    save_config(a.config, cfg)
    print("saved %d login rule(s)" % len(rules))


def cmd_pin(a) -> None:
    require_person("pin")
    cfg = load_config(a.config)
    days = max(1, min(int(a.days), 30))
    rule = {"method": a.method.upper(), "host": a.host, "path": a.path, "reason": a.reason,
            "expires": (datetime.date.today() + datetime.timedelta(days=days)).isoformat(), "max_body": int(a.max_body)}
    print(json.dumps(rule, indent=2))
    confirm("This lets that exact request reach the live system until %s. Only do this for requests that do not change data (for example a session keep-alive)." % rule["expires"], "ALLOW")
    cfg.setdefault("pinned_writes", []).append(rule)
    save_config(a.config, cfg)
    print("pinned. Restart the shield (stop, start) for it to take effect.")


def cmd_wipe(a) -> None:
    require_person("wipe")
    cfg = load_config(a.config)
    d = os.path.expanduser(cfg["log_dir"])
    confirm("Delete everything under %s (traffic, blocks, dry-run bodies)?" % d, "WIPE")
    shutil.rmtree(d, ignore_errors=True)
    for r in (os.path.join(home(), "runs"),):
        shutil.rmtree(r, ignore_errors=True)
    print("wiped")


# --------------------------------------------------------------------------- misc
def cmd_selftest(a) -> None:
    if not os.path.exists(venv_python()):
        die("run setup first")
    rc = subprocess.run([venv_python(), "-m", "unittest", "discover", "-s", os.path.join(HERE, "tests"), "-p", "test_*.py", "-v"]).returncode
    rc2 = subprocess.run([venv_python(), os.path.join(HERE, "tests", "selftest.py")] + (["--chrome", a.chrome] if a.chrome else [])).returncode
    sys.exit(rc or rc2)


def cmd_mcp(a) -> None:
    info = read_run() or {"debug_port": 9333}
    print("Connect a separate browser-tool server to the shielded Chrome (show this to the owner before running it):")
    print("  claude mcp add --scope project chrome-shielded -- npx -y chrome-devtools-mcp@1.10.1 --browserUrl http://127.0.0.1:%d" % info["debug_port"])
    print("Then restart Claude Code. The agent must use only the chrome-shielded tools for the live system.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setup")
    p = sub.add_parser("start")
    p.add_argument("--config", required=True)
    p.add_argument("--headless", action="store_true")
    p.add_argument("--chrome")
    sub.add_parser("status")
    sub.add_parser("stop")
    p = sub.add_parser("login")
    p.add_argument("--host")
    p.add_argument("--seconds", default=120)
    p.add_argument("--close", action="store_true")
    p = sub.add_parser("pin-login")
    p.add_argument("--config", required=True)
    p = sub.add_parser("pin")
    p.add_argument("--config", required=True)
    p.add_argument("--method", required=True)
    p.add_argument("--host", required=True)
    p.add_argument("--path", required=True)
    p.add_argument("--reason", required=True)
    p.add_argument("--days", default=7)
    p.add_argument("--max-body", default=4096)
    p = sub.add_parser("wipe")
    p.add_argument("--config", required=True)
    p = sub.add_parser("selftest")
    p.add_argument("--chrome")
    sub.add_parser("mcp")
    a = ap.parse_args()
    {"setup": cmd_setup, "start": cmd_start, "status": cmd_status, "stop": cmd_stop, "login": cmd_login,
     "pin-login": cmd_pin_login, "pin": cmd_pin, "wipe": cmd_wipe, "selftest": cmd_selftest, "mcp": cmd_mcp}[a.cmd](a)


if __name__ == "__main__":
    main()
