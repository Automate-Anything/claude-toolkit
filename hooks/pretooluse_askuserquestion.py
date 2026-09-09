#!/usr/bin/env python
"""PreToolUse hook: hard-block the AskUserQuestion tool.

PORTABLE / REPO-AGNOSTIC. The AskUserQuestion tool DOES NOT render in this
environment: the interactive question card never shows, so the user never sees
the questions and the agent stalls waiting for an answer that can't arrive.
Written instructions did not stop agents from using it. This hook is the wall:
wired in .claude/settings.json for this repo, it DENIES every AskUserQuestion
call and returns a message telling the agent to ask its question(s) as plain
text in the chat instead.

Matches both the built-in AskUserQuestion tool and any MCP-provided variant
(mcp__*__AskUserQuestion), per the matcher in settings.json.

Mechanism: print a PreToolUse decision with permissionDecision "deny" and exit
0. Coexists with any other hooks on the same matcher: a single "deny" from any
hook blocks the call.
"""

import json
import sys


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def main():
    try:
        sys.stdin.read()
    except Exception:
        pass

    deny(
        "The AskUserQuestion tool is DISABLED and does not work in this "
        "environment: its question card never renders, so the user NEVER sees "
        "the questions. Do NOT use it. Ask your question(s) directly in the "
        "chat as plain text (a short numbered list if there are several) and "
        "wait for the user's reply. This is a hard block, not a preference: "
        "retrying AskUserQuestion will always fail here."
    )


if __name__ == "__main__":
    main()
