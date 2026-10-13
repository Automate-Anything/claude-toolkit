# Evolution WhatsApp: isolated test rig + findings

Stood up 2026-08-26 to prove the self-hosted Evolution WhatsApp integration end to end
**without touching dev, prod, or WHAPI**. Everything below is a throwaway, isolated
environment. Evolution stays dormant on dev and prod (its env vars are set ONLY on the
test billing service named here).

This doc exists so anyone picking the project up knows exactly what runs where, how to
reach it, and what still has to be fixed before it can go near a customer.

> No secret values are stored in this file. API keys and connection strings live in the
> Render service environments and in `evolution/GO_LIVE_CHECKLIST.md`.

---

## 1. The servers (Render workspace "My Workspace", region Virginia)

| Service | Kind | Public URL / ID | What it is |
|---|---|---|---|
| `evolution-api-whatsapp` | Docker web service | https://<your-evolution-service>.onrender.com | The Evolution engine (the WhatsApp gateway). Image `evoapicloud/evolution-api` pinned by digest. Listens on 8080, health path `/`. Admin UI at `/manager`. |
| `app-server-test-clone` | Node web service | https://<your-test-app-server>.onrender.com | A FULL clone of the dev billing-server, the only place Evolution is switched on. Health path `/health`. Crons are OFF here. |
| `evolution-postgres` | Postgres 16 | `<render-postgres-id>` | Evolution's session + message store. Its internal URL feeds `DATABASE_CONNECTION_URI`. |
| `evolution-redis` | Key Value (Valkey 8) | `<render-redis-id>` | Evolution's cache. Its internal URL feeds `CACHE_REDIS_URI`. |

**Branch:** `evolution-whapi-replacement-test` (cut from `dev`). The test billing service
auto-deploys from it. It is `dev` plus this doc, nothing else.

---

## 2. How to access / drive it (no frontend required)

Auth headers:
- **Evolution API:** header `apikey: <AUTHENTICATION_API_KEY>` (value in the Evolution
  service env and in GO_LIVE_CHECKLIST.md).
- **Billing internal endpoints** (`/api/whapi/send-message`, `/api/whapi/mark-read`,
  `/api/whapi/presence`): header `Internal-Secret: <INTERNAL_API_SECRET>` (same value as dev).
- **create-channel** (`POST /api/whapi/create-channel`): NO auth, trusts `company_id` in the
  body (pre-existing WHAPI IDOR pattern, see finding 7). **create-qr** needs an operator JWT.

Connect a WhatsApp (what the operator UI does, done by hand here):
1. `POST /api/whapi/create-channel` with `{company_id, location_id, channel_name}` on the
   billing service, returns the Evolution instance name (e.g. `bp_<company>_<seed>`).
2. `GET <evolution>/instance/connect/<instance>` with the `apikey` header, returns a base64
   QR PNG. Scan it from the phone: WhatsApp, Settings, Linked Devices, Link a Device.
3. `GET <evolution>/instance/connectionState/<instance>` flips to `open`; in the DB,
   `whatsapp_channels.connection_state` becomes `connected` and the phone number is learned.

Useful checks:
- Inbound / outbound land in `public.chat_messages` (filter `business_phone_number` =
  the connected number). Read them with `py scripts/execute_sql.py`.
- Media for a message: `POST <evolution>/chat/getBase64FromMediaMessage/<instance>`.

---

## 3. Environment that actually matters (the config lessons)

**On `evolution-api-whatsapp`:**
- Image: `evoapicloud/evolution-api` (the old `atendai/...` image is delisted, see finding 1).
  Pin by digest, not `:latest`.
- `CONFIG_SESSION_PHONE_VERSION` = a CURRENT WhatsApp-Web version (else WhatsApp rejects the
  link with "couldn't link device"). Bump it whenever WhatsApp rotates.
- `DATABASE_SAVE_DATA_NEW_MESSAGE=true` (REQUIRED, see finding 3). With `false`, Evolution
  does not keep messages, so media/voice download fails with "Message not found".
- The `DATABASE_*` / `CACHE_REDIS_*` block per GO_LIVE_CHECKLIST.

