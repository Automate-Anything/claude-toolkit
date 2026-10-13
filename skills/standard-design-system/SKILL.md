---
name: standard-design-system
description: Template for building a consistent design system in any project. Covers color tokens and the 60-30-10 rule, typography scale, spacing scale, radius and shadow tokens, layout patterns, component patterns (buttons, forms, cards, tables, badges, alerts, modals, empty and loading states), transition tokens, dark mode structure, responsive breakpoints, accessibility in design, and token discipline laws. Read before starting the UI of a new project, before creating or changing design tokens, CSS variables or a Tailwind theme, before building a new shared component, before hardcoding any color, size, radius or spacing value, and when the user says "set up a design system", "define the tokens", "the UI is inconsistent", "add dark mode", "create a component library" or "what color should this be". For choosing the actual style, palette and fonts use ui-ux-pro-max.
---

# Standard 09 - Design System Template

This standard defines the STRUCTURE of a design system: which tokens exist, how components are
specified, and the discipline that keeps a UI consistent. It does not pick the look.

Related skills: `ui-ux-pro-max` (choosing styles, palettes, font pairings and UX guidelines; use
it to fill in the values below), `mobile-view-optimization` (making screens good on a phone),
`standard-accessibility-wcag` (the accessibility bar), `standard-assets-organization` (where the
token file lives), and the motion skills (`motion-design`, `ui-animation`) for anything beyond
functional transitions.

## Purpose
Every project needs a design system, even a small one. This file defines HOW to build one. Customize the values per project, but always follow this structure.

---

## 1. Color Palette

### Define These Categories:
```css
:root {
    /* Brand Colors - customize per project */
    --primary: #______;           /* Main brand color - buttons, links, active states */
    --primary-light: #______;     /* Hover highlights, light accents */
    --primary-dark: #______;      /* Button hover, pressed states */
    --accent: #______;            /* Secondary brand color */

    /* Backgrounds */
    --bg-body: #______;           /* Page background */
    --bg-surface: #FFFFFF;        /* Cards, panels, modals */
    --bg-hover: #______;          /* Hover state backgrounds */
    --bg-active: #______;         /* Active/selected items */
    --bg-muted: #______;          /* Disabled, muted areas */

    /* Text */
    --text-primary: #______;      /* Main body text */
    --text-secondary: #______;    /* Secondary/muted text */
    --text-placeholder: #______;  /* Input placeholders */
    --text-inverse: #FFFFFF;      /* Text on dark backgrounds */

    /* Borders */
    --border: #______;            /* Default borders */
    --border-light: #______;      /* Subtle borders */
    --border-focus: #______;      /* Focus ring color (usually matches --primary) */

    /* Status Colors - use natural expectations */
    --success: #16A34A;           /* Green - active, complete, confirmed */
    --success-bg: #F0FDF4;
    --error: #DC2626;             /* Red - error, danger, delete */
    --error-bg: #FEF2F2;
    --warning: #D97706;           /* Amber - pending, caution */
    --warning-bg: #FFFBEB;
    --info: #0EA5E9;              /* Blue - informational, notice */
    --info-bg: #F0F9FF;
}
```

### Rules:
- NEVER hardcode colors. Always use CSS variables.
- Status colors must match user expectations (green = good, red = bad, yellow = caution, blue = info).
- Apply the 60-30-10 rule: 60% dominant (backgrounds), 30% secondary (surfaces, text), 10% accent (CTAs, highlights).

---

## 2. Typography

### Define These Properties:
```css
:root {
    /* Font Family - choose distinctive, characterful fonts */
    --font-primary: 'Your Display Font', sans-serif;
    --font-body: 'Your Body Font', sans-serif;
    --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

    /* Font Sizes - create clear hierarchy */
    --text-xs: 0.75rem;     /* 12px - small labels, captions, badges */
    --text-sm: 0.875rem;    /* 14px - secondary text, metadata */
    --text-base: 1rem;      /* 16px - body text */
    --text-lg: 1.125rem;    /* 18px - large body, card titles */
    --text-xl: 1.25rem;     /* 20px - section headers */
    --text-2xl: 1.5rem;     /* 24px - page titles */
    --text-3xl: 1.875rem;   /* 30px - hero subheadings */
    --text-4xl: 2.25rem;    /* 36px - hero headings */
    --text-5xl: 3rem;       /* 48px - display text */

    /* Font Weights */
    --font-normal: 400;
    --font-medium: 500;
    --font-semibold: 600;
    --font-bold: 700;

    /* Line Heights */
    --leading-tight: 1.25;
    --leading-normal: 1.5;
    --leading-relaxed: 1.75;
}
```

