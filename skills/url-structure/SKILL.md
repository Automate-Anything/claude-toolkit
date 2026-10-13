---
name: url-structure
description: The owner's standard for ALL routing, navigation and URL work, in any stack (a React SPA with a client router, a Next.js App Router app, or a plain server that serves one HTML file per page). Read it BEFORE adding or changing any route, page, tab, sub-tab, query parameter, redirect, entity-detail page, deep link, or URL-synced dialog; before deciding whether something is a page or a dialog; before renaming or moving a URL; and whenever a new page needs a URL. It defines the golden rules (the entity id goes LAST, a tab is ALWAYS part of the path and never a query param, the default tab is explicit, query params are for filters and dialog state, any view worth returning to must be reachable by URL alone), the three URL types for a scope such as a location or workspace (scope-in-path, scope-as-query-param, scope-free), slug encoding, the dialog versus full-page decision, the saved-preference plus URL interaction, the legacy-redirect rules (including redirects that must translate an id), and the complete change checklist. It also requires a per-repo URL reference section that MUST be updated on every URL change. Use when the owner mentions routes, routing, URLs, navigation, tabs, sub-tabs, query params, redirects, slugs, deep links, breadcrumbs, "make it shareable", "the back button", or "where should this page live".
---

# URL Structure

> ## Adapt before use
> Section 1 (principles) holds in any framework and is the owner's standing decision. Sections 2
> and 3 describe how a repo SHOULD record and implement its URLs. The route names, file names
> and constants below (`/contacts/...`, a `NAV_URLS` object, a central route table) are EXAMPLES
> of the shape, not real paths in this repo. Before citing one, grep the repo. Once the repo has
> real routes, fill in Section 2 with the real URL list and replace the example file names in
> Section 3 with the real ones. Where a principle and the repo's stack genuinely conflict (for
> example a no-framework app with no client router), the repo's reality wins: do not add a
> router to satisfy a principle.

**This document has three sections:**
1. **Principles**: why URLs are shaped this way.
2. **URL reference**: the complete list of this repo's URLs (a template until filled in).
3. **Implementation**: how to add or change a URL without leaving anything broken.

---

# SECTION 1: PRINCIPLES

A URL is not an address. It is **the only piece of app state a user can save, share, reload, or
come back to tomorrow.** Everything below follows from that.

## The core rules

1. **No tenant id in the URL.** A user is always logged into their own account or company.
   Derive it from the session, never from the path.
2. **Human-readable, never opaque ids, where a readable name exists.** `/setup/locations/
   downtown-branch` beats a UUID. A person should be able to read a URL and know where they are.
   It also makes logs and error reports legible.
3. **The entity id goes LAST.** `/contacts/bookings/{contactId}`, not
   `/contacts/{contactId}/bookings`.
4. **A tab is ALWAYS part of the path, never a query param.** `/catalog/services`, not
   `/catalog?tab=services`.
5. **The default tab is explicit in the URL.** When linking to an entity, include the tab even
   when it is the default.
6. **Query params are for filters and dialog state.** `?location=X`, `?user={id}`,
   `?displayMode=calendar`.
7. **Dialogs that hold real content sync with the URL.** Opening and closing them updates the
   URL, so the view is shareable and the back button closes it.
8. **Any view worth returning to must be reachable by URL alone.** If a user can get somewhere
   by clicking, they should be able to get back by pasting.

## Why the id goes last

`/dataset/chunks/set-3`, not `/dataset/set-3/chunks`.

- The stable, greppable prefix comes first; the variable part is the tail.
- Routes are scannable and prefix-matchable.
- It stays consistent when a page gains a second tab or a sub-tab later:
  `/contacts/communications/sms/{id}` works naturally.
- One pattern across every entity type, so nobody has to remember which entity does it which way.

## Why a tab is a path

A tab is a different view, not a filter on one view. Paths are what people bookmark and what a
"send me that page" link has to survive.

The test for path versus query param: **would a user consider this a different page?** Different
page means path. Same page, different slice means query param.

