# The `.claude` toolkit

A portable set of Claude Code **skills**, **slash commands**, and **safety hooks**
that you drop into any repository. Once installed, Claude in that repo already
knows your reusable systems (error-alert design, RLS security, query/page
performance, the money-truth doctrine, the review standards, and more) and is
guarded by the same hooks (no accidental commits/pushes/tree-destroys, no
em dashes, no broken AskUserQuestion calls).

This folder IS the toolkit. Copy it into a repo's `.claude/` and you are done.

---

## What is in here

| Folder / file | What it is |
|---|---|
| `skills/` | The skill library (one folder per skill, each with a `SKILL.md`). Includes `install-toolkit` (the installer skill) and reusable engineering + product + Stripe skills. |
| `commands/` | Slash commands (e.g. `/problem-cause-solution`). |
| `hooks/` | PreToolUse + Stop hooks (git-safety gate, no-em-dash, AskUserQuestion block, code-quality/security checks). Self-contained, no global setup needed. |
| `settings.json` | The Claude Code settings that wire the hooks and set permissions. The installer MERGES this into a target repo, it does not clobber. |
| `install.py` | The installer. Copies the three folders and merges `settings.json` into a target repo. |
| `README.md` | This file. |

The hooks require **Python on PATH as `py`** (Windows) or adjust the command to
`python3` (macOS/Linux). See "Non-Windows" below.

---

## Install it into a repo

You have two ways: ask the agent, or run the command yourself. Both do the same
thing.

### Option A - tell the agent (easiest)

In the repo you want to set up, say to Claude Code:

> install the toolkit

The agent runs the `install-toolkit` skill, which calls `install.py`. If the
toolkit is not already in that repo, tell the agent where it lives (a local path
like `c:\dev\.claude`, or the git URL you keep it at).

### Option B - run the installer yourself

From inside the repo you want to install INTO:

```bash
# if the toolkit already lives in this repo (updating in place):
py .claude/install.py .

# if the toolkit lives elsewhere on your machine:
py "C:/path/to/.claude/install.py" .

# the target defaults to the current directory, so this also works from the toolkit:
py install.py "C:/path/to/target-repo"
```

`.` means "the current repo". The script finds the SOURCE from its own location
and installs into `<target-repo>/.claude/`.

### Then

**Restart Claude Code** in the target repo so it loads the new hooks and skills.

---

## What the installer does (and does not do)

- **Copies** `skills/`, `commands/`, `hooks/` into `<repo>/.claude/`.
- **Merges** `settings.json`:
  - unions `permissions.allow`, `permissions.deny`, `additionalDirectories`
  - adds the toolkit's hooks (de-duped, so re-running never doubles them)
  - keeps every setting the repo already had
  - backs up the existing `settings.json` to `settings.json.bak-<timestamp>` first
- **Is idempotent**: safe to re-run to update. It refreshes files and de-dupes.
- **Never** deletes skills/commands the repo added itself, and never touches
  anything outside `<repo>/.claude/`.

---

## Keeping the toolkit somewhere your team can pull it (recommended)

Put this folder in its own **git repo** (e.g. GitHub). Then any developer, in any
project, can install or update it:

```bash
# one-time: clone the toolkit somewhere
git clone <toolkit-repo-url> C:/dev/claude-toolkit

# in any project, install/update from that clone:
py C:/dev/claude-toolkit/install.py .
```

To update everyone later: push changes to the toolkit repo, and each dev re-runs
`git pull` in their clone plus `py <clone>/install.py .` in their projects (or
just says "update the toolkit" to the agent). Because the merge is idempotent,
re-installing only refreshes and never duplicates.

If you prefer no git, each developer keeps a local copy at a known path (e.g.
`c:\dev\.claude`) and installs from there; they just have to update that copy
themselves.

---

## After installing: adapt the "design pattern" skills

Some skills describe a system you should BUILD, not one that already exists
(error-alert-system, security-rls-permissions, money-truth-doctrine, and the
"how it should be wired" sections of others). They open with an **"adapt before
use"** note. Once you build the real system in a repo, update that skill to name
the actual files/tables/functions so the next agent finds real code, not just the
pattern.

### Optional: turn on the database-write gate

`hooks/pretooluse_bash.py` can require an agent to re-attest it verified the live
schema before running a DB write. It is **off by default**. To enable it, add
your repo's SQL-runner script basename to `DB_RUNNER_SCRIPTS` at the top of that
file, e.g. `DB_RUNNER_SCRIPTS = ("run_sql.py",)`.

---

## Non-Windows machines

The hooks are invoked as `py "..."` in `settings.json` and inside
`pretooluse_powershell`-style comments. On macOS/Linux, `py` may not exist. Two
options:

1. Create a `py` shim: `alias py=python3` (or a small wrapper on PATH), or
2. After installing, edit the target repo's `.claude/settings.json` and replace
   `py ` with `python3 ` in each hook command.

`install.py` itself runs under either `py` or `python3`.

---

## Uninstall

Delete `<repo>/.claude/hooks/`, the toolkit's skills/commands you don't want, and
restore `settings.json` from the `settings.json.bak-<timestamp>` the installer
made. Since the toolkit lives entirely under `<repo>/.claude/`, removing it is
local and reversible.
