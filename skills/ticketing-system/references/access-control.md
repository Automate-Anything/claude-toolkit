# Access control (stack-neutral)

Derive two audiences from the host app's existing roles; enforce everything
server-side (the UI only mirrors it).

## Audiences

- **Reporters** - who may file and view tickets. Usually all authenticated staff
  logins of the app. Decide from the app's roles which are included; typically
  exclude the most-restricted role (e.g. external/limited contractors) unless the
  user wants them to file tickets too.
- **Resolvers** - who works and closes tickets (the dev/support team). They are
  the default assignees and the recipients of the `notify_email` routing.
- **Hand-back** - a resolver may reassign a ticket to a reporter-side person and
  set `needs_client_input`; that person is then notified and can respond.

Confirm the exact mapping with the user in Phase 1 - it depends on the app.

**Worked example** (a 3-role app with roles `owner / agent / viewer`): owner =
resolver (default assignee, in the resolver-email set, can edit config); agent =
reporter (files + comments, can be handed a ticket); viewer = excluded (no nav
item, cannot file or mutate - read-only elsewhere in the app). Map your app's own
role names onto these three buckets: resolver, reporter, excluded.

## Enforcement layers (defense in depth)

1. **Row access** - tickets and their child rows are readable by the reporter/
   resolver audiences and hidden from excluded roles. If the stack has row-level
   security, write read policies; if it's an ORM/API, scope every query.
2. **Write authority** - creates/updates/status/assign/comment go through one
   server path that checks the caller may write AND is not an excluded role, then
   performs the change and logs the event. Never trust a client-sent role or
   actor id; read the current user server-side.
3. **Status transitions** - validate against the transition table server-side;
   reject illegal moves with a clear error the UI surfaces.
4. **Field exposure** - tickets rarely have sensitive columns, but if the app
   masks fields by role, follow that pattern for anything sensitive (e.g. an
   internal-only note).
5. **Storage** - attachment read/write authorized the same way (scope by the
   `tickets` bucket/prefix + the same audience check).
6. **Config** - only an admin may change `notify_email` / resolver set.

## Navigation gating

Register the Tickets page the way the app registers nav, and hide it from roles
that can't use it, matching the app's existing gating (allowlist or role list).
UI hiding is convenience; the server checks above are the real enforcement.
