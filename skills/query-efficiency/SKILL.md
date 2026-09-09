---
name: query-efficiency
description: Guide for making DATA ACCESS efficient - the database and network side of performance, as opposed to the React-rendering side covered by page-performance. Written for a Postgres/Supabase + React stack; the principles apply to any SQL database. Use this skill BEFORE writing any query, any RPC / SQL function, any RLS policy, any migration, any loop that touches data, or any new page/dialog/picker that loads data; and whenever anything feels slow, a page takes seconds to load, a search box lags, a list takes a long time to appear, or you are about to "optimize" something. It encodes hard rules that repeatedly cost real user-visible latency - never query inside a loop (N+1), never compute over the whole table then LIMIT, never call a SECURITY DEFINER helper bare inside an RLS policy or hot query, always measure before AND after with real numbers, and never optimize something the user cannot perceive. Also use when the user mentions slow, laggy, delay, "takes forever", N+1, batching, EXPLAIN, index, RLS performance, pg_stat_statements, or "why is this taking so long".
---

# Query Efficiency: the data-access performance standard

> **Scope split - read the right one.**
> * **This skill** = the DATABASE + NETWORK side. Queries, RPCs, RLS, indexes, N+1 loops, how much data you fetch, how many round-trips you make.
> * **`page-performance` skill** = the REACT side. Re-renders, refs vs state, memoization, scroll handlers, skeletons, optimistic updates.
>
> A slow page is almost always one or the other. Diagnose which before you start.

---

## RULE 0 - THE ONLY REASON TO OPTIMIZE

Before touching anything, answer two questions. If both are NO, **stop and walk away.**

| Question | Threshold |
|---|---|
| **Will the user PERCEIVE this?** | Roughly **>= 400ms**. Seconds, or half a second. |
| **Does it MULTIPLY?** (loop / N+1 / poll / per-row) | Any per-call cost x thousands of calls. |

**A 50ms query is DONE. Leave it alone.** Shaving it to 30ms behind a 250ms
debounce is invisible work that only adds risk.

**But when something multiplies, do not shave the individual call.**
Restructure so it runs once. One query returning 200 rows beats 200 queries
returning one row, even when each of those is "only 5ms".

> Real example: an agent was about to build a generated search column + tsvector to
> take a contact search from 55ms to ~30ms. Behind a debounce the user could never
> have seen the difference. Cancelled as pure waste.
>
> Meanwhile two "fine-looking" ~120ms lookup queries were running ~200,000 times
> each - **6.9 hours of database time apiece**. Per-call they looked healthy. That
> is what multiplication means.

---

## RULE 1 - MEASURE. NEVER GUESS.

Every optimization in this document was found by measurement and several
confident hypotheses were **disproved** by it. You are not the exception.

### Find what is actually slow

```sql
-- What costs the most TOTAL time? (catches the multiplying ones)
SELECT calls, round(mean_exec_time::numeric,1) AS mean_ms,
       round((total_exec_time/1000/60)::numeric,1) AS total_minutes,
       left(regexp_replace(query,'\s+',' ','g'), 110) AS q
FROM pg_stat_statements
WHERE calls > 500
ORDER BY total_exec_time DESC
LIMIT 20;

-- What is slow enough for a human to FEEL?
SELECT calls, round(mean_exec_time::numeric,0) AS mean_ms, left(query,110)
FROM pg_stat_statements
WHERE mean_exec_time >= 400 AND calls >= 50
ORDER BY total_exec_time DESC;
```

### ⚠️ `pg_stat_statements` means are LIFETIME averages

They include every call since the counters started. After you fix something, the
average still looks terrible for a long time. **Always re-measure live before
concluding anything is still slow.**

> Real case: `product_locations` showed a 1,927ms lifetime mean. Measured live
> after the RLS fix: **53ms**. Nine such queries were already fixed; acting on the
> lifetime numbers would have meant "optimizing" things that were already fast.

### Measure as the real caller, with RLS on

A `SECURITY DEFINER` function bypasses RLS; the app usually does not. Measuring
as service-role hides the exact cost you are hunting.

```sql
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"<a real user uuid>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT ...;
```

### Read `loops=` and `Buffers` first

In `EXPLAIN ANALYZE` output these two numbers tell you almost everything:

* **`loops=N`** on an inner node - that node ran N times. `loops=2013` when the
  page shows 30 rows is a bug, not a plan.
* **`Buffers: shared hit=N`** - pages touched. Thousands of buffers to return a
  handful of rows means work is being done and thrown away.

### Timing traps that have produced wrong answers here

