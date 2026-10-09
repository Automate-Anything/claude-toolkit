# The production pipeline for AI-generated video

A distilled, vendor-aware reference for producing short-form ads, short films, music videos and narrated motion-graphics explainers from generated footage (or a
client's own clips). It is written for any practitioner on any project. Every number here was measured on one model, one venue, one tool version and one date; a number
is a default until your own project confirms it, and a tool fact holds only for the model, venue, version and date it was measured on. Re-read a vendor's rate page and
re-measure on your first takes before a decision rests on a figure below.

The spine of the method, in one line: **generate small, approve, then reconstruct.** Generate every clip at a low resolution on a venue that accepts references, read it
with instruments, get the operator's explicit pick, and only then upscale with a reconstructive model, grade, add grain, and downscale once per platform. Two
disciplines make this run without burning money: nothing is bought without a cost line and the operator's explicit yes per batch, however small; and every gate runs
**in code before the call**, never from memory (an agent that "remembers" a rule forgets it on the next context window; a script does not).

---

## 1. The pipeline: phases, gates, and what each produces

Phases run downhill. Each phase's output is the next phase's input, and each carries its own gate. A red gate (GATE:) blocks; the rest guide and report a cost rather
than refuse.

| # | phase | fires on | the gate before it proceeds | what it produces |
|---|---|---|---|---|
| 0 | entry / resume | a request that will end in a rendered video, no phase named yet | none | the genre fixed, the project rehydrated from its pause block, the next phase named |
| 1 | pre-production | a brief, a client script, "shot list", "the premise", "track map" | the client's text saved verbatim; the script-diff PASS both ways; the arc check (film) | the beat list, the shot list by continuity partition, the kit, the risk register, the cost plan |
| 1' | reference teardown | a format the team has not measured | the instrument's self-test; 3 to 5 real references measured, never estimated | a timestamped beat grid at the references' own rhythm |
| 1'' | footage curation | a pack of the client's own clips | the frame-rate decision made against its printed motion cost; nothing conformed before the pick | a recommended cut as a labelled proxy, with reasons and runners-up on disk |
| 2 | references and continuity | "continuity", "refs gate", "start image" | GATE: the refs gate (rules file + ledger + accepted stills) | the accepted reference set by name, the start image, the continuity ledger |
| 3 | the prompt | "write the prompt", "lint the prompt" | the prompt linter PASS for the venue's dialect | the compiled prompt |
| 4 | the generation call | "cost line", "GO", "submit the seeds" | GATE: the cost line + the operator's GO, per batch | the seeds as clips by path, the receipt |
| 5 | the read | "review the seeds", "which take" | continuity FIRST, then the acceptance matrix | keepers with usable windows, voids with reasons |
| 6 | the cut | "build the EDL", "move the line to" | the beat gate + the EDL structural check | the EDL version file (every time derived, none typed) |
| 7 | the sound | "generate the VO", "the sting", "captions" | GATE: the cost line per TTS / STT / clone / music call | the VO stem, the cues, the captions, the placement read |
| 8 | designed elements | "end card", "turntable", "the wall" | the render's completion sentinel; the delivered-frame check | deterministic renders and PNG layers at their lengths |
| E | a narrated explainer | "make an explainer about", "turn this article into a video" | the script sign-off, the pilot sign-off, the timeline check | the rendered explainer, its timeline, its QC list |
| 9 | the finish and QC | "render the spot", "final renders", "QC" | GATE: no upscale before approval; the hosted-upscale GO | the 1080p master, the QC PASS, the finals |
| 10 | the client round | "client feedback", "send this" | the operator's per-item answers | the curated list, the new version, the numbered ask |

**Rules that bind every phase, whatever the genre.** A cost line and the operator's explicit GO precede any billed call (video, image, music, TTS, STT, clone, hosted
upscale), however small the amount; local upscales, the hero grade pass, renders, local transcription and uploads are free. Nothing is upscaled before the operator
approved the take. The client's text is the single source of truth; additions are proposed as numbered cost lines with "no" as the default. Continuity is the first
acceptance test, before the gag. Masters are 1080p only. Decisions reach the operator as numbered plain questions with the cost and the full file path inline, and seeds
reach them as clips by path, never as contact sheets. Every writer drops a timestamped backup before it edits a file, because a project tree carries no version control.
Evidence is not looking: a file that probes valid has not been SEEN until its frames were read, so a report says "container valid, measured rows pass, visual pending"
until then, and appearance is never inferred from a filename, a prompt, a job history or a probe.

**The genre switch** decides the pre-production path, the unit of work, the look, the finish and the cut grammar:

| | ads | film | music video | explainer |
|---|---|---|---|---|
| the unit | a spot, 13 to 60 s, standalone | the film (runtime from the story) | the track (every second allocated) | the film (runtime from the measured voice) |
| the SSOT | the client's script | the self-revelation paragraph then the beat sheet | the track map | the signed-off script; a facts file per claim |
| captions | burned in, narrator only | none | none | in the composition, measured to fit |
| the sign-off | the card + the audio signature, every spot | none | none | none unless briefed |
| upscale | per shot | ONE pass on the locked cut | ONE pass on the locked cut | none (rendered at delivery raster) |
| audio | VO stem + cues + captions | generated where required; the mix crests with the push-in | the track itself; the master carries the cut's own audio | the voice, loudness-normalised |

**The handoff contract between phases.** A chain of automatic phase-to-phase hops has a budget of three after the originating one, unless the operator authorised a
named phase scope ("this GO covers pre-production through the finish for spot X"), which sets the budget to that chain's length. A stop condition outranks the budget
and halts the chain: a missing authority, a material fork (proceeding on an assumption could change truth, safety, cost or reversibility), an unresolved safety gate,
any outward side effect (publish, send, spend, deploy, delete), two similarly plausible routes (present both and stop, never coin-flip), or absent inputs. Never run the
same phase skill twice in one chain. Every handoff reports a status (DONE, DONE WITH CONCERNS, BLOCKED, NEEDS INPUT), the recommended next step by name, the open loops,
and every finding labelled Measured, User-provided, Calculated, Estimated, Proxy or Unknown. A proxy reported as a measurement is the one failure this labelling exists
to prevent.

---

## 2. Pre-production: the script is the source, the shot list is derived

Nothing generates before the plan exists on paper. The plan is a set of files in the project, not a memory, and every rule in it is the price of a generation that was
made without it.

**The script as the single source of truth.** For an ad the client's script is saved verbatim beside the plan, read end to end before the first prompt, and rewritten as
a beat list in script order BEFORE any shot list exists. The shot list is a derivation: it may add framing, coverage and timing, never a character, a beat or a line.
Additions are numbered cost lines with "no" as the default. A rejected cut from an earlier round is evidence about defects, never a source of structure: running scene
detection on it rebuilds the previous producer's segmentation, mistakes included, with the authority of a measurement. A client may switch the SSOT mid-build to their
original script (save it, diff the accepted assets, rebuild the beats); a full alternate spec is a NEW spot; a one-line note is a version bump.

**The beat list.** One beat per script line or on-screen stage direction, in script order. Each beat names the EDL events that will realise it, the VO and sfx inside
it, the order rules (sfx then off-screen line then the reaction word), the marker a line must clear, the cue edges on a marker, a layer's lead before the next beat, a
minimum duration, and the ids that must NOT appear with the operator's reason. Markers are measured on the keeper (the hit's RMS peak, a word onset from the transcript,
the frame a wall clears), never guessed. A sound-only beat still needs its visual cause on screen; a reveal is a beat of its own and its asset appears in no earlier
beat.

**The script diff, by code, both ways.** Before the first prompt, a diff checks the beats against the client's text and the shot list against the beats. A quoted line
that differs from the SSOT by a single token FAILS (an added article once passed a 60-percent-overlap rule). A sentence of the SSOT that no beat covers is a beat the
list forgot. A sentence or a continuity partition split across rows FAILS unless the row records why (consistency not required across the split, or the action outruns
the cap).

**The shot list, built from continuity partitions, not from shots.** A partition is a maximal run of beats that must hold the same people, identity-bearing objects,
setting and look. It is ONE generation whenever it fits the generator's maximum single-clip duration. Consistency is free inside one generation and a gamble between
two, so every extra generation adds risk. You buy a long generation for consistency, not for cutlessness: a cut the model composes inside one generation carries the
world across it by construction, where a cut an editor makes between two generations gambles on it. A short generation is a tool, not a failure (to cover a gap, to fix
a defect, or wherever consistency across the split is not required at all).

**The generator's cap is read, never inferred.** The maximum single-generation duration comes from the vendor's own schema, cost estimator or error message (one
estimator names the real cap when asked for an over-long duration), never from the longest take you happened to run. Unread, the cap is UNKNOWN and no action may be
split. It is written in the shot list's header with its source, and read before the list splits any action.

**Spoken lines are timed before durations are fixed.** With voice-over, dialogue or lyrics, the lines are timed first; durations that sum to a runtime target are a
target hit, not a timing.

**Stage isolation and the redo that never cascades.** Each stage reads ONLY the files of the stage before it. The prompt stage reads the shot list and the reference
set, never the script, because a prompt that re-reads the script re-interprets it and the approved shot list stops being the source. Durations are copied from the shot
list verbatim; a subject's anchor phrases are quoted into every prompt that shows it, word for word. A redo backs the current file up to a kept-versions folder, logs
one metadata row, names the downstream stages that may now be stale in the house order (script, beats, shotlist, refs, prompts, takes, edl, mix, finish), and STOPS;
which downstream stage is redone is the operator's call, each its own redo.

**The rest of the ad plan.** The brand kit (the audio signature, the fixed/locked line, the variable line as a pile of punchlines cherry-picked per spot and never
reused across spots, the CTA, the triad "what it is, what it does, where I get it"); the assets to ask for (packaging photos every side, FLAT artwork since photos are
wrapped and rounded, the product's pieces on white to read the fill colour, full-resolution originals); the rulings to get from the client once (language and platform
risk, rating, wardrobe and set where the script is silent, likeness), each logged with WHO decided and what would reopen it; a global spec decided once (aspect, safe
zones, the true-size rule, the grade and its normalise step); a risk register whose mitigations are already in the shot list; and a cost plan by dependency round so the
operator answers one GO per round. Mine the hook pattern from real top-performing videos before drafting one (pull 50 to 150 over a bounded recent window, transcribe
the 10 to 15 most relevant, tabulate views, the first spoken line 0 to 3 s, when the product is first named, who is on camera) and name the dominant pattern in one
line; but a mined pattern shapes ORDER and FRAMING, never the client's line. Size a talking hook to its take with words divided by 4 minus 1 second (45 to 55 words is
roughly a 12 to 14 s punchy hook; past about 20 s of continuous speech a take drifts and splits into two clips); join clauses with commas, because the model reads a
full stop as permission to pause about half a second.

