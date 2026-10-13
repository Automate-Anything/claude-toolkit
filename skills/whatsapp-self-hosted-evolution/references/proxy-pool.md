# The per-number proxy pool: getting IP addresses and running them

This is the runbook for the layer that sits under the self-hosted WhatsApp stack (Evolution API on
Baileys): every WhatsApp number gets its own stable IP address, bought from a proxy provider,
tracked in one database table, applied to that number's Evolution instance, renewed while the
number is connected and released when it is deleted.

Everything here was read from the bundled production code in `../reference-impl/`. Paths below
are relative to that folder. Where a detail is not in that code, this file says
"not covered by the reference implementation" instead of guessing. Where a build-log document in
`deploy/` disagrees with the code, the code is what is written here.

Vendor facts and the wider list of traps live in the companion skill `iproyal-proxies`. Read its
section 1 ("the ten things that bite") before spending money.

Contents:

1. Why one stable IP per number
2. What you need before you start (accounts, keys, env vars)
3. Buying an IP by hand with the bundled scripts
4. Buying by API (IPRoyal): exact calls
5. The pool table
6. The lifecycle in code
7. Fraud screening (IPQS)
8. The second provider (Bright Data)
9. Admin endpoints
10. Verifying a number really goes out through its proxy
11. Landmines
12. File and script map

Conventions: `<angle brackets>` are placeholders. IPs in examples are from the documentation range
`203.0.113.x`. Never paste a real token, password, order id or IP into a file or a chat.

---

## 1. Why one stable IP per number

By default every Evolution instance sends its WhatsApp traffic from the Evolution host's single
IP. With one to five test numbers that is fine. Once many customers share that one IP, WhatsApp
can flag the IP, and one flag takes down every number on it at once. The fix: each number
egresses from its own IP, so a ban on one cannot spread to the others.
(`deploy/PROXY_PER_CHANNEL_PLAN.md`, "Why")

Which kind of IP:

| Kind | Use it? | Why |
|---|---|---|
| Static ISP / static residential, dedicated, one IP per number | Yes | Looks like one home connection and never changes. This is IPRoyal "ISP Dedicated" (product 9) and Bright Data zone type `ISP` with `pool_ip_type: static_res`, `ips_type: dedicated` |
| Datacenter | No | WhatsApp flags datacenter ranges. Worse than one shared IP |
| Rotating residential | No | The IP changes, which breaks the linked-device (companion) session that needs a stable address |

Without the pool (`EVOLUTION_PROXY_MODE` off) the instance shares the host IP. The code treats that
as test-only. With the mode set to `required`, a connect that cannot get a proxy fails loudly with
HTTP 503 and code `no_proxy_capacity`. It never falls back to the shared IP, because a silent
fallback is exactly the failure this layer exists to prevent. (`server/routes/evolution/provision.ts`)

A number's WhatsApp credentials are stored independently of its egress IP. That is why an IP can
be swapped under a paired number with no new QR scan (section 6.5), and why a logout does not
release the IP (a reconnect keeps the same address).

---

## 2. What you need before you start

### 2.1 Accounts and keys

| What | Used for | Where the value comes from |
|---|---|---|
| IPRoyal account + reseller API token | Primary provider. Every call sends it as header `X-Access-Token` | The token's location in the IPRoyal dashboard is not covered by the reference implementation. It is the token for the reseller API at `https://apid.iproyal.com/v1/reseller` |
| IPRoyal funding: balance, or a saved card | Paying for buys, manual extends and auto-renew | Saved cards are listed by `GET /cards` (run `scripts/iproyal_account.py`). Adding a card or topping up is done in the dashboard, not covered by the reference implementation |
| IPQualityScore (IPQS) API key | Fraud-scoring each IP | The key's location in the IPQS dashboard is not covered by the reference implementation. It is embedded in the request path |
| Bright Data account: API token + customer id (optional second provider) | Fallback when IPRoyal is dirty, erroring or out of stock | Token: BD dashboard, account menu, Account settings, API tokens. Customer id: the `brd-customer-<ID>` value shown on any proxy's access details, not your email (`scripts/brightdata_testbuy.py` header). The first token cannot be minted by API |

IPRoyal money rules that the code is built around:

- A buy pays from the account **balance** unless a `card_id` is sent. With an empty balance the
  order comes back `unpaid`, never provisions, and the connect fails. IPRoyal has no balance
  auto-recharge. (`deploy/PROXY_PER_CHANNEL_PLAN.md`)
- For unattended production, set `IPROYAL_CARD_ID` so buys, manual extends and auto-renew charge
  the saved card and can never fail on an empty balance. A failed renewal lets the IP lapse and
  drops the customer's number. (`deploy/GO_LIVE_CHECKLIST.md` step 6)

Bright Data money rules: the API cannot charge a card. Buys draw from the prepaid balance, and a
buy from an empty balance fails instead of creating debt. Keep auto-recharge on with a buffer
(a dashboard billing setting). (`server/whatsapp/evolution/brightdataClient.ts` header)

### 2.2 What to buy, where, and what it costs

Snapshot from the reference files, 2026. Re-check with the catalog call before spending.

| Item | Value | Source |
|---|---|---|
| IPRoyal product | `9` = ISP Dedicated (static) | `iproyal_testbuy.py`, `iproyal_import.py` |
| IPRoyal location | `16` = United States | `iproyal_testbuy.py` |
| IPRoyal plan `22` | 30 days, $4. Production default | `iproyal_testbuy.py`, `proxy_yield.py` |
| IPRoyal plan `23` | 1 day, about $2. Tests only | same |
| IPRoyal plan `24` / `25` | 60 days $8 / 90 days $12 | `iproyal_testbuy.py` |
| Quantity | Always `1` per order | `proxyPool.ts` (auto-renew is one switch per order, see landmine 4) |
| Bright Data dedicated ISP, unlimited bandwidth | Listed as $4 per IP in one script comment and "roughly $1.80 to $3.50 per month with commitment" in another. Billed prorated until the zone is deleted | `brightdata_testbuy.py` |
| Bright Data shared ISP, unlimited | $2 per IP (script comment). Not used by the server | `brightdata_testbuy.py` |

Premium (hand-picked zero-fraud-score) IPRoyal IPs cannot be ordered through the reseller API.
IPRoyal support confirmed that the dashboard's `proxy_risk_type` / `proxy_score_type` must not be
sent to the order endpoint and product 9 has no fraud-score order question. So API buys are
standard fraud score. If you want Premium IPs, buy them in the dashboard and import them
(section 3.4). Tested result in the build log: a fresh standard buy scored IPQS 0 at purchase, so
Premium is optional insurance, not required. (`iproyalClient.ts`, `PROXY_PER_CHANNEL_PLAN.md`)

### 2.3 Environment variables

`config/env.ts` (which maps env vars to the `config.*` keys the code reads) is NOT bundled in
`reference-impl`. The names below are the ones that appear in the bundled code comments, scripts
and deploy docs. Defaults are the ones those files state.

Set these on the backend service that runs `proxyPool.ts` and the heal job (the app server that
talks to Evolution), not inside the Evolution container.

