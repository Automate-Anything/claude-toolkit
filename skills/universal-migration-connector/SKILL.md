---
name: universal-migration-connector
description: How to build the "give me your username and password and I will do the rest" connector that signs in to a customer's OLD system on their behalf and pulls their data over for migration. Covers the vault security model (credentials are a server-side variable the AI never sees, never in chat, never in the DB, never logged), the layered engine that always has a next step (server-side API login, headless stealth browser on a separate service, the one-tap bookmarklet in the user's own tab), the auth-step engine (one-time codes, verification links, out-of-band approvals, account slugs, chained), the sandboxed AI-planned crawl (egress allowlist frozen at login, PII-stripped page snapshots, a structured plan the worker re-validates, a guarded evaluate escape hatch), anti-bot resilience enforced in software (human pacing, a per-host pace governor, challenge detection, yield never fight), and the bot-block alert loop. This is a pattern to BUILD per repository. Read it BEFORE building anything that logs in to a third-party site with a user's credentials, drives a headless browser on a user's behalf, lets a model plan a crawl or scrape, or handles a user's password for another service. Use when the user mentions a migration connector, auto-import from a competitor, "log in for them", scraping the old system, headless browser, Playwright or Puppeteer stealth, CAPTCHA, Cloudflare blocks, bot detection, one-time codes during login, a bookmarklet import, or prompt-injection risk from a crawled page. For the mapping and import that follow, read `ai-data-migration-agent`.
---

# Universal Migration Connector: "username + password, I will do the rest"

> ## ADAPT BEFORE USE: THIS IS A PATTERN, NOT INSTALLED CODE
> This describes how a login-and-pull connector SHOULD be wired. It is taken from a
> production system and stripped of that product's names and vendors. Nothing here exists
> in your repo until you build it. File, function and field names below are EXAMPLES of the
> shape; grep before citing any. The code wins. Once built, update this skill with the real
> module names, the list of live-verified vendor recipes, and the current status of each
> layer. Check each target system's terms before automating against it; that is the owner's
> decision, not the agent's.

The headline experience: instead of asking the customer to export or paste, the agent
offers to do the WHOLE migration from their login. They enter their OLD system's username
and password in a SECURE popup, and our server signs in and pulls everything over. Auth
hiccups (a code, a verification link, a device approval, an account slug) are handled by
asking for exactly that, through the same secure popup. It is a layered engine that
degrades invisibly so it can handle any direction.

Read alongside: `ai-data-migration-agent` (what happens to the data once pulled),
`ai-model-platform` (the wrapper every planner call goes through), `error-alert-system`.

---

## 1. The vault / security model (non-negotiable)

Credentials are a server-side VARIABLE, never seen by the agent. The flow is: customer ->
SECURE popup -> the connect endpoint -> an in-memory session only. They are:

- NEVER in the chat thread,
- NEVER in the conversation messages table,
- NEVER sent to the model,
- NEVER written to any database,
- NEVER logged. Log step names, statuses and cookie NAMES only.

The remote session (cookies, tokens, browser context) lives only in memory for the
duration of the migration, then is discarded.

The connector only READS the customer's OLD system. The import into the app still runs
under the user's own permissions, unchanged (see `ai-data-migration-agent` section 5).

The tool the agent calls carries NO credentials: it returns an action, the loop emits a
"secure connect ready" event, and the client opens the secure dialog. The agent MUST
explain the safety first (the password goes in a secure box it never sees; a blocked
sign-in falls back to export or paste); enforce that script in the system prompt.

---

## 2. The layered engine (always has a next step)

1. **Layer 1: server-side API login and crawl.** Plain HTTP against the vendor's own API
   or GraphQL. Fast, no browser. If you already have a live-verified vendor connector,
   WRAP it as a recipe; do not rewrite it.
2. **Layer 2: a headless stealth browser** for systems that block a plain fetch login
   (bot walls). **Run it in a SEPARATE service** that already ships a browser and a
   browser pool, with enough memory. The main server delegates over an authenticated
   internal channel (a shared internal-service secret plus a service-name header).
   **DELIBERATE: browsers stay OFF the money-critical server.** Make the delegate a normal
   vendor recipe whose login and crawl call the worker, so the session code needs no
   special-casing.
3. **Layer 3: the one-tap bookmarklet** in the customer's OWN already-authenticated tab.
   The only path no bot wall can block. When a hard CAPTCHA is hit, the engine sets a
   "fall back to bookmarklet" flag and the popup shows "let us do it another way", routing
   back to the chat, where the agent offers export, paste or the bookmarklet. **We do NOT
   pretend to solve CAPTCHAs.**

