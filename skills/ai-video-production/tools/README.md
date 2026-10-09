# The tools

Plain Python 3 and curl. They read API keys from a `.env` in the project root (`HF_CREDENTIALS` as id:secret for Higgsfield, `FAL_KEY`, `ELEVENLABS_API_KEY`), never print one, and write into a `work/` folder beside this `tools/` folder: `work/prove/stills`, `work/prove/takes`, `work/audio`, `work/edit`, `work/out`, `work/receipts`. `ffmpeg.exe` and `ffprobe.exe` are expected in `work/tools/bin/` (a static build; no system install). The code renderer (HyperFrames) is installed with `npm install hyperframes gsap` in a folder of its own; `compose.py` writes project folders under `../hyperframes/video-projects/`.

The scripts came out of two real films and carry those films' shot names in their example data (WOMAN-CU, GARDEN-1S and so on). Replace the example data; keep the method.

## Shared

| Script | What it does |
| --- | --- |
| `common.py` | Where things are (`ROOT`, `WORK`, `BIN`, `TOOLS`), the keys from `.env`, curl with every key scrubbed from its output, the cost ledger (`work/receipts/ledger.jsonl`). Every other script imports it. |

## Buying stills and footage

| Script | What it does |
| --- | --- |
| `higgsfield.py` | Higgsfield runner: `submit <slug> <payload.json> <name> [--cap]`, `batch <jobs.json>`, `wait <name...> [--minutes] [--out]`, `spent`. Prints the cost line (the venue's free estimate or its formula) before the call, refuses a call over the per-call cap or the day cap (`VIDEO_DAY_CAP`), writes the receipt at acceptance, polls, downloads, logs refunds for failed and nsfw. Refuses a name that already has a receipt. |
| `fal.py` | The same for fal.ai (`submit`, `batch`, `wait`, `upload <file>`). Reads prices from fal's pricing endpoint; uploads to fal's storage (for audio, masks and stills over 5 MB); treats a COMPLETED job with an error body as refused; names the output by the endpoint kind. |
| `talking_shots.py` | The talking shots of a film: `plan` prints the shots and the cost and buys nothing; `go` writes the masks, uploads, generates each talking take from its audio with the mask over the speaker and a listening take for anyone beside them, waits, composites; `composite` only joins the halves with ffmpeg `maskedmerge`. Edit the PLAN and SPLIT tables at the top for your film. |
| `read_schemas.py` | Free calls: a model's inputs and price from the venue's catalog. |
| `check_keys.py` | Free calls that prove each key works before anything is bought. |

## Voices

| Script | What it does |
| --- | --- |
| `voice_candidates.py` | Numbered candidates for one person from the ElevenLabs library (a saved library search JSON in, each candidate added to the account and saying that person's lines with eleven_v4 dialogue and emotion tags). Copy it per person; put the results on a page the client can play. |
| `voice_lines.py` | The lines of a film in one approved voice, one file per segment, with tags; `--force` to remake. Spell a name for speech the way the model says it right. |

## The cut

| Script | What it does |
| --- | --- |
| `example_edit_list.py` | An edit-list builder: shots (take, in, out), calls with their audio, bubbles (who, kind, text, when, life, side), the wordmark, a book, the card; timed from the audio lengths; a short take slowed to fit (`stretch`); a reaction shot borrowing another take's sound (`audio`). Writes `work/edit/<film>.json`. Write one per film version. |
| `compose.py` | Edit list in, HyperFrames composition out: the takes as muted video, glass speech bubbles with tags that never leave their scene, the wordmark on the empty side or the top, the book of a trip, the end card. `FILM_PROJECT` names the project folder. Edit the SIDE and SCENE maps for your takes and the brand strings (wordmark, tagline, card lines, fonts) at the top. |
| `mix.py` | The sound from the edit list: the takes' own sound in sequence, every voice line at its real length with a gap (shifted if it would touch), the takes and the music sidechain-ducked under every voice, loudness to -14 LUFS, true peak under -1 dBTP. `--mux <video> <wav> <out>` lays a mix under a picture. |
| `render_pieces.py <edl> <mix.wav> <name>` | Renders a film one shot at a time (each shot its own small composition and short render, re-rendered only when its part of the edit list or `compose.py` changed), joins the pieces, lays the mix under, makes a 720p preview, copies both to the user's Downloads. Start it detached (a `.cmd` or shell script launched with the system's start command, logging to a file). |
| `type_only_film.py` | A film of type alone (sent lines right, replies left, a first word filling the screen), both shapes. |
| `roughcut.py` | An ffmpeg-only assembly from an edit list with plain captions, for a first look without the designed layer. |

## Checking

| Script | What it does |
| --- | --- |
| `review.py <file> [--words]` | Length, size, frame count, loudness and peak, a contact sheet of frames; with `--words`, what was said (ElevenLabs Scribe with word timings and audio events). |

## The order they run in

`check_keys.py` and `read_schemas.py` once; stills with `higgsfield.py batch`; `voice_candidates.py` and the client's numbers; `voice_lines.py`; `talking_shots.py plan` then `go`; scene takes with `higgsfield.py`; `example_edit_list.py`; `mix.py`; `compose.py` on a three-second probe, then on the film; `render_pieces.py`; `review.py` and a frame grid; then the client.
