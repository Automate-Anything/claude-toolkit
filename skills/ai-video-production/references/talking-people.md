# Talking people

How a person on camera speaks with a voice the client approved, how nobody else's mouth moves, and how the shots cut like a film. This is the method that replaced "let the video model say the line", which gave voices the client called "way too AI-ish" and mouths that did not match.

## The principle

The voice comes first and the face follows it. A video model asked to speak a line invents words, invents a voice, and ties the performance to that one take. An audio-driven model (image plus audio in, a talking person out) ties the performance to an audio file you control: change the voice, change the words, redo the take for a dollar, and the face laughs where the line laughs.

## The steps

1. **The person.** One cast still of the person (or the couple) in the place, from the best still model, 2K, from a description detailed enough to hold: age, skin, hair, glasses, earrings, the cardigan, the watch, the phone case, the room's objects, the lens and the light. Look at it at zoom. Every other angle (a close-up of the face at 85 mm, the profile from the other person's side, the wide from the end of the table, the other person's face, the end pose) is an EDIT of that still on an image-edit endpoint: "Keep the exact same two people, faces, hair, clothes, the same kitchen, the same window light, the same photographic look: candid, full-frame camera, natural colour, real skin texture, no retouching. Reframe as ...". The same two people held in all six frames.
2. **The voice.** Numbered candidates from the library for the client's ear, labelled by the person in the film; his number; the lines made in that voice with a dialogue model, emotion as tags, written the way people talk; the name respelled for speech if the model says it wrong; the transcriber confirms the words and that no tag was read aloud. Segments of 4 to 15 seconds each: the audio-driven model degrades past that, and a short segment is a small piece to redo.
3. **The mask.** The audio-driven model animates every face in the frame to the voice. Make a mask image the exact size of the still: white over the speaker's side, black over everyone else, a feathered edge of about 80 pixels through the wall between them (a soft vertical split is enough when the two sit side by side; draw a tighter shape when they overlap). The script `tools/talking_shots.py` writes it from a split fraction and a side. Upload the still (a 1920-wide JPEG under 5 MB), the audio and the mask to the venue's storage.
4. **The talking take.** `image_url`, `audio_url`, `mask_url`, a one-line prompt ("The woman talks to the camera, warm and amused, natural blinks and small head movement, small natural gestures with the phone; the camera holds still."), 720p. About $0.16 a second. The result: the speaker talks, the masked-out person stays still with a closed mouth.
5. **The listener.** The still person beside a talker looks dead. Generate the listener separately: image-to-video from the same still on a model that accepts faces, "the camera locked off and perfectly still; the woman stays almost still, holding the phone up; the man listens with a fond smile, glances at the phone in her hand and back at her face, one slow nod; his mouth stays closed, he never speaks; nobody speaks; no music; no text", the duration rounded up to the talking take's length. About $0.46 a second at 720p.
6. **The composite.** Both start from the same still, so the seam is at static background. Scale both to the same size, take the listener's side from his take and the speaker's side from hers with the same feathered mask: ffmpeg `maskedmerge` (base = his take, overlay = her take, mask = the white-over-her image), audio from the talking take. One command per two-shot; the script does it for every two-shot in the plan.
7. **Two angles from one audio.** Generate the same audio segment on two stills (the close-up and the two-shot, or the profile and the wide). Both are lip-synced to the same file, so the edit can cut between them at any word, like a two-camera shoot. The hook segment opens on the close-up and cuts to the two-shot at the name.
8. **His line.** When the second person has a line, the same method with the mask on his side, on the still where he is largest (his close-up), and the two-shot's silent end take under it.
9. **The check.** Scrub the talking takes at speed or watch them; still frames cannot show whether the mouth leads or lags the voice. A client watching the whole film noticed mouths off the voice that frame grids had not shown. When it is off: the audio-driven take is regenerated (the model is stochastic), or the take is run through a lip-sync repair as a last resort, knowing it brings waxy chins.

## What goes wrong, and the fix

| Failure | Fix |
| --- | --- |
| Both people's mouths move to her words | The mask; and the listener generated separately and composited |
| The listener is frozen | The composite (step 5 and 6) |
| The voice says the name wrong | Respell it for speech; test four spellings and listen |
| The transcriber hears the name right but the client hears a Spanish R | The transcriber cannot judge pronunciation; make short samples (the name in each voice, the line with and without the accent) and let the client pick |
| The venue refuses the still | Over 5 MB: downscale to 1920 wide JPEG; or a photoreal-face policy: use a venue that accepts faces |
| A COMPLETED job with an error body | Treat as refused; the runner checks for a `detail` key |
| A listening take never arrives (a 504 at submit) | Do not block the film: the masked talking take stands alone; the composite is a later, one-piece change |
| The take is 1248 x 704, the film is 1920 x 1080 | Fine for a draft (object-fit cover); for release generate at 1080p or upscale the keepers |
| A line runs longer than its shot | Time the shot from the audio, never the audio from the shot |

## What the video model is still good for

Scenes without speech: her back at the sink while the phone lights on the table, the garden with the phone on the bench, a thumb hovering over a screen, a man up a ladder. Image-to-video from a still, "the shot begins on the start frame and continues from it without any cut", what moves and in what order, the camera holding still, the room's own sound, "nobody speaks, no music, no on-screen text, no logos". A phone in the frame has a dark or plain screen and the words go on afterwards.

## Pronouncing a name

Speech models read a written brand name their own way. Make the name in each voice with four spellings, transcribe each (the transcriber writes what it hears, so a spelling that comes back as the intended word is a candidate), then give the client the short samples to choose by ear. Use the winning spelling in every text handed to a speech model, in the film and in the product, while the written brand stays as written. One client wanted the R said the English way and not rolled: the accent tag on the whole line rolled it, so the name was tagged "American English" and the accent tag applied to the rest of the line.
