---
name: pos-checkout-design
description: How to design the checkout / point-of-sale money model of an app where a customer pays a merchant - the order money columns and the constraints that make status unable to contradict the money, the tender catalog (cash, card, saved card, online, gift card, package credit, membership credit, store credit, offline "other"), split payments and the "every mint path must handle every tender" rule, credit ledgers with redeem-on-apply and restore-on-reverse, order-level discount distribution onto lines, resuming a deposit order, the three different ways money comes back (same-session reverse vs refund vs void), the refundable cap, tips and tax handling in refunds, the card-reader-mid-checkout double-collection class, and delayed-settlement tenders such as ACH. Read this BEFORE building or changing a checkout, a register, a tender or payment method, a split payment, a refund / void / return flow, a gift card or store credit ledger, the order paid/due/status columns, or any code that writes a payment row. Use when the user mentions checkout, POS, point of sale, the register, tenders, payment methods, split payment, deposit, partial payment, amount due, store credit, gift card, refund, void, return, reverse a payment, tip, discount distribution, "the customer was charged twice", or "how does a customer pay." This is the money MODEL; the seven money-truth invariants live in money-truth-doctrine and the per-processor wiring lives in payment-processor-integration-checklist.
---

# POS / checkout design: the money model

> **Adapt before use.** This describes how a checkout money path SHOULD be wired. It is taken from a
> production multi-location POS that paid for every rule below with a real incident. Nothing here is
> wired in your repo yet. The table, column and function names are EXAMPLES of the shape, not names
> to expect. Once you build it, replace them with your real names and add a short "how it is wired
> here" section so the next agent finds the real code.

Read `money-truth-doctrine` first. It owns the seven invariants (charge and record are atomic or
backstopped, write the attempt before the money moves, a gateway id is not proof of capture, never
invent a decline, two-way auto-healing reconcile, one idempotent recovery primitive, never
auto-refund), the void/refund settlement crossover, typed errors, the arm-vs-wait reader timeout and
decline-code mapping. This skill does NOT repeat those. It covers what sits above the gateway: the
order, the tenders, the ledgers and the reversal paths.

Why this skill exists: agents keep breaking money paths by inventing their own instead of learning
the one that exists. Real bugs from one stretch of work: phantom customer debt (an importer wrote
"paid" with amount paid 0), a double gift-card refund (a missing row lock), package-credit payment
rows with nothing behind them, and a credit double-spend that was fixed in one checkout function but
left wide open in the other, more common one. Every one shares a root cause: the agent did not know
the whole flow, so they built a partial or parallel one.

---

## Rule 1: count your mint paths. A fix in one but not all is a shipped bug.

A payment reaches the database through more than one entry point. In the source system there were
four:

| Entry point (example names) | When it runs | What it does |
|---|---|---|
| `process_checkout(data)` | The FIRST tender on a NEW sale. Also a layaway deposit and the first payment of a payment plan. | Inserts the order, all line items, then loops the payments, inserting each payment row and running that tender's side effects. |
| `add_order_payment(order, payment, request_id)` | The 2nd..Nth tender on an ALREADY-CREATED order (split tenders, pay later). | Locks the order, idempotency-checks the request id, inserts one payment row plus that tender's side effects. |
| `purchase_package_atomic(input)` | A prepaid-package sale from the operator app. | Writes its own order, payments and lines. Shares no code with the first two. |
| `purchase_package_public(input)` | The customer-facing online purchase. | A separate implementation again. |

**If you add or change a tender's behavior, you must update it in EVERY mint path.** The credit
double-spend existed because the claim logic was only in the "add a later payment" function; sales
that used that credit as the first tender went through the "create the sale" function, which had no
branch for it, so the credit was never claimed on the common path.

The worst version: one mint path recorded a gift-card payment for months without ever debiting the
gift card. The route literally carried a comment saying the debit was a future pass. A customer paid
by gift card, kept the full balance, and could spend it again. The same hole lived in the online
order routes, which subtracted a gift-card amount from the card charge without redeeming or even
validating a card.

**The lesson, stated as an invariant: any path that inserts a credit-tender payment row MUST redeem
its ledger in the same transaction, or REFUSE the tender. A recorded-but-unredeemed credit is free
money.** If a path cannot safely back a credit tender yet, make it raise. Do not record it and
promise to wire the debit later.

