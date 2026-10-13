---
name: database-write-safety
description: What to do BEFORE and AFTER running anything that writes to a database, for both a hosted Postgres/Supabase database and a local file database such as SQLite. Read it before any UPDATE, DELETE, INSERT, ALTER TABLE, DROP, TRUNCATE or schema change; before any migration, backfill, or script that writes rows in bulk; before running SQL you generated, copied, or are not 100% sure about; before changing a table, column, function, trigger or policy that other objects depend on; and before adding a foreign key to an entity that has a merge, delete, export or clone routine. It encodes the order that makes a bad write survivable: read the LIVE schema, understand everything attached to the table, back up or know your recovery path, SELECT before you UPDATE or DELETE, know the row count before you run, wrap multi-statement work in a transaction, show the SQL and get the owner's go-ahead, then verify the count and the app after. Also use when the owner mentions the database, a migration, a backfill, "fix the rows", "clean up the table", "delete the duplicates", "drop that column", or when something in the database already looks wrong.
---

# Database Write Safety

A bad `UPDATE` with no `WHERE` is permanent unless something was in place before you ran it. That
single fact is why this skill exists. Everything below is the order that turns a disaster into an
inconvenience.

The database is usually more than rows. It is the pairing layer between things: a file on disk
and its transcript, a payment and its invoice, a person and their history. Corrupting it does not
just lose rows, it breaks the alignment between them, and that alignment is the expensive thing
to rebuild.

> **Standing rule from the toolkit's `AGENTS.md`:** before any database write, pull the LIVE
> schema of every table, function and trigger it touches and verify your SQL against it byte for
> byte. Migration files and memory drift. Only the live database is truth.

---

## 0. READS ARE FREE, WRITES ARE GATED

Sort every database action into one of two piles before you run it.

| Pile | Examples | Rule |
|---|---|---|
| **READ** | Fetching the live schema, `SELECT`, `EXPLAIN`, regenerating typed client code from the schema, any read-only CLI command | Run it yourself, without asking. Reading is how you stop guessing. |
| **WRITE** | Executing a migration, any `INSERT` / `UPDATE` / `DELETE`, any `CREATE` / `ALTER` / `DROP` | Never on your own initiative against a shared or production database. See the approval sequence in section 6. |

When the owner asks for a feature, fetch the live schema FIRST, automatically, then plan against
the actual schema. If schema changes are needed, propose them as SQL before writing any app code
that depends on them.

---

## 1. READ THE LIVE SCHEMA. DO NOT ASSUME.

- **Do not assume a table or column exists** because the name sounds right, because an earlier
  message mentioned it, or because a migration file creates it. Verify against the live database.
  (Real example of the trap: a `segments` table that looked like it should carry the filename
  held only `id, parent_id, text, ord`; the filename lived on the parent table, one join away.)
- **The migrations folder is history, not truth.** Owners change things directly in the database
  dashboard. A migration file can describe a function body that was replaced three times since.
  Quote the live definition, never the file.
- **Rows edited through an admin UI change constantly.** Do not quote a seed migration as the
  current contents of a config table. Pull the rows.
- **If anything intervenes between your pull and your write, pull again.** Another agent or the
  owner may have changed it.
- **After any schema change, regenerate the typed client code** (the generated types file) if the
  repo has one, so the compiler sees the new shape.

---

## 2. UNDERSTAND EVERYTHING ATTACHED TO THE TABLE

Before modifying ANY database object (table, column, function, trigger, policy), get the full
picture:

1. **The table's full schema.** All columns, types, constraints, and foreign keys in both
   directions: what it references, and what references it.
2. **Functions** that SELECT, INSERT, UPDATE or DELETE from this table. Search the live function
   bodies, not the migrations.
3. **Triggers** that fire on this table.
4. **Server-side code outside the database** that queries it: serverless or edge functions,
   backend routes, cron jobs, workflow tools.
5. **Access policies** on the table. Understand WHO can access WHAT rows and WHY before you touch
   anything. See `security-rls-permissions`.
