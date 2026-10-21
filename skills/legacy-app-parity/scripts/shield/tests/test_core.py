"""Unit tests for shield_core: every decision branch and every masking rule.
Run: <shield venv python> -m unittest discover -s tests -v   (from scripts/shield)"""
import datetime as dt
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import shield_core as core  # noqa: E402

TODAY = dt.date(2026, 10, 21)
CFG = core.validate_config({
    "version": 1, "targets": ["*.crm.test"], "log_dir": "/tmp/x",
    "pinned_writes": [{"method": "POST", "host": "app.crm.test", "path": "/api/keepalive", "reason": "session ping",
                       "expires": "2026-10-28", "max_body": 64}],
    "login_rules": [{"method": "POST", "host": "app.crm.test", "path": "/u/start"}],
    "allow_get": [{"host": "app.crm.test", "path": "/reports/print-preview", "reason": "read-only preview"}],
}, today=TODAY)


def req(method, path, query="", headers=None, body=0, host="app.crm.test"):
    return core.Request(method=method, host=host, path=path, query=query, headers=headers or {}, body_len=body)


def d(r, login=None, now=1000.0):
    return core.decide(r, CFG, now, login, today=TODAY)


class Decisions(unittest.TestCase):
    def test_plain_reads_allowed(self):
        for p, q in [("/clients", ""), ("/clients/123", ""), ("/payments", ""), ("/settlements", "page=2"),
                     ("/reports/daily", ""), ("/api/v1/contacts", "page=2&sort=name"), ("/dashboard", ""), ("/", "")]:
            self.assertTrue(d(req("GET", p, q)).allow, p)
        self.assertTrue(d(req("HEAD", "/clients")).allow)

    def test_every_write_method_blocked(self):
        for m in ("POST", "PUT", "PATCH", "DELETE"):
            dec = d(req(m, "/api/clients/1", body=10))
            self.assertFalse(dec.allow, m)
            self.assertEqual(dec.kind, "write")

    def test_nonstandard_and_lowercase_methods_blocked(self):
        for m in ("post", "Get", "FOO", "PROPFIND", "CONNECT", "TRACE"):
            self.assertFalse(d(req(m, "/x")).allow, m)

    def test_read_with_body_blocked(self):
        self.assertFalse(d(req("GET", "/clients", body=5)).allow)
        self.assertFalse(d(req("GET", "/clients", headers={"transfer-encoding": "chunked"})).allow)

    def test_method_override_blocked(self):
        self.assertFalse(d(req("GET", "/clients/1", headers={"X-HTTP-Method-Override": "DELETE"})).allow)
        self.assertFalse(d(req("GET", "/clients/1", "_method=DELETE")).allow)

    def test_framework_postback_and_jsonp_blocked(self):
        self.assertFalse(d(req("GET", "/Client.aspx", "__EVENTTARGET=btnSave")).allow)
        self.assertFalse(d(req("GET", "/api/data", "callback=cb123")).allow)

    def test_danger_words_in_get(self):
        for p, q in [("/clients/1/delete", ""), ("/api/deleteClient", ""), ("/void.aspx", "id=1"), ("/x", "op=send"),
                     ("/x", "action=approve"), ("/api/%2564elete", ""), ("/logout", ""), ("/export/clients.csv", ""),
                     ("/documents/9/download", ""), ("/settle", "id=4"), ("/sendStatement", ""), ("/a", "do=PAYING")]:
            self.assertFalse(d(req("GET", p, q)).allow, p + "?" + q)

    def test_allow_get_exception_is_exact(self):
        self.assertTrue(d(req("GET", "/reports/print-preview")).allow)
        self.assertFalse(d(req("GET", "/reports/print-preview/2")).allow)
        self.assertFalse(d(req("GET", "/reports/print-preview", host="other.crm.test")).allow)

    def test_websocket_upgrade_blocked(self):
        self.assertFalse(d(req("GET", "/ws", headers={"upgrade": "websocket"})).allow)

    def test_options_only_as_preflight(self):
        self.assertTrue(d(req("OPTIONS", "/api/x", headers={"origin": "https://a", "access-control-request-method": "POST"})).allow)
        self.assertFalse(d(req("OPTIONS", "/api/x")).allow)

    def test_blocked_hosts_block_reads_too(self):
        for h in ("app.clixsign.com", "api.forthpay.example", "x.twilio.com", "secure.experian.com"):
            self.assertFalse(d(req("GET", "/anything", host=h)).allow, h)

    def test_pinned_write_exact_and_expiring(self):
        self.assertTrue(d(req("POST", "/api/keepalive", body=10)).allow)
        self.assertFalse(d(req("POST", "/api/keepalive", body=100)).allow)  # body cap
        self.assertFalse(d(req("POST", "/api/keepalive/2", body=10)).allow)
        self.assertFalse(d(req("PUT", "/api/keepalive", body=10)).allow)
        later = core.decide(req("POST", "/api/keepalive", body=10), CFG, 0, None, today=dt.date(2026, 10, 29))
        self.assertFalse(later.allow)

    def test_login_window_scoped_and_expiring(self):
        win = core.LoginWindow("app.crm.test", 2000.0)
        self.assertTrue(d(req("POST", "/login", body=40), win).allow)
        self.assertTrue(d(req("POST", "/u/start", body=40), win).allow)  # exact login rule
        self.assertFalse(d(req("POST", "/api/clients/save", body=40), win).allow)
        self.assertFalse(d(req("POST", "/clients/1/verify-bank", body=40), win).allow)
        self.assertFalse(d(req("POST", "/login", body=40, host="evil.crm.test"), win).allow)
        self.assertFalse(d(req("POST", "/login", body=40), win, now=2500.0).allow)
        self.assertFalse(d(req("POST", "/u/start", body=40)).allow)  # login rules only inside a window

    def test_graphql_blocked(self):
        self.assertFalse(d(req("POST", "/graphql", body=50)).allow)


