---
title: Clear, Action-Oriented Title (e.g., "Always Use @s.whatsapp.net for Personal Chats")
impact: CRITICAL|HIGH|MEDIUM
impactDescription: What breaks if this rule is ignored (e.g., "400 Bad Request on every send call")
tags: comma, separated, keywords
---

## [Rule Title]

[1-2 sentences explaining the problem and why it matters. Focus on what breaks.]

**Incorrect (describe the problem):**

```json
{
  "to": "14155552671",
  "body": "Hello"
}
// Missing @s.whatsapp.net suffix → 400 Bad Request
```

**Correct (describe the solution):**

```json
{
  "to": "14155552671@s.whatsapp.net",
  "body": "Hello"
}
// Full Chat ID format → message delivered successfully
```

[Optional: additional context, edge cases, or decision logic]

**Anti-hallucination - parameters that do NOT exist:**
- `phone` - use `to` instead
- `chat_id` - use `to` instead
- `recipient` - use `to` instead

Reference: [WHAPI Docs](https://support.whapi.cloud/help-desk)
