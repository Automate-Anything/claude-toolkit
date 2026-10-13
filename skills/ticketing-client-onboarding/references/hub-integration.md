# Meridian ticket-hub integration contract (what a client app implements)

The client app never talks to the hub from the browser. The browser widget calls
the **client app's own backend**, which holds the hub API key server-side and
proxies to the hub. The client app also exposes a **webhook receiver** the hub
calls when a ticket changes. Hub base path: `/api/v1/tickets` on the Meridian web
service (`MERIDIAN_URL`).

> Verified against the built hub (Meridian `apps/web/src/app/api/v1/tickets/*`).
> Two known gaps are called out inline - plan for them.

## Auth (every hub call)
- Header `Authorization: Bearer <mer_…>` - a per-client-app key (see onboarding
  `SKILL.md` step 1). Keep it in the client app's server env only.
- Errors come as `{ "error": { "code", "message", "details?" } }`. Key on `code`,
  not HTTP status: `unauthorized|forbidden|not_found|validation_error|rate_limited|conflict|service_unavailable|internal`.
- Rate limit: 60 req/min per key; responses carry rate-limit headers - self-throttle.
- **Tenant isolation is by API key**: every read/write is scoped to the key that
  created the ticket (`app_key_id`). One client app = one key = its own ticket space.

## Submit flow (widget → app backend → hub)
1. **Create** - `POST /api/v1/tickets` (scope `tickets:write`), JSON:
   ```json
   { "title": "…(required, 1-300)",
     "body": "…(≤20000)",
     "type": "bug|feature_request|question|other",       // default bug
     "priority": "urgent|high|medium|low",                 // default medium
     "reporter_name": "…", "reporter_email": "…",
     "reporter_context": { "url": "...", "app_version": "...", "browser": "...", "os": "...", "user_id": "..." } }
   ```
   Send `Idempotency-Key: <opaque, ≤255, no whitespace>` so a retry can't double-file
   (24h TTL; replay returns the same body + `Idempotent-Replayed: true`).
   **Do NOT send `company_id`** - the hub ignores it (staff assign the company at
   triage). The hub stamps `app_key_id` + `reporter_kind:"client_widget"`.
   Response `201`: `{ "id": "<uuid>", "display_id": "TKT-00042", "status": "new" }`.
   Show `display_id` to the user.
2. **Attach each file** - `POST /api/v1/tickets/<id>/attachments` (scope
   `tickets:write`), **`multipart/form-data` with a single field `file`**. (Not
   base64, not a signed URL - the browser sends the file to your backend, your
   backend forwards it as multipart.) Limits: **25 MB/file**; MIME must be
   `image/*`, `video/*`, `text/*`, or one of pdf/zip/doc/docx/xls/xlsx/octet-stream.
   Response `201 { "id": "<uuid>" }`. Screenshots from the snip go here.
3. Post-create edits: `PATCH /api/v1/tickets/<id>` (title/body/type/priority/status;
   illegal `status` transition → `422`). Reply/question from the client:
   `POST /api/v1/tickets/<id>/comments` `{ "body": "…", "author_kind": "client" }`.

Reads (for a "my tickets" view): `GET /api/v1/tickets` (this app's tickets),
`GET /api/v1/tickets/<id>`, `GET /api/v1/tickets/<id>/comments` (scope `tickets:read`).

### Minimal backend proxy (any stack - shape, not literal)
```
POST /api/support/ticket        # your app; session-authed as the end-user
  → create ticket at hub with Bearer key + Idempotency-Key
  → for each uploaded file: multipart POST to /tickets/<id>/attachments
  → return { display_id } to the widget; store a local mirror row (hybrid)
```
The key lives in the backend; the browser only ever hits your own route.

## Receive flow (hub → app webhook)
The hub POSTs to a per-app URL when a ticket changes so the end-user sees updates.
- **Events**: `status_changed`, `assigned`, `fields_changed`, `comment`.
- **Payload**:
  ```json
  { "event_id": "<uuid>", "event": "status_changed|assigned|fields_changed|comment",
    "occurred_at": "<ISO8601>", "hub_ticket_id": "<uuid>", "display_id": "TKT-00042",
    "status": "...", "priority": "...", "type": "...", "title": "...",
    "comment": { "body": "...", "author_kind": "staff" } }   // on comment events
  ```
- **Signature** - header `x-meridian-signature: t=<unix-seconds>,v1=<hex-hmac-sha256>`.
  Verify BEFORE trusting: recompute `HMAC_SHA256(secret, `${t}.${rawBody}`)` over the
  **raw request bytes** (not re-serialized JSON), compare with `timingSafeEqual`, and
  reject if `|now − t| > 300s` (5-minute replay window). Same scheme as Stripe.
- **Dedup**: ignore a repeat `event_id` (delivery is best-effort - **2 attempts, 5s
  timeout, no backoff, no dead-letter**, so occasional dupes/misses are possible;
  make the receiver idempotent and, for critical state, also poll `GET /tickets/<id>`).
- On receipt: update your local mirror + reflect status/reply to the end-user.

## Onboarding gaps to plan around (verified in the build)
1. **Webhook registration has no admin UI yet** - the down-webhook URL + secret must
   be inserted by an admin via SQL (envelope-encrypted secret). See `SKILL.md` step 3
   for the exact statement. Until a UI ships, this is a manual onboarding step.
2. **API-key creation currently requires an associated admin/dev user** (or the
   `act_as_developer` scope). When minting a client-app key, associate it with the
   automation/admin account. See `SKILL.md` step 1.
3. **Ticket→company binding is manual at triage** - the API forces `company_id=null`
   on create; a staffer sets the company when triaging. Register the app's webhook row
   with the correct `company_id` so routing/reporting knows the tenant, and adopt a
   triage convention to set `tickets.company_id` promptly.
4. Migration `0162` (+ `0163`, `0167`) must be applied and DB types regenerated on the
   hub before these endpoints work - operator step, not auto-run.

## Enums (authoritative)
- `type`: bug · feature_request · question · other
- `priority`: urgent · high · medium · low
- `status`: new · triaged · in_progress · in_review · needs_client_input · blocked · done · wont_do
  (terminal: done, wont_do; transitions validated server-side - a client only ever
  sets status via PATCH and must respect the returned 422 on an illegal move).
