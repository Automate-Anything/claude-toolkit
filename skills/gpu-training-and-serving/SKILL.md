---
name: gpu-training-and-serving
description: The playbook for GPU work on rented hardware (RunPod pods, serverless endpoints, network volumes) - Part A is fine-tuning runs (Whisper / ASR LoRA with HuggingFace transformers + peft, and the lessons generalize to other seq2seq fine-tunes) - the correctness guardrails that keep a run from silently learning nothing, the speed playbook so runs take hours not days, how to read a run's health, and the pod gotchas. Part B is operating live serving infrastructure - pods versus serverless, volumes and regions, what a read-only API key can and cannot do, how deploys reach a pod or endpoint, and the landmines. Read it BEFORE planning or launching a training run, the moment a run looks wrong or slow, and the moment you touch anything runtime - a pod, a serverless endpoint, a network volume, "why is inference slow", "how many pods do we have", "what's on the volume", "can I create or edit an endpoint", "the worker is ready but jobs fail", "loss is stuck", "WER over 100", "why is training taking so long".
---

# GPU training and serving

> ## Adapt before use
> Part A is a sourced, generic playbook; the Whisper numbers are specific to
> Whisper large-v3 and are labeled as such. Part B describes how serving infra
> SHOULD be operated and documented, taken from a production system. Table
> names, script names and env-var names in Part B are EXAMPLES of the shape.
> The live inventory (endpoint ids, volume ids, regions, what is on each)
> belongs in the repo's own copy, verified live and dated, never remembered.
> Keys never go in any copy: names and locations only.

A run can cost hours of GPU time and real dollars. Get it right before you press
go, and read the gauges correctly once it is running.

**Answering questions about a run ("would X lower WER?", "is Y worth it?", which
learning rate, which LoRA targets): do NOT answer from memory.** The numbers
that matter are specific and well studied. Research them and **cite real
sources** (peer-reviewed papers, official HuggingFace / PEFT docs, the Sanchit
Gandhi "Fine-Tune Whisper" blog), state the **evidence strength** (strong,
moderate, analogical), and flag where evidence is thin or only inferred from
adjacent work. A confident unsourced number is how a multi-hour run gets aimed
at the wrong target.

---

# PART A: fine-tuning runs

Two questions: **"will this run actually learn?"** (correctness) and **"why is
it taking so long?"** (speed). Do correctness first. A fast run that learns
nothing is worthless.

## A0. The one mental model: how to read a run's health

You judge a run by **EVAL metrics, not the training loss.** This is the single
most important habit.

- **Training loss** is noisy and measured during optimization with a live
  (warming-up, high) learning rate. It can start high and jump around. **Do not
  panic on it.** A loss that is *passing through* a value while descending (22,
  19, 11, 9, 2) is NOT the same as a loss *frozen* at that value (stuck at 8 to
  11 for hundreds of steps). The first is healthy; the second is broken. **You
  cannot tell which until you watch several log lines.**
- **Eval loss and eval WER** (printed at each checkpoint with
  `predict_with_generate`) are the truth. A healthy run shows eval WER falling
  below baseline and eval loss heading well under 1.
- **The random-guess floor:** cross-entropy for a model that is purely guessing
  equals `ln(vocab_size)`. For Whisper large-v3 that is `ln(51866)`, about
  10.86. A healthy Whisper fine-tune **starts low (about 0.1 to 1.0) and
  converges toward 0.0 to 0.3.** Loss that **settles AT about 10.86 and will not
  drop** means the model is doing no better than guessing: misaligned targets
  or a broken model (A1.1). Loss that drops *through* 9 to 11 toward 1 is fine.

**GUARDRAIL: do not escalate before the first checkpoint eval lands.** The first
eval (at step = `save_steps`) gives you eval WER and eval loss. Wait for it
before declaring a run broken or restarting. Restarting on a training-loss hunch
wastes the progress already made. (This exact mistake happened: a run was called
"broken" on train loss around 9 and a restart was urged; the first checkpoint
then showed eval WER falling from 99% to 87% and eval loss 1.77. It was learning
fine the whole time.)

