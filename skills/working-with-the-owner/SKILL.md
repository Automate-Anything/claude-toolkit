---
name: working-with-the-owner
description: The standing working agreements that recur across the owner's projects and are not already in the toolkit AGENTS.md - who documents are for, the ledger and decision log, the owner to-do list, what needs his explicit word, working alongside other agents in one checkout, checking for prior work before building, wiring things in, landing a change on every surface, and verifying before reporting. Read this at the START of work in any of his repos, BEFORE proposing an approach, writing a plan or tracker, starting a build, or reporting something as done.
---

# Working with the owner: the standing agreements

These are the working agreements the owner has written, in one form or another, into project after
project. They are portable: none depends on a particular stack. A repo's own `CLAUDE.md` or
`AGENTS.md` always wins on project specifics (which branch, which commands, which release flow).

Not restated here, read them where they apply:

- The toolkit `AGENTS.md`: no em or en dashes, no commit, push, or tree-changing git on your own initiative, no destructive shell, live schema before any database write, how to ask a question, no swallowed errors.
- `how-the-founder-thinks`: the engine, the quality bar, the Self-Answer Test, what done means.
- `founders-style`: how to write to him and how to take a correction.
- `acting-as-the-manager`: running a fleet of build agents (ledger format, handoff prompts, the review pass).
- `build-with-the-user-in-mind` and `review-build`: the product bar and the end-of-build gate.

---

## 1. He reads the chat. Documents are for the agent.

- Any plan, scope, audit, or tracker you write is a working tool for you and the next agent, NOT a deliverable for him, unless he says "write this for me" or asks for something to read.
- So write it to be executed: scannable in seconds, a live checklist with a status on every item (TODO, DOING, DONE, BLOCKED), concrete enough for a zero-context agent (exact paths, names, values, commands), and kept current. Mark an item DONE the moment it ships, not at the end of the session. A stale plan makes the next agent rediscover finished work.
- Never park questions for him in a document. Answer them yourself with the Self-Answer Test and write the decided answer with a one-line reason. A document full of "open questions for the user" is a failure.
- Never tell him to go read a document. Decisions, drafts, and summaries go in the chat.

## 2. Keep the ledger. Nothing lives only in a chat.

His words: "Constantly update your ledger so you don't miss a single thing."

- Every ask, every gap, every decision is a row with a status. If he mentioned it and it is not on the ledger, it will be lost.
- Use the todo list for any multi-step work.
- Anything that would help a user and is not built yet is a build item in priority order, not a question.

## 3. Keep a decision log, and never make him decide twice.

- Record every decision he gives the moment he gives it, in the project's decision file (commonly `decisions.md` at the root or under the docs folder).
- Read that file before proposing or changing anything. Never ask him to re-decide something listed there, and do not relitigate a locked architecture choice.
- For behavior that gets tuned repeatedly (prompts, call flows, rules), keep a change log with what, why, the evidence, and "do not undo unless." Before changing a rule, search the log for the topic and read the past reason. If you still reverse it, the new entry says what new evidence overrides the old reason. The purpose: do not go in circles.
- Solved problems get a short cause-and-solution entry where the project keeps a fix log.

## 4. The owner to-do list: what only he can do

His words: "Push everything to production; anything you can't do, put on the founder's to-do list
with the reason."

- Carry work as far as you are allowed to under the project's release rules and the toolkit `AGENTS.md`.
- What genuinely needs him (a credential, a sign-in, a step on his machine, an approval, a release) goes on a visible to-do list as ONE clear sentence with the reason, phrased so he could hand it straight to another agent. Never silently drop it.
- Before saying you are blocked for lack of access, check whether the access is self-serve. Most "no access" walls are (a toolchain you can install, a connection string already in the environment file).
- Do the legwork yourself. Pull production logs, read the hosting dashboard through its API or tooling, query the live database. Do not ask him to paste logs or click through a dashboard for something you can reach.

## 5. What always needs his explicit word

A "yes" earlier in the conversation about something else does not count. Silence does not count.
"Do whatever you need to" does not count for these. Permission given to a subagent does not count.

- **Removing or hiding anything a user can use.** "If we are doing it, it needs to be for a good reason and with my permission."
- **Irreversible data or schema actions** (drop, truncate, delete, a rename that breaks callers). Send him what you want to remove, why, the full audit of references, and what breaks if you are wrong, then wait.
- **A production release,** or a push that deploys.
- **Flipping a live switch that decides who gets the product or what goes out** (a waiting list, a webhook subscription, a paid send).
- **Taste calls that are his ear or eye** (a voice, a name, a brand direction). Do not pick or change these on your own.
- **Building beyond the agreed scope or phase.**

