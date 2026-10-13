---
name: payment-processor-integration-checklist
description: The granular, per-FEATURE checklist of everything that must be wired before a card payment processor (Stripe, Square, Cardknox/Sola, Clover, PayPal, Finix, or a new one) is fully working in an app, plus how to ask the gateway for the truth about a payment. Covers core payment (keyed charge, saved-card off-session charge, refund, void, capture, 3-D Secure, network account updater), decline reasons into payment history (and why a timeout or cancel is a non-event, never a decline), reconcile lookups, saving a card (keyed, on tap, on the reader), bank accounts (ACH), the physical reader suite (pairing, card-present charge, cancel money-safety, the never-unknown register state, connectivity test), connecting and configuring a processor, the infrastructure a new processor TYPE touches (plugin, factory, type unions, DB constraints, webhooks, duplicated capability lists), advanced features (customer and saved-card import, surcharge, fraud signals, hosted checkout), per-processor quirks already paid for, and a read-only gateway verification tool with its playbook. Read this BEFORE adding a new processor, bringing a partial one to parity, auditing what a processor can and cannot do, or recording / correcting / refunding money whose real state you have not confirmed. Use when the user mentions connecting or onboarding a payment processor, a card reader or terminal, saving a card on file, tap to save, decline reasons, a decline code, a timeout showing as a decline, 3DS / SCA, requires_action, ACH, processor parity, "did this payment go through", a reference number, "is it voided", a double charge, a stranded charge, or "why did this charge fail."
---

# Payment processor integration checklist (and how to get gateway truth)

> **Adapt before use.** This describes what SHOULD be wired for a processor to count as fully
> working. It is taken from a production POS that runs several processors side by side. Nothing here
> is wired in your repo yet. Turn the tables below into a live checklist in your repo with one
> STATUS column per processor you support (done / partial / missing / not applicable / needs
> verification), flip a cell when you ship it, and replace the example names with your real ones.

Read `money-truth-doctrine` first. It owns the seven invariants, the void/refund settlement
crossover, typed errors, the arm-vs-wait reader timeout and decline-code research. Read
`stripe-best-practices` for Stripe API selection. This skill adds what those do not have: the full
per-feature task list, one more invariant, one more UX corollary, the per-processor quirks, and the
verification tool.

Use it two ways:

1. **Adding a new processor.** Walk every row. Do it or mark it not applicable.
2. **Auditing an existing one.** The status column tells you what is done versus missing.

A lesson to hold while you fill in the status column: **a "done" cell means "wired", not "verified
live".** One processor's capture-safety sweep read "done" for weeks while every run returned a 400
from the gateway, because a list call omitted a required sort field. When auditing, re-run the
actual gateway call.

---

## Two additions to the Money-Truth Doctrine

**Invariant 8: discovery is not booking. Every net asks ground truth before it records or speaks.**
The recovery nets overlap by design (browser, status poll, cancel probe, session poller, reconcile
job, recovery job, sweep, re-arm backstop). Each one, before recording a capture or announcing it,
asks ONE authoritative question: is this gateway id already a payment row on a live, non-void order?
If yes, adopt that order silently, stamp the attempt so no later net revisits it, and create NO
ticket. Only a genuinely NEW record earns an info ticket. The recording primitive is itself
idempotent per gateway id on the same order, so two nets racing can never insert twice.

Why this is an invariant and not a nicety: across five days, five alerts that made the owner feel
"it keeps happening" were nets re-announcing money that had been correct for hours (a 22-hour-late
job, a keyed 3-D Secure sale finalized late, a forked cancel probe). The books were right every
time. The SYSTEM was talking about it too many times. Also: a net's candidate filter lives in SQL,
never only in an application post-filter behind a row limit, or the "every minute" net is blind to
fresh strands while older rows fill its page.

**UX corollary: the register must NEVER be left in an unknown state, and CANCEL confirms twice
before it says "cancelled."** A card-present flow has a race: the customer can tap at the exact
moment the operator cancels. So:

- The confirmation screen HOLDS (blocking: no close, no switch tender, no re-ring) while the outcome
  is unknown, and resolves to a DEFINITE paid-or-cancelled within a few seconds by force-reading the
  gateway's own result. It must never drop to a "pending, close and check later" state that lets the
  operator walk away or take another tender on a possibly-captured tap. (An earlier "keep working in
  the background" escape hatch was removed for exactly this reason.)
- CANCEL reads the processor's OWN result BEFORE stopping the reader AND AGAIN right after, because
  a tap can win during the stop. "Cancelled" is shown ONLY after two confirmations of no capture.
  A won tap is KEPT and shown paid, never refunded to tidy up.
- An undetermined outcome never finalizes as declined. It returns a "still verifying" answer so the
  client keeps holding.
- Enforce "cannot walk away" at the HOST too: a dialog that hosts the reader panel refuses to close
  while the panel is busy. And while a reader is live, the checkout freezes other tenders and cart
  edits with "Finish or cancel the card reader first", so a second tender can never race the tap.
- This is processor-AGNOSTIC. Drive it off panel state, not processor type, so every reader behaves
  identically.

---

## A. Core payment

| # | Feature | Notes |
|---|---|---|
| A1 | **Keyed / manual charge** at the register | In-session charge from a tokenized card form. |
| A2 | **Saved-card off-session charge** | This is what makes recurring, memberships and auto-billing work. |
| A3 | **Refund** a payment | Full and partial. |
| A3b | **Void/refund auto-crossover by settlement state**, and report back what the gateway actually did | The rule and the four build rules are in `money-truth-doctrine`. Per-processor notes below. |
| A4 | **Void / cancel** an authorization | |
| A5 | **Capture** a manual-capture authorization | |
| A6 | **3-D Secure / SCA completion** for keyed and saved-card charges | See the A6 detail. |
| A7 | **Network account updater** | See the A7 detail. |

### A3b per-processor notes

- **Cardknox/Sola needs YOU to pick the command.** Its combined void-or-refund command is the
  universal full reversal: it voids if unsettled and fully refunds if settled. Route every FULL
  reversal there. A true PARTIAL uses the plain refund command, which is settled-only. An unsettled
  partial genuinely cannot happen: say "this settles tonight, refund in full now or partially
  after", and do not page anyone. The original failure: a full refund 40 seconds after a charge
  failed with "refund not allowed, issue void", the customer was not refunded and the operator was
  stuck.
- **Stripe and Square cross over natively.** Register charges capture immediately and a single
  refund call always works on a captured charge. An uncaptured authorization is a separate cancel
  path. A Square payment that is already COMPLETED cannot be cancelled: reverse it with a refund and
  record it as a void in your own books if that is what the operator pressed.
- **Decide full versus partial from the original captured amount (plus tip), resolved in ONE
  dispatcher** so every caller gets it, never per route. Do not force "full" by omitting the amount:
  one SDK converts the amount with a big-integer constructor and THROWS on undefined.
- **Not silent.** When the action taken differs from the button pressed, show a brief honest notice:
  "this charge had already settled, so it was refunded, not voided" or "it had not settled yet, so it
  was voided instead of refunded, the money goes back the same."

### A6 detail: "requires action" is NOT a decline

This was a real, high-impact bug. For many cards the bank requires 3-D Secure ("approve in your
banking app"). On a keyed or saved-card charge the gateway then returns the payment in a
"requires action" state with a client secret. That is a recoverable authentication step, not a
decline. The register treated anything other than "succeeded" as a failure and aborted the sale, so
EVERY 3-D Secure card failed keyed entry and the cashier fell back to the physical reader (card
present does the authentication on the device, so it always worked). 22 of one merchant's 29
"declines" over 10 days were actually un-completed challenges, which ALSO tripped the fraud
decline-rate alarm.

The fix, and the pattern for any processor:

- Surface the "requires action" state to the client with whatever token the client SDK needs.
- Complete it client-side. On Stripe with the default automatic confirmation, after the client
  finishes the action the payment advances to succeeded with no server re-confirm (a manual
  confirmation mode would need one). The client call must run on an SDK instance scoped to the
  merchant's CONNECTED account, not just the platform.
- **Never trust the client.** After it resolves, call a server confirm endpoint that retrieves the
  payment from the gateway and trusts only its status.
- **That confirm endpoint must FINALIZE THE ATTEMPT in the same call.** The attempt row was opened
  pending with an "authentication pending" flag (invariant 2 of the doctrine). The confirm endpoint
  is the only server touchpoint after the challenge. When it did not finalize, every such sale sat
  pending after the register had already recorded it, the reconcile job "recovered" it minutes
  later, and two correct sales produced four tickets.
- Abandoned-authentication attempts must be FLAGGED so they do not count as declines in fraud rules.
  Key on the flag, never on decline-reason text (see H3).
- Square's equivalent is a buyer-verification call in the card form that yields a verification
  token, which must be threaded into the charge and the card-save call at EVERY entry point
  (operator, public, portal, payment link, keyed charge, tap to pay).
- Build one reusable challenge runner and one register wrapper that every card-charge site calls.

### A7 detail: network account updater

An expired or reissued saved card keeps working because the card network pushes the replacement
number and expiry to the gateway, so the SAME stored token charges the new card. Make this a
processor-agnostic capability in your code: a registry that records, per processor, the mode
(automatic / merchant opt-in / unsupported), brands, fee, how to enable, and the signal (a flag on
the charge response, or a webhook). Wire both signal paths: a response flag stamps "card updated by
network" on the attempt, and a webhook normalizes to one internal "payment method updated" event
that records a silent info ticket. Read saved-card display live from the processor so nothing cached
needs refreshing.

What was learned per processor (verify against current docs before relying on it):

- **Stripe:** automatic for saved payment methods on current plans; a webhook announces it.
- **Square:** automatic when the issuing bank notifies Square; a webhook announces it.
- **Cardknox/Sola:** merchant OPT-IN in the merchant portal, a small fee per updated card, not all
  brands, and NO API to enable it. It is reactive: after a decline the gateway fetches the
  replacement within about 10 days and the same token then charges the new card, with a flag on the
  response. The vendor says retry 3 to 5 days after the decline, so make sure dunning retries
  (for example +2, +4, +7 days) sit inside that window. Tell those merchants to switch it on.
- **Clover:** on by default for eligible merchants; the token is updated in place.
- **PayPal / Braintree:** an add-on product.

Your own proactive layer complements all of them: text or email a card-update link the month before
expiry, reading expiry live from the processor.

---

## B. Decline reasons into payment history

The plumbing is universal, but each provider must POPULATE the reason in its charge result, and the
reason only reads nicely if its codes are in the label map.

**The critical trap:** a provider that THROWS on a decline (instead of returning a failed result)
loses the code AND gets the attempt recorded as "unknown", which the reconcile job then treats as a
possibly-stranded charge. A clean decline is RETURNED as failed with a reason and a code. Only true
infrastructure errors (auth, network) throw. Watch for processors that signal a decline as an HTTP
error: Finix returns a decline as HTTP 402 with an embedded error object, not as a created transfer
in a failed state. Map it to a returned failed result.

| # | Feature |
|---|---|
| B1 | Provider sets BOTH a human decline reason and the gateway's decline code on a declined result, returned as failed, not thrown |
| B2 | The decline code is carried into the attempt row's metadata (universal plumbing, works if B1 set it) |
| B3 | It shows in payment history, list and detail, with a clean human label |
| B4 | The code-to-label map covers this processor's codes, from OFFICIAL docs, not guessed (the method is in `money-truth-doctrine`) |
| B5 | The decline response to the register carries the code, so checkout shows the specific reason live |
| B6 | Security-safe labels: lost, stolen and fraud become "Card blocked" or "Flagged for security", never "stolen" |
| B7 | A timeout, operator cancel or no-tap is NOT a decline. It is flagged "no card charged" and never stored, shown or counted as a decline |

Extra detail on B4: show the raw code as a "Processor code" field in the detail view and as a suffix
in the list, so support can look up the exact issuer response. Verify a new processor's map by
running your resolver over the processor's full documented code list and confirming every code lands
in a real category. Leave generic catch-all codes (generic decline, do not honor, call issuer) OUT
of the map so the descriptive reason text drives them.

### B7 detail: a timeout, cancel or no-tap is a non-event

Mandatory for any processor with a physical reader or an async tap.

- A reader session that ends WITHOUT the issuer ever seeing a card (the wait elapses, the operator
  presses cancel, the tap never happens, the reader errors) is finalized as a non-event, not a
  declined or failed row that surfaces as a decline. One mechanism to copy: the finalize function
  auto-stamps "no card charged" when the status is declined AND there is no real capture reference
  AND no decline code AND the reason matches a non-event pattern (cancel, timeout, no card, tap read
  failed). Rows finalized through any other status are not auto-stamped: stamp the flag explicitly
  there.
- EVERYTHING downstream excludes the flag: payment history readers, order detail, and every fraud
  rule. A new processor inherits this for free IF its cancel and timeout paths route through the
  shared finalize with an honest reason.
- **The reason text for a non-event must not contain the word "declined".** History readers
  deliberately force-SHOW any no-card row whose reason looks like an issuer decline (declined, cvv,
  expired, insufficient) so a real card problem is never hidden. That means an ambiguously worded
  non-event such as "The card was declined or the tap did not complete" LEAKS back into history.
  Write it unambiguously: "The tap did not complete (no card was read)."
- Before finalizing ANY non-succeeded reader result as a non-event, PROBE the gateway for a real
  capture. A captured tap is a SALE, never discarded.
- Hitting the wait limit is a quiet cancel, and the parked cart survives.

---

## C. Reconcile (stranded and mid-flight charges resolve themselves instead of paging)

| # | Feature |
|---|---|
| C1 | **Lookup by the gateway's id returns a REAL outcome.** A stub here means stranded charges age out to "unknown" and page a human. |
| C2 | The lookup returns the decline code too, so a reconciled decline still shows its reason |
| C3 | Lookup by YOUR request id (an idempotency search), where the gateway supports it |

C3 quirk worth knowing: Finix ignores an idempotency-id filter on its list endpoint. The working
implementation was a newest-first scan (cursor paging; offsets are ignored) over transfers and then
authorizations, matching either the idempotency id or a request-id tag you stamp yourself. The list
index lags a create by a few seconds, which is fine for nets that run minutes later. And never
replay the create to "look it up": a replay there is a duplicate error, not an idempotent return.

---

## D. Save a card on file

| # | Feature |
|---|---|
| D1 | Manual / keyed save (setup intent or tokenize) plus a per-processor card form component |
| D2 | List saved cards for a customer |
| D3 | The processor is added to the frontend "can save" and "can list" capability lists (see section Z) |
| D4 | Any non-standard save payload shape is handled |
| D5 | **Save the card ON TAP at checkout** (a card-present charge that also keeps the card) |
| D6 | **Save a card ON THE READER with no charge**, as ONE shared mechanism behind every add-card dialog |

- D5 on Stripe is a card-present payment with a customer and future-usage set. On Square the
  terminal checkout carries the customer id and, on settle, a card on file is created FROM the
  resulting payment id. Make that step idempotent across the status poll AND the webhook, since both
  will try.
- D6 is worth building once. In the source system ten different add-card surfaces (membership
  signup, payment plan, collect payment, customer profile, sell a package and so on) inherited
  "tap to save" from one shared dialog. A new reader-capable processor needs: a create-setup
  primitive, a process-on-reader primitive, the shared start/status/cancel endpoints dispatching by
  processor, and the dialog's reader-availability gate widened beyond the first processor.
- **If a reader cannot tokenize a tap, stop the reader and say "enter the card manually to save
  it."** Never a dead button. This is a doctrine UX corollary.

## D-ACH. Bank accounts (delayed-settlement save plus recurring charge)

A bank account is not a card. It is save plus recurring plus payment link only, never an in-person
tap. Most card processors have no native bank rail: add these rows only where the processor truly
supports off-session bank debits with a delayed-settlement webhook.

| # | Feature |
|---|---|
| DA1 | Save a bank account with a mandate: instant bank-login verification with a micro-deposit fallback; the account holder name is required |
| DA2 | List a saved bank in the method picker as "Bank ending 6789 (ACH)", bank icon, no expiry |
| DA3 | Charging a saved bank off-session returns PENDING. Not succeeded, not declined |
| DA4 | Record pending and do not advance any entitlement |
| DA5 | The settlement webhook is the money truth: success, failure, and the LATE failure; idempotent per payment; gated on the pending marker so a card payment's success webhook is a no-op |
| DA6 | No double draft while one is in flight (the renewal job skips anyone with a pending debit) |
| DA7 | UI honesty: "Processing (bank transfer, 1 to 4 business days)", never "declined", never "Paid" |
| DA8 | **The webhook subscription must include the late-failure event.** Missing it means a late return never arrives and the customer stays paid on reversed money. This is a dashboard/deploy task: verify it with a test trigger. |
| DA9 | A customer import brings banks and their mandates too. Verify they are attachable and chargeable. Do not assume. |
| DA10 | Manual keyed bank entry: staff types routing and account numbers off the customer's check, with micro-deposit verification. Returns saved or pending verification. |
| DA11 | Routing-number validation (the ABA mod-10 check digit, live, so a typo cannot save) and bank-name autofill |
| DA12 | A self-learning bank-name directory: every saved bank's authoritative name and routing number is upserted, so autofill fills itself from real customers. Do not fabricate a directory; there is no trustworthy public mirror. An unknown but valid routing number still saves. |
| DA13 | A per-company default method (card or bank) that the signup and checkout payment dialogs open on |

The register reality: manual keyed entry off a check is the DEFAULT bank sub-mode. Online-banking
login is the self-serve option for the customer, never forced on staff. The money model for this
tender is in `pos-checkout-design`.

---

## E. Physical reader / terminal

If the business is in-person, a processor without a working reader is not usable. Three reader
models seen so far:

- **Stripe:** a card-present payment handed to a reader; poll the reader's action status; a
  location object is required first.
- **Square:** a terminal checkout object targeted at a device paired by a DEVICE CODE typed on the
  hardware; poll the checkout status; no location object.
- **Cardknox/Sola:** a cloud session against a device serial number, with its own short fixed
  session lifetime.

Make them share one terminal storage shape, one reader panel, one settle function and one
initiate / status / cancel route skeleton. A new reader-capable processor then supplies only its own
create, poll and cancel primitives.

| # | Feature |
|---|---|
| E1 | Connect / register a reader (pairing code, serial, or device code with poll-until-paired) |
| E2 | Any prerequisite object created and cached (for example a terminal location) |
| E3 | Take a card-present charge on the reader |
| E4 | The poll uses the AUTHORITATIVE reader signal for that processor, not a proxy |
| E5 | Per-terminal timeout configuration |
| E6 | Rename, set default, delete a reader |
| E7 | Live status on the register while waiting (countdown, "timed out, send again") |
| E8 | Failure classification plus alerting: processing error says "contact support" and alerts; card declined says "try another card"; wait timeout and cancel get their own message and NO alert; arm-command timeout resolves then retries with NO alert |
| E9 | Cancel money-safety: a tap approving as you cancel is KEPT, never double charged, and every "the tap won" discovery in the cancel path goes through the one settle function |
| E10 | Stranded reader charge reconcile, keyed on that processor's "money moved" signature |
| E11 | A webhook backstop that finalizes if the browser died |
| E12 | Tap to Pay (phone as reader). Needs the native SDK and the platform entitlement. |
| E13 | Frontend reader gates include this processor type |
| E14 | A reader connectivity TEST that proves the reader works without taking money |
| E15 | Reader wait time as a PROCESSOR-level setting applied to all its terminals |
| E16 | The ARM-command timeout handled separately from the WAIT timeout (the rule is in `money-truth-doctrine`) |
| E17 | An armed reader never outlives its screen, and every tap has an owner |
| E18 | Discovery is not booking: every net stays silent about money already recorded |
| E19 | The register is never left in an unknown state (bounded, blocking, processor-agnostic) |

Detail worth keeping:

- **E8.** Derive a failure kind from the processor's own cancel reason and decline data. Square's
  cancel-reason set is exactly buyer cancelled, seller cancelled and timed out: all benign. Declines
  are card declined. Anything anomalous is a processing error and alerts.
- **E9.** A branch that marks the attempt succeeded and answers a bare "succeeded" is a FORK: it
  marks money taken, books nothing, and hands the client no order. A cancel-time probe against a
  reporting API must RETRY, because that API lags by seconds and a single probe missed a won tap.
  Better still, read the session's own result first (instant and authoritative on a won race), then
  again after stopping the reader, and keep the reporting-API retry as the deep fallback.
- **E10.** "Money moved" signatures differ: a payment-intent style id, a purely numeric reference,
  or simply a non-empty payment id on a succeeded attempt.
- **E12.** Physical-terminal gates are separate from the tap-to-pay gate. A processor can have one
  without the other.
- **E14.** The test is an authorization-only hold (or a manual-capture payment, or a non-completing
  checkout) that is voided the moment it approves. It must NOT write a payment attempt row: a test
  is not a payment, and the reconcile job would treat it as a stuck charge. It never throws; every
  outcome is a diagnostic verdict.
- **E15.** Where the device's own session lifetime is short and fixed (about 10 seconds with no
  parameter), the panel silently re-arms on each timeout until the configured budget is reached.
  Where the processor accepts a deadline, pass the setting through. Bug seen: the server deadline
  read only the per-terminal value and ignored the processor-level dropdown. Resolve it as
  "processor-level value, else the terminal's".
- **E16 per-processor "is it armed?" primitive.** Stripe: retrieve the reader and read its current
  action; if it is processing THIS payment, continue as armed. Square: the checkout is an idempotent
  server object keyed by an idempotency key, so a retry after a create timeout is safe ONLY if the
  SAME key is reused. Derive a stable key from the attempt session, then probe for an existing armed
  checkout and adopt it. Cardknox: a cloud session with a pre-inserted row needs its own design
  before a silent re-arm is safe. Do NOT copy one processor's fix blind onto another.
- **E16 alert wiring.** Return a clean conflict status with a stable timeout code, not a 5xx. A 5xx
  for a timeout ALSO makes the frontend alert, because the client helper pages on any status of 500
  or above. One change closes both the server-side and client-side alert.

---

## F. Connect and configure the processor itself

| # | Feature |
|---|---|
| F1 | A connect flow: OAuth, an inline application form, a hosted onboarding link, or inline credentials |
| F2 | Reconnect / edit credentials |
| F3 | It appears in the connectable grid and is not marked "coming soon" |
| F4 | Display name and logo in EVERY label map, plus translations |
| F5 | Per-location default and routing, data driven |
| F6 | Registered in the onboarding registry, if it uses an inline form |
| F7 | The frontend account picker resolves it |

**Verify credentials with the gateway BEFORE storing them.** For an inline-credentials processor,
the connect route should authenticate, confirm the merchant exists, and confirm any second merchant
(for a revenue split) belongs to the same application. Storing unverified credentials produces a
"connected" processor that fails on the first real charge.

---

## G. Infrastructure for a new processor TYPE

| # | Task |
|---|---|
| G1 | A provider plugin that implements the FULL provider contract (use your most complete processor as the template) |
| G2 | Register it in the provider factory and its supported-list helpers |
| G3 | Add the type literal to every BACKEND type union (there were four) |
| G3b | **Widen each frontend app's hand-declared copy of the response type too.** See the trap below. |
| G4 | The redaction ALLOWLIST entry, or NO raw decline detail is stored for this processor |
| G5 | **Widen every database CHECK constraint on processor type.** There were two, on different tables, and one was stale. |
| G6 | Any "charges by account id plus platform key" routing flag, if the processor works that way |
| G7 | Environment variables: config, validation, and EVERY runtime that needs them (web service AND the cron worker) |
| G8 | A webhook route, signature verification, raw-body wiring and dashboard registration, if outcomes are async |
| G9 | The "does a saved card exist?" switches, wherever they are hard-coded per processor |
| G10 | The keyed checkout form branch plus the per-processor card form |
| G11 | Storefront inline-checkout allowlists, in every customer-facing app |
| G12 | Payment-link support and its readiness check |

**The G3b trap.** A storefront app that saves a card often hand-declares a NARROW copy of the
setup response type, and its save flow builds a typed array of supported processors. If you add the
new processor to that array but not to the union, it is a type error that PASSES the warm
incremental typecheck and FAILS the COLD deploy build, where the host compiles from scratch. It does
not break at runtime: it silently blocks the next push to the main branch. After the edit, run a
cold, from-scratch typecheck of those apps, never the warm one.

**Webhook quirks.** Some gateways validate a webhook URL at registration by calling it with an
EMPTY body and requiring a 2xx. Your route must answer 200 to an empty body, and registration can
only succeed once the route is actually deployed. Some authenticate webhooks with basic auth; use a
per-connection random secret as the password.

---

## H. Advanced features

| # | Feature |
|---|---|
| H1 | **Import old customers and their saved cards** from the processor (match to your contacts, one button) |
| H2 | Card surcharge, universal, per company and location, with no per-processor wiring |
| H3 | Fraud signals that exclude integration failures and exclude un-completed authentication from the decline rate |
| H4 | A hosted checkout link |
| H5 | Inline merchant application (boarding) |

- **H1.** Build one shared match engine and one processor-agnostic import dialog, then a thin
  importer per processor. Building the second importer exposed two older bugs in that processor's
  code (an off-session charge sending an empty customer id; a saved-card list route returning 500),
  and required widening the "source system" CHECK on the contacts table.
- **H3.** Filter on the FLAG, not the reason text. A reconciled abandoned-authentication row can
  carry a generic "The card was declined." and slip through a reason-text filter. That was the
  exact false critical alarm.

---

## Per-processor lessons already paid for

- **Any SDK:** an unknown status must be mapped explicitly. One provider defaulted every unknown
  payment status to "requires action". Harmless today, a silent misclassification the day the
  gateway adds a status.
- **Any SDK:** route ALL declines for a processor through ONE classify helper shared by the saved
  card and keyed paths (decline becomes a returned failed result with its code; an infrastructure
  fault becomes a typed throw with a status code), so neither can regress to a raw thrown gateway
  string that returns a 500 and pages.
- **Square:** a payments list call needs an explicit sort field, or the SDK serializes an empty
  value and the gateway rejects it. Reader charges store the Square PAYMENT id, so they refund and
  void by that id.
- **Cardknox/Sola:** a "duplicate transaction" response is the gateway's idempotency guard and the
  first charge likely SUCCEEDED. The message must say "check before retrying", never "declined".
  A voided charge still reports its result as Approved: always read the void flag as well. The
  transaction's entered date is in the merchant's LOCAL time. The full external request id is stored
  intact, but the invoice field is truncated to about 18 characters, so never match a request id
  through the invoice field.
- **Finix (platform payments with native split settlement):** a decline is an HTTP 402; the
  captured amount lives on the transfer created by a capture, not on the authorization, which keeps
  the hold amount; a reversal of a split transfer needs its own prorated split, capped per merchant;
  reversals work whether or not the charge settled.
- **Stripe:** see A6, plus "a server 200 on the charge route with a payment the user says failed
  means the failure was client-side." That one distinction has repeatedly redirected an
  investigation to the right layer.

---

## Z. The systems picture, and the duplicated-list trap

Keep the charge, refund and recurring paths PROCESSOR-AGNOSTIC: one dispatcher, one "which
processor for this location" routing function, one surcharge utility. A new type then leaks only
into: the plugin, the factory, the type unions, the redaction allowlist, the database constraints,
the card forms, the webhook routes, the environment variables, the card-exists switches, and the
**duplicated frontend capability lists**, which are the number one trap.

In the source system there were about eight separate lists: can save cards, can list cards,
connectable processors, the coming-soon gate, payment-link capable, tap-to-pay capable, the
register's tap filters, and the type union itself. **They have subtly different membership ON
PURPOSE.** Evaluate each one against the new processor individually. Never add blindly, and never
assume one list implies another.

The same is true of display names and logos: there were about nine label maps with no single
source. Best fix: build one registry and derive the lists and labels from capability flags. If you
inherit the duplicated version, keep a written inventory of every list and every map so onboarding
is a walk, not a hunt.

---

## How to ask the gateway for the truth about a payment

The ONLY authoritative answer to "did this payment capture, is it still un-voided, was the customer
charged twice" is the gateway itself. Your own attempt and payment rows can be wrong in both
directions: this system shipped false declines (money captured, we said declined) and false
successes (we said succeeded, the gateway showed voided). So before you record, correct or refund
ANY money, verify against the gateway.

### The rules this protects

- **Never record money that did not move.** If the gateway shows a reference voided, declined,
  errored or not found, there is NO money. Do not book a sale for it.
- **Never assume your database is right about money.** A "succeeded" attempt is a CLAIM. The
  gateway is the truth.
- **Never void or refund from the verification tool.** It is read-only. Money goes back only when a
  HUMAN refunds through the normal product flow.
- **Verify BEFORE and AFTER a money write.** Before: is it real? After: did the change match truth?

### Build this tool once

A deployed, READ-ONLY internal endpoint plus a small script that calls the deployed URL, so nobody
needs a production shell.

- **Auth:** a shared internal-tool secret in a request header. Fail CLOSED: if the secret is unset,
  answer 503.
- **Input, one of:** a processor and a gateway reference; a processor and your own request id; a
  processor and a date window with an optional amount filter. Accept a company and location instead
  of a processor id and resolve it.
- **Output:** a list of normalized matches, each with the reference, amount in cents, the raw
  result, a `voided` flag, a `refunded` flag, the command type, the masked card, your request id and
  the entered timestamp. Add a `note` whenever a field could not be determined.
- **`voided: true`** means the charge was reversed BEFORE capture: no money moved. Detect it the
  authoritative way for that gateway (any of the void flags, a voided status, or the void command),
  matching what your provider code uses, not a single field.
- **`refunded: true`** means the charge CAPTURED and was then returned. Money moved and came back.
  That is distinct from voided.
- **Never read the result alone.** A voided charge can still report "Approved".
- **Say what you cannot determine.** If a lookup for some processor returns status only, amount and
  card are null and "refunded" is not determinable: say so on the match. `voided: false` then does
  NOT prove the money is still real; confirm in the processor dashboard if a refund is possible.
- **Ambiguity:** if a company resolves to several active processors with no single default, return
  a conflict with the candidate list and require an explicit processor id.
- **Dead credentials:** if the gateway rejects your reporting credentials, return a clear
  auth-failure error AND raise an escalating engineering alert. A dead reporting key blinds every
  money-truth check.
- **A debug mode** that returns the FULL raw payment object for one id, read-only. A normalized
  succeeded / failed / pending / abandoned is useless for diagnosing WHY a charge died.

### The playbook

Given an attempt row that claims succeeded with a gateway reference:

1. **Verify the reference.** Some gateways look up by scanning a date window, so pass a window
   around the attempt time.
2. **Read the result AND the voided flag.**
   - Approved, not voided, amount above zero: REAL captured money. Safe to book or keep.
   - Voided, or amount zero: NO money. Do NOT book. If YOUR system issued the void on a real
     capture, that is a serious bug. Find out who voided it and fix that code path.
   - Declined, errored or not found: no capture. Do NOT book.
3. **Double-charge check.** List the window by amount. If TWO approved, un-voided sale rows exist on
   the same card for one sale, the customer was charged twice. Record BOTH truthfully, so the
   merchant sees both and refunds one if THEY choose. Never auto-refund.
4. **Timezone and window gotcha.** Your timestamps are UTC; a gateway's entered date may be the
   merchant's LOCAL time. An empty result on a too-narrow window is a false "not found". Default to
   a generous lookback (30 days worked) and pass an explicit window for anything older.
5. **Truncation gotcha.** Match your request id against the field the gateway stores in FULL, never
   a truncated one.

### Reading a FAILED Stripe keyed or online charge from the raw payment object

- Status succeeded: money captured. (A later refund still reads succeeded; confirm in the
  dashboard.)
- Status canceled or "requires payment method", with NO last payment error and NO next action: the
  card was NEVER submitted. The confirm failed BEFORE charging. This is almost always a CONFIG bug
  (a mismatch between the deferred payment form and the server-created payment: future-usage,
  capture method, or amount), not a decline. No money moved. This was the signature of a multi-day
  keyed-card outage.
- Last payment error of type card error, with a decline code: a REAL bank decline. Expected, not a
  bug.
- Status "requires action" with a next action set: an authentication challenge is or was pending.
  If it never completed, the charge abandons. Your reconcile job may label that "abandoned, no
  card", so an abandoned status in your database is NOT proof there was no challenge. Read the raw
  object.
- The future-usage field tells you whether save-card was on for that charge: the field whose
  form-versus-payment mismatch broke keyed save-card checkout.

### The other half: read your own production logs

The verification tool asks the GATEWAY. The complement is what YOUR SERVER did around that charge:
the request, its HTTP status, and the raw per-provider console output. Be able to pull production
logs yourself. Do not ask the user to paste them. What only the logs tell you:

- **Is the provider even being CALLED, and with what?** A processor that "does nothing" is often a
  connect or config gap: no active processor row, the wrong location, a missing environment key.
  The request log shows the call never reaching the provider.
- **What the gateway literally returned.** Learn each gateway's healthy shape so you do not mistake
  a logged success response for a failure.
- **Server-side versus client-side.** A 200 from your charge route means your server succeeded. A
  failure the user still saw is then CLIENT-side (the payment form's confirm, 3-D Secure, or a
  deferred-form config mismatch), not the processor.

**Order of authority for any money question: the gateway, then your production logs, then your
database.**

## Related skills

- `money-truth-doctrine`: read first.
- `pos-checkout-design`: the order, tenders, ledgers and reversal paths.
- `saas-subscription-billing`: the sibling verification surface for platform subscriptions.
- `stripe-best-practices`, `error-alert-system`.
