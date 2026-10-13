---
name: help-center-upkeep
description: How to keep a customer-facing help center (a docs / knowledge-base site of how-to articles) correct - after a code change, when a customer question shows the docs failed them, or when adding real screenshots to articles. Read this whenever the user says "update the help center / docs / knowledge base", "document this feature", "the docs are wrong / outdated", "add screenshots to the help articles", "a user couldn't find X", "users keep asking about Y", at the end of any build that changed something a user sees or does, or when the `support-triage` skill hands off a documentation gap. It defines the three modes (A: document a code change; B: fix a doc gap from a real user question; a screenshot pass), how to verify behavior from the LIVE code before writing, how to write an article a busy non-technical customer can actually follow, the "coming soon" bucket for unreleased features, the screenshot workflow, and the approval rule. Use when the user mentions the help center, learn center, help docs, knowledge base articles, how-to articles, article frontmatter, docs search index, or screenshots for the docs.
---

# Help Center Upkeep

> ## Adapt before use
> This describes how help-center upkeep SHOULD work, taken from two production
> products (a static MDX docs site and an older server-rendered one). Paths,
> frontmatter fields, component names and commands below are EXAMPLES of the
> shape. Find where this repo's articles live, read its style guide if it has
> one, and when the repo disagrees with this file, the repo wins. Once the real
> help center exists, replace the examples here with the real paths and commands.

> **The golden rule: the help center must never fall behind what we shipped.** If a build changed
> reality and the docs still describe the old reality, that is a defect to fix now, not later.

---

## When this runs

Two triggers, same skill:

- **After a build** (the standard post-build gate). You built or changed something; now make the
  help center reflect it. This is Mode A. It is NOT optional and NOT limited to "only if I added a
  whole feature". Any change a user sees or does, including a changed behavior or a fixed bug they
  would notice, means the matching article must be made correct, or created if missing. Read this
  skill BEFORE writing so structure and voice are right.
- **On demand:** a code change to document (Mode A), a customer question that reveals a doc gap
  (Mode B, often handed off from `support-triage`), or a screenshot pass.

## Determine the mode

- **Mode A**, a **code change** shipped: feature added, field renamed, workflow changed, setting
  added, behavior changed, notable bug fix.
- **Mode B**, a **user question, frustration or support issue**: "a user asked how to do X", "users
  keep asking about Y", "someone couldn't figure out Z".
- **Screenshot pass**: adding real screenshots to existing articles. Standalone or alongside A/B.

---

## Mode A: document a code change

1. **Understand what changed.** Read the diff or the recent commits. Focus on user-facing
   behavior: renamed features, new UI, changed workflows, added or removed fields, new settings,
   new bulk actions, changed permissions.
2. **Verify the ACTUAL behavior from code, never from the diff alone.** Confirm exactly how it
   works: database defaults in the LIVE schema, the component or view that renders it, the
   business logic behind it, and the exact labels and UI text (if the UI uses translation keys,
   read the string file, not the key). If behavior is ambiguous from code, open the running app in
   a browser and observe it. Every factual claim must trace to a line of code or an observed
   screen.
3. **Search the help center.** Grep the article folder for the feature name, UI labels, setting
   names, workflow steps. Cast a wide net and check every match.
4. **Decide what needs updating.** For each article, is any part now inaccurate, incomplete or
   misleading? If nothing needs updating, say so and stop.
5. **Match existing style.** Read the style guide if one exists, then 2 to 3 nearby articles in
   the same category. Match tone, structure and section order.
6. **Make minimal edits.** Update only what changed; do not rewrite surrounding paragraphs. Add a
   new bullet in its logical position (alphabetical or grouped, matching the existing list). Bump
   the article's last-updated date.
7. **Show the owner each file plus a one-line summary.**
8. **Stop there.** Committing, pushing and deploying happen only when the owner explicitly asks in
   that conversation.

---

## Mode B: fix a doc gap from a user question

1. **Understand the problem.** What were they trying to do, what did they expect to find, what
   went wrong (could not find it / found it but it did not answer / instructions were confusing)?
2. **Search the help center** for every keyword AND the synonyms a non-technical user would use,
   plus the UI labels they would have seen. Read every match thoroughly.
3. **Verify actual product behavior from code**, with the same rigor as Mode A step 2. Trace it end
   to end. Check defaults, how values are stored, the labels and options actually shown, and the
   logic that runs when a new record is created. If unclear, open the app and look: which boxes
   are checked by default, what the dropdown really offers, what happens on click. If you cannot
   find the source of a fact, say so. Do not fill the gap with an assumption.
4. **Is it really a feature request?** If what they want does not exist, the docs did not fail.
   Check the feature-request tracker if there is one: already tracked means report its title and
   status; not tracked means flag it as a candidate. Do not document around a missing feature.
5. **Did the docs actually fail?** Not every question is a gap. If the right article exists and
   answers it findably, report that with a direct absolute link to the article and section (so the
   owner can send it to the customer) and stop. Proceed only on a genuine gap:
   - **Missing coverage:** no article covers the topic.
   - **Hard to find:** the article exists but uses different words than the user would search, or
     is buried in an unrelated section.
   - **Incomplete:** covers the topic but skips the scenario or step the user needed.
   - **Unclear:** confusing, assumes too much, or has no concrete example.
   - **Outdated:** describes old behavior.
   - **Misleading:** can reasonably be read the wrong way.
