---
name: whatsapp-api
description: How to send and receive WhatsApp messages from an app through the Automate Anything WhatsApp API (https://wa-api.automateanything.ai), a WHAPI-compatible REST API. Use it whenever a project needs to create a WhatsApp number, link a phone to it (QR or pairing code), send text / media / locations / contacts, react, mark read, edit or delete messages, receive messages and delivery ticks by webhook, download media, limit a number to the chats its owner allows (allowlist mode), pace the messages a number starts (careful numbers, 429 handling), or migrate code written for WHAPI. Covers the two keys (partner key, number token), where the keys come from and how to keep them secret, every endpoint, the webhook event format, errors, and the known rough edges.
metadata:
  updated: "2026-11-19"
---

# Automate Anything WhatsApp API

A REST API for WhatsApp, built to speak **WHAPI's language**: the same endpoints, request
bodies and webhook events. Code written for WHAPI works by changing the base URL and the token.

- **Base URL:** `https://wa-api.automateanything.ai`
- **Full reference (always current):** `https://wa-api.automateanything.ai/docs`, machine-readable
  at `https://wa-api.automateanything.ai/openapi.yaml`. When this file and the spec disagree, the spec wins.
- **Playground:** `https://wa-api.automateanything.ai/playground`. Paste a partner key or a number
  token and click through everything below; "Developer view" shows each request as a `curl`
  command and the raw webhook events.
- **This file, latest version:** `https://wa-api.automateanything.ai/skill`

**Two copies of this skill exist, word for word the same:** the live one at
`https://wa-api.automateanything.ai/skill` (it ships with the API) and `skills/whatsapp-api/SKILL.md`
in the public `Automate-Anything/claude-toolkit` repository. **Use whichever has the later
`metadata.updated` date** (the top of the file); if you can fetch URLs, compare. **If you change
either copy:** set `updated` to today and make the same change in the other copy, so they stay
identical. If you cannot edit the other copy, tell the person which one is newer.

The service is new. If something behaves differently from this file or the docs, tell the person
you work for what you sent, what came back and when, so they can report it.

## 1. Keys: what they are and where they come from

| Key | Looks like | What it does | Where it goes |
|---|---|---|---|
| **Partner key** | `aa_pk_...` | Creates, lists, renames and deletes **one account's** numbers. Other accounts' numbers are invisible to it. | `Authorization: Bearer <partner key>` on the **Numbers** endpoints |
| **Number token** | returned as `token` when a number is created | Everything for ONE number: linking a phone, sending, settings, media. | `Authorization: Bearer <number token>` on every other endpoint |

- A person makes the partner key: an owner of the account on the partner page
  (`https://wa-api.automateanything.ai/partner`, API keys), or we do it on the admin page. An
  account can have several keys (one per server or app, each with a name, at most 10); a new key
  works next to the old ones, so a server can switch keys with no gap, then the old key is deleted.
  A key is shown once. **You never create or guess keys.**
- **Read keys from the project's own secret settings** (for example environment variables
  `WA_API_PARTNER_KEY` and, per number, `WA_API_NUMBER_TOKEN`). If a key you need is missing, stop
  and ask the person for it. Do not search the computer for keys.
- **Never** put a key in front-end code, a repository, a log line, a commit, a ticket or a chat
  message. Keys live on the server only. If one leaked, the person replaces it on the admin page;
  the old one stops at once and the numbers keep running.