| Trap | What happens | Do instead |
|---|---|---|
| Several queries chained in one `WITH` | The FIRST absorbs session cold-start. Measured 1,509ms; isolated it was **6-9ms**. | Time each statement separately, and repeat it. |
| First call after `CREATE OR REPLACE` | Cold plan + cold cache. Measured 809ms; steady state **55ms**. | Always discard run 1. Report the warm number. |
| Comparing row COUNTS only | Ordering bugs pass silently. | Compare exact row IDs **and their order**. |

---

## RULE 2 - NEVER QUERY INSIDE A LOOP (the N+1)

The single most expensive pattern in this codebase.

```ts
// ❌ WRONG - one round-trip per item
for (const id of contactIds) {
  const { data } = await supabase.from('contacts').select('id, first_name').eq('id', id);
}

// ❌ ALSO WRONG - still N queries, just concurrent. Now they fight for the
// browser's 6-connections-per-host limit.
await Promise.all(ids.map(id => supabase.from('contacts').select('...').eq('id', id)));

// ✅ RIGHT - one round-trip
const { data } = await supabase.from('contacts').select('id, first_name').in('id', contactIds);
const byId = new Map(data.map(r => [r.id, r]));
```

**How to spot it in code review - grep for these shapes:**

```
.map(async            // a query inside a map
for (... of ...)      // with an await supabase inside
forEach(async
Promise.all(items.map(   // N queries, not one
await ... inside a loop body
```

**Sequential chains are the same bug wearing a hat.** Four dependent fetches
where each waits for the last is a 4-deep waterfall; the page cannot paint until
all four return. Collapse them into one query, one RPC, or at minimum a
`Promise.all` of *independent* fetches.

**In SQL, the same bug is a correlated subquery or a LATERAL over an unbounded
set.** Watch for `loops=` matching your row count.

---

## RULE 3 - FILTER AND LIMIT *BEFORE* THE EXPENSIVE WORK

If a query computes something for every row and then keeps 25, it is doing
~99% of its work for nothing.

**The tell:** the query costs the same whether it returns 25 rows or 1,000.
That means the cost is not per-returned-row, so the limit is being applied last.

```sql
-- ❌ WRONG: aggregates the ENTIRE company, then keeps 25.
WITH activity AS (
  SELECT c.id, GREATEST(MAX(b.created_at), MAX(o.created_at), c.updated_at) AS last_activity
  FROM contacts c
  LEFT JOIN bookings b ON b.contact_id = c.id
  LEFT JOIN orders   o ON o.contact_id = c.id
  WHERE c.company_id = p_company_id
  GROUP BY c.id, c.updated_at
)
SELECT ... FROM contacts c JOIN activity a ON a.id = c.id
ORDER BY ... LIMIT 25;

-- ✅ RIGHT: let WHERE + LIMIT pick the rows, THEN compute per surviving row.
SELECT c.*,
  GREATEST(
    COALESCE((SELECT MAX(b.created_at) FROM bookings b WHERE b.contact_id = c.id), '1970-01-01'::timestamptz),
    COALESCE((SELECT MAX(o.created_at) FROM orders   o WHERE o.contact_id = c.id), '1970-01-01'::timestamptz),
    COALESCE(c.updated_at, c.created_at)
  ) AS last_activity
FROM contacts c
WHERE c.company_id = p_company_id AND c.is_deleted = false
ORDER BY c.created_at DESC
LIMIT 25;
```

> Measured: 10,497 contacts x 72,218 bookings x 94,330 orders = **3,012ms** for the
> CTE version. The restructured version: **5ms**. Same data, same output.
>
> This requires the FK columns to be indexed (`idx_bookings_contact_id`,
> `idx_orders_contact` already exist). Check before assuming.

**Caveat that bit us:** if the sort key IS the expensive value (`ORDER BY
last_activity`), you genuinely must compute it for every candidate before you can
pick the top N. Even then the indexed per-row form beat the join-aggregate 10x
(3,012ms -> 291ms). Measure both shapes.

---

## RULE 4 - RLS IS A PER-ROW COST. TREAT IT LIKE ONE.

This caused the largest slowdowns ever found in this project.

An RLS policy predicate runs **for every row scanned**. If it calls a function,
that function runs for every row too.

### 4a. `SECURITY DEFINER` functions are NEVER inlined

Postgres will not inline a SECDEF function (inlining would run the body with the
caller's privileges instead of the owner's). So a bare `fn()` in a policy is an
opaque per-row function call.

**Wrap every no-argument SECDEF helper in a scalar subquery.** That makes it an
uncorrelated subquery the planner hoists into an InitPlan, evaluated **once**.

```sql
-- ❌ per-row call
USING (company_id = get_my_company_id() AND (is_owner_or_super_admin() OR ...))

-- ✅ evaluated once per query
USING (company_id = (SELECT get_my_company_id())
       AND ((SELECT is_owner_or_super_admin()) OR ...))

-- ✅ array helper needs an explicit cast, or you get 42703 uuid = uuid[]
location_id = ANY ((SELECT get_user_location_ids())::uuid[])
```

