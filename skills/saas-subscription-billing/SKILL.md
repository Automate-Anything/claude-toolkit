---
name: saas-subscription-billing
description: How to model and operate PLATFORM subscription billing for a SaaS (how customers pay YOU for the product) - plans, trials without a card, cancellations and the paid-through grace period, per-seat or per-location subscriptions, add-ons, the three separate "is it alive" signals (processor status vs your active flag vs your dunning phase), one canonical plan resolver, the database invariants that make illegal states impossible, usage overages, test-mode isolation, and how to find and retire ZOMBIE subscriptions that your database calls dead but the processor still bills. Read this BEFORE touching anything that reads, writes, displays or reasons about subscriptions, plans, trials, cancellations, per-unit billing or the billing admin UI; whenever a billing page shows contradictory plan / trial / canceled state; and whenever you see recurring duplicate-subscription or orphan-customer alerts. Use when the user mentions subscriptions, plans, trial, trial end, canceled but still has access, grace period, per-location or per-seat plans, add-ons, MRR, dunning, "two subscriptions", "Trial and Canceled at the same time", a zombie subscription, a subscription still billing after cancel, subscription mirror out of sync, or "which plan is this account on." This is PLATFORM billing only. For a merchant charging their own customers, see pos-checkout-design.
---

# SaaS subscription billing (and retiring zombie subscriptions)

> **Adapt before use.** This describes how platform subscription billing SHOULD be wired. It is
> taken from a production multi-tenant SaaS billing through Stripe, where each of a company's
> locations carries its own plan. Nothing here is wired in your repo yet. Table, column and function
> names are EXAMPLES of the shape. "Location" below is the billable unit: substitute seat, workspace,
> site or whatever you bill per. Once built, replace the names and add a "how it is wired here"
> section.

For Stripe API selection (Checkout Sessions, Billing APIs, restricted keys, webhooks) read
`stripe-best-practices`. This skill covers the data model on YOUR side and the operations around it.

Most "two subscriptions conflicting" bugs are NOT data corruption. They are a UI selector picking
the wrong one of several legitimately coexisting rows. This skill tells you which row is the right
one.

---

## 1. The model in five sentences

1. A **company** is the customer. A company has one or more **billable units** (locations).
2. Subscriptions are **per unit**, not per company: each plan row carries a unit id, and the
   invariant is "every live, billable unit has exactly one ACTIVE plan subscription."
3. There is exactly **ONE processor customer per company** (unique on company id). All of that
   company's per-unit subscriptions bill to the same customer.
4. **Add-ons** (extra phone numbers, extra channels, a paid module) are rows in the same table with
   type `addon`, optionally bound to a unit.
5. A unit can have **more than one plan row at once in the data**. At most one is active (enforced
   by the database); the rest are historical or canceled remnants. Picking the right one to DISPLAY
   is where bugs happen.

**Decide early whether there is a company-level tier. If money is per unit, there is none.** The
source system removed "the company's tier" entirely: tier and money are per unit only. Code that
resolves a "company plan" for feature gating in a per-unit model is a bug. Company-level settings
are fine; they have nothing to do with tier or money.

---

## 2. The subscription row: three "is this alive?" signals

They are NOT redundant. Each answers a different question, and confusing them is the root of most
subscription bugs.

| Field (example) | What it answers | Example values |
|---|---|---|
| `subscription_type` | Plan or add-on? | plan, addon |
| `status` | What does the PROCESSOR say this subscription's state is? | active, trialing, canceling, canceled, incomplete, incomplete_expired |
| `active` (boolean) | Is this OUR canonical "this row is the live one" flag? | true, false |
| `lifecycle_phase` | Where is it in OUR dunning / retention machine? | active, paused, terminated |
| unit id | Which unit does this bill for? | an id, or null for a legacy company-wide row |
| `trial_end` | When the trial ends (null = not a trial) | |
| `current_period_end` | When the paid period ends: the grace boundary for canceled rows | |
| `canceled_at` | When it was canceled | |
| plan id | The plan or add-on definition | |
| plus | cancellation source, billing cycle, trial start, the processor's subscription id, live-mode flag | |

- **`status` mirrors the processor.** It can lag (webhook delay), and it can be `canceled` while
  the subscription still grants access because the period is paid through.
- **`active` is YOUR truth flag** and is what the database invariants enforce. Guards only fire on
  active rows. At most one active plan per unit is guaranteed by a unique index.
- **`lifecycle_phase` is YOUR dunning machine**, independent of status. A row can be status
  canceled and phase terminated (fully dead), or status active and phase paused (a customer in
  dunning who still has access). Do not infer one from the other, and do not collapse them into a
  single boolean.

