---
name: review-build
description: The standard post-build review gate. Invoke this (via /review-build) after building or changing anything, to run a thorough, no-gaps audit of what was built and everything it touches, fix every real issue found, and then keep your customer-facing sources of truth (changelog, docs/help center) current. Run it at the END of a build, before calling the work done.
---

# Review Build

Run the full post-build review below. This is the "definition of done" gate: the work is not done until this passes.

---

## The review

Please review everything you built, or related to what you built, to make sure that there are no gaps. When I say no gaps, I mean 100% gap-free, logical, ease of use for the end user, making sense and even logical from the backend: if this then that, what will happen next on every path, every scenario, technically. Make sure there are no technical bugs or gaps server-side: from the server, from the code, from the database, from any triggers or functions. Make sure there are no errors or bugs.

Please also investigate the UI and UX design to make sure it's the most beautiful, best, and ease-of-use optimized.

Please also zoom out to see if there's anything that might be influenced or referenced or affected by this that should be looked at as well. If you find anything, create proper tasks while you find it, and when you're done with the full audit, go back through your tasks and fix each and every one perfectly and thoroughly. Don't rush, do it thoroughly.

One very important thing: don't trust your sub-agents when they say there is a problem. You need to re-verify by yourself to make sure it's an actual problem, and that the solution you're doing is the actual correct and thorough solution. Think of it like it's your own system: how would you make it, design it, and build it.

Before the review, start by reading the `build-with-the-user-in-mind` skill to guide you on how thorough the review should be.

And if you are reviewing UI or UX, please also read the `ui-ux-pro-max` skill.

---

## Error alerting (if applicable)

If you added new functionality, make sure it's correctly wired into the error alert system, so if there is any issue we get notified with the exact problem. AND confirm it does NOT fire alerts for normal, by-design outcomes (a customer being correctly stopped from doing something, a graceful fallback, an expected empty result). Read the `error-alert-system` skill: alerting on non-events is our #1 recurring alert-system bug.

---

## Keep your customer-facing sources of truth current (immediately, as part of "done")

> ⚠️ **Adapt to this repo.** The two sources of truth below (a user-facing changelog and a
> help center / docs site) are how a mature product keeps users informed. A fresh repo may not
> have them yet. If they don't exist, this section is a reminder to CREATE them when the product
> has users - and once they do exist, update this skill to name their real location and pipeline
> so the steps below become concrete. If they don't apply to this project at all (a library, an
> internal tool), skip this section.

If a changelog and/or docs pipeline exists, do BOTH before calling the work done:

1. **If this is update-worthy** (a new feature, integration, capability, or significant UI/UX
   improvement - NOT a plain bug fix, refactor, or internal tooling): add a changelog entry from
   the user's perspective describing what they can now DO. Use a colon in the title, never an em
   dash or en dash.

2. **Make sure the docs / help center are correctly updated** for anything a user sees or does (a
   page, field, setting, workflow, or a bug behavior they'd notice). Update the matching article,
   or create it if none exists. The docs must never fall behind what you shipped. State explicitly
   which articles you updated or created, or why no docs change was needed.