| Env var | `config` key | Default | Meaning |
|---|---|---|---|
| `EVOLUTION_PROXY_MODE` | `evolutionProxyMode` | `off` | `off`: no proxy, instances share the host IP (test only). `required`: every new number must get a proxy or the connect fails |
| `EVOLUTION_PROXY_AUTOBUY` | `evolutionProxyAutobuy` | off | `on`: buy an IP when the pool has no free one. Spends money |
| `EVOLUTION_PROXY_AUTOHEAL` | `evolutionProxyAutoheal` | off | `on`: the hourly heal job runs (it also needs the service's cron switch, `RUN_CRONS=true` in the source system) |
| `EVOLUTION_PROXY_MAX_POOL` | `evolutionProxyMaxPool` | 10 | Hard cap on rows whose status is not `dead`. Auto-buy refuses above it |
| `EVOLUTION_PROXY_FRAUD_THRESHOLD` | `evolutionProxyFraudThreshold` | 75 | IPQS `fraud_score` at or above this is dirty |
| `EVOLUTION_PROXY_PROVIDER` | `evolutionProxyProvider` | `iproyal` | Provider auto-buy starts on (`iproyal` or `brightdata`) |
| `EVOLUTION_PROXY_MAX_DIRTY_BUYS` | `evolutionProxyMaxDirtyBuys` | 1 | Dirty IPRoyal buys in a row before switching to Bright Data |
| `EVOLUTION_PROXY_BD_MAX_DIRTY_BUYS` | `evolutionProxyBdMaxDirtyBuys` | 20 | Dirty Bright Data buys in a row before auto-buy trips and stops |
| `EVOLUTION_PROXY_MAX_ERROR_SWITCHES` | `evolutionProxyMaxErrorSwitches` | 2 | Provider switches allowed on errors within one acquisition |
| `EVOLUTION_PROXY_DIRTY_BREAKER_RESET_MINUTES` | `evolutionProxyDirtyBreakerResetMinutes` | 120 | A tripped dirty-buy breaker re-arms after this long. `0` disables the timer |
| `IPROYAL_API_TOKEN` | `iproyalApiToken` | none | Reseller token. IPRoyal counts as configured when this is set |
| `IPROYAL_CARD_ID` | `iproyalCardId` | empty | Empty: pay from balance. Digits: that saved card id. `auto`: the first card from `GET /cards`, cached per process |
| `IPROYAL_PLAN_ID` | `iproyalPlanId` | 22 in production | Plan bought, extended and auto-renewed. `23` for cheap tests |
| name not in the bundled files | `iproyalProductId` | 9 | Product id |
| name not in the bundled files | `iproyalLocationId` | 16 | Location id |
| `IPQS_API_KEY` | `ipqsApiKey` | none | Unset: all fraud screening is skipped (fails open) |
| `BRIGHTDATA_API_TOKEN` | `brightdataApiToken` | none | Bearer token |
| `BRIGHTDATA_CUSTOMER_ID` | `brightdataCustomerId` | none | Bright Data counts as configured only when token AND customer id are set |
| name not in the bundled files | `brightdataCountry` | `us` in the scripts | Country sent in the zone plan |
| name not in the bundled files | `brightdataGatewayHost` | `brd.superproxy.io` | Shared gateway host |
| name not in the bundled files | `brightdataGatewayPort` | account-specific | Read it from your zone's access details |

The scripts also read `BRIGHTDATA_ZONE` and `BRIGHTDATA_ZONE_PASSWORD` (scripts only), and
`proxy_yield.py` reads `SUPABASE_ACCESS_TOKEN` (or `VITE_SUPABASE_ACCESS_TOKEN`) and
`VITE_SUPABASE_PROJECT_ID`.

Minimum to go live (from `deploy/GO_LIVE_CHECKLIST.md` step 6):

```
IPROYAL_API_TOKEN=<reseller token>
IPQS_API_KEY=<key>
EVOLUTION_PROXY_MODE=required
EVOLUTION_PROXY_AUTOBUY=on
EVOLUTION_PROXY_AUTOHEAL=on
IPROYAL_CARD_ID=<saved card id, or auto>
IPROYAL_PLAN_ID=22
```

---

## 3. Buying an IP by hand with the bundled scripts

All scripts are in `scripts/`. They are plain Python (standard library only, except
`proxy_yield.py`, which needs `requests` and `python-dotenv`). Each one reads its key from the
process environment first, then from a file named `.env.local` in the folder ABOVE `scripts/`.
Run them as `py scripts/<name>.py` from that parent folder (in the source repo that was the repo
root; copy `scripts/` into your repo the same way).

Nothing prints a proxy password. The discovery scripts do print IPs and proxy usernames, so do not
paste their output into tickets or chats.

### 3.1 Check the account (free)

```
py scripts/iproyal_account.py
```

Calls `GET /balance` and `GET /cards` and prints each under a header line naming the call and its HTTP status
followed by the JSON. Keys containing `pass`, `secret`, `token`, `cvv` or `number` print as
`<redacted>`. Check: HTTP 200 on both (a non-200 means a bad token), a balance that covers the buy
OR at least one card. Note the card `id`: that is the value for `IPROYAL_CARD_ID`.

### 3.2 Discover products, plans, locations and stock (free)

```
py scripts/iproyal_discover.py
py scripts/iproyal_locations.py 9 "united states"
```

`iproyal_discover.py` takes no arguments. It prints one line per product
(`product 9: <name>  plans=[22:<name>($<price>), 23:...]`), then `GET /orders?product_id=9&page=1&per_page=50`
with secret-looking keys redacted, then the detail of the first 3 orders. Use it to confirm the
product id, plan ids and prices, and to see the exact order shape on your account.

`iproyal_locations.py <product_id> [name-substring]` defaults to product `9` and the substring
`united states`. It prints `location id=<id> name=<name> out_of_stock=<bool>` and, indented, each
`child id=<id> name=<city> out_of_stock=<bool>`. Check `out_of_stock` is false for the location
you plan to buy. On one day every US ISP location was out of stock.

### 3.3 Test-buy one IP and fraud-check it (spends money)

```
py scripts/iproyal_testbuy.py                  # dry run, prints what it WOULD buy
py scripts/iproyal_testbuy.py --confirm-buy    # buys 1 IP, then IPQS-checks it
py scripts/iproyal_testbuy.py --confirm-buy --plan 22
py scripts/iproyal_testbuy.py --order <order-id>   # resume: poll + check an existing order, no charge
```

Facts from the script:

- Needs BOTH `IPROYAL_API_TOKEN` and `IPQS_API_KEY`, even for the dry run.
- Product `9` and location `16` are constants at the top of the file. The plan defaults to `23`
  (1 day, about $2). `--plan N` overrides it. Quantity is always 1.
- It pays from the account **balance** (it sends no `card_id`). With an empty balance the order
  will not provision.
- Without `--confirm-buy` (and without `--order`) it prints a `DRY RUN. Would buy: ...` line and
  exits.

What it prints on a real buy: the HTTP status of `POST /orders`, `order id: <id>, status: <status>`,
then `Polling for the provisioned IP ...` (waits of 3, 5, 5, 8, 8, 10 seconds, printing
`...status=<s> proxies=<n>` while waiting), then `FRESH IP: <ip>`, the IPQS fields
(`fraud_score`, `proxy`, `vpn`, `tor`, `recent_abuse`, `bot_status`, `ISP`) and
a `VERDICT: fraud_score=<n>` line ending in `CLEAN ...` (score below 75) or `DIRTY ...`.

What to check: HTTP 2xx on the order, an order id, the IP appears, verdict CLEAN. If it ends with
`No IP provisioned in time. Check order <id> manually.`, do NOT buy again: re-run with
`--order <id>`. The script does not print the credentials and does not test routing. The
credentials are fetched by the import script below.

### 3.4 Import bought IPs into the pool table

```
py scripts/iproyal_import.py
```

Works for IPs bought by the test script, in the dashboard (the way to get Premium IPs), or by
anything else on the same account. Read-only against IPRoyal: it calls
`GET /orders?product_id=9&page=1&per_page=100`, skips orders with `is_test` set and orders whose
`status` is not `confirmed`, and for each proxy builds `http://<username>:<password>@<ip>:<port>`
(port from `proxy_data.ports["http|https"]`, else `http`, else `https`).

It writes a SQL file to the system temp folder (`iproyal_insert.sql`) and prints
`Wrote <n> proxy insert(s) to: <path>` plus one `- <ip>:<port>  (order <id>)` line each. Passwords
go into the file, never to the screen. Each statement is idempotent per `proxy_url`:

```sql
INSERT INTO public.evolution_proxies (proxy_url, label, provider, provider_order_id)
SELECT '<proxy_url>', 'IPRoyal ISP <ip>', 'iproyal', '<order-id>'
WHERE NOT EXISTS (SELECT 1 FROM public.evolution_proxies WHERE proxy_url = '<proxy_url>');
```

Then run that file against your database. The script's last line points at
`scripts/execute_sql.py`, which is a source-repo helper that is NOT bundled: use your own SQL
runner (service-role access). Follow the repo's database-write rule first: pull the live schema of
`evolution_proxies` and check the statement against it. Delete the temp file afterwards, it
contains credentials.

Result: rows with `status = 'available'` (the column default), no fraud score and no lease dates.
The next connect claims them oldest first and screens them then (lease, then IPQS). The hourly
heal job stamps `lease_expires_at` and `auto_extend` from IPRoyal.

Limits to know: the script reads only the first page of 100 orders, and it imports every confirmed
order's IPs (it does not check expiry; an expired one is retired at claim time or by the heal
job). If the heal job is on, it also imports any active order that has no row on its own
(section 6.7, pass A), so a manual import is optional there.

