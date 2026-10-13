---
title: Group Management - Create, Participants, Invites, Settings
impact: HIGH
impactDescription: Using personal chat Chat ID format for groups causes 400 errors; adding participants may silently fail due to WhatsApp anti-spam policy
tags: groups, createGroup, getGroups, getGroup, addGroupParticipant, removeGroupParticipant, getGroupInvite, sendGroupInvite, acceptGroupInvite, updateGroupInfo, promoteToGroupAdmin, leaveGroup, GroupID
---

## Group Management - Create, Participants, Invites, Settings

WhatsApp groups require the `@g.us` Chat ID suffix.
Group IDs cannot be constructed manually - always fetch them from the API.
Adding participants directly may fail silently due to WhatsApp anti-spam policies;
invite links are the reliable alternative.

---

### Step 1 - Create a Group

At least one participant is required to create a group.

**Incorrect (no participants):**
```json
// Tool: createGroup
{
  "subject": "My Team"
}
// Fails - WhatsApp requires at least one member besides yourself
```

**Correct:**
```json
// Tool: createGroup
{
  "subject": "My Team",
  "participants": ["14155552671@s.whatsapp.net", "447911123456@s.whatsapp.net"]
}
// Participants must use @s.whatsapp.net format (personal Chat ID)
// Returns the new group's ID in the response
```

---

### Step 2 - Get Group ID

If the group already exists, fetch its ID:

```json
// Tool: getGroups
{
  "count": 100,
  "offset": 0
}
// Returns list of groups with their "id" field (e.g., "120363194050948049@g.us")
```

To get full details of one group (participants, description, settings):
```json
// Tool: getGroup
{
  "GroupID": "120363194050948049@g.us"
}
```

---

### Step 3 - Add Participants

**Important:** Due to WhatsApp anti-spam policy, adding participants directly
may fail silently for some contacts. Participants who have the group admin
blocked, or who have strict privacy settings, will not be added.
This is a WhatsApp limitation, not an API error.

```json
// Tool: addGroupParticipant
{
  "GroupID": "120363194050948049@g.us",
  "participants": ["447700900123@s.whatsapp.net"]
}
// Returns status for each participant: added, not_authorized, etc.
```

**Reliable alternative - invite link:**

```json
// Step 1: Get the invite link
// Tool: getGroupInvite
{ "GroupID": "120363194050948049@g.us" }
// Returns the invite code

// Step 2: Send the invite link to the person
// Tool: sendGroupInvite
{
  "to": "447700900123@s.whatsapp.net",
  "name": "My Team",
  "inviteCode": "ABC123xyz",
  "inviteExpiration": 1712999999,
  "groupId": "120363194050948049@g.us",
  "caption": "Join our team group!"
}
```

The recipient then accepts by calling:
```json
// Tool: acceptGroupInvite
{ "code": "ABC123xyz" }
```

---

### Removing Participants

```json
// Tool: removeGroupParticipant
{
  "GroupID": "120363194050948049@g.us",
  "participants": ["447700900123@s.whatsapp.net"]
}
```

---

### Promote / Demote Admin

```json
// Tool: promoteToGroupAdmin
{
  "GroupID": "120363194050948049@g.us",
  "participants": ["14155552671@s.whatsapp.net"]
}

// Tool: demoteGroupAdmin
{
  "GroupID": "120363194050948049@g.us",
  "participants": ["14155552671@s.whatsapp.net"]
}
```

---

### Update Group Name or Description

```json
// Tool: updateGroupInfo
{
  "GroupID": "120363194050948049@g.us",
  "subject": "New Group Name",
  "description": "Updated description"
}
```

---

### Send a Message to the Group

Use the Group ID as the `to` field in any send tool:

```json
// Tool: sendMessageText
{
  "to": "120363194050948049@g.us",
  "body": "Hello everyone! \ud83d\udc4b"
}
```

---

### Leave a Group

```json
// Tool: leaveGroup
{ "GroupID": "120363194050948049@g.us" }
```

---

**Anti-hallucination - parameters and fields that do NOT exist:**
- `group_id` (snake_case) - the parameter is `GroupID` (PascalCase)
- `name` in `createGroup` - the field is `subject`
- `title` in `createGroup` - the field is `subject`
- `members` - the field is `participants`
- `phone` or `phones` in participant arrays - use full Chat IDs with `@s.whatsapp.net`
- `addMember` tool - the tool is `addGroupParticipant`
- `kickMember` tool - the tool is `removeGroupParticipant`

Reference: [Groups Guide](https://support.whapi.cloud/help-desk/groups)
