---
name: mobile-view-optimization
description: How to make an existing web app genuinely good on a phone, screen by screen, without changing the desktop layout. Read this BEFORE building or changing any page, dialog, table, toolbar, filter bar, card grid, or tab strip that a user could open on a phone, and whenever the user says "mobile", "phone", "responsive", "it overflows", "it scrolls sideways", "it flies around", "it's cut off", "the buttons are jumping out", "optimize for mobile", "mobile view", or asks for a page-by-page mobile sweep of an app. It encodes the bar ("it doesn't overflow" is the floor, not the bar), the exact verification protocol (390px, touch emulation, wait for settle, scroll to the bottom, overflow probe, then re-check desktop), the catalogue of fixes that actually work (wide table to cards, filter row to a Filters sheet, stacked headers, value-first KPI cards, touch-scrollable tab strips, capped toasts), and the ledger method for sweeping every screen of a large app without losing track. Use it together with mobile-app-ui-design (the design bar) and browser-verification (the tooling).
---

# Mobile View Optimization

How to take a web app that was built on and for a desktop and make every screen
genuinely usable and clean on a real phone. Written from a full page-by-page
sweep of a large production app (hundreds of routes), including the fixes that
were rejected by the owner the first time and why.

The examples use React + Tailwind (`md:hidden`, `sm:flex-row`). The method and
the patterns are the same in any stack: translate the class names to your own
breakpoint system.

---

## 1. The bar

**"It doesn't overflow" is the floor, not the bar.** An agent that removes the
horizontal scrollbar and calls the page mobile-optimized will be sent back. A
page built for a computer usually has to be re-prioritized for a thumb, not just
squeezed.

A screen passes when all of these are true at phone width:

- Nothing overflows the page horizontally and nothing is cut off or clipped.
- The most important data and the primary action are the easiest things to see
  and to tap. Secondary controls are still reachable, but out of the way.
- Nothing wraps into a tall one-word-per-line column, and no text is truncated
  into something unreadable ("EXPENSI", "TOTAL B", "$0....").
- Tap targets are finger sized (44px or more).
- The user never has to scroll in two directions to read one record.
- Nothing was removed. Mobile gets the same capability, reprioritized.

