"""
Read-only IPQualityScore lookup for one or more IPs. Validates the IPQS_API_KEY
and shows the fraud signals we'd screen proxies on. No writes.

Usage: py scripts/ipqs_check.py <ip> [<ip> ...]
Reads IPQS_API_KEY from .env.local.
"""
import os, sys, json, urllib.request, urllib.parse, urllib.error

def load_key():
    k = os.environ.get("IPQS_API_KEY")
    if k:
        return k
    p = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    try:
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line.startswith("IPQS_API_KEY="):
                v = line.split("=", 1)[1].strip()
                return v[1:-1] if v[:1] in "\"'" else v
    except FileNotFoundError:
        pass
    return None

KEY = load_key()
if not KEY:
    print("IPQS_API_KEY not found in env or .env.local"); sys.exit(2)

ips = sys.argv[1:]
if not ips:
    print("usage: py scripts/ipqs_check.py <ip> [<ip> ...] [--strictness N]"); sys.exit(2)

strictness = 1
if "--strictness" in ips:
    i = ips.index("--strictness")
    strictness = int(ips[i + 1]); del ips[i:i + 2]

# strictness=1 = accurate with fewest false positives (per IPQS best-practices).
FIELDS = ["fraud_score", "proxy", "vpn", "tor", "active_vpn", "recent_abuse",
          "bot_status", "ISP", "connection_type", "country_code", "message", "success"]

for ip in ips:
    params = urllib.parse.urlencode({"strictness": strictness, "allow_public_access_points": "true"})
    url = f"https://ipqualityscore.com/api/json/ip/{KEY}/{urllib.parse.quote(ip)}?{params}"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        print(f"{ip}: HTTP {e.code} {e.read().decode('utf-8','replace')[:200]}"); continue
    except Exception as e:
        print(f"{ip}: ERROR {e}"); continue
    summary = {k: data.get(k) for k in FIELDS if k in data}
    print(f"\n=== {ip} ===")
    print(json.dumps(summary, indent=2))
