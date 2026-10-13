---
name: whatsapp-whapi-integration
description: >-
  The owner's production lessons for running WhatsApp on WHAPI.cloud (the paid, managed
  companion-device host) inside a multi-tenant app. This sits ON TOP of the vendor `whapi` skill
  (API reference, chat-id formats, send types): read that one for endpoints, read this one for how
  to wire the system and what breaks. Covers the pre-warmed channel pool claimed instantly at
  signup, QR and phone-code login, the per-channel provider column, the two unrelated WHAPI
  "balances" (partner wallet vs per-channel funded-until), the daily funding job and the two scary
  WHAPI emails, the balance callback, the outbound gate order with anti-block caps that apply ONLY
  to proactive sends, the unauthenticated inbound webhook with normalizer and dedupe, voice-note
  transcription, channel health, ban detection (a banned number still reports AUTH on plain
  /health), disconnect flap-damping, the cancel and grace lifecycle, and why you must keep your own
  message database. Read it BEFORE building or touching anything WHAPI: connecting a number, the
  inbox or AI reply path, reminders or campaigns over WhatsApp, channel funding, deleting a
  channel, or a ban. Use when the user mentions WHAPI, a WhatsApp channel, the channel pool,
  "expires in 3 days", WHAPI balance or wallet, a WhatsApp disconnect or ban, WhatsApp
  Status/Stories, fetching WhatsApp history, "do WhatsApp messages need a database", or "why did
  we get a WHAPI email".
---

# WhatsApp via WHAPI (managed provider): production lessons

> ## Adapt before use
> This describes how a WHAPI integration SHOULD be wired, taken from a production multi-tenant
> system that ran it with real money and real bans. Nothing here exists in your repo until you
> build it. Every table, column, function and env var name below is an EXAMPLE of the shape, not
> a name to grep for. Once the real system exists in this repo, update this file with the real
> file and table names. When this doc and the code disagree, the code wins. This is a live,
> money-moving, ban-sensitive domain: verify against the live code and database before acting.
>
> For the vendor API itself (endpoints, chat-id formats, every send type, groups, newsletters,
> the MCP server) read the `whapi` skill. This skill does not repeat it.

## 0. First: know which "WhatsApp" you are touching

There are three different things that all get called "WhatsApp". Conflating them is a real bug source.

| | Managed companion device (this skill) | Self-hosted companion device | Official Meta Cloud API |
|---|---|---|---|
| What | WHAPI.cloud hosts the linked-device session for you | Your own Evolution API / Baileys stack (see `whatsapp-self-hosted-evolution`) | A WhatsApp Business Account number on Meta's API |
| Number | The customer's real number, their phone stays primary | Same | A dedicated business number |
| Cost | About $25 per channel per month, from a prepaid partner balance | Flat infra plus a few dollars per channel for a proxy | Per-conversation fees |

A companion device is the "Linked Devices" screen on the customer's phone, exactly like WhatsApp
Web. Messages come from their real number.

If the app can run more than one backend, the discriminator is ONE column on the channel row
(example: `provider` = `whapi` or `evolution`, NULL meaning legacy `whapi`). Every WHAPI-only job
(funding, pool, ban sweep, health) must scope its fleet query to WHAPI rows only, so it never runs
WHAPI logic on a self-hosted row. See section 10 for the seam.

## 1. Two totally separate WHAPI "balances"

Confusing these is the number one source of WHAPI panic. They are unrelated.

1. **Partner-account balance ("days on balance").** A prepaid wallet of channel-days you own as a
   WHAPI partner, topped up with real money in the WHAPI panel. Each connected channel burns one
   day per calendar day. This is the money that matters.
2. **Per-channel "funded until" date.** Each channel has its own paid-through date, pushed forward
   by calling the Manager API extend endpoint (which draws days from the partner wallet). Mirror
   it in your DB (example column `funded_until`).

A channel can be about to expire while the wallet is full, and the reverse. WHAPI emails the
account owner about BOTH, independently.

**The two WHAPI emails, and which one is scary:**

- **"Channel X expires in 3 days"** is PER-CHANNEL, fired off one channel's funded-until date.
  It is fixed WHAPI behavior you cannot disable per channel. Getting one for a PAYING account
  means your funding path is broken for that channel. Investigate the funding job. Do not
  hand-top-up and move on.
- **Partner-balance low** is the one that actually needs a card. Handle it with the balance
  callback (section 6).

