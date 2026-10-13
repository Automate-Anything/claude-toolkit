---
title: Channel (Newsletter) Management - Create, Post, Subscribe
impact: HIGH
impactDescription: Channels use @newsletter Chat ID suffix - mixing it up with @g.us causes 400 errors; channels and groups have entirely separate tool sets
tags: newsletter, channel, createNewsletter, getNewsletters, getNewsletter, sendMessageText, subscribeNewsletter, getMessagesNewsletter, NewsletterID, editNewsletter
---

## Channel (Newsletter) Management - Create, Post, Subscribe

WhatsApp Channels are called **Newsletters** in the WHAPI API.
They are unidirectional broadcast tools: only admins can post,
subscribers can only read. Channel IDs use the `@newsletter` suffix.

Do not confuse channels with groups:
- Groups: bidirectional, `@g.us` suffix, use `group*` tools
- Channels: unidirectional, `@newsletter` suffix, use `newsletter*` tools

---

### Create a Channel

```json
// Tool: createNewsletter
{
  "name": "Company Updates",
  "description": "Official announcements from our company",
  "newsletter_pic": "https://example.com/logo.jpg"
}
// newsletter_pic is optional - URL to channel avatar image
// Returns the new channel's ID ending in @newsletter
```

---

### Get Channel ID

To find an existing channel you manage or follow:

```json
// Tool: getNewsletters
// No required arguments
// Returns list of your channels with their IDs

// Tool: getNewsletter
{
  "NewsletterID": "120363171743427809@newsletter"
}
// Returns full channel metadata: name, description, subscriber count, etc.
```

---

### Post to a Channel

Send a message to the channel using any standard send tool.
Use the channel's `@newsletter` ID as the `to` field:

**Correct:**
```json
// Tool: sendMessageText
{
  "to": "120363171743427809@newsletter",
  "body": "*Monthly Update* \ud83d\udcc5\n\nHere are this month's highlights..."
}
```

**Incorrect:**
```json
// Tool: sendMessageText
{
  "to": "120363171743427809@g.us",
  "body": "Update"
}
// @g.us is the group suffix - this tries to send to a group, not the channel
```

You can also send media to channels:
```json
// Tool: sendMessageImage
{
  "to": "120363171743427809@newsletter",
  "media": "https://example.com/announcement.jpg",
  "caption": "New product launch!"
}
```

---

### Read Channel Posts

```json
// Tool: getMessagesNewsletter
{
  "NewsletterID": "120363171743427809@newsletter",
  "count": 20
}
```

---

### Edit Channel Info

```json
// Tool: editNewsletter
{
  "NewsletterID": "120363171743427809@newsletter",
  "name": "Updated Channel Name",
  "description": "New description"
}
```

---

### Subscribe / Unsubscribe (as a follower)

```json
// Tool: subscribeNewsletter
{ "NewsletterID": "120363171743427809@newsletter" }

// Tool: unsubscribeNewsletter
{ "NewsletterID": "120363171743427809@newsletter" }
```

---

### Invite Another Admin

```json
// Tool: createNewsletterAdminInvite
{ "NewsletterID": "120363171743427809@newsletter" }
// Returns an invite link for another person to become a channel admin

// Tool: acceptNewsletterAdminRequest
{ "NewsletterID": "120363171743427809@newsletter" }
```

---

### Delete a Channel

```json
// Tool: deleteNewsletter
{ "NewsletterID": "120363171743427809@newsletter" }
// Irreversible - all posts and subscribers are lost
```

---

**Anti-hallucination - parameters and tools that do NOT exist:**
- `newsletter_id` (snake_case) - the parameter is `NewsletterID` (PascalCase)
- `channel_id` - the parameter is `NewsletterID`
- `channelId` - the parameter is `NewsletterID`
- `title` in `createNewsletter` - the field is `name`
- `createChannel` tool - the tool is `createNewsletter`
- `postToChannel` tool - use standard `sendMessageText` with `@newsletter` Chat ID
- `getChannels` tool - the tool is `getNewsletters`
- `@channel` suffix - the correct suffix is `@newsletter`

Reference: [Channels Guide](https://support.whapi.cloud/help-desk/channels)
