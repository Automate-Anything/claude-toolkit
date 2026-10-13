"""
Proxy yield scoreboard (read-only) for the Evolution per-channel proxy pool.

Answers the question we could NOT answer before: what is each proxy provider's
clean-IP YIELD PER DOLLAR? Right now everything is IPRoyal, so this establishes
the IPRoyal baseline. When a second provider (e.g. Bright Data) comes online it
appears as its own row automatically and the two compete on real numbers.

What it measures, per provider, from the live `evolution_proxies` table:
  buys        total rows we have for that provider (every acquired IP, incl.
              screened-and-rejected ones, which are RETAINED as status='dead'
              rows, e.g. the fraud-100 auto-buy rejection, so the clean-rate is
              honest and not survivorship-biased)
  screened    rows that actually got an IPQS score (fraud_score IS NOT NULL)
  clean       screened rows UNDER the fraud threshold (usable)
  dirty       screened rows AT/OVER the threshold (wasted spend)
  unscreened  rows with no score yet (IPQS off or lookup failed = fails open)
  avg/min/max the fraud_score distribution among screened rows
  clean_rate  clean / screened  (the yield)
  $/usable    price_per_IP_month / clean_rate  (the yield PER DOLLAR, the number
              that actually decides which provider to prefer)

Cost caveat: `evolution_proxies` has no cost column yet, so per-IP price is taken
from the editable PRICE_PER_IP_MONTH map below (normalized to $/IP/30-days so a
1-day test plan and a 30-day plan are comparable). Update these to real invoice
numbers, or add a real cost column later for exact figures.

Usage:  py scripts/proxy_yield.py [--threshold 75]

Read-only: issues SELECTs only, via the same Supabase Management API + token that
scripts/execute_sql.py uses. No writes, no DB gate needed.
"""
import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv

# ---- EDIT ME: nominal price per IP normalized to a 30-day month (USD) --------
# IPRoyal ISP dedicated: plan 22 = $4 / 30-day (prod default); plan 23 = $2 / 1-day
#   (= ~$60/mo equivalent, TEST ONLY). We run the 30-day plan in prod, so $4.
# Bright Data ISP dedicated: ~$1.80-$3.50 / IP / month depending on commitment
#   (VERIFY against a real quote before trusting the $/usable comparison).
PRICE_PER_IP_MONTH = {
    "iproyal": 4.00,
    "brightdata": 3.50,
}
DEFAULT_THRESHOLD = 75  # mirror config.evolutionProxyFraudThreshold

env_local = Path(__file__).parent.parent / ".env.local"
env_file = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_local if env_local.exists() else env_file)

try:
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
    import requests
from requests.packages.urllib3.exceptions import InsecureRequestWarning
requests.packages.urllib3.disable_warnings(InsecureRequestWarning)


def run_sql(sql):
    token = os.getenv("SUPABASE_ACCESS_TOKEN") or os.getenv("VITE_SUPABASE_ACCESS_TOKEN")
    project = os.getenv("VITE_SUPABASE_PROJECT_ID")
    if not token or not project:
        print("Error: SUPABASE_ACCESS_TOKEN / VITE_SUPABASE_PROJECT_ID missing in .env.local")
        sys.exit(1)
    url = f"https://api.supabase.com/v1/projects/{project}/database/query"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": sql},
        verify=False,
        timeout=60,
    )
    if r.status_code not in (200, 201):
        print(f"Error ({r.status_code}): {r.text}")
        sys.exit(1)
    return json.loads(r.text) if r.text else []


def fnum(v):
    # Supabase Management API returns numeric() aggregates as strings ("38.0").
    if v is None:
        return "-"
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return f"{f:.0f}" if f.is_integer() else f"{f:.1f}"