6. **Match existing style** (style guide, then nearby articles).
7. **Make the improvement, only what closes the gap.** Add the missing steps, rewrite the unclear
   part in plain language, add the terminology the user actually used (so the next person finds
   it), add a callout at the confusion point, create a new article if the topic is uncovered, or
   suggest moving an article that is in the wrong section. Do not pad with "good to know" bullets
   that restate what the docs already say.
8. **Show the owner each file, a one-line summary, and how it would have helped the confused
   customer.**
9. **Stop there.** Commit and push only when the owner explicitly asks.

---

## Article conventions (example shape)

- **Scaffold with a script**, not by hand, so frontmatter is never malformed. Example: a
  `new-article` command taking segment, category, slug and title.
- **Frontmatter shape** (example):
  ```yaml
  ---
  title: Create an order manually
  slug: orders/create-manual        # unique within a segment; category/slug
  segment: operators                # which audience (operators | end customers)
  category: orders
  pageKey: page:orders              # matches an app page, for an in-app help drawer
  order: 20                         # sidebar order within the category
  lastUpdated: 2026-01-15           # bump on every edit
  description: One-sentence summary used on cards and for search.
  status: live                      # live (default) | coming-soon
  relatedSlugs:                     # auto-rendered as related-article cards
    - orders/overview
  ---
  ```
- **Derive navigation from frontmatter** so a new article registers itself. A hand-maintained
  sidebar is a second thing to forget.
- **Related articles come from frontmatter.** Do not hand-write a "see also" list.
- **Internal links** are root-relative paths through the site's router. External links open in a
  new tab.
- **Search:** if the site searches a generated body index, regenerate that index after adding or
  editing an article body, or the new text is not searchable. Prefer an in-browser index that
  works in dev with no build step, so you can verify search while iterating.
- **Style:** plain, benefit-first, no jargon, NO em dashes or en dashes, no HTML entities in
  Markdown/MDX (write `&`, not `&amp;`).

---

## "Coming soon": documenting a feature that is not live yet

Sometimes you build something that is NOT yet on for customers (behind a flag, staged, launching
later) but you want the article ready the instant it ships. Use a `status: coming-soon` field.

- **When to use it:** the feature is built or being built, but a customer cannot use it in
  production today. Do NOT write a normal live article for something they cannot do. That sends
  them hunting for a button that is not there.
- **What it does:** renders a "Coming soon" badge and groups the article into a separate section,
  visibly apart from live docs. If the site does not render that yet, add the field anyway and
  flag that the rendering needs wiring.
- **How to write it:** describe what it WILL let them do, in the same voice, but no literal
  click-by-click steps for UI that may still change. Benefit-focused. No screenshots of a
  non-final UI.
- **When it launches:** flip to live, fill in the real steps and screenshots against the shipped
  UI, bump the date, and add a what's-new entry if it is update-worthy.
- **Never** put an unreleased feature in a customer's face as if it exists. "Coming soon" is a
  deliberate, labeled bucket, not a way to sneak half-built docs into the live set.

---

## How to WRITE an article well (the craft, not the mechanics)

An article a customer cannot follow is worse than no article: it wastes their time and then they
open a support request anyway. Write it the way you would want the docs for a tool YOU depend on.

**Voice and audience.** The reader is a busy business owner or front-desk person, not an engineer.
They are mid-task, slightly frustrated, and want to get back to their own customer.

- Second person, present tense, active voice: "Click **Save**," not "The Save button should be
  clicked."
- Lead with the answer. The first sentence says what this is or how to do the thing. No "In this
  article we will explore."
- Short sentences, one idea each. If a sentence has two "and"s, split it.
- Name UI exactly as it appears on screen, in **bold**: the real button label, tab name, field
  name. Verify the label against the live UI code or a screenshot. Never paraphrase it
  ("**+ New order**", not "the add-order button").
- Benefit before mechanics where it helps: why they would do this, then how.
- Never use internal words. Use the product's own on-screen vocabulary, not the table name or the
  engineering nickname. Keep a short internal-word to product-word list for the repo.

**Structure of a how-to** (adapt, do not force every heading, match the neighbors):

