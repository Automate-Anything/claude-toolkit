# Theme adaptation - match the HOST app, never a fixed theme

The #1 failure mode of a ported feature is that it looks pasted-in. The ticketing
UI must look like it was always part of THIS app. Discover the app's design
system in Phase 1 and bind everything to it.

## Discover (before writing any component)

1. **Tokens** - find the source of truth for color, spacing, radius, typography.
   Look for CSS custom properties (`--...`), a Tailwind `theme.extend`, a theme
   object, or a design-tokens file. Note the exact token NAMES for: surfaces/
   backgrounds, text (primary/secondary/muted), borders, the brand/primary color,
   and status colors (success/warning/danger/info/neutral).
2. **Light/dark** - how does the app switch themes (a `data-theme` attribute, a
   `.dark` class, `prefers-color-scheme`)? Your components must respond the same
   way with zero extra work - i.e. use the tokens, don't hardcode. **If the app
   is single-theme (light-only or dark-only), that's fine** - skip the dual-theme
   work, but still centralize colors as tokens so a future theme is a palette swap.
3. **Shared UI kit** - locate existing Button, Badge/Pill, Modal/Dialog, Table/
   DataGrid, Menu/Dropdown, Input/Select/Textarea, Card, EmptyState, Toast,
   Avatar. REUSE them. Read their real props before using them.
4. **Status → color mapping** - if the app has a central status-to-tone map
   (badges read from it), ADD the ticket statuses there instead of inventing
   colors. Many design systems expose a small fixed tone set (e.g. success/
   warning/danger/info/neutral); map the 8 ticket statuses onto it, and rely on
   the label + an icon to disambiguate states that share a tone (status is never
   color-only).
5. **Typography** - if the app uses a specific font for record numbers / IDs /
   money (often monospace), render `TKT-#####` in that same treatment.
6. **Motion** - match the app's transition durations/easing and honor
   `prefers-reduced-motion`.

## Bind (while writing)

- Every color/spacing/type value comes from a token. Zero raw hex, zero magic px
  where the app uses a scale. Label colors map to token classes, not hex.
- Reuse the kit's components; only build a new primitive if the app truly lacks
  it, and then build it in the app's style.
- If the app has a `frontend-design`-style visual pass or component guidelines,
  apply them.

## Verify

If the app supports both themes, toggle them: the ticket board, list, and detail
must both look correct with no hardcoded colors bleeding through. (Single-theme
app: just verify that one theme.) Check the standard breakpoints (~320 / 768 /
1024 / 1280): dense and usable on mobile, no horizontal scroll, tap targets ≥ 44px.

## Anti-patterns

- Importing the origin app's palette/tokens/`globals.css`.
- A "tickets.css" with its own colors instead of the app's tokens.
- New buttons/badges that don't match the app's existing ones.
- Status colors chosen freehand instead of via the app's tone system.
