---
name: standard-accessibility-wcag
description: Accessibility standard targeting WCAG 2.1 Level AA. Covers semantic HTML and ARIA landmarks, keyboard navigation and skip links, screen reader support with a visually hidden utility class, color contrast ratios, focus management in modals, accessible forms, media captions and transcripts, reduced motion, live regions, and a testing checklist. Read before building or changing any page, form, modal, dropdown, menu, tab set, table, icon-only button, status indicator, animation or live-updating view, and when the user says "accessibility", "a11y", "WCAG", "screen reader", "keyboard navigation", "focus ring", "contrast", "aria", "alt text" or "reduced motion".
---

# Standard 11 - Accessibility and WCAG Compliance

Baseline: WCAG 2.1 AA. Someone may use this product all day, by keyboard, on a poor screen, or
with a screen reader. None of this is optional polish.

Related skills: `standard-design-system` (focus, contrast and status tokens),
`standard-error-handling-ux` (accessible error and validation feedback),
`mobile-view-optimization` (touch targets and small screens), `ui-ux-pro-max` (UX guideline
lookups).

## Target: WCAG 2.1 Level AA

## 1. Semantic HTML & ARIA Landmarks
- Use semantic elements: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`, `<section>`, `<article>`
- Add `aria-label` to navigation elements: `<nav aria-label="Main navigation">`
- Use `aria-live="polite"` for dynamic content updates (notifications, AJAX results)
- `aria-expanded` for collapsible sections and dropdowns
- `aria-describedby` for form field help text
- `aria-hidden="true"` for decorative-only elements

## 2. Keyboard Navigation (Critical)
- ALL interactive elements must be keyboard accessible
- Tab order follows logical reading order (avoid `tabindex` > 0)
- Visible focus indicators on all focusable elements (minimum 2px outline)
- Skip-to-content link as the first focusable element on every page:
```html
<a href="#main-content" class="sr-only sr-only--focusable">Skip to content</a>
```
- Escape key closes modals and dropdowns
- Arrow keys for menu and tab navigation
- Enter/Space activates buttons and links

## 3. Screen Reader Support
- Descriptive `alt` text on all meaningful images
- Empty `alt=""` for decorative images
- Form `<label>` associated with every input (`for="id"` or wrapping)
- Error messages linked via `aria-describedby`
- Descriptive page `<title>` on every page
- Heading hierarchy: h1 > h2 > h3 (never skip levels)
- Link text describes destination (never "click here")
- Visually hidden text class for screen readers:
```css
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
.sr-only--focusable:focus {
    position: static;
    width: auto;
    height: auto;
    margin: 0;
    overflow: visible;
    clip: auto;
    white-space: normal;
}
```

## 4. Color Contrast
- Normal text: minimum **4.5:1** contrast ratio
- Large text (18px+ bold or 24px+): minimum **3:1** contrast ratio
- UI components and icons: minimum **3:1** contrast ratio
- Never use color as the ONLY indicator (add icons, underlines, or text labels)
- Test with browser DevTools contrast checker

## 5. Focus Management
- Custom focus styles matching the design system
- Focus trap within modals (tab doesn't escape the modal)
- Return focus to trigger element when modal closes
- Move focus to new content when dynamically loaded
- No focus loss during page interactions

## 6. Form Accessibility
- Every input has a visible `<label>`
- Required fields: visual indicator AND `aria-required="true"`
- Error messages: specific and helpful, linked to field via `aria-describedby`
- Validation errors announced to screen readers
- `autocomplete` attributes on appropriate fields (name, email, address)
- `<fieldset>` and `<legend>` for grouped inputs (radio buttons, checkboxes)

## 7. Media Accessibility
- Captions for all video content
- Transcripts for audio content
- No auto-playing media with sound
- Pause/stop controls for all animations

## 8. Motion & Animation
- Respect `prefers-reduced-motion` media query:
```css
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
}
```
- No content that flashes more than 3 times per second
- Provide option to reduce/disable animations

## Testing Checklist
- [ ] Navigate entire page with keyboard only (no mouse)
- [ ] Test with a screen reader (NVDA, JAWS, or VoiceOver)
- [ ] Run Lighthouse accessibility audit (target 90+)
- [ ] Check all color contrast ratios
- [ ] Verify focus indicators are visible
- [ ] Test at 200% browser zoom
- [ ] Test with high contrast mode
- [ ] Verify all images have appropriate alt text
- [ ] Verify all forms have labels and error handling

## Additional Must-Holds

From an operator-console project's copy of this standard:

- **Status is icon plus label, never color alone.** A colorblind user must be able to tell
  success, warning and danger apart without the hue. Use one canonical status component.
- **Never put the faintest text color on a tinted surface** for anything that must be read. Check
  each new color pairing, not just the base palette.
- **Real elements.** Use real `<button>`, `<a>` and `<label>` elements; give icon-only controls an
  `aria-label`; lists are lists; the primary navigation is `<nav aria-label="...">`; data tables
  use `<th>`.
- **No mouse-only affordances.** Anything reachable by hover or drag has a keyboard path.
- **Never remove a focus ring** without replacing it with an equal or better one.
- **Every animation has a reduced-motion path.** No unavoidable motion.
- **Live regions for live views.** A dashboard, board or feed that updates without a reload uses
  `aria-live="polite"` for the state changes a user relies on, without announcing every tick.
- **Form state reaches assistive tech.** Required and invalid states are conveyed
  programmatically, and errors are tied to their field and announced, not shown by color only.

## How to Check (and report)

Do a keyboard-only walkthrough of the surface, a contrast check on every new color pairing, and a
reduced-motion check. In your handoff, state exactly what you exercised. "It should be
accessible" is not a result.
