---
name: iproyal-proxies
description: >-
  How to buy, run, renew and monitor IPRoyal static ISP proxies from code (the reseller API), with
  the hard-won rules from running one dedicated proxy per WhatsApp number on a self-hosted
  Evolution API / Baileys stack, plus Bright Data as a second provider and IPQualityScore fraud
  screening. Read it BEFORE writing any code that buys, renews, tests or assigns a proxy, and
  before debugging a proxy that "works from my laptop but not from the server". Use when the task
  involves IPRoyal, the IPRoyal reseller API, buying or renewing proxies, a per-account or
  per-channel proxy pool, static ISP vs residential vs datacenter choice, proxy fraud scores,
  auto-renew (auto-extend), a proxy returning 403 or 407, "Invalid proxy", Bright Data zones, or
  giving a WhatsApp (Evolution, Baileys, WAHA, whatsmeow) or browser-automation session its own IP.
---

# IPRoyal proxies: buying, running and renewing them from code

Everything here was learned by running IPRoyal ISP proxies in production (one static IP per
WhatsApp number, behind a self-hosted Evolution API). Facts marked **(measured)** were observed
live. Facts marked **(docs)** are from IPRoyal's documentation or support. The API is external and
changes: when something here disagrees with a live response, trust the live response.

Catalog ids, prices and plan lengths below are what the source system saw in 2026. Verify them
with the catalog call before spending money. Pool table and env var names are EXAMPLES of the
shape; once a pool exists in this repo, add the real file and table names to this skill.

**The real code and the step-by-step runbook are bundled.** The production implementation this
skill was distilled from (pool, IPRoyal / Bright Data / IPQS clients, heal job, SQL, and the
account-check, discovery, test-buy, import, fraud-check and yield scripts) is in
`whatsapp-self-hosted-evolution/reference-impl`. The exact runbook built from that code (every
endpoint, body, column, env var, threshold and script argument) is
`whatsapp-self-hosted-evolution/references/proxy-pool.md`. Use the runbook when you need exact
detail; use this skill for the rules and the reasons. Where a snippet here differs from that
code, the differences are called out inline.

---

## 1. The ten things that bite (read these first)

1. **One source IP at a time, by default.** (docs + measured) "By default, each ISP IP address
   supports one device or source IP at a time." If server A uses the proxy and server B tries
   within roughly 10 to 15 seconds, B gets a bare `403` (empty body, no headers, in about 40 ms).
   That is not a bad proxy and not a ban. Rules: **never send traffic through an IP that is in
   use from anywhere but its real consumer**, and never check an IP from another server right
   before the consumer connects. Checking a freshly bought, unused IP from your backend is fine
   (it rides out activation lag), as long as the consumer then retries past the 15 second hold
   (retry after 8 s and 12 s). If you truly need several sources at once, buy the paid
   *Multi-device access* add-on (3, 5 or 10 extra sources, each at 50% of the order fee).
2. **Auto-renew is per ORDER, not per IP.** (measured) An order of 2 IPs has ONE auto-renew
   switch. Turning it off because one IP is idle also stops renewal of the other IP, even if it
   is in use. Buy **quantity 1 per order** if IPs have independent lifecycles. If you do have
   multi-IP orders, decide renewal per order ("renew if ANY IP in it is in use").
3. **Renewal pays from the account balance unless you say card.** (measured: a live order was
   set to `payment_type: "balance"` with a $0 balance; the failed renewal itself is inferred, it
   had not come due yet) With a $0 balance the renewal cannot be paid and the IP lapses. There is
   no balance auto-recharge. Pass `payment_type: "card"` plus `card_id` (from `GET /cards`) when
   enabling, and `card_id` on buys and manual extends.
4. **Read the state back; never record what you asked for.** (measured) A toggle call can fail
   or be skipped. After changing anything, `GET /orders/{id}` and store IPRoyal's real
   `auto_extend_settings.is_enabled` and `expire_date`. A stored copy that only an hourly job
   refreshes will show stale "renew ON" to humans.
