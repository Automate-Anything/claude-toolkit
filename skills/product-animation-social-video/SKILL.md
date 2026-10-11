---
name: "product-animation-social-video"
description: "Turn a product screenshot or mockup story into a voiced, captioned social video (Reels, TikTok, Shorts, Instagram/Facebook feed, LinkedIn, YouTube) with a hook opening, a narrated product story, an end card, music and sound design, exported as MP4s in 9:16, 4:5, 1:1 and 16:9. Use when the video is built from the real product's screens (screenshots, HTML mockups, the app UI) rather than AI-generated footage; for films made from generated footage use ai-video-production. Read product-animation-core first."
---

# Product animation: social videos

A social video is the same product story as a website loop, but voiced and captioned. It is bookended by an **opening slide** (the hook) and an **end card** (brand + CTA), and exported in four sizes.

**Read product-animation-core first**: the source extraction, story method, realism rules, one-clock engine and pattern library all apply here unchanged. In a video, the clock runs once to `DURATION` instead of looping, and every frame is rendered on demand.

**Related: ai-video-production.** That skill covers films made from AI-generated footage; this one covers videos built from the real product UI. Its research on the first three seconds, voices, words on screen and the sound mix applies here too: read its `references/hooks-and-first-seconds.md`, `references/words-on-screen.md` and `references/editing-sound-rendering.md` before designing an opening or mixing audio. Where the two disagree on a product-UI video, this skill wins.

## 1. Structure

1. **Opening (0 to ~4s).** A headline that states the problem in the viewer's world, plus the trigger object (for example a phone ringing with Decline/Accept).
   - It is fully composed on frame 0, because frame 0 is the autoplay preview and the default cover. Nothing fades in from empty.
   - The narrator reads the headline.
2. **Hand-off transition.** The product "acts" on the trigger: the AI taps Accept (press scale `1-0.14·sin`), a single green ripple runs, and the label changes to "Answered by AI".
   - The headline lifts away (fade + translateY −34px, staggered 60ms).
   - An **iris** opens from the button into the product scene: `-webkit-mask-image: radial-gradient(circle at x y, transparent r, #000 r+2)`, over 650ms with easeInOut.
3. **Narrated bridge.** The narrator says what happened ("Good thing your AI receptionist picked up.") over the iris, before the product audio starts.
4. **Product story.** The real mockup, with word-synced captions above it, driven by the real voices.
5. **Win caption.** The narrator delivers the payoff over the win state ("Booked and confirmed, while you were off the clock.").
6. **End card.**
   - A **shared-element transition** carries the win object into the end card: a copy of the confirmed booking card flies from its rect in the scene to a placeholder slot on the end card, rotating to about −2.5°, while the end layer fades in over 600ms.
   - The narrator reads the brand name and tagline.

## 2. Capture page (deterministic)

Build one HTML page per video (not a canvas artboard). It exposes:

- `window.render(t)`: sets every element's style for time `t` (ms). It is a pure function, so any frame can be rendered in any order.
- `window.DURATION`.
- `window.EVENTS`: ms timestamps for rings, accept, iris, lines, win and end. The sound-design script reads it.
- `?fmt=916|45|11|169` picks the layout via a class on the root (`.f916`, `.f45`, `.f11`, `.f169`).
- `?capture=1` disables the live clock.
- `window.VO` (voice timeline JSON) is injected before load with Playwright `add_init_script`. All timing constants derive from it.

Layout per format is CSS only (`.f45 #phone{…}`). For elements scaled with `zoom`, remember that `left`/`top` are in zoomed units: divide the target pixel position by the zoom.

Auto-center end-card content with a small `centerEnd()` that measures the stack. In 9:16, center it within the safe band; in other formats, center it in the frame.

## 3. Sizes and safe zones

| Format | Size | Use |
|---|---|---|
| 9:16 | 1080×1920 | Reels, TikTok, Shorts, Stories |
| 4:5 | 1080×1350 | Instagram/Facebook feed |
| 1:1 | 1080×1080 | Feed, LinkedIn, X |
| 16:9 | 1920×1080 | YouTube, LinkedIn, website |

**9:16 safe zone.**
- Keep all text and key UI within y 285 to 1440.
- Keep the right rail clear: x > 940 when y > 1000 (like/comment buttons).
- Instagram's feed grid crops Reels to the center 4:5, so the hook must read in that crop.

