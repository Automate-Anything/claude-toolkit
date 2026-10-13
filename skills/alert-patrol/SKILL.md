---
name: alert-patrol
description: The standing alert patrol - run one pass of (or set up the recurring) sweep that pulls the LIVE open engineering alerts, fixes the safe ones end to end, resolves everything already fixed or by-design, and escalates anything that needs the owner (database migrations, money, auth, anything complex) as a DURABLY carried-forward question, so the alert board only ever shows real, open work. Read it whenever the owner says "turn on the alert patrol", "alert watcher", "keep watching the alerts", "run the alert patrol", "start the daily alert check", "monitor prod alerts and fix them", or hands another agent the job of keeping the alert board clean. The standing schedule runs as a CLOUD CRON at fixed daily slots, NOT a session loop. Invoking it alone runs ONE immediate pass. This skill is only the patrol procedure: for how the alert system itself works (the tables, fetching, resolve vs silence, the triage buckets) read `error-alert-system` first.
---

# Alert patrol: the standing alert-board watcher

> ## Adapt before use
> This describes how the patrol SHOULD run, taken from a production system. It
> assumes an alert system shaped like the `error-alert-system` skill (groups,
> events, alerts) already exists in the repo. Table names, column names, the SQL
> runner and the pending-questions file path below are EXAMPLES of the shape.
> Grep the repo for the real ones and update this file once the patrol is live.

You are being asked to run (or keep running) the **alert patrol**: a recurring
sweep that keeps the production engineering-alert board clean and fixes what it
can, on a fixed schedule, without waking the owner for anything that is not
genuinely theirs to decide.

> ## REQUIRED FIRST STEP: read the `error-alert-system` skill
> Before you run a single pass, read `error-alert-system` in full. This skill
> deliberately does NOT re-teach how the alert system works. That one is the
> authority for: the three levels (the bug group, each hit, the ticket you
> resolve) and how they relate through the fingerprint and the alert key; how an
> error becomes an alert becomes a notification; severity, dedupe, silent and
> escalation policy; how to RESOLVE versus SILENCE correctly; and the golden
> triage rules (never resolve an alert whose condition is still live, by-design
> noise versus real bug, the four buckets including "the USER needed to know").
>
> If you patrol without that context you will misclassify alerts and resolve
> live problems. Read it first, every cold start.

---

## 0. The one-paragraph summary (if you read nothing else)

On a fixed daytime cadence (for example 7am, 10am, 1pm, 4pm, 7pm, 10pm
owner-local, plus one overnight sweep), wake up, pull the LIVE open engineering
alerts, and for each: if it is a real bug you can fix SAFELY on your own, fix it
completely and resolve it; if it is already fixed or by-design, resolve it; if it
needs the owner (a database migration, a money or auth change, or anything
genuinely complex or ambiguous), STOP on THAT item, ask the owner a clear
question in chat, and CARRY THE QUESTION FORWARD. Keep doing the other safe work,
and re-surface the unanswered question at the end of the pass and on the next
pass, until the owner answers. Never push a database migration or a
money-critical change to production unattended. The board should end each pass
showing ONLY real, still-open work, plus any alerts the owner explicitly told you
to leave.

---

## 1. How to start it: a CLOUD SCHEDULE, not a session loop

**Primary and recommended: a cloud schedule.** This patrol is a FIXED-CLOCK daily
cadence. A cloud scheduler (the `schedule` skill / a cron-style scheduled agent)
fires at those EXACT times, server-side, with zero interim wakeups, and it
survives the session closing. For "sweep the alert board a few times a day" that
is what the owner actually wants.

- Create one recurring cron per slot (or one cron with an hour list if the
  scheduler supports it), each with the prompt that runs this skill, and the
  cron expression for that slot in the OWNER'S timezone.
- Scheduler crons are interpreted in a fixed zone, usually UTC. Compute each slot
  as UTC from the owner's LIVE offset, or set them and verify the next-fire time
  reads back as the intended local time. Example for an owner at UTC-4:

  | Local slot | UTC hour | cron (UTC) |
  |---|---|---|
  | 7:00 AM  | 11 | `0 11 * * *` |
  | 10:00 AM | 14 | `0 14 * * *` |
  | 1:00 PM  | 17 | `0 17 * * *` |
  | 4:00 PM  | 20 | `0 20 * * *` |
  | 7:00 PM  | 23 | `0 23 * * *` |
  | 10:00 PM | 02 (next day) | `0 2 * * *` |
  | about 2:00 AM overnight | 06 | `0 6 * * *` |

  One-cron form: `0 11,14,17,20,23,2,6 * * *`.
- Each firing runs exactly one full pass (section 3) and ends. No self-sleeping,
  no interim ticks. **To STOP:** delete the cron(s).
