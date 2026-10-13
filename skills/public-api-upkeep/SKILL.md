---
name: public-api-upkeep
description: How to design a PUBLIC DEVELOPER API for a multi-tenant SaaS (the keyed REST API external developers, partners and AI agents call to read and write one customer's data) and the mandatory upkeep checklist for keeping it in lockstep with the product, its docs, its public spec repo, its outbound webhooks/events, and the agent skill shipped to API consumers. Read this WHENEVER you (1) build or change a capability an external integrator might want, so you decide whether to expose it and wire it end to end; (2) touch API-key auth, scopes, tenant guards, idempotency, rate limiting, the versioned API routes, the developer/API-keys settings page, or the API docs site; (3) add or change an endpoint, a scope, a webhook event, or the OpenAPI spec; (4) the owner says "wire it into the API", "expose this over the API", "does the API cover this", "add an API endpoint", "add a webhook", "let agents use our API", or asks how a developer would do X programmatically. Triggers: public API, developer API, API key, scopes, /api/v1, OpenAPI, API docs, API reference, idempotency key, cursor pagination, rate limit, outbound webhooks, webhook signing, event push, headless mode, llms.txt, "copy for LLM", agent skill for our API, SKILL.md for consumers.
---

# Public Developer API: how to build it, and how to keep it complete

> ## Adapt before use
> This describes how a public API SHOULD be wired, taken from a production
> multi-tenant SaaS. File, table, function and scope names below are EXAMPLES of
> the shape. Grep the current repo before citing any of them. The ONE source of
> truth for the contract is the repo's OpenAPI spec; when this file and the code
> disagree, the code wins. Once the real API exists here, replace the examples
> with the real file map and the real scope-to-endpoint table.

## What this is (and is NOT)

A **public, versioned, per-tenant REST API** so external developers, partner platforms and AI
agents can read and manage one customer's data programmatically. It is the keyed front door to the
same capabilities the app itself uses.

- It IS: `/api/v1/*`, authenticated by a per-account API key sent as a bearer token, scoped,
  rate-limited, publicly documented.
- It is NOT the app's anonymous public endpoints (unguessable-token pages a guest uses with no
  key). It is NOT the logged-in user's routes. It is NOT some other dormant "api_keys" table left
  in another service. Those are separate things; do not conflate them, and do not reuse one's
  auth for another.

**Mental model of a key: a key is a robot credential, NOT a logged-in user.** It carries its own
**scopes** (what it may do) and its own **location / sub-tenant scope** (which parts of the account
it may touch), both chosen by an owner or admin at mint time. It does not "act as" any person and
does not carry a human role. Capability = scopes on the key. Who can mint = owner/admin.

## The architecture (five layers)

```
Client (curl / SDK / LLM agent)
   |  Authorization: Bearer <prefix>_live_...
   v
/api/v1/*
   |  cors -> json -> request id -> key auth -> rate limit -> router
   v
key auth middleware
   |  hash the key -> key row -> sets the request context:
   |    { keyId, accountId, scopes[], locationIds[], allLocations, environment, rateLimitPerMin }
   v
handler
   |  requireScope(...) -> assertLocationInScope(...) -> reuse the existing service
   |  account and location come ONLY from the request context (never the request body)
   v
the existing service layer, running with the service role
```

The pieces to build, one small module each:

| Module | Role |
|---|---|
| key auth | Bearer-key middleware. Hashes the key, loads the key row, sets the context. Cache POSITIVE lookups only, throttle the "last used" write, and expose an invalidate call for revoke. |
| tenant guards | `requireScope`, `assertLocationInScope`, `scopedLocationIds`, `assertNoForeignAccount`. **This is the ONLY tenant defense** (see hard rule 1). |
| errors | ONE envelope: `{ error: { type, code, message, param?, request_id } }`. Consumers branch on `type`, switch on `code`, and quote `request_id` to support. |
| rate limit | Per-key token bucket, default per-minute limit on the key row, standard rate-limit headers and `Retry-After` on 429. An in-memory bucket is correct ONLY while the server is a single instance. Leave that caveat as a comment at the code. |
| idempotency | `Idempotency-Key` on creates: replay if seen, else do the work and record the response (status + body), unique per account + key. |
| helpers | async-handler wrapper, request-id middleware, limit parsing, cursor encode/decode. |
| router | Every endpoint, each the same four moves: context -> scope -> reuse service -> clean shape. |
| key management | Mint / list / revoke for the customer's owner or admin, behind the normal logged-in auth, NOT behind key auth. |