## 2. Provisioning: a pre-warmed pool, not create-on-demand

Creating a channel on demand makes the user wait while WHAPI initializes it. Keep exactly one
pre-provisioned channel sitting in QR state, ready to be claimed instantly by the next signup.

- **Seed.** Create a channel on the Manager API, insert a row with no tenant and
  `pool_state='ready'`, fund it 30 days and probe QR readiness in parallel, THEN register the
  inbound webhook.
- **Claim.** Atomic select-then-guarded-update (`ready` to `claimed`), safe under concurrent
  signups (retry up to 5 times on a lost race). Then wire or REATTACH the routing row that maps
  the number to the tenant. Reattaching, instead of creating fresh, preserves the tenant's
  AI-agent settings across a reconnect. Rename the channel on WHAPI fire-and-forget.
- **Entry point (create-channel route).** In order: access check, plan limit on WhatsApp
  channels, auto-bind to the only location if none was given, block a second live channel per
  location, try the pool fast path (about 50 ms), fall back to an inline create when the pool is
  empty.
- **Refill.** Event-driven right after every claim, with an hourly maintenance job as the safety net.
- **Login.** A QR route that polls the login row data for up to 90 seconds, and a phone-code
  route that polls for a pairing code. Both self-heal a dead channel by recreating it.

Pool numbers that worked: fund pool channels 30 days, reap unclaimed pool channels after 96 hours,
reap zombie claims (claimed but never paired) after 60 minutes, reap disconnected channels after
7 days so they stop costing money.

### Several state machines live on the same row

Keep them separate in your head and in the schema:

- `pool_state`: `ready`, `claimed`, `paired`, `disconnected`.
- A legacy provider status string (what WHAPI last said). The funding job funds only "logged in".
- `connection_state`, the CANONICAL one: `connected | reconnecting | needs_qr | disconnected |
  banned | unknown`. This is the single source of truth every UI reads. Server-written only (the
  inbound webhook, the reconciler job, the ban guard). The frontend mirrors the enum, never
  computes it.
- `lifecycle_state`: `active` or `deleted`. Soft-delete: keep the row for audit, null the token.

### A channel is per LOCATION, not per phone number

One channel per location. A tenant with N locations can have up to N channels. Switching phones
does NOT need a new channel: log out, log in with a different phone, the same channel id stays.
Dedupe guards are per location, and a reconnect or phone switch reuses the same channel, never
the create route.

**Disconnect (logout) keeps the channel alive and BILLED.** Only an actual delete stops the
monthly charge, and the delete must really happen on WHAPI's side (see the landmines).

## 3. Config (examples of the shape)

| Setting | What it does |
|---|---|
| Partner token | Manager API auth (create, extend, delete channels). Required at boot. |
| Project id | The WHAPI project new channels are created under. |
| Balance callback secret | A secret in the callback URL path. WHAPI sends no auth headers. |
| Balance runway floor (21 days) | Runway below which the balance callback pages critically. |
| Inbound webhook URL | Where channels POST events. **Read it straight from the process environment, never bake it into shared config**, so a dev machine can never rewrite production channels' webhooks to point at itself. |
| New-channel provider | Which backend brand-new connections use globally, with a per-tenant override table. This is the cutover switch. |

Funding constants that worked: renew at 10 days remaining, early-warning floor at 7 days, grace
period 30 days, hard cap of 45 days on grace funding.

## 4. Data model (examples of the shape)

- **Channels table.** One row per channel, pool channels included. Tenant id (NULL for pool
  rows), the provider's external channel id, the channel token, the state columns from section 2,
  phone number, health and anti-block counters (sent today, recent reply ratio, warmup start),
  funding columns (status `active | grace_period | unfunded`, funded-until, last funded, grace
  start, warning emails sent, release-authorized-at), soft-delete columns, and `provider`.
- **Routing map.** Maps an inbound phone to a tenant and location. In the source system this was
  the ONLY link from a channel to a location (no location column on the channel), and it was 1:1.
  It carries an AI-agent on/off toggle and a SEPARATE emergency hard shut-off flag. Do not merge
  those two: "AI off" means plain inbox, "channel disabled" means send nothing.
- **Messages table.** The message log, shared with SMS and webchat: direction, sender type
  (contact, ai, human), a normalized message id (the dedupe AND delivery-receipt key), a
  normalized chat id, delivery status, media columns (type, status `pending | ready`, source id,
  attempts, next retry at), call status, reaction and quote columns.
