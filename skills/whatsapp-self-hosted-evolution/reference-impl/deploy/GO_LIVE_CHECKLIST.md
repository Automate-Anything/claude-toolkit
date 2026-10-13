# Evolution API - your exact go-live checklist

Everything is coded, committed, pushed, and deployed to the **dev** billing-server.
The DB migration is live. The code is dormant (no Evolution env vars set yet), so
nothing is affected until you do the steps below.

There are only TWO real jobs left: (1) create 3 Render resources + set env vars,
(2) scan a QR with your phone. Copy-paste values are pre-filled below.

---

## The one secret (already generated - use this exact value everywhere)

```
EVOLUTION_API_KEY = <your-EVOLUTION_API_KEY>
```

This SAME value goes in BOTH the Evolution service (as AUTHENTICATION_API_KEY)
and the billing-server (as EVOLUTION_API_KEY). It's the shared admin key.

---

## STEP 1 - Render resources (DONE + one left)

Workspace: **My Workspace** (`<render-workspace-id>`). Region: **Virginia**.

### 1a. Postgres - ✅ ALREADY CREATED
- Name: `evolution-postgres` | id: `<render-postgres-id>` | PG16 | basic_256mb | status: available
- Dashboard: <the database page in the Render dashboard>
- ⚠️ **YOU DO:** open it → **Backups** → confirm daily backups are ON.
- **YOU DO:** copy its **Internal Database URL** (Render hides credentials from the
  API, so I can't; it's one click in the dashboard "Connections" section).

### 1b. Redis / Key-Value - ✅ ALREADY CREATED
- Name: `evolution-redis` | id: `<render-redis-id>` | starter | noeviction + snapshot | status: available
- **YOU DO:** copy its **Internal Key Value URL** (`redis://...`) from the dashboard.

### 1c. The Evolution web service - YOU CREATE (Docker; MCP can't create Docker services)
- New → Web Service → **Deploy an existing image**.
- Image URL: `docker.io/evoapicloud/evolution-api@sha256:966625532d9076a2381e973a271307d107e6f070450de3abeeea8bd18be07252`
  (evoapicloud is the maintained fork; the old `atendai/evolution-api:v2.2.3` is delisted and no longer pairs a device. Pin by digest, not `:latest`.)
- Name: `evolution-api-whatsapp`. Region: **Virginia**. Plan: **Standard**.
- It listens on port **8080** (set if asked). Health check path: `/`.
- The live service already exists: `evolution-api-whatsapp` / id `<render-service-id>` / https://<your-evolution-service>.onrender.com (see `ISOLATED_TEST_RIG.md`).
- **Connect it to the Postgres + Redis above** using their Internal URLs (Step 2).
- After first deploy, copy its public URL (live one is `https://<your-evolution-service>.onrender.com`).

> Why you (not me) do 1c: the Render MCP explicitly cannot create Docker/image
> web services (only source-repo ones). Postgres + Redis I already made.

---

## STEP 2 - Env vars on the EVOLUTION service (paste block)

When creating the `evolution-api` service, paste these env vars. Replace the two
`<paste ...>` lines with the Internal URLs from `evolution-postgres` and
`evolution-redis` (dashboard → each resource → Connections). The API key is real
and final - use it as-is.

```
AUTHENTICATION_API_KEY=<your-EVOLUTION_API_KEY>
SERVER_URL=https://<the evolution-api public URL Render gives this service>
CONFIG_SESSION_PHONE_VERSION=2.3000.1043857760
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=<paste evolution-postgres Internal Database URL>
DATABASE_CONNECTION_CLIENT_NAME=evolution_app
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=false
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=false
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=<paste evolution-redis Internal Key Value URL>
CACHE_REDIS_PREFIX_KEY=evolution_bp
CACHE_REDIS_SAVE_INSTANCES=true
CACHE_LOCAL_ENABLED=false
WEBHOOK_GLOBAL_ENABLED=false
DEL_INSTANCE=false
QRCODE_LIMIT=30
LOG_LEVEL=ERROR
LOG_COLOR=false
```

> Chicken-and-egg tip on SERVER_URL: create the service first (Render assigns the
> URL), then come back and set SERVER_URL to that URL and redeploy. Or leave it
> blank on first create and fill it once you see the assigned URL.

Confirm it's up: open `https://<evolution URL>/` → you get Evolution's info JSON.

---

## STEP 3 - Env vars on DEV billing-server - CLAUDE CAN DO THIS FOR YOU

