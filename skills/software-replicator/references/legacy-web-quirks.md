# Legacy web quirks

What old systems do that trips up automation and rebuilds, and how to handle each. Items marked
(verify) come from secondary sources; confirm on the actual system.

## Detecting what you are dealing with

Run once per system with `evaluate_script`:

    () => ({
      compatMode: document.compatMode,                 // "BackCompat" = quirks mode, no doctype
      documentMode: document.documentMode || null,     // set only in IE or IE mode
      frames: document.querySelectorAll('frame,iframe').length,
      frameset: !!document.querySelector('frameset'),
      webForms: !!document.querySelector('input[name="__VIEWSTATE"]'),
      jsf: !!document.querySelector('input[name$="javax.faces.ViewState"],input[name$="jakarta.faces.ViewState"]'),
      postBack: typeof window.__doPostBack === 'function',
      jquery: window.jQuery ? window.jQuery.fn.jquery : null,
      plugins: document.querySelectorAll('object,embed,applet').length,
      generator: (document.querySelector('meta[name=generator]') || {}).content || null,
    })

Record the answer in `LESSONS.md`.

## Quirks and handling

| Quirk | What to record and how to handle it |
|---|---|
| **Quirks mode** (no doctype) | Box sizes and line heights differ from a standards-mode rebuild; widths in the inventory are slightly off. Match by relations, not pixels (that is what `layout_diff.py` does). |
| **Framesets and iframes** | The frame layout is part of the contract: which pane is fixed (menu, header), which scrolls, which changes when you click in another. `inventory.js` scans same-origin frames; open cross-origin ones by `src`. Snapshots of frame content have had gaps in some DevTools MCP versions: trust the inventory. |
| **window.open popups** | `list_pages` / `select_page`. Record window size, whether it is modal in practice, and what it writes back to the opener (lookup pickers fill a field and close). Rebuild as an in-page dialog only if the owner approves (gray zone). |
| **showModalDialog** | Removed from Chrome long ago (verify). If the vendor's scripts still call it, that path only works in IE mode or through a polyfill. The rebuild must block the page and return a value. |
| **IE-only, IE mode** | Signs: `documentMode` set, `attachEvent`, `ActiveXObject`, an `X-UA-Compatible` header. Staff may run it in Edge IE mode. What Chrome shows may not be what staff see: ask for screenshots from their real setup and treat Chrome captures as fidelity C for affected screens. |
| **ActiveX, Java applets, Flash, Silverlight, Oracle Forms** | Not in the DOM; browser automation cannot see or drive them. Work from network traffic plus the owner's screen recordings, at fidelity C or D, and say so. |
| **ASP.NET WebForms** | Each action posts the whole form with `__VIEWSTATE` and `__EVENTVALIDATION`; `__doPostBack(target, arg)` sets `__EVENTTARGET`, which names the control that fired (`net_schema.py` keeps those values). AutoPostBack dropdowns reload the page and can reset other fields: behavior to replicate or consciously change. Event validation rejects forged posts: always drive the UI. |
| **JSF** | A `ViewState` hidden field; generated ids like `form:table:0:name` change between renders, so identify controls by label (the inventory does). "View expired" after timeout or Back. |
| **Server-rendered forms** | The saved request body is the true field list and order, including hidden fields. Server-side validation comes back on a re-rendered page: capture it by submitting invalid input in the sandbox. |
| **Session timeout** | Measure idle timeout and any warning dialog; note whether unsaved work is lost. Recover by logging in again and replaying the click path. |
| **CSRF tokens** | Note that they exist and how they rotate. Never copy or replay them; drive the UI. |
| **Captchas** | Stop. The owner handles it, or asks the vendor for a sandbox user without one. |
| **Double submit** | Sandbox only: double-click Save once and record what happens (button disables, duplicate record, warning). Copying a duplicate-record bug is an owner decision. |
| **Back button** | Record "Document expired" or resubmit prompts and `onbeforeunload` warnings. Staff learned "never press Back"; a rebuild that makes Back safe is a fix to list on the what's-different sheet. |
| **Print stylesheets, PDF, Crystal, SSRS** | No print emulation in the DevTools MCP; read `@media print` rules from `document.styleSheets` and golden-master server PDFs (text, page breaks, headers). |
| **Excel exports** | Check the real bytes: many ".xls" files are HTML tables or CSV with a different extension. Keep sheet names, header labels, column order, number and date formats, encoding and BOM, leading zeros: staff macros and the accountant depend on them. |
| **accesskey** | Modifiers differ by browser and OS (Alt on Windows Chrome and Edge, Alt+Shift on Firefox, Control+Option on macOS). Keep the same letters. |
| **F-keys and shortcuts** | Find `keydown` handlers (key codes 112 to 123 are F1 to F12) in inline attributes (`pageKeyHandlers`) and saved scripts. The browser reserves some combinations (Control+N, Control+T, Control+W); test each key in the staff's browser. |
| **Tab order and Enter** | Old forms often use `tabindex` and Enter-to-next-field scripts. Walk Tab with `press_key` and read `document.activeElement`; record what Enter does in each field type. |
| **Clickable table cells and images** | `onclick` on `td`, `img`, `span` with a pointer cursor: missing from the accessibility tree, found by `inventory.js` as role `clickable`. Rebuild as real buttons or links with the same position and label. |
| **Fixed-width layouts and tiny fonts** | 800 or 1024 pixel wide pages and 11px Verdana are common. Density is part of the contract (staff see a whole record without scrolling); a modern skin can enlarge type a little only if the same information still fits. |
| **Encoding** | Windows-1252 pages and exports; curly quotes and accented names may break when moved. Check during the data move. |
