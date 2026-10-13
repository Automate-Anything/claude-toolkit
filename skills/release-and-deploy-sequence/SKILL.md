---
name: release-and-deploy-sequence
description: The owner's release sequence for shipping to production - commit everything, push the branch, pull the staging branch in, run the deploy-equivalent verification gates, merge to the staging branch, then promote to the production branch. Read it when the owner says "deploy", "deploy everything", "push everything to main", "release to production", "commit and push everything", "ship it to prod", or hands you the commit -> dev -> main sequence. It encodes the HARD RULE that a deploy ships ALL uncommitted changes in the working tree (every session's, every agent's), not just your own, plus the exact ordered steps, the verification gates (cold typecheck, regenerated database types), the hook-confirmation mechanics, and the gotchas seen live. This skill describes HOW to deploy, never permission to: run it only when the owner explicitly asked for a deploy in this conversation. A promotion to the production branch is always an owner-authorized release event.
---

# Release and deploy sequence

> ## Adapt before use
> This describes how the release sequence SHOULD be wired, taken from a production
> system with a staging branch (`dev`), a production branch (`main`), hosts that
> auto-deploy on push (Render, Cloudflare Pages), and a Supabase database with
> generated types. Branch names, script names and package names below are EXAMPLES
> of the shape. Grep the repo for the real ones, and once this repo's sequence is
> settled, update this file with the real commands. When this doc and the repo
> disagree, the repo wins.

> ## AUTHORIZATION FIRST
> Every step below (committing, pushing, merging to the staging branch, promoting
> to production) requires the owner's explicit instruction IN THIS conversation.
> "Deploy everything" or the numbered sequence below IS that instruction. Never run
> this on your own judgment that the work is "done". Making a code change is
> permission to edit, not to commit.

---

## 1. The rule this skill exists for: you deploy EVERYTHING, not just your own work

Multiple sessions and agents usually share ONE working tree. When the owner says
deploy, **every uncommitted change on disk ships**: files you edited, files other
agents edited, files you have never seen. The owner's words: "It doesn't matter if
it's from you or from anyone else. Everything, everything, everything should be
committed and pushed."

- `git add -A`. Never a hand-picked file list.
- Do NOT skip "someone else's" files, scratch files, or files you think are junk.
  If a sensitive-files guard blocks a specific path, exclude ONLY that path and
  tell the owner which one.
- The commit message describes your own work in detail and notes that pending
  work from parallel sessions is included.

**This is the opposite of the everyday rule, on purpose.** Outside an
owner-ordered deploy (a patrol fix, a lane commit the owner asked for), you stage
exact pathspecs and never sweep other agents' in-flight files. The "everything"
rule applies only when the owner ordered a full deploy. Know which mode you are
in before you stage anything.

---

## 2. The sequence (exact order, the owner dictated it)

```
1. Commit ALL uncommitted files (everything, from every session)
2. Push to origin (the current feature branch)
3. Pull the staging branch in (fetch + merge origin/dev INTO the branch)
4. COLD typecheck every compiled package the release touches
5. Regenerate the database types + full warm typecheck; commit + push the types
6. Push to staging  (fetch origin dev, checkout dev, merge the branch, push)
7. Continue to production (fetch origin main, checkout main, merge dev, push)
```

Then return to the feature branch and sync it (`git checkout <branch>` then
`git merge dev`) so the tree is left where other agents expect it, with zero
uncommitted files.

---

## 3. Step by step, with the mechanics that actually matter

1. **Pre-flight.** `git status --porcelain` (see everything). Run the
   conflict-marker scan if the repo has one (a pre-commit hook should enforce it
   too). Note the current branch.
2. **Commit everything.** `git add -A` then `git commit -m "..."`. If the repo
   has a commit guard hook that demands an explicit confirmation flag, add it
   ONLY because the owner told you to commit in this conversation (section 4).
   If a pre-commit check fails (for example a database-function linter that runs
   on staged migrations), FIX the cause. Never bypass.
3. **Push the branch.** `git push origin <branch>`.
4. **Pull staging in.** `git fetch origin dev` IMMEDIATELY before, then
   `git merge origin/dev --no-edit`. Resolve any conflict by SYNTHESIS (both
   sides are real work), never by taking one side wholesale. Re-run the
   typecheck after a conflicted merge.
5. **Cold typecheck** (deploy-equivalent: a clean build from nothing, which
   catches compile-order and missing-build-output errors that a warm incremental
   run hides). Run it for EVERY compiled package with changes in the release.
   Decide which by what the release's diff touches
   (`git diff --name-only origin/dev...HEAD` after the merge, or the status you
   captured in step 1). A package that deploys through a bundler with no
   separate compile step (a Vite SPA, for example) only needs the warm typecheck.
