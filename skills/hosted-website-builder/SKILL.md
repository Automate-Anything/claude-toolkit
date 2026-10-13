---
name: hosted-website-builder
description: How to design a hosted website builder inside a SaaS - a small set of flagship templates (one per vertical), every text / image / video a NAMED SLOT, slots bound LIVE to the product's own data (hours, prices, services, team, plans) until the customer overrides them, a versioned content JSON with draft and published pointers, one renderer shared by the editor preview and the publish step, static files published to object storage and served by an edge worker keyed on hostname, a free subdomain plus the customer's own domain with automatic certificates, one-click embeds (booking widget, chat, store), legal pages, a contact form that feeds the CRM, an AI agent that can read and edit the site, and a paid add-on that gates publishing. Read this BEFORE building a site builder or landing-page builder, adding a new template, wiring custom domains, creating a website for a customer, giving an AI agent website tools, or debugging a site that looks stale or renders wrong. Use when the user mentions a website builder, hosted sites, templates, slots, click to edit, live data binding, publish, custom domain, CNAME, SSL for SaaS, a subdomain per customer, an edge worker, object storage hosting, "the site says Saved but nothing changed", or "create this website for this customer."
---

# Hosted website builder

> **Adapt before use.** This describes how a hosted website builder SHOULD be wired. It is taken
> from a production builder inside a booking SaaS: five vertical templates, sites served from
> Cloudflare R2 by a Worker, on a free subdomain or the customer's own domain. Nothing here is wired
> in your repo yet. Paths, table names and function names are EXAMPLES of the shape. Once built,
> replace them with your real names and add a "where everything lives" table. If the code disagrees
> with this file, the code wins: fix the file in the same change.

Owner hard rule that applies to any builder: **no customer names in product code, keys, paths or
copy.** A template is named for its vertical or style, never for the customer it was first built
for.

---

## 0. The thirty-second model

- **One website per location** (or per whatever unit your customers publish for). Writes need a
  managing role; reads need membership.
- **A site is a content JSON** stored in a versions table. The site row points at its DRAFT version.
  A publish SNAPSHOTS the draft into a new version and points "published" at it.
- **A template** defines the pages, the slots on each page, the site-wide slots, the first draft,
  and the renderer that turns content plus live data into static HTML, CSS and JS.
- **Live data** is fetched at EVERY render, in the editor preview and at publish: business name,
  phone, email, address, opening hours, the online service menu with prices and durations, team,
  class timetable, plans, packages, the booking link, the store link, the chat widget. Slots START
  bound to that data. The customer's edit replaces the binding with fixed words.
- **Publish** renders every non-hidden page plus a sitemap and robots file, and posts the files to
  the edge worker's publish endpoint (shared secret). The worker writes them to object storage
  keyed by hostname and serves them by the request's Host header.
- **Shared template media** lives in the same bucket under a template prefix and is served on every
  site at a reserved path.
- **Addresses:** a free vanity subdomain, or the customer's own domain. Own domain active means
  publish goes there and the free address redirects.
- **An AI agent can do it too**, through read / edit / publish / create tools.

### Access: do not hide the page behind a manual switch

The owner's decision was "no blocks or switches": every company can open the builder, gated only by
a launch flag plus normal role access to the page. A per-location "offers a site" column existed,
had no UI, and hid the page from everyone, which is how the showcase sites ended up reachable only
by script. Do not add a gate nobody can flip. Gate PUBLISHING if you need to charge (section 7).

---

## 1. Tables and storage (the shape)

- **sites:** company, location, template key, vanity subdomain, custom domain id, draft version id,
  published version id, status, published at.
- **site versions:** site, company, the content JSON, a label, created by.
- **site assets:** site, company, kind (image or video), storage path, public URL, alt text, width,
  height, duration, size, content type.
- **custom domains:** company, location, hostname, status, error detail, the edge provider's
  hostname id, is primary, which surface it serves.
- **A media bucket** with public read. Insert, update and delete are limited to the company's own
  folder. Set a size cap and an explicit list of allowed image and video types.

Keep the content schema, the binding shapes, the live-data fetcher, the first-draft generator, the
template registry and a shared template kit (slot helpers, color math, HTML helpers, legal pages,
feature switches, the preview bridge) in ONE shared module that both the app and the server import.

---

## 2. The content schema (what a human or an agent must understand to "do everything")

