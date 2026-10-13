---
name: standard-assets-organization
description: Standard for organizing CSS, JavaScript, images and fonts in any web project. Covers the assets directory structure for server-rendered and component-based projects, a CSS design token and reset baseline, BEM naming, vanilla JS app structure, asset loading order, cache busting, asset optimization and dark mode token preparation. Read before creating or moving any stylesheet, script, image or font folder, before adding a new CSS file or global style, before writing inline styles or inline script tags, and when the user says "organize the assets", "clean up the CSS", "where should this stylesheet go", "set up the CSS architecture", "cache busting" or "asset loading order".
---

# Standard 03 - Global Assets Organization

Clean, predictable structure for CSS, JavaScript and design assets.

Related skills: `standard-design-system` (the full token and component template that the CSS
baseline here is a short form of), `standard-project-organization` (overall folder layout),
`standard-performance-optimization` (budgets and caching headers), `ui-ux-pro-max` (choosing the
actual palette, fonts and style).

## Mandatory Rule
All CSS, JavaScript, and design assets MUST follow a consistent, organized structure. No scattered files. No inline styles in production (except critical CSS). No script tags with raw code in HTML templates.

## 1. Directory Structure

### For Server-Rendered Projects (PHP, Django, Rails, Spring)
```
assets/ (or public/ or static/)
|-- css/
|   |-- design-system.css     # Design tokens, variables, reset
|   |-- global.css            # Global styles, typography, base elements
|   |-- components.css        # Reusable component styles
|   |-- utilities.css         # Utility classes (.flex, .hidden, .text-center)
|   +-- pages/                # Page-specific styles (only when needed)
|-- js/
|   |-- app.js                # Main application entry point
|   |-- components.js         # Interactive component logic
|   |-- utils.js              # Helper functions
|   +-- modules/              # Feature-specific modules
|-- images/
|   |-- icons/
|   |-- backgrounds/
|   +-- content/
+-- fonts/                    # Self-hosted fonts (if not using CDN)
```

### For Component-Based Projects (React, Vue, Svelte, Angular)
```
src/
|-- styles/
|   |-- globals.css           # CSS variables, reset, base styles
|   |-- tokens.css            # Design tokens only
|   +-- utilities.css         # Global utility classes
|-- components/
|   |-- Button/
|   |   |-- Button.tsx        # Component code
|   |   |-- Button.module.css # Component-scoped styles (CSS Modules)
|   |   +-- Button.test.tsx   # Component tests
|   +-- Card/
|       |-- Card.tsx
|       +-- Card.module.css
+-- assets/
    |-- images/
    |-- icons/
    +-- fonts/
```

## 2. CSS Design System (Mandatory for All Projects)

```css
/* design-system.css or globals.css - ALWAYS the first CSS file loaded */

/* CSS Custom Properties (Design Tokens) */
:root {
    /* Colors - customize per project */
    --primary: #______;
    --secondary: #______;
    --accent: #______;
    --success: #28a745;
    --danger: #dc3545;
    --warning: #ffc107;
    --info: #17a2b8;

    /* Backgrounds */
    --bg-body: #______;
    --bg-surface: #FFFFFF;

    /* Text */
    --text-primary: #______;
    --text-secondary: #______;

    /* Typography */
    --font-primary: 'Your Font', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
    --text-base: 1rem;
    --text-sm: 0.875rem;
    --text-lg: 1.125rem;
    --leading-normal: 1.5;

    /* Spacing */
    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1rem;
    --space-6: 1.5rem;
    --space-8: 2rem;

    /* Borders & Radius */
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --border-color: #E2E8F0;

    /* Shadows */
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
    --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);

    /* Transitions */
    --transition-fast: 0.15s ease;
    --transition-normal: 0.25s ease;
}

/* Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 100%; scroll-behavior: smooth; }
body {
    font-family: var(--font-primary);
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    color: var(--text-primary);
    background-color: var(--bg-body);
}
img { max-width: 100%; height: auto; display: block; }
a { color: var(--primary); text-decoration: none; transition: color var(--transition-fast); }
a:hover { text-decoration: underline; }
```

