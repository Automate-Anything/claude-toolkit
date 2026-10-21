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
AUTH_WORDS = {"login", "signin", "sign-in", "session", "sessions", "auth", "authenticate", "token", "mfa", "2fa",
              "otp", "verify", "saml", "sso", "callback", "oauth", "logon"}
AUTH_PATH = re.compile(
    r"/(login|signin|sign-in|session|sessions|auth|authenticate|oauth/token|token|mfa|2fa|otp|verify|saml|sso|callback)/?$",
    re.I,
)


def _decode_query(q: str) -> str:
    """Normalise a query string for exact comparison (sorted decoded key=value)."""
    return "&".join("%s=%s" % (k, v) for k, v in sorted(parse_qsl(q, keep_blank_values=True)))


def _is_tight_auth_path(path: str) -> bool:
    """A login path is at most 2 segments, no digits, last segment an auth word.
    This keeps the generic login window off /clients/5/verify and /bank/5/token."""
    segs = [s for s in path.lower().split("/") if s]
    if not segs or len(segs) > 2 or any(any(c.isdigit() for c in s) for s in segs):
        return False
    return segs[-1] in AUTH_WORDS or ("oauth" in segs and "token" in segs)
CODE_EXT = re.compile(r"\.(js|mjs|css|woff2?|ttf|otf|eot|map)$", re.I)
IMAGE_EXT = re.compile(r"\.(png|jpe?g|gif|webp|bmp|tiff?|heic|svg|ico|avif)$", re.I)
# The only things passed through untouched on a static path: code, fonts, images.
# Not PDFs, spreadsheets, archives or anything else that could carry records.
STATIC_EXT = re.compile(r"\.(js|mjs|css|woff2?|ttf|otf|eot|map|png|jpe?g|gif|webp|bmp|ico|avif|svg)$", re.I)


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


def _verb_forms(verb: str) -> set:
    """base, plural, and -ing/-ed with the usual spelling changes (delete->deleting,
    cancel->cancelling), so a danger verb is caught in any ordinary tense."""
    forms = {verb, verb + "s", verb + "es", verb + "d", verb + "ed", verb + "ing"}
    if verb.endswith("e"):
        forms |= {verb[:-1] + "ing", verb[:-1] + "ed"}
    if len(verb) >= 3 and verb[-1] not in "aeiou" and verb[-2] in "aeiou" and verb[-3] not in "aeiou":
        forms |= {verb + verb[-1] + "ing", verb + verb[-1] + "ed"}  # cancel -> cancelling
    if verb.endswith("y"):
        forms |= {verb[:-1] + "ies", verb[:-1] + "ied"}
    return forms


# Noun tails that make a joined-up word a danger word: deleteClient, voidPayment.
JOIN_NOUNS = ("client", "clients", "customer", "contact", "payment", "payments", "draft", "drafts", "account",
              "accounts", "record", "records", "invoice", "invoices", "settlement", "settlements", "document",
              "documents", "file", "files", "email", "emails", "sms", "message", "statement", "user", "note",
              "notes", "case", "lead", "all", "batch", "now", "it", "this", "selected", "esign", "signature")


