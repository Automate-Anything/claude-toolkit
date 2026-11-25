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

No plugins or outside packages are needed. It is plain React (or plain JS), CSS, `<video>` and one
`requestAnimationFrame` loop. Add a library only if it is truly needed, and say so first.

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
- Use `svh` units, not `vh`, so the browser bar sliding in and out does not make the page jump.
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
- Encode for scrubbing: H.264 MP4, no audio, short keyframe interval (GOP 4 to 8), `+faststart`, a
  separate encode for phones when the shape differs. A poster image (the first frame) shows until
  the video paints.
- iOS paints nothing for a muted video that never played: play and pause it once after load and
  again on the first touch.

## 7. Verify before showing the owner

Run `scripts/scroll-check.mjs` (in this skill) against the local build and, after deploy, the live
site:

```bash
node scroll-check.mjs http://localhost:3000/ --sizes 412x800,360x640,1440x900 --box ".picture-box" --out ./shots
node scroll-check.mjs http://localhost:3000/ --compare https://example.com/ --sizes 2096x1100 --box ".picture-box"
```

It walks the page in quarter-screen steps and reports, per size: positions with no words in view
and almost no picture on screen (empty), a framed picture partly out of view, buttons that a tap
does not reach (something lies on top), errors in the console, and horizontal overflow. It saves a
JPEG contact strip to look at. `--compare` checks the picture box lands in the same place on two
builds: use it to prove a phone-only fix changed nothing on the computer.

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
| Nov 25 | No plugins or third-party packages unless truly necessary; this is our own skill and our own tools. |
