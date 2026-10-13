"""
Read-only Bright Data account discovery (for the proxy auto-buy evaluation).
Loads BRIGHTDATA_API_TOKEN from .env.local, lists zones, and checks US ISP
availability. No purchase, no writes.
"""
import os, sys, json, urllib.request, urllib.error

BASE = "https://api.brightdata.com"

def load_token():
    tok = os.environ.get("BRIGHTDATA_API_TOKEN")
    if tok:
        return tok
    p = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    try:
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line.startswith("BRIGHTDATA_API_TOKEN="):
                v = line.split("=", 1)[1].strip()
                return v[1:-1] if v[:1] in "\"'" else v
    except FileNotFoundError:
        pass
    return None

TOKEN = load_token()

def get(path):
    req = urllib.request.Request(f"{BASE}{path}", headers={
        "Authorization": f"Bearer {TOKEN}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(body)
            except Exception:
                return r.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:400]
    except Exception as e:
        return None, str(e)

SECRET = ("password", "passwd", "token", "secret", "key")
def redact(o):
    if isinstance(o, dict):
        return {k: ("<redacted>" if any(s in k.lower() for s in SECRET) else redact(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [redact(x) for x in o[:20]]
    return o

if not TOKEN:
    print("BRIGHTDATA_API_TOKEN not found"); sys.exit(2)

print("=== GET /zone/get_active_zones ===")
st, zones = get("/zone/get_active_zones")
print(f"HTTP {st}")
print(json.dumps(redact(zones), indent=2)[:2500])

# US ISP dedicated availability (static residential = ISP).
print("\n=== GET /count_available_ips (US ISP dedicated) ===")
import urllib.parse
plan = urllib.parse.quote(json.dumps({"type": "static", "pool_ip_type": "static_res", "ips_type": "dedicated", "country": "us"}))
st, cnt = get(f"/count_available_ips?plan={plan}")
print(f"HTTP {st}")
print(json.dumps(redact(cnt), indent=2)[:800] if isinstance(cnt, (dict, list)) else str(cnt)[:800])