- **DST caveat:** these are absolute UTC crons, so when the owner's local clock
  changes for daylight saving, every local slot shifts an hour. Re-derive and
  update the crons at a DST boundary, or accept the one-hour drift.

**Do NOT use a session `/loop` for this schedule.** A session loop's sleep is
clamped (about one hour maximum), so reaching a three-hour slot means waking
about hourly and going back to sleep. The owner sees a wake "every hour" that
looks broken. This actually annoyed the owner, which is why the patrol moved to a
cloud schedule. A session loop is fine ONLY for a short, frequent, session-bound
watch the owner is actively sitting with ("check every 15 minutes while I'm
here").

**Running ONE pass on demand:** the owner can invoke this skill any time for a
single immediate sweep, with no scheduling at all. That is section 3 run once,
then stop.

**Git authorization for scheduled passes.** The owner's standing rule is that an
agent never commits or pushes on its own initiative. A scheduled pass starts a
fresh conversation, so the authorization has to travel with it: when the owner
turns the patrol on, ask once whether passes may commit and push safe fixes to
the current feature branch, and put the answer INTO the schedule prompt the owner
approves (for example "run the alert patrol; committing and pushing safe fixes to
the feature branch is authorized"). If the prompt that woke you carries no such
authorization, write and verify the fix, leave it uncommitted, and say so in the
status line. Never the staging or production branch either way.

---

## 2. The schedule (owner-local time: DERIVE the timezone, do not hardcode)

Daytime every three hours, plus one quiet-hours sweep:

| Owner-local slot | What runs |
|---|---|
| 7:00 AM  | full pass |
| 10:00 AM | full pass |
| 1:00 PM  | full pass |
| 4:00 PM  | full pass |
| 7:00 PM  | full pass |
| 10:00 PM | full pass |
| about 2:00 AM | one quiet overnight sweep |

Derive the owner's timezone at setup time (`date '+%Z (%z)'` in a shell on the
owner's machine, or ask). Do not assume it is still what it was when someone last
wrote it down. The first pass starts at the NEXT upcoming slot unless the owner
asks for an immediate first sweep.

---

## 3. What a pass does (the procedure)

### 3a. Read the carried questions first
Open the pending-questions file (example: `docs/alert-patrol-pending.md`). A
scheduled pass has no memory of the previous one; that file IS the memory.

### 3b. Pull the live open alerts
Read-only. For the full fetch and triage playbook (pulling the backing group and
events, reading the payload and stack) use `error-alert-system`. The top-level
board pull has this shape:

```sql
SELECT id, title, severity, fire_count, last_fired_at::text AS last_fired,
       alert_key, payload->>'error_group_fingerprint' AS group_fp,
       payload->>'source' AS src
FROM public.engineering_alerts
WHERE status = 'open'
ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         last_fired_at DESC;
```

- **Pull ALL severities, including info.** The owner's standing rule.
- **Force UTF-8 on Windows.** Alert titles can contain non-ASCII characters that
  crash a cp1252 console print (set `PYTHONIOENCODING=utf-8`, or strip to ASCII).
  A crashed print looks like "no alerts" if you are not careful.

### 3c. Classify each alert
For each open alert decide which bucket it is in, and VERIFY, do not assume:

- **FIXED ALREADY / BY DESIGN:** resolve it, and its backing error group.
  Typical recurring cases: a fix you shipped is now DEPLOYED and the alert only
  fired from the pre-deploy build or from a sticky old tab still running a stale
  bundle or service worker (verify by the LAST-FIRED time against the deploy
  time, and by whether the underlying condition still reproduces); by-design
  telemetry (an observer reporting a valid outcome, a callee that was simply
  busy, a stale-screen "already linked" refusal, a customer shutting off their
  own channel). Never resolve without confirming the condition actually cleared.
- **SAFE TO FIX YOURSELF:** fix it end to end (3d).
- **NEEDS THE OWNER:** escalate and carry forward (3e).
- **LEAVE OPEN (owner's call):** skip. Some alerts are business signals the
  owner wants to keep looking at (example: a negative-margin cost alert).
  Respect any "leave this open" the owner has stated. Do not resolve those.

### 3d. Fix the safe ones, completely, with a normal session's rigor
"Safe" means a real bug whose root cause you can identify and whose fix does NOT
touch a migration, money or auth path and is not otherwise the owner's call. For
those, do the FULL loop:

1. **Root-cause it for real.** Pull the payload and stack, read the live code,
   verify against the live database. Never pattern-match a surface fix. Do not
   trust a sub-agent's finding; re-verify it yourself.
   **Fix the SOURCE, not the symptom:** ask "why is this wrong value or failure
   here at all?", not "how do I stop it showing?". A wrong value has ONE write
   site and MANY readers. Patching a reader (a report, a query, a badge, an
   exclusion filter, or just resolving the alert) never ends, so find where the
   bad value is BORN and fix it there. If this same alert key has been resolved
   before, that trail proves the last fix was a symptom patch: reconstruct the
   real cause and fix the origin instead of re-patching.
2. **Patch it as if it were your own system.** No MVP shortcut, reuse existing
   patterns, honor the repo's conventions and hooks.
3. **Verify like a deploy would.** Cold typecheck every compiled package you
   touched, run the repo's other gates, fix until clean.
4. **Commit and push only if this pass is authorized to** (section 1), and then
   ONLY your own files with exact pathspecs. Other agents work this tree in
   parallel: never sweep their in-flight files into your commit. Fetch the
   branch immediately before pushing. Current feature branch only.
5. **Resolve the alert immediately.** The owner's standing rule is do NOT wait
   for deploy: once the fix is written and verified, resolve the alert and its
   backing group. If it fires again later it re-opens, which IS the watch
   mechanism.

If a "safe" fix turns out mid-investigation to need a migration or a money or
auth change, it is no longer safe. Escalate it (3e) instead of pushing it
unattended.

### 3e. Escalate the owner's-call ones, and CARRY THE QUESTION FORWARD
Anything that requires the owner becomes a **pending question**:

- It **needs the owner** if it requires a **database migration**, touches
  **money, refunds, commissions or auth**, is a **DROP or other destructive
  database operation**, or is genuinely **complex or ambiguous** such that a
  wrong guess is costly. When in doubt, treat it as the owner's call.
- **Do NOT block the whole pass on it.** Ask the owner a single clear question
  in chat (the problem, the proposed fix, the blast radius, the exact decision
  you need), then KEEP GOING and finish the other safe work in this pass.
- **Carry it forward DURABLY.** The pending question must live somewhere
  persistent, not in session state:
  (a) leave the triggering alert OPEN. An open alert IS the durable "still needs
  the owner" marker.
  (b) record a one-line note in the pending-questions file (create it if
  missing): date, alert title, the exact question, proposed fix, blast radius.
  At the END of the pass, re-surface every still-open question in the status
  line. On the NEXT pass, read that file first, do the other safe fixes, then
  re-ask each unanswered question. Delete a question's line only once the owner
  has answered it. Never silently drop an owner question.
- **Never** run a migration, a DROP, or a money-critical production change on
  your own initiative in the patrol. That is the whole point of the
  escalate-and-wait rule.

### 3f. End of pass
- Resolve everything you fixed or confirmed fixed or by-design, so the board
  shows only real open work plus the explicitly left-open ones.
- Re-surface any unanswered owner question(s).
- Give the owner a tight status line: what fired, what you fixed, what you
  resolved, what is pending on them, and anything left uncommitted. The owner
  reads only the chat. Keep it scannable.
- A cloud-scheduled pass just ENDS here. The cron fires the next slot.

---

## 4. Hard rules (do not break these in the patrol)

1. **One pass = one firing.** Under the cloud schedule each cron fire runs
   exactly one pass and ends. Do NOT self-sleep, and do NOT turn a session loop
   into an all-day ticker.
2. **Never push a database migration, a DROP, or a money or auth critical change
   unattended.** Escalate and wait.
3. **Commit only your own files, and only when the pass is authorized to
   commit.** Leave other agents' uncommitted work alone. Fetch before every
   push. Feature branch only.
4. **Verify before resolving.** Never resolve an alert whose condition is still
   live. Confirm a shipped fix actually DEPLOYED (last-fired time against deploy
   time; does it still reproduce) before calling an old alert a straggler. Do
   not trust a sub-agent: re-verify yourself.
5. **Respect "leave open".** If unsure whether something is the owner's call or
   safe, treat it as the owner's call.
6. **Never silence or re-tier an alert on your own.** That needs the owner's
   explicit yes (see `error-alert-system`). Ask it as a carried question.
7. **Carry pending questions across passes** until answered. An unanswered owner
   question is never a reason to stall the safe work, and is never dropped.
8. **Cadence and timezone.** Daytime three-hourly plus one overnight sweep, in
   the owner's LOCAL time, derived live.

---

## 5. Quick reference: starting from a cold handoff

- **Standing patrol** = a CLOUD SCHEDULE (section 1). One recurring cron per
  daily slot, computed in UTC from the owner's live offset, with the git
  authorization written into the prompt. Turn it OFF by deleting the crons. No
  session loop.
- **One immediate sweep** = invoke this skill once (section 3, then stop).
- **Every pass** = read the pending-questions file, pull alerts, classify,
  fix-safe / resolve-fixed / escalate-durably, status line to the owner. The
  board ends every pass showing only genuinely open, real work plus the owner's
  explicit leave-open items.

## Related

- `error-alert-system` - the alert system itself. Read first.
- `systematic-debugging` - root-causing before patching.
- `money-truth-doctrine`, `security-rls-permissions` - the paths the patrol does
  NOT change solo.
