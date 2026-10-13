---
name: verify-before-done
description: How to confirm a change actually works before calling it done, and how to report honestly what was and was not checked. Read it BEFORE saying "done", "fixed", "working", "deployed" or "ready"; after ANY edit to server code that the running process loaded at boot (no hot reload means an unrestarted change is an unverified change); after any fix whose effect you cannot see; before opening a browser against a local server whose URL you have not confirmed; and whenever you are tempted to infer success from "the code looks right" or "no error appeared". It encodes the order: restart, confirm you are talking to the new process, exercise the exact path you changed, check real state on disk and in the database instead of the UI's claim about it, try the edge case that breaks it, then report what you verified and what you did not. Also use when the owner asks "is it working?", "did that fix it?", "are you sure?", "did you test it?", or when reporting results of any kind.
---

# Verify Before Done

The failure this prevents is not writing bad code. It is **reporting unverified work as
finished**. That costs more than the bug, because it moves the discovery to the owner and
destroys the value of every future "done."

This is the owner's own protocol. A third-party `verification-before-completion` skill also
ships in the toolkit and says a compatible thing in fewer words ("evidence before assertions").
Where they overlap, this one is the more specific and wins. For product-level review use
`build-with-the-user-in-mind` and `review-build`; for reports and dashboards use
`report-verification`; for driving a real browser use `browser-verification`.

---

## THE ORDER

### 1. RESTART: assume there is no hot reload until you have proved there is

Many server processes load their routes and modules once at boot. Editing a route file changes
the file on disk and **nothing about the running process**. The route you just "fixed" is still
serving the old code.

Know, per repo, which edits need what:

| Kind of file (examples) | What picks it up |
|---|---|
| Server entry point, route modules, anything `require`d or imported at boot | A process restart |
| Templates or static HTML the server reads per request | A browser refresh, and make it a HARD refresh, because a cached page will happily show you the old markup |
| Frontend code under a dev server with HMR | Usually automatic, but a syntax error can leave HMR stuck on the last good build (see `debugging-discipline`) |
| A production build, a service worker, a deployed bundle | A rebuild and a real reload. A cache can serve the old bundle to the exact tab you are testing |

**Confirm you are talking to the NEW process.** If the machine auto-starts the server (a
scheduled task, a service manager, a watchdog that self-heals it), an older instance may already
be holding the port. Your restart then appears to do nothing, and that failure mode looks exactly
like "my fix did not work." Check which process owns the port and when it started before you
conclude anything about your change.

### 2. KNOW WHICH SERVER YOU ARE LOOKING AT

Before you open a browser, inspect UI, or reason about live behavior, determine the real URL. Do
not assume it.

1. Search the project: `package.json` scripts (dev, start, serve), the README or docs, the
   framework config (Vite, Next, plain Node), env files (`.env`, `.env.local`), and the terminal
   output of the running dev server.
2. Identify the framework, the local URL and port, and whether there are several environments
   (dev, staging, production) or several servers (a frontend plus one or more backends).
3. If the URL is not clearly identifiable, STOP and ask the owner, offering the most likely
   candidates as options.

Hard rules:
- Never assume port 3000 (or any port) by default.
- Never assume a production or staging URL.
- Never perform browser-based reasoning before the URL is confirmed.
- Once confirmed, state which URL you are using, then proceed.

