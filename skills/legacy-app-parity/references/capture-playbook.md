# Capture playbook (Phases 1 and 2)

How to see everything the old system shows and record everything it does, with evidence, without
breaking anything. Pair with `access-and-safety.md` (tiers) and `legacy-web-quirks.md` (old tech).

## Contents

- Mapping: the capture loop, states, click paths, frontier, frames and popups, roles
- Behavior: interaction model, rule sampling, state diffs, calculations, validation probes, lists,
  keyboard and focus, messages, network, JavaScript and REA, exports and printouts, hidden behavior
- Writing it down

## Mapping

### The capture loop (every screen, every state)

Screen IDs: `S01`, `S02`... in discovery order, never reused. States add a suffix: `S04-error`,
`S04-empty`, `S04-menu-open`. File names use the ID: `_raw/shots/old/S04.png`,
`_raw/inventory/old/S04.json`, `_raw/snapshots/old/S04.txt`.

1. `resize_page` to the staff screen size (ask in Phase 0; a common office default is 1366x768 or
   1920x1080). Same size for every capture, old and new.
2. `evaluate_script` with `ready.js`. Proceed only on `READY`. On `NOT_READY` use `wait_for` on
   expected text and re-check. On anything else see the troubleshooting table in SKILL.md.
3. `take_screenshot` with `filePath` (viewport). Add `fullPage: true` as a second file when the
   screen scrolls (`S04-full.png`).
4. `evaluate_script` with `inventory.js` and `filePath`.
5. `take_snapshot` with `filePath` (accessibility tree, useful for uids to click and for labels).
6. Note the click path and URL in `site-map.md`.

Capture these states when a screen has them: default on arrival; a new (empty) record form; a
filled record; each validation error state; an empty list and a long list (paging); a selected row;
each open menu, dropdown and dialog; each tab of a tabbed screen; read-only vs editable modes; each
role's version if you can reach it.

Hover menus: open them (hover or click) and inventory while open, as their own state. Closed menus
are often in the DOM but hidden, and a modern rebuild may not render them until opened, so
`layout_diff.py` compares visible controls by default.

### Click paths, not URLs

Reach every screen from the home screen by clicking, and write the path ("Customers > List > click a
row > Invoices tab"). Old systems keep state in the server session: opening a deep page by URL can
show a wrong record, an error, or skip a step the user always goes through. Use direct URLs only for
read-only list pages after you have seen them work by clicking.

### The frontier

After each batch, run `python3 scripts/coverage.py --parity-dir docs/parity`. It lists:

- safe-looking same-site links not yet inventoried (reach them by clicking where they appear)
- dangerous-looking links (delete, void, send, logout...) that must never be opened by URL
- click-only targets (postbacks, `javascript:` links, onclick handlers, popups)
- menu entries not yet named in `site-map.md`

Mapping is done when the frontier is empty, or every remaining item is marked out of scope by the
owner, or not reachable with your account (listed for owner screenshots).

### Frames and popups

- `inventory.js` scans same-origin frames in place and lists cross-origin ones; open those by their
  `src` as separate screens. Record the frameset layout itself (which pane is fixed, which scrolls,
  which pane changes when you click in another): that is part of the layout contract.
- Popups: after a click that may open a window, `list_pages`, `select_page` the new one, run the loop,
  record its size and what it writes back to the opener (a lookup picker filling a field is behavior to
  rebuild). Return with `select_page`.

### Roles

Each role's own view is the layout contract for the people in that role: an admin view shows menus
and buttons the front desk never sees. Capture every screen a role uses while logged in as that role
(suffix the files, for example `S04@frontdesk.json`), note the differences in each screen spec, and
compare old and new with the same role on both sides. Use the admin login for completeness (every
button exists somewhere) and for testing writes. If you cannot reach a role, list its screens under "Not reachable" in the site map
and ask the owner for screenshots.

## Behavior

### First: the interaction model

For each screen decide, from network traffic and the URL bar while you act:

- **Server postback / full page post:** each action reloads the page (WebForms, JSF, classic PHP,
  ColdFusion). State lives on the server; fields may reset after a post.
- **AJAX:** parts of the page update from `fetch`/XHR calls.
- **Client-side only:** logic in the page's JavaScript, no request.
- **Popup window or modal page:** a separate window that returns a value.
- **Frames:** several documents that navigate independently.

Write it in the screen spec. A rebuild that uses the wrong model (for example a single-page form where
staff are used to each tab saving separately) changes how work feels even when every field matches.

### One observation is one sample of a rule

Never record a rule from one example. Vary one input at a time until you can state the rule and its
edges, then label it OBSERVED for the cases you saw and INFERRED beyond them.

### Before/after state diffs

For anything that reacts to input: set `includeValues: true` (sandbox data only), run `inventory.js`
to `S04-before.json`, perform ONE action (pick a value, tick a box, type and Tab out, click
Calculate), run `inventory.js` to `S04-after.json`, then:

    python3 scripts/state_diff.py S04-before.json S04-after.json --action "picked State = TX"

The output (became enabled, options changed, total recalculated, message appeared) is the behavior.
Paste its findings into the screen spec with the evidence paths.

### Calculations

For each formula (line totals, tax, discounts, late fees, commissions, balances, dates and ages,
rounding): a characterization table in the screen spec. At least these rows: typical, zero, negative
or credit, a value that rounds at .5, a large value, and each discount or tax variant. Change one
input per row. Record the old system's exact output including formatting. These rows become the new
app's unit tests verbatim. If a formula depends on server data you cannot see (a tax table, a price
list), list it as a question.

