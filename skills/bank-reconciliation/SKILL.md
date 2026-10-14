---
name: bank-reconciliation
description: How to design and build bank reconciliation in any app, matching each bank transaction to the invoice, order, payment, processor payout, bill, or tenant it belongs to, and proving the books tie to the bank. Written to fit whatever the current repository is: it starts by mapping that repo's own money records, then gives the data model, the matching passes, the hard cases (batched deposits, processor fees, partial, over and returned payments, transfers between own accounts), the review queue, and the reports. Read it before building or changing reconciliation, matching bank lines, "unmatched deposits", "does the bank tie out", or auto-categorizing bank transactions. Getting the transactions and balances from the bank in the first place is a different skill, `bank-transaction-feed`.
---

# Bank Reconciliation: matching bank lines to what the app already knows

This skill starts where `bank-transaction-feed` ends. That skill only GETS the transactions and
balances from the bank every day. This one decides what each transaction is. Reconciliation answers the next
question for each one: **what is this money?** Which invoice, order, payment, payout, bill,
tenant, or customer does it belong to, and does the app's own record agree with the bank?

This is written to fit ANY app. Every app keeps its money records differently: invoices and
payments, orders and charges, rent ledgers, payouts from a card processor, vendor bills. So
the first job is always to map this design onto the records THIS repository actually has.
Nothing below names a real table; every name is an example of a shape.

