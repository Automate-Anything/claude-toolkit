# Section Definitions

This file defines the 7 rule categories for WHAPI API references.
Rules are assigned to sections based on their filename prefix.

---

## 1. Core Concepts (core)

**Impact:** CRITICAL
**Description:** Foundational concepts that every integration must understand.
Includes Chat ID formats, authentication, and MCP configuration.
Errors here break every other part of the integration.

## 2. Messaging - Sending (msg)

**Impact:** CRITICAL / HIGH
**Description:** Sending messages of all types: text, media, interactive, polls.
Covers how to pick the correct tool and supply parameters correctly.
Wrong tool selection causes 400 errors or unexpected behavior.

## 3. Receiving Messages (recv)

**Impact:** CRITICAL / MEDIUM
**Description:** Receiving incoming messages and events via webhooks.
Polling via `getMessages` in a loop is an anti-pattern that wastes API quota
and misses real-time delivery. Webhooks are the correct approach.

## 4. Groups (groups)

**Impact:** HIGH
**Description:** Creating and managing WhatsApp groups.
Includes participant management, invite links, and group settings.
Group IDs have a specific format that differs from personal chat IDs.

## 5. Channels / Newsletters (channels)

**Impact:** HIGH
**Description:** WhatsApp Channels (also called Newsletters in the API) -
unidirectional broadcasting to subscribers.
Channel IDs use the `@newsletter` suffix, distinct from groups and personal chats.

## 6. Communities (communities)

**Impact:** MEDIUM
**Description:** WhatsApp Communities - collections of groups under a single umbrella.
Community management requires specific tools distinct from group management.

## 7. Integration Patterns (pattern)

**Impact:** HIGH / MEDIUM
**Description:** Ready-made recipes for common integration scenarios.
Shows how to combine multiple API calls into working bot, broadcast,
or CRM integration workflows.
