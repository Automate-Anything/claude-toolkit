# Spec, design direction and build (Phases 3 to 5)

## Contents

- Spec: REQs, gap analysis, questions, build order
- Design: frozen, free and gray zone; the three directions; tokens; the two-second test
- Build: rules per screen, data seeding, what never ships

## Spec

### REQs

Every behavior row and every scenario becomes a requirement in the app repo's `PROJECT_SCOPE.md`
traceability matrix (create the table if the repo has none). Use the old system's own words and keep
the evidence link.

| REQ | Request (old system's behavior) | Acceptance (Given / When / Then) | Artifact | Evidence |
|---|---|---|---|---|
| 041 | Customer form: State = TX enables "Tax exempt" and shows "Texas requires a tax ID" | Given a new customer, When State is set to TX, Then Tax exempt becomes enabled and the red message "Texas requires a tax ID" appears under it | (filled at build) | old: `_raw/inventory/old/S04-after.json`; new: (filled at verify) |
| 042 | Customer list columns | Given the customer list, Then columns are Cust #, Name, City, Phone, Balance in that order, sorted by Name ascending | | |

An unmapped REQ (no artifact or no evidence) means the work is not done.

### Gap analysis

Read the existing app (routes, pages, components, services, schema) and classify each REQ:

- **matches:** exists and behaves the same (still verified in Phase 6)
- **differs:** exists but differs in layout, wording or behavior (list each difference)
- **missing:** not in the app
- **app-only:** the new app has it and the old one does not. Keep it, but it must not occupy a spot
  where staff expect something else, and it goes on the what's-different sheet.

Also list data-model gaps from `data-model.md`: fields the old system stores that the app's schema
lacks (these block the data move later), and value formats that differ (dates, money as text,
codes).

### Questions and scope

Batch into `questions.md`, recommendation first:

- every UNKNOWN or INFERRED behavior that matters
- **quirks**: odd behaviors staff may depend on (a field that keeps its last value, a Back button that
  loses work). Keep, fix, or fix and tell staff?
- **likely-unused features**: legacy systems carry many features nobody uses. Show the evidence (no
  data, owner says unused) and ask. Never drop one silently, never build a reduced version without
  saying so.

### Build order

Order by scenario, not by screen: the most-used whole task first, with every screen it touches. A
task that works end to end is worth more than ten screens that each pass alone.

## Design

**The default is an exact copy of the source. There is no design choice to make: the source screenshot
is the design.** You do not merge or split screens, fix a bug or quirk, rename a label, swap a popup
for a dialog, add inline validation, or change a text field into a picker. The source does it that
way, so you do it that way. If one of those looks worth changing, note it for the owner but build it
as the source has it unless the owner explicitly says to change it, which is then recorded in
`decisions.md`.

### Everything matches

Match all of it to the source, from the screenshots and from `tokens.js` / `interactions.js`:

- position and order of every menu, item, button, tab, field and column; labels and wording; flow and
  which screen opens where; tab order; shortcuts; Enter/Esc behavior; defaults; where messages appear;
  density;
- fonts, font sizes and weights; colors (background, text, borders, accents); spacing and alignment;
  borders, radii and shadows; control shapes; icons;
- hover styles, focus rings, active states, cursors; transitions and `@keyframes` animations (same
  properties, durations and easing); scrollbars.

Do not substitute your component library's defaults for the source's look. A flat grey source button
becomes a flat grey button, not a rounded accent-colored one.

### Tokens

`tokens.js` output (`_raw/tokens/*.json`) is the exact source of the source's colors, fonts, sizes and
spacing; `interactions.js` is the exact source of its hover/focus styles, transitions and animations.
Map both into the new app's design system as named tokens so the whole app follows them, and set the
tokens to the SOURCE's values, not a house palette. Where a repo house rule (a default font, a default
radius) conflicts with the source, the source wins for this project; note the conflict in
`decisions.md`.

### Optional: only if the owner explicitly asked to modernize

Skip this entirely unless the owner asked, in writing, for a more modern look. If they did, keep every
position, label, order, shortcut and behavior unchanged, and build the busiest list screen and the
busiest form screen in 2-3 named directions (faithful / refreshed / modern), show them with
`parity_report.py` next to the source, run `layout_diff.py` on each (a direction that breaks the
layout is not offered), and let the owner choose. Record the chosen deviations in `decisions.md`. The
bar: someone who knows the source finds any control in about two seconds without searching.

## Build

### Per screen

- Build layout and behavior together from the screen spec; a screen that only looks right fails the
  first click.
- Labels verbatim, including abbreviations staff know ("Cust #"), unless `renames.json` holds an
  approved change.
- Same control order and grouping, same tab order (set explicitly when the layout engine would order
  differently), same access keys, same shortcuts (register handlers at the document level the way the
  old system did, and avoid keys the browser reserves such as Control+N, Control+T, Control+W).
- Same defaults on new records, same remembered values, same autofocus.
- Same validation rules and the same message text and position. Same moment of validation (on save vs
  as you type) unless the owner approved a change.
- Calculations implemented once in the service layer, with the characterization tables as unit tests.
  Match rounding mode and formatting exactly.
- Same list behavior: columns, default sort, page size, search fields, filter persistence.
- Exports produce the same format, columns, order and file name pattern as the golden files.
- Rules live in the service layer, not inside UI components, so API, jobs and screens share them.

### Data for comparisons

Seed the new app with the same records the old sandbox screenshots show (or migrate a small slice
early) so old and new screens can be compared with identical data. Comparisons with different data
are NOT_COMPARABLE.

### What never ships

- Vendor code, logos, icons, illustrations, help text or long instructional sentences (`ip_scan.py`).
- A stub, mock or placeholder on any path a staff member will use.
- A behavior built from INFERRED evidence the owner did not confirm.
