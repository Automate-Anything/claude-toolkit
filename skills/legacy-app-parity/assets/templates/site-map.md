# Site map: {{SYSTEM}}

One row per screen (a page, a tab that changes the whole work area, a dialog
or popup with its own controls). IDs are stable: S01, S02... and never reused.
"How to reach" is the CLICK PATH from the home screen, because many old systems
break or behave differently when a deep page is opened by URL.

Frequency comes from the owner's top-tasks list (daily / weekly / monthly / rare).
Status: mapped (screenshot + inventory) -> specified (screen spec written) ->
built -> verified (layout diff PASS + scenarios PASS).

| ID | Screen | How to reach (click path) | URL pattern | Roles that see it | Frequency | States captured | Fidelity | Status |
|---|---|---|---|---|---|---|---|---|
| S01 | | | | | | default | A | mapped |

Fidelity: A = observed live in the sandbox with writes allowed; B = observed
live, read-only; C = from the owner's screenshots or recordings only; D = from
description only. Say the fidelity out loud when reporting progress.

## Frontier (found, not yet mapped)

Keep this list until it is empty or every entry is marked out of scope by the
owner. `coverage.py` regenerates the raw list.

## Not reachable with our account

Screens other roles see that our account cannot open. Ask the owner for
screenshots or a sandbox user with that role.
