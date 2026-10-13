# Notifications & email routing (stack-neutral)

Reuse the host app's EXISTING email transport (provider, queue, verified sender)
and its in-app notification mechanism. Do not add a new email library. If the app
queues email (an outbox drained by a worker/cron), enqueue rows; if it sends
inline, send inline through the same helper.

## The config knob (what makes this reusable)

Store in `ticket_config` (or the app's settings):
- `notify_email` - the address that resolver-team assignments/mentions are emailed
  to. Make it editable by an admin. **Ship the default as a loud placeholder**
  (e.g. `CHANGE_ME@example.com`) so a forgotten setup step fails visibly instead
  of silently emailing the wrong team. Set it to the host team's real inbox during
  Phase 1. (In the origin app it resolves to `effi@automateanything.ai`.)
- `resolver_emails[]` - the set of "resolver/dev team" login emails. An assignee
  whose email is in this set is a resolver → their ticket emails go to
  `notify_email` (a shared inbox), guaranteed. Anyone else → their own address.

## Event → recipient matrix

| Event | In-app (watchers with a login) | Email |
|---|---|---|
| Created/reassigned to a **resolver** | notify assignee (loud) | → `notify_email` (always, regardless of prefs) |
| Created/reassigned to a **non-resolver** (hand-back) | notify assignee (loud) | → that person's own address (respect their pref) |
| New **comment / @mention** on a watched ticket | notify mentioned + assignee | mentioned/assignee per the resolver-routing rule above |
| Status sent **back to the assignee** (in_review/done → in_progress) | notify assignee | to the assignee (resolver-routed) |

Rules:
- "Loud" = if the app has a distinct/priority notification class (survives a
  "only things I'm tagged in" filter, pops a toast, triggers web-push), put the
  ticket assignment/mention/reopen types on that allowlist.
- Resolver assignment email ALWAYS sends (it's the product's core promise); other
  emails respect the recipient's notification preference.
- Never email the actor about their own action (skip self-assign, self-comment).
- Deduplicate: if someone is both @mentioned and the assignee on one comment,
  send one email.

## The pure routing decision (unit-test this)

```
resolveRecipientEmail(assigneeEmail, config):
    if lower(assigneeEmail) in map(lower, config.resolver_emails):
        return config.notify_email        # shared resolver inbox
    return assigneeEmail                   # the person's own address
```

Extract this as a pure function and test it: a resolver login routes to
`notify_email`; a non-resolver routes to itself; case-insensitive; empty → none.

## Email content

Reuse the app's branded email template. Include the ticket number + title, what
happened, who did it, and a deep link to the ticket detail page. Keep the link
path relative if the template prepends the base URL (match the app's convention).