5. **"Fresh IPs every renewal" must stay off** for anything tied to an IP (a WhatsApp session,
   an allow-listed integration). It is product question 17 on ISP Dedicated. On, it swaps your
   IP at each renewal. The bundled reference code sends NO order questions at all (its order
   body is only product, plan, location, quantity and an optional `card_id`) and relies on the
   default being off, which is how it ran in production. Sending the answer explicitly (the
   `product_question_answers` line in the section 4 example) is a suggestion that was never
   run against the API: test it on a 1-day order before relying on it.
6. **A fresh IP is not usable the instant it is bought.** The order goes `confirmed` and gets
   `proxy_data` a little later, and the IP can answer `407 Proxy Authentication Required` for a
   short while after that. Poll, then retry with backoff before calling a new IP bad.
7. **Screen every IP, especially reused ones.** (measured) Fresh standard ISP buys scored IPQS 0
   in testing. The dirty one (score 94) was an IP that had been released: the next renter abused
   it, and it came back dirty. The worst-case sample (n=7, counting that recycled IP) was about
   3 in 10 dirty, so treat that as a ceiling, not the norm. Screen at buy time AND when reusing
   a pooled IP. Dirty = IPQualityScore `fraud_score >= 75`, or `proxy && recent_abuse`.
   Do NOT trust ip-api.com for this: it scored a clean IP as "proxy" and a dirty one as clean.
8. **Premium / zero-fraud-score IPs cannot be ordered through the reseller API.** (IPRoyal
   support, September 2026) The dashboard's `proxy_risk_type` / `proxy_score_type` are
   dashboard-only (401 with the reseller token), and ISP Dedicated has no fraud-score order
   question. If you need premium, buy in the dashboard and import the order into your pool
   (section 7).
9. **Datacenter and rotating residential are wrong for account-bound traffic.** For a platform
   that fingerprints you (WhatsApp, marketplaces, social), use **ISP Dedicated (static)**.
   Datacenter ranges get flagged. Rotating IPs break the session.
10. **Responses are sometimes wrapped, sometimes flat.** Unwrap `body.data ?? body` everywhere.

### Symptom lookup (what was actually seen, and why)

| Symptom | Real cause | Fix |
|---|---|---|
| Connecting fails with "Invalid proxy" / `403`, but the same proxy works from your laptop or in a browser | **Connecting too soon after another machine used the IP.** A different server (a health check, a pre-flight test, you testing from your laptop) sent traffic through it within the last 10 to 15 s, so IPRoyal holds the IP for that source and refuses everyone else | Don't test the proxy from anywhere except the machine that will use it. If something else must touch it, wait about 15 s before the real consumer connects, and retry a refusal after 8 s and 12 s before giving up |
| It fails every time through your app, but works when you try it by hand in the gateway's own UI | Your app runs a check from its own server right before handing the proxy over; doing it by hand skips that check | Remove the pre-check; let the consumer's own test be the check |
| It "works after a redeploy" and then fails again | Time passed during the deploy, so the 15 s hold expired; the redeploy fixed nothing | Same as above |
| (dead ends for the rows above) | Not a source-IP whitelist (IPRoyal ISP has none), not an HTTP-vs-HTTPS-tunnel difference, not the test site's reputation. Time was lost on all three | Go straight to the single-source rule |
| Brand-new IP returns `407` | Not activated yet | Retry with backoff for about 30 s |
| Renew shows ON in your dashboard but IPRoyal has it OFF (or the reverse) | You stored what you asked for, or the switch applied to the whole order | Read the order back after every change (section 4) |
| An IP in use stopped renewing after you released a different IP | Both IPs are in one order; auto-renew is per order | Package rule (section 4); buy quantity 1 per order |
| Risk: renewal day passes and the IP expires anyway (predicted; the setting was caught before it came due) | Auto-renew set to pay from a $0 balance | `payment_type: "card"` + `card_id` |
| Account traffic suddenly comes from your server's own IP | The gateway opened the connection before loading the proxy (Evolution 2.3.7 bug), or the proxy fields were in the wrong shape | Log the proxy each connection uses; see section 7 |
| Buy fails or nothing provisions for a whole country | That location is out of stock (it happened for every US ISP location on one day) | Check `out_of_stock` first; fall back to the second provider (section 8) |

---

## 2. API basics

- Base URL: `https://apid.iproyal.com/v1/reseller`
- Auth header: `X-Access-Token: <token>` (keep the token in an env var, never in code or logs)
- JSON in and out. Use a timeout on every call (the reference client aborts at 30 s; it sends
  `Accept: application/json`, and `Content-Type: application/json` only when there is a body).

