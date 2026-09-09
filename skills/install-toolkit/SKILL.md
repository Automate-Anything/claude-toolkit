---
name: install-toolkit
description: Install or update this shared agent toolkit (all the skills, commands, and safety rules) for a coding agent, either globally (every repo on this machine) or into the current repository. Works for Claude Code, Cursor, and Codex. Read and run this when the user says "install the toolkit", "install that package", "set it up globally", "add my skills to this repo", "install it for cursor/codex", "update the toolkit", or asks to bring the shared skills/rules into a repository or onto the machine. It runs the bundled install.py, which copies skills into each agent's folder and safely MERGES Claude's settings.json without clobbering.
---

# Install the agent toolkit

This toolkit is a portable set of skills, slash commands, safety hooks, and
cross-agent rules. It installs for **Claude Code, Cursor, and Codex** by running
the bundled `install.py`. Skills use the same `SKILL.md` format all three read;
the installer places them in each agent's own skills folder.

## First, locate the toolkit source

Find the folder that contains `install.py`. It is one of:
- **Already in this repo** at `.claude/install.py` (updating in place).
- **A known local path** the user keeps it at (commonly `c:\dev\.claude`).
- **A clone of the toolkit repo**: `https://github.com/getconversationalai/claude-toolkit`
  (private). If it is not on disk, clone it first:
  `git clone https://github.com/getconversationalai/claude-toolkit C:/dev/claude-toolkit`

## Then pick the command

There are two scopes. Ask the user which they want if it is not clear.

**Global (every repo on this machine):**
```bash
py "<toolkit>/install.py" --global
```
Installs into `~/.claude`, `~/.cursor`, `~/.codex`.

**One specific repository:**
```bash
py "<toolkit>/install.py" .            # run from inside the repo
py "<toolkit>/install.py" C:/path/to/repo
```
Installs into that repo's `.claude`, `.cursor`, `.codex` (plus an `AGENTS.md` at
the repo root for Cursor/Codex).

**Pick specific agents (optional).** Default is all three. Narrow with `--agent`:
```bash
py "<toolkit>/install.py" --global --agent claude
py "<toolkit>/install.py" . --agent cursor,codex
```
Valid: `claude`, `cursor`, `codex`, `all`.

## What it does (safe + idempotent)

- Copies `skills/` into each agent's skills dir (`.claude/skills`,
  `.cursor/skills-cursor`, `.codex/skills`).
- Claude Code also gets `commands/`, `hooks/`, and a MERGED `settings.json`
  (unions permissions, adds hooks, backs up the old one first, never clobbers).
- Cursor/Codex get an `AGENTS.md` carrying the same rules the hooks enforce
  (never overwrites an existing `AGENTS.md`).
- Re-running only refreshes and de-dupes: it never doubles a hook or permission.

## After installing

- Tell the user to **restart the agent(s)** so they load the new skills (and, for
  Claude Code, the hooks).
- Note that skills describing a system to BUILD (error alerts, RLS, the
  money-truth doctrine, etc.) carry an "adapt before use" header, and should be
  updated once the real system exists in the repo.
- If the repo has a SQL runner and the user wants the database-write confirmation
  gate (Claude Code only), tell them to add its basename to `DB_RUNNER_SCRIPTS` at
  the top of `.claude/hooks/pretooluse_bash.py` (empty by default, so the gate is
  off until they opt in).