> Measured on `chat_sessions`: **259.6ms -> 5.1ms** (51x), buffers 16,789 -> 306.
> Applied across 928 policies / 288 tables.

The same applies to bare `EXISTS (...)` blocks in a policy: `(SELECT EXISTS (...))`
is hoisted, `EXISTS (...)` may not be.

### 4b. Never put a row-dependent function call in a policy

If the argument comes from the row, it CANNOT be hoisted or index-matched.

```sql
-- ❌ auth_shares_company_with(id) takes the ROW's id -> runs per row, and
--    defeats every index because the OR branch is opaque.
USING (id = auth.uid() OR company_id = get_my_company_id() OR auth_shares_company_with(id))

-- ✅ row-independent: same visibility, evaluated once, index-usable
USING (id = auth.uid() OR company_id = (SELECT get_my_company_id()))
```

> Measured on `public.users`: a **primary-key lookup** was doing a Seq Scan of all
> 323 rows and burning 2,637 buffers because of that one branch. After:
> **11.13ms -> 0.57ms**, buffers 2,637 -> **18**. Every page in the app reads
> `users`, so this was a site-wide win.

### 4c. Slow query? Suspect RLS before you suspect the query

Compare the same query with and without RLS. If the gap is large, the query is
fine and the policy is the problem.

```sql
-- as authenticated (RLS on)   vs   as service_role (RLS off)
```

> Measured on a 1MB table: **5.4ms without RLS, 305ms with** - a 56x penalty that
> had nothing to do with the query.

If a policy genuinely cannot be made cheap, move the query into a
`SECURITY DEFINER` RPC that does the auth check **once** at the top (verify the
caller owns the target), then runs the inner query unfiltered. This trades a
per-row policy for a single up-front check - but the check MUST be there, or the
RPC becomes a cross-tenant leak (see the `security-rls-permissions` skill).

---

## RULE 5 - INDEXES: VERIFY, DON'T ASSUME

Creating an index is a hypothesis. **`EXPLAIN` is the experiment.** Several
"obviously correct" indexes added here were never used.

| Trap | What happens | Fix |
|---|---|---|
| **Partial index the planner can't prove** | `WHERE is_deleted IS NOT TRUE` does not provably match a query saying `is_deleted = false OR is_deleted IS NULL`, so the index is rejected. | Drop the predicate, or make the query's predicate match exactly. |
| **Composite index, non-constant leading column** | `(company_id, phone)` is unusable for the phone when `company_id` comes from a subquery. | Add a single-column index on the actual filter column. |
| **Trigram GIN used for `=`** | `gin_trgm_ops` exists for `ILIKE '%x%'`. On exact equality it is 50-60x slower than a btree. | Add a plain btree for equality; keep trigram for fuzzy search. |
| **Function/expression on the column** | `WHERE lower(x) = ...` or `ILIKE` on `a || ' ' || b` cannot use a plain column index. | Index the exact expression, or store a normalized column. |

> Measured: phone lookup arms - btree `phone_e164` **0.017ms/loop**, trigram
> `phone_number` **0.85-1.02ms/loop**. Adding the two missing btrees took a
> per-lookup path from 2,853ms to 800ms across 2,013 rows.

**Then prove the index is earning its place:**

```sql
SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes WHERE relname = 'your_table' ORDER BY idx_scan;
```

`idx_scan = 0` means never used - **but check `pg_stat_database.stats_reset`
first**; if the counters were reset recently, zero only means "not since then".
Unused indexes are not free: every one is maintained on every INSERT/UPDATE of a
write-hot table.

---

## RULE 6 - FETCH ONLY WHAT YOU RENDER

* **Never a wildcard column select** (hook-blocked). Name the columns.
* **Cap the rows.** A search box does not need 1,000 rows; it needs ~20.
* **Don't fetch heavy columns in a picker.** Address/notes/tags blobs cost
  network and parse time for a list that shows a name and a phone.

> Measured: the Contacts page fetched up to **1,000 rows x ~20 columns on every
> keystroke**, because the "All" page-size cap applied while searching. Network +
> JSON parse + mapping + table re-render, per character typed.

---

## RULE 7 - TYPEAHEAD / SEARCH BOXES

The standard: **the input must never lag**, and results settle quickly after the
user stops typing.

