---
name: whatsapp-self-hosted-evolution
description: >-
  The complete, exact guide to connecting a product to WhatsApp through a SELF-HOSTED Evolution
  API stack (Evolution API on the Baileys library, acting as a WhatsApp linked device / companion
  device), with a real production implementation next to it in reference-impl. Covers the pinned
  Docker image and every environment variable, the dedicated service with its own Postgres and
  Redis, every Evolution REST call with real JSON bodies (create instance, QR, pairing code,
  connection state, send text / media / voice note, status, mark read, presence, fetch media,
  logout, delete, set proxy), the inbound WhatsApp webhook and its payloads, the normalizer, echo
  suppression, the 413 body-size fix, the 400-versus-404 media case, connection states, bans,
  session storage, the app-side tables, a go-live checklist, a test rig, build-time Baileys
  patches (the app-state resync loop fix, with its proof test), and every landmine hit in
  production. Read it BEFORE building or touching anything Evolution or Baileys. Use when the
  user mentions Evolution, Evolution API, Baileys, self-hosted WhatsApp, an Evolution instance,
  QR, pairing code, linked device, companion device, WhatsApp webhook, "couldn't link device",
  "Invalid proxy", QR re-scan after a deploy, messages.upsert, connection.update, fromMe echoes,
  @lid or @s.whatsapp.net JIDs, findMessages, syncFullHistory, "do WhatsApp messages need a
  database", or "our own WhatsApp, stop paying per channel".
---

# WhatsApp via self-hosted Evolution API: the exact guide

> ## Adapt before use
> `reference-impl/` next to this file is ONE real product's production code, copied from a live
> system and scrubbed of secrets and hostnames. It will not compile on its own (it imports that
> product's config, database client and error reporter). Its table names (`whatsapp_channels`,
> `communication_map`, `evolution_proxies`, `whatsapp_provider_overrides`, `chat_messages`), its
> route paths (`/api/evolution/inbound`, `/api/whapi/*`), its instance-name prefix, its Redis key
> prefix and its app-side env var names are EXAMPLES. Evolution's own env vars, endpoints, body
> fields and event names in this skill are real and were read from that code, not from memory.
> They are from the v2.3.7 line of Evolution: check the version you actually run. When this
> document and the code disagree, the code wins. This is a ban-sensitive domain: prove everything
> on a spare number before a customer touches it. Once the system exists in your repo, replace
> the example names here with your real ones.
>
> Related: `references/api-calls.md` (every REST call), `references/webhook-payloads.md` (every
> inbound payload), `references/proxy-pool.md` and the `iproyal-proxies` skill (proxies),
> `whapi` (a managed alternative).

## 1. What this is, in plain words

WhatsApp lets a phone link extra devices (Settings, Linked Devices, Link a Device). WhatsApp Web
is one. A **linked device**, also called a **companion device**, logs in by scanning a QR code or
typing a pairing code on the phone. After that it sends and receives as that phone's real number,
and the phone stays the owner of the account.

- **Baileys** is an open source library that speaks the linked-device protocol over a plain
  WebSocket. No browser, a few MB of memory per number.
- **Evolution API** is a REST server built on Baileys. It runs many numbers at once (each one is
  an "instance"), gives you HTTP endpoints to send, and POSTs a webhook to you when something
  arrives. This skill self-hosts it.

How it differs from the alternatives:

| | Official WhatsApp Cloud API (Meta) | Managed companion host | Self-hosted Evolution (this) |
|---|---|---|---|
| Number | A dedicated business number on Meta's API | The customer's own number | The customer's own number |
| Approval | Meta business verification, templates | None | None |
| Cost | Per conversation | About $25 per number per month | Flat hosting plus about $2 to $6 per number for a proxy |
| Who holds the session | Meta | The vendor | You |
| Ban risk | Low, it is the sanctioned route | Yours | Yours |

The trade-offs you accept:

- **It is unofficial.** WhatsApp can ban a number that behaves like a bot or shares an IP with
  flagged numbers. Your send-rate caps and a dedicated IP per number (section 6) are the
  protection. Nothing removes the risk.
- **You own the uptime.** If you lose the session store, every customer must scan a QR again.
- **WhatsApp rotates its web version.** A stale version makes pairing fail until you bump one
  env var (section 3).
- **Why Evolution and not the others:** raw Baileys means building the whole multi-number
  gateway yourself, and WAHA puts multi-session behind a paid license.

**A fork warning.** The reference implementation's deploy files pin the UPSTREAM image, but
several code comments say "our fork of Evolution". These behaviors need patches that are NOT in
reference-impl: decrypting edits into a `messages.edited` event, status text font codes 0 to 10
and `textColor`, `statusJidList` on a status delete, status view receipts, and a retry inside
Evolution's own proxy test. On the stock image the rest of this guide works and those five do
not. Each is marked "(fork)" where it appears.

## 2. Architecture

```
 customer phone (owns the number)
        |  linked-device protocol, WebSocket
        v
 [ Evolution service ]  one container, pinned image, always on, port 8080
        |         \
        |          \-- its own Postgres: instance registry + short-lived message copy
        |           \- its own Redis:   session credentials (in this config)
        |
        |  REST in  (header: apikey)        webhook out (POST JSON)
        v                                          |
 [ your app server ] <-----------------------------/
        |  your database: one channel row per instance, your own message table
```

Rules that shaped it:

1. **Evolution runs as its own service**, never inside your backend. It holds one long-lived
   socket per customer. It must not starve payment, webhook and cron paths, and it must not
   restart every time you deploy the backend.
2. **Evolution gets its own Postgres and its own Redis**, separate from your app database.
3. **One Evolution instance is one row in your channels table.** The instance name is the key
   that joins the two worlds.
4. **Your app owns the lifecycle.** Evolution never deletes an instance on its own
   (`DEL_INSTANCE=false`). Your database is the source of truth.
5. **Inbound is a webhook.** Evolution POSTs events to one URL on your server. You answer 200
   at once and process afterwards.
6. **Keep your own message table.** Evolution's store is a short-lived copy used only to fetch
   media by message id (section 10).

## 3. Stand up the Evolution service

Files: `reference-impl/deploy/docker-compose.yml` (local), `render.yaml` (hosted),
`.env.example`, `README.md`, `GO_LIVE_CHECKLIST.md`.

### 3.1 The image, and why it is pinned by digest

```
evoapicloud/evolution-api@sha256:966625532d9076a2381e973a271307d107e6f070450de3abeeea8bd18be07252
```

This is the v2.3.7 image.

- **Use `evoapicloud/evolution-api`.** The older `atendai/evolution-api` image is delisted, and
  its v2.2.3 can no longer pair a device (WhatsApp rejects the link).
- **Pin by digest, never `:latest`.** The session schema changes between Evolution versions, so
  a surprise upgrade can drop every linked phone. Bump the digest deliberately, after testing on
  a spare number, and bump `CONFIG_SESSION_PHONE_VERSION` in the same change.

### 3.2 Every environment variable on the Evolution service

