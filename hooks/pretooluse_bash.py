"""
PreToolUse hook for Bash commands.

PORTABLE / REPO-AGNOSTIC. This hook is meant to be copied into any repo. It does
two universally-useful things and nothing repo-specific:

  1. Stops an agent from committing / pushing / destroying uncommitted work in
     the git tree on its own initiative (the git gates below). These apply to
     EVERY repo and need no configuration.

  2. OPTIONALLY gates database writes run through a SQL-runner script, so a first
     write is denied and the agent must re-attest it verified the live schema
     before re-running with `#confirmed`. This only fires if you tell it which
     script name(s) run your SQL, via DB_RUNNER_SCRIPTS below. Empty by default,
     so a fresh repo gets the git gates and no DB gate until you opt in.

To adapt to a new repo: usually you change NOTHING. If the repo runs SQL through
a script (e.g. `py scripts/run_sql.py x.sql`), add that script's basename to
DB_RUNNER_SCRIPTS.
"""
import sys
import os
import json
import re


# Basenames of the script(s) this repo uses to execute SQL. When a Bash command
# invokes one of these AND the SQL it would run is a write, the DB-write confirm
# gate fires. Leave empty to disable the DB gate entirely (git gates still run).
# Example: DB_RUNNER_SCRIPTS = ("execute_sql.py", "run_sql.py")
DB_RUNNER_SCRIPTS = ()


def _mentions_db_runner(command):
    return any(name in command for name in DB_RUNNER_SCRIPTS)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_input = data.get("tool_input", {})
    command = tool_input.get("command", "")

    if not command:
        sys.exit(0)

    # git branch -D (force delete) is handled by the working-tree gate below,
    # which offers the `#git-confirmed` escape. Keeping a separate hard block
    # here would fire first and leave no way through even with permission.

    # --- DB-WRITE AGENT-CONFIRM GATE (no human keypress) ---
    # The user is deliberately OUT of the loop on DB writes. A first (unconfirmed)
    # write attempt is DENIED and the byte-for-byte verification checklist is fed
    # back to the agent. To run it, the agent re-issues the SAME command with the
    # marker `#confirmed` appended, attesting it live-pulled and verified. That
    # applies uniformly to EVERY write including drops - there is intentionally no
    # human stop anywhere, so when the user has already told the agent to proceed,
    # nothing blocks it.
    #
    # `#confirmed` is a shell comment: bash ignores it and the SQL runner never
    # receives it as an argument, so nothing breaks.
    #
    #    The command is `... <sql-runner> <file.sql>`; whether it's a read or a
    #    write lives INSIDE the file, so we open the file and inspect.
    #    Read-only SQL (SELECT / EXPLAIN / WITH ... SELECT) stays silent.
    if _mentions_db_runner(command):
        try:
            is_write = _sql_command_is_write(command)
        except Exception:
            # Detection itself blew up → never silently run a possible write.
            is_write = True
        if is_write and not _has_confirm_marker(command):
            deny(_DB_WRITE_CONFIRM_CHECKLIST)
        # confirmed write, or read-only SQL → fall through to silent allow

    # 2a. GIT commands that can DESTROY UNCOMMITTED WORK.
    #     Same agent-confirm gate as the DB-write path above, for the same
    #     reason: this must be POSSIBLE (sometimes the user really does want it)
    #     but never ACCIDENTAL. The first attempt is denied and the agent is
    #     handed the warning; to proceed it re-issues the SAME command with
    #     `#git-confirmed` appended, attesting it has explicit user permission
    #     and has considered the other agents editing this tree.
    #
    #     Deliberately NOT `ask()`: this project runs in bypassPermissions mode
    #     where ask is auto-approved, so ask would be a no-op. deny+marker is
    #     the only thing that actually forces the agent to stop and think.
    if _is_tree_destroying_git(command) and not _has_git_confirm_marker(command):
        deny(_GIT_DESTRUCTIVE_MESSAGE)

    # 2b. GIT COMMIT: hard agent-confirm gate (deny + attestation marker).
    #    Agents have repeatedly committed on their own initiative and created
    #    problems. A commit is only legitimate when the USER explicitly authorized
    #    it. Same deny+marker mechanic as the DB-write and tree-destroy gates
    #    above (a soft `ask` is useless here: in bypassPermissions mode it is
    #    auto-approved, so the agent would just commit anyway - which is the exact
    #    problem this gate exists to stop). The FIRST commit attempt is DENIED and
    #    the agent is handed the authority question. To proceed, the agent must
    #    re-issue the SAME command with `#commit-approved` appended, attesting the
    #    user gave explicit permission. The marker is a shell comment, so it never
    #    changes what git actually runs.
    if _is_commit_git(command) and not _has_commit_approved_marker(command):
        deny(_GIT_COMMIT_APPROVAL_MESSAGE)

    # 2c. OTHER history/remote-mutating git (push / fetch / pull / merge / rebase).
    #    NOT hard-blocked: the user sometimes asks an agent to do these on purpose.
    #    'ask' lets the user approve on demand while stopping agents from doing
    #    them unprompted. Read-only git (status/log/diff/show/branch -l/etc.) is
    #    never matched here, so it stays silent. (commit is handled above and is
    #    excluded from this matcher.)
    if _is_mutating_git(command):
        ask(
            "This is a git operation that moves the branch or talks to the remote "
            "(push / fetch / pull / merge / rebase). Approve only if you intend the "
            "agent to run it."
        )

    sys.exit(0)


