---
name: scripted-admin-actions
description: The pattern for giving an AI agent (or an operator) a SAFE scripted path to do admin / superadmin actions - extend a customer's trial, change or comp a plan, reactivate a subscription, look up or refund a charge, void a payment, send an approved support reply, provision a resource - WITHOUT a UI login and WITHOUT a server shell. It covers the internal endpoint that reuses the proven admin handlers unchanged, the shared-secret and environment setup, the read vs mutate split, dry-run by default with an explicit confirm flag, preview first, audit notes, disambiguation, verify-after, and the rule that the owner approves every customer-affecting action. Read this whenever a customer asks for more trial time, a plan change, a comped free window or a refund (common in the support flow), whenever you need a customer's live plan / trial / subscription / charge state fast, and BEFORE building any script or internal endpoint that lets an agent perform a privileged action. Use when the user mentions extend trial, more trial days, comp, give free time, change plan, reactivate, refund, cancel a charge, void a payment, list cards, "put them back on <plan>", trial expired, an internal tool secret, an agent endpoint, "do what the admin portal does from a script", or "without logging in".
---

# Scripted Admin Actions

> ## Adapt before use
> This describes how an agent's admin path SHOULD be wired, taken from a
> production SaaS where an agent handles trial extensions, plan changes and
> refunds from a script. The script name, endpoint path, flags and env var names
> below are EXAMPLES of the shape. Grep the repo first: if the script and the
> endpoint do not exist, this skill is the design to build; if they exist under
> other names, the code wins. Once built, replace the examples with the real
> commands. Only the NAMES of secrets ever go in this file, never the values.

A customer asks "can I have a few more days on my trial?" or "please refund that charge." The
admin portal can do it, but an agent has no login and should not be handed one, and a server shell
is the wrong tool. The answer is a guarded door: a script that calls an internal endpoint, which
calls the SAME handlers the portal calls.

---

## The one rule

**These actions move a real customer's live money and subscriptions. Investigate and preview, then
act only on the owner's explicit approval of THAT action.** Never comp, change a plan, extend a
trial, or refund on your own initiative, however reasonable the request looks. Always preview
first. Always dry-run before applying. This is the same rule zero as `support-triage`: "go ahead
and handle the queue" picks what you work on, it does not approve a refund.

---

## The pattern (five parts)

### 1. One internal endpoint, zero reimplemented logic

Add ONE internal route (example: `POST /api/internal/agent-<domain>`) that accepts an `action`
name and parameters. For every mutation it calls the EXISTING proven handler, in process, with a
signed internal-service token, exactly the way the admin portal's server calls it in production.

- Plan and trial actions -> the existing admin subscription handlers (change plan, reactivate).
- Refund and void -> the existing internal refund and cancel-payment handlers.

**Do not re-implement a mutation in the script or in the new route.** The portal's handler already
carries the invariants, the processor calls, the ledger rows and the audit trail that took months
to get right. A second implementation drifts, and the day it drifts is the day it moves money
wrong. The new route is a door, not a room.

### 2. Authentication: a shared secret, by name only

- The script reads two environment variables (example names): `INTERNAL_TOOL_SECRET` and a base
  URL such as `ADMIN_TOOL_URL`.
- Reuse the secret an existing internal read tool already uses rather than minting another.
- Values live in the local env file and the host's secret store. NEVER in a skill, a doc, a script
  default, a commit, or a chat message.
- The endpoint rejects any request without the secret and is not reachable through the public API
  gateway or any customer-facing route.

**Know which environment the URL points at.** In the reference system the default was PRODUCTION
(live payment processor) and staging was a different host. Print the target host at the top of
every run so "which environment did that hit" is never a question.

**Deployment gotcha:** the endpoint lives in the server, so to act on a live customer the route
must already be RELEASED to production. A script that exists locally against a route that is only
on staging does nothing useful for a real customer. Until it is released, the action is done in
the portal by the owner.

### 3. Read vs mutate, and dry-run by default

- **Read actions need no confirm:** preview (plans, trial state, subscription ids), find recent
  charges, one charge's live detail, cards on file.
- **Every mutation is a DRY RUN unless `--confirm` is passed.** The dry run prints exactly what
  would change (current value, new value, which subscription, which charge and amount) and touches
  nothing.
- The safe default must be the one you get by forgetting a flag. Never invert it into
  `--dry-run`.

### 4. Preview, disambiguate, then apply

```
# read-only: plans, trial state, subscription ids (accepts an account id or an exact name)
admin-action --preview --account "<account name or id>"

# dry-run an extension (shows what would change, touches nothing)
admin-action --account <id> --days 7 --plan "<plan name>"

# apply it, with an audit note
admin-action --account <id> --days 7 --plan "<plan name>" --confirm --notes "1 week, asked in support request 12"
```