Values are the ones the production system runs with.

| Variable | Value | What it does, and what breaks without it |
|---|---|---|
| `AUTHENTICATION_API_KEY` | long random, `openssl rand -hex 32` | The global admin key. Your app sends it as the `apikey` header. Must equal your app's Evolution key. |
| `SERVER_URL` | the service's public URL | Evolution's own address. On a host that assigns the URL after creation, create the service first, then set this and redeploy. |
| `CONFIG_SESSION_PHONE_VERSION` | `2.3000.1043857760` when written | REQUIRED. Must be a CURRENT WhatsApp Web version. Stale, and the phone shows "couldn't link device". The value here WILL be stale when you read this: look up the current one. Bump it whenever WhatsApp rotates. |
| `DATABASE_ENABLED` | `true` | Turns on Postgres persistence. |
| `DATABASE_PROVIDER` | `postgresql` | |
| `DATABASE_CONNECTION_URI` | Postgres connection string | Use the internal URL of a managed, backed-up database. |
| `DATABASE_CONNECTION_CLIENT_NAME` | `evolution_app` | The name instances are stored under. It decides which instances a server loads at boot. Never change it on a live system. |
| `DATABASE_SAVE_DATA_INSTANCE` | `true` | Persist instances. Mandatory. |
| `DATABASE_SAVE_DATA_NEW_MESSAGE` | `true` | REQUIRED. With `false` Evolution keeps no message, so fetching media or a voice note by id fails with "Message not found". |
| `DATABASE_SAVE_MESSAGE_UPDATE` | `false` | Receipts are not stored in Evolution. You get them by webhook. |
| `DATABASE_SAVE_DATA_CONTACTS` | `true` | Needed by `POST /chat/findContacts`, which the status feature uses to build its audience. |
| `DATABASE_SAVE_DATA_CHATS` | `false` | Not used. Keeps the database lean. |
| `CACHE_REDIS_ENABLED` | `true` | Turns on Redis. |
| `CACHE_REDIS_URI` | Redis connection string | Internal URL. |
| `CACHE_REDIS_PREFIX_KEY` | `evolution_bp` (example) | Key prefix. Changing it orphans every stored session. |
| `CACHE_REDIS_SAVE_INSTANCES` | `true` | With this on, session credentials live in Redis (section 7). |
| `CACHE_LOCAL_ENABLED` | `false` | No in-process cache. |
| `WEBHOOK_GLOBAL_ENABLED` | `false` | The webhook is set per instance at create time, not globally. |
| `DEL_INSTANCE` | `false` | Evolution must never delete an instance itself. |
| `QRCODE_LIMIT` | `30` | Stop regenerating the QR after 30 tries so a never-scanned instance does not spin forever. |
| `LOG_LEVEL` | `ERROR` | |
| `LOG_COLOR` | `false` | |

### 3.3 Hosting

- **Local test.** `cd reference-impl/deploy`, copy `.env.example` to `.env`, set
  `EVOLUTION_API_KEY`, run `docker compose up -d`. Evolution is at `http://localhost:8080` with a
  throwaway Postgres 16 and Redis 7. Never use those two containers in production.
- **Production** (the reference used Render; any container host works):
  1. A web service that deploys the pinned image. It listens on port **8080**. Health check path
     `/`. A paid always-on plan (a plan that sleeps drops every session). The reference started
     on a "standard" size because sockets live in memory. Scale up as numbers grow.
  2. A managed Postgres 16. **Turn daily backups on.**
  3. A managed Redis-compatible store, configured with **no eviction and with snapshots** and
     reachable only from the private network.
  4. Put all three in the same region as your app server.
  5. Confirm it is up: `GET https://<your-evolution-service>/` returns Evolution's info JSON.
     An admin UI is served at `/manager`.

### 3.4 The admin API key and your app's config

One secret is shared: Evolution's `AUTHENTICATION_API_KEY` equals your app's Evolution key.