# SQL keywords that mutate schema or data. Word-boundary matched, case-insensitive.
_SQL_WRITE_RE = re.compile(
    r"\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|"
    r"comment\s+on|refresh\s+materialized|reindex|vacuum|cluster|"
    r"call|do\b|merge)\b",
    re.IGNORECASE,
)


def _sql_command_is_write(command):
    """
    Decide whether the SQL-runner invocation writes to the DB.

    The SQL we need to classify can come from two places, in priority order:

      1. INLINE in the SAME command. Agents very commonly do:
             cat > scratchpad/x.sql <<EOF
             SELECT ...
             EOF
             py scripts/run_sql.py scratchpad/x.sql
         At permission-check time the file does NOT exist yet (the `cat` part
         hasn't run), so reading it from disk would always fail. Instead we
         inspect the heredoc / redirected SQL embedded in the command itself.

      2. ON DISK. A pre-existing .sql file the command just runs.

    Only if we can find NEITHER do we fail safe to a prompt. A file that
    "can't be read" is almost always case 1 (created later in the same
    command), so we look at the inline SQL before giving up.
    """
    # --- Source 1: inline SQL embedded in the command ---------------------
    inline_sql = _extract_inline_sql(command)
    if inline_sql is not None:
        return _sql_text_is_write(inline_sql)

    # --- Source 2: a .sql file on disk -----------------------------------
    m = re.search(r"(\S+\.sql)", command)
    if not m:
        # No inline SQL and no file path at all → be safe, prompt.
        return True

    path = m.group(1).strip("'\"")
    if not os.path.isabs(path):
        root = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
        path = os.path.join(root, path)

    try:
        # Force UTF-8 so a Windows cp1252 default can't mangle the SQL.
        with open(path, "r", encoding="utf-8") as f:
            sql = f.read()
    except Exception:
        # No inline SQL AND the file isn't on disk. We genuinely can't see the
        # SQL, so don't silently run a possible write. Prompt.
        return True

    return _sql_text_is_write(sql)


def _extract_inline_sql(command):
    """
    Pull SQL embedded directly in the command, or None if there is none.
    Handles the two ways agents stage SQL inline:
      - heredoc:   cat > f.sql <<'EOF' ... EOF   (or <<EOF, <<-EOF)
      - redirect:  echo "SELECT ..." > f.sql / printf '...' > f.sql
    The heredoc body is the high-signal case and is what we key on.
    """
    # Heredoc: capture everything between the <<MARKER line and the closing MARKER.
    hd = re.search(
        r"<<-?\s*['\"]?(\w+)['\"]?\s*\n(.*?)\n\s*\1\b",
        command,
        re.DOTALL,
    )
    if hd:
        return hd.group(2)

    # echo/printf "... SELECT ..." > f.sql : grab the quoted payload before the redirect.
    rd = re.search(r"(?:echo|printf)\s+(['\"])(.*?)\1\s*>", command, re.DOTALL)
    if rd:
        return rd.group(2)

    return None


def _sql_text_is_write(sql):
    """True if the SQL text mutates schema or data (comments stripped first)."""
    sql_no_line = re.sub(r"--[^\n]*", "", sql)
    sql_clean = re.sub(r"/\*.*?\*/", "", sql_no_line, flags=re.DOTALL)
    return bool(_SQL_WRITE_RE.search(sql_clean))


