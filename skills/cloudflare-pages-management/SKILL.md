---
name: cloudflare-pages-management
description: How to manage this account's Cloudflare Pages deployments yourself, via the Cloudflare API, instead of the owner clicking through the dashboard. Read this whenever a hosted frontend is stale/not updating ("the site is still old", "my change didn't go live", "learn.bookingpro.ai / booking / chat / portal is showing the old version"), whenever a Cloudflare deploy is stuck or queued, whenever you need to trigger or watch a Pages deploy, change what triggers a build (build watch paths), change a project's production branch, or audit every project's config. It explains the credentials (in .env.local; if absent, ASK the user for a scoped token), the `scripts/cf-pages.mjs` CLI, the failure modes we have actually hit (jammed build queue at queued:idle, empty watch paths rebuilding on every commit, wrong production branch silently freezing a customer surface), and the exact per-project deploy topology. Use when the user mentions Cloudflare, Cloudflare Pages, a deploy not landing, a stuck/queued build, "redeploy the site", build watch paths, production branch, or "why is the live site old".
---

# Cloudflare Pages Management

The public frontends (main app, guest booking portal, customer portal, chat widget, learn/help center, and the internal suites) are hosted on **Cloudflare Pages**. Each is a separate Pages project that auto-deploys when its production branch is pushed on GitHub. This skill is how YOU manage those deployments directly through the Cloudflare API, so the owner never has to do it by hand in the dashboard.

> **The owner's intent (2026-09-04):** "I shouldn't have to do Cloudflare manually. Just give you the API key, and if you don't have it, ask." That is the whole point of this skill. Do the Cloudflare work yourself.

---

## Credentials

The CLI and every API call read three values from **`c:\dev\booking_pro_saas\.env.local`** (gitignored, never committed):

```
CLOUDFLARE_API_TOKEN=<scoped token: Account -> Cloudflare Pages -> Edit>
CLOUDFLARE_ACCOUNT_ID=<the account id>
CLOUDFLARE_PAGES_PROJECT=booking-pro-learn-portal   # optional default project
```

- **If the token is present in `.env.local`, just use it.** Do not ask again.
- **If it is missing or a call returns an auth error, ASK the user for it in chat.** Tell them exactly what to create: Cloudflare dashboard -> My Profile -> API Tokens -> Create Token -> Custom token, permission **Account -> Cloudflare Pages -> Edit**, scoped to the account, and to paste it into `.env.local` (not into chat). Wait for them to confirm it's saved, then proceed.
- **Never print the token, never commit it, never put it in a URL/log.** The CLI reads it from disk and sends it only as an `Authorization: Bearer` header to `api.cloudflare.com`.

The token is a real secret. It is fine to keep it in `.env.local` for reuse (the owner wants that). It is not fine to echo it, paste it into a doc, or hand it to any host other than the Cloudflare API.

---

## The CLI: `scripts/cf-pages.mjs`

One Node script wraps every routine action. Run it from the repo root (never `cd`). It reads credentials from `.env.local` automatically.

```bash
node scripts/cf-pages.mjs projects
    # List every Pages project on the account: name, production branch, root dir,
    # and build watch-path filter. Flags any project with NO path filter (which
    # rebuilds on EVERY commit to the repo, the misconfig that floods the queue).

node scripts/cf-pages.mjs project <name>
    # Full config for one project + the live (canonical) deployment's commit.

node scripts/cf-pages.mjs deployments <name> [--limit N]
    # Recent deployments: time, env, branch, commit, stage:status, skipped flag.

node scripts/cf-pages.mjs stuck <name>
    # Deployments currently at queued:idle and NOT skipped (the jam signature).

node scripts/cf-pages.mjs cancel-stuck <name> [--yes]
    # Cancel every queued:idle non-skipped deployment (clears a jammed queue).

node scripts/cf-pages.mjs deploy <name> [--branch <b>]
    # Trigger a deploy (default branch = the project's production branch) and
    # WATCH it to deploy:success. This BYPASSES a jammed auto-queue and is the
    # reliable "push it live now" action.

node scripts/cf-pages.mjs set-watch <name> --include "learn-portal/*" [--exclude "..."]
    # Set build watch paths (source.config.path_includes/excludes) so the project
    # only builds when those paths change.

node scripts/cf-pages.mjs set-branch <name> --branch <b> [--yes]
    # Change the production branch. CONSEQUENTIAL on a live surface; confirm intent
    # (see "Production branch" below) before doing this.
```