```ts
SiteContent {
  schema: 1, templateKey: '<template>',
  theme: { tokens: Record<cssVar, value>, colorPreset?: string, fontChoice?: string },
  globals: { brand?: {slot: value}, cta?: {...}, contact?: {...} },   // site-wide slots, in "bags"
  pages: [ { slug, title, hidden?, hiddenSections?, blocks: [ { id, type: '<template>:<pageKey>', fields: {slot: value} } ] } ],
  features?: { bookingEmbed?: boolean, chatWidget?: boolean, shopEmbed?: boolean, bookingScope?: 'location' | 'company' }
}
value = { kind:'literal', value }                       // the customer's words, or a stock media path
      | { kind:'binding', binding: 'location.phone' }   // follows live product data
      | { kind:'asset', assetId, alt? }                 // an uploaded asset row
      | { kind:'list', items: [ {field: value} ], binding?: 'services' }  // binding set = still following live data
```

- **Pages.** The template declares a page order and, per page, a slug, a name and whether it is
  hideable. Each page is ONE block typed by the template. Hiding sets a flag: the page is kept, not
  published and not linked. Home is never hideable. Every template has privacy and terms pages from
  the shared kit.
- **Slots.** Each has a key, a label in the CUSTOMER's words, a type (text, headline, rich text,
  lines, image, video, url, list), optional help text, and item fields for lists. Keep the text
  conventions tiny and documented: in a headline, a marker around a word means accent color and a
  newline means a line break; in rich text, a blank line is a paragraph, a leading hash is a
  heading, a leading hyphen is a bullet; "lines" is one item per line.
- **Colors.** Three base colors only: background, text, accent. Every other tone DERIVES from them.
  The template can read the three back out of its tokens.
- **Features.** Switches for the embeds. The booking embed puts the real booking widget on the Book
  page and routes unedited call-to-action buttons to it. The chat switch injects the chat script and
  needs that location's chat widget to exist. The store embed only appears on templates that have a
  store page.
- **Booking scope.** A site books either THIS location (the default) or the whole company, where
  the visitor picks a location first and the footer lists every bookable location. Have the
  live-data fetcher return BOTH links and the full location list regardless of scope, and let the
  render layer pick, so the editor never re-fetches on toggle. Company scope silently falls back to
  single when there is only one bookable location, and the editor shows the choice ONLY to
  multi-location companies.
- **Binding paths.** Company fields, location fields, hours, services, team, classes, plans,
  packages, socials, the booking link, the store link, assets, embeds. A list bound to live data
  renders from live data until an item is edited; then the editor (or the agent) writes explicit
  items and drops the binding.

---

## 3. How a render works: the editor preview IS the publish

The template exposes "render a page" and "render the whole site", both taking content, binding data
and options, and both returning static files.

- The client builds binding data with the live-data fetcher under the user's session. The server
  builds it with a service credential at publish. **Both call the SAME resolver, so what the editor
  shows is what publishes.** That parity is the whole point. Never write a second resolver.
- A preview option adds a postMessage bridge for click-to-edit and instant text patches.
- An inquiry option wires the contact form to its endpoint at publish.

If the server cannot import the shared module directly (different module system or build), GENERATE
the server mirror with a script and make the server's typecheck FAIL on drift. Do the same for
static assets that are embedded as code. See the landmines.

---

## 4. Adding a new template (checklist)

Copy the closest existing template and rename everything to the new key. **Never copy a customer's
site. Build on your own templates.**

1. **Content file.** The page-key union and page order; page definitions (include privacy and terms
   from the kit); page slots (every text, image, video and list the customer can change, with
   labels in their words and help text); global slots (brand, call to action, contact); the draft
   generator; the resolved shape and its resolver. In the draft, **bind everything that CAN be
   live**, and reference stock media as literal paths under the template's media prefix.
2. **Theme file.** Default tokens, which tokens are the three base colors, the palette derivation,
   the theme CSS.
3. **Renderer.** One fixed navbar with pages as links and hidden pages skipped; a footer with legal
   links; the booking embed section on the Book page; the store embed if the vertical has one; the
   chat tag before the closing body tag; legal page bodies; the SEO head, sitemap and favicon.
4. **Static CSS and JS.** Must include the legal page styles, the footer legal links and the embed
   iframe sizing. Keep the script small: navigation, reveal on scroll, hero video play and pause.
5. **Definition.** Register the template with its key, name, tagline, thumbnail, the BUSINESS TYPES
   it is the default for, and every function above. The template picker and the agent's create tool
   both ask the registry for "the default template for this business type."
6. **Register it** in the template index and in every script that lists templates, then run the
   asset-embed and mirror-sync scripts.
7. **Stock media.** Curate photos and ONE hero video loop: h264, no audio, fast start, with a
   poster image. Name files exactly as the draft's slot paths. Include a social cover image, which
   also serves as the picker thumbnail.
8. **Showcase.** Create a demo location with real-looking catalog, hours and team, publish it to a
   demo subdomain, and walk every page at desktop and phone width. Check: legal pages and footer
   links, the booking iframe, the chat bubble when on, the store embed, call-to-action targets, the
   sitemap and robots file, and that the hero video plays.
