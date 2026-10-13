# Evolution REST calls: the full catalogue

Every call the reference implementation makes, read from
`reference-impl/server/whatsapp/evolution/evolutionClient.ts` and the routes that call it. These
are from the v2.3.7 line of Evolution. If your version differs, the code in your repo and a test
on a spare number win over this file.

Where a detail is not in that code it says "not covered by the reference implementation".
Response bodies below show only the fields the code READS. Evolution returns more. The code
reads several alternative spellings for some fields because Evolution has moved them between
versions: read them all, as the code does.

Placeholders: `<EVO>` is the Evolution base URL, `<instance>` the URL-encoded instance name,
`<CUSTOMER_DIGITS>` a phone number as bare digits with country code, no `+`.

## 0. Common to every call

```
<METHOD> <EVO><path>
apikey: <per-instance token if you have it, else the global admin key>
content-type: application/json
accept: application/json
```

- **Auth** is the `apikey` header only. The global admin key is the Evolution service's
  `AUTHENTICATION_API_KEY`. The per-instance token is returned by create. The client uses the
  per-instance token when the caller passes one and falls back to the global key.
  `/instance/create` and `/instance/fetchInstances` are always called with the global key.
- **Timeout:** 20 seconds unless stated. The client aborts the request and reports a network
  error.
- **Result shape used by callers:** `{ ok, status, body, error?, networkError? }`. The client
  never throws.
- **Numbers:** the `number` field is bare digits. The helper takes everything before `@`, then
  strips non-digits. So `+1 (555) ...`, `<digits>@s.whatsapp.net` and plain digits all work. It
  also means a group JID is reduced to digits: this client cannot address a group.
- **Error bodies.** Evolution v2 is NestJS with class-validator. On a non-2xx the reason is in
  the first of these that is present: `message` (string or array), `response.message` (string
  or array), `response` (string), `error`. Arrays are joined with `; `. If none is present the
  client reports `Evolution <status>`.

  ```json
  { "status": 400, "error": "Bad Request",
    "response": { "message": ["instance requires property \"host\""] } }
  ```

  The exact error envelope beyond those four fields is not covered by the reference
  implementation.
- **Success status codes.** The code only checks for 2xx. The one documented in a comment is
  201 for `/proxy/set`. Others are not covered by the reference implementation.

## 1. Instance lifecycle

### 1.1 Create an instance

```
POST <EVO>/instance/create        (global admin key)
```

QR login, no proxy:

```json
{
  "instanceName": "app_a1b2c3d4_main01_e5f6a7",
  "qrcode": true,
  "integration": "WHATSAPP-BAILEYS",
  "webhook": {
    "enabled": true,
    "url": "https://api.example.com/api/evolution/inbound",
    "byEvents": false,
    "base64": false,
    "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_EDITED", "MESSAGES_DELETE",
               "CONNECTION_UPDATE", "QRCODE_UPDATED", "CALL"]
  }
}
```

With a pairing code requested and a proxy:

```json
{
  "instanceName": "app_a1b2c3d4_main01_e5f6a7",
  "qrcode": true,
  "integration": "WHATSAPP-BAILEYS",
  "webhook": { "enabled": true, "url": "https://api.example.com/api/evolution/inbound/<token>",
               "byEvents": false, "base64": false, "events": ["MESSAGES_UPSERT", "..."] },
  "number": "<CUSTOMER_DIGITS>",
  "proxyHost": "203.0.113.10",
  "proxyPort": "12323",
  "proxyProtocol": "http",
  "proxyUsername": "<user>",
  "proxyPassword": "<pass>"
}
```

Field notes:

- `integration` is the literal `WHATSAPP-BAILEYS`.
- `webhook` is nested under the key `webhook`. `enabled` is REQUIRED or the whole config is
  rejected and the instance runs with no webhook.
- `number` is only sent when the user chose pairing by code.
- Proxy fields are TOP-LEVEL. `proxyPort` is a string. `proxyUsername` and `proxyPassword` are
  sent only when the stored URL has them. A nested `{ "proxy": { "url": "..." } }` is silently
  ignored.
