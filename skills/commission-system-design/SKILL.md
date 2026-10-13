---
name: commission-system-design
description: How to design a staff commission system that stays correct through deposits, split payments, payment plans, refunds, voids, reassignments and rate changes. Covers the one driving rule (commission follows the PAID amount, percentage ramps, fixed is all-or-nothing), the single recompute authority driven by triggers, the immutable base plus the manager overlay plus the separate payout axis, the layered rate model (eligibility, catalog rate, personal rules, location overrides, price bands), who earns (performer vs seller vs checkout person), commission on prepaid packages (seller or performer, never both), refunds as visible minus-lines, reassigning a commission after payout, backdating a rate to past sales, pay periods, the guarded payout functions, the manager report and the staff self-view. Read this BEFORE building or changing anything about commission, payroll earnings, tips visibility, a commission report, or any database function that writes commission rows. Use when the user mentions commission, commission rate, commission rules, override, payout, mark paid, pay period, payroll, clawback, refund proration, "commission on a deposit", "they got paid on money we never collected", reassign the seller, backdate a rate, or a staff member seeing their own earnings.
---

# Commission system design

> **Adapt before use.** This describes how a commission system SHOULD be wired. It is taken from a
> production multi-location service business platform where commission broke in production
> repeatedly before reaching this shape (payroll paying the pre-adjustment amount, product
> commissions missing entirely, a report showing zero, commission paid on money never collected).
> Nothing here is wired in your repo yet. Table, column and function names are EXAMPLES of the
> shape. Once built, replace them with your real names and add a "how it is wired here" section.

Related skills: `pos-checkout-design` (the checkout that creates commission rows),
`memberships-and-packages-design` (prepaid packs that pay commission), `report-verification` (the
checklist for the commission report), `analytics-reports-architecture`.

---

## The one rule that drives everything: commission follows the PAID amount

**A person earns commission ONLY on what the customer has actually PAID, not on the sale price.**

| Rate type | What is earned |
|---|---|
| **percentage** | `full_commission x paid_fraction`. A deposit earns the percentage of the deposit. Paying half earns half. It ramps UP as money arrives and DOWN on refund. |
| **fixed** | **All or nothing.** Zero until the sale is FULLY paid, then the whole fixed amount. A $50 fixed commission never pays out on a $10 deposit. |

`paid_fraction = clamp(0..1, amount_paid / total)`. Refunds are a separate component (below).

**Decide what a waived amount means, once, and use the same answer everywhere.** The settled rule in
the source system: a waived or comped amount is EXCLUDED. A comp collected nothing, so it earns
nothing, and a zero-total order earns zero. An earlier version counted waived as settled in one
place and not in another. Whatever you choose, the insert-time scaler and the recompute must agree.

From the user's side: when a sale is made but not fully paid (a deposit, a partial payment, a
payment plan), the person does not yet earn the full commission. A percentage commission shows only
the portion of what has been paid, and as the customer pays more, including automatic installments,
it ramps up on its own with no action by anyone. A fixed commission shows zero until the sale is
fully paid. That is why the drill-in shows "earned versus pending". **If you ever see full
commission on an unpaid or partly paid order, something bypassed the mechanism. That is a bug.**

### Enforce it with triggers and ONE recompute, not by editing checkout code

- **A BEFORE INSERT trigger on the commission table.** It stamps the immutable base
  (`full_commission := commission_amount`) and scales the new row to the order's CURRENT paid
  fraction, so a commission created on a deposit is BORN scaled. It skips manual rows. It must be
  exception-safe: log and continue, never block a sale.
- **An AFTER UPDATE trigger on the order's paid, waived and total columns** that calls the one
  recompute function. This ramps commission on EVERY later money movement: a second tender, a
  payment-plan installment (manual or from the cron), a void, a refund, a reconcile. It keys off
  amount paid, so it covers all payment paths uniformly. It writes the commission table, not the
  order, so there is no trigger recursion.