A high *baseline* WER is not automatically a bug. If the eval set is hard (a
language or register the base model hallucinates on), a baseline near 99% is
expected. What matters is that it FALLS with training. WER can exceed 100%:
hallucinated extra words count as insertions.

## A1. Correctness guardrails (a broken one of these is a wasted run)

### A1.1 The collator must strip `decoder_start_token_id`, never `bos_token_id`
For Whisper, the tokenizer prepends the start-of-transcript token (id **50258**,
which is `decoder_start_token_id`), and the model re-adds it through
`shift_tokens_right`. The data collator must strip ONE leading copy or the start
token is **doubled and every target shifts by one.** The model trains on
garbage: loss freezes near the random floor (8 to 11) and WER ends above 100%.

- **Correct:** `if (labels[:,0] == model.config.decoder_start_token_id).all(): labels = labels[:,1:]`
- **The trap:** comparing to `tokenizer.bos_token_id`. For Whisper that is
  **50257** (end-of-text), a *different* token, so the strip silently never
  fires. One popular course uses `bos_token_id`; the Sanchit Gandhi blog uses
  `decoder_start_token_id`. **Always use `decoder_start_token_id`.**
- Telltale: training loss frozen at about 8 to 11.

### A1.2 DROP bad clips, never truncate transcripts
Truncating a transcript to fit (for example `[:448]`) chops off the end-of-text
stop token. The model never learns to stop: runaway output, WER above 100%.
Instead **drop** unusable clips with a sanity filter:
- the transcript tokenizes to more than 448 tokens (the Whisper decoder cap);
- the audio is longer than your max-audio setting (you only feed the first N
  seconds but the transcript covers the whole clip: audio/text misalignment);
- too many transcript characters per second of audio (a transcript longer than
  the speech means a wrong duration or an off transcript).
This is cheap to compute and poison to skip.

### A1.3 Mask padding to -100
After `tokenizer.pad`, replace pad positions with `-100` so they are ignored in
the loss. Whisper reuses one id (50257) for pad and eos: mask all but the single
real eos. Unmasked padding inflates loss on tokens the model cannot predict.

### A1.4 bf16, not fp16 (on any Ampere / Ada / Hopper GPU)
fp16's narrow range overflows or underflows: NaN or stalled learning, especially
during warmup. **bf16 has fp32's exponent range** (no loss scaling needed) and is
the recommended choice. Fall back to fp16 only on pre-Ampere cards (T4, V100,
20-series). Keep **eval in full precision** (or autocast and cast
`input_features` to `model.dtype`) to avoid the "input type (float) and bias
type (half)" conv crash in `generate()`.

### A1.5 `load_best_model_at_end` must be wired right
- `eval_strategy == save_strategy`, and `save_steps` a round multiple of
  `eval_steps`, or it errors or no best model is tracked.
- `metric_for_best_model="wer"` **and `greater_is_better=False`.** "wer" does
  not end in "loss", so `greater_is_better` defaults to **True**, which keeps
  the WORST checkpoint. Set it explicitly.
- **Select on eval WER, not eval loss.** A Whisper model can have falling eval
  loss while WER rises (more hallucination).

### A1.6 Verify a merged or reloaded model BEFORE training on top of it
A corrupted or partial save (missing or wrong `generation_config.json`, wrong
`decoder_start_token_id`, missing tokenizer prefix tokens) produces loss near
random and WER near 100% on reload. Before training on a saved model: reload it,
assert `generation_config.decoder_start_token_id == 50258`, confirm the
tokenizer, `preprocessor_config.json` and weights are all present, and run a tiny
WER smoke on a few known clips. "A merged model that performs like the untrained
base" is a broken save, not bad training. Prefer `processor.save_pretrained(dir)`
plus `model.save_pretrained(dir)` so all files ride along.

**Continuing a previous run:** cleanest is to *resume the original adapter* (no
merge error, no config drift) or train a *fresh adapter from the original base*.
Merge-then-new-adapter works but is the riskiest (rounding error plus possible
config drift) and the error compounds across chained merges. Keep the clean base
and the original adapter archived as a fallback.

## A2. Speed playbook: hours, not days

In priority order. (Whisper always pads audio to 30 seconds, so encoder cost per
step is constant: precision and attention wins help a lot; length grouping
helps little.)