### Validation probes (sandbox or ZZTEST records only, since they submit)

Per form: submit empty; each required field blank alone; each field at max length and one over; wrong
formats (letters in numbers, bad email, phone without area code, dates like 31/02, 2/30, far past, far
future); negative and zero amounts; duplicates (same customer number twice); leading and trailing
spaces; pasted text with line breaks. For each: exact message wording, where it appears (inline,
alert box, top banner, new page), whether entered data survives the error, and which field gets focus.

### Lists, search, sort, filter, paging

Which fields search covers; partial or whole-word; case; wildcards; what an empty result shows; default
sort and direction; which columns sort and whether sort survives going into a record and back; filter
defaults and whether they persist; page size and whether it can change; what the row count says; row
click vs double-click vs a View link; multi-select and bulk actions (tier X).

### Keyboard and focus

Staff who use a system for years work from the keyboard. Record per form:

- The real Tab order: focus the first field, then `press_key` Tab repeatedly, reading
  `document.activeElement` (label, name, id) with a tiny `evaluate_script` after each press. The
  inventory's `tabOrder` is computed from markup; scripts can change the real order.
- Access keys (`accesskey` in the inventory; Alt on Windows Chrome and Edge, Alt+Shift on Firefox,
  Control+Option on macOS).
- Function keys and shortcuts: `pageKeyHandlers` in the inventory shows inline ones; search saved
  scripts for `keyCode`, `which`, `key ==`, `F2`, and the numbers 112 to 123. Test each with
  `press_key` in the sandbox.
- What Enter does in a text field (submit the form, or move to the next field), what Esc does,
  autofocus on load, where focus lands after save and after an error.

### Messages and confirmations

Exact wording, type (inline, alert, confirm, banner, toast, new page), position, color, how long it
stays, and whether a confirm dialog's default button is OK or Cancel. `evaluate_script` and
`navigate_page` can accept or dismiss dialogs; dismiss unless the tier allows the action.

### Network: the data model and the server actions

On a live system behind the parity shield, do not use `get_network_request` (the guard blocks it):
the shield's `traffic.jsonl`, `blocks.jsonl` and `dryrun/index.jsonl` replace it, and
`net_schema.py --index <log_dir>/dryrun/index.jsonl` turns the dry runs into the write side of the data
model. The steps below are for a sandbox.

After each action on a screen:

1. `list_network_requests` with `resourceTypes: ["document", "xhr", "fetch"]` (add `other` for odd
   legacy calls). Note the reqids that belong to the action.
2. `get_network_request` with `responseFilePath` and, for posts, `requestFilePath`, pointing into
   `_raw/net/`. The tool replaces your extension and reports the real saved name (for example
   `S04-41.network-response`); use that name.
3. If a response shows no body, it came from cache: reload with `navigate_page` `type: reload`,
   `ignoreCache: true`, then save again.
