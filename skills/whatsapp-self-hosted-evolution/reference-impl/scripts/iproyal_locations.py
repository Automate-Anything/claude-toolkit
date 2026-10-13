"""Print a product's locations (id + name) filtered by a name substring.
Usage: py scripts/iproyal_locations.py <product_id> [name-substring]
Reads IPROYAL_API_TOKEN from .env.local. Read-only."""
import os, sys, json, urllib.request

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

def main():
    token = load_token()
    pid = int(sys.argv[1]) if len(sys.argv) > 1 else 9
    needle = (sys.argv[2] if len(sys.argv) > 2 else "united states").lower()
    req = urllib.request.Request("https://apid.iproyal.com/v1/reseller/products",
        headers={"X-Access-Token": token, "Accept": "application/json"})
    data = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
    prods = data.get("data") if isinstance(data, dict) else data
    prod = next((p for p in prods if p.get("id") == pid), None)
    if not prod:
        print("product not found:", pid); return
    print(f"product {pid}: {prod.get('name')}")
    for loc in prod.get("locations", []):
        if needle in str(loc.get("name", "")).lower():
            print(f"  location id={loc.get('id')} name={loc.get('name')} out_of_stock={loc.get('out_of_stock')}")
            for ch in loc.get("child_locations", []):
                print(f"    child id={ch.get('id')} name={ch.get('name')} out_of_stock={ch.get('out_of_stock')}")

if __name__ == "__main__":
    main()
