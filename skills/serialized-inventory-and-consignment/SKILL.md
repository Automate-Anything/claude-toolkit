---
name: serialized-inventory-and-consignment
description: How to design per-unit (serialized) inventory with vendor consignment, purchase orders, special orders, a stage pipeline and send-out service work, as a VERTICAL LAYER on top of a general app without forking its core entities. Covers the "reuse the shared entity, specialize only what is truly different" principle, the two-layer feature gate (plan plus per-location switch) and its loading-state trap, unit status vs sellable vs pipeline stage, reserved stock that must never read as sellable, consignment accounts payable (owe the vendor only when it sells), vendor balances as trigger-maintained rollups, purchase orders that route each line by item type, receiving that is delta-only and idempotent, batch receive, special orders reserved to a waiting customer, selling N units as N distinct lines, self-healing stock repair, per-company pipeline stages, import provenance, and the bug classes already paid for. Read this BEFORE building serialized or one-of-a-kind inventory, consignment, a vendor ledger, purchase orders and receiving, special / custom orders, a kanban pipeline for physical items, repair or send-out tracking, or a vertical-specific module gated per location. Use when the user mentions consignment, serialized inventory, unit tracking, tags or serial numbers, purchase order, receive stock, vendor payable, vendor balance, reserved item, special order, layaway of a specific unit, pipeline stages, send out for repair, or adding a vertical to the product.
---

# Serialized inventory, consignment and vertical layers

> **Adapt before use.** This describes how per-unit inventory with consignment SHOULD be wired, and
> how to add an industry vertical without forking the core app. It is taken from a production
> vertical that sells and services expensive, individually tracked items (a wig-salon layer on a
> booking and POS platform). Only the lessons that generalize are kept here. Nothing is wired in
> your repo yet. Table and function names are EXAMPLES of the shape. Once built, replace them with
> your real names and add a "where it lives" map.

Money on any of this goes through the normal checkout and ledgers: read `pos-checkout-design` and
`money-truth-doctrine` first.

---

## 1. The harmony principle (hold this as law when adding a vertical)

A vertical is a SPECIALIZATION LAYER, not a parallel app. In the source system: the specialized
item is still a *product*, its customer a *contact*, its service a *booking*, its payment *money in
the same ledger*, its to-do a *task*. A lot is the same and a lot is intentionally different.

**Reuse the shared platform wherever the concept is genuinely shared. Keep and improve the
vertical-specific surfaces wherever it is genuinely different. Never force the vertical into the
generic mold, and never duplicate what is already shared.**

A useful way to draw the line:

| Concept | Lives in |
|---|---|
| The customer, the appointment, the sale and payment, vendor expenses, tasks, the product record | The SHARED entities, each with a link column to the unit |
| The physical unit, vendors and consignment payables, purchase orders, the stage pipeline, work done ON the item, deliveries | Vertical-specific tables |

Give the vertical one focused hub for its own surfaces. Navigation that worked: "a page is a noun,
and New is a button on it", with the daily-use tabs ordered by frequency and the back-office tabs
grouped under one menu.

Be ready to defend what is genuinely different, with reasons: per-unit physical asset tracking;
consignment payables; work performed on the ITEM rather than on the customer; a multi-phase
order, wait, receive, prep, send-out, receive-back cycle; expensive items paid in installments
against a running balance.

**Step zero before building vertical work:** name the JOB in the user's words, walk it end to end,
and confirm a real screen exists for each step. The miss that prompted this rule was above the
field level: there was a page for stock but no page to FIND a specific customer's item. Verify the
verb, not just the noun.

---

## 2. The two-layer gate

Two stacked gates, BOTH must be true:

1. **The plan gate.** A plan feature, resolved per location. A support override wins.
2. **A per-location switch.** Flipping it on fires the seeders (default pipeline stages, message
   templates, appointment templates).

**The invariant: it must be impossible to turn the location switch on without a qualifying plan.**
Enforce the plan at the ON switch, so downstream code only asks "is this vertical on here?"

