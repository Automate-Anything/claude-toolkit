# CLAUDE.md

This file gives every coding agent the standing rules for working in this
repository. It was installed by the agent toolkit as a starting point and is meant
to be edited: it belongs to this repository now.

**How it is organized**

- **Part 1, Project facts.** Specific to this repository. It starts as a set of
  blanks. Fill it in from the code (see the instruction right below).
- **Part 2, How the owner works.** Always applies, in every repository he owns.
- **Part 3, Hard rules.** Always apply. Each one exists because it was broken once
  and cost something.
- **Part 4, Which skill to read when.** The large reference material lives in
  `.claude/skills/`, one folder per skill. Read the matching skill BEFORE you start
  that kind of work, not after it goes wrong.
- **Part 5, Rules learned in this repository.** Starts empty. Add to it.

> **First agent in this repository: fill in Part 1 before doing anything else.**
> Read the package manifests, the folder layout, the deploy config, and the
> scripts, and replace every `TODO` below with what is actually true. Do not ask
> the owner for anything you can read from the repository. Ask only for what the
> code cannot tell you (which branch deploys where, which environments exist),
> one question at a time. Never write a secret value here: name the environment
> variable or the file that holds it. When Part 1 is filled in, delete this note.

---

# Part 1: Project facts (fill in)

## What this is

TODO: one paragraph. What the product is, who uses it, and what kind of codebase
this is (single app, monorepo, which package manager).

TODO: how work is verified here. Say plainly whether there is a test suite. If
there is none, say what counts as verification (typecheck, lint, a real browser)
so no agent invents test commands that do not exist.

**Frontends:** TODO (folder, framework, who uses it)

**Backends:** TODO (folder, runtime, host)

**Data:** TODO (database, auth, storage; name the project by env var, not by id)

**Other surfaces:** TODO (mobile, desktop, workers, cron jobs)

## Commands

```bash
# Dev servers
TODO

# Build + lint
TODO

# Typecheck (and say whether a COLD check is needed before calling work done)
TODO

# Database (how to read the live schema, how to run SQL)
TODO
```

TODO: the package manager rule for this repository (for example "pnpm only").

## Where things deploy

| Branch | What it deploys | Where |
|---|---|---|
| TODO | TODO | TODO |

TODO: say explicitly which surfaces deploy from which branch. Do not assume
"one branch is staging and the other is production" holds for every surface.
If it is asymmetric, write the asymmetry down here, because it drives every
merge decision.

## Where the truth lives

- Spec or plan documents: TODO (or "none")
- Decision log: TODO (create `docs/DECISIONS.md` if none exists; see Part 2)
- Infrastructure map: TODO (see the `infrastructure-overview-template` skill)
- Updates / changelog folder: TODO
- Help center or user docs: TODO

---

# Part 2: How the owner works (always applies)

The full picture is in the skills `how-the-founder-thinks`, `founders-style`,
`working-with-the-owner`, and `working-agreements`. Read them at the start of a
project. What follows is the part that must be in your head on every task.

## Before asking the owner ANYTHING: the Self-Answer Test

Try to answer your own question from, in order: (1) common sense, (2) the industry
standard (how the established products in this domain do it, or standard
engineering practice), (3) the conversation so far, (4) the codebase and the live
system. For migrations and audits, research FIRST. If any source answers it, do
not ask: commit to the answer, state it in one line, and proceed. Only product
calls that are truly undecidable reach the owner.

When you do ask: one question at a time, as multiple choice, each option with its
trade-off, your recommended option first.

## Build it as if it were YOUR OWN system

Decide every choice the way you would if this were your product, that you owned
and had to live with. Pick the option that makes the system the best and easiest
for the user, never the one that is merely faster to ship or safer for you. "Good
enough" is banned. When you recommend something, recommend what you actually
believe is best. If the owner asks "what would you do?", give the same answer you
would act on yourself. Recommending the fast option while privately believing
another is better is dishonest and wastes his time. Flag real risk and cost
honestly, and let him decide the trade-off. Do not quietly lower the quality bar
on his behalf.

## Fix the SOURCE, not the symptom (fix the WRITER, not the readers)

The costliest recurring failure: patch a symptom, call it fixed, watch it return,
because the fix patched a consumer of a wrong value and not its producer. Find
where the wrong value is BORN and fix it there.

- **Reframe first.** Ask "why is this wrong value here at all?", not "how do I
  stop it showing?". A timeout stored as a decline is a wrong-write bug, not a
  noisy-alert bug.
