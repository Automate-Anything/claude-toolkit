---
name: infrastructure-overview-template
description: A fill-in TEMPLATE plus the rules for writing a repo's "infrastructure overview" skill - the single reference that says how the system is wired - runtime layers, every frontend and server and where each deploys, the database, mobile and desktop shells, cron jobs, serverless functions, env vars, where new code belongs, the deploy and branch topology, and how to read production logs. Read it when starting a new project, when a repo has no infrastructure doc or a stale one, when the owner says "document the infrastructure", "write the architecture overview", "how does the system fit together", "where should this code go", "which server", "which branch deploys this", or when an agent keeps asking where things live. Also read it before adding a new server, frontend, cron, edge function or external service, so the overview gets updated in the same change.
---

# Infrastructure overview: template and rules

> ## Adapt before use
> This is a TEMPLATE. It describes how a repo SHOULD document its
> infrastructure, with the structure taken from a production multi-surface SaaS
> (Vite/React frontends on Cloudflare Pages, Node servers on Render, Supabase, a
> Capacitor mobile shell). Copy the template in section 2 into the repo's own
> skill (suggested name: `infrastructure-overview`), fill every bracket from the
> LIVE code and dashboards, and delete the sections that do not apply. Do not
> ship it with brackets left in.

---

## 1. The rules for writing one

1. **Its job is orientation.** An agent reads it to decide where new code
   belongs and how a change deploys, BEFORE touching anything. If it cannot
   answer those two questions in a minute, it failed.
2. **Verify against live code, and date it.** State at the top when it was last
   re-verified. **If it disagrees with the code, the code wins.** Say so in the
   doc.
3. **Name one source of truth per fast-moving fact, and point at it instead of
   copying it.** The cron list, the bundler's chunk list, the per-service deploy
   table: these go stale within weeks. Write "roughly N jobs, registered in
   `<file>`, that file is the truth". A hardcoded list elsewhere WILL be wrong.
4. **If two docs cover deploys, say which wins.** One file is the deploy source
   of truth (service names, URLs, custom domains, branch column, env vars). The
   overview summarizes and defers to it.
5. **Put retired systems first, loudly.** When a runtime layer was retired (an
   automation tool, an old mobile app, a legacy function), old docs and comments
   keep describing it. Open the overview with what is gone, the date, where its
   job moved, the tombstone that catches stragglers (an endpoint returning 410
   Gone), and the single remaining live exception if there is one.
6. **Write down asymmetry.** "dev = staging, main = prod" is rarely true for
   every surface. If branches deploy different subsets, give that its own table.
7. **Keep identifiers out of a portable copy, keep them in the repo's copy.**
   The repo's own overview SHOULD carry service ids and workspace ids (they save
   real time, section 2.4). They are not secrets, but they do not belong in a
   shared toolkit. API keys, tokens and passwords belong in neither: env-var
   NAMES only.
8. **Update it in the same change.** A new route group, cron, function, external
   service, env var, server or frontend means an edit here. Infrastructure
   drifts; a stale overview is worse than none because agents trust it.

---

## 2. The template (copy from here)