| Requirement | Rule |
|---|---|
| Input value | **Local state, always.** Never route a keystroke through the URL/router - that re-renders the page subtree per character. |
| Fetch trigger | Debounce **250ms**. Query on the DEBOUNCED value; render the RAW value. |
| Minimum length | 2 characters. A 1-char search matches ~30% of the table. |
| Row cap | ~20. |
| Cache | React Query, `staleTime` ~30s, and `placeholderData` so the list does not blank between keystrokes. |
| Race safety | Debounced React Query keyed on the term is inherently safe. Hand-rolled fetches need a **sequence guard** (`seq !== seqRef.current -> drop`). |

**Write the search once, as a shared hook, and reuse it.** Near-identical private
copies drift and each re-introduces the same two bugs (raw term in the query key,
no minimum length). One hook, one place to fix.

For a ranked entity search, prefer a single server-side ranking RPC over an ad-hoc
`.or(ilike)`. A good typeahead RPC handles multi-word (order-independent), compact
"firstlast", digit-only matching (so a pasted `(845) 540-1902` matches a phone),
LIKE-metacharacter escaping, and tiered relevance ranking - an ad-hoc `ilike`
returns results in arbitrary order and can't rank. Build it once for the entity
you search most.

---

## RULE 8 - VERIFY THE FIX DID NOT CHANGE THE ANSWER

Performance work that changes results is a bug, not an optimization.

1. **Capture a baseline BEFORE** - exact row IDs **in order**, plus counts and
   totals, across every meaningful scenario (each sort, each filter, search and
   no-search, empty, no-match, special characters).
2. **Apply.**
3. **Diff programmatically.** Never eyeball 30 rows.

> This caught two real bugs that had nothing to do with performance:
> * The `ORDER BY` had **no unique final column**, so two contacts with identical
>   names had undefined order - meaning a row could appear on two pages or none.
> * The default `created_at` sort **matched no `ORDER BY` branch at all**, so its
>   ordering was undefined and had merely looked plausible.
>
> Counting rows would have shown "25 = 25" and shipped both.

**Always end an `ORDER BY` with a unique tiebreaker (`id`)** - and put it LAST, so
it can only break exact ties and never dominate a real sort key.

---

## RULE 9 - WHEN A REWRITE MAKES IT SLOWER, REVERT

`plpgsql -> sql` is **not** a universal win, despite what one success suggests.

* It **helps** when the body is one statement the planner should see whole.
* It **hurts** when the body deliberately precomputes values into `DECLARE`
  variables to avoid per-row work - as CTEs those get re-evaluated per row.

> Measured: `get_sms_threads_v2` improved from the conversion. The identical
> approach on `search_contacts_typeahead` made it **2-3x SLOWER** (55ms -> 181ms)
> and was reverted. Behavior was verified identical both ways, so it was purely a
> performance decision.

Measure both. Keep the winner. Document the loser so nobody repeats it.

---

## THE CHECKLIST

Before shipping anything that touches data:

- [ ] Does this run in a loop? -> batch it with `.in()` / one RPC.
- [ ] Are these fetches sequential but independent? -> `Promise.all`.
- [ ] Does the cost stay flat as the row limit changes? -> the LIMIT is applied too late.
- [ ] Does an RLS policy call a SECDEF helper bare? -> wrap it in `(SELECT fn())`.
- [ ] Does a policy pass a ROW column into a function? -> restructure; it kills every index.
- [ ] Named columns, not a wildcard select? Row cap present?
- [ ] Is a search box debounced (250ms), min 2 chars, input on local state?
- [ ] Did I `EXPLAIN` and check `loops=` and `Buffers`?
- [ ] Did I measure WARM (discarding the first call), each statement separately?
- [ ] Did I diff exact row IDs and ORDER before/after?
- [ ] Does the `ORDER BY` end with a unique tiebreaker?
- [ ] Is the gain something a user can actually perceive (>=400ms or multiplied)?

---

## REFERENCE: real fixes, with numbers

Keep these as calibration for what "slow" looks like and what each rule is worth.

| Kind of fix | Before | After |
|---|---|---|
| Inbox-list RPC rewritten (filter-before-compute) | 6,918 ms | **72 ms** |
| List page with per-row activity (RULE 3 restructure) | 3,012 ms internal / 504 ms RPC | **60 ms** |
| RLS SECDEF-helper hoisted to `(SELECT fn())`, applied fleet-wide | 259.6 ms | **5.1 ms** |
| Row-dependent function removed from a policy (index restored) | 11.13 ms, 2,637 buffers | **0.57 ms, 18 buffers** |
| Unread-count aggregate | 1,698 ms | **20-35 ms** |
| Two "healthy-looking" ~120 ms queries called ~200k times each | ~120 ms | **1.5 ms** |
| Missing btree indexes on a LATERAL join | 2,853 ms | **800 ms** |

Related skills: **`page-performance`** (React rendering side),
**`security-rls-permissions`** (correctness of the policies whose cost this
document is about - never trade security for speed).