class ConfigValidation(unittest.TestCase):
    base = {"version": 1, "targets": ["a.test"], "log_dir": "/tmp/x"}

    def bad(self, **kw):
        cfg = dict(self.base, **kw)
        with self.assertRaises(core.ConfigError):
            core.validate_config(cfg, today=TODAY)

    def test_rejections(self):
        self.bad(version=2)
        self.bad(targets=[])
        self.bad(log_dir="relative/path")
        self.bad(surprise=True)
        self.bad(pinned_writes=[{"method": "POST", "host": "*.a.test", "path": "/x", "reason": "r", "expires": "2026-10-25", "max_body": 1}])
        self.bad(pinned_writes=[{"method": "POST", "host": "a.test", "path": "/x.*", "reason": "r", "expires": "2026-10-25", "max_body": 1}])
        self.bad(pinned_writes=[{"method": "POST", "host": "a.test", "path": "/x", "reason": "r", "expires": "2027-01-01", "max_body": 1}])
        self.bad(pinned_writes=[{"method": "GET", "host": "a.test", "path": "/x", "reason": "r", "expires": "2026-10-25", "max_body": 1}])
        self.bad(pinned_writes=[{"method": "POST", "host": "a.test", "path": "/x", "expires": "2026-10-25", "max_body": 1}])
        self.bad(allow_get=[{"host": "a.test", "path": "^/x$", "reason": "r"}])
        self.bad(rate_per_sec=100)

    def test_example_config_valid(self):
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(here, "shield.example.json")) as f:
            core.validate_config(json.load(f))


