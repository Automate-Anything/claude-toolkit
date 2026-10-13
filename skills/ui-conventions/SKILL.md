---
name: ui-conventions
description: The owner's standing UI conventions that keep a growing app consistent, for a React + Tailwind + shadcn-style stack (the principles apply to any component system). Four parts. (1) COLOR THEME: brand colors come from CSS-variable tokens, never hardcoded hex codes or palette classes, because each account can pick its own theme; which colors are themed, which stay fixed, the status-color standard, and the edge cases (user-picked colors, color-picker swatches, email templates, charts, dark mode). (2) TOOLTIPS: one global provider, set only the content. (3) PAGE MAP: the app's real page structure, canonical names, and where settings live, so you never create a duplicate or orphaned page. (4) LISTS AND PAGINATION: one shared pagination hook, never custom logic. Read it BEFORE writing or editing any component's colors or class names, before adding a tooltip, before creating a new page, tab or settings screen, before naming a navigation item, and before adding pagination to any list that can grow without limit. Use when the owner mentions colors, theme, branding, "it's the wrong blue", dark mode, hardcoded colors, tokens, tooltips, help icons, "where does this setting go", "we already have a page for that", duplicate pages, naming, pagination, page size, or "load more".
---

# UI Conventions

> ## Adapt before use
> These conventions describe how the UI SHOULD be wired. The token names (`--primary`,
> `bg-primary`), the component names (`Tooltip`, `TooltipHelp`, `usePagination`), the file names
> and the page names in the examples come from a production React + Tailwind + shadcn/ui app and
> are EXAMPLES of the shape. Grep the repo before citing any of them. Once the repo has its own
> theme file, tooltip components, page map and pagination hook, replace the examples here with
> the real names, and fill in the page map in Part 3.

For visual quality and design decisions use `ui-ux-pro-max`. For phones use
`mobile-view-optimization`. For rendering performance use `page-performance`. This skill is the
small set of consistency rules that agents break most often.

---

# PART 1: COLOR THEME

**In one line:** colors come from CSS variables, not from palette classes. **Never hardcode hex
codes or palette colors in app code.** Use the token classes below. If a hook blocks your edit,
read this part and fix the approach. Do not bypass it.

## The mental model

The app's brand colors are not "blue" or "navy". They are **whatever the owner of that account
picked**. Two businesses on two theme presets look at the same app with completely different
palettes. Your code has to work for both.

Every brand-relevant color comes from a CSS custom property on the root element. A theme provider
writes the active preset's values to those properties. Utility classes like `bg-primary` resolve
through `hsl(var(--primary))`, so the entire UI follows the theme automatically, **provided you
used a token class.**

If you write `bg-blue-600`, you have frozen the color. It looks correct on the blue theme and
broken on every other theme. Do not do this.

Even an app with a single theme today should be built this way. Adding themes, dark mode, or a
rebrand later is then a change to one file instead of a sweep of every component.

## What gets themed, what stays fixed

**Themed (the brand bucket; flips per preset):**
- `--primary`, `--primary-hover`, `--primary-foreground`
- `--accent`, `--accent-foreground`
- `--ring`
- `--sidebar-primary`
- `--background` (a subtle nudge per preset: a warm versus a cool off-white)
- `--muted`

**Fixed (semantic; the same across all presets):**
- `--destructive`: red, errors, delete actions. It stays red.
- `--border`, `--input`, `--card`, `--popover`, `--foreground`, `--card-foreground`: neutrals.
- Status colors for success, warning and info (below).

## Status colors (palette classes, used sparingly and consistently)

For semantic states that *must* read the same way on every theme, pick ONE family per meaning
and use only that:

| Meaning | Use | Do not use |
|---|---|---|
| Error / destructive | `bg-destructive`, `text-destructive` | a raw red class for the destructive action |
| Success / paid / active | the green family (`bg-green-100 text-green-800`) | emerald (the standard is green, not emerald) |
| Warning / pending | the amber family (`bg-amber-100 text-amber-800`) | orange (the standard is amber, not orange) |
| Info | the blue family (`bg-blue-50 text-blue-700`), *only* for a clear info-state badge | sky |

