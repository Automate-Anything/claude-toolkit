---
name: "animate-product-screenshot"
description: "Turn any product screenshot or HTML mockup into a looping animated demo for a website, or a voiced social video (Reels, TikTok, Shorts, feed, LinkedIn) that tells a short 'it's working live' story."
---

# Animate a product screenshot

Use this when someone shares a software product screenshot, points at UI mockups on their website, or asks to make a product image "come alive". It covers two outputs:

- **Website loops** (sections 1-7): silent animations that loop forever.
- **Social videos** (section 8): voiced, captioned MP4s with an opening slide and an end card, exported in every platform size.

The goal is never decoration. Each animation is a short **story** in which the product visibly does its job. It ends on a **win moment** (booked, paid, replied, resolved, insight found).

The test for every motion: **would the real app actually do this on screen?** If not, cut it.

## 1. Get the real source (fidelity first)

**Mockup on a website.** `curl -sSL URL` the page. Marketing-site mockups are often plain HTML/CSS, not images.
- Extract each mockup block. Look for a shared wrapper or frame class, or an address-bar label like `app.example.com/...`.
- Get its CSS: the main stylesheet, plus lazy CSS chunks named in the JS bundle. Grep the bundle for `assets/*.css`, `*Shot*`, `*Frame*`, `*Mock*`.
- Reuse the real markup, class names and copy verbatim.

**Whole site.**
- Read `/sitemap.xml` and fetch every page.
- Extract all mockups and dedupe them by address-bar URL plus first body class.
- Count how many pages reuse each one. Animate the most-reused first.

**Only an image.** Rebuild it exactly: layout, sizes, colors, copy, icons (inline stroke SVG), and the brand's own font even if it's a common one.

**Simplified marketing mockup.** If the homepage version is simpler than the real product, look for a richer mockup of the same feature (feature or product pages), or ask for real app screenshots. Owners notice when an animation looks less advanced than their app.

**Brand and copy.**
- Never restyle the brand.
- Change copy only to give a story or scroll room.
- Stay within features the site's copy claims, and invent none.

## 2. Brainstorm the story

Share the stories with the user before building a batch. For each screen, write 1-2 lines with three beats:
- **Trigger.** What arrives: a call, a message, a booking, a payment, a page load, a click.
- **Work.** What the product visibly does: the AI types, it schedules, totals, processes, filters.
- **Win.** The result: a confirmation chip, a paid state, a resolved badge, a live number update.

Make the screenshot's original final state the end frame, so a paused frame still matches the original.

## 3. Realism rules (learned from real feedback)

- **Never count up facts.** Prices, line items, totals, counts and balances appear at their real value instantly, as the app renders them.
  - When a value changes, swap it discretely and flash a soft highlight behind it for about 1s (`am-flash`).
  - Scrolling digits look fake.
- **Dashboards load; they don't count.**
  - Skeleton shimmer, then the data resolves at once.
  - Charts may draw in, because chart libraries do.
  - Then show **interaction**, e.g. a cursor clicking a slice to filter.
  - Then a **live update**: a new sale lands, the affected numbers swap with a flash, and a "+$140 · just now" chip pops.
- **Inputs are chosen, not tweened.** A tip, toggle or option gets tapped once. Don't cycle through values unless the story is literally someone deciding.
- **Show a pointer where a human would act.** A click gets a small tap-scale on the cursor, and the target reacts.
- **Animate one focal action at a time.** Keep ambient motion (pulse dot, timer, now-line) subtle.
- **Never let layout jump.** Reserve space with fixed rows, min-heights and opacity rather than mounting blocks into flowing layout mid-story.
- **Never let text wrap in fixed-height rows.** Shorten the copy instead.
- **No randomness detached from the story.** Even a waveform must track the words being spoken.
- **AI conversations must behave like a good human receptionist.**
  - Friendly and conversational.
  - Collects the details a real booking needs (name, then confirmation) before saying "you're booked".
  - Offers choices as "Would either work for you?", never "which is better?".

## 4. Engine: one clock, everything derived

A single `t` (ms) advances every 50-60ms, scaled by a `speed` tweak, and wraps at `total`.

Every visual is a pure function of `t`: visibility, text slices, values, classes and positions. There are no per-element timers, so loops repeat perfectly and retiming means editing one constants object. The same rule makes frame-exact video capture possible (section 8).