### A2.1 The data pipeline is usually the hidden time sink: fix it first
- **Pre-convert ALL audio once to 16 kHz mono 16-bit WAV:**
  `ffmpeg -i in -ac 1 -ar 16000 -c:a pcm_s16le out.wav`. A flood of
  "PySoundFile failed. Trying audioread instead." means libsndfile cannot decode
  your codec (mp3, m4a, mka), so librosa falls back to audioread, a deprecated
  path that shells out to the ffmpeg CLI per file, every epoch. Converting once
  removes that AND the per-load resample. Then always load at the native 16000.
- **Pre-extract log-mel features ONCE and cache to disk**
  (`dataset.map(prepare, num_proc=N)`). Otherwise decode + STFT reruns on every
  sample, every epoch. The more epochs, the bigger the win.
- For direct loads use **soundfile** (a thin C wrapper, no resample), not bare
  `librosa.load` (defaults to 22050 and resamples every call).
- large-v3 uses **128 mel bins** (v2 uses 80). Build the feature extractor from
  the v3 repo or it silently emits wrong-shaped 80-bin features. The 128 bins
  make feature caches about 60% bigger.

### A2.2 Compute settings (set once, big effect)
- **`bf16=True, tf32=True`**, plus at startup
  `torch.backends.cuda.matmul.allow_tf32=True` and
  `torch.backends.cudnn.allow_tf32=True`. tf32 alone is up to about 3x matmul
  throughput versus fp32, free.
- **`attn_implementation="sdpa"`** (default on recent torch). Use
  `"flash_attention_2"` only if it installs cleanly in a few minutes; SDPA
  captures most of the win. Eager is the slow fallback. (FA2 is incompatible
  with `torch.compile` and needs an fp16/bf16 dtype.)
- **Turn `gradient_checkpointing` OFF when VRAM allows.** It slows training
  about 20% (it recomputes activations). With LoRA on a bigger card you can
  often drop it and spend the VRAM on a bigger batch. On 16 GB you may need it.
- **Maximize real batch, minimize gradient accumulation** for a given effective
  batch. `batch=8, grad_accum=2` beats `batch=1, grad_accum=16`: accumulation
  does not save compute, it only emulates a big batch. Use multiples of 8. Find
  the max by doubling until OOM, then back off one.
- **`torch.compile`** (with SDPA, not FA2): up to about 30%, but the first step
  pays compile time and growing decoder length during eval can trigger
  recompiles.
- **`optim="adamw_torch_fused"`:** about 10 to 15% faster optimizer step. Small
  absolute gain with LoRA, but free.
- **DataLoader: feed the GPU.** `dataloader_num_workers` near the vCPU count (4
  to 16), `pin_memory=True`, `persistent_workers=True`, `prefetch_factor=2`. The
  Trainer default of 0 workers serializes CPU feature work and starves the GPU.

### A2.3 Eval is often the bottleneck: it runs at EVERY checkpoint
Generation is an autoregressive loop, far slower than teacher-forced loss. A
286-clip eval took about 14 minutes per checkpoint. Levers:
- **`use_cache=True` during eval generate.** Gradient checkpointing force-sets
  it False for training; if you never flip it back, every token recomputes the
  whole prefix. Likely the biggest hidden eval cost. Flip it back to False
  before resuming checkpointed training.
- **Raise `per_device_eval_batch_size`** well above the train batch (no
  optimizer or gradient state in eval).
- **Cap `generation_max_length`** just above your longest reference (hard cap
  448; a common recipe uses 225). Cost is about linear in tokens generated. Do
  not set it below a real transcript or WER inflates.
- **Greedy: `generation_num_beams=1`.**
- **A small, fixed eval set, evaluated often,** to see the curve and stop early;
  re-rank the top 2 or 3 checkpoints on a bigger set at the end. **Sizing:** WER
  noise is about `sqrt(WER*(1-WER)/N_words)`, and errors cluster so true noise is
  about double that. 50 to 80 clips (800 to 1500 words) ranks checkpoints to
  roughly plus or minus 2%: fine for monitoring and early stop, but re-score the
  finalists on a larger set (about 10k words) for the FINAL pick. **The eval
  pool is a POOL to SAMPLE from. Never feed the whole thing every checkpoint.**