### 3.5 Fraud-check any IP (uses IPQS quota, no spend)

```
py scripts/ipqs_check.py <ip> [<ip> ...] [--strictness N]
```

Prints `fraud_score`, `proxy`, `vpn`, `tor`, `active_vpn`, `recent_abuse`, `bot_status`, `ISP`,
`connection_type`, `country_code`, `message`, `success` for each IP. This script defaults to
`strictness=1`. The server screens with `strictness=0`. Pass `--strictness 0` to see the number
the server will act on.

### 3.6 Yield report (read-only SQL)

```
py scripts/proxy_yield.py [--threshold 75]
```

Reads `evolution_proxies` through the Supabase Management API and prints, per provider: buys,
screened, clean, dirty, unscreened, average / min / max score, clean rate, `$/IP mo` and
`$/usable` (price divided by clean rate), then average score by /16 netblock (dirty ranges float
to the top). Prices come from the editable `PRICE_PER_IP_MONTH` map at the top of the file, not
from invoices: set them to your real numbers. This is why dirty buys are kept as `dead` rows
instead of deleted: the clean rate stays honest.

---

## 4. Buying by API (IPRoyal): exact calls

Source: `server/whatsapp/evolution/iproyalClient.ts`. This is the only module that talks to
IPRoyal.

- Base URL: `https://apid.iproyal.com/v1/reseller`
- Headers on every call: `X-Access-Token: <token>`, `Accept: application/json`, plus
  `Content-Type: application/json` when there is a body.
- Timeout: 30 seconds per call (abort).
- Responses are sometimes wrapped in `{ "data": ... }` and sometimes flat. The client unwraps
  `body.data` when it is present and non-null, else uses the body as is. Do the same everywhere.
- A non-2xx response is reported as `JSON.stringify(body.error)` when the body has an `error`
  key, else `IPRoyal <status>`.

### 4.1 Catalog: products, plans, prices, locations

```
GET /products
```

There is no separate price endpoint in the reference implementation: prices are the `price` on
each plan. Fields the scripts read (everything else is ignored):

```json
{
  "data": [
    {
      "id": 9,
      "name": "<product name>",
      "plans": [ { "id": 22, "name": "<plan name>", "price": 4 } ],
      "locations": [
        {
          "id": 16,
          "name": "United States",
          "out_of_stock": false,
          "child_locations": [ { "id": 0, "name": "<city>", "out_of_stock": false } ]
        }
      ]
    }
  ]
}
```

The server never calls `/products`. It buys with the configured product, plan and location ids.

### 4.2 Balance and cards

```
GET /balance
GET /cards
```

The server reads only `/cards`, and only when `IPROYAL_CARD_ID=auto`: it takes `id` of the first
card (`data[0].id` or `[0].id`) and caches it for the life of the process. The `/balance` response
is printed by `iproyal_account.py` and never parsed by the code, so its exact shape is not covered
by the reference implementation.

### 4.3 Place an order (spends money)

```
POST /orders
```

```json
{
  "product_id": 9,
  "product_plan_id": 22,
  "product_location_id": 16,
  "quantity": 1,
  "card_id": 0
}
```

`card_id` is sent only when a card is resolved from `IPROYAL_CARD_ID`. Without it IPRoyal charges
the balance. That is the whole body: the reference implementation sends NO order questions
(`product_question_answers`), no `auto_extend`, and no fraud-score fields. How to answer order
questions through the API is not covered by the reference implementation.

Response: the client reads only the order id. It accepts the order nested under `data`, flat, or
as the first element of an array, and requires `id` to be a JSON number:

```json
{ "data": { "id": 0, "status": "<status>" } }
```

The proxy is not attached yet. Poll the order.

### 4.4 Order detail: status and proxy credentials

```
GET /orders/<order-id>?product_id=9
```

```json
{
  "data": {
    "id": 0,
    "status": "confirmed",
    "expire_date": "2026-01-31 08:15:16",
    "auto_extend_settings": { "is_enabled": false },
    "proxy_data": {
      "ports": { "http|https": 0 },
      "proxies": [ { "ip": "203.0.113.10", "username": "<username>", "password": "<password>" } ]
    }
  }
}
```

How the client reads it:

- **Provisioned** means `status === "confirmed"` AND at least one proxy with `ip`, `username` and
  `password` AND a numeric port. Anything else is "pending": poll again.
- **Port**: `proxy_data.ports["http|https"]`, else `ports.http`, else `ports.https`.
- **Proxy URL** built by the pool: `http://<username>:<password>@<ip>:<port>`.
- **Expiry**: `expire_date`, else `expires_at`. Format `YYYY-MM-DD HH:MM:SS`; the code replaces
  the space with `T` and parses it.
- **Expired** is true only when proven: the expiry is in the past, or `status` (lowercased) is
  one of `expired`, `cancelled`, `canceled`, `refunded`, `terminated`. An unreadable or missing
  date is NOT expired. The comment gives the reason: never spend money on doubt.
- **Auto-renew**: `auto_extend_settings.is_enabled` when it is a boolean, else unknown (null).

Poll schedule after a buy (`proxyPool.buyAndProvisionOne`): wait 3, 5, 5, 8, 8 seconds, checking
after each. If nothing is provisioned after those five tries the buy is treated as an error, a
real (non-silent) alert fires because money was spent, and the heal job's orphan import picks the
order up later. The code never re-buys for that order.

The same endpoint backs three client functions: `iproyalGetOrderProxies` (credentials after a
buy), `iproyalGetOrderStatus` (claim-time lease check) and `iproyalGetOrderSummary` (read-back
after an auto-renew switch).

### 4.5 List all orders

```
GET /orders?product_id=9&page=<n>&per_page=50
```

Returns an array (wrapped or flat) of orders in the same shape as 4.4, including full
`proxy_data` with credentials. The client pages from 1, stops at the first page with fewer than
50 items, and never reads more than 20 pages. One sweep therefore gives lease status, auto-renew
state and proxy URLs for every order with no per-order call. That is what the heal job runs on.

### 4.6 Auto-renew on or off (no charge by itself)

```
POST /orders/toggle-auto-extend
```

Turning it on:

```json
{ "order_id": 0, "product_plan_id": 22, "is_enabled": true, "payment_type": "card", "card_id": 0 }
```

or, with no card configured:

```json
{ "order_id": 0, "product_plan_id": 22, "is_enabled": true, "payment_type": "balance" }
```

Turning it off:

```json
{ "order_id": 0, "product_plan_id": 22, "is_enabled": false }
```

`order_id` is sent as a number. `payment_type` is required only when enabling. Toggling never
charges; the charge is the renewal itself, which only fires while enabled (a 30-day order extends
by 30 days). The switch is per ORDER: it covers every IP in a multi-IP order.

After every toggle the pool reads the order back (4.4) and stores IPRoyal's real
`auto_extend_settings.is_enabled` and expiry on every pool row of that order, because the toggle
can fail and humans read the stored copy.

### 4.7 Manual extend (spends money)

```
POST /orders/<order-id>/extend
```

```json
{ "product_plan_id": 22, "proxies": [], "card_id": 0 }
```

`proxies` empty extends every IP in the order; listing specific IPs extends only those. `card_id`
only when a card is configured. Used by the heal job to recover an expired lease while keeping
the same IP, which keeps the WhatsApp pairing on it. The response body is not parsed (only
success or failure is used).

---

## 5. The pool table

One row per IP. Table `public.evolution_proxies`, created by
`sql/20260831_120000_evolution_proxies_pool.sql`, extended by
`sql/20260908_130000_evolution_proxies_fraud_score.sql` and
`sql/20260917_000000_evolution_proxies_lease_expiry_autoextend.sql`.

`proxy_url` contains the proxy password. The table is service-role only: row level security is
on with NO policies, the default grants to `anon` and `authenticated` are revoked, and only
`service_role` has access. No client can ever read it. Keep it that way.