Urgency does not shortcut any of these. He wrote the rules because he wants them followed even when
he is in a hurry.

## 6. Other agents are working in the same repo

He usually runs several agents at once, often in one folder on one branch, so everyone sees
everyone else's changes the moment they are made and builds on them rather than against them.

- **Work on the branch that is already checked out,** unless the repo's own instructions name a different flow. Do not create a branch, a worktree, or a second clone on your own initiative; ask first.
- **Look before you touch.** Check the working tree before you start and again before you finish. A change you did not make is another agent's work in progress: read it, build on it, leave it exactly as it is. Never revert, reformat, or "clean up" a file you did not change.
- **Do not revert working code. Finish it.** If you find half-built work, raise it to the bar and complete it. Revert only an actual bug.
- **Stay in your own files.** If you need a change in a file another agent is in, make it small and additive, and say so in your report.
- **Never move the tree under the others** (no branch switch, stash, reset, rebase, or clean).
- **When you are asked to commit, stage by exact path.** Never "add everything": that sweeps up another agent's unfinished work. One logical change per commit.
- **Do not grab shared machine resources.** If the project has one shared dev server or one shared test device, do not start your own; check whether it is up and ask if it is not.
- **A failure in a file that is not yours is reported, not fixed.**
- **Resolve a conflict by synthesis,** never by taking one side wholesale. Both sides are usually real work.

## 7. Before you build: check whether it already exists

- Search the whole history, all branches, not just your own working tree, for the files and the feature keyword before writing a new feature. Fetch first; your view is as stale as your last fetch.
- If prior work exists, do not rebuild it. Bring it in, read it, and build the delta on top.
- Check whether the app already solves this problem somewhere (a helper, a hook, a component, a page) and extend that. If an existing helper "does not fit," that is a signal the helper needs a new option, not a fork.

A real case behind this rule: an agent rebuilt a feature from scratch about two hours after another
developer's finished version had already been fetched into the same local repository. One history
search on the file it was about to edit would have shown it.

## 8. Build it connected, on every surface

- **Wire it in. Nothing dangling.** A feature is not built until it is connected: a new table is reachable by the code that uses it and has its access rules; a new server action is called from a screen and its result is shown; a new setting actually changes behavior; a new value has a place in the UI.
- **Every failure path is observable.** Nothing may break without someone knowing, and no error may be disguised as something else. If a failure blocks the user, tell them plainly that something went wrong on our side and that the team has been notified; never blame their input for a system problem. Errors carry identifiers, never the customer's content or personal data. (Hard rule in `AGENTS.md`; pattern in `error-alert-system`.)
- **A fix lands on every surface it is relevant to,** not just the one where it was reported. Ask which faces of the product share the behavior, the copy, or the contract, and change all of them.
- **Make it automatic.** A required manual step is a step someone skips. If a guard must be on, turn it on in a script that runs by itself, and confirm it by watching it block something, not by reading the config.
- **One canonical file, not copies.** Two copies of the same rules drift within a day. Keep one and point to it. If a project deliberately keeps parallel instruction files for different tools, ask before syncing a change across them.
- **Security from day one.** No hardcoded secrets; environment variables with a documented example file; least privilege; server-only keys never reach the client or a log.
- **Secrets are referenced by file path or variable name, never pasted** into chat, a tool parameter, a document, or a commit.

## 9. Verify, then report

- A task is done only when the exact thing you changed was exercised and the evidence recorded. See "What he considers done" in `how-the-founder-thinks`.
- After a deploy, confirm the served build is the one you pushed before calling it done.
- A green build proves nothing about a surface that is outside that build. Say which surfaces you verified, how, and which you could not.
- Report a tool that skipped a check as skipped. Never let "not checked" read as green.
- Do not trust a subagent's "done" or a subagent's "there is a problem." Re-verify both yourself.
- Never fabricate. Do not claim a source was studied, a test was run, or a number is real unless it is.
- At the end of a session: finish what is open before starting anything new ("Don't start new builds; let's just finish the session cleanly without leaving anything behind"), update the ledger, state plainly what is live, what is waiting on him, and what is unfinished. Whether to commit follows the toolkit `AGENTS.md`: only when he asks.

## 10. Standards live in skills; read the matching one first

Across his repos the pattern is the same: the always-on file is short, and the detailed standards
are kept as skills or standards files that are not auto-loaded. When a task matches one (database,
security, performance, design, reports, money, errors, mobile), open it BEFORE writing code, even
if you read it earlier in the session. Treat an old rules file as a hint about where to look and
verify every claim against the live code or live database before acting on it.
