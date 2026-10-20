# S## Screen name

- Reached by: Menu > Submenu > ... (click path)
- URL pattern: 
- Roles: 
- Frequency: 
- Interaction model: server postback / AJAX / client-side only / popup window / frames (pick and describe)
- Evidence: `_raw/shots/old/S##*.png`, `_raw/inventory/old/S##*.json`, `_raw/snapshots/old/S##.txt`, network `_raw/net/index.jsonl` (screen S##)
- Fidelity: A / B / C / D

## Layout contract (frozen: must match)

Generated from the inventory; edit only to add what the inventory cannot see.

- Regions: (top bar, left menu, toolbar, main form, grid, footer) and what sits in each
- Controls in visual order, with exact labels: 
- Tab order: 
- Keyboard: access keys, F-keys, Enter behavior (submits? moves to next field?), Esc, autofocus on load, where focus lands after save
- Data tables: columns in order, default sort, page size, row actions
- Messages: where errors, confirmations and warnings appear, and how they look (inline, banner, alert box)

## Behavior (one row per control or event)

| Control / event | What it does | Preconditions | Result and side effects | Evidence | Label |
|---|---|---|---|---|---|
| Save | | | | `_raw/net/...`, `_raw/shots/old/S##-after-save.png` | [OBSERVED] |

## Field rules

| Field | Type | Required | Max length | Format / mask | Default (new record) | Allowed values | Exact error text | Label |
|---|---|---|---|---|---|---|---|---|

## Calculations (characterization tables: inputs varied one at a time)

### Formula: (name, e.g. invoice total)

| Case | Inputs | Old system output | Notes (rounding, edge) |
|---|---|---|---|
| typical | | | |
| zero | | | |
| negative | | | |
| rounding .5 | | | |
| large | | | |

Rule as understood: ... [OBSERVED for the rows above / INFERRED beyond them]

## Search, sort, filter, paging

- Search matches which fields? Partial? Case-sensitive? Wildcards?
- Default sort and direction; which columns sort; does the sort persist when you come back?
- Filters and their defaults; do they persist across navigation?
- Page size; what happens past the last page

## Exports and printouts

| Output | Trigger | Format (check the real bytes) | Columns / layout | File name | Golden file |
|---|---|---|---|---|---|

## Behind the scenes

Emails, status changes, numbering sequences, audit or history entries, other
screens that change, integrations, scheduled effects.

## Quirks staff may rely on

Bugs or odd behaviors that people have built habits around. Each one needs an
owner decision in decisions.md: keep, fix, or fix with a note on the
what's-different sheet.

## Open questions

Link each to questions.md.

## Requirements

REQ IDs in PROJECT_SCOPE.md that this screen produced: REQ-...
