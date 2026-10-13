---
name: memberships-and-packages-design
description: How to design the two prepaid / recurring entitlement systems a service business sells to its own customers - recurring MEMBERSHIPS (a plan charged every period that grants facility access, visit or service credits, and member discounts) and prepaid PACKAGES (a session pack bought once and drawn down through an append-only usage ledger). Covers the data models, the counter invariants, the three-state view of a credit (available / scheduled / redeemed), automatic coverage when an appointment is booked and every reason it must NOT fire, the pay-down gate that unlocks sessions in proportion to what was paid, reversals and returns, no-show and refund policy resolution, expiry, transfers, renewal and dunning, saved-card routing, one-time plans, cancel / pause / swap, member check-in by code, QR, RFID fob or biometrics, check-in blocks with a manager override, group classes, signup waivers and door access. Read this BEFORE building or changing memberships, membership plans, renewals, member check-in, packages, session packs, punch cards, class passes, credit redemption, "covered by package", or any ledger of prepaid sessions. Use when the user mentions memberships, plans, recurring billing for customers, dunning, past due, facility access, check-in, QR or barcode check-in, fob, packages, sessions, credits, punch card, redeem, reserve a credit, auto-cover, quantity remaining, scheduled vs used, package expiry, or cross-location redemption. Not for the SaaS's own subscription billing (see saas-subscription-billing).
---

# Memberships and packages design

> **Adapt before use.** This describes how memberships and prepaid packages SHOULD be wired. It is
> taken from a production multi-location booking and POS platform. Nothing here is wired in your
> repo yet. Table, column and function names are EXAMPLES of the shape, because the shape of the
> data model is often the lesson. Once built, replace them with your real names and add a "how it
> is wired here" section.

Both are **credit ledgers** in the money system, alongside gift cards and store credit. Read
`pos-checkout-design` for how a credit is recorded as a tender and restored on reverse, void and
refund. Read `commission-system-design` for how anyone earns on them. This skill covers the
entitlement itself.

The two are deliberately SEPARATE objects. A package is bought once and runs out. A membership
recurs and resets. Do not merge them into one "credits" table: their billing, their expiry and
their reversal rules differ, and every gym or studio feature added later lands as a new field on
one or the other with a default that leaves other businesses unchanged.

---

# Part 1: Prepaid packages