**The default tab is explicit** because a default changes. `/library/datasets` beats `/library`
relying on a default that someone will reorder next month.

## The golden rule for entity detail pages

When viewing a specific entity (a contact, a product, a team member) that has tabs:

```
/{section}/{tab}/{subTab?}/{entityId}
```

- The tab is ALWAYS in the path, even the default tab.
- The entity id is ALWAYS at the END.
- Clicking an entity in a list navigates to `/{section}/{defaultTab}/{entityId}`.
- Clicking a tab navigates to `/{section}/{newTab}/{entityId}`.

Example:

```
Click a contact in the list   -> /contacts/history/{contactId}      (default tab explicit)
Click the "Bookings" tab      -> /contacts/bookings/{contactId}
Click the "SMS" sub-tab       -> /contacts/communications/sms/{contactId}
```

## The three URL types for a scope (location, workspace, branch, project)

Most multi-location or multi-workspace apps have a global scope picker. Every page relates to
that scope in exactly one of three ways, and the URL shape follows.

### Type 1: the scope IS the entity (scope in the PATH)

- **When:** editing one specific location's own configuration.
- **Pattern:** `/setup/{tab}/{scope-slug}`
- **Logic:** the location is the thing being configured, so it belongs in the path.
- **Picker behavior:** changing the picker NAVIGATES to the new URL.

### Type 2: the scope is a FILTER (scope as a QUERY PARAM)

- **When:** the page shows data that can be filtered by location, and also works without the
  filter (shows everything).
- **Pattern:** `/{page}?location={scope-slug}` or `/{page}/{tab}?location={scope-slug}`
- **Logic:** the location is a filter on the data, not the entity itself.
- **Picker behavior:** changing the picker updates the query param and does not navigate away.

### Type 3: scope-free (NO scope in the URL)

- **When:** the data is account-wide and the location is irrelevant to the content.
- **Pattern:** `/{page}` or `/{page}/{tab}/{subTab?}/{id}` (id still at the end).
- **Picker behavior:** changing the picker updates the saved preference only and does not touch
  the URL.

Decide the type BEFORE you write the route. A page built as the wrong type is the most common
cause of "the picker does nothing here" and "the link opened the wrong location".

## Query parameters: when and why

### 1. Entity dialogs (overlays)

```
/team/users?user=123        -> the user list with the edit dialog open
/team/users?newUser=true    -> the user list with the add dialog open
/bookings?booking=456       -> bookings with the booking editor open
```

Why a query param for a dialog:
- The underlying page is still visible and relevant.
- Closing the dialog returns to the same path.
- Direct links work.
- The browser back button closes the dialog naturally.

### 2. Filters and view state

```
?location=downtown-branch   -> filter by location
?type=service               -> filter by category type
?displayMode=calendar       -> change display mode
?viewMode=week              -> change the calendar view
?view=route                 -> an alternate rendering of the same list
```

Why a query param for a filter:
- A filter does not change the page's identity. Same page, different view of the data.
- Easy to add and remove without changing the path.
- Several can combine.

### 3. One-shot "open this" params

A param whose only job is to trigger something on arrival (`?edit={id}` opens that item's
editor; `?call={id}` expands and scrolls to that row) should be **consumed**: act on it, then
strip it from the URL, so a reload does not re-trigger it. A **stale** id (deleted, or belonging
to another scope) is stripped automatically instead of leaving a broken empty dialog.

### Anchors

A `#fragment` is fine for an on-page section that is not worth its own route. Five small related
items that share one narrative live on one page with anchors, not five thin routes. Promote an
anchor to its own page only when it grows its own data, call to action, or story.

## Dialog or full page?

| Criteria | Dialog (query param) | Full page (path) |
|---|---|---|
| **Tabs needed?** | No | Yes |
| **Form complexity** | Simple | Complex |
| **Return to the list after?** | Yes | Not necessarily |
| **Is the page behind it still relevant?** | Yes | No |
| **Worth bookmarking, or opening two side by side?** | No | Yes |

