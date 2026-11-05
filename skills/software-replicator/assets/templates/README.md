# Parity workspace: replacing {{SYSTEM}}

This folder is the working record for making this app a drop-in replacement
for {{SYSTEM}}: same screens, same buttons in the same places, same behavior,
so staff need no retraining. Made by the `legacy-app-parity` skill.

| File | What it holds |
|---|---|
| `site-map.md` | Every screen of the old system: ID, how to reach it, roles, how often it is used, status |
| `scenarios.md` | Whole business tasks, end to end (the real measure of progress) |
| `screens/S##-name.md` | One spec per screen: layout contract, every control's behavior, rules, evidence |
| `data-model.md` | Endpoints and data shapes from network traffic (values removed), made by `net_schema.py` |
| `questions.md` | Everything that could not be learned safely or pinned down, batched for the owner |
| `decisions.md` | Approved deviations from the old system, design direction, quirk decisions |
| `renames.json` | Approved label changes, read by `layout_diff.py` |
| `checklist.md` | Per-screen and per-scenario parity verdicts with evidence |
| `whats-different.md` | The one-page sheet for staff at go-live |
| `LESSONS.md` | What this system taught us, to fold back into the skill |
| `_raw/` | Screenshots, inventories, network bodies, scripts, exports. **Real customer data. Git-ignored. Never commit, never paste into chat.** |

Evidence labels used everywhere: **[OBSERVED]** seen happen in the old system,
with a file in `_raw/` to prove it; **[INFERRED]** concluded from code or
patterns but not seen; **[UNKNOWN]** not learned yet. Nothing marked INFERRED
or UNKNOWN is built until the owner confirms it.
