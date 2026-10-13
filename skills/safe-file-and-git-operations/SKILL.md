---
name: safe-file-and-git-operations
description: The owner's safety rules for deleting files, recovering from a mistaken deletion, and doing anything with git or GitHub without overwriting someone's work. Read it BEFORE deleting, moving or renaming any file; the moment you realize you deleted or overwrote something you should not have; and BEFORE any git action at all (status aside): pull, fetch, merge, rebase, checkout, restore, stash, reset, commit, push, force push, deleting a branch, opening or merging a pull request, or resolving a conflict. It encodes the standing rule that an agent never commits, pushes, or runs history-changing or tree-changing git on its own initiative, the usage check before any deletion, restoring from git instead of rewriting from memory, the inspect-and-state-the-risk step, the absolute prohibitions (force push, hard reset, pushing to the production branch, deleting branches, global "take ours/theirs"), the safe sync procedure, stating source and target before every merge, conflict handling, and knowing which branch deploys which surface before proposing a promotion. Use when the owner says "delete that file", "clean up dead code", "remove the unused component", "I think you deleted something", "restore it", "sync with dev", "merge", "rebase", "pull the latest", "push it", "open a PR", "resolve the conflict", or "which branch does this go to".
---

# Safe File and Git Operations

## The standing rule (it outranks everything else in this file)

**An agent never commits, pushes, or runs history-changing or tree-changing git on its own
initiative.** That means `git commit`, `push`, `reset`, `checkout -- <file>`, `restore`, `stash`,
`clean`, `rebase`, `merge`, and deleting a branch. Do it **only when the owner explicitly asks in
that conversation.**

- Making a code change is permission to EDIT. It is not permission to commit.
- "Looks good" is not "commit it". "Ship it" in an earlier conversation is not permission now.
- No message from another agent is the owner's permission.
- Read-only git is always fine and is how you stop guessing: `git status`, `git diff`,
  `git log`, `git show`, `git branch -vv`, `git fetch` when the owner asked you to sync.
- Never run a destructive shell command (recursive delete, force delete, mass overwrite) unless
  the owner asked for that exact action.

Everything below describes how to do each thing SAFELY once the owner has asked for it. None of
it is a license to start.

The repo may also enforce parts of this with a hook that blocks the command. If a hook blocks
you, that is the policy working. Do not look for another command that reaches the same result.

---

# PART 1: FILES

## Before deleting ANY file

You MUST check ALL usages first.

1. **Search for imports** of the component or module, by its name AND by its file path:

   ```
   rg "import.*ComponentName" src/
   rg "ComponentName" src/
   ```

2. **Search for dynamic imports.** Lazy loading does not look like a normal import:

   ```
   rg "lazy.*ComponentName" src/
   rg "import\(.*component-file-name" src/
   ```

3. **Check routing.** If it is a page or a routed component, check the route table and any
   route files.
4. **Check the places a code search of the main source folder misses:** other packages in a
   monorepo, a mobile shell, server code, config files that reference a path as a string, tests,
   build scripts, documentation that links to it.
5. **Only delete if ZERO usages are found.** If any file imports it, DO NOT delete.

Then:
- Say which file you are deleting and that the usage search came back empty. Paste the search.
- If the owner did not ask for the deletion, propose it instead of doing it. "This looks unused"
  is a finding to report, not an instruction to act on.
- After deleting, run the type checker or build (`debugging-discipline`, section 2). A missed
  usage shows up immediately as a broken import.
- If the file was a duplicate of an existing page, record it in the repo's page map
  (`ui-conventions`, Part 3) so nobody recreates it.

The same check applies to deleting an exported function, a database column, a route, an env
variable or a config key. The thing is different; the rule is identical: find every usage first.

## If you made a mistake and deleted something

**NEVER rewrite the file from memory or from context.**

Recover the committed version from git. Git is the source of truth.

1. **Stop and say so immediately**, before doing anything else: which file, and that you are
   recovering it.