- **Dialog:** a focused action, done and dismissed, where the context behind it matters:
  confirm, rename, quick edit.
- **Full page:** anything with its own data, tabs, or a job that takes a while; anything worth
  bookmarking; anything you would open in a second tab to compare.
- **When in doubt: if you would ever want two of them open side by side, it is a page.**
- **The hybrid is legitimate.** A side sheet for the quick edit (`/team/users?user=123`) AND a
  full page for the in-depth edit (`/team/users/details/123`). Use it deliberately and use the
  same hybrid shape everywhere it appears.

A dialog that cannot be linked to is a dead end: the owner cannot send it to himself, cannot
reload without losing his place, and cannot bookmark the thing he checks daily.

## Slug encoding

Names become URL-safe slugs with one shared function. Never hand-roll it per page.

```typescript
// "Downtown Branch" -> "downtown-branch"
function encodeSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // spaces to hyphens
    .replace(/[^a-z0-9-]/g, '')     // remove special characters
    .replace(/-+/g, '-')            // collapse repeated hyphens
    .replace(/^-|-$/g, '');         // trim hyphens from the ends
}
```

Decide up front what happens when two names produce the same slug, and when a name is entirely
non-Latin and the slug comes out empty. Both happen in real data.

## Saved preference + URL interaction

For a scope the user picks once and expects to stick (the location picker), the saved preference
(for example in localStorage) and the URL each have one job.

1. **The saved preference is only updated by the picker.** Never from URL navigation.
2. **The URL takes precedence for display.** Show what the URL says.
3. **The saved preference provides the default** when the URL has no scope.
4. **One global preference**, the same across all pages.

```
User visits /bookings (no location param)
  - read the saved preference: "downtown-branch"
  - update the URL: /bookings?location=downtown-branch
  - display: Downtown Branch bookings

User opens a shared link /bookings?location=uptown-branch
  - display: Uptown Branch (from the URL)
  - saved preference: UNCHANGED (still downtown-branch)
  - if they navigate away and back, it reverts to their own default
```

Related cases, each of which needs a decision written into Section 2:
- **A per-visit "show all" toggle** that widens the scope with NO URL param and is never
  persisted. Legitimate, but say so, or the next agent "fixes" it by adding a param.
- **A bare path that opens the user's own default** (a per-user preference for which board
  opens first). The bare path is then a redirect, not a page.

## Common mistakes

```
WRONG  /contacts/{id}                       tab missing from the URL
RIGHT  /contacts/history/{id}               default tab explicit

WRONG  /catalog?tab=services                tab as a query param
RIGHT  /catalog/services

WRONG  /contacts/{id}?tab=bookings
RIGHT  /contacts/bookings/{id}

WRONG  /contacts/{id}/bookings              id before the tab
RIGHT  /contacts/bookings/{id}

WRONG  /contacts/{id}/communications/sms
RIGHT  /contacts/communications/sms/{id}

WRONG  /setup/locations/{a-36-character-uuid}                  opaque id where a name exists
RIGHT  /setup/locations/downtown-branch

WRONG  /bookings/{tenantId}                 tenant id in the URL
RIGHT  /bookings?location=downtown-branch

WRONG  the dialog opens but the URL stays /team/users           not shareable
RIGHT  the dialog opens and the URL becomes /team/users?user=123
```

Also:
- **A tab that becomes a query param is a regression**, even when it is less work.
- **Do not put state in the URL that should not be shared.** A path or a filter, yes. A one-off
  token or anything sensitive, no. URLs end up in logs and browser history.
- **Before adding a route, check that no page already covers the job.** A new URL should exist
  because a real step in a real job has no home, not because a new file felt tidy. (See
  `build-with-the-user-in-mind`, Step Zero, and the page map in `ui-conventions`.)

## How the principles map to each stack

**A React SPA with a client router.** Everything applies literally. One central route table, one
central URL-builder module (Section 3).