**A film inverts the order.** The self-revelation is written first as one paragraph and held to 90 percent of the runtime (an early anagnorisis removes the moral
jeopardy for the rest of the film). Each principal carries four slots (a lie, a want, a need, a ghost) and an arc with a canonical state chain; a character-sheet check
refuses a beat sheet whose classifier answers and arc disagree. The beat sheet is the 7-step DNA on a percentage axis in seconds (Weakness and Need at 0, Desire at 12,
Opponent at 25, Plan at 50, Battle at 75, Self-revelation at 90, New Equilibrium at 95), each beat carrying a subworld (a physical environment built before shots).
Premises are ranked twice, on story and on how likely each is to survive the pipeline, and the two rankings are allowed to disagree; the disagreement is the operator's
decision. The hero shot (the shot the film is built around) is storyboarded and generated first: if it does not land, the film does not exist. The hero shot decides the
FORMAT (a photoreal AI face drifts and dies over a held fifteen-second close-up; a stylised, painterly face holds because there is no photographic referent to check it
against), which in turn removes lipsync exposure and likeness risk. A music video adds one rule: the track is measured before a beat is written, and every second is
allocated to a generation window before any prompt, so later beats are placements paid for by trimming the loosest stretch, never appends.

### The shot card (shot-list row) fields

One row per continuity partition. One row is one generation.

- **partition / id** stable id in the shot-list vocabulary; the montage list and the pickups cite it, so it is never renumbered.
- **beats** the beat ids this partition realises.
- **events** the action verbs, and the cast, per cut inside the partition.
- **duration** copied from the beat grid verbatim; within the read cap.
- **the script lines it serves** quoted IN FULL (the diff checks this).
- **mode** refs-only for a whole partition; a start image for an exact continuation; an end still for a defined camera move; a proxy clip for a move on the audio-driven
  camera engine.
- **refs (in slot order)** the reference names in upload order, each with its one narrow role.
- **file** the output path.
- **credits / seed** the estimated spend for the row.
- **split** present only when one action is split across rows, stating why (consistency not required, or the action outruns the cap).

Around the rows sit: a method line (refs gate, cost gate, partition-first, the dialect); a script pointer with the client text verbatim and the generator's cap and its
source; the kit table (reused vs to-build per SKU, plus the look plate per light context, the reference dress rehearsal per partition, and the voices); the room
geometry pinned per partition (re-pinned from the first keeper's frame 0 after the pick); the characters in prose or from the client's approved photos, cast CLOSED
after the first keeper; the rounds and cost by dependency level; the audio plan with the VO lines timed before the durations are fixed; the acceptance rows (row 0 is
geometry and continuity); and the submission commands with the ledger record written before polling.

**The reference teardown** turns a format you have not measured into a beat grid. Pick 3 to 5 REAL examples of the target format (three is the floor: one is a copy, two
that disagree cannot be told from noise), on the deliverable's platform and aspect, each with a source line and a stated reason, kept outside the deliverable tree.
Measure every shot in its DISPLAY geometry: start, end and length; framing by the largest verified frontal face (ECU / CU / MCU / MS / WS or none); motion by phase
correlation (static, drift, pan, handheld) with the speed in frame-widths per second; the first spoken word, speech rate and words per shot; and across the set, shots
per 10 s, the median shot and its spread, the first cut, the framing and motion mix. The measured columns are NEVER replaced by a model's estimate (a written breakdown
misreports durations and cut counts). Write the content of each shot by hand, keep the bones and swap the world (keep the shot-length pattern, the first cut, the hook's
length, the framing sequence, the camera grammar, where speech starts; swap the people, places, props, words, jokes and any set piece that identifies its creator), and
write each of your own beats into one slot in script order. A reference that cuts every 1.5 to 2 s is realised by CUTS (composed or edited), never by more actions in
one shot.

**Studying a reference ad** (a "make it like this one" brief) hands over a template's structure, never its content. Classify the reference by profile (texture, demo,
voiceover, platform-ending, mixed) and build two lists before writing: what to borrow (hook, pacing, shot order, camera, the satisfaction point, the job the ending
does) and what never to carry whatever the profile (the template's product, brand, packaging, claims, prices, captions, platform UI, watermark, account handle, and any
real person's identity or voice). Listen before classifying a presenter: frames cannot tell a voiceover from a lip-sync from silence. Score the first 3 seconds on five
weighted dimensions (visual impact 30 percent, the spoken or written hook 25, emotion 15, information 15, rhythm 15), each citing a named frame; the scale RANKS
versions side by side and predicts nothing. Overlays (captions, prices, shopping UI) are off in the generation and designed in post; the last second keeps the product
on screen.

**Footage curation** (the client supplies the picture) is a phase with one output: a recommended cut the operator can judge on picture, with reasons and runners-up on
disk. The order does not move: take the pack in (hash it, since download copies are byte-duplicates more often than not; probe every file's DISPLAY shape and frame
rate); decide the frame-rate conform against its printed motion cost BEFORE converting (same-speed keeps real time and the audio but drops or repeats frames, so every
dropped frame doubles the per-frame step, which at the delivery width reads nothing under about 5 px and stutters near 30; all-frames keeps every real frame but runs
the clip slow or fast and drops the audio; the originals stay until the cut is locked, because a same-speed master cannot give its dropped frames back); break every
clip down with three tiers of sheet (overview for camera routes, survey for what is in frame, every-frame for a window's in and out) and a written read per clip; group
the pack into camera ROUTES (a route is one subject seen by one camera move, often recorded two or three times in different aspect modes, so a pack is far fewer routes
than files); cut the picture slots to the programme audio's phrases (the cut 2 frames before each phrase's first word); read candidate windows at the DELIVERY shape,
per metric with its validity (sharpness compares only inside one route; shake reads on the axis the move does NOT use, because the residual along a pan is the conform
cadence, not the hand); assign by relevance to the spoken phrase first, then looks, then no route-plus-subject twice, with a runner-up per slot; render a labelled proxy
over the real mix and read its cut-check sheet before it goes anywhere. A requested visual absent from the pack is reported as missing with the nearest real candidate
named; nothing generated or borrowed stands in for it.

---

## 3. References and continuity: build it, never remember it

Every still and every clip is generated from nothing, with no memory of the clip before it, so continuity is BUILT. Three words carry the method. A **keeper** is a take
the operator picked; its frames are the only root a scene can continue from. **Backfill** means every regeneration's references come from accepted assets, in order of
preference: an accepted keeper frame, a crop of an accepted plate, an edit of an accepted still, and a fresh still only as the last resort. **Lineage** means every
start image chains back, by crop or image-to-image edit, to a keeper or to the client's own imported photo; a still generated from prose starts a new world, and three
seeds of it are a round of continuity errors. The ruling that binds the whole phase: spatial and geometric consistency between the shots of a scene is the PRIORITY
consideration for accepting or rejecting a generation, before the gag is even judged.

**The continuity ledger.** Before any reference for a scene, open the previous shot's keeper and read its LAST frame (and the accepted plate, and the client's photos)
at 2 to 4x. Record one row per element that appears in more than one shot: the element, the fixed fact (read, never remembered), the state before, the state after, a
tolerance tag, and the reference name. Two rules hold the ledger together: shot N's after is shot N+1's before (diff them), and every number in a prompt comes from this
table verbatim (the count read on the zoom, never a number from memory). The axes, each a round lost when missed: position and seating order, pose state, the door
(swing, distance, which side of the lens), eyeline per character, who faces whom, counts, the closed cast, wardrobe, held props, set dressing, named states (teeth out,
a garment off, glass in the pane), product shape and colour, product size, density and sound after a burst, anatomy, room geometry per cut, and a trailing line's
continuation. Each delta carries a tolerance tag: **Locked** (fails closed: product shape, door, cast, named states), **Flexible** (may drift: background extras' exact
poses), or **Story-changing** (in force from its event onward). The gate fails on Locked and in-force Story-changing rows only.

