#!/usr/bin/env python3
"""
guard_hook.py - Claude Code PreToolUse hook that keeps live-system work inside
the parity shield. Installed in the app repo's .claude/settings.json during the
shield setup (shown to the owner first). Exit code 2 blocks the tool call and
tells the agent why.

Rules:
  1. The live system's hosts may be opened only with the shielded browser server
     (default name: chrome-shielded). Any other browser tool navigating there is blocked.
  2. On the shielded server: no network-body, memory, trace, Lighthouse or file
     upload tools ever; evaluate_script only for the vetted scripts or short
     read-only snippets; and no tool at all unless the shield is running.
  3. The agent may not run the person-only shieldctl commands, start its own
     mitmproxy, or edit the shield's config, control files or code.

Usage in settings.json:
  python3 <skill>/scripts/shield/guard_hook.py --config <repo>/docs/parity/shield.json
Stdlib only, Python 3.9+. Unrelated tool calls pass straight through.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
SHIELD_HOME = os.path.expanduser(os.environ.get("PARITY_SHIELD_HOME", "~/.parity-shield"))
NAV_TOOLS = {"navigate_page", "new_page", "navigate", "browser_navigate", "goto", "open_url", "browser_tab_new"}
NEVER_ON_SHIELDED = {"get_network_request", "take_memory_snapshot", "performance_start_trace", "performance_stop_trace",
                     "performance_analyze_insight", "lighthouse_audit", "upload_file", "take_heap_snapshot",
                     "screencast_start", "screencast_stop"}
VETTED_SCRIPTS = ("inventory.js", "tokens.js", "ready.js")
FORBIDDEN_IN_SNIPPETS = re.compile(r"fetch\s*\(|XMLHttpRequest|document\.cookie|sessionStorage|indexedDB|postMessage|"
                                   r"sendBeacon|WebSocket|import\s*\(|innerHTML\s*=|\.value\s*=|\.submit\s*\(|"
                                   r"\.click\s*\(|dispatchEvent|__STATE__|__INITIAL|__NEXT_DATA__|__NUXT__")
CACHE_RUNNER = re.compile(r"^async\s*\(\)\s*=>\s*\{\s*const s = localStorage\.getItem\('__lapInventory'\)")


def block(msg: str) -> None:
    sys.stderr.write("parity shield guard: " + msg + "\n")
    sys.exit(2)


def norm(js: str) -> str:
    return re.sub(r"\s+", " ", js or "").strip()


def vetted_texts():
    out = []
    skill_scripts = os.path.dirname(HERE)
    for name in VETTED_SCRIPTS:
        p = os.path.join(skill_scripts, name)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                out.append(norm(f.read()))
    p = os.path.join(HERE, "shield_check.js")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            out.append(norm(f.read()))
    return out


def shield_running() -> bool:
    try:
        with open(os.path.join(SHIELD_HOME, "run.json"), encoding="utf-8") as f:
            info = json.load(f)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": "http://127.0.0.1:%d" % info["proxy_port"]}))
        with opener.open("http://parity-shield.invalid/status", timeout=2) as r:
            st = json.loads(r.read().decode())
        return st.get("shield") == "enforce" and st.get("run") == info.get("run_id")
    except Exception:  # noqa: BLE001
        return False


def host_matches(host: str, pattern: str) -> bool:
    host, pattern = host.lower().rstrip("."), pattern.lower().rstrip(".")
    if pattern.startswith("*."):
        return host == pattern[2:] or host.endswith(pattern[1:])
    return host == pattern


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--shielded-server", default="chrome-shielded")
    a = ap.parse_args()
    try:
        event = json.load(sys.stdin)
    except ValueError:
        sys.exit(0)
    tool = event.get("tool_name", "") or ""
    tin = event.get("tool_input", {}) or {}
    try:
        with open(a.config, encoding="utf-8") as f:
            targets = json.load(f).get("targets", [])
    except (OSError, ValueError):
        targets = []
    shielded_prefix = "mcp__%s__" % a.shielded_server

    # 3. Shell and file rules
    if tool == "Bash":
        cmd = tin.get("command", "")
        if re.search(r"shieldctl(\.py)?\s+(login|pin|pin-login|wipe|stop)\b", cmd):
            block("that shieldctl command is for the owner, in their own terminal. Ask them to run it.")
        if re.search(r"\bmitm(dump|proxy|web)\b", cmd):
            block("do not start mitmproxy yourself; the shield is started with shieldctl.py start.")
        sys.exit(0)
    if tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        path = os.path.abspath(os.path.expanduser(tin.get("file_path", "") or tin.get("notebook_path", "")))
        if (os.path.basename(path) == "shield.json" or path.startswith(SHIELD_HOME + os.sep)
                or path.startswith(HERE + os.sep)):
            block("the shield's config, control files and code are changed only by the owner.")
        sys.exit(0)
    if not tool.startswith("mcp__"):
        sys.exit(0)

    short = tool.rsplit("__", 1)[-1]
    # 1. Live-system hosts only through the shielded browser
    url = tin.get("url") or tin.get("uri") or ""
    if short in NAV_TOOLS and url and targets and not tool.startswith(shielded_prefix):
        host = urlsplit(url).hostname or ""
        if any(host_matches(host, t) for t in targets):
            block("%s is the live system: open it only with the %s browser tools." % (host, a.shielded_server))
    if not tool.startswith(shielded_prefix):
        sys.exit(0)

    # 2. Shielded server rules
    if short in NEVER_ON_SHIELDED:
        block("%s is never used on the live system (it can expose raw client data or act on the system)." % short)
    if not shield_running():
        block("the shield is not running (or not this run). Ask the owner to start it: shieldctl.py start.")
    if short == "evaluate_script":
        fn = norm(tin.get("function", ""))
        if fn in vetted_texts() or CACHE_RUNNER.match(fn):
            sys.exit(0)
        if fn.startswith("async () => { const fn = ") and "localStorage.setItem('__lapInventory'" in fn:
            inner = fn[len("async () => { const fn = "):fn.rfind("; localStorage.setItem")]
            if inner in vetted_texts():
                sys.exit(0)
        if len(fn) <= 400 and not FORBIDDEN_IN_SNIPPETS.search(fn):
            sys.exit(0)
        block("only the vetted scripts (inventory.js, tokens.js, ready.js, shield_check.js) or short read-only snippets may run on the live system.")
    sys.exit(0)


if __name__ == "__main__":
    main()
