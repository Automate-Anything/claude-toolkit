# Access and light cautions

Read in Phase 0. This skill uses the system normally. There is no proxy, no masking and no access
restriction. The notes below are ordinary good practice for working in a live business system, not a
cage.

## Contents

1. The account to use
2. Reading is free
3. Learning what a write does, safely
4. Test records
5. A few traps worth knowing
6. Sensitive data
7. What may be matched, and what may not be copied

## 1. The account to use

Log in with an account that can see every screen staff use. In order of nicety:

- A **sandbox, training or demo account** if the vendor offers one. Best, because you can press Save,
  Delete and Send freely on fake data.
- Otherwise the owner's **normal or admin account**. Fine for replication. An admin account shows
  every screen and button, which is exactly what you want to copy.

The owner logs in to your browser window, so you never handle the password. If one account hides
screens that another role sees, capture each role's own view, because that view is the layout those
staff actually know.

## 2. Reading is free

Navigate, open records, open tabs, open a dialog then Cancel, hover, search, sort, filter, page, view
reports, read settings screens. None of that changes anything. Do it freely and thoroughly: this is
most of the job.

## 3. Learning what a write does, safely

To replicate editing, deleting, saving and sending, you need to see what they do. Prefer, in order:

1. **A sandbox:** do the action for real on fake data.
2. **A clearly fake test record** on the live system (see below): save and edit it to watch the
   behavior.
3. **The system's own history / audit log** on real records: staff have already done these actions
   thousands of times, and the log shows what followed each one. Reading history changes nothing.
4. **Ask the owner** when none of the above can show it.

For an action that deletes a real record, charges a card, or messages a real customer, do not fire it
on real data just to see what it does. Use a sandbox or a test record, or ask. This is about not
sending a real statement by reflex, not about avoiding the feature.

## 4. Test records

On a live system, write-testing is cleanest on a record you created for it:

- Name it with a `ZZTEST` prefix so it sorts last and is obvious.
- Give it contact details that reach the owner (an email on a domain they own, a phone they own), so
  any automated email or text just reaches them, not a real person.
- Leave out real payment details so nothing can charge or draft.
- When you are done, hand the owner a short cleanup list (what to delete).

## 5. A few traps worth knowing

These help you avoid surprises, not restrict you:

- **Some plain links act.** In old systems a link like `delete.aspx?id=` or `logout` performs the
  action on click. `coverage.py` flags links whose label or URL looks like delete/void/send/logout;
  reach those through the UI deliberately rather than by opening the URL blind.
- **Some forms save on blur or on change.** Picking a dropdown value can post the whole form
  (ASP.NET AutoPostBack). If you are on a real record and do not want to save, be aware of this.
- **Confirmation dialogs default to a button.** Read the dialog before pressing Enter.
- **Back and Refresh after a save can resubmit.** Avoid on a real record right after a write.

## 6. Sensitive data

Everything on screen during capture is sent to the AI model. If the data is health, financial or
personal, say so in one line in Phase 0 so the owner can decide it is acceptable before you begin.
Keep raw captures (screenshots, inventories, network bodies) under `docs/parity/_raw/`, which
`scaffold.py` adds to `.gitignore`, and commit only the redacted notes and specs. Do not paste real
records into chat; describe them.

## 7. What may be matched, and what may not be copied

General guidance, not legal advice. Tell the owner to involve a lawyer if the replacement will be
sold.

- **Generally fine to match:** layout and placement, menu structure, workflow and screen flow, field
  order, tab order, keyboard behavior, short functional labels ("Save", "Cust #", "Due date"), and
  the behavior itself (what a button does). Courts have tended to treat these as functional (for
  example Lotus v. Borland on menu hierarchies, and Design With Friends v. Target on a look and feel
  ruled functional).
- **Never copy:** the vendor's logo, product name, icons, illustrations, help text and long
  instructional sentences, documentation, or code (including their downloaded JavaScript).
  Re-implement behavior in the owner's own code and words. `ip_scan.py` checks this before the
  project is called done.
- **The contract:** many vendor terms forbid using the service to build a competing product, and some
  forbid copying features or graphics. An internal-only replacement is a much lower risk than one that
  will be sold. Raise it in Phase 0 and let the owner decide.
