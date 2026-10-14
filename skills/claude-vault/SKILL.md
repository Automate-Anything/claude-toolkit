---
name: claude-vault
description: A design and build guide for syncing a whole Claude Code setup across computers through one private, encrypted git repo (a "vault"); chats, settings, hooks, skills, project .env files, the repo list, uncommitted code and the set of open chat tabs all follow the user from machine to machine with no server. Read it when building, extending or fixing such a sync, when moving Claude Code to another machine, when someone wants chats, settings, skills, .env files, unpushed work or open tabs synced between computers or Claude accounts, or says "set up my new laptop", "make both computers the same", "are my chats syncing" or "pause the sync".
---

# Claude Vault: syncing a whole Claude Code setup across computers

This is the concept and the full build guide. A working reference implementation (one
Node.js file plus a small VS Code extension, Windows-first) is in `reference-impl/`, with
placeholders instead of personal values. Exact file formats are in
`references/file-formats.md`; the full command reference and operator recipes are in
`references/commands.md`.

## 1. The problem

One person, several computers, often several Claude accounts. They want to sit at any
machine and find everything exactly as they left it:

- every chat transcript of every project, including the last messages of a chat they were in
  the middle of;
- the same settings, hooks, slash commands, skills, plans, agents and per-project
  permissions and MCP servers;
- every project's `.env` files (git ignores them, so GitHub never carries them);
- every project repo, cloned at the same path;
- code an agent was halfway through writing: uncommitted edits, untracked files, commits
  not yet pushed;
- the same Claude chat tabs open in each VS Code project window.

Chats are not tied to a Claude account: they are plain files under `~/.claude`. So a sync of
files is enough, and logging into a different account on another machine does not matter.

## 2. The mental model (get this right first)

**A private git repo is a passive, encrypted storage box. Each computer is the engine.**

- The repo holds only encrypted data plus the tool's own source. No CI, no workflows, no
  webhooks, no server. It never wakes up; it changes only when a computer pushes.
- Each computer runs the same sync program from its OWN scheduler (Task Scheduler, launchd,
  systemd, cron). That program fetches, merges, and pushes.
- So there is **no switch on GitHub**. Pausing means disabling the scheduler on that one
  machine. Pausing one machine does nothing to another; each machine pauses itself.
- A machine that is off or asleep does nothing and needs nothing.
- Cost: a private repo with ordinary push and pull is free on GitHub's normal plans. The only
  thing a running sync consumes is local CPU, disk, battery and a few MB of upload per change.

Parts of the system:

| Part | Where | Role |
|---|---|---|
| The tool | a git clone of the vault repo (reference: `C:\claude-vault\vault.mjs`) | does everything; updates itself through the vault |
| Machine-local state | `~/.claude-vault/` | passphrase key file, `state.json`, log, lock, WIP exports, tab plans |
| The remote | private repo `<your-github-user>/<your-vault-repo>`, dedicated branch (reference: `vault`) | encrypted chunks + encrypted manifest + plain tool files |
| Scheduler | the OS scheduler on each machine | runs `sync` every 2 minutes and at logon |
| Companion | a tiny VS Code extension, built and installed by the tool | merges chat tabs into an OPEN window live, reports explicit tab closes, shows conflicts |

## 3. What to sync and what never to sync

Roots are named and resolved per machine (reference `vault.config.json`): `home` = the user
profile, `dev` = the projects folder (reference: `C:\dev`, one repo per direct child).

### Under `~/.claude` (sync the whole tree minus the exclusions)

| Path | Holds | Sync? |
|---|---|---|
| `projects/<encoded-cwd>/<sessionId>.jsonl` | every chat transcript, one file per session | YES, the main payload |
| `projects/<encoded-cwd>/memory/` and similar | per-project memory | YES |
| `settings.json` | global settings, hooks config, permissions, `cleanupPeriodDays` | YES |
| `CLAUDE.md`, `keybindings.json` | global instructions, key bindings | YES |
| `commands/`, `agents/`, `skills/`, `plugins/`, `hooks/` (if used) | slash commands, subagents, skills, plugins, hook scripts | YES (minus huge binary skill folders) |
| `plans/`, `todos/` | plan files and task lists | YES |
| `file-history/` | checkpoint / undo snapshots for edits | YES (lets rewind work on the other machine) |
| `uploads/` | files attached to chats | YES |
| `vscode-state/hosts/<host>/` | the vault's own published tab sets | YES (written by the tool) |
| `.credentials.json*` | the login token of THIS machine's Claude account | NEVER: it would log every machine into one account and leak a secret |
| `sessions/`, `session-env/`, `shell-snapshots/`, `ide/` | live-session and IDE-connection state, lock files | NEVER: machine and process specific |
| `cache/`, `debug/`, `downloads/`, `backups/`, `statsig/`, `telemetry/` | caches, logs, telemetry | NEVER: noise, churns every minute |
| `*.lock`, `.last-cleanup`, `.last-update-result.json`, `mcp-needs-auth-cache.json` | locks and per-machine bookkeeping | NEVER |
| a skill folder holding GBs of binaries (example: `skills/gstack/`) or a venv | installable tooling | NEVER: reinstall it per machine |
| any `node_modules`, `.git`, `venv`, `.venv`, `__pycache__`, `dist`, `.next`, `.turbo`, `.tscache` inside the tree | build and dependency output | NEVER |

