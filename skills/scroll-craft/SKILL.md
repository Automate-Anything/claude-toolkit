---
name: scroll-craft
description: How to build a scroll-driven picture story on a website, the way the owner wants it - the page scrolls like a normal page while ONE picture (scroll-played video, renders, a 3D world) travels with it, from full screen into a framed box, beside the words, back out to full screen, never a fixed movie in the background with words sliding past. Covers the stage and slot model, scroll-to-time scrubbing, chaining clips so nothing is ever black or empty, words over pictures, the separate phone design (the frame that docks under the top bar while the words scroll, then opens out to full screen), keeping the opening subject whole and sharp, how fast it scrolls, verifying at real screen sizes with the bundled scroll-check script, and how to change a page the owner already likes without redesigning it. Use when building or fixing any scroll-driven hero, scrollytelling page, "journey" or fly-through, scroll-scrubbed video, sticky or pinned section, a picture that moves between sections, or when the owner says the scroll, the phone view, the frames, the boxes or the video "is cut off", "is empty", "goes out of view", "looks like a movie" or "is not crispy".
---

# Scroll craft

A scroll story is a page where scrolling plays a picture. Done well it feels like the reader is
travelling through one place while reading a normal page. Done badly it is a movie playing behind
some words, or a movie beside some words, and the owner has rejected both.

This skill is the method. Every site is different (a coffee bean falling into a cup, a product
taking itself apart, a flight into a building): use the examples to understand the idea, never copy
their subject. Making the pictures themselves (Blender, photoreal stills, image-to-video, NASA
imagery) is the `3d-studio` skill; this one is about the page around them.

No plugin, engine or outside package is needed. It is plain React (or plain JS), CSS, `<video>`
and one `requestAnimationFrame` loop. Add a library only if it is truly needed, and say so first.

Many device and scrubbing details below come from nateherk's scroll-craft
(github.com/nateherkai/scroll-craft, MIT), read and folded in as ideas; its engine, plugin and paid
generator are not used. Where its advice clashes with the owner's rules (see "What we did not take"
at the end), the owner's rules win.

## 0. Before building: restate the plan

Write back, in a few plain lines, what the reader will see from the first screen to the last: each
section, what the picture is doing there (full screen, framed on the left, framed on the right),
and what moves when they scroll. Get a yes before building a new journey. A small fix to an
existing one does not need this (see section 8).

## 1. The idea: one picture that travels

- The page is real sections that scroll normally. Words and buttons work from the first second.
- Each section has a **slot**: where the picture belongs while that section is on screen. A slot is
  `bleed` (the whole screen behind the words) or a framed box (square, tall or wide; left or right
  of the words).
- **One** picture box exists for the whole story. Every frame, its rectangle is the blend of the
  current section's slot and the next section's slot. While a section is on screen the box sits in
  its slot; as the section leaves, the box flies into the next slot. Corner radius, edge and shade
  blend the same way.
- So the picture goes box, to window, to full screen, to box again. It never stays parked in one
  place while the page slides past it.

What the owner rejected, and why:

| Rejected | Why |
|---|---|
| One fixed video on one side, words sliding on the other | "It doesn't stay in one place. It moves. It goes to the next page and then the next." |
| A full-screen movie with all the words sliding over it (on a phone) | "It cannot look like a movie." The frames are the design. |
| A framed picture that scrolls out of view with its section | Half the screen goes empty and the picture is cut off. |
| A growing picture (a planet you fly into) inside a box | The box edges slice it as it grows. |

The reference he gave: a coffee site where a bean falls out of one section into the next section's
cup. The object moves with the reading.

## 2. Full screen or framed

- **Something that grows or surrounds you** (flying into a planet, through clouds, into a room):
  full screen from the first moment. To put it beside the words, slide or scale it inside the
  full-screen layer, never put it in a box.
- **Something that stays an object** (a chip, a product, a screen): it may sit in a frame with a
  clear border.
- A full-screen slot is the fixed viewport, not the section's box, so it never shows gaps while the
  section scrolls.
- A picture on black (space, a macro shot) on a page of the SAME black needs no frame: it reads as
  an object, not a video rectangle. "The same black" means the same pixel values (see section 6).

