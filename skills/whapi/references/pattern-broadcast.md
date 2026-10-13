---
title: Broadcast Pattern - Send to Multiple Recipients Safely
impact: HIGH
impactDescription: Bulk API sending without proper warmup and delays is one of the fastest ways to get a WhatsApp number permanently banned
tags: broadcast, bulk, multiple-recipients, rate-limit, delay, getLimits, sendMessageText, loop, anti-spam, ban-risk, warmup
---

## Broadcast Pattern - Send to Multiple Recipients Safely

> **WARNING - High ban risk.** Sending bulk messages via WhatsApp API is one of the
> fastest ways to get your number permanently banned. WhatsApp's anti-spam systems
> are aggressive and improve every year. Before writing any code, consider safer
> alternatives first:
>
> - **WhatsApp Channel (Newsletter)** - subscribers opt in, no ban risk, no delays needed.
>   See `channels-management.md`.
> - **WhatsApp Group** - bidirectional, opt-in by invite. See `groups-management.md`.
>
> Only proceed with direct API bulk sending if you have a specific use case that
> channels and groups cannot serve (e.g., personalized transactional messages).

> **Note - WhatsApp "Broadcast" feature vs. API bulk sending:**
> WhatsApp mobile app has a built-in "Broadcast" feature that lets you send a
> message to multiple contacts at once from your phone. This feature is **not
> accessible via the API**. What is described here is a different approach:
> sending individual API messages to a list of recipients one by one, in a loop.
> The concepts are not the same.

---

### Three Approaches Compared

| Approach             | When to use                                          | Ban risk |
|----------------------|------------------------------------------------------|----------|
| Loop over contacts   | Personalized transactional messages (receipts, OTPs) | HIGH     |
| WhatsApp Group       | Team/community communication, opt-in audience        | None     |
| Channel (Newsletter) | One-way announcements, large opt-in audience         | None     |

For large-scale broadcasting (hundreds or thousands of recipients), use a WhatsApp
Channel. See `channels-management.md`.

---

### Prerequisites and Safety Rules

Before sending to multiple recipients via API loop, all of the following must be in place:

1. **Use a warmed number.** The older and more active the WhatsApp number, the
   more resistant it is to bans. A fresh number will likely be banned within hours
   of bulk sending. The longer a number has been registered with WhatsApp, the
   more resistant it is to blocking.

2. **Warm up the API connection first.** Connecting an old number to the API does
   not automatically transfer its trust score. Start with just a few messages per
   day via API, then increase gradually over days and weeks before attempting
   any bulk sending.

3. **Hard limits - never exceed these:**
   - No more than 10 messages per 15 minutes (≈ 1 message per 90 seconds)
   - No more than 2 messages per minute during any burst
   - No more than 6 hours of sending per day
   - No more than 3 consecutive days of sending

4. **Write to warm contacts only.** Sending to numbers that have never messaged
   you before dramatically increases ban probability. People who have previously
   written to you first are far safer targets.

5. **Personalize every message.** Identical messages sent to many recipients is a
   primary spam signal. Vary the wording for each recipient.

6. **Include an opt-out.** Add a STOP keyword option at the end of the message.
   Aim for at least 30% reply rate - engaged audiences significantly reduce ban risk.

