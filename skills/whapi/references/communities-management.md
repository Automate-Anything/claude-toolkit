---
title: Community Management - Create, Link Groups, Manage Participants
impact: MEDIUM
impactDescription: Communities have a separate ID type and tool set - do not use group tools for community operations
tags: community, createCommunity, getCommunity, getCommunities, addCommunityParticipant, removeCommunityParticipant, linkGroupToCommunity, unlinkGroupFromCommunity, createGroupInCommunity, promoteCommunityParticipant, CommunityID
---

## Community Management - Create, Link Groups, Manage Participants

WhatsApp Communities are containers for multiple groups.
A community has an announcement channel and can contain many sub-groups.
Community tools are separate from both group and newsletter tools.

---

### How Community Structure Works

When you create a Community, WhatsApp automatically creates **two groups** with the same name.
This is not visible in the WhatsApp UI but is critical for API usage:

| Group type         | Purpose                                       | How to identify               |
|--------------------|-----------------------------------------------|-------------------------------|
| Community group    | Structure management - link/unlink sub-groups | the ID returned by `createCommunity` |
| Announcements group | Send messages to all community members        | `"announcements": true` in API response |

Both groups appear when you call `getCommunities` or `GET /groups`, which can be confusing.

**Important:**
- Maximum community size: **2000 members** (community + its announcement group).
- When a user joins any sub-group, they are automatically added to the community and the Announcements group.
- When you unlink a group from a community, all its members are removed from the Announcements group.

---

### Create a Community

```json
// Tool: createCommunity
{
  "subject": "Company Hub",
  "description": "Central place for all our team groups"
}
// Both subject and description are required
// Returns the new community's CommunityID
```

---

### Get Community ID

```json
// Tool: getCommunities
// No arguments required
// Returns list of communities with their IDs

// Tool: getCommunity
{
  "CommunityID": "COMMUNITY_ID_HERE"
}
// Returns full community details including linked sub-groups
```

---

### Link an Existing Group to a Community

Groups must already exist before they can be linked to a community.

```json
// Tool: linkGroupToCommunity
{
  "CommunityID": "COMMUNITY_ID_HERE",
  "GroupID": "120363194050948049@g.us"
}
```

Unlink a group:
```json
// Tool: unlinkGroupFromCommunity
{
  "CommunityID": "COMMUNITY_ID_HERE",
  "GroupID": "120363194050948049@g.us"
}
```

---

### Create a New Group Inside a Community

```json
// Tool: createGroupInCommunity
{
  "CommunityID": "COMMUNITY_ID_HERE",
  "subject": "Engineering Team",
  "participants": ["14155552671@s.whatsapp.net"]
}
```

---

### Get Sub-Groups of a Community

```json
// Tool: getCommunitySubGroups
{
  "CommunityID": "COMMUNITY_ID_HERE"
}
// Returns list of all groups linked to this community
```

---

### Manage Community Participants

```json
// Tool: addCommunityParticipant
{
  "CommunityID": "COMMUNITY_ID_HERE",
  "participants": ["14155552671@s.whatsapp.net"]
}

// Tool: removeCommunityParticipant
{
  "CommunityID": "COMMUNITY_ID_HERE",
  "participants": ["14155552671@s.whatsapp.net"]
}

// Tool: promoteCommunityParticipant
{
  "CommunityID": "COMMUNITY_ID_HERE",
  "participants": ["14155552671@s.whatsapp.net"]
}

// Tool: demoteCommunityParticipant
{
  "CommunityID": "COMMUNITY_ID_HERE",
  "participants": ["14155552671@s.whatsapp.net"]
}
```

---

### Deactivate a Community

```json
// Tool: deactivateCommunity
{ "CommunityID": "COMMUNITY_ID_HERE" }
// Deactivates the community - sub-groups are not deleted
```

---

### Send a Message to All Community Members (Announcements)

To send an announcement to all community members, send to the **Announcements group** -
not to each sub-group individually. The Announcements group is the only channel that
reaches all community members at once.

**Step 1 - Find the Announcements group:**
```json
// Tool: getCommunitySubGroups
{ "CommunityID": "COMMUNITY_ID_HERE" }
// In the response, find the group where "announcements": true
// That group's "id" is the correct target for community-wide announcements
```

**Step 2 - Send to the Announcements group ID:**
```json
// Tool: sendMessageText
{
  "to": "120363345077781365@g.us",
  "body": "Community announcement!"
}
// Use the ID of the group with "announcements": true - not the community ID itself
```

> **Note:** The community ID and the Announcements group ID are different, even though
> both groups share the same name. Always use `getCommunitySubGroups` to find
> the correct Announcements group ID.

---

**Anti-hallucination - parameters and tools that do NOT exist:**
- `community_id` (snake_case) - the parameter is `CommunityID` (PascalCase)
- `name` in `createCommunity` - the field is `subject`
- `groups` in `createCommunity` - groups are linked separately after creation
- `addGroup` tool - use `linkGroupToCommunity`
- `sendToCommunity` tool - does not exist; send to the Announcements group (the sub-group with `"announcements": true`)
- `getCommunityMembers` tool - use `getCommunity` which includes participant info
- sending to all sub-groups in a loop - do NOT do this for community announcements; use only the Announcements group

Reference: [Communities Introduction](https://support.whapi.cloud/help-desk/communities/introduction)
