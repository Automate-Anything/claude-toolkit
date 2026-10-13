---
name: customer-onboarding-doors
description: How a NEW customer gets set up in a SaaS product across every onboarding "door" (the start-from-a-template quick start, the manual multi-step wizard, the in-app setup checklist, the welcome email drip, the first-login product tour) so you change all of them together and never leave one behind, PLUS the mandatory checklist for wiring ANY new feature, setting, default or automatic message into the template quick start so a brand-new account gets it on day one. Read this before touching onboarding, a setup wizard, a quick start, a setup checklist, what a new account is asked or defaulted, the Next/advance behavior of any onboarding step, a welcome email sequence, or a product tour; and AFTER you build or change any feature that has a per-account default, a seeded row, a setting, a catalog object, or an automatic customer message. Triggers: onboarding, guided setup, setup wizard, quick start, start from a template, setup template, pack, vertical defaults, business type defaults, first-run, "what do we ask a new customer", "does a new customer get this automatically", activation, the Next button on a setup step, welcome drip, onboarding emails, walkthrough, product tour, coach marks, "show new users around".
---

# Customer onboarding: every door, kept in sync

> ## Adapt before use
> This describes how onboarding SHOULD be wired, taken from a production
> multi-tenant SaaS that serves about thirty business types. Component, table,
> function and script names below are EXAMPLES of the shape. Grep the current
> repo before citing any of them; when this file and the code disagree, the code
> wins. Once the real onboarding exists here, replace the examples with the real
> names, list the real doors, and keep the checklists.

This skill has two halves. Part 1 is the EXPERIENCE: the doors a new customer can come through and
the rule that keeps them consistent. Part 2 is the ENGINE: the template quick start, and the
checklist that keeps every new feature wired into it.

---

# PART 1: THE EXPERIENCE

## The one rule (why onboarding has this shape)

**Only ask the customer what we cannot answer ourselves. Default everything else, driven by the
kind of business they are.** If we have a sensible default (even an imperfect one), apply it
silently and do NOT put a field on a first-run screen. A new customer should reach a working
system with the fewest possible questions. The owner's words:

- "Who cares about the name of the agent" (it is seeded).
- "Only ask questions we cannot answer by ourselves even if the answer is not so good but we can
  use it as a default."
- "Everything is connected to what type of location they are."

In the reference product the only things we genuinely could not answer were: the **business
name**, the **business type** (which picks the template), and the **address** (which drives
timezone and tax). Almost everything else had a default or came from the business-type pack. Find
that short list for THIS product and defend it.

## The doors (all reach the same account; keep them consistent)

1. **Quick start = "Start from a template" (THE DEFAULT door).** Shown by default to a brand-new
   account. Asks only the two or three unanswerable things, then applies the business-type pack in
   one call and shows a finish screen listing the few remaining tasks only the customer can do.
   This is the fastest path and the one we push. Engine and upkeep: Part 2.
2. **The classic multi-step wizard (the MANUAL door, least pushed, still 100% working).** Reachable
   from a small "set it up manually" link, a banner, or a URL parameter. It is the least promoted
   option, but it must be flawless because a user CAN reach it.
3. **The in-app checklist / nudge banner (after they are in the app).** A dismissible "finish
   setup" banner while the account is not marked complete, plus per-location setup progress.
   Onboarding is NOT forced: a customer can skip and work.
4. **The welcome email drip** (days 2 to about 24). See its section below.
5. **The first-login product tour.** See its section below. The doors SET THE BUSINESS UP; the tour
   teaches a new user WHERE THINGS ARE. Different problem.

## The freeze-bug class (onboarding Next buttons). PREVENT IT.

Symptom a real customer reported: "It stays on the same page. I can click the top tabs to advance,
but the Next button doesn't work."

Root cause: a step's Next/Complete handler `await`ed a slow call BEFORE advancing. Most often a
full session refresh (which can hang for a bad network minute) or a debounced auto-save. If the
await hangs, navigation never happens. The step tabs called the "set current step" function
directly, which is exactly why they worked when Next did not.

**Rule for every onboarding advance handler: ADVANCE FIRST, then do tracking and refresh in the
background (fire and forget). Never `await` a hangable call before navigating.**

- The "mark this step complete" write must never throw by design (it catches itself).
- Session and progress refreshes are best-effort.
- Never gate Next behind a debounced side effect that may not have round-tripped yet. One step
  falsely said "Schedule Required" on a valid seeded default until its autosave returned. The fix
  was an explicit "ready" signal from the child, not waiting on the save.
