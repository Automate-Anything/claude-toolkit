"""
Import owned IPRoyal ISP Dedicated proxies into public.evolution_proxies.

Read-only against IPRoyal (GET orders), then WRITES an idempotent INSERT .sql to
a temp path (passwords go into the file + DB, never to stdout). Run the emitted
SQL with scripts/execute_sql.py to actually insert.

Usage:
  py scripts/iproyal_import.py            # writes /tmp/iproyal_insert.sql
Then:
  py scripts/execute_sql.py /tmp/iproyal_insert.sql   (append #confirmed)
"""
import os
import json
import sys
import tempfile
import urllib.request
import urllib.error

BASE = "https://apid.iproyal.com/v1/reseller"
ISP_PRODUCT_ID = 9
OUT_SQL = os.path.join(tempfile.gettempdir(), "iproyal_insert.sql")


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
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def sqlq(s):
    """Escape a string for a single-quoted SQL literal."""
    return str(s).replace("'", "''")


def main():
    token = load_token()
    if not token:
        print("IPROYAL_API_TOKEN not found (env or .env.local)")
        sys.exit(2)

    orders = api_get(f"/orders?product_id={ISP_PRODUCT_ID}&page=1&per_page=100", token)
    order_list = orders.get("data") if isinstance(orders, dict) else orders
    if not isinstance(order_list, list):
        print("No ISP orders array returned.")
        sys.exit(1)

    rows = []  # (proxy_url, label, order_id)  - url carries the password
    summary = []  # redacted, safe to print
    for o in order_list:
        if not isinstance(o, dict) or o.get("is_test"):
            continue
        if o.get("status") != "confirmed":
            continue
        oid = o.get("id")
        pdata = o.get("proxy_data") or {}
        ports = pdata.get("ports") or {}
        http_port = ports.get("http|https") or ports.get("http") or ports.get("https")
        for i, p in enumerate(pdata.get("proxies") or [], start=1):
            if not isinstance(p, dict):
                continue
            ip = p.get("ip")
            user = p.get("username")
            pw = p.get("password")
            if not (ip and user and pw and http_port):
                continue
            url = f"http://{user}:{pw}@{ip}:{http_port}"
            label = f"IPRoyal ISP {ip}"
            rows.append((url, label, str(oid)))
            summary.append(f"{ip}:{http_port}  (order {oid})")

    if not rows:
        print("No confirmed ISP proxies found to import.")
        sys.exit(1)

    lines = [
        "-- IPRoyal ISP Dedicated proxies -> evolution_proxies (idempotent per proxy_url).",
    ]
    for url, label, oid in rows:
        lines.append(
            "INSERT INTO public.evolution_proxies (proxy_url, label, provider, provider_order_id) "
            f"SELECT '{sqlq(url)}', '{sqlq(label)}', 'iproyal', '{sqlq(oid)}' "
            f"WHERE NOT EXISTS (SELECT 1 FROM public.evolution_proxies WHERE proxy_url = '{sqlq(url)}');"
        )
    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Wrote {len(rows)} proxy insert(s) to: {OUT_SQL}")
    for s in summary:
        print(f"  - {s}")
    print("\nNext: py scripts/execute_sql.py " + OUT_SQL)


if __name__ == "__main__":
    main()