App-side settings (the names are the reference product's; yours may differ):

| App env var | Meaning |
|---|---|
| `EVOLUTION_API_URL` | Evolution base URL. Unset (or the key unset) and the client fails closed: every call returns "Evolution API not configured" and no request is made. |
| `EVOLUTION_API_KEY` | The same value as `AUTHENTICATION_API_KEY`. |
| `EVOLUTION_INBOUND_WEBHOOK_URL` | The URL Evolution POSTs to, for example `https://api.example.com/api/evolution/inbound`. Evolution must be able to reach it: for a local app server against a hosted Evolution, use a tunnel. |
| `EVOLUTION_WEBHOOK_SECRET` | Optional. Turns on a per-instance token in the webhook URL (section 5.2). Unset means the URL's secrecy is the only guard. |
| `WHATSAPP_NEW_CHANNEL_PROVIDER` | Only if you also run a managed provider: which one NEW connections use. Unset means the managed one. |
| `EVOLUTION_PROXY_MODE` | `off` (default, every number shares the host IP, test only) or `required` (section 6). |

The file that reads these and holds their defaults (`config/env.ts`) is not covered by the
reference implementation. The names above come from its deploy docs and the `config.*` reads.

### 3.5 Patch the Baileys library at build time (the app-state loop fix)

Some bugs live in Baileys itself, not in Evolution, so no Evolution setting or API call can fix
them. Patch the installed library while the image is built. Files: `reference-impl/patches/`.

**The bug every Evolution 2.3.7 install has.** Baileys keeps a linked device's app state
(labels, mutes, pins, archive) in step with a loop in `resyncAppState`
(`node_modules/baileys/lib/Socket/chats.js`) that runs until every collection says it is done.
Each pass sends one query. When WhatsApp does not answer within 60 seconds, the query resolves
`undefined` instead of failing, that decodes to `{}`, and every way out of the loop is inside the
`for` over the decoded answer, which never runs on `{}`. Result: one blind query every 60
seconds for as long as the socket lives (about 1,000 a day per number, all through that number's
proxy, which is exactly the kind of odd traffic that gets a number flagged). An answer with no
collections in it spins the loop with no wait at all. Read and run against baileys
`7.0.0-rc.9` (inside the v2.3.7 image) and `7.0.0-rc13`; both have it.

**The fix:** an empty answer ends that sync pass, with one warning in the log. WhatsApp's next
`server_sync` notification, or the next connect, runs the sync again. Where it came from: OpenWA
(`github.com/rmyndharis/OpenWA`, MIT, `scripts/patch-baileys-appstate.js`), a separate
open-source WhatsApp gateway on the same two libraries. Its `docs/29-engine-capability-matrix.md`
lists every library bug it patches, and is worth re-reading when you bump Baileys.

**How the patch is built** (`patch-baileys-appstate-resync-loop.mjs`), the pattern for any
library patch:
- It replaces two exact lines and adds a marker comment.
- Marker already there: it does nothing (safe to run twice).
- Target not found exactly once: it exits non-zero, which fails the Docker build, so a Baileys
  upgrade can never silently ship without it. A failure there means "re-check whether the bug
  is still there", not "delete the patch".
- It prints one `[patch] baileys <version>: ...` line, so the deploy's build log proves it ran.

**Wire it in, one of two ways:**
- **Stock pinned image:** `reference-impl/patches/Dockerfile.patched-image` builds `FROM` the
  pinned digest and runs the patch in `/evolution`. This works because Evolution's build keeps
  dependencies external: Baileys is read from `/evolution/node_modules` at runtime.
- **Building Evolution from source** (a fork, or upstream at a tag plus your own patches): run
  `node <path>/patch-baileys-appstate-resync-loop.mjs` in the build stage right after `npm ci`
  and before `npm run build`. A patch that changes upstream's `src` can be a `git apply`
  diff; this one cannot, because `node_modules` does not exist until `npm ci` has run.

**Prove it:** `patch-baileys-appstate-resync-loop.test.cjs`, run with `node --test` from the
folder that holds `node_modules` after the patch. It cuts the real loop out of the installed
`chats.js` and runs it with the library's own `extractSyncdPatches` against a stand-in WhatsApp
that never answers: 1 query, then it ends. With the fix taken back out, the same loop keeps
querying until the test stops it. Green on rc.9 and rc13.

**Deploying it restarts the service**, which reconnects every number (section 7.3). Ship it when
no one is connected or off-peak. After the deploy, confirm the `[patch]` line in the build log
and that numbers came back connected. What only a live number shows is how often WhatsApp leaves
a sync unanswered: the log line `app-state sync got an empty answer, ending this pass` marks each
time.

## 4. Talking to Evolution

The single file that knows Evolution's REST shape is
`reference-impl/server/whatsapp/evolution/evolutionClient.ts`. Copy its discipline: one module,
never throws, returns `{ ok, status, body, error, networkError }`.

### 4.1 Request basics

- Base URL plus path. Every instance-scoped path ends in the URL-encoded instance name.
- Headers on EVERY call: `apikey: <key>`, `content-type: application/json`,
  `accept: application/json`.
- **Which key.** `apikey` is the per-instance token when you have it, else the global admin key.
  Create and list always use the global key. The per-instance token comes back from create.
- Timeout 20 seconds by default. `findContacts` uses 30 seconds, status sends 120 seconds.
- **Recipient numbers are bare digits**: no `+`, no `@s.whatsapp.net`. The client strips
  anything after `@` and every non-digit.
- **Errors are nested.** Evolution v2 is NestJS, so the reason for a 400 is at
  `response.message` (usually an ARRAY of strings), or a top-level `message` array, or a
  `response` string, or `error`. Read all four or every alert says only "Evolution 400". The
  reference system had 25 failed creates behind opaque alerts before this was fixed.

### 4.2 The calls (full bodies and responses in `references/api-calls.md`)

| What | Method and path | Body |
|---|---|---|
| Create instance | `POST /instance/create` | `instanceName`, `qrcode`, `integration`, `webhook`, optional `number`, optional top-level proxy fields |
| Set webhook | `POST /webhook/set/{instance}` | `{ "webhook": { ... } }` |
| Get QR | `GET /instance/connect/{instance}` | none |
| Get pairing code | `GET /instance/connect/{instance}?number=<digits>` | none |
| Connection state | `GET /instance/connectionState/{instance}` | none |
| List instances | `GET /instance/fetchInstances` | none |
| Restart socket | `POST /instance/restart/{instance}` | none |
| Logout | `DELETE /instance/logout/{instance}` | none |
| Delete instance | `DELETE /instance/delete/{instance}` | none |
| Set or clear proxy | `POST /proxy/set/{instance}` | `enabled`, `host`, `port`, `protocol`, `username`, `password` |
| Send text | `POST /message/sendText/{instance}` | `number`, `text` |
| Send image, video, document | `POST /message/sendMedia/{instance}` | `number`, `mediatype`, `media`, `caption`, `fileName`, `mimetype` |
| Send voice note | `POST /message/sendWhatsAppAudio/{instance}` | `number`, `audio` |
| Post a status (story) | `POST /message/sendStatus/{instance}` | `type`, `content`, `statusJidList`, optional styling |
| Typing / presence | `POST /chat/sendPresence/{instance}` | `number`, `presence`, `delay` |
| Mark read | `POST /chat/markMessageAsRead/{instance}` | `readMessages: [{ remoteJid, fromMe, id }]` |
| Fetch media by message id | `POST /chat/getBase64FromMediaMessage/{instance}` | `message.key.id`, `convertToMp4` |
| Find a stored message | `POST /chat/findMessages/{instance}` | `where.key.id` |
| List saved contacts | `POST /chat/findContacts/{instance}` | `{ "where": {} }` |
| Edit a sent text | `POST /chat/updateMessage/{instance}` | `number`, `text`, `key` |
| Delete for everyone | `DELETE /chat/deleteMessageForEveryone/{instance}` | `id`, `remoteJid`, `fromMe` (JSON body on a DELETE) |

**Not covered by the reference implementation:** sending to a group (its number helper strips a
group JID down to digits, so the client cannot address a group as written, and inbound group
messages are dropped), sending a reaction, location, contact card or sticker (the product
returns a clean 400 "unsupported type" for those), profile picture calls, group management, and
the `syncFullHistory` instance setting. Do not guess those shapes: read the Evolution source for
your version and prove them on the test rig.

### 4.3 The webhook config, built in exactly one place

Both create and set-webhook use one function (`buildEvolutionWebhookConfig`) so they cannot
drift:

```json
{
  "enabled": true,
  "url": "https://api.example.com/api/evolution/inbound",
  "byEvents": false,
  "base64": false,
  "events": [
    "MESSAGES_UPSERT",
    "MESSAGES_UPDATE",
    "MESSAGES_EDITED",
    "MESSAGES_DELETE",
    "CONNECTION_UPDATE",
    "QRCODE_UPDATED",
    "CALL"
  ]
}
```

- **`enabled` is required.** Leave it out and Evolution rejects the whole config with
  `[Validate] webhook requires property "enabled"`. The instance then runs with NO webhook: no
  inbound messages, no connection events.
- **`base64` must be `false`.** With `true`, Evolution inlines the whole media file into the
  webhook body (section 5.3).
- **`byEvents: false`** means every event goes to the one URL.
- **Deliberately NOT subscribed:** `SEND_MESSAGE` (your own outbound echoes, pure noise) and
  `CONTACTS_UPSERT` (the app ignores it, and its first-sync payload is a huge contact array that
  can exceed the body limit and count as a failed webhook).
- `QRCODE_UPDATED` and `CALL` are subscribed but the handler does nothing with them.

### 4.4 Connect a number: the order that works

The route is `createEvolutionChannel` in `reference-impl/server/routes/evolution/provision.ts`.
Each step is in this order for a reason.

1. **Refuse early if not configured** (503).
2. **Reconcile vanished instances FIRST, before any limit check.** Your database is not proof an
   instance still exists. Call `GET /instance/fetchInstances`. For every channel row whose name
   is missing from that list: unbind its routing, soft-delete the row, clear its token, release
   its proxy, raise an alert. **Only act on a successful list.** An API error tells you nothing,
   so leave every row untouched. The first version ran this AFTER the limit gate and never
   reached it, so an operator whose instance had been deleted out of band could not connect a
   replacement at all.
3. Your own limit checks (plan limit, one live channel per location, and so on).
4. **Generate the instance name:** `<prefix>_<8 chars of tenant id>_<6 chars of a seed>_<6 random
   chars>`. The random part is load-bearing. An earlier version derived the name only from the
   channel's display name, so every default-named channel got the SAME name, several rows shared
   one key, and every "exactly one row" lookup threw.
5. **Insert your channel row BEFORE calling Evolution**, so a webhook that races the create can
   find it. State `unknown`, status `pending`.
6. **Claim a proxy** if proxy mode is `required` (section 6). No free proxy: delete the row and
   answer 503. Never fall back to the shared IP.
7. **`POST /instance/create`** with the name, the webhook config, the proxy fields, and `number`
   if the user chose pairing by code.
8. If create fails: release the proxy, delete the row, alert, answer 502.
9. **Store the per-instance token** from the response on the row.
10. **Wire routing** (which tenant and location this number serves), then retire every OTHER
    live WhatsApp routing row for that location so exactly one remains (section 9, landmine 9).
11. **Answer** with the QR, or the pairing code.

Then:

- **QR.** Create returns a base64 PNG. To refresh it call `GET /instance/connect/{instance}`,
  which returns the raw QR string in `code` and the PNG in `base64`. Prefer drawing the QR from
  `code` yourself. If `instance.state` is `open`, the number is already linked. Evolution may
  return the PNG with or without the `data:image/png;base64,` prefix, so normalize it.
- **Pairing code by phone number.** `GET /instance/connect/{instance}?number=<digits>`. A fresh
  instance is not ready to mint a code for its first several seconds: the first call commonly
  returns a QR and no `pairingCode`. So poll: 4 attempts, 3 seconds apart. If still nothing,
  answer HTTP 200 with a "not ready, try again" shape and let the UI retry. The first version
  returned 502 on the first miss, which paged engineering for a normal warm-up and showed the
  user a failure screen. Pairing codes are flaky upstream: **QR is the reliable path.**
- **Linked.** Evolution sends `connection.update` with `state: "open"`. The handler marks the
  row connected, learns the phone number from `wuid`, and re-applies the webhook config.
- The user's steps on the phone: WhatsApp, Settings, Linked Devices, Link a Device, scan.

## 5. The inbound webhook

Files: `reference-impl/server/routes/evolution/inbound.ts`,
`reference-impl/server/inbound/normalizerEvolution.ts`. Payload shapes:
`references/webhook-payloads.md`.

### 5.1 The envelope and the handler order

```json
{ "event": "messages.upsert", "instance": "<your instance name>", "data": { } }
```

You subscribe with UPPER_SNAKE names and receive lower.dot names: `MESSAGES_UPSERT` arrives as
`messages.upsert`. The handler lowercases `event` before comparing. `data` can be one object or
an array: handle both.

Order inside the handler:

1. Verify the URL token if a secret is configured. Reject with 401 BEFORE the ACK.
2. **Answer `200 {"ok":true}` immediately**, then process. Evolution retries a non-200.
3. No `instance` in the body: alert (a misconfiguration) and stop.
4. Route on `event`: `connection.update`, `qrcode.updated` (ignored), `messages.update`,
   `messages.edited`, `messages.delete`, `messages.upsert`. Anything else is ignored silently.
5. Every branch runs detached with its own catch that REPORTS the error. A catch that only logs
   is a silent production bug.

For `messages.upsert`, per message, in this order:

1. No `key`: skip.
2. **Echo check:** if `key.id` is an id you recorded when sending, drop it (section 5.4).
3. Event is `send.message`: drop (defensive, it is not subscribed).
4. `key.remoteJid` ends in `@g.us`: drop (group chat).
5. `key.remoteJid` is `status@broadcast`: drop (a status, or the echo of your own status).
6. **Resolve the channel from the instance name in YOUR database.** Never trust the payload for
   which business number received the message. Unknown instance: report silently, escalate
   after 25. Known instance with no phone number yet (pairing not finished): drop and report.
7. Normalize.
8. **Drop empty envelopes:** a text-type message with no text and no reaction or reply link.
   Two known ones are `secretEncryptedMessage` (an encrypted edit) and `albumMessage` (the
   "N photos coming" header). The rule is general so a type WhatsApp adds later cannot bring
   empty bubbles back. Any other empty type is reported so a real unread type shows up.
9. Hand to your shared inbound pipeline.

### 5.2 Security: there is no signature

Evolution sends no header you control and no signature. The reference implementation offers two
levels:

- **URL secrecy only** (default). The route has no auth middleware and sits on whatever
  allowlist admits requests with no Origin header.
- **Per-instance token in the path.** Set a secret. The token is the first 32 hex characters of
  `HMAC-SHA256(secret, instanceName)`. The URL registered on each instance becomes
  `<base>/<token>`. The server mounts both `/inbound` and `/inbound/:token`, recomputes the
  token from the body's `instance`, compares in constant time, and answers
  `401 {"error":"invalid webhook token"}` on a mismatch or a missing token. Rejections are
  reported silently and escalate after 50, because a spike means YOUR config broke.

  **Turning the secret on for a live fleet:** the moment it is set, every instance still
  registered with the tokenless URL is rejected, and that includes the `connection.update` that
  would have triggered the self-heal. So right after setting it, call `POST /webhook/set` for
  every live instance (or reconnect each one through your UI) to register the tokened URL.

### 5.3 The 413 body-size problem

**What happened.** Instances were created with webhook `base64: true`. Evolution then put the
full bytes of every photo, video, document and voice note inside the webhook JSON. The app
server's global JSON parser had a 100 KB limit, so it answered 413 before the handler ran. One
in four inbound webhooks (6 of 24) failed, and those customer messages were silently lost.

**The fix, four parts, all needed:**

1. `base64: false` in the one function that builds the webhook config. Media is fetched on
   demand by message id instead, so nothing is lost.
2. Re-apply the config to existing instances: on the post-pairing "set webhook" step, and on
   every `connection.update` that says connected. Every Evolution restart reconnects every
   instance, so a config change rolls out to the whole fleet on the next deploy.
3. A path-scoped `express.json({ limit: '2mb' })` on the inbound route, mounted ABOVE the global
   small-body parser, as defense in depth. Two JSON parsers on one path do not conflict: the
   second sees the body already parsed and does nothing.
4. Drop `CONTACTS_UPSERT` from the subscription.

The mount itself lives in the app's server entry file, which is not covered by the reference
implementation. The value `2mb` and the ordering come from its deploy docs.

### 5.4 Echo suppression: the sent-message tracker

Evolution delivers every message YOU send back to you as a `messages.upsert` with
`key.fromMe: true`. A message the business owner types on their own phone looks exactly the
same. Baileys gives no marker to tell them apart. Dropping all `fromMe` loses the owner's own
replies. Keeping all of it re-ingests your own sends.

The fix (`sentMessageTracker.ts`): when a send succeeds, record the returned message id. On
inbound, drop a message only if its id is one you recorded.

- In-memory map of id to expiry. TTL **5 minutes**. Cap **5000** entries (expired entries are
  pruned first, then the oldest).
- Every send funnels through one function that records the id, so no sender can forget.
- The id is read from `key.id`, then `messageId`, then `id` of the send response.
- It is per process. If it restarts between a send and its echo, one echo gets through as a
  correctly attributed "sent from phone" message. With more than one app server instance, move
  the map to a shared store.

### 5.5 How the normalizer maps a message

Input: one `data` item plus the receiving business number from your database. Output: the same
normalized shape every other channel produces, so everything downstream is provider-agnostic.

- **Ids:** the message id is `key.id`. It is also the dedupe key, the echo key and the id used
  to fetch media. `from_me` is `key.fromMe`. The customer's number is the digits before `@` in
  `key.remoteJid`. The receiving business number is passed in from your channel row.
- **Body:** the first present of `message.conversation`, `extendedTextMessage.text`, the
  caption of an image, video or document, the emoji of a reaction, a contact card's text.
- **Type:** `audioMessage` is voice, then image, video, document, contact, reaction, else text.
- **Time:** `messageTimestamp` is in SECONDS.
- The per-shape table is in `references/webhook-payloads.md`, section 2.3.

The JID forms you will see in `key.remoteJid`:

| Form | Meaning | What the reference code does |
|---|---|---|
| `<digits>@s.whatsapp.net` | A person, addressed by phone number | Digits become the customer's phone |
| `<digits>@lid` | A person under WhatsApp's hidden-number (LID) addressing. The digits are NOT a phone number | **Gap:** the normalizer takes the digits anyway, so the "phone" is a LID. Mark-read always rebuilds `<digits>@s.whatsapp.net`. Only edit and delete handle it, by looking up the stored JID first |
| `<id>@g.us` | A group | Dropped |
| `status@broadcast` | Status (stories) | Dropped on upsert; view receipts handled on update (fork) |

**Quoted replies.** The quote context is at the TOP LEVEL of the item, `data.contextInfo`, a
sibling of `message`. It is NOT inside `message.extendedTextMessage`. A quoted text reply
arrives as a plain `message.conversation` with the quote in `data.contextInfo`. Looking only in
the nested place silently unlinked every quoted reply for weeks. Read the top level first and
keep the nested spots as a fallback.

**Media is never in the webhook.** The normalizer carries only the message id. Bytes are fetched
later with `getBase64FromMediaMessage` (section 5.7).

### 5.6 Dedupe

Evolution retries a non-200, and a slow 200 after successful processing also produces a second
delivery. The shared inbound pipeline (not covered by the reference implementation) must guard
at its top: if an inbound row already exists for (tenant, normalized message id), stop. The
source system found duplicates in production (up to 8 copies of one message) before adding the
guard and a supporting index. A unique index is the full fix.

### 5.7 Fetching media, and the 400-versus-404 case

`POST /chat/getBase64FromMediaMessage/{instance}` with `{ "message": { "key": { "id": "<id>" } },
"convertToMp4": false }` returns `{ "base64": "...", "mimetype": "..." }`.

Its two failure codes mean OPPOSITE things:

| Code | Evolution says | Meaning | Do |
|---|---|---|---|
| 400 | "Message not found" | Evolution's store has not caught up yet. Common during the history sync after a reconnect | RETRY with a long escalating backoff, and have a backfill job as a safety net |
| 404 | "instance does not exist" | The instance name is dead or you resolved the wrong one | Do NOT retry. Alert |

This was coded backwards at first: a stale instance name burned the whole backoff and every
voice note sat "pending" forever. Also, if Evolution omits `mimetype`, do not fall back to an
audio type for a photo: pick a fallback by media type (image/jpeg, video/mp4, application/pdf).

The download-and-retry code (the voice pipeline) is not covered by the reference
implementation. Only the REST call is. Build the retry schedule yourself.

### 5.8 Receipts, edits, deletes

- **`messages.update`** carries the delivery state of messages YOU sent. Skip items with
  `fromMe === false`. Read the id from `keyId`, then `messageId`, then `key.id`. `status` is
  `ERROR`, `PENDING`, `SERVER_ACK` (sent), `DELIVERY_ACK` (delivered), `READ` or `PLAYED`, or
  the numbers 0 to 5. Write through a forward-only status writer so a late "sent" cannot
  overwrite "read". A failed receipt write is cosmetic: report silently.
- **`messages.edited`** (fork): find your stored row by message id AND the channel's number,
  never by id alone, and replace its text. Skip voice notes. Unknown message: ignore.
- **`messages.delete`**: `data.id` is the message id. Mark your copy deleted, keep the text.

### 5.9 Outbound, and running beside another WhatsApp provider

The senders themselves are not in reference-impl. These are the rules they followed.

- **Branch at the transport point only, AFTER every business gate** (emergency shut-off,
  subscription state, quiet hours, anti-block rate caps, ban guard). The gates never know which
  backend sends, so they cannot drift apart. Those rate caps are still the real ban protection
  at low volume.
- **Text:** treat 401, 403 and 404 from Evolution as "channel needs re-pairing". Retry the rest.
- **Mark-read needs the sender's digits** as well as the message id, so every caller must pass
  them. A managed provider may not have needed that.
- **Unsupported types** (location, contact, sticker, reaction) answer a clean 400, not a crash.
- **One set of frontend routes.** `dispatch.ts` mounts a router on the SAME paths, BEFORE the
  other provider's routers. For a new channel it picks the backend (a per-tenant override row
  wins, else the global default). For an existing channel it reads the row's provider column.
  It either handles the request or calls `next()`. The provisioning handlers return the SAME
  response shapes the frontend already parses, so the frontend never learns a second backend
  exists. Run the same ownership check on every existing-channel route, including set-webhook.