6. **The app's own permission layer**, if it has one. A policy change may need the per-role
   defaults updated too.

Only then proceed. If you are unsure about any relationship or side effect, ASK before changing.

---

## 3. BACK UP FIRST, OR KNOW YOUR RECOVERY PATH

Before any write you are not certain about, make sure the write is reversible. This is cheap and
it is the only thing that makes the rest of the steps recoverable.

**A file database (SQLite and similar):**

```bash
# Timestamped copy. In WAL mode the -wal and -shm files matter too.
cp app.sqlite "app.sqlite.bak-$(date +%Y%m%d-%H%M%S)"
```

- The safest copy is taken with the server **stopped**, so no write is mid-flight.
- If the server is running in WAL mode, checkpoint first so the WAL is folded into the main file
  (`wal_checkpoint(TRUNCATE)`), or copy the `-wal` and `-shm` files alongside the main file.
- Know when the app checkpoints. One app did it on STARTUP, not on shutdown: a restart folded the
  WAL in, but killing the server mid-write did not.
- A file database is very often excluded from git (`*.sqlite` in `.gitignore`). Then there is no
  remote copy and no point-in-time recovery. Your backup is the only copy.
- Backups are working files, not deliverables. Clean them up when you are done. Do not leave
  test artifacts behind.

**A hosted database (Postgres, Supabase and similar):**

- Find out what recovery actually exists (daily backups, point-in-time recovery, nothing) BEFORE
  relying on it. "The provider has backups" is an assumption until you have read the plan.
- For a targeted change, snapshot the rows you are about to touch into a scratch table or a
  local file first, so you can put them back without a full restore.
- Prefer reversible changes: add the new column and backfill it, and drop the old one in a later,
  separate, approved step.

---

## 4. SELECT BEFORE YOU UPDATE OR DELETE

Run the `WHERE` clause as a `SELECT` first. Read the rows. Confirm they are the rows you meant.

```sql
-- FIRST: look at exactly what you are about to touch
SELECT id, parent_id, text FROM child_rows WHERE parent_id = 42;

-- THEN: the same WHERE, now as the write
DELETE FROM child_rows WHERE parent_id = 42;
```

If the `SELECT` returns something you did not expect (a different count, rows from another
tenant, NULLs you did not anticipate), **stop and figure out why before writing.** That surprise
is the bug, and it is cheaper to understand now than to reverse later.

## 5. KNOW THE COUNT BEFORE YOU RUN

```sql
SELECT COUNT(*) FROM child_rows WHERE parent_id = 42;
```

Write the number down. If you expect to change 12 rows and the count says 4,000, your `WHERE` is
wrong. This one check catches the classic disasters: a missing `WHERE`, a join that fanned out,
an `IN` list that matched more than you thought.

**A write with no `WHERE` clause is almost always a mistake.** If you genuinely mean to touch
every row, say so out loud in your message and take a backup immediately before.

---

## 6. THE APPROVAL SEQUENCE (shared and production databases)

1. Write the SQL into a file.
2. Show the owner the full content of that file.
3. Ask for explicit permission to execute it.
4. **Never execute in the same turn you created it.** Wait for the confirmation.
5. If the change touches tables under access policies, permissions, or tenant isolation, read
   `security-rls-permissions` first and say that you did.

This holds even when the change looks trivial. The trivial ones are where the missing `WHERE`
lives.

**One irreversible action, one explicit confirmation.** Before a `DROP` of anything (table,
column, index, function):

- Prove it is unused against LIFETIME stats, and check when those stats were last reset.
- Grep the whole codebase for it, including typo'd variants and string-built names.
- Confirm it backs no constraint.
- Get sign-off for that specific drop. "Clean up the schema" is not sign-off for a drop.

---

## 7. WRAP MULTI-STATEMENT WORK IN A TRANSACTION

If a change takes more than one statement, it must be all-or-nothing.