- **Status posts and status views** if you publish Stories.
- **Provider overrides.** Per-tenant backend override for NEW channels. Service-role only.

If the routing value column is NOT NULL, use a sentinel like `whatsapp:unpaired` until pairing.
It can never collide with a digits-only phone.

## 5. Outbound send path

Every entry point (inbox manual reply, AI reply, reminders, campaigns, Status posts, presence,
mark-read, rich media) funnels through a small set of shared primitives. One canonical text
sender, with gates in this order:

1. Resolve the channel (exclude soft-deleted).
2. Emergency shut-off flag on the routing row.
3. Subscription-lifecycle gate.
4. Business-closure hold gate, if the app has one (the source app held proactive sends during
   religious rest days in a held-message queue and drained them afterward). Replies are exempt.
5. **Anti-block safety gate.**
6. Provider branch (which transport).
7. POST with retry.
8. On the first ban-shaped status, confirm-then-stop (section 8).

**Anti-block safety, the numbers that worked:** burst cap 2 messages per 60 seconds; a warmup
curve of `[2, 6, 15, 25, 40, 60, 80, 100, 130, 160]` messages per day over the first 10 days,
then 200 per day steady; a rest day at 25% of cap after a 3-day streak.

**These caps apply ONLY to proactive intents** (reminder, marketing, confirmation request).
**Conversational replies (manual, AI reply) are NEVER gated, delayed or dropped.** Refusing to
answer a customer who just messaged is worse than any ban risk. Never reintroduce burst or daily
caps on replies.

For a denied proactive send, deny WITH a retry-after so the dispatcher reschedules on its next
tick. Never silently drop.

**Logging.** The sender is pure transport and does not write the message log. The CALLER logs
the outbound row. Delivery and read receipts come back through the inbound statuses webhook and
are applied by a forward-only rank machine: `pending < sent < delivered < played/read`, with
`failed` and `deleted` terminal. A late "sent" must never overwrite a "read".

## 6. Inbound path

- **Route.** Deliberately NO auth middleware. WHAPI sends no signature, so the URL is the only
  secret. ACK 200 immediately, then process fire-and-forget.
- **Branch by event type.** Statuses go to the delivery-status handler. Calls go to the call
  handler. Other non-message events (user login and logout, channel state changes) go to a
  state handler that writes the connection state and propagates the learned phone number to
  BOTH the channel row and the routing row.
- **Filter before normalizing.** Drop API echoes (`from_me` with source `api`) and group chats
  (`@g.us`). Require the receiving-phone query param you set at webhook registration, and alert
  when it is missing.
- **Normalize** into a channel-agnostic message shape. Body priority: text body, then media
  caption, then link-preview body, then reaction emoji. Reactions and quoted replies populate a
  reference field.
- **Orchestrate** in this order: resolve tenant and location (by receiving phone, scoped to the
  channel type), **idempotency dedupe on the normalized message id** (the provider retries any
  non-200), opt-out keyword handling, the AI-off plain-inbox gate, session resolve, the
  human-takeover branch (`from_me` with source NOT `api` means staff replied from their own
  phone), the voice and media pipeline, auto-reply gates, classifier, mark-read plus typing
  presence, a short debounce (4 seconds worked) so a burst of messages gets one answer, then
  hand off to the AI.
- **Voice notes.** Download the media by id with the channel token, transcribe, store the
  recording. WHAPI media has propagation lag: a 404 shortly after receipt is NOT expiry. Use
  escalating retries and fall back to a `pending` media status that a backfill job salvages.
  Bill transcription as its own usage line, idempotent on an external id.
- **Calls.** Persist missed and answered calls as rows in the message log.
  **Call timestamps are MILLISECONDS. Text message timestamps are SECONDS.** Same API, mixed units.

## 7. Billing: what it costs you, and how tenants pay