**Next.js App Router.** A route is a folder with a page file; the folder path IS the URL.
- Kebab-case folder names. Nesting is path segments, which gives "stable prefix first, specific
  tail last" and human-readable slugs automatically.
- If the config sets a trailing slash (common with a static export), every internal link ends in
  `/`. A link without it still resolves but costs an extra redirect. Match the convention.
- A static export has NO server route table to edit. Adding a page is adding a folder.
- Route groups (a folder name in parentheses) organize files and layouts WITHOUT adding a path
  segment. `(auth)/login/page.tsx` is still `/login`. Use them to give a set of pages their own
  layout while keeping clean URLs.
- If shared chrome (header, footer) is composed per page instead of in the layout, drive nav and
  footer links from ONE config module so the two never drift.
- A redirect for a moved route is an entry in the framework's redirects config (or middleware
  for dynamic apps), not a hand-written page.

**A plain server, one HTML file per page, no client router.**
- Flat, one-level, kebab-case paths. The page name matches the file name one-to-one
  (`/audio-splitter` serves `audio-splitter.html`). Breaking that mapping for cosmetic reasons
  makes the codebase unnavigable by guessing.
- Page routes live in the server entry file; API routes live in their own modules. Keep the
  split: a new page is one line in the entry file, a new endpoint is a route module.
- Static mounts (an `/audio` or `/uploads` file mount) are not page namespaces. Do not add page
  routes under them.
- Most of Section 1 shows up as *query params done right*: read state from `location.search` on
  load so a linked dialog or filter opens in the linked state instead of always the default.
- Every URL is a real server round trip. A route edit needs a restart; an HTML edit needs a hard
  refresh (see `verify-before-done`).

---

# SECTION 2: COMPLETE URL REFERENCE (per repo)

**This section is the repo's living list of every URL. It MUST be updated in the same change as
any URL change.** Until the repo fills it in, the block below is a template showing the format.

Format rules:
- Group by section of the app, and say for each group which URL type it is (scope in path, scope
  as query param, scope-free).
- One line per pattern, then what it shows. Note the page-access key if the app has one.
- Redirects are listed too, marked as redirects, with where they go and whether they keep the
  query string.
- Removed URLs stay listed as REMOVED with the date and the reason, so nobody regenerates a dead
  link.

```
## Operations (scope as query param)
/bookings?location=X&displayMode=calendar&viewMode=day
/members                             -> redirects to /members/all (keeps ?location=)
/members/all?location=X              -> every membership; row opens /contacts/billing/{contactId}
/contacts                            -> contact list
/contacts/{tab}/{contactId}          -> contact detail (tab ALWAYS in the URL, id at the end)
/contacts/{tab}/{subTab}/{contactId} -> contact detail with a sub-tab (id at the end)

## Setup (scope in path)
/setup/locations                     -> list (no scope)
/setup/locations/new                 -> create form
/setup/locations/{scope-slug}        -> one location's details
/setup/schedules/{scope-slug}/{subTab}

## Team (scope-free)
/team                                -> redirects to /team/users
/team/users                          -> user list
/team/users?user={id}                -> user list with the edit sheet open
/team/users/details/{userId}         -> full-page edit
/team/old-tab                        -> REDIRECT -> /team/users (tab retired YYYY-MM-DD)
/team/old-tab/{tab}/{oldId}          -> REDIRECT (id-translated) -> /team/users/details/{userId}
(REMOVED YYYY-MM-DD) /setup/old-thing/{scope-slug}: the setting moved to the user record.
                                     Any link to this path is a dead link; never generate it.

## Query parameters
?booking={id}      opens the booking editor
?newBooking=true   opens the new-booking dialog
?edit={id}         opens that item's editor, then strips the param
?location={slug}   location filter (Type 2 pages only)
?type=a|b          category filter
```

Also keep here a short **key files** table: where the route table lives, where the URL builders
live, where the scope picker syncs with the URL, where the navigation menu is defined.

---

# SECTION 3: IMPLEMENTATION

## Centralize URL building

