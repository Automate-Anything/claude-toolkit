> **About this copy.** This folder is one person's working implementation of a Claude Code
> vault, copied with placeholders: `<your-github-user>`, `<your-vault-repo>`, `<HOME-PC>` (the
> machine that created the vault and does the daily squash), `<LAPTOP>` (a second machine). It
> is Windows-first (DPAPI, Task Scheduler, PowerShell, `%APPDATA%\Code`). The dated incident
> notes describe that person's machines. Where this README and `vault.mjs` disagree, the code
> is right; the disagreements are listed in `../SKILL.md` ("Docs versus code"). Read
> `../SKILL.md` first for the design; read this for one concrete realization of it.

# claude-vault

Encrypted mirror of everything that makes "my Claude Code" mine, so a new computer looks
exactly like the old one after one command. Private repo. Every byte in `chunks/` and
`manifest.enc` is AES-256-GCM encrypted (file names included) with a key derived from a
passphrase that is never stored in this repo. A clone without the passphrase is random bytes.

## What is inside (encrypted)

| Source on the machine | Why |
|---|---|
| `%USERPROFILE%\.claude\projects\**` | every chat transcript of every project, plus per-project memory |
| `%USERPROFILE%\.claude\{settings.json, hooks, commands, skills, plugins, plans, file-history, uploads, ...}` | settings, hooks, skills, undo history |
| the portable slice of `%USERPROFILE%\.claude.json` | per-project allowed tools + MCP servers (merged on restore, machine-specific keys untouched) |
| `C:\dev\<project>\**\.env*` (depth 4, no node_modules) | every project's secrets |
| generated `repos.json` | every `C:\dev\<project>` git remote, so the new machine clones them all to the same paths |

Excluded on purpose: login tokens (`.credentials.json`), lock/session/cache/debug dirs,
`security/` (a Python venv), `skills/gstack/` (1.3 GB of binaries, reinstall it), any
`node_modules` / `.git` / `venv` inside the copied tree.

## New computer

1. Install VS Code + the Claude Code extension, log Claude in (any account; chats are not tied to an account).
2. In a terminal:
   ```
   winget install -e --id Git.Git
   winget install -e --id GitHub.cli
   gh auth login
   gh repo clone <your-github-user>/<your-vault-repo> C:\claude-vault
   C:\claude-vault\setup.cmd
   ```
3. Type the passphrase when asked (stored DPAPI-protected in `%USERPROFILE%\.claude-vault\key.dpapi`, this Windows user only).
   `setup` then pulls everything, clones every project repo into `C:\dev\<name>`, drops the `.env` files in, and installs the scheduled tasks (a full sync every 2 minutes, plus a sync and the reopen watcher at logon).
4. Open VS Code on any project. Same chats, same everything.

Projects MUST live at the same paths (`C:\dev\<name>`) because Claude names the transcript
folder after the encoded working directory.

## Day to day

A scheduled task (`ClaudeVaultPull`, every 2 min on this machine's minute slot, plus
`ClaudeVaultSyncAtLogon` at logon) runs `node vault.mjs sync`. (The task is named "Pull" for
history; it runs the full sync, push included. The old 10-minute `ClaudeVaultSync` task is retired
and `scheduler` deletes it.) Each sync does:
fetch the remote snapshot, apply files that are newer there, re-chunk files that changed
here, push a snapshot commit that is a CHILD of the remote commit (so the push carries only
the delta, typically a few MB). Per-file last-writer-wins by mtime; a file written in the
last 60 s is left alone. Deleting a file on one machine deletes it on the other (only if
unchanged there).

History would grow with every changed chunk, so once a day the machine holding
`%USERPROFILE%\.claude-vault\squash-here` (the one that created the vault, i.e. <HOME-PC>
on a fast uplink) replaces the branch with a single orphan commit. That push is a FULL
re-upload (~1.4 GB, git cannot see that an orphan shares objects with the old branch), which
is exactly why it is daily, from one machine only, and guarded: it first pushes a tiny
`squash.lock` commit; other machines that see a lock younger than 30 min pull but do not
push. Laptops never squash. `node vault.mjs squash` forces one.

Tool updates: edit `vault.mjs` (or the other tool files) on any machine and the next sync
pushes it; every other machine picks it up on its next sync and restarts itself on the new
code before doing anything else.

