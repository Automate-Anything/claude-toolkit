---
name: herk-edit-kit
description: Edit real footage into finished videos, reels and YouTube Shorts, or build motion graphics and end cards, using the open-source Herk Edit Kit (HyperFrames + GSAP). Use when the owner hands over a recording or a downloaded clip and wants it cut, captioned, given B-roll, music and sound, turned into a 9:16 Short, or wants an animated title, outro or end card that looks premium. Covers how to set the kit up, which of its skills to run, how to stay free (no paid transcription, music or SFX), and the lessons from building an end card with it.
---

# Herk Edit Kit

The kit is a workspace, not a loose skill: most of its skills call scripts, docs, styles and
templates at the kit's root. Clone it, set it up once, and run its skills from inside it.
Repository: https://github.com/nateherkai/herk-edit-kit (MIT; HyperFrames parts Apache-2.0).

## Set it up (once per machine or repo)

Needs Node 22+, Git, FFmpeg with ffprobe on PATH, and Chrome or Chromium.

```sh
git submodule add https://github.com/nateherkai/herk-edit-kit.git vendor/herk-edit-kit   # or a plain clone
cd vendor/herk-edit-kit
npm ci && npm run setup && npm test && npm run check
```

`npm test` and `npm run check` must pass (11 tests; 406 cards, 0 errors) before trusting it.
Then `npm run demo` and render it once to prove HyperFrames and Chrome work on the machine.

## Which kit skill to run (from inside the kit folder)

| Job | Kit skill |
|---|---|
| Edit a talking recording end to end | `edit-video` |
| Turn a recording into a 9:16 reel or Short | `short-form-edit` (not the older `short-form-video`) |
| Only remove dead air | `cut-silences` |
| Only find and cut flubs and retakes | `cut-mistakes` |
| Plan the story, hook and payoff | `video-storytelling` |
| Pick or build a visual style, motion-graphics cards | `style-library` |
| A brand reel, sizzle, or anything that must hit a music beat with sound design | `motion-showreel` |

The HyperFrames authoring skills (`hyperframes`, `hyperframes-cli`, `hyperframes-registry`,
`gsap`, `hyperframes-video-beats`, `make-a-video`, `website-to-hyperframes`) are also in this
toolkit as standalone skills.

Start every project with `npm run new-video -- <name>`, then work in `video-projects/<name>`.

## Staying free

The kit's defaults reach for paid services. Do not run them unless the owner says to spend.

- Transcription defaults to ElevenLabs Scribe. Use the source's own captions (yt-dlp
  `--write-subs --write-auto-subs --skip-download`), local Whisper, or
  `npx hyperframes transcribe` with a local model instead.
- `motion-showreel/scripts/sfx.mjs` (ElevenLabs) and `kie.mjs` (music, images, video) are paid.
  Synthesize SFX with ffmpeg instead (recipes below) and use the owner's own music or a pad.
- Never generate footage or stills unless asked; use real footage first.

## Free SFX with ffmpeg (deterministic)

Write each cue as a wav, then premix with the kit's free mixer
`node .claude/skills/motion-showreel/scripts/mix.mjs --bed pad.wav --events events.json --out master.wav --length <s>`
(events: `[{ "t": 1.0, "file": "...", "gain": 0.9 }]`; it normalizes to -14 LUFS, -1.2 dBTP).

- Pop: `aevalsrc='0.8*sin(2*PI*(1100*t+10*(1-exp(-60*t))))*exp(-t*38)':d=0.18`
- Sub boom (55 to 32 Hz): `aevalsrc='0.95*sin(2*PI*(32*t+23/6*(1-exp(-6*t))))*exp(-t*2.4)':d=1.8`
- Impact crack: `anoisesrc=c=white:seed=3:d=0.06` + `highpass=f=2500` + exponential volume decay
- Whoosh: `anoisesrc=c=pink:seed=7:d=0.5` + `highpass=500,lowpass=7000,flanger` + a swell envelope
- Typing tick: `aevalsrc='0.55*sin(2*PI*3400*t)*exp(-t*170)':d=0.05`
- Shimmer: three high sines (2093, 3136, 4186 Hz) with tremolo, fast attack, `exp(-t*2.2)`, `aecho`
- Pad: low sines (55, 82.41, 110 Hz) through `lowpass=420` with fades

Fixed noise seeds keep every rebuild identical. Lay every cue on the animation's beat times.

## Lessons from building an end card

- Follow `MOTION_PHILOSOPHY.md` at the kit root: near-black canvas, light as the brand, a camera
  that never stops (slow push-in, drifting texture), grain, vignette, bloom, motion blur, chromatic
  fringe on the hit, and hold the finished card at least 1.5 s so a phone number can be read.
- Drive everything from one per-frame function of `t` on a single GSAP driver tween. It makes
  every frame seek-safe and lets SFX land on exact times.
- Download real fonts into `assets/fonts` with `@font-face`; never rely on system fonts.
  Fontsource on jsDelivr serves free woff2 files.
- The motif trick: a glowing dot that opens the piece lands as the tittle of an "i" in the
  wordmark. Set the word with a dotless i (U+0131, needs the font's latin-ext subset), measure
  the baseline once with a zero-size inline-block before any transform, and calibrate the dot's
  height and x offset from a snapshot (fonts differ; one needed 0.58 em up and 0.035 em left).
- `background-clip: text` renders invisible in capture; use solid fills plus `text-shadow`.
- `hyperframes check` flags full-frame grain, vignette and flash as covering text. Put
  `data-layout-allow-occlusion` on the covered text (not on the overlay); use
  `data-layout-allow-overflow` and `data-layout-allow-overlap` for deliberate bleed and fringe copies.
  Then confirm readability yourself, since marked text drops out of the contrast audit.
- Render quality names are `draft`, `standard`, `high`. Per-frame grain makes files huge
  (27 MB for 4 s): re-encode with `libx264 -crf 18 -preset slow`, then remux the premixed master
  (`-map 0:v -map 1:a -c:v copy -c:a aac`), because HyperFrames re-encodes audio slightly quieter.
- Verify before handing over: `npx hyperframes snapshot --at <times>` contact sheet, 10-frame
  strips across every transition (`select='between(n,a,b)',tile`), `ffprobe` duration, and
  `ebur128` loudness near -14 LUFS.

## Licensing

The kit is MIT with an extra use permission for its pipeline material; HyperFrames skills are
Apache-2.0. Keep the license notices when copying. The AI Automation Society brand assets in the
kit are not licensed for reuse: never put them in the owner's videos.
