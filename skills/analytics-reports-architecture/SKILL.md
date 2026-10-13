---
name: analytics-reports-architecture
description: How to BUILD a reports / analytics area so new reports are right the first time - the shared filter contract (materialized filters where every box is literally checked, the none-selected sentinel, a ready flag that gates the first query, and labels that never lie), the ordered filter cascade, one shared filter bar that sub-reports consume, the scope rule (every report defaults to the globally selected location and never leaks across tenants or locations), the privileged report-query pattern, capability gating that hides reports a business cannot have data for, one week definition shared by every report and the AI assistant, the four money numbers that must never be mixed (collected vs redemptions vs booked value vs covered lines), showing every row with a plain reason for the zeros, click-through to the underlying sale, and when a report should or should not raise an alert. Read this BEFORE adding or changing any report page, report filter, chart, report query or the data behind an analytics AI assistant. This is the "how it is built" map; its sibling report-verification is the "is it done" checklist, so run BOTH. Use when the user mentions analytics, a report, a dashboard, a report filter, "All selected", weekly grouping, week start, a financial or staff or commission report, gross profit, redemptions, an analytics assistant, "the numbers are wrong", or "the two reports do not match."
---

# Analytics / reports architecture

> **Adapt before use.** This describes how a reports system SHOULD be built. It is taken from a
> production multi-location platform where the analytics area cost more "the numbers are wrong, the
> two reports disagree" round trips than almost anything else. Every rule below is a scar. Nothing
> here is wired in your repo yet. Hook, component and function names are EXAMPLES of the shape.
> Once built, replace them with your real names and add a "where things live" section.

This skill is HOW IT IS BUILT. `report-verification` is the DONE checklist: verify the mechanism
that WRITES the data, the filter cascade, roster versus rows, row caps, and reconcile to the cent
against live data for a real, busy account. This skill does not repeat that checklist. **Read both,
and verify every claim against the live code and database before acting.** Function bodies get
replaced; the database is the only truth.

"Location" below is the scoping unit inside a tenant. Substitute store, branch, team or workspace.

---

## Rule 1: every report is scoped, and scope DEFAULTS to the global picker

A report defaults to the location the app's global picker has selected. "All locations" is a
separate, explicit state, never the silent default. This is not a per-report choice.

- Give multi-select reports ONE shared filter hook, and single-select reports ONE seeded location
  hook. Nobody rolls their own.
- **A report query resolves scope like this.** Admin: the requested set as given (null means
  company-wide). Non-admin with null: their accessible locations. Non-admin with a requested set:
  the INTERSECTION of requested and accessible. **If that intersection is empty, use an impossible
  sentinel id so the query returns NOTHING. Never fall through to company-wide. That leaks.** Write
  this block once and copy it verbatim into every report query. Do not invent a variant.

---

## Rule 2: the MATERIALIZED filter contract. The filters always tell the truth.

This rule took the most back and forth. The shared hook materializes every filter: the selected
array literally IS the current selection, so what the picker SHOWS and what the query DOES can never
drift apart. Preserve every part:

- **Default = everything selected, and every checkbox is literally checked.** The default selection
  IS the full option list, not an empty array that "means all". A user who opens a filter must SEE
  every option ticked. Location seeds from the global picker, unconditionally.
- **The label never lies.** All options selected: "All selected". A strict subset: "N selected" or
  the names. UNTOUCHED and empty (options not loaded yet): the dimension label, such as "All
  products". TOUCHED and empty (the user unticked everything): "None selected". Never show "All
  selected" while the query is restricting, and never "None selected" for a default all-ticked
  picker.
- **Clear All returns to the default all-ticked state** and re-seeds location from the global
  picker. It does NOT empty the pickers. To see nothing, the user unticks everything.
- **"All selected" is byte-identical to "no filter".** The hook exposes EFFECTIVE filters, in which
  an all-selected dimension collapses to an empty array so the query applies no IN restriction.
  **Reports must build queries from the effective filters, never the raw ones.** Otherwise an
  all-selected list becomes a giant IN that silently drops rows whose value is NULL or outside the
  option list. This exact bug shipped twice: a "source" dimension materialized to six values made a
  raw "length above zero" guard always true and dropped every order with a null or other source.
- **An emptied (touched) dimension becomes the sentinel and shows nothing.** The effective value is
  a single all-zero id that matches no row. That is why a raw empty array must never be read as
  "all": touched-empty means NONE, all-selected collapses to empty. The two are opposite intents,
  and only the effective filters plus the sentinel tell them apart.
- **Two pickers on the same axis ADD (union). They do not intersect.** Products and services are
  two views of one "which items" axis. All products plus one service = every product line PLUS that
  service's lines. An AND silently returned zero, because a line is never both a product and a
  service. Staff is a separate axis and ANDs with the item axis.
- **A mode switch (services / products / both) drives the same pickers** and reflects the truth. It
  offers only the sides the business has a catalog for (a services-only tenant sees no switch), and
  it derives an honest "none" state when both pickers are emptied.

### The cascade (filter sequence)