| Column | Type | Meaning | Example |
|---|---|---|---|
| `id` | bigint identity, primary key | Row id | `12` |
| `proxy_url` | text, not null | Full URL with credentials. `http://user:pass@host:port` (or `socks5://`) | `http://<username>:<password>@203.0.113.10:<port>` |
| `label` | text | Human note. Auto-buy writes `<provider> ISP <ip> (auto)`; import writes `IPRoyal ISP <ip>` | `iproyal ISP 203.0.113.10 (auto)` |
| `status` | text, not null, default `available` | `available` (free to claim), `assigned` (bound to a number), `dead` (retired; never claimed) | `assigned` |
| `assigned_channel_id` | bigint, FK to `whatsapp_channels(id)` `ON DELETE SET NULL` | The number using it. Unique where not null: one proxy per number | `481` |
| `health` | text, null or `ok` or `failing` | Enum only. `ok` = last screen was clean, `failing` = dirty or rejected by Evolution, null = unscreened or the lookup failed | `ok` |
| `provider` | text | `iproyal`, `brightdata`, `manual`, or null. Drives release and heal behavior | `iproyal` |
| `provider_order_id` | text | IPRoyal: the order id. Bright Data: the ZONE NAME (delete the zone to stop billing) | `<order-id>` |
| `last_checked_at` | timestamptz | Last screen or lease check | `2026-01-01T08:00:00Z` |
| `assigned_at` | timestamptz | When it was bound to the number | `2026-01-01T08:00:00Z` |
| `notes` | text | Free text: the IPQS summary line and the reason for the last state change | `ipqs:0 @ 2026-01-01T08:00:00.000Z` |
| `created_at` | timestamptz, default now | Claim order is oldest first by this column | |
| `updated_at` | timestamptz, default now | Set by every write | |
| `fraud_score` | integer (added later) | Last IPQS `fraud_score`, 0 to 100. Null = unscreened. Written at every screen point | `0` |
| `lease_expires_at` | timestamptz (added later) | IPRoyal lease end. Null for Bright Data (no fixed lease) or unknown | `2026-01-31T08:15:16Z` |
| `auto_extend` | boolean (added later) | IPRoyal auto-renew as IPRoyal reports it. Null = unknown or not applicable | `true` |

Indexes: `idx_evolution_proxies_status` on `(status)`;
unique `uniq_evolution_proxies_assigned_channel` on `(assigned_channel_id)` where it is not null.

A labeled example row (an auto-bought IPRoyal IP serving a connected number):

```
id                   12
proxy_url            http://<username>:<password>@203.0.113.10:<port>
label                iproyal ISP 203.0.113.10 (auto)
status               assigned
assigned_channel_id  481
health               ok
provider             iproyal
provider_order_id    <order-id>
fraud_score          0
last_checked_at      2026-01-01T08:00:00Z
assigned_at          2026-01-01T08:00:00Z
lease_expires_at     2026-01-31T08:15:16Z
auto_extend          true
notes                ipqs:0 @ 2026-01-01T08:00:00.000Z
```

Related columns on `whatsapp_channels` that the pool code reads: `evolution_instance_name`,
`channel_token` (the per-instance Evolution token), `connection_state`, `lifecycle_state`,
`provider`. It writes `evolution_proxy_url` once, at connect.

Status changes and what `notes` says when they happen:

| From, to | When | `notes` text |
|---|---|---|
| available to assigned | Claimed for a number | unchanged |
| assigned to available | Number deleted, create failed, or orphan sweep (IPRoyal and manual rows) | unchanged |
| assigned to dead | Bright Data row released | `released: BD zone deleted (stops billing)` |
| assigned to dead | Swapped out by the heal job | `retired by auto-heal swap` |
| claimed to dead | Reused IP's lease had expired | `claim-time: IPRoyal lease expired (<status>)` |
| claimed to dead | Reused IP screened dirty | `claim-time screen retired dirty (reused): <summary>` |
| available to dead | Evolution rejected it after the retries | `create: Evolution rejected it (Invalid proxy) after hold retries` |
| available to dead | Heal job found the lease expired | `cron: available lease expired, retired` |
| inserted as dead | Auto-buy screened dirty | `auto-buy screen rejected: <summary>` (Bright Data: `... + zone deleted: ...`) |
| dead to available | Heal job: lease active, routes, clean | `cron: revived (lease active + routable + clean): <summary>` |
| inserted as available | Heal job imported a paid order with no row | `cron: recovered orphaned paid order (no DB row existed)` |
| inserted as available | Bought, clean, but not routing yet | `... not routable within warm-up window (parked to warm)` |

---

## 6. The lifecycle in code

Source: `server/whatsapp/evolution/proxyPool.ts` unless noted.

### 6.1 Claim a proxy for a new number

`claimProxyForChannel(channelDbId)` returns `{ id, proxyUrl }` or null.

1. Select up to 5 rows with `status = 'available'` and `assigned_channel_id IS NULL`, oldest
   `created_at` first.
2. For each candidate, run a conditional update: set `status = 'assigned'`,
   `assigned_channel_id`, `assigned_at`, where `id = ?` AND `status = 'available'` AND
   `assigned_channel_id IS NULL`. Postgres takes a row lock, so two simultaneous claims on the
   same row have exactly one winner. The loser updates 0 rows and moves to the next candidate. No
   explicit lock is needed.
3. Screen the row it won (`screenClaimedProxy`), in this order:
   - **Lease first** (IPRoyal rows with an order id): `GET /orders/<id>?product_id=<product>`.
     If the order is proven expired, set the row `dead`, unbind it, and try the next candidate.
     The reason for the order: IPRoyal's status call has no tight limit, IPQS has a monthly quota,
     so never spend an IPQS lookup on a lapsed lease. An unreadable status falls through (fail
     open).
   - Bright Data rows skip the fraud screen here: their `proxy_url` host is the shared gateway,
     not the egress IP, and they are never parked `available` anyway.
   - **Fraud second**: IPQS on the hostname of `proxy_url`. Dirty: set `dead`, `health =
     'failing'`, store the score, unbind, try the next candidate. Clean: stamp `health = 'ok'`,
     the score and `last_checked_at`. Lookup failed: keep the proxy, `health` null, silent alert.
   - **No routability probe at claim time, on purpose.** See landmine 1.
4. Up to 10 rounds of that. When no `available` row is left, fall to auto-buy (6.6).

### 6.2 Apply it to the Evolution instance (order relative to pairing)

Source: `createEvolutionChannel` in `server/routes/evolution/provision.ts` and `evoCreateInstance`
in `server/whatsapp/evolution/evolutionClient.ts`. The order is:

1. Insert the `whatsapp_channels` row (so there is an id to bind the proxy to).
2. If `EVOLUTION_PROXY_MODE` is `required`: claim. No proxy: delete the row, raise a critical
   alert, answer HTTP 503 `{ "success": false, "error": "...", "code": "no_proxy_capacity" }`.
3. Write the claimed URL to `whatsapp_channels.evolution_proxy_url`.
4. Create the Evolution instance WITH the proxy in the same call. The QR (or pairing code) comes
   back from this call, so the proxy is in place before the first byte goes to WhatsApp. A number
   is never paired on the host IP and proxied afterwards.

```
POST <EVOLUTION_API_URL>/instance/create
headers: apikey: <global Evolution API key>, content-type: application/json, accept: application/json
```

```json
{
  "instanceName": "<instance-name>",
  "qrcode": true,
  "integration": "WHATSAPP-BAILEYS",
  "webhook": { "...": "the webhook config, see the main skill" },
  "proxyHost": "203.0.113.10",
  "proxyPort": "<port>",
  "proxyProtocol": "http",
  "proxyUsername": "<username>",
  "proxyPassword": "<password>"
}
```

The proxy fields are TOP-LEVEL. A nested `{ "proxy": { "url": "..." } }` is silently ignored by
Evolution v2's instance-create DTO: the instance then egresses on the host IP while you believe it
is proxied. (Verified against the InstanceDto source; the source system ran v2.3.7.) `proxyPort`
is sent as a string. The fields come from `parseProxyUrl`, which splits the stored URL and
URL-decodes the username and password; with no port in the URL it defaults to 443 for `https`,
1080 for `socks*`, else 80.

5. If the create fails: release the proxy back to the pool, and if the failure was
   "Invalid proxy" after the hold retries (below), mark that row `dead` with `health = 'failing'`
   so the next connect does not claim it and fail the same way. Then delete the channel row and
   answer 502.