- **You pay WHAPI per channel from the partner balance.** A daily funding job (once a day,
  early morning UTC) should be 100% per LOCATION, never per tenant: resolve each connected
  channel's location, check whether THAT location has an active subscription that covers
  WhatsApp, then either extend funding 30 days (capped at that subscription's period end) or
  start a 30-day grace flow with warning emails on days 1, 7, 14, 21 and 27 before
  soft-disconnecting.
- **A channel you cannot map to a location is a data anomaly.** Keep it funded and fire a
  critical alert. NEVER grace or release it.
- **Tenants pay through the subscription or an add-on**, not per message. Voice transcription
  was the one per-usage item.
- **"Keep the scary email away."** Renew at 10 days remaining, well above WHAPI's own 3-day
  email trigger, and page internally if any logged-in channel still sits below 7 days after a
  funding run. The 45-day hard cap stops you paying forever for a stuck subscription that never
  gets release-authorized.
- **Balance callback.** WHAPI POSTs the remaining days when the partner wallet crosses the
  threshold set in its dashboard. Convert to real runway: days divided by the count of live
  WHAPI channels. Page critically under the floor (21 days). **Scope that channel count to
  WHAPI rows only.** Self-hosted rows in the denominator understate runway and produce false
  criticals.
- **Funding state is internal-admin only.** Show a per-channel badge and "funded until, N days
  left" in the admin tool. The tenant-facing app never shows funding.

**Release and funding are per LOCATION.** The release-authorized stamp gates every channel
delete and must be set per location, so cancelling one location never releases a sibling's
channel. Only a full account disable sets it tenant-wide.

## 8. Health, bans, disconnects, lifecycle

- **Health job (every 5 minutes).** One plain health call per tokened, non-deleted WHAPI
  channel. It reconciles the canonical connection state (the backstop for missed webhooks, and
  it covers EVERY channel) and refreshes the advisory anti-block counters.
- **Ban detection.** A banned number keeps a cached `AUTH` on the plain health call. ONLY the
  health call with `wakeup=true` reveals the ban (status code 5, reason banned). Go
  reactive-first: probe on a ban-shaped send failure, exactly ONE confirming probe, never a
  guess. Add a slow sweep every 30 to 60 minutes, wakeup-probing connected channels only. On a
  confirmed ban: detach every routing row, set the state to `banned`, null the token, fire ONE
  alert. Banned numbers can later reconnect, so warn and coach, never hard-wall.
- **Disconnect notifications are flap-damped.** Keep a `down_since` window of about 3 minutes
  and only notify on a durable disconnect, so a re-pair blip never false-alarms. Fire from both
  the on-demand health check (the owner has the integrations page open) and the 5-minute job.
- **Still-there nudge.** One "still there?" for an AI message that expected a customer reply
  and got none in 5 to 10 minutes.
- **Pool maintenance (hourly).** Reap old pool channels, zombie claims and long-disconnected
  channels, then refill.
- **Lifecycle.** Subscription lapse starts the per-location grace flow, then a soft disconnect
  that PRESERVES the routing row, once release is authorized. Location delete and full account
  purge each release channels through their own internal-secret-gated routes. Manual delete is
  always a soft disconnect plus an async verify that the provider really deleted it.
- **Admin reconciliation.** A read-only drift report (your rows vs WHAPI's channel list) plus a
  separate destructive cleanup, both scoped to WHAPI rows.

## 9. Landmines (each one cost real time or money)

- **Presence `delay` is a START delay, not a display duration.** Too high and "typing" appears
  AFTER the reply arrived. Use 1 for conversational replies.
- **Replies are never gated.** Said twice on purpose (section 5).
- **A banned number's plain health still reports `AUTH`.** Only `wakeup=true` reveals it. Never
  poll the deep probe aggressively: it is itself automation pressure on the number.
- **Never test Status (Story) publishing on a real number.** That got a real number banned.
- **A ban surfaces INCONSISTENTLY on send**, as 500, 428, 401 or 403. Never disconnect on a
  guess. Confirm with exactly one wakeup probe.
- **The channel DELETE call has returned 200 without deleting.** Every delete path needs async
  post-verification, or you keep paying for a channel you think is gone.
- **The Manager PATCH requires the project id in the body even on a rename.** Undocumented,
  discovered through a 400.
- **The channel settings endpoint 404s if called before the channel initializes.** The QR
  row-data probe is the "gate ready" signal. Register the webhook AFTER it.
- **A media 404 shortly after receipt is propagation lag, not expiry.** Retry, then backfill.
- **Call timestamps are milliseconds, text timestamps are seconds.**
- **Never fetch a channel row with a "must be exactly one" query on the provider channel id.**
  Re-pair loops create duplicate rows; a single-row fetch then throws and turns a harmless
  duplicate into a 503 storm. Fetch a list and pick deterministically.
- **If messages and sessions have no foreign key between them, your query layer cannot
  embed-join them.** Do two queries.
- **Dev must never write its webhook URL onto production pool channels** (section 3).

## 10. The provider seam (if a second backend may ever exist)

Design this in from day one. It is cheap now and painful later.

- **One discriminator column per channel.** New-channel routing reads a per-tenant override
  first, then a global default.
- **Route dispatch.** Mount a dispatcher BEFORE the WHAPI routers. Per request it resolves the
  effective provider and either handles it or passes through to the unchanged WHAPI handler.
  The frontend keeps calling one set of routes and never learns there are two backends.
- **One normalized inbound shape.** Each provider has its own normalizer that produces the same
  shape, so the inbound orchestrator never branches on provider.
- **Shared send primitives** resolve the provider from the row and branch internally at the
  transport point only, AFTER every business gate, returning the same result shape. Gate parity
  is then guaranteed.
- **Not shared, WHAPI-only:** funding, the pool, the ban sweep, health telemetry, and
  Status/Stories.

## 11. Do you need your own message database? Yes.

Answer this before assuming a WhatsApp integration can work like an email connector, where you
refetch everything from the mailbox on demand. **With WHAPI you cannot.**

- **WHAPI does not permanently store messages.** It processes them in real time and holds them
  only in short-lived caches while the channel is active. When the channel disconnects or goes
  inactive, no message content is retained. The vendor says so directly: the API is not a
  storage system or archive, and long-term history belongs on your infrastructure, fed by
  webhooks. Media is the one exception: kept about 30 days, then deleted. (Checked against the
  vendor docs in September 2026. Re-verify before relying on the exact retention.)
- **There IS a read-history API, but it reads that cache.** List-by-chat, list-all and
  get-one, with count, offset, time range, from-me, author and sort filters. They return what
  WHAPI still holds for a currently connected channel and nothing once it goes inactive. The
  resync feature only recovers specific missing messages (a quoted message it lost). It does
  not rebuild an archive.
- **"But WhatsApp Web shows scroll-back."** True: a linked device receives a bundle of RECENT
  history from the phone at pair time. Two things still make WHAPI useless as your archive.
  The phone ships only a bounded recent window to any companion, never lifetime history. And
  WHAPI does not durably persist even that, and being a third party you cannot patch it to.

**Rule: never build a WhatsApp feature that assumes it can re-read history from WHAPI.** Persist
every message to your own table the moment the webhook delivers it, and read history, threads,
the inbox, reports and AI context from there. WHAPI is a transport, not a store. Polling the
history endpoints for new messages is also an anti-pattern: missed messages, wasted quota, no
real time. Use webhooks.

## 12. Vendor facts worth repeating here

The `whapi` skill has the full reference. These are the ones production punished:

- One token is one channel is one WhatsApp number.
- There is no bulk endpoint. Loop one send per recipient.
- Filter `from_me` echoes on inbound or you build a self-reply loop.
- Interactive buttons and lists are unstable (WhatsApp may render them as plain text). Polls
  are the stable way to collect a choice.
- WhatsApp is rolling out LID identifiers. Convert them with the vendor's LID lookup; never
  pass a raw LID as the recipient.
- Health status values: `AUTH` live, `QR` waiting for scan, `INIT` and `LAUNCH` connecting,
  `STOP` deactivated, `SYNC_ERROR` log out and reconnect.
- Direct API bulk messaging is the fastest way to get a number banned. Prefer a
  Channel/Newsletter or a Group (opt-in, no ban risk). If you must loop: a warmed and active
  number, API warmup over days, about 10 messages per 15 minutes, 2 per minute burst, 6 hours a
  day at most, 3 consecutive days then rest, warm contacts only, personalize every message,
  include a STOP opt-out, and aim for a 30% or better reply rate.

## 13. Build and review checklist

- [ ] Every WHAPI-only job filters to WHAPI rows.
- [ ] Replies bypass every anti-block cap; proactive sends are denied with a retry-after.
- [ ] The inbound route ACKs first and dedupes on the normalized message id.
- [ ] Every message is persisted to your own table on arrival.
- [ ] Ban handling confirms with exactly one wakeup probe before disconnecting anything.
- [ ] Every delete is verified afterward on the provider side.
- [ ] Funding and release are per location; an unmappable channel stays funded and alerts.
- [ ] The balance callback divides by WHAPI channels only.
- [ ] The inbound webhook URL is read from the environment, never from shared config.
- [ ] Disconnect notifications wait out a short flap window.
- [ ] Funding state is visible to internal admins and invisible to tenants.