Keep a written list of every function that inserts an order or a payment row. When someone adds a
tender field (sub-method, reference number, check number), walk the list.

---

## The tender catalog

One payment-method enum on the payment row. Example set: `cash`, `card`, `card_on_file`, `online`,
`gift_card`, `package_credit`, `membership`, `project_credit`, `balance_credit`, `other`.

For each one, write down the side effect that must fire in every mint path:

| Method | Backing ledger | Redeem on apply | Restore on reverse | Idempotent? |
|---|---|---|---|---|
| cash / card / card_on_file / online | none, it just records money | none | none | n/a |
| gift_card | gift card balance + history | debit AFTER the payment row inserts | credit back by amount | Often NOT. If the restore is not idempotent on the payment id, the reverse path must hold a row lock (see below). |
| package_credit | package item counter + an append-only usage row | redeem, return the usage id, stamp it in payment metadata | return by usage id | Yes, guard a reversal of a reversal. |
| membership | membership credit ledger | redeem, stamp the ledger id in metadata | refund by ledger id | Yes, marker based. |
| project_credit (a payment milestone) | the milestone row | claim once with a "paid by this payment id" guard, then call the canonical mark-paid function | mark unpaid | Yes, once-only guard. |
| balance_credit (store credit) | derived from other orders' negative amount due, plus consumption rows | validate available credit | reverse the consumption row | n/a |
| other | none. An offline tender: Zelle, Venmo, bank transfer, check. A sub-method and a reference carry the detail. | none | none | n/a |

Rules that fall out of this table:

- **Credit tenders are the dangerous ones.** Each one redeems a real ledger. That redemption happens
  INSIDE the privileged server-side function, never in the client. A client must never be able to
  insert one of these payment rows directly. Enforce it in the database: the row-level insert policy
  blocks the credit methods for normal users, and only the privileged function (which bypasses the
  policy) can write them. When you add a new credit tender, add it to that block list in the same
  change.
- **Stamp the ledger handle on the payment.** The usage id / ledger id goes into the payment row's
  metadata at redeem time. Every reverse, void and refund path reads it from there. Without it you
  cannot restore the right ledger row.
- **Do not invent a second "paid" axis.** If a milestone's paid state is its workflow status, route
  checkout through the same mark-paid function the payment webhook uses, and use a "paid by payment
  id" column only as a once-only guard. A parallel paid flag will drift from the status the reports
  read.
- **A non-idempotent restore needs a lock.** If the gift-card credit-back cannot be made idempotent
  on the payment id, the reverse and void paths must lock the payment row `FOR UPDATE` and guard on
  the payment's own state (row already deleted: "already gone"; status already voided: "already
  voided"), so a concurrent second call is a no-op. Missing this lock was a real double refund.
- **Retiring a tender from the UI is not retiring it from the data.** "Check" became a sub-method of
  `other`, with the check number kept on the payment so receipts still print `#1234`. Old rows with
  the old method still exist and must keep loading and displaying. Remove a method from the creation
  UI only, never from display and mapping logic.
- **The method CHECK constraint must list every method the code writes.** A whole tender was broken
  platform-wide because the payment-method CHECK omitted it: the function redeemed the ledger, tried
  to insert the row, hit the constraint, and rolled back every time. Zero rows of that method
  existed in the whole database and nobody noticed. When you add a tender, widen the constraint in
  the same migration and smoke-test an insert.

---

## The order money model and its invariants (non-negotiable)

- **Money is integer CENTS everywhere.** Divide by 100 only for display. Multiply by 100 when saving.
- **Amount paid = the sum of the order's live payment rows**, maintained by ONE trigger that fires
  after insert, update and delete on payments and also recomputes status. Nothing else writes it.
- **Amount due is a GENERATED column**: `total - amount_paid - amount_waived`. It is NOT clamped. It
  can go negative, and **a negative amount due IS store credit**. The store-credit tender draws it
  down.
- **Status must never contradict the money, and the database must refuse a contradiction.** Use CHECK
  constraints so a mismatch is unrepresentable:
  - paid requires coverage: `status <> 'paid' OR total <= 0 OR amount_paid + amount_waived >= total`
  - open requires nothing paid: `status <> 'open' OR amount_paid = 0`
  - partially paid requires a real partial: `status <> 'partially_paid' OR (amount_paid > 0 AND total IS NOT NULL AND amount_paid + amount_waived < total)`
  - void, waived and refunded are terminal and unconstrained.
