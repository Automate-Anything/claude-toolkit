---
title: Sending Media Files - URL vs Base64, MIME Types, and Captions
impact: HIGH
impactDescription: Providing media in the wrong format or wrong MIME type causes 400 errors or delivers the file as the wrong type
tags: media, image, video, audio, voice, document, base64, url, mime_type, caption, sendMessageImage, sendMessageVideo, sendMessageAudio, sendMessageVoice, sendMessageDocument
---

## Sending Media Files - URL vs Base64, MIME Types, and Captions

All media-type send tools (`sendMessageImage`, `sendMessageVideo`, etc.) share
the same `media` parameter. It accepts either a public URL or a base64-encoded string.
Choose the correct format and always specify `mime_type` when using base64.

---

### Two Ways to Provide Media

#### Option 1 - Public URL (preferred)

WHAPI fetches and sends the file from the URL you provide.
The URL must be publicly accessible (no auth required).

```json
// Tool: sendMessageImage
{
  "to": "14155552671@s.whatsapp.net",
  "media": "https://example.com/images/product.jpg",
  "caption": "Here is your product photo"
}
```

Advantages: simple, no size overhead, file is not re-encoded by default.

#### Option 2 - Base64 String

Encode the file as a base64 string and pass it directly.
You MUST include `mime_type` when using base64 - otherwise the API cannot determine
the file type.

**Incorrect (base64 without mime_type):**
```json
{
  "to": "14155552671@s.whatsapp.net",
  "media": "data:image/jpeg;base64,/9j/4AAQSkZJRgAB..."
}
// If mime_type is omitted, WHAPI may misidentify the file type
```

**Correct:**
```json
{
  "to": "14155552671@s.whatsapp.net",
  "media": "/9j/4AAQSkZJRgAB...",
  "mime_type": "image/jpeg",
  "caption": "Your receipt"
}
// Pass raw base64 (without the data: prefix) + explicit mime_type
```

---

### MIME Types by Message Type

| Tool                   | Accepted formats          | MIME type examples                    |
|------------------------|---------------------------|---------------------------------------|
| `sendMessageImage`     | JPG, PNG, WebP, GIF       | `image/jpeg`, `image/png`, `image/webp` |
| `sendMessageVideo`     | MP4, AVI, MOV             | `video/mp4`                           |
| `sendMessageGif`       | MP4 only (not .gif)       | `video/mp4`                           |
| `sendMessageShort`     | MP4 only                  | `video/mp4`                           |
| `sendMessageAudio`     | MP3, WAV, OGG, M4A        | `audio/mpeg`, `audio/ogg`, `audio/mp4` |
| `sendMessageVoice`     | OGG Opus (recommended)    | `audio/ogg; codecs=opus`              |
| `sendMessageDocument`  | Any file type             | `application/pdf`, `text/csv`, etc.   |
| `sendMessageSticker`   | WebP only                 | `image/webp`                          |

---

### Voice Notes vs Audio Files

This is a common mistake - they use different tools and behave differently in WhatsApp UI:

**Incorrect (using audio tool for a voice note):**
```json
// Tool: sendMessageAudio  ← wrong tool for voice notes
{
  "to": "14155552671@s.whatsapp.net",
  "media": "https://example.com/voice.ogg"
}
// Delivered as an audio file (music note icon), not a voice note
```

**Correct (voice note with waveform UI):**
```json
// Tool: sendMessageVoice
{
  "to": "14155552671@s.whatsapp.net",
  "media": "https://example.com/voice.ogg",
  "mime_type": "audio/ogg; codecs=opus",
  "seconds": 12
}
// Delivered as a voice note with waveform display
```

---

### Captions

Most media tools support an optional `caption` to display text under the media.
Caption is not available for voice notes, stickers, or short videos.

```json
// Tool: sendMessageDocument
{
  "to": "14155552671@s.whatsapp.net",
  "media": "https://example.com/report.pdf",
  "mime_type": "application/pdf",
  "filename": "Monthly_Report_March.pdf",
  "caption": "Please review the attached monthly report"
}
```

---

### Disabling WHAPI Re-encoding

By default, WHAPI may re-encode media for WhatsApp compatibility.
To skip re-encoding (when your file is already in the correct format):
```json
{
  "no_encode": true
}
```

---

### Caching

WHAPI caches media files by URL to avoid re-downloading. To force a fresh fetch:
```json
{
  "no_cache": true
}
```

---

**Anti-hallucination - parameters that do NOT exist in media send tools:**
- `file` - the field is `media`
- `url` - the field is `media`
- `attachment` - the field is `media`
- `image` - the field is `media`
- `video` - the field is `media`
- `audio` - the field is `media`
- `document` - the field is `media`
- `type` - not a standalone parameter; use the correct tool name instead
- `encoding` - does not exist; use `no_encode: true` to skip encoding

Reference: [Sending Media](https://support.whapi.cloud/help-desk/sending/send-video-audio-image-document)
