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


if __name__ == "__main__":
    unittest.main()
