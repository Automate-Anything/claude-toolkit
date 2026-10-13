---
name: working-agreements
description: The owner's standing agreements for HOW an agent works in any repository, collected from the always-on rules he wrote after agents kept making the same mistakes. Read it at the START of any non-trivial task and re-read the relevant part before you ask the owner a question, before you write a new function, hook, utility or component, before you edit a file you read earlier in the conversation, before you change anything other code depends on, before you write a plan, tracker, scope or audit document, and whenever a task has two or more steps. It covers the self-answer test (answer your own question from common sense, industry standard, the conversation, and the codebase before asking), reuse before writing new code (with a hard stop when you find similar code and want to skip it), re-reading a file immediately before editing it, checking every dependent of an interconnected change, granular todo lists as your memory, plans detailed enough for an agent with zero context, documents written for the agent and kept current, the user-facing updates log, the project ground-facts note, and keeping rule files in sync across agents. Use when the owner says "why are you asking me", "you already have that", "you duplicated it", "you forgot", "you broke the other page", "write a plan", "make a tracker", "pick this up where the last agent stopped", or hands you a multi-step job.
---

# Working Agreements

These are behavior rules, not style preferences. Each one exists because an agent did the
opposite and it cost the owner time. They apply in every repository unless that repository's own
rules say otherwise.

Two standing rules from the toolkit's `AGENTS.md` sit above everything here:
- **Never commit, push, or run history-changing or tree-changing git on your own initiative.**
  Only when the owner explicitly asks in that conversation. Permission to edit is not permission
  to commit. (Details in `safe-file-and-git-operations`.)
- **Never run a destructive shell command** unless the owner asked for that exact action.

---

## 1. CLARIFY FIRST, but answer your own questions before you ask

### 1.0 The self-answer test (run it before EVERY question, no exceptions)

Before you ask the owner anything, take each question you are about to ask and try to answer it
yourself from these four sources, in order:

1. **Common sense.** Would a reasonable person already know the answer? Is it obvious from the
   request itself?
2. **Industry standards.** How do the leading products in this app's industry handle it, or what
   is standard engineering practice? Adopt the norm.
3. **Conversation history.** Did the owner already say it earlier in this chat, this request, or
   this message?
4. **The codebase and the live system.** Can you answer it by reading the code, the live database
   schema, an existing pattern, or a sibling feature? For any investigation task (a migration, an
   integration, an audit), DO THE RESEARCH FIRST. Most questions answer themselves once you read
   the system.

**If ANY of the four answers the question, you do NOT ask it.** You commit to that answer, state
it in one line ("Defaulting to X because Y"), and proceed.

Only a question that survives all four sources, one that is genuinely undecidable without the
owner's product judgment, is allowed to reach him. Asking a question that one of these four could
have answered is the single most common complaint the owner has about agents. His words: "if you
can answer those, why are you needing me?"

This test is mandatory and it OVERRIDES the urge to "check in" or "be safe."

### 1.1 Understand the intent first

Before doing anything, understand what the owner is REALLY trying to achieve: the goal behind
the request, not just the words. Read between the lines. Consider the bigger picture and why this
matters to him.

### 1.2 If it is clear, just do it

If you understand what he wants and it makes sense: do not ask unnecessary questions, do not
over-engineer the clarification, proceed.

### 1.3 The only three reasons to ask

A. **You genuinely do not understand something.** The request is ambiguous, or you are missing
   context you cannot find.

B. **There are two valid options and the choice is his.** Several reasonable approaches, the
   choice significantly affects the outcome, and you cannot confidently decide for him.

C. **The request does not make sense or is not in his interest.** The approach seems wrong, it
   may cause a problem he has not considered, or it is destructive. Example: "This would delete
   all user data. Are you sure you want that?"

### 1.4 How to ask, when you must

- One question at a time.
- Multiple choice, each option with its trade-off, **your recommended option first**.
- Simple and non-technical. Prefer yes/no or a short list.
- The minimum needed. Do not interrogate.
- Whether to use a question popup or plain chat is set by the repo's own `AGENTS.md`. Follow it.

### 1.5 What NOT to do

- Do not ask questions just to cover every edge case.
- Do not ask about obvious things.
- Do not ask "nerdy" technical questions the owner does not care about.
- Do not slow down a clear request with unnecessary clarification.
- Do not park questions in a document for later (see section 6).

---

## 2. REUSE BEFORE YOU WRITE

Treat the codebase as a library of reusable parts, not a blank slate.

