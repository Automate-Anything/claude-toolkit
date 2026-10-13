# Acceptance tests - user-verifiable "done"

"Done" means these all pass in the running app, on phone + tablet + desktop. "It
compiles" is not done.

## Lifecycle & data
- [ ] Create a ticket → it gets a unique `TKT-#####`, shows on the board in the
      correct column, and on the linked record's page (if linked).
- [ ] Type / priority / labels / assignee / due date all save and display.
- [ ] Move a ticket through new → triaged → in_progress → in_review → done.
- [ ] An illegal status move is rejected (server error surfaced; board drag snaps
      back).
- [ ] From in_review, reopen → in_progress; `resolved_at` clears; a "reopened"
      timeline event appears.
- [ ] Hand-back: set needs_client_input + reassign to a reporter-side person.
- [ ] Soft-delete hides a ticket from the board/list.

## Attachments
- [ ] Upload an image → inline preview; a video → inline player; a doc → download
      chip that opens via a signed URL.
- [ ] A file over the limit is rejected client-side with a clear message.
- [ ] Large file uses resumable upload if the app supports it.

## Comments & timeline
- [ ] Post a comment; @mention a teammate → they become a watcher and are notified.
- [ ] The timeline shows created / status / assignee / priority / reopened events
      with actor + time, humanized.

## Notifications & email (the core promise)
- [ ] Assign a ticket to a resolver → an email lands at the configured
      `notify_email` with the number, title, and a working deep link.
- [ ] Assign to a non-resolver → they get an email at their own address.
- [ ] @mention → the mentioned person is emailed (resolver-routed).
- [ ] Reopen a resolved ticket → the assignee is notified.
- [ ] The actor never gets emailed about their own action; no duplicate email
      when someone is both mentioned and assignee.

## Access control
- [ ] An excluded role cannot see the Tickets nav item or open the board.
- [ ] A read-only/unauthorized user cannot create or mutate (server-enforced,
      not just hidden buttons).
- [ ] Only an admin can change the notify-email/config.

## Design & responsiveness
- [ ] Board/list/detail use the app's tokens; correct in every theme the app
      supports (both light AND dark if it has both; the single theme otherwise).
- [ ] Dense and usable at 320px; no horizontal scroll; tap targets ≥ 44px.
- [ ] Loading = skeletons; empty/error/success states are polished; reduced-motion
      honored; keyboard nav + visible focus throughout.

## Tests
- [ ] Unit tests: status-transition legality + notification routing decision.