- The proxy fields come from parsing a stored URL such as `http://user:pass@host:port` or
  `socks5://...`. Credentials are URL-decoded. A missing port defaults to 443 for https, 1080
  for socks, else 80.

Response (fields read):

```json
{
  "hash": "<per-instance token>",
  "instance": { "token": "<per-instance token>" },
  "token": "<per-instance token>",
  "qrcode": { "base64": "<QR PNG, base64>", "code": "<raw QR string>", "pairingCode": "<code>" }
}
```

- The token is the first present of: `hash.apikey` (when `hash` is an object), `hash` (when it
  is a string), `instance.token`, `token`. Store it on the channel row.
- The QR is `qrcode.base64`, else `qrcode.code`. The pairing code is `qrcode.pairingCode`.
- The QR may or may not start with `data:image/png;base64,`. Add the prefix when it is missing.

Failure handling:

- If the error text matches "invalid proxy" (case-insensitive), wait 8 seconds and retry, then
  12 seconds and retry. A create rejected for "Invalid proxy" leaves nothing behind on
  Evolution, so the same name is safe to reuse. Still rejected after both: the proxy is bad.
- Any other failure: roll back your row and release the proxy.

### 1.2 Set (or re-apply) the webhook

```
POST <EVO>/webhook/set/<instance>
```

```json
{
  "webhook": {
    "enabled": true,
    "url": "https://api.example.com/api/evolution/inbound",
    "byEvents": false,
    "base64": false,
    "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_EDITED", "MESSAGES_DELETE",
               "CONNECTION_UPDATE", "QRCODE_UPDATED", "CALL"]
  }
}
```

The same object as in create, nested under `webhook`. Call it after pairing and on every
`connection.update` that reports connected, so existing instances pick up config changes.
Best-effort: a failure keeps the previous config. Response body is not read.

The event list, and why each is or is not there:

| Event name in config | Arrives as | Used for |
|---|---|---|
| `MESSAGES_UPSERT` | `messages.upsert` | Inbound messages, and echoes of your own sends |
| `MESSAGES_UPDATE` | `messages.update` | Delivery and read receipts |
| `MESSAGES_EDITED` | `messages.edited` | Edits (needs the fork to decrypt them) |
| `MESSAGES_DELETE` | `messages.delete` | Delete for everyone |
| `CONNECTION_UPDATE` | `connection.update` | Connect, disconnect, logout, ban |
| `QRCODE_UPDATED` | `qrcode.updated` | Subscribed, ignored by the handler |
| `CALL` | not covered | Subscribed for future use, ignored by the handler |
| `SEND_MESSAGE` | `send.message` | NOT subscribed: only echoes of your own sends |
| `CONTACTS_UPSERT` | `contacts.upsert` | NOT subscribed: huge first-sync body, unused |

### 1.3 Get a QR code

```
GET <EVO>/instance/connect/<instance>
```

Response (fields read, each in two possible places):

```json
{
  "base64": "<QR PNG, base64>",
  "code": "<raw QR string>",
  "pairingCode": null,
  "instance": { "state": "connecting" }
}
```

- QR image: `base64`, else `qrcode.base64`.
- Raw QR string: `code`, else `qrcode.code`. Prefer this and render the QR in your own UI.
- State: `instance.state`. When it is `open` the number is already linked: tell the UI so.
- A failed call here must be reported, not shown to the user as a silent timeout.

### 1.4 Get a pairing code by phone number

```
GET <EVO>/instance/connect/<instance>?number=<CUSTOMER_DIGITS>
```

Same response as 1.3 with `pairingCode` (else `qrcode.pairingCode`) filled when ready.

A freshly created instance commonly returns a QR and NO pairing code for its first seconds.
Poll: up to 4 attempts, 3 seconds apart. If there is still no code, answer your own client with
HTTP 200 and a retryable "not ready" body. Pairing codes are flaky upstream: offer QR as the
fallback.

