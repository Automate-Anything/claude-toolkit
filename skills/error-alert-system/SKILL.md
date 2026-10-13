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

> **How the owner thinks about an alert (the engine behind every rule below).**
> An alert is never "a row to clear." It is a signal, and the instinct is to ask where
> the signal was BORN and make the thing that produced it right, so it never has to
> fire again. Three principles drive this whole playbook (full set: the
> `how-the-founder-thinks` skill):
> - **Fix from the SOURCE, never the symptom.** Trace to the one write site; do not
>   patch readers. A recurrence is proof the last fix was a symptom patch.
> - **Design so the failure cannot happen, don't just handle it.** The best outcome is
>   not a quieter alert, it is a glitch that was engineered OUT (a retry, guard, or
>   null-check at the source, a state made impossible by construction) so nothing fires
>   in the first place. Prefer that over re-tiering every time it is possible.
> - **Refuse the false tradeoff, and route the signal to the RIGHT human.** Quieting
>   your own inbox is not a reason to leave a USER stranded (bucket D, section 1g). And
>   a graceful fallback is NOT proof the owner does not care: a handled processor / SMS
>   / phone disconnect can still mean a customer's business is about to stop. Silencing
>   is never your unilateral call; it needs the owner's explicit yes.

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
| **A. `report()` in application code** | any catch that would otherwise swallow a failure - frontend, every server, pipeline stages, integrations, routes, scripts. All of them post to ONE intake. |
| **B. A database-side logger** | a database function or trigger that catches its own exception and returns a graceful fallback. Application code never sees that failure, so the database has to report it itself (section 3). |
| **C. The rule engine** | a job that QUERIES state on a schedule and raises alerts for conditions nothing throws on: something that should have happened didn't, a rate crossed a line (section 4). |

A notification channel (email, Slack) sits on the way OUT: it tells a human when an
actionable alert fires (section 5). It is not a way in.

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
This is the short version. The full decision, which you walk for every alert, is 1h.
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

### 1h. The four triage questions (walk them for EVERY alert)

Resolving an alert instance is almost never the real job. The real job is deciding
what SHOULD be true about this alert going forward. An agent that only asks "is the
condition still true right now?" resolves a stale instance and leaves the same noisy
alert to fire again next week. Run these four in order. Each has a distinct action.

**Q1. What is the alert REALLY reporting? Never trust the title.**
The title is written by whatever code raised it, and it lies constantly. Alerts titled
"signature valid", "Repaired malformed ...", "submitted", or "fell back to owner" are
successes or benign self-heals reported through the error pipe. Before doing anything:
- Pull the backing events and read the **actual metadata** (outcome, raw vs normalized
  values, the source, which accounts). See what happened, not what the title says.
