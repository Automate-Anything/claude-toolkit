---
name: ticketing-system
description: Use when a web app needs an internal ticketing / bug tracker / support-ticket / issue-tracker / feedback board added to it - clients or staff filing tasks and bugs, tagging/assigning people, statuses, priorities, attachments (images/video/docs), comments with @mentions, and email-on-assignment - often to replace a shared spreadsheet. Works in ANY stack and matches the HOST app's own design theme, not a fixed one.
---

# Ticketing System (portable blueprint)

## Overview

Build a robust, in-app ticketing system into whatever app you're in. A ticket is
a numbered unit of work someone **reports** and someone else **resolves**, with a
status lifecycle, priority/type/labels, optional links to the app's own records,
file attachments, a comment thread with @mentions, watchers, an audit timeline,
and notifications (in-app + **email on assignment**).

**Core principle:** the feature set and data model are fixed (below); the
*stack* and the *look* are not. You DETECT the host app's conventions and design
tokens, then BUILD to match them. Never copy another app's theme, palette, table
names, or terminology - discover this app's and use those.

## When to use

- "Add a ticketing system / bug tracker / issue tracker / support desk / feedback board."
- "Let clients/staff file tasks and tag me, with statuses and file uploads."
- "Replace our Google Sheet / Trello / spreadsheet of bugs with something real."
- Any request for assign + status + comment + attachment tracking of work items.

Not for: a public/anonymous contact form (no auth), or a full project-management
suite (epics/sprints/gantt) - this is focused ticketing.

## The three phases

Do them in order. Do NOT start writing schema or components until Phase 1 is done.

### Phase 1 - DETECT the host app (never assume)

Investigate and write down, with real file paths, how THIS app does each of:

1. **Stack & data access** - framework, language, how the server talks to the DB
   (ORM? raw SQL? RPC/stored procedures? an API layer?). Find the existing
   read/write pattern and follow it. If it's SQL/Postgres+RLS, tickets are new
   tables + definer functions; if it's an ORM, new models + a service layer; if
   it's a REST/GraphQL API, new endpoints + resolvers.
2. **Auth, roles & "who can do what"** - how the current user is obtained
   server-side, the role vocabulary, and how row/record access is enforced.
   Decide the reporter set and the resolver/assignee set from the app's roles.
3. **Storage** - how files are already uploaded (bucket/blob store, size limits,
   signed URLs, the metadata table). Reuse it; add a `tickets` bucket/prefix.
4. **Notifications & email** - how the app already sends email (provider, queue,
   verified sender) and in-app notifications. Reuse that transport; do NOT bolt
   on a new email library.
5. **Comments/@mentions** - if a mention/comment engine exists, reuse it; else
   build the small one in `references/data-model.md`.
6. **Design system** - the single most important detection step. Find the
   color/spacing/type tokens, the light/dark mechanism, and the shared UI kit
   (buttons, badges, modals, tables, empty states). Read `references/theme-adaptation.md`.
7. **Navigation** - how a new top-level page is registered and gated.

Then write a short **tailored spec** for this app (its names, its theme, its
stack) covering the invariants below. Confirm the notify-email recipient and any
gating with the user.

### Phase 2 - BUILD the data layer

Follow `references/data-model.md` (tables, enums, lifecycle, transitions) and
`references/notifications.md` (event → recipient matrix, email routing, the
config knob), expressed in the host stack's idiom. Enforce the status-transition
rules and access control server-side (`references/access-control.md`), never only
in the UI. Add unit tests for transitions and notification routing.

### Phase 3 - BUILD the UI

Follow `references/ux-spec.md`: a board (columns = statuses, drag to change) and
a filterable list, a create dialog, and a detail view (inline controls,
attachments with inline image/video preview, comment thread with @mention picker,
audit timeline). Bind every color/spacing/type to the host tokens you found in
Phase 1. Skeletons, empty, error, success states. Responsive and dense on mobile;
accessible (keyboard, focus, contrast, 44px targets). Verify in the browser on
phone/tablet/desktop.

**Match the host's rendering model, not a fixed one:**
- **SPA** (React/Vue/etc.): client components + the app's data-fetching layer;
  make status/assignment **optimistic with rollback** so it feels instant.
- **Server-rendered / MPA** (Django/Rails/Laravel + HTMX/Turbo/Livewire): a thin
  **service layer** for each mutation and server-rendered **fragments** the page
  swaps in; "optimistic" here is a fast round-trip that re-renders the fragment,
  with client-side **snap-back on an illegal drag** (mirror the transition
  table). This is fully compliant - don't force a SPA pattern onto an MPA.

## Invariants (the feature set - keep all of these)

- **Numbered tickets** (e.g. `TKT-#####`), a stable human reference.
- **Type** (bug / feature request / question / …), **priority** (urgent→low),
  **free-form colored labels**.
- **Lifecycle**: new → triaged → in progress → in review → done, plus blocked,
  won't-do, and a "needs input" hand-back state. **In review = the reporter
  verifies** before it closes. Legal transitions enforced server-side.
- **Optional link** to one of the app's own records (order, customer, document…).
- **Assignee** (defaults to the resolver team) + **watchers** (reporter +
  assignee + anyone @mentioned).
- **Attachments** (images/video/docs), inline preview, generous size limit.
  Reuse the app's existing uploader; resumable large-file upload only if that
  uploader already offers it - reusing a plain multipart uploader without
  resumable is an acceptable v1 tradeoff (raise the size cap instead).
- **Comments with @mentions**; an **audit timeline** of status/assignee/priority
  changes.
- **Notifications**: in-app + **email to the assignee on assignment** (routed to a
  configurable address), on @mention, and when a resolved ticket is sent back.
- **Access control**: reporters and resolvers derived from the app's roles;
  everything enforced server-side.

## Reference files

- `references/data-model.md` - tables, enums, lifecycle, transition table, comment/mention.
- `references/notifications.md` - event→recipient matrix, email routing, the config knob.
- `references/theme-adaptation.md` - how to discover & bind to ANY design system (read in Phase 1).
- `references/ux-spec.md` - board / list / detail / create / mobile spec.
- `references/access-control.md` - reporter/resolver/hand-back matrix + enforcement.
- `references/acceptance-tests.md` - the user-verifiable done checklist.
- `reference-impl/` - a full Next.js + TypeScript + Supabase (Postgres/RLS/Storage)
  implementation to adapt when the host stack matches. See `reference-impl/README.md`
  for the file map and the exact points to re-theme and re-config.

## Common mistakes

| Mistake | Instead |
|---|---|
| Copying the reference app's colors/tables/terms | DETECT this app's tokens & conventions first (Phase 1) |
| Enforcing status rules / permissions only in the UI | Enforce server-side; the UI just mirrors it |
| Adding a new email library | Reuse the app's existing email transport & verified sender |
| Emailing on every event to everyone | Email on assignment / @mention / send-back only; watchers get in-app |
| Skipping the "in review → reporter verifies" step | It's the point of a support workflow; keep it |
| Hardcoding the notify-email | Put it behind a config knob (default provided, editable) |
| Shipping desktop-only | Board/list/detail must be dense & usable at 320px |
