---
title: Choose the Correct MCP Tool for Each Message Type
impact: CRITICAL
impactDescription: Using a generic or wrong tool causes 400 errors or delivers the wrong message format
tags: message-type, sendMessageText, sendMessageImage, sendMessageVideo, sendMessageAudio, sendMessageVoice, sendMessageDocument, sendMessageGif, sendMessageShort, sendMessagePoll, sendMessageInteractive, sendMessageContact, sendMessageLocation, sendMediaMessage
---

## Choose the Correct MCP Tool for Each Message Type

WHAPI has a dedicated MCP tool for each message type.
Do not use a generic "send message" tool - pick the specific one that matches
what you are sending. Using the wrong tool causes a 400 error or delivers
the content in the wrong format.

---

### Decision Tree

```
What are you sending?
│
├── Text only (with or without link) → sendMessageText
│
├── Image (JPG, PNG, WebP, etc.)    → sendMessageImage
├── Video (MP4, AVI, etc.)          → sendMessageVideo
├── GIF animation (MP4 file)        → sendMessageGif
├── Short video circle (MP4)        → sendMessageShort
│
├── Audio file (MP3, WAV, OGG...)   → sendMessageAudio
├── Voice note (OGG Opus - mic)     → sendMessageVoice
│
├── Document / PDF / any file       → sendMessageDocument
├── Sticker (WebP)                  → sendMessageSticker
│
├── Poll with options               → sendMessagePoll
├── Buttons / List / Interactive    → sendMessageInteractive  ⚠️ unstable
│     ├── Quick-reply buttons      → type: "button"
│     └── Scrollable list menu     → type: "list"
│
├── vCard / contact sharing         → sendMessageContact
│                                      or sendMessageContactList
│
├── Location pin                    → sendMessageLocation
├── Live location                   → sendMessageLiveLocation
│
└── Any media (shortcut, multitype) → sendMediaMessage
```

---

### Key Distinctions to Remember

**Voice vs Audio:**
- `sendMessageVoice` - sends as a voice note (microphone icon, waveform UI)
  - File must be OGG Opus format for best compatibility
- `sendMessageAudio` - sends as an audio file (music note icon, player UI)
  - Accepts MP3, WAV, OGG, M4A, etc.

**GIF vs Video:**
- `sendMessageGif` - the file MUST be an MP4 (not a real .gif file)
  - WhatsApp renders it as an auto-playing GIF
- `sendMessageVideo` - standard video with controls and duration

**Short Video:**
- `sendMessageShort` - circular video preview (like Instagram Reels format)
  - Must be MP4 format

**sendMediaMessage (generic shortcut):**
- Accepts any media type via the `MediaMessageType` parameter
- Useful when you do not know the type in advance or are wrapping a generic sender
- Requires both `MediaMessageType` and `SendParams` fields

---

### Quick Reference Table

| Content          | MCP Tool                  | Required Fields      |
|------------------|---------------------------|----------------------|
| Text             | `sendMessageText`         | `to`, `body`         |
| Image            | `sendMessageImage`        | `to`, `media`        |
| Video            | `sendMessageVideo`        | `to`, `media`        |
| GIF (MP4)        | `sendMessageGif`          | `to`, `media`        |
| Short video      | `sendMessageShort`        | `to`, `media`        |
| Audio file       | `sendMessageAudio`        | `to`, `media`        |
| Voice note       | `sendMessageVoice`        | `to`, `media`        |
| Document         | `sendMessageDocument`     | `to`, `media`        |
| Sticker (WebP)   | `sendMessageSticker`      | `to`, `media`        |
| Poll             | `sendMessagePoll`         | `to`, `title`, `options` |
| Buttons/List     | `sendMessageInteractive`  | `to`, `action`, `type` |
| Contact vCard    | `sendMessageContact`      | `to`, `vcard`        |
| Location         | `sendMessageLocation`     | `to`, `lat`, `lon`   |
| Any media        | `sendMediaMessage`        | `MediaMessageType`, `SendParams` |

---

**Anti-hallucination - tools and parameters that do NOT exist:**
- `sendMessage` - no generic tool with this name; use the type-specific tool
- `send_message` - snake_case; WHAPI MCP uses camelCase tool names
- `type` parameter in `sendMessageText` - text has no `type` field
- `format` parameter - does not exist in any send tool
- `content` parameter - the field is `body` for text or `media` for files

Reference: [Sending Messages](https://support.whapi.cloud/help-desk/sending)
