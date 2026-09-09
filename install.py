#!/usr/bin/env python3
"""
install.py - install this portable agent toolkit (skills + commands + hooks +
cross-agent rules) for one or more coding agents, either GLOBALLY (every repo on
this machine) or into a SPECIFIC repository. Safe and idempotent.

--------------------------------------------------------------------------------
QUICK REFERENCE

  py install.py --global                 # all agents, this whole machine
  py install.py .                        # all agents, the current repo
  py install.py /path/to/repo            # all agents, that repo
  py install.py --global --agent codex   # just Codex, globally
  py install.py . --agent claude         # just Claude Code, current repo

  --agent may be repeated or comma-listed: --agent claude,cursor
  agents: claude | cursor | codex | all   (default: all)
--------------------------------------------------------------------------------

WHAT GETS INSTALLED, PER AGENT

  Skills are the same SKILL.md format for every agent; only the directory differs:
    claude -> <root>/.claude/skills
    cursor -> <root>/.cursor/skills-cursor
    codex  -> <root>/.codex/skills

  Claude Code ALSO gets its commands/, hooks/, and a MERGED settings.json (which
  wires the hooks and permissions). Cursor and Codex do not run Claude's hooks, so
  instead they get an AGENTS.md carrying the same rules as instructions.

  <root> is the user's home directory for --global, or the repo path otherwise.

SAFE + IDEMPOTENT
  - Never clobbers: settings.json is merged (unioned + de-duped), and a timestamped
    backup is made first. AGENTS.md is only written if absent (never overwritten).
  - Re-running refreshes files and de-dupes; it never doubles anything.
  - Only ever writes under the agent's own config dir (.claude / .cursor / .codex)
    and, for cursor/codex, an AGENTS.md at <root>.
"""
import json
import os
import shutil
import sys
from datetime import datetime

SOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_FILE = "settings.json"

# Per-agent config: where its config dir lives (relative to <root>) and where its
# skills go inside that dir. Skills are portable across all three.
AGENTS = {
    "claude": {"dir": ".claude", "skills": "skills"},
    "cursor": {"dir": ".cursor", "skills": "skills-cursor"},
    "codex":  {"dir": ".codex",  "skills": "skills"},
}
ALL_AGENTS = list(AGENTS.keys())


def log(msg):
    print(msg)


# --------------------------------------------------------------------------- #
# Argument parsing
# --------------------------------------------------------------------------- #
def parse_args(argv):
    agents, is_global, target_path = [], False, None
    i = 1
    while i < len(argv):
        a = argv[i]
        if a in ("--global", "-g"):
            is_global = True
        elif a in ("--agent", "-a"):
            i += 1
            agents += [x.strip().lower() for x in argv[i].split(",") if x.strip()]
        elif a.startswith("--agent="):
            agents += [x.strip().lower() for x in a.split("=", 1)[1].split(",") if x.strip()]
        elif a in ("--help", "-h"):
            print(__doc__)
            sys.exit(0)
        else:
            target_path = a
        i += 1

    if not agents or "all" in agents:
        agents = list(ALL_AGENTS)
    unknown = [x for x in agents if x not in AGENTS]
    if unknown:
        log(f"Unknown agent(s): {', '.join(unknown)}. Valid: {', '.join(ALL_AGENTS)}, all.")
        sys.exit(1)
    # de-dupe, keep order
    agents = list(dict.fromkeys(agents))

    if is_global and target_path:
        log("Pass EITHER --global OR a repo path, not both.")
        sys.exit(1)

    if is_global:
        root = os.path.expanduser("~")
    else:
        root = os.path.abspath(target_path or ".")

    return agents, root, is_global


# --------------------------------------------------------------------------- #
# Copying
# --------------------------------------------------------------------------- #
def copy_tree(src, dst):
    """Copy every file under src into dst (skipping caches). Returns file count."""
    if not os.path.isdir(src):
        return 0
    os.makedirs(dst, exist_ok=True)
    n = 0
    for root, _dirs, files in os.walk(src):
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
    return n


# --------------------------------------------------------------------------- #
# settings.json merge (Claude Code only)
# --------------------------------------------------------------------------- #
def _dedupe(seq):
    seen, out = set(), []
    for x in seq:
        key = json.dumps(x, sort_keys=True) if isinstance(x, (dict, list)) else x
        if key not in seen:
            seen.add(key)
            out.append(x)
    return out


