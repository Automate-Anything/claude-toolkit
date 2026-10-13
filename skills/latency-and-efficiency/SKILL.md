---
name: latency-and-efficiency
description: The field guide for making anything fast, cheap and gap-free, in any stack: measure the real thing, fix the actual cause, make the fix impossible to silently break. It carries what query-efficiency (SQL, RLS, indexes) and page-performance (React rendering) do NOT cover: measuring honestly, deciding whether to optimize at all, finding who owns the slow segment, push versus poll and realtime subscriptions, "duplicate" queries that are not duplicates, alerting on persistence instead of blips, caches with staleness bounds, and the local-app cases (per-file work in a loop, a blocked event loop, ffmpeg or other spawned tools, SQLite, big manifests and folder scans). Read it BEFORE optimizing anything, before proposing a performance architecture, before writing a realtime subscription or a polling loop, before "fixing" a duplicate request, before any loop that touches files, a database or a child process, and whenever something feels slow, frozen, or hangs. Use when the owner mentions latency, slow, laggy, frozen, hanging, "takes forever", "should be instant", performance, optimization, caching, polling, realtime, subscriptions, cold start, p95, duplicate queries, or "why is this slow".
---

# The Latency, Efficiency and Correctness Playbook

Distilled from a long performance and reliability push on a multi-tenant SaaS, plus a local
Node + SQLite + ffmpeg tool that processed tens of thousands of files, plus a voice dictation
path with a hard one-second budget. It is **stack-agnostic**: how to think, not a recipe to paste.

> **Read the right skill.**
> - `query-efficiency`: the DATABASE side. N+1, filter before compute, per-row RLS cost, index
>   traps, typeahead, `EXPLAIN`. Its rules are not repeated here.
> - `page-performance`: the REACT side. Re-renders, refs versus state, scroll handlers,
>   skeletons, optimistic updates.
> - `nextjs-supabase-performance`: server components and server actions.
> - **This skill**: everything around those. Whether to optimize, how to measure, who owns the
>   slow part, push versus poll, failure visibility, and non-web workloads.

The through-line:

> **Measure the real thing, fix the actual cause, and make the fix impossible to silently
> break.** Almost every expensive mistake came from skipping one of those three.

---

## Part 0: The optimization bar (read first or the rest is noise)

Before touching anything, answer two questions. If both are NO, **stop and walk away.**

| Question | Threshold |
|---|---|
| **Will a human PERCEIVE this?** | Chase **seconds and half-seconds**. A single operation under about 50ms is DONE. Roughly 400ms and up is where people feel it. |
| **Does it MULTIPLY?** (per file, per row, per poll, per request) | Any per-call cost times thousands of calls. |

- **A single operation under about 50ms is DONE.** Shaving 50ms to 5ms is invisible and wasted.
  It only adds risk and code.
- **The exception is a small cost times a loop or fan-out.** 50ms times 40 while the user waits
  is 2 seconds. But the fix is **stop doing it N times** (batch, cache, push), not make each
  iteration 5ms. One pass building a Map beats 57,000 lookups, even when each lookup is "only
  1ms."
- **The inverse trap is just as real.** Do not add a cache, an index, or a background job to
  something the owner opens once a week and waits 200ms for. That is not a win, it is more
  surface area to break.

If you cannot state, in seconds, what the user will feel differently, you may be optimizing the
wrong thing.

> Real case: a file-listing endpoint took **about 52 seconds**. No single operation was slow. It
> was one filesystem stat plus one database lookup per file, across about 57,000 files. Per call
> it looked fine. That is what multiplication means.

---

## Part 1: Measure before you touch anything

Confident hypotheses about what is slow are wrong often enough that you should not trust yours.
Get a number before and a number after.

```js
// Crude and sufficient. Wrap the suspect operation.
const t = Date.now();
const rows = readManifest();
console.log(`[perf] readManifest ${Date.now() - t}ms, ${rows.length} rows`);
```

For a request, time the whole thing AND the suspicious part inside it. If they are far apart, the
cost is somewhere you have not instrumented yet.

- **1.1 Measure the binding constraint, not the plausible one.** Instrument the timeline (when
  did each phase start and end) and attack the segment that is actually long. The intuitive cause
  is wrong often enough that guessing is negative-value. Real case: a query blamed for slowness
  had not even *started* until 900ms after paint. The bottleneck was the framework not running
  the code yet, not the query.