Key storage (example shape): account id, a short visible prefix, a SHA-256 hash of the key (never
the key), scopes, location scope, an all-locations flag, environment, per-minute rate limit, last
used, expires, revoked.

Customer-facing UI: one Developers / API Keys page, owner and admin only, with a scope picker that
reads from the SAME scope list the server validates against.

## THE HARD RULES (violating these ships a security hole)

1. **Tenant comes ONLY from the key.** Every handler reads the account and location from the
   request context. NEVER trust an account or location id in the request body or query. If one is
   present, it must equal the key's. The API runs with the service role, which BYPASSES row-level
   security, so there is NO database backstop. Code is the only isolation.
2. **Every query in every handler ANDs the account filter**, plus a location filter from the key's
   scoped locations for location-aware reads. A missing account filter on this path is a full
   cross-tenant leak. This is the #1 audit item. Row-level security will NOT save you here.
3. **Reuse the service layer; never reimplement business logic.** Creates go through the same
   service the app uses, tagged with a source of "api" and the same safe policy the public
   customer-facing flow uses: no overbooking / no overriding rules, and a hard conflict returns
   `409`. Matching and de-duplication go through the same matcher the app uses.
4. **BUT an existing database function that gates on the logged-in user CANNOT be reused on the
   API path.** The API has no logged-in user, so a function that starts with "if no user, raise
   not authenticated" will THROW. For those, write a service-role-safe TWIN that:
   - takes the account EXPLICITLY (from the verified key),
   - re-implements the SAME eligibility guards (pull the live body and mirror each check; do not
     work from memory),
   - records the actor as null (no human did this),
   - is executable by the service role ONLY (revoke from public, anonymous and logged-in roles,
     then verify the grants on the live function).
   The handler still asserts account and location scope before calling it.
5. **Every create honors `Idempotency-Key`** (replay if seen -> do the work -> record the result).
6. **Money is integer cents, times are ISO 8601 UTC, lists are cursor-paginated**
   (`{ data, next_cursor }`, a null cursor means the end).
7. **Only owner/admin mint keys.** The full key is shown ONCE at creation. The hash is never
   returned. Revocation is instant (invalidate the cache).
8. **The spec is the source of truth.** An endpoint that exists in code but not in the OpenAPI
   spec (or the reverse) is a drift bug. Update both in the same change.
9. **Within a version, only additive changes.** Say so in a versioning page and keep a changelog.

A `/ping` endpoint that any valid key can call and that echoes back what the key can do (account,
environment, scopes, locations, request id) is the cheapest support tool you will ever build.

## The docs pipeline: one spec, everything else generated

```
spec/openapi.yaml   <- the ONE source of truth
   |- generator script A -> the reference pages (with a playground). NEVER hand-edit these.
   |- generator script B -> the distributable agent skill (SKILL.md + reference/endpoints.md + zip)
docs site -> static host -> the public developer docs domain

PLUS a separate PUBLIC repository developers read and file issues against:
   spec/openapi.yaml       -> openapi.yaml
   guide pages (MDX)       -> docs/*.md   (plain Markdown, JSX stripped so it renders on the host)
   generated agent skill   -> skill/
   + a hand-maintained README with a Scopes table and an Endpoints-overview table
```

**The public repo is where drift actually happens.** In the reference system there was no sync
script: the copy was manual, and the public repo was a version behind the product the moment an
endpoint shipped and nobody copied it. Even inside that repo two files disagreed: the README's
scope table listed scopes that the shipped skill's scope table did not. Either automate the sync
or treat it as a checklist step you never skip (step 8 below). The hand-edited README tables are
the row people skip.

**Never commit a real key or any secret into the public repo.** Examples use obvious placeholders.