4. Append one line to `_raw/net/index.jsonl`:

       {"screen":"S04","action":"click Save","reqid":41,"method":"POST","url":"https://old.example.com/Customer.aspx?id=88","status":302,"resourceType":"document","request_file":"S04-41.network-request","response_file":"S04-41.network-response"}

5. Regenerate the catalog:

       python3 scripts/net_schema.py --index docs/parity/_raw/net/index.jsonl --md docs/parity/data-model.md --json docs/parity/_raw/net/schema.json

`data-model.md` keeps names and types only, so it can be committed; skim it for anything that still
looks like customer data (for example a name inside a URL path) before committing. For old form posts,
the posted field names are the data model, and `__EVENTTARGET`-style values name the control that
posted: that maps every server action to its button.

### JavaScript: client-side rules

The page's own scripts hold validations, calculations, shortcuts, enable/disable logic and the URLs it
calls. To read them:

1. `list_network_requests` with `resourceTypes: ["script"]` and save each with `get_network_request`
   `responseFilePath` into `_raw/js/` (inline scripts: use the saved document response).
2. Search the saved files for the exact on-screen wording first (error messages, labels, alert text),
   then for `keyCode`, `onkeydown`, `submit`, `disabled`, `display`, `Math.round`, `toFixed`, `fetch`,
   `XMLHttpRequest`, `__doPostBack`, `window.open`. Read the code around each hit. Most legacy logic is
   found this way.
3. For large or minified bundles, map them with REA (no setup needed; it never executes the code):

       npx -y rea-agents@latest analyze-javascript-application <abs path to _raw/js> --format json > <abs path>/_raw/js/rea.json

   The output is large; do not read it whole. It records `request` nodes with file and line (where the
   code calls the server), functions, call sites, and webpack-style module structure, plus limitations.
   Use it to find which code builds which request and to walk a big bundle module by module. It does
   not reliably surface alert message strings, so keep step 2.
4. Optional deeper REA use (passive observation of a live page, event listener locations, tracing a
   feature from a seed string) needs REA's MCP server and a browser started with a loopback debugging
   port. Follow the `reverse-engineer-anything` skill, and ask the owner before changing any
   configuration.

Everything learned from code alone is INFERRED until you watch it happen in the UI.

### Exports and printouts

- Exports: in the sandbox, trigger each one, then save the response with `get_network_request`
  `responseFilePath` into `_raw/exports/old/`. Check the real bytes (`file` or the first lines):
  many legacy ".xls" files are HTML tables or CSV. Record sheet names, header labels, column order,
  number and date formats, encoding (BOM), leading zeros, totals rows and the file name pattern. Staff
  macros and accountants depend on these. Keep the file as the golden master.
- Printouts: the DevTools emulate tool has no print mode. Read the print rules with
  `evaluate_script` (walk `document.styleSheets` for `@media print` rules) and save any PDF the system
  produces. Record page size, orientation, headers and footers, what is hidden when printing, page
  breaks. Reports built with Crystal or SSRS are usually PDFs from the server: golden-master their text
  and layout.

### Hidden behavior

Things no screen shows directly: emails and texts sent on events, numbering sequences (invoice
numbers, customer numbers and their format), audit or history entries, automatic status changes,
scheduled jobs (nightly statements, reminders), integrations (accounting, payments, calendars),
reports that arrive by email. Find them by asking the owner, by reading settings and automation
screens (tier R), by watching other screens change after a sandbox write, and from the sandbox's sent
mail log if it has one. List what you could not observe as questions.

### Session and timing

Measure the idle timeout and any warning before it; whether an expired session loses unsaved work;
double-submit behavior (sandbox only: double-click Save once); what Back does after a post. These are
behaviors staff have habits around. Whether to copy a bad one is an owner decision.

## Writing it down

For each screen, copy `screens/_TEMPLATE.md` to `screens/S##-name.md` and fill it from the evidence.
Each behavior row cites its evidence files and carries OBSERVED, INFERRED or UNKNOWN. Unknowns go to
`questions.md` in a batch. Write the top tasks as scenarios in `scenarios.md` with every output
recorded, and run each scenario twice on the old system so noise fields (timestamps, generated
numbers) can be masked when comparing later.

Append anything surprising to `LESSONS.md` (Smell, Failure, Truth, Mitigation).