- Open the **source** that raised it and read WHY it reports at all. The code's own
  comments usually state the intent ("log-only observation phase", "tripwire for an
  upstream bug").
- Check the **resolved history for the same `alert_key`.** A long trail of the same
  alert opened and resolved over and over is a **treadmill**: proof the alert is
  mis-designed and someone keeps hand-clearing it. That is a fix-at-source case, not a
  resolve case.
- **Read the production logs yourself** before concluding anything from the alert text.
  The request that failed, its status code, and the surrounding log lines often reveal
  the real cause (a success status from the server means the failure was on the client;
  an empty error field from a provider can mean it actually succeeded). Do not ask the
  owner to paste logs. See `infrastructure-overview-template` for where a repo records
  how to pull them.

**Q2. Is it a real bug, a mis-scoped alert, or pure noise?** Three verdicts, three actions:

| Verdict | What it looks like | Action |
|---|---|---|
| **Real bug** (one occurrence at 3am would make you investigate) | a broken function, a failing send, a constraint hit, a spoofed webhook | Fix the root cause, verify, resolve. Keep the alert firing: it is doing its job. |
| **Mis-scoped alert** (fires on a benign case AND, sometimes, a real one) | the condition is too broad: it flags normal input as malformed, or logs a success | **NARROW the condition at the source** so it fires only on the bad case. Do NOT kill the whole alert: that throws away the real signal hiding inside it. |
| **Pure noise** (you would never investigate, at any volume) | success reported as error, expected skip, by-design refusal, idempotency hit | Remove the alerting at the source (stop the report call, or log a warning instead). Then resolve. Re-tiering to silent still needs the owner's yes (section 1f). |

These verdicts map onto the buckets in 1e: a mis-scoped alert and pure noise are both
bucket (B), and they differ in how much of the alert survives.

**Q3. Fix at the source WITHOUT losing the real signal or breaking production.**
The expensive mistakes happen here:
- **Verify the "benign" case is benign with LIVE DATA before narrowing.** Do not guess
  from the title. Real case: one alert fired both on an 11-digit phone number (a normal
  number with a country code, benign) and on a 20-digit one (two numbers concatenated,
  a real bug). Only after querying every occurrence was it safe to narrow the alert to
  the 20-digit case and keep that signal. Silencing the whole thing would have hidden
  the real one.
- **A narrowing fix must NEVER change the non-alert behavior.** If a trigger both
  repairs data and alerts, narrowing the ALERT must leave the repair identical. Diff
  the live function body and confirm the only change is the alert predicate.
- **Carve out a KNOWN-benign sub-case, not the whole alert.** If most failures of a
  check would be real but one specific path is benign for a reason you can name, keep
  the alert loud for everything else and special-case that one path, with a `TODO`
  naming the root cause still to fix.
- **Make the surviving alert ACTIONABLE.** If an alert fires rarely, give it enough
  metadata that the notification diagnoses itself (inputs, which checks were tried,
  ids) so the next agent can act without re-deriving it.

**Q4. Where does the fix live, and when does it take effect?** This changes what you
tell the owner:
- **A database fix** (trigger, function) is live the moment it is applied. The noise
  stops now. It is still an edit to existing database state: full live-schema
  discipline applies.
- **A code fix** only takes effect after it DEPLOYS. Until then the running server
  keeps raising it and the alert can reopen once more. Resolve it anyway the moment
  the fix is written and verified (section 1d), and say so plainly in the handoff:
  "resolved; it can reopen until the code deploys."

**The stale-versus-live check.** An alert is a point-in-time record, and even a
well-designed one may have healed itself. Check the thing it names, live:
- a missed-schedule alert: did that job run recently? Then it recovered.
- a latency alert: is the recent p95 for that route back under the threshold?
- a database-function error: does the function now pass the static check?
- "no active plan", "location missing", "credentials revoked": pull the named entity
  and see whether the condition still holds. It often clears on its own.

**The one sentence to remember:** an alert firing is either a bug to fix, a condition
to narrow, or noise to stop at the source. "Resolve the instance" is only the last
step of whichever of those you chose, never the whole answer.

### 1i. Self-solving alerts (the capture carries its own fix)

Some bugs CANNOT be fixed blind: the fix depends on data only the live occurrence
carries (the exact bytes a provider signed, the real payload shape, which of several
variants is the true one). Guessing a fix, or declaring it benign, both lose the
signal. The pattern that closes them is to make the alert solve itself over one more
occurrence.

1. **When you pick up ANY alert, FIRST look in its metadata for fields such as
   `self_solving`, `fix_instructions`, or `diagnosis`.** If present, a previous agent
   already investigated and left you a work order. Follow it and apply the fix the
   captured diagnosis points to. Do not re-investigate from scratch.
2. **When YOU hit an alert you cannot fix blind,** do not guess and do not silence it.
   **Enrich the capture at the source** so the next firing records exactly what is
   needed, and write plain-language `fix_instructions` into the alert metadata saying
   what was wrong and precisely what to set once the data is present. Leave the alert
   OPEN: it is unsolved. The capture change has to reach the running server before the
   next occurrence (that deploy is the owner's). The embedded data must be **safe to
   store**: record the discriminator (a variant NAME, a shape, an id), never a secret,
   a full signature, or a request body.
3. Each firing then either answers the question (the agent applies the named fix) or
   tells the next agent which further variant to capture. The alert converges on a fix
   instead of recurring as a manual investigation.

Worked example: a webhook signature check that sometimes mismatched. The capture was
changed so that, on a mismatch, it tries every credible way of reconstructing the
signed URL and records the NAME of the variant that matches, plus instructions for
setting the verifier to that variant and switching it from observing to enforcing.

### 1j. A human-facing number for every alert

Give every alert a short, stable, monotonic number (a database sequence column, oldest
alert is #1). Show it as the first column of the alerts page and the first line of the
copy-for-an-agent block. The owner then says "check alert #1439" and that is one
lookup. Prefer the number over a UUID or an `alert_key` whenever you talk to a human,
and echo it back when you report.

### 1k. Resolve and silence, mechanically

- **Fix, verify, resolve is ONE unit of work.** Shipping the fix and leaving the alert
  open is a real, repeated miss: the owner thinks it is still broken and the board
  fills with finished work.
- **Resolve the alert AND its backing group** so they stay in sync. The alerts UI
  should do both; if you write to the store directly, do both yourself.
- **Mind the status vocabulary.** If groups and alerts use different words for
  "muted" (for example `ignored` on one and `silenced` on the other), do not mix them.
  The sync between the two has to map one to the other.
- **Silence** is a status plus an "until" time that the rule job respects. It mutes
  for a window without closing. It needs the owner's yes (section 1f).
- **Bulk-resolving a category:** scope it tightly (by key pattern, title pattern, AND
  "last fired more than a day ago") so you never sweep up something still firing.
- **After resolve or silence, a new firing opens a NEW row.** That is by design: one
  open row per `alert_key`, enforced by a unique index on open rows only.

### 1l. When the investigation comes with a video or a voice note

If the owner forwards a customer's screen recording or a voice note about the failure,
process it with the **`media-review`** skill. It transcribes the audio and pulls only
the frames that differ, so you see the exact failing screen and the exact words. Pair
the frames and timestamps with the alert's metadata to reproduce it.

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
- **Severity is derived in a fixed order:** a silent policy gives info; a critical
  marker gives critical and OVERRIDES silent (you cannot ask for both "never page" and
  "must page", critical wins); an info marker gives info; everything else is warning.
- **Dedupe policies** the reporter should offer:
  - `background` (the default): one bucket per (type, message, job, route). The first
    fire notifies, repeats only bump the count, and it re-notifies on a cadence.
  - `user_action`: also bucketed by account and user, so two people hitting the same
    bug do not suppress each other.
  - `critical`: like background with a tighter cadence.
  - `silent`: an info ticket, no notification, visible in the UI, which auto-escalates
    to warning with a one-time notification when the count crosses its threshold. For
    "benign, but I want to watch the frequency."
- **What a report should carry** so the next agent can fix it without re-deriving it:
  a stable `type`, a greppable `source` (`module.function`), the route or job name, and
  the account and user ids.
- **Client-side filtering.** The frontend reporter drops known-benign noise before it
  is sent (auth rejections, aborted requests, network blips, browser-extension errors,
  stale-bundle chunk errors) unless a call forces it through. It also dedupes locally
  for a few minutes and batches, so one broken screen is one report with a count.
- **One intake.** The frontend and every secondary server post to a single
  rate-limited intake endpoint that returns immediately. Dedupe policy and escalation
  threshold travel in the payload, so the rule is learned once and behaves the same on
  every surface.

## 3. THE DATABASE CAPTURE PATH

Application-side reporting cannot see a failure that happens entirely inside the
database: a function or trigger that catches its own exception and returns a graceful
fallback. The user sees a broken page and the application never knew. A real case took
down one core read for every account, silently, because the function swallowed its own
error.

Build a database-side logger and call it from INSIDE the exception handler:

```sql
EXCEPTION WHEN OTHERS THEN
  PERFORM log_db_error('my_function', SQLERRM, SQLSTATE,
    jsonb_build_object('returns_graceful_fallback', true));
  RETURN json_build_object('error', 'internal_error');
END;
```

- It fingerprints on (source function, error code) and writes into the same groups and
  events as everything else, with a title an agent can act on:
  `DB error in <source> [<code>]: <message>`.
- It is **exception-safe**: its own failure can never propagate back to the caller.
- It is privileged and callable by the service role only.
- A rule (section 4) turns those groups into alerts.
- **The proactive sibling: a static check.** In Postgres, a function body that selects
  a column that does not exist is accepted when the function is created and fails only
  when a user trips it. A static checker (the `plpgsql_check` extension) catches that
  before runtime. Run it in three layers: in the local typecheck whenever a migration
  changed, in a pre-commit hook, and as a nightly sweep that reports through the same
  database logger. Tag sweep findings in the metadata (for example
  `origin = static_sweep`) because they fingerprint the same as a real runtime hit and
  you need to tell them apart.

## 4. ABSENCE ALERTS (the rule engine)
Some failures have no exception to catch - something that should have happened
didn't (a job opened and never finished, a queue stopped draining). Observe the
condition from a **write path or an always-running loop** (not a naive timer),
and:
- keep ONE open ticket while the condition holds (refresh it, don't inflate count);
- **auto-resolve** when a later check finds the condition GONE;
- for a rate-based rule, require a minimum sample and do **not** clear on a merely
  quiet window (quiet ≠ fixed).

**Two kinds of rule. The difference decides who closes the alert:**
- **Stateful** rules fire continuously while a condition holds and **auto-resolve**
  when the rule runs again and the condition is gone. Use them for ongoing states: a
  job failing repeatedly, a job that missed its schedule, a provider's webhook failure
  rate, a slow endpoint.
- **Event** rules fire on a one-time signal that needs a human to acknowledge it, and
  stay open until someone resolves them: a subscription ended, a database error.

**What bites in the rule job:**
- **Auto-resolve only happens when the rule RUNS AGAIN and finds nothing.** If the job
  itself was down during the recovery, the alerts sit open for days after the thing
  healed. Resolve those by hand after checking, and treat "the rule job stopped" as
  its own alert.
- **Skip when nothing changed.** A stateful rule evaluates every minute. Bump the fire
  count only when there is NEW activity behind it, or the count spins into the
  thousands and stops meaning anything.
- **Sticky resolve.** A resolved alert reopens only on new activity, never on a repeat
  of the same stale evidence.
- **Daily and weekly jobs need their own allowed-lateness entry,** or the
  missed-schedule rule fires falsely on every job that is not supposed to run each
  minute.
- **Release stale claims** at the start of each run (see section 6).
- **Namespace the key:** `<rule>` or `<rule>:<entity>`, so one open row exists per
  rule per thing.
- Adding a rule should be one entry in one list. If it takes more, the engine is
  wrong.

## 5. NOTIFICATION CHANNEL
Gate notifications so they're useful, not spam: info never notifies; warning/
critical notify on first fire; repeats re-notify only on a cadence (e.g. 24h); a
just-escalated ticket notifies once even inside the window. Make it
**production-gated** (a dev machine shouldn't page anyone) and **skip silently**
if channel credentials are unset - the data still records; notification is
additive. The message carries **identifiers only** + a deep link, never sensitive
content.

Customer-follow-up alerts (an account that needs someone to reach out) belong in the
same inbox under their own category, shown in the UI and NOT emailed to engineering.

**"I got the email but the alerts page is empty."** The email is a snapshot of when
the alert was OPEN. If an agent has since fixed the cause and resolved it, it drops out
of the default open view. It is not missing: switch the filter to resolved or all. The
email always means "this was true at that time", not "this is true now".

## 6. THE WORKFLOW SURFACE (claim, resolve, silence, copy for an agent)

Give the inbox a small internal page and API:

- **List** with filters: status (open by default), whether to include info, and a
  category (engineering versus customer follow-up).
- **Claim ("Work on this").** Marks who is on it, with an expiry (a day). A second
  person gets a conflict while the claim is live. The rule job releases expired claims.
  Only the holder can release early. Resolving or silencing clears the claim.
- **Resolve / silence / reopen,** with an optional resolution note, mirrored onto the
  backing group (section 1k).
- **"Copy for AI".** One button that puts the alert number, title, and payload (source,
  error code, stack, ids) into a block the owner can paste to an agent. Its first line
  is the alert number, so the pasted block and the number he says always match.
- The tables behind it are reachable by the service role only. The browser never reads
  them directly.

---

## 7. GOTCHAS
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
- **Never trust the title** (section 1h). Read the events and the source.
- **"Environment: production" does not mean the production server.** Staging services
  and test clones often run in production mode too and share one database. Put the
  service name, the git branch, and the release id on every server alert, show them in
  the email and in the copy block, and read those FIRST to see which server raised it.
  A real "outage" turned out to be a test clone missing one environment variable.
- **Gate on the real environment** (the hostname, or the server's environment setting),
  not on a build mode flag. Development and staging should persist events for
  debugging but never notify.
- **A database-error rule that hardcodes one severity** will show a fatal failure as a
  warning. Know that when you read it, or carry the severity through.
- **A recurring family of alerts usually has one cause.** When the same few titles keep
  returning (a billing mismatch, an orphaned record), do not resolve them one by one.
  Find the zombie at the source and retire it. For subscriptions the database calls
  dead but the processor still bills, see `saas-subscription-billing`.
- **Do not invent a new send or log helper.** Failures go through the reporter or the
  database logger; new conditions go in as a rule.

---

## 8. WHEN THE SYSTEM EXISTS IN THIS REPO

Replace this section with the real map, and keep it current:

| Concern | Where it lives here |
|---|---|
| Reporter (server) | TODO |
| Reporter (frontend) | TODO |
| Intake endpoint | TODO |
| Error to alert | TODO |
| Rule list and rule job | TODO |
| Notifier | TODO |
| Database logger | TODO |
| Alerts API and page | TODO |
| Tables | TODO |

Also record the query that fetches open alerts, the query that fetches one by its
number, and how to pull production logs. See `alert-patrol` for working the queue on a
schedule.
