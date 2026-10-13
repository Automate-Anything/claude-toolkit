---
name: ai-model-platform
description: How AI/model features should be configured, called, tuned, gated and cost-tracked in any app. Covers the feature_key contract (code defaults + a live tunable row + one telemetry stream + an optional billing path), keeping prompt/model/pricing as DATA not constants, the single wrapper every model call goes through, the connect-then-activate lifecycle with a visible "needs attention" queue, the two billing modes (billed per use vs platform-absorbed), the spend gate and 402 out-of-credit flow, usage rows and the billing job that debits a ledger, attribution for crons, kill switches, error classes, model slots with fallback legs, abuse caps for free features, provisioning provider keys by API, and the anti-patterns that silently lose money or telemetry. This is a pattern to BUILD per repository. Read it BEFORE building any feature that calls a model API, before adding a feature key, before wiring a prompt or a model choice, before designing the settings page that tunes them, and before touching AI billing. Use when the user mentions AI features, model calls, OpenAI, Anthropic, Claude, GPT, prompts, feature keys, token cost, model settings, AI usage tracking, AI credits, insufficient funds, a 402, spend limits, "which model", "what did AI cost us", or connecting/validating a provider key. For the agent architecture built on top of this, read `internal-ai-agent-architecture`.
---

# AI Model Platform

> ## ADAPT BEFORE USE: THIS IS A PATTERN, NOT INSTALLED CODE
> This describes how model features SHOULD be wired. It is taken from a production
> multi-tenant system that bills customers for AI usage, and from a second, smaller
> adaptation of the same design. Nothing here exists in your repo until you build it. The
> table, column, function and env var names are EXAMPLES of the shape (for example "a table
> like `ai_feature_config`"), not references. Grep before citing any of them. When this doc
> and real code disagree, the code wins: live-pull the function definition, the schema and
> the actual file rather than trusting any doc, including this one. Once built, update this
> skill with the real file and table names, and do NOT turn it into a registry of the
> current feature list. Lists of features, channels and flags grow; a hardcoded copy here
> silently rots. Point at the live source of truth instead.

Companion skills: `internal-ai-agent-architecture` (conversational agents built on this),
`error-alert-system` (where model failures land), `money-truth-doctrine` (if money moves).
Before writing provider-specific code, load the provider's own reference skill (for Claude:
`claude-api`), and never answer model ids or pricing from memory.

---

## 0. The mental model

An "AI feature" is a **feature key**: a stable string that ties four things together.

1. **Defaults in code**: model, system prompt, max tokens, response format, and pricing.
2. **A live, tunable row in the database**: per-feature overrides for all of the above, so
   the prompt and the model can be changed **without a code deploy**.
3. **A telemetry stream**: every call goes through ONE wrapper that writes one usage-event
   row (your cost book) and pages the team on an auth failure. Universal, whether or not
   anyone is billed.
4. **A billing path, only for features billed per use**: a credit gate before the call, a
   machine-readable out-of-credit response, and a usage row after success that a billing
   job later debits from a ledger.

The single most valuable idea, the one to keep even if you drop everything else:

> **Prompt, model and pricing are DATA, not constants.**

Hardcoding a prompt means every wording tweak is an edit, a restart and a commit. Storing
it in a row means it is tunable from a settings page while the app runs. For prompt-driven
features that is the difference between iterating in seconds and iterating in minutes.

**The code defaults still matter.** They are the fallback when no row exists and the
record of what the feature was designed with.

### Two billing modes (the distinction that matters most before you touch billing)

Every feature emits telemetry, but features fall into one of two billing modes. Confusing
them is how revenue leaks or customers get wrongly charged.

- **Billed per use** (the default for anything a user deliberately triggers). The route
  runs the credit gate, returns the out-of-credit response when empty, and inserts a usage
  row on success that the billing job debits.