- **Auto-enable from business type, one-directional.** Choosing the matching business type can turn
  the vertical on (only when the plan allows it). It must only ever turn it ON, never off. A
  location that changes type must not silently lose its hub and its data.
- **The frontend gate has TWO forms, and using the wrong one is a shipped bug.** A plain boolean
  that collapses "loading" and "disabled" into false is right for HIDING a sub-component. A full
  PAGE or route gate must use a form that reports loading and WAIT, or it flashes the "not enabled"
  card or redirects during the half-second load. That bug made four pages unreachable.
- In an "all locations" view, any accessible enabled location shows the UI.
- **The backend gate fails CLOSED.** A paid feature must not run when the plan cannot be proven.
  Cache it briefly. Crons and provisioning must also skip companies pending deletion.
- **A per-location mode setting needs a loading guard too.** While loading, do NOT default to the
  most permissive value. That flashed options a restricted location must never see.
- **Adding a column to a shared settings table?** If saves go through a hard-coded allowlist of
  columns, the new column silently fails to save on existing rows until you add it to BOTH the
  update and the create paths.
- **A detail query that enumerates columns** (rather than selecting all) silently omits a new
  column until you add it there. That broke a whole company once.

---

## 3. The unit: three independent axes

A unit is a physical, individually tracked item: a code or tag, a human descriptor, photos, an
owner, a source vendor, a service history and a ledger.

- **Lead the UI with the human descriptor, never the raw internal code.** Imported codes are ugly.
  Fall back to "New item from {vendor}" or the customer's name only when the unit truly has no
  attributes. Never a bare generic label.
- **Source:** a vendor (consignment OR outright purchase), customer-brought (in for service or
  storage), or shop-owned.
- **Three separate things that must not be collapsed:**
  - **Lifecycle status:** in stock, with customer, at a service vendor, returned to vendor, retired.
  - **Sellable:** a unit can be received and not yet ready to sell.
  - **Pipeline stage:** where it is in the workflow. Per-company customizable.

### Reserved stock is NEVER "in stock" or sellable

A reserved unit is: lifecycle "in stock", stage "reserved", not sold, and with NO owner yet. The
customer sits in a separate "reserved for" column; the owner column stays empty until the sale.

**Every reader that answers "what can I sell?" must exclude reserved.** It had to be fixed in THREE
readers: the list badge, the KPI query and the grouped-inventory query. The recurring bug shape is
a NEW reader that forgets the exclusion, classically a grouped path that bypasses the flat path.
Make the filter null-safe (stage is null OR stage is not reserved). The per-customer finder view
still SHOWS a customer's reserved unit: that is correct.

Reservation-integrity regressions to watch for:

- Merging two customer records must re-point "reserved for".
- Dragging a unit off the reserved stage by hand must clear it.
- A void must restore the reservation and must not create a second payable.
- "Delivery done" functions must not require an owner. They silently did nothing for reserved
  units.

---

## 4. Consignment: the vendor owns it until it sells

The defining money mechanic: you owe the vendor only WHEN the unit sells, unless the arrangement is
"owed immediately", in which case the payable is created at receipt.

- **A consignment ledger with one accounts-payable entry per unit**: the amount owed, a status
  (owed, partially paid, paid, reversed), and a **created-reason** that says why it exists (sale,
  owed at receipt, service completed, product receipt, delivery completed, manual, adjustment).
- **Vendor payments allocate against ledger entries**, with an allocation guard.
- **Vendor balance columns are denormalized ROLLUPS. Never write them directly.** Triggers on the
  ledger, payments and purchase-order items recompute them through one recalc function.
- **One vendor table, with a type.** Real vendors play several roles (product on consignment,
  outright purchase, repair, a specialty service, delivery). Company-scoped, not location-scoped,
  even though units, ledger entries and payments ARE location-scoped.
- A vendor scorecard is worth building: lead time, on-time percent, turnaround, return rate, margin.

**The sale is ONE mechanism.** Every entry point (pick the unit from a SKU, scan its tag, a
dedicated sell screen) binds the unit id on the order line. When the order is paid, ONE trigger
flips the unit to sold, links the order and fires the ledger. One mechanism, no double sell.