There is also **`scripts/cf-deploy-learn.mjs`** (a thin shortcut: `node scripts/cf-deploy-learn.mjs` = deploy + watch the learn-portal). `cf-pages.mjs deploy booking-pro-learn-portal` does the same thing.

Under the hood these hit `https://api.cloudflare.com/client/v4/accounts/<acct>/pages/projects/...`. If you need something the CLI doesn't cover, call that API directly with the same token, but prefer extending the CLI over one-off curl so the next agent benefits.

---

## The deploy topology (verified 2026-09-04)

`main` is NOT "the one production branch." THREE Pages sites deploy from `main`, the rest from `dev`. Know which before you touch anything.

| Pages project | Domain | Prod branch | Repo folder |
|---|---|---|---|
| `booking-pro-saas-main` | app.bookingpro.ai | **main** | `src/` (root) |
| `booking-portal` | booking / appointments.bookingpro.ai | **main** | `booking-portal/` |
| `booking-pro-saas-chat` | chat.bookingpro.ai | **main** | `chat-widget-portal/` |
| `booking-pro-saas-dev-v3` | dev.bookingpro.ai | dev | `src/` (root, staging) |
| `booking-pro-customer-portal` | portal.bookingpro.ai | dev | `customer-portal/` |
| `booking-pro-learn-portal` | learn.bookingpro.ai | dev | `learn-portal/` |
| `booking-pro-superadmin` | superadmin.bookingpro.ai | dev | `superadmin-portal/` |
| `booking-pro-support-suite` | support.bookingpro.ai | dev | `support-suite/` |
| `booking-pro-sales-suite` | sales.bookingpro.ai | dev | `sales-suite/` |
| `bookingpro-affiliates` | affiliates.bookingpro.ai | dev | `affiliate-portal/` |

**Why booking-portal and chat-widget are on `main`, not `dev`:** they are LIVE customer surfaces (the public guest booking page and the embeddable chat widget). `dev` is a working/test branch and is frequently not customer-ready, so shipping them from `dev` would push half-tested code to real customers. They deploy from `main` deliberately, as a release. The only time they deploy from `dev` is a one-off: needing to test a change on the real hosted domain because it can't be reproduced on localhost, done knowingly. **Do NOT "correct" these to `dev`.** (This contradicts older wording that lumped them into "dev deploys everything else"; the CLAUDE.md and PROJECT_SCOPE.md deployment sections were fixed to match reality on 2026-09-04. Trust the live Cloudflare config, verify with `cf-pages.mjs project <name>`.)

**Ignore the stale leftover projects** still attached to the repo: `old-booking-pro-saas-dev-v2` (branch `Uri--sku`, deploys disabled), `booking-pro-saas-dev` (empty shell), `booking-pro-saas-old` / `booking-pro-saas-dev-old` (old `getconversationalai` GitHub org, dead since Jan). They do not serve the live domains. Do not deploy them, and do not delete a Pages project without the owner's explicit per-project approval (deletion is irreversible).

---

## The failure modes we have actually hit

### 1. The build queue jams: deployments stuck at `queued:idle`

**Symptom:** the live site is stale, the source is correct on the right branch, and redeploying from the dashboard "does nothing." The live JS bundle hash never changes.

**Diagnosis:** `node scripts/cf-pages.mjs deployments <name>` shows recent production deployments sitting at `queued:idle` (created but never picked up by the build runner), while the canonical/live deployment is days old. Cloudflare Pages shares ONE build-concurrency slot across the account; a flood of builds (see failure mode 2) backs the queue up and it stops draining.

**Fix:**
1. `node scripts/cf-pages.mjs cancel-stuck <name>` to clear the jammed queue.
2. `node scripts/cf-pages.mjs deploy <name>` to trigger a fresh build. A manually-triggered deploy gets a slot immediately and bypasses the stuck auto-queue (builds run in ~25s when they actually run).
3. Verify live (see "Always verify" below).

If auto-dispatch stays broken after clearing the backlog (real pushes still never build), that is Cloudflare's build infrastructure and needs a **Cloudflare support ticket**: "Pages deployments on account <id>, project <name>, stick at queued/idle and are never dispatched to the build runner; no build is running to hold the slot; manual API-triggered deploys succeed in ~25s but auto-queued ones from GitHub pushes never start." The manual `deploy` command is the reliable interim workaround either way.

