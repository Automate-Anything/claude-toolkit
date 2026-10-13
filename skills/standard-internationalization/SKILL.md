---
name: standard-internationalization
description: "Standard 23 of the engineering standards library: internationalization and localization. Covers never hardcoding user-facing text, translation file structure and key naming, i18n libraries by stack (React, Next.js, Vue, Django, Flask, Laravel, Spring, iOS, Android, React Native), RTL support with CSS logical properties, locale-aware date, time, number and currency formatting with the Intl APIs, pluralization rules, and the implementation checklist. Read it BEFORE adding any user-facing string to an app that is or may become multi-language, before building a language switcher, an RTL layout, or locale-aware formatting, and when the user says \"i18n\", \"l10n\", \"translate\", \"translation files\", \"multi-language\", \"locale\", \"RTL\", \"right to left\", \"Hebrew\", \"Arabic\", \"hreflang\", \"pluralization\", or \"currency formatting\"."
---

# Internationalization (i18n) and Localization (l10n)

## PHILOSOPHY
Build for one language. Structure for all languages. Even if your app starts in English only, the architecture should support adding any language without rewriting code.

## 1. CORE PRINCIPLES

### NEVER Hardcode User-Facing Text
```
BAD:  <h1>Welcome to our app</h1>
GOOD: <h1>{t('welcome.title')}</h1>

BAD:  alert("Error: invalid email");
GOOD: alert(t('errors.invalid_email'));

BAD:  $message = "Your order has been placed";
GOOD: $message = __('orders.placed');
```

### Separate Content from Code
- All user-facing strings live in translation files, not in source code
- Translation files are organized by locale: `en.json`, `he.json`, `es.json`, `fr.json`
- Keys are descriptive and hierarchical: `pages.home.hero.title`, `errors.auth.invalid_password`

## 2. TRANSLATION FILE STRUCTURE

```json
// locales/en.json
{
    "common": {
        "save": "Save",
        "cancel": "Cancel",
        "delete": "Delete",
        "loading": "Loading...",
        "error": "Something went wrong"
    },
    "auth": {
        "login": "Log In",
        "logout": "Log Out",
        "register": "Create Account",
        "forgot_password": "Forgot Password?"
    },
    "errors": {
        "required": "This field is required",
        "invalid_email": "Please enter a valid email address",
        "server_error": "An unexpected error occurred. Please try again."
    },
    "pages": {
        "home": {
            "title": "Welcome",
            "description": "Your app description here"
        }
    }
}
```

### Rules:
- Use flat or shallow-nested keys (max 3 levels)
- Group by feature/page, not by component
- Keep keys in English regardless of default language
- Include pluralization support where needed

## 3. i18n LIBRARIES BY STACK

### JavaScript / React
- `react-intl` (FormatJS) or `i18next` + `react-i18next`
- `next-intl` for Next.js
- `vue-i18n` for Vue

### Python
- Django: built-in `gettext` (`{% trans %}`, `_()`, `ugettext_lazy`)
- Flask: `Flask-Babel`
- FastAPI: custom middleware with `gettext` or `i18n` library

### PHP
- Laravel: built-in localization (`__()`, `@lang()`, `/lang` directory)
- Symfony: Translation component
- WordPress: `__()`, `_e()`, `.po/.mo` files

### Java
- Spring: `MessageSource` + `messages_xx.properties` files
- Android: `strings.xml` per locale

### Mobile
- iOS: `Localizable.strings` per locale
- Android: `res/values-xx/strings.xml`
- React Native: `i18next` + `react-i18next`

## 4. RTL (RIGHT-TO-LEFT) SUPPORT

For Hebrew, Arabic, Farsi, Urdu, and other RTL languages:

```html
<!-- Set direction on the HTML element -->
<html lang="he" dir="rtl">
```

```css
/* Use logical properties instead of physical */
/* BAD */
margin-left: 16px;
padding-right: 8px;
text-align: left;
float: left;

/* GOOD */
margin-inline-start: 16px;
padding-inline-end: 8px;
text-align: start;
/* Use flexbox/grid instead of float */
```

### RTL CSS Rules:
- Use `margin-inline-start/end` instead of `margin-left/right`
- Use `padding-inline-start/end` instead of `padding-left/right`
- Use `inset-inline-start/end` instead of `left/right`
- Use `border-inline-start/end` instead of `border-left/right`
- Use `text-align: start/end` instead of `left/right`
- Use Flexbox and Grid (they respect `dir` automatically)
- Mirror icons that have directional meaning (arrows, etc.)

## 5. DATE, TIME, NUMBER, CURRENCY FORMATTING

### NEVER format manually. Use Intl APIs or libraries:

```javascript
// Dates
new Intl.DateTimeFormat('en-US').format(date);  // 2/16/2026
new Intl.DateTimeFormat('de-DE').format(date);  // 16.2.2026
new Intl.DateTimeFormat('he-IL').format(date);  // 16.2.2026

// Numbers
new Intl.NumberFormat('en-US').format(1234567);  // 1,234,567
new Intl.NumberFormat('de-DE').format(1234567);  // 1.234.567

// Currency
new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(99.99);
// $99.99

new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(9999);
// JPY 9,999 (rendered with the yen sign)
```

### Rules:
- Store dates in UTC. Display in user's timezone.
- Store currency amounts as integers (cents) or DECIMAL. Never FLOAT.
- Display numbers, dates, and currency using locale-aware formatters.
- Never assume date format (MM/DD vs DD/MM vs YYYY-MM-DD).

## 6. PLURALIZATION

Different languages have different plural rules (English has 2 forms, Arabic has 6, Chinese has 1):

```json
// English
{ "items": { "one": "{{count}} item", "other": "{{count}} items" } }

// Russian (3 forms, transliterated here to keep this file plain ASCII)
{ "items": { "one": "{{count}} tovar", "few": "{{count}} tovara", "many": "{{count}} tovarov" } }
```

Use ICU MessageFormat or library-specific plural syntax. Never manually check `count === 1`.

## 7. IMPLEMENTATION CHECKLIST

- [ ] All user-facing strings extracted to translation files
- [ ] Translation files organized by locale
- [ ] i18n library configured with fallback language
- [ ] Date/time displayed in user's locale and timezone
- [ ] Numbers and currency formatted per locale
- [ ] RTL layout supported (if applicable)
- [ ] Pluralization handled correctly
- [ ] Language switcher in UI (if multi-language)
- [ ] `lang` attribute set on `<html>` tag
- [ ] Form validation messages are translated
- [ ] Email templates support multiple languages
- [ ] SEO: `hreflang` tags for multi-language pages

## IMPLEMENTATION REQUIREMENT
Structure for i18n from day one. Even if you ship in one language, all user-facing text must go through the translation system. Retrofitting i18n is 10x harder than building it in.

## RELATED SKILLS

- `standard-mobile-app-design`: RTL in React Native (I18nManager).
- `standard-accessibility-wcag`: the `lang` attribute and screen reader behavior.
- `seo`: hreflang and multi-language pages for search.
