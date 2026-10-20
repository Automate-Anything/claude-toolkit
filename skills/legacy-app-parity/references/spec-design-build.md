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

### Frozen, free, gray

**Frozen (the contract):** position and order of every menu, menu item, button, tab, field and
column; labels and wording; screen-to-screen flow and which screen opens where (same window, popup,
tab); tab order; keyboard shortcuts and access keys; Enter and Esc behavior; defaults; where messages
appear; information density (how much fits on one screen without scrolling; staff scan by position).

**Free (the skin):** typeface and type scale, spacing, color shades within the old system's color
identity (if the brand bar was dark blue it stays a blue), borders, radius, shadows, icon style,
control styling, focus and hover states, contrast, loading and empty states, behavior on smaller
screens (the desktop layout still matches).

**Gray zone (ask the owner):** merging or splitting screens; fixing an old bug or quirk; renaming a
confusing label; replacing a popup window with an in-page dialog; adding inline validation where the
old system validated on save; changing a date entry field into a date picker (people type dates fast;
a picker can slow them down).

### The three directions

Build the busiest list screen and the busiest form screen in three directions, all with the frozen
contract intact:

1. **Faithful:** the old look, cleaned up. Same palette and density, crisper type, consistent spacing,
   fixed alignment. Lowest change aversion.
2. **Refreshed:** modern controls and type, the same layout, density and color identity.
3. **Modern:** a new visual language with every control in the same position and order.

Put screenshots in `_raw/shots/faithful/`, `_raw/shots/refreshed/`, `_raw/shots/modern/` and run
`parity_report.py`: it shows the old screen and each direction side by side. Run `layout_diff.py`
on each direction too: a direction that fails the contract is not offered. Present them in plain
English with your recommendation (usually faithful or refreshed for expert staff who use the system
all day).

**The two-second test:** for each direction, someone who knows the old system should find any control
in about two seconds without searching. If the owner can ask one or two long-time staff to look at the
three options, their reaction is better evidence than anyone's taste.

### Tokens

`tokens.js` output (`_raw/tokens/*.json`) is the source of truth for the old color identity, base
font size and density. Map it into the app's design system as named tokens (brand, surface, text,
link, primary action, table header, row stripe, border, focus) so the whole app follows one decision.
Follow the repo's own design rules for everything the contract leaves free; where a house rule
conflicts with the old system's color identity or density, the contract wins for this project and the
conflict is recorded in `decisions.md`.

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