The cascade contract itself (each picker's options come only from rows that survive every filter
before it; changing a filter resets every filter after it) is in `report-verification`. The
architecture points that go with it:

- A typical order is Date, Location, Payment or Status, Staff, Type or Item.
- Location scope also prunes now-invalid staff: someone not at the selected location drops out of
  the staff options.
- **A "filters ready" flag gates the first query.** It is true only once (a) the picker-seeded
  location is materialized, (b) the location-scoped staff roster is in sync, and (c) the option
  lists have loaded at least once. Fold all three into the ONE flag, so every consumer is protected.
  Without (b), a staff filter race returns zero. Without (c), a report evaluates "are all locations
  selected?" before the options exist, which made a single-location tenant fetch twice. Enable the
  data query only when the flag is true.
- **Drain past the row cap.** Option lists AND any client-side aggregate must page to completion,
  or move the aggregate into a server-side query. Many data layers cap a response (1000 rows is
  common) and a larger explicit limit does NOT lift the cap. A 1295-product catalog was silently
  truncated to 1000, so "All selected" only ever covered the first 1000 and the rest could never be
  picked at all.

---

## Rule 3: one shared filter bar per report family. Sub-reports consume it.

A page that hosts many related reports (the financial family, say) owns a SINGLE date and location
bar and publishes it through a context. Every sub-report reads it:

```ts
const shared = useSharedReportFilters();
const dateRange   = shared?.dateRange ?? localDateRange;        // the shared bar wins when present
const locationIds = shared ? shared.locationIds : localScope;   // null = every location
{!shared && <its own date/location controls>}                   // hide own controls under the bar
```

- The bar stays in the SAME on-screen position across reports. A picker that does not apply to the
  active report VANISHES (keep a per-report table of which pickers it uses), but everything else
  stays put so nothing jumps.
- **Never silently ignore a filter the bar shows.** A point-in-time report (receivables aging,
  credit owed) ignores the date range and SAYS SO on screen in a one-line muted note. A
  company-wide report ignores the location and SAYS SO.
- The seeded location hook is context-aware: under a shared bar it returns the shared value and a
  no-op setter; standalone it seeds from the global picker. Never add a second location control
  under the bar.

---

## Rule 4: capability gating. Hide a report a business CANNOT have data for.

One query, cached for a few minutes, returns setup-OR-data booleans per capability (projects,
packages, gift cards, memberships, cash drawer, card processing, time clock, purchase orders and so
on), for the selected locations.

- **Show a report when the business is SET UP for it OR has historical data, even at zero.** Hide
  it only when it cannot possibly have data: no project templates means no projects report;
  memberships off at this location means no membership report. The owner's phrase: the fewest items
  the better.
- **Until the query answers, every capability reads TRUE**, so a report never flickers out and back
  in. Use the "ready" flag only where a flicker would matter.
- **A deep link to a now-hidden report must REDIRECT** (to the overview), never dead-end.
- New capability: add the probe to the query AND the type, then gate the report through one
  capability table.

---

## Rule 5: ONE week definition, everywhere (reports and the AI assistant)

Pick one week (Sunday to Saturday in the source system) and make EVERY report and the analytics
assistant use it. No per-company week-start setting unless you are prepared to honor it everywhere.

This caused a real customer incident: the assistant said the financial report ran Monday to Sunday
while the staff report ran Sunday to Saturday, because the assistant's date resolver used the
database's default week truncation, which is ISO Monday.

- **Database:** never use the built-in week truncation for a report bucket or a this-week /
  last-week boundary if your week is not Monday. Write one small `week_start` function and use it
  in every weekly fragment and in the assistant's date resolver. Mind the argument type: a
  timezone-shifted expression yields a plain timestamp.
- **Frontend:** export ONE week-start constant and pass it to every start-of-week and end-of-week
  call in a report. Never hard-code a week start in a report.
- **Payroll may be a deliberate exception.** The overtime WORKWEEK is a labor-law boundary. In the
  source system it stayed Monday and is NOT governed by the report constant. Do not "fix" it without
  an explicit owner decision: it changes overtime math.
- Before you claim consistency, grep the whole repo for the built-in week truncation, a hard-coded
  week start, ISO week format codes and week-number extraction.

---

## Rule 6: four money numbers that must never be mixed

Mixing these is the single most common "the reports lie" complaint. Know exactly which one a report
shows and LABEL it.

- **Money collected (the bank truth).** What actually came in during the period. A session paid for
  by a package, gift card or membership credit is **zero here**, because the money came in when the
  package or card was SOLD. A money report excludes pure-redemption orders AND redemption tenders
  (package credit, gift card, store credit, membership credit, project credit), or it double counts.
- **Redemptions (value delivered).** The value a person delivered out of previously sold packages,
  valued at each session's share of the package price. Use the SAME allocation function commission
  uses, so the two never disagree. This is a SEPARATE view, NEVER added to money collected: adding
  them counts the same dollars twice. Offer a "money collected / redemptions" toggle that is never
  additive.
- **Booked value.** The scheduled sticker price of completed and paid appointments, blind to how
  they were paid, so it INCLUDES package-covered sessions at full price. It is NOT money collected.
  Label it so, with a tooltip pointing to the money report.