**Never create ad-hoc URL mapping objects inside components.** Build every internal URL through
one module of functions.

```typescript
// One module, e.g. a NAV_URLS object. Functions, not strings, so parameters stay typed.
export const NAV_URLS = {
  newPage: () => '/new-page',
  newPageWithTab: (tab: string) => `/new-page/${tab}`,
  newPageWithId: (id: string) => `/new-page/detail/${id}`,
};
```

- **Type your URL maps** so undefined access is a compile error:

```typescript
type IntegrationId = 'whatsapp' | 'sms' | 'phone';
const URL_MAP: Record<IntegrationId, string> = { /* ... */ };
```

- **The bug this prevents:** an inline map defined as `myUrlMapping` and read ten lines later as
  `myUrlMaping`. In untyped code that is a runtime ReferenceError on the one screen nobody
  tested. Importing from the central module, with types, makes it impossible.

## The complete URL change checklist

When adding or changing a URL, update **ALL** of these. Missing any one causes broken links,
navigation errors, or inconsistent behavior. The names are examples; find the repo's real ones.

1. **Route definition** (the central route table, or the page folder).
   - [ ] Primary route added.
   - [ ] Default-tab redirect, if the page has tabs (`/new-page` -> `/new-page/default-tab`).
   - [ ] Sub-tab routes, if nested.
   - [ ] Parameter routes (`:tab`, `:subTab`, `:id`), id last.
   - [ ] Legacy redirects, if an existing URL is changing.
2. **Central URL builders.**
   - [ ] New builder functions added, old ones updated.
   - [ ] The function that classifies a page's scope type updated, if the page is not Type 3.
3. **Navigation menu**, if the page is in it.
   - [ ] Menu item uses the builder, not a hardcoded string. Correct section, correct icon.
4. **The page component.**
   - [ ] Reads the tab and id from the URL (route params), not from internal state.
   - [ ] Changes tabs by navigating, not by setting state.
   - [ ] Validates URL params against the allowed values and redirects invalid ones.
5. **Links FROM other components.**
   - [ ] Searched the codebase for hardcoded links to the old URL.
   - [ ] Every link component, every programmatic navigate call, every plain `href` updated.
6. **Page-access permissions**, if the app gates pages per role.
   - [ ] Page key added, tab keys added. (The full multi-file rule is in
         `security-rls-permissions`, "Page Access".)
7. **URL-to-tab mapping and validation arrays.**
   - [ ] The arrays of valid tab and sub-tab ids match the ids the component actually uses.
         A stale array is why "the URL changes but the tab does not".
8. **Breadcrumbs**, if the page has them.
   - [ ] Breadcrumb links use the builders; parent breadcrumbs updated if the hierarchy changed.
9. **Section 2 of this skill.**
   - [ ] The new or changed URLs, their redirects, and any new query params are written down.
   - [ ] If the repo mirrors this file for another agent (a Cursor rule, an `AGENTS.md` section),
         the mirror is updated too.
10. **Anything outside the app that carries the URL**: transactional emails, notification deep
    links, help-center articles, QR codes, a mobile shell. These do not show up in a code search
    of the frontend.

| Change type | Must update |
|---|---|
| New page | Route table, URL builders, nav menu, page component, Section 2 |
| Add tabs to a page | Routes, page component (params), URL builders, Section 2 |
| Rename a URL | Route table (add a redirect), URL builders, every file using the old URL, Section 2 |
| Add a dialog with URL sync | Page component (search params), URL builders, Section 2 |
| Change the tab structure | Routes, page component, every file linking to the tabs, Section 2 |

## Search before you change

```bash
# every hardcoded reference to a URL
rg "/old-url" src/

# every use of a builder
rg "NAV_URLS.oldPage" src/

# route definitions, link targets, navigate calls
rg 'path=".*old-url' src/
rg 'to=".*old-url' src/
rg "navigate.*old-url" src/
```

Search template literals too (a backtick followed by `/old`), not just quoted strings.

## When you change a URL: redirects