**On `app-server-test-clone`:**
- The full dev billing-server env, PLUS: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`,
  `EVOLUTION_INBOUND_WEBHOOK_URL` (points at THIS service's `/api/evolution/inbound`),
  `WHATSAPP_NEW_CHANNEL_PROVIDER=evolution`.
- `OPENAI_API_KEY_VOICE_TRANSCRIPTION` (was missing from the copied dev env, see finding 4).
- Leave `RUN_CRONS` and `CRONS_ONLY` UNSET. That is what keeps crons off and makes this
  clone safe. Confirmed in logs: `Skipping cron registration (RUN_CRONS!=true)`.

---

## 4. What was proven working (end to end, through our code + DB)

- Connect / QR pairing, `connection.update` webhook, DB flips to connected, number learned.
- Inbound text (normalized into the same pipeline as WHAPI, Hebrew / emoji intact).
- Outbound text (our `sendText` path, delivered, real message id).
- Auto mark-read (read receipts via the provider-aware function).
- Per-channel PROXY (2026-09-01): each channel claims its own dedicated IPRoyal
  ISP IP at connect (`EVOLUTION_PROXY_MODE=required`) and egresses through it.
  Proven: one test channel claimed 203.0.113.10; IPRoyal DATA USAGE for that IP
  shows traffic to web.whatsapp.com from the moment it connected. See
  `PROXY_PER_CHANNEL_PLAN.md` (T1-T5 done). Ban isolation between merchants achieved.
- Delivery / read TICKS (2026-08-31): `messages.update` now maps the Baileys ack
  (SERVER_ACK/DELIVERY_ACK/READ/PLAYED/ERROR) into the SAME provider-agnostic
  writer WHAPI uses (`applyOutboundDeliveryStatus`), so outbound bubbles show
  the ✓ / ✓✓ / blue ✓✓ exactly like WHAPI. Zero frontend change (the inbox
  already renders ticks from `chat_messages.delivery_status`). NEEDS a live
  end-to-end confirm (send from the app, watch the tick advance).
- Voice note: audio fetched from Evolution and transcribed by Whisper (after fixes 3 + 4).
- Inbound image: fetched + stored (`runMediaPipeline`), proven end to end 2026-08-27.
- **Dead-instance / stale-mapping class fixed + proven (2026-08-27).** Root cause of a full
  debugging session: four `communication_map` rows for one phone, the resolver tied and picked one
  bound to a DELETED channel, so every media fetch named a dead instance and Evolution returned a
  permanent 404 while inbound text kept working. Fixes, all on `evolution-whapi-replacement-test`:
  - `<commit>` 404 = dead instance (bail + alert), 400 = store lag (retry). The retry had them
    backwards, so a stale name burned the whole backoff and parked media `pending` forever.
  - `<commit>` writer fix: `createEvolutionChannel` reattaches a comm_map row pointing at a
    deleted/missing channel, not only a NULL-FK one (out-of-band deletes never null the FK).
  - `<commit>` guarantee exactly ONE live whatsapp comm_map row per location (retire the rest).
  - `<commit>` + `<commit>` before the 409/subscription gates, ask Evolution if the blocking
    instance still exists; if it vanished, retire it and let the connect proceed. Proven: deleted
    the instance out of band, hit create-channel with NO manual DB edit, it self-healed (retired
    the dead channel, reattached the same comm_map row, created the new channel, fired
    `evolution_instance_vanished`).

---

## 5. Must fix before go-live (punch-list)

1. **[DONE]** ~~Dead image.~~ Docs switched off the delisted `atendai/evolution-api` to
   `evoapicloud/evolution-api` (pinned by digest `sha256:9666...07252`, the v2.3.7 line) in
   `docker-compose.yml`, `render.yaml`, `GO_LIVE_CHECKLIST.md`, `HANDOFF.md`, `README.md`. Live
   service already runs it: `evolution-api-whatsapp` / `<render-service-id>`.
2. **[DONE (documented)]** ~~Stale version can't pair.~~ Image pinned by digest; the required
   `CONFIG_SESSION_PHONE_VERSION` (current WhatsApp-Web version, live e.g. `2.3000.1043857760`) is
   now in `render.yaml` + `docker-compose.yml` + the `GO_LIVE_CHECKLIST.md` paste block, with the
   "bump it whenever WhatsApp rotates" note in README/HANDOFF.
3. **[DONE (docs)]** ~~`DATABASE_SAVE_DATA_NEW_MESSAGE` must be `true`.~~ Corrected from `false`
   in `render.yaml`, `docker-compose.yml`, and the `GO_LIVE_CHECKLIST.md` paste block (live service
   already runs it true; media/voice proven in §4).
4. **[DONE]** ~~Missing `OPENAI_API_KEY_VOICE_TRANSCRIPTION`.~~ Prod has it (voice notes
   transcribe daily, verified 2026-10-12). A server without it is no longer silent: it raises a
   `config_missing` alert that names the Render service, and the note is saved as "transcript
   delayed" (`transcript_status='delayed'`) and finished by the `voice_media_backfill` cron once
   the key is set (nothing is lost).
5. **[DONE]** ~~Inbound media rejected: 100KB body cap.~~ Fixed: path-scoped
   `express.json({ limit: '2mb' })` on the route at `billing-server/src/index.ts:647`. (We also
   moved OFF inlined base64 entirely: the webhook is `base64:false` and media is fetched on demand
   by id, so the body stays tiny regardless. Verified: image inbound works end to end, 2026-08-27.)
6. **[DONE]** ~~Inbound non-voice media not downloaded.~~ Fixed: `runMediaPipeline`
   (`inboundMessageService.ts:404`) now downloads image/video/document via the same
   `downloadFromEvolution` path as voice. Verified: an inbound photo saved with
   `media_status='ready'` + `has_media=true`, 2026-08-27.
7. **Two HTTP endpoints not Evolution-aware.** `/api/whapi/mark-read` and `/api/whapi/presence`
   (`billing-server/src/routes/whapi/actions.ts`) still call the WHAPI gate and 404 for Evolution
   channels. They are the retired n8n endpoints, verify no live caller; branch to Evolution if used.
8. **Deploy-time message loss (operational).** Each Evolution redeploy causes a brief
   "conflict: replaced" reconnect storm; messages sent in that window can be lost. Deploy
   deliberately / off-peak. Use a paid Render plan, the Free plan spins down and drops the session.
9. **Reconciler cron (build before scaling past a couple merchants; NOT urgent for the pilot).**
   Nothing periodically compares Evolution's live instance list against our
   `whatsapp_channels` rows. If an instance is DELETED (not just disconnected) out of band and
   nobody adds/reconnects a channel, the DB row keeps reading `active`/`deleted_at IS NULL` and
   the channel sits silently dead. The interactive create-channel path now SELF-HEALS this (it
   reconciles vanished instances before its gates, retires them, and alerts, commit `<commit>`),
   and a single merchant notices the total inbound blackout quickly, so this is low-stakes at
   pilot scale. The real gap it closes: an Evolution service rebuild / Postgres-volume wipe
   deletes EVERY instance at once, silently, and without a sweep we only learn as complaints
   trickle in over days. Build: a cron in `billing-server/src/jobs/` that calls
   `evoListInstances()`, diffs vs `whatsapp_channels WHERE provider='evolution' AND deleted_at IS
   NULL`, and for any row whose instance is gone marks it `connection_state='needs_qr'` (so the
   operator UI shows "reconnect") and fires ONE `evolution_instance_vanished` alert. Reuse the
   retire cleanup already in `createEvolutionChannel` (the reconcile block) and
   `deleteEvolutionChannel`. Same fail-safe rule: only act on a DEFINITIVE list (a successful
   `evoListInstances`); on API error do nothing. Gate it behind `RUN_CRONS` like the other jobs
   so it stays OFF on the test service. (Reasoned through with the owner 2026-08-27: deferred in
   favor of the per-channel proxy, section 6, which is needed before merchant #2 regardless.)

---

## 6. Per-channel IP / ban risk (NOT active yet, must build before merchant #2)

**Right now EVERY connected phone egresses from the SAME IP** (the Evolution host's Render IP).
There is no per-channel IP yet. At scale this is a ban risk: if WhatsApp flags that one shared IP,
every merchant on it goes down together.

- Built: `whatsapp_channels.evolution_proxy_url` + `evoCreateInstance` passes `proxy: { url }` at
  create time when a channel has one.
- NOT built: the assignment/pool that actually gives each channel a proxy, so today every channel
  falls back to the shared host IP.
- Safe ONLY for this owner-only, single-number test (1 IP, low volume, + the provider-agnostic
  rate caps in `billing-server/src/whapi/safety.ts`).

**Requirement before a second, real merchant connects:** each channel on its OWN static (sticky)
residential/mobile IP. NOT datacenter (WhatsApp flags those), NOT rotating (breaks the companion
link). ~$2 to $6 per IP per month, still cheaper than WHAPI.

Minimum viable build (T1 to T5 of `PROXY_PER_CHANNEL_PLAN.md`, full detail there):
- T1. Buy a static-residential/mobile proxy pool; capture the per-IP `host:port:user:pass` format.
- T2. Table `evolution_proxies` (id, proxy_url, status, assigned_channel_id, ...), service-role
  RLS only (the URLs carry credentials).
- T3. Claim a free proxy atomically at connect, write it to `evolution_proxy_url`, pass it to
  create. If none free, FAIL LOUDLY, never fall back to the shared IP once proxy mode is on.
- T4. Release the proxy back to the pool on channel delete/disconnect.
- T5. `EVOLUTION_PROXY_MODE` env flag ('off' default | 'required'). (T6 to T8: health cron,
  superadmin view, backfill, in the plan doc.)

---

## 7. Teardown

When the rig is no longer needed: delete the two web services (`evolution-api-whatsapp`,
`app-server-test-clone`) and, if you want, the Postgres + Redis. The owner's
phone can be unlinked from WhatsApp, Linked Devices. Nothing customer-facing changes; Evolution
was never activated on dev or prod.