- **Intentionally unbilled / platform-absorbed.** No credit gate and no usage row; the
  platform eats the provider cost on purpose. These features share one trait: they fire
  automatically on an inbound event or an internal step, not on a deliberate user action
  with a clear "you will be charged" moment, so a per-use charge would be surprising or
  unbillable. Their defaults carry a charge of zero while the true cost stays non-zero.
  Their cost is still captured in telemetry, so spend stays visible. Typical members: a
  conversational receptionist billed per inbound message at the channel level and never
  per token, transcription and speech, internal classifiers, and any free "sales weapon"
  feature such as a migration assistant.

Which mode a feature is in is a **product decision recorded in code**, not something to
infer from the feature's name. A feature is billed if and only if its call site has a
credit gate plus a usage-row insert, and its defaults have a non-zero charge. When in
doubt, read the call site.

---

## 1. Adding a feature: code ships it, a human finishes it

Shipping a new AI feature happens in two phases because some steps can only be done by a
human. That gap must be VISIBLE, not silent.

**Phase 1: code and a DB row ship; the feature appears NOT CONNECTED.**

The migration inserts the config row with a placeholder provider project id (for example
a `pending_` prefix) and inactive. The coding agent cannot create the real provider
project or set the production secret. So the moment the code lands:

- The feature appears on the settings page as a tinted row with a badge naming exactly
  what is missing:
  - **"Not connected"**: the project id is still the placeholder.
  - **"Missing API key"**: the env var named on the row is not set on the server.
  - **"Orphaned"**: the id is set but the provider's admin API says it does not exist
    (wrong id or deleted project).
- An attention dot appears on the navigation item. A row counts as "unconnected" if its id
  is still the placeholder OR its env var is known to be unset. It is deliberately **not**
  gated on the active flag: a brand-new feature is inactive by definition and the queue
  still has to show it.
- The activation switch is **locked off** until the feature can actually work. Do not let
  someone enable a feature that will fail on its first call.

**Phase 2: a human finishes the connection (what the dot is prompting).**

1. Create the provider project and a project-scoped API key.
2. Set the env var (named exactly as on the row) on EVERY environment's server and
   redeploy.
3. Paste the real project id into the row (editable only while it is still the
   placeholder) and save.
4. Click **Validate**: the server checks that the env var is present and that the key
   authenticates against the provider. On success, if the id is real and the row was
   inactive, it auto-activates.
5. The tint and the dot clear on the next load.

**Do not store a connection status.** Connectedness is recomputed live on every page load
from the env-var check and the id prefix. A stored status column goes stale the moment
someone edits the environment, and then the UI lies with confidence.

The division of labor is fixed: the agent does everything that can be done from code
(defaults, route, migration row, env var read in config) and leaves the feature in the
attention queue. The human does the three things code cannot: create the project, set the
secret, paste the id and activate. In a small single-machine app you need the badge and
the locked toggle; you do not need the cross-page notification plumbing.

---

## 2. The wiring layers (and what breaks when one is skipped)

| # | Layer | Shape | What happens if it is missing |
|---|---|---|---|
| 1 | **Defaults entry** | a defaults map keyed by feature key: model, system prompt, max tokens, response format, input/output CHARGE per 1M tokens, input/output COST per 1M tokens | In the original system the loader fell through to a stub (a cheap model, an empty prompt, generic rates). The call still ran; output and billing were silently wrong. **Throw instead.** |
| 2 | **Prompt variables** (only if the prompt uses merge tags) | a list of `{ name, description }` per feature key | The settings dialog cannot show which tags are available; nobody knows what the prompt accepts. |
| 3 | **Requirements + recommended model** | `{ requiresVision, requiresJsonMode, requiresToolCalling, recommendedModel }` plus the prompt-source mode | No "recommended" pin; incompatible models are not greyed out, so a bad pick fails at call time instead of at pick time. |
| 4 | **Env var** | one project-scoped key per feature (or per provider), read in the config module, listed in the example env file with an empty value | "Missing API key" badge; activation locked; the first call fires a critical "key broken" alert. |
| 5 | **The config row** | feature key, display name, env var NAME, provider project id (placeholder), inactive, plus the nullable overrides and the four pricing columns | The feature never appears on the settings page; only code defaults apply. |
| 6 | **Connection + activation** | a real id, the env var present, active (a human step) | The row sits in the attention queue; the gate may pass but the call fails at the provider with an auth failure. |
| 7 | **Billing gate + out-of-credit route** | a per-bucket out-of-funds flag (plus a "since" timestamp) unless an existing bucket is reused; the route checks it BEFORE the model call and returns HTTP 402 with a machine-readable body | No gate: the customer burns balance with no dialog. Flag column missing: the gate reads undefined and passes forever. |
| 8 | **Frontend out-of-credit handling** | the caller catches the 402 with the matching code, fetches the balance, opens the recharge dialog, stashes the retry payload | A generic error toast; auto-recharge never runs; no recovery without a reload. |

