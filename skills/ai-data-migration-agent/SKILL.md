---
name: ai-data-migration-agent
description: How to build a free, migration-only AI agent that takes ANY export from a customer's old system (clean CSV, messy spreadsheet, pasted blob, PDF, screenshot) and brings it into the app correctly. It sits ON TOP of a deterministic import engine and never replaces it. Covers the mapping funnel (vendor fingerprint -> deterministic match -> AI fill -> value translation -> completeness check), AI entity-type detection, normalizing unstructured files, the propose -> confirm -> run-under-the-user's-permissions flow, the guided concierge conversation (checklist, dependency order, easiest path to the data), self-heal and rollback, restructure plus deterministic self-verification, the pre-import data-quality scan, software-first context and per-vertical playbooks, the entity catalog with a build-time drift guard, free/platform-absorbed billing with an abuse cap, and the landmines (silent column drops, lost historical dates, lenient-mode inserts, colliding generated ids). This is a pattern to BUILD per repository. Read it BEFORE building or changing any AI-assisted import, column mapping, onboarding migration or "bring your data over" feature. Use when the user mentions data migration, importing customer data, an import wizard, AI column mapping, CSV/Excel import, "drop your file in and we do the rest", unstructured import, mapping a spreadsheet to our schema, switching from a competitor, or making migration easy for switchers. For signing in to the old system and pulling the data automatically, read `universal-migration-connector`.
---

# AI Data Migration Agent

> ## ADAPT BEFORE USE: THIS IS A PATTERN, NOT INSTALLED CODE
> This describes how an AI migration agent SHOULD be wired. It is taken from a production
> multi-tenant system and stripped of that product's names. Nothing here exists in your repo
> until you build it. Function, file, tool and table names below (`propose_mapping`, "a
> table like `import_jobs`", "a field-definitions file") are EXAMPLES of the shape. Grep
> before citing any of them; the code wins. Once built, update this skill with the real
> names, keep one plan doc as the source of truth for the agent, and record every decision
> the owner made (the cap scope, which verticals are supported).

> Migration is the number one reason a business will NOT switch to a new product. This
> agent exists to erase that objection: the customer hands over ANY export from their old
> system, structured or messy, and the agent figures out what it is, maps every field to
> the correct column, and imports it cleanly under the user's own security. It is **100
> percent free** and does **only** data migration, nothing else.

Read alongside: `internal-ai-agent-architecture` (the agent bones this one mirrors:
propose/confirm/execute, the gate, write as the caller, the reply pipeline, the gap loop,
compaction), `ai-model-platform` (keys, telemetry, the platform-absorbed billing mode),
`universal-migration-connector` (login-and-pull), `security-rls-permissions`.

---

## 0. The one-sentence mental model

**The deterministic engine does the import. The agent is the brain that turns a messy
human file into the engine's clean inputs (entity type + column mapping + per-value
translations + the decisions a human would otherwise click), explains what it will do, and
lets the user confirm before the engine runs under their permissions.**

Nothing the agent does writes to the database directly. It produces the exact same objects
the manual wizard produces (an entity type, a list of column mappings, import options,
match decisions), hands them to the EXISTING importer pipeline, and that pipeline writes
through the user's own client. The agent is a mapping + orchestration + explanation layer,
not a new writer.

---

## 1. Build the deterministic engine first, and never rebuild it

The engine must exist before the agent, and it should already solve almost everything:

| Capability | The agent reuses it by... |
|---|---|
| Parse CSV / XLSX / XLS (encoding, delimiter, preamble strip) | calling the parser; for non-tabular files it pre-normalizes to rows first (section 4) |
| Deterministic column auto-match (edit distance + aliases + entity keywords) and an entity-type suggester | running it FIRST, then filling only the gaps with AI |
| Per-entity field metadata (keys, labels, aliases, required flags, enums, value aliases) | feeding it to the model as the mapping target |
| Vendor fingerprint detection + curated preset mappings per competitor | checking a fingerprint BEFORE asking the model; a known vendor skips the AI pass |
| Compound column splits + per-value translation | emitting these structures directly |
| Foreign-key resolution (phone, then email, then external id, then name) + an ambiguity review screen | unchanged; the agent can pre-answer obvious match decisions |
| Money to cents, dates, phones, durations | unchanged; the agent never re-implements cents conversion |
| One importer per entity, extending a base importer | getting the importer for the entity and running it; never forking |
| Placeholders, drafts, templates, idempotency by external id | unchanged |
| Cross-entity dependency ordering | ordering multi-file jobs with it |
| Rollback (the only privileged server write) | unchanged; every agent import is rollback-able |

