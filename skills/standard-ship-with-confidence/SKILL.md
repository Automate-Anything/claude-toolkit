---
name: standard-ship-with-confidence
description: "Standard 39 of the engineering standards library: the evidence standard behind the word \"done\". Covers the done definition and what is forbidden in anything claimed as done (TODOs, mocks, placeholders, silent no-ops), the browser test rule, the end-to-end trace rule, expand-contract for schema renames and drops, the cross-origin checklist (CORS, credentials, cookies, CORP), safe deploy ordering, git as the single source of truth, the \"I don't know\" rule, the post-deploy smoke test, checking logs first on a bug report, and the one-line cause in a fix. It complements `review-build`, the audit gate run at the end of a build. Read it BEFORE claiming anything is done, shipped, deployed or working, before any deploy, before renaming or dropping a column, before touching a frontend to API cross-origin seam, when debugging a reported bug, and when the user says \"is it done\", \"ship it\", \"deploy\", \"it does not work\", \"CORS error\", \"rename this column\", \"smoke test\", or \"you said it was done\"."
---

# Ship With Confidence: the anti-bug protocol

**Scope and what lives elsewhere.** In the source library this standard was always-active. It
sets the evidence bar for the word "done" and the mechanics of a safe deploy. It does not repeat:

- `review-build`: the post-build review gate (the no-gaps audit of everything the change touches,
  attacking security changes, mobile optimization, error alert wiring, docs and changelog upkeep,
  the resilience-first handling of failures). Run it at the end of every build. This skill is the
  rule that the result must then be verified in the real user path.
- `browser-verification`: how to actually drive a browser to perform the check in section 1.
- `build-with-the-user-in-mind`: judging the work from the user's seat.
- `error-alert-system`: empty catch blocks and swallowed errors, in depth.

> **Agent rule (overrides anything below that implies otherwise).** This standard describes how the
> project and its pipeline should be set up. An agent never commits, pushes, merges, runs
> history-changing git, triggers a deploy, or publishes a release on its own initiative. It does
> those only when the owner explicitly asks in the current conversation. Otherwise: make the change,
> say exactly what is ready, and offer the next step.

Sections 5, 8 and 10 describe how a deploy and a fix commit should be done WHEN the owner asks for
one. They are not permission to deploy or commit. If the work is ready but not deployed, say so:
"the change is made and verified locally, it is not committed or deployed".

## WHY THIS EXISTS

Production projects routinely ship with clusters of bugs that all share the same root cause: **the code compiled and the tests passed, but nobody actually exercised the user-facing path before declaring "done."** The bugs are different technical classes (CSS scope, React hydration, CORS/CORP, schema/code drift, untracked migrations), but they share one parent: **shipping on assumption instead of evidence.**

This file codifies the standards that prevent that. Every rule here is always-active for every session. Violating them is a defect by definition.

---

## 0. THE DONE DEFINITION (READ FIRST - MOST IMPORTANT)

**"Done" means the user can open the app, click through the feature end to end with real data, and it works.** Nothing less counts as done.

The word "done" is never used for:

| Looks done | Actually not done |
|---|---|
| UI page renders | UI page renders but buttons do nothing |
| API route registered | API route returns 200 but writes nothing |
| Happy path works | Happy path works, errors crash |
| Build passes | Build passes, feature untested in a browser |
| Code looks right | Code looks right, data never flows through it |
| Seeded test data shows | Real user flow produces no data |
| Placeholder "coming soon" | Shipped as a real feature |

**Forbidden in anything claimed as done:**
- `TODO`, `TBD`, `FIXME`, `XXX`, `PLACEHOLDER`, `COMING SOON` in production code paths (other than in deferred-work comments that are explicitly flagged to the user)
- Mocked responses pretending to be real (`return { success: true }` with no side effect)
- Hardcoded demo values where real data should flow
- Empty catch blocks or `catch (e) { /* TODO */ }`
- Commented-out code with "will implement later"
- `.env` values set to "CHANGEME" or left blank in production
- API routes that silently no-op and return 200
- UI components rendering a ghost state forever because the wire-up was skipped
- A feature that "works" only if you reload, only if you clear cache, only in incognito, only with certain data

