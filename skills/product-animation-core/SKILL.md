---
name: "product-animation-core"
description: "Shared method for animating real product screenshots or HTML mockups into short 'it's working live' stories: getting the exact source, writing the trigger, work, win story, the realism rules, the one-clock engine and the pattern library. Use it whenever someone wants a product screenshot, app mockup or UI to come alive, then continue with product-animation-website (silent looping mockups for a site) or product-animation-social-video (voiced, captioned MP4s for Reels, TikTok, Shorts, feed, LinkedIn)."
---

# Product animation: the shared core

This skill holds what every product animation shares. It never ships anything on its own. Read it first, then continue with the output skill:

- **product-animation-website**: silent mockups that loop forever on a website or landing page.
- **product-animation-social-video**: voiced, captioned videos with an opening slide and an end card, exported in every platform size.

If the request does not say which, ask. "Make our screenshots come alive" on a site is website; "a Reel", "a TikTok", "a video for LinkedIn" is social video.

The goal is never decoration. Each animation is a short **story** in which the product visibly does its job. It ends on a **win moment** (booked, paid, replied, resolved, insight found).

The test for every motion: **would the real app actually do this on screen?** If not, cut it.

## 1. Get the real source (fidelity first)

**Mockup on a website.** `curl -sSL URL` the page. Marketing-site mockups are often plain HTML/CSS, not images.
- Extract each mockup block. Look for a shared wrapper or frame class, or an address-bar label like `app.example.com/...`.
- Get its CSS: the main stylesheet, plus lazy CSS chunks named in the JS bundle. Grep the bundle for `assets/*.css`, `*Shot*`, `*Frame*`, `*Mock*`.
- Reuse the real markup, class names and copy verbatim.
- If the site's source repo is available locally, read the mockup components there instead; they are the truth the live site renders.

**Whole site.**
- Read `/sitemap.xml` and fetch every page.
- Extract all mockups and dedupe them by address-bar URL plus first body class.
- Count how many pages reuse each one. Animate the most-reused first.

**Only an image.** Rebuild it exactly: layout, sizes, colors, copy, icons (inline stroke SVG), and the brand's own font even if it's a common one.