### 1.5 Connection state

```
GET <EVO>/instance/connectionState/<instance>
```

```json
{ "instance": { "state": "open" } }
```

State is `instance.state`, else top-level `state`. Values: `open`, `connecting`, `close`. This
call carries no disconnect reason, so it cannot tell a logout from a ban from a blip. Use the
webhook for that.

### 1.6 List all instances

```
GET <EVO>/instance/fetchInstances        (global admin key)
```

Returns an array. The instance name is in one of three places depending on version:
`instance.instanceName`, `name`, or `instanceName`. Read all three.

Used for: reconciling vanished instances before a connect, and verifying a delete. **Only a
successful array is evidence.** A failed call means "unknown", never "gone".

### 1.7 Restart an instance's socket

```
POST <EVO>/instance/restart/<instance>
```

No body. Reconnects with the STORED credentials, so no new QR. Use it right after a proxy
change, or to nudge a stuck session.

### 1.8 Logout

```
DELETE <EVO>/instance/logout/<instance>
```

No body. Drops the WhatsApp link, keeps the instance. Reconnect later with 1.3.

### 1.9 Delete an instance

```
DELETE <EVO>/instance/delete/<instance>
```

No body. Treat 404 as success (already gone). On any other failure change nothing locally.
Evolution acknowledges before teardown finishes: verify with 1.6 after 1.5, 3 and 5 seconds,
and alert only if the name is definitely still listed after all three.

### 1.10 Set, change or clear the proxy on an existing instance

```
POST <EVO>/proxy/set/<instance>
```

Enable or change:

```json
{ "enabled": true, "host": "203.0.113.11", "port": "12323", "protocol": "http",
  "username": "<user>", "password": "<pass>" }
```

Disable:

```json
{ "enabled": false }
```