- Make Next behave exactly like the step tab: same function, nothing awaited in front of it.

## What onboarding asks vs defaults (the pattern to copy)

- **Business details:** ask ONLY the name (required; guard so a blank or placeholder name cannot
  advance). The public display name mirrors it automatically. Legal entity, website, logo and the
  whole main-contact block (already known from signup) are hidden in onboarding and editable
  later in Settings.
- **Cosmetic names (the AI assistant's name, and the like):** never asked. The seeded default
  stands and is editable later.
- **Location:** the address is the essential. Business type drives the pack defaults.
- **Schedule:** defaults to standard weekday hours, seeded and auto-saved. The single-location case
  needs no input.
- **Catalog items:** name and price (plus duration where it applies) are essential. Every
  "advanced" field (SKU, barcode, cost, margin, discount, commission) is collapsed and opt-in, and
  the ones that can auto-generate do. Do not surface them by default.
- **Integrations and AI steps:** skippable. Skip is present and Next is not gated. They duplicate
  pages that are always available in the app, so nobody is forced through them.

## THE CROSS-SURFACE UPKEEP CHECKLIST (why this skill exists)

When you change WHAT onboarding collects, defaults, or how a first-run thing works, update EVERY
door that exposes it, in the same change. Do not fix one and leave the others behind.

1. **New first-run field or setting?** First ask the one rule: can we default it (from the pack,
   the business type, signup, or a sensible constant)? If yes, default it and do NOT add a
   question. If it truly cannot be answered, add it to the MINIMAL place, and:
   - Does the template flow already cover it (pack section + apply function + finish tasks)? If
     the pack supplies it, the wizard must NOT re-ask it.
   - If the wizard must ask it, gate onboarding-only vs settings correctly. Shared components
     render in BOTH onboarding and the permanent Settings pages: use a `mode` prop. Never remove
     the field from Settings.
2. **New onboarding step or a step change?** Wire it into the step registry (keys, renderer,
   completion keys) AND make its advance handler freeze-proof (advance first). Keep the top step
   tabs and the progress indicator in sync.
3. **A default a new account should get on day one?** It belongs in the pack + the apply function
   + the new-account seed trigger, so BOTH template and non-template accounts get it. See Part 2.
4. **A settings or message surface that has a twin** (per business type, or per product area)?
   Reuse the SAME component with a `mode` prop instead of building it twice. If you add a message
   type or variable to one, it then flows to the other by construction. If you must branch, gate
   every branch by the mode and keep the non-target mode byte-identical.
5. **After any onboarding-visible change:** typecheck, run the translation-key audit (zero
   missing), then WALK each affected door on a real account. Update the what's-new log if it is
   user-visible, and the Getting Started and start-from-a-template help articles (read
   `help-center-upkeep` first).

## Landmines (experience side)

- Shared components power BOTH onboarding and permanent Settings. Gate onboarding-only trims
  behind a mode prop; never delete a field from the Settings surface.
- Never `await` a hangable call before advancing a step.
- **Only an explicit click turns a step green.** Step completion is a stored "the user completed
  this" fact, never a data heuristic ("they have three items so the catalog step is done"). The
  write that records it self-catches and never throws.
- Onboarding is not forced; every step is skippable. Do not add a hard block except the one
  essential (a valid business name), and even that shows an inline error, never a dead button.
- Before "fixing" a dead end between two steps, verify it exists against the LIVE defaults. One
  suspected dead end was not real: the flag in question defaulted to true and the auto-created
  first location was already configured.

---

## The welcome email drip (days 2 to about 24)

After the welcome email (day 0), a handful of short first-person notes from the founder over the
first weeks, one job each, worded for the account's business type. It is TIME-based (every new
account, on a clock), distinct from any behavior-based activation sequence.

**If you add, reorder or reword a step, update this section, the email-system docs, and the plan
ledger in the same change.**

- **Shape of the schedule (example):** day 2 the catalog, day 5 the public-facing flow, day 7
  connect payments, day 9 the ONE thing worth turning on for THEIR kind of business, day 14 the
  AI/automation feature plus "reply, it lands with me", day 18 "whatever you need, just ask us or
  the in-app assistant", day 24 "if you ever get stuck, here is the button to reach us". Keep the
  eligibility window a couple of weeks past the last step.