- **Always DERIVE status from the money. Never write a status a caller or a CSV handed you.** The
  canonical derivation, to be copied everywhere and never reinvented: fully refunded gives
  `refunded`; paid plus waived at least total (and total above 0) gives `paid`; some paid and not
  fully covered gives `partially_paid`; nothing paid gives `open`. Every writer must match it: the
  payment trigger, the refund function, the importer, and every server route that sets status
  directly (auto-billing, cancellation fees, plan cancellation).

  History that justifies the constraints: about 84,000 imported orders sat at "paid" with a positive
  amount due (phantom debt), and 141 more had "partially paid" with nothing owed or "open" with a
  payment on them. All had to be backfilled before the constraints could go on.
- **A partial refund that still leaves the order covered resolves to `paid`, not `partially_paid`.**
  Refunding only a tip on a fully-paid order is the classic case. A blind "partial refund means
  partially paid" violates the constraint and the write fails with a server error.
- **An open order can legitimately owe nothing** (a zero or comped order). So for DISPLAY, "Unpaid"
  is correct only when amount due is above 0. Format status from (status, amount due), never from
  the bare status.

---

## Order-level discounts: distribute them onto the lines at mint time

**A line's stored total is the PRE-tax, NET-of-discount amount the customer actually paid for that
line**, net of both its own line discount and its share of the ORDER-level discount (promo code,
manual order discount, courtesy discount). It is never list price. The per-unit tax-inclusive amount
paid is `(line.total + line.tax_amount) / quantity`, and that is the number refunds and returns use.

Why it matters: if the order discount lives only on the order header, the line totals stay gross
while the order total is net, and everything that reads a line as "what they paid" is wrong. It
over-refunds the discount, collects the wrong balance on "record payment", and overstates revenue in
reports. Fixing it required distributing at mint time in every mint path plus a backfill.

**The canonical proration rule (copy it, do not improvise):**

1. Weight the order discount by each line's gross total against the sum of line grosses.
2. The LAST line takes the rounding remainder, so the shares sum EXACTLY to the order discount.
3. Cap each share at: zero or more, the line's own gross (a line total never goes negative), AND the
   remaining undistributed discount (so many small equal lines whose rounded shares are .5 or more
   cannot cumulatively overshoot).
4. Then add the share to the line's discount amount, set the line total to
   `max(0, gross - share)`, and leave tax UNTOUCHED.

Result: the sum of line discounts equals the order discount, except when the discount intentionally
exceeds the subtotal (a courtesy "zero it out including tax"). Then lines cap at zero net and the tax
portion of the discount cannot land on a line. That is harmless: the header total is still correct.

What must stay true around it:

- **The order total is still computed from the HEADER** (subtotal minus discount minus member
  discount plus tax plus surcharge), not from line totals. The status constraints read only header
  columns, so distribution can never violate them.
- **Any new mint path that sets an order-level discount must distribute it**, or it reintroduces the
  whole bug class. Mint paths that never set an order discount (fee orders, booking-to-order) need
  nothing.
- **Accounting must gross revenue back up.** A journal export books revenue as line total plus line
  discount, and the discount contra as the sum of line discounts, so the journal balances. Net
  revenue plus a contra of the full discount is off by the discount.
- **Analytics revenue sums the net line total.** That is correct. Before distribution it overstated
  revenue by counting the discount.
- **A separate member-discount column that is NOT baked into the line total is a refund trap.** If
  the refund unit price does not subtract it, a refund over-refunds by the member discount. Either
  bake it in or subtract it in the refund math before the feature goes live.
- **A commission base computed at mint from the incoming payload already nets the discount.** Do not
  subtract the order-discount share a second time when you later recompute from stored lines. See
  `commission-system-design`.

---

## Resuming a deposit order at checkout

A customer pays a deposit and comes back to pay the rest. There are two ways an outstanding order
enters the cart, and for a partially-paid order only one is correct.