## Project repos follow you too

`repos.json` (generated, union-merged) lists every `C:\dev\<name>` git remote. On EVERY sync,
any listed project without a `.git` folder is cloned. The folder usually already exists
(the vault restores `C:\dev\<project>\.env` first), so it is cloned IN PLACE: `git init`,
`remote add`, `fetch`, track the remote's default branch (advertised HEAD, else main/master),
`checkout`. Untracked files such as `.env` survive; a local file that collides with a tracked
one is moved to `<name>.vault-moved` and logged. A failed clone (no access with this GitHub
login) is retried every 10 min, not on every 2-minute sync. Before 2026-09-28 this ran only in `setup`,
after the `.env` restore, and treated "folder exists" as "cloned": every fresh machine ended up
with `.env`-only folders and `git clone` refusing because they were not empty.

## Open Claude chats: ONE shared set per project, merged (v2, 2026-09-29)

"Newest wins" replaced a machine's whole tab set with the other's; a laptop window that came up
with 2 tabs was about to erase <HOME-PC>'s 26. Now every host publishes only its OWN file,
`~/.claude/vscode-state/hosts/<host>/<project>.json`: `tabs` (sessionId to title, openedAt,
lastActiveAt = the transcript's mtime), `closed` (tombstones: sessionId to closedAt, created ONLY
when the companion recorded an explicit tab close AND the tab is gone from the db), and a
`template` (one webview tab entry with `{{USER}}`/`{{CLAUDE_EXT_VER}}` placeholders for hosts that
have no Claude tab yet). Import = union of every host's tabs minus tombstones (a tombstone beats an
older open; a reopen after `closedAt` beats the tombstone). Locally the layout is KEPT: tombstoned
tabs are removed from their groups (mru re-indexed), missing tabs are appended to the group that
holds the most Claude tabs, cloned from a local tab entry (or the template). `Anthropic.claude-code`
(`panelTabSessions` / `panelSessionIds`) is edited the same way. A host with fewer tabs never
shrinks the set; absence is never a close. Log: `vscode-state: merged <project>: +N from <hosts>,
-M closed, K unchanged (verified 5 s later)`. When the window is open here the merge is written to
`~/.claude-vault/pending/<project>.json` and the companion offers (or, in auto mode, performs) the
reopen; the watcher then merges and reopens. The import refreshes this host's own file (and thus
its tombstones) BEFORE merging, or a just-closed tab would come straight back. Other hosts' files
are never written locally, so they are exempt from the "written in the last 60 s" guard (that
exemption was missing once and a tombstone did not propagate). Tested: 5+3 tabs (1 common) to 7 on
both; close one to 6 on both; a window that reopens with 1 tab is restored to 6; reopen after
close to 7 on both.

**Live merge (companion 1.1.0), the normal path.** VS Code's main process keeps every workspace
`state.vscdb` open until VS Code EXITS (laptop: held 18 min after the window closed), so the
database path only works when VS Code is not running. For a running VS Code the vault writes the
plan to `~/.claude-vault/pending/<project>.json` (adds with session ids and titles, removes with
titles) and the companion applies it INSIDE the window: `claude-vscode.editor.open(sessionId, ...,
{programmatic: true})` opens each missing chat (the Claude extension's own command; it takes a
session id and is idempotent through `hasPanelForSession`), tombstoned tabs are closed by label
with close events suppressed, then a status bar message and
`companion(<project>): merged live (<reason>): +N opened from <host>, -M closed`. On activation the
companion runs `vault.mjs vscode-state` so a freshly opened window gets its plan within seconds.
Mode `auto` merges silently, `ask` shows "Merge / Not now" first, `off` does nothing. Measured:
2 s from plan to merged tab. No reopen, no database write, no exit needed.

The paragraphs below describe the write gate (now only for "VS Code not running") and the older
companion behaviour; the reopen machinery still exists but nothing triggers it for tabs any more.

## Open Claude chats follow you (VS Code panel state)