`<encoded-cwd>` is the project's working directory with every non-alphanumeric character
replaced by `-` (`C:\dev\myapp` becomes `C--dev-myapp`; the drive letter's case can vary, so
check both). **This is why projects must live at the same absolute path on every machine**:
a chat's folder is named after its working directory. A project at a different path on the
other machine silently gets a different, empty chat history.

### Outside `~/.claude`

- **`~/.claude.json`, only its portable slice.** That file mixes portable settings with
  machine state (window positions, caches, account data). Sync only top-level `mcpServers`
  and, per project, `allowedTools`, `mcpServers`, `enabledMcpjsonServers`,
  `disabledMcpjsonServers`, `hasTrustDialogAccepted`, `hasClaudeMdExternalIncludesApproved`,
  `mcpContextUris`. Write the slice canonically (sorted keys, sorted de-duplicated string
  arrays) so identical settings produce identical bytes, and MERGE it back (allowedTools set
  union, MCP servers shallow merge), never overwrite the file.
- **`.env` files of every project**: under the dev root, any file named `.env` or
  `.env.<anything>` except `*.example`, up to 4 levels deep, skipping dependency folders.
- **A generated repo list** (`repos.json`): name and `origin` URL of every git repo in the
  dev root, so a new machine clones them all.
- **WIP snapshots** and **retire tombstones** (sections 9 and 11), which the tool writes into
  `~/.claude-vault/` and then syncs like any other file.

## 4. Encryption

The repo must be safe to lose: a clone without the passphrase is random bytes, file names
included.

- **Key derivation:** `master = scrypt(passphrase, salt, 32 bytes, N = 2^15, r = 8, p = 1)`
  (needs `maxmem` of 128 MiB in Node). The salt is 32 random bytes, stored hex in
  `vault.salt` in the repo (public). Subkeys: `encKey = HMAC-SHA256(master, "enc")`,
  `chunkIdKey = HMAC-SHA256(master, "chunkid")`, `check = HMAC-SHA256(master, "check")`.
- **Wrong-passphrase check:** `vault.check` in the repo holds `hex(check)`. Compare on every
  run; a mismatch stops with "wrong passphrase" and reveals nothing else.
- **Cipher:** AES-256-GCM for everything. Data is gzipped BEFORE encryption (ciphertext does
  not compress).
- **Chunks:** see section 5. The nonce is the first 12 bytes of the chunk id and the AAD is
  the id, so identical content always gives identical ciphertext (dedup) while the
  (key, nonce) pair can never encrypt two different plaintexts.
