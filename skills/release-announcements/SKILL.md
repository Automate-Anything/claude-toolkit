---
name: release-announcements
description: >-
  How to prepare the monthly "What's New" product-update email to the app's users from an
  updates folder, and drop it into the admin email-blast system as a DRAFT the owner reviews and
  sends with one click. Also covers the sibling surface: the owner-approved What's New posts that
  feed the in-app panel and the public changelog. Covers where updates live and how they are
  named, picking the cutoff, labelling by ship month, the voice, writing only the inner body so
  the branded layout wraps it, creating the draft, recording which updates were covered so
  nothing is announced twice, and the hand-off. The agent prepares, the owner sends: never send
  it yourself. Read it when the owner says "prepare the monthly update email", "write the what's
  new email", "announce what shipped", "draft the release notes email", "what's new posts",
  "update the changelog", or clicks a "Prepare monthly update (Copy for AI)" button in the admin
  tool.
---

# Release announcements (monthly What's New email)

> ## Adapt before use
> This describes how the monthly update flow SHOULD be wired, taken from a production system.
> It assumes three things exist: an `updates/` folder of customer-facing ship notes, an admin
> email-blast system with drafts, and a small table recording what was announced. Route paths,
> table names and field names below are EXAMPLES of the shape. Grep the repo for what actually
> exists before citing or calling any of them, and update this file with the real names once
> built. If the blast system does not exist yet, read `email-infrastructure` (section 2.6) and
> build that first.

Turn the month's shipped updates into ONE branded email to the app's users. The owner reviews it
in the admin blast UI (Preview and Audience) and clicks Send. **You prepare the draft. You never
send it.**

Read the `email-infrastructure` skill first. This is a PLATFORM email (from us to our users),
sent through the provider's batch API from the updates persona. The whole send pipeline already
exists. Your job is the copy and inserting the draft.

## The two What's New surfaces (know which one you are doing)

Two related but separate things, both fed by an owner-curated approval queue:

1. **The in-app What's New panel plus the public changelog.** Both read the same APPROVED feed
   (a posts table where status is approved, served by one public endpoint). This is the ongoing
   surface users see in the app and on the changelog page.
2. **The monthly What's New EMAIL** (most of this skill). A once-a-month push, drafted as a
   blast the owner previews and sends.

Both draw from the same raw source (`updates/`), land in different places, and **both need the
OWNER's explicit approval before anything reaches a user.**

## What's New posts (the in-app panel and changelog feed)

The raw `updates/` files are INTERNAL. They can include bug fixes, refactors, internal tooling
and entries not worth a user's attention. They are NEVER shown to users. Users see only APPROVED
posts. To prepare posts for the approval queue:

1. Read `updates/`: what shipped since the last posts, or in the last month.
2. Make a SHORT candidate list: one line per update plus a quick "worth showing a user?" yes or
   no.
3. **SHOW the owner that list and ASK which to include and which to skip. Do NOT create posts
   yet.** Wait for the answer. Nothing auto-loads; the owner decides what is worth showing.
4. Only for the chosen ones: write a clean, short, user-facing Title and Body (what they can
   now DO), in our voice, no em dashes, and insert each as a PENDING post through the admin API
   (title, body, post date, and the source update ids). **Do NOT approve.** The owner approves
   in the admin What's New page, and only approved posts go live.

## 1. Find what shipped

- Updates live as individual files in the repo's `updates/` folder, named
  `YYYYMMDD-HHMM_short-description.md`. The first line is `## YYYY-MM-DD: Title`, followed by a
  description from the user's perspective.
- Cover what shipped since the LAST monthly send. Find the cutoff from the newest existing
  monthly blast row (named like "Monthly update <Month Year>") and from the announcements table
  (section 3b), which lists the update ids already covered. If unsure, cover the last calendar
  month.
- **Label by SHIP month, not send month.** The email goes out early in the month and covers
  what was delivered LAST month. Do not default to today's calendar month. Check the dates on
  the update files.
