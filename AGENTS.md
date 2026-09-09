# Agent instructions (toolkit)

This file carries the cross-agent rules and skill index for coding agents that do
not run Claude Code's hooks (Cursor, Codex, and any other agent that reads an
`AGENTS.md`). Claude Code enforces these same rules mechanically through hooks;
here they are written as instructions so every agent follows them.

## Rules every agent must follow

- **Never use em dashes or en dashes** (the `-` and `-` characters, U+2014 / U+2013).
  Use regular hyphens, commas, colons, or separate sentences. This applies to
  every message and every file you write.
- **Never commit, push, or run history/tree-changing git** (`git commit`, `push`,
  `reset`, `checkout -- `, `stash`, `clean`, `rebase`, `merge`, `branch -D`) on
  your own initiative. Do it only when the user explicitly asks in that
  conversation. Making a code change is permission to EDIT, not to commit.
- **Do not run destructive shell commands** (`rm -rf`, force-delete, mass
  overwrite) unless the user explicitly asked for that exact action.
- **Before a database write** (a migration, an `INSERT`/`UPDATE`/`DELETE`/`DROP`),
  pull the LIVE schema of every table/function/trigger it touches and verify your
  SQL against it byte for byte. Migration files and memory drift; only the live
  database is truth.
- **Do not ask via a popup/interactive question tool.** Ask your questions as
  plain text in the chat and wait for the reply.
- **A swallowed error must be surfaced.** A catch block or DB exception handler in
  a backend path (webhook, cron, route, job) that logs but never reports the
  failure is a silent production bug. Report it, or mark it a conscious benign
  catch. See the `error-alert-system` skill.

## Skills

The skills live in the sibling `skills/` folder (one folder per skill, each with a
`SKILL.md`). They are the same format Claude Code, Cursor, and Codex all read.
Before doing work a skill covers, read that skill first. Highlights:

- Engineering standards: `page-performance`, `query-efficiency`,
  `security-rls-permissions`, `report-verification`, `error-alert-system`.
- Product judgment + review: `build-with-the-user-in-mind`, `review-build`,
  `acting-as-the-manager`.
- Money paths: `money-truth-doctrine`.
- Growth: `seo`.
- Platform: `apple-app-store-submission`, `browser-verification`, `media-review`,
  `claude-model-skill`.
- Stripe: `stripe-best-practices`, `stripe-docs`, `stripe-directory`,
  `stripe-projects`, `connect-recommend`, `upgrade-stripe`.
- Design: `ui-ux-pro-max`.
- Authoring: `skill-creator` (write, improve, and eval-test new skills; follow its house
  conventions, including the no-em-dash rule).
- `install-toolkit`: how to install/update this toolkit in a repo.

Skills that describe a system to BUILD (error alerts, RLS, the money-truth
doctrine, and "how it should be wired" sections) carry an "adapt before use" note.
They describe how things SHOULD be wired; update them once the real system exists
in this repo.
