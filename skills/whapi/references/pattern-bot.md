---
title: Bot Pattern - Receive Webhook, Process, Reply
impact: HIGH
impactDescription: Bots built without webhook-first architecture will miss messages and not scale
tags: bot, webhook, incoming, reply, echo-bot, keyword, from_me, chat_id, updateChannelSettings, sendMessageText
---

## Bot Pattern - Receive Webhook, Process, Reply

A WhatsApp bot using WHAPI works in three steps:
1. **Configure** - set your webhook URL in channel settings
2. **Receive** - WHAPI calls your webhook with incoming messages
3. **Reply** - your server calls WHAPI to send a response

This pattern applies whether you build a simple echo bot, a keyword-based responder,
or a full AI-powered assistant.

---

### Architecture

```
User sends message
      ↓
WHAPI → POST /your-webhook  (JSON payload)
      ↓
Your server parses event
      ↓
Your server calls WHAPI sendMessageText (or other tool)
      ↓
User receives reply
```

---

### Step 1 - Configure Webhook (one time)

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

---

### Step 2 - Handle Incoming Webhook

Your server receives a POST request. Parse the body to extract the message:

```python
# Python / Flask example
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/whapi-webhook", methods=["POST"])
def webhook():
    data = request.json

    # Skip if no messages in payload
    if "messages" not in data:
        return jsonify({"status": "ok"})

    for message in data["messages"]:
        # Skip messages sent by yourself (from_me = True)
        if message.get("from_me"):
            continue

        # Only handle text messages for this example
        if message.get("type") != "text":
            continue

        chat_id = message["chat_id"]           # e.g., "14155552671@s.whatsapp.net"
        text = message["text"]["body"]         # the actual message text
        message_id = message["id"]             # for quoting the reply

        handle_message(chat_id, text, message_id)

    return jsonify({"status": "ok"})
```

---

### Step 3 - Reply to the User

```python
import requests

WHAPI_TOKEN = "your_api_token"
WHAPI_URL = "https://gate.whapi.cloud/messages/text"

def handle_message(chat_id, text, message_id):
    # Simple echo bot - replies with the same text
    reply_text = f"You said: {text}"

    response = requests.post(
        WHAPI_URL,
        headers={"Authorization": f"Bearer {WHAPI_TOKEN}"},
        json={
            "to": chat_id,           # use chat_id from the webhook payload
            "body": reply_text,
            "quoted": message_id     # optional: quote the original message
        }
    )
    return response.json()
```

Or using MCP:
```json
// Tool: sendMessageText
{
  "to": "14155552671@s.whatsapp.net",
  "body": "You said: Hello!",
  "quoted": "ABCDEF1234567890"
}
```

---

### Keyword-Based Bot

```python
def handle_message(chat_id, text, message_id):
    text_lower = text.lower().strip()

    if "price" in text_lower or "cost" in text_lower:
        reply = "Our pricing starts at $29/month. Visit example.com/pricing for details."
    elif "help" in text_lower:
        reply = "I can help with: *pricing*, *support*, *orders*. What do you need?"
    elif "hi" in text_lower or "hello" in text_lower:
        reply = "Hello! \ud83d\udc4b How can I help you today?"
    else:
        reply = "I didn't understand that. Type *help* to see available commands."

    send_reply(chat_id, reply)
```

---

### AI-Powered Bot (with MCP)

When using an AI agent + WHAPI MCP:

1. Receive webhook payload (your server or n8n/Make/Zapier catches it)
2. Pass the message text to your AI agent with context
3. AI agent calls `sendMessageText` via MCP to reply

```
Webhook → n8n HTTP trigger → AI Agent node → MCP sendMessageText
```

The AI agent should:
- Extract `chat_id` from `messages[0].chat_id` in the payload
- Use that `chat_id` as `to` in `sendMessageText`
- Never call `getMessages` in a loop - respond only to what arrives via webhook

---

### Important: Filter Your Own Messages

Always check `from_me` in the webhook payload.
If you do not filter out messages sent by your own number, you will create
an infinite loop where your bot replies to its own messages.

```python
if message.get("from_me"):
    continue  # skip - this is our own outgoing message
```

---

**Anti-hallucination - common bot mistakes:**
- Using `getMessages` in a loop instead of webhooks
- Passing raw phone number (without `@s.whatsapp.net`) as `to`
- Using `message` field instead of `body` in `sendMessageText`
- Replying to `from_me: true` messages (causes infinite loop)
- Using `chat_id` as the parameter name (WHAPI send tools use `to`)

Reference: [Webhooks](https://support.whapi.cloud/help-desk/receiving/webhooks) | [Sending Guide](https://support.whapi.cloud/help-desk/sending)
