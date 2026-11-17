# Verification (Phase 6)

Prove the new app matches the source, screen by screen and task by task. The target is an exact copy,
so the bar is a visual match, not "close." The owner accepts; you present evidence (the visual-diff
numbers and the screenshots).

## Gate order

Run in this order. A later gate never overrides an earlier failure (a beautiful screenshot does not
rescue a missing field).

1. **Capture integrity:** `ready.js` READY on both sides, same viewport, same records, same role,
   same state. Otherwise the comparison is NOT_COMPARABLE with a reason: AUTH_BLOCKED, NOT_READY,
   ERROR_PAGE, DATA_MISMATCH, VIEWPORT_MISMATCH, ROLE_MISMATCH. NOT_COMPARABLE is never a pass.
2. **Layout contract:** `layout_diff.py`.
3. **Screenshot match:** `visual_diff.py` driven to ~0% different, for every captured state.
4. **Look and feel:** every hover, focus, cursor, transition and animation from the source is present.
5. **Behavior:** the screen's behavior rows and state-diff probes replayed on the new app.
6. **Scenarios:** whole tasks replayed on both systems with identical inputs.
7. **Adversarial review:** a fresh subagent hunting for differences.

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
| Page-level key handlers (F-keys, Enter, Esc) not found in the new markup | F2-to-save habits break; press the key on the new screen to confirm, since handlers attached in code are invisible to the inventory |
| Button type changed (submit vs button) | Enter in a field, or a Cancel click, may suddenly save |
| A field lost its form name (when the new screen names its other fields) | The value may silently not save |
| Fewer table rows fit, or the screen now scrolls | Density is part of the contract; long lists get slower to work |
| Fields filled on one side only | The two captures show different data: recapture, or the comparison is NOT_COMPARABLE |

Blocking items are fixed, or recorded in `decisions.md` as approved deviations (and approved label
changes go in `renames.json`). Warnings are each looked at. Small shifts with unchanged neighbours are
expected from a re-spaced skin and are summarized, not listed.

The diff compares visible controls. For menus that are closed by default, capture the open state on
both sides and compare those inventories too.

## Screenshot match (the main visual gate)

The layout diff proves the structure; this proves the pixels. For each captured state (resting, and
the hover, focus, filled, error, empty and open-menu states captured in Phase 1):

1. `take_screenshot` of the source screen and the new screen at the SAME viewport, SAME data and SAME
   state. Different data or state makes the comparison meaningless.
2. Run it:

       python3 scripts/visual_diff.py docs/parity/_raw/shots/old/S04.png docs/parity/_raw/shots/new/S04.png \
           --out docs/parity/_raw/diff/S04-diff.png --json docs/parity/_raw/diff/S04-visual.json --md

3. It prints the percent of pixels that differ, writes a red-highlighted diff image, and names the
   worst grid regions. Open the diff image, go to each region, fix the difference in the new app
   (wrong font, color, spacing, border, shadow, a missing element), re-capture, and re-run. Repeat
   until it reports **MATCH** (at or near 0% different; the default tolerance is 0.5%, tighten it for
   a hero screen).
4. The number is the floor. Also look at the two screenshots side by side yourself and fix anything
   your eyes catch that the threshold let through (a subtle gradient, a slightly wrong weight).
5. Record the final percent in `checklist.md` as the evidence for that screen and state.

If `visual_diff.py` reports Pillow is missing, install it (`pip install pillow`) or fall back to
comparing the two screenshots by eye, region by region, which you do anyway.

## Look and feel (hover, focus, animation)

A screenshot of the resting state does not prove the hover effect or the animation carried over.
Compare these against the source explicitly:

- **Hover:** for each main control, `hover` it in the new app and `take_screenshot`, then compare to
  the source's hover screenshot from Phase 1. The color, shadow, cursor and any movement must match.
- **Focus:** Tab to each field in the new app and screenshot the focus ring; compare to the source.
- **Transitions and animations:** every entry in the source's `interactions.js` (transitions,
  `@keyframes`, animated elements) must have a match in the new app. Trigger each one (open the menu,
  load the spinner, expand the row) and confirm it plays with the same property, duration and easing.
  A hover effect or animation that exists in the source and not in the new app is a failing
  difference, recorded and fixed, not waved through.

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

End states: **matches the source** (every gate passed, with the visual-diff percent and the
screenshots as evidence) or **not yet matching** (each remaining difference named with its evidence).
State the measured result, for example "resting and hover states 0.0% different, all animations
present," rather than claiming "identical" with no number behind it.
