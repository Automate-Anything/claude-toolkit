---
title: Authentication, Channel Settings, and API Base URL
impact: CRITICAL
impactDescription: Wrong auth or base URL causes all API calls to fail with 401 or 404
tags: auth, token, api-key, bearer, base-url, channel-settings, headers
---

## Authentication, Channel Settings, and API Base URL

Every WHAPI API request is authenticated with a channel-specific Bearer token.
The token is passed in the `Authorization` header for direct REST calls,
or via the `API_TOKEN` environment variable when using the MCP server.

---

### Authentication for Direct REST Calls

**Incorrect:**
```http
GET https://gate.whapi.cloud/messages
X-API-Key: my_token_here
```

**Correct:**
```http
GET https://gate.whapi.cloud/messages
Authorization: Bearer my_token_here
```

Header name: `Authorization`
Header value: `Bearer {your_token}`

---

### Base URL

All WHAPI REST API endpoints use this base URL:
```
https://gate.whapi.cloud/
```

Full endpoint examples:
```
GET  https://gate.whapi.cloud/messages
POST https://gate.whapi.cloud/messages/text
GET  https://gate.whapi.cloud/groups
POST https://gate.whapi.cloud/groups
```

Do not construct endpoints with other base URLs - the API does not support custom domains
unless you are on an enterprise plan with a dedicated instance.

---

### Channel Settings (Webhook URL and Events)

Before receiving incoming messages, configure your channel settings.
Use the `updateChannelSettings` MCP tool or `PATCH /settings` REST endpoint:

```json
// Tool: updateChannelSettings
// Note: marked [DESTRUCTIVE] - the MCP client will ask for confirmation before executing
{
  "webhooks": [
    {
      "mode": "body",
      "events": [
        { "type": "messages", "method": "post" },
        { "type": "statuses", "method": "post" },
        { "type": "chats", "method": "post" },
        { "type": "contacts", "method": "post" },
        { "type": "groups", "method": "post" },
        { "type": "calls", "method": "post" }
      ],
      "url": "https://your-server.com/webhook"
    }
  ]
}
```

To see which events are available:
```json
// Tool: getAllowedEvents
// No arguments required
// Returns the full list of event names you can subscribe to
```

---

### One Token = One Channel = One WhatsApp Number

WHAPI is multi-channel: each connected WhatsApp number is a separate channel
with its own API token. If you need to manage multiple numbers, you will have
multiple tokens - one per channel.

Do not reuse the same token across different channels.

---

### Checking Channel Status

Two tools are available:

```json
// Tool: checkHealth
// No arguments required
// Returns detailed channel status including status.text (AUTH, QR, INIT, LAUNCH, STOP, SYNC_ERROR)
// Use this to diagnose connection issues - see the Prerequisites table in SKILL.md for status meanings

// Tool: hello
// No arguments required
// Returns a lightweight ping response with the connected phone number info
// Use this just to confirm the API token is working
```

---

**Anti-hallucination - auth fields that do NOT exist:**
- `X-API-Key` header - use `Authorization: Bearer {token}`
- `apiKey` query parameter - WHAPI does not support query-param auth
- `token` header - the correct header is `Authorization`
- `client_id` / `client_secret` - WHAPI uses simple Bearer token auth, not OAuth
- `WHAPI_API_KEY` env variable - for MCP, the correct name is `API_TOKEN`

Reference: [WHAPI API Reference](https://whapi.readme.io/reference)
