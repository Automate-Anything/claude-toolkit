---
name: ai-video-production
description: How to make a film, an ad, a launch video or a short with AI-generated video that people watch to the end and that a demanding client signs off: the method from idea to delivered file, the rules that make it true and human, the hook science with numbers, which model and venue does which job at what price, the prompt shapes per model, how a person on camera talks with an approved voice and nobody else's mouth moves, the designed layer of words and glass, the sound mix, piece-by-piece rendering, the law on generated people, and every mistake already paid for. Read this before any video work, before buying a frame, before choosing a model, a voice or a venue, and before writing a script for someone else to approve.
---

# AI video production

A complete, self-contained system for making video with generated footage, written from two films made end to end in the first days of October 2026 and from fifty public skills and sixty sources read for them. It is general: it names models, venues, prices and tools, never a client. Numbers carry dates; a number older than a month is read again before money goes on it.

## How to use this skill

1. Read `references/method.md` first: the fourteen steps, each with the gate that ends it and the tool that does it. Everything else hangs off those steps.
2. Read `references/principles.md` before writing a word or buying a frame: the rules that came from a demanding client's corrections, each with the failure that taught it.
3. Open the reference the step needs (the table below). Each is dense and specific on purpose.
4. Run the scripts in `tools/` (plain Python 3 and curl; `tools/README.md` says what each does and how they fit). They print a cost line before every paid call, write a receipt at acceptance, and never print a key.
5. After every piece of work, write what was learned into `references/lessons.md`: a dated line. The skill is only as good as the day's lesson.

## The references

| File | What it holds | Read it when |
| --- | --- | --- |
| `references/method.md` | The fourteen steps with gates and tools; the order that catches a mistake at the cheapest step | Starting or resuming any film |
| `references/principles.md` | The rules that do not move: truth, the hook, the script, voices, words on screen, how work is shown to a client | Before writing or buying |
| `references/hooks-and-first-seconds.md` | What the numbers say about the first 3 seconds, fourteen hook types with mechanism and failure mode, the poster frame rules, what the best launch films did shot by shot | Designing the opening and the poster |
| `references/craft-and-prompting.md` | Finding the idea, scoring it, 21 hook formulas, dialogue that sounds like people, dramaturgy for generated video, the 14-field shot card, prompt syntax per video model, still-image prompting, short-form formats | Writing the script, the shot list and the prompts |
| `references/production-pipeline.md` | Pre-production, continuity through references, prompt dialects, the cost gate, take review, the derived edit list, sound assembly, designed elements, finish and QC, the kit's own failure list | Running production |
| `references/models-and-venues.md` | Which model does which job, on which venue, at what price, what each refuses, how each is called; the whole model field with sources | Before any paid call |
| `references/talking-people.md` | How a person on camera speaks with an approved voice: audio first, the face driven by the audio, a mask so nobody else's mouth moves, the listener generated separately, the composite, two angles from one audio, how the name is pronounced | Any shot where someone talks |
| `references/words-on-screen.md` | Speech bubbles with tags, glass over moving picture, bubbles that never cross a scene, a wordmark that never lands on a face, the book of a trip, the end card, the probe render | The designed layer |
| `references/editing-sound-rendering.md` | The code renderer and its lint, editing a talking recording, the ffmpeg recipes, voices and sound with ElevenLabs, fal's queue and catalog, the character-design workflow | The cut, the mix, the render |
| `references/lessons.md` | Every lesson that cost money or a rejected version, dated, with its fix; what was wrong the first time | When something goes wrong, and after every piece of work |
| `references/legal-and-truth.md` | Demonstrations must be real, generated people are characters not customers, the disclosure laws and platform labels, likeness, what gets an ad pulled | Before release |
| `references/working-with-the-client.md` | One thing at a time, the script as a plain file he edits, numbered voice candidates labelled by the person in the film, one piece raw at a time, files in Downloads with plain names | Every conversation with the person who approves |

## The ten rules that matter most (all in `references/principles.md`)

1. Only what the product really does. A film may show nothing the product cannot do that day; what it shows that is not built yet goes on the product's backlog as top priority the same day, so it is true before the film is published.
2. Every film opens on its hook. Frame 1 is the hook and the poster: no card, no logo, no establishing shot. On a cold feed 7 to 8 of every 10 viewers are gone before second 3.
3. The script is written the way people talk and the client edits it himself in a plain file before anything is generated from it.
4. Every voice is approved by the client from numbered candidates on one page, each list labelled by the person in the film, never by the voice's library name alone. The video model's own speech is never used for anyone on camera.
5. A person on camera talks from an approved audio file; the face is animated to the audio with a mask so only the speaker's mouth moves; anyone beside them is generated listening and composited.
6. One voice at a time. Two at once reads as a bug.
7. Every word on screen is a speech bubble with a tag saying who speaks; it pops up beside the speaker and never crosses into another scene.
8. Generate one piece at a time, look at it frame by frame yourself, show it raw, and carry the lesson to the next piece. Never the whole film at once.
9. Everything is made in small pieces: short clips when generated, and the film rendered one shot at a time and joined, so a change redoes only its piece.
10. Generated people are characters, never customers, and the end card says so.

## What a film costs (October 2026)

A 107 second story film with 33 takes and 19 stills: about $107 of footage at 720p in one day. A 147 second film with a talking couple, nine audio-driven talking takes, five scene takes and six angle stills: about $34 of footage and $2 of voices. Everything after the takes exist (words, voices, timing, music, cards) costs nothing but a render. Details in `references/models-and-venues.md`.

## What this skill does not do

It does not replace an ear: the agent cannot hear a voice or a mix, so the client picks every voice and the music by ear from numbered samples. It does not replace the eye either: every take and every render is looked at frame by frame by the person making it before anyone else sees it.
