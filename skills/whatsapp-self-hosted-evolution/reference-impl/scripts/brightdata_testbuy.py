"""
ONE-OFF GATE TEST: allocate a single Bright Data ISP (static residential) IP via
the Account Management API, IPQS-check it immediately, confirm it actually routes
through BD's gateway, then release it. Answers the questions that gate whether we
build a BD adapter at all:
  1. can we buy ONE dedicated IP on demand via API?           (POST /zone/ips)
  2. is a FRESH BD IP clean?  (the yield question)             (IPQS)
  3. does that IP actually route traffic?                      (brd gateway)
  4. can we release it via API to stop paying?                 (DELETE /zone/ips)
(The "no babysitting" question, auto-recharge, is a billing-page setting you turn
on in the BD dashboard: it needs a plan with a MINIMUM MONTHLY COMMITMENT; pure
pay-as-you-go has NO auto-recharge. Confirm that in the dashboard, not here.)

SPENDS MONEY. Allocating an ISP IP starts a per-IP charge (BD bills ISP per IP,
roughly $1.80-$3.50/mo with commitment). Requires the literal flag --confirm-buy
or it does nothing but a read-only list. Release the IP right after to cap cost.

The WHOLE flow is API-driven: this script creates the zone, buys the IP, and
releases it, all via the API. The only things you copy by hand are the API token
(you can't mint your first token via the API) and your customer id.

Setup needed in .env.local (or the environment):
  BRIGHTDATA_API_TOKEN     Bearer token. BD dashboard -> account menu ->
                           Account settings -> API tokens. (Manual: bootstrap key.)
  BRIGHTDATA_CUSTOMER_ID   your customer id, the brd-customer-<ID> value (shown on
                           any proxy's access details, NOT your email). (Manual.)
  BRIGHTDATA_ZONE          the zone name to use, e.g. isp. --create-zone MAKES it
                           for you via API; or use one you already have.
  BRIGHTDATA_ZONE_PASSWORD optional; the script AUTO-FETCHES it via API
                           (GET /zone/passwords). Only set it to override.
  IPQS_API_KEY             already set for the IPRoyal flow

Usage (fully API, in order):
  py scripts/brightdata_testbuy.py --create-zone   # API-create the empty ISP zone
  py scripts/brightdata_testbuy.py --confirm-buy   # API-buy 1 IP + IPQS + route test
  py scripts/brightdata_testbuy.py --release <ip>  # API-delete that IP (stop paying)
Other:
  py scripts/brightdata_testbuy.py                 # read-only: list IPs in the zone
  py scripts/brightdata_testbuy.py --confirm-buy --city us-newyork
  py scripts/brightdata_testbuy.py --ipqs 1.2.3.4  # IPQS-check an IP only, no buy
"""
import os, sys, json, time, urllib.request, urllib.parse, urllib.error

BD_BASE = "https://api.brightdata.com"
GATEWAY_HOST = "brd.superproxy.io"
GATEWAY_PORT = int(os.environ.get("BRIGHTDATA_GATEWAY_PORT", "0"))  # SET THIS:  # this account's HTTP port (from the dashboard curl example);
                      # BD assigns the port per account, confirm it on the zone page


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


TOKEN = load("BRIGHTDATA_API_TOKEN")
CUSTOMER = load("BRIGHTDATA_CUSTOMER_ID")
ZONE = load("BRIGHTDATA_ZONE")
ZONE_PASS = load("BRIGHTDATA_ZONE_PASSWORD")
IPQS_KEY = load("IPQS_API_KEY")


def bd(method, path, body=None, timeout=30):
    req = urllib.request.Request(f"{BD_BASE}{path}", method=method, headers={
        "Authorization": f"Bearer {TOKEN}", "Accept": "application/json",
        **({"Content-Type": "application/json"} if body else {})},
        data=json.dumps(body).encode() if body else None)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(txt)
            except json.JSONDecodeError:
                return r.status, txt
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:600]
    except Exception as e:
        return None, str(e)


