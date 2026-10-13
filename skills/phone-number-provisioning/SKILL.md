---
name: phone-number-provisioning
description: How to buy phone numbers and make them actually work for voice, SMS and an AI agent: searching and purchasing on SignalWire, registering a 10DLC brand and campaign, attaching numbers to a campaign, what toll-free verification really requires, approval notifications, the reconcile cron, the guarded script "door" that lets an operator or agent do everything the phone-number UI does (buy, enable voice, enable the AI agent, set the fallback number, release, re-attach), and the fast-switch for a number whose carrier attach failed. Contains the exact REST shapes and the traps that silently fail (a 2xx attach is not attached, campaign reads are top-level, lowercase approved states, registry webhooks use the signing key). This is a pattern to IMPLEMENT per repository; verify names against the current repo first. Read it BEFORE writing any number-search, purchase, campaign-attach, brand / campaign registration or approval-notification code, and before buying or releasing any number. Use when the user mentions buy / provision / release a number, toll-free, 10DLC, A2P, brand, campaign, The Campaign Registry / TCR, "campaign attach failed", "number not send-ready", "one number for SMS and phone", turn on calls, enable the AI receptionist on a number, a transfer / fallback number, or "notify me when the number / brand / campaign is approved".
---

# Phone number provisioning: buying, 10DLC, toll-free, and wiring voice + SMS + AI

> ## Adapt before use
> This describes how things SHOULD be wired, taken from two production systems
> (a multi-tenant SaaS and a single-tenant app) that buy numbers on SignalWire.
> Nothing here exists in a repo until you build it. Names like
> `phone-actions`, `provisionSmsNumber`, `messaging_campaign_numbers`,
> `approval_notified_at` are EXAMPLES of the shape: grep the current repo before
> citing any of them, and when this doc and the code disagree, the code wins.
> Update this file with the real names once built. The REST paths are from
> SignalWire at the time of writing (several sit under a `beta` registry path):
> confirm them with the `signalwire-docs` skill before coding against them.
> Other carriers have the same concepts (brand, campaign, attach, verification)
> with different endpoints; the traps transfer, the paths do not.

Related skills: `signalwire-docs` (how to look SignalWire docs up fast; do not
guess the API), `retell-phone-agent` and `self-hosted-voice-agent` (the AI that
answers on the number), `error-alert-system` (every failure path here must be
observable).

---

## The one rule

These actions SPEND MONEY (buying a number) and are IRREVERSIBLE (releasing a
number puts it in a roughly 14-day carrier hold; enabling AI registers it with
the voice platform). **Always dry-run first, read what it says it will do, then
apply with an explicit confirm.** Never buy or release a number on your own
initiative for a real customer. Preview and get the owner's OK.

---

## Where this code MUST live

In ONE backend service that is the sole holder of the carrier credentials, the
sole home of the REST client, and the home of the public webhook receivers. A
web console reaches it over authenticated HTTP. Put every carrier call behind
that service's single `request()` wrapper so it is logged to a provider-events
table and failures route to the error inbox. **Do not hand-roll `fetch`.**

Give each call a stable operation name for the forensic log, for example
`numbers.search`, `numbers.purchase`, `registry.brand.create`,
`registry.campaign.create`, `registry.campaign.attach`.

Sensitive data: identifiers only in errors. Mask any phone number before it
goes into an error or a log line, and scrub provider error bodies (they echo
numbers back).

---

## The one fact that shapes everything: 10DLC is NOT toll-free

| | Local / longcode (10DLC) | Toll-free |
|---|---|---|
| Compliance | Brand + Campaign (The Campaign Registry) | Toll-free **verification** |
| Attach to a campaign | Yes | **No.** Toll-free numbers do not attach to a 10DLC campaign |
| Submit compliance | REST API | **MANUAL FORM ONLY.** No REST endpoint exists |
| Approval webhook | Yes (`status_callback_url` on brand and campaign) | **None. No webhook, no status API** |

So **10DLC is fully automatable**: buy, attach, and a webhook plus a cron tell
you when it is approved. **Toll-free is not.** You can buy the number by REST,
but verification is submitted out of band through the carrier's verification
form, and approval is learned when a human receives the carrier's email. Build
toll-free verification as a tracked, honest, admin-driven record (model it on a
port-request feature if you have one), NOT a fake REST call. **Never invent a
toll-free verification API.**

---

## The SignalWire REST surface

Base: `https://<your-space>.signalwire.com`. Auth: HTTP Basic with the project
id and API token (from env, never in code or docs).

**Search** (the LaML compatibility API). Local versus toll-free is a PATH split:
- Local: `GET /api/laml/2010-04-01/Accounts/{PROJECT}/AvailablePhoneNumbers/US/Local`
- Toll-free: `.../AvailablePhoneNumbers/US/TollFree`
- Params: `AreaCode`, `Contains`, `InRegion` (2-letter state), `InLocality`
  (needs `InRegion`).