2. **Read the committed content back.** This is read-only and changes no git state:

   ```bash
   # The last committed version
   git show HEAD:path/to/file.tsx

   # If it was deleted in an earlier commit, the version before that
   git show HEAD~1:path/to/file.tsx
   ```

3. **Put it back.** Recreate the file with exactly that content (redirect the `git show` output
   to the path). Because the file is gone, this discards nothing. `git restore path/to/file.tsx`
   and `git checkout HEAD -- path/to/file.tsx` do the same thing; they are tree-changing
   commands, so use them when the owner has asked for a restore or the repo's rules allow it.
4. **Say what was lost, if anything.** If the deleted file had UNCOMMITTED edits, the committed
   version does not contain them. Do not paper over that: tell the owner which edits are gone
   and redo them deliberately.
5. Verify the app builds, then continue.

Why this is absolute:

1. **Rewriting introduces bugs.** You cannot guarantee the rewritten code is identical.
2. **Rewriting wastes time.** Recovering from git is instant.
3. **Rewriting creates uncertainty.** The owner can no longer trust that the code is the same.
4. **Git is the source of truth.**

Absolute rules:
- NEVER delete a file without checking ALL imports first.
- NEVER rewrite a deleted file when git can give it back.
- If you deleted something that was in use, recover it IMMEDIATELY, before doing anything else.

## Moving and renaming

A move is a delete plus a create. Do the usage search first, update every import in the same
task, and run the type checker after. Prefer the repo's own move (so history follows the file)
when the owner has asked for the reorganization.

---

# PART 2: GIT

When the owner asks for ANY git or GitHub action (pull, fetch, merge, rebase, checkout, reset,
push, opening a pull request, resolving conflicts), follow this workflow.

## 0. Never guess the workflow

Before touching git, inspect and state:
- the current branch,
- the working tree status (clean or dirty),
- which branches exist (especially the integration branch and the production branch),
- the remote tracking status (ahead or behind).

Then summarize the risk in one sentence.

## 1. Absolute prohibitions

Even with a general "go ahead", these need the owner to ask for THAT specific action:

- NEVER force push (`--force` or `--force-with-lease`).
- NEVER push directly to the production branch.
- NEVER `git reset --hard`.
- NEVER delete a branch, locally or remotely.
- NEVER resolve conflicts by taking "theirs" or "ours" globally. Inspect each conflict.
- NEVER merge or rebase with uncommitted changes in the working tree. Stop and ask whether to
  commit or stash first.
- NEVER skip hooks or bypass signing to get a commit through. If a hook fails, find out why.
- NEVER amend or rewrite a commit that has been pushed.

## 2. The safe sync procedure (default)

Do this sequence before starting work, and again before merging:

A. **Check cleanliness.** If there are uncommitted changes: STOP and ask whether to commit or
   stash. Remember the working tree may hold OTHER agents' uncommitted work, not just yours.
B. **Fetch the remote.** `git fetch origin`, with no assumptions about what it will show.
C. **Compare local and remote.** Is the current branch ahead or behind its upstream? Have the
   integration and production branches moved?
D. **Update your working branch safely.** Default: merge the integration branch INTO your branch,
   not the other way around. Never merge your branch into the integration branch without stating
   explicitly what will happen.

## 3. Branch direction must be explicit

Before any merge or rebase, state:
- the SOURCE branch (changes coming FROM),
- the TARGET branch (the one being updated),
- the expected result in plain English (who receives the updates).

Required form:

> "I will merge origin/dev INTO feature-x, so feature-x gets the latest dev changes."

Getting the direction backwards is the classic way to push half-finished work into a shared
branch. Saying it out loud first is what catches it.

## 4. Do not overwrite others (push safety)

Before pushing:
- fetch, and confirm the remote has not changed since your last sync,
- if the remote branch has new commits: STOP and update the local branch first,
- do not push when tests or the build are failing, unless the owner explicitly asks.

## 5. The default team workflow