def ipqs(ip):
    params = urllib.parse.urlencode({"strictness": 0, "allow_public_access_points": "true"})
    url = f"https://ipqualityscore.com/api/json/ip/{IPQS_KEY}/{urllib.parse.quote(ip)}?{params}"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def get_balance():
    """GET /customer/balance -> {balance, pending_balance}. Lets us measure the
    EXACT cost of a buy by diffing balance before/after, and see trial credit."""
    st, body = bd("GET", "/customer/balance", timeout=8)  # known-slow; fail fast
    return body if isinstance(body, dict) else None


def show_balance(label):
    b = get_balance()
    if b is None:
        print(f"  {label}: (could not read balance)")
        return None
    bal = b.get("balance")
    print(f"  {label}: balance={bal} pending={b.get('pending_balance')}")
    return bal


def get_zone_password():
    """Fetch the zone password via API so you don't have to copy it by hand.
    GET /zone/passwords returns per-zone passwords; shape varies, so parse
    defensively. Returns None if it can't be resolved (route test then skips)."""
    if ZONE_PASS:
        return ZONE_PASS
    st, body = bd("GET", f"/zone/passwords?zone={urllib.parse.quote(ZONE)}")
    if not isinstance(body, (dict, list)):
        return None
    if isinstance(body, dict):
        # seen shapes: {"passwords":["pw"]} or {"password":"pw"} or {"<zone>":"pw"}
        if isinstance(body.get("passwords"), list) and body["passwords"]:
            return body["passwords"][0]
        for k in ("password", ZONE):
            if isinstance(body.get(k), str):
                return body[k]
    return None


def list_zone_ips():
    st, body = bd("GET", f"/zone/ips?zone={urllib.parse.quote(ZONE)}")
    if isinstance(body, dict):
        return [x.get("ip") for x in body.get("ips", []) if x.get("ip")]
    print(f"  (GET /zone/ips -> HTTP {st}: {body})")
    return []


def route_test(ip):
    pw = get_zone_password()
    if not (CUSTOMER and pw):
        print("  (skipping routability test: need BRIGHTDATA_CUSTOMER_ID and a zone "
              "password (auto-fetch failed; set BRIGHTDATA_ZONE_PASSWORD to force it))")
        return
    user = f"brd-customer-{CUSTOMER}-zone-{ZONE}-ip-{ip}"
    proxy = f"http://{urllib.parse.quote(user)}:{urllib.parse.quote(pw)}@{GATEWAY_HOST}:{GATEWAY_PORT}"
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    try:
        with opener.open("https://geo.brdtest.com/mygeo.json", timeout=30) as r:
            geo = json.loads(r.read().decode("utf-8", "replace"))
        egress = geo.get("ip") or geo.get("geo", {}).get("ip")
        ok = "MATCH" if egress == ip else f"egress={egress} (sticky -ip- may differ)"
        print(f"  routes OK via {GATEWAY_HOST}:{GATEWAY_PORT} -> {ok}")
    except Exception as e:
        print(f"  routability test FAILED: {e} (activation lag? re-run in a few min)")


def verdict_line(ip):
    print(f"\n=== IPQS for {ip} (strictness 0) ===")
    r = ipqs(ip)
    for k in ("fraud_score", "proxy", "vpn", "tor", "recent_abuse", "bot_status", "ISP", "connection_type"):
        if k in r:
            print(f"  {k}: {r[k]}")
    score = r.get("fraud_score")
    v = "CLEAN" if isinstance(score, int) and score < 75 else "DIRTY (>= 75)"
    print(f"  VERDICT: fraud_score={score} -> {v}")


args = sys.argv[1:]

# --zone <name> overrides BRIGHTDATA_ZONE for this run (e.g. test a shared zone
# without editing .env.local).
if "--zone" in args:
    ZONE = args[args.index("--zone") + 1]

