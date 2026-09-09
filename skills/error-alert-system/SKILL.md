---
name: error-alert-system
description: A reusable DESIGN PATTERN for capturing, deduping, surfacing, and resolving errors so failures never go unseen - plus the operating rules for triaging alerts once such a system exists. Its Iron Law: always fix the CAUSE and the SOURCE of a problem, never the symptom (trace back to the origin; suppressing an alert without ending its cause is not a fix). This is a pattern to IMPLEMENT per repository, NOT a system that already exists; before referencing any file/table/function named here, VERIFY it exists in the current repo (grep first). Read it before wiring error reporting into a new code path, before adding a catch that swallows a failure and returns a fallback, before adding an alert/rule, before investigating a failure, and before resolving or silencing an alert. Use when the user mentions errors, alerts, error tracking, reportError, report(), fingerprint, dedupe, severity, silent/escalating alerts, "why did this fail," "it failed silently," "I didn't know it broke," or a job/call that died.
---

# Error & Alert System (design pattern)

> ## STATUS: THIS IS A PATTERN, NOT INSTALLED CODE
> Nothing here exists in a repo until you build it. The file/table/function names
> below (`report()`, `error_groups`, `src/lib/errors`, migrations, `check:errors`)
> are from a reference implementation - **grep the current repo before citing any
> of them.** When this doc and real code disagree, **the code wins.** Adapt the
> pattern to the repo's actual stack (Python/TS/etc.) and storage (Postgres,
> SQLite, a table, even a log sink) - the *shape* is what's reusable, not the names.

---

## 0. The mental model: capture everywhere, one inbox

The problem this solves: **a failure nobody sees.** A background job dies at 2pm,
a parse silently returns nothing, an incoming message is never processed, a write
fails and the result vanishes. The app keeps running. Nothing tells you. You find
out when someone asks why the thing never happened.

Everything funnels into ONE place - an **Errors** store (and ideally a small UI
over it). Three doors in:

| Entry point | Who triggers it |
|---|---|
| **A. `report()` in catch blocks** | any catch that would otherwise swallow a failure - pipeline stages, integrations, routes, scripts |
| **B. Rule / absence checks** | write-path or loop checks that alert on failures of *absence* (something that should have happened didn't) |
| **C. Notification channel** | email/Slack/etc. when an actionable alert fires |

The load-bearing idea is a **three-level split** (names are illustrative):

| Level | What it is | Why |
|---|---|---|
| **groups** | one row per **distinct** error, deduped by a `fingerprint`. The "bug." | a bug that fires 4,000× must be ONE line with count 4,000, not 4,000 rows burying every other bug |
| **events** | one row per **occurrence** (FK → group). The "hits." | preserves detail (stack, context) without flattening the inbox |
| **alerts** | one row per **actionable incident**, deduped by an `alert_key`. The "ticket." | this is what a human triages; `fire_count` tells "annoying" from "on fire" |

**Two properties to carry if the domain needs them:**
- **Scope / access control.** If data is multi-tenant or role-scoped, put the
  scope keys (account/tenant/facility) on every row and enforce read access. An
  errors page that ignores scope becomes a data-leak path.
- **Identifiers, not payloads.** `context`/`payload` hold IDs (job id, record id,
  request id) and **never** sensitive content (names, health/financial data, raw
  message text). An error carrying sensitive data turns the Errors view into an
  unintended content-access path - this is a hard rule wherever such data exists.

---

## 1. THE PRACTICAL PLAYBOOK

> ## THE IRON LAW: FIX THE CAUSE, NOT THE SYMPTOM
> For EVERY alert, and every failure this system surfaces, always focus on the CAUSE and the
> SOURCE of the problem, never the symptom. The alert, the error message, the broken screen, the
> failed job: those are symptoms. Your job is to trace back to what actually went wrong and fix it
> THERE.
>
> - **Trace to the source before you touch anything.** Where did the bad value / failure ORIGINATE?
>   What called this with bad input? Keep tracing backward up the chain until you reach the true
>   origin. Fix it at the origin, not where it happened to surface.
> - **A fix that makes the alert stop but leaves the cause in place is not a fix.** Suppressing the
>   symptom (a try/catch that swallows it, a re-tier to info, a resolve without a real change,
>   special-casing the one input that tripped it) hides the problem instead of ending it. It will
>   come back, usually somewhere harder to see.
> - **When you find one instance, ask what CLASS it belongs to and close the class.** One
>   null-check patched where it crashed is a symptom fix; finding why the value was ever null and
>   making it impossible is a source fix. Prefer the source fix every time.
> - **The self-test:** "Have I fixed the actual cause, or have I just made this symptom stop
>   showing up?" If it is the second, you are not done. This is the difference between the problem
>   being GONE and the problem being HIDDEN.
>
> Everything below (triage buckets, silence rules, resolve rules) sits UNDER this law: it tells you
> WHICH cause you are dealing with and what to do about it, but the target is always the cause.

### 1a. Wire a new catch block (the common case)
Every catch that would swallow a failure and return a fallback must surface it
first. Shape (adapt to the repo's language/API):

```
try {
  doTheThing()
} catch (err) {
  report(err, {
    type: "domain.operation",        // a stable category; a severity suffix can set tier
    source: "module.function",        // greppable <module>.<function>
    metadata: { jobId, recordId },    // IDENTIFIERS ONLY - never sensitive content
    scope: tenantOrNull,
  })
  // ...then your fallback / rethrow
}
```

The reporter should be **server-side**, and it must **never throw** - on its own
failure it logs and returns null, so reporting an error never causes one.

### 1b. Enforce it
Add a check (script or lint) that walks every catch and flags ones that neither
rethrow nor surface the failure. A catch is fine if it rethrows, reports, logs,
shows the error to the user, returns an error result, or is explicitly marked
with a **written reason**. Some swallows are correct (a best-effort diagnostic
read) - those get the written reason, not a silent pass.

### 1c. Triage an alert: is the condition still true RIGHT NOW?
An alert is a point-in-time record; it doesn't update its own title.
- **High `fire_count`** → the one to actually fix (it's in a loop).
- **A one-off transient** (an upstream hiccup, a rotated token) → check it still
  reproduces before acting.
- **By-design noise** → don't resolve it repeatedly; **fix the capture** (re-tier
  to info) so it stops alerting. An inbox full of noise is an inbox nobody reads.

### 1d. The rule that never bends
> **NEVER resolve an alert without verifying the condition actually cleared.**
Resolving hides it. Resolve a still-broken thing and you go blind to it - which
defeats the entire point. Re-run what failed, confirm it's healthy, THEN resolve.
When unsure, leave it open and say so.

> **BUT: "the condition cleared" for a CODE fix means the fix is WRITTEN and
> verified correct - NOT that it has been committed, merged, or deployed.**
> Resolve the alert the MOMENT the code change that fixes it is in place, even
> before committing, and WITHOUT asking. Committing/deploying is the OWNER's job,
> not yours - so an alert must never sit open waiting for a commit, a merge, a
> deploy, or the owner's go-ahead. The recurring, costly mistake this fixes:
> agents write the fix, then leave the alert open "until it's committed," which
> clogs the board with already-fixed work and forces the owner to re-triage
> things that are done. The sequence is: (1) verify the root cause, (2) write the
> fix and verify it's correct (typecheck-clean, logic confirmed against the live
> system), (3) **resolve immediately** - then, separately and independently, the
> owner handles commit/deploy on their own clock. Do not conflate the two.
>
> This does NOT loosen the never-resolve-a-still-broken-thing rule: a fix you
> have NOT written yet, or cannot verify is correct, is not "in place" - leave
> those open. The only thing being decoupled is *shipping* (owner's job) from
> *resolving* (do it the moment the code is fixed).
>
> The two things that DO still need the owner, and are the ONLY exceptions:
> silencing/re-tiering a benign alert (explicit permission, §1f) and the
> commit/deploy itself. Neither is ever a reason to hold a resolved-worthy alert
> open.

### 1e. Classify an alert into one of FOUR buckets
| Bucket | Meaning | Action |
|---|---|---|
| **(A) Real bug** | code does the wrong thing (crash, lost work, wrong result, leaked data) | fix the code, then resolve |
| **(B) Alert-system bug** | code behaved correctly (graceful fallback, normal outcome, transient blip) but alerted as a fault, and there is nothing ANY human should do | fix the **capture** (re-tier to info + escalate-after-N), then resolve. **Most common.** |
| **(C) Already handled / not ours** | condition already cleared, or fixed in a build that is written but not yet committed/deployed | verify it's clear (or that the written fix is correct), then resolve NOW - an un-deployed-but-written fix still resolves; do not wait for the deploy (§1d) |
| **(D) Wrong audience: the USER needed to know, not engineering** | code hit a real, legitimate condition (a concurrent-use race, a rejected action, a state that changed under the user) that engineering can't and shouldn't act on, but the END USER was left with no feedback, a scary/wrong message, or stranded | **move the signal, don't just delete it**: give the USER a clear, plain-language message + a way to recover, AND stop the engineering alert. Then resolve. See §1g. |

> Ask: *"if this happens again tomorrow, is there anything a human should DO, and WHICH human?"*
> - Nobody, ever: **(B)**, fix the capture (don't mass-resolve).
> - An engineer (fix code / call a customer / investigate): **(A)** or keep notifying.
> - **The user themselves** (they need to understand what happened and get unstuck): **(D)**. This is the case agents keep misfiling as (B) and silencing, which leaves the user stranded. Do §1g instead.

### 1f. Before you make an alert notify LESS: two questions, then the owner's yes
When an alert looks like "nothing to do" noise, the tempting move is to silence
it (re-tier to info, add/raise `escalateAfter`, mute). Work these two questions
IN ORDER first - they are the logic that lets you answer "should this be silenced?"
on your own without guessing.

**Question 1 - Can we make the glitch not happen at all?**
If the alert fired because something *flaked* - a transient network blip, a
cold-start, a race, an unhandled edge - the correct fix is to make it not flake,
not to mute the symptom. Add the retry / timeout / guard / null-check that removes
the glitch. A blip that self-heals on a retry should be *retried*, so the alert
never fires in the first place. Silencing a fixable glitch throws away the signal
AND leaves the glitch. Only if the condition is genuinely unpreventable (a real
upstream outage you cannot control) do you move to Question 2.

**Question 2 - Is there ANY reason the owner would still want to know?**
A graceful fallback is NOT proof the owner doesn't care. Think hard - double and
triple - about whether a human would still want this alert:
- **Does the condition mean a customer's business may be about to STOP?** A payment
  **processor disconnected**, **SMS/WhatsApp disconnected**, a phone/voice number
  released, email sending broke. The code may "handle" it, and we may have already
  told the customer - but the customer might not understand, might not act, and
  their whole operation could halt. The owner may want to reach out personally.
  → KEEP notifying. This is exactly what the alert is for.
- **Could this point at a fix that makes the bad thing never happen again?**
  → surface it, don't silence it.
- **Did the customer misunderstand something?** → the fix is a product/UX change,
  not muting the signal.

**Only when BOTH are cleared** - the glitch is genuinely unpreventable AND there is
truly nothing a human should ever do about it - is silencing the right answer. And
even then:

> **Silencing is never the agent's call to make alone.** Making an alert notify
> less permanently removes the owner's visibility. ASK the owner for explicit
> permission and wait for a clear yes before you re-tier / raise `escalateAfter` /
> mute. Present what fired, why it's handled, why you believe there's nothing to
> do, and let them decide.

Litmus test you should be able to answer yourself: *"If this fired again tomorrow,
is there anything anyone would DO - fix code, call a customer, investigate?"* If
yes to fixing code → do Question 1. If yes to a human action → keep notifying
(Question 2). Only a clean "no, to everything" earns a silence request.

### 1g. Bucket (D): route the signal to the USER, don't silence it

This is the trap agents fall into most, and the one that produces a *worse*
product than doing nothing: an alert fires for a real, legitimate condition the
code handled correctly, an agent decides "the code is fine, nothing for
engineering to do," re-tiers it to info (bucket B), and never notices that **the
user on the other end of that condition was left stranded, confused, or shown a
scary error for something that wasn't their fault and wasn't a bug.**

Silencing solves the agent's inbox. It does nothing for the user. That is
half-fixing the symptom (patching the *engineering* reader) while ignoring the
*user*, who is the reader that actually mattered. Bucket (D) is: **the code was
right, engineering has nothing to do, but the USER needs feedback and a way
forward.** The fix is to *move the signal to the right audience*, not delete it.

**How to recognize (D).** The condition is real and legitimate, not a code fault:
- a **concurrent-use race**: two tabs / two registers / two staff act on the same
  record; one action wins and the other is now operating on a stale/dead object
  (the checkout that voided a saved order out from under a line-removal, alert
  #1740);
- an **action the system correctly rejected**: a state changed under the user
  (item already sold, order already paid, slot already booked, token expired
  mid-flow) and their next action legitimately can't apply;
- an **optimistic-UI divergence**: the client believed a thing that the server,
  correctly, refused.
The tell: engineering would look at it and say "working as intended," yet a real
person hit a wall and got silence, a raw error code, or a red "failed" toast for a
non-failure.

**What to build instead (walk it from the user's seat: load
`build-with-the-user-in-mind` and do this, don't hand it back to the user):**
1. **Verify the ground truth** so you show the RIGHT message. Read the live state
   (what status is that order in *now*?). Distinguish "already completed
   elsewhere" from "you don't have permission" from "it expired": each deserves
   different words.
2. **Tell the user in plain language**, in their vocabulary, what happened and
   why. Never the raw error code, never a scary generic "failed" when nothing
   failed. ("This sale was already finished on another register.")
3. **Get them un-stuck.** Don't just inform and strand them on a dead object:
   reset / reload / re-fetch so their next action lands on live state. Reassure
   them nothing was lost and where the result now lives ("the completed order is
   in Sales History").
4. **Only alert engineering for the genuinely-unexpected remainder.** Split the
   handler: the known, legitimate condition (this race) informs the user and does
   NOT `report()`; anything you *didn't* anticipate still surfaces the old way
   (keep the state, real error message, engineering alert) so a true bug can't
   hide behind the friendly path.
5. **Confirm the source is already race-safe.** A (D) race usually means a
   *writer* the user is contending with. Check that writer is idempotent /
   guarded (e.g. a `status <> 'void'` guard, a carry-forward that prevents
   double-charge) so the losing side degrades cleanly. If it isn't, that part IS a
   real bug (bucket A): fix it. If it already is, you only need to fix the reader
   that surfaced the ghost.

**Do NOT over-correct into a lock.** The instinct to "prevent this from ever
happening" by locking the record to one user is usually the wrong product call:
it breaks legitimate handoffs (a manager finishing a sale the front desk
started). The right POS/multi-user shape is: allow concurrent access, make writes
idempotent, and give clear feedback + recovery when a race resolves. That is what
Square/Boulevard/etc. do. Prefer feedback over prevention unless the owner asks
for a lock.

Bucket (D) needs **no owner permission**: you are not silencing the owner's
visibility, you are giving the user a better experience AND removing engineering
noise that was never actionable. Just verify the condition cleared and resolve,
noting that the fix routed the signal to the user.

---

## 2. SEVERITY, DEDUPE & FINGERPRINTING

- **Severity tiers**, e.g. info / warning / critical. Info is recorded but does
  NOT notify. Warning/critical notify. A critical marker always wins.
- **Fingerprint = the heart of dedupe.** Normalize the message (replace uuids,
  timestamps, URLs, file paths, long hex, standalone numbers with placeholders),
  then hash to a short stable key. **A bad fingerprint destroys the system:** too
  specific → every occurrence is a new "bug" (flat log); too loose → unrelated
  bugs merge. Always check grouping on **real data**.
- **Escalation:** a silent/info ticket that crosses a repeat threshold (e.g. 100
  fires) should promote to a higher tier so a persistent "minor" issue surfaces.

## 3. ABSENCE ALERTS (the rule engine)
Some failures have no exception to catch - something that should have happened
didn't (a job opened and never finished, a queue stopped draining). Observe the
condition from a **write path or an always-running loop** (not a naive timer),
and:
- keep ONE open ticket while the condition holds (refresh it, don't inflate count);
- **auto-resolve** when a later check finds the condition GONE;
- for a rate-based rule, require a minimum sample and do **not** clear on a merely
  quiet window (quiet ≠ fixed).

## 4. NOTIFICATION CHANNEL
Gate notifications so they're useful, not spam: info never notifies; warning/
critical notify on first fire; repeats re-notify only on a cadence (e.g. 24h); a
just-escalated ticket notifies once even inside the window. Make it
**production-gated** (a dev machine shouldn't page anyone) and **skip silently**
if channel credentials are unset - the data still records; notification is
additive. The message carries **identifiers only** + a deep link, never sensitive
content.

---

## 5. GOTCHAS
- **Never resolve without verifying** (§1d). The unbendable rule.
- **Resolve the instant the code fix is written - do NOT wait for commit/deploy,
  do NOT ask** (§1d). Committing/shipping is the owner's job; holding an alert
  open for it is the single most common mistake here and it clogs the board with
  already-fixed work. Fix written + verified correct = resolve now.
- **Never silence/re-tier an alert without the owner's explicit permission** (§1f).
  Think hard first about whether they'd still want it (a handled processor/SMS
  disconnect can still mean a customer's business is stopping). Silence is the
  last resort, never the agent's unilateral call.
- **Never log sensitive payloads** - identifiers only, wherever regulated/private
  data exists.
- **The reporter must never throw.** Guard it.
- **Noise kills these systems.** Fix the capture (re-tier), don't mass-resolve.
- **"Not engineering's problem" ≠ "silence it."** When a real, handled condition
  alerted but the *user* was the one left stranded/confused (a concurrent-use race,
  a legitimately-rejected action), that's bucket **(D)** (§1g): give the user a
  plain-language message + recovery and stop only the engineering alert. Do NOT
  just re-tier to info and walk away, which leaves the user stuck.
- **Bad fingerprint = broken system.** Verify grouping on real data.
- **Don't invent a second capture path.** One funnel; two ways to record an error
  and the Errors view stops being the one place to look.
- **Verify names before citing them.** This is a pattern; grep the repo for what
  actually exists before pointing the user at a file or table.