- **Manifest:** random 12-byte nonce, `nonce || ciphertext || tag`.
- **File names are hidden** because the only place a real path exists is inside the
  encrypted manifest. Chunk files are named by their keyed id, which says nothing about
  content (it is an HMAC, not a plain hash, so nobody can test "is this known file in
  there").
- **The passphrase is never in the repo**, never in a commit, never in a log. Lose it and the
  vault is unrecoverable by design. Keep it in a password manager.

## 5. Storage layout: chunks, manifest, one snapshot

- **Content-addressed chunks.** Each file is cut into 4 MiB pieces. Chunk id =
  `hex(HMAC-SHA256(chunkIdKey, SHA-256(piece)))`. Stored at `chunks/<id[0:2]>/<id>` as
  `AES-256-GCM(gzip(piece, level 6)) || 16-byte tag`. 4 MiB keeps every object far under
  GitHub's 100 MB file limit. A growing chat transcript re-uploads only its last chunk.
  An empty file gets one chunk.
- **Manifest** (`manifest.enc`, gzip level 9 then encrypted): `{version: 1, generatedAt,
  machine, files: { vpath: {mtime, size, chunks: [ids]} }}`. A vpath is
  `<rootName>/<relative/path>`, so the same logical file maps to different real paths per
  machine.
- **Chunk GC:** after building a new manifest, delete chunk files nothing references.
- **One snapshot, not a history.** The branch holds the current state. Each sync commits a
  new snapshot as a **child** of the remote head and pushes with
  `--force-with-lease=<branch>:<sha we fetched>`. A child commit lets git send only the delta
  (a few MB). **Never make the per-sync commit an orphan:** git then knows no shared objects
  and re-sends the whole repository on every push (measured: about 1.4 GB per push).
- **Squash, rarely, from one machine.** History still grows with every changed chunk, so
  once a day a single designated machine (the one that created the vault, marked by a
  `squash-here` flag file) replaces the branch with ONE orphan commit, then runs
  `reflog expire --expire=now --all` and `gc --prune=now`. That push is a full re-upload,
  which is why it is daily, single-machine, and guarded: first push a tiny `squash.lock`
  commit (`{host, at}`); other machines that see a lock younger than 30 minutes pull but do
  not push. Machines without the flag never squash; on other days every machine runs a daily
  local `gc`.
- **Dedicated branch, not `main`.** Keeps a user's "never push to main" hooks and branch
  protections out of the way, and makes it obvious the branch is machine-written. Never merge
  it into anything; never push it by hand.
- **Git settings for encrypted data:** `.gitattributes` marks `chunks/**` and `manifest.enc`
  as `-delta -text -diff`; repo config `core.compression=0` and `gc.auto=0`. Encrypted bytes
  neither compress nor delta, so trying only burns CPU.
- **GitHub limits:** single file over 100 MB is rejected (chunking solves it); single push
  over 2 GB is rejected, so a large FIRST upload is pushed in batches of about 700 MB of new
  chunks, each its own commit.

## 6. The sync algorithm, step by step

`sync` (every 2 minutes):

1. **Adaptive slot skip.** If the previous run took over 60 s and less than that long has
   passed since it ended, skip this slot. Runs under load stretch instead of piling up.
2. **Take the lock** (section 7). Wait up to 20 s; otherwise log "another sync is running"
   and exit.
3. **Fetch** the branch, then `reset --hard FETCH_HEAD`: the working tree of the vault repo
   is derived data and the remote is the truth. Exception: locally edited tool files are
   saved and written back after the reset (an edit to the tool on any machine IS a tool
   update for every machine). If the tool's own file hash changed in the reset, restart the
   process on the new code before doing anything else.
4. **Derive keys, check the passphrase, decrypt the manifest.**
5. **Pull phase** (remote to disk), per file in the remote manifest:
   - *Merged files* (`claude-json-slice.json`, `repos.json`, `retired.json`): take the remote
     copy whenever its chunks differ from what we last synced, then merge (union) and
     regenerate. Never last-writer-wins for these, or two machines ping-pong a one-line
     change forever.
   - *Missing locally:* if we had synced it before, the user deleted it here, so remember it
     as a local delete (unless it is a protected chat path, section 8, which is restored
     instead). Otherwise restore it.
   - *Present locally:* skip when the remote mtime is not newer than local + 1 s; skip when
     the local file was written in the last 60 s (being written right now, local wins this
     round), EXCEPT for another host's own files (`wip/<other-host>/`,
     `vscode-state/hosts/<other-host>/`), which are never written locally and must always be
     taken; skip when nothing changed since the last sync; otherwise restore.
   - Restore = decrypt chunks into `<file>.vault-tmp`, rename over the target, set mtime to
     the manifest mtime.
   - *Remote deletions:* a file in our last-synced state that the remote no longer has, and
     that is unchanged here since then, is deleted locally. Protected paths are never deleted.
6. **Side lanes**, each fully self-contained so a failure never blocks the chat sync:
   clone missing repos (section 10), apply retire tombstones (section 11), WIP import
   (section 9), tab import (section 12), companion install check, ensure the watcher runs,
   re-register scheduled tasks if the scheduler version changed.
7. If another machine's fresh `squash.lock` is present, stop here (pulled only).
8. **Push phase:** export this machine's tab state and WIP, scan all roots, re-chunk only
   files whose size or mtime changed (1 ms tolerance) or whose chunks are missing, build the
   new manifest, GC unreferenced chunks, write `manifest.enc`.
9. If nothing changed, restore the remote's manifest bytes, maybe squash or gc, log
   `in sync (...)` and exit.
10. **Commit and push:** stage ONLY what this run touched (new and removed chunk paths, any
    untracked leftover chunk files, the manifest, salt, check, `.gitattributes`, the lock
    file, tool files) via `git update-index --add --remove -z --stdin`; `write-tree`;
    `commit-tree -p <remote head>`; push with lease. On a lease rejection, merge (section 7).
11. Update `state.files` (the baseline for the next run) and log one line with per-phase
    timings.

`pull` is steps 1 to 6 only. `restore` is `pull` with `full`: everything missing is restored
and no local delete is inferred (used on a fresh machine).

**Conflict model for files:** whole-file, newest mtime wins, with the 60 s "in use" guard.
Rule for the user: **one chat on one machine at a time.** If the same chat is continued on
two machines within the same couple of minutes, one side's last messages lose.

## 7. Concurrency and robustness

- **One lock for every git command against the vault repo**: scheduled syncs, the watcher's
  quick pull, AND the read-only commands (`status`, `list`, `verify`, which also fetch and
  reset). Without it two processes collide on `index.lock: File exists`. The lock file
  holds the PID of the process holding it; it is stale if older than 2 hours or the PID is dead. A fatal exit
  inside the lock removes it. Read-only commands wait up to 90 s.