- **Fix the writer, not the readers.** A wrong value has ONE write site and MANY
  readers. Patching readers (reports, functions, badges, exclusion filters) never
  ends. If you are adding "also exclude X" to a second or third reader, STOP: the
  fix belongs at the writer.
- **A recurrence proves the last fix was a symptom.** Do not re-patch.
  Reconstruct the whole class of the problem and fix the origin.
- **Measure the truth, and test the OPPOSITE failure.** "Verified" means you
  reconstructed the real population and proved the numbers, not that your change
  did the one thing you intended. If you ship a filter that hides fake cases,
  count the real cases and prove you still keep every one. Default the ambiguous
  case to the SAFE side.
- **If the true source fix is too risky right now,** say so, do a stopgap as
  close to the source as possible (applied at EVERY reader in one pass), and
  never call a stopgap "fully fixed".

## Documents you write are for YOU, not the owner

Plans, scopes, audits, and trackers are agent-facing (you and the next agent),
unless the owner says "write this for me". So they are: scannable in seconds, a
live checklist (every item TODO / DOING / DONE / BLOCKED), concrete (exact paths,
columns, SQL, env var names, so an agent with zero context can execute), and kept
current (mark DONE when it ships). Answer the document's own open questions
yourself with the Self-Answer Test. Never park a question for the owner inside a
document, and never send him to read one. The chat is for him.

## Before building ANY user-facing surface

The moment you start building or redesigning anything a user sees (page, dialog,
form, field, picker, table, button, settings panel, empty state), or catch
yourself thinking "good enough" or "ship it", read the
**`build-with-the-user-in-mind`** skill first. "It works" is the floor, not the
bar.

The UI skills are a pipeline. Use them in order:

1. **`build-with-the-user-in-mind`**: product judgment. Should this surface
   exist, what job does the user come here to do. Read FIRST.
2. **`ui-ux-pro-max`**: the design knowledge base. What it should look like.
   Use BEFORE and DURING the build.
3. **`mobile-view-optimization`** with **`mobile-app-ui-design`**: everything
   that touches UI must be genuinely good on a phone. "It doesn't overflow" is
   the floor.
4. **`review-build`**: the gate at the end of any build, before you call it done.

**Browser authority:** whenever any skill needs a real browser, the
**`browser-verification`** skill governs how (which URL, your own isolated
browser, login walls). Use the one consistent browser it describes, not a
different one bundled with some other skill.

## What "done" means

- A user can do the thing, end to end, on every screen size and every surface
  the change touches. "It compiles" and "tests pass" are not done.
- You checked it yourself, live, the way a user would. Reading the code is not
  verification. See `verify-before-done`.
- Your report says what you verified and what you did not. Never claim a test,
  a read, or a number that did not happen. If you do not know, say "I don't
  know" and go find out.
- The after-build steps in Part 3 are finished.

## Record decisions, never re-ask them

Every decision the owner gives goes into the decision log (see Part 1) with the
date, in his words where possible. Before asking him anything, check the log. A
question he already answered is a failure.

## Use a todo list

Track all multi-step work in a todo list. Its last item is always the after-build
check in Part 3.

---

# Part 3: Hard rules (always apply)

## The database gate

> Read this before touching the database. Every time, every agent, every
> subagent. If you write SQL before completing the checks for your tier, the
> change is rejected, even if the SQL happens to be correct.

Know which tier you are in BEFORE you do anything.

| Tier | What it covers | Required checks |
|---|---|---|
| **1. READ** | `SELECT` only: schema, function bodies, triggers, policies, counts, sample rows | None. Run it freely. Reading the live database always beats guessing. |
| **2. ADD** | Creating something that does not exist yet: table, column, function, trigger, policy, index, fresh rows | Two: (a) query the live database and confirm it does not already exist, (b) read the `security-rls-permissions` skill in full. Every new object needs its access rules thought through. |
| **3. EDIT** | Changing anything that exists: `ALTER`, `DROP`, `UPDATE`, `DELETE`, `CREATE OR REPLACE` of an existing function, trigger or policy, a rename, a constraint change | Four, in order, listed below. |

If the thing you are "adding" already exists, you are in tier 3.

### Tier 3: the four checks

**Pull, write, run, in one uninterrupted beat. Never rely on memory for any
schema, function, or policy detail.** "Memory" includes what you knew before the
pull, anything earlier in the conversation, any migration file on disk, anything
a subagent told you, and anything you remember from a similar table. All of it is
stale by definition. If anything came between the pull and the write (a chat
turn, another file, a planning step), pull again. A re-pull costs two seconds. A
migration written from stale information costs a failed apply, a partial state,
and a second attempt.

