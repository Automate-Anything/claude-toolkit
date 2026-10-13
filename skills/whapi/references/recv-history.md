---
title: Reading Message History - getMessages vs getMessagesByChatID
impact: MEDIUM
impactDescription: Using the wrong tool or missing required parameters causes an empty result or 400 error
tags: getMessages, getMessagesByChatID, getMessage, history, count, offset, time_from, time_to, from_me, sort, pagination
---

## Reading Message History - getMessages vs getMessagesByChatID

Use message history tools to retrieve past messages for display, audit, or context.
There are two tools, and the choice depends on whether you know the Chat ID.

---

### Two Tools for History

| Tool                    | Use when                                   | Required fields |
|-------------------------|--------------------------------------------|-----------------|
| `getMessages`           | Get all recent messages across all chats   | None            |
| `getMessagesByChatID`   | Get messages for a specific chat           | `ChatID`        |
| `getMessage`            | Get one specific message by its ID         | `MessageID`     |

---

### getMessagesByChatID (Most Common Use Case)

Use this when you know the Chat ID and need the conversation history.

**Incorrect (missing ChatID - causes 400):**
```json
// Tool: getMessagesByChatID
{
  "count": 20
}
// ChatID is required - the call fails without it
```

**Correct:**
```json
// Tool: getMessagesByChatID
{
  "ChatID": "14155552671@s.whatsapp.net",
  "count": 20,
  "offset": 0
}
// Returns the 20 most recent messages in this chat, newest first
```

---

### getMessages (Cross-Chat History)

Returns messages across all chats. Useful for getting a recent activity feed.

```json
// Tool: getMessages
{
  "count": 50,
  "from_me": false
}
// Returns 50 most recent incoming messages across all chats
```

---

### Filtering Options (Both Tools)

All filters are optional:

| Parameter     | Type    | Description                                                 |
|---------------|---------|-------------------------------------------------------------|
| `count`       | number  | Number of messages to return (default: 100)                 |
| `offset`      | number  | Skip N messages (for pagination)                            |
| `time_from`   | number  | Unix timestamp - only messages after this time              |
| `time_to`     | number  | Unix timestamp - only messages before this time             |
| `from_me`     | boolean | `true` = only my sent messages, `false` = only incoming     |
| `normal_types`| boolean | `false` = include system messages (join/leave events, etc.) |
| `author`      | string  | Filter by sender Contact ID                                 |
| `sort`        | string  | Sorting order for results                                   |

---

### Pagination

Messages are returned in descending order (newest first).
Use `offset` to paginate:

```json
// Page 1: messages 0-19
{ "ChatID": "14155552671@s.whatsapp.net", "count": 20, "offset": 0 }

// Page 2: messages 20-39
{ "ChatID": "14155552671@s.whatsapp.net", "count": 20, "offset": 20 }
```

---

### Getting a Single Message

If you have a message ID (e.g., from a webhook event):

```json
// Tool: getMessage
{
  "MessageID": "ABCDEF1234567890"
}
```

---

### Important: History vs Real-Time

Message history tools retrieve **past messages** only.
They do NOT notify you about new incoming messages.
For real-time incoming message handling, always use webhooks.
See `recv-webhooks.md`.

---

**Anti-hallucination - parameters that do NOT exist:**
- `chat_id` (snake_case) - the parameter is `ChatID` (PascalCase) in `getMessagesByChatID`
- `to` in getMessages tools - the `to` field is only for send tools
- `limit` - the field is `count`
- `page` - use `offset` for pagination (not page number)
- `before` / `after` - use `time_from` / `time_to` with Unix timestamps
- `type` filter - there is no message type filter in these tools

Reference: [Get Messages API](https://whapi.readme.io/reference/getmessages)
