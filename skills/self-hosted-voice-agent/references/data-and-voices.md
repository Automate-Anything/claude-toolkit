# Database columns, voice catalogue and voice resolution (read from reference-impl)

Files: `sql/*.sql`, `app-server/voiceAgent/{cartesiaVoices,voices,postCall,tools,outbound,campaigns,session,provider}.ts`,
`app-server/voiceAgent/routes/{rt,voices,admin}.ts`.

Table names are the reference product's. Several carry the hosted platform's name
(`retell_*`, `usage_type='retell'`) because the migration reused them on purpose; see
the "keep reporting columns compatible" landmine in SKILL.md. Before any DB write,
pull the LIVE schema of every table you touch; migration files drift.

---

## 1. Migrations included in reference-impl

### 1.1 `20260922_100000_voice_numbers_ai_provider_pipecat.sql` (the one the AI agent needs)

Widens the provider CHECK on the numbers table so a number can be on the self-hosted
agent:

```sql
ALTER TABLE public.voice_numbers DROP CONSTRAINT IF EXISTS voice_numbers_ai_provider_check;
ALTER TABLE public.voice_numbers ADD CONSTRAINT voice_numbers_ai_provider_check
  CHECK (ai_provider IS NULL OR ai_provider IN ('retell', 'pipecat'));
-- Rollback (only when no 'pipecat' rows exist):
--   CHECK (ai_provider IS NULL OR ai_provider = 'retell')
```

Safe to apply before the code ships: code that only writes the old value never
notices. Every reader of `ai_provider` must be audited in the same change. It is an
edit of an existing constraint, so it needs the owner's explicit approval.

### 1.2 `20261005_120000_voice_agent_cloned_voices.sql`

`public.voice_agent_cloned_voices`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `company_id` | uuid NOT NULL | FK companies, cascade delete |
| `location_id` | uuid NULL | FK locations, set null. A clone belongs to the company; a location selects it. |
| `cartesia_voice_id` | text NOT NULL | the id Cartesia returned |
| `name` | text NOT NULL | |
| `gender` | text NOT NULL default `'female'` | CHECK in (`male`, `female`) |
| `language` | text NOT NULL default `'en'` | |
| `created_by` | uuid NULL | FK users, set null |
| `consent_text` | text | the consent the UI collected |
| `consent_at` | timestamptz | |
| `created_at` | timestamptz NOT NULL default now() | |

Index on `company_id`. `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`,
RLS on, four policies (select/insert/update/delete), each: caller not blocked AND
`company_id = get_my_company_id()`.

### 1.3 `20260729_voice_agent_shift_events.sql` (NOT the AI agent)

`voice_agent_shift_events` + `record_agent_shift_transition(...)` record HUMAN call
center agents' online/paused/offline presence from the softphone. It belongs to the
human telephony layer and is unrelated to the AI brain. It is in reference-impl
mainly as a warning: "voice agent" means a human agent in one part of the product and
the AI agent in another. Read the code, not the table name.

## 2. Tables the code reads or writes whose migrations are NOT in reference-impl

The plan names three more migrations that were applied in the product:
`20260922_110000_voice_call_opt_outs.sql`, `20260922_120000` (tiered billing: plan
column `retell_rate_per_min_premium`), `20260922_130000` (campaign tables). Their SQL
is not covered by the reference implementation; the columns below are what the code
uses.

| Table / object | Columns or args used | Where |
|---|---|---|
| `voice_numbers` | `id, company_id, location_id, phone_number, provider_sid, ai_provider, ai_active, ai_agent_id, ai_sip_termination_uri, ai_enabled_at, nickname, lifecycle_state, is_active` | provider switch, outbound, routing, admin |
| `retell_inbound_call_logs` (decision audit, provider agnostic despite the name) | insert `company_id, location_id, from_number, to_number, disposition (live|transfer|hangup|error), decision_reason, duration_ms, signature_ok (null), request_body {provider:'pipecat', call_sid}, response_body {provider:'pipecat', session_id}` | `session.ts` |
| `ai_call_state` (per-call location pin for numbers shared by several locations) | upsert on `call_id` (= session id): `provider, company_id, to_number, shared_group_id, location_id, location_confirmed_at, location_confirmed_by` | `session.ts` |
| `voice_call_opt_outs` | insert `company_id, location_id, phone_number (bare digits), contact_id, source_call_session_id, opt_out_method ('agent'), opt_out_message, scope ('marketing'|'all')` | `mark_do_not_call` tool |
| RPC `is_call_opted_out` | `(p_company_id, p_phone (bare digits), p_scope ('marketing'|'transactional'))` returns boolean | `startOutboundCall` |
| `voice_campaigns` | `id, company_id, location_id, name, objective, from_number, status ('draft'|'sending'|'done'), consent_scope, max_concurrency, quiet_hours_start, quiet_hours_end, max_attempts, recipient_count, placed_count, created_by, started_at, finished_at, updated_at` | `campaigns.ts` |
| `voice_campaign_recipients` | `id, campaign_id, company_id, contact_id, phone_digits, status ('pending'|'calling'|'done'|'failed'|'skipped'), attempts, session_id, outcome, skipped_reason, failure_reason, last_attempt_at, created_at, updated_at` | `campaigns.ts` |
| `usage` | insert `company_id, external_id (session id), usage_type ('retell'), quantity (minutes), unit ('minutes'), description, start_time, end_time, billed (false)`. A unique violation (`23505`) is ignored, so a retried finalize cannot double bill. | `postCall.ts` |
| `call_history` | written by the shared post-call handler (not in reference-impl); the late-recording path updates `recording_bucket_id` by `company_id` + `call_sid` (= session id) | `routes/rt.ts` |
| `location_prompt_variables` | `ai_voice_id` (the selected voice key), `transfer_to_number` | voices routes, fallback transfer |
| `retell_prompt_flags` | `key ('self_hosted_voice_agent'), company_ids, location_ids` | the gate's targeting list |
| `users` | `id, company_id, is_blocked` | operator voice routes |
| `contacts` | `id, phone_number, phone_mobile, phone_home` (first non-empty, deduped by digits) | campaign create |
| `locations` | `timezone`, `name` | campaign quiet hours, admin list |
| Storage bucket `phone_call_recordings` | `{company_id}/{session_id}.wav` | recording upload |