If you are reaching for a blue class and it is NOT clearly an info-state badge, you are almost
certainly building brand UI and should use `bg-primary`.

## Token cheat sheet

| When you want... | Use | Do not use |
|---|---|---|
| Primary button background | `bg-primary` | `bg-blue-600`, `bg-indigo-600`, an arbitrary hex class |
| Primary button hover | `hover:bg-primary-hover` | `hover:bg-blue-700` |
| Primary button text | `text-primary-foreground` | `text-white` (works most of the time, breaks when a theme has a dark primary foreground) |
| Accent / highlight | `bg-accent` / `text-accent-foreground` | `bg-amber-300`, `bg-cyan-400` |
| Card background | `bg-card` | `bg-white` |
| Page background | `bg-background` | `bg-gray-50` |
| Subtle / disabled background | `bg-muted` | `bg-gray-100`, `bg-slate-100` |
| Subtle text | `text-muted-foreground` | `text-gray-500`, `text-slate-500` |
| Borders / dividers | `border-border` | `border-gray-200` |
| Focus ring | `ring-ring` (applied automatically by the primitives) | `ring-blue-500` |
| Sidebar / nav background | `bg-sidebar`, `bg-sidebar-primary` | anything hardcoded |

## Hard rules

**Never, in app code:**

```tsx
// A hardcoded hex literal in an inline style
<div style={{ backgroundColor: '#3B82F6' }} />

// An arbitrary-value class with a hex
<div className="bg-[#0f3460]" />

// A brand-leaking palette class
// (blue, indigo, sky, cyan, teal, purple, violet, fuchsia, pink, rose)
<button className="bg-blue-600 hover:bg-blue-700" />

// Hardcoded gray neutrals in the chrome
<div className="bg-gray-100 text-gray-500 border-gray-200" />
```

**Do instead:**

```tsx
// The shared Button already uses the primary token
<Button>Save</Button>

// A custom button, if you must build one
<button className="bg-primary text-primary-foreground hover:bg-primary-hover" />

// A card surface
<div className="bg-card border-border" />

// Subtle UI
<div className="bg-muted text-muted-foreground" />

// An inline style ONLY when the color comes from data (a user-picked tile color)
<div style={{ backgroundColor: person.tile_color }} />
```

## Edge cases (the gray area)

### User-picked colors stored in the database

A person's tile color, a status color, a custom-field color. These ARE hex literals, but they
live in the database and are user-controlled. The **fallback** for a missing value must NOT be a
hex literal:

```tsx
// Bad: the fallback is hardcoded and will not follow the theme
<div style={{ backgroundColor: status.color || '#3B82F6' }} />

// Good: the fallback is a token
<div style={{ backgroundColor: status.color || 'hsl(var(--primary))' }} />
// Or provide the fallback in the data layer, never in JSX.
```

### Color-picker palettes

The arrays of swatches users choose from are **intentional** hex literals. Keep them. But keep
them in ONE shared file, so the same twelve colors are not duplicated in three components.

### Email and HTML template colors: DO NOT TOUCH

**Email templates are a completely separate branding system from the app theme.** A business
chooses how its outgoing emails look to its own customers. That has nothing to do with how the
staff app looks internally. The two systems must never be coupled.

Hex literals in the files that build email HTML are intentional and customer-facing. Any
color-enforcement hook should carve those paths out explicitly. **Never migrate email-template
colors to app theme tokens.** If a business wants to change its email branding, that happens in
the email template editor, not by switching its app theme.

### Charts and data visualization

A chart with categorical series needs a discrete palette stored in ONE constant. That is a
different concern from the app's brand color: it is "make N series visually distinct". Define it
once, import it everywhere, and pick colors that work across every theme preset. Test on the
lightest and the darkest.