1. **Read the `security-rls-permissions` skill in full.** Editing existing state
   is exactly when access rules get broken.
2. **Pull the LIVE definition of every object you will touch.** Migration files
   lie: they are a historical log, not the current truth. For a function, read
   the entire current body from the database (`pg_get_functiondef` in Postgres)
   and copy from THAT, never from a migration file. Pull the triggers, policies,
   constraints, and the foreign keys pointing at the table the same way.
3. **Audit the ENTIRE codebase for references.** Before renaming, dropping, or
   reshaping anything, search every frontend and every backend. Also search the
   likely permutations of the name: reversed words, common typos, plural and
   singular. A real case: an audit searched for a table's canonical name, found
   zero callers, and the table was dropped. One file had the name with its words
   reversed; the data client silently returns nothing for a table that does not
   exist, so that feature was fully broken for days before anyone noticed.
4. **Show the proof before showing any SQL.** Your message must state: which
   tier and why, what you pulled and what it said, the access-rule
   considerations, and the audit results (what you searched for, where, what you
   found, or "zero references" said explicitly). Then the SQL.

### Drops need the owner's explicit permission, each one, every time

`DROP` of anything, `TRUNCATE`, and any rename whose old name has callers. After
the four checks, STOP. Tell the owner: what you want to drop, why, the full audit
results, and what breaks in production if you are wrong. Ask "May I proceed with
the drop?" and wait. Silence is not permission. An earlier yes about a different
drop is not permission. "Do whatever you need" is not permission. Permission
given to a subagent is not permission.

### Also

- Never quote a migration file as the current truth.
- Never skip the checks because the change "seems too simple". Those are the
  ones that ship broken.
- Never let urgency shortcut the checks. The owner wrote this rule because he
  wants it followed even when he is in a hurry.
- A subagent is bound by this rule too. Say so when you dispatch one.
- See `database-write-safety` for backups, transactions, and verifying after.

## Git

- **Never run a write or destructive git command without the owner's explicit
  word in this conversation:** `commit`, `push`, `stash`, `pop`, `reset`,
  `checkout` of a file, `rebase`, `merge`, `clean`, `rm`, `branch -D`. Not even
  to fix an emergency. Read-only git (`status`, `log`, `diff`, `show`) is always
  fine. Making a code change is permission to EDIT, not to commit.
- **Work on the branch that is already checked out.** Do not create or switch
  branches on your own. If you think the work needs its own branch, ask first.
- **Assume other agents are working in this same checkout.** Run `git status`
  and `git diff` before you start and before you finish. A change you did not
  make is someone else's work in progress: read it, build on it, leave it
  exactly as it is. Never revert, reformat, or "clean up" a file you did not
  change.
- **When asked to commit, stage by exact path.** Never "add all", which takes
  other agents' unfinished work with it. The one exception is a full release
  the owner asked for.
- **A push to a deploying branch is a deploy.** Know from Part 1 what the push
  will ship before you make it. Promoting to production always needs explicit
  approval. Fetch the target branch immediately before any merge into it.
- See `safe-file-and-git-operations` and `release-and-deploy-sequence`.

## Before you BUILD: check whether someone already built it

Several people and agents work in parallel, often on their own branches. A
feature missing from YOUR branch may be finished on someone else's. Before
writing a line of a new feature, extension, or fix:

```bash
git fetch origin                                     # your refs are as stale as your last fetch
git log --all --oneline -- <the files you will touch>
git log --all --oneline --diff-filter=A -- <file>    # who created it, and when
git log --all --oneline --grep '<feature keyword>'   # work in files you have not guessed
```

`--all` is the flag that matters: it searches every branch, not just yours. If
you find prior work, do not rebuild it. Read what exists and build the difference
on top. A real case: an agent rebuilt a feature from scratch two hours after the
finished version had been fetched into the same local repository, and the result
was a hand-resolved conflict and a wasted afternoon.

When a conflict does appear in a feature file, resolve it by SYNTHESIS, never by
taking one side whole. Both sides are usually real work.

## Merge-conflict markers

A botched merge or stash writes `<<<<<<<`, `=======`, `>>>>>>>` into files. If
they are committed they can hide for a long time, because an incremental check
only looks at files in the current change. Whenever you resolve a merge or open a
file that looks merge-touched, scan the whole tracked tree
(`git grep -nE '^(<<<<<<< |={7}$|>>>>>>> )'`) and STOP and report if you find
any. Never edit around a marker, and never commit over one.

