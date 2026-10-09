# ai-video-production

A skill for a coding agent (Claude Code, Cursor, Codex or any agent that reads a `SKILL.md`) and for a person: how to make films, ads and shorts with AI-generated video that people watch to the end and a demanding client approves.

## Install

Copy this folder into the agent's skills folder, keeping the name:

- Claude Code: `.claude/skills/ai-video-production/` inside the project, or `~/.claude/skills/ai-video-production/` for every project.
- Any other agent: point it at `SKILL.md`; the references are plain Markdown; the tools are plain Python 3 scripts.

Then put the keys the venues need in the project's `.env` (`HF_CREDENTIALS`, `FAL_KEY`, `ELEVENLABS_API_KEY`), put `ffmpeg` and `ffprobe` in `work/tools/bin/` beside `tools/`, and for the designed layer run `npm install hyperframes gsap` in a folder of its own. `tools/README.md` has the rest.

## What is inside

- `SKILL.md`: the entry; what to read, in what order; the ten rules that matter most.
- `references/`: the method (fourteen steps with gates), the principles, the hook science with numbers, craft and prompting per model, the production pipeline, models and venues with prices, talking people, words on screen, editing and sound and rendering, the lessons, the law, working with the client.
- `tools/`: the scripts that run the method, with a README.

## Where it comes from

Two films made end to end in October 2026 with generated footage and audio-driven talking people, under a client who corrected every step; fifty public skills read for the work (credited in the Sources line of the references that use them); and about sixty sources on hooks, models, production method and the law, dated. Everything that cost money or a rejected version is in `references/lessons.md`.

## Credits

Parts of `references/craft-and-prompting.md`, `references/production-pipeline.md` and `references/editing-sound-rendering.md` distil public skills by their authors, named in each file's Sources line, under their licences (MIT and CC BY 4.0). The rest was written for this skill.