> **Adapt before use.** This describes how reconciliation SHOULD be built, from standard
> accounting practice. It is not taken from a running system. Once it is built in a repo,
> update this skill (or the repo's own skill) with the real tables, functions, rules, and
> screens, so the next agent finds real code instead of a pattern.

---

## Step 0. Map it to this repository first (do not skip)

Before writing anything, answer these from the code and the live database, not from memory:

1. **Where does money the app EXPECTS live?** The things a bank line could pay or be paid
   for. Examples: invoices, orders, rent charges, subscription renewals, vendor bills,
   payroll runs. Note the amount field, the currency, the due or expected date, the status
   field, and any reference number the customer sees.
2. **Where does money the app has RECORDED live?** Payments, charges, refunds, transfers,
   deposits. Note how each is tied to the expected item, and whether one payment can cover
   several items.
3. **Which money never touches the bank one item at a time?** Card processors (Stripe,
   Square, others) collect many charges and deposit ONE net payout, minus their fees, days
   later. Cash is deposited in batches. Checks may be deposited together. Find every such
   batching source: it changes how matching works (see "Batched deposits").
4. **Who owns the money?** Single business, or many tenants or locations? If many, every
   bank account must belong to exactly one tenant, and every match must stay inside it. A
   match across tenants is a security bug, not a convenience (see `security-rls-permissions`).
5. **What is the source of truth for amounts?** Usually cents as whole numbers. Never use
   floating point for money. Read `money-truth-doctrine` before touching any money path.
6. **Is there already an accounting or ledger layer?** (Its own journal, or a sync to
   QuickBooks or Xero.) If so, reconciliation must write through it, not beside it, or the
   two will disagree.

Write the answers into the repo's skill as a short table. Every rule below is expressed in
terms of "expected items", "recorded payments", and "payouts"; replace those words with this
repo's real records.

---

## The data model (shapes, adapt the names)

Keep the bank's facts, the app's facts, and the link between them in separate places. Never
edit a bank line to make it match; the bank line is evidence.

| Shape | What it holds | Notes |
|---|---|---|
| **bank_account** | one row per real account | owner (tenant), bank, last four digits, currency, the feed it comes from |
| **bank_transaction** | one row per bank line, as loaded | account, posting date, amount in cents (signed: in is positive, out is negative), the bank's type code, description text, bank reference, the source file name, and a uniqueness key so a reloaded file never doubles a line |
| **reconciliation_match** | the link | bank_transaction id, what it matched (type + id of the expected item, payment, or payout), amount applied, who or what made it (a rule name, or a user), when, and a status (active / undone) |
| **reconciliation_exception** | lines that need a human | bank_transaction id, reason code, suggested candidates, assigned to, resolved at |
| **reconciliation_rule** (optional) | saved rules a user taught the system | conditions (description contains, amount, account) and the action (categorize as fee, match to a vendor, ignore as transfer) |

Rules for the model:

- **A bank line can be split** across several items (one deposit pays three invoices), and
  **an item can be paid by several lines** (a customer pays in two parts). So a match is a
  row per link with an amount, never a single column on either side.
- **The sum of active matches on a bank line can never exceed the line's amount.** Enforce
  it in the database (a constraint or a guarded function), not only in the UI.
- **Undo is a status change, not a delete.** Keep who undid it and when. Reconciliation is
  audited work; the history matters.
- **The uniqueness key on bank lines** is what makes reloading a file safe. Build it from the
  account, date, amount, bank reference, and the line's position in the file when the bank
  gives no reference.

---

## Matching, in passes (most certain first)

Run the passes in order on every unmatched line. Each pass only looks at what the earlier
passes left. Keep every rule deterministic: the same inputs always give the same match, and
the match records which rule made it.

**Pass 1. Exact reference.** The bank description or reference contains an identifier the
app issued: an invoice number, an order number, a payment reference, a processor payout id.
Match when the reference is found AND the amount agrees. A reference match with a different
amount is NOT a match: it goes to exceptions as "partial or wrong amount".

**Pass 2. Payouts from a processor.** For each processor deposit, find the processor's payout
record for that date and amount (the processor's API lists payouts and the charges, refunds,
and fees inside each). Match the bank line to the payout, then the payout to its charges.
This is how card money reconciles: never try to match a net deposit to single charges by
amount, it will not add up because of fees and refunds.

**Pass 3. Exact amount + close date + one candidate.** Same amount, same direction, date
within a small window (for example 3 business days, longer for checks), and exactly ONE open
expected item fits. If two or more fit, it is not a match: send it to exceptions with all
candidates.

**Pass 4. Saved rules.** Rules a user taught the system: "description contains MONTHLY
SERVICE FEE: categorize as bank fee", "transfers between our own accounts: pair the two
sides". Each rule application is recorded with the rule's id.

**Pass 5. Suggestions only.** Fuzzy name matching, amounts that are close, combinations of
open items that sum to the line. These NEVER match automatically. They become suggested
candidates on the exception for a human to confirm.

Two hard rules across all passes:

- **Never auto-match when there is doubt.** A wrong automatic match is worse than an open
  exception: it marks an unpaid invoice as paid and hides it. Prefer leaving it for review.
- **Matching never changes amounts.** If the money differs, the difference is recorded
  explicitly (fee, short payment, overpayment), never absorbed by rounding.

---

## The cases that always come up

- **Batched deposits.** One deposit, several items (a day's cash, several checks, a
  processor payout). Match the line to the batch or payout, and the batch to its items.
  If the app does not record batches today, that is the first thing to add.
- **Fees taken out.** The processor deposits net. The fee is a real expense line, matched
  explicitly, so the books show gross sales and the fee separately.
- **Partial payment.** Apply what arrived; the item stays partly open with the remainder.
- **Overpayment.** Apply up to the amount due; the extra becomes a customer credit or a
  refund to make. Never silently drop it.
- **Refunds and chargebacks.** Money out that reverses an earlier payment. Match it to the
  refund or dispute record, not to a new expense.
- **Returned payments (NSF, failed ACH).** A deposit comes back days later as money out.
  Match the return to the original payment, reopen the item, and tell the person who owns
  the follow-up. This is a customer-facing event, not only a ledger entry.
- **Transfers between your own accounts.** Two lines, one out and one in, often on
  different days. Pair them; neither is income or expense.
- **Duplicates.** The same file loaded twice, or the bank resends a day. The uniqueness key
  stops it. If a duplicate still appears, it is a loader bug: fix the key, do not delete rows
  by hand.
- **Weekends and holidays.** Dates shift to the next business day. Use business-day
  windows, not calendar days.
- **Currency.** Match only within the same currency. Conversion is its own explicit line.

---

## The review queue (the human part)

Most lines match on their own; the rest must be easy for a person to clear.

- One screen of open exceptions, oldest first, filterable by account and reason.
- Each exception shows the bank line, why it did not match, and the suggested candidates
  with what each would leave open.
- Actions: confirm a suggestion, match to something else (searchable), split across several
  items, mark as a fee or transfer, create a rule from this decision, or leave a note.
- **Every action is undoable** and recorded with the user and time.
- When a person matches something by hand, offer to save it as a rule so the same line is
  automatic next time.
- Read `build-with-the-user-in-mind` before building this screen: the person here wants to
  clear a pile quickly and trust the result.

---

## Proving it is right (the reports)

Reconciliation is only done when the numbers tie out. Build these and check them against live
data (see `report-verification`):

- **The bank tie-out per account per day:** opening balance from the file, plus every line,
  equals the closing balance from the file. The BAI2 account record carries both balances.
  If this does not tie, the feed is wrong, and nothing downstream can be trusted.
- **Matched versus unmatched:** count and total of matched, open, and exception lines, by
  account and age. Old open lines are the work list.
- **The app versus the bank:** for a period, total payments the app recorded as received
  versus total money in the bank attributed to them. The difference must be fully explained
  by named items (in transit, fees, returns), not by a plug figure.
- **Items the app thinks are paid but no bank line backs.** This is the report that catches
  real problems (a payment recorded but never deposited).

---

## Running it

- Run matching right after the daily feed loads, in the same job or the next step.
- Make it idempotent: running it twice never creates a second match.
- Report failures through the repo's error system (`error-alert-system`), and route
  customer-facing events (a returned payment) to the person who handles them, not only to
  engineering.
- A multi-tenant app runs matching per tenant and per account, and never lets a candidate
  from one tenant be suggested for another tenant's line.

---

## Building it, in order

1. Step 0: map the repo's money records and write the table.
2. The data model, with the uniqueness key and the "matches never exceed the line" guard.
3. Pass 1 and Pass 2 (references and processor payouts). These usually clear most volume.
4. The exception queue and manual matching with undo.
5. Pass 3 and saved rules.
6. The reports, verified against a real account's live data.
7. Suggestions (Pass 5) last.

Then update this skill, or the repo's own skill, with the real names.