Reference: [How to do mailings without the risk of being blocked](https://support.whapi.cloud/help-desk/blocking/how-to-do-mailings-without-the-risk-of-being-blocked)

---

### Safe Broadcast Loop

**Incorrect (no delay - triggers spam detection immediately):**
```python
for phone in contact_list:
    send_message(phone, "Hello! Our sale starts today.")
# Sends all messages instantly - WhatsApp will ban the number
```

**Correct (with long delays between messages):**
```python
import time
import requests

WHAPI_TOKEN = "your_api_token"
WHAPI_URL = "https://gate.whapi.cloud/messages/text"

def send_broadcast(contact_list, message_template):
    results = []
    for phone in contact_list:
        chat_id = f"{phone}@s.whatsapp.net"

        # Personalize the message - identical messages increase ban risk
        body = message_template.format(name=phone)

        response = requests.post(
            WHAPI_URL,
            headers={"Authorization": f"Bearer {WHAPI_TOKEN}"},
            json={"to": chat_id, "body": body}
        )
        results.append({"phone": phone, "status": response.status_code})

        # Wait at least 90 seconds between messages (max 10 per 15 min rule).
        # IMPORTANT: if you also use typing_time in the API call, it adds ON TOP
        # of this sleep. Example: typing_time=2 + time.sleep(90) = ~92 sec total.
        time.sleep(90)

    return results
```

Or using MCP in a loop - call once per recipient, never in parallel:
```json
// Tool: sendMessageText
// Do NOT add typing_time in bulk loops - it adds to total delay between messages
{
  "to": "14155552671@s.whatsapp.net",
  "body": "Hi John! Our sale starts today. 20% off everything."
}
```

---

### Recommended Delays

Based on the hard limit of no more than 10 messages per 15 minutes:

| List size | Min delay between sends    | Session limit              | Risk level                          |
|-----------|----------------------------|----------------------------|-------------------------------------|
| 1-20      | 60-90 seconds              | 1 session per day          | Moderate (warmed number required)   |
| 21-50     | 90-120 seconds             | 1 session/day, rest next day | High (warmed number + API required) |
| 50+       | Use Channel or Group instead | -                        | Very high - direct API not recommended |

**Hard caps:**
- Never exceed 10 messages per any 15-minute window
- Max 6 hours of sending per day
- Max 3 consecutive days of sending, then pause

---

### Check Your Sending Limits

Trial and sandbox channels have message limits. Check remaining quota:

```json
// Tool: getLimits
// No arguments required
// Returns remaining and used limits for your channel
```

---

### Personalized Messages

Personalized messages look less like spam and improve delivery rates.
Include the recipient's name or specific details:

```python
def build_message(contact):
    return (
        f"Hello {contact['name']}! \U0001f44b\n\n"
        f"Your order #{contact['order_id']} is ready for pickup.\n"
        f"Pick up location: *{contact['store']}*\n\n"
        f"Reply STOP to unsubscribe."
    )
```

---

### Using typing_time for Natural Feel

`typing_time` makes automated messages feel more human by showing a "typing..." indicator
before delivery. Use it for individual messages. In bulk loops, it adds to total send time:

```json
// Tool: sendMessageText
{
  "to": "14155552671@s.whatsapp.net",
  "body": "Your appointment is confirmed for tomorrow at 10:00 AM.",
  "typing_time": 2
}
// Shows "typing..." for 2 seconds before the message is delivered.
// In a loop with time.sleep(90): total time per message ≈ 92 seconds.
```

---

### Large Audience - Use a Channel Instead

For recurring newsletters or announcements to hundreds of subscribers,
create a WhatsApp Channel (Newsletter) and let users subscribe:

```json
// Tool: createNewsletter
{
  "name": "Our Company Updates",
  "description": "Subscribe to get weekly news and offers"
}
```

Benefits of channels for broadcast:
- No anti-spam risk - WhatsApp is designed for this use case
- Subscribers opt in themselves
- No need to manage a phone number list
- No delays required between messages

---

**Anti-hallucination - broadcast fields that do NOT exist:**
- `recipients` parameter - there is no bulk-send endpoint; call `sendMessageText` once per recipient
- `to` as an array - `to` is always a single string (one Chat ID)
- `batch` parameter - does not exist
- `sendBulkMessages` tool - does not exist in WHAPI
- `broadcast` tool - does not exist; use loop or Channel

Reference: [Sending Guide](https://support.whapi.cloud/help-desk/sending) | [Channels](https://support.whapi.cloud/help-desk/channels) | [Anti-spam Guide](https://support.whapi.cloud/help-desk/blocking/how-to-do-mailings-without-the-risk-of-being-blocked)
