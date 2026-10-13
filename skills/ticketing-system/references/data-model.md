# Data model, lifecycle & comments (stack-neutral)

Express these in the host stack's idiom (SQL tables + definer RPCs, ORM models +
services, or API resources). Names are suggestions - match the app's conventions.

## Entities

**ticket**
- `id` - surrogate key
- `number` - human ref, unique, e.g. `TKT-00042`. Generate from a monotonic
  counter; no per-year reset unless the app numbers everything that way.
- `title` (required), `body` (long text / markdown)
- `type` - enum: `bug | feature_request | question | future_plan` (adapt names)
- `priority` - enum: `urgent | high | medium | low`
- `status` - enum, see lifecycle below
- `reporter_id` - who filed it (the current user at create)
- `assignee_id` - nullable; who's resolving it
- `linked_entity_type` + `linked_entity_id` - nullable pair; a link to one of the
  app's own records (constrain to the record types that make sense). Store both
  or neither.
- `due_date` - nullable
- `created_at`, `updated_at`, `resolved_at` (set on done/won't-do), `deleted_at`
  (soft delete)

**ticket_label** (`id`, `name` unique, `color` = a token key not raw hex, `deleted_at`)
and **ticket_label_link** (`ticket_id`, `label_id`) - many-to-many.

**ticket_watcher** (`ticket_id`, `profile_id`) - notification recipients. Auto-add
reporter + assignee; @mention adds one.

**ticket_event** (`id`, `ticket_id`, `actor_id`, `kind`, `from_value`, `to_value`,
`created_at`) - audit timeline. `kind` ∈ created | status | reopened | assignee |
priority | type | link.

**ticket_config** - a singleton holding the notify-email recipient and the set of
"resolver/dev" emails used for routing (see notifications.md). This is the knob
that makes the skill reusable per app.

Attachments and comments should REUSE the app's existing generic tables if they
exist (an `attachments` table keyed by `entity_type`/`entity_id`, a `comments`
table likewise). Only create ticket-specific ones if the app has none.

## Status lifecycle

States: `new → triaged → in_progress → in_review → done`, plus `needs_client_input`,
`blocked`, `wont_do`.

- **in_review** - the resolver believes it's done; the *reporter* verifies, then
  either closes (→ done) or reopens (→ in_progress). This verify step is the
  heart of a support workflow - keep it.
- **needs_client_input** - resolver hands it back to a reporter-side person
  (reassign to them; notify them).
- **wont_do** - declined; set `resolved_at`.

**Legal transitions (enforce server-side; reject others with a clear error):**

| from | allowed → |
|---|---|
| new | triaged, in_progress, blocked, wont_do |
| triaged | in_progress, needs_client_input, blocked, wont_do |
| in_progress | in_review, needs_client_input, blocked, wont_do |
| in_review | done, in_progress *(reopen)* |
| needs_client_input | in_progress, triaged |
| blocked | in_progress, triaged, wont_do |
| done | in_progress *(reopen)* |
| wont_do | in_progress |

A same-status set is a no-op. Reopen = `in_review|done → in_progress` (log a
`reopened` event and clear `resolved_at`). Keep this table as the SINGLE source of
truth and mirror it in the client so the UI only offers legal moves.

## Numbering

Atomic counter. Simplest correct form: an upsert that increments and returns the
new value (`insert ... on conflict do update set n = n+1 returning n`), formatted
with a prefix + zero-pad. Reuse the app's existing numbering helper if it has one.

## Comments + @mentions (if the app has none to reuse)

On add-comment: insert the comment; parse `@` mention tokens from the body; for
each matched active user record: add them as a watcher, record the mention, and
create a notification (respect their preference). The token format is
**app-defined** - match whatever the app's users expect (`@username`, `@Display
Name`, or `@email`); the matcher resolves the token to a user record either way.
Provide a "mentionable people" lookup (all active logins, the ones already on this
ticket flagged first) to power the @-autocomplete. Route mention emails through
the same matrix in notifications.md.

## Writes go through one authorized path

Every mutation (create/update/status/assign/comment/label/watch) checks
permission server-side and logs the appropriate `ticket_event`. The UI never
writes directly to storage of record tables without going through that path
(attachments excepted, matching the app's existing upload pattern).