- **STATE-AWARE (owner rule): never tell someone to do a thing they already did.** Every step
  carries a `done` check (did they already build a catalog, connect payments, turn the feature
  on). When done, log a "skipped" row under the step's dedupe key and move to the next due step in
  the same run. **No step ships without a done check.** The one exception is a deliberate
  evergreen note ("here is how to reach us") that is always sent. Source the checks from the
  nightly per-account usage snapshot plus live structural columns, not from guesswork.
- **TONE (owner rule): relaxed.** Everything is already fine. No urgency, no "you need to", no
  "saves you hours later". Light humor is welcome. Never scare anyone.
- **Voice for every step:** first person, NO greeting line, 2 to 4 sentences, ONE call to action,
  signed by the founder (put the sign-off inside the editable body). No em or en dashes. The
  welcome email itself follows the same bar: one paragraph, one button ("Set it up for me",
  leading to the quick start), then the founder note. The email shell adds NOTHING after the body:
  no trailing button, no "Cheers, The Team".
- **Screenshots in emails:** each step shows a picture of the real UI. Capture it from a NORMAL
  customer account, not a superadmin, so the menu in the picture is the menu they see. The copy
  must also name the exact menu item, so the email teaches the path even without the image.
- **Per-business-type wording:** merge tags resolved from the account's business type (the noun
  for a visit, the title for a provider, and so on) plus one per-family tip block. Adding a
  business type means mapping it to a family and giving the family a tip.
- **Deploy-free switch:** store the copy in editable template rows, seed every row INACTIVE, and
  make the sweep a no-op until a step is switched on. Edit, preview, test-send and toggle from an
  admin page. The preview must use the SAME renderer as the live send.
- **Unsubscribe (owner rule):** every email in the sequence ends with an unsubscribe link and the
  physical address. Reuse the platform's ONE marketing opt-out list; never add a second list or
  route for sequences. A suppressed step logs "skipped (unsubscribed)". The account-critical
  welcome still sends, but carries the link.
- **Exactly once, with gates:** a dedupe key per step in the outbound email log. The sweep only
  considers recent, non-deleted accounts whose welcome email was already sent, and sends ONE step
  per account per run, so switching the sequence on late never dumps four emails at once.
  By-design skips (step off, owner unconfirmed, no real email) never alert. A real send failure
  does alert.
- **To add a step:** append it (keep day offsets ascending), seed its template row inactive, give
  it a done check, register it wherever the admin page lists togglable emails, and update the
  docs named above.

---

## The first-login product tour

A stepped "Next / Next" overlay that walks a new user ACROSS pages and points at where each major
area lives.

**If you add to, move or change the tour, update this section in the same change.** This is the
one place a zero-context agent learns the tour exists and how it is wired.

### Build it inert first

Build the engine and the content with NO trigger, so the tour appears for nobody. It runs only
when code calls `startTour(id)`, and the only caller is a dev-only launcher behind a local flag.
Wiring the real first-login trigger is a separate, later deliverable the owner says go on. This
lets the owner walk and approve the whole tour before a single customer sees it.

### The pieces (example shape)

- **Types:** a tour is a list of steps. A step optionally has a route (navigate there first), an
  anchor (an element to point at; omit for a centered card), translated title and body keys, a
  placement, and an optional `isApplicable()` predicate.
- **Content:** an ORIENTATION tour that covers EVERY big capability. The owner wants full coverage
  of the big features, not a short tour. Keep each step to ONE benefit line so it still reads
  fast. For a feature that is OFF by default, the copy must say HOW to turn it on. When
  `isApplicable()` returns false the engine SKIPS the step and keeps the "X of N" counter honest,
  so a plan or role without a gated feature never sees a step describing an upgrade wall.
- **Engine:** per step it navigates safely (respecting unsaved forms), polls briefly for the
  anchor to mount, then renders a dimmed backdrop with a spotlight cutout plus the card. **If the
  anchor never mounts** (the nav item is hidden, inside a collapsed group, or the layout differs)
  **it FALLS BACK to a centered card, so a step never dead-ends.**
- **CANCEL FROM ANYWHERE (owner requirement):** four exit paths, each fully tearing the tour down:
  the corner X, a "Skip tour" text button, the Esc key, and a backdrop click.
- **Card UI:** theme tokens only, so it follows each account's theme.
- **Seen state:** local storage while inert, so the inert build touches no database. When the
  trigger ships, swap in a per-user database-backed record behind the SAME hook API, so only one
  file changes.