- **Resume in place.** The deposit order stays the SAME order. The cart is locked to that order id,
  the deposit is rehydrated as an already-applied payment, and paying adds the balance through the
  "add a payment" path. One order from start to finish. **This is the required path for a
  partially-paid order.** Every "bring this order into checkout" entry point must route partials
  here.
- **Consolidate.** Copy the old order's lines into a NEW order, carry anything paid forward as store
  credit, and void the old order with a pointer to its descendant. The money is correct but it
  churns the order. Use it only for a fully open, nothing-paid order. **Never consolidate a
  partially-paid order.** An early version did, dropped the deposit from view and re-collected the
  full price.

More rules from this flow:

- **Bringing an order into the cart is display only. Nothing hits the database until a payment is
  applied.** The one required effect: the customer's "Balance $X" chip must stop counting the
  balance that is now sitting in the cart, or you are lying to the operator. Every order-into-cart
  path must register its amount due into the "already in front of you" adjustment, or the chip
  double-shows.
- **Cart line ids are not database ids.** Resumed lines carry synthetic ids such as
  `order-<line id>`. Never pass a cart line id into a uuid column: it crashes on the cast. Keep the
  real line id on the cart line as a separate field, guard with a uuid pattern check, or send null
  and let the server re-resolve the covered line.
- **Editing a resumed order's lines needs its own server functions.** Remove a line and change
  price/quantity each get a privileged function that: locks the order, guards the tenant, accepts
  only open and partially-paid orders, recomputes subtotal, tax and total from the surviving lines,
  and DERIVES status from the money. Delete refuses the last line. Update refuses an order that
  carries an order-level discount, because re-prorating the discount is out of scope. There is no
  trigger that re-syncs the order total when a line changes, which is exactly why these functions
  recompute the header themselves.
- **Client order of operations on a line removal:** reverse any per-line credit first, call the
  function, then refresh the balance. If the function reports the order is now paid (the deposit
  covers the trimmed order), tell the operator and reset the form. On a refusal, show plain guidance
  and roll the line back so the cart and the stored order never diverge.
- You can trim a resumed order's own lines. You cannot add brand-new items to it.

---

## Card processing inside checkout

- **Resolve the processor per LOCATION, and allow more than one account per location.** Never assume
  a single company-wide processor. The reader-availability gate must be scoped to the same account
  the charge will route to, or the gate and the charge disagree.