### 2.1 Search first (mandatory)

Before writing ANY new function, hook, utility or component:

- Search by meaning (what does it do) and by name (what would it be called).
- Check the usual homes: the shared library folder, hooks, components, utilities.
- Look for: something that does exactly what you need, something that does part of it, something
  that can be wrapped or extended, and the patterns the codebase already uses.

### 2.2 The reuse hierarchy (in this order)

1. **Use directly.** If an existing function does exactly what you need, use it as is.
2. **Wrap or extend.** If it does 80% or more, wrap or extend it instead of duplicating.
3. **Extract and reuse parts.** If it holds useful logic inside, extract that into a shared helper
   and use it in both places.
4. **Follow the pattern.** If no direct reuse is possible, follow the conventions already there.

### 2.3 Prohibited

- Creating a new function that duplicates existing functionality.
- Copy-pasting logic that already exists elsewhere.
- Creating a new utility when a similar one exists (extend the existing one).
- Creating a new hook when an existing hook can take a parameter for the new case.
- Hand-rolling a standard mechanism the repo already has one shared implementation of. The
  recurring offenders: pagination, search and typeahead, date and timezone formatting, currency
  formatting, URL building, error reporting, toasts, permission checks.

### 2.4 The reuse report

Before implementing new code, state:

```
## Code Reuse Check
- Searched for: [what you searched for]
- Found existing: [relevant functions / hooks / components]
- Reuse decision: [using X directly / wrapping X / extracting from X / no suitable match]
- Justification: [why]
```

### 2.5 When new code IS appropriate

Only when:
- nothing existing does anything similar,
- adapting the existing function would need breaking changes,
- the use case is fundamentally different (not "slightly different parameters"),
- or the owner explicitly asks for a new implementation.

Even then, consider: can the new code be generic enough to replace the similar code? Should you
refactor the existing code to be reusable first?

### 2.6 Consolidation

When your search turns up duplicate or near-duplicate code: flag it to the owner, propose
consolidating as part of the work, and prefer fixing the root cause over adding more duplication.
When you paste the same block a third time, extract one helper and route everyone through it.

### 2.7 HARD STOP: you found similar code and you are thinking of not using it

**This is the most critical rule in this section. Violations here cause the most problems.**

If you find a component, function or utility that does something SIMILAR to what you need, and
you are considering NOT using it, for any reason:

1. **STOP.** Do not proceed with the implementation.
2. **Report what you found.** Show the existing code.
3. **Explain your hesitation.** Why you think it may not fit (a missing prop, a different
   structure).
4. **Ask for explicit permission.** "Should I extend this existing component, or create
   something new?"
5. **Wait for the answer.**

Why:
- You might be wrong about why it will not work.
- A small modification to existing code is almost always better than new code.
- The owner may have context about why the existing code is shaped that way.
- Similar-but-different code is a maintenance nightmare.

What to say:

```
I found an existing component, CardTabs, that builds tabbed interfaces with a card look.
It does not currently support right-aligned tabs.

Options:
1. Add a tabsAlign prop to the existing component (recommended)
2. Write new inline styling (not recommended: it duplicates the visual logic)

Which do you prefer?
```

Never:
- find a similar component and silently decide to build something new,
- assume "it is easier to just write it fresh",
- skip the report because you are confident your approach is better.

This is the one place where the self-answer test does NOT let you decide alone. The benefits it
protects: a single source of truth, a lighter codebase, consistent behavior, and one function to
refactor instead of many.

---

## 3. RE-READ BEFORE YOU EDIT

When you investigate code and later prepare to change it, **re-read the file immediately before
editing.** Several agents may be working in the same tree. The file you read earlier may have been
changed by another agent, or by the owner, since.

1. **Re-read before every edit.** Do not rely on your memory of what the file looked like earlier
   in the conversation.
2. **Compare and adapt.** Is the code still what you expected? Does your planned change still
   make sense?
3. **If the file changed:**

| Size of change | What to do |
|---|---|
| **Minor** (formatting, unrelated code nearby) | Adapt your edit to the current state. Proceed without asking. |
| **Moderate** (related code changed, intent is clear) | Adapt your plan to include the new state. Tell the owner briefly what changed and how you are adapting. Proceed. |
| **Significant** (the area is completely different, or your change no longer makes sense) | STOP before any edit. Explain what you planned, what the file looks like now, and how that affects the plan. Propose an updated approach and ask for confirmation. |

Example of the significant case:

```
The file has changed since I investigated.

I planned to modify handleSubmit at line 45. Another change has since:
- moved the function to line 78
- added new validation logic

Before I proceed: should I still add [the original change] to the updated function, or has this
already been addressed?
```

Absolute rules: never edit from stale information; never assume a file is unchanged since you
last read it; always adapt to the current state; never revert or overwrite another agent's
in-flight work to make your edit fit.

---

## 4. INTERCONNECTED CHANGES: check everything that depends on it

This applies whenever you change something other code depends on: a component used in several
places, a hook or utility, a prop or interface, a database column or function that queries rely
on, an API response the frontend expects, a URL.

1. **Before the change, find the dependents.** Search for imports and for usages by name. For a
   database change, search the queries that use the table or column, the functions and triggers
   in the live database, and any server code outside the main app.
2. **Make the map.** Direct dependents (files that import or call it) and indirect effects (what
   breaks if the behavior changes).
3. **After the change, check EVERY dependent.** Does it still work with the new interface? Does
   it need updating? Are there type errors?
4. **Update dependents in the same task.** Do not leave the codebase broken.

Examples:

```
Changing: <Button> now requires a variant prop
Check:    every file that uses <Button>
Action:   add the prop everywhere, or make it optional with a default

Changing: renaming a column from user_name to full_name
Check:    every query that selects or inserts it, every function, trigger and policy
Action:   update them all in the same change

Changing: a hook now returns { user, isLoading } instead of user
Check:    every caller
Action:   update every destructure
```

Do not: change shared code without checking usages, assume "it is only used in one place", or
leave dependent code broken.

**When you touch a shared mechanism, do ALL its entry points.** A fix applied to one of N paths
is a half fix that ships as a bug.

**Some changes have a fixed list of places that must all move together** (a new page, a new
permission resource, a new URL, a new foreign key to a mergeable entity). When the repo documents
such a list, it is not optional: missing one item ships a broken feature. See `url-structure`,
`security-rls-permissions`, `auth-and-access-control` and `database-write-safety`.

---

## 5. TODO LISTS AND PLANS: the list is your memory

Use the agent's task or todo tool for ANY work with more than one step.

### 5.1 When to create one (mandatory)

- The owner gives you several things to do.
- A task has two or more distinct steps.
- New instructions arrive while you are already working on something.
- The owner mentions ANY detail that needs to be remembered.

### 5.2 How to run it

- Add ALL tasks and sub-tasks BEFORE starting work.
- When you discover more work, ADD it immediately.
- When the owner adds requirements mid-conversation, ADD them.
- Exactly ONE item in progress at a time.
- Mark an item complete only AFTER it is actually done and verified. Never assume.
- Never remove an item until it is truly finished.
- Prefer more granular items over fewer vague ones. When in doubt, add it.
- Include the owner's exact words when he gives specific details.

**Why:** when a conversation is long or the context gets summarized, your memory of earlier
details is lost. The list persists and shows exactly what is left. Treat it as your memory.

### 5.3 Write each item so anyone could execute it

Include exact file paths, function names, column names and values in each item. Break work into
the smallest actionable steps: **one item per file or function change, not one per feature.**
Every item in a plan must have a corresponding todo. Nothing in the plan may be missing from the
list.

```
Good: "Add a cancel button to the booking form that clears all fields and shows a confirmation"
Bad:  "Add cancel button"

Good: "Fix timezone bug: owner said times show 2 hours off in the Eastern timezone"
Bad:  "Fix bug"
```

### 5.4 Planning large tasks

In plan mode, or for any large change, multi-area bug fix, new feature, refactor or migration,
build an **incremental breakdown**:

1. **Identify the end goal.** What does "done" look like?
2. **Work backwards.** What are the milestones?
3. **Break each milestone into atomic steps**, each completable and verifiable on its own.
4. **Prefer more, smaller items.** If an item could be split, split it.
5. **Order by dependency.**

```
Task: "Add a user profile page"

Good:
 1. Create the /profile route in the route table
 2. Create the ProfilePage skeleton component
 3. Add a useProfile hook to fetch the user
 4. Create ProfileHeader (avatar, name, email)
 5. Create ProfileDetails (phone, address)
 6. Create ProfileEditForm
 7. Add the mutation hook for profile updates
 8. Wire form submission to the mutation
 9. Add success and error toasts
10. Add loading skeleton states

Bad:
 1. Create profile page
 2. Add editing functionality
```

