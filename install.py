#!/usr/bin/env python3
"""
install.py - install this .claude toolkit (skills + commands + hooks + settings)
into a target repository, safely and idempotently.

WHAT IT DOES
  - Copies  skills/  commands/  hooks/  into  <target>/.claude/
  - MERGES  settings.json  into  <target>/.claude/settings.json  (never clobbers:
    it unions permissions + additionalDirectories and adds our hooks, keeping
    everything the target repo already had). A timestamped backup is made first.
  - Is safe to re-run: copying refreshes files, the merge de-dupes.

WHAT IT DOES NOT DO
  - It does not touch anything outside <target>/.claude/.
  - It does not delete skills/commands the target added on its own.

USAGE
  # from inside the toolkit folder, install into the current repo:
  py install.py /path/to/target-repo

  # or, if you run it from inside the target repo and the toolkit is elsewhere:
  py /path/to/toolkit/.claude/install.py .

  # default target is the current working directory:
  py install.py

The SOURCE is the folder this script lives in. The TARGET is the repo you name
(or the current directory). See README.md for the full guide.
"""
import json
import os
import shutil
import sys
from datetime import datetime

SOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
COPY_DIRS = ("skills", "commands", "hooks")
SETTINGS_FILE = "settings.json"


def log(msg):
    print(msg)


def resolve_target(argv):
    target = argv[1] if len(argv) > 1 else "."
    target = os.path.abspath(target)
    # If they pointed at a repo root, we install into <repo>/.claude.
    # If they pointed straight at a .claude dir, use it as-is.
    if os.path.basename(target) == ".claude":
        return target
    return os.path.join(target, ".claude")


def guard(target_claude):
    """Refuse to install a toolkit into itself."""
    if os.path.abspath(target_claude) == os.path.abspath(SOURCE_DIR):
        log("Target is the toolkit's own folder. Nothing to do (this IS the source).")
        sys.exit(1)


def copy_dirs(target_claude):
    for d in COPY_DIRS:
        src = os.path.join(SOURCE_DIR, d)
        if not os.path.isdir(src):
            continue
        dst = os.path.join(target_claude, d)
        os.makedirs(dst, exist_ok=True)
        n = 0
        for root, _dirs, files in os.walk(src):
            # skip python caches
            if "__pycache__" in root:
                continue
            rel = os.path.relpath(root, src)
            out_root = os.path.join(dst, rel) if rel != "." else dst
            os.makedirs(out_root, exist_ok=True)
            for f in files:
                if f.endswith(".pyc"):
                    continue
                shutil.copy2(os.path.join(root, f), os.path.join(out_root, f))
                n += 1
        log(f"  copied {d}/  ({n} files)")


def _dedupe(seq):
    seen, out = set(), []
    for x in seq:
        key = json.dumps(x, sort_keys=True) if isinstance(x, (dict, list)) else x
        if key not in seen:
            seen.add(key)
            out.append(x)
    return out


def _merge_permissions(base, incoming):
    base = base or {}
    inc = incoming or {}
    out = dict(base)
    for key in ("allow", "deny", "additionalDirectories"):
        merged = list(base.get(key, [])) + list(inc.get(key, []))
        if merged:
            out[key] = _dedupe(merged)
    # defaultMode: only set ours if the target hasn't chosen one.
    if "defaultMode" not in out and "defaultMode" in inc:
        out["defaultMode"] = inc["defaultMode"]
    return out


def _hook_command(entry):
    hooks = entry.get("hooks", [])
    return tuple(sorted(h.get("command", "") for h in hooks))


def _merge_hooks(base, incoming):
    """Union hook groups per event, de-duping by matcher+command so re-running
    or installing over an existing toolkit never doubles a hook."""
    base = base or {}
    inc = incoming or {}
    out = {k: list(v) for k, v in base.items()}
    for event, groups in inc.items():
        existing = out.setdefault(event, [])
        existing_keys = {(g.get("matcher", ""), _hook_command(g)) for g in existing}
        for g in groups:
            key = (g.get("matcher", ""), _hook_command(g))
            if key not in existing_keys:
                existing.append(g)
                existing_keys.add(key)
    return out


def merge_settings(target_claude):
    src = os.path.join(SOURCE_DIR, SETTINGS_FILE)
    if not os.path.isfile(src):
        return
    with open(src, "r", encoding="utf-8") as f:
        incoming = json.load(f)

    dst = os.path.join(target_claude, SETTINGS_FILE)
    if os.path.isfile(dst):
        with open(dst, "r", encoding="utf-8") as f:
            try:
                base = json.load(f)
            except Exception:
                base = {}
        # back up the existing settings before we touch them
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{dst}.bak-{stamp}"
        shutil.copy2(dst, backup)
        log(f"  backed up existing settings -> {os.path.basename(backup)}")
    else:
        base = {}

    merged = dict(base)
    merged["permissions"] = _merge_permissions(base.get("permissions"), incoming.get("permissions"))
    merged["hooks"] = _merge_hooks(base.get("hooks"), incoming.get("hooks"))
    # carry over any other top-level keys we ship that the target lacks
    for k, v in incoming.items():
        if k not in ("permissions", "hooks") and k not in merged:
            merged[k] = v

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)
        f.write("\n")
    log(f"  merged {SETTINGS_FILE}")


def main():
    target_claude = resolve_target(sys.argv)
    guard(target_claude)
    os.makedirs(target_claude, exist_ok=True)

    log(f"Installing toolkit")
    log(f"  from: {SOURCE_DIR}")
    log(f"  into: {target_claude}")
    copy_dirs(target_claude)
    merge_settings(target_claude)

    log("")
    log("Done. Restart Claude Code in the target repo so it picks up the new")
    log("hooks and skills. The skills that describe a system to build (error")
    log("alerts, RLS, etc.) carry an 'adapt before use' note at the top.")


if __name__ == "__main__":
    main()