- **Anchors:** a dedicated `data-tour="<value>"` attribute threaded through the shared nav
  component as a prop. **Never target a utility class or a DOM position**: navigation reorders per
  user. Items inside a collapsed menu get a navigate-then-centered-card step instead of an anchor.

### To add a step or a tour

1. Add the step (or a new tour, registered in the tour registry).
2. Add its translation keys BEFORE referencing them.
3. If it anchors to a new element, add the `data-tour` attribute there through the shared
   component.
4. Bump the tour version if existing users should see it again.
5. Typecheck, run the translation audit (zero missing), and walk it with the dev launcher.
6. Update this section.

### Hard gating rules for the auto-start trigger

The tour renders above ordinary chrome, so it MUST NOT start on top of a real task. Do not
auto-start while any of these is active; wait until they clear:

- **Any open dialog or sheet.** The tour's scrim would bury it. That includes the unsaved-changes
  dialog, trial and billing dialogs, restore and update prompts, and the onboarding wizard itself.
- **An active real-time task** (a live call, a running checkout). An in-flow control strip has no
  z-index of its own, so the scrim would cover the controls. Gate on that state explicitly.
- **The onboarding flow itself**, if the tour should follow setup rather than compete with it.

Also: toasts render ABOVE the tour by design (a toast should interrupt). Accept that; do not fight
it. A blocked navigation (dirty form) makes the engine wait and never show a mismatched card, so
the trigger does not need to re-implement that. Add a "Replay tour" item to the user menu when the
trigger ships.

**Mobile:** treat a present-but-hidden element (a desktop sidebar that is `display: none` on small
screens returns a 0x0 rect) as "not usable" and fall back to a centered card, so nav-anchored
steps degrade automatically. For true mobile anchoring, open the mobile nav for those steps and
anchor inside it. Keep the card width responsive.

---

# PART 2: THE ENGINE (START FROM A TEMPLATE)

## The one rule (engine side)

An account that started from a template must be able to USE every part of the system immediately,
with defaults. Not "would they want it": if the functionality exists, a template account can use
it. So when you add or change functionality, ask:

**"If an account started from a template today, would this work for them right away, or does it
need data or configuration they do not have?"**

- Needs data or configuration a fresh account lacks (a catalog object, a seeded row, a per-location
  setting that must be non-empty, a message, a phone / messaging / AI wiring, a step only the
  customer can do): the template must supply it, OR the finish screen must list it as a task with
  a deep link. Wire it (checklist below) in the same change.
- Only two exemptions: a setting whose built-in default already makes the feature work, and an
  optional setting that is fine off by default. Nothing else is exempt, and "it is more of an
  add-on" is not a reason to skip.

## What "Start from a template" does (the chain)

1. **UI:** the customer picks a business type and confirms the address, then ONE call.
2. **API route** (owner/admin of the account only):
   - writes the structured address and derives timezone and sales tax from it (regional rate,
     which regions tax services, a gate for unsupported countries),
   - calls the database apply function **as the caller** (the user's own token, never the service
     key), so the function's permission checks stay real,
   - provisions the paid resources a new business needs (for example a first phone number: try the
     customer's own area, then nearby, then the region's major cities; then switch on the alerts
     and the AI answering that depend on it),
   - marks onboarding complete and returns the `remaining_tasks` list the finish screen renders
     with deep links.
3. **Database apply function** `apply_template(slug, account, location, options)`. Order: settings
   (on the FIRST apply at that location only), then categories, catalog items and their
   per-location join rows, bundles, plans, rooms/resources, make the caller a staff member with a
   schedule, mark onboarding steps, write an audit row. **Additive, deduped by name, idempotent:
   re-applying never deletes or overwrites the customer's own data.** Always pull the LIVE function
   body before editing it.
4. **Content:** one pack file per business type, a written pack spec (schema and rules), and a
   generator that validates every pack (keys, units, cross-references, message variables, dashes)
   and writes the seed migration as an upsert by slug. The seed touches ONLY the templates table.

**Per-business-type messaging: ONE messaging system, not one template set per type.** Two layers:

- A vocabulary layer: business type -> family -> a few merge variables (the noun for a visit, the
  title for a provider, a closing line) merged into EVERY send, plus per-family overrides of fixed
  email copy. Because it is driven by the account's stored business type, it also fixes accounts
  that never used a template.
- The pack's messaging section: literal per-type message bodies, subjects, reminder cadence,
  follow-up delay and copy, and the seeded saved replies. Written on first apply only.

