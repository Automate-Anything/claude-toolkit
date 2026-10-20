# Data and cutover (Phases 7 and 8)

## Data (STOP before any write)

Use the right existing skill rather than improvising:

- `competitor-data-migration`: pulling the data from the old system's own API or its dashboard's
  network calls, mapping entities, idempotent re-runs. Its endpoint discovery matches what you
  already recorded in `data-model.md` and `_raw/net/`.
- `ai-data-migration-agent`: the old system offers exports (CSV, spreadsheets, PDFs) to import.
- The repo's database rules: show the migration plan and get the owner's yes before writing anything.

Parity-specific rules on top:

- **Keep the identifiers staff know by heart.** Customer numbers, invoice and order numbers, product
  codes, account codes. Staff search by them, say them on the phone and write them on paper. Continue
  the old numbering sequences (same format, next number) unless the owner decides otherwise.
- **Keep history and its dates:** created dates, posting dates, statuses, notes, attachments, audit
  history where the owner needs it. A migrated record that shows today's date as "created" breaks
  reports and trust.
- **Reconcile per entity:** counts, sums of money fields, open balances, and a sample of records
  compared field by field against the old system's screens. Write the reconciliation into
  `checklist.md`.
- **Data the screens never showed** (found in `data-model.md`) still moves if the old system stored
  it; ask before dropping any of it.

## Cutover

Change aversion is real even when everything matches. These steps come from what worked in large UI
launches (Sedley and Müller, CHI 2013: plan the stages, prime users, explain benefits, give transition
guidance, let users switch between old and new for a while, monitor, collect feedback directly, fix
fast, tell users what improved) and from legacy displacement practice (switch by module or user group,
keep a way back).

1. **Plan the stages.** Switch by module or by user group, not all at once, when the business allows.
   The old system stays available (read-only where possible) during the overlap.
2. **Parallel run.** For a set period, key the same work in both systems (or replay the day's work in
   the new one) and reconcile daily totals and counts. Differences are bugs until explained.
3. **The what's-different sheet** (`whats-different.md`): one page, plain words, only what differs
   and why, a "where did it go" table for anything that moved, and the old annoyances that are now
   fixed. Owner approves it.
4. **A short walkthrough** of each role's top tasks on the new system, 15 minutes, using the
   scenarios. No training course: if it needs one, parity failed somewhere.
5. **A direct line for "this feels different".** Anything reported that is not on the sheet is a
   defect; fix it fast and tell staff it was fixed.
6. **Rollback plan.** What triggers going back, who decides, and how data entered in the new system
   gets back if needed.
7. **Cancelling the old system.** Only after the checklist is green, the parallel run reconciles, and
   the owner says so. Before cancelling, export a complete copy of the old data (every entity, plus
   documents and attachments) and store it where the owner controls it. Check the contract's notice
   period and data-retention terms.

## Close the loop

Fold reusable lessons from `LESSONS.md` into this skill's `references/vendor-notes.md` (vendor
quirks, endpoints that lie, export formats), without customer data or credentials.