- **The refund triggers call the SAME recompute.** Refunds must run the same authority as payments.
  A separate refund function was tried first: that two-writer design caused a base-loss and
  double-clawback bug and was replaced by unification.

**Why this matters for you:** if you build a NEW way for money to land on an order, you do not touch
commission. As long as the path updates the order's amount paid the normal way (insert a payment
row, let the totals trigger run), commission ramps automatically. Verified end to end on a payment
plan: 20 percent, then 80, then 100 percent paid ramped the commission 25, then 100, then 125 cents.

**Resolving the order from a commission row is the trap.** Resolve it through the order line id
where there is one. Fall back to the row's source id ONLY when the source type really is an order.
A prepaid package's source id is the PACKAGE id, and a service's source id may be an appointment
line id. Treating either as an order id silently mis-scales. Special-case them: a package row joins
to the package to find its purchase order.

### The single recompute authority (the one function to understand)

It is the ONLY function that decides what a commission is worth. For each non-manual earning row
that has a base and no manager overlay, it computes TWO INDEPENDENT components:

- **The positive row = gross earned from PAYMENTS = `full x paid_fraction`** (fixed: full once fully
  paid, else zero). It only ramps UP with payment. A refund never shrinks it. It keeps ramping even
  AFTER a partial payout: leave the paid-out amount alone, so `remaining = effective - paid_out`
  surfaces the newly owed amount and the "is paid" flag flips false when paid-out falls below the
  new amount. (Freezing a row at its first payout was the old stranding bug.)
- **The minus-line = the TAKEN-BACK portion = `full x refunded_fraction`** (fixed: full only on a
  FULL refund, else zero), booked as a NEGATIVE manual "Refund adjustment" row. Owner rule: money
  taken back is a VISIBLE minus line on the report, never a silent shrink as if it never happened.
  ONE minus-line per commission, reconciled on every run (delete and reinsert), so multiple refunds
  telescope without double clawback.
- **Net = positive minus minus-lines = `full x (paid_fraction - refunded_fraction)`.** Because the
  two components are independent and both read the ONE immutable base, every sequence composes:
  deposit, pay more, refund, pay again.

Properties it must have: idempotent; per-row exception isolation so one bad row cannot un-ramp the
whole order; and an exception is logged, never allowed to abort the payment.

When you replace an old model with this one, the old functions become orphans. Mark them dead and
drop them. Do not let anyone extend them.

---

## The data model

### The commission row

Key columns (example names):

- `commission_amount`: the LIVE, DERIVED earned amount, scaled by paid fraction.
- `full_commission_cents`: the STABLE BASE, the commission at 100 percent paid and 0 percent
  refunded. Set ONCE at creation. Never mutated by a payment or refund. Null on manual rows.
- `adjusted_amount`: the MANAGER OVERLAY. When set, it wins for display AND payout, and the row is
  protected from the paid ramp.
- `paid_amount`, `is_paid`, `paid_at`, a payout batch id, paid by: the PAYOUT axis, the money
  actually handed to the person. SEPARATE from earning. A row can be fully earned and unpaid, or
  partially paid out.
- rate type (percentage or fixed) and rate.
- `item_price`: the immutable line base the percentage was applied to.
- `earn_basis`: `own` (the performer or seller) or `override` (someone earning on top).
- `commission_type`: service, product, package sale, package redemption, manual. Manual covers both
  hand-entered bonuses AND the negative refund rows. Manual rows are NOT paid-linked: their base
  stays null and every trigger skips them.
- source type and source id.
- location id. **Commission is ALWAYS location-scoped.** Every query, function, rule, report and
  self-view is per location.
- voided flag and voided reason.

**Effective amount = `COALESCE(adjusted_amount, commission_amount)` at EVERY reader AND writer.**
The recurring bug: fixing the DISPLAY of effective amount but not the write and settle path.
Payroll, the report, the pay-period panel, the self-view, exports, the payout function and every
analytics function must ALL use effective. Fixing display alone is a cosmetic non-fix. This is a
general rule: a derived value must be fixed at every reader and every writer.