**Layers 1 to 6 apply to every feature. Layers 7 and 8 apply only to features billed per
use.** A platform-absorbed feature skips 7 and 8 by design, not as a gap.

Two things about layer 7 that are not obvious:

- **Buckets are usually reused, not added.** Several features deliberately share one
  existing credit bucket instead of adding their own flag: they gate on that bucket and
  return its code. Add a new flag only when a feature genuinely needs its own credit pool.
- **The billing job rolls each usage type into a specific bucket, and that mapping is
  explicit in code.** A billed feature whose usage type is not wired into the relevant
  roll-up sits **unbilled forever**: the rows insert and nothing ever sums or debits them.
  This is the most common silent billing gap when adding a billed feature. (An
  intentionally unbilled feature has no usage row at all, so it never reaches the job.
  That is correct.)

---

## 3. Database contract (example shapes)

### The feature config table (one row per feature, the tunable layer)

| Column | Notes |
|---|---|
| feature key (text, unique) | Stable code key; effectively immutable after create. Joins to the usage-event table. |
| display name | Label on the settings page. |
| env var name | NAME of the env var holding the key. **The row is metadata; the secret lives in the environment, never in the DB.** |
| provider + provider project id | A placeholder prefix means unconnected. |
| active (bool) | Runtime gate. Seed new rows **false**: shipped code is not a working feature. |
| model, system prompt, max tokens, response format | Nullable overrides; null falls back to the code defaults. |
| input/output CHARGE per 1M (cents) | What the customer is charged. |
| input/output COST per 1M (cents) | What the call costs YOU. Needed even with no billing. |
| created at | |

A stored `temperature` column, if one exists for legacy reasons, should never be sent.

### The usage-event table (one row per call, written by the wrapper)

For **every** call, success or failure: tenant id, location id, feature key, model,
endpoint, input tokens, output tokens, cached tokens, audio seconds, estimated cost in
cents, provider request id, an external reference, metadata (JSON), error class, error
message, HTTP status, occurred at.

This is your cost book. Without it you cannot answer "what did last month cost, and which
feature spent it", and with any conversational mode that question arrives fast.

### The customer billing feed (billed features only)

- **Usage rows**: tenant, usage type, quantity (cost in cents), unit cents, billed false,
  a JSON description (tokens, model, rates). The job later stamps charged cents and billed
  at, and sets billed true.
- **A balance ledger**: append-only; the current balance is the latest row's running
  balance (integer cents).
- **Billing settings**: auto-charge enabled, threshold and amount; one out-of-funds
  boolean per bucket, each with a "since" timestamp stamped when it goes true and cleared
  on any credit.

---

## 4. The wrapper: the rule that holds it together

> **Every model call goes through one function. No exceptions.**

The moment there are two ways to call a model, the usage table stops being complete, and
an incomplete cost book is worse than none: it reads as authoritative while being wrong.
Same principle as the single capture path in `error-alert-system`: **one door, so the
record is trustworthy.**

The wrapper must:

- **Resolve config**: the live row over the code defaults. **Throw loudly if neither
  exists**; never silently substitute a stub.
- **Refuse an inactive feature** with a clear error.
- **Write a usage-event row on success AND failure.** A failed call sometimes still costs
  tokens and always costs information.
- **Classify the error** (section 9), retry the transient classes with backoff, and report
  through the error system. Never swallow: a model call that fails silently and returns a
  plausible empty result is exactly the swallowed-exception class that system exists to
  catch.