- **Shared across backends:** the normalized message shape, the inbound pipeline, the ban
  handler, the delivery-status writer, the canonical connection-state enum, the rate caps.
- **Billing:** no per-number charge. The reference marks such a row's funding as `active` at
  insert so the managed provider's funding jobs never flag it.
- **Internal admin** (`admin.ts`, super-admin only): the proxy pool with passwords MASKED, and a
  per-tenant "enable" toggle that writes or removes the override.

## 6. Proxies: one stable IP per number

By default every instance connects to WhatsApp from the Evolution host's single IP. Once several
customers share it, WhatsApp flagging that one IP takes all of them down together. So **each
number gets its own static residential or ISP IP**: not datacenter (WhatsApp flags those), not
rotating (a changing IP breaks the linked-device session). Treat it as mandatory before a
second real customer connects. A single test number on the host IP is fine.

**The order, relative to connecting:**

1. Insert the channel row.
2. Claim a proxy for it and write the proxy URL on the row.
3. Pass the proxy INSIDE `POST /instance/create`, so the instance never opens a socket or shows
   a QR without it. The fields are TOP-LEVEL:

   ```json
   { "proxyHost": "203.0.113.10", "proxyPort": "12323", "proxyProtocol": "http",
     "proxyUsername": "<user>", "proxyPassword": "<pass>" }
   ```

   A nested `{ "proxy": { "url": "..." } }` is silently IGNORED, and the number then connects
   from your server's IP while you believe it is proxied.