**Desktop must not change.** Every mobile fix is gated so the desktop layout is
byte-for-byte what it was (base styles plus `sm:` / `md:` overrides, or the
app's mobile hook). The only exception is a fix that also repairs a real desktop
break. Verify both widths, every time.

The visual standard to judge against is the `mobile-app-ui-design` skill: 8
point spacing grid, at most 4 font sizes and 2 weights, value bigger than label,
primary action in the thumb zone (bottom third), 44px targets, designed
mobile-first at 375 to 390px. Read it before redesigning a surface. Use
`ui-ux-pro-max` when a component needs a real redesign rather than a de-clip.

---

## 2. Before the first fix: learn the app's mobile foundations

Spend five minutes finding these, and write them down, before touching a page:

1. **The breakpoint.** What width is "mobile" here, and what is the hook or
   utility for it (for example a `useIsMobile` hook at under 768px matching
   Tailwind `md`)? Use the existing one. Do not introduce a second breakpoint.
2. **The shell.** How does the layout already behave on mobile (drawer sidebar,
   top bar, banners)? A fix in the shell lands on every route at once.
3. **Where horizontal scroll comes from.** Find the scroll container around page
   content. If the main content area is `overflow-x-auto`, then any page whose
   content is wider than the viewport makes the WHOLE page scroll sideways. That
   is the "it flies around" bug. The fix is per-page containment (the wide thing
   scrolls inside its own box, or stops being wide), never removing the shell's
   overflow rule that desktop tables depend on.
4. **A known-good reference.** Find one screen that is already good on a phone
   and copy its patterns (card rows, sheets, collapsed tabs) so the app stays
   consistent instead of gaining a new style per page.
5. **Shared components.** List the shared table, toolbar, dialog, tab strip, KPI
   card and report shell. Fix these first: one change repairs dozens of screens.

---

## 3. The per-screen protocol (follow it literally)

Use a real browser through the `browser-verification` skill (Chrome DevTools
MCP or equivalent). Reading the code is not verification.

1. **Emulate a phone:** 390x844, device pixel ratio 3, mobile and touch enabled.
   Touch matters: hover, wheel and arrow-key affordances do not exist there.
2. **Navigate, then WAIT for the page to settle** (2.5 seconds or more, and
   scroll once). A probe taken mid-render reports overflow that is not real, or
   misses overflow that appears when data arrives.
3. **Scroll the full height in steps and screenshot each step, to the bottom.**
   The first viewport is usually the part that was already fixed.
4. **Run the overflow probe** (below).
5. **Judge against section 1.** If anything is cramped, clipped, overflowing,
   ugly, or not thumb friendly, fix it, gated to mobile.
6. **Reload and re-verify at 390px.** Then **verify desktop at 1440px** is
   unchanged for that screen.
7. **Open the things that open:** every dialog, sheet, dropdown and tab on the
   screen. A page can be clean while its dialog is wider than the viewport.
8. **Check a populated state, not only the empty state.** An empty list always
   looks fine. If the test account has no data for this screen, say so and mark
   the populated state unverified. Do not call it done.
9. Keep typecheck green. Committing is the owner's call.

### The overflow probe

Run this in the page after it settles:

```js
(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const offenders = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 1 || r.left < -1);
    })
    .slice(0, 15)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.className && el.className.toString().slice(0, 80)) || '',
      right: Math.round(el.getBoundingClientRect().right),
      width: Math.round(el.getBoundingClientRect().width),
    }));
  return { scrollWidth: de.scrollWidth, clientWidth: vw, overflows: de.scrollWidth > vw, offenders };
})();
```

`scrollWidth === clientWidth` is the pass condition for the page. The offender
list tells you which element to fix. Remember that elements inside a
deliberately scrollable box will be listed too: that is expected for the box's
children, and is only a bug when the page itself overflows.

Fixed and portal elements (toasts, popovers, floating buttons) can widen the
document on every page at once. If every screen overflows by the same amount,
look there first.

---

## 4. What to look for

- Page-level horizontal scroll.
- Content cut off at the right edge, or clipped inside a card.
- A horizontal control row (title + buttons, or five filters) squeezed until the
  title wraps one word per line or a label is clipped.
- Dialogs, popovers or menus wider than the viewport.
- Multi-column grids that never collapse.
- Fixed pixel widths (`w-[640px]`, `min-w-[...]`) on anything.
- Raw multi-column tables.
- Tap targets under roughly 40px, or two targets touching.
- Filter stacks that push the actual content below the fold.
- Tab strips where some tabs cannot be reached by a finger.
- `truncate` on text the user needs to read in full.
- Counters, hints and secondary labels that cost a row and add nothing on a phone.

---

## 5. The fix catalogue

These are the fixes that survived review. Reach for them in this order of
preference: reprioritize, then restack, then contain.

### Header row (title + actions)

Symptom: the title is squeezed into a tall wrapped column and the last button is
clipped. Fix: the header becomes a vertical stack on mobile and a row from `sm`
up. The identity block (title, description) is locked above the toolbar, title
and description truncate or wrap cleanly, and the toolbar wraps.

```tsx
<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
  <div className="min-w-0">{/* title + description */}</div>
  <div className="flex flex-wrap items-center gap-2 shrink-0">{/* actions */}</div>
</div>
```

### Wide table of records

A wide table inside an `overflow-x-auto` box is NOT automatically fine. It stops
the page from scrolling sideways, but on touch there is no visible scrollbar and
the columns that matter (status, amount, available) sit off the right edge. The
owner's words: "how am I supposed to scroll side to side."

Fix: on mobile render stacked cards, keep the table for desktop.

```tsx
<div className="md:hidden space-y-2">{rows.map((r) => <RecordCard key={r.id} row={r} />)}</div>
<div className="hidden md:block">{/* the existing table, untouched */}</div>
```

Card shape that works: name plus status badge on the top line, one subline of
secondary identity (code, location, email), then the two or three numbers that
matter as small stat tiles. Long detail goes behind tap-to-expand. Free text
uses `break-words`.

The one exception is a purely columnar report table where comparing down a
column is the whole point. That may stay as a table that scrolls inside its own
container, provided it finger-scrolls natively, the identifying column comes
first, and the page itself does not overflow.

### Filter bar

Symptom: five full-width dropdowns stacked, eating the screen before any data
shows. Fix: on mobile show only the one filter people change constantly (usually
the date range or the search box) plus a **Filters** button with a badge showing
how many secondary filters are active. The button opens a bottom sheet holding
the rest, with an Apply button. Desktop keeps the inline row.

Do not waste rows. A good mobile toolbar is often one row: `[Filters] [Search,
flex-1] [Export as an icon button]`. Put related small actions next to each
other rather than each on its own line.

### Primary and secondary actions

The primary action ("Add expense", "New booking") is a contained, full-width
button in the thumb zone, not a small button stranded at the top right.
Secondary actions (Export, Download) demote to compact icon buttons with an
accessible label. Tertiary actions go in an overflow menu.

### KPI and stat cards

Symptom: on a 2 column mobile grid (cards about 170px wide) a horizontal
`[icon][label + value]` layout squeezes the value until it truncates, and labels
wrapping to different heights misalign the numbers.

Fix: vertical stack. A small icon and label row on top, with the label allowed
to wrap and a reserved minimum height so baselines line up across cards. The
VALUE is the hero on its own full-width line, pushed to the bottom of the card,
bold, tabular numbers, never truncated. Compact on mobile (smaller padding and
value size), roomier from `md` up. If a help icon sits beside a wrapping label,
make it flow inline after the label text, not as a flex sibling that lands in
the middle of the wrap.

A truncated number is a bug even when it "fits". `$0....` is an ellipsis, not a
formatting quirk.

### Tab strips

Symptom: an overflowing tab strip is `overflow-x-hidden` and desktop reaches the
hidden tabs with arrows or the wheel. Touch has neither, so the clipped tabs are
unreachable. Fix: make the strip a real touch scroll box when it overflows
(`overflow-x-auto`, hidden scrollbar, `touch-pan-x`, `overscroll-x-contain`).
The desktop arrow path keeps working because both write `scrollLeft`.

For a small fixed set of tabs, collapsing them into a dropdown on mobile is a
good pattern. Collapsing inactive tabs to icon-only is not: unlabeled icons are
cryptic. Changing a shared tab component reshapes every page that uses it, so
get an explicit decision before doing that app-wide.

### Toasts and other fixed overlays

A toast viewport sized to its content can be wider than the screen and give
EVERY page a phantom horizontal scroll. Cap it: `max-width: calc(100vw - 2rem)`
on the viewport and on each toast, with `break-words`.

### Dialogs and sheets

Cap dialog width to the viewport minus a gutter, let the body scroll inside the
dialog, and keep the action buttons visible (sticky footer) rather than below a
long scroll. A form with many fields is usually better as a full-height sheet on
mobile than as a centered dialog.

### Grids and forms

Grids collapse to one column (or two for compact tiles). Form fields go full
width, one per row. Replace fixed pixel widths with `w-full` plus a `max-w` at
the desktop breakpoint.

### Things to simply hide on mobile

Row counters ("42 rows"), redundant helper captions, and decorative columns:
`hidden sm:inline`. Only hide what is truly redundant. Never hide data or an
action the user came for.

---

## 6. Truncate or wrap

- A value the user needs (a number, a status, a name in a list they are
  scanning): never truncate. Give it its own line.
- A short label: wrap it, and reserve height so neighbours stay aligned.
- A long title or description in a header: truncate with `min-w-0` on the flex
  child, because wrapping it would push the content down.
- Free text (message bodies, notes): `break-words`, never a fixed height.

`truncate` does nothing without `min-w-0` on its flex parent chain. That missing
`min-w-0` is the most common cause of a flex row overflowing.

---

## 7. Sweeping a whole app: the ledger

When the ask is "every page, 100% mobile-optimized", a checklist of pages in
your head will not survive the work. Build a ledger file first.

1. **Enumerate every route** from the router, including tabs, sub-tabs and
   detail pages. One checkbox per screen, grouped by section.
2. **Mark what is out of scope, with the reason.** Pure redirects, legacy alias
   routes that render the same component as a clean sibling (`N/A, alias of
   <route>`), and separate apps. Do not skip silently.
3. **Status tags:**
   - `[ ]` to do
   - `[x] VERIFIED` looked at it, scrolled to the bottom, fine as it is
   - `[x] FIXED <file>` changed and re-verified, with a one line note
   - `[~] PENDING-VISUAL` code fixed while the browser was unavailable, needs a look
   - `N/A` with the reason
4. **Never mark VERIFIED without an actual scrolled-to-bottom look.** If the
   browser tooling drops, keep making code fixes, tag them `PENDING-VISUAL`, and
   re-verify the moment it is back.
5. **Group by shell.** Tabs that share a shell are fixed once in the shell. Fix
   shared components before individual pages, then re-check a few of their
   consumers.
6. **Keep a findings log** in the same file: where, symptom, root cause, fix,
   how it was verified. The next page with the same symptom gets the same fix,
   which is what keeps the app consistent.
7. **Bugs that are not mobile bugs get logged, not fixed in the sweep.** You
   will find wrong data and broken features along the way. Write them down as
   their own task so the sweep stays reviewable.
8. Do not stop at "the main pages". The long tail (settings sub-tabs, builders,
   detail pages, populated report tables) is where the breaks are.

---

## 8. Practical rules

- **Gate, do not fork.** Prefer one component with responsive classes. Reach for
  a separate mobile render (`md:hidden` cards beside a `hidden md:block` table)
  only when the shape of the content truly changes.
- **If the app is translated, add the new strings to the translation files
  first** ("Filters", "Apply filters"). Do not hardcode them.
- **Check both orientations of risk:** after a mobile fix, the usual regression
  is on desktop, and after a shared-component fix it is on some other page.
- **Real devices differ from emulation** in safe areas (notch, home indicator)
  and in the on-screen keyboard covering inputs. For a wrapped native app, pad
  for safe-area insets and make sure a focused input scrolls into view.

### Baseline every page needs

These are the ground rules for any page, new or old. Check them once per app:

- The viewport meta tag is present: `width=device-width, initial-scale=1.0`.
- Styles are written mobile-first: base styles are the phone layout, and
  breakpoints add the wider layouts on top.
- Images never exceed their container (`max-width: 100%; height: auto`), load
  lazily below the fold, and use `srcset` and `sizes` so a phone does not
  download the desktop file.
- Headings scale fluidly (`clamp()`) instead of jumping at breakpoints.
- Safe-area insets are padded with `env(safe-area-inset-*)` on anything fixed
  to an edge.
- Besides 390px, spot-check 320px (the smallest common screen) and landscape.
- Test on iOS Safari and Android Chrome when a real device is available, and on
  a throttled network for pages that load a lot of data.

---

## 9. Reporting

Say exactly what was looked at and what was not:

- Which screens were verified live at 390px, and which were only code-fixed.
- Which states were unverified (populated data, a role you could not log in as,
  a dialog you could not open).
- That desktop at 1440px was re-checked, per screen fixed.
- Any design decision you deferred because it changes a shared component for the
  whole app.

"All pages are mobile-optimized" is a claim about every row of the ledger. If
the ledger is not fully checked, report the count.

---

## Related skills

- `mobile-app-ui-design`: the design bar to judge every mobile surface against.
- `ui-ux-pro-max`: when a component needs a redesign, not a patch.
- `browser-verification`: how to drive the browser, emulate the device and screenshot.
- `review-build`: its mobile section is the gate that sends you here.
- `build-with-the-user-in-mind`: decide what the most important thing on the
  screen is before deciding what to put in the thumb zone.