## 3. Time: the scroll plays the picture

- Story time `T = section index + fraction scrolled through that section`. Each section maps a
  range of `T` to a clip (or a range of frames).
- The loop does not jump: it walks the playhead toward the target every frame
  (`current += (target - current) * 0.2`), so a fast flick is smooth and a slow scroll is exact.
- Clips chain: the last frame of one clip is the first frame of the next (when generating video,
  pass the next clip's start picture as the end frame). The reader never sees a cut.
- **Never black, never empty.** Load clips a section or two ahead. A clip keeps showing its last
  picture until the next clip has actually painted a frame; only then swap. Off-screen clips wait
  on the frame they will show first (from above: their start; from below: their end).
- **Pace:** about one screen of scrolling per section. The owner: "with one quick scroll, I can
  scroll through the whole thing." Long pinned sections where nothing changes feel broken. There
  must be no scroll position where nothing moves.
- Speed inside the picture can vary (fast through the boring parts, slow at the reveal), but fast
  parts must blur like real motion (optical-flow in-betweens), not show stacked ghost copies.
- **Even pace across a journey.** Keep (scroll length / clip seconds) within a few percent from clip
  to clip, or the reader feels it speed up and slow down: a 36% spread felt "not smooth", 6% fixed
  it. Changing a length moves every word window after it: check them again.
- A small dwell inside a section settles the picture where the words are and leaves the joins
  untouched: `f(x) = (1 - L) * x + L * (4 * (x - 0.5) ** 3 + 0.5)` with `L` at most 0.3 (the owner
  wants it quick).

**The seek loop, done right:**

- Skip a write that changes the time by less than 0.008 s (computer) or 0.02 s (phone).
- Never set `currentTime` while `video.seeking` is true: a fast flick piles up seeks and freezes the
  clip. Wait for `seeked`, then write the latest target.
- Clamp to `0.999 * duration` (the very end can show black on some browsers).
- Leave an off-screen clip alone once it is within 0.002 s of where it waits.
- Load each clip as a blob (`fetch(src).then(r => r.blob())`, then `URL.createObjectURL`) when its
  section is about 3 screens ahead or 1.5 behind: seeking then works even without HTTP range
  support. Attach listeners and set `preload` before `src`. Revoke the URL on teardown. The whole
  file then sits in memory, so keep phone clips small.
- **Clip time is not section time.** A clip tied to its section's progress sits on its first frame
  while its box slides in and on its last frame while it slides out: the reader sees a still photo
  moving. Map clip time from the moment the picture first shows to the moment it leaves. On a phone
  the video is already moving while the frame scrolls up to dock.
- **Joins: one-sided crossfade.** The incoming clip fades 0 to 1 over about 0.12 to 0.16 of a
  screen while the outgoing one stays fully visible underneath, and drops only once it is covered.
  Fading both at once flashes the page colour through. Never swap a `src` on one element (a black
  frame).

## 4. Words and pictures

- Words sit over the picture and the picture is always behind them, never beside empty space. Give
  the words their own soft shade or glow so they read; do not darken the whole picture with a veil.
- The words are personal and short: one idea per section, said to the reader ("Every time you
  open your laptop ...", not "Our platform enables ...").
- Buttons in a row are the same size. The main call to action (Sign up) is always reachable,
  including in the phone top bar.
- Layers that hold the picture are `pointer-events: none`; the words and buttons are
  `pointer-events: auto`. An invisible pinned layer lying over the buttons makes them dead (it
  happened: "See the next course" and "WhatsApp us" did nothing on a phone).

## 5. Phones: their own design, same idea

A phone is not the desktop squeezed. The idea stays (frames that move, words over pictures), the
layout changes. On a computer the framed box sits beside the words; a phone has no room beside, so:

**The docking frame.** A framed section's frame scrolls up with the page, then stops (docks) under
the top bar. The video keeps playing inside it while the words keep scrolling up under it, so two
scrolls happen at once. When the next section is full screen, the frame opens out to full screen
and the picture continues outside the old border. Consecutive framed sections share one docked
frame. The screen is never black and never half empty.

**Drive it from the words, not from scroll fractions.** Measure where the words really are
(`getBoundingClientRect()` of a section's first and last line) and set the frame from that:

```ts
// phones: k = 0 full screen, 1 docked frame under the top bar
let docked = 0;
for (const g of framedGroups) {               // runs of consecutive framed sections
  const dock = smooth(clamp((vh * 1.12 - g.first.getBoundingClientRect().top) / (vh * 0.32)));
  const open = g.isLast ? 0 : smooth(clamp((barH + vh * 0.72 - g.last.getBoundingClientRect().bottom) / (vh * 0.3)));
  docked = Math.max(docked, dock * (1 - open));
}
const full = { x: 0, y: 0, w: vw, h: vh };
const dockRect = { x: 16, y: barH, w: vw - 32, h: Math.round(vh * 0.44) };
rect = mix(full, dockRect, docked);          // radius 0 -> 24 the same way
```

Fractions of a section depend on how tall the words wrap on that phone; the words' real position
does not. That is what keeps the screen from ever being empty on a 360 px phone and a 430 px phone
alike.

Other phone rules:

- The first framed section's words start just under the docked frame (top padding about
  `barH + frame height`); a framed section after another framed one follows straight on.
- Full-screen sections are about one screen tall (`88svh` to `100svh`), with the words at the
  bottom over the picture.
- Use `svh` units, not `vh`, so the browser bar sliding in and out does not make the page jump. On
  resize, if `innerWidth` did not change it is the address bar: update the height only, do not lay
  out again. Size scroll tracks in px from `innerHeight` when the stage uses `svh`, so both agree.
  Guard against `innerHeight` of 0 (embedded previews), which silently makes a page that cannot
  scroll.
- Measure again on `load` and on `document.fonts.ready`: a font swap changes how tall the words
  are, and the docking frame is driven by them.
- Never put a CSS `transition` on a scroll-driven `transform`: on a phone it trails about a second
  behind the thumb.
- A global `img { max-width: 100% }` shrinks absolutely placed picture layers on a phone: give them
  `max-width: none`. Set width and height together, or neither.
- **The opening subject must be whole.** If the story opens on an object (a globe, a product), it
  starts whole, centred, with nothing cut by the screen edge, then grows to fill the screen as the
  reader scrolls. Use a wide enough source so it is never cropped, place it with a soft fade on the
  edges that meet the page, and make its background exactly the page colour so there is no
  rectangle and no rim around it.

## 6. Pictures that hold up

- **Sharp at the real size.** The source must be at least the displayed width times the device
  pixel ratio. A 720 px clip blown up on a phone is soft; a phone at 412 px wide and DPR 3 shows
  about 1240 px. Never upscale a small clip to cover.
- **Matching blacks.** Video encoders lift black to about 16/255 and a page background of `#000`
  stays 0, so a dark video shows as a grey rectangle. Crush the video's blacks to true 0 when
  encoding (ffmpeg `curves=all='0/0 0.07/0 0.12/0.07 1/1'`), tag it bt709, and use the same black
  on the page.
- **Real, not rendered.** The owner wants it to look filmed and real. His own places come from his
  own photos and videos (his video stays video, sped up with fast and slow parts); never invent a
  stand-in for a real place. The making of the pictures: `3d-studio`.
- **Encode for scrubbing:** re-encode (never cut with `-c copy`, it scrubs badly):
  `ffmpeg -i in.mp4 -c:v libx264 -profile:v high -preset slow -crf 20 -g 8 -keyint_min 8 -sc_threshold 0 -vf "scale=W:-2:flags=lanczos,format=yuv420p" -an -movflags +faststart out.mp4`.
  `-sc_threshold 0` and `-keyint_min` keep keyframes evenly spaced. CRF 22 to 23 for grainy
  footage. Bring 60 fps phone footage to 24 or 30 (`fps=30`) first: about half the size. Roughly
  3 MB per 5 s at 1080p. An ffmpeg with fewer than about 200 filters (`ffmpeg -filters | wc -l`) is
  a stripped build that reports a missing filter as a syntax error.
- **Phone clips:** a landscape clip covering a portrait screen decodes the whole frame and throws
  away about three quarters, which shows as soft and stuttering. For a full-screen phone clip, cut
  it portrait from the master (`crop=ih*9/16:ih`) at display width x DPR. The exception is an
  opening subject that must stay whole (a globe): give it a wider clip, still sharp at its shown
  size. Never `object-fit: contain` (letterboxing reads as a broken embed).
- **Posters and joins from the encoded file:** take the poster from the final mp4
  (`ffmpeg -i clip.mp4 -frames:v 1 -q:v 2 poster.png`), and the next clip's start picture from the
  end of the previous one (`ffmpeg -sseof -0.15 -i legN.mp4 -frames:v 1 chainN.png`). Measure each
  join with ffmpeg's PSNR filter: 28 to 40 dB looked seamless. Give phones their own poster with
  `<picture><source media="(max-width: 1023px)" ...>` so it matches the phone clip.
- **The owner's own footage:** measure the levels first (`signalstats` YMIN/YMAX) and stretch flat
  footage with `colorlevels` in the file, not with a CSS filter. Trim before anyone walks in. Use
  one continuous move in one direction: a reader will stop exactly on a reversal.
- A replaced picture gets a new file name (or `?v=2`): phones keep the old copy cached.
- **iOS shows a frozen first frame** unless the clip is primed. Set `muted` and `playsInline` as JS
  properties as well as attributes. On `loadedmetadata`, `play()` then `pause()`, then nudge
  `currentTime` by +0.05 s so the frame repaints, and seek once even at time 0
  (`currentTime = Math.max(t, 0.001)`, a clip already at 0 never fires `seeked`). Keep retrying the
  prime on `touchend`, `pointerdown`, `click` and `scroll` until every clip has worked (one try on
  the first touch is used up while the first clip is still downloading; `touchend` counts as a user
  gesture, `touchstart` does not). iOS can leave a `play()` promise or `seeking` pending forever:
  release the priming flag after 2 s, and re-issue a seek stuck for over 700 ms with
  `currentTime += 0.001`. Swap the poster away on `seeked` or after 2.5 s, whichever comes first.
  The sign of a missed prime: the first clip frozen, later ones fine.

## 6b. Reduced motion and keyboard

- Under `prefers-reduced-motion: reduce`, fetch no clips and show the posters, cross-fading at the
  same scroll positions. Drop every transform, keep opacity, set `scroll-behavior: auto`. The page
  must still read with no empty screen (scroll-check `--reduced-motion`).
- When a focused button sits in a moving or faded layer, bring it into view with
  `scrollIntoView({ block: "center", behavior: "instant" })` (`smooth` glides with the focus off
  screen).

## 7. Verify before showing the owner

Run `scripts/scroll-check.mjs` (in this skill) against the local build and, after deploy, the live
site:

```bash
node scroll-check.mjs http://localhost:3000/ --sizes 412x800,360x640,1440x900 --box ".picture-box" --out ./shots
node scroll-check.mjs http://localhost:3000/ --compare https://example.com/ --sizes 2096x1100 --box ".picture-box"
```

It walks the page in quarter-screen steps, waits at each step until the videos and the box stop
moving, and reports per size:

- **empty**: no words in view and almost no picture on screen;
- **dead**: the reader scrolled and nothing on screen changed;
- **offview**: a framed picture partly cut by the screen edge;
- **blocked**: buttons a tap does not reach (something lies on top);
- **poster**: a video in view that never painted;
- **soft**: a video shown larger than its pixels at the device's pixel ratio (phones run at 3);
- **media**: clips or images that failed to load;
- **overflow** and console **errors**.

With `--out` it saves a JPEG per position and, when ffmpeg is installed, one contact sheet per size
to look at. `--compare` checks the picture box lands in the same place on two builds: use it to
prove a phone-only fix changed nothing on the computer. `--reduced-motion` walks the page as a
reader with reduced motion. Setup: `npm i playwright-core` in a scratch folder and point `PW_DIR`
at it; it drives installed Chrome.

When a clip misbehaves only on the owner's real phone, build a small diagnostic page: scrub the
suspect clip as a blob, as a direct `src`, and beside a known-good clip, count distinct frames by
drawing the video into a 16x16 canvas and hashing it (3 or more distinct frames: moving; none after
a third of the scroll: frozen), and print `readyState`, the prime result and the seek count. One
screenshot from his phone then tells which layer fails.

Then look yourself:

- At the owner's sizes: his computer (about 2100 px wide), a laptop, and two phones (412x800 and
  360x640). Look for what he would see: an edge cutting the picture, a rim, a soft or dull picture,
  an empty screen, words cut off.
- Scroll from the very first moment of load, fast and slow, both ways. That is what he does.
- A desktop browser at phone size is not a phone. Say so when you report, and ask him to check on
  his own phone.

## 8. Changing a page the owner already likes

This is where the most trust was lost. When he reports problems in something he liked:

- **Fix small problems small.** Change only what he named. Never take the chance to redesign the
  layout, the motion or the words. "It was already good. It had certain small issues, so you
  redesigned it, and it created a bunch of problems."
- Before editing, list exactly which part changes and which parts will not.
- After editing, prove the rest did not change (`--compare` against the live site at many scroll
  positions, zero differences outside the fix).
- If the only fix you can see needs a layout change, ask first and show what would change.

## 9. Example: the Aimplement home (Nov 2026)

One worked example, to show the method in use, not a template:

- Journey: the real Earth from space, through clouds, to the owner's building, his office (his own
  video, sped up), his screen, inside the computer, a transistor that opens on a blinking bulb,
  pulling back to thousands of lights.