4. If create fails, release the proxy and delete the row. If it failed with "Invalid proxy"
   after the retries, mark that proxy dead instead of returning it to the pool.

**Changing the proxy on a live number, with no new QR:**

```
POST /proxy/set/{instance}
{ "enabled": true, "host": "203.0.113.11", "port": "12323", "protocol": "http",
  "username": "<user>", "password": "<pass>" }

POST /instance/restart/{instance}
```

- **Different field names from create:** `host`, `port`, `protocol`, `username`, `password`
  plus `enabled`. The `proxyHost` family returns 400 ("instance requires property host, port,
  protocol"). The right names return 201.
- The change only applies when the socket reconnects, hence the restart. The WhatsApp
  credentials are stored separately from the route out, so it reconnects on the SAME session.
- To remove a proxy: `POST /proxy/set/{instance}` with `{ "enabled": false }`.
- **"Invalid proxy" is often a false alarm.** Evolution tests the proxy itself on create and on
  set. Some providers allow one source address per IP at a time and answer a bare 403 to any
  other address for about 15 seconds. So both calls retry after 8 seconds, then 12 seconds,
  before believing it. A create rejected for "Invalid proxy" leaves nothing behind on
  Evolution, so retrying under the same name is safe. Never test a proxy from your backend or
  laptop right before Evolution uses it.
- **Release the proxy when the channel is DELETED, not on logout**, so a reconnect keeps the
  same IP.

Everything else (buying IPs, fraud screening, the pool table, assignment, auto-renew, the hourly
heal job, a second provider) is in `references/proxy-pool.md` and the `iproyal-proxies` skill.

## 7. Connection lifecycle and session storage

### 7.1 States

Evolution reports three raw states, in the `connection.update` webhook and from
`GET /instance/connectionState/{instance}`. On `close` the webhook also carries a disconnect
reason code, read from `statusReason`, then `statusCode`, then
`lastDisconnect.error.output.statusCode`. Map both onto one canonical enum
(`evolutionConnectionState.ts`):

| Raw state | Reason code | Canonical | What it means |
|---|---|---|---|
| `open` | | `connected` | Linked and working |
| `connecting` | | `reconnecting` | Linking or re-syncing |
| `close` | 401 (logged out) | `needs_qr` | The phone unlinked the device. Scan again |
| `close` | 403 (forbidden) | `banned` | WhatsApp banned the number |
| `close` | 515, 428, 408 | `reconnecting` | Transient. Baileys reconnects by itself |
| `close` | anything else | `disconnected` | Dropped. Includes 440 (replaced), 500 (bad session), 411 |
| anything else | | `unknown` | |

The polling call returns no reason code, so a `close` seen by polling is always `disconnected`.
Only the webhook can tell you `needs_qr` or `banned`.

### 7.2 What the handler does on each

- **connected:** mark the row connected, clear any pending "disconnected" notice, learn the
  phone number from `data.wuid` (else `data.me.id`: digits before `@`), copy it to the routing
  row, re-apply the webhook config, turn proxy auto-renew ON.
- **needs_qr, disconnected, banned:** mark the row, stamp the disconnect time, turn proxy
  auto-renew OFF.
- **reconnecting, unknown:** write the state only. Do not notify anyone.
- **banned (403):** call the shared ban handler: detach the number from all routing, mark it
  banned and not reconnectable, send ONE alert.
- If the state write itself fails, REPORT it. A failed write here means a real ban silently
  goes unrecorded.

### 7.3 Logout, delete, restart

- **Logout** (`DELETE /instance/logout/{instance}`) drops the link and keeps the instance. Row
  becomes `needs_qr`. The proxy is kept. Reconnecting uses the same instance.
- **Delete** (`DELETE /instance/delete/{instance}`). A 404 means already gone, which is fine.
  Any other failure: change NOTHING in your database, so the operator can retry. On success
  unbind routing, soft-delete the row, clear the token, release the proxy. Then verify: Evolution
  acknowledges a delete before teardown finishes, so a single immediate check false-alarmed on
  every delete. Check the instance list after 1.5, 3 and 5 seconds and alert only if it is
  DEFINITELY still listed after all three. A failed list call is inconclusive, not a leak.
- **Restart** (`POST /instance/restart/{instance}`) reconnects on stored credentials with no
  QR. Use it to apply a proxy change or nudge a stuck session.
- **Redeploying Evolution** reconnects every instance at once (a "conflict: replaced" storm).
  Messages sent in that window can be lost. Deploy off-peak.

### 7.4 Where the session lives, and why you never wipe it

- **Postgres** holds the instance registry (name, token, status, filed under the client name)
  and the short-lived message copy.
- **Redis** holds the linked-device SESSION CREDENTIALS when `CACHE_REDIS_ENABLED=true` and
  `CACHE_REDIS_SAVE_INSTANCES=true` (the config above). This was verified in the Evolution
  v2.3.7 source by the system's owners. Without that setting the credentials live in Postgres.
- The reference deploy files still carry comments saying "sessions live in Postgres" and call
  Redis a "cache". Those comments predate that finding.

**So treat BOTH stores as non-disposable.** Losing either, or pointing a server at a different
Redis URI, a different key prefix or a different client name, means every customer scans a QR
again. Back both up daily. Never wipe either volume. Never run Redis with an eviction policy.

## 8. The app-side database (examples of the shape)

The reference implementation contains the proxy table's SQL (`reference-impl/sql/`) but NOT the
migrations for the tables below. These shapes are reconstructed from the columns the code reads
and writes. Names are examples.

```sql
-- EXAMPLE. One row per connected WhatsApp number. One row is one Evolution instance.
CREATE TABLE whatsapp_channels (
  id                      bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  company_id              uuid NOT NULL,          -- tenant
  channel_name            text,                   -- display name
  provider                text NOT NULL DEFAULT 'evolution',  -- discriminator if you run two backends
  evolution_instance_name text,                   -- the Evolution instance name, your stable key
  channel_id              text,                   -- same value again, if legacy lookups key on it
  channel_token           text,                   -- per-instance token from create; NULL after delete
  phone_number            text,                   -- digits, learned from connection.update
  connection_state        text NOT NULL DEFAULT 'unknown',
     -- connected | reconnecting | needs_qr | disconnected | banned | unknown
  connection_checked_at   timestamptz,
  evolution_proxy_url     text,                   -- NULL means the host IP
  lifecycle_state         text,                   -- 'deleted' when soft-deleted
  deleted_at              timestamptz,
  disconnected_at         timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);
-- One live row per instance name.
CREATE UNIQUE INDEX ON whatsapp_channels (evolution_instance_name) WHERE deleted_at IS NULL;
```

- **Routing table** (`communication_map` in the reference): tenant, location, `channel =
  'whatsapp'`, a foreign key to the channel row, the phone number, `active`, `is_deleted`.
  Enforce at most ONE live WhatsApp row per location.
- **Your message table** (`chat_messages` in the reference): at least the normalized message
  id, the business number, the customer number, direction, body, media type and status,
  delivery status and its timestamp, `edited_at`. Index (tenant, message id) for the dedupe
  guard. Look rows up by message id AND business number, never by id alone.
- **Proxy pool table:** real SQL in `reference-impl/sql/`. Service-role only, because the URLs
  carry credentials. Described in `references/proxy-pool.md`.
- **Provider overrides table** (only if you roll out per tenant next to a managed provider):
  tenant id as primary key, `provider`, `note`, `updated_at`. Service-role only. **Write the
  REVOKE.** The source system enabled row security on this table but forgot
  `REVOKE ALL ... FROM anon, authenticated`, leaving full grants behind an empty policy set.

## 9. Landmines, each with the failure behind it

1. **Proxy fields are top-level on create and renamed on set-proxy.** Nested `proxy.url` was
   silently ignored, so numbers connected from the server IP while everyone believed otherwise.
2. **400 versus 404 on media fetch mean opposite things.** Coded backwards, every voice note
   parked as pending forever (section 5.7).
3. **`webhook.enabled` is required.** Without it there is no inbound at all, and nothing errors
   on your side. It was found only in Evolution's own logs.
4. **Webhook `base64: true` causes silent 413 drops.** A quarter of inbound messages were lost.
5. **`DATABASE_SAVE_DATA_NEW_MESSAGE=false` breaks media and voice** with "Message not found".
6. **A stale `CONFIG_SESSION_PHONE_VERSION` gives "couldn't link device".**
7. **The delisted image cannot pair at all.**
8. **Quoted-reply context is top-level.** Every quoted reply was unlinked for weeks.
9. **Duplicate or stale routing rows.** When an instance is deleted out of band, your disconnect
   code never runs, so the old routing row still points at a dead channel. A "reattach only rows
   with a NULL link" rule then inserts a second row, and a third on the next reconnect. The
   resolver tied between them and picked one bound to a DELETED channel. Text kept working (it
   never calls Evolution) while every voice note and image asked Evolution for a dead instance
   and got 404 forever. It cost a full debugging day. Fixes: treat a row pointing at a deleted
   channel as reattachable, and retire every other live row for the location at wiring time.
   When retiring, also clear its active flag and its link, or it stays inside a partial unique
   index and collides with the next reattach.
10. **Instance names must contain randomness** (section 4.4, step 4).
11. **Reconcile before gates, and only on a definitive list** (section 4.4, step 2).
12. **Delete verification must poll.** One immediate check false-alarmed on every delete.
13. **A pairing-code miss is not an error.** Return 200 "not ready", do not page.
14. **Empty envelopes become blank chat bubbles** unless dropped (section 5.1, step 8).
15. **Evolution's error reason is nested.** Reading only a top-level string gave "Evolution
    400" for weeks while a customer could not connect.
16. **A QR-refresh failure was swallowed** as a "timeout" shown to the user, with no report. A
    channel that creates but can never pair was invisible. Report it silently and escalate a
    spike (after 10).
17. **An alert whose text contains the tenant id cannot dedupe.** Pool exhaustion sent one
    critical alert per tenant. Put ids in metadata, keep the message generic.
18. **Jobs written for another WhatsApp provider will act on Evolution rows.** In the source
    system a disconnected-channel reaper, a health check, a balance-runway calculation, an
    account-purge job and a "release for location" route had no provider filter. Results
    included an orphaned live instance whose proxy kept renewing for a deleted company, and a
    runway figure understated about 2.5 times. Audit EVERY query over the channels table and
    every teardown path. Every teardown of an Evolution row must delete the instance AND
    release the proxy.
19. **Evolution's own age check on edits never fires** (it compares seconds to milliseconds).
    WhatsApp rejects edits older than 15 minutes, so check the age yourself first.
20. **Delete-for-everyone is an HTTP DELETE with a JSON body.** A POST is not routed.
21. **Edit and delete need the STORED chat address.** Under LID addressing a chat is often
    stored as `<lid>@lid`. Evolution's edit refuses ("RemoteJid does not match") unless you send
    back the stored form. Look it up with `findMessages` first; fall back to the phone form.
22. **Status: never use `allContacts`.** It throws "Contacts not found" when the instance has no
    saved contacts and it would include groups and LID entries. Always send an explicit
    `statusJidList`. A timed-out status send must NOT be retried: it may have posted.
23. **Status font codes are not the Baileys enum** (fork). Real phones render codes 0, 1, 2, 4,
    5, 6, 7, 8. Codes 3, 9 and 10 render as plain. Do not "fix" the map back to the enum.
24. **Evolution 2.3.7 could open a socket before its proxy finished loading**, so a reconnect
    sometimes went out with no proxy. Log which proxy every socket uses. Detail in
    `iproyal-proxies`.
25. **Deploys lose messages** (section 7.3). **A sleeping hosting plan drops every session.**
26. **Losing the credential store means every customer re-scans** (section 7.4).
27. **One unanswered app-state sync loops a blind query every 60 seconds forever** (a Baileys
    bug, in rc.9 and rc13). Nothing errors and nothing is logged at a normal log level: the
    socket just keeps sending through the number's proxy. Fixed by a build-time patch
    (section 3.5).

Still open in the source system, so check them on any new build:

- **No scheduled reconciler.** Connect self-heals reactively, but nothing diffs Evolution's
  instance list against the database on a timer. A wiped store would surface only as complaints
  trickle in. Build it: list instances, and for each live row whose instance is gone, set
  `needs_qr` and raise one alert. Act only on a successful list.
- **LID on inbound and on mark-read** (section 5.5).
- **Old endpoints that bypass the shared senders** have no Evolution branch. Find callers first.
- **Admin screens built for another provider's telemetry** show blank health for these rows.
- **Nothing happens at all?** Check three things: the URL and key are set, the provider switch
  or a per-tenant override selects Evolution, and the row's provider column says so.
- **No load test was done.** Watch memory as sockets grow and scale before onboarding many.

## 10. Message history: what a linked device can and cannot give you

- **You can** keep every message forever in your own table, from link time onward.
- **You can** receive a bundle of RECENT history that the phone pushes at link time (Baileys'
  `messaging-history.set` event; Evolution's `syncFullHistory` instance setting). The reference
  implementation does not use either, so their request shapes are not covered here.
- **You cannot** get lifetime history. The phone ships only a recent window (community
  measurements: around 10,000 messages over a few hundred chats). Older messages are never sent
  to any linked device. On-demand backfill is often silently dropped by WhatsApp and capped
  near 50 messages per request. This is WhatsApp's protocol, not Evolution's, and self-hosting
  does not change it.
- `findMessages` has no reliable date-range filter.

**Rule:** persist every message to your own table the moment the webhook arrives, and read
history only from there. Never build a feature that assumes it can refetch history on demand.

## 11. Go-live checklist

From `reference-impl/deploy/GO_LIVE_CHECKLIST.md` and `README.md`.

Infrastructure:
- [ ] Postgres created, daily backups ON, internal URL copied.
- [ ] Redis created, no eviction, snapshots on, private network only.
- [ ] Evolution service on the pinned digest, port 8080, health path `/`, always-on plan.
- [ ] Every variable from section 3.2 set. `CONFIG_SESSION_PHONE_VERSION` is current.
- [ ] `SERVER_URL` set to the real public URL and the service redeployed.
- [ ] `GET /` on the service returns the info JSON.

App server:
- [ ] Evolution URL, key and inbound webhook URL set. Key equals `AUTHENTICATION_API_KEY`.
- [ ] Inbound route mounted with the 2 MB path-scoped parser above the global parser, and
      admitted without an Origin header.
- [ ] Webhook secret set, and every live instance re-registered (section 5.2).
- [ ] Every job and query that scans the channels table is provider-scoped (landmine 18).
- [ ] Every Evolution failure path reports to your alert system with a precise source.

Proxies (before a second real customer):
- [ ] Proxy mode `required`, pool stocked. See `references/proxy-pool.md`.

Rollout:
- [ ] Proven on the test rig with a spare number first (section 12).
- [ ] If a managed provider runs alongside: enable Evolution per tenant, not globally. Existing
      numbers keep their provider until the customer reconnects. There is no in-place
      migration: moving a number means a fresh instance and a new QR scan.
- [ ] Rollback is flipping the switch back. Both backends stay live.

## 12. The test rig

From `reference-impl/deploy/ISOLATED_TEST_RIG.md`. Prove the whole path on an isolated copy
before any customer-facing environment has the Evolution env vars set.

**Build:** the Evolution service plus its Postgres and Redis, and a CLONE of your app server
deployed from a test branch. Set the Evolution env vars only on the clone. Leave scheduled jobs
OFF on the clone so it cannot act on real data.

**Drive it by hand** (no frontend needed):

1. Call your create route. It returns the instance name.
2. `GET <evolution>/instance/connect/<instance>` with the `apikey` header. Scan the QR.
3. `GET <evolution>/instance/connectionState/<instance>` becomes `open`. Your row becomes
   connected and the phone number is filled in.

**Prove each of these and write down the result:**

- [ ] QR pairing, then `connection.update` flips the row and the number is learned.
- [ ] Inbound text, including non-Latin text and emoji.
- [ ] Outbound text, with a real message id returned.
- [ ] Mark-read and typing.
- [ ] Delivery ticks advance: sent, delivered, read.
- [ ] Inbound voice note fetched by id.
- [ ] Inbound image, video and document fetched and stored.
- [ ] A quoted reply links to its original.
- [ ] A reply typed on the phone itself arrives as a from-phone message, not dropped.
- [ ] Your own sends do NOT come back as inbound.
- [ ] Logout, then reconnect on the same instance.
- [ ] Delete: instance gone from the list, row soft-deleted, proxy released, no false alert.
- [ ] Delete the instance out of band (in `/manager`), then connect again with no manual
      database edit: it self-heals and raises the "vanished" alert.
- [ ] With a proxy: the proxy provider's usage shows traffic to web.whatsapp.com for that IP.
- [ ] Redeploy Evolution: the number reconnects with no QR.

**Debug helper:** `reference-impl/scripts/evolution_findmsg.py` dumps recent stored messages
for an instance (`POST /chat/findMessages` with `{ "page": 1, "offset": 20 }`) and prints the
exact JSON path of any quote context. Use it to see a real payload instead of guessing.

**Teardown:** delete the two services and optionally the stores. Unlink the phone under Linked
Devices.

## 13. Map of reference-impl

| Read this | For |
|---|---|
| `deploy/docker-compose.yml` | The pinned image and every Evolution env var, with the reason for each |
| `deploy/render.yaml` | The same as a hosted blueprint: plan sizes, health path, private Redis |
| `deploy/.env.example` | The four values a local run needs |
| `deploy/README.md` | Local test, deploy, connect a number, cutover model |
| `deploy/GO_LIVE_CHECKLIST.md` | The step-by-step go-live with env paste blocks |
| `deploy/ISOLATED_TEST_RIG.md` | What was proven live and the punch list |
| `deploy/PROXY_PER_CHANNEL_PLAN.md` | Proxy pool design and build log |
| `server/whatsapp/evolution/evolutionClient.ts` | EVERY Evolution REST call. The source of truth for paths and bodies. Also the webhook config builder, the webhook token, error extraction, the proxy-hold retry |
| `server/whatsapp/evolution/evolutionConnectionState.ts` | Raw state plus reason code to the canonical enum |
| `server/whatsapp/evolution/sentMessageTracker.ts` | Echo suppression |
| `server/whatsapp/evolution/evolutionStatus.ts` | Status (stories): audience building, font codes, delete |
| `server/routes/evolution/provision.ts` | Create, QR, pairing code, health check, logout, delete, with all the ordering reasons |
| `server/routes/evolution/inbound.ts` | The webhook receiver: token check, event routing, receipts, edits, deletes, connection updates |
| `server/routes/evolution/dispatch.ts` | How one set of frontend routes serves two backends, and the set-webhook self-heal |
| `server/routes/evolution/admin.ts` | Internal admin: proxy pool view with masked credentials, per-tenant enable |
| `server/inbound/normalizerEvolution.ts` | Payload to normalized message |
| `server/whatsapp/evolution/proxyPool.ts`, `iproyalClient.ts`, `brightdataClient.ts`, `ipqsClient.ts`, `server/jobs/evolutionProxyHeal.ts` | The proxy pool. See `references/proxy-pool.md` |
| `patches/patch-baileys-appstate-resync-loop.mjs` | The build-time Baileys patch for the app-state loop (section 3.5), and the pattern for any library patch |
| `patches/patch-baileys-appstate-resync-loop.test.cjs` | Runs the installed library's real loop to prove the patch, and the failure without it |
| `patches/Dockerfile.patched-image` | The pinned image with the patch applied on top |
| `sql/` | The proxy pool table and its two additions |
| `scripts/evolution_findmsg.py` | Dump stored messages to inspect real payloads |
| `scripts/` (the rest) | Proxy provider helpers |

**Not in reference-impl**, so build or adapt them yourself: the config loader and its defaults,
the server entry file (route mounting, the 2 MB parser, the allowlist), the media and voice
download pipeline with its retry schedule, the outbound senders that call the client after their
business gates, the shared inbound pipeline and its dedupe guard, the ban handler, the
delivery-status writer, the migrations for the channels, routing and overrides tables, and the
Evolution fork's source patches (the Baileys app-state patch IS included, under `patches/`).