### A2.4 Right-size the run
- **Epochs: 2 to 5 for a few to a few tens of hours of data, NOT 20.** The model
  peaks early then overfits; more epochs burn GPU past the peak (the best
  checkpoint keeps quality safe; money is not). More data with fewer epochs
  beats less data with many epochs.
- **LR for LoRA-Whisper is about 1e-3** (full fine-tune is about 1e-5; people
  conflate the two). 1e-4 is safe but conservative; 3e-4 to 1e-3 converges
  faster. LoRA tolerates about 100x the full fine-tune LR because the base is
  frozen and only about 1% of parameters train.
- **Canonical LoRA config:** `r=32, lora_alpha=64, target_modules=["q_proj","v_proj"], lora_dropout=0.05`,
  about 15.7M trainable parameters (1.0%) on large-v3. Extend the target modules
  (k_proj, out_proj, fc1, fc2) only if it underfits; raise dropout to 0.1 on
  tiny data.
- A grad norm of 10 to 25 that is *stable* is fine: it is the pre-clip value and
  `max_grad_norm=1.0` clips it. Worry only if it climbs while loss stalls.
- **GPU choice is a speed-per-dollar decision:** cost per run = dollars per hour
  times hours. A pricier card with more VRAM (bigger batch, checkpointing off)
  often finishes in fewer hours than the price premium, so it is cheaper per
  run AND faster. Validate by timing a few hundred steps on each.

## A3. Operational gotchas (RunPod / any remote GPU)

- **Run inside `tmux`** (`tmux new -s train`, `tmux attach -t train`). A plain
  terminal job dies when the browser or SSH disconnects. tmux survives
  disconnects but NOT a pod stop or restart.
- **Two disks.** The **network volume** is permanent and follows a volume swap
  between pods. The **container / local disk** is temporary, wiped on stop or
  reset. Keep the **zip and the checkpoints / `output_dir` on the volume**; keep
  the **extracted training files on the local disk** (next bullet).