---

## 5. Purchase orders: route each LINE by item type

One PO screen. Each LINE routes by its item type:

- **A serialized line** spawns units and a per-unit consignment ledger entry.
- **A plain product line** goes to regular stock (the normal receive function, with average cost)
  and creates ONE unit-less "product receipt" ledger row, always owed at receipt.

### The generic-receive bug class

Verify that ANY receive path is:

- **Delta-only.** It ADDS the received quantity. It never SETS stock.
- **Idempotent.** Receiving twice must not double count.
- **Safe on cost.** A zero-cost line must not clobber the unit cost.
- Type-correct: a wide integer price handed to a function expecting a narrower one needs an
  explicit cast.

### Serialized products refuse quantity stock

The receive function RAISES for a serialized product. A serialized product with a quantity but no
units is the forbidden state: it is unsellable, because the register requires a unit. Prevent it
with a **self-heal at every door**: any door that creates units or serialized-looking products
(import, spreadsheet upload, invoice scan, add dialog) calls ONE idempotent repair that (a) links
units to products by evidence and marks the product serialized, and (b) converts any product
quantity into spawned units, zeroing the quantity with an audit entry. It never throws.

Related protect-on-update rule: a "serialized" flag that someone corrected by hand must not be
stomped back by a re-import. Keep such corrections out of the importer's overwrite list, or the
reverse, deliberately. Decide per field and write it down.

### PO totals

If the total is a GENERATED column (subtotal plus extra fees), a recalc function that reads the
subtotal off the header does NOT recompute it from items. Know which one your recalc does before
you trust it.

---

## 6. Special orders (a customer wants something you do not stock)

Model it as status-driven, with NO inventory row until the receive step spawns a unit: need to
order, ordered, received, reserved, sold.

- **The special order has no cost column, by design.** Vendor payables are the PO flow's job. PO
  receive (into general inventory) and customer-reserve receive (spawns a unit RESERVED to that
  customer) are two different doors. Never conflate them.
- **Single receive** creates its own one-line PO, spawns the unit and reserves it.
- **Batch receive is per vendor and idempotent on input.** It creates ONE PO for ONE vendor. The
  function must:
  - REJECT a mixed-vendor or vendor-less batch;
  - DEDUPE the incoming id list (a repeated id would double-spawn, duplicate the PO line and double
    the payable);
  - re-check each order's status inside the loop;
  - SAFE-PARSE the cost map, ignoring a decimal or garbage value rather than casting it raw, which
    aborts the whole batch.

  Keep it in lockstep with the single-receive function: same steps per order, one shared PO header.
- **The UI enforces single-vendor BEFORE the call**: once one order is ticked, only that vendor's
  other orders stay tickable and the rest dim. The function's guards are then defense in depth.
- **Reserve-to-waiting must produce the SAME reserved state as a delivery.** After any vendor
  receive (batch, invoice scan, PO line), offer that vendor's waiting orders, so a human confirms
  which received unit goes to which waiting customer. That function's guards reject sold,
  customer-owned or already-reserved units and non-open orders.
- **Expected rejections here are a legitimate RACE.** Two people reserve at once. Show a plain
  message. Do NOT raise an engineering alert. Have the hook split expected reasons from unexpected
  errors.

---

## 7. Selling N units is N distinct lines

The sale function sells ONE unit per line. Quantity only PRICES. So quantity N must resolve to N
distinct in-stock unit ids, each its own line, quantity pinned to 1, never grouped, with a
duplicate guard. Otherwise it sells 1, bills N and strands N minus 1.

For a builder-style order screen ("build the order, apply it later"): a SAVE (draft) / APPLY
(creates the open order and anything that hangs off it) / UNAPPLY lifecycle. A split payment plan's
deposit can be a set amount OR a percent of the total. Always store the RESOLVED amount in the
field the collect path reads, and keep the mode and percent alongside so the percent recomputes as
the total changes.

---

## 8. Pipelines and work orders

- **Per-company customizable stages**, seeded with defaults when the vertical is switched on. The
  stage is a free-text value on the unit, and a stage can carry a default assignee applied by
  trigger.