```js
componentDidMount(){ this.total=11500; this.last=performance.now(); this.setState({t:0}); var s=this; this.timer=setInterval(function(){s.tick();},50); }
componentWillUnmount(){ clearInterval(this.timer); }
tick(){ var now=performance.now(); var t=(this.state.t||0)+(now-this.last)*(this.props.speed??1); this.last=now; if(t>this.total)t=0; this.setState({t:t}); }
// renderVals(): var T={ arrive:400, work:1300, win:5700 }; derive everything from t
```

- **Helpers:** `clamp`, `ease = 1-(1-x)^3`, `easeInOut`, `money()`, `comma()`.
- `ease` is for motion (positions, sweeps), never for displaying numbers.
- **Before mount** (thumbnails, static frames), return the original final state.

## 5. Pattern library

**Voice and audio**
- **Live speech waveform.** A scrolling bar buffer: push one bar per tick.
  - With a real voice track, the height comes from the audio's RMS envelope (60ms windows, normalized to the 95th percentile, `^0.7`, gate below 0.06).
  - Without audio, the height follows the active word's envelope `sin(πp)^0.6` with a syllable ripple.
  - An idle 7-12px line between words.
  - `transition: height 85ms linear` for website loops.
- **Word-synced transcript.**
  - With voiceover, use real word timestamps.
  - Without voiceover, each word lasts `150 + 52·letters` ms, plus 170ms after punctuation.
  - The active row is highlighted; the current word is weight 800; unspoken words are at 0.3 opacity; future rows are hidden.
  - Scroll with `translateY(-(active-(N-1))·rowH)` once rows exceed the visible count.
- **Recording playback.**
  - Play swaps to pause.
  - The waveform's "played" class fills up to the progress point, and the `m:ss / total` label advances.
  - Transcript rows reveal in sync.

**AI and text**
- **AI writes.** A "Summarizing…" label with 3 bouncing dots, then the text streams at 24-28ms per character behind a blinking caret, then the caret disappears.
- **Chat thread.** An append-only list: incoming message → typing bubble → reply. The reply replaces the typing bubble at the same index.
  - The thread list's preview text and time update.
  - The unread badge pops, then clears once read.
- **Resolved by AI.** "Needs reply" becomes "✓ AI replied" with a pop, the preview updates, and a green glow pulses on the row and on the "AI on" pill.

**Scheduling and lists**
- **Staggered entrance.** Items appear 200-550ms apart via inline opacity/transform transitions, with all items kept rendered.
- **Automation adds an item.** A dark toast slides down ("AI booked …"), and the new block appears with a glow ring.
- **Pending → confirmed card.** A spinner card evolves as details are collected ("Holding Fri 11:00 AM" → "Holding for Jordan P." → green ✓ booked).
- **Reschedule.** Animate `top` over 650ms with a glow, plus a toast saying who or what did it.
- **Now line.** A thin primary line with a dot, drifting down the grid.

**Commerce**
- **Cart builds.** Rows slide in at their real price. Totals swap with a flash highlight on each change.
- **Pay flow.**
  - The tender option is tapped (`on` + `am-tap`).
  - The pay button fills with a progress sweep labelled "Processing…".
  - It then turns green with a popped ✓ and "Paid $X".

**Dashboards**
- **Load and resolve.** Skeleton shimmer bars stand in for values for about 1s, then the real values fade in, with delta chips after.
- **Chart entrance.**
  - A donut sweeps clockwise: a conic-gradient built from cumulative percentages, clipped at the sweep angle, with a track color beyond it.
  - Or bars grow in a stagger.
- **Filter interaction.**
  - The cursor travels to a slice's mid-angle (`x = c + r·sin θ`, `y = c − r·cos θ`) and taps.
  - The selected slice keeps full color; the others dim to about 20% alpha.
  - The legend row is highlighted; the others fade to 0.45.
  - The center shows the segment's value and share, and the hint reads "Filtered · click again to clear".
  - Cycle through 2-3 segments, then deselect.
- **Live update.** A new transaction lands: the affected KPIs and rows swap to their new values with `am-flash`, a "+$140 · just now" chip pops, and counts go up by 1.

**Ambient.** A pulsing status dot, a ringing phone icon, a ticking call timer, and spinners on pending cards.

## 6. Build specifics (website loops)

**Output.**
- If the Artifact tool lists a "Design" type, use one canvas with one interactive artboard per screen, laid out in rows.
- Otherwise, make one self-contained HTML artifact per screen with the same engine.

