---
name: internal-ai-agent-architecture
description: How to architect and build an internal AI WRITE-AGENT (a chat agent that lets a user DO things and change settings in the app by talking to it), and how to teach it one new capability. Covers the ten capabilities a production agent needs (propose -> confirm -> execute, write-as-the-caller so the user's own permissions are the guard, the layered access gate, the settings catalog plus one generic set-setting tool, the two-model worker + humanizer reply pipeline, the deterministic anti-slop pass in software, per-token billing with a once-per-user cost consent, the in-chat contact-support tool, the capability-gap loop that grows the agent, durable interaction logging and the runtime-knowledge boundary), plus the verb contract, the "our team has been notified" failure contract, software-first context, conversation compaction, running the agent over SMS/WhatsApp with voice, images and PDFs, and the landmines. This is a pattern to BUILD per repository. Read it BEFORE designing or building any in-app AI agent, before adding a tool/verb to one, whenever you finish a feature a user can DO or SET and the agent should be able to do it too, and when the user says "build an AI agent", "wire this into the agent", "the agent should be able to do this", "add a verb", "add a tool", "extend the assistant", "what can the agent do", "let users do it by chat", or asks how agents are structured. For the model/key/billing/telemetry plumbing underneath, read `ai-model-platform`.
---

# Internal AI Agent Architecture

> ## ADAPT BEFORE USE: THIS IS A PATTERN, NOT INSTALLED CODE
> This describes how an internal AI agent SHOULD be wired. It is taken from a production
> system (a multi-tenant SaaS where an operator runs their business by chatting with an
> agent) and stripped of that product's names. Nothing here exists in your repo until you
> build it. Every file, table, function and tool name below is an EXAMPLE of the shape, not
> a reference. Grep the current repo before citing any of them. When this doc and real code
> disagree, the code wins. Once the agent is built here, update this skill with a short "how
> it is wired here" section listing the real files, tables and tool names, so the next agent
> finds the code and not just the principles.

Companion skills: `ai-model-platform` (keys, per-feature model config, telemetry, spend
gates: every agent rides it), `error-alert-system` (where failures go),
`security-rls-permissions` (the permission model the agent must inherit),
`inject-tool-knowledge-on-use` (where a tool's how-to belongs), and
`multi-agent-assistant-architecture` (the manager / sub-agent / responder shape for a
personal-assistant style product).

---

## 0. What this is, and the goal it serves

An internal write-agent is the natural-language door to the product: the user types what
they want ("book Jane for a haircut tomorrow at 2", "give Maria 40 percent on color", "turn
texting off", "why is my SMS not working?") and the agent DOES it, changes the setting, or
diagnoses the problem. Every write is proposed, confirmed by the user, then executed and
ledgered.

**The goal:** the agent must eventually do EVERYTHING a user can do in the UI and change
EVERY setting, under that user's real role, security policies and tenant/location access,
AND understand how each thing works. So: **every time you ship a feature, add-on, setting,
toggle, field, action or integration a user can use, you also teach the agent to do it.**
That is part of "done", alongside the help docs and the changelog.

**A conversational AGENT is not a one-shot AI feature.** An agent is a multi-turn loop that
keeps a conversation and calls TOOLS in a bounded iteration loop. A one-shot feature is a
single request/response with no conversation and no tools (a template generator, an invoice
reader, a transcription). One-shot features are wired and billed entirely through
`ai-model-platform`; do not reach for this skill for those.

**Do not confuse two agents that live in the same product.** A common pair: the
operator-facing agent that changes the account, and a customer-facing receptionist that
answers and books for the public. Different audience, different code, different purpose,
different key and prompt. Know which one a request is about before touching either.

---

## 1. The full capability set (build all ten into any internal write-agent)

A production-grade internal write-agent is not "an LLM with tools". It is the agent loop
PLUS these ten capabilities. Each one: what it is, why it exists, the shape to build, and
the one gotcha that bites.

1. **Propose -> confirm -> execute (never a blind write).** The model never writes directly.
   A write-tool call runs a `preview()` that validates, normalizes and returns a human
   summary; that summary is shown to the user as a confirm card; only on confirm does
   `execute()` run. Stash the normalized args server-side between the two (a single-use,
   expiring proposal row). *Why:* the user always sees exactly what will change before it
   changes, and you get an audit trail. *Gotcha:* re-run the full security gate at confirm,
   not just at propose (entitlement and permission can change in between).

2. **Write AS THE CALLER, so the user's own permissions are the real guard.** The agent may
   only ever do what the calling user could do by hand. Build the WRITE with a DB client
   that carries the user's auth token (so row-level security runs as them), not a
   privileged service client that bypasses everything. When you must use a privileged
   function, replicate the ownership check inside the tool. *Why:* the agent inherits every
   current and future permission rule for free; it can never exceed the user. *Gotcha:* a
   privileged write silently lets the agent do things the user's role forbids.

3. **A layered access gate before every action.** Tenant/location access, product
   entitlement (is this feature paid for), a spend allowlist (who may run up cost), and the
   role permission for THIS specific action. Cheapest check first. *Why:* one place that
   decides "can this person do this here". *Gotcha:* the gate checks coarse flags;
   fine-grained row rules still need capability 2.

4. **A settings CATALOG plus one generic set-setting tool (not one tool per setting).**
   Hundreds of settings would bloat the tool list and confuse tool choice. Instead: a
   searchable data catalog where each entry describes a setting (table, column, scope,
   permission, value type, write strategy, and a plain-language MECHANISM), a keyword
   search tool, a read-one tool, and ONE generic `set_setting` verb that reads the entry
   and does the write. Adding a setting = adding a data row. *Why:* the agent scales to
   hundreds of settings with a handful of tools, and the catalog doubles as the coverage
   checklist and the agent's knowledge base. *Gotcha:* the catalog's `mechanism` text is
   the agent's ONLY understanding of the feature at runtime (see 10); write it well.

5. **The two-model reply pipeline: a WORKER model and a HUMANIZER model.** The worker
   (strong, has all the tools) writes the full, detailed answer, and THAT full text is
   stored as conversation history so the model keeps its context next turn. Then a SECOND,
   separate model (its own prompt, its own billing line) rewrites that answer short, warm
   and human, and THAT is what the user sees and what you store as the display copy. *Why:*
   the model keeps rich context for good reasoning, but the human reads something that
   sounds like a sharp colleague texted back, not an AI. *Gotcha:* store BOTH (full =
   history, short = display); never feed the shortened text back as history or the model
   loses detail. Guard the rewrite: only show it if it preserves every number and is not
   longer than the draft, else fall back to the draft.

6. **A deterministic anti-slop pass in SOFTWARE (not a prompt).** After the humanizer, a
   pure code function strips the AI tells a prompt cannot be trusted to remove: long dashes
   to commas, curly quotes to straight, the ellipsis glyph to three dots, exotic spaces to
   normal. It runs LAST on every user-facing string. *Why:* a prompt saying "no long
   dashes" fails often enough to matter; code never does. *Gotcha:* never touch a comma
   between digits (thousands separators) and never run it on a confirm-card summary (those
   must stay verbatim). Keep the source file pure ASCII (build the characters from code
   points) so it cannot itself carry the characters it strips.

7. **Per-token billing plus a once-per-user cost consent gate.** If the agent costs money
   per use, meter it: one usage row per model call rolled into the user's wallet, and one
   BILLING LINE the user can see so they know what the agent cost them. Before first use,
   show a one-time "this is token-based, it spends from your wallet, I agree" gate, and
   when the wallet is empty, pause with an "add funds" path for those who can and "ask
   your admin" for those who cannot. *Why:* no surprise bills; the user opts in knowingly
   and can see the cost. *Gotcha:* enforce the consent on the SERVER too (a client-only
   gate is bypassable), but fail OPEN on a read error so a DB blip never blocks a paying
   user. It is a consent UX, not a security boundary.

8. **A contact-support tool (the user asks us for help, in-chat).** A tool the user can
   trigger ("open a ticket", "tell your team") that files a real support ticket on their
   behalf, authenticated as them, and hands back a ticket number. Treat it as a genuine
   ACTION. *Why:* the user never has to leave the chat to reach a human. *Gotcha:* this is
   DISTINCT from 9; contact-support is the user deliberately asking us, and it opens a
   customer-facing ticket. Post with the caller's own token so the ticket is authored by
   the real user. A genuine failure to file reports to engineering; a friendly re-prompt
   does not.

9. **The capability-gap loop (the agent tells US when it cannot do something).** A tool the
   model MUST call whenever it is asked to DO something it has no tool for. It records the
   gap (aggregated by a normalized key so repeats become a count, giving you a ranked
   "build this next" backlog) AND fires an internal alert whose copy tells the engineer or
   coding agent who picks it up: this is a MISSING CAPABILITY, not a bug, read the agent
   skill and BUILD it. *Why:* this is the engine that grows the agent toward doing
   everything the UI can; every unmet request becomes a signal you receive automatically,
   even if the user never complains. *Gotcha:* fire it at INFO/low severity deduped by the
   gap key (it is a backlog signal, not a fault, so no email spam), and it is NOT 8 (this
   fires automatically; contact-support is user-initiated).

10. **Durable interaction logging plus the runtime-knowledge boundary.** Log EVERY turn
    attempt (including ones blocked before they reach the model: consent, funds, rate
    limit) to an append-only analytics table, separate from the raw transcript, so over
    time you can see where users get stuck and what they keep asking. AND understand the
    hard boundary: the RUNTIME agent CANNOT read your build-time skills or docs (those are
    for coding agents). Its only knowledge is its system prompt plus the catalog mechanism
    text (4); it can only ever DO what a tool lets it. "Give the agent a skill" means
    enrich the catalog knowledge and build the tool, never "point it at a markdown file".

A capability is not done until the after-build sources of truth are current: the plan doc,
the memory/notes, and this skill if you added a new capability PATTERN.

---

## 2. The suggested module layout (one responsibility per file)

Names are examples; keep the separation.

| Module | What it is |
|---|---|
| verb registry | The verb CONTRACT: the definition type, context type, result type, a validation-error class, the registry map, and the function that builds the tools payload for the model. Pure contract. Do not put verbs here. |
| register-verbs | A side-effect module that imports every verb file and registers it. Adding a verb = two lines here. |
| `verbs/*` | One file per verb. This is where a capability's logic lives. |
| access gate | The layered gate (gate the request, evaluate access, is-this-action-permitted) plus the permission type. |
| read tools + `tools/*` | READ/diagnostic tools. Gather freely, no confirm. |
| run-agent | The loop: bounded iterations, tool choice auto. Injects situational context. |
| routes | The propose and confirm HTTP handlers. Generic over the registry; you never touch this to add a verb. |
| proposals | Stash plus the atomic single-use claim. |
| conversation | Persistence, window loading, the context system message. |
| caller client | Builds a DB client that acts AS THE USER (their token), so row-level security runs. |
| system prompt | Lives with the per-feature model config (see `ai-model-platform`), tunable as data. |

Ship the whole agent behind a launch flag until the UI exists. Building a verb then does
not expose it to users; it just makes the agent ABLE to do it once launched. Ship verbs
freely.

---

## 3. The frame you are plugging into

**propose -> confirm -> execute.** Nothing writes without user confirmation.

1. The model calls a write verb. The loop routes it to `preview()` (NOT execute). `preview`
   validates the args, verifies the target exists and is owned by this tenant/location, and
   returns a normalized `args` object (JSON-safe) plus a human `summary` for the confirm
   card. It NEVER writes.
2. The proposal is stashed with the normalized args in a privileged-only table (JSON).
3. The user confirms. The confirm route does an atomic single-use claim of the proposal,
   RE-RUNS the full gate (entitlement, allowlist and permission can change between propose
   and confirm), calls `execute()` with the stashed args, then writes the attribution
   ledger (made-via-agent plus who-commanded-it).

Because the gate re-runs at confirm and the context carries the FRESH confirm-request
token, a verb that writes as the caller gets the user's exact permissions at execute time.

---

## 4. FIRST DECISION: is this a SETTING (catalog entry) or an ACTION (dedicated verb)?

The agent has TWO ways to gain a capability. Picking the right one is the first thing you do.

| The capability is... | Build it as... | Effort |
|---|---|---|
| A **setting** the user changes: a toggle, a number, a choice, a text, a list on a settings screen | A **catalog entry**. The generic `set_setting` verb reads the entry (column, table, scope, permission, value type, write strategy) and does the write. **No new verb file.** | Minutes |
| An **action** with real logic: book, check out, send a message, a cascade, a money path, anything spanning several tables or an engine/function | A **dedicated verb** file, plus a catalog entry that POINTS at it (write kind "dedicated verb") so the agent can still find it by searching. | Hours |

**Why the catalog exists:** a real system has hundreds of settings (one settings table in
the source system had 115 columns). One verb per setting would bloat every model request
and confuse tool choice. Instead the agent searches ONE catalog, reads the match, and calls
ONE generic verb. The catalog is also the live coverage checklist (list entries whose
status is "gap" = the build queue) and it carries the REASONING layer that makes the agent
a smart advisor:

- **Capability entries**, one per setting: UI path, label, the synonyms a user would SAY,
  what it does, the **mechanism** (how it really works, the gotchas), scope, permission,
  value type (with every enum option's label and a hint), the write strategy, the help
  article slug, related entry ids, status.
- **Knowledge entries**: a **mechanism entry** (how a subsystem works end to end, the
  if-this-then-that) and a **playbook entry** (a goal with several routes, the tradeoffs,
  the recommended one, and the steps). This is what lets the agent answer "what is the
  best way to..." instead of guessing.
- **The index**: the registry plus deterministic keyword search. Rank label over synonyms
  over path over body; an exact synonym phrase is the strongest signal.
- **Value coercion**: pure functions for coercion and display (dollars to cents, enum by
  value OR label, JSON list validators). Unit-tested without a DB.
- **The generic verb**: its static permission is "none"; it enforces the ENTRY's permission
  at preview AND execute, then writes as the caller so row-level security is the final
  guard.

### Adding a setting to the catalog (the checklist)

1. **Verify the mechanism from the UI, never from memory**: which table and column, the
   check constraint or enum values (pull the live constraints), the write policy (pull the
   live policies), units (cents? percent?), scope (per-location row vs account-wide), and
   what ELSE the UI writes alongside (paired legacy flags, dependency resets, cascades).
   Read the component's save function.
2. **Pick or add a write strategy.** A new table with its own save semantics = a new
   strategy implemented ONCE in the generic verb, mirroring that UI's save exactly.
3. **Write the entry**: label = the UI's exact label; synonyms = what a user would SAY
   (steal the UI's own search keywords and tooltip wording); mechanism = the tooltip plus
   the verified facts; permission = what the write policy actually requires; value type
   with every option's label and hint; help slug; related ids; status covered.
4. **Add knowledge when the setting is part of a bigger story**: a mechanism entry for how
   the subsystem works, a playbook entry when there are several ways to reach a common
   goal. Not optional for settings with tradeoffs; it is what makes the agent recommend
   the right way.
5. **Prove it**: run a no-DB harness that checks referential integrity (every related id
   exists, every strategy column is in the write list), search ranking for the phrasings
   you expect, and value coercion. Then typecheck. Optionally evaluate the write shape
   against the live constraints with a pure SELECT.
6. **Never expose a legacy column that has no UI control**; pair it automatically if the UI
   does.

### Write strategies (the shapes that came up; yours will differ)

| Strategy shape | What it writes | When |
|---|---|---|
| per-scope settings row | the location row of a settings table; update by id, else CLONE the account-wide row and change one column (never a sparse insert) | a plain per-location setting |
| account-wide settings row | the row with a null scope id; update else insert | account-level switches |
| one key inside a JSON config | merges defaults + current + the change; keeps the config's invariants and "ready to send" guards | grouped alert/notification configs. Mirror the frontend's defaults in one server file or the harness fails |
| a column on a core entity table | with entry-specific dependency guards in the generic verb | per-location or per-account flags |
| settings row with a unique key | partial upsert on the unique key; add the table to the allowed union plus its column list | small one-row-per-scope settings tables |
| scope-dependent routing | writes table A or table B depending on a mode (for example a per-location vs account-wide wallet) | settings whose home depends on a mode |
| dedicated verb | REFUSED by the generic verb; the entry tells the model which verb | lists, CRUD entities, anything with side effects |

Entity lists (statuses, categories, teams, reminders) are verbs, not settings. Count read
tools as valid "dedicated verb" targets too.

**The regression harness (no DB)** should fail on: duplicate ids, a dangling related id, a
strategy column missing from the clone list, a JSON key missing from the defaults, a
covered dedicated-verb entry whose verb is not registered, and the ranking cases. Run it on
every catalog change.

---

## 5. The verb contract (what you implement)

```ts
// EXAMPLE shape. Rename to the repo's conventions.
export const myThingVerb: VerbDefinition = {
  name: 'do_my_thing',            // stable id + ledger tool name (snake_case)
  permission: { kind: 'resource', resource: 'my_table', flag: 'can_edit' },
  description: '...',             // what the MODEL sees: WHEN to use this + the mechanism
  parameters: { type: 'object', properties: { /* ... */ }, required: [], additionalProperties: false },

  async preview(rawArgs, ctx) {
    // 1. Validate every field. Throw a validation error with a friendly re-prompt
    //    on anything missing or ambiguous.
    // 2. Verify the target belongs to ctx.tenantId (+ ctx.locationId if scoped). Resolve names.
    // 3. Return { args: <normalized JSON-safe object>, summary: '<plain confirm card text>' }.
  },

  async execute(args, ctx) {
    // Perform the write with the normalized args.
    // Return { ok, targetTable, targetRecordId, message, data, internalError? }.
  },
};
```

The context is `{ caller, tenantId, locationId }`, all already gate-verified. Registration
is the only wiring: import the verb and put it in the registry. The loop, the propose route
and the confirm route are generic over the registry.

**The permission kinds:**
- `resource` + a flag (can view / can edit / can edit all): checks that flag on the role's
  permissions. Use the SAME resource and flag the UI uses for this action. Match "edit
  all" when the policy specifically requires it, not just "edit".
- `privilege` + a max level: role seniority at or above a level. Use for actions gated by
  seniority rather than a table flag.
- `none`: no specific action permission (a caller's OWN self-only data such as their own
  notification preferences; the self-only row policy is the real guard).

**Owner-only tables.** When the live write policy is "owner or super admin only", there is
no resource to name: use the privilege kind at the top level. Pull the policy before
choosing. A wrong kind either blocks admins who could do it in the UI, or lets the gate
pass and the write gets refused at execute.

**Declare the permission with the resource name the policy actually uses.** Verify against
the live policies (singular vs plural resource names have bitten). The harness does not
check this; the live permissions table does.

---

## 6. SECURITY: the agent ALWAYS has the permissions of THAT user, at THEIR locations

Non-negotiable. The agent may only ever do what the calling user could do by hand in the
UI, at the locations they can access. Two layers enforce it and you must get BOTH right.

### Layer 1: the gate (runs before preview AND again before execute)

In order, cheapest first:
- **Location/tenant access**: the user can access this location (owners bypass). The agent
  is LOCKED to the location the UI's picker has selected. Enforce this as a prompt rule
  (refuse another location and point at the picker) AND structurally (the chat surface
  binds to one location id; every tool uses the gate-verified location from context).
- **Entitlement**: the location has the agent add-on.
- **Allowlist**: the user is allowlisted to use (and spend on) the agent; owners and admins
  automatically.
- **Action permission**: the verb's declared permission against the caller's role.

### Layer 2: WRITE AS THE CALLER when the table has row rules the gate cannot fully mirror

The gate checks ONE account-level flag plus location membership. Several tables' policies
restrict FURTHER: a user with plain "edit" may book only their OWN calendar, not other
people's; commission rules are admin-only; notification preferences are self-only. A
privileged write BYPASSES all of that and lets the agent do something the user's policies
forbid.

**The durable fix: run the WRITE as the calling user, so their exact policies enforce it
natively and any future policy change is inherited automatically.** Build a caller-scoped
client (the public key plus the caller's token, so the DB's "current user" resolves to
them). READS and lookups may stay on the privileged client; the WRITE is what must carry
the user's permissions.

**When you cannot use the caller client** (a shared engine or privileged function that must
run privileged): replicate the policy rule inside the verb. Example: for a booking-type
verb, when the caller lacks "edit all", constrain the staff member to the caller's own
record (or refuse booking someone else), mirroring the table's policy. Put that ownership
check in one shared helper.

**Decision rule:**
- Plain table insert/update/upsert/delete -> the caller client.
- A privileged function or shared engine that self-authorizes -> privileged is fine, but
  VERIFY the function does its own caller auth; if it keys off the current-user id, call
  it via the caller client so that id is set.
- **A function the UI already writes through: call the SAME function as the caller.**
  Never re-implement its table writes. Its own checks and audit stamps then apply.

**Prove it, do not assume it.** Before finalizing a verb, PULL the live policy of every
table and function it writes and confirm the gate plus the write client together are
equivalent to (or stricter than) that policy for every role. That is a read-only schema
query. Have the confirm route turn a permission-denied DB error into a plain permission
message.

---

## 7. UNDERSTAND the mechanism, do not write dumbly (the "smart advisor" bar)

The bar: the agent must understand HOW a thing works, recommend the RIGHT way to achieve
the user's real goal, explain what it will do and the effect, then confirm. Not blind
literal execution. Put "BE A SMART ADVISOR, NOT A BLIND EXECUTOR" in the system prompt so
every new verb inherits it.

- **Read the domain's skill/doc and pull the live schema BEFORE building the verb**, so the
  verb encodes the true mechanism and not a guess. A verb that writes a raw boolean when
  the UI runs a cascade (enabling a feature also seeds a calendar, recurring payments and
  a geocode) is a HALF feature. Mirror what the UI's save actually does, including
  per-location override routing vs base-table writes, dual-write caches, trigger-guarded
  columns, and unique-constraint collisions (return a friendly message, not a crash).
- **TAKING PAYMENT (the safe pattern; read `money-truth-doctrine` first).** (1) NEVER
  hand-roll a payment: route every tender through the one canonical payment function the
  UI uses, and verify its parameter names against the LIVE function definition. (2) The
  agent NEVER touches raw card data. A SAVED card is charged off-session by calling the
  UI's OWN charge route as the caller, with a payment-method id that came from a read
  tool, so the route records the row and applies every guard. (3) A NEW card the customer
  must enter is NOT collected in chat: the verb refuses and directs to a "send payment
  link" verb (a hosted link the customer opens). "Make it safe with a link" is the rule
  for any customer-not-present card payment. Card-present terminal taps are deliberately
  NOT agent-driven; they need the physical reader and a person at the register.
- **Teach the model in the tool description and the system prompt.** The description tells
  the model WHEN to use the verb and the load-bearing rules ("this adds to the
  notification LIST, it does not change anyone's login"). Add a short primer to the system
  prompt for a mechanism the model must reason about across verbs.
- **Give the agent a READ tool to see current state** so it can explain before it changes.
  A verb that changes state is better paired with a read tool that reveals that state.
- **Help docs as the agent's manual.** A search-and-read tool over the customer-facing help
  center lets the agent learn a feature's intent and edge cases the way a human would. If
  it does not exist and the feature is subtle, note the gap.

---

## 8. Read / diagnostic tools (gather freely, no confirm)

For a capability that only READS (look something up, diagnose "why is X not working"), add
a read tool: one `run(rawArgs, ctx)` that MUST NOT write and returns
`{ ok, payloadForModel, summary }`. Scope every read to the context's tenant and location.
**Diagnostics must reuse the SAME gates the real path uses** (a "diagnose SMS" tool reuses
the send path's funds and channel checks) so the diagnosis matches reality. Read tools
that must respect row policies carry the caller's token for a caller client.

**The analytics door.** Numbers questions are answered by ONE read tool that wraps the
existing analytics query dispatcher unchanged and makes no model call of its own. The
entity definitions live in one shared file every door reads. Pass the page the user is on
as a hint so "how did this do last month" resolves.

---

## 9. Software-first context: only rely on the model when you really need it

The rule: **anything the software can know deterministically is resolved BEFORE the model
runs and handed to it. The model is never asked to call a tool to learn what the database
already holds.**

- Build a **preamble loader**: a few small parallel reads (account name, location and
  city, timezone and today's date, the kind of business, which features are on, the
  account's own vocabulary) rendered into a "WHAT YOU ALREADY KNOW" system message,
  injected as the second system message every turn. Rebuilt each turn (it is cheap), so a
  change made on turn N is known on turn N+1.
- It includes the OPENING instruction: if the fact is known, "greet with it, do not ask";
  if it is not set yet, "ask first, then record it with the one tool that needs a human".
- It degrades to a generic preamble (with a silent alert) on a DB blip instead of failing
  the turn.
- **Landmine: do NOT add a "fetch my context" tool.** If the agent needs a new fact the DB
  holds, add it to the preamble. Tools are for things that need the user (a write) or real
  work. A context tool costs a round trip and invites a hallucination.
- Keep per-vertical knowledge (vocabulary, key entities in order, gotchas) in a code
  profile the preamble renders, because the runtime agent cannot read your skills.
- Write a read-only smoke script that prints the exact preamble the model receives for a
  given account, and run it on a few real accounts (known type, catalog type, unset).

**Per-user memory.** Inject one system message per turn from a per-user memory table, and
extract durable facts after a turn with a cheap model, fire-and-forget. Never store a
customer's personal data as memory; guard it with BOTH the prompt and a regex. No wiring
is needed per capability: facts are extracted from the conversation itself.

---

## 10. Errors: what alerts, what does not

Per `error-alert-system`:
- A genuine DB or function failure on a write IS engineer-actionable: report it in the
  execute catch with a stable type and a greppable `module.verb` source. Read-tool
  failures report silently (recorded, no page).
- A BY-DESIGN outcome must NOT page: a validation error thrown in `preview` is a friendly
  re-prompt; a no-op guard, an expected refusal (opted out, already in that state, a
  duplicate handled as friendly), or a permission the gate already caught are not
  incidents. Real failures alert, by-design outcomes do not.

### "Our team has been notified": the failure-UX contract every agent must honor

When ANYTHING the agent does fails with a real internal error, the user MUST be told, in
the agent's own voice, that **our team has been notified** and they can try again. Never a
bare "I could not do that", never silence, never a claim that the feature is missing.
There are THREE distinct code paths and they do not cover each other.

**The invariant:** the user hears "our team has been notified" only when it is TRUE (we
actually reported it), and NEVER on a by-design refusal (permission denied, not found,
insufficient balance, opted out, already in that state). A false "we were notified" on a
normal refusal is as bad as silence on a real failure.

**Path 1: READ tools and the PROPOSE step (goes back through the model).** A read tool or
a `preview()` that hits a real internal error returns `{ ok: false, error: { kind:
'internal_error' } }` to the model. The system prompt makes the model narrate it ("I hit a
temporary hiccup, our team has been notified automatically, try again in a moment", never
"the tool is broken" or "the feature is missing"). So: return that kind on genuine
failures (a validation error is NOT this), and keep the prompt rule that maps it to the
notified line.

**Path 2: the WRITE result at confirm time (rendered DIRECTLY, bypasses the model).** The
load-bearing lesson: `execute()` runs at CONFIRM time and its result message is sent to
the user **verbatim, without passing back through the model**. The prompt rule cannot
reach it. The ONLY mechanism is a field on the result:
- Add `internalError?: boolean` to the verb result.
- Set it true in every execute path that returns not-ok because of a REAL internal failure
  that was ALSO reported (the top-level catch, or right after a non-silent report of a DB
  error with a generic "I could not... please try again" message).
- Do NOT set it on a by-design not-ok (permission denied, friendly duplicate, not found,
  insufficient, already). Two returns in the SAME verb often differ: the permission-denied
  branch is unflagged, the top-level catch is flagged. Get this per RETURN, not per verb.
- Every confirm renderer (the web sheet, each messaging channel host) appends " Our team
  has been notified." when the flag is true and the message does not already contain
  "notified". Wire it once at each render point.

**Path 3: the AGENT LOOP itself failing (provider down, empty response).** The gap that
shipped and had to be fixed: the loop emits an `error` event when it fails (it has already
reported it). The web sheet rendered that event. But the messaging-channel host's emit
interceptor only handled the ack, progress, final and proposal-ready events, so over
SMS/WhatsApp the error event was silently DROPPED and the user got NOTHING back. **Every
host that consumes the agent's event stream MUST render the `error` event and the
iteration-cap-hit event into an actual message**, or that surface goes silent on failure.

**Rule of thumb:** at every place a user can hit a wall, ask "did we report this?" If yes,
they hear "our team has been notified". If it is a by-design refusal, they get a plain,
specific reason and NO notified line. Never a dead end, never silence, never a false claim.
This is also why every agent needs the contact-support tool.

---

## 11. The reply pipeline in detail

What the user READS is not what the main agent WROTE.

- The main agent writes a full, detailed reply. That full text is persisted as the
  message's `content` and is what the model sees as history next turn.
- For a plain reply (no tool calls), a humanizer call (its own feature key, its own prompt
  and pricing, may share the provider key) rewrites it short, warm, human. The rewrite is
  persisted as `display_content` and emitted as the final event. The client shows
  `display_content ?? content`, on reload too.
- **Deterministic guards decide whether the rewrite is shown**: non-empty, not longer than
  the draft (about 1.15x plus 40 characters of slack), and every number and money amount
  in the draft survives. Otherwise the stripped DRAFT is shown. Any error or timeout also
  falls back. The user never gets a blank or blocked turn.
- **The slop stripper always runs LAST** on every user-facing reply: a long dash between
  words becomes a comma, at a line edge it is dropped, the hyphen-minus is untouched,
  curly quotes become straight, the ellipsis glyph becomes three dots, exotic spaces
  become a space. Use it on any NEW user-facing agent text. NEVER on confirm-card
  summaries: money and settings are approved verbatim there.
- **Billing:** the humanizer's tokens are one more usage row under the SAME usage type as
  the agent (tagged with a stage), so the billing page shows one all-in "AI assistant"
  number and the existing roll-up covers it. Do not invent a second usage type for a pass
  that belongs to the same feature.
- **LANDMINE: two features on one provider key.** If telemetry maps key VALUE to feature
  with a map, the last config row loaded wins and the other feature's spend is
  misattributed. Every caller on a shared key passes the feature EXPLICITLY (the loop, the
  memory extractor, the humanizer, the summarizer). See `ai-model-platform`.

---

## 12. How the agent GROWS

Two mechanisms make "do everything the UI can" a closed loop instead of a hope.

- **Every turn is logged, durably.** One row per turn attempt in an append-only,
  privileged-only interactions table, INCLUDING turns that never reach a conversation: a
  consent refusal, an out-of-funds refusal, a rate limit (logged before each early
  return), and every completed run (logged at the end of the loop with the outcome, the
  tools used, and whether a gap was hit). The transcript still lives in the messages table
  and is never purged. Do not confuse them: messages = transcript, interactions = one row
  per turn of signal.
- **When the agent cannot do something, WE find out automatically.** The gap tool: (1)
  records/aggregates the gap by a NORMALIZED key, so "move the number to the other store"
  and "transfer the phone to store B" collapse to ONE row with an occurrence count; (2)
  fires ONE internal alert at INFO severity, silently deduped, that auto-escalates only
  after many occurrences (about 25). Its metadata carries an is-capability-gap marker and
  build instructions, which the alerts board's "copy for AI" turns into a preamble telling
  the picking-up agent: this is a MISSING CAPABILITY, not a bug; read the agent skill;
  build the verb or tool; resolve only once it is built. The system prompt enforces
  calling it (a "you are in beta" rule).

**When you BUILD a capability that was a gap:** add the verb per this skill and the flow
self-heals (a fresh occurrence reopens a resolved gap; once the tool exists the model stops
reporting the gap). Both the gap tool and contact-support can fire in one turn.

**The DETERMINISTIC gap path (no agent turn).** The model-driven tool only fires inside a
turn. Some "we cannot do that yet" cases happen BEFORE a turn runs, most importantly
unreadable inbound media on a channel (a scanned PDF, a video, a word-processor doc). Call
the SAME record-gap function and fire the SAME alert straight from the webhook, so "for
ANYTHING a user asks that the agent cannot do, we get notified so we can add it" holds
even when no model turn runs. When you add a channel or media capability, keep this call
on the "cannot read it" branch.

---

## 13. The agent over a CHANNEL (SMS, WhatsApp) and MULTIMODAL

The agent can be reachable over SMS and WhatsApp so an owner runs their business from
their phone. Keep it dormant behind an env flag until launched.

- **Architecture: ONE shared number per channel that belongs to the product.** Every user
  across every account messages the SAME number. IDENTIFY them by the sending phone
  matched to a verified phone on their user record (layer 1), and AUTHORIZE a sensitive
  action through a real LOGIN LINK (layer 2) that ALSO mints the refresh token the agent
  needs to write as the caller over a channel that has no bearer header. It is the
  product's account, not sending on the user's behalf, so there is no per-user onboarding.
- **One brain, many doors.** A channel adapter seam (`send`, `react`, `sendVoice`,
  `supportsReactions`, `supportsVoice`) plus an inbound message type; a channel-agnostic
  host that does identify, STOP/START, a one-time AI disclosure, funds/rate/gate PARITY
  with the web route, confirm-over-text, the login gate, and ack/progress/reaction
  rendering; one small transport per channel. The brain is the same run function, so a
  new verb works on the channel for free.
- **Multimodal, all REUSING existing features:**
  - **Voice note IN:** transcribe with the existing transcription feature into the inbound
    text and remember that the user wants a voice reply.
  - **Image IN:** download, encode, pass as an image content part to a vision-capable
    model. The transcript stores only the text; images are not replayed on later turns.
  - **PDF IN:** extract the text layer with a pure-JS extractor and feed it as text. A
    SCANNED PDF has no text layer: detect it, reply asking for a photo, AND record a media
    gap (server-side rasterization is the thing to build later).
  - **Voice note OUT:** synthesize with the existing text-to-speech feature. When the user
    sent a voice note, speak the final answer AND send the text so a readable transcript
    stays in the thread. Only on channels that support voice.
  - **Billing decision:** speech-to-text and text-to-speech are platform-absorbed (free to
    the customer); the reasoning turn still bills. Keeps "talk to it while driving" free,
    which is an adoption goal.
  - **Unreadable media never goes silent:** anything the agent cannot read (a scanned PDF,
    a video, a sticker, a location) gets a short agent-voiced reply ("I can read photos,
    PDFs and voice notes, send one of those or type it") plus a recorded media gap.

---

## 14. Long conversations: compaction, windows, and files

- **The big DATA never enters the conversation.** Tools send the model headers, a few
  sample rows and counts; the full rows stay elsewhere. Compaction only condenses the
  back-and-forth REASONING.
- **Compaction (summarize the first half, keep the last half verbatim).** At the END of a
  cleanly completed turn (never on error or cap), when the live history crosses a token
  budget (about 40k, well under the window), split at the token MIDPOINT on a SAFE
  boundary (before a user or assistant message, never orphaning a tool result). Summarize
  the FIRST half with a separate call into ONE dense, logic-only summary and FOLD the
  prior summary in (merge, do not append). Store it on the conversation row; prepend it
  each turn. Keep the LAST half VERBATIM.
- **Never delete history.** Stamp the summarized rows as compacted so the loader excludes
  them from the model; the raw rows stay forever (audit, and the client's history reload
  reads the full transcript). Never summarize the whole thing: that loses the vivid recent
  turns. Use hysteresis (keep roughly half the trigger) so it does not re-compact every
  turn. If the summarizer returns nothing usable, do NOT compact.
- **Summarize-then-stamp, in that order.** A crash between them duplicates content, which
  self-heals at the next compaction. Stamp-first would LOSE content.
- **Hardening:** the summary's own tokens count toward the trigger and it is hard-capped
  on write (it is prepended every turn). If the kept half has no safe split boundary, fall
  back to the EARLIEST safe boundary (never give up, or growth is unbounded). Cap the scan
  and the summarizer input for the pathological case.
- **Sanitize every loaded window.** Make the loaded window a VALID tool-calling sequence
  at BOTH ends: drop leading orphan tool-result rows and any leading or trailing assistant
  message whose tool calls do not all have results. Otherwise a window boundary, or a turn
  that died mid tool execution, makes the provider reject the next request. Order rows by
  created time THEN id for a deterministic tie-break.
- **Durable file references.** An uploaded file never floods the chat. Store the raw file
  in private storage under the user's own folder (their token, so storage policies scope
  it), persist a descriptor (token, path, name, row count, headers, NO row data) on the
  conversation ROW (so compaction, which only stamps message rows, never loses it), inject
  a "files you have" system line each turn, and give the agent a tool to re-read a file
  from its path as the caller. Re-validate the path is under the caller's own folder.

---

## 15. More than one agent

- Each conversational agent has its OWN feature key, OWN prompt, OWN conversation tables,
  and usually its own key and wallet bucket. Keep a one-table MAP in this skill of every
  agent: who talks to it, where the code is, its feature key, how to extend it.
- **Cross-agent referral: every agent knows the others exist.** A narrow agent refuses
  off-topic requests and points to the main assistant; the main assistant refuses the
  narrow agent's job and points there. A narrow agent's toolset contains ONLY its tools,
  so it is structurally incapable of the other agent's writes even if prompted.
- **A stale stored prompt silently drops the referral.** If prompts are overridable in the
  DB, a stale override wins over the code prompt you just edited. Keep the override null
  so the code prompt ships, or re-sync on every edit.
- **Merging a legacy agent into the main one is a CUTOVER, not "delete the key".** Fold the
  old agent in as a read TOOL of the main agent first. The old key is a DIFFERENT key;
  deleting it alone breaks the fallback path if the main agent is ever disabled. Do it in
  one pass: remove the fallback branch in the UI, delete the dead frontend surface (keep
  the shared definitions the new tool needs), unmount and delete the old route and loop,
  only THEN deactivate the config row and remove the env var, and last drop the old
  conversation tables (a drop needs the owner's explicit yes). To improve an answer,
  edit the shared definitions or add a read tool on the main agent; never add to the
  legacy loop.

---

## 16. The exact checklist to add ONE capability

1. **Read the mechanism** for the domain and pull the live schema of every table,
   function, trigger and constraint the write touches. Never build from memory.
2. **Decide read vs write, setting vs action.** Read-only -> a read tool. A setting -> a
   catalog entry. An action -> a verb.
3. **Pick the permission** that matches the UI's real gate. Pull the live policy and
   confirm the gate mirrors it.
4. **Write the verb**: `preview` (validate, verify-owned, normalize, summary), `execute`
   (write). Caller client for plain-table writes; replicate the rule in-verb for engine or
   privileged paths. Mirror EXACTLY what the UI's save does (cascades, per-location
   routing, dual-writes, friendly collision handling).
5. **Teach the model**: a description that says when to use it and the load-bearing rules;
   a short system-prompt primer if it needs cross-verb reasoning; pair a state-changing
   verb with a read tool.
6. **Register** it.
7. **Wire alerts**: real failures page and set `internalError`; by-design outcomes do not.
8. **Verify by doing, not declaring.** Typecheck, then exercise the write shape against the
   live policies (a rolled-back transaction, or pure-SELECT evaluation of constraints) to
   prove it is constraint-valid AND that a lower-permission user is correctly refused. Do
   NOT trust "it typechecks".
9. **Update the sources of truth**: mark it done in the plan doc; record a note if the
   mechanism is non-obvious.
10. **Help docs and changelog**: the agent capability rides the same after-build sources of
    truth as the feature it mirrors (the article listing what the agent can do).

**Live preview smoke test (read-only).** Every `preview()` only reads, so you can run it
against a real account before shipping: a scratch script that imports the registry, builds
a context for your own user/account/location, calls `preview(args, ctx)` for each new verb
and prints the summary. A privileged key as the stand-in caller token works for
privileged-client reads; caller-scoped reads will complain the stand-in is not a real user
token, which is expected. Never let the script call `execute()`. Delete it after.

---

## 17. Landmines (each has bitten a real build)

- **A privileged write on a table whose policy restricts by ownership, "edit all",
  self-only or role**: the agent lets a user exceed their permissions. Use the caller
  client, or replicate the rule.
- **A bare column write where the UI runs a cascade**: a half-configured result. Mirror
  the UI's full save.
- **A base-table write where the field is a per-LOCATION override** (price, duration or
  commission living on a per-location join table): wrong scope. Route per the UI.
- **Stashing a non-JSON value (a date object, a map, undefined) in the proposal**: it does
  not survive the round trip. Normalize to plain JSON in `preview` (dates as ISO strings,
  money as integer cents).
- **Paging engineering for a friendly refusal or a no-op**: alert noise.
- **An overlapping or duplicate verb** (two tools that do the same write): model ambiguity
  plus tokens. One verb per capability; supersede a narrow one instead of adding alongside.
- **A channel host that ignores the loop's error event**: silence on failure over SMS.
- **Feeding the humanized text back as history**: the model loses detail turn by turn.
- **Running the slop stripper over a confirm card**: it alters what the user approved.
- **A "fetch my context" tool**: put the fact in the preamble instead.
- **A stale DB prompt override**: your code prompt edit never ships.
- **Apostrophes in generated source.** When a patch script writes catalog text into
  single-quoted string literals, reword to avoid apostrophes ("of a product" instead of
  the possessive). Escaping through a script plus a shell heredoc has silently lost the
  backslash more than once.
- **New tool-calling models may need a different API surface.** See `ai-model-platform`:
  one provider's newer reasoning models reject function tools on the older chat endpoint.
  Put the adapter in ONE shared module and reuse it; do not fork it per agent.
