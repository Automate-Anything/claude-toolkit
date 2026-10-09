# The method: fourteen steps

How a film is made with generated footage, in order. Each step has a gate (what must be true before the next step starts) and the tool that does it (`tools/README.md`). The rules behind the steps are in `principles.md`; prices and limits in `models-and-venues.md`; why each step is the way it is, with the mistake that taught it, in `lessons.md`.

The order matters because the cheap things come first: words cost nothing, voices cost cents, stills cost a dollar, a second of footage costs up to a dollar, and a render costs ten minutes. A mistake is caught at the cheapest step that can catch it.

## 1. The idea

Find the insight before the idea: the one true thing about how people live with the problem ("people say what they need done out loud, all day, to nobody"). Without an insight the film is a list of features with actors. Use three ideation methods from different families (take a part away, collide two worlds, invert the worst version), write eight to twelve ideas, treat the first three as warm-up, score honestly and argue against the favourite ("why is this not a 9"). Every scene must pass one test: could a rival show this? If yes, it proves the category and not the product, and it leaves. Read the rivals before writing and again the week of release. Write the stranger's sentence first: what one person says the product is after one viewing. Keep a fallback idea that avoids the riskiest craft (for generated footage: no speech on camera).

Gate: the stranger's sentence exists and names something only this product does.

## 2. The hook

Design the first three seconds before anything else (`hooks-and-first-seconds.md`). Frame 1 is the hook and the poster: a face with a specific feeling or one object, one idea, no logo, no card, no room first. The hook lands silent (words on screen, a picture) and rewards sound on. Stack the three channels: what is seen, what is said, the words on screen, all saying one idea inside 1.5 seconds. Write twenty hooks and kill nineteen; score them (`craft-and-prompting.md` section 2).

Gate: the first frame and the first line are written down, and the client has heard the line.

## 3. The script

Write it in the way people talk (`principles.md`, section "The script") and give it to the client as a plain file to edit, with the picture, the spoken line and the words on screen per scene, and a notes space at the bottom. When he has edited it, compare his version with yours line by line and write down what each change teaches. Check every line against the product: a line the product cannot make true goes on the product backlog as top priority. A second piece (a fast run-through, a vertical) is its own script.

Gate: the client says go on the file.

## 4. The voices

For each person who speaks: numbered candidates from a voice library on one page he can open and play, each list labelled by the person in the film ("the elderly woman at the table", "her husband"), never only by the library's voice name. Candidates come from a library search by gender, age, accent and use case, sorted by how often a voice is cloned; add the ones worth hearing to the account. Lines are made with a dialogue model that takes emotion as bracketed tags, written the way people talk (hesitations, "um", a half sentence), at low stability; a proper name the model gets wrong is respelled for speech (a brand name spelled with a U came out with a Y sound; the spelling that is read right is found by making four spellings and listening). Check what was said with a transcriber that also names audio events; it cannot judge an accent or how an R is said, so that goes to the client's ear with short samples.

Gate: a number from the client for every voice in the film.

## 5. The stills

