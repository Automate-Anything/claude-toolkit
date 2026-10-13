# Evolution webhook payloads: the full catalogue

What Evolution POSTs to your inbound URL, per event, and exactly which fields the reference
implementation reads. Sources: `reference-impl/server/routes/evolution/inbound.ts` and
`reference-impl/server/inbound/normalizerEvolution.ts`, from the v2.3.7 line of Evolution.

The examples show the fields the code READS. Real payloads carry more. Anything the code does
not read is marked "not covered by the reference implementation". To see a full real payload,
run `reference-impl/scripts/evolution_findmsg.py` against a test instance.

Placeholders: `<CUSTOMER_DIGITS>` and `<OWN_DIGITS>` are phone numbers as bare digits.

## 0. Delivery

```
POST https://api.example.com/api/evolution/inbound            (no webhook secret)
POST https://api.example.com/api/evolution/inbound/<token>    (webhook secret set)
content-type: application/json
```

- No signature header and no auth header. See SKILL.md section 5.2 for the path token.
- Answer `200 {"ok":true}` immediately and process afterwards. Evolution retries a non-200.
  The retry count and timing are not covered by the reference implementation.
- With webhook `base64: false` the body is small. Keep a 2 MB JSON limit on this path anyway.

## 1. The envelope

```json
{
  "event": "messages.upsert",
  "instance": "app_a1b2c3d4_main01_e5f6a7",
  "data": { }
}
```

| Field | Notes |
|---|---|
| `event` | Lower-case with dots. Lowercase it before comparing |
| `instance` | YOUR instance name. The only thing you use to find the channel. Missing means a misconfiguration: alert |
| `data` | An object or an array of objects, depending on event and version. Always handle both |

Other envelope fields (server URL, timestamps, sender, api key) are not read by the code and
are not covered here.

## 2. `messages.upsert`: a message arrived, or you sent one

One item:

```json
{
  "key": {
    "remoteJid": "<CUSTOMER_DIGITS>@s.whatsapp.net",
    "fromMe": false,
    "id": "<MESSAGE_ID>"
  },
  "pushName": "Dana",
  "messageType": "conversation",
  "message": { "conversation": "Hi, do you have a table at 8?" },
  "messageTimestamp": 1713774883,
  "contextInfo": null
}
```

| Field | Meaning |
|---|---|
| `key.id` | The WhatsApp message id. Your dedupe key, your echo key, and the id used to fetch media |
| `key.fromMe` | `true` for anything sent from the account: your API sends AND messages typed on the phone |
| `key.remoteJid` | The chat. See the JID table below |
| `pushName` | The sender's WhatsApp display name. Shown in the documented shape; the normalizer does not read it |
| `messageType` | The name of the populated key in `message` |
| `message` | The content, in exactly one of the shapes below |
| `messageTimestamp` | SECONDS since epoch. May be a number or a numeric string |
| `contextInfo` | TOP-LEVEL quote context for a reply. A sibling of `message` |

### 2.1 JID forms in `key.remoteJid`

| Form | Meaning | Handling in the reference code |
|---|---|---|
| `<digits>@s.whatsapp.net` | A person, by phone number | Digits before `@` become the customer phone |
| `<digits>@lid` | A person under hidden-number (LID) addressing. The digits are not a phone number | Not special-cased on inbound: the digits are taken as the phone. A known gap |
| `<id>@g.us` | A group chat | Dropped |
| `status@broadcast` | A status (story) | Dropped |

Whether your Evolution version adds an alternative phone-number field next to an `@lid` JID is
not covered by the reference implementation. Check a real payload.

### 2.2 Content shapes in `message`

Plain text:

```json
{ "messageType": "conversation", "message": { "conversation": "Hello" } }
```

Text with a link preview or formatting:

```json
{ "messageType": "extendedTextMessage",
  "message": { "extendedTextMessage": { "text": "See https://example.com" } } }
```

Image (video is the same with `videoMessage`):

```json
{ "messageType": "imageMessage",
  "message": { "imageMessage": { "caption": "The damage", "mimetype": "image/jpeg" } } }
```

Document:

```json
{ "messageType": "documentMessage",
  "message": { "documentMessage": { "caption": "", "fileName": "invoice.pdf",
                                    "mimetype": "application/pdf" } } }
```

Voice note or audio:

```json
{ "messageType": "audioMessage", "message": { "audioMessage": { } } }
```

Reaction:

```json
{ "messageType": "reactionMessage",
  "message": { "reactionMessage": { "text": "<emoji>", "key": { "id": "<TARGET_MESSAGE_ID>" } } } }
```

Shared contact (one):

```json
{ "messageType": "contactMessage",
  "message": { "contactMessage": { "displayName": "Sam",
               "vcard": "BEGIN:VCARD\nFN:Sam\nTEL;type=CELL:<CUSTOMER_DIGITS>\nEND:VCARD" } } }
```

