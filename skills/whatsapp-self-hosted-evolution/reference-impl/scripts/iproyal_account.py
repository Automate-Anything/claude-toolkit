"""Read-only: IPRoyal reseller account balance + saved cards. No spend.
Usage: py scripts/iproyal_account.py"""
import os, sys, json, urllib.request, urllib.error

BASE = "https://apid.iproyal.com/v1/reseller"

def load_token():
    tok = os.environ.get("IPROYAL_API_TOKEN")
    if tok:
        return tok
    p = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    try:
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line.startswith("IPROYAL_API_TOKEN="):
                v = line.split("=", 1)[1].strip()
                return v[1:-1] if v[:1] in "\"'" else v
    except FileNotFoundError:
        pass
    return None

def get(path, token):
    req = urllib.request.Request(f"{BASE}{path}", headers={"X-Access-Token": token, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:400]
    except Exception as e:
        return None, str(e)

def redact(o):
    if isinstance(o, dict):
        return {k: ("<redacted>" if any(s in k.lower() for s in ("pass","secret","token","cvv","number")) else redact(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [redact(x) for x in o]
    return o

token = load_token()
if not token:
    print("IPROYAL_API_TOKEN not found"); sys.exit(2)

for path in ("/balance", "/cards"):
    st, body = get(path, token)
    print(f"=== GET {path} -> HTTP {st} ===")
    print(json.dumps(redact(body), indent=2)[:1500] if isinstance(body, (dict, list)) else str(body)[:800])
    print()