**Simplified marketing mockup.** If the homepage version is simpler than the real product, look for a richer mockup of the same feature (feature or product pages, or richer CSS in the bundle that the page doesn't render), or ask for real app screenshots. Owners notice when an animation looks less advanced than their app.

**Brand and copy.**
- Never restyle the brand.
- Change copy only to give a story or scroll room.
- Stay within features the site's copy claims, and invent none.
- Sample people in the mockup (e.g. "Jordan Powell") come from the site's own copy; keep them unless asked.

## 2. Write the story

Share the stories with the user before building a batch. For each screen, write 1 to 2 lines with three beats:
- **Trigger.** What arrives: a call, a message, a booking, a payment, a page load, a click.
- **Work.** What the product visibly does: the AI types, it schedules, totals, processes, filters.
- **Win.** The result: a confirmation chip, a paid state, a resolved badge, a live number update.

**End on the original.** The screenshot's final state is the story's end frame, so a paused or static frame still matches the original. When the story changes values, choose the *starting* values so the change lands exactly on the screenshot's numbers (147 → 148 members, 9 → 8 credits, $2,935 → $3,120).

**Scripts that scroll.** For a transcript, if the visible box holds N rows, write N+3 to N+5 lines in total: keep the original lines, insert natural steps in between (ask the name, confirm details, deposit or next step), and keep the original final line last. Each line must fit on one row at the row's width; fixed row heights keep the scroll math exact.

## 3. Realism rules (learned from real feedback)

- **Never count up facts.** Prices, line items, totals, counts and balances appear at their real value instantly, as the app renders them.
  - When a value changes, swap it discretely and flash a soft highlight behind it for about 1s.
  - Scrolling digits look fake.
- **Dashboards load; they don't count.**
  - Skeleton shimmer, then the data resolves at once.
  - Charts may draw in, because chart libraries do.
  - Then show **interaction**, e.g. a cursor clicking a slice to filter.
  - Then a **live update**: a new sale lands, the affected numbers swap with a flash, and a "+$140 · just now" chip pops.
- **Inputs are chosen, not tweened.** A tip, toggle or option gets tapped once. Don't cycle through values unless the story is literally someone deciding.
- **Show a pointer where a human would act.** A click gets a small tap-scale on the cursor, and the target reacts.
- **Animate one focal action at a time.** Keep ambient motion (pulse dot, timer, now-line) subtle.
- **Never let layout jump.** Reserve space with fixed rows, min-heights and opacity rather than mounting blocks into flowing layout mid-story. This includes skeletons: a loading placeholder must be exactly the loaded size.
- **Never let text wrap in fixed-height rows.** Shorten the copy instead.
- **No randomness detached from the story.** Even a waveform must track the words being spoken.
- **AI conversations must behave like a good human receptionist.**
  - Friendly and conversational.
  - Collects the details a real booking needs (name, then confirmation) before saying "you're booked".
  - Offers choices as "Would either work for you?", never "which is better?".
- **Prefer the richest version of a screen.** An animation that looks less advanced than the real app is a failure even if it is smooth.

## 4. Engine: one clock, everything derived

A single `t` (ms) advances every 50 to 60ms and wraps at `total` (websites) or runs once to `DURATION` (video).

Every visual is a pure function of `t`: visibility, text slices, values, classes and positions. There are no per-element timers, so loops repeat perfectly, retiming means editing one constants object, and any frame can be rendered on demand (which is what makes frame-exact video capture possible).

```js
// T holds the story's beats; everything else is derived from t.
var T = { arrive: 400, work: 1300, win: 5700 };
var paid = t >= T.win;
var flash = paid && t < T.win + 1100;
```

- **Helpers:** `clamp`, `ease = 1-(1-x)^3`, `easeInOut`, `money()`, `comma()`.
- `ease` is for motion (positions, sweeps), never for displaying numbers.
- **Static frame:** before the clock starts (thumbnails, server render, reduced motion), return the original final state.
- Never use `Math.random`, `Date` or other non-deterministic input while rendering a frame; derive any pseudo-randomness from `t` and indices.

## 5. Pattern library

**Voice and audio**
- **Live speech waveform.** A scrolling bar buffer: push one bar per tick.
  - With a real voice track, the height comes from the audio's RMS envelope (60ms windows, normalized to the 95th percentile, `^0.7`, gate below 0.06).
  - Without audio, the height follows the active word's envelope `sin(πp)^0.6` with a syllable ripple.
  - An idle line between words (7 to 12px in a 60px strip; scale it to the strip's height).
- **Word-synced transcript.**
  - With voiceover, use real word timestamps.
  - Without voiceover, each word lasts `150 + 52·letters` ms, plus 170ms after punctuation, with about 620ms after an AI line and 760ms after a caller line.
  - The active row is highlighted; the current word is weight 800; unspoken words are at 0.3 opacity; future rows are hidden. Hold each word's bold width with an invisible bold copy so the line never reflows.
  - Scroll with `translateY(-(active-(N-1))·rowH)` once rows exceed the visible count.
- **Recording playback.**
  - Play swaps to pause.
  - The waveform's "played" bars fill up to the progress point, and the `m:ss / total` label advances.
  - Transcript rows reveal in sync.
- **Call details.** A ticking call timer, a gently ringing phone icon, a pulsing status dot, and a result card that progresses through pending states before popping into its confirmed state on the final line.

**AI and text**
- **AI writes.** A "Summarizing…" label with 3 bouncing dots, then the text streams at 24 to 28ms per character behind a blinking caret, then the caret disappears.
- **Chat thread.** An append-only list: incoming message → typing bubble → reply. The reply replaces the typing bubble at the same index.
  - The thread list's preview text and time update.
  - The unread badge pops, then clears once read.
- **Resolved by AI.** "Needs reply" becomes "✓ AI replied" with a pop, the preview updates, and a green glow pulses on the row and on the "AI on" pill.
- **Rule checks.** A form arrives ("Awaiting" → "Submitted ✓" pop), a short "Checking answers against …" step with typing dots sits in the reserved space, then the alert box fades in with a red glow and its bullets reveal one by one; cautions follow.

**Scheduling and lists**
- **Staggered entrance.** Items appear 200 to 550ms apart via opacity/transform transitions, with all items kept rendered.
- **Automation adds an item.** A dark toast slides down ("AI booked …"), and the new block appears with a glow ring.
- **Pending → confirmed card.** A spinner card evolves as details are collected ("Holding Fri 11:00 AM" → "Holding for Jordan P." → green ✓ booked).
- **Reschedule.** Animate `top` over 650ms with a glow, plus a toast saying who or what did it.
- **Now line.** A thin primary line with a dot, drifting down the grid.
- **Picker reloads availability.** Choosing a staff member swaps the subtitle and shimmers the slot grid for about 600ms, then the real slots return with the unavailable ones struck through.

**CRM and records**
- **Activity feed lands newest-first.** Keep every event rendered in a fixed-height window with fixed row heights; slide the list with `translateY(-(N-arrived)·rowH)` so new events push older ones down without reflow. Each arrival gets a pop on its node and a soft background tint for about 1.5s, while the record's stat tiles swap with a flash.
- **Menu-driven action.** The cursor taps the ⋯ button, the menu mounts, the cursor taps the item, the menu closes and the target reacts (glow), then the result lands (a credit is used, the count swaps with a flash, the bar width transitions).

**Commerce**
- **Cart builds.** Rows slide in at their real price. Totals swap with a flash highlight on each change.
- **Pay or book flow.**
  - The tender option is tapped.
  - The button fills with a progress sweep labelled "Processing…".
  - It then turns green with a popped ✓ and "Paid $X" or "Booked · Fri, Jun 13 at 11:00".

**Dashboards**
- **Load and resolve.** Skeleton shimmer stands in for values for about 1s, then the real values appear at once, with delta chips after.
- **Chart entrance.**
  - A donut sweeps clockwise: a conic-gradient built from cumulative percentages, clipped at the sweep angle, with a track color beyond it.
  - Or bars grow in a stagger.
- **Filter interaction.**
  - The cursor travels to a slice's mid-angle (`x = c + r·sin θ`, `y = c − r·cos θ`) and taps.
  - The selected slice keeps full color; the others dim to about 20% alpha.
  - The legend row is highlighted; the others fade to 0.45.
  - The center shows the segment's value and share, and the hint reads "Filtered · click again to clear".
  - Cycle through 2 to 3 segments, then deselect.
- **Live update.** A new transaction lands: the affected KPIs and rows swap to their new values with a flash, a "+$140 · just now" chip pops, and counts go up by 1.

**Ambient.** A pulsing status dot, a ringing phone icon, a ticking call timer, and spinners on pending cards.

## 6. Keep the family growing

After each new kind of screen or any correction from the user, add it to the right skill:
- Story, realism and new screen patterns ("numbers shouldn't scroll", "not as advanced as our app") belong here.
- Website build and shipping lessons belong in product-animation-website.
- Video lessons ("the phone shouldn't be maroon", "captions too close to the label", "it said 'the call'") belong in product-animation-social-video.