`browser-verification` covers the browser mechanics (your own isolated browser, login walls,
opening a page in the owner's own browser). This section is only the "which server" gate.

### 3. EXERCISE THE EXACT THING YOU CHANGED

Not a neighbouring route that still works. Not the page that loads. **The specific path you
edited**, with input that actually reaches the changed line.

If you changed the branch that handles a moved file, test with a moved file. If you changed the
error path, cause the error. A green page proves the page renders. It says nothing about the
branch you touched.

### 4. CHECK REAL STATE, NOT THE UI'S CLAIM ABOUT IT

The UI must reflect real state: a delete really deletes (or really goes to the recycle bin), a
save really writes a real, named file. The precedent that earned this rule: a delete helper once
silently PERMANENT-deleted three items that were over the recycle bin's quota, while reporting
success. Every screen said "Deleted". Nothing said "gone forever".

So: a toast saying "Deleted" is not evidence anything was deleted.

- **Files:** list the directory. Confirm the file moved, was created, or is gone.
- **Database:** `SELECT` the rows. Confirm the count and the values changed as intended.
  (`database-write-safety` covers the before-and-after count discipline.)
- **A job:** read its output, not its status field.
- **An external system:** ask it. Read the record back through its API or dashboard.

If the UI and the disk disagree, the disk is right and you have a second bug.

### 5. TRY THE EDGE CASE THAT BREAKS IT

At minimum, the ones real apps hit constantly:

- **A moved or renamed thing.** People reorganize files by hand, outside the app. Anything
  resolving a path or a reference must go through the app's "resolve moved" logic and degrade
  gracefully when the thing is not where the record says.
- **Empty.** No rows, no files, a fresh dataset, a brand-new account.
- **Big.** Behaviour that is fine at 50 items can hang the server at 57,000 (a real case: a
  folder of about 57k audio files turned a harmless per-item lookup into a 52 second request; see
  `latency-and-efficiency`). Test on the largest real dataset you have.
- **Non-ASCII names.** Other scripts, right-to-left text, accents, emoji, spaces. For many
  corpora these are normal, not exotic.
- **The second time.** Run it twice. Retry it. Does it double-write?

### 6. REPORT WHAT YOU VERIFIED, AND WHAT YOU DID NOT

State plainly:

- What you ran, and what you observed. Paste the real output.
- What you did **not** check, and why.
- Whether anything is mock, stubbed, or assumed.

"Should work" is not a result. This is a result: "I restarted the server, called the status
endpoint with a moved source file, and the JSON now returns the resolved path. I did not test the
non-ASCII case."

---

## THE HONESTY RULES

**Never say "done", "fixed", or "working" about something you did not observe working.** If you
inferred it from the code, say you inferred it. The words are a claim about reality, and using
them loosely means the owner cannot trust them when they matter.

**Never report a test as passed when it errored, was skipped, or you did not run it.** If tests
fail, say so and paste the output. A skipped step gets said out loud.

**Distinguish these three, always:**

| Phrase | Means |
|---|---|
| "I verified" | I ran it and observed the result |
| "I believe" | The code says so; I did not run it |
| "I did not check" | Untested, flagged so the owner can decide |

**When a fix does not work, say so immediately.** Do not quietly try a third approach and report
only the outcome. The failed attempts are information, often the most useful information, because
they narrow the cause.

**Uncertainty is a finding, not a weakness.** "This resolves the symptom but I do not understand
why it was failing" is far more valuable than false confidence, because it tells the owner the
root cause is still out there.

**A green typecheck, lint, or build says nothing about behavior.** Gates passing is the floor.

---

## WHEN YOU CANNOT VERIFY

Sometimes you genuinely cannot: the hardware is not available, a paid resource is not rented, the
owner has to supply a file, the step needs a native dialog or a login only the owner has.

Do not silently skip it and report success. Say exactly what is unverified and what would verify
it:

> "I changed the job-submit path but could not test it, because no worker is running. To verify:
> start a worker, paste its URL into settings, and submit one item. Expect a job id back and one
> new row in the jobs table."

That hands the owner a runnable check instead of a claim.

---

## RECORD THE FIX

If the repo keeps a fix log (a durable "problem, cause, fix" file), a verified fix goes in it so
it cannot regress silently and the next agent does not rediscover it. A solved problem becomes a
guardrail. If the repo has no such log, say so; do not invent one unasked.

---

## THE CHECKLIST

Before you say it is done:

- [ ] Did I restart whatever needed restarting, and confirm I am talking to the new process?
- [ ] Did I confirm the real local URL instead of assuming a port?
- [ ] Did I exercise the exact code path I changed, not a neighbouring one?
- [ ] Did I check real state (files on disk, rows in the database, the external system's own
      record) instead of a UI message?
- [ ] Did I try a moved item, an empty case, a large case, a non-ASCII name, a second run?
- [ ] Did I paste real output instead of describing it from memory?
- [ ] Did I say clearly what I did NOT verify?
- [ ] Is anything mock or stubbed, and did I say so?
- [ ] If it is a solved problem and the repo has a fix log, did it go in?

---

## Related

- `build-with-the-user-in-mind`: review mode, the product-level version of this check.
- `review-build`: the full post-build gate.
- `database-write-safety`: verifying database writes specifically, with counts before and after.
- `latency-and-efficiency`: measuring warm, on realistic data, and diffing output before and after.
- `browser-verification`: the browser tooling.
- `report-verification`: the standard for any report, dashboard or export.
