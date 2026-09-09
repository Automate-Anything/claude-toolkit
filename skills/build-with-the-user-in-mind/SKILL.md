---
name: build-with-the-user-in-mind
description: The thoroughness + product-judgment standard for building AND reviewing ANY user-facing feature, field, or flow. Use BEFORE building (Step Zero - name the job, confirm a surface to do it even exists), DURING building (the per-element bar), and as the REVIEW protocol when judging your own or an agent's work from the USER'S SEAT - and any time you catch yourself thinking "this is good enough" / "it's perfect." It encodes a high bar: examine EVERY field/control individually; confirm the user can actually DO the job they came for (not just that a component exists); make every value correct + correctly mapped; think through what brings them here and where they go next (and physically link that next step to cut their time); make sure any data the user would want has a UI home; and check whether another surface must sync. Triggers: building/redesigning a page, dialog, form, picker, table, settings panel, empty state; adding any field or button; reviewing returned/own work; "is this fine?", "good enough", "ship it", "is it done", "looks perfect".
---

# Build With The User In Mind - the thoroughness + review standard

This skill exists because of two repeated, expensive failure patterns:

1. On a long feature build, the same surface gets sent back to be improved many times. Each time the
   agent thinks it is "fine"; the reviewer says "no, better." The pattern is never a missing feature - it is shallow product judgment: shipping the first thing that worked instead of the thing a real
   human would actually want.
2. A whole area gets audited as "perfect / ~90% done" and the reviewer immediately finds there is **no
   screen to do the actual core job** - only adjacent screens that happen to exist. The agent reviewed
   the screens that existed and never asked "for the job the user actually comes to do, is there even a
   place to do it?" It verified the NOUN existed, not that the VERB worked.

This skill encodes the standard so you hit it the FIRST time - both when you BUILD and when you
REVIEW. There are two modes below. Read **Step Zero** + **BUILD MODE** before building. Read
**REVIEW MODE** whenever you judge whether something is done - your own work OR an agent's.

---

## ⛔ STEP ZERO - before you build OR review a single screen

Do this FIRST, before any per-field scrutiny. This is the level the big misses happen at - above the
screen, where a per-field checklist has nothing to catch because the screen shouldn't be the thing
you're looking at.

1. **Name the JOB, in the user's words.** Not the feature - the job. Not "the inventory page," but the
   concrete thing a real person is trying to accomplish, in one sentence, the way they'd say it.
2. **Name WHO does it and HOW OFTEN.** A specific role, a real frequency, under real pressure (in a
   hurry, on their feet, mid-conversation). The frequency and the pressure decide how sleek/fast it
   must be. A 50×/day job that takes 6 clicks is a broken product even if every click "works."
3. **Walk the job end to end and name the SCREEN for each step.** For EACH step, name the exact screen
   + control the user taps. **If you cannot name the screen for a real step, THAT IS THE GAP** - even
   if every file "exists." That missing screen is more important than any polish on the screens that
   exist.
4. **Weight by daily-use frequency, never by item count.** "90% built" is meaningless if the missing
   10% is the screen people touch 50×/day. One load-bearing missing surface outweighs 20 polished
   features. NEVER report a percentage as reassurance.
5. **Only after the job has a complete chain of real screens** do you drop into per-screen, per-field
   scrutiny (BUILD MODE / REVIEW MODE below).

Verify the VERB (can the user do the task?), never just the NOUN (does a file/route/component exist?).

---

## BUILD MODE - the per-element bar

> For EVERY field, control, and state you put on screen, slow down and ask the questions below.
> Not the screen as a whole - every individual piece. "It works" is the floor, not the bar.
> The bar is: a real human, mid-task, finds it obvious, fast, sleek, and consistent with the rest
> of the app - every value is correct and correctly mapped - and nothing breaks, goes stale, or
> leaves them stranded after they use it.

Run this per element, out loud in your head, before you write it and again before you call the
surface done:

1. **Is this the BEST possible way - sleek and minimal?**
   Not just functional. Is it the cleanest version? Too many words? Redundant labels? A header that
   explains what the rows already make obvious? Two controls where one will do? Strip it.

2. **Is it CONSISTENT with the rest of the app?**
   Does this app already solve this exact problem somewhere? Use that pattern, component, icon,
   wording. Do NOT invent a new one. Before inventing anything, grep for how the app already does it.