VS Code stores per-folder UI state in `%APPDATA%\Code\User\workspaceStorage\<hash>\state.vscdb`
(SQLite `ItemTable`). The open Claude Code chat tabs live in three keys: `Anthropic.claude-code`
(the extension's memento, `panelTabSessions` = session id + title), `memento/workbench.parts.editor`
(VS Code's editor layout, where the webview tabs actually are) and
`memento/webviewView.claudeVSCodeSidebarSecondary` (the chat in the secondary sidebar). The
`<hash>` differs per machine, so entries are matched by `workspace.json`'s folder URI.

- Export, every sync: when THIS machine's state for a `C:\dev\<project>` folder changed, write
  `~/.claude/vscode-state/hosts/<host>/<project>.json` (one file per machine, rides the normal
  vault sync; the import is a UNION of every host's open tabs minus explicit-close tombstones,
  never a replace). The older single-file `~/.claude/vscode-state/<project>.json` (newest wins) is
  retired: every export deletes any leftover one so nobody applies it. The user name and the
  extension's versioned install dir inside the values are replaced by `{{USER}}` /
  `{{CLAUDE_EXT_VER}}` and expanded on import, so a different Windows user name or extension
  version on the other machine does not break the tabs.
- Import, every sync: a file from another machine is written into the local `state.vscdb` only
  when that folder's window is NOT open here (VS Code reads the db only when a window opens and
  rewrites it from memory while open). Open = listed in `globalStorage\storage.json`
  `windowsState` while `Code.exe` runs. Never opened here = skipped until VS Code creates the entry.
  `state.vscdb.vault-bak` is taken before the first write of a day. Only the three keys are touched.
- Semantics: a chat opened on machine A is open on machine B the next time B opens (or reloads)
  that project window. If both windows are open at once, the machine whose state changed last
  wins on the next open. Transcripts are never affected; this is panel state only.
- Needs `node:sqlite` (Node >= 22.13). Without it the feature logs once and disables itself;
  the transcript sync is never blocked by anything in this section.
- `node vault.mjs vscode-state` runs one import + export by hand.

## Open WINDOWS follow you too (companion extension + reopen watcher)

The import above can only touch a CLOSED window. For an OPEN window, `companion/` (a tiny VS Code
extension, packaged into a .vsix by `vault.mjs` with its own zip writer and installed through the
`code` CLI whenever its version or content changes) does the rest:

- **Live merge (current, companion 1.1.x).** While the window is open, the vault leaves a merge
  plan in `~/.claude-vault/pending/<project>.json` (`adds`: chats open on another machine,
  `removes`: chats closed there). The companion applies it INSIDE the running window: it opens
  each missing chat with the Claude command `claude-vscode.editor.open(<sessionId>)` and closes
  tombstoned tabs by title. No database write and no window reload. At most one batch a minute,
  `maxLiveOpens` (default 8) per batch with `openDelayMs` (default 1500) between opens, and it
  waits while free memory is under `minFreeMemoryMB` (default 1024). Setting
  `claudeVaultCompanion.mode`: `auto` (default, merge by itself), `ask` (a toast first), `off`.
- The older "reopen the window when idle" behaviour (`idleSeconds`) is no longer used by the
  companion: the setting is still declared in `package.json`, but nothing reads it. The manual
  reopen command below still works.
  (`auto` is the default because the goal is "identical on both computers", which `ask` cannot
  deliver while nobody is at the other machine.)
- Reopen = write `~/.claude-vault/reopen/<project>.json`, close the local Claude tabs (they are
  being replaced anyway; a busy webview is the likeliest thing to keep a window from closing),
  then `workbench.action.closeWindow`. If the window is still alive 3 s later: close all editors
  and try once more; still alive: a warning toast asks the user to close it by hand (the request
  stays valid for 3 min, see the watcher). Never while an editor has unsaved changes, and no
  offer while a chat is streaming. Every decision is logged to `sync.log`
  (`companion(<project>): ...`) and to the "Claude Vault" output channel.
- THE write gate for `state.vscdb`: an exclusive open (`FileShare.None`) must succeed and the
  file's mtime must be at least 5 s old. SQLite keeps the file held for as long as VS Code has
  that workspace's storage open, so "held" is ground truth regardless of every other signal (the
  laptop showed both failure modes on 2026-09-28: an import while the window was open, and one
  in the gap between `storage.json` saying closed and the final flush). After a write the key is
  re-read 5 s later: "verified" or "overwritten by VS Code, will retry" (applied is cleared).
  The periodic import waits up to 6 s for the gate, the reopen watcher up to 30 s.
