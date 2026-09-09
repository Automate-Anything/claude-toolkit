# The agent toolkit

A portable set of **skills**, **slash commands**, **safety hooks**, and
**cross-agent rules** that you install for any coding agent, either globally (every
repo on your machine) or into one specific repository. Once installed, the agent
already knows your reusable systems (error-alert design, RLS security, query/page
performance, the money-truth doctrine, SEO, the review standards, and more) and
follows the same rules (no accidental commits/pushes/tree-destroys, no em dashes,
verify a DB write against the live schema first).

It works for **Claude Code, Cursor, and Codex** (and any other agent that reads an
`AGENTS.md`). Skills use the same `SKILL.md` format all three understand; the
installer just puts them in each agent's own skills folder.

This folder IS the toolkit. `install.py` copies it where each agent looks.

---

## What is in here

| Folder / file | What it is |
|---|---|
| `skills/` | The skill library (one folder per skill, each with a `SKILL.md`). Portable across Claude Code, Cursor, and Codex. |
| `commands/` | Slash commands (e.g. `/problem-cause-solution`). Claude Code. |
| `hooks/` | PreToolUse + Stop hooks (git-safety gate, no-em-dash, AskUserQuestion block, code-quality/security checks). Claude Code only. Self-contained, no global setup needed. |
| `settings.json` | Claude Code settings that wire the hooks and set permissions. The installer MERGES this, it does not clobber. |
| `AGENTS.md` | The same rules as the hooks, written as instructions, for agents that do not run Claude's hooks (Cursor, Codex). |
| `install.py` | The installer. Handles all agents and both scopes (global / one repo). |
| `README.md` | This file. |

The hooks require **Python on PATH as `py`** (Windows) or adjust to `python3`
(macOS/Linux). See "Non-Windows" below. `install.py` runs under either.

---

## Install it

There are **two commands**: install **globally** (applies to every repo on this
machine) or install into **one specific repository**. Each works for all agents at
once, or a single agent you name.

### 1. Install globally (every repo on this machine)

```bash
py /path/to/toolkit/install.py --global
```

This installs into your home directory for each agent:
`~/.claude/`, `~/.cursor/`, `~/.codex/`.

### 2. Install into a specific repository

```bash
# run from inside the repo you want to set up:
py /path/to/toolkit/install.py .

# or name the repo:
py /path/to/toolkit/install.py C:/path/to/repo
```

This installs into that repo's `.claude/`, `.cursor/`, `.codex/` (plus an
`AGENTS.md` at the repo root for Cursor/Codex).

### Pick specific agents (optional)

By default it installs for **all** agents. To target one or some, add `--agent`:

```bash
py install.py --global --agent claude          # just Claude Code, globally
py install.py . --agent cursor,codex           # Cursor + Codex, this repo
```
Valid agents: `claude`, `cursor`, `codex`, `all` (default).

### Or just tell the agent

In a repo that already has the toolkit (or that can reach a clone of it), say:

> install the toolkit

The agent runs the `install-toolkit` skill, which calls `install.py`.

### Then

**Restart the agent** so it picks up the new skills (and, for Claude Code, hooks).

---

## What the installer does per agent

| Agent | Skills go to | Also gets |
|---|---|---|
| **Claude Code** | `.claude/skills/` | `.claude/commands/`, `.claude/hooks/`, and a MERGED `.claude/settings.json` that wires the hooks |
| **Cursor** | `.cursor/skills-cursor/` | `AGENTS.md` at the root (the rules the hooks enforce, as instructions) |
| **Codex** | `.codex/skills/` | `AGENTS.md` at the root |

- **Merges, never clobbers.** `settings.json` unions `permissions.allow`/`deny`/
  `additionalDirectories` and adds the hooks, keeping everything the target had.
  It backs up the old `settings.json` to `settings.json.bak-<timestamp>` first.
- **Never overwrites an existing `AGENTS.md`** (if the repo already has one, it is
  left alone; the rules also live in the skills).
- **Is idempotent.** Safe to re-run to update: it refreshes files and de-dupes, so
  it never doubles a hook or a permission.
- **Only writes** under each agent's config dir (`.claude` / `.cursor` / `.codex`)
  and the root `AGENTS.md`. It never deletes skills the target added itself.

> **Why Cursor and Codex get `AGENTS.md` instead of hooks:** Claude Code's hooks
> are Python scripts Claude runs before a tool call. Cursor and Codex do not run
> them. So the toolkit gives those agents the same intent (no em dashes, do not
> commit/push on your own, verify DB writes, do not swallow errors) as written
> rules in `AGENTS.md`, which both agents read automatically.

---

## Keeping the toolkit somewhere your team can pull it (recommended)

This toolkit lives at **https://github.com/getconversationalai/claude-toolkit**
(private). Any developer with access can install or update it in any project:

```bash
# one-time: clone the toolkit somewhere
git clone https://github.com/getconversationalai/claude-toolkit C:/dev/claude-toolkit

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

The Claude Code hooks are invoked as `py "..."` in `settings.json`. On macOS/Linux
`py` may not exist. Two options:

1. Create a `py` shim: `alias py=python3` (or a small wrapper on PATH), or
2. After installing, edit `.claude/settings.json` and replace `py ` with
   `python3 ` in each hook command.

`install.py` itself runs under either `py` or `python3`. (Cursor/Codex do not run
the hooks, so this only affects Claude Code.)

---

## Uninstall

Everything the installer wrote lives under the agent config dirs
(`.claude` / `.cursor` / `.codex`) and the root `AGENTS.md`. To remove: delete the
toolkit's skills from each agent's skills folder, delete `.claude/hooks/`, restore
`.claude/settings.json` from its `settings.json.bak-<timestamp>`, and delete
`AGENTS.md` if the toolkit created it. All of it is local and reversible.