A package is a prepaid pack of sessions a customer buys once and draws down over time ("10 sessions
full body", "5-pack facials").

## 1. The data model

Two layers: a **template** (the sellable product) and, when someone buys, a **sold package** owned
by a customer, with **items** (per service or product lines) and an append-only **usage ledger**.

| Table (example) | What it is | Key columns |
|---|---|---|
| package templates | The sellable product, scoped to company and location | name, price in cents, validity days, active, SKU, sell-online flags, "expires from" rule, taxable, refund policy, no-show policy, commission mode, deposit mode, sibling group id (the same template across locations), soft delete, import markers |
| template items | The lines of a template | item type (service or product), the item id, quantity, unit price, is-bonus, "starts at session N", duration |
| sold packages | A package owned by a customer | customer, name, purchase price, status, purchase order id, purchase payment id, expires at, template id, location, revenue earned so far, payment settled, soft delete, import markers |
| sold package items | **The counters.** The per-line balance | package id, item, quantity included, quantity used, quantity remaining, unit value, is-bonus, starts at session, duration |
| usage ledger | **Append-only.** One row per redeem, reserve or reversal | package, package item, appointment id, order line id, quantity used, value used, reversal-of id, notes, used at |
| coverage pending | A "cover when paid" queue: a covered checkout line whose package is not yet paid enough to unlock | order, order line, package, item, quantity, expected amount, settled at |

### The core counter invariant

```
quantity_remaining = quantity_included - quantity_used      (per item, always)
quantity_used >= 0,  quantity_remaining >= 0,  quantity_used <= quantity_included
```

`quantity_used` is the counter. Every consume increments it and decrements remaining. Every
reversal writes a NEGATIVE usage row and moves the counters back. Revenue earned on the package is
clamped to between zero and the purchase price in every function that touches it.

After ANY change to a package function, verify the invariant across the whole database: zero items
with remaining below zero, used below zero, used above included, or remaining not equal to included
minus used.

### The usage ledger is APPEND-ONLY, with a hard guard

Triggers block UPDATE and DELETE on the usage table. You never edit or delete a usage row. To undo
a consume you INSERT a reversal row that points at the original and negates its quantity and value.
A reversed pair nets to zero, and both sides are hidden from history readers.

### Lifecycle status

`awaiting_payment` (sold, unpaid, redemption hard-blocked), then `active`, then `depleted`,
`expired`, `cancelled` or `transferred`. A cron flips past-expiry packages to expired. A trigger on
the order flips awaiting to active when the purchase order becomes paid or waived. Display labels
(Not redeemed / Partially redeemed / Redeemed) come from ONE helper, and that helper must be
scheduled-aware (next section).

## 2. The THREE-STATE model (every reader must get this right)

If a credit is consumed the moment a covered appointment is BOOKED, the raw used counter mixes
delivered sessions with upcoming reservations. So every surface that shows a package splits it
three ways:

```
Available  = quantity_remaining              (free to book)
Scheduled  = committed to a FUTURE, not-yet-delivered appointment (a reservation)
Redeemed   = quantity_used - Scheduled       (actually delivered; clamp at 0)
Available + Scheduled + Redeemed = quantity_included
```

- ONE function computes this, and one shared readout component displays it (dim zeros rather than
  hiding them, so the layout never jumps).
- "Scheduled" per item = the sum of non-reversed usage rows whose appointment is in the future and
  whose status is not passed, completed, cancelled or no-show. Invariant to verify: scheduled never
  exceeds the used counter, so Redeemed never goes negative.

**Any reader that shows "used" from the raw counter OVERCOUNTS delivered sessions.** It counts
upcoming reservations as delivered. This was a real bug class, fixed in a badge, a customer-portal
"visits used" line, a usage report and a per-item progress bar. A new package reader that is not
fed "scheduled" ships the same bug.

## 3. How a credit gets consumed

**Path A: manual, at checkout.** The operator adds a covered item and the package-credit tender
redeems it. See `pos-checkout-design`. Have a system redeem primitive and a permission-gated one.

**Path B: AUTOMATIC when the appointment is booked.** The point: a package-covered appointment
reads "Covered by package" from the instant it is booked, never "payment due". Make it a
per-location setting with these values:

| Setting | At booking | At delivery | On cancel or reschedule |
|---|---|---|---|
| **creation** (a good default) | Reserve the credit (a usage row with no order line yet) and create a PAID order at commit. Shows as Scheduled, never unpaid. | Already settled. | Released if policy says return (section 6). |
| **start / finish / completed** | Nothing | An hourly job settles it when the appointment starts, when its end time passes, or when it reaches a completed status. | Clean: nothing was reserved. |
| **manual** | Nothing | Nothing | Not applicable. The operator applies the package at checkout. |

Resolve the setting through one helper: the explicit per-location value wins, then any legacy
boolean, then manual.

The triggers on the appointment's service lines:

- **Reserve on insert.** Acts only in creation mode. Idempotent: it will not double-reserve the same
  appointment and service. Best effort: a failure is logged and never blocks the booking.
- **Create the order, DEFERRED to commit.** Make it a deferred constraint trigger so it fires once
  every service row exists. A multi-service appointment then gets ONE order, not a partial one.
- **Release on delete or on a change of service.** Releases a stranded reservation when a covered
  service is REMOVED or SWAPPED on a live appointment. Before this existed, editing a covered
  appointment silently lost the customer's session. It reconciles per service (remove one of two,
  release exactly one), does NOT fire on a pure reschedule, and NEVER releases a SETTLED credit.

The full settle function attaches or redeems the credit, creates the order and a package-credit
payment whose metadata carries the usage id for later reversal, and marks the appointment paid. It
is idempotent (it returns "already settled" instead of creating twice), so the hourly job can
safely re-sweep creation-mode locations as a self-heal for a create that failed at booking.

### The pay-down gate (applies to both paths)

A credit can be redeemed only to the extent the purchase order is PAID.

```
paid_pct       = settled ? 1 : no purchase order ? 1 : (total > 0 ? amount_paid / total : 1)
unlocked       = floor(paid_pct * quantity_included)     (bonus items: fully unlocked, a gift is not payment-gated)
redeemable_now = max(0, min(quantity_remaining, unlocked - quantity_used))
```

