---
name: debugging-discipline
description: The owner's rules for finding and preventing breakage fast. Read it the moment something that worked stops working (a white screen, a crash, a broken page, a failing build), BEFORE you add a single console.log; after any large edit (50+ lines in a file, 3+ files, a refactor, or moving code between files); before adding ANY import from an external package; and before adding a catch block or a multi-step call to an external service. It encodes revert-first debugging (when it just broke, undo the recent change and bisect, which takes minutes, instead of instrumenting, which takes an hour), the mandatory syntax, type and lint check after large changes, verifying a package is installed before importing it, never swallowing an error, and the build-time habits that prevent whole classes of bugs (idempotent staged calls, structured failure responses, refs for values passed between async stages). Use when the owner says "it's white", "the page is blank", "it broke after your changes", "it was working before", "it crashes", "import error", "module not found", "the build fails", "the dev server is stuck", or "why did this fail".
---

# Debugging Discipline

The toolkit also ships a third-party `systematic-debugging` skill (root cause before fixes) and
the owner's `error-alert-system` skill (its Iron Law: fix the cause, not the symptom). This skill
is the owner's own short list of the moves that actually save hours. They are compatible; when
something just broke, start HERE.

---

## 1. DEBUG BY REVERTING FIRST

When something breaks after recent changes, **reverting is faster and more reliable than adding
logs.**

### The case that earned this rule

A products page loaded briefly, then crashed to a white screen.
- The terminal showed no errors (a runtime error, not a syntax error).
- There was no access to the browser console.
- The obvious move was to add logs everywhere, which could have taken hours.

Instead, every products-related change was undone in about 2 minutes: the pagination state, the
pagination logic, the list's data source (put back to the original), the wrapper components, the
action bar, the handler function.

**Result:** the page worked immediately. The changes were then re-added one at a time to find the
one that broke it.

### When this rule applies

ALL of these are true:
- It was working before.
- Recent changes were made (by you or another agent).
- The code now misbehaves (a white screen, errors, broken functionality).

### The revert-first workflow

**Step 1: identify the scope.** Before touching anything, look (these are read-only):

```
git status                  which files are modified
git diff --stat HEAD        how big each change is
```

Identify which modified files plausibly relate to the broken feature.

**Step 2: back up, then revert the most likely culprit.**

1. Pick the file most likely responsible. It is usually the one with the most changes to the
   affected feature.
2. **Save the change first**, so nothing is lost:
   `git diff -- <file> > <scratch-dir>/backup_<file>.diff` (a read plus a file write; put it in
   a scratch directory, not in the project).
3. Undo the change.
4. Test, or ask the owner to test.

> **How to undo, given the owner's git rule.** An agent never runs tree-changing git
> (`git restore`, `git checkout -- <file>`, `git stash`, `git reset`) on its own initiative.
> So:
> - **If the change is yours, from this session,** undo it with the edit tool: put the lines
>   back, using the backup diff as the exact record of what to reverse. That is an edit, and it
>   is always allowed. `git show HEAD:<path>` (read-only) prints the committed version to
>   compare against.
> - **If you want the whole file reset to its committed state,** that discards uncommitted
>   work, so it is the owner's call. Say which file, say the backup diff exists, and ask. Run
>   `git restore <file>` only when he says to.
> - **If the uncommitted changes might be someone else's** (another agent, the owner), STOP and
>   ask before undoing anything. Offer the backup diff as the safety net.
> - Do not reach the same result by a side door (overwriting the file from `git show`, deleting
>   and recreating it). The rule is about not destroying uncommitted work, not about which
>   command does it.

**Step 3: bisect if needed.** If undoing one file does not fix it, undo additional files ONE at
a time, testing after each. Stop when the problem disappears. Do not batch.

**Step 4: identify the problematic change.** The backup diff shows exactly what changed in the
guilty file. Read it to find the specific cause. It is often a structural change (a wrapper, a
moved hook, a changed data source), not a logic error.

**Step 5: reapply the safe parts.** Reapply the changes that were NOT the problem, one at a
time, testing between each. Fix or rewrite only the problematic part.

### Why revert-first beats logs-first