9. **Agent.** Nothing per template: the tools read the registry. A NEW feature switch means
   extending the feature type, the kit, the editor's feature rows and the agent's edit tool.
10. **Typecheck everything that imports the shared module**, including a COLD from-scratch
    typecheck of the server.
11. **Declare the page's sections and wrap each one** (section 7c), or the customer cannot remove
    parts of it.

---

## 5. "Create this website for this customer" (the playbook)

Do it in this order. Every step has a check.

**5.1 Account and location.** The customer needs an account, an owner user and a location. No
account means the owner signs them up (or the sales flow does). Do not fabricate an owner user
yourself. **The site only looks finished when the product holds the truth**: opening hours, online
services with prices, team photos, plans and packages if sold. Do those FIRST, or those sections
show nothing.

**5.2 Create the site.** In the app, through the agent, or by script using the SAME writes the app
does: insert the site as a draft, insert a version holding the template's first draft, point the
site's draft at it. The free address is short, lowercase, hyphenated, and not on the reserved
subdomain list. Keep that list in ONE place if the client and server both check it.

**5.3 Words.** The template copy already carries the business name. Rewrite the story slots (the
About statement, hero headlines, service blurbs) from what the customer gave you, in the editor or
through the agent. **Never by hand-editing JSON in the database. Do NOT retype hours, prices,
services, team or plans: they are bound.** The one exception is a customer who wants different
words than their live data.

**5.4 Their photos and videos.** Build an import script with a dry-run mode. It walks the draft, and
for every image or video slot STILL pointing at the template's stock media, if a file with the SAME
NAME exists in the customer's folder (recursive, case-insensitive), it uploads the file, records
the asset and switches the slot to the asset: exactly what the editor's "replace image" does. So
name the customer's files like the template's stock names and one run re-skins the whole site. Add
an explicit `--set <page>.<slot>=<file>` mapping for odd names. Dry-run first and read the plan.
**Never run it with a real customer's media against a demo or showcase site. Those are public.**
Keep the hero loop short (8 to 12 seconds), muted, a few megabytes at most, with a poster.

**5.5 Booking, chat, store.** Feature switches in the editor or through the agent. The booking
widget defaults ON. Turning chat on creates or enables that location's chat widget, so chats land in
the inbox.

**5.6 Their own domain.** The wizard takes the hostname, shows the CNAME target (their DNS must
point the host at your fallback origin), and polls until the certificate is issued and the status is
active. Then publish again. The free address then redirects. The customer (or you, if they hand over
DNS) adds the record; an agent cannot. **Apex domains** need a registrar that supports CNAME
flattening or ALIAS records. Otherwise use `www` and have the registrar redirect the apex.

**5.7 Publish and verify, in a real browser.** Every page returns 200; the hero video plays; hours,
prices and team match the product; the Book page shows the widget for THAT location; a contact form
submission creates the contact, the lead and the tag AND emails the merchant; legal pages open; the
sitemap and robots file return 200; the phone-width layout is clean.

**5.8 Hand-off.** Tell the owner the addresses, what was imported, and what the customer can now do
themselves. **Do not keep a second copy of the site anywhere.** The repo, the database and the
bucket are the only sources.

### The contact form is a product feature, not a mailto

The public inquiry endpoint does all of: find or create the contact at that location, add a note,
create a lead in the growth pipeline, tag the contact "Website", and send the merchant a branded
email with an "Open contact" link.

---

## 6. Giving an AI agent website tools

| Tool | Kind | Does |
|---|---|---|
| read website | read | An overview (status, addresses, template, pages shown and hidden, business slots, colors, features), or one page with every editable slot and its current words. |
| edit website | write, manager and above | A list of changes: text (page, slot, value; a list item by index and field), page hidden, feature on or off, colors. The confirm card quotes BEFORE and AFTER. An optional publish after saving. |
| publish website | write | The app's publish. Sets the web address first if the site has none. |
| create website | write | Template from the location's business type (or named), address from the company slug or name, the first draft. |

- **Resolve a page or slot by key OR by label**, with unique prefix or containment matching. On
  ambiguity, list the candidates rather than guessing.
- **The agent writes AS THE CALLER**, through the same access rules as the app. A staff member with
  no rights gets a clean refusal, not a service-credential bypass. If a sub-step has a stricter rule
  (creating the chat widget was owner-only), return a friendly refusal for a manager.
- Share ONE content-edit module between tools: load the site for a location, describe pages,
  globals and features, normalize a change, apply a change, and backfill pages a newer template
  added to an older site.
- **Declare the gaps.** Media upload and own-domain setup were app-only. List them as known gaps in
  the agent's catalog so it says so instead of pretending.
- Smoke-test read tools and the PREVIEW of write tools against a demo company. Never execute a
  write on a real customer as a test.