- **NEVER extract a many-small-files dataset onto the network volume.** Network
  storage pays a metadata round trip per file. Extracting 71k clips onto the
  volume crawled at about 15 files per second (about 80 minutes, and it died
  twice); the SAME zip onto the local container disk ran at about 370 files per
  second (about 3 minutes). The pattern: the zip stays on the volume (survives
  restarts), `unzip -q x.zip -d /data-local`, train from the local path, write
  checkpoints to the volume. After a pod restart: re-extract (minutes) and
  resume. Bonus: every epoch's dataloader reads come off local NVMe. If a
  partial network-volume extraction must be finished in place, do not trust
  `unzip -n` (it skips half-written files from the crash). Use a parallel
  size-verifying extractor (compare each file's size on disk to the zip entry).
- **Resizing a network volume can RESTART the pod** (new container). That kills
  running terminals, in-flight unzips and downloads, and wipes all pip installs.
  Do the disk math and size the volume BEFORE staging data. Checkpoint math: one
  checkpoint is about adapter + 2x optimizer state (an all-linear LoRA r=32 on
  large-v3 is about 700 MB); 180 checkpoints is about 120 GB. Cap retention
  with `save_total_limit` (the best checkpoint is kept in addition to the most
  recent N).
- **Before re-uploading "missing" data, search for it:**
  `find / -name "<file>" 2>/dev/null`. A "missing" 3 GB upload was actually
  present, just sitting zipped. A re-upload would have wasted hours.
- **The pod's copy of your training script is a manual upload. There is no
  sync.** After ANY local edit, re-upload it before running, or you are running
  old code. Multiple runs failed on a stale script. Confirm the file's
  modified-time changed after upload.
- **Resume after a crash:** `resume_from_checkpoint=True` restores model,
  optimizer, scheduler, RNG and step. Keep `save_only_model=False` (the default)
  or you cannot truly resume. Verify loss continues smoothly.
- **Install deps fresh on a new pod.** Python packages live on the container,
  not the volume. Pin versions that match the image's torch (see B5).

## A4. Launch recipe and pre-flight checklist

**Pre-flight (before you press go):**
- [ ] Script re-uploaded to the pod (modified-time is current).
- [ ] Training data present and unzipped to LOCAL disk; **DATA AUDIT run**
      (below), not just `wc -l`.
- [ ] Starting model verified (base, or a save you smoke-tested per A1.6).
- [ ] Eval set SAMPLED small (tens of clips), not the whole pool.
- [ ] bf16 on; epochs right-sized (2 to 5); LR sane (1e-4 to 1e-3 for LoRA).
- [ ] Running inside tmux; `output_dir` on the volume; volume sized for the
      checkpoints.

**MANDATORY pre-flight DATA AUDIT.** A filter that runs but sees zeroes silently
does nothing. If the trainer reads each clip's length from a `seconds` field in
the manifest and the field is missing, it reads 0, so the over-30-second drop
(`0 > 30`) and the alignment drop **never fire**, and the run trains on
misaligned poison. This happened: 2,719 over-30-second clips, 5.9% of a
"filtered" mix, while the code *reported* a successful filter. Print the numbers
and **refuse to launch if durations are missing or a meaningful share of clips
exceeds 30 seconds.** Shape of the audit (adapt paths and field names):

```python
import json, os, collections
D = "<data-dir>"
rows = [json.loads(l) for l in open(f"{D}/manifest.jsonl", encoding="utf-8") if l.strip()]
has = sum(1 for r in rows if r.get("seconds"))
def sec(r):   # field if present, else size-based for 16k mono 16-bit PCM (32000 bytes/s)
    if r.get("seconds"): return float(r["seconds"])
    p = f'{D}/{r["audio_path"]}'
    return max(0, (os.path.getsize(p) - 44) / 32000) if os.path.exists(p) else 0
s = [sec(r) for r in rows]; over = sum(1 for x in s if x > 30)
by = collections.Counter(r.get("source", "?") for r, x in zip(rows, s) if x > 30)
if has < len(rows) * 0.99:
    print(f"!! STOP: {len(rows)-has}/{len(rows)} rows have NO duration -> filters are INERT")
print(f"clips {len(rows)} | with-duration {has} | {sum(s)/3600:.1f}h | mean {sum(s)/len(s):.1f}s | max {max(s):.0f}s")
print(f">30s POISON: {over} ({over/len(rows):.1%}) ; worst sources: {by.most_common(5)}")
```

No durations, or a meaningful over-30-second fraction: fix the data (record
`seconds` when the dataset is built; hold out or chunk the long clips) BEFORE
launching, not after.

**Then watch:**
- First 50 or so steps: training loss clearly **descending toward about 1**, not
  flat at 9 to 11.
- First checkpoint: eval WER below baseline, eval loss heading under 1.
- Stop when eval WER plateaus for 2 or 3 checkpoints (the best is auto-kept).

## A5. Lessons paid for in real runs

1. **Judged a run broken on training loss before the first eval** and urged an
   expensive restart. The eval showed it was learning. Always wait for the
   checkpoint eval.
2. **Used the entire eval pool every checkpoint:** 14-minute evals bloating the
   run. Sample a small fixed eval set.
3. **Theorized a "corrupted model" from loss numbers** when the real story was a
   hard eval set plus a still-descending loss. Prefer the simplest explanation
   the EVAL data supports. Do not over-diagnose.
4. **Nearly re-uploaded 3 GB of "missing" data** that was already on the pod.
   `find` before you upload.
5. **Ran a stale script** because the pod copy was not re-uploaded after edits.
   Re-upload and check the modified-time.
6. When the owner pushed back ("my model was better, why go back to base?"),
   **he was right** and the data-driven read was wrong. Weight the user's direct
   observations; verify with eval numbers, not theory.
7. **A "filter" silently did nothing because the manifest had no durations.**
   The cause was trusting a code comment ("filter dropped about 3.6%") instead
   of verifying the data path end to end. Verify the DATA, not the code's claim
   about the data: run the A4 audit and read real numbers every launch.

---

# PART B: operating live serving infrastructure

> **Why this part exists:** an agent spent a full session standing up a
> serverless endpoint, fixing pod latency and killing a hallucination, and
> re-derived the whole layout, the access model and a dozen landmines the hard
> way. Write the inventory down, verified live and dated.

**The golden rule:** *you usually have more access than a read-only provider key
suggests.* Find out where the write-capable credentials legitimately live before
concluding "no access". Never print a secret value: reference it by env-var name
or table column, and read it in-process.

## B1. Where the env lives

- **One env file at the repo root.** Never per-app. Gitignored. Every var the
  code reads is documented (empty) in the committed example file.
- **Read a secret in-process, never echo it:** a script reads the var and uses
  it in a header.
- **Know what is NOT in the local file.** Values the owner set only on the host
  (Render env vars: a serving URL, an internal shared secret, AI provider
  credentials) cannot be read locally. Write down which those are, so nobody
  hunts for them.

## B2. What access you actually have (fill in per repo)

| Credential | Can do | Cannot do |
|---|---|---|
| Read-only GPU provider key | list endpoints, read endpoint config, list volumes, read health, query GPU-type availability | **invoke** an endpoint (403), create / delete / edit pods, endpoints or volumes |
| Database service role + DB URL | full database (bypasses RLS), including any service-role-only columns that hold per-endpoint keys | (server-only; never in a client bundle) |
| Git credential | push to the repo | nothing on the host: this is SEPARATE from the host's own GitHub pull, which can break independently |
| No host (Render) credential | - | set env vars, trigger or roll back a deploy, reconnect the host to GitHub. **All owner-only.** |

## B3. Operating an endpoint despite a read-only key

A read-only provider key cannot invoke or edit. But if the app registers its
endpoints and hosts in the **database** (a table per kind, with a base URL and
an API key in a write-only, service-role-only column, so an admin console can
switch the active one without a redeploy), then the invoke key for each endpoint
is readable with the service role. Reading it in-process and using it against
the provider is the intended way to operate that endpoint.

The shape (never print the key; it only ever goes into the header):

```js
// read the active endpoint's url + key with the service role, then USE it
const rows = await (await fetch(`${SB_URL}/rest/v1/<endpoints_table>?select=url,api_key,is_active`,
  { headers: { apikey: SERVICE_ROLE, authorization: `Bearer ${SERVICE_ROLE}` } })).json();
const ep = rows.find(r => r.is_active);
const H = { "content-type": "application/json", authorization: `Bearer ${ep.api_key}` };
const out = await fetch(`${ep.url}/runsync`, { method: "POST", headers: H,
  body: JSON.stringify({ input: { /* a cheap, real job */ } }) });
```

What such a key typically unlocks on RunPod serverless (verify per key):

- **Invoke:** `POST {url}/runsync`, or `/run` async then poll `GET {url}/status/{id}`.
- **Purge a stuck queue:** `POST {url}/purge-queue`.
- **Health:** `GET https://api.runpod.ai/v2/{endpointId}/health` (worker and job
  counts).
- **Edit config:** `PATCH https://rest.runpod.io/v1/endpoints/{id}` (for example
  the idle timeout). This worked with a stored key that happened to have write
  scope. Not every key will: if a PATCH returns 403 it is an invoke-only key
  and the owner must edit in the dashboard.

**Limits of this trick.** It is for operating the owner's own endpoints inside
the task you were given: invoking, measuring, purging, a config tweak the owner
asked for. It is not a path to creating, deleting or resizing paid resources;
those stay the owner's call. And if the app does NOT store keys this way, do not
go looking for another back door: ask for the grant (B6).

## B4. Inventory and architecture (fill in per repo, verified live)

Record, with the date verified:

- **Each serverless endpoint:** name, region, how it is built (GitHub-built from
  which branch and Dockerfile), GPU tiers, FlashBoot, idle timeout, min / max
  workers, the model it serves, which volume it mounts.
- **Each persistent pod:** region, GPU, the model and server it runs, how it is
  exposed (tunnel or proxy), where its URL is registered, and whether it
  serializes inference.
- **Each network volume:** name, region, size, what is on it (checkpoint names
  and sizes, which is the default).
- **How the app resolves the active backend** (database-first with a short
  cache, env fallback only if the table is empty) and the serving code path.
- **A latency baseline with its breakdown:** total round trip, pure compute,
  pure network distance, and the figure under concurrency.

Design facts worth knowing before you read your own inventory:

- **A pod that serializes inference** (one GPU lock, on purpose, so concurrent
  calls cannot OOM) makes concurrent requests queue single file. Under bursty
  load that queue, not the model, is the latency. Measure 1 request and N
  concurrent requests separately. In the source system the round trip was
  roughly half compute and half geography (a far-away region), and three
  concurrent chunks took about four times one. The levers are a closer region
  and batching, not a faster model.
- **A pod's tunnel URL rotates on every pod restart.** Re-register the new URL;
  do not debug the old one.
- **A serverless backup can exist but be capacity-throttled.** Know which is
  primary.

## B5. How serving deploys (and the gotchas)

- **A GitHub-built serverless endpoint rebuilds on push** to its branch. **The
  build context is the REPO ROOT,** so a Dockerfile in a subdirectory must
  `COPY` with repo-root-relative paths.
- **Pin library versions to the base image's torch.** A torch 2.4 image plus the
  latest `transformers` crash-looped on `cannot import name 'DTensor'`; pinning
  `transformers==4.44.2` fixed it. A worker that crash-loops on import still
  shows as "ready".
- **A persistent pod does NOT auto-deploy.** Editing the pod's server script and
  pushing does nothing to the running pod. It needs a manual restart with the
  new code. If that keeps biting, move the service to a git-built serverless
  endpoint so code changes deploy themselves.
- **A server that runs TypeScript directly (no compile step) only fails its
  deploy on SYNTAX errors.** A TYPE error passes that service and fails the
  sibling apps that do compile. Split signal: one service green, the others
  red. Run the real typecheck before pushing.
- **The host's GitHub connection can silently break** ("access to the Git
  repository was denied"): every service stops deploying, auto AND manual, while
  your `git push` keeps succeeding. Owner-side fix: reconnect the host to GitHub.
- **Verify freshness after any deploy:** a health route that returns the build
  commit, checked against your push (see `deploy-freshness`).

## B6. What you cannot do yet: ask the owner for durable grants

Every one of these was a real wall. Getting them removes the owner from the loop:

1. **Create, delete or resize pods and endpoints, edit GPU tiers:** a read/WRITE
   provider API key in the env file.
2. **Anything on the host** (set env vars, trigger or roll back deploys, read
   deploy logs): a host API key in the env file plus a per-service deploy hook
   URL, or an MCP connector.
3. **Restart a pod with new server code** (SSH through the provider's proxy is
   flaky: it needs a PTY and keys reset): a stable SSH path, or better, move the
   service to a git-built serverless endpoint.
4. **Read deploy logs** to diagnose a failed build: covered by item 2. Without
   it the owner ends up screenshotting logs.

## B7. Landmines (all learned the hard way)

- **A region can be GPU-starved.** Zero serverless stock for weeks. A volume
  there is stranded. Check availability (the provider's GPU-types query) BEFORE
  creating a volume or endpoint in a region.
- **The volume's region must equal the endpoint's region.** Serverless pins to
  the volume's data center. Picking a wrong-region volume is the number one way
  to make a dead endpoint. The endpoint-edit UI picks GPUs by **memory tier**
  (24 GB, 16 GB), not model name, and grays out a volume whose region cannot
  serve the selected tier.
- **"ready" is not "works".** A worker can be `ready` (container up) yet crash
  on every job. Prove a real job COMPLETES (a cheap one, like listing available
  checkpoints) before declaring an endpoint healthy.
- **A read-only key cannot invoke (403).** That is not "no access": see B3.
- **An idle timeout of a few seconds means a cold start on nearly every
  request.** A short increase (for example to 60 seconds) is often the cheapest
  latency fix.
- **Whisper-family servers transcribe silence and hallucinate** (stock phrases
  like "Thank you.") when VAD filtering and the no-speech threshold are not
  actually applied by the server. Stripping the phrases client-side is a
  band-aid. The real cure is **VAD in the serving code.** Before stripping a
  phrase, make sure it is not something users genuinely say in that language.

## Related

- `agent-access-and-toolchains` - build toolchains, secrets, dashboard invites.
- `infrastructure-overview-template` - where the inventory in B4 can live.
- `deploy-freshness` - verifying a served build.
- `error-alert-system` - wiring serving failures into alerts.
- `query-efficiency`, `page-performance` - the other halves of "why is it slow".