- **Log latency.** Model calls are slow and variable; you want the numbers before you
  optimize anything.
- **Accept an explicit feature, tenant, location, external ref and metadata**, and
  otherwise read attribution from request context (section 6).
- Take a `run` closure that makes the provider call and returns
  `{ value, model, endpoint, inputTokens, outputTokens, cachedTokens, audioSeconds,
  requestId }`, so the wrapper works for chat, embeddings, speech and vision alike.

**A shared model-tuning helper** is spread into every call. It translates "max tokens"
into whichever parameter name the model family expects (reasoning families use a
different one). It deliberately never emits `temperature`: every feature runs at its
model's default, which sidesteps reasoning models rejecting an explicit temperature.

### The route template for a billed feature

```ts
// EXAMPLE shape. Names are illustrative.
router.post('/generate', validateTenantAccess, async (req, res, next) => {
  const { tenantId } = res.locals;
  try {
    // (1) Credit / lifecycle gate. Never call the model when blocked.
    const gate = await canProcess(tenantId, '<bucket>');
    if (!gate.can_process) {
      const [settings, balanceCents] = await Promise.all([
        loadAutoChargeSettings(tenantId),
        getCurrentBalance(tenantId).catch(() => 0),
      ]);
      return res.status(402).json({
        code: 'insufficient_funds_<bucket>',
        reasons: gate.reasons,
        balance_cents: balanceCents,
        auto_charge_enabled: !!settings?.enabled,
        auto_charge_threshold_cents: settings?.threshold ?? null,
        auto_charge_amount_cents: settings?.amount ?? null,
      });
    }

    // (2) Resolve config (row over defaults; throws if neither).
    const cfg = await loadFeatureConfig('<feature_key>');

    // (3) The wrapped call (writes the usage event automatically).
    const { value, inputTokens, outputTokens } = await callModel({
      feature: '<feature_key>',
      apiKey: config.keyFor('<feature_key>'),
      run: async () => { /* provider call + token extraction */ },
    });

    // (4) AFTER success: compute cost from ACTUAL tokens, insert the usage row.
    try {
      await insertUsage({
        tenantId, usageType: '<feature>_generation',
        quantity: costCents(cfg, inputTokens, outputTokens),
        unit: 'cents', billed: false,
        description: JSON.stringify({ model: cfg.model, inputTokens, outputTokens }),
      });
    } catch (err) {
      reportError(err, { source: '<feature>.usage_insert', metadata: { tenantId } });
    }

    res.json({ /* ... */ });
  } catch (err) { next(err); }
});
```

---

## 5. How billing works, end to end

For a **billed-per-use** feature. The key thing: **the balance is not debited in real time
at the moment of the call.**

1. **At call time** the route gates on the STORED out-of-funds flag for its bucket (plus
   the lifecycle gates). If blocked it returns 402 and never calls the provider.
2. **The provider call** runs inside the wrapper, which writes one telemetry row. This
   does not touch the customer's balance.
3. **On success** the route computes the charge from the actual token counts and inserts
   an unbilled usage row.
4. **The billing job** (frequent, about every 10 minutes) sums unbilled usage rows per
   feature, applies any included monthly allowance, and calls ONE transactional function
   that appends a ledger row decrementing the balance, stamps the charged amount and
   time, and marks the rows billed.
5. **When the post-debit balance is at or under the bucket's threshold**, the job sets the
   bucket's out-of-funds flag and stamps the "since" time. The next call then 402s.
6. **Recovery** goes through ONE add-balance function. On any positive credit (a card
   top-up, a successful auto-charge, a promo credit, a manual admin credit) it appends a
   positive ledger row, clears ALL out-of-funds flags and their timestamps, and kicks the
   billing job to re-evaluate immediately. The frontend polls the balance for the flag to
   clear, then REPLAYS the original request from the stashed retry payload.