- **1.2 Averages lie. Look at the distribution.** Distinguish cold versus warm, p50 versus p99. A
  query that is fast 10,000 times and catastrophic 100 times hides behind its average. A bimodal
  shape (many fast, a cluster very slow) means CAPACITY or cold starts, not general slowness.
- **1.3 Verify you measured the CURRENT build.** A cache or service worker can serve the old
  bundle to the exact tab you are testing. A raw HTTP request bypasses that cache and tells you
  "deployed" when the browser is still on the old code. Confirm which build is actually running.
- **1.4 A duplicate count is a HYPOTHESIS.** Two calls to one table are not a duplicate until the
  **full** query matches: every filter, and for an RPC or a POST, the **request body**. Tools
  that group by a truncated prefix collapse unrelated queries into one line. Deliberate
  prefetches and auto-heal retries look like duplicates and are correct. Prove it before "fixing"
  it.
- **1.5 Check whether you even OWN the slow segment.** See the case study in Part 6.
- **1.6 Read the hot path's code before proposing an architecture for it.** A profile tells you
  WHERE the time goes. It does not tell you what is already built.

### Measuring traps that produce wrong answers

| Trap | What happens | Do instead |
|---|---|---|
| **Timing the first call only** | Cold OS file cache, cold plan, cold connection. The first read of a large file can be many times slower than steady state. | Run it 3 or more times. Discard the first. Report the warm number, and say separately what cold costs. |
| **Testing on a small dataset** | The pattern that is fine at 50 files is catastrophic at 57,000. Costs that multiply are invisible at small N. | Test against the real corpus, or the biggest folder or tenant you have. |
| **Comparing counts only** | "Still 25 rows, still works." Ordering and content bugs pass silently. | Compare the actual values and their order, not just the length. |
| **Measuring with a job running** | A concurrent batch job starves disk and CPU; everything looks slow. | Measure on an idle machine, or note what else was running. |
| **Measuring a dev server's first hit** | Many dev servers compile a route on first visit. That cost does not exist in production. | Measure warm, and prefer a production build (see `nextjs-supabase-performance`). |

### The server-wide freeze fingerprint

If **every** page hangs, not just the slow one, and the server process CPU is near zero, the
event loop is blocked, not spinning. It is almost always a synchronous call in a loop: a
synchronous child-process spawn, a synchronous exec, a synchronous read of something huge, or a
tight sweep of synchronous filesystem stats. In a single-threaded server, one of those freezes
every route for every user until it finishes.

---

## Part 2: The efficiency toolkit (priority order: higher means bigger, more durable win)

### 2.1 Push, do not poll

A 2 second poll is about 1,800 requests per hour per client, almost always answering "nothing
changed." A realtime subscription delivers in milliseconds and costs nothing while idle.

- **Keep a slow poll (20 to 30 seconds) as a backstop.** Sockets drop and lose events.
- **Refetch once on every reconnect.** Whatever happened while disconnected was never delivered.
- **Check whether a push channel already exists** before building one.
- The same idea applies to third parties: if a provider can push status events to a webhook
  (event streams, sink webhooks), take that over polling their API on a timer.

### 2.2 Collapse N calls into 1

- **Never do per-item work in a loop.** This is the single most expensive pattern, in all three
  of its disguises:

```js
// WRONG: a database query per file
for (const file of files) {
  const row = db.prepare('SELECT id FROM jobs WHERE file = ?').get(file);
}

// WRONG: a filesystem stat per file
files.map(f => ({ f, size: fs.statSync(path.join(dir, f)).size }));

// WRONG, and this one freezes the ENTIRE server, every route, until it finishes
for (const file of files) {
  const dur = spawnSync(ffprobe, ['-i', file /* ... */]);
}

// RIGHT: hoist the work out of the loop, then map with in-memory lookups
const byFile = new Map(
  db.prepare('SELECT file, MAX(id) AS id FROM jobs GROUP BY file').all()
    .map(r => [r.file, r])
);
const rows = files.map(f => ({ f, job: byFile.get(f) || null }));
```

- **How to spot it in review.** Grep for these shapes:

```
for (... of ...)     with a db call / a stat / a spawn inside
.map(                with a query or a stat inside
.forEach(            with anything touching disk or the database inside
await                inside a loop body
```

- **The fix is always the same shape:** run a few **set-based queries once**, build Maps and
  Sets in memory, then map over the items with pure lookups. One query returning 10,000 rows
  beats 10,000 queries returning one row. (For SQL and Supabase specifics see `query-efficiency`
  Rule 2.)