### Rules:
- Load only the weights you use (typically 400, 500, 600, maybe 700).
- Body text: minimum 16px for readability. Never smaller for main content.
- Create dramatic scale contrast between headings and body for visual hierarchy.
- Consider fonts like: Clash Display, Cabinet Grotesk, Satoshi, Outfit, Plus Jakarta Sans, Space Grotesk, General Sans, Syne, Instrument Serif, Playfair Display. BUT vary your choices across projects.

---

## 3. Spacing

### Consistent Scale:
```css
:root {
    --space-1: 0.25rem;    /* 4px */
    --space-2: 0.5rem;     /* 8px */
    --space-3: 0.75rem;    /* 12px */
    --space-4: 1rem;       /* 16px */
    --space-5: 1.25rem;    /* 20px */
    --space-6: 1.5rem;     /* 24px */
    --space-8: 2rem;       /* 32px */
    --space-10: 2.5rem;    /* 40px */
    --space-12: 3rem;      /* 48px */
    --space-16: 4rem;      /* 64px */
}
```

### Rules:
- Use spacing variables, never arbitrary pixel values.
- Be consistent: if card padding is --space-4 on one page, it is --space-4 on every page.
- Spacing creates hierarchy: more space between unrelated groups, less space between related items.

---

## 4. Borders & Shadows

```css
:root {
    /* Border Radius */
    --radius-sm: 4px;       /* Small elements (badges, tags) */
    --radius-md: 8px;       /* Most elements (buttons, inputs) */
    --radius-lg: 12px;      /* Cards, modals, containers */
    --radius-xl: 16px;      /* Large cards, hero sections */
    --radius-full: 9999px;  /* Pills, avatars, circular badges */

    /* Shadows */
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
    --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
    --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.1);
}
```

### Rules:
- All interactive elements have rounded corners.
- Shadows are subtle for light themes, barely visible for dark themes.
- Borders are light, not heavy or dark.

---

## 5. Layout Patterns

### Common Application Layouts:
- **Sidebar + Main Content**: Fixed sidebar (200-280px), sticky header (48-64px), scrollable main area.
- **Top Nav + Content**: Full-width top navigation, content below.
- **Full-Bleed Sections**: Full-width alternating sections for marketing/landing pages.
- **Dashboard Grid**: CSS Grid with cards, charts, and data tables.

### Rules:
- Use CSS Grid for 2D layouts, Flexbox for 1D alignment.
- Define max-width for content (typically 1200-1440px).
- On mobile (< 768px): stack everything vertically, sidebar becomes a slide-out drawer or bottom nav.
- Always set min-height: 100vh on the app wrapper.

---

## 6. Component Patterns

### Buttons
- Define sizes: small, default, large
- Define variants: primary, secondary, ghost, danger, outline
- All buttons get: hover state, active state, focus ring, disabled state
- Include icon support (icon-only, icon + text)
- Compact by default. Never oversized unless it is the primary CTA.

### Forms
- Every input has a visible label
- Define focus state: colored border + subtle box-shadow
- Error state: red border + error message below the field
- Consistent padding, font size, border radius across all form elements
- Form groups have consistent vertical spacing

### Cards
- Surface background + subtle border or shadow
- Consistent padding (use spacing scale)
- Optional: header row (title + action), body, footer
- Hover effect for clickable cards (lift + shadow increase)

### Tables
- Full width, clean borders
- Header: muted background, smaller/uppercase text
- Alternating row colors or hover highlight
- Wrap in overflow container for horizontal scroll on mobile

### Badges / Tags
- Pill shape (full border-radius)
- Small text, compact padding
- Variants matching status colors: success, error, warning, info, neutral

### Alerts / Notifications
- Icon + text layout
- Colored border or background matching severity
- Variants: success, error, warning, info
- Dismissable when appropriate

### Modals
- Overlay backdrop (dark, semi-transparent)
- Centered card with header, body, footer
- Focus trap (tab key stays inside modal)
- Escape key and backdrop click to close
- Max-width: 420-560px for standard modals

### Empty States
- Centered layout with icon, message, and optional action button
- Friendly, helpful messaging ("No results found. Try a different search.")

### Loading States
- Skeleton screens preferred over spinners for content areas
- Button loading: disable + show spinner + change text ("Saving...")
- Page/section loading: skeleton placeholder matching content shape

---

## 7. Transitions & Animation

```css
:root {
    --transition-fast: 0.15s ease;
    --transition-normal: 0.25s ease;
    --transition-slow: 0.4s ease;
}
```

### What Gets Transitions:
- Hover states (background, color, border, shadow)
- Focus states (border, box-shadow)
- Sidebar/drawer open/close
- Modal fade in/out
- Dropdown expand/collapse