# Mutating git verbs OTHER than commit (commit has its own hard gate below).
# We match the git subcommand, allowing for flags/options before it
# (e.g. `git -c core.pager=cat push`).
_GIT_MUTATING_RE = re.compile(
    r"\bgit\b(?:\s+-\S+(?:\s+\S+)?)*\s+(push|fetch|pull|merge|rebase|cherry-pick|revert)\b",
    re.IGNORECASE,
)


def _is_mutating_git(command):
    return bool(_GIT_MUTATING_RE.search(command))


# `git commit` in any form. Matches flags/options before the subcommand
# (e.g. `git -c user.name=x commit`, `git commit -m "..."`, `git commit --amend`).
_GIT_COMMIT_RE = re.compile(
    r"\bgit\b(?:\s+-\S+(?:\s+\S+)?)*\s+commit\b",
    re.IGNORECASE,
)


def _is_commit_git(command):
    return bool(_GIT_COMMIT_RE.search(command))


# Attestation marker for git commit. Like `#confirmed` / `#git-confirmed`, it is
# a shell comment, so appending it never alters what git actually runs.
_GIT_COMMIT_APPROVED_MARKER = "#commit-approved"


def _has_commit_approved_marker(command):
    return _GIT_COMMIT_APPROVED_MARKER in command


_GIT_COMMIT_APPROVAL_MESSAGE = """STOP. You are about to run `git commit`.

DID YOU GET AUTHORITY AND EXPLICIT PERMISSION FROM THE USER TO COMMIT?

  If NO  -> STOP. Do not commit. Do not look for another way around this.
            Tell the user what you have staged / changed and ASK them whether
            they want you to commit. Let them decide. Agents committing on their
            own initiative has repeatedly created problems: that is exactly what
            this gate exists to prevent.

  If YES -> the user explicitly told you to commit (in this conversation, in
            words like "commit", "commit it", "go ahead and commit"). Re-run the
            SAME command with `#commit-approved` appended.

What does NOT count as permission to commit:
  - The user asked you to make a code change (that is permission to EDIT, not to
    commit; leave the change staged/unstaged and ask).
  - A "yes"/"go ahead" from earlier in the conversation about a DIFFERENT action.
  - "do whatever you need to" / "fix it": that is not an instruction to commit.
  - Your own judgment that the work is "done" and "should" be committed.

`#commit-approved` is a shell comment, so appending it changes nothing about
what the command does. It exists solely to make committing a deliberate act that
you affirm the user authorized."""


# ---------------------------------------------------------------------------
# WORKING-TREE DESTROYERS -- hard deny, never `ask`.
# ---------------------------------------------------------------------------
# These verbs can silently discard UNCOMMITTED work. That is categorically
# different from commit/push (which only add history): there is often NO way to
# get the work back, and on a repo where several agents are editing the tree at
# once, one agent running `git stash` reverts EVERY OTHER AGENT'S in-flight
# edits too. Those agents are not watching and cannot restore themselves.
#
# WHY DENY AND NOT ASK: this project runs in bypassPermissions mode, where
# `ask` is auto-approved and therefore provides ZERO protection. Only an
# explicit deny actually stops the command. (This is exactly how the incident
# happened: `git stash push -- <6 files>` was run to compare a lint baseline,
# it reverted all six files, and it was pure luck the stash was recoverable.)
#
# The rule in CLAUDE.md is already absolute -- "NEVER run any write/destructive
# git command ... even if you're trying to resolve an extreme emergency" -- but
# a rule that is only written down is a rule that keeps getting broken. This
# makes it mechanical.
#
# If the USER genuinely wants one of these run, they run it themselves, or they
# say so and the agent relays that this hook must be temporarily edited. There
# is deliberately no bypass marker: an escape hatch is a thing agents reach for.
_GIT_TREE_DESTROYING_RE = re.compile(
    r"\bgit\b(?:\s+-\S+(?:\s+\S+)?)*\s+"
    r"(stash|reset|checkout|restore|clean|rm|switch|worktree\s+remove|"
    r"update-ref|filter-branch|reflog\s+delete|branch\s+-D|branch\s+-d)\b",
    re.IGNORECASE,
)

# Read-only escapes that merely CONTAIN a destroyer word but change nothing.
# `git stash list` / `git stash show` inspect; `git checkout --` with no paths
# is not here because it DOES revert. Keep this list minimal and provably safe.
_GIT_TREE_SAFE_RE = re.compile(
    r"\bgit\b(?:\s+-\S+(?:\s+\S+)?)*\s+"
    r"(stash\s+(list|show)|reflog(\s+show)?\s*$|reflog\s+show\b|worktree\s+list)\b",
    re.IGNORECASE,
)