### Dark mode

Dark values live in the dark block of the global stylesheet. If theme presets define light values
only, any new dark-mode-aware UI needs the dark variant of any new token defined in that block.

## When you genuinely need a new themeable color

1. **Stop.** Do not add the hardcoded color.
2. Check whether `--primary`, `--accent`, `--muted`, `--card` or `--background` covers it. About
   95% of the time, one does.
3. If you truly need a new token (for example a chat-surface background), add it in EVERY place
   a token lives:
   - the global stylesheet, under the root block AND the dark block,
   - the styling config's color map,
   - each theme preset, if it should swing per preset (or leave it fixed if it should not),
   - the pre-paint script in the HTML shell, if it swings per preset (so there is no flash of
     the wrong color before the app loads).
4. Use the new token through its class.

This is the right amount of friction. Hardcoding should be more painful than tokenizing.

## If a hook blocks you and you think it is wrong

Read the edge cases above. If you still believe the hook is wrong:
- Do not disable the hook.
- Do not add an escape comment or reshape the code to evade it.
- Ask the owner. The hook is project-wide policy. Changing it is a deliberate decision, not a
  workaround.

---

# PART 2: TOOLTIPS

One global tooltip provider wraps the entire app, at the root. Therefore:

- **Never add another tooltip-provider element** anywhere. Nested providers produce inconsistent
  delays and duplicate context.
- **Never override the delay.** The global provider sets the standard.
- **Only set the tooltip's content.** Leave everything else at the defaults.

```tsx
// Standard tooltip
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

<Tooltip>
  <TooltipTrigger asChild>
    <button>Hover me</button>
  </TooltipTrigger>
  <TooltipContent>
    <p>Your help text here</p>
  </TooltipContent>
</Tooltip>
```

```tsx
// Help-icon tooltip: a question-mark icon with text, as one shared component
import { TooltipHelp } from '@/components/ui/tooltip-help';

<Label>SKU <TooltipHelp content="Stock Keeping Unit" /></Label>
```

- Use the shared help-icon component for "explain this field" text. Do not rebuild the icon plus
  tooltip by hand in each form.
- A tooltip is hover-only. On a phone there is no hover, so nothing essential may live ONLY in a
  tooltip.
- Do not hide ACTIONS behind hover (action icons that appear only when the row is hovered). They
  are invisible on touch and undiscoverable everywhere. Keep actions visible.

---

# PART 3: THE PAGE MAP (do not create a duplicate or orphaned page)

Every app needs a short, maintained map of its ACTUAL page structure. Without it, agents build a
new page for something that already has a home. That happened repeatedly in the app this came
from, and each time it left dead code and two places to maintain.

## What the map contains (fill in per repo)

**1. Main navigation pages.** One row each:

| Page | Route | File | What it is |
|---|---|---|---|
| (example) Catalog | `/catalog` | the catalog page component | Services, Products, Packages, Categories as tabs |
| (example) Team | `/team` | the team page component | Users, Time Clock, Payroll as tabs |
| (example) Setup | `/setup/...` | the location detail component | Company and location settings, main tabs plus sub-tabs |

**2. The canonical names.** The app uses ONE name per area. Write them down with the alternatives
that are NOT used, because agents invent synonyms:

- Catalog (not "Offerings")
- Team (not "Resources")
- Setup (not "Location Settings")
- Communications (not "Messaging")

A second name for the same area becomes a second page.

**3. Where settings live.** Settings for a feature are usually **NOT standalone pages**. They
are tabs or sub-tabs inside an existing page. Keep a table:

| Setting | Where it lives |
|---|---|
| (example) Booking rules | Setup > Booking Settings > Booking Rules |
| (example) Notifications | Setup > Notifications |
| (example) Payment processors | Integrations > Payment Processors |
| (example) Payroll settings | Team > Payroll (the settings icon in the tab) |