| Purpose | Call | Notes |
|---|---|---|
| Catalog | `GET /products` | products, plans (id, name, price), locations (+ `child_locations`), `questions`, `quantity_discounts` |
| Balance | `GET /balance` | plain number |
| Saved cards | `GET /cards` | ids to pass as `card_id` |
| List orders | `GET /orders?product_id=9&page=1&per_page=50` | paginate until a short page; each order includes status, expiry, auto-renew AND full `proxy_data` (credentials) |
| One order | `GET /orders/{id}?product_id=9` | same shape as a list item |
| Buy | `POST /orders` | see section 4 |
| Manual renew | `POST /orders/{id}/extend` | `{ product_plan_id, proxies: [], card_id? }`; passing specific IPs in `proxies` renews a SUBSET of a multi-IP order |
| Auto-renew on/off | `POST /orders/toggle-auto-extend` | `{ order_id, product_plan_id, is_enabled, payment_type?, card_id? }`; payment fields only needed when enabling |

**Catalog ids seen** (verify with `GET /products`, they can change):

| Product | Plans (id: length, price) |
|---|---|
| 9 ISP Dedicated (static) | 22: 30 days $4, 23: 1 day $2 (good for tests), 24: 60 days $8, 25: 90 days $12 |
| 3 Datacenter Dedicated | 5: 30 days $1.80 (avoid for account-bound traffic) |
| 6 Residential | rotating, per-GB (avoid for sessions) |

Location `16` = United States (with about 250 city child locations). ISP Dedicated order
questions: `7` extra requirements (text), `9` Multi-device access (`"4"` = 3 devices, `"6"` = 5,
`"11"` = 10), `17` Fresh IPs every renewal (boolean, keep false).

**Order shape (the fields that matter; all values are placeholders):**

```json
{
  "id": 0,
  "status": "confirmed",
  "expire_date": "2026-01-31 08:15:16",
  "quantity": 2,
  "auto_extend_settings": {
    "is_enabled": false,
    "payment_type": "balance",
    "card_id": 0,
    "product_plan": { "id": 22, "name": "30 Days", "price": 4 }
  },
  "proxy_data": {
    "ports": { "http|https": 0 },
    "proxies": [ { "ip": "<ip>", "username": "<username>", "password": "<password>" } ]
  }
}
```

Proxy URL for a client: `http://<username>:<password>@<ip>:<port>` (port from
`ports["http|https"]`, falling back to `ports.http` / `ports.https`). URL-encode the credentials.

An order is **expired** if `expire_date` is in the past or `status` is one of
`expired | cancelled | canceled | refunded | terminated`. Treat an unreadable date as NOT expired
(never spend money on doubt).

Other shapes to handle:

- `status: "unpaid"`: the buy hit an empty balance. It never provisions and nothing is charged,
  but cancel it in the dashboard so it can't charge later once the balance is funded. Detect it
  and fail fast with "top up / use a card" instead of waiting for provisioning. (measured) The
  reference code does not have this check: there an unpaid order just polls as "pending" (3, 5,
  5, 8, 8 s) and surfaces as "order created but no proxy provisioned in time".
- The reference code treats an order as provisioned only when `status` is `confirmed` AND there
  is at least one proxy with ip, username and password AND a numeric port. It reads the new
  order's id from the create response only when `id` is a JSON number (nested under `data`,
  flat, or first in an array).
- The server's order sweep uses `per_page=50`, stops at the first short page, and reads at most
  20 pages.
- Every IP in a multi-IP order shares ONE username and password; only the IP differs. Don't key
  or de-duplicate pool rows by username.
- `GET /orders` without `page` returns `422` ("The page field is required."). (measured)
- A just-created order often has no `expire_date` yet; stamp buy time + plan length yourself.
- Expiry sometimes arrives as `expires_at` instead of `expire_date`; read both.
- Orders have an `is_test` flag; skip those, and anything not `confirmed`, when importing.
- A failed call returns a body shaped `{ "error": ... }`.
- `/products` location and `child_locations` entries carry `out_of_stock`; check it before
  buying from a specific city or country.
- `per_page` up to 100 works on `GET /orders`.

---

## 3. Minimal client (TypeScript, Node 18+)