def _is_tree_destroying_git(command):
    if _GIT_TREE_SAFE_RE.search(command):
        return False
    return bool(_GIT_TREE_DESTROYING_RE.search(command))


_GIT_DESTRUCTIVE_MESSAGE = """STOP. You are trying to do something that is NOT permitted by default.

This git command can DESTROY UNCOMMITTED WORK:
  stash, reset, checkout, restore, clean, rm, switch, worktree remove,
  update-ref, filter-branch, reflog delete, branch -D/-d

DID YOU GET SPECIAL PERMISSION FROM THE USER FOR THIS EXACT COMMAND?

  If NO  -> STOP. Do not run it. Do not look for another way around it.
            Tell the user what you wanted to run and why, and let them decide.

  If YES -> Re-run the SAME command with `#git-confirmed` appended.

BEFORE YOU DO, READ THIS:

  There are MANY OTHER AGENTS working in this repository right now, and they
  have UNCOMMITTED FILES in this same working tree. Whatever you do, be
  EXTREMELY CAREFUL not to create problems for their files.

  `git stash` reverts files ON DISK -- including files you never named, and
  including files another agent is editing this very second. That agent is not
  watching, will not notice, and CANNOT restore its own work. One careless
  command silently destroys hours of someone else's work.

  Before proceeding, check what is at risk:  git status --short

  This has already happened once: an agent ran `git stash push -- <6 files>`
  just to compare a lint baseline. It reverted all six. Recovery was luck.

ALMOST ALWAYS THERE IS A READ-ONLY WAY -- PREFER IT:

* Compare against the committed version?  git show HEAD:<path>
* See what you changed?                   git diff <path>
* Need a clean copy to lint/build?        copy it to your scratchpad and work
                                          on the copy. Never revert the tree.
* Undo your own edit?                     use the Edit tool to change it back.

`#git-confirmed` is a shell comment, so appending it changes nothing about what
the command actually does. It exists solely to make this a deliberate act."""


# Attestation marker for working-tree-destroying git. Mirrors the SQL
# `#confirmed` gate: a shell comment, so it never alters what bash runs.
_GIT_CONFIRM_MARKER = "#git-confirmed"


def _has_git_confirm_marker(command):
    return _GIT_CONFIRM_MARKER in command


# The agent's attestation marker. It's a shell comment, so bash ignores it and
# the SQL runner never receives it - appending it changes nothing about what runs.
_CONFIRM_MARKER = "#confirmed"


def _has_confirm_marker(command):
    return _CONFIRM_MARKER in command


# Fed back to the agent (as a deny reason) on a first, unconfirmed DB write.
_DB_WRITE_CONFIRM_CHECKLIST = (
    "DATABASE WRITE, CONFIRM BEFORE YOU RUN.\n\n"
    "Before you execute this migration, ask yourself: will this actually change "
    "anything in the database?\n\n"
    "If NO (read-only, SELECT / EXPLAIN): you can execute. Re-run the exact same "
    "command with #confirmed appended.\n\n"
    "If YES (it writes, alters, drops, replace, or inserts): STOP. You are not "
    "allowed to run this until you have pulled the LIVE schema of every table, "
    "function, or trigger this touches, straight from the database, NOT from a "
    "migration file, NOT from memory, NOT from earlier in this conversation. "
    "Verify it byte for byte to make sure it's 100% accurate: every column name, "
    "every type, every argument, every constraint in your SQL must match the live "
    "object exactly except what you are trying to change, obviously. A single wrong "
    "column name is a failed migration. Only once you have live-pulled and verified "
    "every byte, re-run the exact same command with #confirmed appended."
)


def block(reason):
    print(f"BLOCKED: {reason}", file=sys.stderr)
    sys.exit(2)


def deny(reason):
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(result))
    sys.exit(0)


def ask(reason):
    # The user NEVER wants a manual permission popup. So instead of prompting the
    # human ("ask"), we ALLOW the call and surface the specific warning to the
    # AGENT via additionalContext - the agent reads it, makes sure everything is
    # good, and proceeds. Hard blocks (block()/exit 2) and the DB-write self-
    # confirm gate (deny()) are unaffected; only this soft warning stops nagging
    # the human. (Note: a "permissionDecision: ask" would STILL pop up even in
    # bypassPermissions mode - that's exactly why this emits "allow" instead.)
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "additionalContext": reason,
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