- Store each number's `token` next to its `id` in the app's own secret store or database when you
  create the number. (`GET /channels/list` with the partner key also returns each number's `token`.)
  If your tool runs every command in a fresh shell, do the multi-step work (create, link, poll) in
  ONE script that holds the keys in memory, rather than writing them to files.

## 2. The standard flow

```bash
BASE=https://wa-api.automateanything.ai

# 1. Create a number (partner key). The answer has the number's id and its own token.
curl -X PUT $BASE/channels -H "Authorization: Bearer $WA_API_PARTNER_KEY" \
  -H "Content-Type: application/json" -d '{"name":"Front desk"}'

# 2. Link a phone (number token). Show this QR picture to the person; they scan it in
#    WhatsApp: Settings, Linked devices, Link a device.
curl $BASE/users/login -H "Authorization: Bearer $WA_API_NUMBER_TOKEN"
#    ...then poll until it says linked: status.text = "AUTH".
curl $BASE/health -H "Authorization: Bearer $WA_API_NUMBER_TOKEN"

# 3. Send its events to your app.
curl -X PATCH $BASE/settings -H "Authorization: Bearer $WA_API_NUMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"webhooks":[{"url":"https://your.app/whatsapp","headers":{"x-api-key":"a-secret-you-choose"},"events":[{"type":"messages","method":"post"},{"type":"statuses","method":"post"}]}]}'

# 4. Send a message.
curl -X POST $BASE/messages/text -H "Authorization: Bearer $WA_API_NUMBER_TOKEN" \
  -H "Content-Type: application/json" -d '{"to":"14155551234","body":"Hello!"}'
```

## 3. Endpoints

**Numbers (partner key)**

| Method + path | Does |
|---|---|
| `PUT /channels` | Create a number `{ name?, allowlist_mode?, safety_profile? }` -> `{ id, token, ... }` (`allowlist_mode: true` = this number starts in allowlist mode, see below; `safety_profile: "careful"` = send limits, see section 6) |
| `GET /channels/list` | This account's numbers (`?count`, `?offset`) |
| `PATCH /channels/{id}` | Rename `{ name }` and/or switch `{ safety_profile: "careful" \| "legacy" }` |
| `DELETE /channels/{id}` | Delete (logs the phone out, removes the number for good) |
| `GET /partners` | The account (balance is unlimited) |
| `POST /channels/{id}/extend`, `PATCH /channels/{id}/mode` | Accepted for WHAPI compatibility; numbers never expire |

**Link a phone (number token)**

| Method + path | Does |
|---|---|
| `GET /users/login` | QR code as a picture (`base64`). Ask again about every 15 s: the QR changes. |
| `GET /users/login/rowdata` | QR code as text, to draw it yourself |
| `GET /users/login/{phone}` | Pairing code for that phone (digits with country code, e.g. `14155551234`). The person types it in WhatsApp: Linked devices, Link a device, "Link with phone number instead". |
| `GET /health` | Status: `status.text` is `AUTH` when linked, `QR` while waiting; `user.id` is the phone |
| `POST /users/logout` | Log the phone out (the number stays and can link again) |

What they answer:

- `GET /users/login` -> `{ "status": "OK", "base64": "data:image/png;base64,iVBOR...", "expire": 20 }`.
  `base64` is a complete **data URL**: use it as an `<img src>` as it is, or, to make a file, drop
  everything up to and including the first comma, base64-decode the rest and save it as `qr.png`.
- `GET /users/login/rowdata` -> `{ "status": "OK", "rowdata": "<QR text>", "expire": 20 }`.
- `GET /users/login/{phone}` -> `{ "status": "OK", "code": "ABCD1234", "expire": 120 }`. The code comes
  without a dash; show it to the person as `ABCD-1234` for easy reading (they type the 8 characters).
  Asking again for the same phone returns the same code until WhatsApp replaces it.
- Any of them can answer `{ "status": "WAITING" }` for a few seconds right after a request: ask again
  after 2 s, it is not an error. `409` means the number is already linked.
- `GET /health` -> `{ "channel_id", "start_at", "uptime", "status": { "code", "text" }, "user"? }`. Read
  `status.text`: `QR` while waiting for a scan, `AUTH` once linked (then `user.id` is the phone
  number, digits only, for example `14155551234`); others are `LAUNCH`, `INIT`, `STOP`, `ERROR`.
  `status.code` is WHAPI's number for the same. Once linked, the QR and code calls answer `409`.

**Linking needs a person.** You cannot scan a QR or type a code into a phone. Make the QR easy to
reach (save `qr.png` and open it, or put the data URL on a page), tell the person exactly what to do
(WhatsApp, Settings, Linked devices, Link a device, scan), then poll `GET /health` every few seconds
until `AUTH`. A QR is valid about 20 seconds; fetch a fresh one each time you show it again.

**No server yet? Use the built-in test address.** Set the webhook `url` to
`https://wa-api.automateanything.ai/gateway/sink` (it answers 200 to anything), then read what
arrived with `GET /gateway/deliveries` (number token). Swap in your real URL later. The answer, newest
first:

```json
{ "deliveries": [ { "id": 418, "event": "messages.post", "url": "...", "created_at": "...",
    "delivered": true, "attempts": 1, "last_status": 200, "last_error": null,
    "payload": { "event": { "type": "messages", "event": "post" }, "channel_id": "...", "messages": [ ... ] } } ] }
```

`payload` is exactly the body your webhook would get. `id` only grows: poll every 2 seconds with
`?after_id=<highest id seen>&limit=100` to get only new ones (events show up within a few seconds).
Polling like this is for testing; a real app uses its own webhook URL.

**Settings (number token):** `GET /settings`, `PATCH /settings` with `webhooks: [{ url, headers?,
mode?, events? }]`. `headers` are sent with every event: put a secret there and check it in your
endpoint to know the call is genuine. `mode` is `body` (default: every event is a POST, the action
is in the body) or `method` (each event uses its action as the HTTP method). Events are `{ type, method }` pairs: types `messages`,
`statuses`, `calls`, `users`, `channel`. A webhook with no `events` gets `messages`/`post` only.

**Send (number token).** Every send takes `to` (digits with country code, a chat id like
`14155551234@s.whatsapp.net`, or a group id ending in `@g.us`), optional `quoted` (a message id to
reply to) and `typing_time` (seconds of "typing...", up to 20). Answers `{ sent: true, message }`;
keep `message.id` to react, edit or delete later.

| Method + path | Body |
|---|---|
| `POST /messages/text` | `body`; to EDIT a text you sent, add `edit: "<its id>"` (within 15 minutes) |
| `POST /messages/image`, `/video`, `/gif`, `/document`, `/voice`, `/audio`, `/sticker` | `media` = a public file URL or base64 / data URL (up to 16 MB); `caption`, `mime_type`; `filename` for documents |
| `POST /messages/location` | `latitude`, `longitude`, `name?`, `address?` |
| `POST /messages/contact` | `name`, `vcard` |

**Message actions (number token)**

| Method + path | Does |
|---|---|
| `PUT /messages/{id}` | Mark a received message read (last 14 days) |
| `DELETE /messages/{id}` | Delete a message you sent, for everyone (last 14 days) |
| `PUT /messages/{id}/reaction` | `{ emoji }`; `""` removes your reaction |
| `PUT /presences/{chatId}` | Show "typing..." or "recording..." |
| `GET /media/{id}` | Download a received image, voice note, document, ... (`id` = the message id) |
| `GET /gateway/deliveries?after_id=` | This number's recent webhook events and whether each reached your app ("did my app get it?") |

**Allowlist mode (number token; only for numbers in allowlist mode).** For a number whose owner
allows only certain chats (for example a personal phone). You choose it per number when you create
it (`PUT /channels` with `allowlist_mode: true`; your other numbers are not affected), or we switch
it on for your whole account, and then every number you create starts in it (`GET /partners` shows
`allowlist_mode: true`). It is fixed when the number is created. Such a number handles **only the
chats on its list**: every message is decrypted
as normal (so a chat allowed later works from its very next message), and a message from any other
chat is dropped on our server straight after, before it is stored, logged, sent to your webhook or
its media fetched. Sends, read receipts, typing and calls to other chats are refused with 403,
history sync is off, and no chat or contact lists are stored (the phone's contact book is never read). Encryption keys (Signal sessions and
sender keys) for other contacts are kept only so allowed chats keep working; no message text or
names are stored for them. Webhook delivery copies are kept less than a day. A number created in
allowlist mode shows `allowlist_mode: true` and has **no list yet, so it drops every chat until you
send one.**

| Method + path | Does |
|---|---|
| `PUT /allowlist` | `{ "chats": ["<id>@g.us", "<digits>@s.whatsapp.net", "<id>@lid", "+1 415 555 1234"] }`: the WHOLE list in one call (it replaces the one in force; at most 5,000; plain phone numbers with the country code are accepted; no device part). `200 { count }`; `400 { error: "bad_allowlist" }` = one id is wrong, nothing changed; `503 { error: "not_stored", count }` = in force but not saved, send it again. Send the full list whenever it changes, and again every few minutes |
| `GET /allowlist` | Counts only: `{ allowlist_mode, has_list, chats, list_set_at }` |
| `GET /allowlist/chats` | For a "pick your chats" screen: `{ chats: [{ id, name, kind: "group" }] }`, the phone's groups, read live. Never stored. The phone's contact book is never read, so let the person type numbers for one-to-one chats. Needs a linked phone |

## 4. Receiving: the webhook events

Every event is a `POST` (or the event's own method with `mode: "method"`) with JSON carrying
`event: { type, event }` and `channel_id`, exactly like WHAPI.

- **`messages`**: `{ messages: [ { id, from_me, type, chat_id, timestamp, source, from, from_name,
  text: { body }, image | video | voice | document: { id, mime_type, caption, ... }, location,
  contact, action, context } ] }`. `type` is `text`, `image`, `video`, `gif`, `audio`, `voice`,
  `document`, `sticker`, `location`, `contact`, or `action` (a reaction, edit or delete of another
  message: `action.type` + `action.target`). `context.quoted_id` is set on replies.
- **Your own sends come back too**: `from_me: true`, `source: "api"`. Messages typed on the linked
  phone itself arrive with `from_me: true`, `source: "mobile"`. A bot must answer neither, or it
  talks to itself and answers the phone owner's own messages to other people. **One exception:**
  the linked phone's **"Message yourself"** chat. There, the person's message arrives as
  `from_me: true, source: "mobile"` with `chat_id` = the number's own phone (`GET /health` ->
  `user.id`, plus `@s.whatsapp.net`). Treat exactly that case as an incoming message; it is the
  easiest way for a person to test a bot with a single phone.
- **`statuses`**: delivery and read ticks for messages you sent.
- **`users`**: a phone linked (`post`) or logged out (`delete`). **`channel`**: the number's status
  changed. **`calls`**: someone called the number.
- Answer any 2xx **quickly** (do slow work after answering). Anything else is retried: 3 s, then
  doubling, at most 10 minutes apart, for 24 hours. Events of one number arrive in order, and a
  retry can deliver one twice: dedupe on the message `id`.

A minimal receiver (Node + Express; the same steps in any language):

```js
app.post('/whatsapp', express.json({ limit: '25mb' }), (req, res) => {
  // 1. Only accept calls that carry the secret you put in the webhook's headers.
  if (req.get('x-api-key') !== process.env.WA_WEBHOOK_SECRET) return res.sendStatus(401);
  // 2. Answer at once; do the real work after.
  res.sendStatus(200);
  const { event, channel_id, messages = [] } = req.body;
  if (event?.type !== 'messages') return;
  for (const m of messages) {
    const selfChat = m.chat_id === `${MY_PHONE}@s.whatsapp.net`;   // MY_PHONE = GET /health user.id
    if (m.from_me && !(m.source === 'mobile' && selfChat)) continue;  // own sends and own typing, except "Message yourself"
    if (alreadyHandled(m.id)) continue;   // a retry can repeat an event
    if (m.type === 'text') handleText(channel_id, m.chat_id, m.text.body);
  }
});
```

To reply, `POST /messages/text` with `to` = the incoming `chat_id` (or `from`).

## 5. Errors

Errors look like WHAPI's: `{ "error": { "code": 400, "message": "A plain sentence saying what to fix." } }`.

| Code | Meaning | What to do |
|---|---|---|
| 400 | A field is missing or wrong | Read `message`, fix the request |
| 401 | Key missing or wrong | Check you used the right key for this endpoint (partner vs number) |
| 404 | Number or message not found (or belongs to another account) | Check the id |
| 403 | WhatsApp banned this number, or (allowlist mode) the chat is not on the number's list | Banned: it cannot send or link again; tell the person. Not on the list: add the chat with `PUT /allowlist` first |
| 409 | Number already linked (when linking), or not linked / logged out (when sending) | Link it (`GET /users/login`), wait for `GET /health` = `AUTH` |
| 429 | Careful numbers only: a send limit was reached (`error.details` = `per_minute` or `daily_cap`); nothing was sent | Wait the seconds in the `Retry-After` header (also `error.retry_after`), then send again. Never retry in a tight loop |
| 502 | WhatsApp's side did not answer; nothing may have been sent | Check (for example `GET /gateway/deliveries`) before sending again; do not blindly resend |
| 503 | A linked number is reconnecting, or no capacity to connect a new number | Nothing was sent: retry in a few seconds (reconnecting) or minutes (capacity); tell the person if it persists |

## 6. Good to know

- **Linking:** the QR is the most reliable way. A pairing code must be typed promptly; if
  WhatsApp says the code is wrong, get a fresh one. Many failed attempts in a row can make
  WhatsApp refuse codes for that phone for a while; use the QR then.
- **Each number connects from its own IP address**, chosen and managed automatically. Nothing to
  configure.
- **Numbers never expire** and there is no balance to top up.
- **Before the first send, check `GET /health` says `AUTH`.** A number that is not linked answers
  sends at once with 409; do not treat that as a temporary failure.
- **WhatsApp rules still apply:** do not send bulk unsolicited messages; numbers that spam get
  banned by WhatsApp (a banned number reports `status.reason: "banned"` and cannot link again).
- **Careful numbers (send limits).** A number with `safety_profile: "careful"` paces the messages
  it **starts**: one at a time a few seconds apart, at most 2 a minute, and a daily cap that is 2
  on the day the phone first linked and rises over 10 days to 200 (a rest day at a quarter of the
  cap follows 3 heavy days). **Replies are never limited:** a send to a chat that wrote in the last
  24 hours goes out at once. Reactions and edits count too. Over a limit the send answers 429;
  queue the message and send it after `Retry-After`. A careful number's send answers include
  `safety: { initiated, sent_today, daily_cap, rest_day }`. Every other number is `legacy`: no
  limits at all.

## 7. Install this skill

- **Any agent, no install:** read `https://wa-api.automateanything.ai/skill` at the start of the task.
- **Claude Code (one project):** save it as `.claude/skills/whatsapp-api/SKILL.md`:
  `curl -fsSL https://wa-api.automateanything.ai/skill -o .claude/skills/whatsapp-api/SKILL.md --create-dirs`
- **Claude Code (every project):** the same file at `~/.claude/skills/whatsapp-api/SKILL.md`.
- **Other agents** (Cursor, Codex, Copilot, Gemini): put the file wherever the agent reads skills
  or instructions (for example reference it from `AGENTS.md`).