**The hold retry.** Evolution tests the proxy itself during instance-create and during set-proxy,
and reports a refusal as an error whose text contains `Invalid proxy`. IPRoyal lets one source
address use a proxy at a time: for about 15 seconds after any request through it, every other
address gets a bare 403. So if anything else touched the proxy moments earlier (the post-buy
routability probe, the heal job, a manual test), Evolution rejects a perfectly good proxy. The
client therefore retries a call that failed with `Invalid proxy` after 8 seconds and again after
12 seconds (`EVO_PROXY_HOLD_RETRY_DELAYS_MS = [8_000, 12_000]`). Evolution's own test already
retries for about 4.5 seconds, so the total carries past the hold. A proxy still rejected after
that is genuinely bad. A create rejected for an invalid proxy leaves nothing behind on Evolution,
so retrying under the same instance name is safe.

### 6.3 Change the proxy on an existing instance

```
POST <EVOLUTION_API_URL>/proxy/set/<instance-name>
headers: apikey: <per-instance token if known, else the global key>
```

```json
{ "enabled": true, "host": "203.0.113.11", "port": "<port>", "protocol": "http", "username": "<username>", "password": "<password>" }
```

To switch the proxy off: `{ "enabled": false }`.

These names (`host`, `port`, `protocol`, `username`, `password`) are DIFFERENT from the
instance-create names (`proxyHost`, ...). Verified against the deployed rig: the `proxyHost*`
names on this endpoint return 400 ("instance requires property host, port, protocol"); the
`host*` names return 201. One line in `deploy/PROXY_PER_CHANNEL_PLAN.md` still says the opposite;
the code is right.

A change only takes effect after the socket reconnects, so always follow it with:

```
POST <EVOLUTION_API_URL>/instance/restart/<instance-name>
```

The restart reconnects on the stored credentials. No new QR.

### 6.4 Release

`releaseProxyForChannel(channelDbId)` / `releaseProxiesForChannels([...])`. Idempotent.

Called when: the number is deleted (`deleteEvolutionChannel`), the instance vanished from
Evolution out of band (the reconcile block at connect), the instance create failed, and the heal
job's orphan sweep. NOT called on logout: a logout keeps the channel row, and a reconnect reuses
the same instance and proxy, so the number keeps the same egress IP.

What it does depends on the provider:

- **IPRoyal** (and manual or unknown providers): row goes back to `available`, unbound. The IP
  keeps its remaining paid lease and is reused by the next connect. Then the order's auto-renew
  is re-decided by the package rule (6.5) and read back from IPRoyal.
- **Bright Data**: the zone is deleted (`DELETE /zone`), because Bright Data bills prorated until
  the zone is deleted. The row becomes `dead` (that IP no longer exists and cannot be reused).

### 6.5 Renewal follows real connection state

IPRoyal leases are 30 days. Letting one lapse forces a new IP and risks the number. So renewal is
kept ON only while the IP is serving a connected number, and OFF otherwise. There is no config
switch for this: it is driven by events.

- The Evolution connection webhook handler (`server/routes/evolution/inbound.ts`) calls
  `setProxyAutoExtendForChannel(channelId, true)` when the canonical state becomes `connected`,
  and `(channelId, false)` on `needs_qr`, `disconnected` or `banned`. Fire and forget: toggling
  never charges and must not block the webhook.
- A never-paired IP never reaches `connected`, so renewal never turns on for it.

The decision is made per ORDER, not per IP (`orderRenewalFromStates`), because IPRoyal has one
auto-renew switch per order:

| States of the numbers on the order's assigned IPs | Result |
|---|---|
| Any one is `connected` | ON |
| None connected, and every one is `disconnected`, `needs_qr`, `banned` or `released` | OFF |
| None connected, and at least one is anything else (`reconnecting`, `unknown`, null) | Leave the switch as it is |
| No assigned IP at all | OFF |

A row still assigned to a deleted or missing channel counts as `released`.

Every change goes through `reconcileIproyalOrderRenewal(orderId)`: decide, call
toggle-auto-extend (4.6) with `IPROYAL_PLAN_ID`, then ALWAYS read the order back and write
IPRoyal's real `auto_extend` and `lease_expires_at` onto every `available` or `assigned` row of
that order. It never throws; a failed toggle or read-back raises a silent alert.

### 6.6 Auto-buy when the pool is empty

`acquireNewProxy(channelDbId)`, reached only from the claim when no `available` row exists.
Returns null unless `EVOLUTION_PROXY_AUTOBUY` is `on`.

Guard rails, in the order the code applies them:

1. **Provider configured.** Start on `EVOLUTION_PROXY_PROVIDER` (default `iproyal`). If it is
   not configured, use the other. Neither configured: alert (`evolution_proxy_no_provider`),
   return null.
2. **In-process lock.** Buys are serialized inside the process so two connects that both find
   the pool empty cannot both order. Across several server instances the lock does not apply; the
   pool cap is what bounds spend there.
3. **Re-check inside the lock.** If a proxy became `available` while waiting, return null without
   buying.
4. **Dirty-buy breaker, per provider.** In-memory counters of dirty buys in a row, kept for the
   life of the process. IPRoyal at its limit (default 1) switches to Bright Data if configured.
   Bright Data at its limit (default 20), or IPRoyal with no Bright Data, stops auto-buy and sends
   one critical alert. A clean buy resets that provider's counter. A tripped breaker re-arms
   after `EVOLUTION_PROXY_DIRTY_BREAKER_RESET_MINUTES` (default 120) since that provider's last
   dirty buy. Why the limits differ: a dirty IPRoyal buy wastes a full lease (about $4); a dirty
   Bright Data buy deleted on the spot costs cents through proration.
5. **Pool cap.** Count rows with `status <> 'dead'`. At or above `EVOLUTION_PROXY_MAX_POOL`
   (default 10): critical alert, return null.
6. **Buy** (`buyAndProvisionOne`): IPRoyal `POST /orders` then poll (4.3, 4.4), or Bright Data
   zone create (section 8). Any failure is an ERROR: switch to the other provider, at most
   `EVOLUTION_PROXY_MAX_ERROR_SWITCHES` (default 2) times per acquisition, then critical alert.
7. **Screen** the egress IP with IPQS (skipped when no key). Dirty: insert a `dead` audit row
   (Bright Data: delete the zone first), count it, loop back to step 4.
8. **Routability.** Send `GET http://api.ipify.org` through the proxy (8 second timeout, 2xx =
   routable), at 0, then after waits of 3, 5, 6, 8, 8 seconds. A freshly bought IPRoyal IP is not
   auth-ready the instant it is provisioned, and Evolution's create-time test returns 407 for an
   unready one. Not routable in that window: an IPRoyal IP is inserted as `available` to warm up
   and this connect fails once (a retry reuses it); a Bright Data zone is deleted, recorded
   `dead`, and counted as an error switch.
9. **Insert** the row already `assigned` to this number, with provider, order id (or zone name),
   score, and for IPRoyal a first `lease_expires_at` of now plus 1 day when `IPROYAL_PLAN_ID` is
   23, else now plus 30 days. The heal job overwrites it with IPRoyal's exact date. If the insert
   fails after a paid buy: critical alert; a Bright Data zone is deleted, an IPRoyal order is
   recovered by the heal job's orphan import.

A final hard cap on loop iterations (both dirty limits plus the error-switch limit plus 4)
guarantees the loop ends even with a bad configuration.

### 6.7 The hourly heal job

Source: `server/jobs/evolutionProxyHeal.ts`, `runEvolutionProxyHealJob()`. Does nothing unless
`EVOLUTION_PROXY_AUTOHEAL` is `on`. The build log says it runs hourly at minute 22; the cron
registration itself is not bundled, so schedule the function yourself.

It starts with ONE order sweep (4.5). If that fails, the run is skipped with an alert. The signal
for everything is the ORDER STATUS, never downtime: a network blip does not expire an order, so
there is no "down for N minutes" timer to get wrong. Passes A to D look only at rows with
`provider = 'iproyal'`.

