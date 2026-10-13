---
title: Sending Text Messages - Formatting, Emojis, and Link Preview
impact: HIGH
impactDescription: Wrong formatting syntax or incorrect parameter names cause the message to send as plain text or fail entirely
tags: sendMessageText, body, formatting, bold, italic, emoji, line-break, link-preview, typing, quoted, mentions
---

## Sending Text Messages - Formatting, Emojis, and Link Preview

`sendMessageText` sends plain or formatted text. WhatsApp uses its own
markup syntax (not HTML or Markdown) for bold, italic, and other formatting.

---

### Basic Send

**Correct:**
```json
// Tool: sendMessageText
{
  "to": "14155552671@s.whatsapp.net",
  "body": "Hello! Your order has been confirmed."
}
```

Required fields: `to` (Chat ID), `body` (message text)

---

### WhatsApp Text Formatting Syntax

| Effect       | Syntax                   | Example                      |
|--------------|--------------------------|------------------------------|
| Bold         | `*text*`                 | `*Important notice*`         |
| Italic       | `_text_`                 | `_Thank you for your order_` |
| Strikethrough| `~text~`                 | `~Old price: $50~`           |
| Monospace    | `` `text` ``             | `` `ORDER-12345` ``          |
| Line break   | `\n` in JSON string      | `"Line 1\nLine 2"`           |

**Incorrect (HTML/Markdown - not supported by WhatsApp):**
```json
{
  "body": "<b>Important</b> - your order is ready!\n## Details"
}
// WhatsApp renders HTML and Markdown as literal characters
```

**Correct (WhatsApp syntax):**
```json
{
  "body": "*Important* - your order is ready!\n_Details below_"
}
```

---

### Emojis

Emojis work natively - include them directly in the string:
```json
{
  "to": "14155552671@s.whatsapp.net",
  "body": "Your delivery is on the way! \ud83d\ude9a\n\nExpected arrival: *today* by 6 PM"
}
```

---

### Link Preview

By default, WHAPI generates a link preview for the first URL in the message.

To disable preview:
```json
{
  "to": "14155552671@s.whatsapp.net",
  "body": "Check this out: https://example.com",
  "no_link_preview": true
}
```

To request a wide (full-width) preview:
```json
{
  "no_link_preview": false,
  "wide_link_preview": true
}
```

---

### Simulating Typing Before Send

Use `typing_time` to make the bot appear as if it is typing before the message arrives.
Value is in seconds.

```json
{
  "to": "14155552671@s.whatsapp.net",
  "body": "Processing your request...",
  "typing_time": 2
}
// Sends "typing..." indicator for 2 seconds, then delivers the message
```

---

### Replying to a Message (Quote)

```json
{
  "to": "14155552671@s.whatsapp.net",
  "body": "Yes, we can help with that!",
  "quoted": "p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw"
}
// "quoted" is the message ID from a previous message
```

---

### Editing a Sent Message

```json
{
  "to": "14155552671@s.whatsapp.net",
  "body": "Corrected: your order ships on Friday.",
  "edit": "p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw"
}
// "edit" is the message ID of the message to replace
```

---

### Reacting to a Message

Send an emoji reaction to any message using `reactToMessage`.
You need the message ID - get it from a webhook event or a `getMessages` call.

```json
// Tool: reactToMessage
{
  "MessageID": "p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw",
  "emoji": "👍"
}
// Adds a thumbs-up reaction to the specified message
// MessageID comes from messages[n].id in the webhook payload
```

To remove a reaction, send an empty string as the emoji:
```json
// Tool: reactToMessage
{
  "MessageID": "p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw",
  "emoji": ""
}
```

---

### Mentioning Users in Groups

```json
{
  "to": "120363194050948049@g.us",
  "body": "Hey @14155552671, please confirm!",
  "mentions": ["14155552671@s.whatsapp.net"]
}
// Include the phone with @s.whatsapp.net in mentions array
// Write @phone (without suffix) in the body text
```

---

**Anti-hallucination - parameters that do NOT exist in sendMessageText:**
- `message` - the field is `body`
- `text` - the field is `body`
- `content` - the field is `body`
- `html` - WhatsApp does not support HTML
- `markdown` - WhatsApp does not support Markdown
- `subject` - there is no subject in WhatsApp messages
- `title` - use `body`; `title` belongs to `sendMessagePoll`

**Anti-hallucination - reactions:**
- `sendReaction` - the tool is `reactToMessage`
- `reaction` as top-level parameter - the correct field is `emoji`
- `message_id` (snake_case) - the correct field is `MessageID` (PascalCase)

Reference: [Text Formatting Guide](https://support.whapi.cloud/help-desk/faq/whatsapp-text-formatting)
