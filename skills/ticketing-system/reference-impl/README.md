# Reference implementation (Next.js + TypeScript + Supabase)

A complete, production ticketing system to adapt when the host stack matches
(Next.js App Router + Supabase Postgres/RLS/Storage + TanStack Query). It is the
FAST PATH, not a requirement - on other stacks, follow the `references/*` specs
instead. Even here, do Phase 1 first and RE-THEME + RE-CONFIG (below).

## What's here

The `src/` and `sql/` subfolders mirror the origin implementation:

- `sql/` - four migrations:
  - schema (enums, tables, RLS, config singleton),
  - RPCs (create/update/status/assign/get-list/get-detail/labels/watch + a
    transition-check function + numbering),
  - notifications (event side-effects, dev-email routing, comment+@mention,
    storage bucket + policies),
  - optional spreadsheet importer.
- `src/data-layer/` - the typed `createDb` method wrappers, module `types.ts`,
  Zod `schema.ts`, and the pure helpers (`status.ts` transition table,
  `priority.ts`, `labels.ts`, `notifications.ts` routing) + their unit tests.
- `src/module/` - `api.ts` (reads), `actions.ts` (server actions), `hooks.ts`
  (TanStack Query, optimistic status/assign).
- `src/ui/` - the pages + components (board, list, filters, new-ticket modal,
  detail, attachments, comments, timeline).

## Adapt in this order

1. **Phase 1 detection** (see SKILL.md). Confirm the host uses Supabase; if not,
   use the specs, not this code.
2. **RE-CONFIG** - the only behavioral knobs:
   - `ticket_config.notify_email` default and `dev_emails[]` (the resolver set).
     Set these to the host app's team/inbox. Search for `automateanything` and
     the origin emails and replace them. Prefer shipping the migration's default
     as a loud placeholder (`CHANGE_ME@example.com`) so a missed setup step fails
     visibly rather than emailing the origin team.
   - Numbering prefix (`TKT-`) if the app prefers another.
   - The `linked_entity_type` allowed values → the host app's real record types,
     and the detail page's link hrefs to those records.
3. **RE-THEME** - bind to the host tokens (see theme-adaptation.md):
   - Add the 8 ticket statuses to the host's status→tone map (or create a local
     one using the host's tone vocabulary). The origin used a 5-tone system
     (success/warning/danger/info/neutral); remap if the host differs.
   - Swap every UI-kit import (Button/Badge/Modal/Table/Menu/Input/EmptyState/
     Toast/Avatar) to the host's components; adjust props to their real shapes.
   - Replace the full-height page wrapper, the mono font treatment for the
     number, and the comment/@mention component with the host's equivalents.
   - Point the uploader at the host's storage bucket + size limits + resumable
     helper.
4. **Re-wire integration points** - auth/current-user, role → reporter/resolver
   mapping, the email transport (queue vs inline), and nav registration, all per
   what Phase 1 found.
5. **Test** - port the two unit tests (transitions, routing), then run the
   `references/acceptance-tests.md` checklist in the browser.

## Grep checklist before shipping

- No `automateanything`, no origin-app person names, no origin table/route names
  that don't exist in the host.
- No raw hex colors; no origin `globals.css`/token imports.
- Status tones come from the host's system.
- `notify_email` points at the host team's address.
