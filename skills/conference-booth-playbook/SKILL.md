---
name: conference-booth-playbook
description: The complete playbook for taking a SaaS product to a CONFERENCE / TRADE-SHOW BOOTH and having everything demoable - a live app packed with believable demo data, one phone number visitors can call or text, self-running booth screens (live app, animated poster, looping tour video), a QR "test it now" landing page that captures leads, a mock customer website showing the embed, offline travel backups, and one phone-friendly command-center page with every link and the demo script. Battle-tested at a real multi-thousand-attendee show with three screens. Read this when the user mentions a conference, trade show, expo, booth, demo data for an event, a booth poster, a tour video, a test-drive page, booth leads, booth screens, "prepare for the conference", or "do what we did last conference". Also read it before building any realistic re-runnable demo dataset.
---

# Conference Booth Playbook

> ## Adapt before use
> This describes how a booth setup SHOULD be built, taken from a real first
> conference run. Page names, table names and scripts below are EXAMPLES of the
> shape. On the first run in a repo you build these pieces; on later runs, replace
> the examples here with the real paths, keep a per-event tracker doc, and add
> that event's landmines to the list at the bottom.

How to bring the product to a booth and have EVERYTHING demoable: a live app full of believable
data, something visitors can try on their own phone in ten seconds, a QR funnel that captures
leads, and screens that run themselves while you talk to people.

Keep one tracker doc per event that logs every decision and landmine in full. This skill is the
condensed, repeatable process.

## The booth architecture (what a booth setup IS)

| Piece | What it does |
|---|---|
| **Screen 1: the live app** | The real product, owner logged in to a demo account, with a packed, believable day on screen. |
| **Screen 2: the poster** | An animated brand poster: cycling headlines, the permanent slogan, a glowing QR code, a feature ticker. One URL that auto-adapts when the physical screen is rotated to portrait. |
| **Screen 3: the tour video** | A self-playing slide loop (about 10 slides x 8 seconds) of REAL product screenshots with a slow pan/zoom, ending on the QR. A page, not a video file. |
| **QR landing page** | A skippable lead form, then three buttons: sign up free / try it by phone / try it by text. |
| **Lead capture** | The landing page posts to a public endpoint -> a leads table -> an internal admin page listing leads per event. |
| **One booth number** | ONE number that does voice AND text AND the AI/automation demo. |
| **Mock customer website** | A believable fake client site with the product's widget embedded (a "book now" button plus a "show it embedded" toggle), proving how it looks on THEIR site. |
| **Alternate video screen** | A fullscreen page that plays any video URL with the QR overlaid, in case the owner records a real video instead. |
| **Command center** | One phone-friendly page with every link, every login location, the 90-second demo script and the readiness checklist. Update it each event; do not fork a new one. The owner keeps it open on their phone at the table. |
| **Travel backups** | The tour and the poster republished as single self-contained HTML files (images inlined), so they work from any browser with zero deploy. |

Use ONE demo account that carries the dataset, and reuse it every event.

## The demo dataset

Keep a `demo_seed/` folder of numbered SQL files plus the generator scripts that produced the big
ones, applied in numeric order. The properties that make it safe to re-run:

- **Idempotent.** Every generated id is a deterministic UUID (v5) under one fixed namespace, keyed
  by a readable string (for example the id of an item = v5 of `"item:" + name`). Re-running upserts
  instead of duplicating.
- **Correct by the app's own rules.** Rows match the shape the real creation function writes,
  INCLUDING child rows. Money rows respect the invariants: never write a generated column, and let
  the triggers that maintain paid amounts and status do their job. Derived rows (commissions,
  rollups) may need to be minted set-based, because the "recompute" function may only UPDATE rows
  that already exist.
- **Everything demoable.** Every feature someone might ask about has data behind it: resources,
  bundles, gift cards, plans, forms, message threads on every channel, AI call history with
  word-for-word transcripts, tags, tasks, promotions, charts. If a visitor asks "can it do X" and
  the screen for X is empty, the demo is over.
- **Scale that looks like a real business:** thousands of records over months, so reports "sound
  right" and no chart is flat.

**For the NEXT conference, the dates are the whole job.** The generators write absolute timestamps
aimed at the event window. Calendars must be FULL on the event days, and a separate file must fill
"today" so the today's-revenue tile is not zero. Re-run the generators with the new dates, then
re-apply.

Gotchas:

- If the machine's Python lacks timezone data, the generators end up using a constant UTC offset.
  Fix that offset whenever the event is on the other side of a daylight-saving change or in
  another timezone, or every record lands an hour off.
- Pull the LIVE schema first, every time. Column drift between conferences is guaranteed.
- Seed files are plain inserts/upserts scoped to the demo account. Anything that edits shared
  functions or triggers is a different, higher-risk change and follows the repo's database rules
  and the owner's approval.

## The safety checks (the things that can kill the booth live)

Check these FIRST, not last.

1. **One number for everything.** Voice, text and the AI demo all on a single number. Done means
   the provider's list shows that one number with every capability enabled and, for text, the
   sending registration VERIFIED. A text-registration attach can come back failed and does NOT
   heal by retrying, so do this days ahead and have a fallback path. Keep the old number as a
   silent backup. Provision through scripts that are dry-run unless confirmed (see
   `scripted-admin-actions`).
