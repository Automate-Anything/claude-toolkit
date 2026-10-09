# Editing, sound and rendering

How the designed layer is rendered from code, how a talking recording is cut from its
transcript, the ffmpeg recipes that every pipeline ends in, the voice and sound tools, and the
generation API that most video models sit behind. Everything here is a number, a command, a
rule or a failure mode. Where a vendor is named, the vendor's current API reference wins over
this page: re-read the schema or the parameter table before a paid call.

Commands are shown for a POSIX shell; section 3.12 says what changes on Windows.

## 1. The designed layer with a code renderer

The designed layer is everything that is not footage: titles, captions, charts, lower thirds, takeovers,
animated diagrams, end cards. Build it with a code renderer that turns an HTML page with a scripted timeline
into frames, then an MP4. HyperFrames is the open renderer used here: HTML is the source of truth, GSAP drives
the animation, headless Chrome captures frames, ffmpeg encodes. The rules carry to any HTML-to-video renderer.

### 1.1 How a composition is built

A composition is one HTML file. A `div` with `data-composition-id` is the root; children with
timing attributes are clips; a paused GSAP timeline registered on `window.__timelines` is the
animation.

| Attribute | Required on | Meaning |
| --- | --- | --- |
| `id` | every clip | unique identifier |
| `data-start` | every clip | start time in seconds, or a clip reference such as `"intro + 2"` |
| `data-duration` | img, div, compositions | seconds; video and audio default to media length |
| `data-track-index` | every clip | integer lane; two clips on one track must not overlap |
| `data-media-start` | video, audio | trim offset into the source file |
| `data-volume` | audio | 0 to 1, default 1 |
| `data-composition-id` | the root and sub-compositions | the key the timeline is registered under |
| `data-width`, `data-height` | compositions | 1920x1080, 1080x1920 or 1080x1080 |
| `data-composition-src` | a sub-composition mount | path to the external HTML file |

Rules the renderer enforces or the lint catches:

- `data-track-index` is a lane for overlap checking, not a z-order. Use CSS `z-index` for layering.
- The main `index.html` puts the root `div` directly in `body`. Only sub-compositions loaded through
  `data-composition-src` wrap their root in a `<template>`. A `<template>` on the main file hides everything.
- Visible timed `div`s carry `class="clip"`. Never put `class="clip"` on a `<video>` or `<audio>`.
- Video is always `muted playsinline`; the sound is a sibling `<audio>` element, usually pointing at the
  same file, so the mixer sees a separate track.
- Never nest a timed `<video>` inside a timed `div`. Put it in an untimed wrapper and animate the wrapper
  (push-ins, reframes). Animating the video element's own width or height freezes frames.
- Duration comes from `data-duration`, never from the GSAP timeline's length. Never create an empty tween
  to pad a duration, but do end each sub-composition timeline with an anchor
  `tl.to({}, { duration: SLOT_DURATION }, 0)` so `timeline.duration()` is never shorter than the slot;
  a shorter timeline is hidden and shows as a black-frame flash at the tail.
- Deterministic only: no `Math.random()`, no `Date.now()`, no render-time `fetch()`. Use a seeded PRNG
  (mulberry32) or a harmonic hash such as `80 + 220 * Math.abs(Math.sin(i * 0.7 + 0.3) * Math.cos(i * 1.3 + 0.7))`.
- No `repeat: -1`. Compute `repeat: Math.ceil(duration / cycle) - 1`.
- Build timelines synchronously at page load. Nothing inside `async`, `setTimeout` or a Promise: the
  capture engine reads `window.__timelines` right after load.
- Animate only visual properties (opacity, x, y, scale, rotation, color, backgroundColor, borderRadius,
  filter). Never animate `visibility` or `display`, never call `play()`, `pause()` or `seek()` on media,
  never drive one property of one element from two timelines. A property driven by several tweens across a
  long reel (a shared flash layer) can stick on a backward seek: compute it in a per-frame driver instead.
- `gsap.set()` on an element from a later scene fails because it is not mounted yet; use
  `tl.set(selector, vars, time)` at or after that clip's `data-start`.
- No `<br>` in flowing text (natural wrap plus a forced break overlaps); use `max-width`. `background-clip:
  text` renders invisible in capture; use solid fills and `text-shadow` for bloom. Full-screen linear
  gradients on dark backgrounds band in H.264; use radial glows or a solid plus a local glow.

Sub-composition skeleton (inside a `<template>`, styles scoped to `[data-composition-id="scene-2"]`,
never `html, body`, GSAP loaded from a local file):

```js
(() => {
  const SLOT = 6.5;
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
  tl.from("#s2-title", { y: 60, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.2);
  tl.to({}, { duration: SLOT }, 0);
  window.__timelines["scene-2"] = tl;   // key equals data-composition-id exactly
})();
```

Mount in the root: `<div id="el-2" data-composition-id="scene-2" data-composition-src="compositions/scene-2.html" data-start="4.8" data-duration="6.5" data-track-index="1" data-width="1920" data-height="1080"></div>`.

Per-frame driver for canvas work (particles, noise, big grids, the HUD): one tween advances a proxy and
everything drawn is a pure function of its value, so seeking anywhere draws the right frame:

```js
const drv = { t: 0 };
tl.fromTo(drv, { t: 0 }, { t: END, duration: END, ease: "none", onUpdate: () => frame(drv.t) }, 0);
```

Canvas 2D is headless-safe. Live WebGL can stall the capture; ship a Canvas 2D fallback or pre-render the
shot to an MP4 and place it as a video clip. 2,000 to 4,000 particles on one canvas is a safe budget.

Layout before animation: write the hero frame of each scene as static CSS first (the content container
fills the scene with `width: 100%; height: 100%; padding; display: flex; gap; box-sizing: border-box`,
never `position: absolute` on a content container), then add entrances with `gsap.from()` toward those
positions and exits with `gsap.to()` away from them. Overlaps are only visible when the end state is built first.

Scene transitions in a multi-scene composition: always a transition between scenes, every element enters
with a `from()` tween, no exit tweens before a transition (the transition is the exit, so the outgoing scene
must be fully visible when it starts), and only the final scene may fade its elements out. Pick one primary
transition for 60 to 70 percent of the changes plus one or two accents; calm 0.5 to 0.8 s on `sine.inOut`,
medium 0.3 to 0.5 s on `power2`, high energy 0.15 to 0.3 s on `expo`. Camera moves and full-frame wipes
sequence, never overlap, or they guillotine content. Rotate the flavour: no two consecutive transitions the same.

### 1.2 Fonts

Download the font files into the project (`assets/fonts/`) and declare them with `@font-face`; never rely on
system fonts, and localise any CDN font or GSAP link before the final render. The compiler embeds the fonts
it knows and lint warns about one it cannot. Measure layout once at the top of the build
(`getBoundingClientRect` after `document.fonts.ready`), before any `immediateRender` tween applies a
transform, never inside `onUpdate`. Sizes for rendered video: headlines 60 px and up, body 20 px and up,
data labels 16 px and up, `font-variant-numeric: tabular-nums` on number columns.

### 1.3 Lint, validate, preview, render

```bash
npx hyperframes init my-video --non-interactive     # scaffold (templates: blank, swiss-grid, kinetic-type, product-promo, ...)
npx hyperframes lint [--verbose] [--json]            # structure: missing data-composition-id, track overlaps, unregistered timelines, tween conflicts
npx hyperframes validate [--no-contrast]             # headless Chrome: runtime JS errors, missing assets, failed requests, WCAG AA contrast at 5 timestamps
npx hyperframes preview [--port 3002]                # studio with hot reload; ?comp=<id> opens one composition
npx hyperframes snapshot . --at 2.9,10.4,18.7        # one PNG per timestamp, then look at every PNG
npx hyperframes render --quality draft --output renders/draft.mp4
npx hyperframes render --quality high --fps 60 --workers 1 --output renders/final.mp4
npx hyperframes doctor                               # Chrome, ffmpeg, Node, memory
```

| Render flag | Values | Default | Note |
| --- | --- | --- | --- |
| `--fps` | 24, 30, 60 | 30 | 60 doubles render time |
| `--quality` | draft, standard, high | standard | draft while iterating, high for delivery |
| `--format` | mp4, webm | mp4 | webm carries alpha |
| `--workers` | 1 to 8 or auto | auto | each worker is a Chrome process |
| `--docker` | flag | off | byte-identical output |
| `--gpu` | flag | off | GPU encode |
| `--strict`, `--strict-all` | flag | off | fail on lint errors, or on errors and warnings |

Workers and memory: every worker spawns Chrome, so on an 8 GB machine two or three workers is the ceiling
and `doctor` reports when memory is short. Any composition that contains a `<video>` layer renders with
`--workers 1`: parallel workers make the video layer paint black. Draft quality first, always.

Overlay weight: two to five decoratives per scene with slow ambient motion; an overlay that leaves a
background image barely visible is too heavy and gets its opacity reduced; grain and vignette are a texture
on every scene, not a decoration on one. Contrast is measured: `validate` samples the pixels behind every
text element and wants 4.5:1 for normal text and 3:1 at 24 px or larger.

Hard kills for exits: every caption group ends with an exit tween and a deterministic kill
`tl.set(el, { opacity: 0, visibility: "hidden" }, group.end)`; a self-lint seeks to `group.end + 0.01` and
warns when the group is still visible. A prop that has said its piece retires to opacity 0, not 0.3, and the
mute is emitted before any later-starting lighting sweep. Snap every tween end to a multiple of `1/fps`;
steep tails (`expo.in`, `power4.in`) alias at sub-frame boundaries. If the capture stalls, kill the renderer
and its Chrome children before retrying with `--workers 1 --quality draft`.