- "Is this window open?" (only decides logging and whether the companion is asked; the gate
  above decides writing) uses three signals (any = open): the companion's heartbeat file
  `~/.claude-vault/windows/<project>.alive` (touched every 30 s), VS Code's `storage.json`
  `windowsState` (misses windows opened by the `code` CLI, found 2026-09-28), and the Code.exe
  window titles (`... - <project> - Visual Studio Code`). Importing into an OPEN window's db is
  silently undone by VS Code and would be marked applied, so this must not be wrong.
- First export of a project on a machine: exported only if the local `state.vscdb` is newer than
  the other machine's file (`exportedAt`); otherwise the file is the baseline. A blanket "never
  on first export" rule swallowed the laptop's first real change (2026-09-28).
- The **reopen watcher** (`node vault.mjs watch`, started at logon by `ClaudeVaultWatch` and
  re-spawned by every sync/pull if it died; one per machine, exits by itself when `vault.mjs`
  changes) polls that folder every 2 s: waits until the window is gone (storage.json
  `windowsState`, up to 3 min, then gives up and logs), does a quick pull, applies that one
  project's chat state into `state.vscdb`, and runs `code "<folder>"`. About 5 s end to end.
- The companion also exports this window's chat tabs after a Claude tab opens or closes
  (`onDidChangeTabs`): once 20 s have passed since the last tab change, at most once every 60 s
  per window, and only while no chat of this project is streaming.
- **One lane:** `ClaudeVaultPull` runs the full `node vault.mjs sync` (fetch, apply, push) every
  2 min, so changes land on the other machine within a few minutes. `node vault.mjs pull`
  (pull only, no push) still exists as a manual command.
- Commands: "Claude Vault: Reopen this window with the other machine's chats" and
  "Claude Vault: Export this window's open chats now". `node vault.mjs companion` rebuilds and
  reinstalls the extension.

## Uncommitted code follows you too (the WIP lane)

Project code used to reach the other machine only through GitHub (committed AND pushed), so a
chat saying "I changed billing.ts" arrived on a machine whose billing.ts was still old. Now every
sync (2 min) snapshots each `C:\dev` repo's work in progress as **git objects** into
`~/.claude-vault/wip/<host>/<project>/` (rides the encrypted vault, never touches GitHub):

- `meta.json`: branch, HEAD, upstream, porcelain status, `diff --stat`, `contentHash` (machine
  independent identity: HEAD + status + `git diff HEAD --binary` + untracked contents),
  `basedOn` (the other machine's snapshot this tree continues from), `exportedAt`.
- `commits.bundle`: unpushed commits (`merge-base(HEAD, upstream)..HEAD`) plus the `git stash
  create` commit that captures tracked changes without touching index or tree. Temporary refs
  `refs/claude-vault/{head,stash}` exist only for the `bundle create` call.
- `untracked/**`: untracked, non-ignored files, mirrored (copy on change, stale ones removed).
- Size cap 200 MB: above it, metadata only ("snapshot too large"). Exported only when the repo
  fingerprint (HEAD, upstream, status, size+mtime of every changed/untracked file) changed.
- A clean, fully pushed repo publishes an empty snapshot (`clean: true`) so the other side drops
  the WIP state once the work landed on GitHub.

The other machine applies a snapshot from another host only when ALL hold: no chat of that
project is streaming here; its own tree is clean, OR byte-identical to the last snapshot it
applied, OR equal to the snapshot's `basedOn` (their work continues exactly from our state); the
snapshot's HEAD descends from the local HEAD (a snapshot whose HEAD is our past is stale and
refused; a different branch is accepted only when the local tree is clean and fully on origin,
because switching then loses nothing). A snapshot equal to any state this machine itself exported
is a stale mirror and ignored. Order of operations: fetch + unbundle (change nothing), ancestry
check, THEN `stash create` + `stash push -u` of the local state (sha logged to
`wip/<host>/backup.log`; stash entries are never dropped), `checkout -B <branch> <head>`, `stash
apply --index <sha>`, copy untracked files, verify `contentHash` equality (status mismatch =
roll back, the failed apply kept as the newest stash entry). Log line:
`wip: applied <project> from <host>, snapshot <age>s old, verified`.

