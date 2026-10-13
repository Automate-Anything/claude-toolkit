---
name: nextjs-supabase-performance
description: How to make a Next.js App Router app (server components and server actions) over Supabase with row-level security feel instant. This is the server-rendered case, NOT a client SPA, so the rules differ from a Vite plus React Query app. Read it BEFORE writing or changing any page or route, any server-side data function, any layout or auth guard, any loading or Suspense boundary, any Supabase query or RPC used by a server component, and whenever navigation feels slow, a click "does nothing" for a second, a page takes seconds, or you are about to measure performance on the dev server. It encodes what actually fixed a production app: dedupe the per-request auth tax with React cache(), give every route area an instant-paint loading file, keep authed routes dynamic, prefetch primary navigation, stream slow sections, parallelize independent server work, aggregate in SQL instead of fetching thousands of rows into Node, index the exact keyset ORDER BY, and PROVE the fix changed speed without changing the answer or the security boundary. Use when the owner says slow navigation, "should be instant", freezes on click, server components, server actions, loading.tsx, Suspense, prefetch, streaming, force-dynamic, prerender error, or "why is this page slow" in a Next.js app.
---

# Next.js App Router + Supabase performance

> ## Adapt before use
> This describes how a server-rendered Next.js + Supabase app SHOULD be wired, taken from a
> production app where it was measured. The function, file and route names below are EXAMPLES of
> the shape (`getCurrentUser`, `requireUser`, an `(app)` route group, a `TableSkeleton`). Grep
> the repo before citing any of them. Once the repo has its own guard, skeletons and proof
> scripts, update this file with the real names and the real commands.

> **Scope split.**
> - `query-efficiency` owns the query rules: never query in a loop, filter and LIMIT before the
>   expensive work, hoist RLS helper calls, index traps, typeahead. They are referenced here, not
>   repeated.
> - `page-performance` owns client-component rendering: refs versus state, memoization, scroll
>   handlers, optimistic updates.
> - `latency-and-efficiency` owns how to measure and whether to optimize at all.
> - **This skill** owns what is specific to server components and server actions.

## Know your architecture before you optimize

In an App Router app, a page is an `async` server component that runs auth plus database queries
*on the server* before the HTML streams to the browser. There is no client-side query cache
mediating navigation. That means a slow page is almost always one of:

1. **Per-request server tax** (auth resolved several times, work repeated on every navigation),
2. **No instant paint** (the click freezes on the old page until the server finishes),
3. **A slow query** (N+1, fetch-everything-then-reduce, per-row RLS, a missing index).

Diagnose *which* before touching anything. The three parts below map to those three causes, in
the order they usually dominate.

---

## RULE 0: the only reason to optimize, and the only way to know it worked

Optimize only what a human can PERCEIVE (roughly 400ms and up, or seconds) **or** what MULTIPLIES
(per row, per request, N+1: a small cost times thousands). A 30ms query behind a debounce is
done; leave it.

**MEASURE, do not guess**, and separate the two clocks that mislead everyone:

- **The dev server compiles each route on first hit.** The first visit to a page can take seconds
  *purely* to compile. That cost is **gone in production**. NEVER measure performance on the dev
  server's first hit and conclude the app is slow.
- **Measure a production build, but do NOT casually spin up servers.** Several agents each
  starting a dev or production server on one machine corrupt each other's build output directory
  and crash the page mid-request. This has caused real outages. So:
  - **Never touch the shared dev server.** It is the owner's and other agents rely on it.
  - If you genuinely need a production build to measure, **ask the owner first**, build it into
    an ISOLATED output directory, run it on a throwaway port, and **kill it the moment you are
    done**. One measurement, then tear it down. (Shape: a separate dist directory for the build
    and the start command, and a port the dev server is not using.)
  - Better, prefer measurements that need no extra server: SQL `EXPLAIN ANALYZE`, before/after
    proof scripts, and reading the build output. None of those open a port.