1. `## What it is`: one or two sentences. What the feature is and the job it does for them.
2. `## When you would use it` (optional): 2 to 4 bullets of real scenarios in their words.
3. `## Step by step`: a numbered list where each step is ONE action starting with a verb. Put the
   screenshot right under the step it illustrates. Call out anything conditional ("**Deposit**:
   only appears if your rules require one").
4. **Settings / field reference** (when the page has settings): one line per field or toggle with
   the exact label, what it does, and the default. This must match the in-app tooltip for the same
   field. The doc and the tooltip must never disagree.
5. `## Common questions / gotchas`: the 2 to 5 things people actually get wrong. This is where you
   pre-empt the support request. If a real customer question drove this edit (Mode B), the answer
   to THAT question belongs here in the words they would search for.

**What "gap-free" means** (the bar the post-build review checks): a reader following it top to
bottom completes the task with no missing step, no unexplained field, no "then a dialog appears
that we never mentioned", and no claim that does not match the app. Walk the workflow yourself and
make sure the article matches every screen they will see, in order.

**Good vs bad, concretely:**

- Bad: "Users may configure notification preferences in the settings area." Vague, passive, no
  path, no labels.
- Good: "Go to **Setup > Notifications**. Toggle **Send reminders** on, then pick how far ahead
  under **Reminder timing** (default: 24 hours before)."
- Bad: every edge case dumped into the steps. Good: happy path in the steps, edge cases in
  **Common questions / gotchas**.

**Length.** As long as it needs to be, no longer. A simple action is 5 lines. A settings-heavy
page is legitimately long because every toggle needs a line. Do not pad; do not truncate a real
settings reference to look shorter.

**Accuracy over completeness.** A short article that is 100% correct beats a thorough one with one
wrong default. If you cannot verify a detail from code or the running app, leave it out and say
what is unverified. Never guess a default or a behavior.

---

## Screenshots (REQUIRED for anything complicated, not a nice-to-have)

**Words are not enough for complicated stuff.** Any multi-step flow, any setting whose meaning is
not obvious from its label, and above all anything where the SAME thing can be set in more than
one place (a rate on the item vs on the person, a value that overrides another, a toggle that
gates a whole section) MUST have real screenshots of EACH place, embedded at the step they
illustrate. A person confused enough to open the docs needs to SEE it, not read a path and guess.
Owner rule: "if it's complicated, show actual pictures of everywhere and how it works." Do not
ship a complicated article as text-only and call it done.

Rule of thumb: if a reader following the words alone could end up on the wrong screen, click the
wrong control, or not believe they are in the right place, it needs a screenshot. A one-liner
("click Save") does not.

### One convention, built once

- **One screenshot component** (framed, lazy-loaded, captioned, theme-correct), registered
  globally so articles use it with no import. Its `alt` doubles as the visible caption, so write a
  real caption, not a filename.
- **Images in the site's public folder, one folder per topic**, descriptive kebab-case filenames,
  referenced by a stable absolute path. This beats co-located image folders with relative
  imports: the older product used paths like `../../../../assets/help/name.png` and every moved
  article broke its images. A public folder needs zero import wiring.
- Keep one reference article that shows a "two places to set it" case done right, and read it
  before doing another complicated article.

### How to capture

1. **Capture through the browser automation tool**, following the `browser-verification` skill
   (your own isolated browser; if there is a login wall, open the page and ask the owner to log
   into YOUR window).
2. **Use a demo account with realistic sample data, never real customer data and never the
   admin/dev account.** Set up a realistic state first (a rule filled in, a record on the
   calendar, a filled ticket), so the picture shows a real example, not an empty form.
3. **Hide dev overlays before EVERY shot.** A debug bar or dev banner reappears on each navigation,
   so hide it again after every page load.
4. **Crop tightly to the relevant panel.** A raw full-page shot is unreadable. Reliable method:
   take a viewport screenshot, then crop to the element's bounding box with an image library.
   Remember the screenshot is at the device pixel ratio, so scale CSS coordinates by
   image-width / viewport-width before cropping. Measure the element's box and take the
   screenshot in the same beat; a layout shift between measuring and shooting misaligns the crop.
   Alternatively resize the viewport narrower to zoom into the relevant UI. Save crops to the
   scratchpad first, then copy the final ones into the topic folder.
5. **Verify each image actually loads in the rendered article.** Open the article and check every
   figure image has a natural width above zero. A broken `src` renders nothing and is easy to
   miss.
6. **Show the screenshots to the owner for approval.** They verify the data and UI state look
   right.
7. Bump the last-updated date.

Prioritize the highest-traffic and most-confusing articles first. When several agents do
screenshot passes, track per-article DONE in one shared plan so they do not collide.

---

## Build, verify, deploy

- Run the docs site's build locally (it should regenerate the search index, typecheck, and build).
- If the docs site deploys from a branch that gets no push-time type check, run a cold typecheck
  on it yourself before it is merged there.
- Verify in a real browser, not with curl. A single-page docs site returns its shell for any URL,
  so curl "succeeds" on a page that is actually a 404.
- Know which branch the docs site deploys from. It is often NOT the main app's release branch;
  never merge it into the wrong one. Deploying is the owner's call.

## Gotchas

- Migration files lie. Verify behavior from live code or the running app.
- Do not document a feature that does not exist (Mode B step 4).
- Do not add content just because a question was asked. Only close a genuine gap.
- A missing translation key renders the raw key to users. That is an app bug, not a docs fix;
  report it rather than documenting the raw key.
- A customer's screen recording or voice note is processed with the `media-review` skill
  (transcript plus only the distinct frames), never frame by frame.
- Cross-links: `support-triage` hands off here for doc gaps; the screenshot pass uses
  `browser-verification`; the post-build gate (`review-build`) calls Mode A.
