---
name: email-infrastructure
description: >-
  The delivery architecture pattern for email in a SaaS app, AND the rules for building email HTML
  that actually renders in Gmail and Outlook (tables only, no SVG, no double quotes inside style
  attributes, equal-height cells, one restrained palette, a manage block, verified in a real
  inbox). Covers the two fundamentally separate channels (PLATFORM email from us to our users,
  staff and internal team through a transactional provider such as Resend; TENANT email from a
  customer business to its own customers through that business's own OAuth-connected mailbox), the
  single audit log every send must land in, the send-and-log wrapper, sender personas, one shared
  branded layout per channel, the template resolver with unfilled-placeholder guard, suppression
  lists, the provider event webhook, the auth-provider send-email hook (so signup and reset
  emails are yours, not the auth vendor's), the staged path for a new project (vendor built-in
  sender first, own transport later), and the admin surfaces that view sent mail. Read it BEFORE
  writing, sending, logging, templating, designing or debugging any email, digest, report email or
  notification email, and before assuming a send log exists. Use when the user mentions email, an
  email template, email design, an email that looks broken or plain in Gmail, charts in an email,
  Resend, SMTP, the send-email hook, auth emails, confirmation, password reset, OTP, magic link,
  an email log, unsubscribe, bounces, email blasts, or "why didn't this email send or show up".
---

# Email infrastructure: delivery pattern and rendering rules

> ## Adapt before use
> Sections 0 to 8 describe how email SHOULD be wired, taken from a production multi-tenant
> system. It is a pattern to build per repository, NOT code that already exists here. Every
> file, table, column and function name is an EXAMPLE of the shape: grep the current repo
> before citing any of them, and do not conclude something is broken because a name from this
> doc is missing. Once the real system exists, update this file with the real names. When this
> doc and the code disagree, the code wins.
>
> Section 9 (how to build email HTML that renders) and section 10 (writing standard) are not a
> pattern to adapt. They are rules, and they apply to every email in every project from day one.
>
> This is an INFRASTRUCTURE map. It deliberately does not list every email type (those change
> constantly). It explains the pipes, not the water.

Concrete vendors named here (Resend for transactional, Gmail OAuth for tenant mailboxes,
Supabase Auth for the hook) are what the source system used. The shape holds with other vendors.

---

## 0. The one thing to understand first: there may be TWO separate channels

If the app is a platform whose customers are businesses with their own customers, email is not
one pipe. It is two completely different pipes with different senders, layouts, tables and
rules. Conflating them is the number one source of email bugs.

| | PLATFORM email | TENANT email |
|---|---|---|
| Who sends it | Us (the product) | A customer business (a tenant) |
| Who receives it | Tenants, their staff and owners, affiliates, internal ops, engineers | The tenant's OWN customers |
| Examples | Low-balance warning, payment failed, signup confirmation, subscription lifecycle, engineering alerts, product-update blasts | Appointment confirmation and reminder, review request, receipt, order shipped, promo |
| Transport | A transactional provider on OUR domain | The tenant's own mailbox, connected by OAuth |
| Body source | Typed code helpers (plus a small editable table for a few) | Per-tenant editable template rows, resolved by one resolver |
| Layout | One platform shell | One tenant shell plus composable primitives |
| Audit log | The one log table, always | The same log table, also |
| From address | Our personas (notifications, billing, updates, support) | The tenant's connected mailbox |

**Both channels log to the same table.** That is why one admin screen can show every email
regardless of channel. But how a send is produced and dispatched is entirely different. Before
you write or debug an email, decide which channel you are in.

A product with only its own users (no tenants mailing their customers) has ONE channel. Ignore
section 3 and keep the rest.

---

## 1. The audit log everything lands in

This is the spine. **Every email any server sends, on either channel, writes exactly one row.**
One door, so the record is trustworthy (the same principle as the `error-alert-system` skill).

Enforce it mechanically if you can: a pre-commit or agent hook that blocks any raw provider
send call that is not paired with a logger call. Then there is no legitimate way to send without
logging.

Example columns:

| Column | Meaning |
|---|---|
| `id` | row id |
| `service` | which server sent it (and `auth` for the auth hook) |
| `email_type` | a free-text STABLE key for filtering, such as `low_balance_warning`, `auth:signup`, `reminder_24h_email`. No enum; the caller picks a consistent string |
| `to_email`, `from_email` | addresses (join multiple recipients with a comma) |
| `subject` | subject line |
| `body_preview` | first 280 characters with HTML stripped. Auto-derived, never set by callers |
| `body_html`, `body_text` | the full body as sent |
| `provider_message_id` | links to the provider dashboard for opens, clicks, bounces. NULL for sends through a tenant mailbox |
| `status` | `sent` or `failed` at insert; later `delivered`, `bounced`, `complained` from the provider webhook; `skipped` when a gate dropped the recipient |
| `error_message` | failure reason |
| tenant id (nullable) | owning tenant; NULL for internal and engineering emails |
| recipient user id (nullable) | when the recipient is one of our users |
| `metadata` (json) | trigger context: booking id, template id, stage, blast id, a dedupe key |
| `sent_at` | when logged |

Row security on, with NO policies for end users: service-role writes only, read only through
the admin backend. Index on sent-at descending, tenant, type, status, provider message id and
recipient.

Do not log attachment bytes. If a send is HELD (a quiet-hours queue), do not log at hold time;
log the eventual send, or you double-count.

---

## 2. PLATFORM email: the transactional provider

### 2.1 Two logger functions

- **`sendAndLog(params)`**: sends through the provider AND writes the log row. **It never
  throws.** A logging failure must not make a send look failed, or someone re-sends and the
  user gets two. It logs failures too. Prefer this for all new code.
- **`logEmailSend({...})`**: fire-and-forget. For the rare case where you already called the
  provider yourself and need the row right after.

If there are several servers, each has its own copy that writes directly with its own
service-role client. There is no inter-server forwarding for email logging.

### 2.2 Typed helpers, one per email kind

One function per platform email kind. Each builds a subject and HTML through the shared layout,
then calls one private send-and-log helper. If the product is bilingual, each takes a language
param through a tiny `L(lang, a, b)` helper, and brand names stay in English.

### 2.3 Sender personas

Use separate from-addresses by the NATURE of the message, each configurable by env:

- a default transactional persona (also used by the auth hook),
- a billing persona for payment, balance and subscription email,
- a marketing or updates persona for blasts, ideally on a separate sending domain so marketing
  reputation cannot damage transactional delivery,
- a support persona,
- and an env var for where internal system alerts go.

Recipient lists for internal alerts are ALWAYS env configuration, never a code constant.

### 2.4 ONE platform layout

A single function is the source of truth for the look of every code-rendered platform email. It
returns a full inline-styled, table-scaffolded, Outlook-safe document about 560 px wide.

The house style that the owner signed off on is **minimal editorial**: a warm ivory page, ONE
flat white card with a hairline border, no drop shadow, no rounded blob, a small left-aligned
wordmark, a gold uppercase eyebrow, a serif ink headline, LEFT-aligned short body, ONE accent
(gold), an ink call-to-action button.

Params that proved useful: preheader, title, an eyebrow badge, body HTML (pre-escaped, KEEP IT
ONE OR TWO SHORT SENTENCES), a quiet monospace code box for one-time codes, info rows of label
and value (auto-dropping empties), one call to action, a muted paste-able fallback link ("if the
button does not work") for auth and action emails, a footer note, and an unsubscribe URL or a
preferences URL (mutually exclusive).

Rules:

- **Every platform email changes when you change this file. Do not fork it and do not hand-roll
  a competing shell.** If a caller needs something the shell cannot do, add an OPTIONAL param so
  every caller stays on one design.
- A platform email uses ONE palette. If a caller passes its own accent color, ignore it.
- **Export an `escapeHtml` and wrap every user-provided string** before it goes into the body.
- This layout is NOT for tenant-to-customer email.

### 2.5 The "new account signed up" email, and why its sweep is the guarantee

The owner relies on getting exactly one internal email per NEW ACCOUNT (not per new user inside
an account). The design that holds:

- Dedup is ONE column on the account (example `signup_notified_at`), compare-and-set stamped by
  the sender. Every trigger may then call it freely.
- Triggers call it immediately on each signup path.
- A sweep job every 5 minutes emails any account still unstamped after 2 minutes.

**The sweep is the guarantee, not a redundancy.** In the source system it was retired on the
theory that the checkout webhook was enough. Months later a new card-free signup path bypassed
checkout, and the owner silently stopped receiving the email for most signups until someone
noticed. Do not retire the sweep, and do not wire a new signup path to a specific trigger
instead of relying on the stamp.

Debugging "the owner is not getting the signup email": look in the log for that email type and
at the stamp on the account. Stamp NULL and the account older than a few minutes means the sweep
is not running. Row present means check the recipient address, which comes from env.

### 2.6 Admin blasts (a platform sub-channel)

Operator broadcasts to users: a UI in the admin tool, sent through the provider's BATCH API
(100 per call) from the marketing persona, with one-click `List-Unsubscribe` headers. Tables for
blasts, recipients, saved segments and a blast suppression list. Each send still writes the
audit log. Welcome emails and onboarding drips should reuse the SAME suppression list and the
same unsubscribe route (with a null blast id in the token), so one opt-out stops blasts and the
sequence together. See the `release-announcements` skill for the monthly update flow on top.

### 2.7 Undeliverable-address suppression

Remember addresses PROVEN undeliverable so you never mail them twice.

- A GLOBAL table keyed by lowercased address (a dead mailbox is dead for every email kind),
  service-role only. Columns: reason (`hard_bounce | complained | invalid_recipient | manual`),
  source (`provider_webhook | provider_api_reject | manual`), detail, best-effort attribution,
  a suppressed-send counter, first and last seen.
- A service with: a fail-OPEN read, an idempotent upsert that never throws, and a classifier
  that says whether a provider error is address-fatal or transient. **A 429, a 5xx or a soft
  bounce never suppresses.**
- **Enforce it at ONE choke point that every provider send passes through.** Before sending,
  drop suppressed recipients from the list. If all are suppressed, drop the whole send with a
  benign "invalid recipient" result that logs `skipped` and never alerts. If some survive, mail
  only them, so one dead address cannot sink a whole staff batch. On an address-fatal rejection,
  record the recipient so the next send skips it.
- The same choke point is where a placeholder-address gate lives (never send to synthetic or
  internal placeholder addresses).

**Three separate lists, three purposes. Do not merge them:** global undeliverable suppression,
tenant-scoped customer opt-outs (section 3.6), and operator-marketing unsubscribes (2.6).

### 2.8 The provider event webhook

A route mounted EARLY with a raw-body parser, because signature verification needs the raw
bytes. Verify the Standard Webhooks (Svix-style) HMAC-SHA256 signature. **If the secret is
unset, refuse every event with 503** rather than accepting unsigned events.

- Bounced: suppress the recipient ONLY if the bounce is permanent, and set the log row to
  `bounced`. Transient bounces do not suppress.
- Complained: suppress, set `complained`.
- Delivered: set `delivered`.
- Everything else: acknowledge, do nothing.

The webhook must also be registered in the provider dashboard with the signing secret in the
host's env. That is dashboard state, not repo state.

---

## 3. TENANT email: the tenant's own mailbox

This is usually the operationally bigger channel. A tenant's reminders, receipts and review
requests go out FROM THE TENANT'S OWN MAILBOX, using bodies the tenant can edit.

### 3.1 One resolver for every tenant send

Every tenant send site funnels its body through one helper (it can serve SMS and WhatsApp too;
a channel arg picks the table). It turns a template reference plus a variable map into a
ready-to-send body. Lookup cascade:

1. A template id: fetch that row, verifying it belongs to the tenant and is not soft-deleted.
2. Else a default key: fetch the tenant's seeded default by key (for hardcoded send sites).
3. Else an inline fallback body passed by the caller.
4. Else an empty string. Callers trim and skip.

It returns the body, subject, source and a list of unresolved variables. **It never returns null.**

Two interpolation subtleties that matter:

- **HTML escaping.** Partition the variables. Most (names, dates, tenant config: untrusted) are
  HTML-escaped to prevent stored XSS. A small ALLOW-LIST of server-rendered HTML chunks (an
  items list, an address block) and theme tokens pass through raw. Add a new server-rendered
  HTML variable to the allow-list or it shows up as visible escaped tags.
- **Theme tokens.** A per-template JSON palette merged with a default theme and exposed as
  `{{theme_*}}` placeholders, substituted in the same pass. The tenant's color picker drives them.

Use `{{var}}` placeholders. Some keys get soft fallbacks (first name falls back to "there").
Unknown keys with no value and no fallback go into the unresolved list.

### 3.2 The guardrail: never ship an unfilled placeholder

After resolving, check the unresolved list. If it is non-empty, **block or hold the send and
alert**, so a customer never receives "Hi {{first_name}}" literally. Every send site runs this.

### 3.3 Template tables

- An email templates table, row-secured and tenant-scoped: tenant, location (NULL means
  tenant-wide default, non-null means a location override), name, subject, HTML content, an
  event type, an is-default flag, a default key (what the resolver matches), a theme palette, a
  soft-delete flag, plus a snapshot of the seeded version and a fingerprint, so you can detect
  drift from the baseline.
- A parallel text templates table for SMS and WhatsApp, same model.

Seed defaults are defined in code and seeded per tenant. Tenants then edit their own copy.

### 3.4 The tenant layout and design language

**These emails are held to a high visual bar: premium and calm, never a generic transactional
template.** Any new tenant email matches the design language and composes from the existing
primitives. Do not hand-roll fresh HTML and CSS.

- **Shell.** A 560 px container, a white card (small radius, soft shadow as progressive
  enhancement) on a warm ivory page, generous padding. A wordmark header (logo plus the
  uppercase letter-spaced business name, or a serif wordmark when there is no logo), the card,
  then a quiet footer ("Sent by {business}" plus "Manage email preferences"). Dark mode and
  mobile through media queries as enhancement, a hidden preheader, a table scaffold and a serif
  fallback for Outlook.
- **Typography.** System sans for body. Serif for headlines and accent numerals. The large
  serif headline IS the hero; there is deliberately no colored hero band. Eyebrows are 11 px
  uppercase, wide letter-spacing, in the accent color. Lots of whitespace, thin hairline
  dividers instead of boxes.
- **Palette.** One shared base, and ONLY the accent and its soft tint change per category to
  set the emotional tone. Base: background `#F5F1EC`, card `#FFFFFF`, heading `#111111`, body
  `#3C3A36`, accent `#9C7A3F`, accent soft `#FAF7F2`, button `#111111` with white text, footer
  `#8B867B`.

  | Theme | Accent | When |
  |---|---|---|
  | Gold (default) | `#9C7A3F` | confirmation, reminder, celebratory |
  | Deep gold | `#8A6A2E` | reschedule, neutral changes |
  | Rose | `#A35E5E` (soft `#FBF3F1`) | cancellation, no-show |
  | Forest | `#3F5F3D` (soft `#F1F4EE`) | positive money-in states: orders, receipts |
  | Clay | `#9A5C3E` (soft `#F8EFE7`) | attention, not alarm: refund, declined, payment failed |
  | Charcoal | `#2C2825` (soft `#F2EFEA`) | tasks |
  | Champagne | `#B89360` (soft `#FAF3E5`) | gift delivery |

  **Pick the theme by the emotional moment, not the feature.** These are the source brand's
  values; swap the palette for the project's brand but keep the one-base-plus-accent discipline.
- **Authoring.** A tiny `build(preheader, body)` wrapper calls the shell with the standard
  placeholders, and each seed template is `build(preheader, <stacked primitives>)`, averaging
  about six primitives. To write a new one, copy a sibling and swap primitives. Never start
  from blank HTML.
- **Primitives worth having:** eyebrow header (eyebrow, headline, intro); details list
  (uppercase label column, serif value column, hairline-separated, supports strikethrough);
  old-vs-new comparison for reschedules; primary button and ghost secondary button; one muted
  helper line under the button; a "getting there" location card; paragraph; numbered steps with
  serif numerals; an italic quote callout; a gift-card visual; wrappers for raw list HTML; a
  star-rating row of five tap-friendly links carrying the rating as a query param.

The tenant shell and the platform shell are different on purpose. Do not confuse them.

### 3.5 Dispatch through the tenant mailbox

One `sendEmail` entry point resolves the sending mailbox for the location and dispatches through
the mailbox API, awaited, so the result reflects whether the provider accepted. Pipeline:

1. **Auto-pause gate.** If email is paused at this location (dead auth, limit hit), refuse early.
2. **Hold gate**, if the app has one (the source app queued proactive customer-facing sends
   during religious rest days and drained them afterward). Replies and platform or billing
   email are never held.
3. **Sender resolution.** Pinned sender id, then by address, then the default, then any
   connected sender at the location. None found: pause email at the location and return an error.
4. **Daily quota.** An atomic check-and-increment per sender per UTC day (default 2000,
   overridable per sender). Over the limit: decrement and refuse.
5. **Send.** On an auth failure (invalid grant, 401) pause the location's email and notify the
   tenant. On success clear any pause flag.

The mailbox send path ALSO writes the audit log (provider message id NULL).

**Never import the mailbox provider client outside this module.** Everything goes through the
one entry point so quota, pause, hold and logging all run.

The send-site pattern is always: build vars, resolve the body, run the placeholder guard, check
opt-outs and suppression, send.

### 3.6 Tenant-channel suppression

Before a tenant send, check the tenant-scoped opt-out registry (an active opt-out is one with no
resubscribe stamp) and per-category preferences. Every customer-facing email carries a signed
preference or unsubscribe link. A bounce sweeper on the mailbox side writes hard bounces into
this registry.

### 3.7 Connecting a mailbox (OAuth), and the scope-decline case

Flow: a start route signs a CSRF-proof state token and returns the consent URL; the frontend
navigates there in the same tab; the provider redirects to a callback that connects the
mailbox, then redirects the user back to the page they came from with a success param or an
error-code param. The page reads the param, refreshes, toasts and strips it. Map distinct error
codes: missing mail scope, invalid grant, no email returned, missing location, unknown.

**The load-bearing subtlety is the per-scope checkbox.** Google's consent screen shows a
SEPARATE checkbox for the mail permission. If the user leaves it unchecked, the OAuth exchange
still SUCCEEDS, but the grant carries only identity scopes. Every later mail API call would 403
with insufficient scopes. So the connect function must inspect the granted scopes, and if the
mail scope is absent: **revoke the useless half-grant at the provider** (so the next attempt
shows a fresh checkbox), store NOTHING, and throw. A scope-less credential is never persisted,
so there is nothing to disconnect or clean up afterward.

**A scope decline is NOT an engineering alert.** This is the canonical example of the owner's
alert principle (see `error-alert-system`): the system worked exactly as designed, the user
declined a permission, we refused and cleaned up, and the frontend tells them precisely what to
do. A correct, user-fixable outcome generates ZERO alerts, not even a silent one. The callback
deliberately does not report this one code, while every OTHER connect failure still reports.
The user gets: a PERSISTENT on-page warning banner with a Reconnect button (not only a
disappearing toast), and an upfront hint on the connect card to keep the mail box checked.
Apply the same rule to any OAuth connect path.

---

## 4. Auth emails: own them through the send-email hook

Signup confirmation, password reset, invite, magic link, email change, reauthentication, and the
security notifications (password changed, email changed).

**To the user these look like the auth vendor's emails. They should be 100% yours.** Configure
the auth vendor's Send Email Hook to POST every auth email event to your endpoint INSTEAD of
sending anything itself. You then render the HTML, pick the sender, send through your own
provider account from your own domain, and log it. The vendor's role shrinks to "generate the
token and tell us to send an email". These are platform emails that happen to originate from an
auth event.

**The load-bearing switch is in the auth vendor's dashboard, not the repo.** You cannot verify
it by grepping code. If auth emails ever look like the vendor's plain default template again,
the first suspect is that dashboard hook being disabled or pointed at the wrong URL or secret,
not a code regression.

How the hook endpoint works:

- A public route (no session auth) with a RAW body, excluded from any "account must be active"
  middleware. Model it on an existing payment webhook route.
- Verify a **Standard Webhooks HMAC-SHA256 signature** over
  `${webhook-id}.${webhook-timestamp}.${rawBody}`. The secret has a vendor prefix that must be
  stripped and the remainder base64-decoded to the key bytes. Compare in constant time. Enforce
  a 5-minute replay window.
- Status codes matter because the vendor retries: 200 (accepted, no retry), 400 (bad payload,
  no retry), 401 (bad or missing signature, no retry), 503 (secret not configured, or the send
  failed, so the vendor retries).
- Switch on the action type and **render from code**, mapping per-action copy (eyebrow,
  headline, short intro, one-time code, call to action, footer) onto the shared platform layout.
  Do not fork a bespoke auth shell.
- If several apps share one auth project, pick the brand persona from user metadata first, then
  from the redirect host.
- **Resolve the real recipient carefully.** Prefer the app's own user row, fall back to the
  auth payload's address. If the app uses synthetic placeholder auth addresses for some users
  (invited users with a non-deliverable internal address), carry the real address in the invite
  payload's user metadata and fall back to that. It needs no DB read, so it is race-proof. That
  was the root-cause fix for invites that silently vanished when the app's user row had not
  committed yet. If no real address resolves: do NOT send, return 200 (a retry cannot conjure an
  address), and fire an alert so a dropped auth email is never silent.
- Build the action URL from the redirect target, preserving existing query params, plus the
  token hash and type. The notification-only emails point at the forgot-password page instead.
- Send through `sendAndLog` with service `auth` and email type `auth:<action>`, with metadata
  naming the source, action, app, user id and language.
- **Special case:** on a "password changed" notification, if the user was invited and has never
  logged in, SUPPRESS it and return 200. That event is a first-time invite acceptance setting an
  initial password, not a real password change, and it scares a brand-new user.

### Auth bodies are CODE, not rows in an editable table

A mistake that was made and documented wrongly once: assuming an editable "platform email
templates" table drives the auth emails. It did not. The hook rendered entirely from code. To
change a signup or reset email you edit the hook, not a row. Keep the admin editor honest with
an explicit list of the action types that are actually wired at runtime, and only let those be
edited.

### What an editable platform-template table IS good for

A small table (action type, subject, body HTML fragment, active flag, language) for a few
owner-facing emails:

- **The welcome email**, sent by a sweep about a minute after the owner confirms their address,
  plan-aware and language-aware with fallbacks (plan-specific row, then generic; preferred
  language, then English). The editable fragment owns the headline, the single button and the
  sign-off. The shell adds only wordmark, card and footer, and appends no extra button or
  sign-off.
- **A welcome drip**, several steps over the first two weeks, sent by a sweep every 15 minutes,
  one send per account per run, exactly-once through a dedupe key in the log metadata, written
  on BOTH sent and skipped rows.
  - **Make it STATE-AWARE.** Each step has a live "already done" check. A step that is already
    done is logged `skipped` and never sent, so nobody is told to connect a payment processor
    they already connected.
  - Seed each step INACTIVE. The admin toggle is the deploy-free on/off switch per step.
  - Any motion is progressive enhancement inside a reduced-motion-safe media query. The static
    state is the finished email, because Gmail web and Outlook strip animation.
  - Every one ends with an unsubscribe link and a physical address, and sends the
    `List-Unsubscribe` and `List-Unsubscribe-Post` headers. A suppressed recipient gets a
    `skipped` row under the dedupe key. The welcome itself still sends (account-critical) but
    carries the link.
- **If the same shell is duplicated** (runtime, a registry, admin preview builders), the copies
  must be byte-identical. Change one, change all. Better: do not duplicate it.

To add another editable platform email: a registry entry with its variables, the action type in
the runtime-wired list, sample merge data for the admin preview, and a seed row per language.

---

## 5. Starting a new project: the staged path

You do not need all of the above on day one. A launch-critical project in the source portfolio
shipped this way, deliberately:

| | Stage 1 (launch) | Stage 2 (after launch) |
|---|---|---|
| Template | Yours: branded HTML pasted into the auth vendor's dashboard | Yours: the same HTML, moved into code |
| Transport | The auth vendor's built-in email service | Your provider, through the Send Email Hook |
| From address | A generic vendor address (cannot change without custom SMTP or a provider) | Your own domain |
| Audit log | None, only the vendor's logs | The log table, one row per send |
| Code in the repo | Only the UI that TRIGGERS the vendor to send | The hook endpoint, logger and layout |

**Why:** the built-in sender works immediately with zero infrastructure. A real provider needs
an account, DNS domain verification and a live endpoint. **It is a transport swap only**: the
templates and every auth UI flow are already final, and moving later changes only what carries
the mail.

What you accept in stage 1: low rate limits (a handful of emails per hour, so bulk testing WILL
hit it, and that is expected, not a bug), a from-address that is not your domain, and no send
log.

Stage 1 facts an agent must know so it does not chase ghosts:

- **There is no email-sending code and no log table.** Do not grep for them and conclude
  something is broken. "Did it send?" is answered in the vendor dashboard logs.
- **Templates are edited in the dashboard**, not in code. A code search for the body finds
  nothing. Keep the vendor's substitution tokens intact.
- **The load-bearing switches are dashboard state:** "confirm email" ON, custom SMTP OFF. If
  auth emails stop arriving, suspect those settings and the hourly rate limit before repo code.
- The repo holds only thin wrappers around the auth client calls that trigger each email
  (sign up, resend confirmation, reset password, update password, send and verify a one-time
  code, change email, magic link), plus the pages: signup with resend, login by password or
  email code, forgot password, reset password landing, change email in the profile, and the
  callback route that exchanges the code for a session.

Stage 2 build order: create the provider account and verify the domain in DNS; add the log
table; add `sendAndLog`; port the dashboard templates into one code layout; build the hook
endpoint (section 4); then the OWNER flips the dashboard hook on. That last step is the actual
switch.

---

## 6. Admin surfaces

- **Activity log.** A paginated list over the audit log, newest first, enriched with the tenant
  name. Filters: search on recipient and subject, email type, status, service, tenant, date
  range. A distinct-types endpoint populates the type filter. The detail drawer renders the
  stored HTML in a SANDBOXED iframe and links to the provider dashboard.
- **Per-tenant communications tab.** The same component, locked to one tenant.
- **Platform template editor.** Edits only the runtime-wired action types, with a per-row
  active kill switch and per-language rows. Writes are audit-logged.
- **Blasts** and the engineering alerts page, which can deep-link into the activity log
  filtered by tenant or type.

---

## 7. Decision guide and hard rules

Which channel am I in?

- Goes to **a tenant's own customer**: tenant channel. Build vars, resolve, guard, check
  opt-outs, send through the tenant mailbox. The body is a template row. Do NOT use the
  platform provider.
- Goes to **a tenant, owner, staff member, affiliate, internal person or engineer**: platform
  channel. A typed helper, the platform layout, send-and-log, the persona that fits.
- **Signup, reset, invite, magic link, email change**: the auth hook handles it. You almost
  never call it directly.

Hard rules:

- **Match the design language. Never invent your own.** Look at a sibling template first.
- **Tables only, no SVG, no double quotes inside `style=""`, equal-height cells, one palette, a
  manage block, verified in a real inbox** (section 9). Every one of those has shipped broken to
  production. None is optional.
- **Never call the provider's send without an adjacent logger.**
- **Never import the mailbox client outside the one send module.**
- **Escape user input** in platform bodies. In tenant bodies the resolver escapes for you; do
  not bypass it by hand-building HTML with raw personal data.
- **No em dashes or en dashes** anywhere in subjects, bodies or copy. They have caused real
  mojibake bugs.

---

## 8. Common "why didn't it work" traps

- **Email not in the activity log:** it was sent without a logger, or the tenant mailbox send
  failed before logging, or it was held (logged only when the drain sends it).
- **Customer got `{{first_name}}` literally:** the guardrail was bypassed, or a variable was
  missing with no fallback and nobody handled the unresolved list.
- **Tenant email silently not sending:** no connected mailbox row, the location's email is
  auto-paused (dead auth), or the daily quota is exhausted. Check the mailbox connection and
  pause state, not the platform provider.
- **Raw HTML showing as escaped tags:** a server-rendered HTML variable is not on the allow-list.
- **Owner not getting the signup email:** section 2.5.
- **Auth emails look like the vendor default:** the dashboard hook (section 4).
- **A planning doc says a piece is "not yet implemented":** docs go stale. Check the code and
  the route mount before believing either the doc or this skill.

---

## 9. How to BUILD email HTML that actually renders (read before writing ANY template)

This applies to every email: platform or tenant, transactional or digest, hand-rolled or
composed from primitives. These rules exist because a scheduled report email shipped to
production that looked fine in a Chrome preview and looked broken in Gmail: no visuals, default
Times font, uneven boxes, no manage block. The owner's review: "The colors look like AI slop.
There are no visuals. Every container is a different size. Did you actually read the email
skill?" Every rule below is one of those defects.

Keep ONE reference implementation in the repo: a data-rich email (KPI grid, bar chart, stacked
bar, a figures table, a manage block) built entirely from table cells. Copy its techniques; do
not reinvent them. Record its path here once it exists.

**1. Email clients are not browsers. Assume the worst client, which is Gmail plus Outlook.**

- **NO inline `<svg>`.** Gmail, Outlook and Yahoo strip it entirely. A chart built as SVG is
  invisible in a real inbox. A Chrome screenshot of the HTML file proves NOTHING about email.
- **NO remote images for anything structural.** Outlook blanks them by default and Gmail
  proxies them. A logo is fine as decoration with a graceful fallback. A chart as a PNG is not.
- **NO `<style>` blocks for anything load-bearing, no `position`, no flex or grid, no CSS
  variables.** Inline styles only, and prefer the HTML attributes Outlook honors: `bgcolor`,
  `width`, `height`, `align`, `valign`, `cellpadding="0" cellspacing="0" border="0"`.
- **Tables are the layout engine.** Every column, every card, every bar is a `<td>`.
  `border-radius` and `box-shadow` are progressive enhancement: the email must look correct
  with them stripped.

**2. Never put a double quote inside `style="..."`.** A font stack with a double-quoted name
(`"Segoe UI"`, `"Times New Roman"`) TERMINATES the attribute. Every declaration after
`font-family` (the size, the color, the uppercase, the letter-spacing) is silently dropped and
the email renders as default 16 px Times. This is the single most invisible bug in email HTML:
the file looks right, the diff looks right, and the inbox is wrong. Use single quotes inside
font stacks (`'Segoe UI'`) and never anything else quoted inside an inline style. Verify in the
browser by reading the attribute back, for example
`document.querySelector('td div').getAttribute('style')`: it must contain the full declaration
list. Do not verify by eye.

**3. Equal sizes, or it looks broken.** Boxes that are each their own nested table will be
different heights the moment one label wraps. Put the cells that must match in the SAME `<tr>`
with the border and padding on the `<td>` itself, so the table row equalizes them for free.
Give every KPI card exactly the same number of lines (label, value, change: always three, with
`&nbsp;` when a line is empty) and short labels that never wrap at 600 px.

**4. Visuals that survive every client (the only techniques that work):**

- **Vertical bar chart.** One `<td valign="bottom" height="110">` per bar. Inside it a one-cell
  table `width="{barW}"` whose `<td height="{h}" bgcolor="{color}">&nbsp;</td>` IS the bar
  (height in px, proportional to the max). Amount labels in the row above, day labels in the
  row below with a hairline `border-top`. Highlight the max in ink.
- **Stacked or horizontal bar.** One `<tr>` with cells whose `width="{pct}%"` and `bgcolor` are
  the segments, `height="14"`.
- **Pie, donut, composition** ("card vs cash", "completed vs cancelled vs no-show"). A 100%
  stacked bar (one `<tr>`, one `<td width="{pct}%" bgcolor>` per segment, a 2 px white
  `border-right` between segments, minimum 2% so a sliver stays visible) plus a legend table:
  a 10 by 10 swatch cell, label, bold value, muted percent. Two of these side by side in one
  `<tr>` reads like a dashboard. This is how the big payment and commerce platforms show
  composition in email. A real pie needs SVG or an image and will not render.
- **Sparkline or line chart.** Not possible reliably. Use bars.
- **Tables of figures.** Hairline `border-bottom` per row, right-aligned tabular numbers,
  `white-space:nowrap`, a bold totals row.

**5. One restrained palette per email, not a rainbow.** The house style for anything premium:
warm ivory page `#F5F1EC`, white card, ink `#1F1B17`, body `#3C3A36`, muted `#8B867B`, hairline
`#E8E1D8`, ONE accent (gold `#9C7A3F`) for bars and eyebrows. Forest `#3F5F3D` and rose
`#A35E5E` ONLY to mean up and down. Serif (Georgia) for the headline and big numerals, system
sans for labels. Colored accent bars per card, emerald, indigo, amber and rose pills, and
component-library-looking chips read as AI output.

**6. Write for the reader you have.** Business owners know what gross profit is. No explanatory
footnotes, no "Here is how {name} did", no singular and plural mismatches ("Appointment done"
when there are 162). Labels are 1 to 3 words. Say the comparison once under the headline
("Compared with the previous week."), then show the change on each card as an up-triangle
(`&#9650;`) plus "11.1% vs prior week" in forest, a down-triangle (`&#9660;`) plus "9.6%" in
rose, or "No change" in muted. When there is no honest percentage (no base, a non-positive
base, values straddling zero) show nothing. Never a wrong arrow.

**7. Every recurring email has a manage block, not a footer link.** A distinct soft panel
(`#FAF7F2`, hairline border) under the card that says what this email is, who it is sent to
(the recipient address plus how many others), and gives two links: manage (schedule,
recipients, contents) and stop. Plus the `List-Unsubscribe` header on the send. A ten-point
"Manage these reports" link at the bottom is not a manage block.

**8. Verify in a REAL inbox before calling it done.** The Chrome preview catches layout; only
Gmail catches Gmail. Use the feature's own "send test" path (or a throwaway script with the
provider key loaded) to your own address, open it in Gmail, then check: fonts and sizes
applied, every visual visible, cells equal, the manage block present. If you cannot send from
your machine, SAY SO and hand the test to the owner. Do not claim it is verified.

**9. A job that emails is live the moment it is deployed, and "uncommitted" is not
"undeployed".** A parallel session's batch commit swept a half-finished scheduled job and its
template onto the main branches, and production emailed 89 account owners a $0 report with no
visuals. Build the guard FIRST (the no-activity skip, the dedupe, the recipient checks), the
send LAST, and check the file's history across all branches before assuming nothing is live.

---

## 10. Writing the emails (provider-independent)

- **One purpose per email.** Two asks means two emails.
- **The subject says what happened**, not a category.
- **The first line repeats the subject in plain words.** Preview panes show about 90 characters.
- **One obvious primary action**, with a plain fallback link below it.
- **Say who it is from and why they received it.** Branded footer.
- **Voice:** write like a person. Short sentences, no jargon, no table or enum names leaking.
- **No em dashes or en dashes.** Comma, colon, or a new sentence.
- **Every email:** working absolute URLs, sane with images blocked, substitution tokens intact.

---

## Related skills

- `error-alert-system`: where send failures land, and why a user-fixable outcome is not an alert.
- `release-announcements`: the monthly update email built on the blasts sub-channel.
- `build-with-the-user-in-mind`: the text-quality bar applies to email copy.
- `security-rls-permissions`: the service-role-only tables above.