Shared contacts (several):

```json
{ "messageType": "contactsArrayMessage",
  "message": { "contactsArrayMessage": { "contacts": [ { "displayName": "Sam" },
                                                       { "displayName": "Lee" } ] } } }
```

Envelopes that are not messages of their own (dropped):

```json
{ "messageType": "secretEncryptedMessage", "message": { } }
{ "messageType": "albumMessage", "message": { } }
```

`secretEncryptedMessage` is an encrypted EDIT pointing at an earlier message. `albumMessage` is
the "N photos coming" header of a multi-photo send; each photo then arrives as its own message.

Shapes the normalizer does not read (location, sticker, poll, live location, buttons, lists,
view-once wrappers, ephemeral wrappers) are not covered by the reference implementation. They
fall into the "text with no text" rule and are dropped with a silent report that names the
`messageType` and the keys present, so you learn which ones your users actually send.

### 2.3 How each shape is normalized

| Shape | `message_type` | Body | Media id |
|---|---|---|---|
| `conversation` | `text` | the string | none |
| `extendedTextMessage` | `text` | `.text` | none |
| `imageMessage` | `image` | `.caption` or empty | `key.id` |
| `videoMessage` | `video` | `.caption` or empty | `key.id` |
| `documentMessage` | `document` | `.caption` or empty, filename from `.fileName` | `key.id` |
| `audioMessage` | `voice` | empty | `key.id` (in the voice id field) |
| `contactMessage` | `contact` | display name, newline, the phone from the vCard `TEL` line | none |
| `contactsArrayMessage` | `contact` | the display names joined with ", " | none |
| `reactionMessage` | `action` | the emoji | none; reference kind `reaction` |

The type test is "the key is present in `message` OR `messageType` equals its name", checked in
this order: audio, image, video, document, contact, reaction, else text.

Every normalized message also gets: `direction` "Incoming", `channel` "whatsapp", `source`
"mobile", `from_me` from `key.fromMe`, `chatId` (the raw chat JID followed by the receiving
business digits), and `created_at` from `messageTimestamp` times 1000.

### 2.4 Quoted replies

A reply to an earlier message:

```json
{
  "key": { "remoteJid": "<CUSTOMER_DIGITS>@s.whatsapp.net", "fromMe": false, "id": "<MESSAGE_ID>" },
  "messageType": "conversation",
  "message": { "conversation": "Yes, that one" },
  "contextInfo": {
    "stanzaId": "<QUOTED_MESSAGE_ID>",
    "participant": "<OWN_DIGITS>@s.whatsapp.net",
    "quotedMessage": { "conversation": "The 8pm table?" }
  },
  "messageTimestamp": 1713774990
}
```

- The quote is at `data.contextInfo`, NOT inside `message.extendedTextMessage`.
- `stanzaId` is the id of the quoted message. Link to it.
- The snippet is the first present of `quotedMessage.conversation`,
  `.extendedTextMessage.text`, `.imageMessage.caption`, `.videoMessage.caption`,
  `.documentMessage.caption`.
- Lookup order in the code: `data.contextInfo`, then `message.extendedTextMessage.contextInfo`,
  `message.imageMessage.contextInfo`, `message.videoMessage.contextInfo`,
  `message.documentMessage.contextInfo` as fallbacks.

### 2.5 `fromMe` messages

```json
{ "key": { "remoteJid": "<CUSTOMER_DIGITS>@s.whatsapp.net", "fromMe": true, "id": "<MESSAGE_ID>" },
  "messageType": "conversation", "message": { "conversation": "On my way" } }
```

Two different things produce this exact shape:

1. The echo of a message YOUR server sent through the API. Its `key.id` is in your
   sent-message tracker: drop it.
2. A message the account owner typed on their own phone. Its id is unknown to you: keep it,
   attributed as sent by staff from the phone.

There is no field that tells them apart. The id match is the only discriminator.

## 3. `messages.update`: receipts for messages you sent

```json
{
  "keyId": "<MESSAGE_ID>",
  "remoteJid": "<CUSTOMER_DIGITS>@s.whatsapp.net",
  "fromMe": true,
  "status": "DELIVERY_ACK"
}
```

| Field | Read as |
|---|---|
| message id | `keyId`, else `messageId`, else `key.id` |
| `fromMe` | Skip the item when it is exactly `false` |
| `status` | A string (uppercased before lookup) or a number |

Status mapping:

| String | Number | Your delivery status |
|---|---|---|
| `ERROR` | 0 | failed |
| `PENDING` | 1 | pending |
| `SERVER_ACK` | 2 | sent (one tick) |
| `DELIVERY_ACK` | 3 | delivered (two ticks) |
| `READ` | 4 | read (blue ticks) |
| `PLAYED` | 5 | played (voice note listened to) |