- Keep the `updates/` folder to user-facing wins only (new features, integrations,
  capabilities, significant UI). If the folder is disciplined that way, you do not have to
  filter out fixes and internal work. If it is not, filter them out and tell the owner.

## 2. Write the email

- **Audience:** the app's account users (owners and admins). Not THEIR customers.
- **Voice:** plain, benefit-first, no hype, positive framing. NO em dashes or en dashes (use
  commas, colons, or "to"). Say what they can now DO, in their words.
- **Structure:** a warm one-line intro, then the new things grouped, each a short blurb.
  Scannable. Plus a subject line and a preheader (the inbox preview text).
- **Rendering:** use the blast system's brand-template authoring mode, so it wraps your body in
  the branded layout (wordmark, theme, footer, unsubscribe). Write ONLY the inner content. Do
  not hand-roll a full email document or a header or footer; the layout adds them. Keep the
  HTML simple: paragraphs, bold, lists. Do not invent a new design. The rendering rules in
  `email-infrastructure` section 9 still apply to whatever you put inside.

## 3. Insert it as a DRAFT (so the owner can preview and send)

Create the draft through the admin API (preferred). Example shape:

```
POST {ADMIN_SERVER_URL}/api/v1/email-blasts
{
  "name": "Monthly update <Month Year>",
  "subject": "<subject>",
  "preheader": "<preheader>",
  "body_html": "<inner html>",
  "authoring_mode": "brand_template",
  "audience_filter": { "roles": ["owner", "admin"], "exclude_blocked": true, "include_disabled_accounts": false }
}
```

It is created with status `draft`. **Do NOT trigger send.**

If you cannot reach the API, insert a draft row directly with the same fields and
`status='draft'`. That is a database write: pull the LIVE columns of the blasts table first and
verify your insert against them (name, subject, preheader, body, authoring mode, audience filter
json, status, from address, from name, reply-to are the usual ones).

## 3b. Record which updates this covers (never re-announce)

After creating the draft, insert ONE row into the announcements table, LINKED to the draft
blast, with the sent timestamp LEFT NULL. Example shape:

```sql
INSERT INTO product_update_announcements (blast_id, included_update_ids, label)
VALUES ('<draft blast id>', ARRAY['<update_file_stem_1>', '<update_file_stem_2>'], 'Monthly update <Month Year>');
```

- The included ids are the `updates/` filename stems you covered. Next month's run reads these,
  so the same update is never announced twice.
- **Do NOT set the sent timestamp.** The reminder indicator in the admin nav (a red dot on
  "Product Updates") clears ONLY when the owner actually clicks Send. The send path stamps both
  the blast and this announcement as sent, and the indicator keys off a real send this month.
  Recording the row with the timestamp null keeps the updates queued to this draft while the
  reminder correctly persists until the email truly goes out. A prepared-but-never-sent draft
  must never silently swallow a month.

## 4. Hand off

Tell the owner in one line: "Draft ready on the Email Blasts page. Open it, check Preview and
Audience, then click Send." The owner does the final review and the one-click send in the UI.

## Gotchas

- Do not send it. Draft only.
- Do not approve What's New posts. Pending only, and only after the owner picked which ones.
- Do not write a full HTML document. The brand template wraps your inner body.
- No em dashes or en dashes anywhere.
- Cover the right month: the ship month.
- Leave the sent timestamp null on the announcement row.
- Audience, preview, send, and open, click and bounce tracking belong to the blast UI. Do not
  rebuild any of that here.

## If the pieces do not exist yet (what to build)

- **`updates/` folder discipline.** One file per user-facing ship, timestamped name, a dated
  title line, written from the user's seat. Make writing one part of finishing a feature.
- **A "Prepare monthly update (Copy for AI)" button** on the admin blasts page that copies a
  prompt pointing the agent at this skill. It makes the monthly routine one click for the owner.
- **The announcements table:** blast id, included update ids (text array), label, sent
  timestamp (null until the real send).
- **The posts table and approval page** for the in-app panel and changelog: title, body, post
  date, source update ids, status (`pending` then `approved`), served by one public endpoint
  that returns approved posts only.
- **The reminder indicator** that stays on until a real send happens this month.