**If only part of a feature is ready**, ship only that part and say so explicitly:
> "Phase 1a is live: invites work end to end, password setup works end to end. Phase 1b (resend-invite, deactivate) is **not** built yet - the buttons are hidden in the UI. I'll do 1b in the next pass."

That's honest. Saying "agent management is done" when only create works is dishonest and hurts the project.

**When I say "done" or "shipped" or "working," I am making a claim.** That claim must be backed by a specific verification the user can reproduce. If the claim is wrong, the bug is on me, not on "edge cases" or "something we didn't think of" - it's on me for using the word without evidence.

---

## 1. THE BROWSER TEST RULE (NON-NEGOTIABLE)

Before claiming any user-facing change is "done":

1. State the **exact user action** that would prove it works. Examples:
   - "Log in, open the sidebar, collapse it, reload the page. The icons should stay in place with no flash."
   - "Upload a profile picture, go to the agents table, your avatar should display in the row at 28x28."
2. Either **perform that action** (curl, scripted check) or **ask the user to perform it** and wait for confirmation.
3. "Type-check passed" and "build succeeded" are **not** proof of working. They prove the code compiles. Nothing more.

If I cannot perform a UI test and the user isn't available, I must say so explicitly: "I shipped the code, but I can't verify the UI. Please test by doing X."

## 2. THE END-TO-END TRACE RULE

When changing anything that crosses layers (DB -> API -> shared types -> frontend -> browser cache), trace the data through **every hop** before deploying. For a profile picture upload, that's:

```
<input file> -> FormData -> fetch("/profile/me/picture", credentials)
    -> CORS preflight -> session middleware -> multer/multipart
    -> object storage PutObject -> DB update -> response body
    -> React setState -> mediaUrl(key) builder -> <img src>
    -> CORS preflight for GET -> session middleware -> object storage GetObject
    -> streamed response -> browser render
    -> Cross-Origin-Resource-Policy check -> pixel on screen
```

If any hop isn't verified, the feature isn't done. Most bugs live at the seams between hops: CORS, SameSite cookies, CORP, encoding, caching, type mismatches.

## 3. SCHEMA CHANGES USE EXPAND-CONTRACT

**Never rename or drop a column during live traffic** unless the app is explicitly in maintenance mode.

The correct pattern for a rename:

1. **Expand**: Add the new column alongside the old. Backfill it. Code writes BOTH, reads prefer the new.
2. **Ship** that deploy and verify. Old clients still work.
3. **Switch**: Remove the code that references the old column.
4. **Ship** that deploy and verify.
5. **Contract**: Drop the old column in a separate migration.

A column rename done atomically (e.g. `profile_image_url` -> `profile_image_key` in a single migration + deploy) produces a brief window where the new API code queries a column that the database has not yet renamed. That window causes 500 errors and corrupted writes.

If a rename MUST be atomic (small projects, acceptable downtime): stop the API first, migrate, restart. Never migrate while API is serving traffic on the old code path.

## 4. THE CROSS-ORIGIN CHECKLIST

Any change involving a frontend on one origin talking to an API on another origin (e.g. `app.<your-domain>` <-> `api.<your-domain>`) must verify ALL of these in a real browser:

- [ ] `Access-Control-Allow-Origin` present on actual and preflight responses, for the right origin (not `*` with credentials)
- [ ] `Access-Control-Allow-Credentials: true` on both preflight and actual
- [ ] Session cookie is set with `Domain=.<your-domain>` and `SameSite` value that allows the intended request types
- [ ] For **embedded resources** (`<img>`, `<script>`, `<link>`): `Cross-Origin-Resource-Policy` is `same-site` (not `same-origin`)
- [ ] For **fetch / XHR**: CORP doesn't apply; check CORS instead
- [ ] Error responses (4xx, 5xx) also have CORS headers. Otherwise the browser shows a generic network error and the user sees "Could not save" instead of "Email already exists."

## 5. DEPLOY ORDERING IS LOAD-BEARING

The safe order is always:

1. Pull new code to disk (does not affect running API yet)
2. Install dependencies
3. Apply database migrations
4. Build assets (for example the web frontend build)
5. Restart the API (picks up new code)
6. Smoke-test the specific thing that changed
7. Only then, move on

If any step fails, DO NOT proceed. Fix the failure or roll back. Half-deployed state is the most dangerous state.

For migrations that are backwards-incompatible with the currently-running code (rare, but happens for renames/drops), stop the API before running the migration, or use expand-contract (see section 3).

## 6. GIT IS THE SINGLE SOURCE OF TRUTH

**Nothing the server needs may exist only on the server.** If a file is required to run, build, or migrate, it is in git. Untracked server-side state is a time bomb:

- Migration SQL files: in git
- Infrastructure config (reverse proxy config, process manager config): in git
- Env var names (not values): in .env.example, in git
- Seed data for bootstrap: in git

Periodically run `git status` on the server. Any untracked file is either a bug, a leak, or drift - none of those are acceptable.

## 7. THE "I DON'T KNOW" RULE

When uncertain whether something will work, **say so**. Examples:

- "I changed CORP to same-site. I verified the header is sent but I did not verify in a browser that <img> actually renders - please hard-reload and check."
- "The migration applied cleanly, but there's a brief window where new code may run against old schema. Restart immediately after migration."
- "This pattern works in Hono's Node adapter. I did not test it under Bun or edge runtimes."

Confidence is earned through verification. Don't ship on hope.

## 8. POST-DEPLOY SMOKE TEST (MANDATORY)

After every deploy, before closing the task:

1. `curl -s -o /dev/null -w "%{http_code}\n" <frontend-url>/<entry-page>` -> expect 200
2. `curl -s <api-url>/health` -> expect `{"status":"ok",...}`
3. Process manager check (e.g. `pm2 list`, `systemctl status`, `docker ps`) -> all expected processes online, low unstable-restart count
4. **The specific thing that changed** -> hit the exact endpoint, widget, or flow that the change touched. If that requires auth, ask the user to verify.

A process manager showing "online" is necessary but insufficient. The process being alive does not mean the feature works.

## 9. WHEN A BUG IS REPORTED, CHECK LOGS FIRST

If the user reports a failure:

1. **Check the server/runtime error logs first** (e.g. `pm2 logs --err`, `journalctl -u <service>`, `docker logs`, framework error log). Before speculating about causes, before re-reading the code, before touching anything, read the actual error output from the last deploy onward.
2. Cross-reference with the user's timestamp/description.
3. Only then form a hypothesis.

Most "mystery bugs" are documented clearly in the stderr logs. Skipping this step wastes time and makes the wrong fix.

## 10. KEEP A RETRO TAIL

When a bug slips through after type-check and tests pass, the fix commit message must include a one-line cause in the body. (An agent prepares this message and commits only when the owner asks; if no commit is requested, give the same one-line cause in the report to the owner.) Examples:

- "Cause: CSS class was scoped to `.me-row .ava-purple`; used bare `.ava-purple` elsewhere with no style."
- "Cause: stored the S3 API endpoint as a public URL; private buckets require signed access or a dedicated serving layer."
- "Cause: migration + code deploy were atomic; new code queried renamed column before ALTER TABLE ran."

These one-liners build a memory of how things break. Patterns emerge. Future code avoids the same traps.

---

## ENFORCEMENT

Before any "done / shipped / deployed" message to the user, I must privately answer:

1. What is the user action that proves this works?
2. Has that action been performed (by me or the user)?
3. If not, have I explicitly asked the user to perform it?
4. Have I checked the cross-origin checklist if this touches the frontend <-> API seam?
5. Have I checked stderr logs for anything quietly broken?

If I cannot answer "yes" to 1 and (2 or 3), I am not done, regardless of how green the build is.

The bar is not "my code is correct." The bar is "the user's experience is working."

## RELATED SKILLS

- `review-build`: the post-build review gate.
- `browser-verification`: performing the browser test.
- `standard-ci-cd-pipeline`: deployment strategies and rollback.
- `standard-database-design`: migrations.
- `standard-incident-management`: when a deploy causes an outage.
- `report-verification`: the same evidence bar applied to reports and dashboards.
