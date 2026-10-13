# Integration snippets (host-file touchpoints)

Besides the self-contained `sql/`, `src/ticketing-module/`, and `src/pages/`, the
origin build touched five shared host files. Reproduce the equivalent in the host
app. These are the Next.js+Supabase forms; translate to the host stack.

## 1. Data-access layer - typed RPC wrappers

The module's `api.ts`/`hooks.ts` call `createDb(sb).<method>()`. In the origin,
`createDb` is a big object in `src/lib/db.ts`; the ticket methods were appended:

```ts
// createTicket / updateTicket / setTicketStatus / assignTicket / getTickets /
// getTicketDetail / listTicketLabels / upsertTicketLabel / addTicketComment /
// watchTicket / unwatchTicket - each a thin wrapper over the matching RPC via a
// small `rpcUntyped<T>(supabase, fn, args)` helper (used because the generated
// DB types don't include new functions yet). Example:
async getTickets(filters = {}): Promise<TicketListResult> {
  return unwrap(await rpcUntyped<TicketListResult>(supabase, "get_tickets", { p: filters }));
}
```
If the host has no such layer, call the RPCs/endpoints directly from `api.ts`.

Also widen the app's mention-picker entity union to include `"ticket"` (the
mentionable-people RPC ignores the entity type, so no server change needed).

## 2. Status → tone map

The origin has a central `src/config/status-map.ts` badges read from. Added:

```ts
// StatusDomain gained "ticket"; only 5 tones exist so states share tones -
// the label + icon disambiguate (status is never color-only):
ticket: {
  new: "info", triaged: "neutral", in_progress: "warning", in_review: "info",
  needs_client_input: "warning", blocked: "danger", done: "success", wont_do: "neutral",
},
// + label overrides for nice casing: in_progress→"In Progress", in_review→"In Review",
//   needs_client_input→"Needs Client Input", wont_do→"Won't Do".
```
If the host has no central map, the module can carry its own tiny status→tone
helper using the host's tone vocabulary.

## 3. Navigation entry (gated)

```ts
// Workspace section; hidden from the excluded role via the app's nav gating.
{ label: "Tickets", href: "/tickets", icon: Ticket },
```

## 4. Query keys (if the app centralizes TanStack keys)

```ts
tickets: {
  root: () => [...all, "tickets"],
  list: (filters) => [...all, "tickets", "list", filters ?? null],
  lists: () => [...all, "tickets", "list"],
  detail: (id) => [...all, "tickets", "detail", id],
  labels: () => [...all, "tickets", "labels"],
  options: (kind) => [...all, "tickets", "options", kind],
},
```

## 5. Email transport

The RPCs enqueue into the app's existing email outbox
(`notification_outbox(recipient_profile_id, channel, payload{to,trigger_key,title,body,link})`)
which an existing cron drains through the verified sender. Point the ticket
notify functions at whatever transport the host already uses; do not add a new
one. The recipient is chosen by `ticket_config` + the resolver-routing rule (see
`../references/notifications.md`).

## Uploads

`components/detail/ticket-attachments.tsx` mirrors the app's existing uploader
(client size check via an `uploads/limits` helper, sanitize name, upload to the
`tickets` bucket at `tickets/<id>/<ts>-<name>`, insert an `attachments` metadata
row with `entity_type='ticket'`, roll back the storage object if the row insert
fails, download via a short-lived signed URL). Repoint at the host's storage.