- **"Received back" is its own stage, NOT "Done".** A unit returned from a vendor is received.
  Then you message the customer, book the fitting, and only THEN mark it done, which stamps the
  completion time. Collapsing those two loses the follow-up step.
- **A work order is a header plus line items** (service type, with or without a unit, with or
  without a vendor, with or without pricing). It is performed ON the item, is usually NOT a
  calendar appointment, and frequently has no unit attached. Do not join work lines by unit id when
  most lines have none. Join by the header.
- **A two-context service model that is not symmetric.** The same catalog service can be "work on
  the item, no appointment" or "book a calendar appointment". Every picker reads ONE source and
  shows ONLY its context's set, in two clearly labeled controls. **Never merge or dedupe imported
  services across contexts.** Two services with the same name in different contexts are DIFFERENT
  services, and an auto-suffixed duplicate name is correct.
- **Stage changes and sales emit automation events from database triggers** (stage entered, sold).
  Time-based ones come from crons (service overdue, post-sale check-in, shelf aging, vendor return
  overdue). Seed automations INACTIVE, so turning messaging on prompts the customer to activate
  them.
- Gate repair work on a texted customer approval. Track labor with timers.
- **Print means print.** A tag-print action should open the print dialog ready to go, sized for the
  label, not download a PDF. A batch prints one tag per target.

---

## 9. Import provenance

- **Both markers null (no import batch id AND no source system) means a real in-app row.** Constrain
  the source-system values, and add partial indexes for idempotency and rollback.
- **Triggers and crons skip migrated rows.** Never send high-volume per-item notifications on
  imported rows.
- **The "pause notifications" guard must be an atomic conditional UPDATE**, not read then write.
  Read-then-write sent five duplicate emails under concurrency.
- **If importers stamp location in a mapper layer**, grepping the importer files for the location
  column returns nothing and LOOKS broken. It is not. But any hand-written load must bake the
  location into every insert itself.
- **Imported rows can be structurally wrong in ways going-forward writers are not.** One import
  stuffed the vendor's name into a free-text instructions field while marking the work "done in
  house", which showed the wrong action button. Fix the writers first. Do not backfill where the
  data is ambiguous (was that name a staff member or a vendor?) without the customer.

---

## 10. Gotchas and bug classes

- **Two foreign keys to the same parent make an embedded join ambiguous** in an auto-generated
  API. Disambiguate explicitly.
- **Never build a filter string by interpolation.** Use parameterized equality and contains
  filters.
- **Migrations LIE.** Several past "critical" findings were false because they were read from stale
  migration files, and one "fix" based on one regressed a real invariant. Re-verify EVERY claim
  against the live function body.
- **Shared-file hazard.** High-traffic files get edited concurrently. After editing one, re-grep
  your change on disk.
- **Old planning documents are not architecture references.** A months-old multi-agent work log
  kept being read as current state. Mine such files for the WHY of a fix, never for what is live.
- **Agent parity.** A new operator capability or setting should also become an AI-agent action,
  writing AS THE CALLER through the same guarded functions, with by-design rejections mapped to
  plain messages and no alert. Flows that are inherently multi-select or a photo upload (batch
  receive, invoice scan) stay UI-only. Say so deliberately.

## Before you build

1. Respect the harmony principle: reuse shared, keep specific, never fork or duplicate.
2. Do step zero: name the job, walk it, confirm a screen exists for each step.
3. Lead UI with the human descriptor.
4. Page gates wait for loading. Sub-components use the plain boolean.
5. Any new unit-creating door calls the self-heal. Any new inventory reader excludes reserved.
6. Any receive path is delta-only and idempotent.
7. Pull the live schema and function body before any change to a money or inventory function.

## Related skills

- `pos-checkout-design`, `money-truth-doctrine`: the sale and its payment.
- `saas-subscription-billing`: the plan gate.
- `competitor-data-migration`: import provenance and idempotent re-runs.
- `build-with-the-user-in-mind`, `security-rls-permissions`, `error-alert-system`.
