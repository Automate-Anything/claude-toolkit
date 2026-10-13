---
name: multi-agent-assistant-architecture
description: The standing architecture for an AI personal assistant (or any always-on assistant a person messages over chat, SMS or WhatsApp) built as a manager, standing specialist sub-agents, a responder, and a watchdog. Covers the hard rules (the manager never executes, sub-agents report only to the manager, everything a person reads goes through the responder, nothing falls out, nothing the assistant starts on its own bypasses the queue, prove behavior not presence), the three-layer memory model with a memory-keeper and tiered hard rules, skills loaded on demand (shipped skills and the person's own stated or learned procedures), open items vs the task list, model slots, the acknowledgment rhythm, and the proactive engine (one queue, a day-time agent, a summary agent, host-only delivery, inboxes, reminders, off-days, template tiers). This is a pattern to BUILD per repository. Read it BEFORE designing an assistant with more than one agent, and before changing anything in the turn, channel-host, memory or decisions layers, or adding any agent, tool, prompt, message path, background job or proactive source. Use when the user mentions a manager agent, sub-agents, specialists, a responder, a watchdog, agent memory, long-term memory, "the assistant forgot", open items, reminders, proactive messages, a daily summary, quiet hours, "it messaged me at the wrong time", or "it dropped what I asked".
---

# Multi-Agent Assistant Architecture: the standing law

> ## ADAPT BEFORE USE: THIS IS A PATTERN, NOT INSTALLED CODE
> This describes how an assistant's brain SHOULD be built. It is taken from a production
> personal-assistant product and stripped of that product's names. Nothing here exists in
> your repo until you build it. Table names, constants and tool names below are EXAMPLES of
> the shape. Grep the repo before citing any of them; when this doc and the code disagree,
> the code wins. Once built, update this skill with the real file and table names, link the
> design documents that hold the reasoning, and keep a short list of where the code
> currently DIFFERS from this law (an honest drift list is worth more than a clean doc).

This is for the people and agents BUILDING the assistant, not for the product. It is the
one place that says how the brain is built, so anyone who changes anything builds WITHIN
the architecture and never shakes it up. If a change would break one of the rules below,
it is the wrong change: stop and reconcile with the design, or raise it with the owner,
before building.

Keep the depth in design documents and let this skill be the map plus the hard rules. The
documents worth having: the master build doc the owner reviews item by item, an
architecture brief, an open-items design, a method doc ("prove every item by real
behavior, never by the code existing"), a proactive-side build doc with a tracking ledger
(statuses only), and a worklog of judgment calls.

Companion skills: `inject-tool-knowledge-on-use` (where a tool's how-to belongs),
`ai-model-platform` (slots, keys, telemetry), `internal-ai-agent-architecture` (the
in-app write-agent shape: propose/confirm, write as the caller).

---

## 1. The shape: three agents and a loop

1. **The manager is the brain.** It sees every inbound message first. It only thinks,
   decides and hires. It NEVER runs a tool itself. It runs on the flagship model. It holds
   a lot of memory (the person, their history, what is open) instead of carrying tools.
2. **The sub-agents are the hands, and they are STANDING SPECIALISTS, not throwaways.**
   Each owns a domain (email, CRM, browser and so on) and PERSISTS: spun up on first use,
   kept warm while the domain is active, holding its own memory of what it has done and
   the method (skill) it read, on a thread of its own per (person, domain). It does not
   hold the whole conversation, only the slice the manager hands it plus its domain
   memory. It reports back ONLY to the manager, never to the person. Several run in
   parallel when several things are asked. World-touching specialists (browser, CRM,
   money) run on the flagship. **Do NOT build a sub-agent that is born and killed per
   task**; hire the standing specialist through one delegate call with its domain.
3. **The responder is the mouth.** The only thing the person ever reads. It does not
   think; it rewrites the manager's decision into the shortest human message. The person
   never sees the manager's or a sub-agent's raw words.
4. **The watchdog is the safety loop.** Software plus a small yes/no judge, on a beat. It
   guarantees nothing the person asked for is ever silently dropped: a stopped or crashed
   sub-agent, or a stopped manager with nothing running, is caught and the manager is
   restarted.

---

## 2. The hard rules (do not break these)

- **The manager never executes.** It routes and hires. Do not give the manager execution
  tools. If a turn needs a tool run, a sub-agent runs it. (Known drift to watch for: a
  "read this skill first" hold that still leaves the manager every tool, so it can pay a
  bill or publish a site itself. Leaving tools on the manager "just in case" is how this
  rule dies.)
- **Sub-agents report only to the manager.** Never wire a sub-agent to message the person
  directly. The responder is the only voice out.
- **Everything the person reads goes through the responder.** No agent writes to the
  person in its own raw words. No fixed template sentences reach a person except the few
  the law or a platform fixes. A new fixed sentence is a BRIEF the responder renders,
  never a string constant. Enforce it with a build-failing test that scans for hardcoded
  person-facing lines.
- **The model chain is the owner's, and lives in one file.** Each routing slot has ordered
  fallback legs across providers. Never change a slot's legs without the owner's explicit
  word. When no leg can answer, nothing is lost (a model-down path holds the inbound).
- **Nothing falls out.** Any new long-running or background work is a durable job the
  watchdog can see (a delegated job with a heartbeat), never an in-process timer that dies
  with the process. If you add a path that can stop, make sure the stop reports back.
- **Prove behavior, not presence.** "The code exists" is never "it works". A feature is
  correct only when it has been run against a real scenario with real models and seen to
  behave right, and the owner has signed off.
- **One voice.** Every agent writes as the assistant, first person, in the one voice
  (one shared guidelines constant read by the manager, the specialists, the proactive
  agents and the responder). No machinery words reach a person ("the system", "the
  agent", "the queue"): a specialist's line that names machinery is handed back with a
  one-voice check, and the writer answers yes or corrects; only the SENT line goes into
  memory. Nothing a person reads carries a long dash, bold, a star or AI filler: strip
  formatting and AI slop deterministically in the channel host's send function.
- **Nothing the assistant starts on its own bypasses the queue.** A watcher, a renewal, an
  inbox, a due task, a reminder, a care follow-up, discovery, growth: each ENQUEUES a
  candidate; only the proactive agents decide and only the host sends. A new proactive
  source that sends on its own is wrong.

---

## 3. Memory (three layers; the crux of making the manager smart)

1. **The active matter's working memory.** What the manager just researched, what a
   sub-agent just reported, the method it just read, kept IN FULL while the matter (the
   thread) is live, so nothing is looked up twice. One encrypted row per note (kinds:
   finding, report, skill, message summary) in a table like `matter_notes`, rendered into
   the preamble as the matter block. When the matter closes the memory-keeper runs and the
   notes are dropped; the durable parts live on in the store.
2. **The thread.** The recent stretch in full plus a rolling summary of the older part.
   Count in ROUNDS, not messages (a burst from one side is one round); the source system
   keeps 200 rounds for the manager and 50 for a hired specialist. A single huge message
   (a pasted book) is held in full only briefly, then stood in for by a summary; the full
   text stays in the messages table and search finds it. **One giant message cannot blow
   the context.**
3. **Long-term.** Facts, past topics and research findings, all embedded and reranked in
   your own database (an embedding model plus a reranker in Postgres). This is "the graph
   we pay for"; there is no third-party graph product.

A skill note in the working memory ages out of the prompt about two hours after its last
use (a re-read keeps it warm; the keeper still sees it at close).

**Memory comes in automatically, never left to the manager to search.** Every turn the
preamble carries a capped, clearly titled "Possibly relevant from past conversations"
section, fetched by meaning, with a line telling the manager to use the search tool for
more. The manager still has the tools: hybrid memory search (about 50 candidates reranked
to 20, and it ABSTAINS when nothing is relevant), thread search, a timeline, and
"remember always" / "stop remembering always".

**The memory-keeper** runs on the FLAGSHIP, in the background, when a sub-agent reports
back AND when a matter closes. It routes each matter note to one of three places:
- a standing rule the person set -> the hard-rules store (a pinned fact of type "rule");
- durable knowledge or an outcome -> an embedded fact in the store (not pinned);
- disposable scaffolding -> dropped.
Software cannot tell these apart, so this is a judgment pass, **never the cheap model**.
At the close of a matter it also names a PROCEDURE of the person's it saw (their own
repeatable method); software counts the sightings and at the third writes the skill.

**The hard-rules / preferences store is tiered**, and it is SEPARATE from the guardrail
rules (what the assistant may DO). These are the person's preferences ("never book me
before 9am", "always text"), built on pinned facts. They reach the preamble in tiers so
nothing is silently dropped and the prompt stays lean:
- **HOT**: set within about two weeks, carried always, any domain.
- **UNIVERSAL**: marked universal, applies to everything, carried always, capped at
  about 100.
- **DOMAIN**: older, fetched reliably by the fact's `domain` field when the matter touches
  that domain, **never by fuzzy keyword**.
Dedupe by id against what is already shown. Nothing ages out. Do not change a cap or a
window without the owner.

---

## 4. Skills on demand (how the assistant knows the proper way to do a thing)

- Skills are a library of well-named, documented files, one per kind of work. Only the
  one-line headers are in the agent's prompt by default; the body loads on demand.
- **The rule, enforced in code:** before a governed kind of work, the agent reads the
  skill first. A skill marked "before" HOLDS the tool call, injects the skill, and makes
  the agent retry after reading.
- **Lifetime in context:** the full skill text lives with the SUB-AGENT for the life of
  the task (the hands need the how-to). The MANAGER keeps only a one-line pointer on the
  open item and has the sub-agent re-read the skill if the matter returns. A skill is
  never stuck in history forever and never gone mid-task.
- When you add a capability, add or update its skill and keep the header name clear and
  findable.

**The person's own skills.** Two ways a skill comes to exist for a person:
- **STATED**: they tell the assistant a procedure once; the manager's save-skill tool
  saves it at once and records the standing permission with a set-rule call in the same
  turn.
- **LEARNED**: the keeper saw them walk the assistant through the same procedure three
  times; a skill-writing pass distills it once and the person is TOLD through the queue,
  never silent magic.

The headers ride in the manager's prompt under "Their own skills" beside the shipped ones;
a load tool loads the body; a standing specialist whose domain names one takes it as its
method; the day-time agent sees the triggers. **A skill is a METHOD, never a permission**:
its body reaches every executor inside the untrusted-content boundary, and every act it
drives still goes through the guardrails and the person's standing rules. Mounted for
that person only; never in anyone else's prompt. Give it a page (read, correct a step in
place as a new version, "off" keeps the words and stops the following, remove). Do not
add a second store for "procedures" or "routines"; this is it.

**Inject tool knowledge at the moment of use, not in the brain.** See
`inject-tool-knowledge-on-use`. A tool's special or easy-to-get-wrong how-to does not
belong in the always-on prompt; it is delivered when the agent reaches for the tool.

---

## 5. Open items (the person's unresolved things)

Stored as encrypted decision rows. The behaviors that MUST hold:

- **Never silently expire.** No timed auto-drop. An item leaves only when decided, done,
  or closed with a reason.
- **A permanent, logged-in page**, reached from the profile menu, no token, no expiry. A
  one-day link is only a convenience for someone not logged in.
- **Close with a reason:** decided, done, let go, or someone else is handling it. "Let it
  go" / "my husband has it" is a clean close, recorded, never nagged again.
- **Resurface at the right moment only:** NEVER while a question is in the air; only when
  the current matter is done and nothing is waiting on the person. A smart judge picks
  the moment, not a timer.
- **Numbering, always, for more than one item**, even across separate messages (1 of 2,
  2 of 2). The person answers by number.
- **Batching:** more than one thing in a moment is ONE numbered message, important first,
  not separate messages.
- **The link to the outstanding items** is attached whenever the assistant lists items,
  except a tiny one-off FYI. It points at the permanent page, the same destination as the
  profile-menu door.
- **A summary is two levels:** current/active on top, past unresolved below ("Still open
  from before:"). Never a flat dump.
- **An old item is raised as old** (more than a week: "from three weeks ago") with the
  push-off offered; the page splits Now from Past and carries the important mark.
- **A blocking question gets ONE "still there?"** at five minutes and never again; a
  delegated job that comes back while the question stands resumes with those words.

## 6. The task list (the person's decided to-dos)

A SEPARATE store from the open items.

- **The hard distinction.** Informational ("the payment went through") is a plain message,
  on no list. Actionable (something still to do) is a task. Open items are UNDECIDED
  questions of the assistant's; tasks are DECIDED things of the person's. **Never one
  store with two views.**
- **Who adds.** The person (the page's add field, or telling the assistant) and the
  assistant (when it sees a real to-do of theirs). Only the assistant creates open items.
- **The one-way bridge.** An open item the person decides to do graduates into a task;
  nothing flows back.
- **The surface.** A page under the profile menu next to open items and files, with a
  grocery-list feel: add, a box marks done (a second tap brings it back), edit in place,
  remove, a due date (a day with an optional time), history. No token, no expiry.
- **When the assistant leans in:** at the due date, as a candidate the manager judges in
  the next reply the person starts, once a day per task, never a flat list, never
  mid-matter; when it sees something that helps, by its own judgment; never a check at
  add-time. A message the assistant starts on its own at the due time belongs to the
  proactive side.

---

## 7. The models (who runs on what)

One routing file is the ONE source for which model answers each slot. Never trust a model
name written anywhere else (this file included). The shape that does not move is WHICH
SLOT each job asks for:

- The manager's live turn, the summarizer (compaction, the archive summary), the
  memory-keeper, the moment judge, the stand-in summary of a big message, a hired
  specialist: the flagship ("plan") slot.
- What the person reads: the "voice" slot.
- Reflexes only on the light slots: the planner's first look, the ack trigger,
  classification, the router.
- Memory reads and browser DOM steps: their own slots.
- **A known way to drift:** a watchdog's "is the person satisfied" judge or an answer
  judge quietly asking for the cheap slot. The design puts every JUDGMENT on the flagship.

Each slot has up to three legs; a leg that fails falls to the next. See
`ai-model-platform` for the slot and leg mechanics.

## 8. The acknowledgment and reply rhythm

Not every message gets a reaction (a thumbs-up on everything is not human). A reaction is
for a human moment (thanks, a joke, bad news) or the lead-in to a longer job. A quick
answer is just answered. A longer job gets a short "on it" in the assistant's own words
(never a template), then the result. Typing shows throughout; progress lines on a long
job.

---

## 9. The proactive side (everything the assistant does when the person has NOT written first)

The shape every new source or path must keep:

1. **One queue.** A table like `proactive_queue`. Every source ENQUEUES a candidate
   (source kind, source ref, topic, brief, an `important` flag set IN CODE per source, the
   inbox when it has one) and never sends. Typical sources: email triage by class per
   inbox, watchers and renewals, care follow-ups, discovery, a due task, a set-aside or
   stale open item, reminders, growth reasons, a learned skill. Dedupe is the queue's
   (one open candidate per source ref) plus the source's own.
2. **The DAY-TIME agent** (a scan about every 5 minutes). It sees only the important
   candidates plus the person's rules, inboxes and own skills, and gives each a
   disposition: drop, hold for the summary, tell now, do (hire a specialist through
   delegate; a person's skill whose trigger matches is a "do", naming it), or ask. **The
   1 / 2 / 3+ shape is enforced in code**: one thing is one line, two are two lines,
   three or more are ONE numbered message important-first; the say-now tool refuses
   anything else. On an off-day only the important reach it.
3. **The SUMMARY agent** at the passes. The passes are the union of the default times and
   each inbox's own times, drained BY INBOX and grouped by inbox in the words, in the
   person's time zone (inferred from their phone number when none is set). It gets full
   memory, the held candidates, the outcomes of the day's jobs, and what was already told
   today, and composes one message or nothing (**empty is a real answer**). The daily
   brief is FOLDED into it: one morning message. Off-days (the person's pinned rule read
   in code, the weekend by default, spans) give it the off-day shape; the first pass after
   an off-day or a holy day is the welcome-back shape.
4. **Delivery is the host's alone.** One host send function owns: quiet hours, the daily
   cap, the messaging platform's 24-hour window, holy-day gating, numbering, the
   interactive shape (buttons or a list built from a numbered reply; the words after the
   list always go as their own text), and explicit cues. Outside the window the candidate
   is HELD, never dropped, and the door is an approved template that carries the
   substance. Template tiers: say (one thing), batch (several, numbered), nudge, welcome
   back, and quick yes/no with buttons.
5. **Inboxes are rows.** One row per connected inbox with its label (inferred, or set by a
   tool), its own pass times, its importance bar enforced AT ENQUEUE, its connection state
   (a revoked grant is told once and the reconnect is told once), its cursor and its push
   watch (with a poll every sweep as the floor). Triage stores which inbox an email came
   from; a second inbox's setup question is asked when it connects.
6. **Reminders:** at their time in a quiet moment (three quiet minutes, looked at again
   every minute); ten minutes overdue unless within a minute of the person's last
   message; twenty minutes regardless, as a "by the way". The reminder's own time rides in
   the deferral reason, because the scheduler moves the fire time.
7. **Growth** (invites): N invites a week, sending never blocked, the seat opens at the
   turn (click order, N per inviter per week), the invitee told with a template, the
   inviter told through the queue, never important.

The numbering, batching, link, own-words and one-voice rules above apply to every
proactive message. The "worth saying now" judgment is the day-time agent's, not a
timer's; a moment judge is the pattern for resurfacing.

**Audit findings to design against from day one** (each was real drift found by a
verified audit of a built system): a must-tell candidate that can be dropped; a failed
summary that is simply lost; assistant-initiated sends that still bypass the queue. None
of the proactive side counts as working until each row of the ledger has a live-model run
the owner has judged.

---

## 10. If you are about to change the brain

1. Read the master build doc and the relevant design doc.
2. Check your change against the hard rules. If it breaks one, it is wrong.
3. Build within the architecture:
   - a new capability is a skill plus a sub-agent's tools, not a tool bolted onto the
     manager;
   - a new message path goes through the responder;
   - a new long job is a watchdog-visible durable job;
   - a new proactive source enqueues and never sends;
   - a new fixed sentence to a person is a brief the responder renders, never a constant
     (the own-words guard test fails the build otherwise).
4. Prove it by real behavior and get the owner's sign-off before calling it done.
5. Read the drift list before building on any ledger: it says where the code differs from
   this law.