- Alternative, newer: `GET /api/relay/rest/phone_numbers/search` with `areacode`
  / `starts_with` / `contains` / `ends_with`, which have mutually exclusive
  rules. Pick ONE search API and be consistent.

**Purchase:** `POST /api/relay/rest/phone_numbers` with body `{ "number": "+1..." }`.
The response has `id` (the provider SID: store it as the number's provider
reference), `number`, `capabilities`, and **`number_type`: `"toll-free"` or
`"longcode"`**. Branch compliance on `number_type`.

**Attach to the campaign (10DLC only):**
`POST /api/relay/rest/registry/beta/campaigns/{CAMPAIGN_SID}/orders` with body
`{ "phone_numbers": ["+1..."], "status_callback_url": "<your number-assignment callback>" }`.

**Verify the attach:**
`GET /api/relay/rest/registry/beta/campaigns/{CAMPAIGN_SID}/numbers?max_results=100`,
find the entry whose `phone_number.number` matches, require `state === 'completed'`.

**Brand:** create with `POST /api/relay/rest/registry/beta/brands` (include
`status_callback_url`); it returns `{ id, state }`. Read with
`GET /api/relay/rest/registry/beta/brands/{BRAND_SID}`.

**Campaign:** create with
`POST /api/relay/rest/registry/beta/brands/{BRAND_SID}/campaigns` (include
`status_callback_url`); it returns `{ id, state }`. Read with
`GET /api/relay/rest/registry/beta/campaigns/{CAMPAIGN_SID}`.

---

## Traps that silently fail (each cost real production time)

1. **A 2xx on the attach order is NOT "attached".** The POST only means "order
   received". The carrier may defer it (the roughly 1-hour post-purchase hold) or
   fail it asynchronously. **Always poll-verify** the campaign's number list for
   `state === 'completed'` before trusting it. A number left unattached gets
   **reaped by the carrier's unattached-number sweep**. Real incident: numbers
   silently lost.

2. **Campaign READS are TOP-LEVEL, not brand-nested.** `GET .../campaigns/{id}`
   works. `.../brands/{b}/campaigns/{c}` returns an **HTML 404** and makes every
   status poll fail silently. Campaign CREATE is brand-nested; campaign READ is
   top-level. This hid for 8 days in production.

3. **The phone-number resource never populates its campaign id.** The campaign's
   `/numbers` list is the ONLY honest source of attachment truth. Store
   attachment in your own junction table, verified against the provider.

4. **Approved-state vocabulary is LOWERCASE and plural. Never `=== 'VERIFIED'`.**
   Brand approved is about `{completed, verified, approved, active}`. Campaign
   approved is about `{completed, approved, active, verified}`. Dead-terminal is
   about `{rejected, failed, expired}`. Use predicate helpers, case-insensitive,
   in ONE place.

5. **The roughly 1-hour post-purchase hold and the roughly 14-day release hold
   are NORMAL.** "Pending during the hold" is the expected first-attempt
   outcome, not an error. Do not alert on it. Let the reconcile cron converge.

6. **Registry webhooks are signed with the SIGNING KEY, not the API token**
   (Twilio `validateRequest` style). Validate registry callbacks against the
   signing key. A **signature-rejected** webhook is a CRITICAL alert: the
   carrier is reaching you but you are rejecting it, so automation silently stalls.

7. **Pre-check before POSTing an attach order** to avoid 422 spam: GET the
   campaign numbers first. Already `completed`: success without a POST.
   `pending` or `failed`: do not re-POST.

8. **A campaign attach in state `failed` does NOT self-heal by re-driving it.**
   Confirmed with the carrier's ops team. The fix is the fast-switch below.

---

## Approval notifications

Three events: **brand approved**, **campaign approved**, **toll-free verified**.
Wire each to the alert system; it is the only reliable notification surface.

- **10DLC (brand and campaign):** learn of approval two ways: the
  `status_callback_url` **webhook** (fast, best effort) AND a **reconcile cron**
  (the real backstop that heals every missed webhook). Both call ONE shared
  approval side-effect function so they cannot drift. That function exists
  because webhook and cron drifted once and approvals did nothing.
- **Toll-free:** there is no webhook. An admin marks it `verified` when the
  carrier's email arrives. A cron may surface a weak "looks verified" hint, but
  never claims verification from that alone.
- **Firing the notification:** this is GOOD news, not a failure. Use the alert
  system's rule / notice entry point, NOT the error reporter. Use a severity
  that actually notifies (an `info` tier typically never does).