| Revert first | Logs first |
|---|---|
| About 1 to 5 minutes to find the problem | 30+ minutes adding logs everywhere |
| No code pollution | Logs scattered through the codebase |
| Uses the recorded diff (reliable) | Relies on guessing where to log |
| Finds WHAT broke | You still have to work out WHAT broke |
| Clean codebase after | Every log must be cleaned up after |

### When to fall back to instrumentation

Only when:
- the bug existed BEFORE any recent changes,
- you do not know whether it ever worked,
- the problem is intermittent or timing-related,
- or the history does not help (too many unrelated changes).

When you do instrument: add the logs, run, read, then REMOVE every one of them before you call
the work done.

### Critical rules

1. **Never jump straight to adding logs** when something just broke.
2. **Always look at what changed first.**
3. **Always save a backup** before undoing, so no work is lost.
4. **Test after EACH undo.** Do not batch several files.
5. **Ask before undoing** anything the owner or another agent might want to keep.
6. **One change at a time** when reapplying, with a test between each.

### Worked example

```
Owner: "The booking page is white after your changes"

1. It was working before, so revert-first applies.
2. Look at what changed: one dashboard file has 488 lines changed.
3. Save the backup diff of that file to the scratch directory.
4. Put the file back: reverse my own edits, or ask the owner for a `git restore` of that file.
5. Ask the owner to test.
6. Fixed, so the bug was in my changes to that file.
7. Read the backup diff to find the specific cause.
8. Reapply the changes one at a time, testing after each.
```

---

## 2. CHECK FOR SYNTAX, TYPE AND IMPORT ERRORS AFTER LARGE CHANGES

### When this applies

- You edited 50 or more lines in a single file.
- You edited 3 or more files in one task.
- You refactored or restructured code.
- You moved code between files.

### Required checks

1. **Read the dev server's terminal output**, if one is running. Look for compilation errors,
   syntax errors, import errors. A bundler prints them in red and keeps serving the last good
   build, so the page can look fine while your change is not even loaded.
2. **Run the linter and type checker on the modified files** (the editor's diagnostics tool, or
   the repo's lint and typecheck scripts).
3. **If errors are found, fix them BEFORE moving on**, then re-verify.

### Why

- Large changes have a higher chance of typos, missing brackets and broken imports.
- Hot reload can get STUCK when several broken changes pile up. After that, nothing you edit
  appears, and you start debugging the wrong thing.
- Catching an error immediately is faster than debugging it later, three changes deep.

### What NOT to do

- Do not skip verification because "it looks right."
- Do not leave syntax errors for "later."
- Do not make more changes on top of broken code.

A clean check here is the floor, not proof the feature works. That is `verify-before-done`.

---

## 3. VERIFY A PACKAGE IS INSTALLED BEFORE YOU IMPORT IT

When adding ANY import from an external package (not a local file):

1. **Identify the package name** (for a scoped package, the full `@scope/name`).
2. **Search the manifest** (`package.json`, `requirements.txt`, `pyproject.toml`, and so on).
3. **If it is NOT there, install it FIRST**, with the package manager the repo enforces, then
   write the import.
4. **If it is there**, the import is safe.

```typescript
// EXTERNAL: must be verified in the manifest
import * as VisuallyHidden from "@radix-ui/react-visually-hidden"
import { motion } from "framer-motion"
import dayjs from "dayjs"

// LOCAL: no verification needed
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useAuth } from "../hooks/useAuth"
```

Absolute rules:
- Never add an import for a package without verifying it is installed.
- **Never assume a package exists because similar packages do.** Having four packages from one
  UI family installed does not mean the fifth is. This exact assumption is the usual cause.
- Install before importing, not after.
- If you forgot and caused an import error, install the package immediately.
- Use the repo's package manager. Many repos enforce one and reject the others.
- In a monorepo, check the manifest of the package you are editing, not the root.
- Before adding a NEW dependency at all, check whether the repo already has one that does the job
  (see `working-agreements`, reuse before writing). A new dependency is a decision, not a reflex.

---

## 4. NEVER SWALLOW AN ERROR

Any new try/catch, API call or webhook call that can fail must REPORT the failure through the
repo's error reporter, with identifying context (ids and a source label, never personal data or
payloads).

- **If you catch it, report it.** A catch that only logs to the console and returns a fallback
  is a silent production bug: the app keeps running and nobody learns it broke.