Lint passing is not visual truth. After every draft render extract frames at word-exact timestamps and look
at each one (section 3.9): no cropped faces, correct face mode per scene, text readable and on palette, no
overflow, transitions on the intended word, no blank or black frames.

### 1.4 The short-form edit method (reels, shorts, short ads)

Input: a source recording and an optional reference reel. Output: 1080x1920 by default, a separately
composed 1920x1080 when asked (a centre crop is not a second composition). Each ratio is verified on its
own, opening and CTA included.

1. The first gate: in the first three seconds, is someone convinced they need to watch to the end? Name the
   specific benefit, the unresolved question, the evidence visible by second three, and the exact payoff
   scene. Effects and polish come after this test. The opening must also work muted.
2. Three openings, materially different, built from the same truthful source speech (problem first, result
   glimpse, recognition first). Render their first three seconds cheaply, compare for topic clarity,
   curiosity, muted comprehension and follow-through, choose, and write down why. Never choose by loudness
   of effect. Never promise what the footage cannot pay off.
3. A ledger of open questions, `OPEN-LOOPS.json`: one main loop and at most one secondary loop open at a
   time; each with `question`, `object` (the visibly incomplete thing), `setup` time, `updates` (time and
   state), `closure` time, `resolution`, verbatim `supportingSpeech`; plus an `opening` object with
   `benefit`, `evidenceBy3`, `payoffTime`. A recurring object that resolves nothing is a callback, not a
   loop. The promised lesson closes before the CTA; a comment request is never the only answer.
4. Footage versus graphics: no default percentage. Keep a duration ledger (authentic footage, generated
   illustration, designed graphics, speaker only). A still with a camera move is a photographic layer, not
   moving B-roll. Each B-roll scene appears once per reel (a crop, speed change, reverse or regrade is not a
   new scene); record scene identity, file hash and interval in `assets/footage-ledger.json`. Contain the
   full source frame by default; crop only when subject, action and consequence stay visible at start,
   middle, end and action peaks in both ratios. Narration and captions carry the words, so a graphic shows
   the example, relationship or consequence, never a third restatement as a headline.
5. Captions: phone-safe region for 1080x1920 starts at x 90 to 930 and y 200 to 1600 (right edge and bottom
   belong to the platform UI); adjust to the actual face position in every layout; short phrase groups;
   exact word onsets within 2 frames; emphasis never changes the speaker's wording.
6. Music on contact: normalise the voice first; start the bed 14 to 20 dB under the voice and adjust to the
   real track; duck under speech; aim for about -16 LUFS integrated and at most -1 dBTP on the mix without
   crushing dynamics. SFX land on the visible contact of an object (align the audible impact peak, not the
   file start, within 2 frames); score anticipation, contact and release separately; let some cuts pass
   without a whoosh; voice stays dominant. "Music too loud" is fixed by a measured bed reduction relative to
   the reviewed stem, verified after mastering, never by a quieter master alone.
7. Checks on the encoded file, not the composition: the opening frame by frame (impact, reveal, return,
   first spoken word surviving the mix); the hero frame of every shot at full size and phone size;
   contiguous strips across every cut; fresh ASR on the final audio diffed against the expected text; voice
   to bed ratio; clipping; the last syllable; ratio, duration, fast-start MP4, final hash. Gaps over 2.2 s
   without a deliberate story hold fail cadence. Calibrate validators with negative controls (a caption
   shifted 0.3 s, a one-frame gap, a dropped word must fail). A waveform is not listening and ASR is not hearing.

Lock the cut after the rough animatic and before polished graphics; every later timing change rebuilds
captions, graphics and sound from the same map (`assets/plan.json` with scenes, events, captions on the
edited timeline and `sourceStart`/`sourceEnd` per word; cuts quantised to `1/fps`, word times kept precise).

### 1.5 The motion-showreel method (10 to 30 s brand reels)

One motif, transformed: the brand's most reduced element opens the reel, becomes each chapter's material,
and lands as punctuation in the lockup. Six or seven labelled craft chapters, each with one tool overlay that
shows the work. A persistent HUD (corner marks, title top left, spec line top right with a blinking dot,
timecode bottom left, progress ruler bottom centre, chapter label bottom right; mono caps, tracking 0.2 em,
about 16 px, flipping ink and paper with the background). Ink, paper, one accent and one held-back colour
that appears only in the climax flurry. Every chapter change flips value or saturation.

Beat grid: 120 to 130 BPM. Every hard cut, flash and invert lands within 2 frames of a grid line; one
pre-drop gap (music ducked half a beat) before the midpoint hit. For 15 s at about 129 BPM (32 beats):
physics intro 4 beats, type chapter 8 beats with an internal invert, three 4-beat chapters with the drop in
the middle, a flurry of about 6 cuts in 4 beats (one per beat, then half beats), about 4 beats of lockup.
Roughly 75 percent development, 13 percent flurry, 12 percent resolve. Density breathes: one object, a wall
of type, a grid of 100, thousands of particles, one hero object, the flurry, one word.

Measuring a reference: contact sheets at 6 fps in 4x4 tiles, per-frame luminance difference for hard cuts
(a mean absolute difference above 40 on a 64x36 grey downscale marks a cut), mean luminance every 0.5 s for
the value rhythm, audio RMS every 0.25 s and onset peaks (mean plus 2.5 standard deviations) for the beat.
With a BPM and phase, report each cut's offset from the nearest beat and half beat; your own render should
sit within about 35 ms.