| Pass | What it does | Cap per run |
|---|---|---|
| A. Orphan import | An order that is not expired, has a port and proxies, and whose order id and IP are in no row (any status): insert each IP as `available`. Recovers a paid buy whose insert was lost | 10 |
| 1. Available cleanup | An `available` row whose order is expired becomes `dead`. Idle leases are meant to lapse; this keeps a connect from claiming a dead one | none |
| B. Revive | A `dead` row whose order is active AND that routes (the same ipify probe) AND is not IPQS-dirty goes back to `available`. Undoes a row marked dead wrongly or temporarily. Only the 100 most recently updated dead rows are scanned | 10 |
| 0. Heal assigned and expired | Only for numbers whose `connection_state` is `connected`. Try `POST /orders/<id>/extend` then restart the instance (same IP, no QR). If that does not fully succeed, `swapProxyForChannel` (6.8). Stops at the first failed heal | 2 fixes |
| C. Reconcile auto-renew | Per order, apply the package rule (6.5) and toggle only on a real mismatch with what the sweep reported. Includes orders with no assigned IP at all (they must not renew) | 20 toggles |
| D. Stamp lease info | Write `lease_expires_at` and `auto_extend` from the sweep onto live rows, only when a value changed | none |
| E. Orphan-proxy sweep | Any row (both providers) still `assigned` to a channel that is deleted or missing is released (6.4) | none |

Spend rules inside pass 0:

- A disconnected or logged-out number is deliberately left to lapse. Renewal was turned off when
  it disconnected; healing it would pay for an IP nobody uses.
- **Mass-expiry guard.** If more than 3 in-use leases are expired at once, or more than half of
  the connected numbers' leases, that is a payment or card failure, not bad luck. The job sends a
  critical alert ("fix the card") and renews or swaps nothing.

Pass C detail for a number stuck mid-reconnect: a state that is not `connected`, `disconnected`,
`needs_qr` or `banned` is normally undecided, so a brief blip never turns renewal off. To stop a
stuck number from renewing forever, the job asks Evolution once per run
(`GET /instance/fetchInstances`) and maps `connectionStatus`: `open` = connected, `close` =
disconnected, `connecting` with `disconnectionAt` more than 24 hours ago = disconnected. Evolution
unreachable: stays undecided.

### 6.8 Replace a bad IP without a new QR scan

`swapProxyForChannel(channelDbId)` returns `{ ok, reason? }`.

1. Read the number's `evolution_instance_name` and `channel_token`.
2. Retire the current row(s): `status = 'dead'`, unbound, note `retired by auto-heal swap`.
   Bright Data: delete the zone. IPRoyal: re-decide the order's renewal. Retiring first is what
   frees the unique `assigned_channel_id` slot.
3. `claimProxyForChannel` (reuse first, else auto-buy, with every screen and breaker).
4. `evoSetProxy` (6.3), then `evoRestartInstance`. Either failing raises a critical alert and
   returns `ok: false`.
5. Renewal turns itself on for the new IP when the webhook reports `connected`.

Proven live: a paired number was moved onto a new IP with set-proxy plus restart and no QR.

The only caller in the reference implementation is the heal job. There is no bundled admin route
for a manual swap or for retiring an IP. To replace an IP by hand (for example one you believe is
flagged), call `swapProxyForChannel` from a one-off script or your own admin route.

---

## 7. Fraud screening (IPQS)

Source: `server/whatsapp/evolution/ipqsClient.ts`.

```
GET https://ipqualityscore.com/api/json/ip/<IPQS_API_KEY>/<ip>?strictness=0&allow_public_access_points=true
headers: Accept: application/json
```

The key is in the path (URL-encoded), so never log this URL. Timeout: 15 seconds.

- `strictness=0` matches the IPQS web dashboard and gives a stable reading.
- `allow_public_access_points=true` reduces false positives on shared connections.

Fields read from the response:

```json
{
  "success": true,
  "message": "<text>",
  "fraud_score": 0,
  "proxy": false,
  "vpn": false,
  "tor": false,
  "recent_abuse": false,
  "bot_status": false,
  "ISP": "<isp name>"
}
```

A lookup counts as FAILED when the HTTP status is not 2xx, the body is not JSON, or `success` is
`false` (the error text is `message`).

The verdict (`isIpDirty(result, threshold)`):

- A failed lookup is NEVER dirty. Screening fails open, so a flaky outside API can never become a
  "kill this proxy" writer, and never blocks a customer's connect.
- Dirty when `fraud_score >= threshold` (default 75).
- Also dirty when `proxy` AND `recent_abuse` are both true, even if the number dipped: that
  catches a recycled, abused IP.

Where it runs and what a dirty result does:

| Point | Dirty result |
|---|---|
| Buy time (auto-buy) | Row inserted `dead` for the audit trail, the provider's dirty counter goes up, another IP is bought (subject to the breaker). Bright Data: the zone is deleted too |
| Claim time (reusing a pooled IP) | Row set `dead`, `health = 'failing'`, unbound; the claim moves to the next candidate or to auto-buy |
| Heal job revive pass | The dead row stays dead |

It does NOT run on a timer. The reason in the code: these are dedicated IPs only you use, so an IP
that was clean at purchase stays clean while you hold it. The one moment cleanliness can change is
when a released IP is handed to a new number (the previous holder may have got it flagged), so
that is where the re-screen is. An in-use IP that goes dirty is not policed.

What gets stored: `fraud_score` (number), `health` (`ok`, `failing` or null) and a one-line
summary in `notes` such as `ipqs:0 @ <timestamp>` or `ipqs:94 proxy recent_abuse @ <timestamp>`,
or `ipqs:unchecked (<error>) @ <timestamp>` for a failed lookup.

Why IPQS and not ip-api: ip-api only knows an IP's type and proved unreliable for this job. It
called a fraud-94 recycled IP clean and a clean fresh IP a proxy, exactly backwards.

Always screen the EGRESS IP. For IPRoyal that is the host in `proxy_url`. For Bright Data it is
the IP returned at buy time, never the gateway host.

---

## 8. The second provider (Bright Data)

Source: `server/whatsapp/evolution/brightdataClient.ts`.

**When it is used.** Only inside auto-buy, when both `BRIGHTDATA_API_TOKEN` and
`BRIGHTDATA_CUSTOMER_ID` are set: after one dirty IPRoyal buy (default), after an IPRoyal buy
error (API down, no stock, nothing provisioned in time), or first if
`EVOLUTION_PROXY_PROVIDER=brightdata`. A dirty Bright Data buy never switches back to IPRoyal; it
stays on Bright Data and retries up to its limit.

**The model is different from IPRoyal.** Each IP is its own zone, created with one IP. There is no
lease and no auto-renew: Bright Data bills prorated until the zone is deleted. So a released,
dirty or non-routable Bright Data IP is always deleted, never parked `available`. The connection
host is a shared gateway, not the IP.

- Base URL: `https://api.brightdata.com`
- Headers: `Authorization: Bearer <token>`, `Accept: application/json`, and
  `Content-Type: application/json` with a body. Timeout 30 seconds.

**Buy one IP.**

```
POST /zone
```

```json
{
  "zone": { "name": "<zone-name>", "type": "ISP" },
  "plan": {
    "type": "static",
    "pool_ip_type": "static_res",
    "ips_type": "dedicated",
    "bandwidth": "unlimited",
    "unl_bw_tiers": "std",
    "country": "us",
    "ips": 1
  }
}
```

- `pool_ip_type: "static_res"` is required. Without it Bright Data silently makes a Datacenter
  zone.
- `ips: 1` at creation makes the IP allocate immediately. Creating an empty zone and adding an IP
  afterwards (`POST /zone/ips`) gets queued.
- The zone name is new for every buy: `bp` + the time in base 36 + 5 random base-36 characters
  (lowercase letters and digits).
- The password is read from the response at `zone.password`, which may be a string or an array
  (first element). No password: delete the zone and fail.

**Read the egress IP.**

```
GET /zone/ips?zone=<zone-name>
```

Response read as `{ "ips": [ { "ip": "203.0.113.20" } ] }`. Polled after waits of 1, 2, 3, 4
seconds. No IP in that time: delete the zone and fail.

**The proxy URL** stored in the pool and given to Evolution:

```
http://brd-customer-<CUSTOMER_ID>-zone-<zone-name>:<zone-password>@<gateway-host>:<gateway-port>
```

**Release.**

```
DELETE /zone
```

```json
{ "zone": "<zone-name>" }
```

A 404 is treated as success (already gone).

**Balance** (used by the admin sync endpoint): `GET /customer/balance`, read as
`{ "balance": <number>, "pending_balance": <number> }`, with a short 8 second timeout because the
endpoint is slow.