- **Timeouts on every child process** (default 5 minutes, SIGKILL; the scan gets 4 minutes).
  A hung child must never hold the lock. Seen in practice: `code --install-extension` hung
  for 13 minutes. Anything that can hang and is not needed for the sync (the extension
  installer) runs detached and is verified on a later run by looking in the extensions
  folder, not by calling the CLI again.
- **Lost push race: merge, do not redo.** When the lease is rejected, fetch again, read
  their manifest, and merge: for a file on both sides take the newer mtime; a file missing
  on one side counts as a deletion only if the other side still has the unchanged pre-race
  version, and never for protected chat paths. Build the commit in a temporary index
  (`GIT_INDEX_FILE`): `read-tree <theirs>`, apply our delta relative to the pre-race remote
  (keeping chunk deletions only for chunks the merged manifest no longer references), add
  the new encrypted manifest, `write-tree`, commit with parent `<theirs>`, push with lease
  `<theirs>`. Up to 6 attempts; if all fail, log "nothing lost, will retry next run".
- **Slot alternation.** Two machines on the same 2-minute schedule would race constantly.
  The creator (the `squash-here` machine) starts its task on an even minute, every other
  machine on an odd minute. Persist the scheduler version in state the moment tasks are
  registered so nothing re-registers later and moves the slot.
- **A chunk referenced by a manifest must be committed.** Targeted staging used to stage
  only chunks written in this run; a chunk left on disk by an interrupted run was "present"
  for the manifest but never committed, and the other machine crashed with ENOENT. Fixes:
  stage every untracked file under `chunks/`; when reading a chunk missing on disk, fetch it
  from the fetched commit (`git show FETCH_HEAD:chunks/..`) and repair the tree; if still
  missing, log and skip that file for this run instead of aborting.
- **Fast scanning on Windows.** `fs.stat` opens every file and antivirus scans each open
  (22 s for 31k files on a slow laptop). Enumerate the tree with ONE PowerShell process
  using .NET `DirectoryInfo.EnumerateFiles`, which takes size and mtime from the directory
  listing; fall back to a plain walk. Check chunk existence from one directory listing, not
  tens of thousands of `existsSync` calls.
- **Self-update.** Tool files ride the repo in plain text. After every fetch, compare the
  running file's hash; if it changed, re-exec with the same arguments. The watcher exits on
  its own when the file changes and the next sync restarts it.

## 8. Deletion safety: chats are never deleted through the sync

Anything under `home/.claude/projects/` (chats and per-project memory) is protected:

- a protected file missing locally is **restored**, never propagated as a delete;
- a protected file missing remotely is **re-pushed**, never deleted locally;
- the race merge never drops one.

Why: Claude Code has its own cleanup (`cleanupPeriodDays`, default 30 days). On a fresh
machine it ran before the synced `settings.json` arrived and deleted dozens of old
transcripts locally. Without protection, the next sync would have deleted them on every
machine. Also set `"cleanupPeriodDays"` in `~/.claude/settings.json` very high (for example
`36500`) and never lower it. The trade-off is deliberate: deleting a chat on purpose brings
it back on the next sync. Everything outside the protected prefix keeps normal delete
semantics (deleted on one machine, deleted on the others if unchanged there).

If someone wants old chats cleaned up, do NOT build a silent hard delete. Offer an
**archive**: move matching transcripts into an encrypted `archive/` area of the vault,
restorable, opt-in and off by default, keyed on "not an open tab on any machine AND older
than N days". Open-tab state is the only reliable keep-signal: VS Code's grouping of
sessions is in-memory UI state and is not persisted anywhere readable, so a group-based rule
cannot be built faithfully.

## 9. The WIP lane: uncommitted code follows you

Without it, a chat on machine B says "I changed billing.ts" while B's billing.ts is still
old, because the change was never committed and pushed. The WIP lane carries work in
progress as **git objects** through the encrypted vault, never through GitHub, and never as
loose files (two trees on different commits would corrupt each other).

**Export** (every sync, per repo in the dev root, only when the repo fingerprint changed;
fingerprint = HEAD, upstream, ahead/behind, porcelain status, size and mtime of every
changed and untracked file). Status comes from one `git status --porcelain=v2 --branch -z
--untracked-files=all` per repo, run 6 at a time, shared between import and export. Written
to `~/.claude-vault/wip/<host>/<project>/`:

- `meta.json`: branch, HEAD, upstream and its sha, sorted status, untracked list, `clean`
  (clean AND fully pushed), `basedOn` (the other host's snapshot this tree continues from),
  `diffStat`, `stash`, `contentHash`, `exportedAt`.
- `commits.bundle`: `git stash create` makes a commit of the tracked changes WITHOUT touching
  index or tree. Point temporary refs `refs/claude-vault/head` (HEAD) and
  `refs/claude-vault/stash` at them, `git bundle create` those refs excluding
  `^<merge-base with upstream>` (else with origin/HEAD, main, master, dev), delete the refs.
  The bundle therefore carries the unpushed commits plus the stash commit.
- `untracked/**`: untracked, non-ignored files mirrored (copy changed ones, remove stale).
- Cap 200 MB: above it, metadata only (`tooLarge`).
- A clean, fully pushed repo publishes `clean: true` with no bundle, so the other side drops
  its applied WIP once the work landed on GitHub.

`contentHash` is the machine-independent identity of the work: SHA-256 of HEAD, status,
`git diff HEAD --binary`, and every untracked file's path and bytes.

**Import** (for each other host's snapshot of a repo that exists here). Skip if already
applied, if a chat of that project is streaming here (a transcript written in the last
30 s), or if the snapshot equals the local tree (record it) or equals any state this machine
itself exported (stale mirror). Apply only when ALL hold:

1. the local tree is clean, OR byte-identical to the last snapshot applied here, OR equal to
   the snapshot's `basedOn` (their work continues exactly from ours);
2. after `fetch origin` and `git bundle unbundle`, the snapshot's HEAD exists here;
3. the snapshot's HEAD descends from the local HEAD. If it does not: a snapshot whose HEAD is
   our past is stale and refused; a different history is accepted only if the local tree is
   clean and the local HEAD is on origin (switching then loses nothing).

Order of operations: objects first (fetch, unbundle: change nothing), ancestry check, THEN
save local state (`git stash create` for the sha, logged to `wip/<host>/backup.log`, then
`git stash push -u`; stash entries are never dropped), `checkout -B <branch> <head>` (and set
upstream), `stash apply --index <sha>` (fallback without `--index`), copy untracked files
in, remove untracked files placed last time that the snapshot no longer has, then
**verify** that the new `contentHash` equals the snapshot's. On mismatch, roll back: stash
the failed apply, check out the old branch and HEAD, pop the saved stash; the failed apply
stays as the newest stash entry.

**The conflict rule:** two edited trees are a CONFLICT, never a merge. Log
`<project> diverged`, record the file list in `wip/<host>/status.json`, and let the companion
show a warning with the files and the backup log. The user decides; the tool never picks a
winner. Never run `reset --hard`, `clean`, or `checkout -f` on a project repo.

**Return to normal:** when the snapshot says `clean` (the other machine committed and
pushed), drop our applied WIP only if the commit contains exactly what we hold: no tracked
edits, and every untracked file byte-identical to the commit's blob (`git hash-object
--path` vs `rev-parse <commit>:<path>`); remove those duplicates and check the commit out.
Separately, clean repos simply behind origin fast-forward on their own (`merge --ff-only
@{u}`), fetching each repo at most every 30 minutes, 4 in parallel, skipped while a chat
streams or tracked edits exist.

Rule for the user: **one repo on one machine at a time.**

## 10. Repos and .env files: same projects at the same paths

- The repo list is regenerated every sync by MERGING with the existing list (a fresh machine
  with no repos must not wipe it), minus retired names.
- **Clone in place, every sync.** "Missing" means no `.git` with a commit, not "no folder":
  the `.env` restore usually creates the folder first, and a plain `git clone` refuses a
  non-empty folder. So: `git init`, add or set `origin`, `fetch`; default branch = what the
  remote advertises (`remote set-head origin -a`), else `main`, `master`, or the only
  branch; move any local file that collides with a tracked file to `<name>.vault-moved`;
  `checkout -b <branch> --track origin/<branch>`. Untracked files such as `.env` survive.
- On failure, remove the half-made `.git` (a naive check would think it cloned) and retry
  later (reference: every 10 minutes per repo).
- **Credentials without mixing accounts.** Fetch with the machine's default credential
  helper first. If that fails for a GitHub URL and `gh` is installed, retry with
  `-c credential.helper= -c "credential.helper=!gh auth git-credential"`, and if that works,
  write the gh helper into THAT repo's local config only. The vault repo itself always uses a
  repo-local gh helper. Never set a global helper: it mixes the vault's GitHub account with
  the user's work accounts on project repos.

## 11. Retiring a repo everywhere

The repo list is a union that never shrinks, so deleting a folder by hand only makes the
clone lane bring it back. Retire it instead (`forget "<folder>"`):

- write a tombstone `{at, by}` to the synced `retired.json` (merged per folder, newest `at`
  wins, so an undo beats an older forget and the reverse) and drop it from `repos.json`;
- each machine, on its next sync, removes its copy ONLY if: no uncommitted changes, no
  unpushed commits (`git log --branches --not --remotes` empty), no stash entries, no chat
  of that project running. Otherwise log the reason, record `retireRefused` for the companion
  to show, and re-check every 10 minutes;
- first copy every `.env*` in it to `~/.claude-vault/retired/<folder>/` (synced, encrypted),
  then move the folder to the Recycle Bin (recoverable), never a hard delete;
- chats are never touched. `forget --undo` lifts the tombstone; nothing is restored by itself.

## 12. Open chat tabs follow you

Where the state lives: VS Code keeps per-folder UI state in
`<VS Code user dir>/User/workspaceStorage/<hash>/state.vscdb` (SQLite `ItemTable`). The
`<hash>` differs per machine, so match folders through `workspace.json`'s folder URI. The
open Claude tabs are in `Anthropic.claude-code` (`panelTabSessions`: session id and title;
`panelSessionIds`) and `memento/workbench.parts.editor` (the editor grid; Claude tabs are
webview editors whose `viewType` contains `claudeVSCodePanel` and whose state carries
`sessionID`). Reading needs SQLite (Node's built-in `node:sqlite`, Node 22.13 or newer;
without it, disable this feature and log once). Read from a COPY of the DB so a live lock
never matters.

**Per-host published sets, merged as a union minus tombstones.** Each host writes only its
own file `~/.claude/vscode-state/hosts/<host>/<project>.json` with `tabs` (session id to
title, openedAt, lastActiveAt = the transcript mtime), `closed` (tombstones), and a
`template` tab entry. Import = union of every host's tabs minus tombstones: a tombstone beats
an older open, a reopen after `closedAt` beats the tombstone, tombstones expire after 30
days. **Never replace a tab set with another machine's.** The earlier "newest set wins" design
let a window that came up with 2 tabs wipe the other machine's 26. A host with fewer tabs
never shrinks the set; absence is never a close.

**Only an explicit close creates a tombstone:** the companion records every user close of a
Claude tab (title and time; suppressed while the tool itself is closing tabs), and the
exporter creates a tombstone only when a session that was open at the last export is gone
from the DB AND a close event with its title exists. Export this host's file (and its
tombstones) BEFORE merging, or a tab closed a moment ago comes straight back.

**Machine-specific values** inside the stored JSON (the profile user name in paths, plain and
URL-encoded, and the Claude extension's versioned install folder) are replaced with
`{{USER}}` and `{{CLAUDE_EXT_VER}}` on export and expanded on import.

**Writing the DB when VS Code is closed.** VS Code reads the DB only when a window opens and
rewrites it from memory while running; its main process can hold the file for many minutes
after the window closed. The write gate: an exclusive open (no sharing) must succeed AND the
file's mtime must be at least 5 s old. Then: keep the existing layout, remove tombstoned
tabs from every editor group (re-index `mru`), append missing tabs to the group that already
holds the most Claude tabs by cloning a local Claude tab entry (or the template), update the
extension's list, back up the DB once a day (`state.vscdb.vault-bak`), write in one
`BEGIN IMMEDIATE` transaction, and re-read 5 s later to verify ("overwritten by VS Code, will
retry" otherwise).

**Merging live when the window is open: the companion extension.** When VS Code holds the
DB, the tool writes a plan to `~/.claude-vault/pending/<project>.json` (adds with session ids
and titles, removes with titles). The companion, running inside that window, watches the
folder (plus a 60 s poll) and applies it with the Claude extension's own command:
`vscode.commands.executeCommand('claude-vscode.editor.open', sessionId, undefined, undefined,
undefined, undefined, { programmatic: true })`, which opens a chat by session id and is
idempotent. Tombstoned tabs are closed by label with close events suppressed. Throttles: at
most 8 opens per batch, newest activity first, 1.5 s between opens, one batch per minute,
postponed below 1024 MB free memory; focus is returned to the tab the user had; merged
session ids are remembered per window so repeated plans (until VS Code flushes) open
nothing twice. Modes: `auto` (default), `ask` (Merge / Not now), `off`. On activation the
companion asks the tool for a fresh plan; it also triggers an export about 20 s after a
Claude tab opens or closes (at most once per 60 s, only when no chat is streaming).

**Is this window open? Three signals, any one means open:**

1. the companion's heartbeat file `~/.claude-vault/windows/<project>.alive`, touched every
   30 s, counted if younger than 90 s;
2. VS Code's `globalStorage/storage.json` `windowsState` (misses windows opened by the
   `code` CLI);
3. the window titles of running VS Code processes (`... - <folder> - Visual Studio Code`).

`storage.json` alone was wrong in practice. This signal only decides "write a pending plan
for the companion"; the exclusive-open gate decides whether writing the DB is allowed.

The companion is a real extension: the tool packages the `companion/` folder into a `.vsix`
(a zip with `extension.vsixmanifest` and `[Content_Types].xml`; the reference has its own
tiny zip writer) whenever its version or source hash changes, and installs it detached with
`code --install-extension <vsix> --force`.

The reference also keeps an older path: a reopen watcher (`watch`, one per machine, started
at logon) that closes and reopens a window to apply state through the DB. The live merge
replaced it for tabs.

## 13. Scheduling

Reference (Windows Task Scheduler), all launched through a tiny VBScript that runs
`node vault.mjs <cmd>` with no visible window (`WScript.Shell.Run cmd, 0, False`), so no
console flashes every 2 minutes:

| Task | Trigger | Runs |
|---|---|---|
| `ClaudeVaultPull` | every 2 minutes, start minute even (creator) or odd (others) | `sync` (a full sync; the name is historical) |
| `ClaudeVaultSyncAtLogon` | at logon of this user | `sync` |
| `ClaudeVaultWatch` | at logon of this user | `watch` |

At-logon tasks are registered with `Register-ScheduledTask` because `schtasks /SC ONLOGON`
needs elevation. Every sync also respawns the watcher if its PID is dead. An older 10-minute
`ClaudeVaultSync` task is deleted when tasks are registered.

**Pause, resume, check** are per machine; each machine pauses itself. Pause = disable the
tasks FIRST, then kill any running tool process and remove the watcher PID file (a sync
running in between can respawn the watcher), then confirm. Do a final `sync` first if
nothing should be lost. Resume = enable the tasks and run one `sync`. Exact commands, and
suggested launchd and systemd equivalents, are in `references/commands.md`.

## 14. Passphrase storage per machine

- **Windows (reference):** DPAPI, bound to the Windows user. Store with
  `ConvertTo-SecureString -String '<passphrase>' -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Encoding ascii -LiteralPath "$env:USERPROFILE\.claude-vault\key.dpapi"`;
  read back with `ConvertTo-SecureString` and `Marshal.SecureStringToBSTR`. Interactive setup
  uses `Read-Host -AsSecureString` twice (no echo, minimum 12 characters).
- **macOS (suggestion, not in the reference):** Keychain:
  `security add-generic-password -s claude-vault -a "$USER" -w` (prompts), read with
  `security find-generic-password -s claude-vault -w`.
- **Linux (suggestion, not in the reference):** libsecret: `secret-tool store
  --label=claude-vault service claude-vault`, read with `secret-tool lookup service
  claude-vault`. Headless fallback: a file with mode 0600 (this is what the reference does on
  non-Windows systems, in plain text, which is weaker).
- An environment variable (`CLAUDE_VAULT_PASSPHRASE` in the reference) is for tests and
  automation only.

## 15. Onboarding a new machine (generic)

Placeholders: `<your-github-user>`, `<your-vault-repo>`, `<passphrase>`, `<vault-dir>`
(reference: `C:\claude-vault`), `<dev-root>` (reference: `C:\dev`).

1. Install git, the GitHub CLI, Node (22.13 or newer for tab sync), VS Code, and the Claude
   Code extension (Windows: `winget install -e --id Git.Git`, `GitHub.cli`,
   `OpenJS.NodeJS.LTS`, `Microsoft.VisualStudioCode`; then
   `code --install-extension anthropic.claude-code`). Open a NEW terminal so PATH updates.
2. `gh auth login --hostname github.com --git-protocol https --web`, as `<your-github-user>`.
   Do NOT run `gh auth setup-git` or change global git credential settings.
3. `gh repo clone <your-github-user>/<your-vault-repo> <vault-dir> -- -b vault`
4. Store `<passphrase>` with the OS method from section 14. Check: `node <vault-dir>/vault.mjs
   status` prints the snapshot summary ("Wrong passphrase" means retype).
5. `node <vault-dir>/vault.mjs setup`: restores everything into `~/.claude` and the dev root,
   clones every project in place around the restored `.env` files, registers the scheduled
   tasks, installs the companion.
6. Verify: `verify 30` shows 0 differ (or only files changed since), the project folders
   exist, the tasks exist, the companion is listed in `code --list-extensions`.
7. Open VS Code on any project and log the Claude extension into any account.

Never create the `squash-here` flag on a second machine. Keep projects at the same absolute
paths as on the other machines.

## 16. Command set

`setup`, `sync`, `pull`, `restore`, `status`, `list`, `verify [n]`, `squash`,
`forget "<folder>"`, `forget --undo "<folder>"`, `scheduler`, `watch`, `companion`,
`vscode-state`, `wip`, `wip-state [dir]`. What each does, environment overrides, and healthy
log lines: `references/commands.md`.

## 17. Landmines (each one happened)

- **The tool is an ES module** (`.mjs`). `require` does not exist in it; use the imported
  `spawn` and friends. When patching it from a helper script, do not build code with
  `String.raw` and backticks: escapes get mangled. Edit escapes directly.
- **Separate, repo-local credential helper.** The vault repo authenticates through a
  repo-local `credential.helper=!gh auth git-credential` (reset the inherited helper with an
  empty `credential.helper` entry first). Project repos keep the machine's normal helper. A
  global helper mixes accounts and pushes project code as the wrong user.
- **Read-only commands take the lock too.** `status` and `verify` fetch and reset the vault
  repo; run during a sync they caused `index.lock: File exists`.
- **Every child process needs a timeout.** A hung `code --install-extension` held the lock
  for 13 minutes. Run non-essential installers detached and verify later.
- **Orphan snapshot commits re-upload everything.** 1.4 GB per sync and stale-lease failures
  against the other machine. Snapshots are children of the remote head; only the daily squash
  is an orphan.
- **Stage leftover chunks.** A chunk written by an interrupted run but never committed made
  the other machine crash with ENOENT. Stage untracked chunks and repair missing chunks from
  the fetched commit.
- **Claude Code's own cleanup deletes chats.** Protect `projects/` from sync deletes and set
  `cleanupPeriodDays` very high.
- **Generated files must be merged, not newest-wins** (repo list, `~/.claude.json` slice,
  tombstones), or machines ping-pong forever.
- **"Folder exists" is not "cloned".** The `.env` restore creates the folder first; clone in
  place and treat "has a commit" as cloned. Before this fix every fresh machine ended up with
  `.env`-only folders.
- **Another host's own files are exempt from the 60 s in-use guard.** Without the exemption
  a tab tombstone did not propagate.
- **"Newest tab set wins" erased tabs.** Union minus explicit-close tombstones only.
- **Writing an open window's DB is silently undone** by VS Code, and the write would be
  recorded as applied. Gate on an exclusive open plus 5 s quiet, and verify 5 s after.
- **`storage.json` misses windows opened by the `code` CLI.** Use all three open-window
  signals.
- **A long-open VS Code window runs the OLD companion.** A newly installed extension version
  loads only in windows opened (or reloaded) after the install. When the companion changes,
  reload windows before judging the new behavior.
- **Two machines on the same minute** race every push. Alternate slots, and never re-register
  tasks needlessly (it moves the slot).
- **A slow, loaded machine** can take 30 to 200 s per sync; let it skip slots instead of
  queueing behind the lock.
- **A large first upload** exceeds GitHub's 2 GB push limit; push in batches.

## 18. Things not to do

- Do not describe a switch, a running process, or a cost meter on GitHub. It is passive.
- Do not build any silent hard delete of chat transcripts, and do not lower
  `cleanupPeriodDays`. Offer the opt-in archive from section 8 and call it archived, not
  deleted.
- Never write the passphrase into the repo, a commit message, a log line, a config file, a
  chat, or documentation. It lives only in the OS-protected key store and the user's password
  manager.
- Never merge the vault branch into anything, push it by hand, or edit chunk or manifest
  files. Only the tool writes there.
- Never `reset --hard`, `clean -f`, or `checkout -f` a PROJECT repo from the sync. (The vault
  repo itself is reset on every fetch; that is fine because it is derived data.)
- Never resolve a WIP conflict automatically.
- Never sync login tokens, and never sync `~/.claude.json` whole.
- Never set a global git credential helper as part of the sync.

## 19. Cost and footprint

- GitHub: one private repo, ordinary git traffic. Steady state pushes a few MB per change;
  the daily squash re-uploads the full encrypted size once from one machine.
- Size: in a heavy real setup the encrypted vault was about 1.4 GB, most of it chat text
  (about 800 MB). Chunk dedup keeps growth to what actually changed.
- Time: about 8 to 14 s per sync on a desktop with an SSD (fetch about 2, scan about 3, push
  about 2), longer on a slow laptop. Every log line carries the phase timings.
- CPU and battery: one short run every 2 minutes, plus the watcher idling on a 2 s poll.
- Disk: the vault clone (roughly the encrypted size) plus `~/.claude-vault`.

## 20. Building your own: a sensible order

1. Config with roots and include/exclude rules; scan to a vpath map.
2. Key derivation, salt and check files, chunk and manifest encryption; `status`, `list`,
   `verify`.
3. Push phase and pull phase with the state baseline, protected chat paths, the 60 s guard,
   and `restore`.
4. Git plumbing: dedicated branch, child-commit snapshots, lease push, targeted staging,
   lock, timeouts, race merge, batching, daily squash with lock.
5. Scheduler with slot alternation, hidden launcher, adaptive skip, self-update.
6. Merged generated files: `~/.claude.json` slice, repo list with clone in place, retire.
7. WIP lane with verify and rollback.
8. Tab sync: DB export and import with the gate, then the companion for live merge.

Test each lane with two throwaway clones on one machine (override the host name and the
roots through environment variables, as the reference does) before trusting it with real
chats.

## Docs versus code in the reference

The reference `README.md` and `NEW-COMPUTER.md` were corrected against the code on 2026-10-14
(scheduling, retry and fetch intervals, watcher wait, tab export timing, the live merge, the
retired single-file tab state). What still lags is only inside the code, in comments and log
text; the behaviour itself is right:

- `vault.mjs`'s header comment and the `setup` log still say "runs every 10 min"; the scheduler
  actually registers a full sync every 2 minutes. The non-Windows hint suggests a 10-minute
  cron line; use 2 minutes to match.
- The header says Node 18 or newer is enough; open-tab sync needs `node:sqlite`, so use Node
  22.13 or newer.
- The companion's `package.json` still declares an `idleSeconds` setting that nothing reads
  any more.

When you build your own, keep README, comments and code in step: a stale interval in the docs
is exactly what sends the next person to debug the wrong thing.