### 2. Empty build watch paths: rebuilds on EVERY commit (this is what floods the queue)

**Symptom:** every push anywhere in the monorepo triggers a build of a project whose folder didn't change. Dozens of needless builds pile into the shared queue and jam it (failure mode 1).

**Diagnosis:** `cf-pages.mjs projects` flags any project with `includes=[]` or `includes=undefined` as `<<< NO PATH FILTER`.

**Fix:** set watch paths so the project only builds when its own folder (plus any shared packages it imports) changes:
```bash
node scripts/cf-pages.mjs set-watch <name> --include "<folder>/*,packages/ui-shared/*"
```
Watch paths are matched against the REPO ROOT, so the pattern is `learn-portal/*`, not `*` (root_dir is separate). Include every shared package the app imports (`packages/ui-shared/*`, `packages/affiliate-admin-ui/*`) or a change to a shared package won't redeploy the app that uses it. All the real repo projects were given correct filters on 2026-09-04; verify with `cf-pages.mjs project <name>` if unsure.

> **API gotcha:** the path filter lives in `source.config.path_includes` / `path_excludes` (what `set-watch` writes), NOT in `build_config` and NOT in `deployment_configs.*.build_watch_paths`. PATCHing those other locations returns `success: true` but silently drops the value. Always re-read with `cf-pages.mjs project <name>` and confirm `path_includes` actually persisted; `set-watch` prints a WARNING if it didn't.

### 3. Wrong production branch: a surface silently freezes

**Symptom:** a project never updates from the branch you expect (e.g. the chat widget was stale for 11 days because it was on a branch nothing was landing on for release).

**Diagnosis:** `cf-pages.mjs project <name>` shows the production branch. Compare against the topology table above.

**Fix (CONSEQUENTIAL, confirm first):** changing the production branch changes what ships to a live domain. For a customer surface, get the owner's explicit intent before changing it (do not assume the documented topology is the desired one, the docs were wrong once; the live config or the owner is the authority). Then:
```bash
node scripts/cf-pages.mjs set-branch <name> --branch <b>
```
The command prints the domains and prompts before applying.

---

## Always verify live (do not trust "deploy: success" alone)

A successful build is not proof the content is live. After any deploy, confirm the actual served bundle, via the **chrome-devtools MCP** (governed by the `browser-verification` skill), never curl (SPA 404 trap):

1. Navigate to the affected URL with cache ignored.
2. Confirm the page renders (not the 404/"not found" state), e.g. check the `<h1>` / title.
3. For a content change, fetch the live JS bundle and confirm it contains the new content, and that the bundle hash CHANGED from the stale one:
   ```js
   // in evaluate_script on the live page
   const src = [...document.querySelectorAll('script[src]')].map(s=>s.src).find(s=>s.includes('/assets/index-'));
   const txt = await (await fetch(src)).text();
   return { bundle: src, hasNewThing: txt.includes('<some slug/string only the new build has>') };
   ```
   If the bundle hash is the same as before the deploy, the new build did NOT actually go live (a jammed queue, failure mode 1).

---

## Routine playbook: "make the live site show my change"

1. **Push the change to the project's production branch first.** Cloudflare clones from GitHub; it does not use your local working tree. Confirm the commit is on the right branch at `origin` (`git log --all --oneline -- <folder>`).
2. **Trigger + watch the deploy:** `node scripts/cf-pages.mjs deploy <name>` (or `cf-deploy-learn.mjs` for learn-portal).
3. **Verify live** via chrome-devtools MCP as above.
4. If it was stale because of a jam, also run `cancel-stuck` and consider whether watch paths (failure mode 2) need fixing so it doesn't recur.

## Gotchas

- Run scripts from the repo root, never `cd` into a subdir (breaks project hooks; CLAUDE.md hard rule).
- The account `pages/projects` LIST endpoint caps `per_page` at 10; a larger value returns an empty list. The CLI paginates correctly, raw curl should use `per_page=10&page=N`.
- `cancel` on an already-skipped deployment returns `success: true` but the row stays (it was never going to run); that's fine. `cancel-stuck` only targets non-skipped `queued:idle` rows.
- Cloudflare Pages, Cloudflare Workers, and DNS are different products. This skill is Pages only. If the task is Workers or DNS, the same token may not have scope; ask for the right one.
- Deleting a Pages project is irreversible and needs explicit owner approval per project. Default to leaving stale projects alone.