> **`status = 'canceled'` does NOT mean "no access".** If the period end is in the future and it was
> not a canceled-during-trial, the customer keeps access until that date. They paid for the period.
> This "canceled-grace" row is intentionally kept alive, and it coexists with a NEW live
> subscription.

---

## 3. One canonical resolver

Put "which subscription counts as active" and "which plan governs this unit" in ONE module. Every
billing surface goes through it, on the client and on the server. Never re-implement the logic
inline.

**What counts as "active".** Keep a subscription if ANY of:

1. status trialing AND trial end is in the future. (No trial end recorded: fall back to the active
   flag.)
2. active flag true AND status is active or canceling.
3. status canceled AND period end is in the future AND it was NOT canceled during the trial. This is
   canceled-grace, honored because they paid for the period.

Everything else (incomplete, expired, terminated past its period) is not active.

**Key consequence:** for ONE unit you can get BOTH a trialing or active row AND a canceled-grace row
in the filtered list at the same time. That is correct and intended. The list is not "the one
plan". It is "every subscription that still grants something."

**The tie-break predicate: "truly active"** = active flag true AND status in (active, canceling,
trialing). True for a live, paying or trialing row. False for a canceled-grace remnant. Use it to
pick between coexisting rows.

**Resolve a specific unit's plan** by returning that unit's own active plan row's plan, or null.
NO company-wide fallback. Callers treat null as "no plan, deny paid features."

**Feature gating:** with a unit id, that unit's plan governs. Without one (a gate not tied to a
chosen unit yet), use an explicit ANY-unit rule: allowed if any billable unit's plan grants it.
Name that variant so nobody mistakes it for a company tier.

---

## 4. The number one bug: per-unit selection without the tie-break

This is the failure reported as "two subscriptions conflicting" or "one location shows Trial AND
Canceled at the same time."

**What it looks like:** the page header says "Trial, $X/month after trial" but the card for the same
single unit shows a "Canceled" badge.

**Why:** the unit has TWO plan rows in the active list at once: a trialing row (the live one) and a
canceled row still inside its paid period (kept by rule 3 above). If the per-unit map is built
naively from key/value pairs, two entries share the same unit key and the language keeps whichever
comes LAST, silently dropping the other. Two independent selectors, same unit, different answers.

**The fix:** when building a unit-to-subscription map, never use last-one-wins. A truly live status
always beats a canceled-grace remnant:

```ts
const isLiveStatus = (s) => s === 'trialing' || s === 'active' || s === 'canceling';
const planByUnit = new Map();
for (const p of planList) {
  if (!p.unit_id) continue;
  const existing = planByUnit.get(p.unit_id);
  if (existing && isLiveStatus(existing.status) && !isLiveStatus(p.status)) continue; // keep the live one
  planByUnit.set(p.unit_id, p);
}
```

This is safe because the unique index guarantees at most one active plan per unit. You can never
have two genuinely live plans competing. The only competition is live versus canceled remnant, and
live always wins.

**Whenever you build a unit-to-subscription or company-to-subscription map from a list that can
contain canceled-grace rows, you MUST tie-break. A bare map built from pairs is a bug.** This
applies to any future per-unit, per-company or per-item dedup of subscription rows.

Secondary wording rule: a canceled row with a future period end displays "Access until {date}", NOT
"Renews {date}". It will not renew.

### Different surfaces can correctly use different rules

Several places decide "which subscription, what status", and they do not all use the same rule.
That is fine as long as each surface's rule matches what the surface is FOR. The bug is a surface
whose rule contradicts its own purpose, not merely two surfaces that differ.

| Surface | Honors canceled-grace? | Why that is correct |
|---|---|---|
| Feature gating (access) | YES | A paid grace period still grants access. |
| Quota math | NO | Quotas come from the LIVE plan, not one that is winding down. |
| "What can you buy or change now" | NO | You cannot change plan against an already-canceled subscription. A grace-only company correctly sees "no current plan" there and is routed to resubscribe, while access is still granted by the access gate elsewhere. |

So a plans page showing "no current plan" for a canceled-grace-only company is correct, not a bug:
that page's job is "what is purchasable." The rule: route through the canonical resolver UNLESS the
surface has a purpose-specific reason to differ (quota versus access versus purchasable), and then
make the difference INTENTIONAL and commented.

---

## 5. Database invariants: make illegal states physically impossible

These are why you can TRUST "at most one active plan per unit" and never defend against it in app
code.

| Guard | Kind | Guarantees |
|---|---|---|
| One active plan per (company, unit) | partial unique index | No double plan. |
| One active add-on per (company, item, unit) | partial unique index | No double-billed add-on. |
| An active row needs a processor subscription id | BEFORE trigger, named to fire FIRST | An active row with no processor id is AUTO-CORRECTED to inactive and incomplete. It never throws, which avoids webhook retry storms. |
| An active plan row must have a unit id | BEFORE trigger | |
| An active row must have a period start and end | BEFORE trigger | |
| Hard-deleting a unit deactivates its subscriptions first | BEFORE DELETE trigger | |
| Soft-deleting a unit deactivates its active subscriptions | AFTER UPDATE on the soft-delete flag | Defense in depth against webhook lag. |