def danger_words_in(path: str, query: str, extra: list[str] | None = None) -> list[str]:
    verbs = DANGER_VERBS + [w.lower() for w in (extra or [])]
    forms = set()
    for v in verbs:
        forms |= _verb_forms(v)
    for v in ("delete", "remove", "cancel", "send", "pay", "charge", "void", "approve", "refund", "submit", "reset"):
        forms.add("re" + v)
    long_verbs = [v for v in verbs if len(v) >= 4]
    hits: list[str] = []
    parts = [_decode(path)] + [_decode(k) + " " + _decode(v) for k, v in parse_qsl(query, keep_blank_values=True)]
    for part in parts:
        for t in _tokens(part):
            if t in hits:
                continue
            if t in forms:
                hits.append(t)
                continue
            # Joined-up word with no camelCase or separator: deleteclient, voidpayment.
            for v in long_verbs:
                if t.startswith(v) and t[len(v):] in JOIN_NOUNS:
                    hits.append(t)
                    break
                if t.endswith(v) and t[:-len(v)] in JOIN_NOUNS:
                    hits.append(t)
                    break
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
        allowed = set(keys) | {"query", "max_body"}
        extra = set(rule) - allowed
        if extra:
            raise ConfigError("%s rule has unexpected key(s): %s" % (what, ", ".join(sorted(extra))))
        for k in keys:
            v = rule.get(k)
            if not isinstance(v, str) or not v:
                raise ConfigError("%s rule needs %s" % (what, k))
            if k in ("host", "path") and re.search(r"[*?\[\]()|^$\\+{}]", v):
                raise ConfigError("%s rule %s must be exact, no wildcards or patterns: %r" % (what, k, v))
        q = rule.get("query", "")
        if not isinstance(q, str):
            raise ConfigError("%s rule query must be a string" % what)
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
    for sh in cfg.get("static_hosts", []):
        if not isinstance(sh, str) or not sh:
            raise ConfigError("static_hosts must be non-empty strings")
        if any(host_matches(sh, t) or host_matches(t, sh) for t in targets):
            raise ConfigError("a static_host may not overlap a target host: %r" % sh)
    mask = cfg.get("mask")
    if mask is not None:
        if not isinstance(mask, dict) or set(mask) - {"extra_keys"}:
            raise ConfigError("mask may only contain extra_keys")
        if not all(isinstance(k, str) for k in mask.get("extra_keys", [])):
            raise ConfigError("mask.extra_keys must be strings")
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
                if host_matches(host, r["host"]) and path == r["path"] and _decode_query(req.query) == _decode_query(r.get("query", "")):
                    return Decision(True, "allow_get exception", "read")
            return Decision(False, "risky word(s) in a GET: %s" % ", ".join(words[:5]), "danger-get")
        return Decision(True, "read", "read")

    if method == "OPTIONS":
        # A real preflight is answered locally by the addon (kind "preflight"); it
        # is never forwarded, so a handler that acts on OPTIONS can't be reached.
        if "origin" in h and "access-control-request-method" in h and req.body_len == 0 and not req.query:
            return Decision(True, "CORS preflight", "preflight")
        return Decision(False, "OPTIONS that is not a plain CORS preflight", "method")

    def query_ok(rule):
        return _decode_query(req.query) == _decode_query(rule.get("query", ""))

    for r in cfg.get("pinned_writes", []):
        if r["method"] == method and host_matches(host, r["host"]) and path == r["path"] and query_ok(r):
            if _dt.date.fromisoformat(r["expires"]) < today:
                continue
            if req.body_len > r["max_body"]:
                return Decision(False, "pinned rule body cap exceeded", "write")
            return Decision(True, "pinned: %s" % r["reason"][:60], "pinned")

    if login and method == "POST" and login.open_for(host, now):
        rules = cfg.get("login_rules", [])
        host_rules = [r for r in rules if host_matches(host, r["host"])]
        if host_rules:
            # Once this host has pinned login paths, ONLY those are allowed.
            if any(r["method"] == method and path == r["path"] and query_ok(r) for r in host_rules):
                return Decision(True, "login window (pinned)", "login")
            return Decision(False, "POST not in this host's login rules", "write")
        if not req.query and _is_tight_auth_path(path):
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
NAME_KEYS = {"alias", "nickname", "spouse", "coapplicant", "cosigner", "coborrower", "beneficiary", "reference",
             "emergencycontact", "employer", "contact", "client", "customer", "debtor", "applicant"}
ACTION_WORDS = re.compile(r"^(view|edit|open|details?|select|print|download|export|add|new|remove|delete|void|save|cancel|"
                          r"close|more|actions?|yes|no|n/a|none|active|inactive|pending|paid|closed|true|false|ok|-|"
                          r"\d{1,3}%?)$", re.I)
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


OPTION_TEXT_KEYS = {"label", "text", "option", "display", "displaytext", "caption"}
_SAFE_ID = re.compile(r"^(?:\d+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                      r"|[A-Za-z]{1,6}[-_]?\d{1,12}|[0-9a-fA-F]{16,40})$")
# Cell content kept unmasked: money, counts, percentages, dates. Short ALPHA cells
# are kept ONLY when every word is interface/status vocabulary, because by shape
# alone a short word like "Zebulon" is indistinguishable from "Enrolled".
_KEEP_NUM = re.compile(r"^[\s$€£()]*-?[\d,]+(\.\d+)?\)?%?\s*$|"  # amounts, counts, percentages
                       r"^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}([ T].*)?$")  # dates
STATUS_WORDS = set("""active inactive pending paid unpaid open closed cancelled canceled completed complete approved
declined rejected new settled settling current overdue draft drafts enrolled enrollment withdrawn hold onhold review
in progress done failed success error sent received scheduled processing processed yes no true false na none all
high low medium urgent normal flagged verified unverified default primary secondary""".split()) | {"n/a"}