- Seven sections: full screen (the Earth, centred words), full screen, tall frame, wide frame, full
  screen, full screen, tall frame.
- On a phone the two framed sections share one docked frame; the Earth opens whole and small above
  the headline on true black, then grows to full screen as you scroll.
- Code: `C:\dev\aimplement\src\components\site\world-hero.tsx`. Picture making:
  `C:\dev\aimplement-world\scrollcraft\builds\aimplement-world\` and the `3d-studio` skill.

## What we did not take from nateherk's scroll-craft

Each of these clashes with the owner's rules:

- A fixed stage with every word in a layer sliding over the film (its "worldflight" mode), a
  full-screen hero as the phone default, or dropping the clip on phones for a still poster.
- Slow pacing: "slower than you think", 2 to 3 screens per hero section, long pins, an empty screen
  "before the peak". Ours: about one screen per section, never empty.
- Off-black instead of true black (we match the video's black to the page's black at 0).
- 720 px phone encodes (ours: display width x DPR).
- Dark bands over up to 58% of the frame (a veil; ours: a glow on the words).
- Its variety law, fingerprint gate and signature-move rules: a different design method.
- kie.ai for generating pictures: any generator works, see `3d-studio`.

## Rules ledger (add every scroll rule the owner teaches)

| Date | Rule |
|---|---|
| Nov 18 | The picture travels with the page: box, window, full video. Never one fixed movie beside or behind sliding words. |
| Nov 19 | A picture that fills or grows is full screen from the first moment, so it is never cut off by a box. |
| Nov 19 | No veil over the picture: "100% vivid, like a real thing". Words get their own glow. |
| Nov 19 | Crystal sharp at his real screen size, every frame. No thick outline or rim. |
| Nov 19 | About one screen of scroll per section; one quick scroll runs the whole story. |
| Nov 23 | Words cover the pictures; the pictures are always behind. Buttons in a row are the same size. |
| Nov 23 | Every button must work on a phone (picture layers never catch taps). |
| Nov 23 | On a phone, never a part of the screen with no words and no picture. |
| Nov 23 | Phone: the frame scrolls up and docks under the top bar, the video keeps playing while the words scroll up, and the next section opens it out to full screen. Never black. |
| Nov 23 | Phones keep the frames. Turning everything into a full-screen movie is a redesign he did not ask for. |
| Nov 25 | The opening subject is whole on a phone: never cut by the screen edge, no rectangle, no rim, sharp. It starts further away and you zoom in, like on the computer. |
| Nov 25 | Fix small problems small; never redesign what he already liked. |
| Nov 25 | Our own skill and our own tools. Outside plugins and skills are welcome as ideas ("if there's any value to it, we can use it"); install or connect one only when truly necessary. |