**The gap the agent fills (and ONLY this gap):**

1. **AI entity-type detection** when the fingerprint misses and the keyword scorer is
   ambiguous.
2. **AI field-to-column mapping** when the deterministic matcher leaves a required field
   or a source column unmapped (the common case with renamed, foreign or cryptic headers).
3. **Unstructured / messy files** the parser's single-header assumption cannot handle.
4. **A conversational, hand-holding surface** so the customer talks to it ("here is my
   client export", "the prices are in a weird column") instead of clicking a 7-step
   wizard.

If you find yourself re-implementing parsing, cents conversion, foreign-key resolution or
a second importer, STOP: the engine already has it.

---

## 2. The flow (propose -> confirm -> run)

One migration conversation, one or more files.

1. **Ingest.** The user uploads or drops files, or pastes data. The agent parses each into
   `{ headers, sampleRows }`. It NEVER sends the full file to the model: only the headers
   plus a small sample (the first 5 to 20 rows, PII-minimized), on a budget of roughly 2k
   tokens.
2. **Detect (read-only).** In order: vendor fingerprint -> deterministic entity suggestion
   and column match -> an **AI pass** that fills only the unmapped or ambiguous pieces.
   The model is given the entity's field definitions as the target schema and asked to map
   each remaining source column to a field key or to "skip", with a confidence and a
   one-line reason per mapping.
3. **Propose.** The agent returns a PLAN shown as a confirm card (it never auto-runs): the
   detected entity type, the full column mapping (deterministic and AI, each tagged by
   source and confidence), the import options, a pre-flight summary (N new / N update / N
   need review / N placeholders), and a live one-row preview. Multi-file shows the
   dependency-ordered sequence.
4. **Confirm.** The user confirms, or edits any mapping inline using the SAME widgets as
   the manual wizard. Editing is first-class: the agent's mapping is a STARTING point; the
   user is the authority.
5. **Run under the user's permissions.** The finalized mapping goes into the existing
   importer pipeline: build lookup caches, create the import-job row, batch-insert through
   the user's client. The agent introduces no new write path.
6. **Report and offer rollback.** The same results surface as the manual wizard. Every
   agent import creates an import-job row and is fully undoable.

Because step 5 reuses the existing importer, the agent inherits batching, progress,
placeholders, idempotency, rollback, and the security property in section 5 for free.

---

## 3. The AI mapping: the field-to-column completeness bar

The core promise: **every source field lands in the correct column, or is deliberately and
visibly skipped. No silent drops.** The bar is exhaustiveness, not "most columns".

The mapping pass is a funnel, cheapest and most certain first:

1. **Vendor fingerprint preset.** If the file matches a known vendor export, use its
   curated default mapping. Most trustworthy; tag as "from preset". No model call.
2. **Deterministic auto-match.** Exact key/label, alias, phone-overflow, then fuzzy.
   High-confidence matches stand.
3. **AI fill for the remainder.** For every still-unmapped source column AND every
   still-unmapped REQUIRED target field, ask the model to pair them. It gets the source
   column name plus a few sample values, and the candidate target fields (label,
   description, aliases, type, enum values). It returns `{ sourceColumn, targetField or
   "skip", confidence, reason }`.
4. **AI value translation.** For enum targets, if the source values do not match the enum,
   the model proposes a value-mapping table (source value -> target enum value), seeded
   from the field's value aliases. A compound column (one column packing two logical
   values) gets a value extractor.