- **For external tools (ffmpeg, ffprobe, any child process), the fix is different.** Never spawn
  synchronously in a loop. Spawn async with **bounded concurrency** and a **per-call timeout**,
  return a cheap answer immediately, and let the real value fill in the background.
- **One shared cache, not N independent fetches.**
- **The cheapest request is the one you do not make.** Check whether an already-loaded object
  already holds the value.
- **Bulk writes belong in one transaction.** In SQLite, thousands of single inserts outside a
  transaction each pay their own fsync (see `database-write-safety`).

### 2.3 Filter and limit BEFORE the expensive work

If code computes something for every item and then keeps 20, it does about 99% of its work for
nothing.

**The tell:** the operation costs the same whether it returns 20 rows or 2,000. That means the
cost is not per-returned-row, so the limit is being applied last.

Pick the rows first (by filter, by tail, by page), *then* compute the expensive per-row value
only for the survivors. For a large append-only log file, read backwards from the end for the few
rows you will show instead of parsing the whole file and slicing.

**The honest caveat:** if the expensive value IS the sort key, you genuinely have to compute it
for every candidate before you can pick the top N. Even then, restructuring usually still wins,
but measure both shapes instead of assuming.

### 2.4 Start work as early as its inputs allow

If the inputs exist before the consumer mounts, start the request then, in parallel, and hand
over the in-flight promise. When you cannot shrink a segment, **start it earlier** or **overlap
it with something the user is already doing** (see the pre-warm in Part 6). Bound anything cached
this way on a hot or stateful path (see 4.3).

### 2.5 Push per-row work down to where it is cheap

When a query is slow because an authorization check runs **per row**, the fix is not a bigger
index. It is to run the check ONCE. Moving a per-row auth predicate into a single up-front check
took one query **from 4,000ms to 15ms (254x)**. The mechanics (wrap helper calls in a scalar
subquery, or one checked function) are in `query-efficiency` Rule 4. The lesson generalizes: find
the work that is being repeated per row and hoist it.

### 2.6 Cache on a change key, not on a timer

Any expensive read (a big manifest, a folder scan) should be cached in memory and reused until
the underlying thing actually changes. Key the cache on something that changes when the data
does, for example a file's modified time plus its size. Never key it on a TTL alone, which either
serves stale data or re-reads for no reason.

When a cached value depends on **two** inputs, cache the expensive part by its change key and
recompute the cheap part on each call.

### 2.7 Do not block the page on cosmetic data

If a page renders only after waiting for both a fast source and a slow source, the slow one gates
everything. Render from the fast source first, fetch the extra in the background, patch it in.
This took one page from about 30 seconds to about 0.1 seconds.

Make the background step robust: on failure leave the plain UI (and report the failure, see
`error-alert-system`), and re-query the DOM when the late response resolves, so it cannot clobber
a view the user already rebuilt.

### 2.8 Only THEN reach for indexes

Lower leverage than the moves above, with traps (see 4.5 and `query-efficiency` Rule 5). One
exception worth doing early: an index for an aggregate that runs **on every request**. It is
invisible while the table is small and never shows up in a profile taken today, but it lands
before the data arrives (see Part 6).

---

## Part 3: Make failure impossible to miss

- **3.1 A silent subscription is a silent-failure factory.** A push channel with no failure
  handler stops receiving data forever if the join fails. Nothing throws, nothing logs. Every
  subscription MUST handle its failure status and report it.
- **3.2 But alert on PERSISTENCE, not a single failure.** A dropped socket (laptop sleep, network
  switch, a deploy) fires an error and then reconnects fine. *That is not an incident.* Track
  failures per source, **reset the counter the instant a success arrives**, and alert only after
  N consecutive failures with no recovery. Store the counter at module scope, or a component
  remount resets it. Model the BORING case (a device asleep all day): that is what floods you,
  not the dramatic outage.
- **3.3 Match severity to impact; dedupe server-side.** Degraded (a backstop still covers it)
  and dead (no fallback) are different alerts. Collapse identical errors into one group with a
  count. On the original project this collapsed 17,070 rows into one. **Never put personal data
  in alert metadata**: ids and scope, never the person or the payload.
- **3.4 Beware the filter that eats your own alerts.** A noise filter that dropped anything
  containing "timeout" or "failed to fetch" nearly ate every realtime alert, because the status
  string was `TIMED_OUT`. Opt critical alerts out of generic noise filters explicitly.
- **3.5 A subscription to data the client cannot read is dead on arrival.** Realtime needs both
  the transport enabled for that data AND the subscriber allowed to read it by the access policy.
  Verify both.