def _is_safe_id(v) -> bool:
    if isinstance(v, int):
        return True
    return isinstance(v, str) and bool(_SAFE_ID.match(v))


def _is_keepable_cell(c: str) -> bool:
    s = c.strip()
    if not s or len(s) > 24:
        return False
    if "@" in s or PAT_SSN.search(s) or PAT_PHONE.search(s):
        return False
    if _KEEP_NUM.match(s):
        return True
    words = re.split(r"[\s/&\-]+", s.lower())
    return all(w in STATUS_WORDS or w in UI_WORDS for w in words if w)


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
PAT_SSN_PARTIAL = re.compile(r"(?i)(?:x{3}|\*{3})[- ]?(?:x{2}|\*{2})[- ]?\d{4}|(?<!\d)\d{3}[- ]\d{2}[- ]x{4}(?!\d)")
PAT_EIN = re.compile(r"(?<!\d)\d{2}-\d{7}(?!\d)")
PAT_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+(?:@|%40)[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# Phone: optional country code, optional separators (including none): (646)231-7788, 6462317788, +16462317788.
PAT_PHONE = re.compile(r"(?<![\d.])(?:\+?1[ .\-]?)?\(?\d{3}\)?[ .\-]?\d{3}[ .\-]?\d{4}(?![\d.])")
PAT_CARD = re.compile(r"(?<!\d)(?:\d[ \-]?){12,18}\d(?!\d)")
PAT_ZIP4 = re.compile(r"(?<!\d)\d{5}-\d{4}(?!\d)")
PAT_LONGNUM = re.compile(r"(?<![\d.])\d{10,17}(?![\d.])")  # account-number-length digit runs
# "DOB: 02/03/1980", "SSN - 123456789", "Acct# 000123456789".
PAT_LABELED = re.compile(r"(?i)\b(dob|d\.o\.b|date of birth|ssn|social|tin|ein|acct|account|routing|aba|member|card)\b"
                         r"\s*[:#\-]?\s*([()\d][\d()\-. /]{3,25}\d)")
# "Quartermaine, Zebulon" and ALL-CAPS "QUARTERMAINE, ZEBULON" or "ZEBULON QUARTERMAINE".
PAT_NAME_COMMA = re.compile(r"\b([A-Z][\w'\-]+|[A-Z]{2,})\s*,\s*([A-Z][\w'\-]+|[A-Z]{2,})(?:\s+[A-Z]\.?)?\b")
PAT_NAME_CAPS = re.compile(r"\b[A-Z][A-Z'\-]{1,}(?:\s+[A-Z][A-Z'\-]{1,}){1,2}\b")
PAT_STREET = re.compile(r"\b\d{1,6}\s+(?:[A-Za-z0-9.'\-]+\s){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|"
                        r"Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace|Trl|"
                        r"Trail|Sq|Square)\b\.?", re.I)
PAT_JWT = re.compile(r"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}")
PAT_B64 = re.compile(r"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{200,}={0,2}")


# Words that appear in interface phrases ("Client Details", "Edit Client"). A run
# of 2 or 3 Capitalized words is treated as a possible person name unless every
# word is in this list. Used for titles, headings and ARIA/alt/title text.
UI_WORDS = set("""
a about account accounts action actions active add address advanced agent agents agreement agreements all alert alerts
amount amounts and app apply approval approvals archive assign assigned attachments audit back balance balances bank
banking batch billing calendar call calls campaign campaigns cancel case cases change charges check client clients close
collapse comment comments company compliance confirm contact contacts contract create credit creditor creditors current
customer customers dashboard data date dates day debt debts default delete deposit deposits detail details dialog document
documents download draft drafts edit email emails enroll enrolled enrollment enrollments event events expand export fee
fees file files filter filters first forecast form forms full general group groups help history home import inbox info
information insights invoice invoices last lead leads list log login logout main manage menu message messages more my
name names negotiation negotiations new next note notes notification notifications of offer offers open options other
overview owner page payment payments pending people personal phone portal preferences previous print profile program
programs queue quick read record records refresh reminder reminders report reports reset review role roles save schedule
scheduled search section select send service settings settle settlement settlements show sign signature sms sort status
statement statements submit summary support system task tasks team template templates text the to today toggle tools
total totals transaction transactions trigger triggers update upload user users view welcome workflow workflows your
""".split())
# A person name: 2-3 capitalized words, allowing McDonald / DeShawn / O'Brien and
# accented letters (Jose Garcia, Zoe Muller). Unicode-aware.
_CAPWORD = r"[A-ZÀ-ɏ][\w'À-ɏ.\-]{1,30}"
NAME_RUN = re.compile(r"(" + _CAPWORD + r")((?:\s+" + _CAPWORD + r"){1,2})", re.UNICODE)


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
        # Identifiers seen in identifying positions this run (memory only, never
        # written): masked again wherever they reappear (headings, messages...).
        self._known: dict = {}
        self._known_re = None

    # ----- learned identifiers -----
    def learn(self, value) -> None:
        if not isinstance(value, str):
            return
        v = value.strip()
        if len(v) < 3 or len(v) > 80 or re.search(r"[\d@/\\<>{}]", v) or len(v.split()) > 4:
            return
        if not re.search(r"[A-Za-z]{2}", v):
            return
        added = False
        for item in [v] + [w for w in re.findall(r"[A-Za-z][A-Za-z'\-]{2,}", v) if w[0].isupper()]:
            if item.lower() in UI_WORDS or item in self._known:
                continue
            self._known[item] = self.fpe(item)
            added = True
        if added:
            self._known_re = None

    def apply_known(self, text: str) -> str:
        if not text or not self._known:
            return text
        if self._known_re is None:
            alts = sorted(self._known, key=len, reverse=True)
            self._known_re = re.compile(r"(?<![A-Za-z])(" + "|".join(re.escape(a) for a in alts) + r")(?![A-Za-z])")
        return self._known_re.sub(lambda m: self._known[m.group(1)], text)

    def mask_names(self, text: str) -> str:
        """Possible person names: a run of capitalized words (also ALL-CAPS and
        "Last, First") that has at least two words which are NOT interface words,
        so "Jose Garcia" and "QUARTERMAINE, ZEBULON" mask but menu labels like
        "Payment Plans" or "Client Details" are left alone. Plus learned names
        (which mask even a lone reappearance)."""
        def run(m):
            whole = m.group(0)
            words = [w for w in re.split(r"[\s,]+", whole) if w]
            non_ui = [w for w in words if w.lower() not in UI_WORDS]
            return self.fpe(whole) if len(non_ui) >= 2 else whole
        text = self.apply_known(text)
        text = PAT_NAME_COMMA.sub(run, text)
        text = NAME_RUN.sub(run, text)
        text = PAT_NAME_CAPS.sub(run, text)
        return text

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

        text = self.apply_known(text)
        text = PAT_JWT.sub("[masked-token]", text)
        text = PAT_B64.sub("[masked-blob]", text)
        text = PAT_EMAIL.sub(lambda m: self.email(m.group(0)), text)
        text = PAT_CARD.sub(card, text)
        text = PAT_LABELED.sub(lambda m: m.group(1) + m.group(0)[len(m.group(1)):-len(m.group(2))] + self.fpe(m.group(2)), text)
        text = PAT_SSN.sub(self.ssn, text)
        text = PAT_SSN_PARTIAL.sub(lambda m: self.fpe(m.group(0)), text)
        text = PAT_EIN.sub(lambda m: self.fpe(m.group(0)), text)
        text = PAT_PHONE.sub(lambda m: self.phone(m.group(0)), text)
        text = PAT_ZIP4.sub(lambda m: self.fpe(m.group(0)), text)
        text = PAT_STREET.sub(lambda m: self.fpe(m.group(0)), text)
        text = re.sub(r"(?<!\d)\d{9}(?!\d)", lambda m: self.fpe(m.group(0)) if aba_ok(m.group(0)) else m.group(0), text)
        text = PAT_LONGNUM.sub(lambda m: self.fpe(m.group(0)), text)
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
        if self._is_name_key(key_norm) or NAME_RUN.fullmatch(v.strip()):
            self.learn(v)
        return self.fpe(v)

    @staticmethod
    def _is_name_key(nk: str) -> bool:
        return (nk.endswith("name") and nk not in UI_NAME_KEYS) or nk in NAME_KEYS

    def _collect(self, obj, parent_key: str = "", person_ctx: bool = False) -> None:
        """First pass over JSON: learn names before masking, so a name that also
        appears in a free-text field earlier in the document is caught too."""
        if isinstance(obj, dict):
            nkeys = {k: norm_key(k) for k in obj}
            ctx = (person_ctx or bool(PERSONISH_PARENTS.search(str(parent_key)))
                   or any(is_strong_key(nk) for nk in nkeys.values()))
            for k, v in obj.items():
                nk = nkeys[k]
                if isinstance(v, str) and (self._is_name_key(nk) or (ctx and nk == "name")):
                    self.learn(v)
                elif isinstance(v, (dict, list)) or (isinstance(v, str) and v.strip()[:1] in ("{", "[")):
                    self._collect(v, str(k), ctx and isinstance(v, (dict, list)))
        elif isinstance(obj, list):
            for v in obj:
                self._collect(v, parent_key, person_ctx)
        elif isinstance(obj, str):
            try:
                self._collect(json.loads(obj), parent_key, person_ctx)
            except ValueError:
                pass

    def _mask_all(self, v, nk: str):
        # Everything under an identifying key is masked, EXCEPT nested record ids
        # (so a masked "bankAccounts" list still has usable ids to navigate by).
        if isinstance(v, dict):
            out = {}
            for k, x in v.items():
                ck = norm_key(k)
                if ID_KEY.match(ck) and _is_safe_id(x):
                    out[k] = x
                else:
                    out[k] = self._mask_all(x, nk)
            return out
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
                elif nk in OPTION_TEXT_KEYS and isinstance(v, str) and NAME_RUN.fullmatch(v.strip()):
                    # autocomplete / Select2 option text that is a person name
                    self.learn(v)
                    out[k] = self.fpe(v)
                elif ctx and nk in CONTEXT_KEYS and not isinstance(v, (dict, list)):
                    out[k] = self.mask_scalar(nk, v)
                elif ID_KEY.match(nk) and isinstance(v, (str, int)):
                    # An id keeps its value only if it is a plain record id (int, UUID,
                    # or prefix+digits). An id field holding an email/SSN is still masked.
                    out[k] = v if _is_safe_id(v) else self.mask_patterns(str(v)) if isinstance(v, str) else v
                else:
                    out[k] = self.mask_json(v, str(k), ctx and isinstance(v, (dict, list)))
            return out
        if isinstance(obj, list):
            if (obj and TABLE_PARENTS.match(norm_key(parent_key)) and all(isinstance(r, list) for r in obj)
                    and all(not isinstance(c, (dict, list)) for r in obj for c in r)):
                # DataTables-style rows: every string cell is record data (amounts,
                # dates and short statuses kept so the parity work can read them).
                return [[self.fpe(c) if (isinstance(c, str) and not _is_keepable_cell(c)) else c for c in r] for r in obj]
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
        obj = json.loads(text)
        self._collect(obj)
        return prefix + json.dumps(self.mask_json(obj), ensure_ascii=False, separators=(",", ":"))

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
    def _learn_from_html(self, html: str) -> None:
        """First pass: names in table cells, definition values and text inputs."""
        for m in re.finditer(r"<(td|dd)\b[^>]*>\s*(?:<[^>]+>\s*)*([^<]{3,80}?)\s*<", html, re.I):
            txt = m.group(2).strip()
            if NAME_RUN.fullmatch(txt) and not all(w.lower() in UI_WORDS for w in txt.split()):
                self.learn(txt)
        for m in re.finditer(r"<input\b[^>]*>", html, re.I):
            tag = m.group(0)
            t = re.search(r"\btype\s*=\s*['\"]?([A-Za-z\-]+)", tag, re.I)
            if (t.group(1).lower() if t else "") not in ("", "text"):
                continue
            v = re.search(r"\bvalue\s*=\s*(?:(['\"])(.*?)\1|([^\s\"'>]+))", tag, re.I | re.S)
            if v and NAME_RUN.fullmatch((v.group(2) or v.group(3) or "").strip()):
                self.learn((v.group(2) or v.group(3)).strip())
        for m in re.finditer(r"(['\"]?)([A-Za-z_][A-Za-z0-9_]{1,60})\1\s*:\s*(['\"])([^'\"\\]{3,80})\3", html):
            if self._is_name_key(norm_key(m.group(2))):
                self.learn(m.group(4))

    def mask_html(self, html: str) -> str:
        # Drop HTML comments outright: they are not rendered but reach outerHTML, and
        # legacy pages sometimes park record data (even SSNs) in them.
        html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
        self._learn_from_html(html)
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
        # Mask "key": "value" pairs where the key identifies a person (covers inline
        # state like window.__STATE__ = {"firstName":"...","hardship":"..."} without
        # trying to brace-match whole objects, which backfires on real script code).
        def kv(m):
            nk = norm_key(m.group(2))
            if not is_strong_key(nk):
                return m.group(0)
            masked = self.mask_scalar(nk, m.group(5))
            if not isinstance(masked, str):
                masked = self.fpe(m.group(5))
            return "%s%s%s%s%s%s%s" % (m.group(1), m.group(2), m.group(1), m.group(3), m.group(4), masked, m.group(4))
        js = re.sub(r"(['\"]?)([A-Za-z_][A-Za-z0-9_]{1,60})\1(\s*:\s*)(['\"])((?:\\.|(?!\4).){0,4000})\4", kv, js)
        js = PAT_EMAIL.sub(lambda m: self.email(m.group(0)), js)
        js = PAT_SSN_DASHED.sub(self.ssn, js)
        js = PAT_CARD.sub(lambda m: self.fpe(m.group(0)) if luhn_ok(re.sub(r"\D", "", m.group(0))) else m.group(0), js)
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
                # Hidden (and other) inputs can carry JSON or PII: unescape, then mask.
                return put(self._mask_attr_payload(val))
            if al == "href" and re.match(r"\s*(mailto|tel|sms|callto):", val, re.I):
                return put("#parity-masked")
            if al in ("href", "src", "action", "formaction", "srcset", "poster"):
                return put(self.mask_url(val))
            if al in ("title", "alt", "aria-label", "aria-description", "aria-valuetext", "label"):
                return put(self.mask_patterns(self.mask_names(val)))
            if al.startswith("data-") or al == "value":
                return put(self._mask_attr_payload(val))
            if al in ("placeholder", "content") or al.startswith("aria-"):
                return put(self.mask_patterns(val))
            return m.group(0)

        return re.sub(r"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:(['\"])(.*?)\2|([^\s\"'>=`]+))", attr, tag, flags=re.S)

    DATA_TAGS = ("td", "dd", "textarea")
    NAME_TAGS = ("title", "h1", "h2", "h3", "h4", "h5", "h6")
    CHROME_TAGS = ("button", "th", "label", "option", "select", "legend", "caption")

    def _mask_attr_payload(self, val: str) -> str:
        """An attribute value that may hold JSON or PII (hidden input, data-*)."""
        import html as _html
        raw = _html.unescape(val)
        s = raw.strip()
        if s[:1] in ("{", "[") and s[-1:] in ("}", "]"):
            try:
                obj = json.loads(s)
                self._collect(obj)
                return _html.escape(json.dumps(self.mask_json(obj), separators=(",", ":")), quote=False)
            except ValueError:
                pass
        return self.mask_patterns(self.mask_names(val))

    def _mask_cell_text(self, text: str) -> str:
        """Record text in a cell: mask words, but keep amounts, dates, counts and
        short status words so the parity work can still read a row."""
        if text.strip().endswith(":"):
            return self.mask_patterns(text)
        text = self.apply_known(text)

        def word(m):
            w = m.group(0)
            if ACTION_WORDS.match(w) or _is_keepable_cell(w):
                return w
            return self.fpe(w)
        return re.sub(r"\S+", word, text)

    # Tags that end a data/chrome region, so an unclosed <td> or <option> can't
    # bleed masking across the rest of the page.
    _RESET = {"tr": ("td",), "table": ("td",), "dl": ("dd",), "select": ("option",), "ul": ("option",),
              "ol": ("option",)}

    def _mask_markup(self, html: str) -> str:
        depth = {t: 0 for t in self.DATA_TAGS + self.NAME_TAGS + self.CHROME_TAGS}
        out = []
        for p in re.split(r"(<[^>]*>)", html):
            if p.startswith("<"):
                m = re.match(r"<\s*(/?)\s*([A-Za-z][A-Za-z0-9]*)", p)
                if m:
                    tag, closing = m.group(2).lower(), bool(m.group(1))
                    if tag in depth and not p.rstrip().endswith("/>"):
                        depth[tag] = max(0, depth[tag] + (-1 if closing else 1))
                    # Opening or closing a row/table/list resets cell/option depth.
                    for container, inners in self._RESET.items():
                        if tag == container:
                            for it in inners:
                                depth[it] = 0
                out.append(self._mask_tag(p))
            elif not p.strip():
                out.append(p)
            elif any(depth[t] for t in self.CHROME_TAGS):
                out.append(self.mask_patterns(p))
            elif any(depth[t] for t in self.DATA_TAGS):
                out.append(self._mask_cell_text(p))
            else:
                # Headings and ordinary body text (nav links, list items, spans):
                # mask patterns and possible person names.
                out.append(self.mask_patterns(self.mask_names(p)))
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
