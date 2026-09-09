#!/usr/bin/env python3
"""Stop hook: block if the last assistant message contains an em dash or en dash.

Stop hooks receive JSON on stdin including `transcript_path` (a JSONL file, one
message per line). We read the LAST assistant text and scan it for the dash
characters the user never wants. If found, we return decision:"block" with a
reason so the model rewrites the message without them.

Forbidden chars are defined by CODE POINT (not literal glyphs) so the script is
immune to the interpreter reading its own source under a non-UTF-8 codepage
(Windows cp1252). stdin is decoded as UTF-8 explicitly for the same reason.

Fail-open: any error (missing file, parse failure) exits 0 so the turn is never
wedged by a broken hook.
"""
import json
import sys

# Defined by code point so this source stays pure ASCII and cannot be corrupted
# by a non-UTF-8 codepage when the interpreter reads its own file.
FORBIDDEN = {
    chr(0x2014): "em dash (U+2014)",
    chr(0x2013): "en dash (U+2013)",
    chr(0x2015): "horizontal bar (U+2015)",
    chr(0x2012): "figure dash (U+2012)",
}


def read_stdin_utf8() -> str:
    data = sys.stdin.buffer.read()
    try:
        return data.decode("utf-8")
    except Exception:
        return data.decode("utf-8", "replace")


def main() -> int:
    try:
        payload = json.loads(read_stdin_utf8())
    except Exception:
        return 0  # fail-open

    if payload.get("stop_hook_active"):
        return 0  # already in a block/rewrite loop -> don't re-block

    path = payload.get("transcript_path")
    if not path:
        return 0

    try:
        last_assistant_text = ""
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                if row.get("type") != "assistant":
                    continue
                parts = row.get("message", {}).get("content", [])
                text = ""
                if isinstance(parts, list):
                    for p in parts:
                        if isinstance(p, dict) and p.get("type") == "text":
                            text += p.get("text", "")
                elif isinstance(parts, str):
                    text = parts
                if text.strip():
                    last_assistant_text = text
    except Exception:
        return 0  # fail-open

    found = [label for ch, label in FORBIDDEN.items() if ch in last_assistant_text]
    if not found:
        return 0

    reason = (
        "Your last message contains "
        + ", ".join(found)
        + ". The user does not allow these characters. Rewrite the message using "
        + "regular hyphens (-), commas, colons, or separate sentences instead. "
        + "Never use em dashes or en dashes."
    )
    sys.stdout.write(json.dumps({"decision": "block", "reason": reason}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
