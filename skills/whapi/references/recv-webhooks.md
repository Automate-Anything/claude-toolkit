---
title: Receive Messages via Webhooks - Never Poll
impact: CRITICAL
impactDescription: Polling getMessages in a loop wastes API quota, misses real-time delivery, and does not scale; webhooks are the only correct approach for receiving incoming messages
tags: webhook, webhooks, mode, url, method, events, incoming, receiving, polling, anti-pattern, updateChannelSettings, getAllowedEvents
---

## Receive Messages via Webhooks - Never Poll

WHAPI delivers incoming messages (and all other events) by making HTTP POST requests
to a URL you configure - this is called a webhook.
Calling `getMessages` in a loop to check for new messages is an **anti-pattern**:
it does not deliver messages in real time, burns through API rate limits,
and will miss events that arrive between polling intervals.

---

### Anti-Pattern: Polling

**Incorrect - do NOT do this:**
```python
# WRONG: polling loop
while True:
    messages = get_messages(count=10)
    for msg in messages:
        if is_new(msg):
            handle(msg)
    time.sleep(5)
```

Problems:
- Minimum 5-second latency on incoming messages
- Burns API rate limit quota continuously
- Does not catch all event types (status updates, group changes, calls, etc.)
- Will not scale to multiple users or high message volume

---

### Correct Approach: Webhook

```
WhatsApp user sends a message
        ↓
WhatsApp servers
        ↓
WHAPI receives and parses
        ↓
WHAPI POSTs to your webhook URL  (within ~1 second)
        ↓
Your server handles the event
```

---

### Step 1 - Configure the Webhook URL

**Via REST API (curl):**
```bash
curl --request PATCH \
     --url https://gate.whapi.cloud/settings \
     --header 'accept: application/json' \
     --header 'authorization: Bearer YOUR_TOKEN' \
     --header 'content-type: application/json' \
     --data '{
  "webhooks": [
    {
      "mode": "body",
      "events": [
        { "type": "messages", "method": "post" },
        { "type": "statuses", "method": "post" }
      ],
      "url": "https://your-server.com/webhook"
    }
  ]
}'
```

**Via MCP tool:**
```json
// Tool: updateChannelSettings
// Note: marked [DESTRUCTIVE] - the MCP client will ask for confirmation before executing
{
  "webhooks": [
    {
      "mode": "body",
      "events": [
        { "type": "messages", "method": "post" },
        { "type": "statuses", "method": "post" }
      ],
      "url": "https://your-server.com/webhook"
    }
  ]
}
```

To see all available event types:
```json
// Tool: getAllowedEvents
// No arguments required
// Returns the full list of subscribable event names
```

Your webhook URL must:
- Be publicly accessible (reachable from the internet)
- Accept HTTP POST requests
- Return HTTP 200 within a reasonable timeout (recommended: under 5 seconds)

---

### Common Event Types

| Event name   | Triggered when                                          |
|--------------|---------------------------------------------------------|
| `messages`   | New incoming message (text, media, etc.)               |
| `statuses`   | Message delivery/read status changes                   |
| `chats`      | New chat created or chat updated                       |
| `contacts`   | Contact info changed                                   |
| `groups`     | Group created, participant added/removed, settings changed |
| `calls`      | Incoming call received                                 |

---

### Step 2 - Handle the Webhook Payload

WHAPI sends events as JSON POST body to your URL.
A typical incoming message payload:

```json
{
  "messages": [
    {
      "id": "p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw",
      "from_me": false,
      "type": "text",
      "chat_id": "14155552671@s.whatsapp.net",
      "timestamp": 1712995245,
      "source": "mobile",
      "text": {
        "body": "Hello!"
      },
      "from": "14155552671",
      "from_name": "John"
    }
  ],
  "event": {
    "type": "messages",
    "event": "post"
  },
  "channel_id": "YOUR-CHANNEL-ID"
}
```

Key fields:
- `messages[n].id` - unique message ID (use this as `quoted` when replying)
- `messages[n].chat_id` - Chat ID of the conversation (use this as `to` when replying)
- `messages[n].from_me` - `false` means incoming, `true` means outgoing (sent by your number)
- `messages[n].type` - `text`, `image`, `audio`, `document`, `poll_update`, etc.
- `messages[n].text.body` - text content (only present for type `text`)
- `messages[n].from` - sender's phone number without `@s.whatsapp.net` suffix (use `chat_id` for replies, not `from`)
- `messages[n].from_name` - sender's display name in WhatsApp
- `messages[n].source` - device type (`mobile`, `web`, etc.)
- `channel_id` - your WHAPI channel identifier

For the full list of webhook payload formats for all event types:
[Incoming webhooks format](https://support.whapi.cloud/help-desk/receiving/webhooks/incoming-webhooks-format)

---

### Step 3 - Reply to an Incoming Message

After receiving a webhook event, reply using the sender's `chat_id` and optionally quote
the original message using its `id` - both taken directly from the webhook payload:

```json
// Tool: sendMessageText
{
  "to": "14155552671@s.whatsapp.net",
  "body": "Hello! Thanks for reaching out.",
  "quoted": "p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw"
}
// "to"     = messages[n].chat_id from the webhook payload
// "quoted" = messages[n].id from the webhook payload (optional - quotes the original message)
```

---

### Local Development - Exposing Localhost

To test webhooks locally, use a tunnel service like:
- [ngrok](https://ngrok.com/) - `ngrok http 3000`
- [localtunnel](https://theboroer.github.io/localtunnel-www/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

Then use the tunnel URL as the `url` value inside your `webhooks[]` configuration.

---

**Anti-hallucination - webhook configuration fields that do NOT exist:**
- `webhookUrl` as top-level field - the correct structure is `webhooks[].url` (nested inside the `webhooks` array)
- `events` as a top-level flat array - events go inside `webhooks[].events[].type` and `webhooks[].events[].method`
- `callback_url` - the field is `webhooks[].url`
- `notification_url` - the field is `webhooks[].url`
- omitting `mode` - always include `"mode": "body"` in the webhook object
- omitting `method` per event - always include `"method": "post"` for each event entry
- `subscribe` parameter - events are configured via `webhooks[].events` array
- `secret` parameter in updateChannelSettings - webhook signature is not configured this way

Reference: [Webhooks](https://support.whapi.cloud/help-desk/receiving/webhooks)