A consequence worth knowing: because the gate reads a stored flag the job maintains, a
customer who has just hit zero can still pass the gate until the next tick. That is by
design: the gate is a cheap stored-flag read and the job is the source of truth. Reasoning
as if the debit were synchronous produces wrong conclusions.

Both cost recordings exist on purpose: the telemetry row (your cost, written by the
wrapper) and the usage row (customer billing, written explicitly after success). Without
the usage insert the customer is never billed; without the wrapper there is no telemetry,
no auth alerting, and the dashboard shows zero for the feature.

**If the product is subscription-priced today, defer the billing layer and build the
telemetry anyway.** Cost visibility is useful the moment the first model call ships. Only
the gate, the ledger and the 402 path are deferrable. Keep the two gotchas above (the
roll-up mapping, the non-synchronous debit) written down so the design is not reinvented
later. A conversational mode changes the cost profile completely: subscription features
have predictable volume, open-ended chat does not, and telemetry is what makes that
visible before it becomes a surprise.

---

## 6. Attribution: request context and crons

Register a middleware that fills an async-context store with `{ tenantId, locationId,
userId }` from the request. The wrapper reads it for attribution.

| Code path | Needs an explicit wrap? |
|---|---|
| A route handler | No, the middleware handles it. |
| Fire-and-forget from a request handler | No, async context follows the chain. |
| A webhook receiver hitting a route | No, it is request-path. |
| A cron or background job | **Yes.** Wrap the per-tenant unit of work in a "run with AI context" helper, or pass tenant/location explicitly to the wrapper. |
| A boot script or one-shot | Optional. The wrapper tolerates null; the row attributes to "unattributed". |

If a cron has neither, the usage event writes a null tenant silently and per-tenant cost
reports under-count. Either mechanism works; pick one per job.

---

## 7. Model slots and fallback legs (when you route across providers)

When the product runs several kinds of model work, do not scatter model names through the
code. Keep ONE routing file that maps named SLOTS to models, and have each job ask for a
slot.

- The shape that does not move is **which slot each job asks for**: a flagship "plan"
  slot for judgment (the main turn, summarizing, memory keeping, any decision), a "voice"
  slot for what a person reads, light "cheap read" slots for reflexes only (a first look,
  an ack trigger, classification, routing), and dedicated slots for memory reads or
  browser steps.
- **Judgment goes on the flagship.** Software cannot tell a standing rule from disposable
  scaffolding; a pass that decides that is never the cheap model. Putting a judge on the
  cheap slot is a known way to drift from the design.
- **Each slot has ordered legs** (for example a subscription-based provider first, a
  second provider's API next, the first provider's API key last). A leg that fails falls
  to the next. When NO leg can answer, nothing is lost: the inbound is held and a
  model-down path tells the person honestly.
- **Never trust a model name written anywhere else**, including in a skill. Read the
  routing file. Never change a slot's legs without the owner's explicit word.

In a simpler product there is no fallback chain: features hard-fail on exhausted retries,
and any fallback lives inside the `run` closure. Choose deliberately and write it down.

---

## 8. The settings surface, prompt sources, and kill switches

**One page** listing every feature: name, provider, model, active toggle, connection
badge, and an edit dialog for model, prompt and max tokens. The job this page serves is
"change the prompt and see if the output gets better". So:

- **Editing a prompt must not require a restart.** Read the row per call (one indexed
  lookup; measure before adding a cache).
- **Show what a change costs.** Surface the per-1M rates next to the model picker.
- **Pin the recommended model and grey out incompatible ones** rather than letting a pick
  fail at call time.
- **Link to usage.** After changing a prompt the next question is "did it help and what
  is it costing"; put that one click away.

**Prompt source** decides what the edit dialog shows (default inline):
- `inline`: a textarea bound to the row's system prompt, seeded from the defaults, with
  the variables reference panel.
- An external prompt lab: hide the textarea and link to where the prompt really lives.
- Composed at call time from per-tenant settings: hide the textarea.
- `none`: audio, transcription and speech features have no system prompt.