class Masking(unittest.TestCase):
    def setUp(self):
        self.m = core.Masker(key=b"k" * 32)

    def test_deterministic_within_run_and_different_across_runs(self):
        self.assertEqual(self.m.fpe("Zebulon"), self.m.fpe("Zebulon"))
        self.assertNotEqual(self.m.fpe("Zebulon"), core.Masker(key=b"j" * 32).fpe("Zebulon"))
        self.assertNotEqual(core.Masker().fpe("Zebulon Quartermaine"), core.Masker().fpe("Zebulon Quartermaine"))

    def test_format_preserved(self):
        out = self.m.fpe("Ab-12 cd")
        self.assertRegex(out, r"^[A-Z][a-z]-\d\d [a-z][a-z]$")
        self.assertNotEqual(out, "Ab-12 cd")

    def test_shapes_obviously_fake(self):
        t = self.m.mask_patterns("SSN 123-45-6789 mail zeb.q@canary-mail.com tel (646) 231-7788 card 4111 1111 1111 1111")
        self.assertNotIn("123-45-6789", t)
        self.assertRegex(t, r"SSN 9\d\d-\d\d-\d{4}")
        self.assertIn("@example.invalid", t)
        self.assertRegex(t, r"\(555\) 555-01\d\d")
        self.assertNotIn("4111 1111 1111 1111", t)

    def test_routing_and_luhn_checks(self):
        self.assertNotIn("021000021", self.m.mask_patterns("routing 021000021"))  # valid ABA
        # Any bare 9-digit number may be an SSN, so it is masked even when it is just an order number.
        self.assertNotIn("123456780", self.m.mask_patterns("order 123456780 ref"))
        self.assertIn("1234567812345678", self.m.mask_patterns("id 1234567812345678"))  # fails Luhn: kept

    def test_json_identifiers(self):
        rec = {"id": 17, "clientId": "C-00017", "firstName": "Zebulon", "lastName": "Quartermaine", "ssn": "123-45-6789",
               "dob": "1980-02-03", "email": "zeb.q@canary-mail.com", "mobilePhone": "(646) 231-7788",
               "address": {"street": "1234 Canary Lane", "city": "Springfield", "zip": "62704"},
               "balance": 1520.55, "status": "Enrolled", "notes": "Lost job in March", "spouse": {"name": "Ophelia"},
               "bankAccountNumber": "000123456789", "routingNumber": "021000021"}
        out = self.m.mask_json(rec)
        blob = json.dumps(out)
        for canary in ("Zebulon", "Quartermaine", "123-45-6789", "1980-02-03", "canary-mail", "231-7788", "Canary Lane",
                       "Springfield", "62704", "Lost job", "Ophelia", "000123456789", "021000021"):
            self.assertNotIn(canary, blob, canary)
        self.assertEqual(out["id"], 17)
        self.assertEqual(out["clientId"], "C-00017")
        self.assertEqual(out["balance"], 1520.55)
        self.assertEqual(out["status"], "Enrolled")
        self.assertEqual(out["dob"], "1900-01-01")
        self.assertTrue(out["ssn"].startswith("9"))

    def test_interface_names_survive(self):
        cfg = {"fields": [{"name": "Hardship Reason", "type": "text", "fieldName": "hardship_reason", "label": "Hardship"}],
               "columns": [{"columnName": "Client Name", "displayName": "Client Name"}], "menu": [{"name": "Settlements"}]}
        out = self.m.mask_json(cfg)
        self.assertEqual(out["fields"][0]["name"], "Hardship Reason")
        self.assertEqual(out["fields"][0]["label"], "Hardship")
        self.assertEqual(out["columns"][0]["displayName"], "Client Name")
        self.assertEqual(out["menu"][0]["name"], "Settlements")

    def test_name_masked_inside_person_record(self):
        out = self.m.mask_json({"contacts": [{"name": "Zebulon Q", "email": "z@q.com"}]})
        self.assertNotIn("Zebulon", json.dumps(out))

    def test_label_value_pairs(self):
        out = self.m.mask_json([{"label": "SSN", "value": "123-45-6789"}, {"label": "Status", "value": "Active"}])
        self.assertNotIn("123-45-6789", json.dumps(out))
        self.assertEqual(out[1]["value"], "Active")

    def test_nested_json_string_and_datatables(self):
        out = self.m.mask_json({"d": json.dumps({"FirstName": "Zebulon"})})
        self.assertNotIn("Zebulon", json.dumps(out))
        out = self.m.mask_json({"data": [["Zebulon Q", 1520.5, "Enrolled"]], "recordsTotal": 1})
        self.assertNotIn("Zebulon", json.dumps(out))
        self.assertEqual(out["data"][0][1], 1520.5)
        self.assertEqual(out["recordsTotal"], 1)
        opts = self.m.mask_json({"states": [["AL", "Alabama"], ["TX", "Texas"]]})
        self.assertEqual(opts["states"][0][1], "Alabama")  # option lists are not record rows

    def test_xssi_prefix_kept(self):
        out = self.m.mask_json_text(")]}'\n" + json.dumps({"email": "a@b.com"}))
        self.assertTrue(out.startswith(")]}'"))
        self.assertNotIn("a@b.com", out)

    def test_html(self):
        html = ('<html><head><title>T</title></head><body>'
                '<input type="text" name="custname" value="Zebulon Q">'
                '<input type="hidden" name="__VIEWSTATE" value="ZEBULON-STATE">'
                '<input type=password name=pw value=secret123>'
                '<a href="mailto:zeb@q.com">mail</a> <a href="/clients/123456789">open</a>'
                '<textarea>Zebulon lost his job</textarea><td>SSN 123-45-6789</td>'
                '<script>window.__STATE__ = {"firstName":"Zebulon","status":"Enrolled"};</script></body></html>')
        out = self.m.mask_html(html)
        for canary in ("Zebulon", "ZEBULON-STATE", "secret123", "zeb@q.com", "123-45-6789"):
            self.assertNotIn(canary, out, canary)
        self.assertIn('href="/clients/123456789"', out)  # record links keep their ids
        self.assertIn('"status":"Enrolled"', out)

    def test_csv_and_xml(self):
        csv = "Name,SSN\nZebulon Q,123-45-6789\n"
        out = self.m.mask_csv(csv)
        self.assertTrue(out.startswith("Name,SSN\n"))
        self.assertNotIn("Zebulon", out)
        xml = "<r><FirstName>Zebulon</FirstName><Status>Open</Status></r>"
        out = self.m.mask_xml(xml)
        self.assertNotIn("Zebulon", out)
        self.assertIn("<Status>Open</Status>", out)