Unknown status: ignore. Write through a forward-only writer keyed on the message id.

(fork) A viewer of a status you posted:

```json
{
  "keyId": "<STATUS_MESSAGE_ID>",
  "remoteJid": "status@broadcast",
  "fromMe": true,
  "status": "READ",
  "statusView": true,
  "participant": "<CUSTOMER_DIGITS>@s.whatsapp.net",
  "timestamp": 1713775200
}
```

When `remoteJid` is `status@broadcast`, never treat the item as a chat receipt. If `statusView`
is `true` and `participant` is a string, record one view. `timestamp` is seconds. The fork
resolves a viewer's `@lid` to a phone when it can; when it cannot, the LID digits arrive and
still count that viewer once.

## 4. `messages.edited`: a message was edited (fork)

```json
{
  "key": { "id": "<ORIGINAL_MESSAGE_ID>" },
  "editedMessage": { "conversation": "Make it 8:30 please" }
}
```

- `key.id` is the id of the ORIGINAL message.
- New text is the first string among `editedMessage.conversation`,
  `.extendedTextMessage.text`, `.imageMessage.caption`, `.videoMessage.caption`,
  `.documentMessage.caption`.
- Update your existing row in place, found by message id AND the channel's business number.
  Stamp an edited time. Skip voice notes (their body is your transcript). Ignore an edit for a
  message you never stored.
- On stock Evolution an edit arrives instead as a `messages.upsert` with
  `messageType: "secretEncryptedMessage"` and no readable text, which is dropped.

## 5. `messages.delete`: deleted for everyone

```json
{ "id": "<MESSAGE_ID>" }
```

The handler reads only `data.id`. Mark your copy deleted, matched by message id AND the
channel's business number, and keep the text for the record. Your own delete-for-everyone
produces the same event, which simply re-applies the same state.

## 6. `connection.update`: link state changed

Linked:

```json
{ "state": "open", "wuid": "<OWN_DIGITS>@s.whatsapp.net" }
```

Linking or re-syncing:

```json
{ "state": "connecting" }
```

Phone unlinked the device:

```json
{ "state": "close", "statusReason": 401 }
```

Banned:

```json
{ "state": "close", "statusReason": 403 }
```

| Field | Read as |
|---|---|
| `state` | `open`, `connecting` or `close` |
| reason code | `statusReason`, else `statusCode`, else `lastDisconnect.error.output.statusCode` |
| paired number | `wuid`, else `me.id`. Take the part before `@` and keep only digits |

Reason codes (Baileys DisconnectReason) and the canonical state each maps to:

| Code | Name | Canonical state |
|---|---|---|
| 401 | loggedOut | `needs_qr` |
| 403 | forbidden | `banned` |
| 408 | timedOut | `reconnecting` |
| 428 | connectionClosed | `reconnecting` |
| 515 | restartRequired | `reconnecting` |
| 440 | connectionReplaced | `disconnected` |
| 500 | badSession | `disconnected` |
| 411 | multideviceMismatch | `disconnected` |
| none or other | | `disconnected` |

`open` maps to `connected`, `connecting` to `reconnecting`, anything unrecognized to `unknown`.

What the handler does with it: see SKILL.md section 7.2.

## 7. `qrcode.updated`: the QR was refreshed

Subscribed and ignored. The QR is fetched on demand with `GET /instance/connect/{instance}`.
The payload shape is not covered by the reference implementation.

## 8. Call events

`CALL` is subscribed and the handler does nothing with it. The event name as delivered and the
payload shape are not covered by the reference implementation.

## 9. Events you may see but did not subscribe to

| Event | Handling |
|---|---|
| `send.message` | Always your own outbound. Drop it. It shares the item shape of `messages.upsert` |
| `contacts.upsert` | Ignored. A huge array on first sync. Do not subscribe |
| anything else | Ignored silently, so a new event type does not flood alerts |

## 10. Errors the handler reports, and how loudly

| Situation | Report | Loudness |
|---|---|---|
| Token rejected | `evolution_inbound_token_rejected` | Silent, escalate after 50 |
| No `instance` in the body | `evolution_inbound_missing_instance` | Loud |
| Unknown or deleted instance | `evolution_inbound_unknown_instance` | Silent, escalate after 25 |
| Channel has no phone number yet | `evolution_inbound_dropped_no_phone` | Silent, escalate after 10 |
| Message with no readable content | reported with its `messageType` | Silent |
| A branch threw | `evolution_inbound_process_failed` with the stage | Loud (receipts: silent, escalate after 50) |
| The connection-state write failed | `evolution_inbound_process_failed`, stage `connection.update.dbwrite` | Loud |
| Re-applying the webhook failed | `evolution_set_webhook_failed` | Silent, escalate after 20 |

The alert type names are the reference product's. Keep the loudness logic: a forged request or
a single blip must not page anyone, but a spike means your own config broke.