### The rules table

- Kind is `personal` or `location_override`.
- A **personal** rule is set on a person and is the FINAL WORD for that person on the items it
  matches, replacing the catalog rate even when the item has no catalog commission. It can be
  company-wide or scoped to one location; a located rule outranks a company-wide one at its
  location.
- A **location override** makes a person earn a percentage of EVERY sale at a location, IN ADDITION
  to the performer's own commission. They stack.
- **Price bands** (minimum and maximum price): a rule can be tiered. If the base leaves the band,
  the row earns zero. When re-creating a split line, match the band on the FULL line base, not the
  per-person split. A band is about the item price, not how it is divided.

### Pay periods

Per-location settings: cadence (monthly or biweekly), month start day (1 to 28), biweekly anchor.

**One PURE period-math helper in the database is the single source of truth. Never do period math
in the browser.** The browser anchors on the user's LOCAL date and the database on UTC, and they
disagree at boundaries. Also a real bug: a date label format code that meant day-of-WEEK was used
where day-of-MONTH was intended. Test the labels.

---

## The product model: three config layers plus two viewing surfaces

**Layer 0: eligibility.** A per-person "commission eligible" toggle, OFF by default. A person earns
NOTHING (no own rows, no override rows, not listed as an earner) unless it is on. This is the master
switch.

**Layer 1: the catalog rate.** Each service and product carries a default commission type and
value. It can be overridden per location, so the same service pays a different rate at a different
location. A "none" type at a location forces zero there.

**Layer 2: the person's own structure.** Personal rules scoped to all services, all products, or a
targeted category, service, product or package. Each is percentage or fixed, may carry a price
band, and is company-wide or per location. "This technician earns 40 percent on all services, 50
percent on color, and $15 flat on this one package."

**Layer 3: location override.** Scope all, services, or products. Always a percentage, stacked on
the performer's own row for the same line. Use it for a manager who gets a cut of the whole
location.

**Rate precedence for a given line and person, highest wins:** personal rule (located beats
company-wide), then the located catalog rate, then the base catalog rate. Then, separately and
ADDITIVELY, any location-override earners get their stacked rows.

### Who earns it (differs by item type)

- **Service: the person who RENDERED it.** Changing the performer re-creates the line's commission.
- **Product: the person who CHECKED IT OUT, at the location where it happened.** Give each location
  a setting: "auto-assign commission to the logged-in user." On: the signed-in operator earns even
  if nobody deliberately picked a "checkout by" person. Off: only a deliberate pick earns. This
  matters because history cannot distinguish a real pick from a fallback, so the creator honors the
  checkout person only where the toggle is on.
- **Prepaid package: the SELLER or the PERFORMER of each delivered session**, per the rules below.

Hard-won rules on recipient resolution:

- **Resolve the seller the SAME way a product line resolves its recipient at checkout**: the picked
  "checkout by" person IF eligible, else null. Never default to the logged-in session user. The old
  bug attributed every package sold at the register to whoever was signed in.
- **A creator that bails silently when there is no seller is a real bug source.** No seller, no
  commission, no error. Surface it.
- **A function that reads "the current user" from the database session hard-fails when called by a
  server with a service credential**, because there is no current user. Pass the seller explicitly.
- **Even a correctly attributed sale creates zero** unless there is a rate from somewhere: a
  template seller rate or a personal package rule.

---

## Commission on prepaid packages

### Seller OR performer, never both

A package pays commission to EITHER the seller OR the performer. Enforce "never both" with a CHECK
on the template's mode. Resolve the recipient through ONE helper, in this order: the template's
explicit override (seller / performer / nobody), then the location's setting, then the default
(seller). Every reader of the mode goes through that helper.

Two lessons from getting there:

- A company-level default sat in the chain, was "none" for every company, had no UI, and would have
  zeroed every seller who earned through a personal rule. Remove chain links nobody can see or set.