**Kill switches, in order** (bundle most inside the one gate function):
1. The user is blocked.
2. The account is manually disabled.
3. No active subscription (paused, terminated and trial-expired all flow through this).
4. The bucket's out-of-funds flag.
5. The per-feature opt-in the customer controls, checked in the route before the call.

**Screaming vs quiet buckets.** Classify every billing bucket. A SCREAMING bucket's
out-of-credit state brings back the global low-balance banner, because the failure is
invisible in real time (an inbound message goes unanswered, a phone rings out). A QUIET,
user-initiated bucket does not, because the user already saw their click fail and got the
dialog; alerting again is double alerting. The test when adding a bucket: could the
customer miss the failure if we stayed silent?

**Customer-facing "AI unavailable" cannot be derived from the active flag alone.** That
flag is set by the platform admin. A true runtime "unavailable" needs the customer's
toggle, the balance flag and the lifecycle gate combined. Only the platform admin sees the
attention queue.

---

## 9. Failure paths

The wrapper classifies every error and writes the class on the usage event:

| Class | Trigger | Reporting | The user sees |
|---|---|---|---|
| auth failure | 401 from the provider | CRITICAL "key broken for this feature", deduped, paged | a generic error |
| quota exhausted | a quota 429 | warning | an error; rare behind the billing gate |
| rate limited | a transient 429 | retried with backoff; alert only if retries are exhausted | an error if exhausted |
| server error | 5xx | retried; alert on exhaustion | an error on exhaustion |
| bad request | 400 | warning | an error; usually a code bug (bad schema, oversized prompt) |
| unknown | unclassified | warning | an error |

The out-of-credit dialog handles ONLY balance failures. Auth, quota and server failures
surface as a generic message unless a high-frequency feature adds its own graceful
degradation at the call site.

---

## 10. Free features: an abuse cap instead of billing

A platform-absorbed feature still needs abuse control. It is NOT a per-use charge; it is a
**usage cap**: a generous ceiling no legitimate use would hit, purely to stop someone
pointing a free model at their own workload all day.

- **Meter model spend, not the underlying work.** Sum the feature's telemetry cost per
  tenant against a configurable ceiling (an admin setting, tunable without a deploy).
- **Scope it deliberately** (per account by default; per location only if multi-location
  customers need headroom). Decide one and record it.
- **Degrade gracefully at the cap.** The AI assistance turns off; the deterministic path
  still works. Never hard-block the underlying job. No 402 and no balance dialog: that is
  the billed-feature pattern.
- **Keep telemetry on** so you can see real usage and raise the ceiling if it is too low.
- **Token discipline is what keeps a free feature affordable**: send headers and a small
  sample, never whole files.

**Do not add a unilateral rate cap, cooldown or throttle to a billed feature as "defense
in depth".** That is a product decision, not hygiene. The default is per-message dedup
only.

---

## 11. Provider-specific gotchas worth keeping

- **Newer reasoning model families can reject function tools on the older chat endpoint.**
  Verified on one provider: the chat-completions endpoint returned 400 for a newer family
  when function tools were sent with reasoning on, telling the caller to use the newer
  responses endpoint or turn reasoning off. Turning reasoning off works but throws the
  reasoning away. The fix was ONE shared adapter module (a "does this model use the newer
  API" check, chat history converted to input items, flattened tools, response chaining
  inside a turn, usage read from the newer field names) while older models keep the old
  endpoint. **Any other tool-calling feature switched to the new family on the settings
  page hits the same 400 until it adopts the adapter.** Reuse the adapter; never fork it.
  Re-verify against the provider's current docs; this is the kind of fact that moves.
- **Two features sharing one provider key need an explicit feature on every call.** If the
  wrapper infers the feature from the key VALUE with a map, two config rows resolving to
  the same key collide: the last row loaded wins and every caller relying on the lookup is
  misattributed (spend, alerts, the dashboard). Sharing a key is fine (an agent and its
  humanizer do), but then EVERY call on that key passes the feature explicitly. Simplest
  fix: make the feature a required argument and never infer it.