6. **Regenerate types and run the final gates.** Regenerate the database types
   from the LIVE schema, then run the full typecheck(s). If the generated types
   file changed, commit and push again.
7. **Merge to staging.** `git fetch origin dev` (fresh, immediately before),
   `git checkout dev` (verify `git status --short` is EMPTY first: a clean tree
   is what makes the branch switch safe for every other agent),
   `git merge origin/dev --ff-only` (sync), `git merge <branch> --no-edit`,
   `git push origin dev`. This deploys staging and every surface that deploys
   from the staging branch.
8. **Promote to production.** `git fetch origin main`, `git checkout main`,
   `git merge origin/main --ff-only`, `git merge dev --no-edit`,
   `git push origin main`. This is the production release. If a pre-push hook
   re-runs the cold checks on production pushes, it passes because you already
   ran them.
9. **Return and leave it clean.** `git checkout <branch>`,
   `git merge dev --no-edit`, confirm `git status --short` is empty and that the
   repo's hooks path is still configured (`git config core.hooksPath`).

---

## 4. Hook confirmation flags (what they are, when they are legitimate)

A well-guarded repo makes the agent affirm that the owner authorized a dangerous
git action, typically by appending a shell-comment flag to the command. The flag
changes nothing about the command; it is an affirmation the hook looks for.

| Example flag | Gate | Legitimate ONLY when |
|---|---|---|
| `#commit-approved` | `git commit` | the owner said to commit in this conversation (this sequence counts) |
| `#git-confirmed` | `checkout` and other tree-changing git | the tree is CLEAN (verify `git status --short` prints 0 lines) and the owner's deploy instruction requires the branch switch |

**Never use a flag to get past a FAILING check** (conflict markers, a database
function linter, the cold typecheck). Flags affirm authorization. They do not
waive verification.

If the repo has no such hooks, the same discipline applies by hand: you only run
these commands because the owner asked, and you only switch branches on a clean
tree.

---

## 5. Branch topology (why staging first, then production)

The two branches often deploy DIFFERENT subsets of the codebase. It is not
always "dev = staging copy of everything, main = prod copy of everything". A real
example of the asymmetric shape:

- The staging branch deploys EVERYTHING except the main app's production: the
  staging main app and staging API server, and it is the ONLY deploy for the
  secondary portals and their servers.
- The production branch deploys ONLY the production main app and the production
  API server.

Consequences:

- A staging-to-production merge is a production release event: owner-authorized,
  every time, never bundled implicitly with a staging push.
- A change to a surface that only deploys from the staging branch does NOT imply
  a production merge. Land it on staging and stop.
- Feature branches are cut from the staging branch, never from production. Catch
  a branch up by merging staging INTO it, never the reverse.

Document the real per-service table in the repo (see the
`infrastructure-overview-template` skill) and point to it from here.

---

## 6. Gotchas (each observed live)

- **"Already up to date" on the staging pull is normal** when other sessions
  merged earlier. The fetch must still be the immediately preceding command
  before ANY merge.
- **A stale `git fetch` is not fresh.** If anything ran between your fetch and
  the merge, fetch again.
- **GitHub may print "Changes must be made through a pull request" on the
  production push and still accept it** (advisory-mode branch protection). Read
  the actual result. If the push is really REJECTED, stop and tell the owner. Do
  not try to bypass protection.
- **Branch switches swap files on disk.** Harness "file changed on disk" notices
  after a checkout are expected, not someone reverting your work.
- **Database checks need the live database.** If a function linter runs inside
  the typecheck and the pre-commit hook whenever migrations changed, it needs
  the live DB reachable, and the migrations must already be APPLIED to the live
  DB before the release typechecks. Follow the repo's database workflow (pull
  the live schema and verify the SQL against it before any write).
- **A code deploy and its migration can disagree for a few minutes.** If the
  schema change lands after the code, put up the maintenance banner for the
  window (see the `maintenance-banner` skill).
- **A green push is not a served release.** Confirm the hosts actually deployed
  and serve the new build (see the `deploy-freshness` skill: version endpoint,
  build id).

---

## 7. Rules

- Deploy only on the owner's explicit instruction in this conversation.
- An owner-ordered deploy ships everything in the tree. `git add -A`.
- Fetch immediately before every merge.
- Resolve conflicts by synthesis, then re-verify.
- Never bypass a failing gate. Fix the cause.
- Promotion to production is its own owner-authorized event.
- Leave the tree on the feature branch, synced, with zero uncommitted files.

## Related

- `maintenance-banner` - cover the window where code and schema disagree.
- `deploy-freshness` - make sure open clients pick up the new deploy.
- `infrastructure-overview-template` - where the per-service deploy table lives.
- `review-build` - the post-build review gate to run BEFORE asking for a deploy.
