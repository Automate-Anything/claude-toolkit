---
name: report-verification
description: The standard for calling ANY report, dashboard, analytics view, or data export "done." Read it BEFORE you build, change, audit, or declare done any surface that shows aggregated data. It forces you to verify the mechanism that WRITES the data (not just the query that reads it), the filter cascade, roster-vs-rows completeness, row-cap/units/reconciliation correctness, and to verify against LIVE data for a real, busy account rather than by reading code. Use when the user mentions a report, dashboard, analytics tab, metric, KPI, export/CSV, "the numbers are wrong", "a name is missing", "the total doesn't match", or "is this report right."
---

# Report Verification: the standard for calling ANY report "done"

This skill exists because of a real, expensive failure. An agent swept every report for one bug
class (a row-cap), declared them all fixed, and the report someone had promised a customer was
still wrong in three ways the sweep never looked at: a staff filter silently hid employees, a
whole category of data was missing because the WRITER of the data had skipped it on a wrong
assumption, and the filters did not cascade. The sweep verified one bug class and called that
"reviewed." It wasn't. A report is verified only when ALL of the checks below pass, against LIVE
data, for a real account.

Run this checklist whenever you build, change, audit, or declare done ANY report, dashboard,
analytics tab, or export.

---

## 1. The data-PRODUCING mechanism, not just the data-READING query

A report is a window onto rows some OTHER mechanism writes (a checkout routine, a trigger, a
cron, an import, a backfill). The report can be pixel-perfect and still show garbage because the
producer never wrote the rows.

For every number the report logically must show:
- **Name the mechanism that produces it.** Which function/trigger/job/import writes these rows?
  Read its LIVE definition and confirm the write path exists and covers every category the report
  displays (e.g. services AND products AND packages; every location; every entry point - money
  that can flow through more than one write path must be written by ALL of them).
- **Prove it produced rows recently.** Query the live table: rows per day for the last 2-3 weeks
  next to the driving activity (payments per day, bookings per day). A gap between "activity
  happened" and "rows written" is the bug, even when every screen renders beautifully.
- **Never accept an assumption about attribution.** "Nobody selects a name, so we can skip it" was
  FALSE - people had selected names on hundreds of lines. If a mechanism depends on users doing X
  at the right moment (selecting a name, picking a location), query the actual data to see whether
  they DO X, before excluding anything from a backfill or report.
- **Backfills must cover every category and the full window.** After any backfill, diff
  activity-vs-rows per day AND per category; a category or a date-gap with activity but no rows
  means the backfill is incomplete.

## 2. Filter sequence (the cascade contract)

Filters form an ordered sequence (typically: Date -> Location -> Payment/Status -> Person -> Type
-> Item). The contract, verified filter by filter:
- **Each picker's OPTIONS derive only from data that survives every filter BEFORE it.** A static
  option list mid-chain breaks the contract.
- **Changing a filter resets every filter AFTER it** (their options just changed under them; stale
  picks silently filter to nothing).
- **A filter seeded from a global context** (e.g. a global location picker) still stays
  user-changeable.
- **Results respect ALL active filters simultaneously** - verify by picking a combination and
  reconciling the on-screen total against a live query with the same predicates.

## 3. Population completeness (roster vs. rows)

Decide explicitly, for pickers AND result lists: is the population "entities that have rows" or
"the full logical roster"? For anything payroll- or person-shaped, it is the ROSTER: every person
in scope appears - in the picker AND as a $0 line item - because a missing name and a $0 name are
very different statements. Deriving people-lists from result rows only is how "the system lost my
employee" happens.

## 4. Values are real, complete, and reconciled

- **Row-cap discipline:** every client-side aggregate must read the FULL result set, not a
  truncated page. Most data layers cap a response at some maximum row count (and a large explicit
  `limit` often does NOT lift it) - so paginate/drain to completion or aggregate server-side.
  Verify the count you aggregated equals the count that actually exists.
- **Column truth:** every selected column verified against the LIVE schema. Loose typing (`any`,
  untyped rows) hides selects of nonexistent columns that render as blank/Unknown forever.
- **Reconcile the money:** header total = sum of visible line items = a live query sum with the
  same predicates, to the cent. Do this for at least one real, busy account - empty/seed data
  hides everything.
- **Exports mirror the screen:** the CSV/Excel contains the same population and totals as the
  screen (including $0 roster lines), and money exports as real numbers, not strings.

## 5. How to verify (non-negotiable mechanics)

- Verify against the LIVE data store with a real account's data, not by reading code. Run the
  read query yourself (reads are cheap and safe).
- Walk the actual filter UI in the browser (see the `browser-verification` skill) when the change
  is filter behavior: click the sequence, watch options narrow, watch resets happen.
- State what you verified with evidence (the per-day diff query, the reconciliation numbers),
  never "it looks right."
- A green typecheck/lint/i18n run says NOTHING about any of the above.

## The self-test before declaring a report done

1. Did I name and live-verify the mechanism that WRITES this report's data, and diff its output
   against real activity per day and per category?
2. Did I click through the filter sequence and confirm options cascade and resets fire?
3. Does every person/entity that logically belongs appear - including zeros?
4. Did the on-screen total reconcile to the cent against a live query for a real busy account?
5. Would someone, pulling this exact report for a customer tomorrow, find what they were promised?

If any answer is "I think so," the answer is no. Verify it.