Crawl order inside the delegate: the bespoke vendor recipe first; on a "no crawl recipe"
signal, the sandboxed planned crawl (section 4); then the honest capability gap plus the
guided-export fallback. The migration never dead-ends.

---

## 3. The auth-step engine (handle any direction)

A recipe can PAUSE at any point and request exactly what it needs, collected in the secure
popup, never the chat. Field kinds:

- `otp`: a code emailed or texted ("did you get a code? enter it"). Two-factor by phone or
  email is the identical path.
- `link`: a VERIFICATION LINK emailed to them (a magic link, "verify this device"). We
  cannot reach their inbox, so they paste the link and the headless browser opens it to
  complete device trust.
- `confirm`: an OUT-OF-BAND action (click a button in the email, approve a push). No
  value; they press Continue.
- `account`: the account slug, subdomain or site id.
- `text` / `password`: any other single value a recipe needs.

The engine can CHAIN steps (password -> code -> link). The session holds the in-progress
login (layer 1) or keeps the browser page open (layer 2) across the step and resumes on
submit.

---

## 4. The sandboxed planned crawl (login is generic; where the data lives is not)

The gap this closes: layer 2 can LOG IN to almost any vendor generically, but the CRAWL
was hand-written per vendor, so a vendor with only a login recipe dead-ended at "automatic
pull not built yet". The fix: for a vendor we are signed in to but have no crawl recipe
for, the worker snapshots the page, the model PLANS the crawl, and the worker executes the
plan. The model emits DATA, not code, and never sees credentials or raw customer data.

### P0: the sandbox floor (attach BEFORE any navigation)

Attached to the credential-bearing browser context before the first navigation:

- **An EGRESS ALLOWLIST** keyed to the vendor's registrable domain (derived from the
  recipe's login URL) that ABORTS any off-site data request. This is the hard wall against
  prompt-injection exfiltration.
