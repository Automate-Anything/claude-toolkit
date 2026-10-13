# WHAPI Agent Skill - Navigation Guide

Comprehensive guide for AI agents building WhatsApp integrations via WHAPI.cloud.
Use the MCP server (`whapi-mcp`) to call the API from within
Cursor, Claude Desktop, or any MCP-compatible client.

## Structure

```
whapi/
  SKILL.md        # Main skill manifest - read this first
  AGENTS.md       # This navigation guide
  references/     # Detailed reference files - load on demand
```

## Quick Start

```
New to WHAPI? Read in this order:
  1. references/core-mcp-setup.md   ← install and configure the MCP
  2. references/core-chat-id.md     ← understand Chat ID formats (most common error)
  3. references/core-auth.md        ← authenticate direct REST calls
  4. references/msg-type-selection.md ← choose the right send tool
  5. references/recv-webhooks.md    ← receive incoming messages (never poll)
```

---

## MCP as Source of Truth for Undocumented Endpoints

This skill documents the most common operations. The `whapi-mcp` MCP server
exposes ALL available API methods.

**When you need an operation not listed in this guide:**
1. List available MCP tools and find the matching one.
2. Use ONLY parameters from the MCP tool schema - never invent parameter names.
3. Still apply Chat ID format rules (`core-chat-id.md`) and auth rules (`core-auth.md`).
4. Do NOT fall back to REST guessing if the MCP tool is available.

---

## 1. Core Concepts - CRITICAL

Read these before anything else. Errors here break every other part of the integration.

| File | What it covers |
|------|----------------|
| [`references/core-chat-id.md`](references/core-chat-id.md) | Chat ID formats: `@s.whatsapp.net` (personal), `@g.us` (group), `@newsletter` (channel). The #1 source of errors. |
| [`references/core-mcp-setup.md`](references/core-mcp-setup.md) | Installing `whapi-mcp` for Cursor and Claude Desktop. Quick run via npx. |
| [`references/core-auth.md`](references/core-auth.md) | Bearer token authentication, base URL, channel settings (webhook URL + events). |

---

## 2. Messaging - Sending - CRITICAL / HIGH

| File | What it covers |
|------|----------------|
| [`references/msg-type-selection.md`](references/msg-type-selection.md) | Decision tree: which MCP tool to call based on what you are sending (text, image, video, voice, document, poll, etc.). |
| [`references/msg-text.md`](references/msg-text.md) | Text formatting (bold, italic), emojis, line breaks, link preview, typing simulation, quoting, mentions, reactions. |
| [`references/msg-media.md`](references/msg-media.md) | Media files: URL vs base64, MIME types per format, voice vs audio distinction, captions, encoding options. |
| [`references/msg-interactive.md`](references/msg-interactive.md) | Polls (stable) and interactive messages (unstable): Quick-reply buttons (`type: "button"`) and List of options (`type: "list"`). Correct `action` structures for each type, incorrect examples that cause 400 errors, poll response tracking. |

---

## 3. Receiving Messages - CRITICAL / MEDIUM

| File | What it covers |
|------|----------------|
| [`references/recv-webhooks.md`](references/recv-webhooks.md) | Webhook setup, event types, payload structure. Why polling with `getMessages` is an anti-pattern. |
| [`references/recv-history.md`](references/recv-history.md) | Reading message history: `getMessages` vs `getMessagesByChatID`, pagination, filters. |

---

## 4. Groups - HIGH

| File | What it covers |
|------|----------------|
| [`references/groups-management.md`](references/groups-management.md) | Create group, get group ID, add/remove participants, invite links, admin management, group settings. |

---

## 5. Channels / Newsletters - HIGH

| File | What it covers |
|------|----------------|
| [`references/channels-management.md`](references/channels-management.md) | Create channel, post messages using `@newsletter` ID, subscribe/unsubscribe, admin invites. |

---

## 6. Communities - MEDIUM

| File | What it covers |
|------|----------------|
| [`references/communities-management.md`](references/communities-management.md) | Create community, link groups, manage participants, send announcements via Announcements group. |

---

## 7. Integration Patterns - HIGH / MEDIUM

| File | What it covers |
|------|----------------|
| [`references/pattern-bot.md`](references/pattern-bot.md) | Full bot recipe: configure webhook → receive message → filter `from_me` → reply. AI agent pattern included. |
| [`references/pattern-broadcast.md`](references/pattern-broadcast.md) | Safe broadcast loop with delays, channel-based broadcasting for large audiences, rate limits. |

---

## Most Common AI Mistakes (Quick Reference)

| Mistake | Correct approach | Reference |
|---------|------------------|-----------|
| Using `@c.us` for personal chat | Use `@s.whatsapp.net` | `core-chat-id.md` |
| Passing bare phone number to `to` | Add `@s.whatsapp.net` suffix | `core-chat-id.md` |
| Using `sendMessage` (generic) | Use the type-specific tool | `msg-type-selection.md` |
| Polling `getMessages` in a loop | Set up webhook and listen | `recv-webhooks.md` |
| Using `message` field instead of `body` | Use `body` for text content | `msg-text.md` |
| Sending voice with `sendMessageAudio` | Use `sendMessageVoice` for voice notes | `msg-media.md` |
| Using `API_KEY` env var for MCP | Use `API_TOKEN` | `core-mcp-setup.md` |
| Using `X-API-Key` header | Use `Authorization: Bearer {token}` | `core-auth.md` |
| Replying to own messages (infinite loop) | Filter `from_me: true` in webhook handler | `pattern-bot.md` |
| Sending to all recipients at once | Add 60-90 second delays; max 10 per 15 min | `pattern-broadcast.md` |
| Using `"type": "reply"` with nested `reply` object for buttons | Use `"type": "quick_reply"` with flat `title` and `id` | `msg-interactive.md` |
| Putting `sections` directly in `action` for list messages | Wrap in `action.list{ sections[], label }` | `msg-interactive.md` |
