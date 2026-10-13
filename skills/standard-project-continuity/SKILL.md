---
name: standard-project-continuity
description: "Standard 31 of the engineering standards library: the session management protocol that keeps context from being lost between conversations on a large, multi-phase project. Covers the mandatory session start (read CLAUDE.md, docs/PROGRESS.md, docs/DECISIONS.md, docs/INFRASTRUCTURE.md, then state the current phase), the new-project fallback (offer to scaffold those files and wait for confirmation), which standards to read before coding each kind of feature, the guided one-step-at-a-time approach for an owner who does not code, and the mandatory session end (update the status files, report what was done and what is next, offer to commit). Read it at the START of every working session, at the END of every working session, when bootstrapping CLAUDE.md or a docs folder for a new project, and when the user says \"where were we\", \"pick up where we left off\", \"what is the current status\", \"what is next\", \"update the progress doc\", \"wrap up\", \"end of session\", or \"set up the project docs\"."
---

# Project Continuity: session management protocol

## PURPOSE

For large, multi-phase projects that span many sessions, this standard ensures context is never
lost between conversations. In the source library it was always-active: it applies to every
session, not only when a topic comes up.

> **Agent rule.** The session end protocol says to OFFER a commit. That is the whole of it. An
> agent never commits, pushes, merges, runs history-changing git, or deploys on its own initiative.
> It does those only when the owner explicitly asks in the current conversation.

## SESSION START (MANDATORY)

At the START of every session, before doing ANY work:

1. Read `CLAUDE.md` in the project root: understand the current phase, the active task, and the
   decisions.
2. Read `docs/PROGRESS.md`: know exactly what has been completed and what is next.
3. Read `docs/DECISIONS.md` if making architectural choices: check whether the decision was already
   made.
4. Read `docs/INFRASTRUCTURE.md` if working on anything that touches external services, APIs,
   deployment, or env vars. It is the single source of truth for all service configs, where
   credentials are kept (locations, never the values), and setup status.
5. Read the project facts file if the project has one (where the project lives, the stack, hosting,
   domains, how it is deployed). See `standard-project-info-template`.
6. Acknowledge to the user: briefly state what phase we are in and what we are working on.

### NEW PROJECT FALLBACK

If any of those files do NOT exist yet (a fresh project that has not been bootstrapped), do NOT
silently proceed. Instead:

1. Tell the user which files are missing.
2. Offer to scaffold them now: a starter `CLAUDE.md` (project name, current phase, active task, key
   decisions table, last-updated date) and a `docs/` folder with empty `PROGRESS.md`,
   `DECISIONS.md`, and `INFRASTRUCTURE.md`. Only scaffold those that match the project type: for
   example `INFRASTRUCTURE.md` is irrelevant for a static site with no backend.
3. Wait for the user to confirm the scaffold before generating files.
4. Once scaffolded, the SESSION START protocol above applies on every subsequent session.

## BEFORE CODING ANY FEATURE

Before writing code for any feature or task:

1. Read the relevant standards for that task. `standards-index` lists all of them with the trigger
   for each. The common routes:

   | Task | Read first |
   |------|-----------|
   | Building ANY UI | The design skill (`ui-ux-pro-max`) FIRST, then the rows below |
   | Building web UI | `standard-design-system`, `standard-assets-organization`, `mobile-view-optimization`, and the web design persona standard if the toolkit has it |
   | Building mobile UI | `standard-mobile-app-design`, `mobile-app-ui-design`, `standard-design-system` |
   | Building an API | `standard-api-design`, `standard-security-fortress` |
   | Database work | `standard-database-design`, `query-efficiency`, `security-rls-permissions` |
   | Authentication | `standard-security-fortress`, `standard-audit-ready-code` |
   | Internationalization | `standard-internationalization` |
   | Testing | `standard-testing-strategy` |
   | Deployment (web) | `standard-ci-cd-pipeline`, `standard-ship-with-confidence` |
   | Deployment (app stores) | `standard-app-store-deployment`, `apple-app-store-submission` |
   | Error handling | `standard-error-handling-ux`, `error-alert-system` |
   | Performance | `standard-performance-optimization`, `page-performance`, `query-efficiency` |
   | Cross-platform code | `standard-cross-platform-development` |
   | Mobile architecture | `standard-mobile-app-architecture` |
   | Native device APIs | `standard-native-device-apis` |
   | Real-time sync | `standard-real-time-sync` |

2. Follow the standards defined in those skills.
3. Always follow the master protocol (the umbrella rules for architecture, security, design, SEO,
   communication and git), if the toolkit or the project carries it.
4. Always follow `standard-audit-ready-code`. It was always-active in the source library: every
   line of code must pass third-party audits.
5. Always follow `standard-ship-with-confidence` before using the word "done".

## GUIDED APPROACH

If the user does not code and the agent does all implementation, follow `standard-guided-setup`:

- Break tasks into small steps.
- Give ONE step at a time when the user needs to do something (run a command, create an account,
  and so on).
- Wait for confirmation before moving on.
- Explain the "why" briefly.
- If something fails, troubleshoot before continuing.

## SESSION END (MANDATORY)

At the END of every work session:

1. Update `CLAUDE.md`:
   - Update the "Current Status" section with the current phase and active task.
   - Update the "What's Been Completed" checklist.
   - Add any new decisions to the "Key Decisions" table.
   - Update the "Last Updated" date.
2. Update `docs/PROGRESS.md`:
   - Check off completed items.
   - Add notes about anything in-progress or blocked.
3. Offer to commit the changes to git with a meaningful message. Offer only: do not commit unless
   the owner says yes.
4. Tell the user what was accomplished and what is next.

## CRITICAL RULES

- NEVER start coding without knowing the current project state.
- NEVER make architectural decisions that contradict `docs/DECISIONS.md`.
- NEVER skip reading the relevant standards before a task.
- ALWAYS follow the security standards in `standard-security-fortress`. No exceptions.
- NEVER commit, push, or deploy without the owner's explicit instruction.
- If unsure about user intent, ASK. Do not assume.

## STARTER FILE SHAPES

The scaffold offered in the new project fallback, kept minimal on purpose.

`CLAUDE.md`:

```markdown
# [Project Name]

## Current Status
- Phase: [phase]
- Active task: [task]

## What's Been Completed
- [ ] [item]

## Key Decisions
| Date | Decision | Why |
|------|----------|-----|

Last Updated: [YYYY-MM-DD]
```

`docs/PROGRESS.md`: a checklist per phase, with notes on anything in progress or blocked.

`docs/DECISIONS.md`: one entry per decision, or an index of ADRs (see
`standard-architecture-decisions`).

`docs/INFRASTRUCTURE.md`: each external service, what it is used for, its setup status, the NAMES
of the env vars it needs, and where its credentials are stored. Never the secret values.

## RELATED SKILLS

- `standards-index`: every standard in the library with its trigger.
- `standard-architecture-decisions`: how to record a decision properly.
- `standard-guided-setup`: step-by-step help for an owner who does not code.
- `standard-git-workflow`: branching and commit message conventions.
- `acting-as-the-manager`: coordinating parallel agents and handoffs across sessions.
