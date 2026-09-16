---
name: review-build
description: The standard post-build review gate. Invoke this (via /review-build) at the END of building or changing anything, before calling the work done. It runs a thorough, no-gaps audit of what was built and everything it touches (frontend, backend, database, every path and scenario), proves any security-sensitive change is actually secure by attacking it, confirms UI is beautiful AND fully mobile-optimized, wires new functionality into error alerting the right way, keeps customer-facing docs current, and extends any operator-facing agent / template / public API the feature needs. Then it fixes every real issue found, thoroughly, re-verifying each one yourself. Use when the user says "review what you built", "is it done", "no gaps", "run review-build", or finishes a feature.
---

# Review Build: the definition-of-done gate

Run this at the END of a build, before you call the work done. The work is NOT done until this
passes.

> ⚠️ **Adapt to this repo.** Several sections below assume systems a mature product has (an error
> alert system, a help center, an operator-facing agent, a template/seed for new accounts, a public
> API, an email pipeline). A fresh repo may not have them. Where a section names one, treat it as
> "IF this repo has X, do this." If X does not exist, that section is a prompt to consider building
> it when the product needs it, then update this skill to name the real system. Never skip the
> section silently: state that it does not apply and why.

## Before you start reading

- Read the **`build-with-the-user-in-mind`** skill first. It sets how thorough this review has to
  be, from the user's seat.
- If any part of what you built touches UI or UX, read the **`ui-ux-pro-max`** skill.
- If any part touches auth, security, or the database, read the **`security-rls-permissions`**
  skill before the security step below.

---

## 1. The review: find every gap

Review everything you built, AND everything related to or affected by what you built, to make sure
there are no gaps. "No gaps" means 100% gap-free: logical, easy for the end user, and sound from the
backend. Trace it as "if this, then that": for every path and every scenario, what happens next,
technically.

- **Backend soundness.** No technical bugs or gaps server-side: the server, the code, the database,
  every trigger and function. Walk each branch. What happens on the empty case, the error case, the
  concurrent case, the malformed-input case, the second-time case?
- **UI and UX.** Investigate the design so it is the most beautiful, cleanest, and most
  ease-of-use-optimized version, not just the first thing that worked. (Use `ui-ux-pro-max`.)
- **Zoom out.** Look for anything that might be influenced, referenced, or affected by this change
  that should be looked at too. A change rarely stays in one file. What else reads this data, calls
  this function, renders this state, or depends on this shape?

**As you find issues, create a proper task for each one, while you find it.** Do a full audit first,
capturing everything, then go back through your tasks and fix each one perfectly and thoroughly. Do
not rush. Do it thoroughly.

> **Do NOT trust your sub-agents when they say there is a problem.** Re-verify by yourself that it is
> an actual problem, and that the fix you are about to apply is the actual correct and thorough
> solution. Think of it as your own system: how would YOU make it, design it, and build it?

---

## 2. Security: prove it, do not assume it

If you added or changed anything touching auth, tokens, RLS, SECURITY DEFINER functions,
public/anon endpoints, user input, or cross-tenant data, you must **prove it is secure by actually
attempting the attack** and confirming it fails. Do not assume.

- Read the **`security-rls-permissions`** skill first.
- Try the real attacks: wildcard input, a spoofed origin / spoofed ID, another tenant's ID, a
  missing or forged token, a request as the wrong role or the wrong location. Confirm each one is
  rejected.
- A SECURITY DEFINER function that takes a caller-supplied id MUST verify the caller owns that
  target in-body, or it is a cross-tenant IDOR. Test it with someone else's id and confirm it
  refuses.

State what you attacked and that it failed as intended.

---

## 3. Mobile: everything that touches UI must be 100% phone-optimized

If what you built touches UI, it must be fully optimized for a small phone screen, not only desktop.
Check it at a narrow width: nothing overflows or is cut off, tap targets are large enough (a
comfortable finger size, roughly 44-48px), text is readable without zooming, dialogs and tables and
forms reflow rather than break, and the primary action is reachable with a thumb. A feature that
works on desktop but is broken on a phone is not done.

---

## 4. Error alerting: notify on real failures, stay silent on by-design outcomes

If you added new functionality, make sure it is correctly wired into the error alert system so a
real failure notifies you with the exact problem. AND confirm it does NOT fire an alert for a
normal, by-design outcome (a customer being correctly stopped from doing something, a graceful
fallback, an expected empty result). Read the **`error-alert-system`** skill: alerting on non-events
is the number one recurring alert-system bug, and its Iron Law is to fix the CAUSE, not the symptom.

The decision of what to do with a failure follows section 8 below (resilience first, then the right
audience).

---