def inum(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def main():
    threshold = DEFAULT_THRESHOLD
    if "--threshold" in sys.argv:
        threshold = int(sys.argv[sys.argv.index("--threshold") + 1])

    provider_sql = f"""
        SELECT
          COALESCE(provider, '(none)')                                   AS provider,
          COUNT(*)                                                       AS buys,
          COUNT(fraud_score)                                             AS screened,
          COUNT(*) FILTER (WHERE fraud_score IS NOT NULL
                             AND fraud_score < {threshold})              AS clean,
          COUNT(*) FILTER (WHERE fraud_score IS NOT NULL
                             AND fraud_score >= {threshold})             AS dirty,
          COUNT(*) FILTER (WHERE fraud_score IS NULL)                    AS unscreened,
          ROUND(AVG(fraud_score) FILTER (WHERE fraud_score IS NOT NULL), 1) AS avg_score,
          MIN(fraud_score)                                              AS min_score,
          MAX(fraud_score)                                              AS max_score
        FROM public.evolution_proxies
        GROUP BY 1
        ORDER BY 1;
    """

    # Bonus: clean-rate by /16 netblock, the "consecutive buys share a poisoned
    # block" pattern (id 6/7 both 198.51.x @ 38). IP is parsed out of proxy_url.
    netblock_sql = f"""
        WITH ips AS (
          SELECT
            COALESCE(provider, '(none)') AS provider,
            substring(proxy_url from '@([0-9]+\\.[0-9]+)\\.') AS block16,
            fraud_score
          FROM public.evolution_proxies
        )
        SELECT provider, block16 AS netblock_16,
               COUNT(*) AS ips,
               ROUND(AVG(fraud_score) FILTER (WHERE fraud_score IS NOT NULL), 1) AS avg_score,
               MIN(fraud_score) AS min_score, MAX(fraud_score) AS max_score
        FROM ips
        WHERE block16 IS NOT NULL
        GROUP BY provider, block16
        ORDER BY provider, avg_score DESC NULLS LAST;
    """

    rows = run_sql(provider_sql)
    print(f"\n=== Proxy yield scoreboard (threshold = {threshold}) ===\n")
    hdr = f"{'provider':<12}{'buys':>5}{'scrn':>5}{'clean':>6}{'dirty':>6}{'unscr':>6}{'avg':>6}{'min':>5}{'max':>5}{'clean%':>8}{'$/IP mo':>9}{'$/usable':>10}"
    print(hdr)
    print("-" * len(hdr))
    if not rows:
        print("(no proxies in the pool yet)")
    for r in rows:
        prov = r["provider"]
        screened = inum(r["screened"])
        clean = inum(r["clean"])
        rate = (clean / screened) if screened else None
        price = PRICE_PER_IP_MONTH.get(prov)
        per_usable = (price / rate) if (price and rate) else None
        print(
            f"{prov:<12}{inum(r['buys']):>5}{screened:>5}{clean:>6}{inum(r['dirty']):>6}{inum(r['unscreened']):>6}"
            f"{fnum(r['avg_score']):>6}{fnum(r['min_score']):>5}{fnum(r['max_score']):>5}"
            f"{(f'{rate*100:.0f}%' if rate is not None else '-'):>8}"
            f"{(f'${price:.2f}' if price else '-'):>9}"
            f"{(f'${per_usable:.2f}' if per_usable else '-'):>10}"
        )

    print("\n--- clean-rate by /16 netblock (dirty clusters float to the top) ---\n")
    nb = run_sql(netblock_sql)
    nhdr = f"{'provider':<12}{'netblock/16':<14}{'ips':>4}{'avg':>6}{'min':>5}{'max':>5}"
    print(nhdr)
    print("-" * len(nhdr))
    for r in nb:
        print(
            f"{r['provider']:<12}{(r['netblock_16'] or '-'):<14}{inum(r['ips']):>4}"
            f"{fnum(r['avg_score']):>6}{fnum(r['min_score']):>5}{fnum(r['max_score']):>5}"
        )
    print(
        "\nNote: $/usable = $/IP-month / clean-rate (screened only). Prices are the\n"
        "editable PRICE_PER_IP_MONTH map, not live invoice data. Small n right now;\n"
        "the number gets trustworthy as the pool grows. A second provider shows up\n"
        "as its own row automatically once it starts writing rows.\n"
    )


if __name__ == "__main__":
    main()