**Account-specific parts to read from your own dashboard:**

- The customer id (`brd-customer-<ID>`).
- The gateway port. Bright Data assigns it per account; read it from the zone's access details
  (the curl example there). `scripts/brightdata_testbuy.py` has the source account's port as the
  `GATEWAY_PORT` constant near the top: change it to yours before using the script's route test.
- Auto-recharge and the balance buffer (billing page). The script header says auto-recharge needs
  a plan with a minimum monthly commitment; the build log and go-live checklist say Bright Data
  support later confirmed it works on pay-as-you-go. Confirm in your own dashboard.

**Not built:** a low-balance monitor. An empty balance makes buys fail, and that is the one
unattended failure mode of this provider.

**Scripts** (`BRIGHTDATA_API_TOKEN` always; others as noted):

```
py scripts/brightdata_discover.py
```

Read-only. Prints `GET /zone/get_active_zones` (secrets redacted) and
`GET /count_available_ips?plan=<url-encoded JSON>` for
`{"type":"static","pool_ip_type":"static_res","ips_type":"dedicated","country":"us"}`.

```
py scripts/brightdata_testbuy.py --balance
py scripts/brightdata_testbuy.py --create-zone --zone <name> --ips 1      # buys: same shape as the server
py scripts/brightdata_testbuy.py --delete-zone --zone <name>              # stops billing
py scripts/brightdata_testbuy.py --ipqs <ip>                              # IPQS only, no BD call
py scripts/brightdata_testbuy.py --route <ip> --zone <name>               # route test only
```

`--create-zone` needs a zone name (`--zone <name>` or `BRIGHTDATA_ZONE`). Options: `--country <cc>`
(default `us`), `--shared` (shared instead of dedicated), `--ips N` (omit to create an empty
zone), `--no-ipqs`. With `--ips` it prints the `POST /zone` result, then `DEDICATED IP: <ip>`, the
IPQS fields and verdict (clean below 75), a routability line, and the exact `--delete-zone`
command to run when done. The route test needs `BRIGHTDATA_CUSTOMER_ID`; it fetches the zone
password with `GET /zone/passwords?zone=<name>` (or uses `BRIGHTDATA_ZONE_PASSWORD`), connects
with user `brd-customer-<ID>-zone-<zone>-ip-<ip>` through the gateway and reads
`https://geo.brdtest.com/mygeo.json`, printing a `routes OK via ...` line ending in `MATCH` when the egress IP
equals the bought IP.

The script also has an older flow (`--confirm-buy`, `--release <ip>`, `--city`) that adds an IP to
an EXISTING zone with `POST /zone/ips` body `{ "customer", "zone", "count": 1, "country",
"country_city"? }` and removes it with `DELETE /zone/ips` body `{ "zone", "ips": ["<ip>"] }`. It
prints the balance before and after so the difference is the exact price. The server does not use
that flow (it queued); prefer `--create-zone --ips 1`.

There is no import script for Bright Data. A Bright Data IP enters the pool only through auto-buy.

---

## 9. Admin endpoints

Source: `server/routes/evolution/admin.ts`. Mounted at `/api/whapi/admin/evolution` behind the
super-admin middleware. Reads the service-role tables through the admin client.

- `GET /proxies`: every pool row, newest first, plus yield stats. The proxy password is masked
  (`http://<username>:***@<host>:<port>`). Response:

```json
{
  "proxies": [
    {
      "id": 12, "provider": "iproyal", "status": "assigned", "health": "ok", "fraud_score": 0,
      "proxy": "http://<username>:***@203.0.113.10:<port>", "label": "...", "notes": "...",
      "provider_order_id": "<order-id>", "assigned_channel_id": 481,
      "company_id": "<id>", "company_name": "<name>", "channel_name": "<name>",
      "last_checked_at": "...", "assigned_at": "...", "lease_expires_at": "...",
      "auto_extend": true, "created_at": "...", "updated_at": "..."
    }
  ],
  "stats": [
    { "provider": "iproyal", "total": 0, "screened": 0, "clean": 0, "dirty": 0, "unscreened": 0,
      "available": 0, "assigned": 0, "dead": 0, "clean_rate": null }
  ],
  "threshold": 75
}
```

- `POST /proxies/sync`: pulls fresh lease expiry and auto-renew from IPRoyal (one order sweep) and
  stamps the rows, plus the Bright Data balance when configured. It never buys, renews, swaps or
  retires, and it works even with `EVOLUTION_PROXY_AUTOHEAL` off. Response:
  `{ "ok": true, "stamped": <n>, "orders": <n>, "brightdata_balance": <number or null> }`, or
  HTTP 502 `{ "error": "...", "brightdata_balance": ... }` when the IPRoyal sweep fails.

The same file also holds the per-company provider override routes (`/companies...`), which are
not about the pool.

Not in the reference implementation: routes to add a proxy by hand, retire one, or trigger a
swap. Those are done with SQL (section 3.4) or by calling the pool functions.

---

## 10. Verifying a number really goes out through its proxy

Do NOT test by sending your own request through the proxy from a laptop or another server. With
IPRoyal's one-source-at-a-time rule that locks the real consumer out for about 15 seconds, and it
proves nothing about what Evolution does.

1. **Database.** `evolution_proxies` has a row with `status = 'assigned'` and
   `assigned_channel_id` = the number's channel id (or `GET /proxies` shows it against the right
   company). This row is the source of truth for which IP a number holds.
2. **Provider traffic view.** This is how the source system proved it: the IPRoyal dashboard's
   DATA USAGE for that IP showed traffic to `web.whatsapp.com` starting the moment the number
   connected. Traffic on the IP = WhatsApp is egressing through it and not through the host IP.
3. **Evolution accepted it.** Instance-create or set-proxy succeeded. Evolution runs its own
   proxy test on both and fails the call with `Invalid proxy` otherwise, so a 2xx means Evolution,
   from its own address, routed through the proxy.
4. **Connection.** The instance reaches `open` (`GET /instance/connectionState/<instance>`) and
   the channel's `connection_state` becomes `connected`.
5. **Bright Data only.** `py scripts/brightdata_testbuy.py --route <ip> --zone <zone>` prints
   `MATCH` when the egress IP equals the zone's IP. Do this before the number is using it.

Reading the proxy back from Evolution (a "find proxy" call) is not covered by the reference
implementation. The companion skill adds one more check worth building: log which proxy each
Baileys socket was opened with, because a socket that silently fell back to the host IP looks
healthy until the number is flagged.

---

## 11. Landmines

Each one cost something real.

1. **Probing a proxy from your backend right before Evolution uses it.** IPRoyal allows one source
   address per IP; any other address gets a bare 403 for about 15 seconds. A routability probe at
   claim time made Evolution's own test fail with "Invalid proxy" on EVERY connect that reused a
   pool IP. Fix in code: no probe at claim time; the only probe is right after a fresh buy; and
   instance-create and set-proxy retry `Invalid proxy` after 8 and 12 seconds.
2. **Proxy passed in the wrong shape at instance-create.** `{ proxy: { url } }` is ignored
   silently. The number pairs on the host IP while the database says it is proxied. Use the
   top-level `proxyHost` / `proxyPort` / `proxyProtocol` / `proxyUsername` / `proxyPassword`.
3. **Set-proxy uses different field names** (`host`, `port`, `protocol`, `username`, `password`,
   `enabled`). The create-style names return 400. And a set-proxy does nothing until the instance
   is restarted.
4. **Auto-renew is one switch per ORDER.** With a 2-IP order, releasing one IP switched renewal
   off for the other, still serving a connected customer, and the hourly reconcile flipped the
   order back and forth between siblings. Fix: decide per order (on if any IP in it serves a
   connected number), and buy quantity 1 per order so each IP has its own switch.
5. **Storing what you asked for instead of what the provider has.** A toggle can fail or be
   skipped. The pool view then shows "renew ON" for an order IPRoyal has OFF. Fix: read the order
   back after every toggle and store that.
6. **Orders with no assigned IP left renewing.** The reconcile once looked only at assigned IPs,
   so an order left renewing (a release whose toggle failed, a manual dashboard toggle, an IP
   retired as dirty) kept charging for idle IPs every 30 days, unnoticed. Fix: pass C includes
   every order that has any live or dead row.