- **When a reader is connected, the card tender defaults to the reader**, not keyed entry.
- **A card that charges at the gateway but fails to persist its payment row is the
  money-moved-no-record case.** Critical alert plus a message that tells the operator the card WAS
  charged (see the doctrine's UX corollaries).
- **"Defer recording" means the charge already happened; the mint function records it once.**
  In-flight reader charges track on attempt rows keyed by a session id; the mint links the attempt
  to the order so the reconcile job sees it as booked and does not create a second, phantom order.
- **Bound everything on the reader.** The wait, the cancel and the post-tap verify are all time
  bounded, so the operator never sees an endless spinner. Details are in
  `payment-processor-integration-checklist` under the reader suite.

### The reader-tap-mid-checkout class (the costliest recurring money bug)

It has two opposite failure modes, and a fix for one caused the other. Both are about a reader tap
that is mid-flight while the operator does something else to the sale.

**The invariant: every gateway capture must end up recorded on a live order, no matter what the
operator does mid-tap. A capture may fail to land only if the booking function itself errors
(infrastructure), never because of an operator action.**

**Failure mode A, double collection.** The reader is armed on a pre-created open order. Before the
tap resolves, a different concurrent action settles the sale another way and destroys that order: a
cash re-ring, a plain void, a consolidation from another register. The tap then captures against a
dead order, is recorded nowhere, and the operator collects again. Seen live three times at one
merchant, on sales of $20 to $90.

**Failure mode B, the self-inflicted strand.** A guard built to stop mode A fired against the sale's
OWN legitimate tap, leaving a real capture unrecorded. It happened when the guard keyed on the
attempt's session id. **Root lesson: a session id cannot tell "a sibling tap I am settling right
now" from "a rival register's live tap."** A normal rapid multi-appointment checkout arms and taps
several items back to back, each with its own session id, then checks out consolidating them. At
booking time a sibling's just-succeeded tap can still read pending for a beat under a different
session. A session-keyed "is a tap in progress?" guard on the consolidate or void path therefore
blocks legitimate sales and strands their money. Do not add one. It is unfixable on that path.

**How the class is actually closed, using only signals that do not false-fire:**

1. **A concurrent-ARM guard on the reader initiate endpoint.** Refuse to arm a second reader session
   for a sale that already has a live pending reader attempt (a few minutes old, not released). Safe
   because it is about arming, not settling.
2. **A database trigger that blocks a DESTRUCTIVE void over a live pending tap.** Only a destructive
   void: one with no "consolidated into" pointer. A consolidation void carries the sale forward and
   is explicitly exempt, or it breaks multi-item checkout. This is the only correct signal:
   consolidation versus destruction, not session identity.
3. **A self-healing booking routine with no dead ends.** In order: reference already recorded;
   sibling short-circuit; re-select by idempotency key; ground truth by reference; add the payment
   to the consolidation descendant; and finally, on a void header, the stranded-charge primitive
   that creates a reconciled order. A capture always lands somewhere live.
4. **The stranded-charge primitive returns "already linked" ONLY when the reference is on a LIVE
   order.** A link to a void order falls through to link-or-create. Fixing this in the primitive
   fixed every caller at once.
5. **A partial unique index: one gateway capture can be recorded at most once on a live order.**
   A structural stop against double recording. Exclude the one legitimate multi-order flow if you
   have one (a single portal payment spread across several orders).
6. **The nightly integrity check keys on the REAL invariant:** "this capture's reference is on NO
   live order." Not "the attempt has no order id", because an attempt can carry a void order's id
   and still be stranded.

**Recording a stranded capture after the fact means recording the truth, never refunding.** Use the
canonical idempotent "add a payment" function with the gateway reference as the external id and a
deterministic request id. If the order was already settled another way, the overpayment becomes
store credit automatically (negative amount due). For every "captured but not recorded" alert: ask
the GATEWAY first that the money really moved, then record it onto the right live order.

### A tap's success can reach the browser late, twice, or by a side door

The server may book a staged reader sale BEFORE the browser learns about it (success seen in a
status poll, a race won on Cancel, a poller, a sweep). The browser must never be able to record the
same capture twice. Three invariants:

1. **Every success payload carries the booked order.** Every place the reader UI reports success
   passes the order id and number from the server response, and consumers ADOPT it instead of
   calling the mint. Add another success site and it must pass them too.
2. **The browser's mint of a staged tap reuses the STAGED cart's idempotency key.** The mint then
   returns the already-booked order. A fresh random key per mint was the writer of the duplicate.
3. **A unique-capture violation inside a card mint means "already booked", not "money lost".** Look
   up the live order holding the reference and adopt it silently. Reserve the critical "charged but
   not saved" page for a reference that is on NO live order.

Also: poll reader status in the background and on focus. A hidden-tab pause is what left a panel
saying "waiting" four minutes after the tap had approved.

### An armed reader must never outlive its screen, and every tap needs an owner

A $5 tip tap was armed from a secondary dialog, the dialog was closed, the customer tapped, and the
capture sat on no order for eight hours.

- The reader UI cancels the reader when it unmounts, including when it unmounts while the arm
  request is still in flight, with an "abandoned" reason. Any new host of that UI inherits this.
  Never build a second reader UI without the same cleanup.
- A tap carries its INTENT (tip or payment) on its attempt row. Pass it from any dialog whose tap is
  not a plain payment, or a server-side recording loses the meaning of the money.
- A succeeded tap with no staged cart but bound to an existing live order is attached to that order
  only by callers that KNOW the browser is gone (the abandoned cancel, the session poller, the
  reconcile job). Browser-present paths leave recording to the browser, which knows the tender
  detail.
- The "add a payment" function is idempotent per gateway external id on the same order (real ids
  only, exclude placeholder ids). Browser and server may both record the same capture; the second
  call returns the existing row. Never rely on the unique index as the only guard.

### Never fork the settler

Every place that DISCOVERS a tap succeeded (the status poll, the pre-cancel probe, the cancel
kept-money path, the session poller, the reconcile job, the sweep) must go through ONE settle
function. It is the one function that finalizes the attempt, books the staged cart (attach to an
existing order or create one), attaches an orphaned no-cart tap when the register is gone, and
returns the booked order id for the client to adopt.

A branch that marks the attempt succeeded directly and returns a bare "succeeded" marks the money as
taken, books nothing and hands the client no order. That exact fork, in a pre-cancel probe, left a
$115.83 sale unbooked until the recovery job found it. When auditing, grep for direct "finalize as
succeeded" calls outside the settle module. The only legitimate ones come AFTER a booking, or for a
truly order-less attempt that then pages a human.

### A keyed charge that needs 3-D Secure must finalize its attempt when the challenge completes

The attempt opens pending with an "authentication pending" flag. The browser runs the challenge and
calls a confirm endpoint that verifies the payment at the gateway. That endpoint is the ONLY server
touchpoint after the challenge, so it must also finalize the attempt. When it did not, the attempt
stayed pending after a correctly recorded sale, the reconcile job "recovered" it minutes later, and
two correct sales produced four tickets.

### Recovery nets: three rules, or you create the "it keeps happening" illusion

Several nets overlap by design. When one touches money another path already recorded, it must be a
SILENT no-op, or one capture shows up as three incidents over two days while the books were right
the whole time.

1. **Ground truth decides, never our markers.** "Is this reference already a payment row on a live,
   non-void order?" is the only question. A human repair, the browser, a sweep or a backstop may
   have recorded it without clearing the staged cart or stamping a "recovery done" marker.
   Corollary: a capture that was REVERSED at the gateway is also accounted for. The proof is the
   reversal's own audit row written by the refund dispatcher, never a "voided" status alone, because
   a books-only correction can flip a row to voided without touching the gateway. A net that ignores
   this fires "stranded" every night for a tap that was booked and then voided, while the gateway
   says no funds were captured.
2. **Already recorded means stamp and stay silent. Only a NEWLY created record earns a ticket.**
3. **Candidate filters live in SQL, never only in an application post-filter behind a row limit.**
   A recovery job pulled all succeeded card taps in 48 hours (146 at the time), limited to the
   oldest 100, then filtered in application code, so a fresh strand was invisible for up to a day.
   Any scanner over the attempts table must prove its limit bounds real candidates, not the whole
   table. (Watch JSON: clearing a key by setting JSON null keeps the key, so filter on the extracted
   text value being null.)

---

## Money coming back: THREE different paths. Do not confuse them.

Picking the wrong one corrupts the books.

| Path (example name) | When | What it does to the payment row | Books |
|---|---|---|---|
| `reverse_order_payment` | SAME-SESSION backout, only while the order is open or partially paid | Restores the credit ledger, then DELETES the row. No trace. It is "undo" at the register. | Nothing ever happened. |
| `record_order_refund` | A real refund on a closed, paid order | Writes a refund row (gross amount) | The sale happened, money went back. Revenue nets down. Order can end terminal "refunded". |
| `void_order_payment` | Undo a MISTAKEN payment, keep the sale | Keeps the row, flips it to voided with who, when and why, plus an order event | NO refund row. The item still sold, the balance is owed again. The order REOPENS as unpaid. |

**Void versus refund is a books question.** A refund says "sold, then gave money back": revenue nets
down and a refund is on the books. A void says "this payment should not have counted": the sale
stands, the balance is owed again, and there is no refund on the books. If you refund a mistaken
payment, the books show the item sold with revenue mysteriously reduced. Void is the
accounting-correct tool for "wrong card, let me pay another way" and "test checkout, undo it".

All three restore the credit ledger for credit tenders. Reversing a milestone credit must RAISE if
the workflow has already moved past that milestone; use a refund there instead.

**Refund is credit-aware.** On a refund back to the original method, it restores the ORIGINAL
tender's ledger: gift card by amount (works on partial refunds too); package credit, membership
credit and milestone credit only on a FULL refund of that payment, because their restore functions
take no amount and a partial-dollar refund cannot return a fraction of a session. A refund to cash
or to account credit leaves the original ledger spent: the operator chose to return value another
way. Caveat seen live: if the credit-return function requires a logged-in user, a server-side
refund of that tender raises. Decide whether those refunds are operator-only or give the server a
system variant.

### The refundable cap is what was PAID, not what the items are worth

A return prices money back from item value, but part of an order can be waived (never paid), still
unpaid (partial payment), or already refunded. The refund function refuses to hand back more than
was collected. That guard is CORRECT and stays. But the operator must never meet it:

- The return dialog computes the true cap client-side, mirroring the server's distribution exactly:
  per payment, `amount + tip` minus its succeeded refunds, floored at zero, summed.
- On a RETURN it caps the refund at `cap + restocking fee` (the net never exceeds the cap; the items
  are still marked returned) and shows ONE plain sentence: "Refund is $X, the most that can go back:
  the customer paid $P and $R was already refunded." Nothing more. The operator must never be left
  with a question.
- On an EXCHANGE, where there is no single obvious fix, it explains and blocks in one line.
- Classify the server's guardrail messages in ONE place, built from the real error strings, and use
  it in every refund and return surface. An operator-fixable rejection is user feedback and never
  pages engineering. Owner rule: a ticket exists only if we must act or could make it better. A
  correct "you cannot refund what was never paid" earns a pop-up, not a ticket.

### Void: the hard-won gotchas (every one was a real bug)

1. **The processor's refund webhook will UNDO a card void unless guarded.** Voiding a card reverses
   the charge at the gateway, which makes the processor send a refund webhook. That handler calls
   the refund function, which would insert a refund row and close the order: the void silently
   becomes a refund seconds later. Two guards must both stay: the refund webhook skips a payment
   that is already voided, and the refund function raises on a voided payment. Every new processor's
   inbound refund or void webhook needs the same skip.
2. **Void only a fully succeeded payment. Reject a partially refunded one.** Voiding it would
   double-restore the amount-based ledgers (gift card and store credit use the full gross) and
   orphan the existing refund row. Void is the whole payment, always. A partial-dollar reversal is
   the refund's job.
3. **Voiding a store-credit payment must reverse its consumption row.** The spendable-credit formula
   subtracts un-reversed consumption. Skip it and the customer loses that credit forever. The
   original void shipped with a comment claiming there was nothing to restore. That was a
   customer-money bug.
4. **Never auto-apply store credit. Not on void, not anywhere.** Store credit is the customer's
   money, and auto-spending it onto other open orders was a real merchant complaint. Void frees the
   credit and stops; the order owes its balance and the operator chooses how to collect. Applying
   credit is always a deliberate action: a button on an unpaid order, or a "use account credit"
   tender at checkout. If you retire an auto-apply sweep, turn it into a no-op rather than hunting
   every caller.
5. **A sync trigger that only upgrades an appointment to "paid" never downgrades it.** So void, like
   refund, must itself flip the appointment's payment status back to due when the order leaves paid,
   or the calendar shows a stale "Paid". Capture the pre-void status BEFORE the trigger rewrites it.
6. **Void must reallocate tips** the same way refund does, or a voided payment's tip stays live in
   the tips ledger and in payroll.
7. **Commission reacts automatically. Do not hand-adjust it.** A void or refund lowers amount paid
   or inserts a refund row; the commission recompute follows the money. For that to work, the sync
   trigger must keep amount paid equal to the surviving money (count a partially refunded payment at
   its gross and let the refund rows carry the reduction, consistently).
8. **Route by "is it processor-backed", not by the method string.** Card, saved card AND online all
   carry a gateway payment id and must reverse at the GATEWAY. Gating on `method == 'card'` silently
   skips the gateway reversal for online card charges.
9. **Voided payments must drop out of every money read.** Revenue analytics, the receipt's total
   paid, accounting, payment-list totals and commission reports all filter voided out. A new report
   that sums payments must too.
10. **Know the ledger's real type strings and signs.** A gift-card redeem was stored as type
    `redeem` with a NEGATIVE amount, and the restore as `refund` with a positive amount. An
    accounting query that looked for `redemption` counted nothing. Sum the negated amount over both
    types so redemptions count and voids net back out.

Void is ALWAYS per payment. There is deliberately no whole-sale void: to undo a split-tender sale
you void each payment. Build it as one shared control (button, tooltip, confirm, card-versus-ledger
routing, cache invalidation) and drop it next to every per-payment refund button.

---

## Delayed-settlement tenders (ACH / bank debit)

ACH is the one tender whose money does NOT move at charge time. An off-session bank debit returns
"processing", settles over 1 to 4 business days, and can still FAIL afterward (insufficient funds,
closed account, a dispute up to about 60 days). It breaks the usual "charge succeeds, record
succeeded, done" rhythm.

- **Tender shape.** It can stay under the processor-charge method with a sub-method of `ach` and a
  pending marker in metadata. It does not need its own top-level method.
- **Record PENDING. Never paid, never declined.** Insert the payment with status pending. This is
  load-bearing: the totals trigger sums only succeeded and partially refunded payments, so a pending
  payment contributes zero to amount paid and the order stays open. It can never falsely read as
  paid. Do NOT advance any entitlement (membership period, package credits) on pending.
- **The webhook is the money-truth net.** Success flips the pending payment to succeeded, the
  trigger flips the order to paid, THEN the entitlement work runs. Failure marks it failed and runs
  dunning. A late return (bounced days after apparent success) marks it failed, rolls back any
  advanced entitlement and runs dunning. **The late-failure event must be enabled on the webhook
  subscription**, or late returns never reach you and the customer stays "paid" on reversed money.
- **Idempotency and the one critical guard.** Settlement is keyed on the gateway payment id and
  gated on the pending marker. The gate is essential: a CARD charge records its payment succeeded
  synchronously, so when the processor later sends "payment succeeded" for that card payment, the
  settlement code must be a no-op. Without the gate it advances the period a second time. Always
  gate delayed settlement on the delayed-settlement marker, never on "this payment has a membership
  id."
- **No double draft.** The renewal job must skip anyone whose previous bank debit is still pending,
  or the next tick charges again before the first clears.
- **UI honesty.** Pending shows "Processing (bank transfer, 1 to 4 business days)", never "Paid" and
  never "Failed". Saved-method pickers render a bank as "Bank ending 6789 (ACH)", with no expiry.
  The in-person tap stays card-only; a bank debit is save-a-bank plus recurring plus payment link.

---

## Mandatory wiring for any money path you add

1. **Every customer message is logged.** Email and SMS go through the logging helpers, never the
   provider directly.
2. **Real failures alert.** In a webhook, a cron or an automated path, a bare console error emails
   nobody. Pair it with the error reporter. Money-moved-no-record is critical. Benign skips are
   silent. See `error-alert-system`.
3. **Database changes to money functions are byte-for-byte.** Before any replace: pull the LIVE
   function body, diff so only your intended lines change (every other tender branch preserved
   verbatim), keep the privileged function's grants (revoke from anonymous and public, grant to
   authenticated and service), and get explicit permission before any drop.