## 5. Keep customer-facing sources of truth current (immediately, as part of "done")

If this is **update-worthy** (a new feature, integration, capability, or significant UI/UX
improvement, NOT a plain bug fix, refactor, or internal tooling), keep the two customer-facing
sources of truth current before calling the work done. IF this repo has them:

1. **The changelog / "What's New".** Add one entry from the user's perspective, describing what they
   can now DO. Title uses a colon, never an em dash or en dash. (In a repo with an automated
   pipeline, this is a dated file in the changelog folder that flows to the What's New page and the
   monthly email. Name the real path once it exists here.)
2. **The docs / help center.** Update the matching article for anything a user sees or does (a page,
   field, setting, workflow, or a bug behavior they would notice), or create it if missing, so the
   docs never fall behind what you shipped. If this repo has a dedicated docs skill (e.g.
   `update-help-center`), read it first for structure, wording, and how to add screenshots. State
   which articles you updated or created, or why none was needed.

---

## 6. Operator-facing agent (if this repo has one)

If what you built is something an operator can DO or SET in the app, and this repo has a
natural-language operations agent that lets operators do things by chat, make sure that agent can do
it too, always under that user's real role, security, and location access.

- Read the repo's agent-extension skill first (e.g. `extend-operations-agent`) to see how the agent
  is structured.
- If it already covers the new action, confirm so. If it cannot, build the verb or read tool,
  mirroring how the feature actually works (write as the caller so the same security applies), not a
  blind write that bypasses the app's rules.
- If what you built is a pure bug fix, refactor, or internal tooling, do nothing here. State which.

---

## 7. New-account templates and the public API (if this repo has them)

- **Templates / seed for a fresh account.** If you added new functionality, a company that started
  from a template must be able to use it immediately with defaults. If it needs any data or
  configuration a brand-new account does not have, wire it into the template start (regenerate the
  seed, dry-run the setup routine). Read the repo's template skill (e.g. `setup-templates`) first.
  Exempt only if a built-in default already makes it work, or it is an optional setting that is fine
  left off. State what you wired, or which exemption applies.
- **Public / developer API.** If this repo exposes a public API, check whether what you built should
  be exposed through it. Read the repo's API skill (e.g. `public-api`) and, if so, wire it in per
  that skill's upkeep checklist so the API stays complete and consistent.

---

## 8. The resilience-first philosophy (how to handle any failure you find)

When you find something that fails, decide in this order. This is the most important judgment in the
whole review, and it is the same logic as the `error-alert-system` skill's bucket model.

**First: can you make the system so resilient it never fails here at all?**
If there is a way to fix the system so it handles this case (and every case like it) without
bothering the user OR us, that is the best outcome, always. A system built to handle everything is
the goal. Retry the transient thing, guard the null, make the write idempotent, design out the whole
class of failure. Prefer this over any notification.

**If it genuinely cannot be made not to fail, then ask: whose fault, and whose problem, is it?**
If nothing is actually broken (the system is working exactly as designed because that is the correct
and most robust way to work), and the reason it "failed" is that the CLIENT did something wrong, then
the feedback goes to the CUSTOMER, not to us. Do not alert engineering for a user error.

**If the customer needs to be told, decide HOW by timing:**
- **It happens WHILE they are doing something, right in front of the screen** (they clicked, the
  action could not apply): they do NOT need an email or anything heavy. Show a simple, clear pop-up
  or inline message saying what happened, that they need to try again, and exactly what to do. Plain
  language, in their words, with the recovery step. That is all.
- **It happens while they are away** (overnight, a background job, a disconnected integration) and
  they must be told because something will not work: send a short, nice email with quick
  instructions and a direct link to where they fix it. Optionally set a one-time banner for their
  next sign-in, that shows once and is gone after they dismiss it. If you send any email, read the
  repo's **`email`** skill first.

**Only alert US (engineering)** for a genuine failure that a human on our side should investigate or
fix. Never for a by-design outcome, a handled fallback, or a user error.

---

## The done-check (run before you say "done")

1. Did I audit everything I built AND everything it affects, and fix every gap thoroughly, verifying
   each fix myself rather than trusting a sub-agent?
2. For any security-sensitive change, did I attack it and confirm the attack fails?
3. If it touches UI, is it beautiful AND fully phone-optimized?
4. Is new functionality wired to alert on real failures and stay silent on by-design outcomes?
5. Did I keep the changelog and docs current (or state why not needed)?
6. Did I extend the operator agent / template / public API where applicable (or state the exemption)?
7. For every failure I found, did I choose the most resilient fix first, and route any remaining
   signal to the right audience (customer pop-up, customer email, or an engineering alert) the right
   way?

If any answer is "I think so", it is not done. Go verify it.
