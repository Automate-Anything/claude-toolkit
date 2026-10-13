"""
ONE-OFF TEST: buy a single fresh IPRoyal standard ISP IP (the same product/pool
the auto-buy uses) and IPQS-check it IMMEDIATELY, to answer: are fresh standard
buys clean at purchase, or does IPRoyal recycle dirty IPs?

SPENDS MONEY. Requires the literal flag --confirm-buy or it does nothing.
Defaults: product 9 (ISP Dedicated), plan 23 (1-DAY, ~$2), location 16 (US),
quantity 1, paid from account BALANCE. Override plan with --plan N.

Usage:
  py scripts/iproyal_testbuy.py               # dry (prints what it WOULD buy)
  py scripts/iproyal_testbuy.py --confirm-buy # actually buys + checks
"""
import os, sys, json, time, urllib.request, urllib.parse, urllib.error

IPROYAL_BASE = "https://apid.iproyal.com/v1/reseller"
PRODUCT_ID, LOCATION_ID = 9, 16
PLAN_ID = 23  # 1-day (~$2); 22 = 30-day ($4)

def load(name):
    v = os.environ.get(name)
    if v:
        return v
    p = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    try:
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line.startswith(name + "="):
                val = line.split("=", 1)[1].strip()
                return val[1:-1] if val[:1] in "\"'" else val
    except FileNotFoundError:
        pass
    return None

IPROYAL_TOKEN = load("IPROYAL_API_TOKEN")
IPQS_KEY = load("IPQS_API_KEY")

def iproyal(method, path, body=None):
    req = urllib.request.Request(f"{IPROYAL_BASE}{path}", method=method, headers={
        "X-Access-Token": IPROYAL_TOKEN, "Accept": "application/json",
        **({"Content-Type": "application/json"} if body else {})},
        data=json.dumps(body).encode() if body else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:500]
    except Exception as e:
        return None, str(e)

def ipqs(ip):
    params = urllib.parse.urlencode({"strictness": 0, "allow_public_access_points": "true"})
    url = f"https://ipqualityscore.com/api/json/ip/{IPQS_KEY}/{urllib.parse.quote(ip)}?{params}"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

args = sys.argv[1:]
if "--plan" in args:
    i = args.index("--plan"); PLAN_ID = int(args[i + 1])
plan_price = {22: "$4 / 30-day", 23: "$2 / 1-day", 24: "$8 / 60-day", 25: "$12 / 90-day"}.get(PLAN_ID, f"plan {PLAN_ID}")

if not IPROYAL_TOKEN or not IPQS_KEY:
    print("Missing IPROYAL_API_TOKEN or IPQS_API_KEY"); sys.exit(2)

# Resume mode: skip the buy, just poll + IPQS-check an already-placed order.
resume_order_id = None
if "--order" in args:
    i = args.index("--order"); resume_order_id = int(args[i + 1])

if resume_order_id is None and "--confirm-buy" not in args:
    print(f"DRY RUN. Would buy: product {PRODUCT_ID} (ISP Dedicated), plan {PLAN_ID} ({plan_price}), "
          f"location {LOCATION_ID} (US), qty 1, from balance.")
    print("Re-run with --confirm-buy to actually purchase + IPQS-check.")
    sys.exit(0)

if resume_order_id is not None:
    order_id = resume_order_id
    print(f"Resume mode: polling existing order {order_id} (no new charge) ...")
else:
    print(f"Placing order: product {PRODUCT_ID}, plan {PLAN_ID} ({plan_price}), location {LOCATION_ID} (US), qty 1 ...")
    st, body = iproyal("POST", "/orders", {
        "product_id": PRODUCT_ID, "product_plan_id": PLAN_ID,
        "product_location_id": LOCATION_ID, "quantity": 1})
    print(f"POST /orders -> HTTP {st}")
    if not isinstance(body, dict):
        print(body); sys.exit(1)
    order = body.get("data") or body
    order_id = order.get("id") if isinstance(order, dict) else None
    print(f"order id: {order_id}, status: {order.get('status') if isinstance(order, dict) else '?'}")
    if not order_id:
        print(json.dumps(order, indent=2)[:800]); sys.exit(1)

print("Polling for the provisioned IP ...")
ip = None
for delay in (3, 5, 5, 8, 8, 10):
    time.sleep(delay)
    st, det = iproyal("GET", f"/orders/{order_id}?product_id={PRODUCT_ID}")
    o = det.get("data") if isinstance(det, dict) else None
    if not isinstance(o, dict):
        continue
    pdata = o.get("proxy_data") or {}
    proxies = pdata.get("proxies") or []
    if o.get("status") == "confirmed" and proxies and proxies[0].get("ip"):
        ip = proxies[0]["ip"]
        break
    print(f"  ...status={o.get('status')} proxies={len(proxies)}")

if not ip:
    print(f"No IP provisioned in time. Check order {order_id} manually."); sys.exit(1)

print(f"\nFRESH IP: {ip}")
print("=== IPQS (strictness 0, same as web default) ===")
r = ipqs(ip)
for k in ("fraud_score", "proxy", "vpn", "tor", "recent_abuse", "bot_status", "ISP"):
    if k in r:
        print(f"  {k}: {r[k]}")
score = r.get("fraud_score")
verdict = "CLEAN (fresh buys are good)" if isinstance(score, int) and score < 75 else "DIRTY (IPRoyal recycles bad IPs)"
print(f"\nVERDICT: fraud_score={score} -> {verdict}")
print(f"(order {order_id} is a {plan_price} lease; note the IP if you want to import it into the pool)")