- When the preview shows MORE THAN ONE active subscription (for example one per location), the
  mutation REQUIRES an explicit `--subscription <id>`. Never let the tool pick.
- Accept a human-readable target (an exact account or plan name) for preview, but resolve it to an
  id and show the id back, so the apply step runs against an id you saw.
- `--notes "..."` is the audit trail: who asked, where, why. Always pass it on a mutation.

### 5. Verify after, and report with evidence

After applying, run the preview again and confirm the new state. Report the before and after
values, not "the script exited 0." The same goes for a sent support reply: confirm the stored
reply row and the outbound email log entry.

---

## Domain rules that came with the billing actions

Keep these, they are the gotchas the handlers encode.

**Trial / plan**

- **Free days = deferring the first charge.** `--days N` sets "billing starts at now + N days":
  full access, no charge until then. If there is no card by then, the processor cancels cleanly
  onto the free plan. The customer is never dunned for a comped window.
- **A deferral does nothing on a $0 plan.** Extending a trial for an account currently on the free
  plan REQUIRES naming the paid plan to put them on. Omit the plan on an already-paid plan to keep
  it and just add days.
- **Change plan** can apply immediately or deferred (with `--days`), monthly or yearly cycle
  (default monthly).
- **Reactivate** revives a canceled subscription, optionally with free days.

**Payments**

```
admin-action --find-charges --account <id> [--limit 20]      # recent charges
admin-action --charge-detail --charge <chargeId>              # one charge, live from the processor
admin-action --list-cards --account <id>                      # cards on file

# refund (full unless --amount, in cents): the dry run shows the LIVE charge first
admin-action --refund --charge <chargeId> --reason "duplicate"
admin-action --refund --transaction <txId> --reason "duplicate" --confirm [--amount 5300]

# void an UNCAPTURED payment (a captured charge must be refunded, not canceled)
admin-action --cancel-payment --charge <chargeId> --reason "abandoned" --confirm
```

- **Read the processor's truth before a refund.** The dry run fetches the live charge so you
  refund what was actually captured, not what a local row claims.
- **Captured charges are refunded; only uncaptured ones can be canceled.** Picking the wrong verb
  fails at the processor.
- **Amounts are integer cents.** A refund is full unless an amount is given.
- **A reason is required** on every refund and void.

---

## The same pattern for non-billing actions

The same five parts apply to any privileged action an agent needs.

- **Sending an approved support reply.** The script calls the SAME endpoint as the admin board's
  Send button, so storage, the customer email and the email log all happen the normal way. It
  authenticates by opening a one-off server-side login as a named staff user (default the owner,
  a flag to change it) and signs that session out when done. It refuses text that breaks house
  rules (an em dash or en dash). The approved text is passed as a file path, not inline.
- **Closing a request by direct SQL.** When a script takes a shortcut around the UI handler, write
  down exactly which side effects it SKIPS (the "resolved" email) and which it still TRIGGERS (a
  queued satisfaction survey), and give a flag to suppress the latter. A shortcut with undocumented
  side-effect differences is how a customer gets a survey about a duplicate ticket.
- **Provisioning a paid resource** (a phone number, a sending registration). `--list` to see state,
  one flag per capability, dry-run unless `--confirm`. "Done" is defined by what `--list` shows
  afterwards, not by the buy command succeeding.

---

## Building checklist (when the door does not exist yet)

1. List the actions the agent actually needs. Split them into read and mutate.
2. Find the existing handler for each mutation. If none exists, build it for the portal FIRST;
   the script only ever reuses.
3. Add the internal route: secret check, action switch, in-process call to the handler with the
   internal-service token, `dry_run` honored for every mutation.
4. Write the script: env by name, target host printed, preview action, dry-run default,
   `--confirm`, `--notes`, required disambiguation, required `--reason` on money.
5. Make sure the handler's audit row records that the action came through the agent path, plus
   the note.
6. Wire failures into the error/alert system (`error-alert-system`). A swallowed failure on a
   refund path is a silent production bug.
7. Test on staging against a throwaway account. Then get the route released to production by the
   owner before relying on it.
8. Write the real commands into this skill, names only for secrets.

## What this path must never become

- A way to skip the owner's approval. The script is faster hands, not broader authority.
- A general "run any admin action" endpoint. Each action is named and maps to one handler.
- A second implementation of money logic.
- A place a secret gets written down.
- An excuse to SSH into a server or to ask the owner for their login.

Related skills: `support-triage` (rule zero and the reply/resolve scripts), `money-truth-doctrine`
(money invariants, processor as the source of truth), `error-alert-system`,
`stripe-best-practices` (when the processor is Stripe).