- Global handlers (unhandled errors, unhandled rejections, the data library's global error hook)
  usually exist already. You only need to add reporting for **explicit** try/catch blocks in new
  code.
- A catch that is genuinely benign must say so, in a comment, as a conscious decision.

The design of the reporter, and when NOT to alert (by-design outcomes), is the
`error-alert-system` skill.

---

## 5. KNOWN FIRST CHECKS (do these before theorizing)

Symptoms with a known first move. Each cost real time once.

| Symptom | Check first |
|---|---|
| **A white screen right after a change** | Revert-first (section 1). |
| **Nothing I edit shows up** | Hot reload stuck on a syntax error (section 2), or a server that needs a restart, or an old process holding the port (see `verify-before-done`). |
| **Module not found / cannot resolve import** | Is the package in the manifest (section 3)? |
| **403 / permission denied on a table** | Table GRANTS first, policies second. A missing grant means the policies are never evaluated. About 90% of mysterious 403s on a new table are missing grants. Compare with a table that works. (Full order in `security-rls-permissions`.) |
| **403 from a backend API** | Is that server running, and is the tenant or auth header set? |
| **Data is missing or blank** | Access policy and tenant id matching; then a column the query never selected, hidden by loose typing. |
| **A money value is 100 times too big or too small** | Double conversion between cents and dollars (see `database-write-safety`). |
| **"It only breaks in the production build"** | A real bug until proven otherwise. A production build that white-screens locally was once a circular import created by chunk splitting. "Works on the dev server" does not count. |
| **The whole server hangs, CPU near zero** | A synchronous call in a loop blocking the event loop (see `latency-and-efficiency`). |
| **It works for me (the owner) but not for a staff user** | You tested as a privileged role. Test as the real, unprivileged user. |

---

## 6. BUILD-TIME HABITS THAT PREVENT THE BUG

Lessons from a multi-stage submission to an external provider (create an account, then a
profile, then a compliance bundle, then a registration, each stage depending on the id returned
by the last). They generalize to any multi-step call chain.

- **Make every stage idempotent.** The caller passes the ids of anything already created
  (`existing_<thing>_id`), and the stage skips creation when the resource exists. A retry after a
  failure at stage 3 must not create a second account at stage 1.
- **Persist per-stage status and per-stage errors**, not one overall flag. "Stage 2 rejected,
  with these reasons" is recoverable. "Failed" is not.
- **Let structured failures through.** If a response validator throws on any non-success, the
  detailed provider errors are lost and the user sees "something went wrong". Give the validator
  an explicit option to return the failure body, and use it where the failure carries
  field-level detail.
- **Show provider errors grouped by section, with the friendly field name**, so the user can
  fix the right field instead of reading an error code.
- **Use a ref, not state, for a value produced by one async stage and consumed by the next** in
  the same run. State read inside a long-running async function is a stale closure: stage 2 sees
  the id as it was when the function started, which is empty.
- **Take pushed status events over polling** when the provider offers them (event streams, a
  sink webhook). The provider pushes, a handler looks up the record by the provider's id and
  writes the new status, the UI reads it live. No polling loop and no extra API calls.
- **Test buttons per stage** are worth building during development, so each stage can be run on
  its own. Remove debug logging before you ship.

---

## THE CHECKLIST

- [ ] It just broke: did I look at what changed and undo it, before adding any logs?
- [ ] Did I save a backup diff before undoing, and ask before touching anyone else's changes?
- [ ] Did I undo and reapply ONE change at a time, testing between each?
- [ ] After a large change: did I read the dev server output and run the linter and type checker
      on what I touched, and fix everything before continuing?
- [ ] For every new external import: is the package in the right manifest?
- [ ] Does every new catch report the failure, or carry a comment saying why it is benign?
- [ ] Did I remove every temporary log?
- [ ] Did I fix the CAUSE, or did I only make the symptom stop?

## Related

- `systematic-debugging`: the general root-cause method.
- `error-alert-system`: the Iron Law and the reporting pattern.
- `safe-file-and-git-operations`: what an agent may and may not do with git.
- `verify-before-done`: proving the fix.
- `working-agreements`: re-read before editing; interconnected changes.