5. **Completeness check before proposing.** The agent MUST verify that every required
   field is satisfied (directly, via a "satisfied by" rule, or by a default). If a
   required field is still unmapped it does NOT quietly proceed: it asks ONE targeted
   question ("Which column holds the service duration?") with a dropdown of the remaining
   columns.
6. **Every unmapped column is surfaced, not hidden.** A column the agent chooses to skip
   is shown as "skipped: <reason>" on the confirm card so the user can object. The failure
   mode we refuse to ship is a column full of real data silently dropped because no field
   matched.

**Thoroughness rules to encode in the prompt and the tool descriptions:**
- **Money is ALWAYS integer cents in the schema.** The transformers convert. The model's
  job is only to identify WHICH column is money and whether the source is dollars or cents
  (feed the deterministic currency inference as a hint).
- **The "real date" problem.** Historical exports carry the original date in a column that
  must map to the historical-date field (an external-created-at, a start time, a first
  visit), NOT be dropped in favor of the row's created-at, which defaults to the import
  moment. A "date created / first seen / original booking date" column goes to the
  historical field, never discarded.
- **Names.** A single "Full Name" column satisfies first and last name through a
  "satisfied by" rule plus the validator's auto-split. Map it to the full-name field; do
  not force a wrong split.
- **Map to the REAL column keys in the field definitions, not assumed ones.** Traps that
  have bitten: the name column is not called `name` on every entity; a record can truly
  require denormalized text (a customer name, a service name, a slug) even when the
  foreign key resolves; categories link through a junction table, not a category id;
  staff spans two tables and needs a role.

---

## 4. Unstructured / messy files

A parser assumes a single header row and a clean table. Real exports often are not. The
agent adds a **pre-normalization step** that turns messy input into `{ headers, rows }`,
THEN hands off to the normal pipeline.

| Messy shape | Normalization |
|---|---|
| Header not on row 1 (title rows, "Report generated at...", blanks) | Detect the real header row from the sample (the row whose cells look like field names and whose following rows are data); drop the preamble. |
| Merged cells / multi-row headers | Flatten to single headers ("Q1 / Revenue" -> "Q1 Revenue") before mapping. |
| One sheet mixes MULTIPLE entities (customers and their appointments interleaved) | SPLIT into per-entity row sets and propose each as its own import in dependency order. |
| Key-value / transposed (each record is a block of `Field: value` lines) | Pivot to tabular. |
| Free-text blob / notes dump | Route to a notes entity (needs only the owner and content); extract per-customer notes, matching the customer by name/phone through the foreign-key resolver. |
| PDF / image (an invoice, a printed list, a screenshot) | Reuse the vision pattern the product already has for reading invoices to structured line items; extract rows, then feed the tabular pipeline. Do NOT invent a new OCR stack. |
| Multiple files from one vendor | Detect each, order by dependency, share the placeholder pool across files (a customer created during one import is reused for the next). |

**The honesty rule:** when the agent is unsure, it says so and asks one precise question
with a dropdown rather than guessing silently. A wrong silent mapping is worse than one
question.

### Restructure plus self-verify (reshape any input, then PROVE it)

Two tools make the agent smart at SHAPE, not just field mapping:

- **A restructure tool** reshapes one messy input into MULTIPLE clean entity tables at
  once: FAN-OUT (one blob -> customers + services + bookings; child records carry the
  parent key so they link), PIVOT/UNPIVOT (a grid -> rows), DERIVE/SPLIT columns. Give it a
  big output budget and make it truncation-honest. It is told NEVER to invent data and
  NEVER to drop records. This is "dump whatever you have and I will sort it into the right
  tables".
- **A verify tool** is the TRUST loop, and it is deliberately NOT a pure AI self-grade. A
  DETERMINISTIC floor in code: row accounting; fabrication sampling (output values
  normalized and checked for presence in the source); fan-out linkage (child references
  must exist in the parent table); shape sanity. PLUS a SECOND-model critic for semantic
  errors. It returns `{ ok, issues: [{ severity, kind, entity, detail, fixHint }],
  counts }`; ok is false on any high-severity issue.