A 10-pack paid 50 percent unlocks 5 sessions. A covered appointment whose package is not paid down
enough is NOT auto-reserved. It goes into the coverage-pending queue, and a trigger on payments
redeems it when enough money lands. A sweep heals rows that stranded mid-settle.

## 4. When packages do NOT apply. Memorize these.

A package silently does NOT cover or auto-reserve when any of these is true:

- The appointment is a **walk-in with no customer**.
- The appointment is **imported or calendar-synced** (any import batch id, source system, external
  event id or external id). **A bulk import must never drain credits.** For imported history a
  package SHOULD cover, a reconcile function handles the unambiguous cases and the ambiguous ones
  surface in a review screen with plain-language recommendations.
- The package is **not active**, or is **expired**.
- **The pay-down gate:** nothing is redeemable right now.
- **The cross-location gate:** when cross-location redemption is off (it was off for nearly every
  company), a package pinned to a home location covers only appointments at that location. A
  package with no location is unrestricted. Apply the gate in BOTH the reserve trigger and the
  availability function.
- The setting is manual.
- Bonus items bypass the pay-down gate but obey everything else.
- **Session-index add-ons:** a template item with "starts at session N" becomes available only at
  the Nth redemption.

## 5. Selling a package

List every path that creates a sold package: at the register, online storefront (guest or
logged-in), sold directly to a customer, an ad hoc custom package, and the import. Each must write
the package, its items, its purchase order and its payment consistently (see the mint-path rule in
`pos-checkout-design`). The import sets the import markers so auto-cover skips those rows. A
trigger stamps the location on insert.

## 6. No-show and refund policy resolution

One helper returns both policies, each with the same precedence: **template override, then the
per-location setting, then the company default, then a literal default** (`consume` for no-show,
`never` for refund).

- The per-location column is nullable, meaning "inherit". The settings screen shows the EFFECTIVE
  per-location value, so a dead or contradicting company row can never silently mislead. That exact
  contradiction was live: the company default said consume while every location said return.
- **The company settings row is not guaranteed to exist.** Only about half the companies had one.
  The literal default at the end of the chain is load-bearing.
- **Cross-location coverage resolves policy by the APPOINTMENT's location**, not the package's
  home. The location where the service was rendered owns the no-show and refund decision.
- No-show policy values: `consume` (keep the credit), `return` (give it back), `ask` (prompt the
  operator).

## 7. Reversals and returns

Four release paths, one per event. All write a NEGATIVE usage row, restore the counters and the
revenue-earned figure (floored at zero), and revive a depleted package.

| Event | Gate |
|---|---|
| Appointment CANCEL or no-show | Policy says return. Also reverses ORPHAN reserved credits (reserved, no order yet). |
| A service REMOVED or SWAPPED on a live appointment | Only reserved-not-settled credits; per-service reconcile. |
| Order REFUND | A FULL refund back to the original method only. A session is indivisible, so a partial-dollar refund does NOT return it. By design. |
| Payment VOID | Void is always full. |

All are idempotent: a usage row that already has a reversal is skipped. Two self-heal crons catch
anything that stranded (credits owed but not returned on cancel; cover-when-paid rows stuck
mid-settle), and both route real failures to engineering alerts.

**The permission-gated return function is UNSUITABLE to call from a trigger.** If "return credits"
requires an elevated permission, a front-desk user editing an appointment would be blocked.
System-initiated releases do the reversal INLINE in system context.

### The completion gate: auto-covered appointments do NOT auto-complete

An appointment covered at booking is marked paid before the visit happens. A separate "auto-complete
paid appointments" feature would then flip it to Completed purely because time passed, burning the
session for a visit no human confirmed. So:

- Both auto-complete paths SKIP an appointment whose order carries a package-credit payment stamped
  as an auto-checkout. It waits for a human to mark it Completed. The calendar shows a "Confirm
  completion" badge on past, un-completed, auto-covered tiles.
- On cancel or no-show of an UN-completed covered appointment, the SESSION is returned regardless of
  the no-show policy. A session that was never delivered has nothing to "consume". The return policy
  still does the full reversal; consume and ask use a credit-only release (no money moved, and it
  voids the pure-package order only when there is no real money on it).
- That stamped payment is the canonical "this appointment was auto-covered" signal. Reuse it. Do
  not invent another.
- Widen the self-heal sweep to match whenever you widen the live rule.