## A guard that is not switched on is not a guard

Checks that depend on someone remembering a setup step will be off on some
machine, silently, and a dead check looks exactly like a passing one. So:

- Guards (git hooks, pre-build scans) must enable themselves, for example from
  the install step. Do not add a manual "remember to run this" step to the docs.
- Do not remove a guard from a typecheck, build, or hook because it is in your
  way. Fix what it found.
- Verify a guard by OBSERVATION, not by reading config: feed it something it
  should block and see it block.
- The fast, incremental check is for iterating. Before calling work done, run
  the same cold check the deploy runs. Errors that pass a warm local check and
  fail the deploy build are a known class.

## Shell

- **Never `cd` into a subdirectory.** The working directory persists between
  commands and the project hooks use paths relative to the repository root. Use
  the tool's directory flag (`--dir`, `--prefix`, `--project`) or absolute
  paths. Tell subagents the same.
- No destructive shell commands (`rm -rf`, force-delete, mass overwrite) unless
  the owner asked for that exact action.
- On this owner's Windows machines Python is `py`, not `python` or `python3`.

## Writing style: no em dashes or en dashes

Never use an em dash (U+2014) or an en dash (U+2013) anywhere: user-facing copy,
templates, subjects, code comments, commit messages, documents, or chat. The
owner hates them, they read as machine output, and they have caused real
production bugs: when a UTF-8 file is read with the wrong encoding, the dash
becomes a run of garbage characters, and that garbage has been sent to real
customers.

- After a greeting, use a comma. For an aside, use a colon or two sentences.
- For a range, write "5 to 10".
- A plain hyphen between words ("24-hour", "heads-up") is fine.
- When writing files from a script, pass the encoding explicitly (UTF-8).
- You cannot find this corruption by searching for the dash, because by then the
  dash is gone. Search for the corrupted form.

## Errors must be visible

A catch block in a backend path (webhook, cron, route, job, AI orchestration)
that only logs is a silent production bug. Logging does not tell anyone. Report
it through the project's error reporter. Before adding a report, ask: **"If this
fired once at 3am, would I investigate?"**

| Answer | What to do |
|---|---|
| Yes, a single occurrence is a real bug | Report it. It creates a ticket and notifies once, then dedupes. |
| No, it is an expected branch, but frequency matters | Report it silently: tracked, no notification, escalates if the count crosses a threshold. |
| It must page immediately | Report it as critical. Critical can never be silenced. |
| I would never investigate, at any volume | Do not report it. Log a warning and move on (opted-out contact, already processed, feature not configured). |

See the `error-alert-system` skill for the design and the `alert-patrol` skill
for working the queue.

## Every outbound message is logged

Every email and every text message the system sends goes through ONE send helper
per channel that also writes the log row. Never call the provider directly beside
it. If the helper does not fit your case, extend the helper. Do not fork a second
send path. See `email-infrastructure`.

## A request a user is waiting on must never hang

The shared database client usually has no request timeout, and that is correct
for crons, imports, and long reports. A client-side abort does not stop the
statement on the server, and retrying a write that is not idempotent can apply it
twice, so do not put a blanket timeout on the shared client. But a handler a live
user is waiting on (auth check, heartbeat, readiness) gets a bounded client:
a short timeout, one retry for idempotent reads only, never a retry for writes.
Pure telemetry writes return immediately and write in the background. See
`latency-and-efficiency`.

## If the app is translated

Every user-visible string goes through the translation function. Add the key to
the translation file BEFORE adding the call that uses it: a call with no matching
key renders the raw key to users. Use nested objects, not keys with dots in them.
Do not translate data that users typed (names, their own content). Generic words
(Save, Cancel) live in one shared namespace: check there before adding a
duplicate. See `standard-internationalization`.

## After you build: two things, before calling it done

1. **A change users would care about gets ONE new file in the updates folder**
   (see Part 1), named `YYYYMMDD-HHMM_short-description.md` with the current date
   and time. First line `## YYYY-MM-DD: Short Title`, then what the user can now
   DO, from their side. One small file per update, never one shared document,
   because parallel branches collide on a shared file. New features and
   meaningful improvements count. Bug fixes, refactors, and internal tooling do
   not. See `release-announcements`.
