# Evolution API - self-hosted WhatsApp (the WHAPI replacement)

This directory holds everything to run **Evolution API**, our self-hosted WhatsApp
backend that replaces WHAPI. It links a merchant's WhatsApp as a **companion
device** (the "Linked Devices" screen on their phone) over the Baileys
multi-device protocol, exactly like WHAPI did, but with **no per-channel fee** and
**no Chromium** (a session is a lightweight WebSocket, not a headless browser).

The billing-server integration is already built: a `provider` column on
`whatsapp_channels` (`whapi` | `evolution`) decides, per channel, which backend
serves it. New connections follow the `WHATSAPP_NEW_CHANNEL_PROVIDER` switch; every
existing WHAPI channel keeps working untouched. The frontend is unchanged.

---

## What runs where

| Piece | Where |
|---|---|
| Evolution API service (Docker image `evoapicloud/evolution-api`, pinned by digest) | **Dedicated Render web service** (NOT co-located with billing-server). Live: `evolution-api-whatsapp` / `<render-service-id>` / https://<your-evolution-service>.onrender.com |
| Session store (Postgres) | Render Postgres, **daily backups on** |
| Cache (Redis) | Render Key-Value |
| Provider adapter, inbound webhook, provisioning | already in `billing-server/src/whatsapp/` + `routes/evolution/` |

---

## 1. Local test (before touching Render)

```bash
cd evolution
cp .env.example .env
# edit .env: set EVOLUTION_API_KEY to `openssl rand -hex 32`
docker compose up -d
# Evolution is now at http://localhost:8080
```

Point your LOCAL billing-server at it by adding to `billing-server/.env.local`:

```
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=<the same key you put in evolution/.env>
EVOLUTION_INBOUND_WEBHOOK_URL=http://localhost:3001/api/evolution/inbound
WHATSAPP_NEW_CHANNEL_PROVIDER=evolution      # so a new connect uses Evolution
```

Restart billing-server. Now a new WhatsApp connect in the app creates an Evolution
instance instead of a WHAPI channel.

> Note: for INBOUND to reach a local billing-server, Evolution must be able to POST
> to your machine. Local-to-local (both in Docker/localhost) works. If you run
> Evolution on Render but billing-server locally, use a tunnel (e.g. cloudflared)
> and set `EVOLUTION_INBOUND_WEBHOOK_URL` to the tunnel URL.

---

## 2. Deploy to Render (production)

Either apply `render.yaml` as a Blueprint, or create by hand:

1. **New → Web Service → Deploy an existing image** → `docker.io/evoapicloud/evolution-api`
   pinned by digest (the maintained fork; `atendai` is delisted and its `v2.2.3` no longer
   pairs a device). Plan: **Standard** (sockets are memory-resident; scale up as merchants grow).
   Also set `CONFIG_SESSION_PHONE_VERSION` to a current WhatsApp-Web version or the link is rejected.
2. **New → Postgres** (`evolution-postgres`). Turn **daily backups ON**. Copy its
   Internal Connection String.
3. **New → Key-Value** (`evolution-redis`). Copy its connection string.
4. Set the web service's env vars (see `render.yaml` for the full list). The key ones:
   - `AUTHENTICATION_API_KEY` = `openssl rand -hex 32` (a long random value).
   - `SERVER_URL` = the service's public URL (or a custom domain like
     `https://evolution.example.com`).
   - `DATABASE_CONNECTION_URI` = the Postgres internal connection string.
   - `CACHE_REDIS_URI` = the Key-Value connection string.
5. Deploy. Confirm `GET https://<evolution-url>/` returns Evolution's info JSON.

Then set on the **billing-server** (dev service first, prod later):

```
EVOLUTION_API_URL=https://<evolution-url>
EVOLUTION_API_KEY=<same AUTHENTICATION_API_KEY>
EVOLUTION_INBOUND_WEBHOOK_URL=https://api.example.com/api/evolution/inbound
# leave WHATSAPP_NEW_CHANNEL_PROVIDER=whapi until you've tested; flip to evolution to cut over
```

---

## 3. Connect YOUR WhatsApp to test it

1. In billing-server env, set `WHATSAPP_NEW_CHANNEL_PROVIDER=evolution` (and the
   three EVOLUTION_* vars) and restart.
2. In the app, go to **Integrations → WhatsApp → Connect** exactly as normal. The
   UI is unchanged; it will show a QR code (this one is served by Evolution).
3. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device → scan**.
4. Watch it connect. Under the hood:
   - Evolution fires `connection.update` → billing-server sets the channel's
     `connection_state` to `connected` and learns your phone number.
   - The Integrations page flips to "connected" via the same realtime path WHAPI used.
5. **Test outbound:** send yourself (or the connected number send to a test contact)
   a message from the operator inbox. It goes out via Evolution.
6. **Test inbound:** message the connected WhatsApp from another phone. Evolution
   POSTs `messages.upsert` → `/api/evolution/inbound` → the normal inbound pipeline
   (contact upsert, session, AI agent) runs identically to WHAPI.
7. **Test voice:** send a voice note; the transcription pipeline fetches the audio
   from Evolution and transcribes it.

If anything fails, it's wired into the alert system - you'll get a ticket with the
exact `source` (`routes.evolution.inbound`, `createEvolutionChannel.evoCreate`,
`publicAvailability.union`, etc.). Check the engineering alerts portal.

---

## 4. The IP / ban-risk note (read before bulk migration)

All merchant sessions egress from the Evolution host's IP by default. At low volume
this is fine, and our existing anti-block safety caps (`billing-server/src/whapi/
safety.ts`) - which are provider-agnostic and still apply - are the real
protection. Before migrating MANY merchants off WHAPI, assign per-instance proxies
(each its own egress IP): the `evolution_proxy_url` column + the `proxy` field on
instance-create are already wired; populate `evolution_proxy_url` per channel and
it flows into Evolution at create time. Buy a residential/mobile proxy pool when
volume justifies it.

---

## 5. Cutover model (parallel, reversible)

- `WHATSAPP_NEW_CHANNEL_PROVIDER=whapi` (default): nothing changes.
- Flip to `evolution`: **new** connections use Evolution. Existing WHAPI channels
  keep running (their `provider` column stays `whapi`).
- Migrate an existing merchant by having them reconnect (which creates a fresh
  Evolution instance) - or leave them on WHAPI until they naturally re-pair.
- Roll back any time by flipping the switch back; both providers stay operational.

---

## Version pinning

The image is `evoapicloud/evolution-api` (the `atendai` image is delisted), pinned
**by digest** in `docker-compose.yml` + `render.yaml` - currently the v2.3.7 digest
`sha256:966625532d9076a2381e973a271307d107e6f070450de3abeeea8bd18be07252`. Do NOT
use `:latest` in prod - bump deliberately after testing. Session schema changes
across major Evolution versions; a surprise upgrade can drop links. When you bump
the image, also refresh `CONFIG_SESSION_PHONE_VERSION` to a current WhatsApp-Web
version (else pairing fails with "couldn't link device").