Service: `app-server-dev` (id `<render-service-id>`).
The moment the Evolution service exists and you give Claude its public URL,
Claude sets these via the Render MCP (update_environment_variables works on
existing services). You don't touch this step.

```
EVOLUTION_API_URL=https://<the evolution-api public URL>
EVOLUTION_API_KEY=<your-EVOLUTION_API_KEY>
EVOLUTION_INBOUND_WEBHOOK_URL=https://dev-api.example.com/api/evolution/inbound
WHATSAPP_NEW_CHANNEL_PROVIDER=evolution
```

> `WHATSAPP_NEW_CHANNEL_PROVIDER=evolution` is set ONLY on app-server-dev,
> NEVER on app-server-prod, until you've tested and are 100% happy. WHAPI
> stays the default + fully live on prod the entire time. Existing channels
> everywhere keep their own provider='whapi' and are untouched.

---

## STEP 4 - Connect your WhatsApp and test (this is the part only you can do)

1. Open the DEV app (dev.example.com) → Integrations → WhatsApp → Connect.
2. A QR appears (served by Evolution now). On your phone:
   WhatsApp → Settings → Linked Devices → Link a Device → scan it.
3. Watch it flip to "connected."
4. Test outbound: send a message to a test contact from the inbox.
5. Test inbound: message the connected number from another phone → confirm it
   shows up and (if AI agent on) gets a reply.
6. Test voice: send a voice note → confirm it transcribes.

If anything breaks, you'll get an engineering alert with the exact source
(`routes.evolution.inbound`, `createEvolutionChannel.evoCreate`, etc.).

---

## STEP 5 - Go to production (controlled PER-COMPANY rollout)

The provider is chosen PER COMPANY now, not by a single global flag (commit
`<commit>` + the per-company dispatcher). On `app-server-prod` set:

```
EVOLUTION_API_URL=<evolution api url>
EVOLUTION_API_KEY=<evolution admin key>
EVOLUTION_INBOUND_WEBHOOK_URL=https://api.example.com/api/evolution/inbound
# Do NOT set WHATSAPP_NEW_CHANNEL_PROVIDER: unset already defaults to 'whapi'. Set it
# to 'evolution' ONLY if you want the GLOBAL default flipped so EVERY new connect uses
# Evolution (the flip-all switch). For the per-company rollout, leave it unset and flip
# companies individually below.
```

Then roll out gradually: **Superadmin -> Integrations -> Evolution -> Companies ->
search a company -> "Enable Evolution"**. That writes a per-company override, so only
that company's NEW connects use Evolution; every other company stays on WHAPI.
Existing connected channels (any company) keep their current provider until they
re-pair. Remove the override to send a company back to WHAPI. The Proxies tab on the
same page shows the pool + yield stats.

⚠️ **BEFORE a MIXED fleet (some whapi, some evolution): provider-scope the WHAPI
crons.** `whatsappChannelHealth`, `whapiFunding`, and `whapiPoolMaintenance` query
`whatsapp_channels` with NO provider filter, so they'd run WHAPI logic on Evolution
channels (e.g. WHAPI-health-check an Evolution instance -> false "dropped"). Add
`.eq('provider','whapi')` (or exclude `'evolution'`) to those queries before flipping
real companies. Evolution's own crons already scope themselves; `banGuard` is shared
by design. **DONE (2026-09-16):** the fleet-scan SELECTs in those three crons now
filter `provider.is.null,provider.eq.whapi` (keeps legacy null-provider WHAPI rows,
excludes Evolution); the per-channel updates inherit that scope.

