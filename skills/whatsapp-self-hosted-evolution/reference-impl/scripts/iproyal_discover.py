"""
Read-only discovery for the IPRoyal reseller API (dedicated ISP).

Loads IPROYAL_API_TOKEN from .env.local, lists orders, fetches each order's
detail, and prints the structure with password-like fields REDACTED so we can
see exactly where the host/port/username/password live for dedicated ISP proxies.

No writes, no spend: this only calls GET endpoints. Once we see the shape, the
companion insert step builds the proxy URLs and writes them into
public.evolution_proxies (without ever printing the passwords).
"""
import os
import json
import sys
import urllib.request
import urllib.error

BASE = "https://apid.iproyal.com/v1/reseller"


def load_token():
    tok = os.environ.get("IPROYAL_API_TOKEN")
    if tok:
        return tok
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("IPROYAL_API_TOKEN="):
                    v = line.split("=", 1)[1].strip()
                    if (v[:1], v[-1:]) in (('"', '"'), ("'", "'")):
                        v = v[1:-1]
                    return v
    except FileNotFoundError:
        pass
    return None


def api_get(path, token):
    url = path if path.startswith("http") else f"{BASE}{path}"
    req = urllib.request.Request(
        url, headers={"X-Access-Token": token, "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:500]
        return e.code, {"_http_error": body}
    except Exception as e:  # noqa: BLE001
        return None, {"_error": str(e)}


SECRET_HINT = ("pass", "secret", "token", "apikey", "api_key")


def redact(obj):
    if isinstance(obj, dict):
        return {
            k: ("<redacted>" if any(h in k.lower() for h in SECRET_HINT) else redact(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [redact(x) for x in obj]
    return obj


def main():
    token = load_token()
    if not token:
        print("IPROYAL_API_TOKEN not found (env or .env.local)")
        sys.exit(2)

    # 1. Products (to discover the ISP product_id that /orders requires).
    pstatus, products = api_get("/products", token)
    print(f"GET /products -> HTTP {pstatus}")

    prod_list = products.get("data") if isinstance(products, dict) else products
    product_ids = []
    if isinstance(prod_list, list):
        for p in prod_list:
            if not isinstance(p, dict):
                continue
            pid = p.get("id")
            plans = ", ".join(
                f"{pl.get('id')}:{pl.get('name')}(${pl.get('price')})"
                for pl in (p.get("plans") or [])
                if isinstance(pl, dict)
            )
            print(f"  product {pid}: {p.get('name')}  plans=[{plans}]")
            if pid is not None:
                product_ids.append(pid)

    # 2. Orders for ISP Dedicated (product_id 9), which is what we care about.
    for pid in [9]:
        status, orders = api_get(f"/orders?product_id={pid}&page=1&per_page=50", token)
        print(f"\nGET /orders?product_id={pid}&page=1 -> HTTP {status}")
        print(json.dumps(redact(orders), indent=2)[:3000])

        order_list = orders.get("data") if isinstance(orders, dict) else orders
        if not isinstance(order_list, list):
            continue
        for o in order_list[:3]:
            oid = o.get("id") if isinstance(o, dict) else None
            if oid is None:
                continue
            st, detail = api_get(f"/orders/{oid}?product_id={pid}", token)
            print(f"\n===== GET /orders/{oid} (product {pid}) -> HTTP {st} =====")
            print(json.dumps(redact(detail), indent=2)[:4000])


if __name__ == "__main__":
    main()