- These names are DIFFERENT from create. Using `proxyHost` and friends returns 400 ("instance
  requires property host, port, protocol"). The correct names return 201.
- Evolution tests the proxy before accepting. "Invalid proxy" is retried after 8 and 12
  seconds, same as create.
- The change takes effect only after the socket reconnects: follow with 1.7.

## 2. Sending

Every send records the returned message id for echo suppression. The id is the first present
of `key.id`, `messageId`, `id` in the response.

### 2.1 Send text

```
POST <EVO>/message/sendText/<instance>
```

```json
{ "number": "<CUSTOMER_DIGITS>", "text": "Your appointment is confirmed for 3pm." }
```

Response (field read):

```json
{ "key": { "id": "<MESSAGE_ID>" } }
```

How the calling sender classifies failures (the sender itself is not in reference-impl; this
is from the lesson documents): 401, 403 and 404 mean the channel is unauthorized or gone and
needs re-pairing; other failures are retried as transient.

### 2.2 Send an image, video or document

```
POST <EVO>/message/sendMedia/<instance>
```

```json
{
  "number": "<CUSTOMER_DIGITS>",
  "mediatype": "image",
  "media": "https://cdn.example.com/files/receipt.jpg",
  "caption": "Your receipt",
  "fileName": "receipt.jpg",
  "mimetype": "image/jpeg"
}
```

- `mediatype` is `image`, `video` or `document`.
- `media` is a public URL or a base64 string. Evolution accepts both.
- `caption`, `fileName` and `mimetype` are optional.
- Response: as 2.1.
- Size limits are not covered by the reference implementation. Test with real large files.

### 2.3 Send a voice note

```
POST <EVO>/message/sendWhatsAppAudio/<instance>
```

```json
{ "number": "<CUSTOMER_DIGITS>", "audio": "https://cdn.example.com/files/note.ogg" }
```

`audio` is a public URL or base64. This endpoint sends it as a push-to-talk voice note. In the
client, media type `audio` routes here instead of to `sendMedia`. Response: as 2.1.

### 2.4 Send to a group

Not covered by the reference implementation. The client's number helper strips a JID to its
digits, inbound group messages (`@g.us`) are dropped, and no group endpoint is called.

### 2.5 Post a status (story)

```
POST <EVO>/message/sendStatus/<instance>        timeout 120 seconds
```

Text status:

```json
{
  "type": "text",
  "content": "Open late tonight until 10pm",
  "statusJidList": ["<OWN_DIGITS>@s.whatsapp.net", "<CUSTOMER_DIGITS>@s.whatsapp.net"],
  "backgroundColor": "#FF075E54",
  "textColor": "<text color, fork only>",
  "font": 0
}
```

Image or video status:

```json
{
  "type": "image",
  "content": "https://cdn.example.com/files/promo.jpg",
  "caption": "New this week",
  "statusJidList": ["<OWN_DIGITS>@s.whatsapp.net", "<CUSTOMER_DIGITS>@s.whatsapp.net"]
}
```

- `type` is `text`, `image` or `video`. For media, `content` is a public URL Evolution downloads.
- `backgroundColor` is required for text. The reference default is `#FF075E54` (an ARGB value).
- `statusJidList` is FULL JIDs (`<digits>@s.whatsapp.net`), 6 to 15 digits each. Put the
  account's own number first so the post shows under "My status".
- **Never use `allContacts`.** It throws "Contacts not found" when the instance has no saved
  contacts, and it would hand groups and LID entries to the send.
- Evolution sends to the list in batches of 10 under one message id, so a long list is slow.
  The reference caps the list at 5000 and uses a 120 second timeout.
- **A timeout is not a failure you may retry.** The post may have gone out. Retrying can post
  it twice.
- (fork) `font` accepts 0 to 10 and `textColor` exists. Upstream accepted font 1 to 5 and had
  no text color. The codes real phones render: 0 plain sans, 1 serif, 2 script, 4 bold sans,
  5 rounded handwriting, 6 heavy serif, 7 extra-bold sans, 8 bold typewriter. Codes 3, 9 and 10
  render as plain. WhatsApp desktop and web only have the first three.
- WhatsApp itself only shows a status to people who have the number saved.
- Response: as 2.1. Keep the message id and the recipient list: a delete needs both.

How the reference builds the audience: saved contacts from 3.5, plus everyone who has messaged
this number in the app's own message table, plus the own number. An "only" list sends to just
the listed people. An "except" list removes the listed people.

### 2.6 Delete a status

```
DELETE <EVO>/chat/deleteMessageForEveryone/<instance>        timeout 120 seconds
```

```json
{
  "id": "<STATUS_MESSAGE_ID>",
  "remoteJid": "status@broadcast",
  "fromMe": true,
  "statusJidList": ["<OWN_DIGITS>@s.whatsapp.net", "<CUSTOMER_DIGITS>@s.whatsapp.net"]
}
```

(fork) A status revoke is delivered like the status itself, so it needs the recipient list.
Upstream sent the revoke to nobody. A superset of the original list is harmless.

## 3. Chat actions

### 3.1 Typing and presence

```
POST <EVO>/chat/sendPresence/<instance>
```

```json
{ "number": "<CUSTOMER_DIGITS>", "presence": "composing", "delay": 1200 }
```

`presence` is one of `composing` (typing), `recording`, `paused`, `available`, `unavailable`.
`delay` is milliseconds and optional. Response body is not read.

### 3.2 Mark a message read

```
POST <EVO>/chat/markMessageAsRead/<instance>
```

```json
{
  "readMessages": [
    { "remoteJid": "<CUSTOMER_DIGITS>@s.whatsapp.net", "fromMe": false, "id": "<MESSAGE_ID>" }
  ]
}
```

Evolution wants the full message key, so the caller must know the sender as well as the
message id. `fromMe` is always `false` (you only mark inbound messages read). The reference
always rebuilds the JID as `<digits>@s.whatsapp.net`: a chat stored under `@lid` is a known
gap.

### 3.3 Fetch media by message id

```
POST <EVO>/chat/getBase64FromMediaMessage/<instance>
```

```json
{ "message": { "key": { "id": "<MESSAGE_ID>" } }, "convertToMp4": false }
```

Response:

```json
{ "base64": "<file bytes, base64>", "mimetype": "audio/ogg; codecs=opus" }
```

- Works for voice notes, audio, images, video and documents. The id is the `key.id` of the
  inbound message.
- Needs `DATABASE_SAVE_DATA_NEW_MESSAGE=true` on the Evolution service.
- **400 "Message not found"**: the store has not caught up. Retry with a long backoff.
- **404 "instance does not exist"**: wrong or dead instance. Do not retry. Alert.
- `mimetype` can be missing. Fall back by media type, never to an audio type for a photo.
- The retry schedule is not covered by the reference implementation.

### 3.4 Find a stored message

```
POST <EVO>/chat/findMessages/<instance>
```

By id:

```json
{ "where": { "key": { "id": "<MESSAGE_ID>" } } }
```

Recent messages, as the debug script does (optionally filtered to one chat):

```json
{ "page": 1, "offset": 20,
  "where": { "key": { "remoteJid": "<CUSTOMER_DIGITS>@s.whatsapp.net" } } }
```

Response (field read): `messages.records[0].key.remoteJid`.

```json
{ "messages": { "records": [ { "key": { "id": "<MESSAGE_ID>", "remoteJid": "<lid>@lid" } } ] } }
```

The debug script also accepts the list under `records` or `data`, because the shape has varied.
Used to learn the chat address Evolution STORED for a message before an edit or a delete. There
is no reliable date-range filter.

### 3.5 List saved contacts

```
POST <EVO>/chat/findContacts/<instance>        timeout 30 seconds
```

```json
{ "where": {} }
```

Response: an array. Fields read per row: `remoteJid` and `pushName`.

```json
[ { "remoteJid": "<CUSTOMER_DIGITS>@s.whatsapp.net", "pushName": "Dana" } ]
```

Keep only rows whose `remoteJid` matches `^\d{6,15}@s\.whatsapp\.net$`. That drops groups,
`@lid`, broadcast and status entries. Needs `DATABASE_SAVE_DATA_CONTACTS=true`. The phone's
address book only arrives when a phone links.

### 3.6 Edit a text message you sent

```
POST <EVO>/chat/updateMessage/<instance>
```

```json
{
  "number": "<STORED_REMOTE_JID>",
  "text": "Corrected text",
  "key": { "id": "<MESSAGE_ID>", "remoteJid": "<STORED_REMOTE_JID>", "fromMe": true }
}
```

- Text only. Evolution does not edit media.
- `number` and `key.remoteJid` must BOTH be the chat address Evolution stored for the message
  (get it from 3.4). Under LID addressing that is `<lid>@lid`. Send the phone form when the
  stored form is a LID and Evolution refuses with "RemoteJid does not match".
- WhatsApp rejects edits older than 15 minutes. Evolution's own age check never fires (it
  compares seconds to milliseconds), so check the age before calling.

### 3.7 Delete a message for everyone

```
DELETE <EVO>/chat/deleteMessageForEveryone/<instance>
```

```json
{ "id": "<MESSAGE_ID>", "remoteJid": "<STORED_REMOTE_JID>", "fromMe": true }
```

The method is DELETE with a JSON body. POST is not routed. Use the stored chat address from
3.4: a revoke sent to the other form may not reach the chat.

## 4. Service-level

```
GET <EVO>/
```

Returns Evolution's info JSON. Used as the health check and as the "is it up" test. The body's
fields are not read by the code. The admin UI is at `<EVO>/manager`.

## 5. Calls a developer may want that are NOT in the reference implementation

Do not invent these shapes. Read the Evolution source for your pinned version and prove each
on the test rig:

- Sending to a group, and any group management.
- Sending a reaction, location, contact card, sticker, poll, list or buttons.
- Profile picture, profile name, business profile, "is this number on WhatsApp" checks.
- Instance settings such as `syncFullHistory`, reject-call or always-online.
- Handling the `CALL` event.
- Any Evolution integration other than `WHATSAPP-BAILEYS`.