### Rules:
- Keep transitions functional, not decorative
- Respect `prefers-reduced-motion: reduce` (set all durations to near-zero)
- Maximum transition duration: 0.4s for UI elements
- Never add animation delays on interactive elements
- For scroll-driven and cinematic animations, use a dedicated animation library such as GSAP, and read the toolkit's motion skills (`motion-design`, `ui-animation`) first

---

## 8. Dark Mode Support

Structure your CSS variables to support theme switching:
```css
:root, [data-theme="light"] {
    --bg-body: #FFFFFF;
    --bg-surface: #F8FAFC;
    --text-primary: #1E293B;
    --border: #E2E8F0;
}

[data-theme="dark"] {
    --bg-body: #0F172A;
    --bg-surface: #1E293B;
    --text-primary: #E2E8F0;
    --border: #334155;
}

@media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
        --bg-body: #0F172A;
        --text-primary: #E2E8F0;
    }
}
```

### Rules:
- Brand colors (--primary, --accent) typically stay the same in both themes
- Never use pure black (#000000) for dark mode backgrounds. Use rich darks (navy, slate, charcoal).
- Test contrast ratios in both themes.

---

## 9. Responsive Breakpoints

```css
/* Mobile-first approach */
/* Base styles = mobile (320px+) */

@media (min-width: 480px)  { /* Small phones landscape */ }
@media (min-width: 640px)  { /* Large phones */ }
@media (min-width: 768px)  { /* Tablets */ }
@media (min-width: 1024px) { /* Desktops */ }
@media (min-width: 1280px) { /* Large desktops */ }
@media (min-width: 1536px) { /* Ultra-wide */ }
```

### Rules:
- Design mobile-first, enhance upward
- Sidebar hides on mobile (< 768px), toggled by hamburger button
- Tables get horizontal scroll wrapper on mobile
- Touch targets: minimum 44x44px on mobile
- No content should overflow or be cut off at any screen size

---

## 10. Accessibility in Design

- Focus indicators: visible outline/ring on all focusable elements
- Color contrast: minimum 4.5:1 for normal text, 3:1 for large text
- Never use color alone to convey meaning (always include icon or text)
- All interactive elements have hover AND focus states
- prefers-reduced-motion: respected globally

---

## How to Use This Template
1. Define your project's brand colors, fonts, and personality first
2. Fill in the CSS variable values above
3. Build a design-system.css (or equivalent for your framework) with all tokens
4. Every component references these tokens. No magic numbers.
5. New pages/features extend the design system. They never override it.

## Token Discipline Laws

These come from a production project's copy of this standard ("tokens are law"). They are what
keeps a design system from eroding once it exists.

1. **Tokens only.** Use the semantic token or utility class, never a raw hex value and never an
   arbitrary one-off value in a component (for example no `bg-[#c2410c]`, no inline
   `color: #78716c`). If a value is missing, add a token to the token file and the theme mapping;
   do not inline it.
2. **Name tokens by role, not by literal color.** Define semantic roles and use them
   consistently:

   | Role | Example tokens | Use for |
   |---|---|---|
   | Action (brand accent) | `action`, `action-hover`, `action-tint` | the ONE acting control on a view, plus the active navigation item |
   | Secondary | a second brand scale | links, key figures, live signals |
   | Surfaces | `paper` (app background), `surface`, `surface-tint` (cards) | backgrounds, never text |
   | Ink | `ink`, `ink-muted`, `ink-faint` | text, in descending emphasis |
   | Border | `border`, `border-strong` | hairlines and stronger dividers |
   | Status | `status-success`, `status-warning`, `status-danger`, each with fg and bg | semantic state only, a scale of its own |

3. **The accent law.** The action color marks the acting control (primary button, active tab
   underline) and the active navigation item, and nothing else. If two unrelated things on a
   screen wear the accent, one of them is wrong.
4. **Status never wears brand.** Success, warning and danger use the status scale, not the brand
   accent or the secondary color. Status is always icon plus label, never color alone. Build one
   canonical status component (a status pill) and use it everywhere.
5. **Radius and spacing come from tokens too.** Do not hardcode radii or paddings.
6. **Shared primitives before bespoke.** Reuse the existing Button, TextField, DataTable,
   EmptyState, error panel, StatusPill, SegmentedControl and PageHeader (or this project's
   equivalents). A new one-off component that duplicates an existing primitive is a review
   finding.
7. **Keep the variable indirection intact.** Colors are CSS variables so that light and dark
   themes and per-customer theming stay possible. Never hardcode a value that a theme would need
   to override.