- Extending: a new change kind is added to the change type, the normalizer, the applier, the tool's
  schema enum, the catalog entry and the agent's primer, all together.

Every template footer renders one shared "Powered by" line linking to your marketing site. Add it to
any new template.

---

## 7. Charging for it: gate PUBLISH, not building

Building and previewing are free. PUBLISHING is gated by an entitlement: an active website add-on
for that location, or a support comp. An activation step appears in the editor before the first
publish, and the server re-checks on publish and refuses with a payment-required status.

Why this shape: **the customer sees the finished site before paying.** Never put the paywall before
create or preview.

- Model it as a per-location add-on subscription (see `saas-subscription-billing`), monthly or
  yearly, prorated onto the existing invoice.
- **Existing published sites get a grace window at launch, not an outage.**
- Give support a per-company override so they can comp it.
- Decide the cancel behavior up front: the site stays editable but unpublishes after the paid
  period ends. That requires an UNPUBLISH path. If "take a site down" does not exist yet, cancel
  cannot be honored. Build it with the add-on.

### 7b. Changing the look (template) of an existing site

Keep the current draft row untouched. Insert a NEW version: the newest non-published version of
this site that already uses the target template (which restores that look's earlier edits), or else
the template's first draft. Carry the current features over, then set the site's template key and
draft pointer. Flush the editor's pending save first and remount the editor (key it on site id plus
draft version id). Published snapshots are never touched; the live site changes look only on the
next publish.

### 7c. Honest content, and hideable sections (owner rule)

- **A bound list is the TRUTH, even when empty.** Every resolver uses live data whenever a list is
  bound, with NO "if live is empty, fall back to sample items". The section then disappears. Before
  this rule, a merchant with no online packages was shown the template's FICTIONAL packages and
  memberships with "Buy online" buttons. Same for hours: bound means the location's hours or
  nothing, never sample hours.
- **First drafts contain no invented facts.** Reviews and testimonials, quote banners, numbers and
  stats, and premises claims (parking, transit, amenities, walk-ins) start EMPTY, and their
  sections render only once the customer fills them. Marketing copy (headlines, intros) is fine.
  Keep this rule for every new template.
- **Hideable sections.** The page content carries a list of hidden section keys, and the template
  declares each page's sections (key, label, which slots belong to it). The renderer wraps every
  declared section in "is this section on, and does it have real content?". In the editor, clicking
  any slot of a section shows a "Hide this section" bar; the page panel lists sections with
  switches, and a section's name opens its fields, which is the way INTO an empty section.

---

## 8. Landmines (each one cost real time)

- **"Saved" but nothing stored.** The versions table shipped with NO update policy ("versions are
  immutable"), while the editor and the agent save by UPDATING the draft in place as the caller.
  Row-level security turned every save into a zero-row no-op WITH NO ERROR, so the editor said
  "Saved" and nothing was kept. The fix has two halves: a policy that allows updating ONLY a row
  that is some site's draft and no site's published version; and **every client draft write selects
  the id back and treats zero rows as a failure.** Keep both for any new writer. General rule: an
  update under row-level security that matches zero rows is silent, so always confirm a row came
  back.
- **Mirror drift.** Editing the shared template module without regenerating the server mirror makes
  the server render the OLD template. Typecheck catches it. Deploy does not warn.
- **Embedded static assets.** CSS and JS edits need the embed script re-run, or preview and publish
  keep the old file.
- **A CLI flag that does not exist prints help and uploads nothing.** Confirm an upload by listing
  or fetching the object, not by the command exiting cleanly.
- **Line-aware text helpers.** A rich-text block that starts with a heading marker is a heading
  line; the rest is body.
- **Dash guards.** If the repo has a guard against typographic dashes or mojibake, a CSS escape for
  one trips it too. Use commas and colons in copy.
- **Long brand names collide with a centered nav.** Cap the wordmark width and keep the cap.
- **Cache.** Serve site files with "no cache, must revalidate" so a CSS change shows immediately.
  Template media is cached for a day, so replacing a stock image under the same key can lag a day.
  Use a new file name.
- **Demo sites are public.** Never put a real customer's media or data on them.
- **Access rules.** Site and version writes need a company match plus a managing role. The agent
  writes as the caller.
- **Bound lists detach on the first item edit.** Editing one service card freezes the WHOLE list at
  the current data. Tell the operator, and prefer editing the service in the catalog.
- **Older sites and newer templates.** A template that gains a page needs a backfill step when an
  older site is loaded.

## Related skills

- `seo`: sitemaps, robots, structured data and findability for the published sites.
- `page-performance`, `ui-ux-pro-max`: the templates themselves.
- `saas-subscription-billing`: the paid add-on.
- `security-rls-permissions`: the write policies, and the zero-row update trap.
- `browser-verification`: walking a published site.