The alert model itself (groups, events, alerts, severity) is the `error-alert-system` skill. It
is a pattern to build per repo; do not wire to it before it exists.

---

## Part 4: Correctness traps that pass every gate

- **4.1 Loose typing in data mapping hides real bugs.** A row cast to an untyped value silenced a
  read of a column the query never selected. It rendered blank forever. Type the row properly:
  the type is the check.
- **4.2 Verify the VERB, not the NOUN.** "Does the screen render" is not "can the user do the
  job." Walk the real task end to end on the **busiest, ugliest real record**. Seed data and
  empty states hide every mapping and edge bug. (This is the `build-with-the-user-in-mind`
  standard.)
- **4.3 Anything cached on a money or state path needs a staleness bound.** A head-start cache
  reused minutes later can serve a stale payment status into checkout. Read-only display data
  caches freely. Anything gating a decision cannot.
- **4.4 "It only breaks locally" is a hypothesis, not a finding.** A production build that
  white-screens locally is a real bug until proven otherwise (in one case, a circular import
  created by chunk splitting). "Works on the dev server" does not count: different module
  semantics.
- **4.5 Index and query traps.** A partial index is used only if the planner can prove the
  query's predicate implies the index's. `LIMIT` changes everything, so measure the real query
  with its real `LIMIT` first. A "simpler" declarative rewrite can be slower than a procedural
  function that computes once. Dropping unused indexes can speed up reads and writes both.
- **4.6 When you touch a shared mechanism, do ALL its entry points.** A fix to one of N paths is
  a half fix that ships as a bug. When you paste the same block a third time, extract one helper
  and route everyone through it.

---

## Part 5: Verify the fix, and be willing to revert it

### 5.1 The fix must not change the answer

Performance work that changes results is a bug, not an optimization.

1. **Capture a baseline BEFORE.** The actual output (row ids in order, counts, totals) across the
   meaningful cases: empty, one item, the huge folder, a moved file, a name with non-ASCII
   characters.
2. **Apply the change.**
3. **Diff programmatically.** Never eyeball 30 rows and call it identical.

This is also how you catch bugs that predate your change: an ordering that was never stable, a
filter that silently dropped rows. Counting alone would show "25 = 25" and ship both.

### 5.2 When the rewrite is slower, revert

Not every restructure wins. A change that adds indirection, a cache that never hits, an async
conversion that adds overhead to something already fast: measure it, and if it lost, revert it
and **write down that it lost** so nobody tries the same thing in three months. A disproved
optimization is a solved problem and deserves a durable note.

### 5.3 Process discipline

- **Read live state before changing it.** Pull the current schema, function, or policy from the
  live system, not from a migration file or memory. Files are history, not truth. If anything
  intervenes between pull and write, pull again.
- **One irreversible action, one explicit confirmation.** See `database-write-safety`.
- **Respect other people's in-flight work** in a shared tree.
- **Do not casually spin up servers to measure.** Several agents each starting a dev or
  production server on one machine can corrupt each other's build output and take down the
  server the owner is using. Prefer measurements that open no port (query plans, proof scripts,
  build output). If you need a server, ask first, isolate it, and tear it down.
- **Keep an honest ledger:** what you measured, changed, verified, and **got wrong**.
- **State what you did NOT verify.** (This is `verify-before-done`.)

---

## Part 6: Case study, a dictation path with a one-second budget

A worked example of Part 1, including the mistakes. The numbers are real.

**The ask:** key-release to final text in under 1 second. It was about 3.2 seconds.

**What was measured first (right):**

```
Speech recognition (third-party GPU)   2,117 ms   65%
LLM cleanup                            1,011 ms   31%   <- in series, after recognition
our own overhead                         124 ms    4%
```

**What was then done wrong:** a six-tier optimization plan was written from those numbers
**without reading the hot path's code**. Half the plan already existed: streaming recognition
that cut on pauses, a skip path for the LLM, a "waking up" notice for a cold engine. The plan
proposed building things the code already did, in a document the owner was going to act on.

> **The rule this earns:** measuring tells you WHERE the time goes. It does not tell you what is
> already built. **Read the hot path's code before proposing an architecture for it.** A profile
> plus an unread codebase produces confident, expensive nonsense.

**What re-measuring by mode showed (the real finding):**

| mode | n | LLM skipped | recognition p50 | total p50 |
|---|---|---|---|---|
| translate | 324 | 296 | 1,608 | 1,690 |
| same-language | 203 | 183 | 1,575 | 1,667 |