## 8. Transfers

Transferring remaining credits to another customer creates the recipient's package with NO purchase
order and a price of ZERO. It is not a sale, so reports and commission never double count.

- Keep lineage in two columns: the immediate parent, and the ORIGINALLY SOLD package, stable across
  A to B to C chains.
- **Resolve "how was this paid for" through the origin**, never by copying the order onto the child.
- **A refund or void of the original sale cascades**: it also cancels packages whose origin was sold
  on that order. Both confirm dialogs name the recipients before the operator confirms.
- The pay-down gate reads a child as fully paid (no order). That is correct ONLY because a transfer
  requires 100 percent paid and the cascade cancels the child if the money later goes back. If you
  ever allow transferring a partly paid package, the gate must read the origin's order.
- An original with every credit transferred and none used here becomes "transferred". One with some
  sessions used stays "depleted".

## 9. Package landmines

- A reader that shows raw "used" over-counts delivered sessions.
- A new appointment-edit path must go through the service-line delete and update so the release
  trigger fires. A raw counter change elsewhere bypasses it.
- The usage ledger is append-only. Insert a reversal.
- Do not call a permission-gated return from a trigger.
- Auto-cover skipping imported, synced and walk-in appointments is BY DESIGN. Do not "fix" it.
- Respect the cross-location gate in every new query, or you leak a credit across locations or fail
  to cover a legitimate one.
- **The order is created at COMMIT.** Inside a single transaction, or a rolled-back test, the order
  does not exist yet. The reservation with no order is the in-flight state.
- Commission triggers live on the package tables. Do not disturb them.

---

# Part 2: Recurring memberships

A membership is a recurring plan a customer subscribes to with the merchant. It grants some mix of
**facility access** (walk in and check in), **visit or service credits** per period, and **member
discounts**.

## 10. The data model

A **plan** (the sellable product) and, when someone subscribes, a **sold membership** owned by a
primary customer, with optional **family members**, a **visit log**, an append-only **credit
ledger**, and **coverage and benefit** junctions.

| Table (example) | What it is | Key columns |
|---|---|---|
| plans | The template. One row PER LOCATION, siblings joined by a group id. | price, billing interval and count, billing anchor day, first-period charge rule, plan type, visits per period, rollover policy, maximum banked credits, max members, credit sharing, blackout rules, trial days, cooling-off days, mid-period credit policy, retail and service discount percents, setup fee, minimum commitment, early cancellation fee, tax mode, online purchase mode, active, auto-renew, redemption mode |
| memberships | A SOLD membership | primary customer, plan, HOME location, status, payment processor and method and processor account, period start and end, next renewal date, last charged, last failed, failed count, banked credits, period credits used, trial / cooling-off / commitment end dates, cancel at, cancelled at, pause resumes at, price override, last decline reason and category, signup order, member code |
| membership members | Family members on one membership | customer, is primary, per-member credits used, added, removed (soft) |
| visits | The check-in log | membership, customer, location, check-in method, checked in by, in and out times, notes |
| credit ledger | Append-only signed ledger | change type (redeemed, refunded, expired, rollover, period grant, manual adjust), signed amount, appointment, visit, order, REDEEMING location, service id, notes |
| plan services | Which services a plan's credits cover. **An EMPTY set means it covers ALL services.** | plan, service, plus optional per-service caps |
| plan benefits | Dynamic benefits: discount, member price, fee waiver, each with a scope | |
| consent log | Signup consents: the recurring-billing disclosure, terms, cancellation policy | text version, text snapshot, accepted at, IP, user agent, signup source |

**Plan type, the kind of entitlement:**

- `facility_access`: consumed by CHECK-IN. Visits per period null means unlimited (log a visit, move
  no credit). A finite number makes it a punch card.
- `service_credits`: consumed by a "pay with membership" tender at checkout and by auto-settle.
- `hybrid`: both.

**The entitlement matrix:**

- N credits for covered services = visits per period N, plus rows in plan services (or empty for
  all).
- Unlimited of a service = visits per period null, plus a plan-services row. Redemption logs a
  visit or a zero-amount ledger row and decrements nothing.
- A discount on something = percent columns and/or a benefits row.