```ts
const BASE = 'https://apid.iproyal.com/v1/reseller';

async function iproyal<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; status: number | null; body: T | null; error?: string }> {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'X-Access-Token': process.env.IPROYAL_API_TOKEN!,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => null);
    const unwrapped = (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
    return res.ok ? { ok: true, status: res.status, body: unwrapped } : { ok: false, status: res.status, body: null, error: JSON.stringify(json) };
  } catch (e) {
    return { ok: false, status: null, body: null, error: String(e) };
  }
}

type Order = {
  id: number; status?: string; expire_date?: string;
  auto_extend_settings?: { is_enabled?: boolean };
  proxy_data?: { ports?: Record<string, number>; proxies?: { ip: string; username: string; password: string }[] };
};

function summarize(o: Order) {
  const port = o.proxy_data?.ports?.['http|https'] ?? o.proxy_data?.ports?.http ?? null;
  const t = o.expire_date ? Date.parse(o.expire_date.replace(' ', 'T')) : NaN;
  const expired = (!Number.isNaN(t) && t < Date.now()) ||
    ['expired', 'cancelled', 'canceled', 'refunded', 'terminated'].includes((o.status ?? '').toLowerCase());
  return {
    orderId: String(o.id),
    expired,
    expiresAt: Number.isNaN(t) ? null : new Date(t).toISOString(),
    autoRenew: typeof o.auto_extend_settings?.is_enabled === 'boolean' ? o.auto_extend_settings.is_enabled : null,
    urls: (o.proxy_data?.proxies ?? []).map((p) =>
      `http://${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@${p.ip}:${port}`),
  };
}
```

---

## 4. Worked examples

### Buy one IP and wait until it is usable

```ts
async function buyOne(cardId?: number) {
  const order = await iproyal<Order | Order[]>('POST', '/orders', {
    product_id: 9,            // ISP Dedicated
    product_plan_id: 22,      // 30 days (23 = 1 day for tests)
    product_location_id: 16,  // United States
    quantity: 1,              // one IP per order: independent renew/cancel
    ...(cardId ? { card_id: cardId } : {}),  // omit = pay from balance
    product_question_answers: { "17": "0" },  // Fresh IPs every renewal: explicitly OFF. NOT sent by the
                                              // reference code (it sends no questions); unverified, test first
    // auto_extend: true,  // (docs) renew from purchase; never sent by the reference code, which
    //                     // switches renewal on only once the IP is in use
    // add "9": "4" to product_question_answers only if you need 3 simultaneous sources (paid)
  });
  if (!order.ok || !order.body) throw new Error(`buy failed: ${order.error}`);
  const id = Array.isArray(order.body) ? order.body[0]?.id : order.body.id;

  // Provisioning is async: poll until confirmed with credentials. (Intervals that worked: 3, 5, 5, 8, 8 s.)
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3_000));
    const got = await iproyal<Order>('GET', `/orders/${id}?product_id=9`);
    if (got.body?.status === 'unpaid') throw new Error(`order ${id} unpaid: fund the balance or pass card_id`);
    const s = got.body && summarize(got.body);
    if (got.body?.status === 'confirmed' && s?.urls.length) return s;
  }
  throw new Error(`order ${id} not provisioned yet; poll again later (never re-buy)`);
}
```

After it provisions:

1. Fraud-screen it (section 5). Dirty: keep it as a `dead` row and buy again (with a breaker,
   section 7).
2. Wait until it routes (activation lag): a plain HTTP request through it, with backoff
   (tries at 0, 3, 5, 6, 8, 8 s). Still not routing: park it `available` to warm up, don't discard.
3. Record `lease_expires_at` as now + plan length straight away; the next order sweep replaces
   it with IPRoyal's exact `expire_date`. (The reference code only knows two lengths here: plan
   23 = 1 day, anything else = 30 days. With a 60 or 90 day plan the first stamp is wrong until
   the sweep corrects it.)
4. If an order was paid but no IP arrived within the poll window, alert; a later sweep imports it.
5. Then hand it to the real consumer, which runs its own test (section 6).

### Turn auto-renew on or off, then record the truth

```ts
async function setAutoRenew(orderId: string, enabled: boolean, cardId?: number) {
  const body: Record<string, unknown> = { order_id: Number(orderId), product_plan_id: 22, is_enabled: enabled };
  if (enabled) Object.assign(body, cardId ? { payment_type: 'card', card_id: cardId } : { payment_type: 'balance' });
  const res = await iproyal('POST', '/orders/toggle-auto-extend', body);
  // Always read back: the toggle can fail, and the state is per ORDER.
  const got = await iproyal<Order>('GET', `/orders/${orderId}?product_id=9`);
  const truth = got.body ? summarize(got.body) : null;
  // store truth.autoRenew + truth.expiresAt on EVERY pool row with this orderId
  return { requestOk: res.ok, autoRenew: truth?.autoRenew ?? null, expiresAt: truth?.expiresAt ?? null };
}
```

Toggling never charges. The renewal itself charges, shortly before `expire_date`.

Card choice pattern: an env var holds the saved card id; the value `auto` means "the first card
from `GET /cards`" (cached per process); empty means balance. Set it on the service that actually
runs the buy / renew / extend calls, not on the proxy consumer.

**Test plan trap:** if you tested with the 1-day plan (23), switch the configured plan back to 30
days (22) before production. Otherwise every auto-renewal renews for one day, daily.

### Decide renewal per order (the package rule)

```ts
// states = connection state of whatever uses EACH assigned IP of one order
function shouldRenew(states: (string | null)[]): boolean | null {
  if (states.some((s) => s === 'connected')) return true;           // anything in use: renew all
  // The reference code's exact set. 'needs_qr' is its logged-out state; 'released' is what it
  // assigns to an IP still bound to a deleted or missing channel.
  const definitelyIdle = new Set(['disconnected', 'needs_qr', 'banned', 'released']);
  if (states.some((s) => !s || !definitelyIdle.has(s))) return null; // mid-reconnect: don't touch
  return false;                                                       // nothing in use (or no IP assigned)
}
```

Run this whenever a consumer connects or disconnects, when an IP is released, and in an hourly
reconcile. Include orders whose IPs are all idle or retired (renewal should be off). A reconcile
that only looks at assigned IPs never catches an idle order left renewing.

### Recover an expired lease without changing the IP (docs; built, not yet exercised live)

`POST /orders/{id}/extend` with `{ product_plan_id: 22, proxies: [], card_id }` renews the same
IP. That keeps everything tied to it (a paired WhatsApp session, an allow-list). Only if that
fails, swap to another IP. `extend` also accepts a different `product_plan_id`, so a 1-day test
IP can be upgraded to 30 days while keeping the same IP. Auto-renew can also be switched on at
purchase (`auto_extend: true` on `POST /orders`). Verify both on a cheap test order before
relying on them.

---

## 5. Fraud screening (IPQualityScore)

- Check the **egress IP** (the proxy's `ip`), not your server. With a gateway-style provider
  such as Bright Data, screen the IP it returns, never the gateway host.
- `GET https://ipqualityscore.com/api/json/ip/<key>/<ip>?strictness=0&allow_public_access_points=true`.
  Use `strictness` 0 or 1 (IPQS says these give the fewest false positives).
  `allow_public_access_points` cuts false positives on legitimate shared ISP addresses.
  The reference server and its test-buy scripts use `strictness=0` with a 15 s timeout; the
  bundled `ipqs_check.py` defaults to `strictness=1`, so pass `--strictness 0` to see the number
  the server acts on. The key is in the URL path: never log the URL.