Smaller steps mean less chance of missing something, each step can be verified before the next,
progress is visible, the work is easy to resume after an interruption, and edge cases surface
during planning instead of during implementation.

### 5.5 The mandatory last item

Every list ends with: **"Check whether any of this deserves an entry in the user-facing updates
log."** See section 7. Before marking it complete, review what you did and decide whether a user
would care. If yes, write the entry. If no, mark it complete with no action.

The toolkit's `writing-plans` and `executing-plans` skills cover plan mechanics in more depth.
This section is the owner's bar for how granular the result must be.

---

## 6. DOCUMENTS YOU WRITE ARE FOR THE AGENT, NOT THE OWNER

When you write a plan, scope, audit, tracker, or any working document, the default audience is
**the agent**: you, and the next agent who picks the work up. It is NOT a deliverable the owner
will read.

### 6.1 The default

Unless the owner explicitly says "write this for me", "I want to read X", or asks for a summary,
report or explanation, **assume every document you create is an agent-facing working tool** and
that he will never open it. When he says "write a plan / doc / tracker", he means "build yourself
something to work from." The owner reads the chat.

### 6.2 What that means for how you write it

- **Scannable in seconds.** The next agent opens it, sees the full state of the work, and misses
  nothing. No prose padding, no narrative for the owner's benefit.
- **A live checklist.** Every actionable item is a checkbox or has an explicit status (TODO /
  DOING / DONE / BLOCKED). The point of the document is to know what is done and what is not at a
  glance.
- **Concrete and self-contained.** Exact file paths, function names, table and column names,
  exact values, SQL, env var NAMES (never their values). An agent with zero prior context must be
  able to execute from it.
- **Kept current.** Mark items DONE in the document the moment they ship, not at the end of the
  session. A stale plan makes the next agent "rediscover" work that already shipped.

### 6.3 The decision-making corollary

Because the document is yours and you are executing it, **you answer the open questions in it
yourself.** A plan is not a place to park questions for the owner. Before any line becomes "ask
the owner X", run the self-answer test (section 1.0). If any source answers it, write the decided
answer into the document with a one-line rationale, not the question.

A document full of "open questions for the owner" is a failure mode: it pushes work back onto him
that the agent was supposed to do.

### 6.4 The work-context (handoff) file

For a feature that spans sessions or machines, keep ONE context file so work can continue
anywhere. A good one contains:

- a one-paragraph overview of what is being built and why,
- **Completed** and **In progress / pending** as checklists,
- a table of the key files and what each is for,
- the contracts that matter: request and response shapes, including the error shape (with
  placeholder values only, never real identifiers),
- the next steps, in order,
- how to test it by hand,
- the non-obvious technical notes: the decisions and the traps already hit.

Mark it clearly as a work-in-progress tracker, not a behavior rule, so it is not mirrored into
always-on rule files. Delete or archive it when the feature ships.

### 6.5 When the owner IS the audience

Only when he explicitly asks for something to read do you write for a human reader: prose,
context, no internal status markers. When an ask is genuinely ambiguous, default to
agent-facing. It is the common case.

---

## 7. THE USER-FACING UPDATES LOG

> **Adapt before use.** This describes a convention to set up per repo: a folder of small dated
> files, one per notable change. If the repo has no such folder, say so and ask once whether to
> start one. If it already has a changelog pipeline, use that and update this section with its
> real path. `review-build` section 5 covers the surrounding duty (changelog plus help docs).

After completing any action, ask: **"Is this a new add-on or a notable improvement a user would
care about?"** If yes, write an entry.

**Counts:**
- new features or pages,
- new integrations or capabilities,
- significant UI or UX improvements,
- new settings or configuration options,
- new automations or workflows,
- anything a user would notice and appreciate.

**Does NOT count:**
- bug fixes (unless it was a major user-facing problem),
- refactors with no visible change,
- internal tooling or developer-only changes,
- minor styling tweaks,
- performance work (unless dramatically noticeable).

**How:**
- One new file per update, named with the current date and time plus a short description:
  `YYYYMMDD-HHMM_short-description.md` (lowercase, hyphen-separated).
- Written from the **user's perspective**, not the developer's: what they can now DO, not how it
  was built. No code words.
- Title uses a colon or a hyphen, never an em dash or en dash.

```markdown
## 2026-02-11: New Calendar View

You can now view your schedule in a monthly calendar layout. Switch between day, week and month
using the toggle at the top of the Schedule page.
```