**Inline message bodies in packs are plain text.** The send path wraps plain text in paragraphs at
send time. Never put HTML in a pack message body.

**Opt-in messages stay off.** Greetings such as birthday or holiday messages are seeded for every
account but OFF by default. A greeting is a deliberate choice, so no pack ships it on.

**If the product has an in-app AI assistant,** give it a "start from a template" action that calls
the SAME route as the caller. When you add a pack section a customer would ask about, mention it
in that action's description and preview.

## Checklist: wiring a new feature into the template start

Pick every row that applies. The question is always: what does a fresh template account need so
this WORKS?

| The feature adds... | Do this |
|---|---|
| A new column or setting a new business should have set | Add the key to the pack's settings section (every pack, or the builder default), whitelist it in the generator's allowed keys, read it in the apply function with a coalesce-to-existing pattern, document it in the pack spec. |
| A new catalog object type | New pack list + validator block + apply-function section (name-deduped insert, per-location join rows) + a depth rule in the pack spec. |
| A new automatic customer message or lifecycle config | Give it a vocabulary-aware system default, add it to the shared messaging builder and the allowed-keys list, merge it in the apply function. Never hardcode one industry's noun in a new default template. |
| A new per-account seeded row (template, category, status) | Make the new-account seeder trigger do it for EVERY account, so it is not template-only. If the business type should change its content, add a pack key plus an update guarded by "untouched by the customer". |
| A new phone / messaging / voice / AI capability a new account should start with | Wire it into the provisioning step after the resource is live. Reuse the proven service function, never a copy. Report failures as an entry in `warnings[]`, do not fail the whole quick start. |
| A new thing only the customer can do (OAuth, payment processor, hardware) | Add a remaining-task key and its computation, the label / description / action text, and the deep link on the finish screen. |
| A new business type | Add a pack (the generator must REFUSE to run until every type has exactly one pack) and map the type to its vocabulary family and provider title. |

Then, every time:

1. Run the generator (validates and regenerates the seed).
2. Apply the seed (only template rows). If the apply function changed: re-pull the live body
   first, write the full function as a new migration, apply it, and run the SQL function checker.
   Database writes follow the repo's database rules and the owner's approval.
3. **Dry-run the apply function as a real test owner inside a rolled-back block.** Set the request
   identity to that user, call the function, then raise an exception carrying the counts so the
   whole thing rolls back. Confirm your new rows and settings appear.
4. Update the pack spec, this skill if the chain changed, and the start-from-a-template help
   article when the customer would notice.

## Ordering trap: seed vs function

When pack keys grow, every new key must be optional, and the apply function must coalesce to the
old value so older packs seed identically. **Do not apply a regenerated seed before the function
that understands it.** Until the new function is live, the old one ignores the new keys and can
SILENTLY SKIP entries in a new shape (an object where it expects a bare name simply does not match
anything). Function first, then seed.

## Keeping packs fresh from live customers (the freshness loop)

Packs must track what real businesses of each type actually run. Periodically, or when the owner
asks, study the LIVE database in aggregate per business type: most common item names with median
price and duration, top products, bundle and plan shapes, deposit / cancellation / tip posture,
reminder cadence. Read-only queries. **Never copy a single customer's data or names.** Propose a
reviewed diff to the pack files (bump the version), regenerate, apply the seed. Record the study
date in the plan doc.

## Landmines (engine side)

- The apply function writes SETTINGS only on the first apply at a location; catalog and message
  templates are guarded by name / untouched checks. Do not add an unconditional UPDATE of
  customer-editable data.
- Units: money is integer cents; a percent deposit is a whole percent; tax is a plain percent
  (8.54). Validate units in the generator.
- Message bodies may only use variables the send paths actually supply. Keep a validator
  allow-list. An unknown `{{var}}` makes the outbound guard HOLD the message, so a typo in a pack
  silently stops a customer's reminders.
- The apply function runs as the caller, so the caller needs the edit permissions for what it
  writes. Owner and admin have them; do not assume a lesser role does.
- The provisioning step spends real money and registers with outside providers. Test on staging
  with a fresh account and watch the first run. Never on a real customer without the owner.
- No em or en dashes anywhere in packs (the validator rejects them), and keep seed text to plain
  ASCII if any downstream channel mangles accents.

Related skills: `help-center-upkeep` (the Getting Started articles), `review-build` (the post-build
gate that asks whether the template needs extending), `build-with-the-user-in-mind`.
