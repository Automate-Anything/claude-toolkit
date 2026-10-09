# Models and venues

Which model does which job, where it is bought, what it costs, what it refuses, how it is called. Every number carries its date; a number older than a month is read again before it is used. The full model field with sources is in section 3; the kit's measured venue table is in `production-pipeline.md` section 5.

## 1. The jobs, and what did each in October 2026

| Job | Model | Venue and endpoint | Price seen | Limits and habits |
| --- | --- | --- | --- | --- |
| Cast and place stills | GPT Image 2.5 (Sunburst) | Higgsfield `marketing-studio/image/sunburst` (2k, 16:9, quality high); also OpenAI direct and fal | about $0.20 a still (2026-09-30) | Holds a described person well from text. The same description repeated keeps a person across stills only loosely, so angles are edits (next row). |
| Another angle of the same people | GPT Image 2.5 edit | fal `openai/gpt-image-2.5/sunburst/edit` (`image_urls`, `prompt`, `quality`, `output_format`, `image_size`) | $1.00 an image (2026-09-30) | "Keep the exact same two people, faces, hair, clothes, the same room, the same window light, the same photographic look" plus the new framing (85 mm close-up, profile from the other side, a wide from the table's end). Six angles of a couple held in every frame. |
| A person talking | OmniHuman 1.5 (ByteDance) | fal `fal-ai/bytedance/omnihuman/v1.5` (`image_url`, `audio_url`, `mask_url`, `prompt`, `resolution` 720p or 1080p) | $0.16 a second (2026-09-30) | The mouth follows the audio; laughs where the line laughs; natural blinks and gestures. 720p output is 1248 x 704. Animates EVERY face in frame unless a mask limits it (white over the speaker, black elsewhere, a feathered edge). Input image must be under 5 MB: send a 1920-wide JPEG. Degrades after about 10 to 15 seconds; cut segments to that. |
| Someone listening beside the speaker | Seedance 2.5 image-to-video | Higgsfield `bytedance/seedance-2.5/image-to-video` | $0.4622 a second at 720p (2026-09-30) | Same still as the talking take, "his mouth stays closed, he never speaks, the camera does not move at all"; composited with a feathered split (`tools/talking_shots.py`). |
| A scene without speech | Seedance 2.5 image-to-video | Higgsfield, as above (`image_url`, `prompt`, `duration` 4 to 30, `resolution` 480p, 720p, 1080p, `generate_audio`) | $0.2056 a second at 480p, $0.4622 at 720p, $1.1372 at 1080p (2026-09-30) | Accepts photoreal faces in the start image (fal's Seedance refuses them). Makes its own room sound. Speaks a quoted {line} cleanly at 720p but the voice is the model's: not used for anyone on camera. A harmless action can be blocked by moderation (a hand dropping paper into a bin); blocked calls are not charged. A 22-second one-shot with an action in the middle worked first time. |
| Lip repair on an existing take | sync-3 (Sync Labs) | fal `fal-ai/sync-lipsync/v2` or v3 ($3 a minute); `veed/lipsync` ($0.40 a minute); `fal-ai/kling-video/lipsync/audio-to-video` | 2026-09-30 | Last resort: repair brings waxy chins. Prefer driving the face from audio in the first place. |
| Voices | ElevenLabs eleven_v4 | `POST /v1/text-to-dialogue?output_format=mp3_44100_128` with `{"model_id":"eleven_v4","inputs":[{"text":..., "voice_id":...}]}` | about $0.08 per 1,000 characters (2026-09) | Emotion as bracketed tags in the text ([amused], [pause], [laughs], [tired], [warm]); written the way people talk. Library: `GET /v1/shared-voices?gender=female&age=old&language=en&use_cases=conversational&sort=cloned_by_count&page_size=30`; add one with `POST /v1/voices/add/{public_owner_id}/{voice_id}` body `{"new_name":...}`. Reads a written name its own way: respell for speech. |
| Checking what was said | ElevenLabs Scribe v2 | `POST /v1/speech-to-text` with `tag_audio_events=true` | cents | Writes the words with timings and names sounds ([laughs]); shows if a tag was read aloud. Cannot judge an accent or an R: that is the client's ear. |
| Music | ElevenLabs Music v2.5 | `POST /v1/music` | $0.15 a minute direct, more through resellers (2026-09) | Licensed for ads on self-serve plans (not film, TV or studio games). Lyria is in preview with unclear terms; Suno and Udio have no official API and face suits; Stable Audio is instrumental only. |
| Sound effects | ElevenLabs SFX | `POST /v1/sound-generation` | $0.12 a minute | The video models' own ambience is usually enough; layer on top. |
| Words, glass, cards | HyperFrames 0.7 (HeyGen, Apache-2.0) with GSAP | local, `npx hyperframes render` | free | About 9 minutes of render per 100 seconds of film on an 8 GB laptop at one worker; about a minute per shot when rendered in pieces. |
| Cutting, mixing, checking | ffmpeg 7 or newer | local | free | A static build in a folder on the path; no system install needed. |
| Upscale | Topaz Starlight Precise (fal), SeedVR2 (fal `fal-ai/seedvr/upscale/video`, $0.001 a megapixel) | 2026-09-30 | Test on a skin close-up first: upscalers oversharpen skin. A 1080p master is a legitimate choice. |

## 2. The venues

| Venue | What it is for | How it is called | Habits |
| --- | --- | --- | --- |
| Higgsfield (API) | Stills and Seedance footage with faces; 82 models under one key (Seedance 2.5 and 2.0, Kling 3.0 std, pro, 4k, turbo, MiniMax H3, Wan 3.0, Happy Horse, LTX, Grok video; stills GPT Image 2.5, Ideogram, Recraft, Qwen Image) | `https://api.higgsfield.ai`, header `Authorization: Key <id>:<secret>`, curl only (Python's HTTP client is refused with a challenge page). `GET /models` lists; `POST /estimate/<slug>` is free and returns a number or, for token-priced models, the formula; `POST /<slug>` returns a request id and a status URL; statuses queued, in_progress, completed, failed, nsfw, canceled. No balance call: keep a ledger. Seedance tokens = height x width x (seconds x 24) / 1024; image and audio references free; a video reference multiplies the rate by 0.6. | Four minutes a take on a good day, over twenty on a busy one; a submit can answer 504 and must be sent again; failed and nsfw are not charged. It ran a one-day 100 percent cashback in September 2026 (cashback paid at list price, expiring at the day's end): watch for such offers and generate a whole film's takes inside the window. |
| fal.ai | Talking people, image edits, lip-sync, upscales, storage; the broadest catalog (Seedance, H3, Wan, Omni, Veo, Kling, FLUX, GPT Image, Nano Banana, Seedream, ElevenLabs, Sync, Topaz) | Queue: `POST https://queue.fal.run/<endpoint>` returns `request_id`, `status_url`, `response_url`; poll `status_url` until COMPLETED, read `response_url`. Prices: `GET https://api.fal.ai/v1/models/pricing?endpoint_id=<id>`. Schema: `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` (the input object is the schema whose name ends in Input). Storage: `POST https://rest.alpha.fal.ai/storage/upload/initiate` `{"content_type","file_name"}` returns `upload_url` and `file_url`; PUT the bytes. Balance: `GET https://rest.alpha.fal.ai/billing/user_balance`. Header `Authorization: Key <key>`. | A COMPLETED job can carry an error body (`{"detail":[...]}`): treat it as refused. The catalog search ignores its query: look endpoints up by name. Refuses any photoreal face as a Seedance reference or start frame, generated faces included. Input files over 5 MB are refused: downscale. |
| Replicate, OpenRouter, Runway Dev, Atlas, WaveSpeed, Runware | The same model families, often cheaper per second for Seedance 2.5 (about $0.23 at 720p against $0.47 on fal in September 2026) | Each its own API | Test the face policy and the watermark behaviour on the exact route before planning around it; they differ. |
| kie.ai | A reseller of largely the same models that claims to undercut the makers' own prices | Its own API | Unverified in this skill: one identical prompt on two venues, compare the frames and the queue time, before trusting the cheapest. |
| Google (Gemini API) | Veo 3.1 (no speech, true 4K), Gemini Omni Flash (cheap wides) | Gemini API | SynthID watermark in the pixels, cannot be disabled; blocks recognizable real people. |
| ElevenLabs | Every voice, the transcriber, music, effects | `xi-api-key` header | See the jobs table. |

## 3. The model field, as of 2026-09-30 (re-check before every production)

What changed that month: Sora 2 was removed from OpenAI's API on 2026-09-24. Veo 3.1 and Kling 3.0 fell off the top of the blind arenas; the top cluster is Gemini Omni Flash 1.1, Wan 3.0, MiniMax H3 and H3 Max, Seedance 2.0 and 2.5, within about 25 Elo. There is no Veo 4. Seedance 2.5 launched 2026-07-31 (30-second takes, 50 references, 480p and 720p native; "1080p" is a provider upscale on most routes but native on Higgsfield's API). Kling 4.0 was announced 2026-09-28 with an API promised for October.

| Model | Resolution, length | Audio and lips | References | Price per second (venue) | Weaknesses |
| --- | --- | --- | --- | --- | --- |
| Seedance 2.5 (ByteDance) | 480p and 720p native, 4 to 30 s | Yes; speaks quoted dialogue | Image-to-video, first and last frame, 50 refs | $0.23 (Replicate, OpenRouter) to $0.47 (fal); $0.46 at 720p on Higgsfield | Face filter on fal; morphing in fast action; accents unpredictable |
| Seedance 2.0 | up to 1080p native, 4 to 15 s | Yes | 12 refs | $0.30 fal 720p | Same filter on fal |
| Gemini Omni Flash 1.1 | 720p native, 3 to 10 s, extend to 40 | Yes; stutters on about 15 percent | Image and short video refs | $0.10 720p | Floaty motion, face drift on head turns; invents words |
| Veo 3.1 (Google) | 720p to 4K, 4, 6 or 8 s | Mouth shapes look artificial | 3 images | $0.40 | Not for speech; SynthID |
| Kling 3.0 Pro | 720p and 1080p, 3 to 15 s | Per-character lip sync; drifts after about 8 s | Elements, multi-prompt | $0.17 with audio (fal) | Slight text distortion |
| MiniMax H3 / H3 Max | 480p, 768p native, up to 2K/4K; 5 to 15 s | Yes, voice reference | 12 refs, native multi-shot | $0.05 to $0.16 | Tops the image-to-video boards but one hands-on test found it weakest for real people; test on the hardest shot |
| Wan 3.0 (Alibaba) | up to 1080p, 30 s | Yes, rough | Many kinds | $0.05 to $0.20 | Context decay over 30 s |
| OmniHuman 1.5 | 720p (1248 x 704), 1080p | Driven by an audio file | One image plus a mask | $0.16 (fal) | Animates every face unless masked; degrades past about 15 s |

Stills: GPT Image 2.5 Sunburst and Flare (first on the arenas, photoreal skin and light, up to 16 reference images, $0.04 to $0.10 direct); Nano Banana Pro and 2 (character consistency for up to 5 people from up to 14 images; SynthID); Seedream 5.0 Pro (photographic portraits, slow). Speech: ElevenLabs Eleven v4 first on the speech arena; Cartesia Sonic 3.6 second. Lip repair: sync-3. Audio-driven talking shots: OmniHuman 1.5, VEED Fabric 1.0 ($0.15 a second), Hedra Character-3, Kling lip sync.

Head to head by shot type (testers, last 90 days before 2026-09-30): talking close-up: drive from audio with OmniHuman, or Seedance 2.5 if its face test passes, Kling 3.0 Pro under 8 s; hands and phone: fix hands in the still, animate 3 to 5 s with minimal finger motion, composite the screen; wide establishing: Omni Flash or Wan 3.0; fast action: keep it light, H3 or Kling; product macro: Seedance 2.5 keeps text best.

## 4. What films cost

| Film | Footage | Everything else |
| --- | --- | --- |
| A 107-second story film with twelve characters: 33 takes, 19 stills | about $107 on Higgsfield at 720p, in one day under a cashback | under $2 of voices and music |
| A 93-second first draft of a talking couple | about $25 on Higgsfield, $22 on fal | cents |
| The same film rebuilt from the client's script (147 s): nine talking takes, four listening takes, one new scene, six angle stills | about $12 on fal (talking), $20 on Higgsfield (listening and the scene), $6 of stills | cents |

Budget 15 to 25 generations per finished shot for a montage made the old way (text-to-video or free image-to-video with speech); with stills first and audio-driven faces the keep rate on the second film was nearly one in one. A change to words, voices, bubbles, timing, music or the card after the takes exist costs nothing but a render.

## 5. Keys and the computer

- Keys in the project's `.env` (`HF_CREDENTIALS` as id:secret, `FAL_KEY`, `ELEVENLABS_API_KEY`), never in a chat, a prompt, a receipt or a committed file. The scripts scrub every key from every output they print.
- `ffmpeg` and `ffprobe` as a static build in `work/tools/bin/`; a code renderer wants them on the PATH of the same command.
- 8 GB of memory is enough for one render at one worker; two renders or a render beside a test run leaves 300 MB. Render in pieces.
- A background command an agent starts is killed after a time limit and its child processes keep running: start long work detached and kill by name when it is wrong (`hyperframes render`, `chrome-headless-shell`, the piping `ffmpeg`).
- The working directory of an agent's shell can change between calls: every command uses absolute paths.
- Python on Windows writes CRLF unless told `newline="\n"`; a `%` inside a string later run through a formatter must be doubled, and a string substituted as a value must not be; a heredoc mangles backslashes; a backslash-u in a Python string literal is a syntax error on a Windows path.
- A chat takes files up to about 30 MB: a 720p preview goes in the chat, the master goes to the client's downloads folder with a plain name.