if not TOKEN:
    print("Missing BRIGHTDATA_API_TOKEN. See the setup block at the top of this file.")
    sys.exit(2)

# --ipqs <ip>: just check an IP, no BD calls.
if "--ipqs" in args:
    if not IPQS_KEY:
        print("Missing IPQS_API_KEY"); sys.exit(2)
    verdict_line(args[args.index("--ipqs") + 1]); sys.exit(0)

# --balance: show account balance / trial credit (free, needs only the token).
if "--balance" in args:
    show_balance("balance")
    sys.exit(0)

# --route <ip>: just test that an EXISTING IP routes (no buy). Use this to test a
# shared IP you already created in the dashboard: --route <ip> --zone <name>.
if "--route" in args:
    print("=== routability ===")
    route_test(args[args.index("--route") + 1])
    sys.exit(0)

# --release <ip>: remove an allocated IP to stop paying.
if "--release" in args:
    ip = args[args.index("--release") + 1]
    st, body = bd("DELETE", "/zone/ips", {"zone": ZONE, "ips": [ip]})
    print(f"DELETE /zone/ips {ip} -> HTTP {st}: {json.dumps(body)[:300] if isinstance(body, (dict, list)) else body}")
    sys.exit(0 if st in (200, 204) else 1)

# --delete-zone: permanently remove the whole zone (stops all billing for it).
if "--delete-zone" in args:
    if not ZONE:
        print("Set BRIGHTDATA_ZONE or pass --zone <name> to delete."); sys.exit(2)
    st, body = bd("DELETE", "/zone", {"zone": ZONE})
    print(f"DELETE /zone {ZONE} -> HTTP {st}: {json.dumps(body)[:200] if isinstance(body, (dict, list)) else body}")
    sys.exit(0 if st in (200, 204) else 1)

# --create-zone: create the EMPTY dedicated-ISP zone via API (no IP yet, no per-IP
# charge). This is the container POST /zone/ips later adds an IP into. Doing it via
# API means the only thing you copy by hand is the token + customer id.
if "--create-zone" in args:
    if not ZONE:
        print("Set BRIGHTDATA_ZONE to the name you want (e.g. isp) first."); sys.exit(2)
    zc = "us"
    if "--country" in args:
        zc = args[args.index("--country") + 1]
    # ISP zone, unlimited bandwidth: plan.type=static + pool_ip_type=static_res
    # (REQUIRED, or BD silently makes a Datacenter zone). --shared = Shared unlimited
    # ($2/IP); default = Dedicated unlimited ($4/IP). --ips N sets the IP count AT
    # CREATION so the IP allocates immediately (the reliable path; create-empty then
    # POST /zone/ips gets QUEUED). No --ips = start empty.
    shared = "--shared" in args
    plan = {"type": "static", "pool_ip_type": "static_res", "country": zc,
            "bandwidth": "unlimited", "unl_bw_tiers": "std",
            "ips_type": "shared" if shared else "dedicated"}
    nips = int(args[args.index("--ips") + 1]) if "--ips" in args else 0
    if nips > 0:
        plan["ips"] = nips
    st, body = bd("POST", "/zone", {"zone": {"name": ZONE, "type": "ISP"}, "plan": plan})
    print(f"POST /zone ({ZONE}, {'shared' if shared else 'dedicated'} ISP unlimited, {zc}, "
          f"ips={nips}) -> HTTP {st}: {json.dumps(body)[:500] if isinstance(body, (dict, list)) else body}")
    if st not in (200, 201):
        print("Zone create failed. If it says the zone exists, you're fine, reuse it.")
        sys.exit(1)
    if nips <= 0:
        print(f"Zone '{ZONE}' ready (0 IPs). Buy into it with --confirm-buy.")
        sys.exit(0)
    # Created WITH ips: the IP should allocate right away. Fetch, IPQS, route-test it.
    print("Fetching the allocated IP ...")
    ip = None
    for delay in (2, 3, 4, 5, 6):
        time.sleep(delay)
        ips = list_zone_ips()
        if ips:
            ip = ips[0]
            break
        print(f"  ...still {len(ips)} IP(s)")
    if not ip:
        print("No IP surfaced yet; re-check with the read-only list shortly.")
        sys.exit(1)
    print(f"\nDEDICATED IP: {ip}")
    if IPQS_KEY and "--no-ipqs" not in args:
        verdict_line(ip)
    print("\n=== routability ===")
    route_test(ip)
    print(f"\nWhen done, delete the whole zone to stop billing:\n"
          f"  py scripts/brightdata_testbuy.py --delete-zone --zone {ZONE}")
    sys.exit(0)