The shared post-call writer is fed (from `postCall.ts`): `agentType: 'ai'`,
`provider: 'pipecat'`, `agentId: 'pipecat:<engine>'`, `agentName: 'self-hosted'`,
`callId` = session id, `providerCallSid` and `twilioCallSid` = carrier call sid,
numbers with and without `+`, `callStatus` (`failed` when `ended_by='error'`, else
`completed`), `durationSeconds` (rounded), `transcript` (User/Agent lines), the four
analysis fields, `disconnectionReason` = `ended_by`, `totalCostCents`,
`productCosts {engine, usage}`, `llmTokenUsage`, `latency`, `toolCalls`,
`transcriptWithToolCalls`, `recordingBucketPath`, and the location id and name.

Tables the design calls for but the reference never built: `voice_agents`
(agent-config-as-data, including a per-agent `engine`) and `voice_agent_tools` (the
tool catalogue as data). Not covered by the reference implementation.

---

## 3. The Cartesia voice catalogue (public Cartesia voice ids)

Model for all: `sonic-3.6` (multilingual, 44 languages). Ids were pulled from the live
Cartesia voices API and checked by ear with English samples (2026-10-05). The
"Mexican accent" voices are Cartesia Spanish voices reading English: a slight,
natural accent that reads as more human.

| key | Cartesia voice id | Name | Gender | Accent | Picker blurb |
|---|---|---|---|---|---|
| `allie` | `2747b6cf-fa34-460c-97db-267566918881` | Allie | female | American | Confident, approachable, natural. Default female. |
| `cory` | `41468051-3a85-4b68-92ad-64add250d369` | Cory | male | American | Casual, friendly, easygoing. Default male. |
| `fernanda` | `b4b8e2af-6139-466e-a93a-30c20d2e1fc5` | Fernanda | female | Mexican accent | Warm Latina with a slight natural accent. |
| `daniela` | `5c5ad5e7-1020-476b-8b91-fdcbe9cc313c` | Daniela | female | Mexican accent | Soft Latina, gentle accent, very human. |
| `emma` | `f6ff7c0c-e396-40a9-a70b-f7607edb6937` | Emma | female | American | Casual, everyday, relaxed. |
| `harper` | `d6c52d6f-6478-47a2-ad54-dbc8f3335a2b` | Harper | female | US Southern | Soft, poised Southern warmth. |
| `jacqueline` | `9626c31c-bec5-4cca-baa8-f8ba9e84c8bc` | Jacqueline | female | American | Young, empathic, reassuring. |
| `mateo` | `2fc4f1ec-bfd0-46f1-8e6d-d4279eaaf838` | Mateo | male | Mexican accent | Warm Mexican male, genuine tone. |
| `archie` | `ef191366-f52f-447a-a398-ed8c0f2943a1` | Archie | male | British | Warm, conversational British, polished. |
| `jameson` | `a5136bf9-224c-4d76-b823-52bd5efcffcc` | Jameson | male | American | Laid-back, friendly, onboarding-style. |

`DEFAULT_FEMALE_KEY = 'allie'`, `DEFAULT_MALE_KEY = 'cory'`.
`catalogVoiceFor(selection)`: empty selection returns Allie; otherwise matches by key
or by raw Cartesia id; no match returns null.

### Loudness

Cartesia voices come back at very different loudness (Allie measured about 9.5 dB
louder than Cory). Against a fixed ambience bed, a hot voice sounds less human and the
bed sits wrong under a quiet one. The product validated normalizing to about -16 LUFS
offline with `ffmpeg -af loudnorm=I=-16:TP=-1.5:LRA=11`. Real-time loudness
normalization of the TTS stream is NOT in the reference runtime (only the beds are
peak-normalized). Build it, or pick voices of similar loudness.

