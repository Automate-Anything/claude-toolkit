# UX spec - board, list, create, detail (stack-neutral)

Build with the host app's UI kit and tokens (see theme-adaptation.md). Every
`cursor:pointer` works on first click; not-ready controls render disabled, never
as dead pointers. Skeletons for loading (spinners only inside buttons). Polished
empty / error / success states. Accessible: keyboard nav, visible focus,
sufficient contrast, alt text.

**Perceived speed depends on the rendering model.** On a SPA, make status +
assignment **optimistic with rollback**. On a server-rendered/MPA stack
(HTMX/Turbo/Livewire), do a fast round-trip that re-renders the fragment, with a
client-side **snap-back on an illegal drag** (mirror the transition table). Both
satisfy "feels instant" - pick the one native to the app.

## /tickets page

Viewport-locked (the app's full-height page wrapper if it has one). Header: title
+ open count, a **New ticket** button (only if the user may write), and a
**Board / List** toggle (persist the choice per user, e.g. localStorage in a
try/catch). A filter bar + search (debounce ~150ms):
- filters: status (multi), priority (multi), type (multi), assignee, label,
  linked-record type, and a **"mine"** toggle (reporter or assignee = me).
- On mobile, collapse filters into a menu; keep search visible.

### Board
Columns in lifecycle order; each header shows its count. Cards show: number
(mono), title (clamp), assignee avatar/initials, label chips, a priority
indicator, and attachment/comment counts. Drag a card to another column →
change status, but ONLY if the move is legal (mirror the transition table);
illegal drop snaps back with a toast. Card click → detail.

### List
The app's table/grid. Columns: number, title, type, priority (pill), status
(badge), assignee, labels, updated. Sortable. Row click → detail.

## New-ticket dialog

The app's modal. Fields: title (required), body, type, priority, optional
linked-record picker (reuse the app's entity search if one exists; otherwise a
record-type select + id/reference field is acceptable for v1), labels (multi;
allow creating a label inline), assignee (default the resolver team). Show
per-field validation errors inline. On success: toast + go to the new ticket.
Attachments can be added on the detail page after creation to keep create fast.

## Ticket detail (/tickets/:id)

- Header: title + `TKT-#####` (mono) + status badge; a Watch/Unwatch toggle.
- Inline controls (each optimistic, disabled if the user can't write): status
  (menu limited to the legal next states + current; picking in_progress from
  in_review/done is a reopen), priority, type, assignee, labels, linked record,
  due date.
- Body: render markdown if the app has a renderer; else preformatted text.
- **Attachments**: reuse the app's uploader against a `tickets` bucket/prefix,
  generous size cap, resumable for large files if supported. Inline `<img>` for
  images and a `<video controls>` for video; other types as a download chip via a
  short-lived signed URL. Show name + human size.
- **Comments**: the thread + a composer with an @mention picker (reuse the app's
  mention component). Author + relative time per comment.
- **Timeline**: the audit events, newest or oldest first per the app's convention,
  each humanized ("Sam changed status In review → Done", "created", "reopened",
  "assigned to Alex", "priority High → Urgent").

## Record cross-link

On the linked record's own page, show its open tickets (count + a small list or a
"Tickets" tab), linking back to the board filtered to that record. Reuse whatever
pattern the app uses for related-item panels.