- **The agent MUST verify after every reshape and FIX before importing**: re-run the
  restructure with the fix hints, ask the customer one precise question, or import only
  the entities that passed (the user confirms). The confirm card shows the verification
  result. The prompt enforces it: "Never import a reshape you have not verified."

### Data-quality check and correct on attach (the pre-import scan)

A PURE, deterministic scan of the WHOLE parsed file (not just the model's sample) for the
flaws a per-row validator misses because each value is valid in isolation. Five kinds:

- **numeric outlier**: a price 6x or more the column median, with an extra-zero typo guess
  (20000 -> 2000). Exclude identifier columns (code, id, phone, near-unique).
- **blank row**: fully empty.
- **sparse row**: only a name, no other data.
- **duplicate row**: an exact duplicate.
- **near-duplicate values**: one vendor typed five ways. "Irene" and "Irene band fall"
  collapse to "Irene", but ONLY when the bare base word is itself a value, so two
  different people sharing a first name never merge.

Each finding carries an English message (for the AGENT's context), a kind plus i18n
parameters (for the user's card, which renders a TRANSLATED label, never raw English), and
a default-accept flag. Run it on EVERY entry point (file attach, paste, photo), wrapped in
try/catch: a scanner bug degrades to no card plus a silent report, and never blocks the
attach.

Split the findings by RISK:
- **Auto-applied: ONLY fully blank rows.** Zero data, cannot be a real record. NOTHING
  else is auto-changed. An earlier version also auto-dropped name-only and duplicate rows;
  that was a **silent data loss bug**: a name-only row might be a real contact, an exact
  duplicate might be two real identical items.
- **Card: everything else.** Name-only and duplicate rows, the price outlier and the
  spelling merges go to a "Review data quality" card with a checkbox per fix. Safe
  cleanups are pre-ticked; the price outlier is NOT pre-ticked (a money-value guess the
  user consciously accepts). They also ride the attach message as "data-quality flags" so
  the agent raises each one.

Accepting applies the fixes to the HELD parsed rows in place, so the import that follows
uses the corrected data (client-side, no server round trip, no model turn). Re-scan after
the auto-drop so the flags' row indexes reference the rows the card corrects. **A value
merge PRESERVES the dropped distinction**: the scanner records the wording beyond the
canonical base ("band fall") and, when the file has a notes-like column, appends it to
that row's notes before overwriting the value. No notes column: the merge still
collapses, and the user can decline that one. Keep the scanner dependency-free so it is
unit-testable in isolation, and verify it against a real export.

---

## 5. SECURITY: the agent has EXACTLY the user's permissions, role and locations

Non-negotiable. The agent must never let a migration write something the user could not
write by hand.

**Layer 1: the gate** (mirror the main agent's gate, scoped to migration):
- **Location access**: the agent is LOCKED to the selected location and the import targets
  it (multi-location sources go through the existing location-mapper).
- **Permission**: importing is gated by the SAME data-import permission the manual wizard
  checks. A user who cannot open the import page cannot use the agent.
- **Entitlement**: because the agent is FREE and its whole point is to win switchers, do
  NOT hide it behind a paid add-on. It is still gated by the permission above, so it is
  not "anyone".

**Layer 2: WRITE AS THE CALLER.** If the importer runs through the logged-in user's client
(their token), every insert already runs under their row policies: tenant isolation,
location access, per-table role permissions, the blocked-user gate. A permission-denied
from the database is the final guard.

**Therefore the hard rule:** the run step MUST go through the existing caller-scoped
importer path, NOT a new privileged write. **Never add a server "bulk insert" endpoint
that writes with a privileged role to "make it faster".** That bypasses the user's
policies and breaks the exact property required. The only privileged server write is
rollback, which is privileged ON PURPOSE and dependency-ordered; leave it.

If an import genuinely needs a privileged function, that function must verify in its body
that the caller owns the target, and be called through the caller-scoped client so the
current-user id is the user. Default to the plain caller client.

Before shipping any new write the agent can trigger, PULL the live policy of the target
table and confirm the gate plus the caller client are equivalent to or stricter than it
for the user's role. That is how you PROVE the property, not assume it.

---

## 6. Billing: FREE = platform-absorbed, telemetry still on, capped against abuse

See `ai-model-platform` for the two billing modes. This agent is platform-absorbed on
purpose: it is the sales weapon; charging for it defeats the point.

- **No credit gate, no out-of-credit response, no usage row.** A migration must never
  stall on balance.
- **Telemetry still universal.** Every model call goes through the one wrapper so cost is
  visible and auth failures still page. The defaults carry a charge of zero; the true cost
  stays non-zero.
- **Its own feature key** (and ideally its own key). If it ever shares a provider key with
  another agent, EVERY call passes the feature explicitly.
- **Token discipline.** Only headers plus a small PII-minimized sample reach the model,
  never whole files. A privacy rule AND what keeps a free feature affordable.

**The abuse limit instead of billing.** A generous ceiling no legitimate migration would
hit, purely to stop someone pointing the free model at their own work all day.
- Scope it per account by default (a migration is an account-level event); per location
  only if multi-location businesses need headroom. Decide one and record it.
- **Meter model spend, not imports.** Sum the agent's telemetry cost per account against a
  ceiling that is an admin setting (tunable without a deploy). The ACTUAL row inserts are
  never capped.
- **Graceful degradation at the cap.** The AI mapping pass turns off; the deterministic
  engine and the manual wizard still work: "You have used the AI assistant's limit for
  this migration; you can finish mapping manually or reach out and we will help." Never
  hard-block the import itself.
- Keep telemetry on so you can raise the ceiling if a genuine big migration needs it. The
  summarizer's cost counts toward the cap too.

---

## 7. The guided concierge experience

The agent is not a dry mapping tool; it is a **warm, hand-holding migration concierge**
that makes switching FEEL effortless. It says things like "No worries, I will guide you
step by step", makes the whole thing sound easy, and leads the customer through it rather
than dropping them at an upload box. Encode this tone in the system prompt (warm,
reassuring, concrete, never jargon). Conversational replies run through the humanizer and
the slop stripper; confirm cards never do.

1. **Know them before they speak.** On open the agent already has, from the software
   preamble: the selected location, the account, the business type, the time zone, and
   which features are turned on. It TAILORS the opening and never asks what it can already
   see: "I can see you run {business name}, a {business type} in {city}. Let us bring your
   data over from your old system."
2. **Ask what they used, as a checklist.** A checkbox list of what the OLD system held,
   pre-weighted to their business type, each option mapping 1:1 to an importable entity
   type (customers, staff, services, products, appointments past and upcoming, sales and
   payment history, packages, memberships, gift cards, account credit, notes and forms).
   The ticked set is the migration's work list.
3. **Sequence by hierarchy automatically.** Order the ticked items by foreign-key
   dependency (staff and services before appointments; customers before bookings,
   packages and memberships). Say the plan in plain words ("We will do it in the right
   order so nothing ends up orphaned: first your services and staff, then your clients,
   then their appointments and balances") and walk ONE entity at a time, highest first.
4. **For each entity, find the easiest path to the data**, in this preference order:
   a. **Auto-connect** if a one-click path exists for their vendor: "Good news, for
      {vendor} there is an easy way; I can connect and pull it over automatically."
   b. **Guided export** from a vendor knowledge base: step by step "here is exactly where
      the export button is". Be honest about what is verified vs reconstructed; tell them
      to search the vendor's help if a menu differs. Never invent click paths.
   c. **"Just give it to me" fallback** when they cannot export at all: "No problem, just
      copy everything you can see, select the whole client list on screen, and paste it
      here, and I will sort out where each piece goes." This is the load-bearing promise:
      even a shapeless copy-paste lands in the right columns.
5. **Map, preview, confirm, run, report**, one entity at a time. After each: "Done, {N}
   clients are in; want to keep going with appointments?" keeps momentum.
6. **Finish with a summary** of everything brought over, what was skipped and why, and a
   one-click undo.

**Use EVERY available path, not just files.** The agent knows and offers the auto-connect
paths that exist: an official API or OAuth connect, a bookmarklet token handoff, a
login-and-pull connector, and files / paste / saved HTML as the universal fallback. Its
routing checks: is there an auto-connect path for this vendor? Offer it first ("the easy
way"). If not, guided export. If they cannot export, paste. It must be able to INITIATE
the connect flow, not just describe it, and it runs as the user.

**Scope: migration ONLY.** The agent does NOTHING except help migrate data. The prompt:
"You are the Data Migration Assistant. You ONLY help the user bring their existing
business data into the app. If asked to do anything else, politely say that is not what
you do and point them to the main assistant or the relevant page." Its toolset is
migration tools only, so it is structurally incapable of other writes even if prompted.
The main assistant, in turn, refuses import requests and points here. Keep stored prompt
overrides null (or re-sync on every edit) so the referral is never dropped by a stale
prompt.

---

## 8. Self-heal: the agent can FIX a botched migration

Because the agent can READ the imported data (scoped by the user's policies), it can
diagnose and repair mistakes.

- **Every import is a job row** with the inserted record ids, so the agent knows exactly
  what a migration created and can undo it or re-run with a corrected mapping.
- **Diagnose "this looks wrong":** "47 bookings came in with no service, because the
  Service column was not mapped; want me to fix the mapping and re-run just those?"
- **Fix through the SAME confirm -> run flow**, under the user's permissions. A repair is
  just another proposed action; it never silently rewrites data.
- **Reversible repairs:** prefer re-import with rollback over in-place edits, so a fix is
  itself undoable.

Understand what happened and fix the source of the problem (a wrong mapping), not just the
symptom.

---

## 9. Software-first context, playbooks, and vertical completeness

**"Only rely on AI agents when we really need them."** Anything the software can know
deterministically is resolved BEFORE the model runs.

- A **preamble loader** does a few small parallel reads and renders "WHAT YOU ALREADY
  KNOW": business, location and city, time zone and today, the kind of business (or "NOT
  SET YET"), features on, their words for clients and staff, typical services. Then
  EITHER "YOUR OPENING: greet with it, do not ask what they do, ask which system" plus the
  niche playbook, OR "YOUR OPENING: ask what they do first, then record it" plus the
  general rules. Rebuilt every turn. Degrades to a generic preamble with a silent alert on
  a DB blip.
- **No "get my context" tool.** If the agent needs a new fact the DB holds, add it to the
  preamble. The ONE vertical step that needs a human is a caller-scoped
  "set business type" write, which returns the playbook inline so the turn continues.
- **A vertical profile is the per-vertical brain** (the runtime agent cannot read your
  skills): a resolver (a strong feature flag wins, then keyword buckets), and per
  vertical: the staff title, the word for a client, the key entities IN IMPORT ORDER, and
  the gotchas. Extend a vertical by editing its profile; every consumer picks it up.
- **A "describe target" tool is the agent's deep model knowledge**: per entity, the
  required fields, foreign-key dependencies, the import ORDER, any prerequisite, and the
  gotchas, plus the global rules. The agent calls it before mapping or sequencing.

**Vertical completeness: the agent can IMPORT what it asks for.** "The default is the core
vertical; if we add other verticals they need to be fully configured, or it is a broken
product." An audit of the source system found playbooks promising entities the engine
could not import (empty field definitions, a missing importer, a describe tool that knew
13 of the engine's entities). The fix:

- **ONE entity catalog** both the describe tool and the checklist read, filtered per
  business (an "only when" condition per entity), with "offer: false" for importable but
  not offered entities, and a `prerequisite` for a step the customer must do first.
- **A drift guard as a build gate.** A script wired into typecheck parses the engine (the
  entity-type union, intersected with registered validators, registered importers, and
  non-empty field definitions) and FAILS unless that set equals the catalog ids exactly
  (connector-only entities carved out), and every entity id named in a playbook exists in
  the catalog. Add an entity to the engine and you must add it to the catalog, or the
  build fails. "Keep it in sync" is enforced, not remembered.
- **Playbooks reference catalog ids**, so the "bring this in" list uses the same ids the
  run verb takes.
- **A registration checklist for a NEW entity**, kept in this skill once the repo's real
  list is known. In the source system it was about 14 places: the type union plus labels
  and icons; the setup config; field definitions and their map; the validator and its
  index; the importer and its index; foreign-key resolver caches; validation-context
  wiring; the wizard tile; column-matcher keywords and scores; the dependency order; the
  vendor dependency priority; the imported-records view (columns AND the table-name
  switch); the rollback allowlist; and the catalog entry. The records view has bitten: a
  column list without a matching switch case errors the view with "unknown entity type"
  and shows zero rows although the import worked.

---

## 10. The tool surface

Every "write" is really "produce engine inputs" or "run the existing importer".

**Guidance and context (no confirm):** an entity-checklist tool (takes NO args; resolves
the vertical server-side from the location's own record); a list-form-templates tool (as
the caller, so a responses file attaches to the right form BEFORE the run); a
vendor-paths tool (best route for a vendor: auto-connect, guided export, or paste).

**Read / analysis (no confirm, no write):** analyze a file or pasted blob (entity guess,
headers, sample rows, vendor match); restructure; verify restructure; re-read an attached
file from its durable path as the caller; propose mapping (runs the funnel, returns the
mappings, value translations and the completeness report); preview import (pre-flight
counts plus one resolved row); explain export (sourced from the vendor knowledge base).

**The run verb (confirm -> execute):** the ONLY state-changing action. `preview()`
validates the finalized plan and returns the confirm-card summary; `execute()` feeds it to
the importer through the user's client and creates the job row. Multi-file sequences by
dependency and shares the placeholder pool.

**Grow, escalate, research:** describe target; report capability gap (asked to migrate
something it cannot: unknown entity, unreadable source, unhandled transform; aggregated,
one INFO alert with build instructions); contact support; and live web research (the
provider's built-in search tool) to look up a specific old system's real export path when
the knowledge base has no confident answer, so the step-by-step is accurate, not guessed.

**Self-heal:** inspect an import (read back what a job created); fix an import (re-map and
re-run the affected rows, or roll back and re-import, through the same confirm flow).

**Connect:** initiate an API auto-connect path as the user, or start the secure
login-and-pull connector (see `universal-migration-connector`).

**The handoff landmine.** After a multi-entity pull or restructure, turn ALL entities into
a full queue of pre-parsed streams, dependency-ordered, stash them ALL at once, and hand
off to the importer, which walks the user through EVERY entity (auto-match, review,
import, rollback each). **Do NOT build a one-at-a-time in-chat queue**: the confirm
handoff closes the chat and navigates away, so a per-entity queue only ever imported the
FIRST entity.

Keep the confirm-card summary verbatim (money and row counts are approved as-is).

**Long conversations and files:** a migration runs long (many entities, corrections,
one-time-code round trips). Use the compaction model and the durable file reference from
`internal-ai-agent-architecture` section 14. The summary is LOGIC-ONLY: entities and row
COUNTS, column-to-field mappings, value translations, what was confirmed, imported or
skipped and why, decisions, open questions, the vendor and path. NEVER row data or PII.
Because tools send only headers, samples and counts, even a 10-year, 48,000-row migration
keeps the chat small.

---

## 11. Importer hardening (two CLASSES found by a no-gaps audit)

A full audit (two adversarial sub-audits, every finding re-verified against the live
constraints before fixing) found five real defects. The two classes are the lessons.

- **Lenient mode does NOT skip a validator-error row before insert.** If the default
  validation mode is lenient and the batch processor only skips error rows in STRICT
  mode, then a validator that enforces a DB-required field only by pushing an error does
  NOT prevent the insert: the row reaches the writer and hits a raw not-null or check
  violation the customer sees. **Therefore every DB-required column must ALSO be guarded
  at the WRITER (the importer), returning a graceful per-row failure with a plain-English
  message.** The validator error is the upfront warning; the importer guard is the hard
  backstop on EVERY path (wizard, agent handoff, connector).
- **A content-derived external id must never collapse two genuinely distinct rows.** When
  a file has no source id and you generate one from the row's content, two rows identical
  in every mapped field (two same-day same-amount payments, two blank-dated leads for the
  same customer) generate the SAME id and the second is silently swallowed as "already
  imported". Fix it at the ONE shared writer: append a **per-file occurrence index** when
  there is no real source id, computed so the same row lands on the same index on a
  re-import (idempotency holds). A real source id short-circuits it. Verify the fix does
  not regress entities that intentionally converge on a name or disambiguate on conflict.
- **View-layer defects count.** A missing case in the post-import "view records" screen
  and a phantom column in its allow-list both made a successful import LOOK broken.
- **Write down what you verified correct and left alone**, so the next audit does not
  "fix" it: consistency rules on every path, null-safety, date parsing never writing
  "Invalid Date", cents parsing never NaN or negative, per-vertical gating, alert
  classification, internal sentinel fields stripped on every insert path.

**Generic imports for a new entity** should: emit REAL columns; stamp a source system; use
a deterministic external-id fallback so re-imports UPDATE; derive every live check-
constraint pair in the validator; resolve foreign keys through the tiered resolver into
match-review fields (pick, create, or leave unlinked); and treat a known natural key (a
code, a name) as an UPDATE of that record instead of minting a "-2" copy. Never route a
historical import through a live side-effecting function (a check-in that consumes
credits); plain insert.

**Onboarding surfaces that prompt the import** must stay in sync with the catalog: the
finish screen of onboarding gets a prominent "Bring your existing data over" card (not a
tiny muted footnote), and the in-app setup checklist lists core entities as subtasks plus
vertical-gated ones, gated by the SAME conditions as the agent's catalog so a plain
business never sees another vertical's entities.

---

## 12. The checklist to build or extend ONE capability

1. Read the companion skills and the engine's plan docs. Pull the LIVE schema of every
   target table so the mapping target is real, not remembered.
2. **Reuse the engine.** A new entity almost certainly needs only AI mapping and
   normalization. If it truly has no importer, build the importer FIRST, then teach the
   agent.
3. **Normalization first** for any non-clean-table shape.
4. **The mapping funnel**: fingerprint -> deterministic -> AI fill -> value translation ->
   completeness check.
5. **Security**: the existing caller-client importer; the gate mirrors the import
   permission plus the location lock; pull the live policy and prove equivalence. No new
   privileged write.
6. **Billing and the cap**: the wrapper with the migration feature key, charge zero, no
   credit gate, headers and sample only; the cap degrades the AI pass and never blocks the
   import.
7. **Scope**: migration only; refuse and redirect.
8. **Teach the model**: tool descriptions that encode the thoroughness rules; a short
   prompt primer on the completeness bar.
9. **Verify by doing**: typecheck; run the mapping against a real messy sample and confirm
   every required field is satisfied and no data column is silently dropped; run a small
   real import end to end, then roll it back and confirm the database is byte-identical
   after.
10. **Update the plan doc**, the help docs and the changelog (it is a headline switcher
    feature).

---

## 13. Landmines

- **Rebuilding the engine**: a new parser, cents converter, second importer or foreign-key
  resolver. All exist.
- **A privileged bulk-insert endpoint "for speed".** Breaks the core security property.
- **Silently dropping a column or proceeding with an unmapped required field.** When
  unsure, ask ONE precise question.
- **Dropping the historical date.** The customer loses their history and nobody notices
  until a report looks wrong.
- **Treating money as dollars.** Integer cents; the transformers convert.
- **Billing the agent.** Free. Telemetry only.
- **Letting it do non-migration work.** Scope creep makes it a second main agent.
- **Sending whole files to the model.** Privacy and cost.
- **Two agents sharing a provider key without an explicit feature.** Misattributed spend.
- **Building the mapping against assumed column names.**
- **Forgetting multi-entity ordering** or the shared placeholder pool.
- **Enforcing a DB-required field only in the validator.**
- **A content-derived id with no occurrence index.**
- **A new entity without the catalog entry and every registry.**
- **Auto-dropping anything except a fully blank row.**
- **Importing an unverified reshape.**
- **A one-at-a-time in-chat import queue.**
- **A "fetch my context" tool.**
- **Hiding the agent behind a paid add-on.**
