---
name: ticketing-client-onboarding
description: Use when adding the support/ticketing experience to one of our CLIENT apps and connecting it to the central Automate Anything control plane (the Meridian ticket hub) - the avatar→Support→submit widget with screen-snip/paste/drag screenshots, filing into the hub, and receiving status/reply updates back. The rollout playbook to onboard each client app; theme-matched per app. For building a standalone in-app ticketing system from scratch instead, use the `ticketing-system` skill.
---

# Onboard a client app to the ticketing control plane

## Overview
The central hub (Meridian) already owns tickets, notifications, the agent
approvals inbox, and the autonomous coding agent. This skill connects one **client
app** to it: an embedded **Support widget** (identical everywhere, matched to that
app's theme) files tickets into the hub and receives updates back - hybrid, so the
hub is the source of truth and the client app keeps a local mirror. Do this once
per client app.

**Architecture:** browser widget → the client app's OWN backend (holds the hub API
key) → hub `/api/v1/tickets`. The hub → the client app's webhook receiver on
changes. The browser never holds a hub secret.

## The five onboarding steps

### 1. Provision a hub API key for this app
In Meridian: **Admin → Settings → API Keys → create key**. Scopes: **`tickets:read`
+ `tickets:write`**. ⚠️ Key creation currently requires an associated admin/dev
user (or `act_as_developer`) - associate the automation/admin account. Copy the
plaintext `mer_…` **once** into the client app's server env (e.g.
`MERIDIAN_TICKETS_API_KEY`) plus `MERIDIAN_URL`. One key per client app = its tenant
boundary.

### 2. Build the Support widget in the client app
Follow `references/support-widget.md`: avatar→Support→**Submit a ticket** →
bottom-right dialog; attach / drag / **paste** / **snip** (the `getDisplayMedia`
hide→capture→reopen flow); auto-capture URL + app version + browser/OS into
`reporter_context`. **Match the host app's theme/tokens** - never a pasted-in look
(see the `ticketing-system` skill's `theme-adaptation.md`). There is NO shared
widget package - each app builds its own against the API (reuse `booking_pro_saas`
as the reference and dodge the bug being fixed there).

### 3. Wire the backend proxy + attachments
Follow `references/hub-integration.md`: a server route (session-authed as the
end-user) that creates the ticket (`POST /tickets` + `Idempotency-Key`), then
uploads each screenshot/file (`multipart POST /tickets/<id>/attachments`, ≤25 MB),
returns the `display_id`, and stores a local mirror. Key stays server-side.

### 4. Register the down-webhook + the repo
- **Down-webhook** (so status/replies flow back): add a `ticket_app_webhooks` row
  for this app's `app_key_id` + `company_id` + receiver `url`, with an
  envelope-encrypted secret. ⚠️ There's no admin UI yet, and the secret can't be
  plain-SQL inserted (it's vault-encrypted) - call the existing provisioner from a
  one-off Meridian server script:
  `await upsertWebhook(serviceClient, { companyId, appKeyId, url, secret, createdBy })`
  (`apps/web/src/server/tickets/webhook-config.ts`). *Recommended follow-up: add a
  small admin action/UI that calls `upsertWebhook` so this isn't manual.* Then build
  the **receiver** in the client app (verify `x-meridian-signature`, dedup on
  `event_id`, update the mirror) per `hub-integration.md`.
- **Repo allowlist** (so the agent may work this client's tickets): Meridian **Admin
  → Control Plane → Repos → add** the client's `owner/name` + `company_id` +
  `default_branch` + `deploy_target`.

### 5. Verify the round-trip
Run `references/acceptance-tests.md` end-to-end: submit + snip from the client app →
ticket + screenshot appear in the hub and notify the agency → a hub status/comment
change reaches the client app and the end-user. On all viewports, light + dark.

## References
- `references/support-widget.md` - the widget + screen-snip (stack-neutral, theme-matched).
- `references/hub-integration.md` - the exact hub API + down-webhook contract (auth, endpoints, payloads, signing, gaps).
- `references/acceptance-tests.md` - the user-verifiable done checklist.

## Gotchas (verified against the built hub)
| Gotcha | Do this |
|---|---|
| Webhook has no admin UI; secret is encrypted | Register via a one-off `upsertWebhook(...)` script; add a UI action as follow-up |
| API key needs an associated user | Associate the automation/admin account when minting |
| Ticket→company is set at triage, not at ingest | Register the webhook with `company_id`; adopt a prompt-triage convention |
| Hub migrations are operator-applied | Ensure `0162/0163/0167` are applied + types regenerated before testing |
| Webhook delivery is best-effort (2 tries, no backoff) | Make the receiver idempotent; poll `GET /tickets/<id>` for critical state |
| Browser can't silently snip the OS | The picker prompt is expected; Safari degrades to paste/drag (feature-detect) |

## Do NOT
- Put the hub API key in the browser - proxy through the client app's backend.
- Send `company_id` on create (ignored) or trust a webhook before verifying its signature.
- Reduce the client's submit options, or copy another app's theme.