- A legacy "none" was NOT "nobody". An old dialog saved "none" as its DEFAULT while personal package
  rules still paid the seller. Once "none" came to mean "no one", those rows had to be reset to null
  (inherit). When you give an existing enum value a new meaning, migrate the old rows.

**Seller mode.** The sale creator makes the seller row (rate: personal package rule, then template
seller rate, then company default). It is **paid-linked exactly like a line**: not "full at
activation". It follows the money collected on the package's PURCHASE ORDER: percentage ramps,
fixed is all-or-nothing, a refund or void books a minus-line. The row is created at FULL and the
insert trigger ramps it. A legacy package with no purchase order cannot ramp and stays at full;
that is harmless if those are fully paid. The creator fires on insert (any status) OR on the
awaiting-payment-to-active flip, and is guarded create-once with a not-exists check, so insert plus
a later status flip never double-writes. An older "only create when active" gate was removed: it is
what let a package on a voided order carry a full commission.

**Performer mode.** Each DELIVERED session pays the performer `their own rate for that service x
the session's share of the package price`, scaled to what the customer has PAID. One function
computes it; the insert trigger and the recompute resolve the order through session, then package,
then purchase order, so it ramps and claws back like any line. Allocation: weight by each item's
unit value across non-bonus items; bonus sessions allocate zero; a missing value falls back to an
equal split by session count. **Use the SAME allocation function in reports, so the report and the
commission never disagree.**

**Recognize at DELIVERY, not at reservation.** If a credit is reserved the moment an appointment is
booked, do NOT create the performer commission then. Defer a redemption tied to a FUTURE
appointment and create it once the appointment's end time has passed, from a sweep. That is robust
to appointments whose time passes with no status change, and it matches accounting, which
recognizes redeemed-session revenue at delivery. Both the sweep and its helper must SKIP a session
that has a reversal row pointing at it: a session cancelled before or around delivery must never
earn commission for a service never delivered. A reversal row (cancel, no-show) voids the matching
commission.

**Either/or is enforced PER PACKAGE, not only by the mode chain.** A package that already holds
live POSITIVE commission on one side never creates the other side, even if the setting flips later.
One helper answers "is this side taken?" (the sum of full over that side's live own rows is above
zero). The writers read it and skip by design, AND a BEFORE INSERT guard raises on a real conflict.
Negative and voided rows never conflict. The ONLY way to move a package from one side to the other
is a deliberate resync that reconciles the LOSING side to zero FIRST (unpaid: void it; paid: a
settled negative delta so the side sums to zero and is released), then creates the winning side.

**A covered line pays NO standard commission.** An appointment paid for by redeeming a package
credit collected no new money on that line. Commission follows a payment, and the package already
paid at sale time. Every creator must gate on "this line is not package-covered", and the session
writer voids any own or override rows on a covered line, which handles the "credit applied after
the commission was created" ordering. Add an integrity check that alerts if a live standard
commission ever sits on a covered line.

---

## Reassigning who earns it ("everything should be changeable")

- **A service or product line.** One manager-level, location-guarded function. ALWAYS void the old
  row, so its unpaid remainder can never be paid to them again, and book a VISIBLE minus-line
  against the old person for ONLY what was actually PAID OUT to them, not the full earned amount. A
  partial payout claws back exactly the partial payout. Then create the new person's row at THEIR
  resolved rate, scaled by the insert trigger.
- **Idempotency.** The void stamps a "reassigned" reason and the recompute SKIPS voided rows, so a
  later payment can never resurrect the reassigned-away row. That was a real double-commission bug.
  A double click hits the "not voided" guard, or finds the new person already has a live row and
  returns "already present".
- **New person ineligible or no rate:** the old row is still voided and nothing is created. Return
  that fact to the caller.
- **Only the one line's own row moves.** Override rows belong to the override earner and are not
  reassigned.
