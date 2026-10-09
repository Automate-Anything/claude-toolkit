"""Small shared helpers for the launch video's paid calls: keys from .env, curl, receipts, the cost ledger.

Nothing here prints a key. Higgsfield refuses Python's own HTTP client, so curl does the transport.
"""
import io, json, os, re, subprocess, time, datetime, hashlib

TOOLS = os.path.abspath(os.path.dirname(__file__))                      # this folder (tracked)
ROOT = os.path.abspath(os.path.join(TOOLS, "..", "..", ".."))           # the repository, where .env lives
WORK = os.path.abspath(os.path.join(TOOLS, "..", "work"))               # stills, takes, voices, edit lists, renders (not in git)
BIN = os.path.join(WORK, "tools", "bin")                                # ffmpeg and ffprobe (not in git)
RECEIPTS = os.path.join(WORK, "receipts")
LEDGER = os.path.join(RECEIPTS, "ledger.jsonl")
HF = "https://api.higgsfield.ai"


def env():
    """Keys from the nearest .env above this folder (the project root when the skill is installed in a project)."""
    out = {}
    here = TOOLS
    for _ in range(6):
        p = os.path.join(here, ".env")
        if os.path.exists(p):
            for ln in io.open(p, encoding="utf-8", errors="replace").read().splitlines():
                m = re.match(r"^([A-Z0-9_]+)=(.*)$", ln)
                if m:
                    v = m.group(2).strip()
                    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                        v = v[1:-1]
                    out[m.group(1)] = v
            return out
        here = os.path.dirname(here)
    return out


_E = env()


def _scrub(s):
    for k in ("HF_CREDENTIALS", "FAL_KEY", "HF_API_KEY_SECRET", "ELEVENLABS_API_KEY", "OPENAI_API_KEY"):
        v = _E.get(k)
        if v:
            s = s.replace(v, "<key>")
    return s


def curl(method, url, headers=(), body=None, timeout=120, out_file=None):
    cmd = ["curl", "-sS", "-L", "-m", str(timeout), "-X", method, url, "-w", "\n%{http_code}"]
    for h in headers:
        cmd += ["-H", h]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
    if out_file:
        cmd += ["-o", out_file]
    r = subprocess.run(cmd, input=json.dumps(body) if body is not None else None, capture_output=True, text=True, encoding="utf-8", errors="replace")
    text = r.stdout
    code = text.rsplit("\n", 1)[-1].strip() if text else "?"
    payload = text.rsplit("\n", 1)[0] if "\n" in text else ""
    return code, _scrub(payload), _scrub(r.stderr)


def hf_headers():
    return ["Authorization: Key " + _E["HF_CREDENTIALS"], "Accept: application/json"]


def fal_headers():
    return ["Authorization: Key " + _E["FAL_KEY"], "Accept: application/json"]


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(entry):
    """One line per paid call: written when the venue accepts the job, updated rows are appended, never edited."""
    os.makedirs(RECEIPTS, exist_ok=True)
    entry = dict(entry)
    entry.setdefault("at", now())
    with io.open(LEDGER, "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(entry, ensure_ascii=True) + "\n")


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(json.dumps(obj, indent=1, ensure_ascii=True))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def fal_balance():
    code, body, _ = curl("GET", "https://rest.alpha.fal.ai/billing/user_balance", fal_headers(), timeout=30)
    try:
        return float(body)
    except Exception:
        return None
