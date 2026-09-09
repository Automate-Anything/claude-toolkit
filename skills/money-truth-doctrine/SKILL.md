---
name: money-truth-doctrine
description: The portable, stack-agnostic doctrine for building a point-of-sale / payments path that can NEVER lie about money. Read this FIRST for ANY money-path work in any repo: charging a card, recording a sale, refunding, voiding, reconciling stranded charges, handling a physical reader/terminal, or wiring a new payment processor. It is seven hard-won invariants (charge+record atomicity, write-the-attempt-before-the-money, a gateway id is not proof of capture, never invent a decline your software made up, frequent two-way auto-healing reconcile, one idempotent charge-type-agnostic recovery primitive with an intake-source allowlist, never auto-refund / never silently hide unrecovered money) plus the UX corollaries and the meta-rule for getting it right the first time. Use when the user mentions POS, checkout, taking a payment, a card charge, refund, void, decline, stranded/phantom charge, double charge, reconcile, card reader/terminal, or "did this payment actually go through."
---

# The Money-Truth Doctrine

> ⚠️ **This is a design doctrine, not a description of an existing system.** It tells you how a
> money path SHOULD be built so it can never lie about money. Nothing here names files, tables, or
> functions in your repo, because it is meant to be dropped into any codebase. When you implement it,
> the concrete mechanisms below (the attempt row, the reconcile crons, the recovery primitive, the
> alert wiring) become real files in YOUR repo. Once they exist, extend this skill with a short
> "how it's wired here" section pointing at them, so the next agent finds the real code, not just the
> principles.

This is the hard-won mental model for building a POS / payments path that **can never lie about
money**. It is PORTABLE: the principles hold for any codebase, any processor, any stack. Every rule
below was paid for by a real production incident (charges that captured but showed "declined";
charges that captured but were never recorded; phantom debt; false declines caused by our own
timeouts). Each rule is stated as "here is the failure mode, here is the invariant that makes it
impossible."

**The one sentence:** *money moving and money being recorded must be inseparable; when they can't be
atomic, every gap must be detected and auto-healed within minutes, and the ONLY decline a customer
ever sees is one the gateway itself returned, never one our software invented.*

## The seven invariants

**1. A charge and its record must be ATOMIC, or backstopped. Never "hope the client finishes."**
The classic hole: the client (browser/app) charges the card in step 1, then records the sale in a
SEPARATE step 2. If the client dies in between (tab closed, network drop, crash), the money moved and
no sale exists. Fix, in priority order: (a) make charge+record ONE server operation (the server
charges, then books the order before responding, so the client can't strand what it never had to
finish); (b) where truly async (a physical reader that settles out-of-band), STAGE the full cart on
the server BEFORE the charge so the server can complete the sale itself on success; (c) always have a
reconcile backstop (invariant 5). Never rely on the client completing step 2.

**2. Write the attempt row BEFORE the money moves.** Every charge path must insert a "payment
attempt" record (pending) *before* calling the gateway. Then money can never move without at least a
row existing to reconcile against. The attempt row is the spine of every recovery mechanism.

**3. A gateway id / reference number is NOT proof money moved. Only the gateway's OWN "approved +
not voided" verdict is.** Real incident: an ERRORED transaction still came back with a numeric
reference, which *looked* like a real capture. Rule: never infer "captured" from the shape or
presence of an id. Confirm against the gateway's authoritative result field (e.g. Stripe
PaymentIntent `status='succeeded'`; Square Payment `status='COMPLETED'`; a gateway that returns a
result-code + a void flag must read BOTH: approved AND not-voided). A voided-but-approved row reads
as FAILED, not succeeded, or you double-book a sale that collected nothing.

