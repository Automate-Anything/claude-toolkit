---
title: How Booking Pro Uses WHAPI (project-specific)
impact: CRITICAL
impactDescription: This is how OUR system wires WHAPI. The rest of this skill is the generic WHAPI API downloaded from the vendor; THIS file is our actual integration. Read it before touching anything about WhatsApp channels, funding, the channel pool, or "why did we get a WHAPI email".
tags: bookingpro, funding, channel pool, balance callback, whapiFunding, whatsapp_channels, extend, grace period, partner token, expires in 3 days
---

## How Booking Pro Uses WHAPI

> The other reference files in this skill are the GENERIC WHAPI vendor API
> (sending messages, chat IDs, newsletters, webhooks). THIS file is
> project-specific: how the Booking Pro codebase actually provisions, funds,
> monitors, and tears down WHAPI channels. When a task is about our WhatsApp
> plumbing, this is the source of truth; verify specifics against the live code
> in `billing-server/src/`.

### The mental model: two totally separate "balances"

Confusing these two is the #1 source of WHAPI panic. They are unrelated.

1. **Partner-account balance ("Days on Balance" in the WHAPI Partner Dashboard).**
   A prepaid wallet of channel-days we own as a WHAPI *partner*. Topped up with
   money (e.g. $12 = 30 channel-days) at panel.whapi.cloud. Each connected
   channel burns 1 day off this wallet per calendar day. This is the money that
   actually matters. Handled by the **balance callback** (below).

2. **Per-channel "funded until" date.** Every individual channel
   (e.g. `DRAXTH-C5QFZ`) has its own paid-through date. We push this date forward
   by calling WHAPI's `POST /channels/{id}/extend` (which draws days from the
   partner wallet). Stored in our DB as `whatsapp_channels.funded_until`. Handled
   by the **funding cron** (below).

A channel can be about to "expire" (its per-channel date is near) even while the
partner wallet is full. WHAPI emails the account owner about BOTH independently.

### The two WHAPI emails, and which is scary