**Crisp scaling.**
- Keep the mockup at its native width (e.g. 540px), wrapped in `zoom: 2`.
- Put it inside a fixed artboard with about 40px of padding in the page's background color, so the frame shadow shows.
- Size the height generously: extra padding is fine, clipping is not.

**Shared CSS.**
- One support file (`project/<name>.css`), linked relatively right after `support.js`, holds the site's frame/base CSS and the motion utilities below.
- Screen-specific CSS goes in each artboard's `<helmet><style>`.

**Motion utilities.** Paste these into the shared CSS and swap in the brand's color values:

```css
.am-caret{display:inline-block;width:1.5px;height:1.05em;background:currentColor;vertical-align:-2px;margin-left:1px;animation:amBlink 1s steps(2,start) infinite}
@keyframes amBlink{to{visibility:hidden}}
.am-typing{display:inline-flex;gap:3px;align-items:center;height:15px}
.am-typing i{width:5px;height:5px;border-radius:50%;background:currentColor;animation:amBounce 1s infinite ease-in-out}
.am-typing i:nth-child(2){animation-delay:.15s}.am-typing i:nth-child(3){animation-delay:.3s}
@keyframes amBounce{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-3px);opacity:.95}}
.am-in{animation:amIn .38s cubic-bezier(.2,.8,.2,1) both}
@keyframes amIn{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
.am-pop{animation:amPop .45s cubic-bezier(.2,.8,.2,1) both}
@keyframes amPop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}
.am-glow{animation:amGlow 1.1s ease-out 3}
@keyframes amGlow{0%{box-shadow:0 0 0 0 rgba(107,29,32,.45)}100%{box-shadow:0 0 0 9px rgba(107,29,32,0)}}
.am-glow-good{animation:amGlowGood 1.1s ease-out 2}
@keyframes amGlowGood{0%{box-shadow:0 0 0 0 rgba(63,125,79,.45)}100%{box-shadow:0 0 0 8px rgba(63,125,79,0)}}
.am-tap{animation:amTap .35s ease}
@keyframes amTap{50%{transform:scale(.93)}}
.am-float{animation:amFloat 2s ease-out both}
@keyframes amFloat{0%{opacity:0;transform:translateY(6px)}15%{opacity:1;transform:translateY(0)}75%{opacity:1;transform:translateY(-12px)}100%{opacity:0;transform:translateY(-18px)}}
.am-skel{display:inline-block;border-radius:5px;background:linear-gradient(90deg,#f2ebdf 25%,#faf6ef 50%,#f2ebdf 75%);background-size:200% 100%;animation:amShim 1.2s linear infinite}
@keyframes amShim{to{background-position:-200% 0}}
.am-flash{animation:amFlash 1.1s ease}
@keyframes amFlash{0%,25%{background-color:#f3e6e3}100%{background-color:rgba(243,230,227,0)}}
@media (prefers-reduced-motion: reduce){[class*="am-"],.am-typing i{animation:none}}
```

Give flashed numbers `display:inline-block; border-radius:5px; padding:0 4px; margin-left:-4px`, so the highlight reads as a chip behind the value.

**Design-canvas template rules.**
- **Holes are lookups only.** Compute everything in `renderVals()`.
- **Interpolation works** in class and style attributes: `class="ap {{a.c}} {{a.glow}}"` and `style="top: {{a.top}}px; opacity: {{a.op}}"`.
- **Mount-time animations** (`am-in`, `am-pop`) fire on first render or when the class is added. Re-adding the class on the next loop replays them. Use them for append-only lists and `sc-if` reveals.
- **Never filter a list whose items appear out of order.** Index reuse re-animates the wrong rows; keep all items and drive their opacity instead.
- **Write out literally any items that need different icons,** because holes can't inject markup.
- **Tweaks:** `speed` (0.5-1.8x), plus at most one color.
- **Build one screen, publish, then the next.** Don't verify by rendering unless asked.

## 7. Website loop timing

- Story length is 6-15s.
- Hold the win for 2.5-3.5s, then loop.

## 8. Social video

A social video is the same story, but voiced and captioned. It is bookended by an **opening slide** (the hook) and an **end card** (brand + CTA), and exported in four sizes.

### 8.1 Structure

1. **Opening (0 → ~4s).** A headline that states the problem in the viewer's world, plus the trigger object (for example a phone ringing with Decline/Accept).
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

### 8.2 Capture page (deterministic)