```js
// Example with a synchronous SQLite driver. Any driver has an equivalent.
const tx = db.transaction((rows) => {
  for (const r of rows) {
    stmtDelete.run(r.id);
    stmtInsert.run(r.file, r.text);
  }
});
tx(rows);   // commits only if the whole body succeeds; a throw means nothing was written
```

A half-applied change is worse than a failed one: it leaves the database in a state neither you
nor the app expects, and you will not know how far it got.

Transactions also make bulk writes dramatically faster in SQLite. Thousands of individual
`INSERT`s outside a transaction each pay their own fsync. This is the "do it once, not N times"
lesson from `latency-and-efficiency`, wearing a different hat.

If the repo already has examples of transactional writes, follow those examples instead of
inventing a new shape.

---

## 8. VERIFY AFTER: the count, the rows, then the app

```sql
SELECT COUNT(*) FROM child_rows WHERE parent_id = 42;    -- is it what you predicted?
SELECT id, text FROM child_rows WHERE parent_id = 42 LIMIT 10;   -- do the values look right?
```

Then verify in the **app**, not just in SQL. Restart the server if it needs it, open the page
that reads this data, and confirm it shows what you expect. A database change the app does not
pick up is not a finished change. See `verify-before-done`.

---

## SCHEMA CHANGES: extra care

- **Adding a column** is usually safe: existing rows survive with NULLs or the default.
- **Two definitions of the schema must not drift.** If the app creates its tables at startup
  (`CREATE TABLE IF NOT EXISTS ...` in a schema file) AND you alter the live database by hand,
  update the startup definition too, so a fresh database matches an upgraded one. These two
  drifting apart is a real bug: the app works on your machine and breaks on a clean setup. The
  same applies to any "seed for a new tenant" function versus a backfill for existing tenants:
  a new resource needs BOTH.
- **Renaming or dropping a column** can rewrite the whole table and break every query, function,
  trigger and policy that names it. Back up first, without exception, and find every reference
  (see `working-agreements`, "interconnected changes").
- **`DROP TABLE` is not recoverable.** Back up, and say plainly what you are about to do before
  you do it.
- **Never edit a file database by hand in a GUI tool while the server is running.** WAL mode
  tolerates concurrent readers, but an external write mid-request can produce exactly the kind of
  inconsistency that is painful to trace.

### A new table under row-level security needs grants AND policies

Two layers, and both must be right. If the table grant is missing, the policies are never even
evaluated and every call returns a permission error that looks like a policy bug. Grant first,
enable row security, then write the policies. The full debugging order for a mysterious 403
("check table grants FIRST") is in `security-rls-permissions`.

### A new foreign key to an entity that has an "enumerate every reference" routine

Some entities have a routine that must know about every table pointing at them: a **merge** tool
(fold duplicate B into canonical A), a hard-delete or anonymize routine, a per-customer export, a
clone-to-template routine. If your migration adds a column or table that references such an
entity, you MUST wire it into that routine in the same change. Skipping it leaves orphaned rows
pointing at a soft-deleted record and silently breaks reporting, billing and history.

For a merge routine, the shape is:

1. **The merge function.** Pull its LIVE body first (do not copy it from an old migration). Add a
   re-point statement for the new foreign key, and record the affected row count in the
   function's result so the caller can show it.
2. **The composite-unique special case.** If the new table has a unique or primary key that
   includes the entity id (for example `UNIQUE (person_id, x)`), a plain re-point will collide.
   Dedupe first, then update:

   ```sql
   DELETE FROM child_table WHERE person_id = p_duplicate_id
     AND x IN (SELECT x FROM child_table WHERE person_id = p_canonical_id);
   UPDATE child_table SET person_id = p_canonical_id WHERE person_id = p_duplicate_id;
   ```
3. **The preview function**, if there is one ("what will move" counts shown before the merge).
   Add a count for the new table.
4. **The frontend label** for the new preview key, or the UI shows the raw key.
5. **Audit-only references are NOT re-pointed.** A merge-history table that records "A absorbed
   B" must keep pointing at the original ids. The merge function skips them on purpose.