The 4:5, 1:1 and 16:9 versions get their own layouts, not letterboxing: text and trigger side by side in wide formats, and scaled end cards (about .8 / .62 / .76).

## 4. Timing

- **Reading time:** every caption stays on screen at least `0.5s + words ÷ 3.5`. Audit it with a table before rendering.
- **Let the voice drive the timeline.** Line N+1 starts after line N's last word ends, plus a gap (about 380ms after the AI, about 450ms after the caller).
- `accept = max(2750, hookNarrationEnd + 250)`. Rings repeat every 850ms until then.
- Hold the end card at least 3.4s, and at least the narrator's end line plus 900ms.
- Total: aim for 25 to 35s.

## 5. Captions

- One line of speech per caption, shown above the product with a speaker chip ("Caller", "AI", "Booked at 9:03 PM").
- Words bold as they are spoken (from the timestamps).
- Long lines step down in size: over 50 characters ×0.88, over 62 ×0.8.
- Leave **at least 40px** between the chip and the caption text (32px at 1:1). Users notice cramped spacing on phones.
- A cream plate fades behind the caption area so the scrolling UI never collides with text.
- **Text and SMS threads are never voiced.** Voicing texts makes them read as a phone call (user feedback). Only the narrator speaks.
  - Time each message by reading time (`0.5s + words ÷ 3.5`), not by voice.
  - Show the newest message in the caption as a message bubble: incoming in a light bubble, the AI's reply in the accent color. Use chips like "Text from Ava" and "AI replied" instead of call-style speaker chips.
  - In the product scene, typing dots run for about 1s before each message lands, and the AI's replies write out quickly.
  - Sound: a soft message ping for incoming texts and a short "sent" swoosh for the AI's replies, instead of phone rings.
  - The opening's trigger object is a lock-screen message notification with a Reply button, which the AI taps ("Replied by AI").

## 6. Design rules for opening and end slides (from real feedback)

- Work like a senior UI/UX designer:
  - left-aligned editorial layout;
  - one display face at 800 weight with tight tracking (−0.045em);
  - a muted secondary line;
  - a single accent color.
- Avoid template tells:
  - single-word color accents;
  - ALL-CAPS eyebrows;
  - strings of middle dots;
  - "→" in CTAs;
  - glowing gradient blobs.
- Put any phone or device mockup in neutral hardware: graphite body and dark slate wallpaper. **Never tint the device in the brand color** (a maroon phone was rejected).
- Opening and end card share the same background (for example brand cream), so the video starts and ends in one world. A dark opening with a light end card felt disjointed.
- When the client wants options, put **five distinct directions** side by side on a Design canvas at 1080×1920 before building. Examples: light gallery, giant clock typography, full-bleed call screen, brand-color ripple, closed-sign storytelling. Implement the pick in all four formats.
- The opening that worked:
  - small eyebrow "Friday, 9:02 PM" with an accent dot;
  - two-line headline with an explicit `<br>` (no orphans);
  - a muted subline;
  - a graphite phone rising from the bottom edge, cropped by the frame, with Decline/Accept moved up the screen so they sit inside the safe zone.
- End card (top to bottom):
  - logo + name;
  - tagline (about 112px);
  - the flown-in win card;
  - one-sentence value prop;
  - three check-icon proof points (only ones the site actually claims);
  - a full-width CTA button;
  - the URL.

## 7. Voiceover (ElevenLabs)

- **Key handling:** the user supplies the key. Pass it only as an env var on the command (`XI_KEY=… python3 build_vo.py`). Never write it to files, skills or memory, and suggest they rotate it afterwards.
- **Casting:**
  - Audition several voices per role: narrator, AI agent, caller.
  - Library voices need a paid plan. A 402 means upgrade, not a bug.
  - Let the user choose by ear and record the voice IDs in the build script.
  - The narrator should sound smooth and confident. The AI agent should be warm and conversational. The caller should sound natural, not polished.
- **Endpoint:** `POST /v1/text-to-speech/{voice}/with-timestamps` returns audio plus character alignment.
  - Group characters into words by splitting on spaces.
  - Trim leading silence to about 30ms and shift the timestamps to match.