7. **Empty balance.** A balance-paid buy with no funds comes back `unpaid` and never provisions,
   so the connect fails. The reference code does not detect `unpaid` specifically: it shows up as
   "order created but no proxy provisioned in time" after the 29 second poll. And an auto-renew
   paid from an empty balance lets the lease lapse. Fix: set `IPROYAL_CARD_ID`.
8. **A freshly bought IP is not usable at once.** It can answer 407 for a short while after it is
   provisioned, and Evolution's create-time test rejects it. Fix: the routability wait after a buy
   (about 30 seconds of backoff); a slow one is parked `available` to warm up, not discarded.
9. **Reused IPs are the dirty ones.** A fresh buy scored 0. The IP that scored 94 had been
   released, abused by the next renter, and come back. Fix: re-screen at claim time, lease check
   first.
10. **Trusting ip-api for cleanliness.** It rated a fraud-94 IP clean and a clean IP a proxy.
11. **Mass expiry is a card problem.** Several in-use leases expiring together means the payment
    failed. Mass-renewing or mass-swapping would spend into a broken card and churn every number.
    The job alerts and does nothing.
12. **The test plan left on in production.** With `IPROYAL_PLAN_ID=23` every buy and every
    renewal is for one day: daily renewal events and daily spend. Set it back to 22. Also, the
    buy-time lease stamp treats every plan other than 23 as 30 days, so with plan 24 or 25 the
    first `lease_expires_at` is wrong until the heal job overwrites it.
13. **Parking Bright Data IPs.** They bill until the zone is deleted. Every release, dirty reject,
    non-routable result and failed insert deletes the zone. A Bright Data row never returns to
    `available`.
14. **Screening the Bright Data gateway instead of the IP.** The host in a Bright Data
    `proxy_url` is the shared gateway. Screen the egress IP returned at buy time.
15. **A Bright Data zone created without `pool_ip_type: "static_res"`** is silently a Datacenter
    zone. And an empty zone plus `POST /zone/ips` queues instead of allocating: create with
    `ips: 1`.
16. **Releasing the IP on logout.** That churns the number's egress IP for no reason. Release only
    on delete (and on vanished instances). A logout keeps the proxy.
17. **A proxy left `assigned` to a deleted channel** keeps renewing forever (about $4 a month
    each). The heal job's orphan sweep (pass E) is the safety net; it only runs with autoheal on.
18. **Healing a disconnected number.** It pays for an IP nobody is using and contradicts the
    renewal that was just turned off. Pass 0 only heals numbers that are `connected`.
19. **An IP wrongly marked dead.** A transient rejection used to lose a paid, working IP. The
    revive pass brings back a dead row whose lease is active, that routes, and that is clean.
20. **A paid order with no row.** If the insert after a buy fails, or provisioning outlasts the
    poll, money is spent and the pool does not know. Never re-buy: the orphan import (pass A)
    recovers it, and `iproyal_testbuy.py --order <id>` resumes by hand.
21. **`proxy_url` reaching a client.** It carries the password. The table has no client policies
    and no client grants; the admin endpoint masks it. Never add a policy "just for reading".
22. **Read from the code, not yet hit in production:**
    - After a swap, `whatsapp_channels.evolution_proxy_url` still holds the OLD url (only connect
      writes it). Trust `evolution_proxies.assigned_channel_id`, not that column.
    - In pass 0, if the extend succeeds but the restart fails (or the channel has no instance
      name), the job falls through to a swap: the just-renewed IP is retired `dead` and a second
      IP is claimed or bought. The revive pass can return the first one to the pool later.
    - If a proxy is freed while a connect is waiting for the buy lock, that connect returns "no
      capacity" (503) instead of claiming it. A retry succeeds. The same happens when a fresh
      IPRoyal IP is parked to warm up.
    - The pool builds `proxy_url` without percent-encoding the credentials, and `parseProxyUrl`
      URL-decodes them. A password containing `@`, `:`, `/`, `#`, `?` or `%` would be mis-parsed.
      Encode when you build URLs by hand.
    - The dirty-buy counters and the buy lock live in process memory. A restart clears the
      counters, and several server instances each have their own. The pool cap is the only spend
      bound that holds across instances.
    - A connect that has to auto-buy can take over a minute end to end (29 s order poll, about
      30 s routability wait, then up to 20 s of hold retries). Make sure the caller's HTTP timeout
      allows it.
    - `iproyal_import.py` reads only the first 100 orders; the server sweep reads up to 20 pages
      of 50.
    - The build log mentions a targeted single-order status call for orders missing from the bulk
      list. The job does not do that: an order missing from the sweep is simply left alone.

---

## 12. File and script map

Server code (`reference-impl/server/`):

| File | Use it for |
|---|---|
| `whatsapp/evolution/proxyPool.ts` | The pool: `claimProxyForChannel`, `releaseProxyForChannel` / `releaseProxiesForChannels`, `swapProxyForChannel`, `setProxyAutoExtendForChannel`, `reconcileIproyalOrderRenewal`, `syncIproyalOrderToPool`, `orderRenewalFromStates`, `probeProxyRoutable`, and the auto-buy state machine (`acquireNewProxy`, `buyAndProvisionOne`) |
| `whatsapp/evolution/iproyalClient.ts` | Every IPRoyal call: create order, order detail / status / summary, list orders, toggle auto-extend, extend, card resolution |
| `whatsapp/evolution/brightdataClient.ts` | Every Bright Data call: buy one (zone create + read IP), delete zone, balance |
| `whatsapp/evolution/ipqsClient.ts` | The IPQS lookup, the dirty verdict, the one-line summary |
| `jobs/evolutionProxyHeal.ts` | The hourly heal job (passes A, 1, B, 0, C, D, E) and the read-only `syncEvolutionProxyLeaseInfo` |
| `whatsapp/evolution/evolutionClient.ts` | `evoCreateInstance` (proxy at create), `evoSetProxy`, `evoRestartInstance`, `parseProxyUrl`, the `Invalid proxy` hold retry, `evoListInstances` |
| `routes/evolution/provision.ts` | Connect flow: claim, write `evolution_proxy_url`, create instance, roll back on failure; delete flow: release |
| `routes/evolution/inbound.ts` | The connection webhook that turns renewal on and off |
| `routes/evolution/admin.ts` | `GET /proxies` (masked pool + stats) and `POST /proxies/sync` |

SQL (`reference-impl/sql/`):

| File | Adds |
|---|---|
| `20260831_120000_evolution_proxies_pool.sql` | The table, its indexes, RLS on, client grants revoked |
| `20260908_130000_evolution_proxies_fraud_score.sql` | `fraud_score` |
| `20260917_000000_evolution_proxies_lease_expiry_autoextend.sql` | `lease_expires_at`, `auto_extend` |

Scripts (`reference-impl/scripts/`):

| Script | Spends money? | Use it for |
|---|---|---|
| `iproyal_account.py` | No | Balance and saved cards (find the card id) |
| `iproyal_discover.py` | No | Products, plans, prices, and the real order shape |
| `iproyal_locations.py <product_id> [substring]` | No | Location ids and stock |
| `iproyal_testbuy.py [--confirm-buy] [--plan N] [--order ID]` | Only with `--confirm-buy` | Buy one IP and fraud-check it; resume a pending order |
| `iproyal_import.py` | No | Turn confirmed orders into pool INSERTs (SQL file in the temp folder) |
| `ipqs_check.py <ip> ... [--strictness N]` | No (uses IPQS quota) | Fraud-check any IP |
| `brightdata_discover.py` | No | Active zones and available-IP count |
| `brightdata_testbuy.py` | With `--create-zone --ips N` or `--confirm-buy` | Buy, screen, route-test and delete a Bright Data IP; `--balance` |
| `proxy_yield.py [--threshold N]` | No | Clean rate and cost per usable IP, per provider and per netblock |

Build logs (`reference-impl/deploy/`): `PROXY_PER_CHANNEL_PLAN.md` (what was built and why, in
order; a few lines are older than the code), `ISOLATED_TEST_RIG.md` (what was proven and how),
`GO_LIVE_CHECKLIST.md` step 6 and 6b (the production env block).

Not bundled, so write your own: `config/env.ts` (the env var to `config` mapping), the cron
registration for the heal job, `scripts/execute_sql.py`, the error reporter, and the admin client
for your database.