Verify nothing was missed by listing every foreign key to that entity from the LIVE catalog and
cross-checking it against the statements inside the routine. Anything in the live database that
is missing from the routine is a bug.

```sql
-- Every column in the live database that references the entity's table (Postgres).
SELECT ns.nspname || '.' || rel.relname AS tbl, att.attname AS col
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
JOIN pg_class fkrel ON fkrel.oid = con.confrelid
JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
WHERE con.contype = 'f' AND fkrel.relname = 'your_entity_table'
ORDER BY ns.nspname, rel.relname;
```

---

## MONEY COLUMNS: one unit, everywhere

Pick one unit for stored money and never mix. The owner's convention is **integers in cents**.

| Operation | Rule |
|---|---|
| Reading from the database for display | Divide by 100, OR use the shared currency formatter, never both |
| Saving user input | Multiply by 100 (the user types dollars) |
| CSV / PDF exports | Divide by 100 before formatting to two decimals |
| Passing to a shared format function | Keep it in cents if the function expects cents |

- **The common mistake is double conversion:** dividing by 100 when fetching, then handing the
  result to a formatter that divides by 100 again.
- **Red flag:** a code comment saying a column is "stored in dollars". It is almost always wrong.
  Verify the live column type: an integer column means cents.

For the wider rules on money paths, see `money-truth-doctrine`.

---

## SQL YOU DID NOT WRITE YOURSELF

Generated, copied, or pasted SQL gets **more** scrutiny, not less. Before running it:

1. Read every statement. If you do not understand one, do not run it.
2. Find every `WHERE`. Confirm each one is scoped the way you intend.
3. Look specifically for: a missing `WHERE`, a `DROP`, a `TRUNCATE`, a `DELETE` with a join, an
   `UPDATE` setting a column to a constant across the table.
4. Run the `SELECT` form of each write first (section 4).

---

## IF SOMETHING ALREADY WENT WRONG

1. **Stop writing immediately.** Stop the server or the job. Every further write reduces what is
   recoverable.
2. **Copy the current state before you experiment.** You may need to compare against it, and a
   fix attempt can make things worse.
3. **Find the most recent backup**, and check its timestamp against when the damage happened.
4. **Diff before restoring.** Restoring loses everything written since the backup. Know what that
   is. Sometimes replaying a few recent changes onto the backup beats losing an hour of real work.
5. **Tell the owner what happened, plainly, right away.** Not after the third repair attempt.
6. **Write down the cause and the fix** in the repo's fix log if it has one, so it cannot happen
   twice.

---

## THE CHECKLIST

Before running anything that writes:

- [ ] Did I pull the LIVE schema of every table, function and trigger this touches?
- [ ] Do I know every function, trigger, policy and piece of server code attached to the table?
- [ ] Did I back up (server stopped, or after a WAL checkpoint), or do I know the real recovery
      path?
- [ ] Did I run the `WHERE` as a `SELECT` and read the actual rows?
- [ ] Do I know the exact row count I expect to change?
- [ ] Does every write have a `WHERE`, or did I say out loud that it is intentional?
- [ ] Is multi-statement work wrapped in a transaction?
- [ ] Did I show the SQL and get an explicit go-ahead, in a later turn than the one I wrote it in?
- [ ] For a schema change: is the startup or seed definition updated to match, so a fresh
      database is identical? Are existing tenants backfilled?
- [ ] For a new foreign key: does a merge, delete, export or clone routine need to learn about it?
- [ ] After: did the count match my prediction, and do the rows look right?
- [ ] After: did I restart the server if needed and confirm the app shows the change?
- [ ] After: did I regenerate typed client code and clean up backups and temp files?

---

## Related

- `verify-before-done`: the general "did it actually land" protocol.
- `security-rls-permissions`: policies, grants, SECURITY DEFINER functions, tenant isolation.
- `query-efficiency`: making the queries themselves cheap.
- `latency-and-efficiency`: set-based writes over per-row loops; transactions as the fast path.
- `money-truth-doctrine`: money paths.