- **Display text vs spoken text:** keep a `(who, display, spoken)` tuple with the **same word count**, so timestamps map one-to-one onto the on-screen words ("11" ↔ "eleven", "2:30" ↔ "two-thirty"). Assert it.
- **Cache** every take by hashing voice + text + model + settings + seed, and retry on connection resets.
- **Pronunciation:**
  - Respell difficult words in the spoken text ("balla-yahzh" for balayage).
  - For narrator stress problems, use `eleven_flash_v2` with CMU arpabet phoneme tags, for example `<phoneme alphabet="cmu-arpabet" ph="S AH0 L AA1 N">salon</phoneme>`.
  - Play candidate spellings for the user and let them reject by ear.
- **Verify every narrator line with speech-to-text** (`POST /v1/speech-to-text`, `model_id=scribe_v1`). Models swap small words ("a call" came out as "the call").
  - If the transcript is wrong, generate several takes with different `seed` values, transcribe each, and keep a take that matches.
  - STT is lenient, so still ask the user to listen.
- **Phone line:** band-pass the in-call voices to 170 to 7000Hz (×1.15 gain) so they sit apart from the narrator.
- **Outputs:** `vo/<variant>/timeline.json` (lines with word timings, rings, accept, win, winCap, end, total, narration spans, waveform envelope), `call.wav` and `narr.wav`.

## 8. Sound design (numpy/scipy, timed from EVENTS)

- **Ring:** 400+450Hz with a 20Hz warble, 0.42s each.
- **Accept:** two-note blip (880 → 1320Hz).
- **Iris:** a quiet band-passed noise whoosh.
- **Win:** two-note bell chime (C6 + G6 with harmonics).
- **End card:** whoosh plus a small CTA pop.
- **Text threads:** a two-note message ping (E6 then A6, short decay) for incoming texts, and a rising band-passed noise swoosh plus a light blip for sent texts. No rings.
- **Music bed:**
  - warm pad + eighth-note pluck arpeggio, about 100bpm (Fmaj7, Dm7, Bbmaj7, Cmaj7), low-passed at 3.8kHz;
  - fades in at accept and out over the last 1.4s.
- **Ducking:** `duck = 1 - 0.62·clip(speechEnvelope/0.025)` on music and effects (about −8dB). Lay voices on top at ×1.9, then peak-normalize.

## 9. Render pipeline

```python
# render.py page_url out.mp4 W H [VO_DIR]
pg = browser.new_page(viewport={"width": W, "height": H})
pg.add_init_script("window.VO = " + open(VO_DIR + "/timeline.json").read() + ";")
pg.goto("file://" + page + "?fmt=916&capture=1")
for f in range(int(DURATION / 1000 * 60)):
    pg.evaluate(f"render({f * 1000 / 60})")
    ffmpeg.stdin.write(pg.screenshot(type="jpeg", quality=95))
# ffmpeg: -f image2pipe -framerate 60 -c:v mjpeg -i - -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart
# then make_audio.py events.json audio.wav VO_DIR; mux with AAC 192k
```

- Run the four formats **in parallel**, each in its own `jobs/<variant>-<fmt>/` folder (they write same-named temp files).
- **Loudness:** finish with `loudnorm=I=-14:TP=-1:LRA=11` (social platforms target about −14 LUFS). Check with `ebur128`.
- **Cover:** export a JPG at about 1.5s from the 9:16 render.
- **Naming:** `<product>-<story>_v<N>_<fmt>.mp4`. Bump the version on every delivery and keep old ones.
- **Before every render:** snapshot frames at key times (frame 0/cover, just after accept, mid-iris, a long caption, the win, the end card) in all four formats. Tile them into one contact sheet and look at it. This is where text-color inheritance bugs, overlaps and safe-zone breaks show up.

## 10. Delivery

- Send all four MP4s together, with a one-line caption saying what changed.
- When asked, write the post caption:
  - a hook line that repeats the video's opening;
  - a short story paragraph;
  - the end card's proof points as ✔️ lines;
  - CTA + "link in bio";
  - 8 to 10 niche hashtags.
  - Offer a short variant and an engagement question.

## 11. Keep this skill growing

After every video delivery or correction, add the lesson here (structure, voice, captions, sound, render or delivery). Story and realism lessons go in product-animation-core instead.