- **A package sale.** If the old seller was already PAID, do not refuse. Act like a refund: book a
  visible negative "Commission reassigned" line against the old seller (net zero for them, the paid
  row kept for audit) and create the new seller's row.
- **Claw the NET, not per row.** Book ONE minus-line per old person for the net of their SETTLED
  rows (paid-out positives minus settled negative deltas), deduped by a (target, person) note, and
  void every UNPAID live own row of theirs on that target. A per-row clawback double-clawed a seller
  whose paid row a backdate had already netted to zero.
- **The deferred-forever trap.** Creation on reassign was gated only on "the old seller had a row."
  A package sold with NO seller never had a row, so reassigning a seller onto it deferred forever:
  the creator's moment had passed and it never fired again. The result was "No commission" despite
  a correct, eligible seller and rule. Gate on "had a row OR the package is past awaiting payment."
  Create NOW for any already-active or paid package, and defer only a package genuinely awaiting
  payment.

---

## Backdating a rate ("apply this rate: from now on, or also to past sales")

Give EVERY commission-setting surface one shared control and run the backdate AFTER its own save:
personal rules, override rules, catalog items (single and bulk), package templates, and the
location's recipient setting.

- **Cursor-batch it.** A user-context database call runs under a short statement timeout (8 seconds
  in the source system), so the function takes a cursor and a limit and the client loops until
  done, showing progress.
- **Scopes:** one person (with an audit stamp on the rule), one override rule, service or product
  ids with an optional location, package templates, a location's packages.
- **The primitive: reconcile a target.** Recompute what SHOULD exist under the CURRENT rules and
  compare the SUM of live base amounts to the expected base:
  - Equal: no-op. A second run changes zero rows. That is the idempotency proof.
  - Nothing paid out: UPDATE the oldest row in place (keeps its id and created-at; extra rows
    voided; expected zero means void).
  - Something paid out: paid rows are NEVER touched. Insert ONE delta row for the difference. A
    positive delta is a normal unpaid earning row. A NEGATIVE delta is a non-manual row with a
    negative base that the recompute ramps with the paid fraction, never claws, and keeps settled
    (paid flag true, paid amount zero), so payroll never tries to pay it while every earned total
    nets it. This is the visible-minus rule again.
- Manager-adjusted rows are skipped. Manual rows are never touched. Imported or voided orders and
  covered lines are skipped.
- **WHO earns is never changed by a backdate.** Live own rows define the recipients.
- **Stamp new rows with the SALE's date** so they land in the right pay period.
- After any change, run the order through the recompute.
- **A person-scoped backdate touches ONLY that person.** Thread an "only this user" argument through
  the resync functions. Item, template and location scopes reconcile everyone.

**The resync base must equal the CREATION formula.** If stored line totals are already net of the
distributed order discount, do NOT subtract the order-discount share again. One creator did, and
the audit caught the lines it would have rewritten. The acceptance test for any change to a resync
function: a rolled-back resync over a few hundred real lines and packages must change ONLY rows
whose rules really changed.

**Report accuracy with the new row shapes.** Delta rows carry item price zero and no rule id, so
sales and effective-rate math never double count the sale and the band check cannot zero them.
Negative deltas are marked paid, so the "Unpaid" view and owed totals ignore them. Same convention
as refund minus-lines: owed is never negative, earned totals net them.

---

## The payout (manager side)