## Ship an agent skill WITH your API docs

Integrators increasingly point an AI agent at your API. Give that agent one file that makes it
correct on the first call. This is cheap because it is generated from the spec.

What the shipped skill contains (it is written TO the consumer's agent, not to yours):

1. **Frontmatter** with a `name` and a `description` that says what the API does and lists trigger
   phrases in the consumer's words ("book an appointment", "check availability", the key prefix).
   Add license and homepage/repository metadata.
2. **What the product is**, in three sentences. An agent with no context needs the nouns.
3. **Authentication**: the header, where a key is minted, that a key is bound to one account and
   carries scopes plus a location scope, that it is a robot credential, never to put a live key in
   client or mobile code, and what `401` vs `403` mean.
4. **The scope table**, and "ask the account owner to mint a key with exactly the scopes you need."
5. **Conventions in one list**: base URL, cents, UTC, the error envelope and how to branch on it,
   cursor pagination, idempotency on creates, the rate limit and its headers.
6. **The FULL endpoint catalog** as one table (method, path, one-line summary), with full detail in
   a bundled `reference/endpoints.md`. One file must be enough to use the API.
7. **Common recipes** as numbered steps for the 3 or 4 real jobs, each with its failure branch
   (for example: check availability, then create, send an idempotency key, and a `409` means the
   slot was taken between the two calls, so re-fetch). Recipes are what stop an agent from
   inventing a flow.
8. **Where to find more**: the live docs, the raw spec URL, the guides, and the LLM indexes.
9. **How to install it**, for every kind of agent: read it straight from the public repo's raw URL
   (no download), download the zip into a skills directory, paste it into a rules file or an
   `AGENTS.md`, or paste it into a chat. Author it to the open agent-skills format (plain Markdown
   with YAML frontmatter) so it works in any agent that reads a skills directory.

Alongside the skill, make the docs themselves agent-readable:

- A **"Copy for LLM" / copy-Markdown button** on every page, and each page's raw Markdown at a
  stable URL (append `.md`).
- **`llms.txt`** (a compact index of the site) and **`llms-full.txt`** (every page concatenated,
  ready to paste into a context window).
- An "Use with an AI agent" guide page that says: give the agent the key as an environment
  variable, never inline; mint a DEDICATED key for the agent with only the scopes it needs; revoke
  it if anything looks wrong.

Regenerating the skill is part of every endpoint change. Confirm the new endpoint appears in the
generated endpoint reference before calling the change done.

## THE UPKEEP CHECKLIST (the reason this skill exists)

When you build or change ANY capability an external integrator might want to do programmatically,
decide whether the API should cover it. If yes, wire it end to end. Do NOT leave the API behind
the product.

1. **Endpoint.** Add the handler following the pattern: context -> `requireScope` ->
   `assertLocationInScope` where a location is involved -> reuse the existing service -> return
   the clean shape. Creates: wire `Idempotency-Key`. Writes: the safe policy, hard conflicts.
2. **Scope.** If it needs a new scope, add it to the valid-scopes list AND document it. If an
   existing scope fits, reuse it.
3. **Spec.** Add the path, schemas, examples and EVERY error to the OpenAPI spec. Then regenerate
   the reference pages and the agent skill. Do not hand-edit generated files.
4. **Guide (if it introduces a concept).** A new noun or a new flow a developer must understand
   gets a guide page and a nav entry.
5. **Agent skill.** It regenerates from the spec in step 3. Confirm the endpoint is in the
   generated catalog, and add a recipe if the flow is not obvious.
6. **Customer UI.** A new scope must appear in the key page's scope picker. A new endpoint under
   an existing scope needs no UI.
7. **Verify.** Smoke-test the endpoint against the live system with a real key minted from the
   key page, including a cross-tenant attempt that must fail, and confirm the docs build passes.
8. **Publish to the public repo.** Keep all four in lockstep: the spec (whole file), the guides you
   added or changed (as plain Markdown), the regenerated skill folder, and the README's Scopes and
   Endpoints-overview tables BY HAND. It is a different repository, so committing and pushing
   there needs its own explicit request from the owner, like any other commit.
9. **Events.** If the capability creates a state change an integrator would want pushed, add or
   extend a webhook event (next section) and document it.
10. **Deploy** is the owner's call, per the repo's release rules.

If the capability should NOT be in the API (internal-only, admin-only, money not yet in scope),
say so explicitly. That is a valid answer. But make the decision; do not silently skip it.

## Outbound webhooks (events pushed to the integrator)

The shape that worked in production:

- **Fan out from an event outbox**, not from request handlers. One engine reads the outbox and
  writes a delivery row per (endpoint, event), deduped by a unique constraint on that pair.
- **Sign every delivery** with HMAC-SHA256 over the body using a per-endpoint secret the customer
  can rotate.
- **Retry with exponential backoff**, and track health per endpoint: count consecutive failures,
  notify the account owner, and auto-disable after a small number in a row (three in the
  reference system) so a dead URL does not retry forever.
- **Event names are `noun.verb`** (created, cancelled, rescheduled, completed, and so on), with
  `"*"` meaning all.
- **Enrich the payload at fan-out** with the fields an integrator needs to match the record on
  their side (the contact id plus normalized phone, email and name), so they do not have to call
  back for every event.
- **Emit from the WRITER level for anything money-related.** Reliable payment events came from a
  trigger on the payments table that fires on every processing path. Emitting from one handler
  misses the other paths.
- **Management API mirrors keys:** owner/admin only; create, list, delete, rotate secret, list
  recent deliveries, and a **send test event** action that posts a signed test payload so the
  customer can verify reachability before going live.
- **An event that is defined but that no writer emits is a known gap, not a feature.** Write it
  down as a follow-up next to the event list (the reference system had exactly one: a refund
  event defined and documented before any writer fired it).

## Headless mode (not an endpoint, but integrators rely on it)

An integrator who owns all customer communication in their own platform needs the app to stay
silent. Provide ONE master switch (account-wide, plus a per-location override) that silences EVERY
app-to-end-customer message: texts, email, chat channels, AI, reminders, confirmations, review
requests, greetings, automations.

- Implement it as ONE gate function called by every send path, not a check sprinkled per feature.
  A new channel that forgets the gate breaks the promise.
- Staff notifications and platform-to-customer-account mail are NOT affected.
- Surface it at the top of the automatic-messages settings page.

## Docs site essentials (gotchas that cost real time)

- A **client-rendered single-page build that prerenders only the resource routes** (the search
  index, `llms.txt`, `llms-full.txt`, per-page Markdown) is deliberately more robust than
  prerendering every HTML page. The full HTML prerender was heavy (syntax highlighting) and
  fragile across build runners. If the framework has client loaders, keep the docs route on one;
  converting it back to a server loader breaks the no-SSR build.
- **Pin the Node version** in a version file AND in the host's build settings. The framework's
  minimum moved and the host's default was older.
- **Know the build output directory.** It is not always `dist`; a wrong one deploys an empty site.
- **A docs site inside a monorepo with a different major version of the UI framework** needs
  explicit dedupe and aliasing in its bundler config. Do not remove those when "cleaning up".

## Deferred on purpose (decide, write down, do not half-build)

Money-moving endpoints, OAuth, and a real sandbox/test environment were deliberately NOT in the
first version. A first version that reads and manages safely is shippable; a first version that
moves money with no sandbox is a liability. Record what is deferred and why in the plan doc.

## Common questions, answered from the model

- **"Where does a customer get a key?"** The Developers / API Keys page. Owner or admin only.
- **"Read-only vs read/write key?"** Scopes are per key; a read-only key gets only `read:*`.
- **"Does it respect roles / row-level security?"** A key is not a user. It carries scopes plus a
  location scope, not a role. Isolation is enforced in code, not by the database.
- **"Can the API do X?"** Check the scope-to-endpoint table and the spec. If X is not there and an
  integrator would want it, that is an upkeep gap: run the checklist.

Related skills: `security-rls-permissions` (why the service role bypasses row-level security),
`review-build` (the post-build gate that asks whether the API needs extending),
`help-center-upkeep` (customer docs, as opposed to developer docs).
