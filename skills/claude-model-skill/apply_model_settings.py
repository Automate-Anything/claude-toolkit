#!/usr/bin/env python3
"""
Apply the owner's preferred Claude Code model setup to the GLOBAL user
settings file (~/.claude/settings.json). Safe to re-run: it only touches the
three model keys, preserves everything else, backs up the old file, and
validates the result parses as UTF-8 JSON.

Run:  py apply_model_settings.py          (Windows)
      python3 apply_model_settings.py     (macOS / Linux)
Optional: --scope project   writes .claude/settings.json in the CWD instead
          (note: modelPicker is user/managed scope only and is skipped there).
"""
import io
import json
import os
import sys
import shutil
import datetime

DEFAULT_MODEL = "claude-opus-4-8[1m]"

AVAILABLE_MODELS = [
    "claude-opus-4-8[1m]",
    "claude-sonnet-5",
    "claude-haiku-4-5",
    "claude-fable-5",  # version prefix: permits Fable 5 AND Fable 5.1
]

MODEL_PICKER = [
    {"value": "claude-opus-4-8[1m]", "label": "Opus 4.8 (1M context)", "description": "Opus 4.8 with 1M context"},
    {"value": "claude-sonnet-5", "label": "Sonnet 5", "description": "Efficient for routine tasks"},
    {"value": "claude-haiku-4-5", "label": "Haiku 4.5", "description": "Fastest for quick answers"},
    {"value": "claude-fable-5[1m]", "label": "Fable 5 (1M context)", "description": "Fable 5 with 1M context"},
    {"value": "claude-fable-5-1[1m]", "label": "Fable 5.1 (1M context)", "description": "Most capable for your hardest and longest-running tasks"},
]

scope = "user"
if "--scope" in sys.argv:
    scope = sys.argv[sys.argv.index("--scope") + 1]

if scope == "project":
    path = os.path.join(os.getcwd(), ".claude", "settings.json")
else:
    path = os.path.join(os.path.expanduser("~"), ".claude", "settings.json")

os.makedirs(os.path.dirname(path), exist_ok=True)

settings = {}
if os.path.exists(path):
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copyfile(path, path + ".bak-" + stamp)
    with io.open(path, "r", encoding="utf-8") as f:
        settings = json.load(f)

settings["model"] = DEFAULT_MODEL
settings["availableModels"] = AVAILABLE_MODELS
if scope == "user":
    settings["modelPicker"] = MODEL_PICKER
else:
    settings.pop("modelPicker", None)

with io.open(path, "w", encoding="utf-8", newline="\n") as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)
    f.write("\n")

with io.open(path, "r", encoding="utf-8") as f:
    check = json.load(f)

print("OK  wrote", path)
print("    model:          ", check["model"])
print("    availableModels:", check["availableModels"])
if scope == "user":
    print("    modelPicker:    ", [r["value"] for r in check["modelPicker"]])
print("Reload the Claude Code window / restart the session for it to take effect.")