## 3. CSS Methodology: BEM
```css
/* Block__Element--Modifier */
.card { }                    /* Block */
.card__title { }             /* Element */
.card__title--large { }      /* Modifier */
.btn { }
.btn--primary { }
.btn--disabled { }

/* Rules:
   - Block = reusable component
   - Element = part of a block (double underscore)
   - Modifier = variation (double dash)
   - Never nest deeper than .block__element--modifier
*/
```

For component-based frameworks (React, Vue), use CSS Modules, styled-components, or Tailwind instead of BEM.

## 4. JavaScript Structure

### Vanilla JS (Server-Rendered Projects)
```javascript
// app.js - Main entry point
const App = {
    config: { apiUrl: '/api/', timeout: 5000 },

    init() {
        this.bindEvents();
        this.initComponents();
    },

    bindEvents() {
        document.addEventListener('DOMContentLoaded', () => {
            this.handleForms();
            this.handleNavigation();
        });
    },

    // Utility: Debounce
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    },

    // Notification system
    notify(message, type = 'info') {
        // Create and show notification element
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
```

### Component-Based (React, Vue, etc.)
- Follow framework conventions (hooks, composables, services)
- Keep API calls in a dedicated `services/` or `api/` folder
- Use state management patterns appropriate to the framework

## 5. Asset Loading Strategy

### Loading Order (Critical for Performance)
```html
<!-- 1. Preload critical assets -->
<link rel="preload" href="/assets/css/design-system.css" as="style">
<link rel="preload" href="/assets/fonts/your-font.woff2" as="font" type="font/woff2" crossorigin>

<!-- 2. Critical CSS (inline in <head> for above-the-fold content) -->
<style>/* Minimal critical styles */</style>

<!-- 3. External stylesheets -->
<link rel="stylesheet" href="/assets/css/design-system.css">
<link rel="stylesheet" href="/assets/css/global.css">
<link rel="stylesheet" href="/assets/css/components.css">

<!-- 4. JavaScript (deferred) -->
<script defer src="/assets/js/app.js"></script>
```

### For Bundled Projects (Vite, Webpack, esbuild)
- Let the bundler handle code splitting and asset optimization
- Use dynamic imports for route-level code splitting
- Tree-shake unused code automatically

## 6. Cache Busting
- **Bundlers**: Automatic hash in filenames (e.g., `app.3f2a1b.js`)
- **Server-Rendered**: Append file modification time or version hash as query parameter
- **CDN**: Set appropriate Cache-Control headers with versioned filenames

## 7. Asset Optimization
- CSS: Minified in production (PostCSS, cssnano, or bundler)
- JavaScript: Minified, tree-shaken, code-split (Vite, esbuild, Terser)
- Images: WebP format with fallbacks, responsive sizes via srcset, lazy-loaded
- Fonts: Subset to used characters, preloaded, use `font-display: swap`
- Icons: SVG sprite system, icon components, or a single icon library

## 8. Dark Mode Preparation
```css
:root, [data-theme="light"] {
    --bg-body: #ffffff;
    --bg-surface: #f8f9fa;
    --text-primary: #1e293b;
    --text-secondary: #64748b;
}

[data-theme="dark"] {
    --bg-body: #0f172a;
    --bg-surface: #1e293b;
    --text-primary: #e2e8f0;
    --text-secondary: #94a3b8;
}

@media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
        --bg-body: #0f172a;
        --text-primary: #e2e8f0;
    }
}
```

## Rules
1. Every page uses the global design system. No inline styles except critical CSS.
2. Design tokens (CSS variables) are the single source of truth for all visual values.
3. New pages/components extend the design system. They NEVER override it.
4. Page-specific CSS is only for truly unique layouts, not for overriding component styles.
5. Keep it clean, organized, and maintainable. If you can not explain the file structure in 30 seconds, it is too complex.