- **Covered-line commission is zero.** A line paid by a package credit collected no new money on
  that line, so it pays no standard commission. Every commission creator gates on "this line is not
  covered", and an integrity check alerts if a live standard commission ever sits on a covered line.
  See `commission-system-design`.

Also: voided payments drop out of every money read, and revenue sums the NET line total (see
`pos-checkout-design`).

---

## Rule 7: the report-query pattern

New report data almost always belongs in ONE privileged server-side function rather than a wide
client query. Per-row access checks on a wide report query are slow; a privileged function does the
auth check ONCE. Follow one template exactly:

- **Preamble:** read the caller; raise on unauthenticated, blocked or no tenant; take the tenant
  from the SESSION, **never from a caller-supplied id**; resolve location scope with the intersect
  block from rule 1.
- Pin the search path, mark it stable, and set the grants: revoke from public and anonymous, grant
  to authenticated and the service role.
- Return one JSON object the page maps to numbers. **Coerce every numeric on the client.** JSON
  numbers can arrive as strings and collapse a chart's axis to a lone zero.
- Change discipline: pull the LIVE body immediately before any replace, change only the intended
  lines, re-assert the grants, apply, then re-pull and smoke-test. Migration files lie.
- **A dynamic-SQL data layer (the kind behind an AI assistant) fails only at run time.** When you
  touch it, smoke-test EVERY entity and group-by combination you changed.

---

## Rule 8: show EVERY relevant row, with a reason for the zeros

A report that shows only rows that "have data" hides the thing the user came to check.

- **Roster, not just rows**, for anything person- or payroll-shaped. See `report-verification`.
- **Every sale, with a plain reason for a zero.** A commission report's itemized list shows sales
  that earned nothing at zero, with a PLAIN reason a manager understands, truncated with the full
  sentence on hover. Derive the reasons from the real creation gates and keep them faithful:
  covered by a package, not paid yet, no person on the line, person not eligible, no rate, zero
  base.

Landmines proven in exactly that kind of "why is it zero" query:

- **A voided row re-surfaces with the WRONG reason.** A refunded or reassigned line's commission is
  voided, and the report hides voided rows, so the line reappears as "no commission" unless you
  EXCLUDE lines whose commission was voided by a refund or reassignment. They DID earn; the refund
  shows as a visible minus line instead. A "covered line" void SHOULD still surface, with the
  correct "covered" reason.
- **Recipient resolution must mirror the creator.** If the creator credits the checkout person only
  where a location setting is on, the "why" query must do the same. Resolving it unconditionally
  falsely blames the logged-in operator.
- **The base must mirror the creator** (add the order discount back for a courtesy order), or a
  courtesy line is falsely reported as "zero base".
- These explanatory rows are read-only: no checkbox, no payout, never part of mark-paid, and never
  double counted against real rows. Exclude lines that have a live row.

The general lesson: **an explanation query is a second implementation of the business rule.** It
drifts unless it mirrors the writer gate for gate.

---

## Rule 9: click a line to open the sale, in a NEW TAB

A report line that corresponds to a sale links to it, opened in a new tab with the usual
no-opener attributes, so the report tab stays exactly where it was. The click that opens the link
must not also fire the row's own click: use a separate element or stop propagation. Resolve the
target per row type. Some rows have no order (a legacy package with no purchase order, a session
redemption, a manual entry): show no link rather than a broken one.

---

## Rule 10: error-alert wiring for reports. Mostly: DO NOT alert.

A report is a read-only view. An empty result, a graceful fallback, or a read that fails and shows
an empty state is a BY-DESIGN outcome and must NOT report an error. It would flood. A secondary
fetch that fails logs to the console and shows nothing.

The ONE place that SHOULD alert is a money-integrity INVARIANT that only a real bug can violate
(for example a live standard commission on a covered line), checked by a scheduled integrity sweep
and routed to the alert system. See `error-alert-system` for the one-question test.

---

## The self-test before you call an analytics change done

1. Did I read the EFFECTIVE filters, not the raw ones, for every query predicate? (Rule 2)
2. Does the report default to the global picker's location and wait for the ready flag? (Rules 1, 2)
3. If it buckets by week or uses this-week / last-week, is it the shared week? Did I grep for a
   stray one a customer could compare? (Rule 5)
4. Is the number money collected, redemptions, booked value or a covered line, and is it LABELED so
   it cannot be confused with a sibling report? Does it exclude redemption tenders if it is money?
   (Rule 6)
5. Does every relevant entity and sale appear, with a faithful reason for the zeros and no double
   count? (Rule 8)
6. New query: the privileged pattern, tenant from the session, location intersect, row cap drained,
   grants re-asserted, smoke-tested live? (Rule 7)
7. Then run the `report-verification` checklist. A green typecheck says nothing about any of this.

## Related skills

- `report-verification`: the DONE checklist. Run it every time.
- `commission-system-design`, `memberships-and-packages-design`, `pos-checkout-design`.
- `query-efficiency`: why per-row access checks belong in one privileged function.
- `security-rls-permissions`, `error-alert-system`, `dataviz` for chart design.