- **Prove the answer did not change.** A performance change that alters results is a bug. For any
  database change, capture a before and an after and diff them programmatically. "It looks right"
  is not proof.

Real numbers for calibration, from the app this came from: deduping the per-navigation auth tax
took page work from **2 to 4 redundant auth round-trips down to one**; adding a loading boundary
took click-to-first-paint from a multi-second freeze to **about 2ms**; warm navigation settled at
**about 30ms**; a dashboard rollup replaced a **20,000-row fetch with nested children, reduced in
Node**, with a single SQL aggregation returning one row.

---

# PART 1: THE PER-REQUEST SERVER TAX (hits EVERY page)

Anything the app does on *every* navigation is multiplied by every click. Fix these first; they
dwarf any single page's query.

## 1.1 Resolve the current user ONCE per request (React `cache`)

The layout guards the route (a "require user" check), then the page guards again (a "require
role" or "require permission" check), and data functions sometimes resolve the user too. Each
call does a network auth lookup **plus** a profile query. Unwrapped, that is the same auth work
**2 to 4 times per navigation** before any page data loads.

**The fix:** wrap the "get current user" function in **React `cache()`**, so it runs at most once
per server request no matter how many callers ask.

```ts
import { cache } from "react";
export const getCurrentUser = cache(async function getCurrentUser() { /* auth + profile */ });
```

**Consequences you must respect:**
- In any server-side data function that needs the caller, **reuse the cached function**. Never
  add a fresh auth lookup plus profile read of your own.
- `cache()` is per-request and server-only. Do not rely on it across requests.

## 1.2 Keep authed routes dynamic

Every authed page reads per-user cookies and returns policy-scoped data. It is **never** static.
Declare the authed layout dynamic (`export const dynamic = "force-dynamic"` on the layout of the
authed route group) and keep it. Without it, Next can mis-detect a page as prerenderable,
especially one that only reaches the session through the `cache()`-wrapped guard or through a
server action, and then **crash the build** trying to render it statically ("Error occurred
prerendering page ...").

## 1.3 Do not repeat work the guard already did

The guard already fetched the profile (role, team, ids). Do not re-query the profile table for
the same facts in a data function or a dashboard. Pass the user down or call the cached guard.

---

# PART 2: MAKE THE CLICK FEEL INSTANT (streaming + prefetch)

In server-component routing, a click **blocks on the server render** unless you give Next a
boundary to show immediately. The user experiences that block as "I pressed the button and
nothing happened for two seconds."

## 2.1 Every route area needs a loading file (this is the big UX win)

A `loading.tsx` is shown **instantly** in the page slot the moment a link is clicked, while the
destination server component fetches. The persistent shell (sidebar, top bar) stays put; only the
content area swaps to a skeleton, then to real data. This is what turns a frozen click into a
response in about 2ms.

- Put one shared loading file at the root of the authed area (header, toolbar and a table
  skeleton is a good generic shape) so every page is covered. Add a **more specific** one in a
  route folder only when that page's shape differs enough that the generic skeleton reads wrong.
- Prefer a skeleton that *matches the real layout* over a spinner. Reuse the app's existing
  skeleton components, so they match the real grid rhythm and honor reduced motion.
- The loading file is also the **prerequisite for prefetch** on dynamic routes: Next only
  prefetches a dynamic route up to its nearest loading boundary.

Note the difference from the client-SPA advice in `page-performance` ("prefer stale data over
skeletons"). In a server-rendered navigation there is no stale client cache to show, so the
instant skeleton IS the best available first paint.

## 2.2 Prefetch the likely-next routes

Keep `prefetch` on primary navigation links so the destination is warmed on hover or when it
enters the viewport. Do not prefetch everything indiscriminately: prefetch the nav, not every row
action.

## 2.3 Stream heavy sections instead of blocking the whole page

If one slow query holds up an otherwise-fast page, wrap that section in `<Suspense>` with a
fallback so the rest of the page paints immediately and the slow part streams in.

## 2.4 Parallelize independent server work

A page that awaits query A, then B, then C is a serial waterfall. The page cannot paint until all
three finish in sequence. If they are independent, run them together:

```ts
const [page, fieldDefs, assignees] = await Promise.all([
  listRecords(params), getCustomFieldDefs(), getTeamMembers(),
]);
```

Only keep awaits serial when a later one genuinely needs an earlier one's result. Note that
`Promise.all` over a per-id query does NOT fix an N+1: it just runs the N queries concurrently.
Batch them into one (see `query-efficiency` Rule 2).

## 2.5 Client components: the high-frequency rules still apply

For `"use client"` components (grids, drag, scroll, zoom, anything gesture-driven) the rules in
`page-performance` apply unchanged. The two that bite most in a server-rendered app:

- A typeahead's input must be **local state** and must never route a keystroke through the URL.
  A router push per character re-renders the server page per character. Debounce the *fetch*
  (about 250ms), require at least 2 characters, cap rows (about 20).
- Values that change more than about 5 times a second belong in a ref with direct DOM writes,
  never in state.

---

# PART 3: MAKE THE QUERY FAST (what is specific here)

This is where the real *production* latency of a page lives once Parts 1 and 2 are done. The
general rules are in `query-efficiency`. What follows is what a server-rendered Supabase app adds.

## 3.1 Aggregate in SQL; do NOT fetch the table into Node and reduce there

If a page needs *counts or rollups*, compute them in the database and return a handful of rows,
not thousands of rows plus nested children to fold up in JavaScript.

> The worst offender in the source app was a helper that fetched up to **20,000 records with
> every child row** on three dashboards, just to count by status and by eligibility. It was
> replaced by one SQL function returning three small count maps in one row. It was proven
> byte-identical to the old JavaScript reduction across every role before shipping.

When you write such a function:
- Make it run with the CALLER's rights (`SECURITY INVOKER`, the default) if it must stay scoped
  to the caller by the row policies. Only use the elevated (definer) form when you deliberately
  do the auth check once at the top and then run unfiltered, and then follow every lockdown rule
  in `security-rls-permissions`.
- Reuse the app's **canonical derivations** instead of reinventing them. If a ranking or a status
  rollup already lives in the list query, the dashboard function copies that exact expression so
  the two cannot diverge.
- Return database enum values and map them to UI enums in ONE place in app code, so the mapping
  stays single-sourced.

## 3.2 A measured deferral is a valid outcome: do not rewrite a security boundary for an imperceptible cost

A row policy that calls a helper with a ROW column cannot be hoisted; it is genuinely per-row.
Keep the cheap, hoistable role checks *in front* of it so they short-circuit most rows.

The source app measured exactly this and deliberately did NOT fix it:

> A per-row visibility helper on a scoped user's list scan cost about 0.8ms per row (about 37ms
> for 46 rows; an admin short-circuited at 0.4ms through the hoisted role check). That is **not
> user-perceptible** and only becomes so at around 10,000 rows. But it DOES multiply, so it is a
> real future cost. The only effective fix changes the policy mechanism to
> "id IN (a set-returning function of my visible ids)", which alters the **security boundary on
> sensitive data**. A subtle bug there is a cross-user data leak, not just a slow page. The risk
> was not worth paying down an imperceptible cost.

What made that a decision and not a shrug:
- **The number was written down**, with the row count it was measured at.
- **A trigger to revisit was written down:** when that list query measures over 400ms warm in
  production, or the database's statement stats show it among the top total-time queries.
- **The fix was sketched in advance**, including the requirement to prove visibility
  byte-identical before shipping.

Do the same whenever you defer: number, trigger, sketch.

## 3.3 Slow query? Suspect the policy before the query

Compare the same query as a normal authenticated user and as the privileged role. A big gap means
the policy, not the SQL, is the cost. (Mechanics in `query-efficiency` Rule 4.)

## 3.4 Index the EXACT keyset ORDER BY (verify, do not assume)

If lists are keyset-paginated (`order by <col> desc, id desc`), each needs a **composite** index
on the *same* columns in the *same* directions, or the page scans and sorts the whole table on
every load. When you add a new list, match its index to its real ORDER BY, and confirm with
`EXPLAIN`. On tiny seed data the planner may still choose a sequential scan, and that is correct:
these indexes are for production scale. Other index traps are in `query-efficiency` Rule 5.

## 3.5 Fetch only what you render

Name the columns, cap the rows (a picker needs about 20, not 1,000), and do not pull heavy blobs
(notes, addresses, tags) into a list that shows a name and a phone. Selecting every column is
acceptable for ONE row on a detail page. Do not copy that shape into a list.

---

## HOW TO MEASURE

**Real navigation:** on a production build, time from a link click to content commit in the
browser (see `browser-verification`). Warm revisits are the steady-state number. A first visit to
a dynamic page pays the server query once; that is Part 3.

**`EXPLAIN` as the real caller, with policies on.** Impersonate a real user inside a transaction
so the policies actually run. Measuring as the privileged role hides the exact cost you are
hunting:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<a real user uuid>","role":"authenticated"}', true);
explain (analyze, buffers, costs off) select ...;
rollback;
```

Read `loops=` (a node that ran per row when it should run once) and `Buffers` (pages touched to
return a few rows means work thrown away) first.

**Prove a database change did not change the answer.** Two proof shapes worth building once per
repo and reusing:

- **A visibility snapshot.** A script that captures, per role, the exact set of visible row ids
  across the sensitive tables. Run it before and after a policy change, diff the two files, and
  require "IDENTICAL".
- **An aggregation diff.** For a new rollup function, compute the old way and the new way per
  role and diff the tallies order-insensitively before wiring it in.

Keep whatever policy regression test the repo has green.

---

## THE CHECKLIST (before calling any performance work done)

**Per-request (Part 1)**
- [ ] No new auth lookup plus profile read; the cached "current user" function is reused?
- [ ] Authed routes still covered by the dynamic declaration; the production build passes?

**Feel (Part 2)**
- [ ] The route paints instantly on click (covered by a loading file)?
- [ ] Primary navigation prefetched; a genuinely slow section wrapped in `<Suspense>`?
- [ ] Independent server fetches in one `Promise.all`, not a serial waterfall?
- [ ] Client hot path: refs (not state) above about 5 updates a second; memoized props and
      callbacks; no state updates inside scroll handlers; typeahead input on local state?

**Query (Part 3)**
- [ ] No query in a loop; batched into one query or one RPC?
- [ ] Counts computed in SQL, not by fetching many rows into Node?
- [ ] Cost does not stay flat as the LIMIT changes (LIMIT applied early)?
- [ ] Policy helper calls hoisted; row-column helpers behind cheap checks?
- [ ] A matching composite index for the exact keyset ORDER BY, verified with `EXPLAIN`?
- [ ] Named columns, capped rows, no heavy blobs in lists?

**Proof (Rule 0)**
- [ ] Measured WARM on a production build, not the dev server's first hit, without disturbing
      the shared dev server?
- [ ] For database changes: visibility and tallies proven identical before versus after?
- [ ] The gain is something a user can actually perceive (400ms and up, or multiplied)?
- [ ] For anything deferred: the number, the trigger to revisit, and the sketch are written down?

---

## Related

- `query-efficiency`, `page-performance`, `latency-and-efficiency`: the other three performance
  skills.
- `security-rls-permissions`: never trade security for speed.
- `browser-verification`: how to drive the real browser.
- `error-alert-system`: any new catch or exception path must still report.
- `build-with-the-user-in-mind`: do not trade correctness or the user's job for speed.