- **"Upcoming End of Paid Period - channel X expires in 3 days."** This is the
  PER-CHANNEL email, fired off a single channel's `funded_until` clock. It is a
  FIXED WHAPI behavior we **cannot disable per channel**. The only way to never
  receive it is to keep every channel funded well above 3 days at all times. Our
  funding cron does exactly this (renewal threshold is 10 days, deliberately far
  above WHAPI's 3-day trigger). If you still get one, the funding path is broken
  for that channel - investigate, don't just top up by hand.
- **Partner-balance low callback.** WHAPI POSTs a small `{ days: N }` to our
  balance-callback webhook when the partner wallet crosses the threshold we set
  in the dashboard. We convert it to real runway (days / live-channel-count) and
  alert a human to add money. This is the one that actually needs a card.

### The DB table: `whatsapp_channels`

One row per channel (pool channels included). Key columns for funding/lifecycle:

- `channel_id` - WHAPI's channel id (e.g. `DRAXTH-C5QFZ`). `channel_token` - its bearer token.
- `company_id` - owning company; **NULL for unclaimed pool channels**.
- `channel_status` - WHAPI-side status text. `'channel logged in'` = paired & live. The funding cron only funds these.
- `pool_state` - `ready` (unclaimed pool), `claimed`, `paired`, `disconnected`.
- `funded_until` / `last_funded_at` - our mirror of the per-channel paid-through date.
- `funding_status` - `active` | `grace_period` | `unfunded`. **Caveat:** the
  funding cron only ever WRITES `active` or `grace_period`. A freshly-seeded
  channel keeps its seeded `unfunded` until a tick touches it, so historically a
  healthy paid-for channel could read `unfunded` and look at-risk when it wasn't
  (real confusion: NIGHTW-JJLX5, 2026-08). The cron now restamps covered
  channels to `active` on every tick via `reconcileCoveredChannelStatus`, so
  `unfunded` on a logged-in channel is a real anomaly, not a display quirk.
- `grace_period_start`, `warning_emails_sent`, `release_authorized_at` - grace/lapse bookkeeping.

### The funding cron - `billing-server/src/jobs/whapiFunding.ts`

Runs **daily at 06:00 UTC** (`scheduleLocked('0 6 * * *', 'whapi_funding', ...)`
in `jobs/index.ts`). Runs on BOTH the prod billing-server (`booking_pro_saas-prod`,
deploys from `main`) and staging (deploys from `dev`). **Real customer channels
are funded by the PRODUCTION server**, so a fix to funding behavior only fully
takes effect once it reaches `main`.

**Funding is decided 100% PER-LOCATION, never per-company.** A channel belongs to
a location (via `communication_map`), and THAT location's own subscription pays
for it. This mirrors the product's per-location subscription model - there is no
company-wide WhatsApp entitlement.

Per logged-in channel:

1. **Resolve the channel's location** via `communication_map`
   (`connected_to_whatsapp_channel_id` → `location_id`; `whatsapp_channels` has
   NO `location_id` column). The cron batches ONE query for all channels into a
   `channel db id -> location_id` map. Verified 1:1 in live data.
   - **Unmappable** (no non-deleted, location-bound comm_map row): a DATA anomaly
     on a live channel, never a lapse. Keep it funded and fire a critical alert -
     NEVER run grace/release on a channel we merely failed to map.
2. **Location covered?** Coverage is a `location_id -> best covering sub` map
   (furthest-future active sub at that location whose `item_id` is a plan with
   `number_of_whatsapp_channels > 0` or a "WhatsApp Channel" addon). Subs with a
   NULL `location_id` are legacy company-wide rows and are skipped (can't cover a
   specific location).
   - Covered → `handleActiveSubscription`: if `funded_until` is within the
     **renewal threshold (10 days)**, call `/extend` for up to 30 days (capped at
     THAT location's sub `current_period_end`). If not yet due, reconcile status.
   - Not covered → `handleNoSubscription(channel, companyName, locationId)`: run
     the grace-period flow, and eventually delete - but ONLY if
     `release_authorized_at` is set. `GRACE_FUNDING_HARD_CAP_DAYS = 45` stops us
     paying WHAPI forever for a stuck sub.
3. **Early-warning sweep** (`runEarlyWarningSweep`, end of each tick): any
   logged-in, non-grace channel still below the **7-day early-warning floor**
   after all handling → critical alert. This is the "catch it before the scary
   WHAPI email" backstop. Floor (7) sits above WHAPI's 3-day trigger, and the
   renewal threshold (10) sits above the floor, so a healthy channel is topped up
   ~3 days before it could ever alert and ~7 days before WHAPI could email.

### Release is per-location too (not just funding)

`release_authorized_at` is the flag every channel-delete is gated on. It must be
set per-LOCATION so cancelling one location never releases a sibling location's
channel. Three code paths set it:

- **`subscriptionLifecycleAdvancer.terminateSubscription(sub)`** - one sub
  terminates → `authorizeWhatsAppReleaseForSub` stamps ONLY the channels at
  `sub.location_id` (resolved via comm_map). Legacy NULL-location sub falls back
  to company-wide.
- **`subscriptionLifecycleAdvancer.terminateForCompanyAdmin(companyId)`** - a full
  company disable → company-wide release is CORRECT here (every location is
  shutting down).
- **`cardFreeReleaseAuthorization.authorizeCardFreeInfraReleaseForLocation(company,
  location)`** - called by `whapiFunding` at grace-expiry for a card-free
  downgrade; releases only that location's channels if that location is card-free
  and unpaid. The older company-wide `authorizeCardFreeInfraRelease` now releases
  RETELL numbers only (retell has no location link yet).

### The balance callback - `billing-server/src/routes/whapi/balanceCallback.ts`

Account-level webhook at `/api/whapi/balance-callback/:secret` (secret in the
path; WHAPI sends no auth headers). WHAPI POSTs `{ days: N }` when the partner
wallet crosses the dashboard threshold. We convert to real runway
(`days / live-channel-count`), and alert critically if below
`WHAPI_BALANCE_RUNWAY_FLOOR_DAYS` (default 21) so a human tops up the wallet.

### The channel pool - `billing-server/src/whapi/pool.ts`

To make signup instant, we keep exactly ONE channel pre-created in WHAPI's QR
state (`pool_state='ready'`, `company_id=NULL`). Signup **claims** it atomically
(`claimPoolChannel`), wires up `communication_map`, and an async refill seeds the
next one. Reapers (hourly, `whapiPoolMaintenance`) clean stale pool channels,
zombie claims, and long-disconnected channels to stop the ~$25/mo charge. Pool
channels are funded 30 days at seed time.

### Provisioning helpers - `billing-server/src/routes/whapi/helpers.ts`

- `extendChannelFunding(channelId, days, partnerToken, comment)` - the one call
  that pushes a channel's paid-through date (WHAPI `POST /channels/{id}/extend`).
- `softDisconnectWhatsAppChannel` - deletes the channel on WHAPI but preserves
  the `communication_map` row (NULLs the FK) so AI-agent flags survive a
  reconnect. `deleteWhatsAppChannelFull` - hard teardown incl. comm_map.
- `recreateWhapiChannel` - rebuild a channel deleted on WHAPI's side while
  keeping our DB row (preserves FK references + message history).

### Env / config

- `WHAPI_PARTNER_TOKEN` - the partner bearer token; required for create / extend /
  delete. Read via `config.whapiPartnerToken`.
- `WHAPI_PROJECT_ID` - WHAPI project the channels live under.
- `WHAPI_INBOUND_WEBHOOK_URL` - where channels POST inbound messages/state
  (prod: `api.bookingpro.ai/api/whapi/inbound`; dev must be the dev URL so dev
  never rewrites prod channels' webhooks to itself).
- `WHAPI_BALANCE_CALLBACK_SECRET`, `WHAPI_BALANCE_RUNWAY_FLOOR_DAYS`.

### Debugging checklist: "we got a WHAPI email / a channel looks at-risk"

1. Pull the row: `SELECT channel_id, channel_status, funding_status, funded_until,
   last_funded_at, grace_period_start, release_authorized_at, pool_state
   FROM whatsapp_channels WHERE channel_id='...'`.
2. Is `funded_until` in the future with comfortable runway? If yes and the email
   said "3 days", the email is STALE (queued off a pre-top-up date) - no action.
3. Does the company hold an ACTIVE WhatsApp-covering sub? (plan with
   `number_of_whatsapp_channels>0`, or a "WhatsApp Channel" addon, `active=true`,
   status in active/trialing/past_due/unpaid.) If yes, the funding cron will keep
   it alive; if `funding_status='unfunded'` on a logged-in channel, that's the
   anomaly the early-warning sweep now flags.
4. Check `[WhapiFunding]` logs for that `channel_id` and any
   `whapi_funding_error` engineering alerts.

### Where funding state is shown (superadmin only; NOT merchant-facing)

- **Company detail → Integrations card** (`superadmin-portal/.../company/IntegrationsCard.tsx`):
  a compact badge per channel - "Funded" (active), "Grace period", "Not funded".
  (Historically this compared `funding_status === 'funded'`, a value that never
  exists, so every channel showed red; fixed 2026-08 via a `fundingBadge` map.)
- **Manage WhatsApp channel drawer** (`superadmin-portal/.../ManageWhatsAppChannelDrawer.tsx`):
  the drill-in. Shows the friendly funding label PLUS "Funded until: <date> · N
  days left" (amber under 7 days) - the runway number to look at when triaging a
  funding alert. Backed by the `/whapi/admin/channels/:id/manage` endpoint, whose
  select must include `funded_until` / `last_funded_at`.
- The merchant-facing operator app does **not** display funding state at all -
  it's purely internal plumbing.