4. **Verify by exercising the REAL entry point, not a proxy.** The credit double-spend slipped
   through because the test called the "add a payment" function directly and never ran the "create
   the sale" function. Test the actual entry points, in a rolled-back block against live data if
   needed.

---

## The golden rules

1. **Handle every tender in EVERY mint path.** A one-sided fix is a shipped bug.
2. **Never invent a parallel money mechanism.** There is one canonical function each for redeem,
   refund, mark-paid and sync-totals. Route through it.
3. **Credit tenders redeem inside the privileged function, never by a client insert.** The row
   policy enforces it; a new credit tender goes on the block list.
4. **Money is integer cents. Amount due can be negative, and that is store credit. Status cannot
   contradict the money.** Derive status from the money, always.
5. **Reverse (same session, deletes) is not Refund (money back, terminal) is not Void (undo a
   mistake, reopens, keeps the row).** All three restore credit ledgers.
6. **Byte-for-byte on money-function edits, and test the real function.**
7. **Any path that records a credit tender redeems its ledger in the same transaction, or refuses
   it.**
8. **Every gateway capture lands on a live order no matter what the operator does mid-tap.** One
   settler, idempotent recording per gateway id, and nets that say nothing about money that is
   already recorded.

When in doubt, read the live function body before changing anything. The database is the source of
truth; a document like this one is only the map to it.

## Related skills

- `money-truth-doctrine`: the seven invariants, settlement crossover, typed errors, reader timeouts.
- `payment-processor-integration-checklist`: everything to wire per processor, and how to ask the
  gateway what really happened.
- `memberships-and-packages-design`: the package and membership credit ledgers used as tenders.
- `commission-system-design`: how commission follows the paid amount.
- `saas-subscription-billing`: the SEPARATE domain of merchants paying the platform.
- `error-alert-system`, `report-verification`.