def _merge_permissions(base, incoming):
    base, inc = base or {}, incoming or {}
    out = dict(base)
    for key in ("allow", "deny", "additionalDirectories"):
        merged = list(base.get(key, [])) + list(inc.get(key, []))
        if merged:
            out[key] = _dedupe(merged)
    if "defaultMode" not in out and "defaultMode" in inc:
        out["defaultMode"] = inc["defaultMode"]
    return out


def _hook_command(entry):
    return tuple(sorted(h.get("command", "") for h in entry.get("hooks", [])))


def _merge_hooks(base, incoming):
    base, inc = base or {}, incoming or {}
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


def merge_settings(claude_dir):
    src = os.path.join(SOURCE_DIR, SETTINGS_FILE)
    if not os.path.isfile(src):
        return
    with open(src, "r", encoding="utf-8") as f:
        incoming = json.load(f)

    dst = os.path.join(claude_dir, SETTINGS_FILE)
    base = {}
    if os.path.isfile(dst):
        with open(dst, "r", encoding="utf-8") as f:
            try:
                base = json.load(f)
            except Exception:
                base = {}
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(dst, f"{dst}.bak-{stamp}")
        log(f"    backed up existing settings.json -> settings.json.bak-{stamp}")

    merged = dict(base)
    merged["permissions"] = _merge_permissions(base.get("permissions"), incoming.get("permissions"))
    merged["hooks"] = _merge_hooks(base.get("hooks"), incoming.get("hooks"))
    for k, v in incoming.items():
        if k not in ("permissions", "hooks") and k not in merged:
            merged[k] = v

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)
        f.write("\n")
    log("    merged settings.json")


def write_agents_md(root):
    """Place AGENTS.md at <root> for cursor/codex, only if not already present."""
    src = os.path.join(SOURCE_DIR, "AGENTS.md")
    if not os.path.isfile(src):
        return
    dst = os.path.join(root, "AGENTS.md")
    if os.path.exists(dst):
        log("    AGENTS.md already exists here - left untouched (rules also live in skills/)")
        return
    shutil.copy2(src, dst)
    log("    wrote AGENTS.md (cross-agent rules)")


# --------------------------------------------------------------------------- #
# Per-agent install
# --------------------------------------------------------------------------- #
def install_agent(agent, root):
    cfg = AGENTS[agent]
    agent_dir = os.path.join(root, cfg["dir"])
    log(f"  {agent}: {agent_dir}")

    # 1. Skills (all agents).
    n = copy_tree(os.path.join(SOURCE_DIR, "skills"), os.path.join(agent_dir, cfg["skills"]))
    log(f"    copied {n} skill files -> {cfg['skills']}/")

    if agent == "claude":
        # 2. Commands + hooks (Claude Code only).
        nc = copy_tree(os.path.join(SOURCE_DIR, "commands"), os.path.join(agent_dir, "commands"))
        if nc:
            log(f"    copied {nc} command file(s)")
        nh = copy_tree(os.path.join(SOURCE_DIR, "hooks"), os.path.join(agent_dir, "hooks"))
        if nh:
            log(f"    copied {nh} hook file(s)")
        # 3. Merge settings.json (wires the hooks + permissions).
        merge_settings(agent_dir)
    else:
        # Cursor / Codex do not run Claude's hooks: carry the rules via AGENTS.md.
        write_agents_md(root)


def guard(agents, root, is_global):
    """Refuse to install the toolkit on top of its own source folder."""
    if not is_global:
        claude_target = os.path.join(root, ".claude")
        if os.path.abspath(claude_target) == os.path.abspath(SOURCE_DIR):
            log("Target .claude is the toolkit's own source folder. Nothing to do.")
            log("Run this from INSIDE the repo you want to install into, or pass --global.")
            sys.exit(1)


def main():
    agents, root, is_global = parse_args(sys.argv)
    guard(agents, root, is_global)

    scope = "GLOBALLY (every repo on this machine)" if is_global else f"into {root}"
    log(f"Installing toolkit for [{', '.join(agents)}] {scope}")
    log(f"  from: {SOURCE_DIR}")
    for agent in agents:
        install_agent(agent, root)

    log("")
    log("Done. Restart the agent(s) so they pick up the new skills.")
    if "claude" in agents:
        log("Claude Code also loaded the hooks (git-safety, no-em-dash, quality checks).")
    if any(a in agents for a in ("cursor", "codex")):
        log("Cursor/Codex read the rules from AGENTS.md and skills from their skills dir.")
    log("Skills that describe a system to BUILD carry an 'adapt before use' note.")


if __name__ == "__main__":
    main()