3. **Is every VALUE correct and correctly mapped?** (the "everything works with the right values"
   bar - make it explicit, it is the easiest thing to fake-pass.)
   - Is the right field bound to the right column? (Not the created/imported timestamp when the real
     date is a different column; not one entity's name where another's belongs.)
   - Are units right - money in the stored unit, divided/multiplied only for display? Dates in the
     user's timezone? Counts matching what's actually rendered below them (a "0 items" stat over a
     list of 32 is a bug)?
   - Do the numbers reconcile across the surface - header total = sum of rows = what the next page
     shows? Open a REAL record with real data and read every value against the source of truth.
     Empty/seed data hides mapping bugs.

4. **Is the actual TEXT the best possible phrasing?** (every word the UI says TO the user - labels,
   buttons, headings, helper text, tooltips, toasts, empty states, errors, confirmations.)
   Read each string as a real person seeing it for the first time and ask:
   - **Will someone NOT understand it?** No invented jargon, no internal/dev/migration vocabulary
     leaking to users (raw enum values, table/column names, import tags). If a normal user wouldn't
     say it, rewrite it.
   - **Is it the COMMON INDUSTRY phrasing?** Use the word the user's world already uses - research the
     established tools in that domain - not a clever synonym you coined.
   - **Can it be SHORTER / clearer?** Cut filler. A button is a verb ("Send", not "Click here to send
     this"). A label is 1-3 words. Say it the way a person would say it out loud.
   - **Is it CONSISTENT?** Same concept = same word everywhere (don't call it "client" here and
     "customer" there); consistent casing; follows the app's voice. When unsure of the best wording,
     look at how a sibling surface already says it and match - don't invent a second vocabulary.

5. **What does the user expect from muscle memory?**
   A clear "✕" to clear a field. A field collapsed until clicked, not a giant always-open list.
   Auto-fill the likely value with one obvious escape.

6. **What is the WORKFLOW - what brings the user here, and what happens AFTER they act?**
   Think the whole funnel, not the single screen:
   - What were they doing right before they hit this control? Pre-fill / default from that context.
   - The moment they pick/submit - then what? Does it create the next thing, notify someone, show a
     confirmation, or leave a gap? A picker can't just record a value - after the pick, the
     downstream effects (charge, schedule, task, status update) must actually happen. Think it
     through based on the full workflow.
   - Are there MULTIPLE ways to arrive at this same end state? Handle them all, gap-free.

7. **Did you LINK the next step to cut their time?** (don't just *anticipate* the next click, *remove*
   it.)
   After the user finishes here, where do they go next 80% of the time? Put that destination ON this
   surface - a button, a link, a deep-link with the entity pre-seeded - so they don't navigate
   manually. The bar isn't "they can get to the next step"; it's "the next step is one obvious click
   from here, with context carried over." Cutting a 5-step path to 2 is the product win.

8. **Does the user want DATA that has no UI home?**
   Is there data tied to this surface that the user would reasonably want to SEE or ACT ON, but
   there's no place to? If the data exists and the job needs it, it needs a surface, a column, a card,
   or a link - not to sit invisible in the database. Conversely, if you're showing a value the user
   can't act on but should be able to (a status they can't change, a name they can't open), that
   dead-end is also a gap. Every meaningful datum the job touches gets a place to live and, if
   actionable, a control to act on it.

9. **Does another place need to SYNC?**
   The data you just wrote - does another surface read it and now go stale or wrong? Did you build a
   parallel mechanism that DUPLICATES an existing table/endpoint/concept? Search the data layer and
   code first. If you store a snapshot, will the source change later and leave it lying? If you hide
   something in one surface, does it leak into another?

10. **What about the empty / error / loading / edge states?**
   Empty states look intentional and consistent, not like a bug. A mode with no requirement shouldn't
   force one. A record with no data shouldn't show a broken auto-fill. Money fields need typed,
   constrained storage, not loose strings. Imported/placeholder junk must never render as if it were
   real user content - gate or clean it.

---

## REVIEW MODE - judging "is it done?" from the USER'S SEAT

Use this when you review your OWN work before declaring done, OR an agent's returned work. The failure
this prevents: grading the screen from the developer's chair ("the fields look right, gates are green
→ done") instead of from the user's seat ("can the user actually do their job here, fast, with correct
values, and get to the next step?").

**Do not review by reading the diff or the DONE writeup alone. Review by DOING THE JOB.**

1. **Re-run Step Zero against the shipped result.** Name the job; walk every step; confirm a real
   screen exists for each. Did this change actually complete the chain, or just polish one link?

2. **Open a REAL record with REAL data and do the task as the human.** Not the empty state, not a seed
   row - the busiest, messiest real record. Empty/happy-path data hides every mapping and edge bug.
   Read EVERY value on screen against the source of truth: right field, right column, right units,
   counts that reconcile.

3. **Walk the funnel forward.** After the user acts here, can they get to the next step in one obvious
   click with context carried (Q7)? Or did you leave them to navigate manually? If a daily job still
   takes 5 manual hops, it's not done - it works, but it isn't the product.

4. **Hunt the data-with-no-home + dead-affordance gaps (Q8).** Is there data the job needs that has no
   surface? Is there a control shown that does nothing, or a value the user should be able to act on
   but can't? List them as gaps even if everything "renders."

5. **Read every label as a confused first-time user.** Would a real user know what this word means?
   Flag invented jargon, internal/migration vocabulary leaking to users, inconsistent casing,
   placeholder junk. Where possible, take a live screenshot of each page and scan it specifically for
   vocabulary a user won't understand and anything that just looks unpolished.

6. **Check sync + duplication (Q9).** What else reads the data this changed? Did it create a parallel
   mechanism? Did a sibling surface go stale?

7. **Distinguish "their code is wrong" from "the data/another layer is wrong."** Before blaming the
   builder, eliminate: is it the data (import mismatch), an access/permission layer, a stale
   first-paint, a different layer? Reproduce on a clean load. Don't escalate a phantom; don't pass a
   real one.

8. **Gates are necessary, not sufficient.** Typecheck/build/lint clean are the floor. They say the
   code compiles - they say NOTHING about whether the user can do the job. A surface can pass every
   gate and still be the wrong surface, or miss the screen the user actually needed. Never report
   "gates green" as if it were "done."

---

## The discipline that makes this real (both modes)

- **Audit the existing system BEFORE designing.** Pull the live schema / data shape. Grep for existing
  tables/endpoints/components that already do this. Read the relevant project conventions. The #1
  source of rework is building something that already existed or that fans out to surfaces you didn't
  check.
- **Don't ask the user what you can answer yourself.** Common sense, the established industry standard,
  the conversation history, or the codebase usually answers it - decide, state it in one line,
  proceed. Reserve questions for genuinely undecidable PRODUCT calls.
- **Build complete, not MVP.** No "defer the polish to v2," no dead affordances, no silent gaps. If a
  change alters a number/badge/state, ship it fixed in the same pass.
- **Verify by doing the job, not by declaring it.** "I think it's done" is not done. "I walked the job
  on a real record, every value reconciles, the next step is one click away, no data is homeless, and
  a confused user would understand every label" is done.

---

## The self-test before you say "done" (or "it's perfect")

Ask yourself honestly, in this order:

1. **Did I name the job and confirm a real screen exists for every step of it?** (Step Zero. If you
   skipped this, you don't yet know if it's done; you only know the screens you happened to look at
   look okay.)
2. **Did I open a real, messy record and read every value against the source of truth?** (Correct +
   mapped.)
3. **Is the next step one obvious, context-carrying click from here?** (Time cut in half.)
4. **Does every datum the job touches have a home, and every shown control do something?**
5. **Would a demanding reviewer, looking at every field and walking the actual job, send it back?**

If you're not sure on any of these - the answer is probably "send it back." Spend that scrutiny
yourself now, on a real record, walking the real job - so the reviewer doesn't have to spend it for
you many times over, and so you never again call something "perfect" that has no door for the user to
walk through.

## How this applies regardless of feature

Feature-agnostic. Settings page, checkout flow, picker, dashboard widget, empty state, table column - same drill: Step Zero (does the job have its screens?), then every element through the BUILD-mode
questions, then REVIEW mode from the user's seat. The standard is the same everywhere: sleek, human,
consistent, every value correct, the next step linked, no homeless data, complete, gap-free - verified
by doing the job, not by declaring it done.