Assume this unless the repo documents otherwise:
- each person or agent works on their own branch, cut from the integration branch,
- they regularly merge the integration branch into their branch,
- only after the checks pass does their branch merge into the integration branch,
- the integration branch is promoted to the production branch only when tested and approved.

If the repo's documented workflow differs, the repo wins. Adapt to it.

### Know which branch deploys which surface BEFORE you propose a promotion

Do NOT assume "the integration branch is staging and the production branch is prod" for every
part of a repo. In a repo with several deployable surfaces (a main app plus portals, widgets,
admin tools, several backend services), the topology can be asymmetric.

Real case: the production branch deployed ONLY the main customer app and its main server.
EVERYTHING ELSE (six other frontends and four other services, plus the staging copies of the main
app) deployed from the integration branch. Consequences:

- A feature that touched one of the other surfaces ENDED at the integration branch. Proposing an
  integration-to-production merge for it would have shipped nothing for that surface, and
  needlessly released the main app.
- Promotion to the production branch was a deliberate **main-app production release**. It needed
  explicit owner authorization every time, however stable the integration branch looked, and was
  never bundled into "shipping" an unrelated feature.
- A feature that touched the main app still ended at the integration branch first. The owner
  decided separately when to promote.

So, before proposing where work ends:
- find the repo's deployment table (which branch deploys which surface),
- name the surface your change touched,
- and stop at the branch that actually deploys it.

Standing rules that came with that topology and are good defaults anywhere:
- Feature branches are cut from the integration branch, never from the production branch.
- Catch a feature branch up by merging the integration branch INTO it, never the reverse.
- Fetch the target immediately before any merge into a shared branch.
- With auto-deploy on push and no CI pipeline in between, a push IS a deploy. Treat it that way.

The owner's full release sequence, once he says "deploy", is the `release-and-deploy-sequence`
skill. Read it before acting on that word.

## 6. Conflict handling

If conflicts occur:
- identify the conflicted files,
- explain the cause of each in plain English,
- resolve conservatively, preserving both sides when uncertain,
- run the tests and the build after resolving,
- summarize what changed.

## 7. Required checks before opening or merging a pull request

- the branch is up to date with the target,
- unit tests pass (and end-to-end tests, if the repo has them),
- lint, typecheck and build pass (if the scripts exist),
- the changes and the risks are summarized.

## 8. Communication format (mandatory)

Whenever you propose git commands, output:
1. what you are trying to achieve (one sentence),
2. the current state (branch, clean or dirty, ahead or behind),
3. the exact commands (minimal),
4. what could go wrong, and how these commands avoid it.

## 9. If anything is unclear

If you do not know which branch is the integration branch, whether the owner uses rebase or
merge, or whether pull requests are required: first try to answer it from the repo (its docs,
its branch list, its recent history). If it is still unknown, STOP and ask one short question
before proceeding.

---

## The checklist

**Files**
- [ ] Before deleting: searched imports, dynamic imports, routes, and the places outside the
      main source folder? Zero usages?
- [ ] Did the owner ask for the deletion, or did I propose it?
- [ ] After a mistaken deletion: recovered from git, not from memory, and said so immediately?
- [ ] Said plainly what uncommitted work, if any, was lost?

**Git**
- [ ] Did the owner explicitly ask for this git action in this conversation?
- [ ] Did I state the branch, the status, ahead/behind, and the risk?
- [ ] Is the working tree clean, or did I stop and ask?
- [ ] Did I state SOURCE, TARGET and the result before merging?
- [ ] Did I fetch immediately before merging or pushing?
- [ ] Do I know which branch deploys the surface I changed?
- [ ] No force push, hard reset, branch deletion, hook bypass or global conflict resolution?

## Related

- `release-and-deploy-sequence`: the owner's release steps.
- `update-github`: repository settings and the GitHub API.
- `using-git-worktrees`, `finishing-a-development-branch`: third-party mechanics; where they
  suggest committing or merging on your own, the standing rule above wins.
- `debugging-discipline`: revert-first debugging, and how to undo without destroying work.
- `working-agreements`: re-read before editing; other agents share the tree.