One cast still per person or couple, one still per place, from the best still model (GPT Image 2.5 in October 2026), 2K, with a description detailed enough to hold (age, skin, hair, glasses, clothes, the room's objects, the lens, the light). Every other angle of the same people is an EDIT of the cast still on an image-edit endpoint ("keep the exact same two people, faces, hair, clothes, the same kitchen, the same window light" plus the new framing), so the faces match in every frame; six angles of a couple held in every one. Phone screens are never generated readable: dark, or a plain light grey, and the real interface or the words go on afterwards. Look at each still yourself, at zoom, before he sees it.

Gate: he has seen the cast and the places.

## 6. The raw takes, one piece at a time

For a new film: generate ONE shot, look at it yourself frame by frame (a tile of frames), show it to him raw (no words, no music, nothing on top), carry what he says to the next shot. Never the whole film at once; a whole film generated in one day has to be reworked when the method is wrong.

- A person talking: the take is generated FROM the approved audio (an audio-driven model such as OmniHuman 1.5: image plus audio in, a talking person out, the mouth following the voice, the face laughing where the line laughs), with a mask so only the speaker's face moves to the words; anyone else in the frame is generated listening (image-to-video from the same still, "his mouth stays closed, he never speaks") and the halves are composited with a feathered split. Two angles per segment from the same audio, cut like two cameras. Details in `talking-people.md`.
- A scene without speech: image-to-video from its still (Seedance 2.5 on a venue that accepts faces). The prompt says the shot begins on the start frame and continues without a cut, what moves in what order, what the camera does (usually: holds still), what is heard, and that nobody speaks and there is no music and no text.
- Every paid call prints its cost line first and writes a receipt at acceptance (`tools/higgsfield.py`, `tools/fal.py`). A day cap and a per-call cap refuse a surprise. The venue's own estimate is free; ask it first.
- Generate at 480p or 720p, pick, and enlarge or regenerate the keeper for the final.

Gate: each take read frame by frame (`tools/review.py`: length, loudness, a contact sheet, with `--words` what was said) and accepted by him.

## 7. The edit list

One JSON file per version (`work/edit/<film>-vN.json`) built by a script, never by hand: the shots (take, in, out, duration), the calls with their audio files, the bubbles (who, kind, text, when, how long, which side), the wordmark, the book, the card. Shots are timed from the voices (the real length of each audio file plus a gap), never the voices from the shots; every exchange ends inside its own shot; a stock line that would spill onto the next picture is cut at a word boundary; a take shorter than its call is slowed to fit, never frozen; a reaction shot borrows the sound of the line it interrupts. A version is a new file; a note becomes a change to one row.

Gate: the script prints the timeline and every exchange ends inside its own shot.

## 8. The designed layer

Bubbles, tags, glass, the wordmark, the book of a trip, the card: a generated composition for a code renderer (`tools/compose.py` writes HyperFrames HTML with GSAP timelines from the edit list). It carries no sound. Probe first: a three-second composition with one of every new element, rendered and read as a frame, before any full render; a probe found a formatting bug that silently dropped the whole glass background in two minutes instead of twenty. Details in `words-on-screen.md`.

Gate: lint is clean and the probe frame is right.

## 9. The sound

`tools/mix.py` builds the mix outside the renderer from the edit list: the takes' own sound in sequence, every voice line at its real length with a gap (shifted if it would touch the one before), the takes' sound and the music ducked under every voice by a sidechain compressor, then loudness to -14 LUFS with true peak under -1 dBTP. One voice at a time, always.

Gate: the script reports no overlapping voices.

## 10. The render, in pieces

`tools/render_pieces.py <edl> <mix> <name>`: every shot of the edit list is its own small composition and its own short render (about a minute), rendered again only when its part of the edit list or the composition code changed; then the pieces are joined, the mix is laid under, a 720p preview is made, and both go where the client looks. Run it as a detached process (a `.cmd` or shell script started with the operating system's start command, logging to a file): an agent's tool call is stopped after a time limit, and a film must never depend on that. Never one long render of the whole film: a fifteen-minute render on a shared computer lost the machine to other work four times in a row, and a change to one shot would redo all of it.

Gate: the log says DONE and the file's loudness and length are measured.

## 11. The check

A grid of frames across the whole film (one every six seconds) and single frames at every new element, looked at before anyone else sees anything: bubbles inside their scene, nothing on a face, nobody mouthing someone else's words, no black frames (a code renderer with many blurred overlays can capture black), the first and last syllable of every line, loudness and peak measured. Say which checks were measured and which were watched; never call a measurement a viewing. Still frames cannot show lip-sync drift: scrub the talking shots at speed or hand them to the client's eye.

Gate: you would sign it.

## 12. His notes

Each round of notes becomes a new version file; nothing is overwritten. Structural notes go back to step 3, a voice to step 4, a face to step 5 or 6, words on screen to step 8 (free), timing to step 7 (free).

## 13. Before release

Every line proven on the real product (a saved real run behind every result on screen); every voice approved; the kept takes regenerated at 1080p or upscaled (test the upscaler on skin first; a 1080p master is a legitimate choice); the grade; the platform files (16:9 master, 9:16 cutdowns of one idea each, 4:5 or 1:1 for feeds) and the poster frames chosen by hand; the disclosure line on the card; five strangers watch once and say in one sentence what the product is.

## 14. Write it down

After every piece of work: one dated line in `lessons.md`; a rule into `principles.md`; a price or a limit into `models-and-venues.md`; the step above corrected if the lesson changes the method.