```markdown
---
name: infrastructure-overview
description: Reference for how [APP] is wired together - the runtime layers, where each kind of code lives, the servers and frontends, the database, the mobile/desktop apps, the cron jobs, the serverless functions, and the deploy/branch topology. Read it to understand the system before deciding where new code belongs or how a change deploys. Also use when the user mentions architecture, deployment, [HOSTS], where to put code, which server, cron jobs, the deploy branch, env vars, or "how does the system fit together".
---

# Infrastructure Overview

> Deploy source of truth: [FILE + SECTION]. When this skill and that file
> disagree on a deploy detail, that file wins. Re-verified against live code
> [DATE]; if it disagrees with the code, the code wins.

## Retired systems - read this first
- [SYSTEM] was retired on [DATE]. Everything it did ([LIST]) now runs in [WHERE].
- Tombstone: [the endpoint/function that now returns 410 Gone, if any].
- The single remaining live exception: [WHAT still calls the old system, where
  in the code, and what has to happen before it can be removed].
- If a doc or comment routes [X] "through [SYSTEM]", it describes the old world.

## The runtime layers
1. Frontends - [framework] on [host].
2. Backend servers - [runtime/framework] on [host]. [NAME] is the primary one.
3. Database/platform - [Postgres + auth + storage + functions on which vendor].
4. Mobile / desktop - [native shell around the web app, or separate codebases].
5. [GPU / workers / queues, if any].

## Frontends
| Dir | What it is | Deploys to | From branch |
|---|---|---|---|
| [dir] | [role] | [URL prod] + [URL staging] | [branch] |

Main-app facts: [framework + bundler], dev port [N], path alias [..], env file
[NAME], service worker [yes/no and its strategy], manual chunks: see [FILE].

Edge middleware: [preview-host redirects, unknown-host redirects, robots rules
per host, which crawlers are allowed for link previews].

## Backend servers
| Dir | Role | Host service(s) | Branch | Health | Local port | Canonical URL |
|---|---|---|---|---|---|---|
| [dir] | [what it owns] | [prod service] / [staging service] | [..] | [/health] | [N] | [..] |

Note any mismatch between the infra-as-code file and the live dashboard service
names (the config file can declare one name while the live services are others).

## What the primary server handles
- Payments & billing: [..]
- Messaging (SMS / WhatsApp / email): [..]
- Calendar / mail OAuth: [..]
- AI: [..]
- Scheduled work: roughly [N] cron jobs registered in [FILE]. That file is the
  source of truth. Do not copy the list here.
- External services it talks to: [..]
- Standing business rules an agent must not undo: [e.g. "transactional SMS is
  free, only campaigns are billed; do not reintroduce a per-message charge.
  Source: [doc]"].

## Database
| Setting | Value |
|---|---|
| Project | [name; id lives in env as [VAR]] |
| Monetary values | [integers in CENTS - divide by 100 for display] |
| Pull live schema | [command] |
| Generate types | [command] -> [output file] |
| Execute SQL | [command] (ask the owner first) |

Security model: [table grants, then RLS policies; the helper functions; how
data-access permissions and page-access permissions are split]. Authority:
`security-rls-permissions`.

Serverless / edge functions:
| Function | Purpose |
|---|---|
| [name] | [..] |

[New functions are rare; most server work belongs in [PRIMARY SERVER].]

## Mobile / desktop
| Setting | Value |
|---|---|
| Native shell | [dir] |
| Config | [file, app id, web dir] |
| Native bridge | [file; how plugins are reached] |
| Build & sync | [command] |
| Updates | [store only / store for native changes + OTA bundles for JS-only changes] |
| CI | [workflow file] |

[Editing the web app updates the mobile app on the next build + sync, or not.]
[Any retired mobile codebase and the outdated docs that still describe it.]

## Environment variables
- Env file per surface: [NAME]. Inventory: [EXAMPLE FILE].
- The backend URL var the frontend uses: [VAR]. Old names that survive only as
  dead fallbacks, not for new code: [VAR].
- Vars that no longer exist because the flow moved server-side: [..].
- Server secrets never go in any frontend.

## Where new code belongs
| If the work is... | It lives in... |
|---|---|
| UI, pages, components, client-side logic | the relevant frontend |
| Anything needing a server secret | [PRIMARY SERVER] |
| Cron jobs, background processing, usage tracking | [PRIMARY SERVER], registered in [FILE] |
| Webhook receivers | [PRIMARY SERVER] |
| Backend logic for an internal portal | the matching paired server |
| Tables, RLS policies, functions | a database migration |
| A lightweight proxy (exposing one key) | an edge function |

Short version: [one sentence].

## Deploy & branch topology
| Branch | What it deploys |
|---|---|
| [prod branch] | [exactly which surfaces] |
| [staging branch] | [exactly which surfaces, including staging copies] |

| Surface | Where the work lands |
|---|---|
| [main app / primary server] | feature branch -> [staging]; [staging] -> [prod] only on an explicit, owner-authorized release |
| [any other frontend or server] | feature branch -> [staging], and stop there |

Standing rules: [where feature branches are cut from; how to catch a branch up;
fetch immediately before any merge; who may push to prod; whether there is CI
or the hosts simply auto-deploy on push].

## Reading production logs yourself
[Connector/tool, the workspace id, the service id of each service with its URL
and branch, the query recipe, the gotchas. See section 2.4 of the template skill.]

## Keeping this current
When something changes - a new route group or cron, a new function, a new
external service, a deploy or env-var change, a new server or frontend - update
this skill, and update [DEPLOY SOURCE OF TRUTH] for anything deploy-related.
Deeper architecture docs: [path]; note which of them still describe retired
systems.
```

---

## 2.4 What to put in "Reading production logs yourself"

This section pays for itself the first time a production failure happens. If
the host has an MCP connector (Render does), an agent can pull live logs
directly, without a shell on the host and without the owner pasting anything.
**Use it before asking the user for a log.** It is faster and authoritative.

Write down, in the repo's copy:

- **The tools.** They are usually deferred tools: load the schema before the
  first call each session. The workhorse is the log-listing tool; also list
  services, list / get deploys (did it deploy, when), and metrics.