**4. Removed files, and what replaced them.** When a duplicate is deleted, record it:

| Deleted file | Replaced by | Reason |
|---|---|---|
| (example) an "Offerings" page | the Catalog page | Duplicate: same tabs |
| (example) a standalone "Booking Settings" page | the Setup page | Duplicate: these are sub-tabs in Setup |

This table stops the next agent from recreating the same duplicate under the same tempting name.

**5. Page-access keys**, if pages are gated per role. Every navigable page and tab needs one.
The naming convention and the multi-file rule are in `security-rls-permissions`, "Page Access".

## The mistakes this prevents

- Creating an "Offerings" page for products and services, when a Catalog page already has
  Services, Products, Packages and Categories tabs.
- Creating a "Resources" page for locations and staff, when Team has the staff and Setup has the
  locations.
- Creating a standalone settings page for a feature whose settings are sub-tabs of Setup.

## Before creating a new page

1. Check whether the functionality already exists in a page or tab.
2. Read the route table to see what pages exist.
3. Read the navigation component for the menu structure.
4. Read the page-access defaults for the keys.
5. If unsure, search the codebase for the feature's name AND its likely synonyms.
6. Ask whether the job needs a page at all (`build-with-the-user-in-mind`, Step Zero).

If it does need a new page, follow `url-structure` for its URL and update the map in the same
change.

---

# PART 4: LISTS AND PAGINATION

When adding pagination to any list that can hold unlimited or large data, use the repo's ONE
shared pagination hook (in the source app, a `usePagination` hook in the hooks folder).

**Do NOT create custom pagination logic.** Not a local page-state pair, not a hand-rolled slice,
not a second hook with a slightly different shape. If the shared hook lacks something you need,
extend it (and stop and ask if you are tempted not to: `working-agreements`, section 2.7).

Why it is a rule and not a preference: one implementation means one place to fix and one
behavior everywhere. Hand-added pagination state and logic, wired through a list's data source,
was part of the change set that white-screened a page in the incident behind the revert-first
rule (`debugging-discipline`). Which piece was guilty was never the point; the point is that a
list should not carry its own copy of this logic at all.

If the repo has no shared hook yet, the first paginated list is where you build it. Then every
later list uses it.

Related rules that live elsewhere, so a paginated list is actually correct:
- **A stable order.** Every `ORDER BY` ends with a unique tiebreaker, or a row can appear on two
  pages or on none (`query-efficiency`, Rule 8).
- **An index for the sort.** Keyset pagination needs a composite index that matches the exact
  ORDER BY (`nextjs-supabase-performance`, 3.4).
- **Totals are not computed from one page.** Any count, sum or export must read the full result
  set or aggregate on the server (`report-verification`, row-cap discipline).
- **The page-size cap still applies while searching.** An "All" page size combined with a search
  box once fetched up to 1,000 rows on every keystroke (`query-efficiency`, Rule 6).
- **Switching pages keeps the previous rows visible** until the next page arrives, instead of
  flashing a skeleton (`page-performance`, loading states).

---

## The checklist

- [ ] No hex literal, no brand palette class, no hardcoded gray in what I wrote?
- [ ] Status colors use the one standard family per meaning?
- [ ] Any fallback for a user-picked color is a token, not a hex?
- [ ] Email template colors untouched?
- [ ] A new token was added in every place tokens live, including the dark block?
- [ ] No new tooltip provider, no delay override, only content set?
- [ ] Nothing essential is hover-only?
- [ ] Before a new page: checked the page map, the routes and the nav for an existing home?
- [ ] Used the app's canonical name for the area?
- [ ] Updated the page map, including the removed-files table when I deleted a duplicate?
- [ ] Pagination uses the shared hook, with a stable order?

## Related

- `ui-ux-pro-max`: design quality.
- `mobile-view-optimization`: the phone bar.
- `page-performance`: rendering and loading states.
- `url-structure`: where a new page's URL goes.
- `working-agreements`: reuse before writing.