The LLM was **already** skipped on most dictations and they still took about 1,690ms. Then, on
our own overhead across 712 dictations: **p50 = 1 ms.**

> **One millisecond.** Every "optimization" queued for our own code (collapsing the entitlement
> gate, trimming silence, pre-connecting the socket) was competing for a few tens of
> milliseconds against a floor of about 1,650 ms owned entirely by a third-party GPU. **Find the
> segment that is actually long, then check whether you even own it.** Optimizing a tier you
> control but that costs 1ms is theatre.

**Two things that were genuinely worth it:**

1. **Indexes on the per-request aggregate.** An entitlement check ran on every dictation and
   summed a usage table with no matching index. Measured on a 500,000-row copy: **83.68 ms to
   0.36 ms (232x)**. Invisible at 261 rows; it landed *before* the data arrived. Cheap,
   permanent, and it never shows up in a profile taken while the table is small. The class of
   bug: work proportional to ALL the data, on every request.
2. **Pre-warm on key press.** When the slow segment belongs to someone else, look for *time you
   already have*. A user speaks for seconds before releasing the key, so poking the serverless
   endpoint at key-DOWN boots a cold worker behind the utterance. It makes nothing faster. It
   moves the cost into dead time.

> **Generalizable move:** when you cannot shrink a segment, try to **start it earlier** or
> **overlap it with something the user is already doing.**

**Diagnosing a third-party tail.** The p95 was 21.5 seconds with a 101 second worst case. The
distribution, not the average, gave it away: 61 dictations under 1 second, 22 over 10 seconds.
That bimodal shape means *capacity*, not slowness. Reading the provider's own API confirmed it:
minimum workers set to zero, all workers throttled, 14 jobs queued, one GPU type allowed. And
every 30 to 94 second outlier was on the endpoint whose idle timeout was **5 seconds**: it died
after nearly every request.

> **Averages hide cold starts. Always look at the distribution.** And when the slow tier is a
> vendor, read the vendor's config and health API before theorizing.

---

## THE CHECKLIST

Before shipping anything that touches data, files, or a hot path:

- [ ] Is the gain something a human can actually perceive (seconds or half-seconds; under about
      50ms is done), or does it multiply?
- [ ] Did I read the hot path's code before proposing changes to it?
- [ ] Do I own the slow segment? If a vendor owns it, did I read the vendor's config and health?
- [ ] Does anything run per item in a loop? Hoist it into set-based queries plus Maps.
- [ ] Any synchronous spawn or exec in a loop? Make it async, bounded, with a timeout.
- [ ] Does the cost stay flat as the limit changes? The filter is applied too late.
- [ ] Is an expensive read cached on a change key (modified time plus size), not a timer?
- [ ] Does the page block on cosmetic data that could load in the background?
- [ ] Is anything polling that could be pushed, with a slow backstop poll and a refetch on
      reconnect?
- [ ] Does every subscription handle and report its failure, and alert only on persistence?
- [ ] Is every cache on a money or state path bounded for staleness?
- [ ] Did I prove a "duplicate" by full query and body before removing it?
- [ ] Did I measure WARM, more than once, on realistic data volume, on the current build, and
      look at the distribution?
- [ ] Did I diff the actual output before and after, not just the count?
- [ ] If the rewrite lost, did I revert it and write that down?

---

## The one-paragraph version

**Read the hot path's code before proposing an architecture for it**: a profile plus an unread
codebase produces confident, expensive nonsense, and half of what you "plan" may already exist.
**Check whether you even own the slow segment**: optimizing a tier you control that costs 1ms,
while a vendor owns 1,650ms, is theatre. When you cannot shrink a segment, start it earlier or
overlap it with something the user is already doing. Look at the DISTRIBUTION, not the average: a
bimodal split is capacity, not slowness. Do not optimize what a human cannot feel (under about
50ms is done); chase seconds, and when a small cost is multiplied by a loop, remove the loop
instead of shrinking each iteration: push instead of poll, batch N into one, share one cache,
start work as early as inputs allow, hoist per-row work out of the inner loop. Prove a
"duplicate" is real (full query plus body). Attack the segment that is actually long, on the
build actually running. Report every failure, but alert on PERSISTENCE ("failed and did not come
back"), never a self-healing blip; dedupe hard; keep personal data out. Gates passing is the
floor: verify the user can do the real job on a messy record, type your data mapping, bound any
cache on a money or state path, never wave off a failing production build as "just local." Read
live state before changing it, confirm before anything irreversible, and write down what you got
wrong.
