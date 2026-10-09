# Words on screen

The designed layer: everything that sits on the footage and is made in code, never by a model. Built as a composition for a code renderer (HyperFrames: HTML, CSS and GSAP timelines rendered frame by frame to video) from the edit list by `tools/compose.py`. It carries no sound; the sound is mixed separately and laid under the rendered picture.

## Speech bubbles with tags

- **Every word on screen is a bubble with a tag** that says who speaks: "You" (small caps, grey) for the person; the brand wordmark in the brand's display face for the product; the role for the other end of a call ("Insurance", "Caller", "Robocall", "Pharmacy"). A line to nobody (said aloud to the room) is a lighter bubble with no tag, in italics.
- **It pops up beside the speaker,** on the empty side of the frame (a side map per take, chosen by eye from contact sheets), with one curve and no overshoot: from opacity 0, scale 0.92, 16 px below, 0.4 s, power2.out. A sent message leaves upward (0.35 s, power2.in); a reply fades (0.45 s). A hard kill (`tl.set opacity 0`) at the end of every element: the renderer's lint demands it and a missing one leaves a ghost.
- **It points at the speaker with a squared corner,** the way a message bubble does (border-bottom-left-radius 6 px on the speaker's side, 28 px elsewhere). A drawn tail (a rotated square under the bubble) read as a stray diamond and was removed.
- **Glass.** A gradient from rgba(255,255,255,0.86) to 0.60 at 165 degrees, backdrop blur 26 px with saturate 1.4, a 1 px white border at 0.9, inset highlights (0 2px 0 white; 0 -3px 6px black at 0.07), a soft drop shadow. The alphas are higher than a web page's glass would be, so type reads over moving picture; a bubble over a dark hedge at 0.44 was unreadable. Type: 44 px at 1080p, 500 weight, 1.22 line height; the tag 20 px, 600 weight, 0.08 em tracking, uppercase; the wordmark tag 44 px in the display face.
- **Left and right bubbles may never meet:** on a wide frame each is at most 44 percent of the width with a 5 percent gutter (5 + 44 is under 50); on a tall frame the far side sits one row up (bottom plus 300 px). Two bubbles visible at once is a chat, and fine; two bubbles overlapping is a bug.
- **A bubble never crosses into another scene.** A `SCENE` map names which takes belong to one scene; a bubble may outlive its shot only into the next shot of the same scene. If that leaves under 2.2 s to read it, it comes up earlier instead; if the shot itself is too short, the shot is lengthened in the edit list (a 1.6 s shot became 2.2 s so "Did anyone pay the electric?" could be read). Nine bubbles sat over the wrong scene in one render before this rule existed.
- **Life:** 3.4 s for a sent or reply line, 2.6 s for a line to nobody, the audio's length plus 0.4 s for a call line, 2.2 s minimum. Reading speed on screen is about 5 to 10 words a second on TikTok's own guidance; a bubble holds at most about 15 words.

## A note at the top

A sentence about the product rather than a line someone says (the kind of thing the client wants "clearly said": "For calls to companies, it switches to a more human calling voice") is a lighter bubble at the top of the frame on the speaker's side, 36 px, 4 s, out of the way of the call's bubbles at the bottom. Public copy about how the product is built goes to the client first and must be true of the product.

## The wordmark over the picture

Once, early, when the name is first said: the wordmark on glass, large (15 percent of the width), on the EMPTY side of the frame by the same side map as the bubbles, or at the top (7.5 percent of the width) when the frame has no empty side. It landed on a face in one render; a wordmark never sits on a face. One curve, 0.5 s, no overshoot.

## The book of a trip

A result that is a document (an itinerary, a plan) is a glass card on the empty side of the frame whose pages turn: title in the display face (96 px), lines in the text face (40 px), a small uppercase badge at the bottom ("Booked"), each page rising in (0.38 s, power2.out) and leaving up (0.3 s), the whole card rising in and fading out. Five pages in 4.6 s reads as a flip through a little book. At 76 px and 32 px it read as a web card, not a book.

## The end card

The brand's own: a light gradient ground (white to #E9E9E9 at 165 degrees), the wordmark large (12.5 percent of the width) in the display face, the tagline under it in the display face, one line in the text face in grey, the address, and small: "The people in this film are generated. What the product does is real." Each line rises in 0.45 s apart. Seven seconds; the last two quiet. Fonts are the brand's files converted to TTF and declared with @font-face in the composition (a font-family name without an @font-face is a lint error, and the renderer would silently fall back to a system face: one end card went out in Arial).

## The probe

Before any full render: a three-second composition with one of every new element (a sent bubble, a reply, a note, the wordmark, the book), rendered and read as a frame. Two minutes, and it found: a doubled percent sign that survived into the CSS and silently dropped the whole glass background (a string substituted as a value is not run through the formatter); a tail that read as a diamond; a bubble unreadable over a dark hedge; the wordmark on a face.

## The renderer's own rules (HyperFrames 0.7)

- A composition is a root with `data-composition-id`, `data-duration`, `data-width`, `data-height`; clips carry `data-start`, `data-duration`, `data-track-index`; videos `data-media-start` for an in-point and `muted` when the sound comes from elsewhere.
- One audio clip per track index; two on one track may not overlap. Give every voice its own track, or keep the sound out of the composition altogether (recommended).
- Every exit tween is followed by a hard kill at the clip's end.
- No font-family without an @font-face.
- About forty elements with `backdrop-filter` or `filter: blur` in one composition and the capture can go black for the first half of the render; thirty rendered clean. Split a long film into pieces (which the piece-by-piece render does anyway).
- `render --fps 24 --quality standard --workers 1 --output renders/x.mp4`; needs `ffmpeg` and `ffprobe` on the PATH of the same command and says so only at the end. Never regenerate a project's HTML while its render is running.
- Lint before every render: `npx hyperframes lint`.

## Captions for spoken lines

A spoken line on a film that leans on speech is captioned from its first word, within two frames of the word, seven words or fewer per frame, rendered by this layer from the transcript's word timings, never by the video model (models burn in gibberish subtitles). A story told in bubbles needs no captions: the bubbles are the captions.