**Counters.** A shared-pool credit cache on the membership (floored at zero everywhere) and a
per-period usage counter. For per-member plans the counter lives on the member row. The ledger is
append-only in spirit: every consume writes a signed row, a refund writes a refunded row, nothing is
edited or deleted.

**A reconciler that overwrites the cached balance with the ledger sum** is correct for a shared pool
ONLY because period turnover nets out (expired is negative, rollover is zero, the period grant is
positive) and cover rows net (redeemed minus one, refunded plus one). If a per-member plan writes
period grants but never touches the shared cache, its lifetime sum drifts that reconciler. Know
which branches your reconciler actually covers.

**Status:** trialing, active, then past due (after the final dunning attempt), paused (with a
resume date) or cancelled.

## 11. Per-location scoping

A plan is one row per location. Helpers copy, mirror and push a plan across locations, with a
preview first.

Cross-location check-in and redemption is gated by a company switch plus the membership's home
location. Off: a member checks in and redeems only at home. Give the owner a bypass in the staff
function and NO bypass in the customer self-service one. **Make the home location immutable after
it is set**, with a trigger. Record the REDEEMING location on every ledger row so you can report
"paid at A, used at B" separately from "sold here".

## 12. Identifying a member at check-in

Support several credentials and let every scan handler accept ANY of them.

- **A short stable member code** (8 unambiguous characters, unique per company, assigned by
  trigger), rendered as a 1D barcode plus the readable number. This is the primary path: any
  hardware barcode scanner reads it, and staff can type it. WHY a short code: a signed token is
  well over 100 characters, which is QR-only. A plain laser scanner cannot read it.
- **A signed, short-lived token as a QR** (an HMAC valid for about 5 minutes), for phone cameras
  and 2D imagers. Resolve the owner server-side so a customer cannot request another member's
  token.
- **An RFID fob or card.** A USB reader that emulates a keyboard "types" the chip's id and Enter
  exactly like a barcode scanner, so it flows through the same always-on scanner listener with zero
  new hardware integration. Fobs and cards are one implementation. Normalize the id, make it unique
  per company while active, soft-deactivate lost ones so the id can be re-issued, and make the
  table writable only through functions.
- **Dispatch in the scan handler:** a value shaped like a token goes to token verification;
  otherwise try the member code, then the fob id. Record which method was used on the visit.
- **Keep the namespaces DISJOINT at the writers:** adding a fob rejects an id equal to a live
  member code, and code assignment avoids active fob ids. A value then resolves to at most one
  member.
- **A global scanner-capture lock.** While an enrollment dialog is listening for a tap, any
  always-on scanner on the same page stands down, so the tap is not processed twice.
- Offer credential enrollment at signup as well as on the customer's profile.
- Re-point credentials when two customer records are merged.

**Biometrics, if you add them:**

- **Face, on-device.** The camera frame never leaves the device. Self-host the models (never a
  CDN). Gate with liveness and anti-spoof. Store only an embedding, never readable by the client.
  Identify one-to-many WITHIN A LOCATION only, with a conservative threshold AND a runner-up gap
  guard, and NEVER guess: fall back to another method. Put the matcher behind a swappable
  interface and compare only SAME-version templates, so changing the engine forces re-enrollment
  rather than a false match.
- **Consent is its own append-only legal record** with versioned text. Enrollment requires FRESH
  consent (within the hour and not superseded by a withdrawal). The business owner's one-time
  acknowledgement is separate from each member's consent, and is stamped server-side by a trigger.
- **Withdrawal hard-deletes** and is available to the operator AND to the member themselves.
- **Retention:** a daily job hard-deletes templates N days after the membership reaches ANY lapsed
  state. The first version keyed on "cancelled" only and orphaned templates forever for past-due
  and expired members.
- **Fingerprint through passkeys (WebAuthn).** The fingerprint never leaves the device's secure
  hardware. You store a public key, a credential id and a counter: no biometric data, a lighter
  legal footprint than face. Check-in is a usernameless assertion: the browser reports which
  credential signed, and you map credential to member.
- **Keep the gate simple.** A two-level company-plus-location gate was collapsed to a single
  per-location toggle. A gate function called WITHOUT a location returned "disabled" and dead-ended
  enrollment: always pass the location.

## 13. How entitlement is consumed