**4. Never let OUR software invent a decline. The only decline a customer sees is one the gateway
returned.** Real incident: a reader session TIMED OUT or ERRORED and we finalized it "declined", but
a late or keyed auth can approve at the gateway AFTER the session died, and an "error" can coincide
with a real capture. Rule: before finalizing ANY non-succeeded terminal or async result as declined,
PROBE the gateway ("did this actually capture, by the request id it stores in FULL, not a truncated
field") and if it captured, record it as succeeded. A timeout must NEVER produce a false decline;
only a genuine issuer decline (the gateway's own "no") may finalize without a probe. Distinguish "the
customer didn't tap in time" (correct decline, nothing captured) from "we stopped listening too
early" (the money may have moved, probe first).

**5. Reconcile BOTH directions, FREQUENTLY, and AUTO-HEAL. Don't just alert.** Two independent nets:
- **Attempt-driven** (every minute-ish): find every attempt that is `succeeded` + real-money-id +
  no order, and BOOK it (record the money that already moved as a real paid order). Idempotent.
- **Gateway-driven** (every ~15 min, short lookback): ask each gateway "what did you capture?" and
  assert every capture has a record on our side; recover or alert the mismatches. This catches a
  capture we have NO attempt row for at all.

"Once a day" is not enough (a phantom charge sits up to 24h). The nets must AUTO-BOOK, not merely
page a human: the same fix a human would do by hand, done by the cron that detects it.

**6. Make recovery a SINGLE canonical, idempotent primitive, and make it charge-type / path-AGNOSTIC.**
Real incident: recovery was a multi-step, per-charge-type sequence (staged cart? existing session
order? then book) and a hole in the sequencing (an empty pre-minted order from a *declined* sibling
tap in the same session) swallowed a real capture and starved the book step. Rules:
- ONE `book_stranded_charge`-style operation that does link-or-book atomically, guarded by the
  REFERENCE NUMBER (link only to an order that records THIS reference; never to "some order in the
  session" or "an order whose *other* tenders sum to enough", both mislink). It must be idempotent
  (already linked -> no-op; reference already recorded -> link; else mint), so calling it twice is safe.
- Have MORE THAN ONE independent net call it, and make at least one net NOT filter by charge type or
  step-sequence, so a hole in one path can't strand money the agnostic net would catch.
- Guard the primitive with an INTAKE-SOURCE allowlist: only auto-book genuine walk-up / online sales
  (pos / online / link / gift / package / tap-to-pay / customer-portal). A recurring / autobill /
  membership / refund capture must NOT become a generic "reconciled" order; it needs its own re-link.
  Refuse it here and let it page a human. (Verify your allowlist against the REAL source enum: a
  missing intake source silently refuses real sales; a bogus value is dead code.)

**7. NEVER auto-refund to "tidy up," and NEVER silently hide unrecovered money.** A charge with no
order is almost always OUR bug, not a customer owed money back: the customer really did buy
something. Auto-refunding means the business delivered the service and got nothing, with nobody told.
Rule: money only ever goes BACK when a HUMAN sends it back. Recovery BOOKS (keeps the money, records
the sale); only a human refunds. And a "skip" / "can't-auto-book" branch must not stamp a "handled"
marker that hides the row from the human pager: a real capture we can't auto-book MUST still surface
loudly. The only silent path is a genuinely benign one (a tiny probe charge, an already-booked row).
If real money is uncertain, PAGE. Never swallow.

## The UX corollaries (the customer / operator must never be confused)

- **"Save card" + a reader that can't tokenize a tap -> stop the reader and say "enter the card
  manually to save it."** Never a dead button, never a silent failure, never let a tap-save and a
  keyed-save both land. Disarm the reader the instant the operator opts into an action the tap can't
  do, and self-document WHY on the control.
- **A false "Declined" panics the operator into re-charging.** When a charge actually went through
  but recording failed, the operator message must be "Card charged, do NOT charge again; we're
  recording it," never "payment not saved / try again." When nothing was captured (a genuine error or
  timeout with no money), say "did not go through, nothing charged," never a scary "Declined by the
  card issuer."
- **An auto-recovered order must render HONESTLY.** A generic "Sale (reconciled)" line + a
  plain-language note ("this charge was captured but the sale wasn't booked; the payment is real; add
  detail if you want"). The operator sees the truth (paid, real card) and a clear next action. Never
  fake specifics.
- **A pre-minted-then-abandoned order header must be reaped** (auto-voided after a grace) or it
  becomes phantom accounts-receivable / phantom customer debt. Predicate it narrowly (open + zero
  lines + zero payments + no pending attempt + aged) so a real open sale is never voided.

## The void/refund settlement invariant (build EVERY processor this way)

A captured card sits in one of two states, and the two money-reversal commands are not interchangeable:
- **UNSETTLED** (same-day, before the processor's batch/settlement): the charge can be **VOIDED** (it
  never hits the customer's statement) but usually **cannot be refunded**.
- **SETTLED**: the charge can be **REFUNDED** (money goes back) but **cannot be voided**.

The operator must NEVER have to know which state a charge is in, and a reversal must NEVER fail
because the app picked the wrong command. So **every full reversal auto-crosses-over**: a "Refund"
that can't refund (unsettled) transparently becomes a void; a "Void" that can't void (settled)
transparently becomes a refund. The operator's action ALWAYS succeeds.

Build rules for a new processor's refund path:
1. A full reversal must SUCCEED whether the charge is settled or not. If the gateway has ONE command
   that auto-resolves, use it for full reversals. If it has SEPARATE void/refund commands, TRY the
   natural one and auto-fall-back to the other on the gateway's settled/unsettled error: do NOT
   surface that raw error and do NOT make the operator retry.
2. Report back what the gateway ACTUALLY did (voided vs refunded) so the UI can show a non-silent
   notice. The transition is automatic but the operator must SEE it ("this charge had already
   settled, so it was refunded, not voided; the money goes back the same").
3. Decide full-vs-partial from the original captured amount, inside the reversal path (not by
   omitting the amount at a route layer, which can throw or silently over-refund).
4. Never send an explicit partial amount to a full-only void command (it either errors or silently
   voids the WHOLE charge, over-refunding a partial).

## Typed errors, not thrown gateway strings

An EXPECTED gateway/flow condition (a card decline, a duplicate-transaction idempotency guard where
the first charge likely SUCCEEDED, a too-small/too-large amount, a $0 charge, an offline/busy reader)
MUST surface as a TYPED error with an explicit status (a clean 4xx: 400 input, 402 decline, 409
conflict/duplicate) + a stable code + an honest message, OR (for a plain card decline on a charge) a
RETURNED failed result. NEVER a bare `throw new Error(<gateway string>)`: that has no status, so a
global error handler that pages on `status >= 500` returns a 500 AND pages engineering for what is
normal flow control. The client should mirror this: a known set of expected 4xx statuses
({400,402,404,409,422,429}) is surfaced verbatim with no client-side alert. When onboarding or
auditing a processor, grep its charge/refund/capture branches for `throw new Error(` and confirm each
is either an unreachable fault (the SDK returned nothing) or converted to a typed 4xx.

A processor that THROWS on a decline (instead of returning a failed result) loses the decline code
AND gets the attempt recorded as `unknown`, which the reconcile cron then treats as a
possibly-stranded charge. A clean decline must be RETURNED as failed with a reason + code; only true
infra errors (auth/network) should throw.

## The ARM-vs-WAIT timeout trap (any physical reader / async tap)

There are TWO different reader timeouts and they need OPPOSITE handling:
- **WAIT timeout** (post-arm): the reader is armed and waiting for a tap and the wall-clock deadline
  elapses. This is a NON-EVENT: the panel silently re-arms within the wait budget, and a real
  wait-timeout is never a decline and never an alert (invariant 4).
- **ARM-COMMAND timeout** (at initiate, BEFORE the wait loop): the API call that ARMS the reader times
  out, so you never reach the wait loop. This one gets missed. It is AMBIGUOUS: the reader might
  actually be armed and prompting for a tap, or the command never landed. Both wrong answers are bad:
  a blind silent re-arm DOUBLE-ARMS an already-armed reader (two live authorizations = a
  double-charge), and a flat "tap again" DEAD-ENDS the operator.
- **The correct pattern:** on an arm-command timeout, ASK THE READER'S REAL STATE instead of guessing.
  If the reader reports it is armed for THIS payment, fall through to the normal wait/poll (one
  session, seamless). Otherwise the arm did not land: return a clean, non-paging timeout code and let
  the UI silently re-arm (bounded: cap the retries, reset on a fresh arm, only while inside the wait
  window) so the operator never sees a stop and a genuinely dead reader still surfaces after a few
  tries.
- Do NOT copy one processor's re-arm fix blindly onto another: the re-arm's double-charge safety
  depends entirely on that processor's idempotency / session model (an idempotency-keyed server object
  is safe to retry ONLY if the SAME key is reused; a pre-inserted attempt row needs its own design).
- An arm-command timeout is a benign transient: it must NOT report an error. Only a genuinely
  unexpected branch (neither a known device state nor a timeout) stays an error+5xx.

## Decline codes: research them, don't guess

When you map a gateway's decline codes to human labels:
1. **Authoritative source, not the codes you happen to see.** Fetch the processor's own decline-code
   reference and map every code to a category from THAT, not from free-text that happened to sit next
   to a code in your data. A guessed map is a lie shown to the customer.
2. **Do NOT force-map an AMBIGUOUS catch-all code to a fixed category.** A processor often reuses one
   generic code for many issuer declines while stamping the SPECIFIC reason in the text. Mapping a
   generic code to "Suspected fraud" made an insufficient-funds decline read as "Suspected fraud",
   wrong and offensive. OMIT such catch-all codes from the code map so the descriptive reason text
   drives them via a keyword fallback. Resolve order: no-card flag -> cancel/timeout keyword -> CODE
   map (specific codes only) -> REASON keyword -> AVS/CVV -> generic.
3. Every category needs a **security-safe human label** (lost/stolen/fraud -> "Card blocked" /
   "Flagged for security", never "stolen"), with the raw code shown as a "Processor code" field so
   support can look up the exact issuer response.

## Wire it into alerts (so a human learns of anything the machine couldn't fix)

Every recovery path reports through an error-alert system (see the `error-alert-system` skill): an
auto-BOOK is silent/info (visible, no 3am page, escalates on a spike so a systemic cause still
surfaces); an unrecoverable real capture, a broken reporting/credentials key (which blinds the whole
gateway-probe net, so real captures would silently decline), or a give-up-after-N-retries is
critical. The rule: the machine self-heals the routine case quietly, and pages a human ONLY for what
it genuinely cannot make true on its own.

## The meta-rule (how to build this the FIRST time)

Do not claim "bulletproof." Claim "atomic where possible + two independent idempotent auto-heal nets
+ gateway-truth verified + human-paged for the rest." For EVERY money path ask, out loud, "if the
client dies RIGHT HERE, what happens to the money and to the record?", and don't ship the path until
the answer is "recorded, or auto-healed within minutes, or loudly paged; never lost, never a lie."
When you find ONE new hole, don't just patch that sequence: ask what CLASS it belongs to and close
the class (usually: add or strengthen an agnostic idempotent net, don't add another fragile
conditional).

**Order of authority for any "what happened to this money" question: gateway truth > your production
logs > your database.** Build a read-only way to ask the gateway directly (its own API's retrieve /
report call), so you can confirm what really happened to a charge before you record, correct, or
refund anything, without a shell into production.