Every payout function sits behind ONE admin guard (a company-level role check that returns the
caller's company). **Each one ALSO checks every row's location** against the caller's accessible
locations. A privileged database function bypasses row-level security, so company plus role alone
is a cross-location hole: a manager could act on another location's rows with a crafted call. The
list screen hiding those rows is not a guard.

| Function (example) | Does |
|---|---|
| record payments | The core payout writer. Settles against the EFFECTIVE amount, clamps to [0, remaining], sets the paid flag. |
| pay oldest first | Allocates ONE total across a selection oldest first, then delegates to record payments. |
| bulk adjust (set or add) | Writes the overlay. Skips paid rows. |
| unmark payments | Undo a payout. A guarded function, NOT a raw client update, because the table's update policy is role-blind. |
| add manual / adjust / clear adjustment / void | Bonus, edit, clear, void. A paid-edit guard: a row with money already paid cannot be quietly changed. |

Consider splitting the guard when tips share the model: editing tip MONEY can be admin-only while
running payroll stays manager-level, since managers run payroll.

---

## The surfaces

**Manager report.** A pay-period panel at the top whose headline is the total EARNED this period at
the location: a payout snapshot, not a query. A gear opens per-location pay-period settings.

- **The roster, not just rows.** One card per person. People who earned are expanded; people with
  zero collapse into a single dropdown so earners stay front and center. A missing name and a $0
  name mean different things (see `report-verification`).
- **An "all locations" toggle** combines each person's total across locations. When on, show a
  per-location totals strip above AND below the list, and give anyone earning in more than one
  location an expand control that reveals their split by location. Grand total = sum of location
  totals = sum of person totals. Make that reconcile.
- **Filters:** date range, locations, payment status (unpaid, paid, all), staff, items.
- **Per-line drill-in:** who bought it, the order's paid state and amounts, this commission's earned
  so far versus still pending, and for a package the used / scheduled / available breakdown.
- **Payout actions:** select rows or people, mark paid with one editable total allocated oldest
  first, unmark, adjust with a note, add a bonus to a $0 person, void.

**Staff self-view.** OFF by default. A manager turns on "let staff see their commission" PER
LOCATION, because not every location wants to give every person access. Put that switch on the panel
header. It was once buried in the pay-period dialog and nobody could find it.

- The person sees ONLY their own commission, as a per-period total, **combined across every
  location they earn in and have access to**. The location picker is ignored: it is their money
  wherever they earned it. Group lines by location on expand.
- Because the functions are own-only (rows where the user is the caller), crossing locations leaks
  nothing.
- **The tab was gated TWICE and one gate was forgotten.** The visibility function returned true, but
  the tab key was missing from the settings page's tab allowlist, which filtered it out for
  EVERYONE before the visibility check ran. No staff member could see it although the database was
  correct. When you add a tab, check every allowlist it passes through.

**Tips can share this exact model.** The owner's framing: tips and commissions are the same
concept. One generalized self-view component with a mode switch, a sibling per-location visibility
toggle, own-only functions reading the tips ledger, and the SAME pay-period cadence so both line up
on one grid. Tips have no eligibility flag; the per-location toggle is their only gate.

**AI assistants that know about commission.** If an analytics assistant can answer commission
questions and an operations agent can SET commission, they are two more readers and writers. Teach
the assistant that its commission total is already net (overlay applied, negative rows included).
When you add a commission type or change what nets into a total, update the tool description in the
same change, or the assistant will describe the old shape.

---

## Landmines checklist (every one has bitten production)

1. **Effective amount at EVERY reader AND writer**: display, exports, payroll, analytics, payout.
2. **Commission follows PAID money.** Full commission on a partly paid order means a trigger was
   bypassed.
3. **A row's source id is not always an order id.** Resolve the order through the line.
4. **Manual rows are not paid-linked.** Null base; every trigger skips them.
5. **Privileged payout functions need the per-row location check.**
6. **Period math in the database only (UTC), never in the browser.** Check the label format codes.
7. **Refund proration reads the stable base**, never the current amount, or multiple refunds
   compound.
8. **In PL/pgSQL a record variable cannot be dereferenced until it is assigned.** Use an explicit id
   plus a boolean found flag. This broke the line-detail function for package rows with no line.
9. **Everything is location-scoped.**
10. **A covered line earns no standard commission.**
11. **Verify every claim against the LIVE database.** Never quote a migration file as truth.

## Related skills

- `pos-checkout-design`, `memberships-and-packages-design`, `analytics-reports-architecture`,
  `report-verification`, `security-rls-permissions`.