2. **Balance funded.** Any usage-billed feature stops dead on insufficient funds, in front of a
   visitor. Know exactly which features draw on the balance and which are free, and top up with
   headroom for two days of strangers hammering it.
3. **The subscription or trial covers the event dates.** The run-1 near-disaster: the demo
   account's trial ended the day BEFORE the conference, and an expired subscription is a hard
   block on the whole app. Check the trial end and status for every location against the event
   dates. Extending it is a billing action and needs the owner's explicit approval, never your own
   initiative.
4. **A real human test call and text** to the booth number before the event. Only a live call
   proves audio end to end. Also confirm emergency-address registration on the voice number if the
   provider requires it.

## The three screens

**Poster (screen 2).** Generated by a script, so regenerating it is one command.

- The permanent slogan stays on screen the whole time. The owner cares about it more than any
  cycling headline.
- Put the QR glow on a WRAPPER element. A negative z-index pseudo-element on the card itself
  disappears behind its parent (stacking-context bug).
- A `max-aspect-ratio: 1/1` media query makes the SAME URL re-lay itself out for a portrait
  screen, so there is one link to remember.
- Fullscreen the browser (F11) and it loops forever.

**Tour (screen 3).** Also generated by a script.

- Order that worked: slogan intro, the main calendar/dashboard, the customer-facing flow, the
  website embed, checkout, analytics, the message inbox, a second channel, an AI call transcript,
  the QR outro.
- **Recapture every screenshot fresh for each conference.** Stale branding is instantly visible on
  a big screen. Owner logged in, drive the browser per the `browser-verification` skill, and hide
  trial and update banners with a script before each shot.
- Know which page actually shows the thing you are selling. The transcript shot came from the
  conversation view with the card expanded; the "history" page showed a call journey, not the
  words.
- Verify each slide's image actually loads. A missing image is a blank slide for 8 seconds, every
  loop, all day.

**The QR code** is embedded in both generators as a data URI read from a file. For a new
conference, regenerate the QR (PNG, then base64 data URI, pointing at the landing page URL) into a
FRESH file and update that path in both scripts FIRST. A path left pointing into an old temporary
folder is the first thing that breaks.

## QR landing page and leads

Flow: an optional info form (name, company, phone, email; phone OR email is enough; ALWAYS
skippable, it never blocks) -> three buttons:

- **Sign up for free** (straight to signup).
- **Try it by phone** (a `tel:` link to the booth number).
- **Try it by text** (an `sms:` link to the same number with a prefilled message).

Rules:

- The number lives in ONE set of constants at the top of the page. Update it when the booth
  number changes.
- The leads table enforces phone-or-email, is readable by internal admins only, and tags each row
  with an `event_name`. **Set a NEW event name per conference** so leads stay separable.
- The form must never stand between a curious visitor and the demo. A lead you did not capture is
  better than a visitor who walked away.

## Deploy and backups

- Know which branch the booth surfaces deploy from (often not the main app's release branch), and
  run a cold typecheck on those surfaces before they are merged there if nothing checks them at
  push time. Deploying is the owner's call; never push without being asked.
- **Make the backups every time.** In run 1 the owner flew overseas before the deploy. Inline the
  tour's images as base64 data URIs into one HTML file and publish it somewhere that needs no
  deploy (a hosted artifact, or just carry the file). Same for the poster. Result: the screens
  work from any browser with zero infrastructure.
- Hosted embeds: a page opened from `file://` cannot iframe a widget that restricts
  frame-ancestors. Embed demos must be HOSTED on an allowed domain.

## The next-conference checklist (run in this order)

1. Read the tracker from the last event; start a fresh tracker section for this one.
2. Safety checks first: subscription covers the dates, balance funded, one number fully enabled.
3. Pull the live schema; regenerate and re-apply the demo dataset aimed at the new dates
   (calendars FULL on event days; "today" has revenue; reports sound right).
4. Update the landing page (number, new event name); regenerate the QR data URI; regenerate the
   poster and tour with fresh screenshots; update the mock customer site if branding moved.
5. Cold typecheck, the owner-approved deploy, then verify EVERY URL live in a real browser.
6. Publish the offline backups (tour + poster) and refresh the command center.
7. Human steps for the owner: log into screen 1, fullscreen the other two, make one live test
   call and send one test text.

## Landmines learned at run 1 (do not rediscover)

- **Trial expiry the day before the event.** Check first, not last.
- **Generic themes get rejected.** Use the real brand palette and fonts, written down as exact
  values in the tracker. The owner also rejected invented brand names for the demo account: name
  it after the product.
- **Two different numbers for call vs text confused everyone.** It must be ONE number.
- **No em or en dashes anywhere, including generated HTML copy.**
- **`file://` pages cannot iframe the widget.** Host embed demos.
- **Screenshots go stale silently.** Recapture ALL of them and verify each slide's image loads.
- **Hardcoded scratch paths in generators** (the QR file) rot between events. Fix them before
  running anything.

Related skills: `scripted-admin-actions` (number provisioning, trial extension),
`browser-verification` (screenshots), `product-animation-website` and `ui-ux-pro-max` (poster and
tour polish).
