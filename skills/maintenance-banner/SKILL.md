---
name: maintenance-banner
description: A database-driven, platform-wide maintenance banner that turns on and off with one row update and no deploy, plus a lighter "scheduled maintenance" heads-up shown in advance. Read it whenever there will be a gap where deployed code and the live database disagree (a schema migration that runs after the code ships, a risky cutover, any short window where users might see duplicated or half-loaded data), before building such a banner into a new app, or when the owner says "put up the maintenance banner", "turn on maintenance mode", "tell customers we are doing maintenance", "schedule a maintenance notice", or "the banner is stuck on". Covers the single-row table design, the read/write security model, the client polling, the on/off/scheduled SQL, the deploy-and-migration runbook, and the gotchas.
---

# Maintenance banner

> ## Adapt before use
> This describes how the banner SHOULD be wired, taken from a production system
> (Supabase/Postgres, several web frontends, an admin portal). Nothing here exists
> in a repo until you build it. The table, column and route names below are
> EXAMPLES of the shape: grep the repo before citing any of them, and once the
> banner is built, update this file with the real names and the real command for
> running SQL. Before any write to the live database, pull the live schema of the
> table and verify your SQL against it.

One always-on-top banner that tells every user the platform is briefly under
maintenance. It exists to cover the unavoidable gap between a code deploy and a
database migration, or any short window where the two are out of sync and a user
might see something odd (an item showing twice, a page half-loading). You turn it
on, do the risky work, turn it off. No redeploy is involved either way.

---

## 1. The design

- **One row.** A table (example: `maintenance_status`) that always holds exactly
  one row, `id = 1`, with a CHECK constraint enforcing the single row.
- **Columns (example shape):**
  - `active boolean` - the full "under maintenance NOW" banner.
  - `message text` - optional custom copy. NULL means the default copy.
  - `ends_at timestamptz` - optional "back by" time.
  - `updated_at timestamptz`.
  - `scheduled_active boolean`, `scheduled_message text`,
    `scheduled_starts_at timestamptz` - the scheduled-notice layer.
- **Two independent notices.** `active` is the full banner. `scheduled_active` is
  a lighter "heads up, scheduled maintenance" warning shown ONLY while `active`
  is false, so a user sees it in advance and it is replaced by the full banner
  when the window starts.
- **Read path.** Anonymous and authenticated roles have SELECT only. Every client
  surface polls the row about every 30 seconds. Flip the row and the banner
  appears or disappears for everyone within about 30 seconds, no deploy.
- **Write path.** There is NO write policy. Only the service-role key changes the
  row (an admin-portal endpoint that writes with the service key, or an agent
  running SQL with it). A leaked public/anon key cannot flip the platform into
  maintenance.
- **Display.** `message` wins if set, else a friendly default ("quick scheduled
  maintenance, some items may briefly appear more than once"). If `ends_at` is in
  the future, the banner adds "back to normal by {time}".
- **It is a notice, not a lock.** The banner never blocks anything and does not
  put the app into read-only mode.

Why a polled row instead of a feature flag in code or an env var: an env var
needs a redeploy (the exact thing you are trying to avoid mid-window), and a
realtime channel is one more thing that can be down during the very maintenance
you are announcing. One cheap SELECT every 30 seconds is boring and always works.

---

## 2. Two ways to flip it

1. **Admin portal (the easy button, preferred for the owner).** A settings page
   with two cards, "Under maintenance now" and "Scheduled maintenance notice",
   each with an on/off switch, an editable message (blank = default) and a
   date/time. Backed by a small authenticated GET/PUT endpoint on the admin
   server that is gated to the top admin role and writes with the service key.
2. **SQL (agent, or no portal yet).** The UPDATE statements below, run through
   the repo's normal "execute SQL against the live DB" path. It is a normal
   database write: confirm with the owner as usual.

---

## 3. Turn it ON

```sql
-- default copy:
UPDATE public.maintenance_status SET active = true WHERE id = 1;

-- or with custom copy and a back-by time:
UPDATE public.maintenance_status
  SET active = true,
      message = 'We are upgrading the catalog. Some items may show more than once for a few minutes.',
      ends_at = now() + interval '30 minutes'
  WHERE id = 1;
```

## 4. The scheduled heads-up (set it in advance)

```sql
-- warn now; it is replaced by the full banner when you flip `active` on tonight:
UPDATE public.maintenance_status
  SET scheduled_active = true,
      scheduled_message = NULL,                 -- NULL = default copy, uses scheduled_starts_at
      scheduled_starts_at = '2030-01-10 02:00:00-05'
  WHERE id = 1;

-- clear it:
UPDATE public.maintenance_status
  SET scheduled_active = false, scheduled_message = NULL, scheduled_starts_at = NULL
  WHERE id = 1;
```

## 5. Turn it OFF

```sql
UPDATE public.maintenance_status
  SET active = false, message = NULL, ends_at = NULL
  WHERE id = 1;
```

Always clear `message` and `ends_at` when you turn it off, so the next time it
goes on it starts from the default unless you set new copy.

`ends_at` is advisory text only. It does NOT auto-clear the banner. You clear the
banner by setting `active = false`.

---

## 6. The deploy / migration gap (the main use)

When code ships before its migration, or the migration runs later in a night
window:

1. Turn the banner ON (optionally with `ends_at = now() + interval 'N minutes'`).
2. Run the migration or do the risky cutover.
3. Regenerate and push the database types if the schema changed.
4. Verify the surfaces look right.
5. Turn the banner OFF.

Because clients poll about every 30 seconds, allow up to a minute for it to
appear and to clear. Do not start the risky work the same second you flip it.

---

## 7. Gotchas

- **It shows to EVERY role, including logged-out visitors on public pages, on
  purpose.** That is the point during real maintenance.
- **It is not dismissible.** If it is "stuck on", it is not stuck: `active` is
  still `true` in the row. Turn it off with the SQL above.
- **Do NOT show it inside an embedded widget** (an iframe on a customer's own
  site). An embed is a fixed-height frame with its own header and footer
  suppressed, so a platform notice eats its height and blends into the
  customer's branded page. The banner is for YOUR surfaces: the main app, the
  standalone public pages, the customer portal.
- **Every client surface needs the banner component and the poll.** A new
  frontend added later silently has no banner. Add it to the new-surface
  checklist.
- **The banner never blocks writes.** If the window truly requires that nobody
  write, that is a different feature (a read-only mode). Do not pretend the
  banner provides it.
- **The poll must be cheap and failure-tolerant.** One tiny SELECT; if it fails,
  keep the last known state and try again next tick. A failed poll must never
  blank the page or throw into the app shell.

---

## 8. Build checklist (new repo)

- [ ] Single-row table with the CHECK, seeded with `id = 1`, `active = false`.
- [ ] RLS on, SELECT granted to anon + authenticated, no INSERT/UPDATE/DELETE
      policy at all.
- [ ] One shared banner component, mounted at the top of every first-party
      surface, hidden in embeds.
- [ ] 30-second poll, default copy, optional message, optional "back by" time.
- [ ] Scheduled-notice layer shown only while `active` is false.
- [ ] Admin-portal page with the two cards, backed by a service-key endpoint
      gated to the top admin role.
- [ ] This skill updated with the real table name and the real SQL command.

## Related

- `release-and-deploy-sequence` - where the code-then-migration window comes from.
- `deploy-freshness` - the other half: making open tabs pick up the new code.
- `security-rls-permissions` - the grant-plus-policy model the table relies on.