**Path A: facility check-in.** A privileged, permission-gated function validates: memberships
enabled at this location, status active or trialing, plan type facility or hybrid, blackout rules,
per-location coverage through the sibling group, and cross-location scope. Then: unlimited inserts
a visit only; finite inserts a visit plus a minus-one ledger row and decrements. A customer
self-service twin resolves the one eligible membership and has no owner bypass.

**Path B: "pay with membership" at checkout.** For service-credit and hybrid plans. The operator
picks the membership and which unpaid service lines it covers (coverage respects plan services;
empty means all). At finalize, a redeem function writes the ledger row linked to the appointment
and order, and decrements. **If your "create the sale" function cannot safely back this tender,
make it REFUSE it** rather than add a half-wired branch: redemption is then orchestrated through
the redeem function plus the "add a payment" path. And widen the payment-method CHECK constraint.
This tender was broken platform-wide because the constraint omitted the method (see
`pos-checkout-design`).

**Path C: auto-settle after the visit.** A job sweeps passed or checked-in appointments and, BEFORE
charging the card on file, tries to settle by membership. It only does so when the customer is an
active member with a covering credit AND a per-location switch is on AND a recurring-billing
consent row exists. Then it redeems and marks the appointment paid, skipping the charge.

**Optional: auto-cover at booking, per plan.** A plan-level redemption mode: `pay_at_checkout`
(nothing happens at booking) or `auto_cover_at_booking`. In the second mode, triggers mirror the
package ones, with these differences:

- No order is created, so no deferred trigger is needed. **"Covered by membership" is DERIVED** from
  a live, non-reversed redeemed ledger row linked to the appointment. Do not look for an order.
- Idempotency, cover and release are keyed on (appointment, service), with the service id stored on
  the ledger row, so a multi-service appointment covers each covered line and removing one service
  releases exactly that line.
- Release on cancel or no-show ONLY if the appointment was not already completed. A delivered visit
  keeps its credit.
- The same gate-outs as packages (no customer, synced, imported).
- **Do not alert engineering on by-design "not covered" outcomes** (cross-location, blackout, no
  credit, inactive). Only genuinely unexpected errors are logged as errors.

Refunds find the un-refunded redeemed row and write a refunded row that restores the credit,
floored at zero. A manual adjust requires a note and an elevated permission.

## 14. Member discounts

One resolver returns, for a customer: the retail and service percents (the MAX across the plan's
percent columns and any percent benefit rows), plus arrays of benefits, member prices and fee
waivers (for example a card-surcharge waiver). The cart applies it to the rest of the cart and
persists it on the order as a member discount amount. It is SEPARATE from the credit tender and
from signup: all three can appear on one order. Refund math must account for it (see the member
discount caveat in `pos-checkout-design`).

## 15. Billing, renewal and dunning

- **The engine is a cron.** Select active memberships that are not on manual billing and whose next
  renewal date has arrived, and charge only at a fixed local hour in the home location's timezone.
  Fail CLOSED if the timezone cannot be resolved.
- **Route a saved card to the CARD's home processor account, never by location routing.** Each
  membership stores its own processor, method and account. A recurring charge sent to whichever
  processor the location currently defaults to will fail when that differs from where the card was
  saved. This rule applies to every recurring and auto-billing job.
- **Idempotent per period.** Derive the charge's request id from the membership id and the date.
- **On success:** write a paid order with a renewal source plus its payment, send the receipt,
  advance the period (anchor-day logic for fixed-day plans, otherwise interval times count), and
  grant the new period's credits. Turnover follows the rollover policy (none, limited, unlimited),
  capped at the maximum banked, and writes expired, rollover and period-grant ledger rows.
- **On failure (dunning):** a shared failure engine with a default of 4 attempts at +2, +4 and +7
  day gaps, configurable per location, pushing the next renewal date forward each retry. After the
  final failure the status flips to past due and stops. Recovery needs a card update and a retry.
  Notify the customer by SMS and email, and alert the operator.
- **Manual billing** means the merchant collects renewals themselves. The cron never touches those,
  deliberately, to stop perpetual dunning noise.
- **One-time plans need a first-class flag.** Without an auto-renew flag, every non-manual active
  membership charges forever, and the only workarounds are manual billing or a scheduled cancel.
  With auto-renew false, the writer sets no next renewal date at signup and the cron also filters
  on the flag.