All of these act only on active rows. Setting active to false never trips them. That is why
deactivation (cancel, delete) flows are safe.

A design note on the auto-correcting trigger: inside a webhook handler, a constraint that throws
turns one bad event into an endless retry storm. Prefer correcting the row to a safe state over
raising.

---

## 6. The dunning / lifecycle machine

Independent of processor status. Rough flow: active, then (payment problems) paused with reminder
emails, then terminated. The operator-facing "subscription dead" gate reads the lifecycle phase on
active rows.

Decide whether you offer a MANUAL pause. The source system removed its admin "pause subscription"
feature: to stop billing a non-paying company, downgrade to the free plan rather than pause. Then
"paused" means only "in dunning", with no ambiguity.

---

## 7. How money moves

### Trials without a card, created server-side

A new company's trial can be created directly on the server with the processor's subscription-create
call: no checkout session, no card, no redirect. The user never sees the processor at signup. They
meet it only when they actually buy something. Consequences to design for:

- **The signup code does not write your subscription table. The webhook does, seconds later.**
  Anything that reads subscriptions immediately after signup must tolerate that window. Pattern:
  key off a column on the company that IS stamped synchronously at signup (for example "initial
  plan selected at"), not off the subscription row.
- **Set the trial's "missing payment method" behavior to CREATE AN INVOICE, not cancel or pause.**
  On Stripe, cancel and pause never create an invoice. If your card-free downgrade is driven by the
  "invoice payment failed" event, changing this setting silently breaks trial expiry.
- **Both creation paths exist.** Hosted checkout is still used for real purchases (upgrades,
  add-ons, adding a unit). Never assume a subscription came from checkout.

### The rest

- Plan and add-on subscriptions bill to the company's one customer. Webhooks sync subscription,
  invoice and checkout-completed events into your subscription and transaction tables.
- **Usage overages** (minutes, messages, AI usage) are metered into a usage table. A daily billing
  job deducts from the company's prepaid balance through ONE atomic function that deducts and marks
  billed in the same transaction, claiming the rows before deducting so it cannot double charge.
- **MRR snapshots** are written nightly, filtered to: status active, lifecycle active, live mode,
  trial expired.

---

## 8. Live mode and account isolation

- **Tag every subscription, billing-settings and transaction row with a live-mode flag.** False
  means a test-mode object or one from an old or foreign processor account. Exclude it from billing
  automation, admin revenue views, MRR and orphan alerting. Always filter live mode on aggregate and
  revenue queries.
- **Platform billing and merchant payments are 100 percent isolated.** If your product also lets
  customers charge THEIR customers (a connected-accounts model), that uses different credentials,
  different tables, and a SEPARATE webhook endpoint and secret. Those never write the platform
  subscription, balance or transaction tables. As a structural backstop, the platform webhook
  rejects any event that carries a connected-account id.

---

## 9. Checklist before touching subscription code

1. Am I reading PLATFORM billing or MERCHANT payments? Different tables entirely.
2. Will my code build a unit or company map from a list that can contain canceled-grace rows?
   Tie-break it. Never a bare map from pairs.
3. Am I treating canceled status as "no access"? Wrong. Check the period end and
   canceled-during-trial.
4. Am I conflating status, the active flag and the lifecycle phase? They answer different questions.
5. Am I re-implementing "which plan is active" inline? Use the resolver. Do not fork it.
6. Am I aggregating revenue or MRR? Filter live mode.
7. Did I verify against the LIVE database rather than assumptions? A reported "two conflicting
   subscriptions" is usually one live plus one canceled-grace, not corruption.

---

## 10. Zombie subscriptions: find them and retire them

The owner model, which is load-bearing: **exactly ONE active plan per (company, unit). Every other
plan row is HISTORY and MUST ALSO be terminal (canceled) at the processor.** A past subscription
that is still active and billable at the processor is a **zombie**. It keeps firing subscription
webhooks, trips the one-active-plan invariant, and generates recurring alerts. Your webhook guards
keep YOUR end state correct, but they cannot retire the zombie at the processor.

**Why the guards alone were not enough.** One cleanup job cancelled leftover subscriptions only for
manually disabled companies. Customer-creation code only prevented NEW duplicate customers. The
webhook path cancelled the OLD subscription when a NEW one superseded it, going forward. Nothing
retired a stale subscription for an ALIVE company: historical zombies that pre-dated the guard, or
whose cancel had failed silently, were never cleaned up.

Symptoms that point here: recurring "plan invariant blocked a duplicate" alerts, "non-mapped
customer" alerts, "ignored test-mode subscription" alerts, "orphan customer" alerts, or a company
showing two subscriptions for one unit.

### The rules

- **One active plan per unit.** History rows are fine in your database. A history subscription
  still LIVE at the processor is the bug.
- **Never cancel a customer's real plan.** The cancel tool REFUSES a subscription whose mirror row
  is still active, unless a force flag is passed. Do not force without proof the row is stale.
- **Dry-run before you cancel.** Cancel is dry-run by default. Read the output, confirm it is a
  zombie, THEN confirm.
- **One subscription per call.** No bulk cancel. Retire zombies individually, by exact id.
- **Trust the key-mode warning.** If every retrieve failed, the deployed key is the wrong mode or
  broken and the findings are meaningless. Do not act on them.

### Build this tool once

Deployed internal endpoints plus a script that calls the deployed URL, so nobody needs a production
shell. Same shared-secret header as the payment verification tool in
`payment-processor-integration-checklist`. Fail closed: no secret configured means 503.

**1. A READ-ONLY report.** For every real processor subscription id you hold for an ALIVE company,
retrieve it from the processor and diff live status against your mirror. Scope it to one company
(fast, for triaging a single alert) or cap the number scanned. It returns four buckets:

- **zombies:** your row says inactive, the processor says live and billable. Retire these.
- **mirror stale:** your row says active, the processor says canceled or gone. YOUR row is wrong (a
  webhook was missed). Do NOT cancel anything: there is nothing to cancel. Resolve with the
  customer-subscriptions lookup below.
- **scatter:** one unit with more than one PLAN subscription live at the processor at once. True
  duplication. Exclude add-ons: a plan and a separately purchased add-on legitimately coexist.
- **skipped non-processor ids:** seed and demo rows whose ids are not real processor ids. Filter
  them out so they never show as false findings.

If EVERY retrieve fails, raise an escalating "blind" alert AND return a key-mode warning in the
response.

**2. A cancel endpoint, dry-run by default.** Without an explicit confirm it cancels nothing and
shows what would happen. With confirm it cancels at the processor AND makes your mirror row
TERMINAL: inactive, status canceled, canceled-at now, **period end set to NULL**, and a cancellation
source of "admin action".

- **Clearing the period end is essential.** A canceled row with a future period end still counts as
  an active grace-period plan in your own "what is active" filter. Without clearing it, the retired
  zombie would STILL show as a second active plan for the unit.
- **The "admin action" source avoids sending the customer a "downgraded due to failed payment"
  email.**
- It refuses with a conflict if your row is still active, unless force is also passed.
- A cancel failure reports one alert, and the mirror is only synced when the processor cancel
  succeeds, so no inconsistent state is left.

**3. A READ-ONLY customer-subscriptions lookup.** The resolution path for a mirror-stale finding.
List what a company ACTUALLY has live at the processor: subscriptions under its mapped customer AND
subscriptions found by searching metadata for the company id. The second search catches
account-migration scatter, where the live subscription sits under a DIFFERENT customer than the one
you mapped. That is the exact reason a mirror row reads "not found."

Always stamp your own company id (and unit id) into subscription metadata at creation. It is what
makes this search possible.

### The playbook: from a scatter alert to a clean board

1. **Identify the company** from the alert metadata.
2. **Report, scoped to it.**
3. **Read the buckets:**
   - Zombies present: these are the recurring-alert source. Dry-run each, confirm it is a past
     subscription and not the unit's current plan, then confirm.
   - Mirror stale present: your row says active, the processor says gone. Run the customer
     lookup to see what the company really has live. If the live subscription sits under a different
     customer, repoint the mirror row to the real subscription or re-map the canonical customer. If
     the customer genuinely has NO live plan, that unit is billing nothing. That is customer-facing:
     escalate.
   - Scatter present: two live subscriptions for one unit. The NEWER is almost always the real plan
     and the older is the zombie. Verify before cancelling.
4. **Re-run the scoped report.** It should come back clean.
5. **Resolve the alerts.**

### Know which reconcile surface a symptom belongs to

| Surface | For |
|---|---|
| Subscription scatter (this section) | PLATFORM subscriptions: zombies, stale mirror rows, per-unit duplication |
| Connected-account orphans | Merchants' own processor accounts that are orphaned |
| Customer card-charge truth | Did a CUSTOMER's card charge capture, is it voided, was it double charged. See `payment-processor-integration-checklist`. |

## Related skills

- `stripe-best-practices`: API selection, keys, webhooks.
- `payment-processor-integration-checklist`: the sibling read-only verification tool for charges.
- `pos-checkout-design`: merchant-customer payments, a separate domain.
- `error-alert-system`: how these surface as alerts and how to resolve after reconciling.