## 4. How a stored voice becomes the runtime voice (`voices.ts`)

The stored selection lives in `location_prompt_variables.ai_voice_id` and reaches
`resolveVoiceRtVoice(bundle, engine)` through the inbound voice bundle. Three formats:

1. A catalogue key (`allie`) or a raw catalogue id.
2. A clone: `cartesia:<voiceId>` with optional `:male` / `:female` suffix (the picker
   stores `cartesia:<id>:<gender>`). Missing gender reads as female.
3. A legacy hosted-platform id (for example `11labs-Cimo`).

Output (`VoiceRtVoiceConfig`): `engine`, `source_voice_id`, `gender`, an optional
`cartesia` block (only for formats 1 and 2), an always-present `elevenlabs` block, an
`openai_realtime` block, and `language` (default `en-US`; a one-element array
collapses to a string).

Cartesia block defaults (the "mellow, not wild" values set by ear on a real call):

| Field | Value | Rule |
|---|---|---|
| `speed` | 0.88 | `bundle.voice_speed` overrides, clamped to 0.6 to 1.5 |
| `emotion` | `neutral` | fixed; `content` is the warmer by-ear option |
| `volume` | 0.9 | fixed, eased below 1.0 so it is not loud on a phone |
| `model` | `sonic-3.6` | |

Cartesia `generation_config` ranges: speed 0.6 to 1.5 (1.0 default), volume 0.5 to
2.0 (1.0 default), emotion is a free-text tone guide (unknown values are interpreted,
not rejected, per the product skill).

ElevenLabs fallback block (always built, used only when there is no Cartesia block):

| Field | Rule |
|---|---|
| `voice_id` | from the legacy catalogue below, else a gender default by name regex |
| `model` | `bundle.voice_model` if it starts with `eleven_`, else `eleven_flash_v2_5` |
| `speed` | `bundle.voice_speed` clamped to 0.7 to 1.2, default 1.0 |
| `stability` | `1 - voice_temperature / 2` clamped 0 to 1, default 0.5 |
| `similarity_boost` | 0.75 |

Legacy catalogue (hosted-platform id to ElevenLabs public premade voice and OpenAI
Realtime preset):

| Legacy id | Gender | ElevenLabs premade | OpenAI Realtime voice |
|---|---|---|---|
| `11labs-Cimo` | F | Sarah `EXAVITQu4vr4xnSDxMaL` | marin |
| `11labs-Grace` | F | Rachel `21m00Tcm4TlvDq8ikWAM` | marin |
| `11labs-Hailey` | F | Matilda `XrExE9yKIg1WjnnlVkGX` | marin |
| `11labs-Kathrine` | F | Alice `Xb7hH8MSUJpSbSDYk0k2` | sage |
| `11labs-Kate` | F | Alice | sage |
| `11labs-Chloe` | F | Matilda | coral |
| `11labs-Hailey-Latin-America-Spanish-localized` | F | Matilda | marin |
| `11labs-Nico` | M | Adam `pNInz6obpgDQGcFmaJgB` | cedar |
| `11labs-Andrew` | M | Brian `nPczCjzI2devNBz1zQrb` | cedar |
| `11labs-Brian` | M | Brian | cedar |
| `11labs-Ethan` | M | Daniel `onwK4e9ZLuTAKqWW03F9` | ash |
| `11labs-Gilfoy` | M | Chris `iP95p4xoKVk53GoZ742B` | ash |
| `11labs-Joe` | M | Adam | cedar |

Unknown id: female default (Sarah / marin) unless the id matches a male-name regex,
then male default (Adam / cedar). The mapping was chosen by ear; re-listen before
relying on it. OpenAI Realtime presets judged most human: `marin` (female), `cedar`
(male).

## 5. Voice cloning (Cartesia, self-serve, instant)

1. The operator records in the browser (MediaRecorder) or uploads a file, ticks a
   consent statement, names the voice and picks a gender.
2. The UI sends base64 JSON to `POST /api/voice-agent/voices/clone` (gated by the same
   per-business switch).
3. The app server checks size (2 KB to 16 MB) and that consent is present, then posts
   multipart (`clip`, `name`, `language`, `description`) to Cartesia
   `POST /voices/clone`. The returned `id` is usable at once (no training wait).
4. It stores the id in `voice_agent_cloned_voices` with `consent_text` and
   `consent_at`. The voice appears in the picker as `cartesia:<id>:<gender>`.
5. If Cartesia succeeded but the insert failed, the voice exists upstream but not in
   the app: reported as `voice_agent_clone_store_error`. There is no clean-up of the
   orphaned upstream voice (not covered by the reference implementation).

Cloning on the speech-to-speech engine (OpenAI Custom Voices) was sales-gated when
researched (eligible customers only, max 20 voices per org, a verbatim consent
recording required). The reference does not implement it. ElevenLabs instant cloning
was the earlier plan for the chained engine and was replaced by Cartesia.