class Sniff(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(core.sniff(b'{"a":1}', "text/html", "/x"), "json")
        self.assertEqual(core.sniff(b"!function(){}", "application/javascript", "/static/app.js"), "js")
        self.assertEqual(core.sniff(b"{weird js", "text/javascript", "/main.js"), "js")
        self.assertEqual(core.sniff(b"<!doctype html><html>", "", "/"), "html")
        self.assertEqual(core.sniff(b"\x89PNG\r\n", "", "/doc/1"), "image")
        self.assertEqual(core.sniff(b"%PDF-1.4", "", "/doc/1"), "binary")
        self.assertEqual(core.sniff(b"data: x\n\n", "text/event-stream", "/s"), "sse")
        self.assertEqual(core.sniff(b"", "text/html", "/"), "empty")


class DryRun(unittest.TestCase):
    def test_credentials_never_written(self):
        m = core.Masker()
        self.assertTrue(core.mask_dryrun_body(b'{"user":"a","password":"p"}', "application/json", m, "/x").startswith(b"[withheld"))
        self.assertTrue(core.mask_dryrun_body(b"user=a&pin=1234", "application/x-www-form-urlencoded", m, "/x").startswith(b"[withheld"))
        self.assertTrue(core.mask_dryrun_body(b"anything", "", m, "/login").startswith(b"[withheld"))

    def test_values_masked_structure_kept(self):
        m = core.Masker()
        out = json.loads(core.mask_dryrun_body(b'{"firstName":"Zebulon","amount":50}', "application/json", m, "/api/save"))
        self.assertEqual(set(out), {"firstName", "amount"})
        self.assertNotEqual(out["firstName"], "Zebulon")
        out = core.mask_dryrun_body(b"__EVENTTARGET=btnSave&custname=Zebulon", "application/x-www-form-urlencoded", m, "/C.aspx")
        self.assertIn(b"__EVENTTARGET=btnSave", out)
        self.assertNotIn(b"Zebulon", out)


class GuardsAreLoadBearing(unittest.TestCase):
    """Knock each guard out and prove a test above notices."""

    def test_danger_vocabulary_knockout(self):
        with mock.patch.object(core, "DANGER_VERBS", []):
            with self.assertRaises(AssertionError):
                Decisions("test_danger_words_in_get").test_danger_words_in_get()

    def test_write_block_knockout(self):
        real = core.decide

        def permissive(r, cfg, now, login=None, today=None):
            dec = real(r, cfg, now, login, today)
            return core.Decision(True, "knocked out", "read") if dec.kind == "write" else dec
        with mock.patch.object(core, "decide", permissive):
            with self.assertRaises(AssertionError):
                Decisions("test_every_write_method_blocked").test_every_write_method_blocked()

    def test_strong_key_knockout(self):
        with mock.patch.object(core, "is_strong_key", lambda nk: False):
            with self.assertRaises(AssertionError):
                m = Masking("test_json_identifiers")
                m.setUp()
                m.test_json_identifiers()


if __name__ == "__main__":
    unittest.main()