Build one HTML page per video (not a canvas artboard). It exposes:

- `window.render(t)`: sets every element's style for time `t` (ms). It is a pure function, so any frame can be rendered in any order.
- `window.DURATION`.
- `window.EVENTS`: ms timestamps for rings, accept, iris, lines, win and end. The sound-design script reads it.
- `?fmt=916|45|11|169` picks the layout via a class on the root (`.f916`, `.f45`, `.f11`, `.f169`).
- `?capture=1` disables the live clock.
- `window.VO` (voice timeline JSON) is injected before load with Playwright `add_init_script`. All timing constants derive from it.

Layout per format is CSS only (`.f45 #phone{…}`). For elements scaled with `zoom`, remember that `left`/`top` are in zoomed units: divide the target pixel position by the zoom.

Auto-center end-card content with a small `centerEnd()` that measures the stack. In 9:16, center it within the safe band; in other formats, center it in the frame.

### 8.3 Sizes and safe zones

| Format | Size | Use |
|---|---|---|
| 9:16 | 1080×1920 | Reels, TikTok, Shorts, Stories |
| 4:5 | 1080×1350 | Instagram/Facebook feed |
| 1:1 | 1080×1080 | Feed, LinkedIn, X |
| 16:9 | 1920×1080 | YouTube, LinkedIn, website |

**9:16 safe zone.**
- Keep all text and key UI within y 285-1440.
- Keep the right rail clear: x > 940 when y > 1000 (like/comment buttons).
- Instagram's feed grid crops Reels to the center 4:5, so the hook must read in that crop.

The 4:5, 1:1 and 16:9 versions get their own layouts, not letterboxing: text and trigger side by side in wide formats, and scaled end cards (about .8 / .62 / .76).

### 8.4 Timing

- **Reading time:** every caption stays on screen at least `0.5s + words ÷ 3.5`. Audit it with a table before rendering.
- **Let the voice drive the timeline.** Line N+1 starts after line N's last word ends, plus a gap (about 380ms after the AI, about 450ms after the caller).
- `accept = max(2750, hookNarrationEnd + 250)`. Rings repeat every 850ms until then.
- Hold the end card at least 3.4s, and at least the narrator's end line plus 900ms.
- Total: aim for 25-35s.

### 8.5 Captions

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

### 8.6 Design rules for opening and end slides (from real feedback)

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

### 8.7 Voiceover (ElevenLabs)

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
- **Phone line:** band-pass the in-call voices to 170-7000Hz (×1.15 gain) so they sit apart from the narrator.
- **Outputs:** `vo/<variant>/timeline.json` (lines with word timings, rings, accept, win, winCap, end, total, narration spans, waveform envelope), `call.wav` and `narr.wav`.

### 8.8 Sound design (numpy/scipy, timed from EVENTS)

- **Ring:** 400+450Hz with a 20Hz warble, 0.42s each.
- **Text threads:** a two-note message ping (E6 then A6, short decay) for incoming texts, and a rising band-passed noise swoosh plus a light blip for sent texts. No rings.
- **Accept:** two-note blip (880 → 1320Hz).
- **Iris:** a quiet band-passed noise whoosh.
- **Win:** two-note bell chime (C6 + G6 with harmonics).
- **End card:** whoosh plus a small CTA pop.
- **Music bed:**
  - warm pad + eighth-note pluck arpeggio, about 100bpm (Fmaj7-Dm7-Bbmaj7-Cmaj7), low-passed at 3.8kHz;
  - fades in at accept and out over the last 1.4s.
- **Ducking:** `duck = 1 - 0.62·clip(speechEnvelope/0.025)` on music and effects (about −8dB). Lay voices on top at ×1.9, then peak-normalize.

### 8.9 Render pipeline

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

### 8.10 Delivery

- Send all four MP4s together, with a one-line caption saying what changed.
- When asked, write the post caption:
  - a hook line that repeats the video's opening;
  - a short story paragraph;
  - the end card's proof points as ✔️ lines;
  - CTA + "link in bio";
  - 8-10 niche hashtags.
  - Offer a short variant and an engagement question.

## 9. Keep this skill growing

After each new kind of screen or video, or any correction from the user, add the pattern or rule here. Website feedback ("numbers shouldn't scroll", "not as advanced as our app") belongs in Realism rules. Video feedback ("the phone shouldn't be maroon", "captions too close to the label", "it said 'the call'") belongs in section 8.