# Verification (Phase 6)

Prove parity screen by screen and task by task. The owner accepts; you present evidence.

## Gate order

Run in this order. A later gate never overrides an earlier failure (a beautiful screenshot does not
rescue a missing field).

1. **Capture integrity:** `ready.js` READY on both sides, same viewport, same records, same role.
   Otherwise the comparison is NOT_COMPARABLE with a reason: AUTH_BLOCKED, NOT_READY, ERROR_PAGE,
   DATA_MISMATCH, VIEWPORT_MISMATCH, ROLE_MISMATCH. NOT_COMPARABLE is never a pass.
2. **Layout contract:** `layout_diff.py`.
3. **Behavior:** the screen's behavior rows and state-diff probes replayed on the new app.
4. **Scenarios:** whole tasks replayed on both systems with identical inputs.
5. **Visual review:** `parity_report.py`, looked at by you, then by the owner.
6. **Adversarial review:** a fresh subagent hunting for differences.

## Layout

    python3 scripts/layout_diff.py docs/parity/_raw/inventory/old/S04.json docs/parity/_raw/inventory/new/S04.json \
        --renames docs/parity/renames.json --json docs/parity/_raw/diff/S04.json --md docs/parity/_raw/diff/S04.md

What it checks and why:

| Check | Why staff feel it |
|---|---|
| Missing control | They look for it and it is not there |
| Label changed | They scan for a word that no longer exists |
| Moved relative to neighbours (left/right in a row, above/below in a column), or swapped | Muscle memory clicks the wrong button |
| Moved to another part of the screen | Their eyes go to the old spot |
| Tab order | Fast keyboard entry lands in the wrong field |
| Required, max length, input type | New errors, truncated data, slower date entry |
| Select options missing or reordered | They pick by position and by typing the first letter |
| Access key lost | Alt+S stops saving |
| Table columns missing or reordered | They read columns by position |
| Titles and prominent labels missing | Orientation cues gone |

Blocking items are fixed, or recorded in `decisions.md` as approved deviations (and approved label
changes go in `renames.json`). Warnings are each looked at. Small shifts with unchanged neighbours are
expected from a re-spaced skin and are summarized, not listed.

The diff compares visible controls. For menus that are closed by default, capture the open state on
both sides and compare those inventories too.

## Behavior

For every row in the screen spec: perform the same action on the new app and compare with the
evidence. For reactive behavior, repeat the old `state_diff` probe on the new app and compare the two
outputs line by line. For validations, replay the probe inputs and compare message wording and
position. Calculations are covered by the characterization tables running as unit tests; also check
one or two through the UI, because formatting and rounding often differ only on screen.

Use real input (`type_text`, `press_key`), and walk the Tab order with `press_key` on both systems.

## Scenarios (characterization and parallel run)

For each scenario in `scenarios.md`:

1. Run it on the old system twice. Fields that differ between the two runs are noise (timestamps,
   generated ids, session tokens); record them as masked.
2. Run it on the new app with identical inputs.
3. Compare every output except masked fields: screens reached in order, messages, values, totals,
   generated numbers' format, exports, side effects.
4. Exports: compare against the golden files from the old system (same columns, order, formats,
   encoding, file name pattern). A human approves any intentional difference, which is then recorded.

## Visual review

    python3 scripts/parity_report.py --parity-dir docs/parity

Open the report and look at every pair yourself before showing anyone: alignment, density, wrapped
labels, truncated values, focus outlines, empty and error states. The report lives under `_raw/`
because screenshots show records; show the owner on screen rather than sending it around.

## Adversarial review

For each screen (or a batch of small ones), dispatch a fresh subagent that did not build it:

    You are checking whether a rebuilt screen is a true drop-in replacement for an old system's
    screen, for staff who have used the old one for years. Evidence: old screenshot and inventory
    <paths>, new screenshot and inventory <paths>, the screen spec <path>, the layout diff <path>.
    Find at least five differences a staff member would notice (placement, wording, order, tab
    order, keyboard, defaults, validation, messages, formatting, density). For each give the exact
    evidence (file and element or region) and why it matters. If you find fewer than five real ones,
    say so plainly; do not invent any. Do not modify files.

Fix what is real. Record disagreements as questions for the owner.

## After every fix: regression

Mark each checked item keep or fix. Change only the fix items, then re-run `layout_diff.py` and the
scenario replays for every screen already passed. Fixes to shared components cause silent regressions
elsewhere.

## Records and end states

- `checklist.md`: one row per screen and per scenario with the verdict and evidence paths.
- `PROJECT_SCOPE.md`: Artifact and Evidence columns filled for every REQ.
- `ip_scan.py --terms "<vendor>,<product>,<module names>"` clean before calling the project done.
- `coverage.py`: frontier empty or owner-scoped.

End states: **ready for owner review** (every gate passed with evidence) or **failed with residuals**
(each residual named with its evidence). Never claim "pixel-perfect" or "identical". Name what was
compared, how, and what is left.