- The web lookup page and the API are different scoring products and do NOT agree: one IP read
  84 on the page and 94 on the API, and the API said 94 at every strictness from 0 to 3, so no
  setting reconciles them. (measured) Set your thresholds on the API's numbers only.
- A failed lookup returns `success: false` with a `message`. Useful fields: `fraud_score`,
  `proxy`, `recent_abuse`, `bot_status`, `ISP` (uppercase).
- IPQS has a monthly quota (the free tier is roughly 5,000 lookups a month, unverified). At claim
  time, check the cheap things first (lease not expired, via IPRoyal, which has no quota), then
  IPQS.
- Dirty if `fraud_score >= 75` OR (`proxy === true` AND `recent_abuse === true`). Fresh clean
  buys scored 0, so the margin is huge.
- Screen at **buy time** and again at **claim time** when reusing a pooled IP. Not on a timer.
- Fail OPEN if the fraud service is down (don't block a customer), but log it.
- Scores cluster by netblock (/16): in the sample, whole ranges scored 100 or 94 while others
  scored 0. After a dirty streak, buying from a different city (`product_location_id` of a child
  location that is not `out_of_stock`) should land in another range. That idea was designed but
  never run; test it before relying on it.
- A per-provider circuit breaker (stop auto-buying after N dirty buys in a row, alert, self-heal
  after a cooldown) bounds the spend when a range goes bad.

Real cost is **price / clean rate**: at the worst-case 29% dirty, a $4 IP costs about $5.60 per
usable IP. With fresh buys scoring clean it is close to $4. Keep dirty buys as `dead` rows (not
deleted) so the clean rate you compute isn't biased toward survivors.

---

## 6. Testing a proxy correctly

- Test FROM the machine that will use it. A test from anywhere else both proves nothing about
  that machine and, because of the single-source rule, can lock the real consumer out for 15 s.
- An IP-echo site (for example `https://icanhazip.com`) through the proxy must return the
  proxy's IP, not your server's. The reference code's probe is a plain-HTTP
  `GET http://api.ipify.org` through the proxy with an 8 s timeout, and it only checks for a
  2xx (it does not compare the returned IP). It runs right after a fresh buy and in the hourly
  job's revive pass, never at claim time.
- Reading the result:
  - `200` with the proxy IP: good.
  - `407`: bad credentials, or a brand-new IP not ready yet (retry with backoff for about 30 s).
  - `403` with empty body, no headers, in tens of ms: another source used this IP moments ago.
    Wait 15 s and retry once. Never mark the IP dead on this alone.
  - timeout / connection refused: likely dead or expired, check the order status.
- A proxy that works from your laptop and fails from your server is almost always the
  single-source rule, not the proxy.

---

## 7. Example: one static IP per WhatsApp number (Evolution API / Baileys)

How it was wired. Adapt names to your system. The surrounding WhatsApp stack is in the
`whatsapp-self-hosted-evolution` skill.

**Why:** WhatsApp flags many sessions sharing one IP. One ban on a shared IP takes down every
account on it. Each number gets its own static ISP IP, so its traffic looks like one home
connection.

**Pool table (one row per IP):** `proxy_url` (with credentials; service-role access only),
`status` (`available | assigned | dead`), `assigned_channel_id` (unique), `provider`,
`provider_order_id`, `fraud_score`, `lease_expires_at`, `auto_extend`, `last_checked_at`, `notes`.

**Lifecycle:**

1. **Connect a number:** claim an `available` IP with a race-safe
   `UPDATE ... SET status='assigned' WHERE id=? AND status='available'`. Screen it (lease not
   expired, fraud check). **Do not run a routability probe from the backend at claim time**: it
   trips the single-source rule and the consumer's connect then fails. Pool empty: auto-buy one,
   behind a hard cap on total IPs (runaway-bill guard). Fail loudly if nothing is available:
   never fall back to the server's own IP.
2. **Give it to the WhatsApp gateway.** Evolution v2 `POST /instance/create` takes the proxy as
   TOP-LEVEL fields `proxyHost, proxyPort, proxyProtocol, proxyUsername, proxyPassword`. A nested
   `{ proxy: { url } }` is silently ignored, and the account then egresses from your server.
   `POST /proxy/set/{instance}` uses different names:
   `{ enabled, host, port, protocol, username, password }` (the create-style names return 400
   there), and it only takes effect after `POST /instance/restart/{instance}`. The reference
   client sends the proxy in the create call itself, so the proxy is in place before the QR is
   issued, and it retries a create or set-proxy that failed with "Invalid proxy" after 8 s and
   12 s (the single-source hold).
3. **Auto-renew follows real connection state:** on when the number connects, off when it logs
   out or is banned (package rule, section 4). An IP that never paired never renews.
4. **Release on delete (not on logout):** return the IP to the pool (`available`), keep its paid
   lease for reuse, switch renewal off if nothing else in the order is in use. A logout keeps
   the IP so a reconnect keeps the same egress.
5. **Hourly repair job:** one `GET /orders` sweep feeds everything: import orders you own but
   have no row for, retire expired available IPs, revive dead-but-alive ones, renew or swap
   expired IPs of CONNECTED numbers, reconcile renewal per order, stamp expiry + renewal onto
   rows, and release IPs still assigned to deleted channels.
6. **Seamless swap without re-pairing:** set the new proxy on the instance, then restart it. The
   WhatsApp credentials are independent of the IP, so it reconnects without a new QR.
7. **Mass-expiry guard:** if more than 3 (or over half) of the in-use IPs expire at once, that
   is a payment failure, not bad luck. Alert, don't mass-renew or mass-swap.

**More than one kind of consumer can lease from the same pool.** In a second project a
browser-automation service leased a user's browsing IP from the same pool as the WhatsApp
gateway. Each IP still has exactly ONE consumer. The backend's "prepare" step must not probe the
IP, and each consumer retries its first connection past the hold at 8 s and 12 s.

**Guard rails that keep spend bounded (numbers that worked):**

- **Buy lock + pool cap:** one buy at a time per process, re-checking the pool inside the lock
  (two simultaneous connects must not both buy). A hard cap on non-dead IPs (default 10) is what
  bounds spend across several server instances.
- **Dirty-buy circuit breaker, per provider:** IPRoyal switches to the second provider after 1
  dirty buy (each wastes a full lease). Bright Data trips after 20 dirty buys in a row (prorated,
  cents each), with a critical alert. Provider switches on errors are capped at 2 per
  acquisition, plus a hard iteration cap. A tripped breaker resets itself after 120 minutes.
- **Hourly job caps:** at most 2 renew/swap fixes per run (stop on the first failure), 10 order
  imports, 10 revivals (revive = active lease + routes + clean IPQS), 20 renewal toggles, and
  only the newest 100 dead rows scanned. Expiry is decided from order status, never from
  downtime (a network blip never "expires" a lease).
- **Stuck connections:** a consumer stuck mid-reconnect for over 24 hours (read from Evolution's
  fetch-instances `connectionStatus` + `disconnectionAt`) counts as not in use for renewal.
- **Read-only "sync from provider" button:** stamps lease expiry + renewal from one order sweep,
  never buys, renews or swaps. Safe to press any time.

**Importing IPs you bought by hand** (premium IPs, packs): list orders, skip `is_test` and
anything not `confirmed`, build the proxy URLs from `proxy_data`, insert as `available` with the
order id. The hourly sweep also auto-imports any active order it finds without a row.

**Proving traffic really leaves through the proxy:** the IPRoyal dashboard's data-usage view for
an IP showed traffic to WhatsApp's web host. Log the proxy each connection uses as well. A
connection that silently fell back to the server's own IP looks fine until the account is flagged.

**Batch buying (planned, not built):** a 2-IP pack costs about $6 vs $8 for two singles, but
renews all-or-nothing. The plan: only buy packs once usage is steady; use the seamless swap to
move users onto full packs, turn renewal off on the emptied pack, and keep at most one pack
partly filled.

**Gateway bugs that look like proxy problems:**

- Evolution 2.3.7 loaded an instance's proxy WITHOUT awaiting it before opening the socket, so
  a reconnect sometimes went out with NO proxy (logs showed the socket proxy as null). Fix:
  await the proxy/settings loaders before creating the socket. Always log which proxy each
  socket used.
- Evolution's own proxy test refused the whole instance create on a single refusal ("Invalid
  proxy"). Retry quick refusals (1.5 s, 3 s) before failing; don't retry timeouts.
- If your gateway runs on a PaaS, confirm its outbound IP is stable. The single-source rule
  means a gateway that alternates egress IPs locks itself out.

---

## 8. Costs and provider notes

- ISP Dedicated: $4 per IP per 30 days ($2 per 1-day test IP); about $5.60 per usable IP in the
  worst case, close to $4 when fresh buys come back clean.
- Multi-device access add-on: +50% of the order fee per tier (3 / 5 / 10 extra sources).
- Dashboard-only add-ons: Premium (hand-picked low fraud score, choose the scoring provider:
  scamalytics, ip_quality_score or ip_data) about +35%; "Extra requirements" +30%; "Fresh IPs
  every renewal" +10%.
- Quantity discounts (`quantity_discounts` in `/products`): 25% off from quantity 2 (a 2-pack of
  standard IPs was about $6 vs $8 for two singles). That discount is the real cost of the
  "quantity 1 per order" rule, because multi-IP orders renew all-or-nothing. Buy singles until
  usage is steady; then use packs and keep users packed so at most one IP sits idle. At volume
  (100 IPs) the quote was about $2.85 per IP.
- Keep a card on file and use it for buys, extends and auto-renew. IPRoyal's balance has no auto
  top-up.
- **Stock is not guaranteed.** On one day every United States ISP location was out of stock at
  IPRoyal, and Bright Data became the realistic first source of US IPs. Have the second provider
  working before you need it.
- ProxyWing: rejected. Its order API charges the balance only (no card) and has no auto top-up,
  and Cloudflare blocks non-browser User-Agents on its API (error 1010), so any client must send
  a browser User-Agent. (For reference: clean IPs are its default tier, about $3 a month,
  1-month minimum.)

### Bright Data as a second provider (built and proven, verified September 2026)

- **Why:** redundancy if IPRoyal fails or is out of stock, and a dirty BD IP costs cents
  (prorated) where a dirty IPRoyal buy wastes a whole lease. Break-even: BD at about $3.50 per IP
  beats IPRoyal's worst-case $5.60 per usable IP at any clean rate above about 63%.
- **API basics (from the reference client):** base `https://api.brightdata.com`, header
  `Authorization: Bearer <token>`, 30 s timeout. It needs the API token AND the customer id.
- **Buy:** `POST /zone` with body `{ zone: { name: "<new unique lowercase name>", type: "ISP" },
  plan: { type: "static", pool_ip_type: "static_res", ips_type: "dedicated", bandwidth:
  "unlimited", unl_bw_tiers: "std", country: "us", ips: 1 } }` allocates the IP immediately.
  `pool_ip_type: "static_res"` is required, or Bright Data silently creates a Datacenter zone.
  One zone per IP, a fresh zone name per buy.
  Creating an empty zone and then calling `POST /zone/ips` queued and never filled.
- **Read:** `GET /zone/ips?zone=<zone>` for the IP. The password comes from the create response
  (`zone.password`, sometimes an array).
- **Connect:** through the shared gateway `brd.superproxy.io`, user
  `brd-customer-<id>-zone-<zone>`. **The port is account-specific**: the source account's port
  was NOT the generic 33335 from the docs, so read it from your zone's access details. Screen
  the returned IP, not the gateway.
- **Release:** `DELETE /zone { zone }` (a 404 means already gone). Billing is prorated until the
  zone is deleted, so always delete on release or dirty. Never park BD IPs idle. Two $4 dedicated
  IPs deleted within minutes cost about $0.31 in total.
- **Money:** API buys draw only from the prepaid balance (the API cannot charge a card). A buy
  from an empty balance fails without creating debt. Auto-recharge works on pay-as-you-go with no
  monthly commitment (BD support): it fires when the balance drops below 85% of the recharge
  amount and is "not guaranteed to succeed". Not yet observed working, so enable it and watch
  one cycle. Watch the balance too: `GET /customer/balance` is slow (fine with an 8 s wait, hangs
  at 30 s). A low-balance monitor for BD is the one unattended failure mode: build it.
- **Cleanliness (n=2):** one scored 0; one scored 75 and was a Canadian IP despite `country=us`.
- **Limits:** residential needs a KYC-verified business account; changing the account's billing
  country needs documents; the "free credits" offer does not cover proxies.
- **Proven:** a WhatsApp session moved onto a BD IP with set-proxy + restart, no new QR.
- **Open:** `POST /zone/ips/refresh` may re-roll an IP in place (cost unverified).

---

## 9. Safety rules for an agent using this skill

- Buying, extending and enabling auto-renew SPEND MONEY: confirm with the owner first, use the
  1-day plan (23) for experiments, and never buy in a retry loop.
- Never print or log proxy passwords or the API token. Mask as `http://user:***@ip:port`.
- Never mark an IP dead on one `403` (single-source) or one `407` (activation lag).
- Never re-buy while an order is still provisioning: poll the existing order.
- Only the consumer machine talks through a proxy. Monitoring reads order status from the API,
  not by routing traffic.
- When this document and the repo's pool code disagree, the code is what runs. Fix the code to
  match a rule here, or update the rule. Do not silently keep both.
