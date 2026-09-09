---
name: install-toolkit
description: Install this shared .claude toolkit (all the skills, commands, and safety hooks) into the CURRENT repository, or update it if already installed. Read and run this when the user says "install the toolkit", "install that package", "set up the .claude toolkit here", "add my skills to this repo", "update the toolkit", or asks to bring the shared skills/hooks into a new repository. It runs the bundled install.py, which copies skills/commands/hooks and safely MERGES settings.json without clobbering anything the repo already has.
---

# Install the .claude toolkit into this repo

This toolkit is a portable set of skills, slash commands, and PreToolUse/Stop
safety hooks meant to be dropped into any repository. This skill installs (or
updates) it in the CURRENT repo by running the bundled `install.py`.

## What "install" does

- Copies `skills/`, `commands/`, `hooks/` into `<repo>/.claude/`.
- MERGES `settings.json` into `<repo>/.claude/settings.json`: it unions the
  permissions + additionalDirectories and adds the toolkit's hooks, keeping
  everything the repo already had. It backs up the existing settings first.
- Is safe to re-run (idempotent): re-running refreshes files and de-dupes the
  merge, so it doubles nothing.

It never deletes skills/commands the repo added on its own, and never touches
anything outside `<repo>/.claude/`.

## How to run it

First, locate the toolkit source (the folder that contains `install.py`). It is
one of:
- **Already in this repo** at `.claude/install.py` (the user is updating in place).
- **A sibling/known local path** the user keeps the toolkit at (ask if unsure;
  the common one is `c:\dev\.claude`).
- **A git repo** the user cloned (the toolkit's own repository).

Then run, from the repo you want to install INTO:

```bash
# toolkit already in this repo (update in place):
py .claude/install.py .

# toolkit lives elsewhere on disk:
py "<toolkit-path>/install.py" .
```

`.` means "install into the current repo". The script figures out the source
from its own location and merges into `<current-repo>/.claude/`.

## After installing

- Tell the user to **restart Claude Code** in this repo so it loads the new
  hooks and skills.
- Point out that skills describing a system to build (error alerts, RLS
  security, the money-truth doctrine, etc.) carry an "adapt before use" header:
  they describe how things SHOULD be wired, and should be updated once the real
  system exists in this repo.
- If the repo has a SQL runner script and the user wants the database-write
  confirmation gate, tell them to add its basename to `DB_RUNNER_SCRIPTS` at the
  top of `.claude/hooks/pretooluse_bash.py` (empty by default, so the gate is
  off until they opt in).

## If the user is setting up a brand-new machine

The toolkit is self-contained: the no-em-dash Stop hook and the AskUserQuestion
block ship inside `hooks/` and are wired by the merged `settings.json`, so a
developer with no global `~/.claude` hooks still gets them per-repo after install.
