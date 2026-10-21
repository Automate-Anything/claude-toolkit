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
FORBIDDEN_IN_SNIPPETS = re.compile(
    r"fetch\b|XMLHttpRequest|xmlhttp|\.open\s*\(|document\.cookie|cookieStore|sessionStorage|localStorage|indexedDB|"
    r"postMessage|sendBeacon|WebSocket|EventSource|import\s*\(|require\s*\(|innerHTML|outerHTML|insertAdjacent|"
    r"\.value\s*=|\[['\"]value['\"]\]\s*=|\.submit\s*\(|requestSubmit|\.click\s*\(|dispatchEvent|\.focus\s*\(|"
    r"__STATE__|__INITIAL|__NEXT_DATA__|__NUXT__|__APOLLO|window\s*\[|globalThis\s*\[|eval\s*\(|Function\s*\(|"
    r"navigator\.|location\s*=|location\.(href|assign|replace)|\.href\s*=|credentials",
    re.I)
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
        sys.exit(0)  # not a hook event we understand; let the harness decide
    tool = event.get("tool_name", "") or ""
    tin = event.get("tool_input", {}) or {}
    is_browser_or_mcp = tool.startswith("mcp__")
    try:
        with open(a.config, encoding="utf-8") as f:
            cfg = json.load(f)
        targets = cfg.get("targets", [])
        if not isinstance(targets, list) or not all(isinstance(t, str) for t in targets):
            raise ValueError("bad targets")
    except (OSError, ValueError):
        # Fail closed: without a readable target list we cannot tell live-system
        # traffic apart, so block anything that could reach it.
        if is_browser_or_mcp:
            block("the shield config could not be read; refusing browser/MCP tools until it is fixed.")
        targets = []
    shielded_prefix = "mcp__%s__" % a.shielded_server

    def names_target(text: str) -> bool:
        for host in re.findall(r"https?://([^/\s'\"\\)]+)", text or ""):
            host = host.split("@")[-1].split(":")[0]
            if any(host_matches(host, t) for t in targets):
                return True
        return False

    # 3. Shell and file rules
    if tool == "Bash":
        cmd = tin.get("command", "")
        if re.search(r"shieldctl(\.py)?\s+(login|pin|pin-login|wipe|stop|start)\b", cmd):
            block("shieldctl start/login/pin/stop/wipe are for the owner, in their own terminal. Ask them to run it.")
        if re.search(r"\bmitm(dump|proxy|web)\b", cmd):
            block("do not start mitmproxy yourself; the shield is started with shieldctl.py start.")
        # No direct HTTP to the live system or to the browser's debug port, which
        # would skip the proxy. (Reads of the live system go through the shielded browser.)
        if re.search(r"\b(curl|wget|http|https|nc|ncat|python[0-9.]*\s|node\s)", cmd) and (names_target(cmd) or re.search(r"127\.0\.0\.1:(9333|9222)|localhost:(9333|9222)", cmd)):
            block("do not reach the live system or the browser debug port from the shell; use the shielded browser.")
        # No shell edits to the shield's config or control files.
        if re.search(r"(>>?|tee|sed|cp|mv|dd|cat\s)\s", cmd) and re.search(r"shield\.json|\.parity-shield|control\.json", cmd):
            block("the shield's config and control files are changed only by the owner.")
        sys.exit(0)
    if tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        path = os.path.realpath(os.path.expanduser(tin.get("file_path", "") or tin.get("notebook_path", "")))
        base = os.path.basename(path).lower()
        scripts_dir = os.path.dirname(HERE)  # the skill's scripts/ folder (vetted .js live one level up)
        if (base in ("shield.json", "control.json") or path.startswith(os.path.realpath(SHIELD_HOME) + os.sep)
                or path.startswith(os.path.realpath(HERE) + os.sep)
                or (path.startswith(os.path.realpath(scripts_dir) + os.sep) and base in ("inventory.js", "tokens.js", "ready.js"))):
            block("the shield's config, control files, code and vetted scripts are changed only by the owner.")
        sys.exit(0)
    if tool == "WebFetch" and names_target(json.dumps(tin)):
        block("do not fetch the live system directly; read it through the shielded browser.")
    if not is_browser_or_mcp:
        sys.exit(0)

    short = tool.rsplit("__", 1)[-1]
    # 1. Live-system hosts only through the shielded browser (any tool input, not just a url field)
    if not tool.startswith(shielded_prefix) and names_target(json.dumps(tin)):
        block("that names the live system: reach it only with the %s browser tools." % a.shielded_server)
    if not tool.startswith(shielded_prefix):
        sys.exit(0)

    # 2. Shielded server rules
    if short in NEVER_ON_SHIELDED:
        block("%s is never used on the live system (it can expose raw client data or act on the system)." % short)
    if not shield_running():
        block("the shield is not running (or not this run). Ask the owner to start it: shieldctl.py start.")
    if short == "evaluate_script":
        fn = norm(tin.get("function", ""))
        vetted = vetted_texts()
        if fn in vetted or CACHE_RUNNER.match(fn):
            sys.exit(0)
        if fn.startswith("async () => { const fn = ") and "localStorage.setItem('__lapInventory'" in fn:
            inner = fn[len("async () => { const fn = "):fn.rfind("; localStorage.setItem")]
            if inner in vetted:
                sys.exit(0)
        if len(fn) <= 400 and not FORBIDDEN_IN_SNIPPETS.search(fn) and not names_target(fn):
            sys.exit(0)
        block("only the vetted scripts (inventory.js, tokens.js, ready.js, shield_check.js) or short read-only snippets may run on the live system.")
    sys.exit(0)


if __name__ == "__main__":
    main()
