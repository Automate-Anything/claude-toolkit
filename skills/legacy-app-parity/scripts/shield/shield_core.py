"""
shield_core.py - the decisions and the masking behind the parity shield, with no
mitmproxy imports so every rule can be unit-tested directly.

Two jobs:
  1. decide(): may this request leave the machine? Default answer: no, unless it
     is a plain read, or it matches an exact rule the operator pinned.
  2. Masker: replace client identifiers in what the browser receives with
     obviously fake, format-preserving stand-ins, consistent within one run.

Python 3.12+ (runs inside the shield's own venv with mitmproxy).
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import hmac
import json
import os
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, unquote, urlencode

MAGIC_HOST = "parity-shield.invalid"
MAGIC_PREFIX = "/__parity_shield/"
READ_METHODS = {"GET", "HEAD"}
STANDARD_METHODS = {"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE", "CONNECT", "TRACE"}

# --------------------------------------------------------------------------- #
# Request decisions
# --------------------------------------------------------------------------- #
# Verbs that make a GET suspicious. Matched as whole tokens (after decoding and
# splitting camelCase and separators) in the path and in query keys and values,
# with verb endings, so "delete" also catches "deleted" and "deleting". Nouns such
# as "payments" or "settlements" (list pages) are deliberately not matched.
DANGER_VERBS = [
    "delete", "remove", "destroy", "void", "cancel", "refund", "logout", "logoff", "signout",
    "send", "email", "mail", "sms", "text", "call", "dial", "approve", "post", "pay", "charge",
    "submit", "archive", "purge", "reset", "import", "merge", "batch", "run", "process",
    "execute", "finalize", "finalise", "unsubscribe", "activate", "deactivate", "enroll", "enrol",
    "disburse", "sign", "create", "save", "update", "assign", "transfer", "generate", "export",
    "download", "print", "settle", "refresh", "pull", "sync", "upload", "del", "notify", "dispatch",
    "trigger", "schedule", "draft", "issue", "release", "close", "reopen", "restore", "write",
]
VERB_ENDINGS = ("", "s", "es", "d", "ed", "ing")
FRAMEWORK_GET_KEYS = {"__eventtarget", "__eventargument", "__viewstate", "__eventvalidation", "__viewstategenerator"}
JSONP_KEYS = {"callback", "jsonp", "cb", "jsoncallback"}
ACTION_KEYS = {"action", "cmd", "command", "op", "operation", "mode", "do", "task", "method", "event"}
OVERRIDE_HEADERS = ("x-http-method-override", "x-http-method", "x-method-override")
DEFAULT_BLOCKED_HOST_PARTS = [
    "clixsign", "forthpay", "forth-pay", "dialer", "twilio", "sendgrid", "mailgun", "postmark",
    "mandrill", "experian", "equifax", "transunion", "plaid", "nmi.com", "authorize.net", "epps",
]
AUTH_PATH = re.compile(
    r"/(login|signin|sign-in|session|sessions|auth|authenticate|oauth/token|token|mfa|2fa|otp|verify|saml|sso|callback)/?$",
    re.I,
)
CODE_EXT = re.compile(r"\.(js|mjs|css|woff2?|ttf|otf|eot|map)$", re.I)
IMAGE_EXT = re.compile(r"\.(png|jpe?g|gif|webp|bmp|tiff?|heic|svg|ico|avif)$", re.I)


def _tokens(text: str) -> list[str]:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
    return [t for t in re.split(r"[^A-Za-z0-9]+", text.lower()) if t]


def _decode(s: str) -> str:
    prev = None
    for _ in range(4):
        if s == prev:
            break
        prev, s = s, unquote(s.replace("+", " "))
    return s


def danger_words_in(path: str, query: str, extra: list[str] | None = None) -> list[str]:
    verbs = DANGER_VERBS + [w.lower() for w in (extra or [])]
    forms = {v + e for v in verbs for e in VERB_ENDINGS}
    hits: list[str] = []
    parts = [_decode(path)] + [_decode(k) + " " + _decode(v) for k, v in parse_qsl(query, keep_blank_values=True)]
    for part in parts:
        for t in _tokens(part):
            if t in forms and t not in hits:
                hits.append(t)
    return hits


def host_matches(host: str, pattern: str) -> bool:
    host, pattern = host.lower().rstrip("."), pattern.lower().rstrip(".")
    if pattern.startswith("*."):
        return host == pattern[2:] or host.endswith(pattern[1:])
    return host == pattern


def normalize_path(path: str) -> str:
    p = re.sub(r"/{2,}", "/", _decode(path))
    return p or "/"


@dataclass
class Request:
    method: str
    host: str
    path: str  # without the query string
    query: str = ""
    headers: dict = field(default_factory=dict)
    body_len: int = 0
    scheme: str = "https"


@dataclass
class Decision:
    allow: bool
    reason: str
    kind: str


class ConfigError(ValueError):
    pass


ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CONFIG_KEYS = {"version", "proxy_port", "debug_port", "targets", "static_hosts", "static_paths", "blocked_hosts",
               "danger_words", "allow_get", "pinned_writes", "login_rules", "websocket_allow", "rate_per_sec",
               "burst", "log_dir", "mask", "upstream_ca", "_comment"}


def validate_config(cfg: dict, today: _dt.date | None = None) -> dict:
    """Raise ConfigError on anything doubtful: unknown keys, patterns where an
    exact value is required, missing reasons, long or missing expiry dates."""
    today = today or _dt.date.today()
    if not isinstance(cfg, dict):
        raise ConfigError("config must be a JSON object")
    unknown = set(cfg) - CONFIG_KEYS
    if unknown:
        raise ConfigError("unknown config keys: %s" % ", ".join(sorted(unknown)))
    if cfg.get("version") != 1:
        raise ConfigError("version must be 1")
    targets = cfg.get("targets")
    if not isinstance(targets, list) or not targets or not all(isinstance(t, str) and t for t in targets):
        raise ConfigError("targets must list the old system's hosts")
    log_dir = cfg.get("log_dir")
    if not isinstance(log_dir, str) or not os.path.isabs(os.path.expanduser(log_dir)):
        raise ConfigError("log_dir must be an absolute path")

    def exact(rule, keys, what):
        if not isinstance(rule, dict):
            raise ConfigError("%s entries must be objects" % what)
        for k in keys:
            v = rule.get(k)
            if not isinstance(v, str) or not v:
                raise ConfigError("%s rule needs %s" % (what, k))
            if k in ("host", "path") and re.search(r"[*?\[\]()|^$\\+{}]", v):
                raise ConfigError("%s rule %s must be exact, no wildcards or patterns: %r" % (what, k, v))
        if "path" in keys and not rule["path"].startswith("/"):
            raise ConfigError("%s rule path must start with /" % what)

    for r in cfg.get("pinned_writes", []):
        exact(r, ["method", "host", "path", "reason", "expires"], "pinned_writes")
        if r["method"] != r["method"].upper() or r["method"] not in STANDARD_METHODS or r["method"] in READ_METHODS | {"OPTIONS", "CONNECT", "TRACE"}:
            raise ConfigError("pinned_writes method must be an uppercase write method")
        if not ISO_DATE.match(r["expires"]):
            raise ConfigError("pinned_writes expires must be YYYY-MM-DD")
        if (_dt.date.fromisoformat(r["expires"]) - today).days > 30:
            raise ConfigError("pinned_writes may not expire more than 30 days out")
        if not isinstance(r.get("max_body"), int) or not 0 <= r["max_body"] <= 65536:
            raise ConfigError("pinned_writes max_body must be an integer 0..65536")
    for r in cfg.get("login_rules", []):
        exact(r, ["method", "host", "path"], "login_rules")
    for r in cfg.get("allow_get", []):
        exact(r, ["host", "path", "reason"], "allow_get")
    for r in cfg.get("websocket_allow", []):
        exact(r, ["host", "path", "reason"], "websocket_allow")
    if "static_paths" in cfg:
        try:
            re.compile(cfg["static_paths"])
        except re.error as e:
            raise ConfigError("static_paths is not a valid pattern: %s" % e)
    rate = cfg.get("rate_per_sec", 4)
    if not isinstance(rate, (int, float)) or not 0 < rate <= 20:
        raise ConfigError("rate_per_sec must be between 0 and 20")
    return cfg


@dataclass
class LoginWindow:
    host: str = ""
    until: float = 0.0

    def open_for(self, host: str, now: float) -> bool:
        return bool(self.host) and now < self.until and host_matches(host, self.host)


def decide(req: Request, cfg: dict, now: float, login: LoginWindow | None = None,
           today: _dt.date | None = None) -> Decision:
    """The single source of truth. Anything not explicitly allowed is blocked."""
    today = today or _dt.date.today()
    method, host = req.method, req.host.lower()
    path = normalize_path(req.path)
    h = {str(k).lower(): v for k, v in req.headers.items()}

    if method not in STANDARD_METHODS:
        return Decision(False, "non-standard method %r" % method[:16], "method")
    if method in ("CONNECT", "TRACE"):
        return Decision(False, "%s not allowed" % method, "method")
    blocked_parts = DEFAULT_BLOCKED_HOST_PARTS + [str(b).lower() for b in cfg.get("blocked_hosts", [])]
    if any(part and part in host for part in blocked_parts):
        return Decision(False, "host on the blocked list", "host")
    if any(k in h for k in OVERRIDE_HEADERS):
        return Decision(False, "method-override header", "override")
    qpairs = parse_qsl(req.query, keep_blank_values=True)
    qkeys = {_decode(k).lower() for k, _ in qpairs}
    if "_method" in qkeys:
        return Decision(False, "_method override parameter", "override")

    if method in READ_METHODS:
        if req.body_len > 0 or "transfer-encoding" in h:
            return Decision(False, "%s with a body" % method, "body-on-read")
        if qkeys & FRAMEWORK_GET_KEYS:
            return Decision(False, "framework postback fields on a GET", "framework")
        if qkeys & JSONP_KEYS:
            return Decision(False, "JSONP callback", "jsonp")
        for k, v in qpairs:
            if _decode(k).lower() in ACTION_KEYS and danger_words_in("", "x=" + v, cfg.get("danger_words")):
                return Decision(False, "action parameter %s" % k[:20], "danger-get")
        if h.get("upgrade", "").lower() == "websocket":
            for r in cfg.get("websocket_allow", []):
                if host_matches(host, r["host"]) and path == r["path"]:
                    return Decision(True, "pinned websocket", "websocket")
            return Decision(False, "websocket upgrade", "websocket")
        words = danger_words_in(path, req.query, cfg.get("danger_words"))
        if words:
            for r in cfg.get("allow_get", []):
                if host_matches(host, r["host"]) and path == r["path"]:
                    return Decision(True, "allow_get exception", "read")
            return Decision(False, "risky word(s) in a GET: %s" % ", ".join(words[:5]), "danger-get")
        return Decision(True, "read", "read")

    if method == "OPTIONS":
        if "origin" in h and "access-control-request-method" in h and req.body_len == 0:
            return Decision(True, "CORS preflight", "preflight")
        return Decision(False, "OPTIONS that is not a CORS preflight", "method")

    for r in cfg.get("pinned_writes", []):
        if r["method"] == method and host_matches(host, r["host"]) and path == r["path"]:
            if _dt.date.fromisoformat(r["expires"]) < today:
                continue
            if req.body_len > r["max_body"]:
                return Decision(False, "pinned rule body cap exceeded", "write")
            return Decision(True, "pinned: %s" % r["reason"][:60], "pinned")

    if login and method == "POST" and login.open_for(host, now):
        exact_ok = any(r["method"] == method and host_matches(host, r["host"]) and path == r["path"]
                       for r in cfg.get("login_rules", []))
        if exact_ok or AUTH_PATH.search(path):
            return Decision(True, "login window", "login")

    return Decision(False, "%s blocked (read-only shield)" % method, "write")


# --------------------------------------------------------------------------- #
# Masking
# --------------------------------------------------------------------------- #
STRONG_KEYS = {
    "firstname", "lastname", "middlename", "fullname", "givenname", "familyname", "surname", "maidenname",
    "alias", "nickname", "ssn", "social", "socialsecurity", "taxid", "tin", "ein", "itin", "dob", "dateofbirth",
    "birthdate", "birthday", "email", "phone", "mobile", "cell", "fax", "telephone", "address", "street",
    "addressline", "city", "zip", "zipcode", "postal", "postcode", "county", "apt", "accountnumber", "accountno",
    "accountnum", "acct", "routing", "aba", "iban", "swift", "card", "cardnumber", "pan", "cvv", "cvc", "expiry",
    "expiration", "bank", "employer", "license", "driverslicense", "passport", "signature", "ipaddress",
    "username", "login", "password", "passwd", "pwd", "secret", "token", "apikey", "spouse", "coapplicant",
    "cosigner", "coborrower", "reference", "beneficiary", "emergencycontact", "last4", "lastfour",
    "casenumber", "filenumber", "filename", "note", "notes", "comment", "comments", "memo", "hardship",
    "hardshipreason", "description", "age",
}
SHORT_AFFIX_KEYS = ("ssn", "dob", "zip")
# Keys ending in "name" are identifying (firstName, clientName) except these,
# which name parts of the interface; masking them would scramble the labels
# the parity work needs. A bare "name" is masked only inside person records.
UI_NAME_KEYS = {
    "name", "fieldname", "columnname", "displayname", "tablename", "propertyname", "typename", "classname",
    "templatename", "statusname", "stagename", "rolename", "permissionname", "groupname", "modulename",
    "pagename", "tabname", "menuname", "buttonname", "sectionname", "formname", "reportname", "viewname",
    "eventname", "actionname", "campaignname", "productname", "planname", "workflowname", "triggername",
    "categoryname", "labelname", "keyname", "settingname", "optionname", "listname", "teamname",
}
CONTEXT_KEYS = {"name", "title", "reason", "value", "text", "details", "message", "body", "subject"}
ID_KEY = re.compile(r"^(id|ids|uuid|guid|.+id|.+ids|.+uuid|.+guid)$")
PERSONISH_PARENTS = re.compile(r"(client|contact|customer|consumer|debtor|applicant|lead|spouse|cosigner|person|"
                               r"user|enrollee|borrower|reference|beneficiary|employer)", re.I)
TABLE_PARENTS = re.compile(r"^(data|aadata|rows|records|items|results|list)$")
LABEL_KEYS = {"label", "name", "key", "field", "fieldname", "title"}


def norm_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(k).lower())


def is_strong_key(nk: str) -> bool:
    if nk in ("taxid", "ssnid"):
        return True
    if ID_KEY.match(nk):
        return False
    if nk in UI_NAME_KEYS:
        return False
    if nk in STRONG_KEYS or nk.endswith("name"):
        return True
    if any(nk.startswith(s) or nk.endswith(s) for s in SHORT_AFFIX_KEYS):
        return True
    return any(nk.startswith(s) or nk.endswith(s) for s in STRONG_KEYS if len(s) > 3)


PAT_SSN = re.compile(r"(?<!\d)(\d{3})([- ]?)(\d{2})\2(\d{4})(?!\d)")
PAT_SSN_DASHED = re.compile(r"(?<!\d)(\d{3})(-)(\d{2})-(\d{4})(?!\d)")
PAT_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+(?:@|%40)[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PAT_PHONE = re.compile(r"(?<![\d.])(?:\+?1[ .\-]?)?\(?\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}(?![\d.])")
PAT_CARD = re.compile(r"(?<!\d)(?:\d[ \-]?){12,18}\d(?!\d)")
PAT_ZIP4 = re.compile(r"(?<!\d)\d{5}-\d{4}(?!\d)")
PAT_STREET = re.compile(r"\b\d{1,6}\s+(?:[A-Za-z0-9.'\-]+\s){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|"
                        r"Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace|Trl|"
                        r"Trail|Sq|Square)\b\.?", re.I)
PAT_JWT = re.compile(r"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}")
PAT_B64 = re.compile(r"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{200,}={0,2}")


def luhn_ok(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = ord(ch) - 48
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def aba_ok(digits: str) -> bool:
    if len(digits) != 9 or not digits.isdigit():
        return False
    w = (3, 7, 1) * 3
    return sum(int(c) * w[i] for i, c in enumerate(digits)) % 10 == 0


class Masker:
    """Obviously fake, format-preserving masks derived from an HMAC of the whole
    value with a random per-run key that is never written anywhere."""

    INPUT_TEXT_TYPES = {"", "text", "email", "tel", "number", "date", "datetime-local", "month", "search", "url",
                        "week", "time"}

    def __init__(self, key: bytes | None = None, extra_keys: list[str] | None = None):
        self._key = key or os.urandom(32)
        self.extra_keys = {norm_key(k) for k in (extra_keys or [])}

    # ----- primitives -----
    def _stream(self, value: str):
        counter = 0
        data = value.encode("utf-8", "surrogatepass")
        while True:
            yield from hmac.new(self._key, b"%d|" % counter + data, hashlib.sha256).digest()
            counter += 1

    def fpe(self, value: str) -> str:
        """Letters -> letters (case kept), digits -> digits, other characters kept."""
        if not value:
            return value
        s = self._stream(value)
        out = []
        for ch in value:
            if "a" <= ch <= "z":
                out.append(chr(97 + next(s) % 26))
            elif "A" <= ch <= "Z":
                out.append(chr(65 + next(s) % 26))
            elif "0" <= ch <= "9":
                out.append(chr(48 + next(s) % 10))
            elif ch.isalpha() or ch.isdigit():
                out.append("x")
            else:
                out.append(ch)
        return "".join(out)

    def _digits(self, value: str, n: int) -> str:
        s = self._stream("digits|" + value)
        return "".join(chr(48 + next(s) % 10) for _ in range(n))

    def ssn(self, m: re.Match) -> str:
        d = self._digits(m.group(0), 8)
        sep = m.group(2)
        return "9%s%s%s%s%s" % (d[:2], sep, d[2:4], sep, d[4:8])

    def email(self, value: str) -> str:
        return "user%s@example.invalid" % self._digits(value, 6)

    def phone(self, value: str) -> str:
        digits = "55555501" + self._digits(value, 2)
        core = re.sub(r"^\+?1[ .\-]?", "", value)
        out, i = [], 0
        for ch in core:
            if ch.isdigit() and i < len(digits):
                out.append(digits[i])
                i += 1
            else:
                out.append(ch)
        return "".join(out)

    @staticmethod
    def date_like(value: str) -> str | None:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}([T ].*)?", value):
            return "1900-01-01" + value[10:]
        m = re.fullmatch(r"\d{1,2}/\d{1,2}/(\d{2,4})", value)
        if m:
            return "01/01/1900" if len(m.group(1)) == 4 else "01/01/00"
        return None

    # ----- free text -----
    def mask_patterns(self, text: str) -> str:
        """Identifiers that can be recognized by shape, anywhere in text."""
        if not text:
            return text

        def card(m):
            raw = re.sub(r"\D", "", m.group(0))
            return self.fpe(m.group(0)) if 13 <= len(raw) <= 19 and luhn_ok(raw) else m.group(0)

        text = PAT_JWT.sub("[masked-token]", text)
        text = PAT_B64.sub("[masked-blob]", text)
        text = PAT_EMAIL.sub(lambda m: self.email(m.group(0)), text)
        text = PAT_CARD.sub(card, text)
        text = PAT_SSN.sub(self.ssn, text)
        text = PAT_PHONE.sub(lambda m: self.phone(m.group(0)), text)
        text = PAT_ZIP4.sub(lambda m: self.fpe(m.group(0)), text)
        text = PAT_STREET.sub(lambda m: self.fpe(m.group(0)), text)
        text = re.sub(r"(?<!\d)\d{9}(?!\d)", lambda m: self.fpe(m.group(0)) if aba_ok(m.group(0)) else m.group(0), text)
        return text

    def mask_url(self, text: str) -> str:
        """Links keep record numbers (otherwise navigation breaks); only contact
        details, dashed SSNs and tokens inside them are masked."""
        if not text:
            return text
        text = PAT_JWT.sub("[masked-token]", text)
        text = PAT_EMAIL.sub(lambda m: self.email(m.group(0)), text)
        text = PAT_SSN_DASHED.sub(self.ssn, text)
        text = PAT_PHONE.sub(lambda m: self.phone(m.group(0)), text)
        return text

    # ----- values under identifying keys -----
    def mask_scalar(self, key_norm: str, v):
        if v is None or isinstance(v, bool):
            return v
        if isinstance(v, int):
            n = len(str(abs(v)))
            return int("9" + self._digits(str(v), n - 1)) if n > 1 else 9
        if isinstance(v, float):
            return float(int("9" + self._digits(repr(v), 3)))
        if not isinstance(v, str) or not v.strip():
            return v
        if key_norm in ("password", "passwd", "pwd", "secret", "apikey") or key_norm.endswith("token"):
            return "[masked-secret]"
        if "email" in key_norm or "@" in v:
            return self.email(v) if "@" in v or "%40" in v else self.fpe(v)
        if any(x in key_norm for x in ("phone", "mobile", "fax", "cell", "telephone")):
            return self.phone(v) if re.search(r"\d{3}\D*\d{4}", v) else self.fpe(v)
        if "birth" in key_norm or key_norm in ("dob", "dateofbirth"):
            return self.date_like(v) or self.fpe(v)
        m = PAT_SSN.fullmatch(v)
        if m:
            return self.ssn(m)
        return self.fpe(v)

    def _mask_all(self, v, nk: str):
        if isinstance(v, dict):
            return {k: self._mask_all(x, nk) for k, x in v.items()}
        if isinstance(v, list):
            return [self._mask_all(x, nk) for x in v]
        return self.mask_scalar(nk, v)

    # ----- JSON -----
    def mask_json(self, obj, parent_key: str = "", person_ctx: bool = False):
        if isinstance(obj, dict):
            nkeys = {k: norm_key(k) for k in obj}
            ctx = (person_ctx or bool(PERSONISH_PARENTS.search(str(parent_key)))
                   or any(is_strong_key(nk) for nk in nkeys.values()))
            label = next((obj[k] for k in obj if nkeys[k] in LABEL_KEYS and isinstance(obj[k], str)), None)
            label_is_pii = bool(label) and is_strong_key(norm_key(label))
            out = {}
            for k, v in obj.items():
                nk = nkeys[k]
                if nk in self.extra_keys or is_strong_key(nk):
                    out[k] = self._mask_all(v, nk)
                elif nk == "value" and label_is_pii:
                    out[k] = self._mask_all(v, norm_key(label))
                elif ctx and nk in CONTEXT_KEYS and not isinstance(v, (dict, list)):
                    out[k] = self.mask_scalar(nk, v)
                elif ID_KEY.match(nk) and isinstance(v, (str, int)):
                    out[k] = v
                else:
                    out[k] = self.mask_json(v, str(k), ctx and isinstance(v, (dict, list)))
            return out
        if isinstance(obj, list):
            if (obj and TABLE_PARENTS.match(norm_key(parent_key)) and all(isinstance(r, list) for r in obj)
                    and all(not isinstance(c, (dict, list)) for r in obj for c in r)):
                # DataTables-style rows: every string cell is record data.
                return [[self.fpe(c) if isinstance(c, str) else c for c in r] for r in obj]
            return [self.mask_json(v, parent_key, person_ctx) for v in obj]
        if isinstance(obj, str):
            s = obj.strip()
            if len(s) > 1 and s[0] in "{[" and s[-1] in "}]":
                try:
                    inner = json.loads(s)
                except ValueError:
                    inner = None
                if inner is not None:
                    return json.dumps(self.mask_json(inner, parent_key, person_ctx), separators=(",", ":"))
            return self.mask_patterns(obj)
        return obj

    def mask_json_text(self, text: str) -> str:
        text = text.lstrip("﻿")
        prefix = ""
        for guard in (")]}',\n", ")]}'\n", ")]}'", "while(1);", "for(;;);"):
            if text.startswith(guard):
                prefix, text = guard, text[len(guard):]
                break
        return prefix + json.dumps(self.mask_json(json.loads(text)), ensure_ascii=False, separators=(",", ":"))

    # ----- CSV, XML, text -----
    def mask_csv(self, text: str) -> str:
        lines = text.splitlines(keepends=True)
        if not lines:
            return text
        out = [lines[0]]
        for line in lines[1:]:
            body = line.rstrip("\r\n")
            out.append(self.fpe(body) + line[len(body):])
        return "".join(out)

    def mask_xml(self, text: str) -> str:
        def elem(m):
            tag, attrs, inner = m.group(1), m.group(2) or "", m.group(3)
            if is_strong_key(norm_key(tag.split(":")[-1])):
                return "<%s%s>%s</%s>" % (tag, attrs, self.fpe(inner), tag)
            return m.group(0)
        text = re.sub(r"<([A-Za-z_][\w:.\-]*)(\s[^<>]*)?>([^<]*)</\1>", elem, text)
        return self.mask_patterns(text)

    def mask_text(self, text: str) -> str:
        """Plain text: short status words pass with shape masking only; anything
        longer is treated as record content."""
        if len(text) <= 64:
            return self.mask_patterns(text)
        return self.fpe(text)

    # ----- HTML -----
    def mask_html(self, html: str) -> str:
        out, pos = [], 0
        for m in re.finditer(r"(<(script|style)\b[^>]*>)(.*?)(</\2\s*>)", html, re.I | re.S):
            out.append(self._mask_markup(html[pos:m.start()]))
            out.append(m.group(1))
            out.append(self._mask_inline_script(m.group(3)) if m.group(2).lower() == "script" else m.group(3))
            out.append(m.group(4))
            pos = m.end()
        out.append(self._mask_markup(html[pos:]))
        return "".join(out)

    def _mask_inline_script(self, js: str) -> str:
        def kv(m):
            nk = norm_key(m.group(2))
            if not is_strong_key(nk):
                return m.group(0)
            masked = self.mask_scalar(nk, m.group(5))
            if not isinstance(masked, str):
                masked = self.fpe(m.group(5))
            return "%s%s%s%s%s%s%s" % (m.group(1), m.group(2), m.group(1), m.group(3), m.group(4), masked, m.group(4))
        js = re.sub(r"(['\"]?)([A-Za-z_][A-Za-z0-9_]{1,60})\1(\s*:\s*)(['\"])((?:\\.|(?!\4).){0,500})\4", kv, js)
        js = PAT_EMAIL.sub(lambda m: self.email(m.group(0)), js)
        js = PAT_SSN_DASHED.sub(self.ssn, js)
        return js

    def _mask_tag(self, tag: str) -> str:
        name_m = re.match(r"<\s*([A-Za-z][A-Za-z0-9\-]*)", tag)
        name = name_m.group(1).lower() if name_m else ""

        def attr(m):
            aname = m.group(1)
            quote = m.group(2) or ""
            val = m.group(3) if m.group(2) else (m.group(4) or "")
            al = aname.lower()

            def put(v):
                q = quote or '"'
                return "%s=%s%s%s" % (aname, q, v.replace(q, "&quot;" if q == '"' else "&#39;"), q)

            if name == "input" and al == "value":
                t = re.search(r"\btype\s*=\s*['\"]?([A-Za-z\-]+)", tag, re.I)
                ttype = t.group(1).lower() if t else ""
                nm = re.search(r"\bname\s*=\s*['\"]?([^'\"\s>]+)", tag, re.I)
                nmv = nm.group(1).lower() if nm else ""
                if nmv in ("__viewstate", "__eventvalidation"):
                    return put("PARITY-SHIELD-REMOVED")
                if ttype in self.INPUT_TEXT_TYPES:
                    return put(self.fpe(val))
                if ttype == "password":
                    return put("")
                return put(self.mask_url(val))
            if al == "href" and re.match(r"\s*(mailto|tel|sms|callto):", val, re.I):
                return put("#parity-masked")
            if al in ("href", "src", "action", "formaction", "srcset", "poster"):
                return put(self.mask_url(val))
            if al in ("title", "alt", "placeholder", "value", "content", "label") or al.startswith(("aria-", "data-")):
                return put(self.mask_patterns(val))
            return m.group(0)

        return re.sub(r"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:(['\"])(.*?)\2|([^\s\"'>=`]+))", attr, tag, flags=re.S)

    def _mask_markup(self, html: str) -> str:
        out, in_textarea = [], False
        for p in re.split(r"(<[^>]*>)", html):
            if p.startswith("<"):
                low = p.lower()
                if low.startswith("<textarea"):
                    in_textarea = True
                elif low.startswith("</textarea"):
                    in_textarea = False
                out.append(self._mask_tag(p))
            elif in_textarea and p.strip():
                out.append(self.fpe(p))
            else:
                out.append(self.mask_patterns(p))
        return "".join(out)


# --------------------------------------------------------------------------- #
# Body sniffing and dry-run bodies
# --------------------------------------------------------------------------- #
def sniff(body: bytes, content_type: str, path: str) -> str:
    """Decide the body type from the bytes first, the header second."""
    ct = (content_type or "").lower()
    if "text/event-stream" in ct:
        return "sse"
    if not body:
        return "empty"
    if CODE_EXT.search(path) and "json" not in ct and "html" not in ct:
        return "js" if path.lower().endswith((".js", ".mjs")) else "code"
    head = body[:2048].lstrip(b"\xef\xbb\xbf \t\r\n")
    if head[:1] in (b"{", b"[") or head.startswith((b")]}'", b"while(1);", b"for(;;);")):
        return "json"
    low = head[:512].lower()
    if head[:1] == b"<" and (low.startswith((b"<!doctype html", b"<html")) or b"<html" in low or b"<body" in low
                             or b"<head" in low or "html" in ct):
        return "html"
    if low.startswith(b"<?xml") or ("xml" in ct and head[:1] == b"<"):
        return "xml"
    if head.startswith((b"\x89PNG", b"GIF8", b"\xff\xd8\xff", b"RIFF")) or "image/" in ct:
        return "image"
    if head.startswith((b"%PDF", b"PK\x03\x04", b"\xd0\xcf\x11\xe0")) or "pdf" in ct or "octet-stream" in ct:
        return "binary"
    if "javascript" in ct or "ecmascript" in ct:
        return "js"
    if "css" in ct or "font" in ct:
        return "code"
    if "csv" in ct:
        return "csv"
    try:
        body[:4096].decode("utf-8")
    except UnicodeDecodeError:
        return "binary"
    return "text"


SECRET_BODY = re.compile(r"(?i)[\"']?(pass(word|wd)?|pwd|secret|otp|mfa[_-]?code|2fa|one[_-]?time[_-]?code|pin)[\"']?\s*[:=]")
KEEP_FORM_KEYS = re.compile(r"^(__EVENTTARGET|__EVENTARGUMENT|action|cmd|command|mode|op|operation|method|task|event)$", re.I)


def mask_dryrun_body(body: bytes, content_type: str, masker: Masker, path: str) -> bytes:
    """Bodies the browser tried to send: every value masked, structure kept.
    Anything that may hold credentials is never written."""
    if AUTH_PATH.search(path) or SECRET_BODY.search(body[:16384].decode("latin-1")):
        return b"[withheld: may contain credentials]"
    ct = (content_type or "").lower()
    text = body.decode("utf-8", "replace")

    def all_values(o):
        if isinstance(o, dict):
            return {k: all_values(v) for k, v in o.items()}
        if isinstance(o, list):
            return [all_values(v) for v in o]
        if isinstance(o, str):
            return masker.fpe(o)
        return o

    if text.lstrip()[:1] in ("{", "["):
        try:
            return json.dumps(all_values(json.loads(text)), separators=(",", ":")).encode()
        except ValueError:
            pass
    if "x-www-form-urlencoded" in ct or re.match(r"^[\w.%\-\[\]]+=", text):
        pairs = []
        for k, v in parse_qsl(text, keep_blank_values=True):
            if k.lower() in ("__viewstate", "__eventvalidation"):
                pairs.append((k, "[framework-state]"))
            elif KEEP_FORM_KEYS.match(k) and re.fullmatch(r"[A-Za-z0-9_$:.\-/]{1,60}", v or ""):
                pairs.append((k, v))
            else:
                pairs.append((k, masker.fpe(v)))
        return urlencode(pairs).encode()
    if "multipart/form-data" in ct:
        names = re.findall(r'name="([^"]+)"', text)
        return ("[multipart fields: %s]" % ", ".join(dict.fromkeys(names))).encode()
    return ("[%d bytes, %s]" % (len(body), ct or "unknown type")).encode()


def mask_query(query: str, masker: Masker) -> str:
    return urlencode([(k, masker.fpe(v) if v else v) for k, v in parse_qsl(query, keep_blank_values=True)])


def config_sha(cfg: dict) -> str:
    return hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()[:16]
