"""Unit tests for guard_hook.py (the Claude Code PreToolUse guard). Stdlib only."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SHIELD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(SHIELD, "guard_hook.py")


class Guard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = os.path.join(self.tmp.name, "shield.json")
        with open(self.cfg, "w") as f:
            json.dump({"version": 1, "targets": ["*.forthcrm.com"], "log_dir": "/tmp/x"}, f)
        self.env = dict(os.environ, PARITY_SHIELD_HOME=os.path.join(self.tmp.name, "home"))  # no run.json: shield "not running"

    def tearDown(self):
        self.tmp.cleanup()

    def run_hook(self, tool, tool_input):
        p = subprocess.run([sys.executable, HOOK, "--config", self.cfg], input=json.dumps({"tool_name": tool, "tool_input": tool_input}),
                           capture_output=True, text=True, env=self.env)
        return p.returncode, p.stderr

    def test_unshielded_browser_cannot_open_live_system(self):
        rc, err = self.run_hook("mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page", {"url": "https://acme.forthcrm.com/clients"})
        self.assertEqual(rc, 2)
        self.assertIn("live system", err)
        rc, _ = self.run_hook("mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page", {"url": "http://localhost:3000/clients"})
        self.assertEqual(rc, 0)

    def test_shielded_tools_need_running_shield(self):
        rc, err = self.run_hook("mcp__chrome-shielded__take_screenshot", {})
        self.assertEqual(rc, 2)
        self.assertIn("not running", err)

    def test_never_tools_blocked_even_when_running(self):
        rc, err = self.run_hook("mcp__chrome-shielded__get_network_request", {"reqid": 3})
        self.assertEqual(rc, 2)
        self.assertIn("never used", err)

    def test_person_only_commands_and_mitm_blocked(self):
        for cmd in ("python3 shieldctl.py login --host a.forthcrm.com", "python3 x/shieldctl.py pin --config c",
                    "shieldctl.py stop", "mitmdump -p 9000"):
            rc, _ = self.run_hook("Bash", {"command": cmd})
            self.assertEqual(rc, 2, cmd)
        rc, _ = self.run_hook("Bash", {"command": "python3 shieldctl.py status"})
        self.assertEqual(rc, 0)

    def test_shield_files_not_editable(self):
        rc, _ = self.run_hook("Edit", {"file_path": "/Users/x/DFA/docs/parity/shield.json"})
        self.assertEqual(rc, 2)
        rc, _ = self.run_hook("Write", {"file_path": os.path.join(SHIELD, "shield_core.py")})
        self.assertEqual(rc, 2)
        rc, _ = self.run_hook("Edit", {"file_path": "/Users/x/DFA/src/app/page.tsx"})
        self.assertEqual(rc, 0)

    def test_unrelated_tools_pass(self):
        rc, _ = self.run_hook("Read", {"file_path": "/etc/hosts"})
        self.assertEqual(rc, 0)

    def test_shell_http_to_target_or_debug_port_blocked(self):
        for cmd in ("curl https://acme.forthcrm.com/api/clients",
                    "curl http://127.0.0.1:9333/json",
                    "python3 -c \"import urllib.request; urllib.request.urlopen('https://acme.forthcrm.com/x')\""):
            rc, _ = self.run_hook("Bash", {"command": cmd})
            self.assertEqual(rc, 2, cmd)
        rc, _ = self.run_hook("Bash", {"command": "curl https://example.com"})
        self.assertEqual(rc, 0)

    def test_shell_start_and_control_writes_blocked(self):
        for cmd in ("python3 shieldctl.py start --config c.json",
                    "echo '{}' > ~/.parity-shield/control.json",
                    "sed -i '' s/a/b/ docs/parity/shield.json"):
            rc, _ = self.run_hook("Bash", {"command": cmd})
            self.assertEqual(rc, 2, cmd)

    def test_webfetch_to_target_blocked(self):
        rc, _ = self.run_hook("WebFetch", {"url": "https://acme.forthcrm.com/clients/1", "prompt": "read"})
        self.assertEqual(rc, 2)
        rc, _ = self.run_hook("WebFetch", {"url": "https://docs.python.org", "prompt": "read"})
        self.assertEqual(rc, 0)

    def test_fail_closed_on_bad_config(self):
        with open(self.cfg, "w") as f:
            f.write("{ not json")
        rc, err = self.run_hook("mcp__chrome-shielded__take_screenshot", {})
        self.assertEqual(rc, 2)
        self.assertIn("could not be read", err)

    def test_unshielded_evaluate_naming_target_blocked(self):
        rc, _ = self.run_hook("mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script",
                              {"function": "() => fetch('https://acme.forthcrm.com/x')"})
        self.assertEqual(rc, 2)

    def test_vetted_script_edit_blocked(self):
        inv = os.path.join(os.path.dirname(SHIELD), "inventory.js")
        rc, _ = self.run_hook("Edit", {"file_path": inv})
        self.assertEqual(rc, 2)


class GuardWithRunningShield(unittest.TestCase):
    """evaluate_script rules need the shield to look 'running': stand up a fake status server."""

    def setUp(self):
        import http.server
        import threading
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        os.makedirs(self.home)
        self.cfg = os.path.join(self.tmp.name, "shield.json")
        with open(self.cfg, "w") as f:
            json.dump({"version": 1, "targets": ["*.forthcrm.com"], "log_dir": "/tmp/x"}, f)
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.srv = srv
        with open(os.path.join(self.home, "run.json"), "w") as f:
            json.dump({"run_id": "R1", "proxy_pid": os.getpid(), "chrome_pid": os.getpid(),
                       "proxy_port": self.port, "debug_port": 9333, "browser_url": "http://127.0.0.1:9333"}, f)
        self.env = dict(os.environ, PARITY_SHIELD_HOME=self.home)

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def _handler(self):
        import http.server
        port_holder = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                body = json.dumps({"shield": "enforce", "run": "R1"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        return H

    def run_hook(self, tool, tool_input):
        p = subprocess.run([sys.executable, HOOK, "--config", self.cfg],
                           input=json.dumps({"tool_name": tool, "tool_input": tool_input}),
                           capture_output=True, text=True, env=self.env)
        return p.returncode, p.stderr

    def test_vetted_scripts_allowed_snippets_and_bad_ones_blocked(self):
        ready = os.path.join(os.path.dirname(SHIELD), "ready.js")
        if os.path.exists(ready):
            with open(ready) as f:
                rc, _ = self.run_hook("mcp__chrome-shielded__evaluate_script", {"function": f.read()})
            self.assertEqual(rc, 0, "ready.js should be allowed")
        rc, _ = self.run_hook("mcp__chrome-shielded__evaluate_script", {"function": "() => document.title"})
        self.assertEqual(rc, 0, "short read-only snippet allowed")
        for bad in ("() => fetch('/api/x', {method:'POST'})", "() => document.querySelector('form').requestSubmit()",
                    "() => { window['fetch']('/x'); return document.body.outerHTML; }"):
            rc, _ = self.run_hook("mcp__chrome-shielded__evaluate_script", {"function": bad})
            self.assertEqual(rc, 2, bad)


if __name__ == "__main__":
    unittest.main()
