# Lessons

Every lesson that cost money, time or a rejected version, with its fix. Add a dated line after every piece of work. The first section is the short list; the log is the long one.

## What was wrong the first time, and what corrected it

| First version | What corrected it |
| --- | --- |
| Seedance through fal for everything | fal refuses every photoreal face on Seedance, generated ones included; a second venue (Higgsfield) accepts them. Test references on the exact route before planning around a venue. |
| A 60-second film | The films that travelled ran 83 to 104 seconds with one long hold. |
| "The thing only this product does" judged against one rival | Two other rivals did it; read every rival before writing, and again the week of release. |
| A booking and a website as scenes | Every rival shows the same; what is the same everywhere cannot carry a film. |
| The video model speaking the lines | Voices "way too AI-ish" and mouths off the voice. The voice is made first in an approved library voice with human texture and the face is driven from the audio. |
| Two voices overlapping in the mix | "Sounds like a bug." The mix is built from the edit list, one voice at a time, everything else ducked. |
| Words on screen as plain captions | Every word is a speech bubble with a tag saying who speaks, on glass, beside the speaker. |
| A drawn tail on the bubble | Read as a stray diamond; a squared corner points at the speaker. |
| Glass at web-page alpha over dark footage | Unreadable; alphas 0.86 to 0.60 over moving picture. |
| Bubbles timed to their line only | Nine sat over the wrong scene; a bubble never crosses into another scene, and a too-short shot is lengthened in the edit list. |
| The wordmark centred | It landed on a face; it stands on the empty side of the frame or at the top. |
| An end card in a stand-in typeface | The client caught Arial. An assembly stand-in never carries a wrong brand; a still of the real card goes first. |
| The whole film generated in one day | The client's structural notes meant most of it was remade. One piece at a time, shown raw, before the next is bought. |
| A film built, then given a hook | "A video without a really good hook in the beginning is worthless." The first three seconds are designed first. |
| A script written for the client to approve | He rewrote it by hand and asked that the differences be learned (see `principles.md`, "The script"). The next first draft is written his way. |
| A cutaway to a stranger the teller never named | "It's not about the old lady." She tells it, then we see it, always her or someone she just named. |
| The husband's mouth moving to her words | The audio-driven model animates every face; mask the speaker, generate the listener separately, composite. |
| One long render of the whole film | Starved for three hours behind other work on the machine and killed four times; rendered as eighteen one-minute pieces, started detached, it took 28 minutes and a change redoes one piece. |
| "The product opens every call by saying it is an AI" shown in the film | The client ruled otherwise for the product; the film keeps his line and the product change went on the backlog. A film shows the product the client wants, and the backlog makes it true. |
| A capability in the script that the product did not have | "100 percent, we need to be able to do that": it stays in the film and goes on the backlog as top priority, because the film must be true when published. |
| Imported public skills visible to the repository's checks | 12,860 findings until the folder was ignored. Imported files stay out of version control; sources and commits recorded so they can be fetched again. |
| An online document for the client to edit the script | He lost access when his account changed. A plain file in his downloads and in the editor. |
| The footage left on one computer | He moved to a new laptop and had nothing. Footage is too large for the repository; copy the work folder before a computer is replaced, and say so in the handoff. |

## The fifteen failures of generated footage and their fixes (from the field)

| Failure | Fix |
| --- | --- |
| Face drifts between shots | Character sheet; keyframe first; angles as edits of one still; reject on comparison with the sheet |
| Waxy, glossy skin | Film-stock and flaw wording ("heavy film grain, imperfect focus, focus breathing, halation"), 2K keyframes with grain, no skin smoothing, shared grain, saturation down 10 to 15 percent |
| Garbled screen text or an invented interface | Never generate the interface; composite real captures or cut to designed inserts; phones dark or plain in the footage |
| Phone changes shape, fingers multiply | Hide hands by framing, simple grips, short clips, small camera moves |
| Gibberish burned-in subtitles | No text in references; regenerate or crop; own captions only |
| Voice changes between clips | One recorded or generated voice per person over the full stem; or drive the face from the audio |
| Rushed or wrong-speaker dialogue | One speaker and one short line per clip, written pauses |
| Shots of one scene do not cut | Grid keyframes from one hero image, the same lens wording in every prompt, matched eyelines |
| Floating motion | Describe action in physical beats, slower actions, one action per clip |
| Jittery camera | One move per shot; "locked-off" wording for stillness |
| Instructions ignored at the end of a long prompt | Essentials first, 60 to 100 words, one change per iteration |
| A reference bleeds its light or framing | Give every reference a named job |
| Colour and texture jump between shots | Bake the grade into keyframes, match to a hero clip, one shared grain pass |
| Flicker and sharpened artifacts after upscaling | Test the upscaler on skin, or stay at 1080p |
| Backlash, a label surprise or a legal problem | Entertainment and product truth first, real product behaviour only, no real likenesses, conspicuous disclosure |

## Working habits that paid for themselves