A URL that ever existed may be bookmarked, emailed, or printed.

1. **Keep the old path working.** Redirect it to the new one; do not 404.
2. **Keep the query string** through the redirect when it carries a filter (`?location=`).
3. **A redirect that must TRANSLATE an id is not a string redirect.** Real case: a "technicians"
   tab was merged into "users". The old links carried a technician id, but the new page is keyed
   by user id. A plain string redirect would land on the wrong record or on nothing. The redirect
   has to be a small component (or handler) that LOOKS UP the new id from the old one, then
   navigates. Check every legacy pattern that carries the old id, including old query-param
   forms.
4. **Mind exact versus prefix matching.** Redirecting `/orders` to its new home must not swallow
   `/orders/detail/{id}` if that detail page still lives there.
5. **Remove conflicting legacy routes.** Two routes with the same structure but different param
   names shadow each other; the old one wins silently.
6. **A removed URL with no successor is a dead-link generator.** Find what still produces it
   (menus, emails, notification templates, agent tools) and stop it at the source. List it as
   REMOVED in Section 2.
7. **Verify by loading both** the old and the new URL after the change.

Verification before calling a URL change complete:
- [ ] Routes updated, no conflicts.
- [ ] Every navigate call and link updated.
- [ ] Every URL-builder function updated.
- [ ] Validation arrays match the real tab and sub-tab ids.
- [ ] No legacy redirect conflicts with a new route.
- [ ] Tested: clicking tabs and sub-tabs updates the URL AND the visible tab.
- [ ] Tested: pasting the URL into a fresh tab lands in the same state.
- [ ] Tested: the back button does the expected thing (closes the dialog, returns to the list).

## Adding a dialog with URL sync

```typescript
// React Router shape; adapt to the repo's router.
const openDialog = (entityId: string) => {
  const params = new URLSearchParams(searchParams);
  params.set('entity', entityId);
  navigate(`?${params.toString()}`, { replace: true });
  setEditingEntity(entity);
};

const closeDialog = () => {
  const params = new URLSearchParams(searchParams);
  params.delete('entity');
  const next = params.toString();
  navigate(next ? `?${next}` : window.location.pathname, { replace: true });
  setEditingEntity(null);
};

// URL -> dialog state, so a pasted link opens the dialog.
useEffect(() => {
  const entityId = searchParams.get('entity');
  if (entityId && !editingEntity) {
    const entity = entities.find(e => e.id === entityId);
    if (entity) openDialogForEntity(entity);
    // If the id is stale (deleted, other scope), strip the param instead of showing nothing.
  }
}, [searchParams, entities, editingEntity]);
```

Preserve the OTHER params when you add or remove yours. Building the query string from scratch
is how opening a dialog silently drops the active location filter.

## Adding an entity detail page with tabs

```typescript
// 1. Routes: id always at the end.
//    /{section}/{tab}/{entityId}
//    /{section}/{tab}/{subTab}/{entityId}

// 2. From the list, include the default tab.
const openEntity = (id: string) => navigate(`/${section}/${defaultTab}/${id}`);

// 3. Tab changes update the URL.
const setActiveTab = (tab: string) => navigate(`/${section}/${tab}/${entityId}`, { replace: true });

// 4. Read the tab from the URL, never from component state.
const { tab, subTab, entityId } = useParams();
```

## After a large restructuring

When a navigation is consolidated (many flat items into a few umbrellas), write down the
canonical routes and the list of legacy paths that now redirect, in Section 2, in the same
change. A consolidation without that list leaves the next agent unable to tell a legacy path that
is intentionally redirected from one that is simply broken.

---

## Related

- `build-with-the-user-in-mind`: Step Zero, does this job have a screen at all?
- `ui-conventions`: the page map, so you do not create a duplicate page.
- `security-rls-permissions`: page-access keys when a new page needs gating.
- `verify-before-done`: restart and load the actual URL after any route change.
- `working-agreements`: "interconnected changes", for finding every dependent of a URL.
