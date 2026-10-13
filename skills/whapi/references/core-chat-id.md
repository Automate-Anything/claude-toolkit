---
title: Always Use the Correct Chat ID Format
impact: CRITICAL
impactDescription: Using the wrong Chat ID format causes a 400 Bad Request on every send call
tags: chat-id, to, phone, group, channel, newsletter, s.whatsapp.net, g.us
---

## Always Use the Correct Chat ID Format

Every WHAPI send call requires a `to` parameter containing the full Chat ID.
Chat ID format depends on the chat type - using the wrong format causes a 400 error
or routes the message to the wrong recipient.

---

### Personal Chat (1-on-1)

**Incorrect:**
```
14155552671
+14155552671
14155552671@c.us         ← old format, no longer valid
```

**Correct:**
```
14155552671@s.whatsapp.net
```

Format: `{full_phone_number_with_country_code}@s.whatsapp.net`
- No `+` prefix
- No spaces or dashes
- Always include the country code (e.g., `1` for US, `44` for UK, `61` for Australia)

Example: Australian number +61 3 9914 5883 → `61399145883@s.whatsapp.net`

---

### Group Chat

**Incorrect:**
```
mygroup
1234567890@s.whatsapp.net   ← wrong suffix for a group
```

**Correct:**
```
120363194050948049@g.us
```

Format: `{group_id}@g.us`

How to get a group ID - use the `getGroups` MCP tool:
```json
// Tool: getGroups
// Returns a list with each group's "id" field
// Example response: { "id": "120363194050948049@g.us", "name": "Team Chat" }
```

You cannot construct a group ID manually - always fetch it via the API.

---

### Channel / Newsletter

**Incorrect:**
```
120363171743427809@g.us     ← wrong suffix for a channel
MyChannelName               ← name is not a valid ID
```

**Correct:**
```
120363171743427809@newsletter
```

Format: `{channel_id}@newsletter`

How to get a channel ID - use the `getNewsletters` MCP tool:
```json
// Tool: getNewsletters
// Returns list with each newsletter's "id" field
```

---

### Quick Reference Table

| Chat Type       | Format                             | How to Get ID          |
|-----------------|------------------------------------|------------------------|
| Personal        | `{phone}@s.whatsapp.net`          | Compose from phone number |
| Group           | `{id}@g.us`                       | `getGroups` tool       |
| Channel/Newsletter | `{id}@newsletter`             | `getNewsletters` tool  |

---

### LID (New WhatsApp Identifier)

WhatsApp is gradually introducing a new identifier system called LID.
If you receive a LID and need to convert it to a standard ID, use:
- `getLidById` - get LID from a known Chat ID
- `getLidByIds` - batch conversion

Do not pass raw LID values directly to the `to` parameter without conversion.

---

**Anti-hallucination - Chat ID variants that do NOT exist:**
- `@c.us` - outdated, no longer works for personal chats
- `@chat` - does not exist
- `chat_id` parameter - the field is called `to`
- `phone` parameter - the field is called `to`
- `recipient` parameter - the field is called `to`
- `number` parameter - the field is called `to`

Reference: [Chat ID Documentation](https://support.whapi.cloud/help-desk/faq/chat-id.-what-is-it-and-how-to-get-it)