- A probe render (three seconds, one of every element) before any full render.
- A frame grid (one frame every six seconds) and single frames at every new element, read before the client sees anything.
- A cost line before every paid call, a receipt at acceptance, a day cap, a ledger (the venue may have no balance call).
- The venue's own free estimate before the paid call; a check of the key and the catalog with free calls before anything is bought.
- Scripts that build the edit list, the composition and the mix from one JSON file, so a note is a change to one row and every version can be rebuilt.
- Public skills found by short searches on GitHub, read before copying (every SKILL.md, every script for hosts it contacts and settings it changes), installed scoped to the work's folder, never a kit's hook into a shared folder. The best find had six stars.
- Research agents in parallel with the house rules in the brief; their reports saved to files at once because they arrive only in the conversation.

## The log

- 2026-09-30. Research, toolbox, plan and concept written; nothing generated. Beat sheet at version 3 after reading all three rivals. Two kits of public skills installed scoped to the folder.
- 2026-09-30. A whole film generated in one day on one venue to use a cashback window: 13 stills (GPT Image 2.5, 2K, 16:9), 24 takes on Seedance 2.5 at 720p from the stills, one blocked by moderation (a hand dropping paper into a bin), every other take usable first try, every spoken line heard right by the transcriber. What held: a still per scene, then image-to-video with "the shot begins on the start frame and continues from it without any cut"; the phone held under the chin like a voice note keeps the mouth mostly hidden and the lines land; a 22-second one-shot with an action in the middle worked first time. ffmpeg on Windows: `drawtext` with an empty option fails with only "Invalid argument"; a segment that adds two inputs shifts every later input index, so compute indices from the input list; a heredoc mangles backslashes; files over 30 MB cannot go in the chat, so send a 720p preview.
- 2026-09-30. The designed layer as a generated composition from the edit list; the renderer's lint met: no font-family without @font-face, no overlapping audio on one track, a hard kill after every exit. Render needs ffmpeg on the PATH and says so at the end. Never regenerate the HTML while a render runs. The client caught an end card in Arial.
- 2026-09-30. The client on the first draft with sound: the product is male, and every voice was "way too AI-ish". Human is texture: a breath, "uh", a half second, a regional colour, lines that trail off; bracketed tags and low stability; library voices with grain; twelve numbered candidates for his ear.
- 2026-09-30. The client on the second draft: voices overlapped; every line needs a tag saying who speaks; every word on glass; words pop up like speech bubbles. The sound left the renderer for the mix script; a stock robocall line cut at a word boundary (3.3 s) so the exchange ends inside its shot; the vertical retimed to the real voices. A probe render caught the invalid glass background. Thirty blurred elements rendered clean; the renderer warns at about forty.
- 2026-09-30. Frame by frame: nine bubbles outlived their shot; the scene map; a 1.6 s shot lengthened to 2.2 s. Three renders of about 9 minutes each between versions: the fixed cost of a render is why the probe and the grid come first. A render already known to be wrong is stopped and its orphaned processes killed by name.
- 2026-09-30. The voice decided by the client's ear and borrowed by the film; lines made the product's way (dialogue endpoint, tags). A second, more human voice for calls the product places; a note on glass that says so, with the words sent to the client first.
- 2026-09-30. The story film's method: one cast still of the couple; six angles as edits ($1 each); her lines first in the approved voice; each talking take generated from the audio with OmniHuman 1.5 ($0.16 a second); two angles per segment from the same audio. fal refuses an input image over 5 MB; a COMPLETED job can carry an error body. The video model's own speech is no longer used for anyone on camera. The name came out "Yuri"; respelled for speech.
- 2026-09-30. The client: every film opens on its hook; the disclosure line lives on the end card. The second film designed from the first frame backwards with six truth checks before a frame is bought.
- 2026-10-01. The client's structural notes: she tells it, then we see it, always her or someone she named; the husband's mouth moved to her words. The mask (white over her side, feathered), the listener generated separately, the composite with `maskedmerge`; his own short line at the end. The client edited the script by hand and asked that the differences be learned; the differences are in `principles.md`.
- 2026-10-01. Two things the client wrote into the script that the product did not do yet went on the product backlog as top priority with his words and the why: a film may only show what the product really does, and the backlog makes it true.
- 2026-10-01. The pronunciation of the name settled by his ear from five short samples; the transcriber cannot judge an R.
- 2026-10-01. The render: one long render starved for three hours behind other work and was killed four times; rendered one shot at a time (eighteen pieces, about a minute each), started detached, all done in 28 minutes once it got its turns. A take that never arrived (a 504) must not block the film.
- 2026-10-01. Version 3 of the couple's film delivered (147 s, -14.2 LUFS). Known flaws left for his notes: two bubbles crossing for a few frames, one cutaway in the wrong place, one segment without a listening take. He later reported mouths off the voice in some shots: still frames cannot show lip-sync drift; the talking shots must be watched at speed before delivery.
- 2026-10-05. The client moved to a new computer: the footage was on the old one only. Copy the work folder before a machine is replaced.