- **Idempotency:** gate on the row's `approval_notified_at` /
  `verification_notified_at` stamp. Stamp then fire, with the update conditional
  on the stamp still being null (an atomic claim), so the webhook and the cron
  do not double-fire.
- **Delivery reality:** check that an alert actually reaches a person. An alert
  that is only a database row unless email env vars are set in production is
  not a notification. If the owner wants a real ping, confirm the delivery
  channel is configured and say so plainly if it is not.

## The reconcile cron (the backstop)

A scheduled job calling an authenticated cron route, under an advisory lock so
runs do not overlap. Every 15 minutes:
1. load the non-terminal brand and campaign rows;
2. GET live state (campaign at the **top-level** path);
3. stamp a last-synced-with-provider time;
4. on approved drift, run the shared approval side effect;
5. on dead-terminal drift, save the response body and fire a critical alert;
6. re-verify every `pending` campaign-number row.

---

## Single-tenant versus multi-tenant

**Single tenant: ONE brand, ONE campaign, forever.** Register once, owner-gated;
after that the SIDs are configuration (stored in the DB with the other carrier
resource ids). No per-tenant registration on the buy path. No pricing, funds or
transaction accounting. No shared-versus-own campaign migration.

**Multi tenant:** per-tenant registration, tiers (a shared campaign versus the
tenant's own), a money gate on purchases, and tenant scoping on every lookup.
If a mature multi-tenant implementation exists in another of the owner's repos,
mine it for exact code and ignore its payments / multi-location / tier
scaffolding when the target is single-tenant.

Data model (example shape): a brands table, a campaigns table, and a
campaign-numbers junction table carrying the verified attach state. Use text
columns with named check constraints rather than DB enums (the state
vocabulary changes), an updated-at trigger, row-level security with an admin
predicate as the real boundary, and forward-only idempotent migrations. If a
draft DDL exists in the docs, check its scoping column before applying it; a
draft scoped to the wrong key must be re-scoped, not applied as-is.

---

## The script "door": doing everything the phone UI does without a UI login

Build one guarded internal endpoint plus a small CLI script that drives it, so
an operator or an AI agent can provision numbers the same way the UI does. It
REUSES the proven service functions the UI routes call (provision voice number,
provision SMS number, enable voice, enable AI, disable AI, release, assign to
campaign, load the unified list). Never reimplement them. It is only a guarded
door.

**Read actions (no confirm):**
- `--list`: the unified number list (voice + SMS + AI capability per number).
- `--search --area <code> [--contains <digits>]`: available numbers.

**Mutations (dry-run unless `--confirm`):**
- `--buy-sms`: buy an SMS number and attach it to the campaign.
- `--buy-voice`: buy a voice number (spends money).
- `--enable-voice`: turn on calls on an existing (for example SMS-only) number.
- `--enable-ai` / `--disable-ai`: put the AI voice agent on the number. Needs
  voice already on AND a fallback / transfer number.
- `--set-transfer`: set the AI fallback / transfer number for a location. It is
  required so a "live" AI never dead-airs.
- `--release [--roles voice,sms,ai]`: release per role (default all).
  Irreversible; the carrier hold applies.
- `--reattach-sms`: re-attach to the campaign. Best effort; see trap 8.

**Safety model:**
- Every mutation is a dry-run unless confirmed, and the dry-run prints exactly
  what would change.
- A shared internal secret from env authenticates the script; it defaults to a
  base URL from env.
- **Ownership:** the endpoint bypasses the user-JWT auth the UI routes use, so
  it MUST resolve the tenant itself and scope every lookup to that tenant,
  re-enforcing the same IDOR guards in the handler body.
- **Deployment reality:** the endpoint acts on the carrier account its
  environment is configured for. To act on a LIVE customer's numbers you must
  hit production, so the route must be released to production first. Until then
  it only answers on staging. Know which one you are pointing at before you
  confirm anything.

### "One number for both SMS and phone"

1. Buy the number (as SMS or as voice) onto the location.
2. Enable voice, if you started from SMS.
3. Set the transfer number, so the live AI has a fallback.
4. Enable AI, so the agent answers calls on it.

Now the same E.164 number does inbound calls (AI) and SMS. Outbound SMS still
needs the carrier campaign attach to complete before the number is send-ready.

### Fast-switch a broken SMS number (failed carrier attach)

Each step with confirm:
1. release the bad number, SMS role only;
2. search the same area code and pick a fresh SMS-capable number;
3. buy it as SMS, which attaches it; check the attach result reports success;
4. optionally enable voice and AI on the fresh number.

Fresh numbers attach cleanly: the failure is per-number carrier luck, not the
campaign and not your code. If SEVERAL fresh numbers all fail to attach, THEN it
is a campaign problem: open a ticket with the carrier's ops / support desk.