Two edited trees are a CONFLICT, never a merge: `wip: <project> diverged (local changes on this
machine), not applying; files: ...`, written to `wip/<host>/status.json`, and the companion
(1.0.3) shows a warning toast in that project's window with "Open backup log" / "Show files".
The user decides; the tool never picks a winner. Never `reset --hard`, `clean` or `checkout -f`
on a project repo.

Return to normal: when the other machine committed and pushed, our applied WIP is dropped only if
the commit contains exactly what we hold (`prepareForCheckout`: no tracked edits, every untracked
file byte-identical to the commit's blob, then those duplicates are removed and the branch checked
out). Clean repos that are simply behind origin fast-forward (`merge --ff-only @{u}`) on the
scheduler (fetch at most every 30 min per repo, 4 repos in parallel) so committed work arrives without any agent.

**One chat, one machine at a time; one repo, one machine at a time.** Transcripts are whole
files: the newest copy wins per file, and a file written in the last 60 s on a machine is never
overwritten there. If the same chat is continued on both machines during the same 2 minutes, one
side's last messages lose. Two trees edited at the same time are a conflict (above). Continue a
chat or an edit where you are; the other machine follows within 2 minutes.

Debug: `node vault.mjs wip` (one import + export by hand), `node vault.mjs wip-state <repo>`
(fingerprint, status, contentHash, and what was last exported).

## Retiring a project folder everywhere (`forget`)

`repos.json` is a union that never shrinks, so deleting a folder only makes the clone lane bring
it back within a minute (this happened on the laptop). `node vault.mjs forget "<folder name>"`
writes a synced tombstone (`~/.claude-vault/retired.json`, newest entry per folder wins across
machines) and drops the folder from `repos.json`. On its next sync, EVERY machine moves its copy
to the Windows Recycle Bin, but only if the repo has no uncommitted changes, no unpushed commits
(`git log --branches --not --remotes` empty), no stash entries and no running chat of that
project; otherwise it logs `forget: NOT removing <folder> ...: <why>`, writes a
`retireRefused` entry to `wip/<host>/status.json` (the companion shows the reason as a toast) and
re-checks every 10 minutes. Any `.env*` in the folder is copied to
`~/.claude-vault/retired/<folder>/` first (synced, encrypted). Chats are never touched.
`node vault.mjs forget --undo "<folder name>"` lifts the tombstone; nothing is restored by
itself (Recycle Bin, or clone again). Tested 2026-09-29 on two throwaway clones.

## Performance and robustness (per sync)

Home PC (SSD) steady state 8 to 14 s: fetch 1.7, pull 0.8, wip 1.4, vscode 0.4, scan 2.6,
chunk+manifest 0.5, push 2.2. What made the difference, in order of impact on a slow disk:

- **No per-file opens for the scan.** `fs.stat` opens every file on Windows and Defender scans
  each open (22 s for 31k files on the laptop). The `.claude` tree is enumerated by ONE PowerShell
  process using .NET `DirectoryInfo.EnumerateFiles`, which takes size and mtime from the directory
  listing itself (`enumerateTree`; plain walk as fallback). mtime tolerance 1 ms vs the stored value.
- **Targeted staging.** `git add -A` walked 20k chunk files (32 s on the laptop). The push stages
  only what the run touched (`update-index --add --remove --stdin`: new/removed chunk ids, manifest,
  tool files). Chunk existence comes from one directory listing instead of 40k `existsSync` calls.
- **WIP status in one parallel batch** (pool of 6, `git status --porcelain=v2 --branch -z`, one call
  per repo) shared by import and export; upstream sha resolved lazily; repo fetches for the
  fast-forward lane every 30 min, 4 in parallel.
- **Lost push race = merge, not redo.** The loser re-fetches, builds its snapshot on top of the
  other machine's new commit in a temporary index (their tree + our delta + merged manifest,
  newest entry per file, deletions only for unchanged pre-race versions, chats never dropped)
  and pushes again, up to 6 quick attempts (`push race with <host>: merged our snapshot on top of
  theirs`). Tested with two machines syncing at the same instant.
- **Nothing can hold the lock forever.** Every child process has a timeout (default 5 min).
  The companion installer (`code --install-extension` hung 13 min on the laptop) runs detached and
  is verified on a later sync through the extensions folder, never through the code CLI.
- **One 2-minute lane per machine.** The 10-minute backstop task is retired (it only collided).
  Machines sit on alternating minute slots (creator even, others odd); the scheduler version is
  persisted the moment tasks are registered so nothing re-registers (and moves the slot) later.