- **Cancel, pause and swap are app-orchestrated**, shared between staff and customer self-service:
  charge the early cancellation fee, respect the cooling-off refund and the commitment end, cancel
  now or at period end. Swap changes the plan and optionally resets credits. No database trigger
  enforces these, so every entry point must use the one service.
- **Bank debits** add a pending state. See the delayed-settlement section in `pos-checkout-design`.

## 16. Check-in alerts and blocks

One function returns alerts for a customer at a location, each with a code and a level (block or
warn): past due, failed charge, no card on file, required form missing. Each is a per-location
switch, ALL default off.

- Every check-in function (staff, self-service, API) raises a specific "check-in blocked" error
  with the codes when a block applies.
- The ONLY bypass is a dedicated override function that needs an elevated permission, sets a
  transaction-local flag the check-in function reads, and stamps the visit's notes with the codes
  and the reason.
- A data-layer gotcha that hid every one of these messages: a database client can reject with an
  error OBJECT that is not an instance of the language's Error class. Read the message off the
  object, or the UI shows only its generic fallback.

## 17. Additions for gyms and studios

Put everything gym-specific behind one gate keyed on the business type, so other businesses never
see it.

- **Group classes are NOT appointments.** Separate tables for the class series, the sessions, the
  attendees, standing enrollments and the waitlist. A reservation is roster only. The membership
  credit is consumed at class CHECK-IN, not at reservation. Class check-in enforces the same block
  switches and has its own manager override. Editing a series re-times its unheld future sessions;
  deleting a class service cancels its future sessions. Merging customers re-points attendees,
  waitlist and enrollments.
- **Per-service caps on a plan:** a visit limit with a cadence (week, month, billing period), guest
  visits and a rollover maximum. Use fixed, epoch-anchored windows, and one allowance function that
  returns capped, limit, used, remaining and window. If the junction table has no update policy,
  the client replaces a changed cap with delete plus insert.
- **A signup waiver.** A form can be required at JOIN time. Hook it into the ONE function that
  creates a membership, so every signup path (staff, register, public, cart, paid link) gets it.
  It creates the fill request or reuses an open one, skips forms the customer validly signed, and
  texts the link unless the caller defers delivery to offer "sign here now, text a link, or send to
  kiosk." Online, show the forms inline before the card step and have the public signup REFUSE with
  a "waiver required" conflict if unsigned: a writer-side guarantee, not just a UI step.
- **Door access.** Turn entitlements into physical access with doors, rules and grants (one open
  grant per door and person, with a sync status for the hardware connector and a full audit). One
  function computes a member's door set, and it is the truth: only active and trialing memberships,
  including family members, open doors. Past due, paused and cancelled do not. **Access follows
  what was PAID.** A trigger on membership status reconciles the delta, and is a no-op for
  companies with no doors. Do NOT build a second entitlement store for doors.

## 18. Membership landmines

- **A consumption layer that is built but dormant proves nothing.** If the visit and ledger tables
  are empty in production, a passing typecheck is not proof. Smoke-test every check-in and redeem
  path you touch in a scratch flow.
- **A branch that exists in every function but has never run live** (per-member credit sharing with
  several members) is untested. Say so before building on it.
- **Look at the status distribution before assuming.** In the source data most memberships were
  past due, and that was migrated history, not a live failure. Never let a report or migration
  treat past due as rare without checking.
- **Stale header comments lie.** A job's header said "scaffolding only" while the body was fully
  implemented. Read the code.
- Saved-card renewals route to the card's home processor.
- A feature-off catalog tab that silently bounces a deep link elsewhere produces a dead "Manage
  plans" link. Make setup links feature-aware.
- Membership lifecycle messages (welcome, cancellation) belong in the SAME shared notification
  settings component as appointment alerts, driven by a mode, not a parallel system.

## The discipline for both

1. Pull the LIVE function or trigger body immediately before replacing it. These objects are
   replaced often, by more than one person.
2. After any package change, verify the counter invariant across the whole database.
3. Smoke-test the consumption path you touched.
4. A money path wires error reporting. Reserve, settle, reverse, renew and the crons all should.
5. Every query is location-scoped. "All locations" is a separate, explicit toggle.

## Related skills

- `pos-checkout-design`, `commission-system-design`, `analytics-reports-architecture`,
  `saas-subscription-billing` (a different system: the SaaS's own plans), `security-rls-permissions`,
  `error-alert-system`.