**References are derived, in dependency order.** A still is generated only after every still it is built FROM is accepted (portraits, locations and look plates first; a
prop after its owner, built in the owner's hand or on the owner's table; an anchor frame last). The build order: the start image equals the previous shot's LAST state
(an image-to-image edit of the keeper's frame with only the scripted change), never the scene's opening wide; before/after pairs come from ONE source (the after is an
edit of the accepted before, and a kept post-state element has its pre-state derived from the kept frame with the change reversed, riding only its own side of the
transition); inserts and close-ups start on a CROP of the accepted plate at that framing; character refs are cut from the first accepted take (the subject isolated,
occluders painted out, one ref per recurring character in every later gen); product shape from the client's own photo and product size from an in-world crop beside a
known object (a magnified sheet pins shape and colour only, never size); the room ref is the establishing frame with the whole cast in it (it EMBEDS them, so adding a
member from their single ref puts that person in twice); garment and prop text is generated INTO the reference, never hand-placed; a look plate per light context (an
abstract full-frame field of colour and light, no subject, cited by every shot in that light under a look-only role, enumerated against the shot list before it is
generated, because three plausible exterior plates covered neither of two interiors on one film); and a client-supplied image is IMPORTED with its provenance (recording
a client's approved photo as a generated take to satisfy the lineage rule writes a false record).

**Point at references, never describe them.** A cited reference gets one narrow role and an exclusion ("take his complete appearance from his sheet and change nothing";
"use its shape, size, materials and colours only, never its background"). Any adjective about a cited reference can only contradict it, and the words won every time on
measured runs. Diff prose against the asset, never against other prose. Colour identity is stated RELATIVE and bounded on both sides whenever the frame is dark
("clearly lighter than the forest behind it, and still clearly darker than the pale one"), because a one-sided relative instruction is a direction with no stopping
point. One subject per reference at native resolution (a montage blends into an average subject); a sheet transfers its LAYOUT, so a grid renders as upright rows and
the sheet is built as the shot's own scatter.

**Generating an identity reference** (the last resort: a recurring character with no keeper and no client photo, which must be AUTHORED). None of the image routes carry
a seed, so the PROMPT is the seed, and the only thing that makes it one is how little freedom it leaves. Write it as JSON, save it beside the frame it produced, and
register the frame with the JSON as its provenance. Lock every variable (one concrete value per attribute, a hex for every colour, degrees for a head turn, cm for
distances), and lock ABSENCE twice (anything the model might add that the reference lacks is stated as "none" AND in the negative list). Counter the model's default
pretty-face prior in all three places at once (a geometric field, a one-line imperative, and the default version in the negatives), and counter-steer toward the
reference's own features, never toward plainness. Put quality boosters ("8K", "flawless") in the NEGATIVE list and replace them with a capture pipeline (body, lens,
aperture, ISO, film stock); imperfections are present and LOCATED. Iterating is a variable audit across the whole list, not a patch, and every change goes into ONE
generation from the full JSON (an image-to-image edit is never stacked on the persona still, because each stacked edit softens its patch and the video model animates
the seams). Describe an identity by biometric traits (the actual nose, jaw, eye colour and spacing, hairline, marks, age), never by beauty adjectives, which activate
the beauty prior and overwrite the face the reference carries.

**The cast stress test** locks a new recurring member BEFORE the first video that shows them, under the conditions that break an identity: three angles, three shot
sizes, every light context they appear in, and a two-shot beside every co-star, at least ten cheap stills from the member's own identity references with the canonical
descriptor pasted verbatim into each. A character locks at **10 of 10**: one drift is a miss, never averaged away by the nine good ones. A location or a prop locks on
the operator's explicit pass over its matrix. A reference changed after the lock voids it. The matrix is its own cost line and GO.

**Accept every generated still like a seed.** A start image is a contract: any defect in it is in every seed built on it. Before it feeds anything, run the scene's
acceptance rows on it at zoom (product pieces at 2x, lettering against the accepted close-up, geometry against the previous keeper, the cast counted once each at 2x,
anatomy per person at 3x, a silent subject's mouth closed, a speaking subject's mouth open mid-syllable). Repair by REASON, then read it again: a stochastic miss is a
new seed on the same request; a local defect in an otherwise-right still is an EDIT on the clean plate; a still that shows exactly what was asked for is a re-written
request, never another seed of it. A still is never accepted because the attempts ran out; two repairs that do not clear a row go to the operator with both attempts.
Read the TEXT in every frame you accept: a watermark, badge or caption baked into a reference is animated into every seed, and a model reads lettering in a reference as
an instruction to letter the frame.

**The refs gate runs in code before the GO.** It turns the ledger into a rules file and refuses the generation call when a locked element's reference is missing from
that call, when a start image has no accepted record, when a capitalised subject in the prompt is neither ruled nor declared (born in this gen, or a conscious
prose-only decision; a capital inside a quoted line is a spoken stress mark, not a subject), when a reference whose file changed after it was accepted is cited, when
light described in the prose has no look plate cited, or when a hosted reference URL has lapsed (checked locally from the recorded expiry, because the model fetches the
URL at generation time while the job bills at acceptance, so a lapsed URL would pass a name check and cost the whole batch). Its table is pasted into the GO ask; a FAIL
means no submit (overridable only by an explicit GO against a named cost, never a silent stop). A cheap dress-rehearsal still from the SAME reference set is read before
any refs-only call or any batch over a modest threshold, so the operator approves the spend against a picture of what the references carry, not against a description.

**The scene proxy** is the room computed, not remembered: a keeper frame becomes a labelled grey-box scene (people, furniture, door, window, lamp, floor, each a box
with a position, size and depth rank) on a local GPU, from which the agent places ANY camera and reads what it sees (left or right, near or far, in frame, occluded, out
of frame) rather than guessing. That table IS the ledger's room-geometry row and the source of every geometry sentence for a new angle. One geometry feeds three
channels: the grey frame rides as a layout-only reference when a start or end still is generated, and as the video camera engine's geometry reference, so the prompt,
the stills and the refs cannot disagree. A hand-added box is anchored in DEPTH, not only x and y, because the far plane slides WITH a camera move and the near plane
against it; a box on the wrong side of the target distance moves the wrong way and reads a correct EXIT as a drop. Where no GPU is available the proxy fails closed, the
geometry is read off the keeper frame at 2 to 4x zoom and copied into the prompt verbatim, and the GO ask says "no scene proxy for this shot"; never write geometry from
memory and call it computed.

**The repair ladder when continuity breaks**, cheapest first: backfill (rebuild the references from accepted assets, regenerate only the failing shot); extension
(continue the keeper from its last frame on the keeper's own job, so room, wardrobe, framing and props carry by construction); an insert that explains the break; start
ON the establishing frame (a punch-in on the same axis, never a reverse angle when continuity is the note, because a reverse angle re-invents the room on every seed); a
finish punch-in or reframe that leaves a stale state out of frame for free; and only then drop, reframe or cut the beat. Above the ladder: one continuous action is ONE
generation (a frame-perfect chain of separate gens still reads as a stitch, because each gen re-decides pace, drift and light); and replace the reference, not the seed,
when several seeds from one accepted reference all read fake (about one reference in ten will not animate however it is prompted).

### Asset hygiene (the prompts, the job document and the files on disk must agree)

Each rule below billed a render, or nearly did, and none is visible from inside a prompt. Cross-check citations against assets BOTH ways (every reference a prompt cites
resolves to an asset that exists, and every asset in the job document is cited by something); a set-difference both ways surfaced four cited plates that were never
entered as assets so no generation leg ever saw them. A spec that lives in two documents is not changed until it is changed in both. Never bulk-replace a domain noun (a
find-and-replace of a stone's name broke the one clause that was physics, not storyboard); enumerate every hit and rule on each. When a generated frame settles a
geometry question, diff every later prose against the IMAGE, never against other prose. Strip a superseded asset's cached citation rather than annotating it. Never
select an asset by filename order (alphabetical order has nothing to do with time; select by modification time or an explicit version). A defect note names the
hash-suffixed FILE it was written about and the re-roll that fixes it clears the note in the same step (a note written about a regenerated asset silently re-points at
its replacement; one "both boards are WRONG" note outlived the re-roll that fixed it by six hours and had the operator authorise a regeneration of an asset that was
already correct). The document stores a MEASUREMENT, never a verdict, and every count, duration and total is regenerated by measuring the files at write time, never
retyped. A derived artefact (a proxy clip, a crop, a split sheet) carries the fingerprint of the state it was derived from, and the gate diffs that against the live
source; a mismatch is not a warning to weigh, the artefact is stale and is re-derived before it is cited.

---

## 4. Prompt dialects per model and venue

A prompt is COMPILED, not written: the shot document supplies the facts, the accepted references supply every visible attribute, the venue's dialect supplies the shape,
and the prompt says only what neither a reference nor a parameter can carry (which reference is which subject, what happens in what order, what the camera does, what is
heard). Three words: the **dialect** (one venue, one schema; a front-end's feature set is not the model's contract), the **contract** (what the prompt may say, never a
description of a cited reference and never a parameter), and the **tail** (the trailing exclusion region, the only place a prohibition steers instead of injecting).

**Global rules that bind every dialect.** Parameters never go in the prose (model, version, duration, aspect, resolution, frame rate, the audio toggle, API field
names); the one exception is timing a dialect's schema requires. Observable direction, never adjectives: "cinematic", "dynamic", "epic" steer nothing; write subject
placement, camera height, light direction, motion speed, performance, sound. Negatives are targeted to a specific likely failure or omitted. Point, never describe. A
held vendor spec is indexed by every FEATURE it documents, not only the rules you came for (two whole features of one optimizer spec sat unread for a week because
nobody had a question that named them).

**The bracket-template dialect (the primary reference-to-video engine).** References are addressed ordinally per type in upload order (at-Image1, at-Video1, at-Audio1),
a start image passed on its own flag and called "the start frame". The complex-shot layout is a sequence of labelled bracket sections: Generation Goal (the script's own
sentences, quoted), Reference Asset Roles (one line per reference: "at-ImageN is X: use only its A, B, C; never its D"), Subjects and Relationships (the ledger per
person, "only these N people", the geometry as THIS camera sees it, at most ONE anchor coordinate and everyone else by relationship), Event Script ("Cut N (t-t s):" the
framing first on its own clause, then the action, cause before reaction, every eyeline a target, every hand placed, the hit named with its sound in angle brackets),
Audio (room tone, the named sounds, lines in braces per speaker in sentence case with a stressed word in capitals), and Maintain Consistency (the locked facts, the door
sentence copied verbatim from the geometry record). Sound markup: parentheses for music, angle brackets for sound effects, braces for dialogue. State inheritance is the
core: each beat starts from the prior beat's physical result, and the hidden interval is never a reset. Prohibitions live in the TAIL, not the body ("no head bounce" in
the body RENDERED a bounce; a negative in the body renders the thing it forbids), and the sanctioned tail negatives are narrow (subtitles, music, logos, watermarks,
plus what the shot document forbids). Edit and extend are phrasing, not just a flag: without the scope-closure wording the model generates a NEW video, billed in full,
no error. A move is a start image plus an END still baked from the proxy, not a clip beside a start image (a clip beside a start image is inert, moving about 3 degrees
of a 25-degree orbit). Wire limits around 6000 chars (about 2.5 to 3.2k works, over 5k warns), duration an integer, result URLs expire in about 24 hours. On the
pay-as-you-go variant of this model the wire shape is a single content array, not the at-flag shape, and ordinals are numbered per TYPE in array order, so a first frame
occupies at-Image1 and every reference shifts by one; the submit tool prints the resolved map before the GO, because a prompt citing the wrong ordinal generates cleanly
and bills in full.

**The 2.0 / fast draft dialect of the same family** uses "Shot 1:" storyboard lines and NEVER numeric timestamps, half the price per token, slots of 9 images / 3 videos
/ 3 audio, and refuses real faces; it is a draft engine, not the default.

**The typed-label dialect (the audio-capable engine).** Subjects are "Subject N" defined once with their source pictures cited INSIDE the definition, concrete frames
are "Picture N", camera motion is a "Video N" relationship, each label with exactly one retention-analysis entry (fully preserved, partially preserved, attribute
transfer, weak reference). The polarity is the OPPOSITE of the bracket engine: dialogue goes VERBATIM inside a dialogue span, never invented. The style word comes FIRST
in the opening shot ("Live-action, cinematic, a medium close-up frames ..."), the camera is type plus amplitude plus speed in one sentence, and grain belongs in the
video prompt (real footage carries it). This engine has ONE positive stream and NO negative prompt, so a negation that names a concrete object DRAWS it ("do not
reproduce the grid and markers" rendered a floor grid and cyan markers); state the wanted state instead ("the flames stay small and low, the air above them clear").
Count expression beats: more than two or three in one shot average into a still face, so split at 2 to 3 seconds with one beat each. A dialogue span does not move
faces; it reallocates screen time to the shot carrying the line and squeezes its neighbours. A silent standing subject mouths a syllable in the first second if the
start still caught the subject mid-word, so accept a silent start still with the mouth closed; a quiet shot gets a CONCRETE soundscape ("soft room tone with a low
ventilation hum") never an absence, because the engine fills an empty audio lane with invented talk. The camera-motion role sentence and its proxy clip are ONE unit:
ship both or neither.

**The image models (stills, plates, references).** The default image-to-image model composes a scene from references and holds colour, size order and character;
reference 1 is the image being edited, the others cited by role, phrased as a transformation with a preserve list and a conflict priority. A precision tier exists at
the same price for anything that must read as a photograph or survive an edit. The fallback model edits surgically ("change only this, count exactly that") and IGNORES
sheets when composing, so it is for a count fix or a ghost removal, not a compose. One writes garment text the other refuses. Start frames are pre-action (has-just /
about-to, never mid-stride) and a coherent moment, and generated CLEAN (no grain, halation or chromatic aberration baked in, because the video inherits it). Reference
adherence is per MODEL, not per prompt, so reference-critical work defaults to the model that honours it.

**The phone-native dialect** (a genre dialect layered on the model's own, for a creator-style talking head). The formula is camera, person, environment, product action,
expression, lighting, imperfection, each as an observable fact. Name the device as the CAMERA, never as a prop ("handheld iPhone shot, the front camera held at arm's
length"), because a phone written into her hand appears there and one engine burned captions onto a shirt when handed film-stock words; the take review fails a phone or
a camera UI drawn into the frame. Positive-spec only (a negation summons what it names). Light is named practicals, uneven on purpose, never a two-point softbox or a
ring-light catchlight. Motion is the video-call register (weight shifts, blink asymmetry, a hand adjusting the frame once); a torso that holds still longer than about 6
to 7 seconds reads as a render. Where the model voices the line itself, stress a word by writing it in capitals inside the quoted line (one or two words a line; a whole
line in capitals reads as shouting), size the line to a duration the venue sells (end the real line with a full stop and add a throwaway sentence, then cut at the
pause), and LOCK the prompt after the first line so only the quoted words change from clip to clip.

**The linter runs before the gate.** It checks the mechanical rows (slot ranges expand with no double assignment and no gap within the cap; the char cap re-measured
after every edit; negations in the body; all-caps tokens outside the stoplist and outside a quoted line; the venue's moderation words; parameters in the prose; a named
off-frame object; category referents and gait mechanics; beat density; a prompt that repeats a reference's description; single-shot negatives on a long or multi-cut
generation; a per-line prompt that drifted from its locked first line; quality words; grain asked of a still; a negation naming a scene object on the single-stream
engine; the style not first on that engine), and the judgement rows are read by eye. A FAIL on slots or the cap blocks; a WARN is answered in the prompt or the GO ask,
never ignored. A check ships only at zero false positives on a known-good prompt set, and every loosening is replayed against the original defects.

**The no-negative-list rule.** Do not paste a generic quality blacklist. A boilerplate negative fought practical-effects reference photos on one film and had to be
removed, and the negatives are scoped to the generation's LENGTH: a long generation composes its own coverage, so "no hidden splice, no unmotivated cut, no abrupt
push-in" forbids the reason it was generated long, and a cut inside one generation is descriptive while consistency across it is the verdict. On the
single-positive-stream engine a negation that names any scene object draws it, so every prohibition there is rewritten as the wanted positive state.

**When the venue answers wrongly**, diagnose by listing what PASSED first and diffing against what failed, never three hypotheses in a row. An "nsfw" refusal within a
minute is a prompt WORD, not the picture (paraphrase the shape; frame chest-up or knees-down, never the bare-torso waist, which is refused unbilled). A fresh bang at
frame 1 means the prompt described falling pieces ("the room is blanketed, still raining, NO bang"). A widened shot means an off-frame object was named or the camera
could not hold its subjects (write the look, not the thing; bind the camera to one subject or one fixed geometry). The line-deliverer facing the lens is the default
(write the addressee).

---

## 5. The cost gate

Every generation call is production: nothing is bought on a test, and nothing is bought without the operator's explicit GO on a cost line, however small the amount. The
call goes through ONE gated path per venue, so the refs gate, the cost, the receipt and the poller cannot be skipped by hand. Three words: the **GO** (the operator's
yes to a named cost, per batch, never standing), the **receipt** (the venue's job handle persisted the instant it accepts the job, because billing happens at
acceptance, not at fetch), and the **clip** (a landed seed reaches the operator as a file path; the pick is theirs).

**Constraints guide; they never block.** Every house rule, default and ranking shapes a better-informed recommendation and makes its cost visible at the moment of
choosing; it never removes an option. The shape every constraint takes: state the rule, state what departing from it costs as a number where one exists, recommend, then
do what the operator rules. Three things are not constraints in this sense and stay: the cost line and the GO (they block the AGENT from spending the operator's money
unasked, which is the operator's decision point, not a limit on them); a pre-submit refusal that protects a billed call (it becomes a priced warning inside the cost
line, which the GO overrides); and a vendor's own refusal (not yours to relax; report it, name what it cost, route around it).

**The roster is a parameter, not a constant.** The venue table below is one practitioner's measured roster on the accounts they held; you almost certainly hold
different ones, and no rule here requires an account anywhere. What travels is the routing logic, four rules and no vendor names: rank the venues YOU have by MARGINAL
cost (the price of the next second of output, never the headline rate and never the wallet balance; a subscription's true rate is the month's cost divided by the
credits actually burned); prefer pay-as-you-go over plan lock-in at equal cost (spiky client demand penalises a plan twice, a light month expiring credits and a heavy
month buying packs at retail); let FUNDING decide which ranked venue is reachable (where the money sits is a hard constraint; being second or fourth on price is a
premium to quote, never a reason to refuse); and route on CAPABILITY before price where a capability is the job (a real person's likeness, an audio reference that
drives the words, a raster a venue cannot reach).

### The venue table (measured September to October 2026; prices move, re-read before quoting)

A price here is evidence with a date on it, not a constant. Vendors reprice and change moderation without notice. These are the numbers the kit recorded, labelled as of
their date; re-measure before a decision rests on one, and trust the receipt over the arithmetic.

**Video, the one model sold by five routes (480p chain, one model family, measured 2026-09 to -10):**

| route | 480p $/s | 720p $/s | 1080p $/s | real likeness | audio ref | notes |
|---|---|---|---|---|---|---|
| PAYG route A (people-free) | 0.1029 to 0.1039 | 0.2311 | not offered | refused upstream | yes | cheapest at the default raster; flat token rate across rasters, so 720p is pure pixels; references hosted free on its own store |
| PAYG route B (real-likeness) | 0.1186 | 0.2668 | 0.6428 SETTLED (catalog 0.462 is only the reserve, measured 2026-10-02) | yes, a licensed-asset escape | yes | the only row that takes a real person's likeness as a subject reference and a voice clip as the speech reference; 100 percent over 244 observed calls; refunded on failure |
| subscription CLI (now closed) | 0.1213 blended | 0.3153 | 0.45 (9 cr/s) | yes | yes | plan; true rate is month cost over credits burned; keeps the extension-by-job-id handle and 2K local-faces H3 |
| PAYG API (same vendor, separate wallet) | 0.144 (at a dated 30 percent launch discount) | 0.324 | NO 1080p at all | ordinary face accepted, public figure refused | yes (WAV only, no MP3) | places FOURTH of five on price; token-metered with no number returned, so the gate computes the cost; the only route with structurally separate edit and extend endpoints (a misread is impossible by construction) and the cheapest 2K audio-capable engine at 0.0715/s; no cost cap |
| general hosted route (people-free) | 0.2205 | 0.4730 | 1.164 | refused (any photoreal person) | yes | the DEAREST row; completeness, not a route; its reference-to-video carries one task enum for reference/editing/extension with a hard total of 50 files |

The likeness split is PUBLIC-FIGURE vs ORDINARY-PERSON, not venue vs venue: an ordinary person's face is accepted on routes B and the API; a public figure is refused
EVERYWHERE, the licensed-asset flag included (it relaxes the real-face check and leaves a separate upstream content-safety layer in place), and the test to find out
cost $0.00 because a refusal is not charged. The one general hosted route refuses ANY photoreal person. The token formula measured EXACT is W times H times (duration
times fps plus 1), over 1024: the vendor's documented "times fps times seconds" is short by exactly one frame, so a 4 s clip returns 97 frames (4.041667 s), found only
by a measured run. Moderation runs DURING processing on some venues, so a clean submit is the QUEUE, not the verdict (a request sat 65 s before landing a refusal).

**The audio-capable engine (a different look, 768p minimum or 2K):** about 0.06/s at 768p and 0.13/s at 2K on the general hosted route; 0.0715/s at 2K on the PAYG API
(half what the primary model costs at 480p there, but no audio input, 5 to 15 s only, and 0.08 per reference image past the first five). Free per take on a local GPU (a
24 GB card renders a 5 s take at 768x1344 in about 120 s, peak 23.9 GB).

**Creator-style talking heads:** the simple talking head and the hook sweep route to a no-audio-input voicing engine, about 0.52 per 8 s at 720p on the cheaper venue
(fixed 4 / 6 / 8 / 10 s steps) against 0.80 to 1.20 on the fallback (any whole second 3 to 10 s, a 360p draft cheaper); 720p native, about 15 percent of takes stutter
and are regenerated, it INVENTS words so a script-exact mouth needs an audio-driven model or a lipsync pass. Every OTHER shot in the spot (product-in-hand, b-roll, a 30
s story, a pinned voice, a defined move) stays on the primary consistency model. A talking head carrying a LOCKED voice-over generates at 720p with the VO as an audio
reference and delivers through a 1.5x lanczos scale (not a reconstruction); the words must be ABSENT from the prompt (written dialogue beats reference audio and demotes
it to timbre), and the venue is route B for a real likeness or route A people-free.

**Stills:** a default image-to-image model at about 0.05 per 2K still, with a same-price precision tier for a photoreal reference. A hosted reconstructive UPSCALE tier
(per second of output) and a free local reconstructive tier; see the finish section.

**Which venue refuses what:** faces, as above (public figure everywhere; any photoreal person on the one general hosted route; real faces upstream on route A). Specific
moderation is on the prompt WORDS, not pictures (anatomical nouns, "thrusting", a suggestive look described, injury words in slapstick); a bare-torso waist frame or a
headless start image is refused unbilled; all-caps script words trip the refs gate's subject scan. A relaxed content filter is NOT a blanket bypass (it relaxes the
real-face check only). A reference hosting URL refusal (a dead paste host) kills a submission; use the venue's own host.

**The cost line and the GO.** One line per batch: seeds times seconds times rate, the balance before and after, dollars for stills at the model's rate, the free steps
named as free; then wait. The gate table (the refs-gate PASS verbatim) and the resolved reference names in slot order ride above it. Decisions go as numbered plain
questions with the cost and the full path inline. Free before billed is the order of spend: disk (whisper the existing takes for the words, RMS-scan for the onset, cut
a keeper frame as a reference, re-run an edit) then a still (cents) then a seed (tens of credits). Before a re-roll's cost line, read the take ledger (attempts and
picks per shot, the measured keep rate, the stop-rule tripwires): the same flaw on two takes of an unchanged prompt stops the re-rolls and rewrites ONE variable; three
paid attempts on one shot with no budget and no pick goes to the operator as options, not another batch; a declared budget half spent without a pick changes the
strategy, not the wording.

**Receipts at acceptance.** Print the job handle the instant it exists and append it to an append-only ledger BEFORE any polling, so a hard kill still leaves a
recoverable id. Write the raw venue reply verbatim (the reply shape changes: a bare list, a dict with an id, a dict with a job_id; parse shape-safely and keep the
original). Record output dimensions and bytes in the receipt (a hosted model changed resolution mid-session with no signal). Each seed's receipt carries every reference
the call SENT by name with the URL or upload id it went as, so an attachment check can prove after the fact that nothing gated was left behind. COMPLETED is "finished
running", never "succeeded": gate on a file on disk plus a 2xx on the result (one queue accepts any body and validates on the runner, so a bad request reaches COMPLETED
and the result fetch returns 422 or 504). Cost is a receipt, not arithmetic (a billing header arrives on a re-fetch seconds to hours later; arithmetic ran about 10
percent high across ten runs). Never resubmit a billed job; its result persists, re-fetch by id. A refusal is classified from the venue's own record before it is called
free.

**Refunds, hangs, 503s and polling.** A word-moderation refusal within a minute is refunded (resubmit inside the original GO after fixing the words). A
reference-moderation refusal is billed 0 and is not a retry case (change venue or remove the person). A content-safety refusal on the FRAMING, not the subject (disposal
language, pieces at large scale, anatomy-word density) is re-anchored to a legitimate referent and retried ONCE. A 503 on one seed of a batch is resubmitted under a NEW
scene key (the same key clobbers the batch receipts). Two 504s in a row is an outage: stop paying to find out, switch venue on the next GO. A hanging hosted-upscale
submission (no job, no charge) is retried once, then the route switches. Poll DETACHED (one background waiter at a time, never a follow-and-grep that pins a 300 MB
filter process), every path absolute, with a broad exception and a miss budget (a narrow except once killed the script and took a paid task id with it), matching the
completion sentinel anywhere in the line (a pattern anchored on the line start never fires; three landed seeds sat unread for 33 minutes once). Some venues are
fire-and-poll, never a blocking wait (one has a p50 of 245 s and a p95 of 603 s against a 300 s default wait that would time out on a job still billing). A provider
error can arrive as a COMPLETED status with a 404 or 500 and is NOT charged, so read the provider status and the run's own cost before calling a take failed; a reply
with no run id at all is a body the gateway rejected, so no run exists and nothing was billed. A missing completion sentinel is a failure regardless of file size. Disk
is a production resource: a project reached 210 GB and the drive fell to 4.7 GB free, the swap could not grow, and the whole environment crashed; check free space
before a batch and before every finish.

**Mode by what the shot must hold** (a per-SHOT choice, never a house default): a whole continuity partition as one long generation holds best refs-only (the reference
set carries identity, wardrobe, room and look; a start image re-renders the frame it was given, and consistency across a composed cut is free where two joined
generations gamble); a new angle with cast and room carried by references goes refs-only with the proxy's grey frame under the layout-only role; a defined camera move
with an arrival takes a start image plus an end still baked from the proxy; an exact continuation takes the keeper's LAST frame as the start image. Refs-only skips the
one reviewable frame before an expensive take, so when the angle is risky, buy the dress-rehearsal still first.

---

## 6. Take review: continuity first, then the acceptance matrix

A landed seed is read the same day, by the agent, with instruments, and the operator's verdict is the ONLY pick. Four rules above the matrix: report what you SAW, not
the win you hoped for (a take that fixes one defect and introduces a worse one has the worse one as its headline); a whole-frame downscale assesses COMPOSITION only, so
identity, hands, teeth and product are read at 1:1 or larger; every instrument prints a known-answer self-test beside its number, or the number is not evidence; and
evidence is not looking (a take that probes valid and passes every measured row says "container valid, measured rows pass, visual pending" until its frames were read,
and appearance is never inferred from a filename, a prompt, a job history or a probe).

**Continuity FIRST, before the gag.** Against the previous keeper's last state and the established shots, per cut: the door, the seats, counts, what is in whose hands,
wardrobe, set dressing, the cast (each named character once, counted at 2x across the crowd, nobody invented), the pose state, the product's shape at every scale and
its size beside a known object, named states. A geometry break rejects the seed before its gag is judged. A cut the model COMPOSED inside one generation is a
capability, never a defect: the read across it is whether the world survived (the same faces, wardrobe, room, light and performance register either side); never fail a
take for containing a cut, and never grade the cut's motivation. A seam between two generations is a different object, judged at the edit. An instrument measures light,
contrast, white balance and palette across every cut as MULTIPLES of the take's own within-shot baseline (raw values do not separate a composed cut from a splice across
takes; compare multiples inside one take, never raw numbers between takes, and a quiet take's small baseline inflates every multiple).

**The acceptance matrix, a table and never a score.** Each row answered PASS, FAIL or note; a FAIL is never overridden by a good-looking frame; the worst row is the
headline of each seed's line. The rows:

- **script beat** the scripted action IS the action (the verb the script wrote, not the one the model chose); the cause on screen before the reaction; nothing invented.
- **technical** dims, fps, CFR, duration; the internal cut list DESCRIPTIVE and handed to the edit, never a fail.
- **consistency across composed cuts** the same faces, wardrobe, room, light and performance register either side of each cut the model composed; a break on any axis
  FAILS, the cut's presence never does.
- **anatomy** per person in a per-person crop at 3x: two arms, two legs, one head, each hand on an arm, one prop per hand.
- **faces** undistorted; a floor of about 60 px of face height in the take's native pixels (measured at 480p) for any beat the faces carry, which is a FLOOR not a target
  (a face just over it came back under-rendered and was rejected); identity against the character's close shots (a reconstructed face is plausible, not faithful); face
  detail compared only with every crop resampled to one common size, and every detector box confirmed by eye (a cascade returned seven confident false positives on a
  two-shot and missed both real faces).
- **attachment** every reference the take was gated on was SENT to the model (the gate's submission record against the receipt's request record; a path or a name in a
  prompt is not proof the model read the image), and the product is visible and matches its reference.
- **product** shape at 2x (the exact silhouette, haphazard angles, never aligned); proportion by a 4x crop beside the product photo, because the pixel instrument is BLIND
  at 480p (a known 1:4.75 read 1:2.6 at 30 px).
- **composition and eyelines** nobody looks into the lens; the line-deliverer faces the camera, never back-to-camera; each gesture motivated in its framing; the reaction
  faces its cause with the matching emotion; no focus pull off the face; the camera holds its lock (a scale-match of the upper frame between frames, read on the frame
  strip because an edge number reads a global GRADE shift as camera drift).
- **audio** word-like events on an unscripted mouth read as shouting (void); the scripted words intelligible (a near-homophone is a void); a generated tone at the head
  (spectral flatness under 0.3 with a stable peak, and the test is gated by level because codec noise on a clean floor reads perfectly tonal); the hit's RMS peak time.
- **delivery** on a take that SPEAKS, the half the ear cannot judge: the speech span against the duration (over about 0.3 s of tail silence means the model was given more
  seconds than the script fills and RUSHED; head silence is the same defect and the only one cheap to trim); every gap at or over 0.25 s with its time (a 0.7 s hold
  mid-line traces to a full stop in the prompt); the pace in words over the SPAN against the band the genre asks for (230 to 250 wpm is the creator band, a brand read
  sits far below, there is no universal band); and stutter candidates (an adjacent repeat that passes an intelligibility check because generated speech produces it with
  no audio artefact, caught only by a transcript read). A throwaway tail added to size a line to a venue's duration step is not the performance.
- **named state** every frame of every window after the event, wides included, at 4x with the gamma lifted in dark cavities (a sparse sample passes defects that every
  frame at 4x shows).
- **dignity** awake; nobody touched unless the script does it; nobody left lying under an effect; hands high, visible, held; no hand at the bottom edge of a chest-up
  two-shot. The brand's standards and the genre's tone set the bar.
- **realism** natural poses; dance not jerky; no phantom extra; the runner seen from behind; the subject still in the last frame; on a creator-style take the tells pass
  (sound off first, hands on the product, a torso static over 6 to 7 s, consonant lip drift, the product morphing between shots, background warp, a phone or camera UI in
  frame).

**Reading at zoom, by image purpose.** A review image is written for what it is FOR, and its bytes are paid in every request a session replays (two sessions died on a
length-limit error at about half their compaction trigger, carrying 37 lossless full frames). A VERDICT image (skin, identity, hands, teeth, a garment, a named state)
is a crop of the thing judged at native size or larger, high-quality 4:4:4, NEVER downscaled and with no dimension cap. A SURVEY image (the continuity sheet, the 1 fps
tile, a contact or cut sheet) is whole frames read for layout, mid-quality, and may be downscaled because composition survives it. A GENERATOR INPUT (a start image, a
plate, a reference) stays lossless, never recompressed.

**Voids and usable windows.** A seed that fails a hard row is VOID with its reason in the ledger, never reused; the same realism failure across several seeds of ONE
reference is a REFERENCE void (rebuild and re-accept the reference before the next seed). A keeper is a take plus a WINDOW: in and out set from the read ("only from 1/3
in, as they snap to"; "cut before the teeth show"; "only the first 0.9 s"), the out-point at least one frame before the take's own internal cut, with the state at the
window's end recorded; a window whose last frame hides the face cannot be continued by a gen, and that is said now. A void names whether the next take is a re-roll at
all (the same flaw on two takes stops the re-rolls; a shot at three paid attempts with no pick and no budget goes to the operator as options).

**Residual doubts travel with frame times, never as a re-roll question.** Once the budget is final, a seed that meets every named constraint goes forward, and a
residual doubt (a wedding band at 2.4 to 3.3 s, a fleck on the lamp at 4.1 to 4.6 s) goes into the delivery note with its frame time, not "approve or re-roll for the
fleck?" The headline is the worst row, never the best; "not bad" from the operator is not a pick, wait for the path. When the operator names a defect, locate it on
THEIR frame first (a frame-match against the take windows), confirm the person and the event, and only then act. When the operator says they see it in motion, they see
it.

An instrument that cannot detect the defect is reported as BROKEN, not as a number (a scale metric once matched a frame to itself at 0.90x and had already been used to
make claims). A self-test that fails is worked by hand first, because the known answer may be the thing that is wrong (a colourfulness test expected over 100 for pure
red, whose true value is 85.53; the instrument was right). A reduced render reads motion loose; the delivered frames are the verdict (48 of 48 shots passed a
sustained-action check on half-resolution previews and 11 failed on the delivered frames). Prove a query before believing an empty result (a broken cut-map query reads
exactly like an absence). Texture compares only between matched-motion windows. Record a withdrawn or refuted finding beside the finding, so the next session does not
inherit it.

---

## 7. The edit as a derived EDL

The edit is a DERIVED document: the client script is the single source of truth, the keepers are the operator's picks, and a builder computes every timeline number from
them, so re-running the same plan reproduces the same EDL and an editorial note becomes a change to the plan rather than a hand edit of a time. A typed time is a defect
waiting for the next re-version; a hand edit to a shipped EDL is a lost audit trail. The finisher reads nothing but this file.

**The beat list comes first, from the script.** One beat per script line or stage direction, in script order, each naming the EDL events that will realise it, the VO
and sfx inside it, the order rules, the marker a line must clear, the cue edges on a marker, a layer's lead before the next beat, a minimum duration, and the forbidden
ids with the operator's reason. Markers are measured on the keeper, never guessed. The gate fails a non-optional beat with a missing event, beats out of script order, a
VO or sfx outside its beat's span, an order rule violated, a VO not ending before its marker, a cue edge off its marker, a placed line no beat claims, and an EDL event
no beat claims (an invented beat).

**Placement by derivation.** A keeper is a take plus in, out and the state at out, the out-point at least one frame before the take's own next internal cut. The builder
accumulates the timeline from the ordered events and resolves every audio and layer time from a REFERENCE (a marker, an event edge, another line's edge): "12.5" only
for a measured absolute; "start" / "end"; a marker name; an event's timeline start or end; a marker plus an offset; a take time inside an event; "this line ENDS 0.5 s
before the hit, floored to the frame"; "this line ends 0.1 s before L0 starts" (the narrator chain derived BACKWARDS from the hit); "this entry starts 0.3 s after L1
ends". Every per-frame plan is sampled on the shot's real frame times (0 to (n-1)/fps), never across its playing duration, because a key placed at the duration lands
one frame past the last image. A number the plan MEASURED from files carries a block with its inputs' hashes, and the build FAILS when an input changed since the number
was derived. Every event carries the seek convention: a full-take hero needs the handle set to the in-point, and a seek between frames ahead of an fps filter doubles
the first frame whenever the next frame starts more than half a frame later (14 of 22 events shipped one frame late once), closed by resetting the presentation
timestamps before the fps filter.

**Sound from picture markers.** The operator gives placement as word-times-event (a word at a timeline second; a line during an event; a line ending just before the
sign-off sfx; a quip's halves on setup and payoff), and each becomes a reference. An off-screen line sits at its take time. A dub (a line the venue refused) sits on the
take's mouth shape, the native muted from the onset. Carried sound is cut FROM the take at the cut frame and placed as an sfx at the next event (a word's tail over the
next shot, a tear across the cut). A lip-synced line (the picture generated to that voice) sits where the take's own audio says, by envelope correlation, and is
RE-MEASURED whenever its file changes (a cleaner render sat 0.54 s later than the file it replaced, and the carried number would have dubbed the shot). Music is cut to
the marker it ends on (a cue shorter than its span just ends, which the checker fails, so loop a short bed by whole bars on its own beat grid or cut a longer excerpt);
a cue slams in ON the reveal marker, not on the cut before it; a bed runs under the turntable and the card; ducks under lines with ramps; no bed under the hit.

**The script-fidelity gate before any finish.** The beat gate exits non-zero on any FAIL and no finish runs on a FAIL; a structural check fails any window crossing its
take's own scene cut except a cut the event DECLARES as accepted (which prints as INFO, because a gate that fails a chosen keeper on every render teaches every reader
to skip its verdict). An A/V-sync regression suite gates any change to the cut path (off-grid cuts, the take's own audio, a late track, missing packets, VO placement,
read back from the decoded output; its first run failed the finisher of the day on all five fixtures).

**Notes as parameter changes to a NEW version.** A note from the operator or the client is applied as a change to the plan or a builder flag, and the result is a NEW
EDL file; the previous version stands byte-identical. Locate first, then cut: operator-marked frames ARE the cut (match them to the take, cut that clip at those frames,
no re-derivation); a trim is the window on the frame; "cut before the heads swivel" is the last still frame by motion energy. The repair ladder before any regen: drop a
bad short shot, swap a shot from an older version, lengthen or shorten a window, a hybrid EDL mixing a new take's cuts with the keepers, a punch-in to keep the wrong
thing out of frame, a placed sfx for a lost sound, and only then a regen with the approved cut frozen. An alternate deliverable is its own EDL with its own audio map
and captions.

**The genre switch.** Ads: hook inside the first 2 s, setup, the reveal on a marker, the product beat, the turntable with the closer 0.7 s in, the end card at 2.5 s
full with the audio signature at plus 0.02; a capper spot copies the delivered spots' events into a montage windowed on the disclaimer's word times. The UGC sub-genre:
the hook on the FIRST frame legible with the sound off, the problem in her words, the demo with REAL proof composited at about 8 to 12 s of a 30 s spot, the offer and
disclosure in the last 3 to 5 s; no music under the open, no card unless briefed, the disclosure is a beat never cut or ducked over, and alternates are the variant
matrix (one axis per EDL). Film: 16:9, no captions, no card, no narrator explaining the mystery; the beat list IS the beat sheet with the self-revelation at 90 percent;
build outward from the hero shot; the mix crests WITH the push-in. Music video: the track map allocates the whole timeline first (BPM, bar, the hits everything cuts to,
measured and CHECKED, never read off a tracker's tempo number); later beats pay by trimming; the edit is locked before finishing and the master carries the cut's own
processed audio.

---

## 8. Sound assembly

Sound is built from the picture and paid for by the character, the minute and the generation, so every voice, sound and cue arrives through a cost line and the
operator's GO, lands under a stable name that is never regenerated by accident, and is placed by a reference the edit holds. The operator's ear is the pick; the
instruments locate, they do not decide.

**Voice takes: one voice and one model per role.** The narrator is ONE voice id chosen by the operator and rendered with ONE model for the campaign's whole life,
because another model renders the same voice id with a different timbre; identity across regenerations is audited BY EAR (same id, same model, same settings, a seed
when pinned). A distinct voice for every other speaking role. Render three takes per line into a NAMED reel with an index, and the operator picks by ORDINAL from the
named file ("not bad" is not a pick). Steer the reading without speaking it: previous and next context (slang reads as another language without it), phonetic spelling,
a spelling spread across the takes. Every placed line records its SOURCE (a TTS job id, a clone id, or extracted-from a path and time) and its gap floor; the stem
builder refuses a line whose quietest tenth sits above the floor (about -40 dBFS by default, measured on one job), because a line lifted out of a finished cut carries
that cut's music bed between its words and every placement instrument then validates the file against itself.

**Dubs for refused lines.** A line the venue refused for moderation is dubbed in that character's OWN cloned voice (an instant clone from the character's take lines,
every sample long enough; the shot prompted with a similar-mouth word; the real line rendered by the clone and placed on the mouth shape, the native muted from the
onset). A real person's voice as a clone is likeness exposure, stated once. The clone id is recorded and reused.

**Off-screen lines.** An off-screen line is NEVER the narrator (the client hears the narrator asking a question that belongs to the character behind the door): a
distinct shared-library voice picked against the client's brief, given a door treatment (a high-pass, a low-pass, a short boxy echo, a small gain lift).

**Sfx with a syllable map.** The ladder is the take's own sound first (cut at the frame, placed as an sfx, the native muted where it played), then a library sound with
its licence line read, then generated sound last through the cost line. A pick from a reel is confirmed as a SYLLABLE MAP before anything is cut (which onsets, in which
order, the bitten-off one excluded), read back to the operator and confirmed. VO never overlaps an sfx. A tick train under speech is swapped, not patched (eight ticks
across half a second survive every local repair; replace the moment, audio AND picture). Speech over a vehicle, a crowd or wind takes a speech-enhancement model first,
a separator second, spectral denoise third (measured on one line: 2.8 dB to 14.3 dB SNR with the words intact); clean the WHOLE take segment, never the excerpt, so the
background does not return at the next cut, then re-measure the cleaned excerpt.

**Music cues cut to markers with ducks.** The default music route is async, returns two takes a call behind a cost line and a GO; the operator's own candidates and a
library bed are fallbacks that need permission first. A cue is CUT to the marker it must end on from the head of the candidate (the file name carries the length); a cue
that must slam in starts ON the reveal marker with no fade; a bed under the turntable and card runs to the end; ducks are timeline seconds under a line with ramps
(about -12 dB under a disclaimer, -6 under a dub or shout, -10 under the closer); the hit's own shot carries only native sound, no bed. A cue shorter than its span is
looped on its own beat grid by whole bars (the take's ending kept, its hit moved by exactly the jump), the grid CHECKED (a least-squares line through the tracked beats,
accepted only within 15 ms and 10 ms of kick drift, its phase from the kicks because a tracker locking onto off-beat hats put a synthetic grid half a beat off); a tempo
that moves loops on the tracked beats. Transcode any compressed music download to a clean WAV before anything reads it.

**Room tone.** A generated tone or drone, a click where a cut truncates a sound, or a line a reused clip must not carry is muted by a window in the EDL and the hole is
filled with SYNTHESIZED room tone (a clean sibling slice colours independent noise over the whole length), never a pasted slice (it carries the take's artifacts) and
never digital silence (the drop from room fuzz to nothing is audible).

**Captions.** The narrator's lines only, as word ranges, NEVER punctuation (contractions keep the apostrophe, hyphenated compounds split into two words), the spoken
word highlighted in the brand colour, centred clear of the platform UI, never over the card and never two cards on one frame. The DISPLAY text is the script's and the
TIMING is the transcript's, and script word i pairs with time i only when the two counts agree (a transcript's capitalisation is not the client's copy). Card line
breaks come from the font's measured advance, never a character count; card boundaries are half-open (an inclusive-both-ends switch composited two layers on the frame
that lands on the boundary, and an epsilon trim trades that for a blank frame about one time in twenty). A swapped VO take re-runs the word times for THAT line only so
hand patches on the others survive.

**The stem.** Every entry with a file is placed on a silent 48 kHz stem at its EDL time, gained to the target with a per-line peak cap, by sample placement (no
filtergraph timing drift), and rebuilt from the EDL on every master (a stale stem once shipped a line at its previous version's time). An initial-letter filter once
dropped the off-screen line, so the builder places EVERY entry with a file.

**Loudness targets.** The master is a STATIC sum, no loudness processing, because a single-pass normaliser is dynamic by definition and rides the programme (the bed
swells in every gap between lines), a ride every later stage inherits and a listener hears as a second element washing in and out. The finisher sets the level ONCE at
delivery: measure the master, apply ONE static gain to the target, and limit at 192 kHz BEFORE the resample to 48 kHz and again after it. That order is measured, not
assumed: a limiter only AFTER the resample delivered a true peak a full decibel hotter than the target, only before held it, both held it. The target is the client
reference's own measured integrated loudness when there is one (they approved that level), else the house -14 LUFS. The master's true-peak ceiling sits UNDER the
platform ceiling by at least the AAC overshoot (measured 0.4 to 1.0 dB, growing with how hard the limiter works), re-measured after any premix change. The finisher
prints the limiting the target costs and the loudest limiting-free target before the render is heard. Verification is on the DELIVERED file, per metric with its label
(duration, integrated loudness and LRA within tolerance and FINITE, true peak under the ceiling, placement by ENVELOPE correlation within 15 ms because a waveform
correlation reads near zero under loudnorm plus AAC), per channel never a mono sum. For a standalone finished mix, a loudness master targets -14 LUFS for streaming with
a -1 dBTP ceiling (presets range -9 to -16).

The phone-mic register follows the capture device the frame shows: a clip-on or headphone mic earns a clean close voice with the room low; a bare phone at arm's length
earns the room-tone bed, a phone-mic band (a high-pass near 90 Hz, a soft roll-off above about 7.5 kHz), a light auto-gain feel and no noise reduction. Disfluencies are
PLACED, not cleaned (2 to 4 per 30 s, one in the first sentence). A generator that speaks on its own clock is dubbed and RETIMED whenever a VO is locked (fit a linear
map on the matched words, then a pitch-preserving tempo change and a delay; one engine's mouth ran about 1.1x slow and started about 0.75 s late).

---

## 9. Designed elements

Two families share nothing: generated motion (stochastic, GPU, expensive) and designed motion (deterministic, CPU, code-rendered, infinitely revisable). Designed
elements are the second, fenced from the first. The whole game is craft and design-system fidelity; the whole discipline is FIX AT THE SOURCE, CHECK ON THE DELIVERED
FRAME, ONE VARIABLE PER ROUND.

**What is designed.** Anything that must be exact: packaging and product (a generator printed "WARNIGY"), the wordmark and the card, the product's pieces as sprites, a
display with names, a wall or a drift that must straddle a cut at a known frame. Anything that must be alive is generated. The two meet only where the operator has
accepted a composite on a plate, NEVER as a 2D overlay on generated motion. Every on-screen word has a named source (the client's text, a line heard in the footage, or
the CTA); an internal label, a placeholder or a concept name never prints (a shipped frame once read the concept's working title).

**Drawn in code, never generated.** Each element is an HTML composition rendered deterministically through headless browser from LOCAL assets with a seeded random
source, so a "fix one thing" round changes one thing. The composition is a pure function of time: one paused timeline drives everything, canvas work reads a tweened
progress object never a wall clock, anything that flows is a tweened DISTANCE never an accumulation (a per-frame accumulation depends on how many frames happened, so a
scrub lands elsewhere than a playthrough and two render workers seam). A large 2D canvas is opened with the read-frequently flag or its first frame per worker differs
from the same frame drawn mid-sequence. A seek waits two frames and seeks again before a capture (a screenshot straight after setting the time is one tick stale), and
the update callback is called explicitly after the seek (pausing suppresses it). A determinism proof reads the script for clock and random readers AND renders twice at
different worker splits comparing every frame (the script read cannot see an accumulation; only the two-render proof can).

**Inserts drawn in code, fixed at the source by measurement.** A residual defect (a notch, a speck, a crop line) is repainted IN THE ASSET by measurement (a circle fit
through the clean edge), never hidden by layout. A label's straight edge bakes into every element made from it as a run of opaque pixels that reads as a black strip, so
the asset is cut clean at the source or bled off the frame, never bordered. Missing art is completed at the source or bled off the frame, never extrapolated (three
rounds of extrapolated burst tips were rejected on sight). A keyed cut-out's blacks are HOLES that go translucent over any other layer, so alpha is forced opaque inside
a matte closed around the coloured body. Alignment is MEASURED, not eyeballed; layering is the operator's call on sight; one variable changes per round; after failed
rounds, revert to the accepted version and ask what specifically is wrong, candidates side by side.

**Composition drivers, written as numbers beside the bans** (a kit that lists only bans passes on the discipline and loses the taste; two films matched on
motion-per-frame and glow area and the worse one differed only in hero size and time-with-nothing-big): one hero per scene at least a third of the content box's height,
three size tiers and no fourth, light on the hero only (one focus highlight per frame, the glow out before the element exits), one or two set pieces a chapter
choreographed as relative times, an empty frame is nothing reaching a fifth of the box for over 1.5 s, and idle motion has a floor not just a ceiling (about 22 to 28 px
over 1.3 to 1.8 s, plus about 1.5 degrees of rotation and a slow 1 to 1.06 scale, each object on its own phase). Type has a floor per ROLE (body and captions about 44
px on a 1080 stage, labels 34, nothing below 30 ever), and a safe-area group scale multiplies every floor by its reciprocal, so size the type at floor over the scale
BEFORE the wrap. Joins are written on BOTH sides (an exit reaches zero before the cut, a scene's first elements start on frame 1; an in and an out are not the same
length, an entrance slow and firm, an exit quick). A counter's intermediate values are on-screen claims (keep the whole roll unreadable or do not count).

**Fixed at the source by measurement, verified on the DELIVERED frame.** The render is not the artefact; the delivered frame is. After the finish, read the element in
the deliverable at 1:1 and 4x (the card's edges, the wordmark's notches, the wall's coverage across the join, the pieces' legibility with no sprite below about 40 px at
a 2160-wide raster). A fix checked on the card render while the delivered frame keeps the defect is a rejected round (a dozen card variants were rejected in a row when
the fix was verified on the wrong artefact). A composition that sets text is read at the SOURCE too (every string it can put on screen against the approved copy,
because a counter's intermediate or a label on a transition shows between sampled frames and nowhere else); a composition with three or more scenes has its STRUCTURE
read at the source (scenes switched by opacity with nothing moving the world, a kicker-title-body stack, scale as the only animation, one kind of transition at every
cut all read as a slide deck). The composition carries the sound sync constant (the burst at its offset, found by correlation against the render and verified by region
brightness on the delivered frame); when the sound moves, the constant moves, never the sound.

---

## 10. Finish and QC

The order is the skill. Nothing in the finishing chain commutes, and every rule exists because a different order destroys something you paid for:

```
upscale  ->  grade (LUT then film-emulation)  ->  grain  ->  watermark  ->  downscale  ->  encode
```

Grade before the upscale and the reconstructor rebuilds your halation as photographed detail. Grain at delivery resolution and the encoder discards it. Watermark before
the upscale and it gets sharpened into artefacts.

**Upscale tiers and when.** The decision that dominates: does this source need detail RECONSTRUCTED or only ENLARGED? AI-generated, heavily compressed or below 720p
needs the RECONSTRUCTIVE tier (the model invents detail softer than capture, which is the feature that separates upscaled 480p from a natively-rendered 1080p frame's
hard edges; a faithful upscaler on 480p produces enlarged 480p at any price, which is choosing not to do the technique). A clean capture already at or above the
delivery raster is a FAITHFUL tier, far cheaper, and a capture already at the delivery raster with no grain on the deliverable gets NO upscaler at all, only a
mathematical lanczos resample to the true display shape (an anamorphic clip stored 1920x1080 becomes 1080x1920). Within the reconstructive tier the pick is PER SHOT
from the FRAMING: a free local reconstructive pass by default (the cleanest arm, least flat-area noise and flicker, and its output is the review copy), and a billed
hosted diffusion pass FROM THE ORIGINAL TAKE for any shot whose faces sit too small for the generator to have drawn them (a head under about 50 px tall in a 480x854
take, so any full-body wide) or whose text must read. The hosted pass does NOT stack on the local one (both start from the take). Measured on two wides: the faces' edge
energy rose two to five times and glasses, hair and chart bars became objects; cost about $2.60 for two 5 s clips at 4x, and the delivered file grew 31.1 to 36.8 MB at
the same quality because there was now detail to encode. Two checks on every hosted shot: identity across cuts (a small face is reconstructed PLAUSIBLY, not faithfully)
and invented small text (a corridor door sign grew fake lettering). A talking head with a locked VO generated at 720p takes a 1.5x lanczos, not a reconstruction,
because the operator judged the raw better than the reconstructed version at that raster. Smoke-test one second before committing hours (does the model exist in this
install, does the container decode, which encoder wins, seconds per frame on THIS aspect ratio, because a benchmark does not carry across aspect).

**Normalise per shot, before the look.** A LUT or a film-emulation grade is the GRADE step and assumes normalised input (the library look alone read pale on flat
overcast footage beside a hand-normalised chain). Per shot, in 16-bit: the 0.5/99.5 luma percentiles mapped to about 0.02/0.88 (black point kept under 0.30, white over
0.70, the stretch capped so it is a normalise and not a creative contrast push), and a saturation factor to the chroma of footage the operator approved (the
film-emulation hero lands about 27 percent less saturated than a cube's estimate). The flat is 10-bit, tagged, and starts at presentation time 0 (a flat starting at
0.041 s made the grader render one extra leading frame).

**The hero pass.** An authored film-emulation grade applied to each upscaled or normalised clip in a colour tool, ONE clip per call over a transport the human starts,
writing a 10-bit mezzanine that is PROBED rather than trusted. Two tiers must not overlap: a 3D LUT (a cube) carries per-pixel colour only (white balance, tone curve,
contrast, split-tone, saturation, black point, the film-stock transform); a film-emulation grade carries the spatial and temporal physics a LUT cannot (halation, bloom,
grain, gate weave), and the two are PARALLEL renderers of one look, never stacked (one or the other owns the stock transform, or you emulate twice). On AI-generated
footage set the emulation's input to the display colour space, never a log profile (generated video is display-referred already; a log input applies an inverse
transform that never existed and wrecks the black point, the single commonest mistake). Choose a look by RENDERING it on a frame that spans the tonal range (backlit
haze, a textured subject, a saturated colour, a deep shadow in one frame), never by its name (the look one project's notes recorded as intended crushed the foreground
subject to near-silhouette, discarding the fur detail a 135-minute upscale existed to create). Push contrast, not chroma (4:2:0 blocks up saturated reds and blues). A
grade note is diagnosed per shot before any global move (a spot called unreal measured healthy contrast and black levels, its defect in shot-to-shot INCONSISTENCY, and
a global saturation lift would have pushed the worst shot further out). Verify the mezzanine is 10-bit by PROBE (a codec name does not tell you its bit depth; a request
for 10 bits can succeed and silently give 8), and check the geometry (some intermediates pad width to a macroblock multiple, so carry a crop on the deliver leg or the
aspect ships wrong).

**Grain, coarse or not at all.** Grain is a bitrate tax of 50 to 120 percent at the same quality. Skip it entirely for a 2.5 Mbps-class rendition (it doubles the master
and then does not exist: fine per-pixel grain returns to within 1 to 3 percent of no grain after a 2.5 to 5 Mbps re-encode). Above that, apply COARSE grain (2 px or
more, which keeps roughly a third of its energy), and only on a mezzanine ABOVE delivery resolution (80 percent survives a 5 Mbps rendition from an above-delivery
mezzanine, 28 percent from a 1:1 one). Check whether the GRADE already applied grain before adding any (a film-emulation preset typically carries grain, halation and
bloom in the same node as the stock transform, so a "remaining grain step" doubles it; verify against a 1:1 crop of the picture, never by grepping the grade file, whose
parameters are stored encoded). One pro-compression use survives: a whisper of grain dithers the banding on smooth gradients (fog, mist, sky, steam) under 8-bit
delivery.

**The phone-native finish tier INVERTS two of these rules.** A creator-style spot that must read as phone-shot gets a near-identity colour cube (no film stock, no
split-tone), NO film-emulation pass at all (halation, bloom and film grain read as film, and a phone has none), and a temporal layer AT DELIVERY resolution: fine
sensor-style noise OR a denoise (the probe decides the direction), a slow exposure drift, a stepped white-balance drift, an exposure jump at each cut, one to three
pixels of handheld shake, and a phone-class encode (H.264 4:2:0, a closed GOP, display-space tags, 2.5 to 12 Mbps). The dose is decided by a PROBE against the project's
own real phone clips (dead-flat 8x8 share, noise floor, median block spread, on native centre crops at five points), as a matched-content comparison against the RANGE
over every reference frame, never a threshold. The calibration overturned the premise: two real phone clips as they arrived through a 2.5 Mbps re-encode read a noise
floor of 0.1 to 0.7 with some dead-flat blocks, while three raw 720p generated takes read 1.8 to 2.0 and no dead-flat blocks at all, so the generated take carried MORE
fine texture than the phone clips, and the dose that landed it inside the band was a DENOISE and a 2.5 Mbps encode, not grain. On another generator or another set of
real clips the direction can reverse.

**The hero pass, film look, grain and watermark ORDER.** Watermark LAST, on the final master, after the grade and the grain (the reconstructor treats a mark before the
upscale as photographic content and rebuilds it; the grade bleeds halation out of a mark placed before it). Overlay the mark AFTER the downscale, not before
(compositing at mezzanine resolution and then downscaling resamples the hard edges a graphic depends on). Crop the logo to its opaque bounding box before sizing it (an
exported logo sits inside a larger transparent canvas, so margins measured from the canvas push it off the corner). Archive an un-watermarked master clean. Scale the
mark as a constant fraction of frame width per variant, never in absolute pixels. Verify the mark at several timecodes, never just the first frame.

**The delivery encode.** From the graded mezzanine, downscaling in the same pass. The house spot deliverable is H.264 High, quality 17, AAC 192 kbps, 8-bit 4:2:0,
progressive, constant frame rate at the EDL's rate, display-space tags, no HDR, the moov atom first; every intermediate is 10-bit 4:2:2 and the deliverable is the only
8-bit 4:2:0 file; masters are 1080p only. Never build a variant by re-encoding a finished deliverable; go back to the graded mezzanine (re-encoding puts the grain
through compression twice). A hard byte cap is a different problem: two-pass at an explicit bitrate derived from the cap (cap bytes times 8 over duration minus audio
minus about 0.5 percent muxing overhead), aimed about 6 percent under the stated cap because "50 MB" may mean 50,000,000 or 52,428,800 bytes; below about 2.5 Mbps
DENOISE before encoding and spend the bits on the image; use the film tune that eases deblocking, never the grain tune that spends bitrate the cap does not have; ship
H.264 for inline playback unless a newer codec's support is known. Upload a platform's work one tier ABOVE the viewing resolution where it helps (1440p so the richer
transcode ladder serves 1080p with the grain intact). A hand deploy once shipped a week-old git-ignored render folder over the current work, so check the dates of
anything not in version control before any publish.

**The one-pass QC reads the DELIVERED file, per metric with its label, never a total score.** Duration against the EDL (under 50 ms). Integrated loudness within
tolerance and FINITE and true peak under the platform ceiling (an audio-stream check is not a SOUND check: a conforming track at minus infinity ships silent). The AAC
packet clock (every packet one frame and every start one frame after the last, because a timestamp jump before the encoder is written as one overlong packet and every
later packet plays late). The delivered cut list against the EDL joins, every extra detection NAMED. Take-cut leaks (a hero window crossing its take's own scene cut; a
cut the take composed and the operator kept is declared on the event and prints as INFO). Near-black per event (all three sampled frames under 16/255 FAILS unless
declared, the row that catches a source type the grade turned black). The end card by correlation. VO placement by envelope correlation. The longest still run against
the declared limit. The source geometry of every hero take as INFO (a display shape unlike the storage shape is normalised before any crop). Against the PREVIOUS
version, every footage event's middle frame read as regraded, moved (a crop, scale or warp) or retimed (a one-frame slip). Format rows (frame, codec, colour tags, CFR,
faststart, audio format) are mechanically fixable and the agent fixes them alone; judgement rows (duration, loudness, cuts, leaks, black frames, the card, placement)
change the content and go to the operator with the number. Then the EYE and the EAR at several timecodes over light and dark backgrounds (never the first frame alone):
the grade at zoom, the mouth check on the wides, the audio at every cut and hit, the captions against the VO. Every comparison instrument carries a known-answer case in
the same invocation (a file against itself must return infinity; a quiet-log suppresses the result line and an empty result reads as "identical"). Anything found goes
back to the EDL or the hero, never to a gain nudge or a re-encode of the deliverable. A plan step earns a cheap verification immediately before it runs (two of five
finish steps were wrong and both would have shipped invisibly: "coarse grain then watermark" when the emulation already laid grain, and "re-lay the real music track"
when the edit's audio was not a clean slice of it, a correlation of 0.146 against a 1.0 self-test). A repair is judged by OUTCOME on the picture, never by the metric
that motivated it (two VO-retime repairs measured better and were rejected on sight as dropped frames, and the UNREPAIRED takes were accepted).

**Platform recompression.** The platform re-encodes both the real and the generated upload, so the band that matters for a phone-native spot is the one AFTER that
transcode, and grain only survives if it was coarse and on an above-delivery mezzanine. Folklore is answered by a lookup before an encode changes (a "custom bitrate
forces the highest resolution" claim was false; the platform re-encodes everything to a 1080p ceiling). A finished file served under a platform's size limit is served
essentially as-is and validates the encode choices, but says nothing about surviving a transcode ladder, which is a separate measurement.

---

## 11. Hard-won failures and what each cost (the field notes)

Every line below is a measured or dated lesson the kit records, collected so the next practitioner does not pay for it again.

- A rejected deliverable run through scene detection rebuilt the previous producer's segmentation with the authority of a measurement; a prior cut is evidence about
  defects, never a source of structure.
- 11 of 17 vertical client clips stored anamorphically were read as square pixels and every render stretched them 3.16x wide; probe the DISPLAY shape before any crop.
- A pack conformed same-speed to the canvas rate and its originals deleted lost every wide pan to a roughly 30 px stutter; the double step is what a viewer sees, and the
  originals stay until the cut is locked.
- 27 files de-duplicated to 17 (10 were download copies) then 5 camera routes; count a pack after hashing, and it is routes, not files.
- A fresh still of "the same room" for the next shot made a new world; three seeds of it were a rejected round.
- A sibling's three-panel sheet passed for its LAYOUT transferred its whole design and converged three characters into one; the role line is the only thing that separates
  a layout from a design.
- An absolute coat colour held in a bright frame and failed in a shaded one (grey-silver came back dark brown), and the character who threw could no longer be the one who
  caught; state colour relative and bounded on both sides when the frame is dark.
- "Not a <the wrong animal>" did nothing twice against a dominant prior; only removing the scene the prior completes works, and a species comes from a reference sheet,
  never from text (six paid rolls returned the same real animal against every negative).
- Four gens chained frame-to-frame for one action held geometry at every join and still read as a stitch; a 12 s take at 30 credits replaced four 5-to-6 s gens at about
  52 and deleted three joins.
- Ten of twelve prompts cited look plates that had been written but never entered into the job document, so no generation leg ever saw them and nothing reported them
  missing.
- A bulk rewrite left the strongest size cue ("real mass and gravity on the boulder") in the one clause that was physics, not storyboard, because it was never reread;
  never find-and-replace a domain noun.
- A review script picked a superseded plate because its hash sorts after the current one's; alphabetical order has nothing to do with time.
- A "both boards are WRONG" note outlived the re-roll that fixed it by six hours, had the operator authorise a regeneration of an asset that was already correct, and
  reversed the two variants' merits; the document stored a verdict where it should store a measurement.
- "No head bounce" in the body rendered a bounce; "THEY DO NOT MOVE IN UNISON" rendered unison; "Nothing lumbers" rode in every lumbering take; prohibitions go in the
  tail.
- "His bag on the carpet (below the frame)" three times pulled the camera back and invented a handbag (20 credits); never name an off-frame object.
- Anatomical nouns and "thrusting" tripped a refusal on a whole batch; a bare-torso waist frame and a headless start image were refused unbilled.
- A 20 s refs-only generation carried a single-shot negative tail inherited from 4-to-6 s prompts, forbidding the coverage the long take existed to compose.
- Nine expression beats in one 7 s close-up averaged into a still face (37 to 42 dB); the same beats as three 2-to-3 s shots landed every one (22 to 23 dB).
- A camera-motion role sentence left in with its proxy clip DROPPED drew a floor grid and cyan markers on every take (the single-stream engine reads a negation that names
  a concrete thing as an instruction to draw it).
- A still caught mid-word opened a silent subject on a mouth flap (0.31 against 0.19 with the mouth closed); a quiet shot written as an absence left invented speech in 2
  of 6 takes against 0 of 6 with a named room tone.
- Reducing the step count measured better on every VIDEO instrument and degraded the AUDIO stream monotonically (3.6x artifact energy at three steps, clipping at full
  scale); a video-only measurement cannot clear a joint audio-video model.
- A stock frontal-face detector returned a confident false positive on a subject's trousers and a fireplace tool-set and the SAME wrong box on every arm, so reusing "the
  detected box" reproduced the error and looked like agreement; confirm every box by eye.
- An edge-strip "camera hold" read a global GRADE shift as camera drift; a Laplacian "detail" number was INVERTED by an overlay artifact (448 against a clean 379); a
  frame-0 correlation stayed 0.98 with a grid drawn over the correctly-reconstructed frame.
- Two review sessions died on a length-limit error at about half their compaction trigger, carrying 37 lossless full frames; images are cheap in tokens and large in
  bytes.
- An in-point at a half-frame quantised to a rounding tie in the builder's fps filter and doubled the first frame of 14 of 22 events one frame late, which every per-hero
  check passed and only the finished-vs-previous read caught; the approved version's own four doubled first frames read the same way.
- An initial-letter filter dropped the off-screen line from the stem; a stale stem shipped a line at its previous version's time.
- A VO lifted from a finished cut carried its bed between every line, so the music appeared exactly when the voice did and muting the events' native audio changed
  nothing.
- An inclusive-both-ends caption switch composited two layers on the boundary frame, and an epsilon trim traded that for a blank frame about one time in twenty; the
  half-open form is the only fix.
- A label asset's straight cut edge baked a run of 211 opaque pixels into every element made from it and read as a black strip; three rounds of extrapolated burst tips
  were rejected on sight.
- A per-frame accumulation in a composition rendered a seam at every worker split and a different one at a different worker count; the script read saw nothing, only the
  two-render proof did.
- A grade file grepped for "grain" and "halation" found nothing on a grade that demonstrably carried both (the parameters are stored encoded); render it and look at a 1:1
  crop.
- Render codecs addressed by display name returned an empty list that looked exactly like a licence-gated free edition; they are addressed by extension (0 codecs by key,
  60 by extension on one format).
- A 10-bit request to one encoder silently gave 8 bits; one 10-bit intermediate codec padded the width 3416 to 3424 and the aspect would have shipped wrong without a crop.
- A grade pass that already emitted PCM audio was the best copy of a mix made in the tool; re-laying the raw music track (correlation 0.146 against a 1.0 self-test) would
  have replaced the processed mix with the raw track.
- A client's "a bit of VO at the very start" was the subject's own spoken filler between two runs, and a fix made from word times trimmed a number instead; locate a sound
  note by transcribing the DELIVERED file at that timecode before anything moves.
- Five fixes that each constrained one defect all landed and the piece lost its design (the brand system, each spot's hook, the concept's device); every note set names
  what to KEEP.
- A quieter premix pushed the limiter harder and the AAC overshoot grew (a -1.5 target delivered -0.9 where earlier versions overshot 0.2); the ceiling gap is re-measured
  after any premix change.
- Two of five written finish steps were wrong in ways the output would never show; a plan step is a hypothesis, and it earns a cheap verification immediately before it
  runs.
- A disk reached 210 GB and fell to 4.7 GB free, the swap could not grow, and the whole environment crashed under a build; free space is read before every batch and every
  finish, and a mezzanine is never backup-copied.
- 62 GB of superseded mezzanines accumulated in one day; the superseded set is listed by category at every phase boundary for the operator to name, one delete per
  category.
- Eleven versions of one spot shipped PRE-FINISH before anyone asked, because the builder was the project's own and no phase routed it to the finish.
- Two hand-written grade level chains stood for ten hours on a documentary spot before the operator asked; a deviation from the house grade needs a stated reason.
- On one documentary-ad job, 7 of 11 phase skills were never invoked although every phase ran, and the grade shipped half the look after a 15-line search of the guide; a
  rule in a file does not hold, a code gate does.

---

**Sources.** Distilled from the public repository konradre/video-production-skills (MIT) on GitHub (the fifteen agent skills, the look-library grading method, and the
handoff and method documents), together with the open-source projects its references credit as pattern sources (among them ComfyUI-Darkroom, spectral_film_lut,
hyperframes, davinci-resolve-mcp, h3-storyboard-skill, agentkit-samples, ComfyUI-Majoor-OmniCam and others named in that kit). Prices, caps and moderation facts are
reproduced as of the dates the kit states (September to October 2026) and must be re-measured before they are relied on.