- Companion 1.0.5 exports a window's chat tabs at most once per 60 s and only once no chat of the
  project is streaming.

Every sync line carries the phase timings; watch `scan`, `wipExp` and `chunk+manifest`.

- **A chunk referenced by a manifest must be in the tree.** Targeted staging only staged chunk
  ids written in the current run; a chunk file left behind by an interrupted run (a killed
  installer, a timeout) was "present" for the manifest but never committed, and the other
  machine died with ENOENT on that chunk (laptop, 2026-09-29 08:05Z). Now every untracked file
  under `chunks/` is staged too (`staging N chunk file(s) left untracked ...`), a chunk missing on
  disk is restored from the fetched commit (`git show FETCH_HEAD:chunks/..`), and a file that
  still cannot be restored is logged and skipped for that run instead of aborting the sync.
- **Adaptive slot.** When the previous run took longer than 60 s and less than that much time
  has passed since it ended, the scheduled run skips its slot (`previous run took Ns ... skipping
  this slot`), so runs under load stretch instead of piling up behind the lock.
- **Throttled live merge (companion 1.1.1).** `maxLiveOpens` (8 per batch, newest activity
  first, one batch per minute until done), `openDelayMs` (1500), `minFreeMemoryMB` (1024: below
  it the merge is postponed and logged at most every 5 min), focus is given back to the tab the
  user had in front, already-merged session ids are remembered per window so the vault's
  re-plans (until VS Code flushes its state) do not reopen anything.

New machine: paste `NEW-COMPUTER.md` to the Claude agent there.

Log: `%USERPROFILE%\.claude-vault\sync.log`.

```
node C:\claude-vault\vault.mjs status    # what the snapshot holds
node C:\claude-vault\vault.mjs verify    # decrypt a random sample, compare to disk
node C:\claude-vault\vault.mjs sync      # run a sync now
node C:\claude-vault\vault.mjs restore   # pull everything, push nothing
```

## How the encryption works (for the next agent)

- `vault.salt` (public random) + passphrase to scrypt (N=2^15) to master key to HMAC subkeys.
- `vault.check` = HMAC(master, "check"): detects a wrong passphrase, reveals nothing else.
- Files are cut into 4 MB chunks. Chunk id = HMAC(subkey, sha256(plaintext)); gzip, then
  AES-256-GCM with nonce = id[0:12] and AAD = id. Same content to same id to stored once
  (dedup across files, versions, machines). A growing transcript only adds its last chunk.
- `manifest.enc` (random nonce) maps virtual path to {mtime, size, chunk ids}. Paths never
  appear in the clear anywhere in the repo.
- Losing the passphrase = losing the vault. There is no recovery by design.

## Landmines

- GitHub rejects single files > 100 MB and single pushes > 2 GB: chunking handles the first,
  `BATCH_PUSH_BYTES` (700 MB batches on a first upload) the second.
- Never make the per-sync snapshot an orphan commit again. Git marks only the trees of EDGE
  PARENTS as already-known, so a commit with no ancestry re-sends the entire repo on every
  push (measured 1.43 GB / 20,562 objects per 10-minute sync on a laptop, which then raced
  <HOME-PC>'s syncs and failed with stale force-with-lease three times).
- The two `.claude-vault` generated files are union-merged, never last-writer-wins, or the
  machines ping-pong a one-line change forever.
- Anything under `.claude/projects/` (chats, per-project memory) is NEVER deleted through
  the vault (`PROTECTED_PREFIX`). Claude Code's own 30-day cleanup ran on the laptop before
  its `settings.json` had arrived and deleted 45 transcripts locally (2026-09-28); without
  this rule the next sync would have deleted them on every machine. A missing chat is
  restored from the vault instead. Consequence: deleting a chat on purpose brings it back on
  the next sync; that is the intended trade-off ("keep every chat forever").
- The branch is `vault`, not `main`, so a global git hook that blocks pushes to
  `main` never fires.
- `core.compression 0` + `-delta` on chunks: encrypted data does not compress or delta.
- `cleanupPeriodDays` in `~/.claude/settings.json` is 36500 (set 2026-09-25). If Claude Code
  ever deleted a transcript locally, the next sync would propagate the delete. Do not lower it.