- **The workspace id and each service id, labeled** by URL and branch, with the
  production one called out: "this is the one you want for a real customer's
  issue". Memorize these in the doc so nobody re-lists every time. A full
  service listing for an account with many projects can overflow one tool
  result; if you must re-list, do it in a subagent that returns only this
  project's rows.
- **How to query.** Required: the resource id(s) and the workspace id. Time
  range in RFC3339 for anything older than the default window. Log type:
  `request` (HTTP access logs: method, path, status, client; great for "did the
  browser even hit this route, and what status came back"), `app` (application
  stdout: the actual error bodies), `build` (deploy build logs). Text filters
  are substring or regex and are OR'd. Path, method, status code, host and
  level filter request logs. Paginate with the returned next-start / next-end.
- **A worked recipe: "a customer's charge failed, what really happened?"**
  1. Request log for the call and its HTTP status. A `200` means the SERVER
     succeeded: a failure the user saw is then CLIENT-side (a confirmation or
     3DS step), not the server.
  2. App log for the error body around that timestamp, filtered on the gateway
     tag and the payment reference.
  3. Cross-check the database (the payment-attempt row and its metadata) and
     the processor's own record. **Gateway truth beats our logs beats our
     database** (see `money-truth-doctrine`).

**Gotchas that will bite you:**

- **The default window is only the last hour.** An empty result usually means
  "nothing in the last hour", not "nothing exists". Widen the start time.
- **Success looks like nothing.** A healthy gateway response has an empty error
  field and a success code. A raw response dump with a success result is a
  SUCCESS. Do not read a log line's mere presence as a problem.
- **Production versus staging.** A real customer is on production. Diagnosing on
  the staging service shows you nothing for them.
- **Reading a secret is not the same as needing it.** A host's key-value product
  is its Redis-style store, NOT env vars. And never pull a production env secret
  to your shell to run a local script. Read the logs and the database instead.

---

## 3. Lessons the template encodes (why each section is there)

- **Asymmetric branches cause wrong deploys.** In the source system the
  production branch deployed ONLY the main app and its API server, while the
  staging branch deployed EVERYTHING ELSE (all secondary portals and their
  servers) plus the staging copies of the main app. A change to a secondary
  portal needed no production merge at all; agents who assumed "main = prod for
  everything" either merged needlessly or thought a change was unshipped.
- **A server that absorbed a retired tool's job needs saying.** After an
  automation tool was retired, one server owned messaging, calendar and mail
  OAuth, AI and about a hundred cron jobs. Docs that still said "routed through
  the old tool" sent agents to code that no longer existed.
- **"Where new code belongs" prevents the most common misplacement:** a server
  secret reaching a frontend, or a new serverless function for work that
  belongs in the primary server.
- **The infra-as-code file and the live dashboard can disagree** on service
  names. Record both, and which one is live.
- **Some surfaces exist in the repo but not in the deploy table.** Mark them
  "confirm before assuming a live URL" instead of guessing one.
- **A service that runs TypeScript directly with no compile step only fails its
  deploy on syntax errors,** while sibling apps fail on type errors. Note per
  service what its build actually checks, so a split green/red deploy is not a
  mystery.
- **Money conventions belong in the overview** (integers in cents) because every
  new feature touches them and a wrong guess is a 100x bug.
- **Standing business rules belong next to the code that enforces them.** If
  "this category is free and must never be billed" lives only in someone's
  head, a well-meaning agent will reintroduce the charge.

---

## 4. Fill-in checklist

- [ ] Every bracket replaced from LIVE code or the dashboard, not memory.
- [ ] Verified date at the top; "code wins" stated.
- [ ] Retired systems listed first, with tombstones and the one live exception.
- [ ] Every frontend and server has a host, a branch and a URL (or an explicit
      "not deployed / confirm").
- [ ] Cron list POINTED at its registry file, not copied.
- [ ] Branch topology table shows exactly which surfaces each branch deploys.
- [ ] Log-reading section has the workspace id, labeled service ids, the recipe
      and the gotchas.
- [ ] Env-var NAMES only. No keys, tokens or passwords anywhere.
- [ ] "Keeping this current" names the deploy source of truth.

## Related

- `release-and-deploy-sequence` - uses the branch topology documented here.
- `agent-access-and-toolchains` - how an agent gets to each host and dashboard.
- `gpu-training-and-serving` - the inventory format for GPU pods and endpoints.
- `deploy-freshness` - how each surface listed here picks up a deploy.
- `security-rls-permissions`, `money-truth-doctrine` - authorities this defers to.