if not (CUSTOMER and ZONE):
    print("Missing BRIGHTDATA_CUSTOMER_ID and/or BRIGHTDATA_ZONE. See setup block.")
    sys.exit(2)

country = "us"
if "--country" in args:
    country = args[args.index("--country") + 1]
city = None
if "--city" in args:
    city = args[args.index("--city") + 1]

before = list_zone_ips()
print(f"Zone '{ZONE}' currently has {len(before)} IP(s): {before or '(none)'}")

if "--confirm-buy" not in args:
    loc = f"city {city}" if city else f"country {country}"
    print(f"\nDRY RUN. Would allocate 1 ISP IP in {loc} (POST /zone/ips, count=1). "
          f"This STARTS a per-IP charge.")
    print("Re-run with --confirm-buy to actually allocate + IPQS + route-test.")
    print("After testing, release it with:  py scripts/brightdata_testbuy.py --release <ip>")
    sys.exit(0)

skip_ipqs = "--no-ipqs" in args
if not IPQS_KEY and not skip_ipqs:
    print("Missing IPQS_API_KEY (add it to .env.local, or pass --no-ipqs to skip the "
          "fraud check for a plumbing-only test)"); sys.exit(2)

body = {"customer": CUSTOMER, "zone": ZONE, "count": 1, "country": country}
if city:
    body["country_city"] = city
print("\n=== balance BEFORE buy ===")
bal_before = show_balance("before")
print(f"\nAllocating 1 ISP IP (POST /zone/ips) in {city or country} ...")
st, resp = bd("POST", "/zone/ips", body)
print(f"POST /zone/ips -> HTTP {st}: {json.dumps(resp)[:400] if isinstance(resp, (dict, list)) else resp}")
if st not in (200, 201):
    sys.exit(1)

# The new IP: prefer the POST response, else diff the zone list.
new_ip = None
if isinstance(resp, dict):
    for x in resp.get("ips", []) or resp.get("new_ips", []):
        cand = x.get("ip") if isinstance(x, dict) else x
        if cand and cand not in before:
            new_ip = cand; break
if not new_ip:
    print("Polling zone for the new IP ...")
    for delay in (3, 4, 5, 6):
        time.sleep(delay)
        after = list_zone_ips()
        diff = [ip for ip in after if ip not in before]
        if diff:
            new_ip = diff[0]; break
        print(f"  ...still {len(after)} IP(s)")

if not new_ip:
    print("No new IP surfaced. Check the zone in the dashboard; nothing to test.")
    sys.exit(1)

print(f"\nFRESH BD IP: {new_ip}")
print("\n=== balance AFTER buy (delta = the EXACT price of 1 IP) ===")
bal_after = show_balance("after")
if isinstance(bal_before, (int, float)) and isinstance(bal_after, (int, float)):
    print(f"  >>> this IP cost: {round(bal_before - bal_after, 4)} "
          f"(if 0, it may be trial credit or billed later as pending)")
if IPQS_KEY and not skip_ipqs:
    verdict_line(new_ip)
else:
    print("\n(IPQS fraud check skipped, plumbing-only test)")
print("\n=== routability ===")
route_test(new_ip)
print(f"\nDone. RELEASE it to stop the charge:\n  py scripts/brightdata_testbuy.py --release {new_ip}")
