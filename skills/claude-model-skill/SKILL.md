---
name: claude-model-skill
description: Set up the owner's preferred Claude Code model configuration on ANY computer or repository. Read this when the owner says "set up my models", "make Opus 4.8 the default", "fix the model picker", "I don't see Opus 4.8", "apply my model settings", "hide Opus 5", or hands this skill to a fresh machine/agent. It writes the global ~/.claude/settings.json so the default model is Opus 4.8 (1M context) and the /model picker shows exactly Opus 4.8, Sonnet 5, Haiku 4.5, Fable 5, Fable 5.1 in that order, with Opus 5 removed. Ships a portable script (apply_model_settings.py) so the agent does it in one command, plus the manual JSON and the rules for user vs project scope.
---

# Claude Model Skill

Owner preference: **Opus 4.8 (1M context) is the default model**, and the
`/model` picker shows **only** these rows, in this order:

1. Opus 4.8 (1M context)
2. Sonnet 5
3. Haiku 4.5
4. Fable 5 (1M context)
5. Fable 5.1 (1M context)

**Opus 5 is deliberately excluded.** Do not add it back.

## Fastest path: run the script (one command)

The script lives next to this file. It edits the GLOBAL user settings file,
backs up the old one, only touches the three model keys, and validates the JSON.

```bash
# Windows
py "C:/Users/<user>/.claude/skills/claude-model-skill/apply_model_settings.py"
# macOS / Linux
python3 ~/.claude/skills/claude-model-skill/apply_model_settings.py
```

Then tell the owner to reload the VS Code window (or restart the CLI session).
Verify by opening `/model`: the five rows above should appear and nothing else.

## Where the setting lives (user vs project scope)

| File | Scope | Use it for |
|---|---|---|
| `~/.claude/settings.json` (Windows: `C:\Users\<user>\.claude\settings.json`) | This computer, every repository | **The default. This is what the script writes.** |
| `<repo>/.claude/settings.json` | One repository, committed and shared with the team | Only if a team wants to force a lineup for one repo |
| `<repo>/.claude/settings.local.json` | One repository, this computer only (git-ignored) | Rarely needed |

Key facts from the Claude Code docs (`https://code.claude.com/docs/en/model-config.md`
and `settings-reference.md`):

- `model` and `availableModels` work in ANY of the files above.
- `modelPicker` is **user or managed scope only**. It is ignored in a project
  file. So a project-level setup can filter the picker (`availableModels`) but
  cannot set custom labels or order. That is why the global file is the right home.
- `availableModels` entries may be a family alias (`opus`), a version prefix
  (`claude-fable-5`, which also permits Fable 5.1), or a full ID. A `[1m]`
  suffix is stripped before matching, so it is harmless in the allowlist.
- `availableModels` only hides rows. `modelPicker` REPLACES the built-in rows
  and its array order is the display order. Both are needed for this lineup.
- `enforceAvailableModels` is for managed/enterprise settings. Not needed here.

## The exact JSON (if applying by hand)

Merge these three keys into the settings file. Preserve every other key
(permissions, hooks, plugins, theme, etc.). Read and write the file as UTF-8.

```json
{
  "model": "claude-opus-4-8[1m]",
  "availableModels": [
    "claude-opus-4-8[1m]",
    "claude-sonnet-5",
    "claude-haiku-4-5",
    "claude-fable-5"
  ],
  "modelPicker": [
    { "value": "claude-opus-4-8[1m]", "label": "Opus 4.8 (1M context)", "description": "Opus 4.8 with 1M context" },
    { "value": "claude-sonnet-5", "label": "Sonnet 5", "description": "Efficient for routine tasks" },
    { "value": "claude-haiku-4-5", "label": "Haiku 4.5", "description": "Fastest for quick answers" },
    { "value": "claude-fable-5[1m]", "label": "Fable 5 (1M context)", "description": "Fable 5 with 1M context" },
    { "value": "claude-fable-5-1[1m]", "label": "Fable 5.1 (1M context)", "description": "Most capable for your hardest and longest-running tasks" }
  ]
}
```

After writing, re-parse the file as JSON to prove it is valid before reporting done.

## Why Opus 4.8 "disappeared" (so you can explain it)

After the Claude 5 release the built-in picker moved to Opus 5 / Fable 5.1 /
Sonnet 5 / Haiku 4.5. Opus 4.8 (`claude-opus-4-8`) is still a valid, selectable
model; it just lost its built-in picker row. Trust that the ID is valid even if
it is not in the built-in list. It is being phased out gradually (some newer
tools are unavailable on it) but no end-of-life date is published.

## Side effects the owner accepted

- `/fast` refuses to toggle if it would move the session onto Opus 5, because
  Opus 5 is outside the allowlist.
- `/model opus` resolves to Opus 4.8 (the newest permitted Opus).
- Subagents or skills that request a blocked model run on a fallback model
  instead of failing.

## Sharing this skill with another computer or repository

- **Another computer (recommended):** copy the whole folder
  `~/.claude/skills/claude-model-skill/` into the same path on the new machine,
  then tell the agent there: "run the claude-model-skill". It is global, so it
  works in every repository on that machine.
- **Via a repository:** copy the folder into `<repo>/.claude/skills/claude-model-skill/`
  and commit it. Any agent working in that repo can then run it, and it still
  writes the GLOBAL file on whatever machine it runs on.
- Do not put the model keys in the repo's `.claude/settings.json` expecting the
  custom picker: `modelPicker` is ignored there (see scope table above).