2. **Anything a user sees or does that changed gets the help docs corrected**,
   or a new article if none exists. "I built X but the docs still describe the
   old X" is a defect. Say which articles you updated, or why none needed it.
   See `help-center-upkeep`.

Also ask of every new feature: would a brand-new customer want this on day one?
If yes, wire it into onboarding and the default setup. See
`customer-onboarding-doors`.

## Secrets

Refer to a secret by the name of its environment variable or the path of the
file that holds it. Never paste a secret value into the chat, a tool parameter,
a document, or a skill.

## Never remove what a user can use

Never remove a feature a user can use, and never take an action that cannot be
undone, without the owner's explicit and specific yes.

---

# Part 4: Which skill to read when

Before starting work, check whether one of these applies and read that skill in
full. `AGENTS.md` in the toolkit has the complete index by category, and
`standards-index` lists the whole standards library.

| When you are... | Read |
|---|---|
| Starting in this repository, designing anything, or judging whether something is done | `how-the-founder-thinks`, `founders-style`, `working-with-the-owner` |
| Building or redesigning anything a user sees | `build-with-the-user-in-mind`, then `ui-ux-pro-max` |
| Making anything work on a phone | `mobile-view-optimization`, `mobile-app-ui-design` |
| Finishing any build | `review-build`, `verify-before-done` |
| Opening a page in a real browser to check it | `browser-verification` |
| Doing any database work | `database-write-safety`, `security-rls-permissions`, `standard-database-design` |
| Writing access rules, roles, login, signup, or tenant separation | `security-rls-permissions`, `auth-and-access-control` |
| Writing any query, function, or loop that touches data, or anything feels slow | `query-efficiency`, `latency-and-efficiency` |
| Working on pages, components, rendering, scroll or drag | `page-performance`, `nextjs-supabase-performance` |
| Adding or changing routes, tabs, URLs, or query params | `url-structure` |
| Working with dates, times, or scheduling | `timezone-handling` |
| Adding colors, tooltips, pagination, or a new page | `ui-conventions` |
| Debugging | `debugging-discipline`, `systematic-debugging` |
| Explaining a bug to the owner | the `/problem-cause-solution` command |
| Touching payments, refunds, ledgers, or anything about money | `money-truth-doctrine`, `pos-checkout-design`, `payment-processor-integration-checklist` |
| Touching subscriptions, plans, or trials | `saas-subscription-billing`, `stripe-best-practices` |
| Touching commissions, memberships, or prepaid packages | `commission-system-design`, `memberships-and-packages-design` |
| Building or changing a report, dashboard, or export | `report-verification`, `analytics-reports-architecture` |
| Adding or changing an AI feature or an agent | `ai-model-platform`, `internal-ai-agent-architecture`, `multi-agent-assistant-architecture` |
| Working on a phone or voice agent | `retell-phone-agent`, `voice-agent-prompting`, `self-hosted-voice-agent`, `phone-number-provisioning` |
| Working on WhatsApp, email, or text messages | `whatsapp-whapi-integration`, `whatsapp-self-hosted-evolution`, `email-infrastructure` |
| Investigating or adding an error alert | `error-alert-system`, `alert-patrol` |
| Deploying, releasing, or a hosted site is stale | `release-and-deploy-sequence`, `deploy-freshness`, `cloudflare-pages-management`, `maintenance-banner` |
| Shipping code before its database change, or the reverse | `maintenance-banner` |
| Handling a customer support request | `support-triage` |
| Building or changing a public API | `public-api-upkeep`, `standard-api-design` |
| Importing a customer's data from another system | `ai-data-migration-agent`, `competitor-data-migration` |
| Working on iOS, Android, or a desktop app | `ios-build-from-windows`, `apple-app-store-submission`, `android-device-bridge`, `tauri-desktop-app` |
| Working on search visibility | `seo`, `local-seo-playbook` |
| Managing several agents | `acting-as-the-manager` |
| Told you are blocked on access or a tool | `agent-access-and-toolchains` |
| Writing a new skill | `skill-creator` |

Skills that describe a system to BUILD open with an "Adapt before use" note. They
describe how things should be wired. Once the real system exists in this
repository, update the skill with the actual file and table names.

---

# Part 5: Rules learned in this repository

Add a rule here when something breaks and the fix is a habit, not just a code
change. Write what happened, when, and the rule that follows from it. A rule with
its reason is followed; a rule without one is skipped. When a lesson is not
specific to this product, add it to the toolkit as a skill too, so the next
project starts with it.

TODO: none yet.