**Why one file per update:** separate files cannot produce merge conflicts between agents
working in parallel, and once a month the owner can ask for "everything in the updates folder
from this month, as a nice email" without anyone having tracked it by hand.

---

## 8. PROJECT GROUND FACTS: keep one note, and keep it true

> **Adapt before use.** Every repo should have ONE short configuration note (in its `CLAUDE.md`,
> `AGENTS.md`, or an infrastructure skill) answering the questions below. If it is missing,
> build it from the code the first time you need it. Never put secret VALUES or account
> identifiers in it: names of variables only.

What the note must answer, because agents get each of these wrong when it is not written down:

- **Which env file is real.** For example `.env.local`, not `.env`. Check the documented one
  first.
- **The env variable NAMES and what each is for.** Never the values.
- **Every server and its port.** A repo often has more than one backend. Which runs where
  locally, and what each one handles.
- **How to start each piece** locally, and which package manager is enforced.
- **The database:** the provider, where the live schema snapshot lives, how to refresh it, and
  whether the migrations folder is the source of truth (often it is NOT).
- **Shell quirks.** For example on Windows the Python launcher is `py`, not `python`.
- **A "common issues" list**: symptom, first thing to check. For example "403 on an API call:
  is that server running, and is the tenant header set?"

### Where new code belongs

Decide the layer BEFORE writing anything. The generic rule:

| If the task involves... | Build it in... |
|---|---|
| UI, pages, components, forms, client-side logic | The frontend |
| A call that needs a server secret (payments, messaging, AI providers, email) | A backend server. **Never the frontend.** |
| Scheduled or background work | The backend |
| Receiving webhooks from external services | The backend |
| Tables, policies, database functions | A migration, after `database-write-safety` |
| A tiny proxy whose only job is to keep one key off the client | A serverless or edge function |

If it needs a server (secrets, cron, webhook handling, anything that cannot run in the browser),
it goes on the server the repo already has, not on a new one. **Never put a server secret in the
frontend.**

### Keep the infrastructure note current

It MUST be updated whenever infrastructure changes: a new endpoint or cron job, a new webhook, a
new external service, a new env variable, a deployment change, or functionality moving from one
layer to another (update BOTH sides). An infrastructure note that still describes a retired
system is worse than none, because it sends the next agent to build on something that is gone.
If you find one stale, say so at the top of it and point to the current source.

---

## 9. KEEP RULE FILES IN SYNC ACROSS AGENTS

Different agents read different files. One reads `CLAUDE.md` and `.claude/skills/`, another reads
`.cursor/rules/`, others read `AGENTS.md`. A rule written in one place is invisible to the rest.

- **When you create a rule in one agent's format, reflect it in the others** the repo uses. The
  mirror can be shorter (a summary plus the key rules) but must carry the same intent.
- **When you update one, update its mirror in the same change.** Do not let them drift.
- **Name one canonical copy.** Put a mirror notice at the top of each non-canonical copy saying
  where the canonical one lives. If a mirror is known to be stale, say so at the top instead of
  leaving it silently wrong.
- **Work-in-progress tracking documents are the exception.** They are context, not behavior
  rules, and are not mirrored.

After creating or editing any rule file:
- [ ] Is the rule reflected in every agent's rule system this repo uses?
- [ ] Is the section heading findable?
- [ ] Is the intent preserved, even if the wording is shorter?

Editing `CLAUDE.md`, `AGENTS.md` or agent configuration is the owner's call. Propose the change
and make it when he asks.

---

## THE SHORT VERSION

Answer your own questions from common sense, industry norms, the conversation and the code before
you ask; ask only what needs the owner's judgment, one multiple-choice question at a time with
your recommendation first. Search before you write, reuse or extend what exists, and STOP and ask
if you find similar code you would prefer not to use. Re-read a file right before editing it.
When you change anything shared, find and fix every dependent in the same task. Put every step
and every detail in a todo list granular enough for a stranger to execute, and mark items done
only when verified. Write plans and trackers for the next agent: checkboxes, exact names, kept
current, questions answered not parked. Log what users would notice, one dated file per update.
Keep the project's ground facts and the rule files true, in every place agents read them.

## Related

- `debugging-discipline`: revert first, check for syntax errors, verify packages.
- `safe-file-and-git-operations`: deleting files, recovering them, git safety.
- `verify-before-done`: proving the work before calling it done.
- `acting-as-the-manager`: when you are coordinating other agents.
- `build-with-the-user-in-mind`, `review-build`: the product bar and the done gate.