- **A same-site endpoint capture** (which of the vendor's own endpoints the page calls).
- **A PII-STRIPPED page snapshotter**: URL, DOM outline, link labels, table HEADERS,
  export affordances and captured endpoints. NEVER cell values.

Register the sandbox route handler so it runs FIRST (allowed -> fall through to the next
handler; blocked -> abort).

**The allowlist is PHASE-GATED.** It may grow during LOGIN (single-sign-on and identity
provider hops need off-site navigation). The session calls `freeze()` the moment login is
confirmed AND at every crawl, snapshot and execute-plan entry. During the CRAWL phase the
allowlist is LOCKED and an off-site document navigation is BLOCKED, not auto-allowed.

> **Do NOT reintroduce an unconditional "off-site navigation is allowed" rule.** Setting
> the page location to an attacker URL with the data in the query string during the crawl
> phase would be an exfiltration channel. Prove the gate with a real two-server browser
> attack harness: login-phase navigation allowed; crawl-phase navigation AND fetch
> blocked.

### P1: the structured-plan executor

The model turns the snapshot into a JSON plan of steps of two kinds:
- **via endpoint**: re-request the vendor's OWN same-site JSON API and page through it;
- **via table**: navigate, read a table or grid, and page through it.

The worker **RE-VALIDATES the plan** (same-site only, GET only, and hard caps: in the
source system 200 pages, 50,000 rows, 12 entities and a 4-minute wall clock) and executes
it deterministically into crawled entities that go to the existing importer. The planner
call goes through the one model wrapper under its own feature key, free to the customer.

### P2: the guarded evaluate escape hatch

For shapes that endpoint and table cannot express, the model may emit a JS function body
that reads the DOM and returns rows. A validator REJECTS it before it runs if it
references network, cookies, storage, eval, navigation, script injection or runtime
primitives. Check two normalization variants so comment obfuscation cannot slip a banned
token through. It runs inside the page's own origin sandbox; the P0 egress allowlist is
the hard backstop. Prove it with a hostile-page harness (the source system used 36
assertions).

### P3: the gate before turning it on

Build and typecheck are not enough. **End-to-end verification on ONE real vendor login is
the remaining gate** before enabling it for connect vendors in production.

---

## 5. Honesty rules

- A recipe's `verifiedLive` flag is TRUE only after its login AND crawl are confirmed
  against a live account.
- The generic headless recipe attempts the common username/password shape; that is safe
  because it is generic. Where the DATA lives is NOT generic.
- **Never hand-guess a crawl path.** The planned crawl is not guessing: the model plans
  against the real logged-in page, every path is re-validated same-site, and nothing
  off-origin can be reached.
- Only if the planned crawl ALSO finds no importable data does the engine fire the
  capability gap and fall back to the bookmarklet.
- The vendor-paths tool returns "secure connect" only for vendors with a recipe, and
  offers it first.

---

## 6. Anti-bot resilience: in SOFTWARE, not the prompt

Bot protection's easiest tell is machine SPEED and rhythm; acting fast triggers a
challenge, a logout or a ban. The fix lives in the browser worker and is enforced in
code. The AI never drives the browser keystroke by keystroke.

- **Human pacing helpers (recipes MUST use these):**
  - type character by character with 55 to 180 ms of jitter plus a rare typo and
    correction; NEVER a bulk fill on a watched field;
  - click by moving the mouse in steps to an OFFSET point inside the element, with a
    dwell; never a zero-millisecond center click;
  - pause to "read" after navigation; scroll like a person.
  The code FLOORS the rate, so machine-fast is physically impossible and the AI cannot
  override it.
- **A pace governor:** a per-host token bucket, a minimum of about 8 seconds plus jitter
  between login attempts, and a 10-minute COOLDOWN after any challenge. The session asks
  for a login slot before connecting. In a cooldown it REFUSES and falls back to the
  bookmarklet; it NEVER waits and retries into a wall. A step delay spaces crawl pages.
- **Challenge detection:** recognize the common CAPTCHA and interstitial families, and
  catch a mid-crawl bounce back to the login page (the "acted too fast, got logged out"
  case). **The RULE: YIELD, never fight.** Set the bookmarklet fallback, mark the host
  challenged.
- **Fingerprint:** a stealth plugin plus a hardened context (viewport jitter, the
  automation flag undefined, a real accept-language, no touch or mobile emulation).
- **IP reputation (a deliberate FUTURE option, not a default):** a datacenter IP is
  challenged on sight by many web application firewalls regardless of behavior. The real
  fix is routing the migration browser context through a residential proxy. If proxy
  plumbing already exists elsewhere in the stack, wiring it is small. The decision was:
  do NOT wire it by default; turn it on IF the bot-block alerts show a vendor we care
  about is blocked at the IP layer. It costs per gigabyte, so it is an on-demand
  improvement.
- **The bot-block alert (the improvement loop):** whenever a sign-in is blocked by bot
  protection (a CAPTCHA, a firewall interstitial, a mid-crawl bounce to login), fire an
  INFO alert, silently deduped, that auto-escalates after about 10 occurrences. Its
  metadata carries the vendor, the challenge kind, the is-capability-gap marker and build
  instructions. A block is never silent: it is a ranked "make this vendor's recipe
  better" backlog signal, and a vendor that blocks often escalates to a real alert. This
  is how the headless layer GROWS.
- **Honesty:** no behavior layer beats a determined firewall every time from a datacenter
  IP. The GOAL: never be the one to look robotic through speed or rhythm (fully ours,
  fully fixable); pass common checks; when a hard wall still wins, yield to the
  bookmarklet so the migration never dead-ends; and ALERT so we learn which vendors need
  a proxy or a better recipe.

---

## 7. After the pull: hand ALL entities to the importer

On success, turn the crawl's entities into a FULL queue of pre-parsed streams, ordered by
foreign-key dependency, stash them ALL at once, and hand off to the importer, which walks
the customer through EVERY entity (auto-match, review, import, rollback each) under the
user's permissions, exactly like a manual multi-file import.

**Do NOT build a one-at-a-time in-chat queue.** The confirm handoff closes the chat and
navigates away, so a per-entity queue only ever imported the first entity. Stash-all is
the fix.

---

## 8. Provisioning and adding a vendor

- The internal-service secret must be set on BOTH services, in every environment. It is a
  human step, like any secret; name it in the example env file with an empty value.
- The browser service must install its browser at build time.
- **A new vendor is:** a headless recipe in the worker (login selectors plus crawl,
  live-verified) + one delegate-recipe line in the main server's registry + an entry in
  the vendor-paths tool.
- For hard sites, consider the residential proxy before expecting a datacenter login to
  succeed.

---

## 9. Landmines

- **Credentials anywhere but the in-memory session**: the chat, the transcript, the model
  context, a DB column, a log line.
- **Logging cookie VALUES** instead of names.
- **The browser on the money-critical server.**
- **An off-site navigation allowed during the crawl phase.** Freeze the allowlist at
  login.
- **Sending cell values in the page snapshot.** Headers and structure only.
- **Executing the model's plan without re-validating it** (same-site, GET only, caps).
- **Letting the model drive keystrokes**, or a recipe that uses a bulk fill or an instant
  click.
- **Waiting and retrying into a challenge** instead of refusing and falling back.
- **Trying to solve a CAPTCHA.**
- **A silent bot block.** It must alert.
- **Marking a recipe verified before a live login and crawl.**
- **Hand-guessing where a vendor's data lives.**
- **A per-entity in-chat queue after the pull.**
- **Turning the planned crawl on in production before one real vendor has passed end to
  end.**