⚠️ **WEBHOOK HARDENING - set `EVOLUTION_WEBHOOK_SECRET=<strong random>`** on every
billing-server replica that runs Evolution. When set, each instance registers a
per-instance HMAC-token webhook URL and `/api/evolution/inbound` rejects
forged/tokenless posts; UNSET = no token (works, but the inbound webhook is guarded
only by URL secrecy). After setting it, existing Evolution instances re-register on
their next connect (set-webhook), so reconnect any already-live one once to avoid a
brief inbound gap. (WHAPI's inbound is deliberately left as-is; hardening it would
require migrating every live WHAPI channel's registered URL.)

Global rollback at any point: keep/using `WHATSAPP_NEW_CHANNEL_PROVIDER=whapi` and
remove the per-company overrides. Both providers stay operational.

---

## STEP 6 - Per-channel proxy: production env (before a SECOND real merchant)

The per-channel proxy system (IPQS fraud screen + auto-buy + connection-driven
auto-renew + order-status auto-heal + seamless no-QR swap) is built and OFF by
default. The owner's own single number is safe on the shared Render IP; flip these
on before a second/real merchant connects via Evolution, so a WhatsApp ban on the
shared IP can't cascade across merchants.

Set on the Evolution billing-server (the one with `RUN_CRONS=true`):

```
IPROYAL_API_TOKEN=<reseller token>     # required for auto-buy
IPQS_API_KEY=<key>                     # fraud screen  (✅ already set on Render)
EVOLUTION_PROXY_MODE=required          # each channel MUST get its own IP (never share)
EVOLUTION_PROXY_AUTOBUY=on             # buy an IP when the pool is empty
EVOLUTION_PROXY_AUTOHEAL=on            # hourly heal cron (needs RUN_CRONS=true)
```

⚠️ **GO-LIVE STEP - `IPROYAL_CARD_ID=<your-card-id>`.** Currently **UNSET on purpose** - we
pay from the IPRoyal **balance** during testing (fine while it's being watched).
Before real merchants rely on unattended auto-renew, SET this to the saved card
(the saved card) so a 30-day renewal can **never fail on an empty balance** - a
failed renewal lets the IP lapse and drops the merchant's number. Balance now, card
for production.

⚠️ **GO-LIVE STEP - `IPROYAL_PLAN_ID`.** Currently set to **23 (1-day, ~$2)** for
TESTING (cheap buys, and short leases expire fast so the heal/expiry path is easy to
exercise). Before production, switch back to **22 (30-day)** - a 1-day lease in prod
would churn/renew every single day (constant renewal events + spend); 30-day is the
stable production default.

Optional tunables (good defaults, override only if needed): `EVOLUTION_PROXY_FRAUD_THRESHOLD`
(75), `EVOLUTION_PROXY_MAX_DIRTY_BUYS` (**1** now = one dirty IPRoyal IP switches to
Bright Data; was 3 before BD existed), `EVOLUTION_PROXY_DIRTY_BREAKER_RESET_MINUTES`
(120), `EVOLUTION_PROXY_MAX_POOL` (10). Full design: `PROXY_PER_CHANNEL_PLAN.md`.

---

## STEP 6b - Second proxy provider: Bright Data (optional; redundancy + yield)

Auto-buy now supports a SECOND provider, **Bright Data**, with a bounded switching
state machine (committed 2026-09-10, `<commit>`). It's dormant until BD is
configured. To turn it on, set (leave `EVOLUTION_PROXY_PROVIDER` at its `iproyal`
default so IPRoyal stays primary):

```
BRIGHTDATA_API_TOKEN=<admin-scoped Bearer token>   # BD dashboard -> Account settings -> API tokens
BRIGHTDATA_CUSTOMER_ID=<your-customer-id>                 # the brd-customer-<ID> value
```

Then **fund the BD balance and turn ON auto-recharge with a buffer.** BD's API cannot
charge a card directly; a buy from an empty balance FAILS (no card debt) and the state
machine treats it as an error and switches back to IPRoyal. Auto-recharge works on
Pay-As-You-Go with no monthly commitment (BD support confirmed 2026-09-10).

**Switching behavior:** start on IPRoyal; a dirty IPRoyal IP switches to BD after 1
(each IPRoyal dirty wastes a ~$4 lease); BD is sticky (each dirty is a few cents via
proration and is deleted on the spot) up to `EVOLUTION_PROXY_BD_MAX_DIRTY_BUYS` (20,
~$1) then trips + alerts; an ERROR switches providers, bounded by
`EVOLUTION_PROXY_MAX_ERROR_SWITCHES` (2) so it can never ping-pong forever. BD IPs are
each their own zone, deleted on release (BD bills prorated until deleted). Yield of
both providers is tracked by `scripts/proxy_yield.py`.

⚠️ **Recommended follow-up (NOT built yet):** a BD low-balance monitor that alerts
before the balance runs dry, since that's the one unattended failure mode.

---

## Want me to do Step 1 + 2 + 3 for you?

I have Render MCP access to "My Workspace." If you reply "provision it," I will
create the Postgres, Redis, and Evolution web service, set every env var above
(including on app-server-dev), and hand you a running stack - leaving you
ONLY Step 4 (scan the QR). I didn't do it unprompted because it creates paid
resources on your account.
```