- **Provisioning a provider project and key WITHOUT the dashboard.** Some providers offer
  an organization admin key that cannot call the model APIs but can drive an admin API,
  which is enough to do every human step except pasting the secret into the hosting
  environment:
  1. Find or create the project (list first; check the feature's row for an id).
  2. **Check what keys already exist BEFORE creating one.** The listing returns each key's
     redacted value, name, owner and last-used time. The host may already hold one of
     them; compare the last 4 characters. Do not silently create a second key when a
     working one exists.
  3. Create a service-account key when needed. The response carries the secret ONCE. Write
     it straight into the local env file from the same script. **Never print it**; print
     only the prefix and the last 4.
  4. Verify with the NEW key, not the admin key: list models, then make one real call with
     the feature's exact request shape.
  5. Tell the owner the one remaining step: copy the value into the hosting environment
     on every environment under the same variable name and redeploy.
  Revoke an old key only on the owner's say-so: an extra valid key is harmless, a revoked
  one still configured on the host takes the feature down.

---

## 12. Anti-patterns (known ways to get it wrong)

- **Calling the provider SDK directly** without the wrapper: skips telemetry, auth
  alerting, retry and attribution.
- **Hardcoding one global API key** instead of the per-feature key: attribution is lost
  and the row is labeled "unknown".
- **Sending `temperature`**, or sending a raw max-tokens parameter to a model family that
  wants a different name. Use the tuning helper.
- **Inserting the usage row BEFORE the provider call succeeds**: bills the customer for
  failures. Insert after success only.
- **Letting the usage insert throw and break the response.** Wrap it in try/catch plus a
  report; the customer already has their result.
- **Skipping the gate because "the job checks balance anyway".** The job runs on a
  schedule; without the gate a customer can burn a negative balance in between.
- **Returning a non-402 status for out of credit.** The frontend dispatcher is keyed on
  status 402 plus the code; any other shape breaks the dialog.
- **Calling the wrapper from a cron with neither a context wrap nor explicit ids.**
- **Adding a new billing bucket without its flag column.** The flag must exist before the
  bucket joins the list, or the gate reads undefined and passes forever. Reusing an
  existing bucket avoids this.
- **Adding a new usage type without adding it to the job's roll-up list.** Unbilled
  forever.
- **A silent stub fallback when defaults are missing.** A silent wrong-model call is far
  more expensive than a loud failure.
- **Putting the API key in the database.**
- **Storing a connection status column.** Compute it live.
- **Seeding a new feature active.**
- **Quoting a migration file as the current truth for a config row.** Rows are edited
  through the settings UI constantly; live-pull.
- **Dropping a config row or an env var** without the owner's explicit permission.
- **Inventing a new send/log/billing helper** instead of extending the wrapper, the gate
  and the one out-of-credit dialog.
- **Adding a UI string reference before its translation key exists**, if the app is
  localized. AI UI strings go through the same i18n as everything else.

---

## 13. Build order

**Adding one feature to an existing platform:**
1. The defaults entry, every field.
2. Prompt variables, if the prompt uses merge tags.
3. Requirements, recommended model, prompt source.
4. The env var read in config (the value is a human step); add it to the example env file.
5. Migration: the config row with the placeholder id, inactive.
6. Billing: reuse an existing bucket where possible; otherwise add the flag and its
   timestamp, extend the gate, and add the usage type to the job's roll-up.
7. Route: access check -> gate -> load config -> wrapped call -> usage row after success.
8. Frontend: the 402 catch, the dialog's feature list, the poll-until-funded map.
9. Translation keys before any reference to them.
10. Human steps (the attention dot is the reminder): create the project and key, set the
    env var everywhere, paste the id, validate, activate.

**Building the platform from nothing:**
1. The two tables (feature config, usage events).
2. Defaults plus the config loader that merges row over defaults and throws when neither
   exists.
3. The single wrapper, with telemetry on success and failure. Nothing calls a provider SDK
   directly, ever.
4. The first real feature, one feature key, end to end, to prove the contract.
5. The settings page: list, badges, locked toggle, edit dialog.
6. A usage view: cost per feature over time. Needed before any conversational mode.
7. Billing, only if the product decision calls for it.