Measuring a music bed: decode to 22,050 Hz mono; onset envelope from 46 ms windows; autocorrelate within
plus or minus 6 percent of the target BPM for the period; fold the onsets to find the phase, taking the
phase from the kick band (two cascaded `lowpass=f=120`), because a full-band fold can lock onto off-beat
hats and put every splice half a beat late. Print per-bar and per-beat RMS and low-band energy; find the
riser, the drop (a jump of 10 dB or more in the low band), the break and the return. Splice 32 beats (16
intro and build ending on the drop's downbeat, 8 drop, 4 break under the flurry, the return hit plus a tail)
and re-measure: the bed's kick phase should be within about 25 ms of 0. Put the measured BPM in the HUD.
Premix bed and beat-placed SFX with `adelay` and `amix=normalize=0`, two-pass `loudnorm` to -14 LUFS and
-1.2 dBTP, then a limiter; the renderer re-encodes audio slightly quieter, so remux the master WAV into the
render afterwards (section 3.7).

Build rules specific to a reel: every time comes from the beat sheet (`const B = n => n * PERIOD`); tween
only transforms and opacity; staggered phases must finish before their cut (start plus max delay plus
duration); fake motion blur with `filter: blur(6px) -> 0` plus a `scaleY` stretch; squash and stretch on
contact (`scaleX 1.35 / scaleY 0.7` for 2 to 3 frames, then `elastic.out(1, 0.5)`). Verify: 10-frame strips
across every transition, six random frames that read as the brand with the HUD covered, cut offsets within
35 ms, luminance alternating by chapter, the pre-drop dip audible.

### 1.6 Video storytelling rules (the long graphics-led video)

- One persistent world that never resets. An element, once drawn, is never redrawn, moved or relabelled;
  new material is added to the space. Decide the spatial grammar first (for example left to right is toward
  the outcome, up is toward a human and is the only warm thing, down is into a system of record) and hold it
  for the whole runtime. Break it once, deliberately, for meaning.
- The camera is the edit. Three altitudes (world, region, detail); move between adjacent ones; a jump from
  detail to world only as a payoff. Name framings as exact world windows whose edges fall between labels,
  never as scale factors. Reuse the same window for the same purpose. Vary duration with distance. A cover
  layer goes opaque before the camera moves under it. No label within 60 px of the frame edge. A reframe
  that finishes and then a wipe that starts reads as a glitch and a pause: merge them into one gesture on a
  shared `power2.inOut`. Front-loaded eases (`power3.out`) are for element entrances, not for visible footage moves.
- One thing lit at a time. Exactly one element at full brightness (luma 200 to 235); context 120 to 150
  (opacity about 0.56), spent 85 to 105 (about 0.33), no label ever below 90. Hierarchy is the ratio between
  active and quiet, not darkness: a build whose brightest pixel was 101/255 was unreadable at 960x540. A label
  inherits its element's state. One opacity authority per element per window, or the master strobes at 10 Hz.
- Open loops are spatial. Plant something visibly incomplete in the hook, re-show it at every section
  boundary (about two seconds each), advance it visibly, close on the image you opened on. Handing an item
  to its slot is a live camera move of about 1.4 s, never a cut to a pre-made filled frame. A corner counter
  needs a one or two word name beside the numeral.
- If it does not get a word, it does not get drawn. About 20 on-screen words per section; labels are one or
  two words under their element. One travelling subject whose state visibly changes carries each section.
- One global token set: strokes 1.5 / 2.5 / 4 / 7, type 22 / 30 / 42 / 60 / 84, radii 10 / 22 / 40, five
  colours with five fixed meanings, never pure white for type (halation on dark). Gate it with a linter that
  fails the build. The signature of a machine-made piece is 18 stroke weights and 9 type sizes 0.2 apart.
- Motion: entrances on `cubic-bezier(0.16, 1, 0.3, 1)`, exits faster than entrances, duration varies with
  mass, `back.out` exactly once per section, no cross-fade of full-bleed layers ever (a pixel is graphic or
  footage, never a blend).
- Build contract: one generator per section writing one composition file; shared geometry in shared modules
  nobody forks; namespace SVG `defs` ids before assembly (`url(#id)` resolves to the first match in document
  order, so once an earlier composition unmounts every later graphic paints nothing); time everything to word
  starts, entering 0.15 to 0.25 s ahead; print any gap over about 1.5 s with nothing happening; after
  graphics exist, shift timings only through a parse-level transform derived from the edit list.
- Gates, then look anyway: token lint, no-cross-fade lint, a 960x540 downscale of every major beat read by
  eye, seam and dead-frame scans against a control known to trip them, speaker presence about 40 percent,
  and a contiguous strip across every transition window (`select='between(n,A,B)',scale=480:270,tile=layout=6x7`),
  because every motion defect lives between beat frames. Verify the assembled artifact, never the prototypes.

### 1.7 Video beats for long talking-head videos

Overlay cards on top of a speaker: a glass lower third when the speaker stays visible (scaffolds, topic
labels, small lists; 12 to 30 s, long topics 25 to 45 s with staggered sub-elements; about 68 to 72 vw wide,
max about 1240 to 1280 px; bottom centre; never over the face) and a full-screen takeover for a thesis, list,
stat or quote (4 to 12 s; overview 8 to 10 s; stat 5 to 8 s; sparse text, one accent only on a true stat).
Pacing: no more than 20 to 30 s without a beat early on, 30 to 45 s in the main body. Start each beat 0.2 to
0.6 s before the anchor word, keep it alive for the whole topic span, clear 0.1 to 0.5 s before the next.
Write for a one-second glance: short noun phrases, one mental model per card. A beat-sync validator reads
every mounted beat's `data-anchor` phrase and enforces an entry between 0.2 s after and 1.8 s before the
word (suggested lead 0.5 s). Respect a user's shortening of a beat; fill after it with a shorter card.

### 1.8 Website to video

Seven gated steps, each producing the artifact the next consumes: capture the site (name, top colours,
fonts, key assets, one-sentence vibe); a `DESIGN.md` cheat sheet (about 90 lines: style prompt, 3 to 5 hex
colours with roles, 1 or 2 type families, 3 to 5 anti-patterns); the narration `SCRIPT.md` (durations come
from the words); the `STORYBOARD.md` per beat (mood, camera, animations, transitions, assets, depth layers,
SFX, an asset audit table); the voice, transcribed for word timestamps (beat start is the first word's start,
beat end the last word's end plus 0.3 to 0.5 s); build and self-review each composition; lint, validate,
snapshot every beat midpoint, hand off with a per-beat table and the exact commands. Video types: social ad
10 to 15 s in 3 to 4 beats; feature announcement 15 to 30 s in 3 to 5; brand reel 20 to 45 s in 4 to 6;
product demo 30 to 60 s in 5 to 8; launch teaser 10 to 20 s in 2 to 4. Audition two or three voices on the
first sentence before generating the full narration. Every static image gets motion.

## 2. Editing a talking recording

Order of work: word-level transcript, silences, mistakes, lock, graphics. Each stage writes a new file; the
original is never touched; a transcript is only ever used against the video it was timed on.

### 2.1 Word-level transcript first

Every cutting tool needs `{ "audio_duration_secs": N, "words": [{ "text", "start", "end" }] }` with
times in seconds on the exact source recording. Paragraphs, SRT cues and segment-only transcripts do not
carry word timing; request word timestamps or align, never invent them. Sources: ElevenLabs Scribe
(section 4.4; keep only `type == "word"`), OpenAI Whisper API (`whisper-1`, `response_format=verbose_json`,
`timestamp_granularities[]=word`), Groq Whisper (`whisper-large-v3`, same flags), local whisper.cpp (`small`
for clean speech, `medium` over music; never a `.en` model unless the audio is known English, because `.en`
models translate). Quality check: more than 20 percent music-note tokens, nonsense words, words shorter than
0.05 s or many `uh`/`huh` entries mean the transcript failed; retry larger or in the cloud, and strip
non-word tokens before anything downstream reads the file.

### 2.2 Cut silences

Pure pause trimming, deterministic and transcript-driven. Defaults from a talking-head pipeline that removes
15 to 20 percent of a typical raw take:

| Parameter | Default | Meaning |
| --- | --- | --- |
| gap | 0.55 s | pauses shorter than this are never touched |
| head pad | 0.22 s | silence kept before the first word |
| tail pad | 0.34 s | silence kept after the last word |
| breath kept | 0.24 s for pauses of 2 s or more, 0.20 s after `. ! ?`, 0.14 s otherwise | never a hard zero gap |
| breath bias | 55 percent of the kept breath after the previous word, 45 percent before the next | |

Delete ranges are merged; keep ranges are the complement; keep ranges under 0.04 s are dropped. Words are
re-timed by subtracting the removed time before each word, with `source_start` and `source_end` kept. Render
with a `trim`/`atrim` plus `concat` filter graph (section 3.2) so picture and sound stay in sync. Audio-driven
alternative when there is no transcript yet: `silencedetect` at -35 dB with 0.6 s minimum silence and a
0.15 s margin on each side of speech (-40 to -45 dB in quiet rooms, -30 in noisy ones); a speech-aware mode
keeps breaths shorter than the minimum inside a sentence and cuts only sentence-boundary pauses. Lower the
gap for a punchier cut, raise it to breathe. Do not remove pauses that carry meaning.

Air in the cut: aggressive capping produces 20 to 40 ms gaps at sentence boundaries that a listener hears as
stutters. Measure the speaker's own median sentence-boundary gap (one reference speaker: 470 ms) and flag
junctions about ten times tighter. Repair with 4 to 8 frames of the track's own room tone with 10 ms fades,
never `anullsrc` (digital silence against a -50 dBFS floor is an audible dropout), spliced into the word
tail with a 40 ms equal-power crossfade (a hard butt amputates a 60 to 120 ms decay). Insertion shifts the
transcript deterministically; no re-transcription is needed.

### 2.3 Cut mistakes and retakes

Mechanical detection proposes, a human (or the agent reading in context) decides, then the approved cuts are
applied. Detector rules from the same pipeline, run on the silenced transcript so cuts land on the silenced timeline:

- Stutter: two consecutive identical tokens (case-folded, punctuation stripped) with less than 0.5 s between
  them; propose removing the first, keeping the second. Confidence high.
- Segments: split the words at gaps over 0.85 s, at a sentence end once a segment has run 7.5 s, or at 16 s.
- Retake: two segments within 8 segments and 75 s of each other whose content-word signatures (first 18
  tokens longer than two characters, stop words removed) have Jaccard similarity of 0.34 or more (cut), or
  0.24 or more with at least two of the first four tokens matching (review). Propose removing the earlier
  take up to the start of the later one.
- False start: a retake whose first take is under 6 s and restarts within 12 s.

Review every candidate in context before applying: emphatic repetition ("never, never"), copula then question
("the piece is, is this"), and listing look identical to a stutter. A clean delivery may yield zero cuts, and
that is a valid result. Write the approvals as
`{ "cuts": [{ "start": 100.93, "end": 101.06, "reason": "false start" }] }` on the input timeline (widen a
range when a whole botched take should go), then apply: the tool writes the EDL, a re-timed transcript, a
decisions log and, with an apply flag, the cut video through the same trim/concat graph. Joins between two
spoken words are hard cuts; a 20 to 30 ms fade can be added later for tighter audio. Build a review page of
every cut boundary (before and after frames plus the audio around the join) and listen to each join.

### 2.4 The edit list and the re-timed transcript

The EDL is `keep_ranges` and `delete_ranges` on the source timeline with reasons and the two durations. The
re-timed transcript carries every surviving word with `start`, `end`, `source_start`, `source_end`. Never
mix source-time and edited-time anchors in one file; one canonical map that captions, graphics and sound all
read; cut boundaries quantised to `1/fps`, word times kept at ASR precision; derive the final word timing
from the frame-aligned EDL after the clean cut is rendered and diff a fresh ASR of the final audio against
the expected text. Edited duration equals source minus removed time; the rendered file's audio and video
lengths agree within 0.04 s.

### 2.5 Then graphics

Only after the cut is locked: beat sheet with a transcript anchor, one visual idea and a deliberate callback
per beat; the long-form rules of 1.6 and 1.7 or the short-form rules of 1.4; graphics timed to word starts,
entering 0.15 to 0.25 s ahead, sub-element reveals bound to their own spoken nouns rather than `index * 0.4`
staggers; face kept in frame in every layout; a non-timed wrapper for camera reframes of the speaker.

## 3. ffmpeg recipes

Probe first, plan from real numbers, prefer lossless, re-encode as few times as possible (intermediates at
CRF 18, the delivery encode last), frame changes before captions, loudness last, then check the file and look
at the picture. A step is done only when ffmpeg exited 0 and the output probes as expected.

### 3.1 Probe

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 in.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,avg_frame_rate,codec_name,pix_fmt,color_transfer -of json in.mp4
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels -of json in.mp4
```

`r_frame_rate` and `avg_frame_rate` disagreeing means variable frame rate (phone and screen recordings):
every re-encode then conforms to constant rate (`-fps_mode cfr -r 30`) and lossless cuts are unreliable, so
cut accurately. `color_transfer` of `smpte2084` (PQ) or `arib-std-b67` (HLG) means HDR; convert before any
SDR step (3.11).

### 3.2 Cut

```bash
# lossless, snaps to the previous keyframe (may start up to a GOP early, often 1 to 10 s)
ffmpeg -y -ss 00:01:20 -i in.mp4 -t 45 -c copy -avoid_negative_ts make_zero out.mp4
# frame accurate: re-encode
ffmpeg -y -ss 80.000 -i in.mp4 -t 45.000 -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart out.mp4
# sample-accurate audio only
ffmpeg -y -ss 1.2345 -i in.wav -t 1.1111 -af "atrim=end=1.1111,asetpts=PTS-STARTPTS" part.wav
```

Several segments in one pass (the shape the silence and mistake cutters write, as a filter script so no shell
quoting is involved):

```text
[0:v]trim=start=0.000:end=12.400,setpts=PTS-STARTPTS[v0];
[0:a]atrim=start=0.000:end=12.400,asetpts=PTS-STARTPTS[a0];
[0:v]trim=start=13.100:end=40.250,setpts=PTS-STARTPTS[v1];
[0:a]atrim=start=13.100:end=40.250,asetpts=PTS-STARTPTS[a1];
[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]
```

```bash
ffmpeg -y -i in.mp4 -/filter_complex cuts.txt -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart out.mp4
# ffmpeg before 7.0: -filter_complex_script cuts.txt
```

A stream-copy cut that deviates more than 0.5 s from the request should be re-encoded instead; an AAC copy
lands on a packet boundary (about 21 ms). To cut on the beat, snap in and out points to measured onsets
within about 0.12 s (a quarter beat at 120 BPM) and only to grid points an onset actually supports.

### 3.3 Join

Plain cut join of files with identical codecs, size, rate and audio layout: a concat list.

```bash
printf "file 'a.mp4'\nfile 'b.mp4'\nfile 'c.mp4'\n" > list.txt
ffmpeg -y -f concat -safe 0 -i list.txt -c copy out.mp4
```

Different sources, or a transition: normalise every clip to one frame, rate, pixel format and audio layout,
then `xfade` and `acrossfade`. Output length equals the sum of the clips minus the transition times
(n minus 1 of them); every clip must be longer than twice the transition.

```text
[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,settb=AVTB[v0];
[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,settb=AVTB[v1];
[0:a]aresample=48000,aformat=channel_layouts=stereo[a0];
[1:a]aresample=48000,aformat=channel_layouts=stereo[a1];
[v0][v1]xfade=transition=fade:duration=0.5:offset=11.900[vout];
[a0][a1]acrossfade=d=0.5:c1=tri:c2=tri[aout]
```

`offset` is the first clip's length minus the transition; for a third clip the next offset adds the second
clip's length minus another transition. Transitions: `fade`, `dissolve`, `wipeleft`, `wiperight`, `wipeup`,
`wipedown`, `slideleft`, `fadeblack`, `fadewhite`, `circleopen`. Add `-fps_mode passthrough` on the output
so the already-constant-rate picture is not duplicated at the end. A clip without audio gets a generated
silent track (`anullsrc=r=48000:cl=stereo` trimmed to its length) so the join has no hole.

### 3.4 Reframe to 9:16 and 1:1

```bash
# crop to fill (a 16:9 source loses about 70 percent of its width; centre by default, move the window toward the subject)
ffmpeg -y -i in.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-out_w)*0.5:(in_h-out_h)*0.5,setsar=1" -c:v libx264 -crf 18 -c:a copy out_916.mp4
# pad with bars
ffmpeg -y -i in.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1" -c:v libx264 -crf 18 -c:a copy out_916_pad.mp4
# the phone-editor look: the whole frame centred on a blurred, darkened copy of itself
ffmpeg -y -i in.mp4 -filter_complex "[0:v]split[fg][bg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=20,eq=brightness=-0.15[bgb];[fg]scale=1080:1920:force_original_aspect_ratio=decrease[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1[v]" -map "[v]" -map 0:a -c:v libx264 -crf 18 -c:a copy out_916_blur.mp4
# square
ffmpeg -y -i in.mp4 -vf "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,setsar=1" -c:v libx264 -crf 18 -c:a copy out_11.mp4
# exact pixel rectangle (x, y, w, h known)
ffmpeg -y -i in.mp4 -vf "crop=1080:1920:420:0,setsar=1" -c:v libx264 -crf 18 -c:a copy out_crop.mp4
```

Replace the `0.5` crop factors with 0 (left or top edge) or 1 (right or bottom) when the subject is off centre.
`yuv420p` needs even dimensions. Fit to the delivery size before captioning so text is sized for the final
frame; captions burned small and upscaled later come out soft.

### 3.5 Captions with word timing

Burned captions go through libass (`subtitles=` or `ass=` filters). For per-word highlight, write an ASS
file whose `PlayResX`/`PlayResY` equal the video size and use karaoke tags: `\kf<centiseconds>` fills each
word from `SecondaryColour` to `PrimaryColour` over its measured duration. Real word timings beat an even
split; an energy split (cutting the cue at equal cumulative-energy quantiles) beats even when no words exist.

```text
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Montserrat,112,&H0000D4FF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,0,2,54,151,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.10,0:00:02.40,Cap,,0,0,0,,{\fad(80,120)}{\kf42}First {\kf35}three {\kf53}words
```

ASS colours are `&HAABBGGRR` (blue, green, red order, alpha first). `Alignment` 2 is bottom centre, 8 top
centre, 5 middle. A word-scaling style (active word `\fscx112\fscy112` on its own Dialogue line) needs
`WrapStyle: 2` so libass never re-wraps the line when the highlight grows. Then burn:

```bash
ffmpeg -y -i in.mp4 -vf "ass=captions.ass:fontsdir=assets/fonts" -c:v libx264 -crf 18 -c:a copy out_cap.mp4
# plain SRT with a forced style
ffmpeg -y -i in.mp4 -vf "subtitles=subs.srt:force_style='Fontname=Inter,Fontsize=20,Outline=2,MarginV=14'" -c:v libx264 -crf 18 -c:a copy out_srt.mp4
# soft subtitles, player toggleable, video and audio copied
ffmpeg -y -i in.mp4 -i subs.srt -c copy -c:s mov_text -metadata:s:s:0 language=eng out_soft.mp4   # .mkv uses -c:s srt
```

Sizing: at a 288-line reference grid a `Fontsize` of 24 is about 8.3 percent of the frame height (160 px on
1920) and 13 is the readable floor at 4.5 percent (87 px). Fit the size down until every cue wraps within 2
lines before splitting a cue; never rewrite or shorten the words to make them fit. Hold a cue shorter than
1.0 s longer, never past the next cue. Keep text out of the platform's own UI: TikTok covers about the
bottom 22 percent, right 14 percent and top 10 percent; Reels 20 / 12 / 8; Shorts 18 / 12 / 6; feed
destinations use a 5 percent title-safe border. Group words 2 to 3 for high energy, 3 to 5 conversational,
4 to 6 measured; break on sentence boundaries or pauses over 150 ms. Colour emoji need PNG assets composited
per glyph. Indic, Thai, Lao, Khmer and Burmese must go through libass (drawtext has no shaping).

### 3.6 Loudness normalisation to -14 LUFS and a true-peak ceiling

Two passes: measure, then apply linearly with the measured values.

```bash
ffmpeg -hide_banner -nostdin -i in.mp4 -vn -af "loudnorm=I=-14:TP=-1:LRA=11:print_format=json" -f null -
# read input_i, input_tp, input_lra, input_thresh, target_offset from the JSON on stderr, then:
ffmpeg -y -i in.mp4 -c:v copy -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=-19.2:measured_TP=-3.1:measured_LRA=8.4:measured_thresh=-29.6:offset=0.3:linear=true:print_format=summary" -ar 48000 -c:a aac -b:a 192k out_norm.mp4
# verify the written file
ffmpeg -i out_norm.mp4 -af ebur128=peak=true -f null -
```

Targets: -14 LUFS and -1 dBTP for YouTube, Reels, TikTok, Shorts, X, LinkedIn, Facebook; -16 LUFS and -1.5
dBTP for podcasts (some short-form editors mix to about -16 to leave dynamics); -23 LUFS for EBU broadcast.
A lossy encoder can push peaks past the ceiling loudnorm held (one AAC encode at 192k moved a transient from
-2.4 to +3.7 dBFS): re-measure the written file and, if it overshoots, raise the bitrate to 256k or 320k or
lower the TP ceiling by the overshoot and encode again. Never normalise ambience or room tone (-40 LUFS or
below) to a speech target; that raises the noise, not the content. `loudnorm` already applies the R128
gates, so no speech gate in front of it. Lower `LRA` to squeeze a wide mix into a phone speaker.

### 3.7 Music ducking with a sidechain compressor, SFX and remuxing a master

```bash
ffmpeg -y -i talk.mp4 -stream_loop -1 -i bed.mp3 -filter_complex "[0:a]aformat=channel_layouts=stereo,asplit=2[voice][key];[1:a]aformat=channel_layouts=stereo,volume=-14dB[music];[music][key]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=400:makeup=1[ducked];[voice][ducked]amix=inputs=2:normalize=0:duration=first,afade=t=out:st=57:d=3[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest out_mix.mp4
```

`threshold=0.05` linear is -26 dBFS: the bed ducks whenever the voice is louder than that. Ratio about the
duck amount in dB divided by 3 (minimum 2); 12 dB of duck is the default feel. Attack 20 ms, release 400 ms;
a shorter release brings the bed back faster, a lower threshold ducks on quieter speech. Start the bed 14 to
20 dB under the voice. Sound effects are a third bed that is never ducked (they are cut to the picture).
Voice clean-up chains, mild to strong:

```text
highpass=f=80,acompressor=threshold=-18dB:ratio=2:attack=5:release=80:makeup=1
highpass=f=80,deesser=i=0.4,afftdn=nf=-25:tn=1,acompressor=threshold=-18dB:ratio=3:attack=5:release=80:makeup=2
...the chain above, then deesser=i=0.6,acompressor=threshold=-24dB:ratio=4:attack=5:release=120:makeup=3,alimiter=limit=0.891251:level=disabled
```

Only the strong chain has a limiter, so normalise afterwards. Beat-placed SFX premix:
`[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:0.5,afade=t=out:st=0.46:d=0.04,volume=0.5,adelay=464|464[e0]`
per cue (delay in ms equals beat index times period), then `amix=inputs=N:normalize=0:duration=first`, two-pass
loudnorm to -14 LUFS and -1.2 dBTP, `alimiter=limit=0.87:level=false`, written as `pcm_s24le`. Remux a master
WAV into a render whose audio came out quieter:

```bash
ffmpeg -y -i render.mp4 -i master.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest final.mp4
```

### 3.8 Platform exports

| Preset | Frame | Video | Audio | Limits |
| --- | --- | --- | --- | --- |
| youtube | 1920x1080, source fps | libx264 preset slow, CRF 18, profile high, yuv420p | AAC 192k, 48 kHz | 12 h, 256 GB, -14 LUFS, -1 dBTP |
| reels | 1080x1920, 30 fps | libx264 preset medium, CRF 20, high, yuv420p | AAC 128k or 192k, 48 kHz | 90 s, 4 GB, -14 LUFS, SDR only |
| tiktok | 1080x1920, 30 fps | same as reels | same | 600 s, 4 GB, -14 LUFS, SDR only |
| shorts | 1080x1920, 30 fps | same as reels | same | 180 s, 256 GB, -14 LUFS |
| x | 1280x720, 30 fps | libx264 medium, CRF 22, high, yuv420p | AAC 128k, 44.1 kHz | 140 s, 512 MB, h264 only |
| linkedin | 1080x1080, 30 fps | libx264 medium, CRF 20 | AAC 128k, 48 kHz | 600 s, 5 GB |
| facebook | 1920x1080, 30 fps | libx264 medium, CRF 20 | AAC 128k, 48 kHz | 240 min, 4 GB |
| h265 | source | libx265 medium, CRF 24, yuv420p, `-tag:v hvc1` | AAC 160k | Apple-compatible tag |
| prores master | source | prores_ks profile 3 (422 HQ), yuv422p10le, `-vendor apl0`, .mov | pcm_s16le | editing master |

```bash
ffmpeg -y -i final_cut.mp4 -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p" -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 192k -ar 48000 -movflags +faststart youtube.mp4
ffmpeg -y -i final_cut_916.mp4 -r 30 -c:v libx264 -preset medium -crf 20 -profile:v high -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 -movflags +faststart reels.mp4
ffmpeg -y -i master.mp4 -c:v prores_ks -profile:v 3 -vendor apl0 -pix_fmt yuv422p10le -c:a pcm_s16le master.mov
```

Order for a delivery: colour (HDR to SDR, LUT), cut, join, silence, fit, captions and overlays, sync, audio
mix, loudness, export, then a compliance check (codec, pixel format, size, fps cap 60, true peak, colour
tags, VFR, duration cap, loudness within 2 LU of the spec) and a contact sheet. Conforming 60 fps to 30 is
fine for a talking head and choppy for sports or drone pans; keep 60 when the platform allows.

### 3.9 Contact sheets, strips and frames (look at the picture)

```bash
ffmpeg -y -i render.mp4 -vf "fps=6,scale=480:270,tile=layout=4x4" sheet_%02d.png            # 16 tiles per sheet, tile i of sheet k is at (k*16+i)/6 s
ffmpeg -y -i render.mp4 -vf "select='between(n,440,449)',scale=384:-1,tile=layout=5x2" -frames:v 1 -fps_mode passthrough strip.png   # 10 contiguous frames across a transition
ffmpeg -y -ss 7.29 -i render.mp4 -frames:v 1 -q:v 2 frame_7.29.png                          # one frame at a spoken word
ffmpeg -y -sseof -0.04 -i clip.mp4 -frames:v 1 -q:v 2 lastframe.jpg                          # the last frame, for a poster bracket
ffmpeg -hide_banner -i render.mp4 -vf blackdetect=d=0.03:pix_th=0.06 -f null -                # black frames of 30 ms or longer
ffmpeg -hide_banner -i render.mp4 -af volumedetect -f null -                                  # peak and mean level
```

Read the sheets at 960x540 for legibility and the strips for the defect signatures: a large jump then
several near-identical tiles (front-loaded ease or dead stop), one motion halting and another starting (two
moves that should be one), one tile unlike both neighbours (a pop). The tool measures, a person decides.

### 3.10 Silence removal, speed change, freeze, loop

```bash
ffmpeg -hide_banner -i talk.mp4 -af "silencedetect=noise=-35dB:d=0.6" -f null - 2>&1 | grep silence_   # list silences, then build keep ranges with a 0.15 s margin and cut as in 3.2
ffmpeg -y -i in.mp4 -filter_complex "[0:v]setpts=PTS/1.25[v];[0:a]atempo=1.25[a]" -map "[v]" -map "[a]" -c:v libx264 -crf 18 -c:a aac out_fast.mp4      # 1.25x, pitch preserved
ffmpeg -y -i in.mp4 -filter_complex "[0:v]setpts=PTS*2[v];[0:a]atempo=0.5[a]" -map "[v]" -map "[a]" -c:v libx264 -crf 18 -c:a aac out_half.mp4             # half speed
ffmpeg -y -i in.mp4 -vf "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,setpts=PTS*2" -an out_slowmo.mp4                              # fluid slow motion, 10 to 20x slower than real time to render
ffmpeg -y -i in.mp4 -vf "tpad=stop_mode=clone:stop_duration=2" -af "apad=pad_dur=2" out_hold.mp4         # hold the last frame 2 s
```

`atempo` accepts 0.5 to 100 per instance; chain instances for factors outside that range. A speed ramp is a
list of segments at constant speeds (`trim,setpts=(PTS-STARTPTS)/F` and `atrim,asetpts,atempo=F` per segment)
concatenated. Speed changes up to about 1.5x pass for talk; "make it 60 seconds" from three minutes is a trim
or a highlight cut, not a 3x speed-up. A fast-cut 24 fps generated clip that must sit in a 60 fps reel: speed
it up and re-encode all-intra at 60 (`-r 60 -g 1`) before placing it.

### 3.11 LUT, colour and HDR to SDR

```bash
ffmpeg -y -i log_footage.mp4 -vf "lut3d=file=grade.cube:interp=tetrahedral,format=yuv420p" -c:v libx264 -crf 18 -c:a copy out_lut.mp4
# blend a LUT at 70 percent
ffmpeg -y -i in.mp4 -filter_complex "[0:v]split[a][b];[b]lut3d=file=grade.cube:interp=tetrahedral[l];[a][l]blend=all_mode=normal:all_opacity=0.7,format=yuv420p[v]" -map "[v]" -map 0:a -c:v libx264 -crf 18 -c:a copy out_lut70.mp4
# PQ or HLG (phone HDR) to BT.709 SDR
ffmpeg -y -i hdr.mov -vf "zscale=t=linear:npl=1000,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p" -c:v libx264 -crf 18 -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a copy sdr.mp4
# typed primary correction (exposure, contrast, saturation, temperature, three-way balance, curves)
ffmpeg -y -i in.mp4 -vf "scale=in_color_matrix=bt601,format=gbrpf32le,exposure=exposure=0.3,colortemperature=temperature=5600,colorbalance=rs=0:gs=0:bs=0:rm=0.05:gm=-0.05:bm=0.05:rh=0:gh=0:bh=0,eq=contrast=1.1:saturation=1.05:gamma=1.0,curves=preset=medium_contrast,scale=out_color_matrix=bt601,format=yuv420p" -c:v libx264 -crf 18 -c:a copy out_cc.mp4
```

Tone-map choices: `hable` default, `mobius` keeps more highlight detail, `bt2390` is the broadcast standard.
Phone HDR is usually Dolby Vision profile 8 on an HLG base layer; tone-map from the base layer, or strip the
DV layer losslessly when players mis-render it. An HDR source pushed through an SDR encode without tone
mapping goes flat and grey; log footage (S-Log, V-Log, C-Log) tagged SDR looks grey and wants its LUT first.
Run colour before everything else in the chain.

### 3.12 Windows quirks

- Paths inside a filter string: a drive-letter colon is a filter option separator, so escape it and prefer
  forward slashes: `ass=C\:/work/captions.ass:fontsdir=C\:/work/fonts`, `lut3d=file=C\:/luts/grade.cube`.
  Paths given as plain arguments (`-i`, the output) need no escaping. Spaces inside a filter path also need a
  backslash or the whole filter in single quotes.
- Put long filter graphs in a file and pass the file (`-/filter_complex graph.txt`, or
  `-filter_complex_script graph.txt` on ffmpeg before 7.0). It removes every quoting problem in PowerShell,
  where `"` and `$` and backticks are live and single quotes are literal. In cmd.exe wrap the whole filter in
  double quotes and avoid `%` (it is the environment-variable character).
- `drawtext`: never put the text inline. Write it to a file and use `textfile=label.txt:expansion=none`; the
  graph parser never sees the text, so apostrophes, percent signs, colons, commas and brackets survive.
  Resolve a concrete `fontfile=` (escaped as above) instead of a family name: some Windows builds crash with an
  access violation when drawtext resolves a font through fontconfig. A font name given inline must be
  escaped (`\\ : , [ ] ;` with a backslash, drop `'` and `%`). `boxborderw=v|h` and `text_align=C` need
  ffmpeg 6.1 or newer.
- `-f null -` works for measurement passes on every platform (do not write `NUL`). Discard a stream with
  `-an` or `-vn`, not with redirects to `NUL`.
- `-pattern_type glob` is unsupported on some Windows builds (Chocolatey); use `%04d` sequence patterns or a
  concat list, and pass an explicit `-t` with a concat list of stills to keep the total exact.
- A crashed ffmpeg child reports a large unsigned exit code (4294967295 and similar) rather than a small
  signed one; test for non-zero, never for a specific value.
- Reopen the terminal after installing ffmpeg so PATH refreshes. Confirm the build has libass, libfreetype,
  libfribidi, libx264, libx265, libzimg (`zscale`) with `ffmpeg -buildconf`; a gyan.dev full build does.
- Node spawns on Windows: pass arguments as an array (no shell) so backslashes and spaces in paths survive;
  the filter-script-file approach above keeps the argument list short.

## 4. Voices and sound with ElevenLabs

All endpoints sit under `https://api.elevenlabs.io/v1`, authenticated with the header `xi-api-key`. SDKs:
Python `pip install elevenlabs`, JavaScript `npm install @elevenlabs/elevenlabs-js` (never the old
`elevenlabs` npm package), CLI `npm install -g @elevenlabs/cli`; all read `ELEVENLABS_API_KEY` from the
environment. Validate a key with `GET /v1/user`. Keys live in `.env`, never in a chat or a composition.

### 4.1 Text to speech

`POST /v1/text-to-speech/{voice_id}` (streaming variant `/stream`), body `{"text", "model_id",
"voice_settings", "language_code", "apply_text_normalization", "previous_text", "next_text"}`, query
`output_format`. SDK: `client.text_to_speech.convert(text=..., voice_id=..., model_id=...)` returning audio
chunks; CLI `elevenlabs text-to-speech convert --voice-id ID --text "..." --model-id eleven_v3 --output out.mp3`.

| Model | Languages | Latency | Use |
| --- | --- | --- | --- |
| `eleven_v4` | 90+ | standard | highest quality, emotional range, audio tags; only `stability` and `similarity_boost`; no SSML; not on the `stream-input` socket |
| `eleven_v4_turbo` | 90+ | about 100 ms | real-time v4 over the text-to-dialogue WebSocket, one voice per connection |
| `eleven_v3` | 70+ | standard | previous expressive model; audio tags; stability as three modes |
| `eleven_flash_v2_5` | 32 | about 75 ms | lowest latency and cost; `stream-input` WebSocket |
| `eleven_multilingual_v2` | 29 | standard | most stable on very long generations; `style` and `speed` available |

Voice settings: `stability` 0 to 1 (lower is more expressive, higher is steadier), `similarity_boost` 0 to 1
(higher is closer to the sample and amplifies its artifacts), `style` 0 to 1 and `speed` 0.25 to 4.0 (v2 and
v3 only), `use_speaker_boost`. Presets that read as human: narration stability 0.7 and similarity 0.5;
conversational 0.4 and 0.75; news 0.8 and 0.6; character or drama 0.3 and 0.8 with direction in the text.
On v3 the stability slider is effectively three modes: creative (about 0.0, most expressive, obeys tags,
least stable), natural (0.5), robust (1.0, steady, largely ignores tags). For an ad voice-over start natural,
move toward creative only when a tag is being ignored, and never ship a take you did not listen to.

Audio tags (v3 and v4) are square-bracketed directions inside the text: `[whispers]`, `[laughs]`,
`[sighs]`, `[excited]`, `[sarcastic]`, `[curious]`, `[crying]`, `[shouts]`, `[pause]`, `[clears throat]`,
`[exhales]`, `[gasps]`, plus descriptive ones such as `[nervously]` or `[strong French accent]` that the
model follows to a degree; verify each by ear. Pacing and emphasis also come from punctuation: ellipses for
pauses, capitals for stress, a dash-free short sentence for a beat. Text normalisation (`"auto"`, `"on"`,
`"off"`) decides whether `01/15/2026` is read as a date or as digits. For long scripts in several requests,
pass `previous_text` and `next_text` so prosody stitches across the boundaries. Formats: `mp3_44100_128`
default, `mp3_44100_192` on Creator and above, `pcm_44100` and `pcm_48000` on Pro and above, `wav_44100`,
`opus_48000_64`, `ulaw_8000` for telephony. Track spend with the `x-character-count` and `request-id` headers.

Human texture: choose the voice to the register before tuning any number; short sentences; write the breath
in with punctuation; at most one direction tag per sentence; regenerate a line rather than stacking tags;
the same model and settings across every line of one film.

### 4.2 Text to dialogue

`POST /v1/text-to-dialogue` (and `/stream`) takes an ordered list of turns, each with its own voice, and
renders them as one scene with natural turn-taking, so a two-voice ad spot or an interview does not need
per-line generation and manual joins:

```json
{
  "model_id": "eleven_v3",
  "inputs": [
    { "text": "[curious] You built the whole thing over a weekend?", "voice_id": "VOICE_A" },
    { "text": "[laughs] Two weekends. The first one was all coffee.", "voice_id": "VOICE_B" }
  ],
  "settings": { "stability": 0.5 }
}
```

Query `output_format` as for TTS. The WebSocket form `wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=mp3_44100_128`
registers voices in the first message (`{"voices": [...], "xi_api_key": "..."}`), takes
`{"inputs": [{"text", "voice_id", "new_turn"}]}`, buffers about 40 characters and 8 words before emitting
audio (`{"flush": true}` forces it), closes after 20 s idle unless `{"keep_alive": true}` is sent, returns
`{"audio": base64, "is_final"}`, and gives word timing with `sync_alignment=true` on the query string.
`eleven_v4_turbo` allows one voice per connection, `eleven_v4` up to 10; only v3 and v4 models work here
(the older `/v1/text-to-speech/{voice_id}/stream-input` socket takes Flash and Multilingual v2).

### 4.3 Finding and adding a voice

Your own voices: `GET /v1/voices` (SDK `client.voices.get_all()`), each with `voice_id`, `name`, `labels`
(gender, age, accent, description, use case), `preview_url`. The shared library:
`GET /v1/shared-voices` with filters `gender` (`male`, `female`, `neutral`), `age` (`young`, `middle_aged`,
`old`), `accent` (for example `american`, `british`, `australian`, `indian`), `language` (ISO code),
`use_cases` (for example `narrative_story`, `conversational`, `characters_animation`, `social_media`,
`entertainment_tv`, `advertisement`, `informative_educational`), `category` (`professional`, `high_quality`,
`famous`), `search` (free text), `featured`, `page_size` up to 100, `sort`. Each result carries
`public_owner_id`, `voice_id`, `preview_url`, `free_users_allowed`, `live_moderation_enabled`,
`rate` and the usage notes. Add one with `POST /v1/voices/add/{public_owner_id}/{voice_id}` and body
`{"new_name": "Narrator A"}`; it then has a `voice_id` in your account. Clone from samples with
`POST /v1/voices/add` (multipart `name`, `files[]`, `description`, `labels`) only with the speaker's
documented consent. Audition two or three candidates on the first real sentence, at the final settings.

### 4.4 Speech to text (Scribe) with word timings and audio events

`POST /v1/speech-to-text` multipart with `file` (or `cloud_storage_url`, or `source_url` for hosted media)
and `model_id=scribe_v2` (`scribe_v2_medical` for clinical audio; realtime variants for live use). Options:
`timestamps_granularity` (`word` default, `character`, `none`), `diarize` (up to 32 speakers;
`num_speakers`, `diarization_threshold` about 0.22, `detect_speaker_roles` for agent and customer),
`tag_audio_events` (default true: laughter, applause, music become `audio_event` entries), `keyterms` (up
to 100 terms, 50 characters and 5 words each, for names and jargon), `language_code` (ISO 639-1 or 639-3,
auto-detected otherwise), `no_verbatim` (drops filler words and false starts: do not use it for a cutting
transcript, where the fillers are what you cut), `seed` for a repeatable result, `additional_formats`
(`srt`, `txt`, `docx`, `html`, `pdf`, `segmented_json`), `transcript_edit` (a natural-language instruction
applied to the text, 30 percent surcharge), `webhook` for async. Limits 5 GB and 10 hours per file.

Response: `text`, `language_code`, `language_probability`, `audio_duration_secs`, `words[]` with `text`,
`start`, `end`, `type` (`word`, `spacing`, `audio_event`), `speaker_id`, `channel_index`. Filter to
`type == "word"` before cutting; keep `audio_event` entries to find laughs and claps you may want to cut
around or score. For a cutting transcript extract mono 16 kHz audio first (`ffmpeg -i in.mp4 -vn -ac 1
-ar 16000 -b:a 64k audio.mp3`) to keep the upload small, and store the result beside the source so the same
take is never paid for twice. A 401 is a bad key; a 403 is a key without speech-to-text permission.

### 4.5 Music

`POST /v1/music` (SDK `client.music.compose`) with either `prompt` plus `music_length_ms` (3,000 to 600,000)
or a `composition_plan`, `model_id` (`music_v2_5` is the current best; the endpoints default to `music_v1`
so always pass it), `force_instrumental`, `output_format` (`auto` gives `mp3_48000_192` on v2 models;
`mp3_48000_320` available). `music.compose_detailed` returns the plan and metadata with the audio and, with
`store_for_inpainting=true`, a `song_id`. `music.composition_plan.create(prompt, music_length_ms, model_id)`
returns an editable plan. Plans are an ordered list of up to 30 `chunks`, each 3,000 to 120,000 ms, with
`text` (section labels like `[Intro]`, lyrics, inline cues like `{guitar solo}`), `duration_ms`,
`positive_styles` and `negative_styles` (up to 50 each, English), `context_adherence` (`low`, `medium`,
`high`). Put genre, instrumentation and vocal style in the first chunk's styles (6 or 7 of them set the
tone), not in the text. Inpainting (enterprise) mixes reference chunks `{"song_id", "range": {"start_ms",
"end_ms"}}` with new generation chunks and can condition a chunk on up to 30 s of a stored song with
`condition_strength` `low` to `xhigh`. `POST /v1/music/video-to-music` scores uploaded video (1 to 10
files, 200 MB and 600 s combined) from a `description` and up to 10 `tags`. There is no stems endpoint:
separate a mix afterwards with a source-separation model (section 5.3). Prompts cannot name artists or quote
copyrighted lyrics; a `bad_prompt` error returns a `prompt_suggestion`. For a bed under narration ask for an
instrumental with clear space for a voice, a steady measurable tempo, and a few seconds more than the cut.

### 4.6 Sound effects

`POST /v1/sound-generation` (SDK `client.text_to_sound_effects.convert`) with `text`, `duration_seconds`
0.5 to 30 (auto when omitted), `prompt_influence` 0 to 1 (default 0.3; 0.8 for a UI click that must be
exactly what you asked), `loop` true for a seamless ambience (v2 model `eleven_text_to_sound_v2`),
`output_format`. Prompt with the physical event, surface, distance and style: "heavy rain on a tin roof",
"footsteps on gravel with distant traffic", "cinematic braam, horror", "8-bit jump". Generate a kit per film
(pops, clicks, whooshes, ticks, shimmer, sub boom, final hit, brand-native sounds), trim each cue to its
audible onset, and place by beat (section 3.7).

### 4.7 Voice isolation

`POST /v1/audio-isolation` (SDK `client.audio_isolation.convert(audio=file)`) strips room tone, HVAC,
traffic and music from a recording and returns MP3 by default; `file_format=pcm_s16le_16` skips decoding for
16 kHz mono PCM input. Use it before transcription of noisy audio, before voice conversion, and to pull a
usable voice out of a phone recording; listen for the watery artefacts it leaves on breaths and re-run the
mix at a lower bed level instead of isolating harder.

### 4.8 Pricing and licensing notes

Billing is in characters for TTS and dialogue (the `x-character-count` header is the invoice per call),
by audio duration for voice conversion (1,000 characters per minute processed), by hours of audio for
Scribe, by generated length for music and sound effects; `429` means the plan's credit pool or concurrency
is exhausted. Check the pricing page and the remaining credits before a batch; record the cost per asset.
Licensing for an ad: commercial use needs a paid plan (the free tier is non-commercial with attribution);
each library voice carries its own terms (restricted uses, required notices, live moderation, not for free
accounts), read them before the voice goes into a spot; a cloned voice needs the speaker's written consent;
confirm the plan's grant for generated music before it plays under a paid placement. Keep the evidence
(plan, voice terms, consent) with the deliverable.

## 5. fal.ai: the generation API behind most video models

Most image, video, voice and lip-sync models used in this skill sit behind one queue API. The agent-first
way in is the `genmedia` CLI; the raw queue shape is below for pipelines that call it directly.

### 5.1 The queue API

Submit, poll, fetch. Authenticate with `Authorization: Key $FAL_KEY`.

```text
POST https://queue.fal.run/{endpoint_id}            body: the model's input JSON
  -> { "request_id", "status_url", "response_url", "cancel_url" }
GET  {status_url}?logs=1                             -> { "status": "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED", "queue_position", "logs": [...] }
GET  {response_url}                                  -> the model's output JSON (image or video objects with "url", "width", "height", "content_type")
PUT  {cancel_url}                                    -> cancels a queued job
```

Rules: use the `status_url` and `response_url` the submit returned rather than building them (the status
path is on the app id, not the full endpoint path); poll every 3 to 5 s; a `FAILED` status carries an
`error`; `?fal_webhook=https://your.server/hook` on the submit replaces polling; `https://fal.run/{endpoint_id}`
runs synchronously for images only, never video; download every output URL promptly (they are not permanent).
Storage upload: `fal_client.upload_file(path)` (Python) or `fal.storage.upload(file)` (JavaScript) return a
CDN URL for `image_url`, `video_url` or `audio_url`; a data URI works for small files. Schema:
`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={endpoint_id}` (fields, enums, defaults, output
shape). Price: the model page `https://fal.ai/models/{endpoint_id}` states the unit (per image, per second of
video, per megapixel, per minute of audio) and the amount.

### 5.2 The CLI

Install: `curl https://genmedia.sh/install -fsS | bash` (Linux, macOS) or `irm https://genmedia.sh/install.ps1 | iex`
(Windows PowerShell), then `genmedia setup --non-interactive --api-key "$FAL_KEY"` (or leave the key in
`FAL_KEY` and pass `--no-save-key`). Set `GENMEDIA_NO_UPDATE=1` in CI.

| Command | Purpose |
| --- | --- |
| `genmedia models "<query>" [--category text-to-video] [--limit 5] [--status all] --json` | search the catalog; the category is inferred from the query unless `--no-classify` |
| `genmedia models --endpoint_id <id> --json` | verify an endpoint exists and is not deprecated |
| `genmedia schema <id> --json` or `--format openapi` | inputs, outputs, enums; always before a run with custom parameters |
| `genmedia pricing <id> --json` | cost per call |
| `genmedia run <id> --<param> <value> [--async] [--download "./out/{request_id}_{index}.{ext}"] --json` | run; any schema field is a flag; `genmedia run <id> --help` lists them |
| `genmedia run "<prompt>" --json` | smart routing: classifies the prompt (image, video, music, tts, 3d) and picks a default endpoint; the output's `routed` block names what ran |
| `genmedia status <id> <request_id> [--result] [--logs] [--cancel] [--download ...] --json` | poll an async job |
| `genmedia upload <path-or-url> --json` | upload to the CDN, returns `url` |
| `genmedia docs "<topic>" --json` | documentation search |

Rules: `--json` whenever an agent reads the output; never invent an endpoint id (search, then verify);
inspect the schema before any custom parameter or a guessed flag fails with 422; `--async` for every video,
audio and 3D job; download with `--download`, not curl; record endpoint, request id, prompt, seed and path.

```bash
SUBMIT=$(genmedia run bytedance/seedance-2.0/image-to-video --image_url "$URL" --prompt "slow push-in, wind in the hair, haze drifting" --async --json)
REQ=$(echo "$SUBMIT" | jq -r '.request_id'); EP=$(echo "$SUBMIT" | jq -r '.endpoint_id')
until [ "$(genmedia status "$EP" "$REQ" --json | jq -r '.status')" = "COMPLETED" ]; do sleep 5; done
genmedia status "$EP" "$REQ" --download "./out/{request_id}_{index}.{ext}" --json
```

### 5.3 Model routing defaults by task

Defaults, not laws: verify the endpoint, read the schema, check the price, and let a named preference win.

| Task | First choice | Then |
| --- | --- | --- |
| Text-heavy stills (posters, UI, labels, infographics) | `openai/gpt-image-2` at `quality=high`, 2K or 4K | `fal-ai/nano-banana-pro`; cheap models are not acceptable here |
| Premium still, realistic or styled | `openai/gpt-image-2` | `fal-ai/nano-banana-pro`, `fal-ai/nano-banana-2`, `fal-ai/bytedance/seedream/v5/lite/text-to-image` |
| Fast draft stills | `fal-ai/flux-2/klein/9b` | `fal-ai/flux-2/klein/4b`, `fal-ai/flux-2/flash`, `fal-ai/z-image/turbo` |
| Image edits (background, relight, outfit, product placement, multi-image) | `fal-ai/nano-banana-pro/edit` | `openai/gpt-image-2/edit` (up to 16 inputs), `fal-ai/bytedance/seedream/v5/lite/edit` |
| Highest quality video | `bytedance/seedance-2.0/text-to-video`, `/image-to-video`, `/reference-to-video` | `fal-ai/veo3.1`, `fal-ai/kling-video/v3/pro/...`, `fal-ai/kling-video/o3/pro/...` (4K variants under `/v3/4k/` and `/o3/4k/`), `fal-ai/minimax/hailuo-2.3/pro/...` |
| Fast or cheap video | `bytedance/seedance-2.0/fast/...` | `xai/grok-imagine-video/text-to-video` and `/image-to-video`, `fal-ai/veo3.1/lite`, Kling v3 standard |
| Multi-shot storytelling | Seedance 2.0 | Kling v3 pro (multi-prompt, element controls), `alibaba/happy-horse/...`, `fal-ai/wan/v2.7/...` |
| First to last frame | `fal-ai/kling-video/o1/image-to-video` | `fal-ai/veo3.1/first-last-frame-to-video`, `fal-ai/wan-flf2v`, `fal-ai/vidu/q1/start-end-to-video` |
| Talking head from a portrait | `veed/fabric-1.0` (image plus audio), `veed/fabric-1.0/text` | `fal-ai/creatify/aurora` (visual direction), `fal-ai/bytedance/omnihuman/v1.5`, Kling AI Avatar v2 |
| New speech on existing footage | `fal-ai/sync-lipsync/v2` | Kling lipsync endpoints |
| Expressive TTS | `fal-ai/elevenlabs/tts/eleven-v3`, `fal-ai/elevenlabs/text-to-dialogue/eleven-v3` | `fal-ai/minimax/speech-2.8-hd`; fast: `fal-ai/minimax/speech-2.8-turbo`, `fal-ai/kokoro/american-english` |
| Music | `fal-ai/elevenlabs/music` | `fal-ai/minimax-music/v2.6`, `fal-ai/lyria2`, instrumental `fal-ai/stable-audio-25/text-to-audio` |
| Sound effects | `fal-ai/elevenlabs/sound-effects/v2` | `fal-ai/mmaudio-v2` (foley synced to a video from a prompt) |
| Transcription | `fal-ai/elevenlabs/speech-to-text/scribe-v2` (diarization) | `fal-ai/wizper` (Whisper v3), `fal-ai/speech-to-text` |
| Stems and clean-up | `fal-ai/demucs` (vocal and instrumental separation) | `fal-ai/elevenlabs/audio-isolation`, `fal-ai/sam-audio/separate` |
| Deterministic utilities | `fal-ai/ffmpeg-api/merge-audio-video`, `workflow-utilities/amix-audio`, `workflow-utilities/auto-subtitle`, `workflow-utilities/add-subtitles-to-video`, `workflowutils/resize-image`, `workflowutils/composite-image`, `workflowutils/sam-hq` (masks) | inspect schema before each |

Prompting differences that matter: GPT Image 2 wants a structured five-part prompt (scene, subject,
important details, use case, constraints) with literal text in quotes or capitals and edits written as
"Change: ... Preserve: ..."; Kling wants one declarative line of 30 to 40 words per shot and, from a still,
motion only (re-describing the frame makes it drift); Happy Horse wants about 20 words and gets worse with
every adjective; multi-beat action goes in a timecoded shot list when the schema has one. Durations are
usually 5 or 10 s; longer costs more and drifts more. Seeds give repeatable iterations where supported.

### 5.4 The cinematography vocabulary

Build a prompt in this order: subject, context (place, time, weather, story moment), lens and framing,
camera motion (video only), atmosphere, mood and colour, output controls (ratio, duration, continuity).
Visual facts beat prestige adjectives: "overcast daylight, brushed aluminium, 50 mm feel" instead of
"stunning, cinematic".

- Shot sizes: extreme close-up (one detail), close-up (face or object with emotional focus), medium
  close-up (chest up), medium (waist up), full (whole body, silhouette readable), wide (subject inside the
  environment), extreme wide (scale, isolation).
- Angles: eye level (grounded), low (power, awe), high (vulnerability, layout clarity), Dutch (unease,
  sparingly), over the shoulder (relationship), POV (subjective), profile (graphic, fashion).
- Movement: slow push-in (attention, premium reveal), pull-back (isolation, reveal), dolly left or right
  (discovery), tracking (follow action), crane up (scale, release), handheld (urgency, intimacy),
  locked-off (control, deadpan), orbit (product, inspection), macro glide (texture, food, jewellery).
- Composition: centred symmetry (control, luxury), rule of thirds, negative space (copy area, tension),
  foreground obstruction (secrecy), leading lines, frame within frame.
- Lighting: soft key (commercial calm), hard key (graphic, noir), backlight (separation, silhouette), rim
  light (outline, glass, metal), practicals (lamps, signs, screens), motivated light, low key, high key,
  top light (institutional), window light (documentary).
- Lens feel: 14 to 20 mm (scale, kinetic interiors), 24 to 28 mm (environmental realism), 35 mm (natural
  cinematic), 50 mm (portrait and product balance), 85 mm (compressed portrait), 100 mm macro (detail),
  telephoto compression (distance, surveillance). Depth: shallow, deep, rack focus.
- Colour and grade: clean neutral (e-commerce), warm golden (nostalgia, hospitality), cool cyan shadows
  (thriller, tech), desaturated earth (documentary), high-contrast monochrome (noir, fashion), pastel
  (beauty, wellness), sodium vapour night (urban tension).
- Texture: fine grain (organic, period), clean digital (tech, luxury), halation (dream, night practicals),
  mist filter (romance), crisp high shutter (action), motion blur (speed).
- Continuity phrases: "same subject and wardrobe as the reference", "preserve product shape and label",
  "continue from the uploaded first frame", "single continuous shot", "no cutaways", "no time jump",
  "same lighting direction throughout".

Quality bar: the move is physically plausible; lens, shot size and angle do not contradict each other;
lighting direction is consistent; the grade does not flatten the subject; one shot per prompt unless the
model takes a shot list. A generic result wants more camera, blocking, light and environment, not adjectives.

### 5.5 The character-design workflow

Consistency is the whole job. The anchor is an identity contract repeated verbatim in every prompt; the
variable block is the only thing that changes.

1. Collect inputs: character type (realistic, stylised, anime, mascot), identity anchor (age range, face
   shape, eyes, nose and lips, skin and marks, hair, build and posture, signature wardrobe or prop), style
   target, outputs needed, references, consistency level (exploratory, pitch, production).
2. Write the anchor once and freeze it:
   `CHARACTER ANCHOR: [codename], [age range], [face shape], [eye shape and colour], [brows], [nose],
   [mouth], [skin details], [hair colour, length, texture, style], [build and posture], [signature wardrobe
   or accessory], [visual style]`. Then per shot:
   `SHOT VARIABLE: [expression], [pose or action], [outfit allowed to change or not], [setting], [camera
   distance and angle], [lighting], [mood], [output format]`. What may change: expression, pose, angle,
   lighting, setting; outfit, period and medium only on request. What never drifts: eye spacing and shape,
   face silhouette, nose and lip structure, hair silhouette, skin marks, proportions, the signature accessory.
3. Concept portrait: `openai/gpt-image-2` (most consistent) or `fal-ai/nano-banana-pro`; drafts on
   `fal-ai/flux-2/klein/9b`. Waist-up, neutral expression, simple background, no extra characters.
4. Reference sheet: full-body front view with the whole silhouette and costume seams, then a turnaround
   (front, side, back, consistent proportions, white background, "no style drift between views").
5. Expression sheet: one approved face reference, a nine-portrait grid (neutral, happy, angry, afraid, sad,
   surprised, suspicious, determined, amused), "same face, same hairstyle, same style, clean grid".
6. Identity-preserving edits for outfits and props: upload the approved image, `fal-ai/nano-banana-pro/edit`
   or `openai/gpt-image-2/edit`, prompt "keep the uploaded character's face, hair, body proportions and
   style exactly consistent; change only the outfit to ...; no face changes". Separate change from preserve.
7. Character to video: an approved still first, then `bytedance/seedance-2.0/image-to-video` (drafts on
   `xai/grok-imagine-video/image-to-video`): "[duration] second shot of the uploaded character, same face,
   hair, outfit and proportions, [specific action], [camera movement], [environment], [lighting],
   controlled motion, no age drift, no costume morphing". Talking: `veed/fabric-1.0` with the approved
   portrait and the voice track from section 4.
8. Negative prompt when the schema supports one: "different face, different hairstyle, different eye
   colour, altered age, changed outfit, extra character, distorted hands, inconsistent style, cropped body,
   duplicate character, text, watermark".
9. Reject and retry when face shape, eye spacing, hairstyle, marks or build drift; when the outfit changes
   although only expression or pose should; when a sheet mixes styles; when hands or props distract; when
   video motion changes age, face, costume or silhouette. If identity keeps slipping, strengthen the anchor
   or move to an edit or reference workflow instead of adding style words.
10. Return the downloaded paths and the exact anchor used, so the next session reuses the identity.
    Escalate consistency in this order: text anchor, approved image reference, edit or reference-image
    workflow, image-to-video from approved stills, an identity-preserving endpoint for a production series.

## Sources

Built from four public skill repositories, all read as data: the HyperFrames student kit by Nate Herk
(github.com/nateherkai/hyperframes-student-kit, MIT) for the code renderer, the short-form, showreel,
storytelling, beats and website-to-video methods and the silence and mistake cutters; ffmpeg-skill by
kajisho5 (github.com/kajisho5/ffmpeg-skill, MIT) for the filter graphs, platform presets, safe zones and
Windows pitfalls; the ElevenLabs skills (github.com/elevenlabs/skills, MIT) for the voice, dialogue,
transcription, music, sound-effect and isolation endpoints; and the fal.ai community skills
(github.com/fal-ai-community/skills, MIT) for the queue API, the CLI, model routing, cinematography and
character-design workflows. Library-search, licensing and raw queue-URL details were completed from the
vendors' public API references and should be re-checked there before use.
