# Command reference and operator recipes

The reference tool is one file run as `node vault.mjs <command>`. With no command it runs
`sync`. Every command that touches the vault repo runs under the single lock (see SKILL.md).

## Commands

| Command | What it does |
|---|---|
| `setup` | First run on a machine. Checks git and node (and warns if `gh` is missing), verifies the folder is a clone with an `origin`, sets repo-local git config (identity, `core.autocrlf=false`, `core.compression=0`, `gc.auto=0`, repo-local `credential.helper=!gh auth git-credential`). Asks for the passphrase (hidden, typed twice, at least 12 characters) unless already stored, up to 3 tries against `vault.check`. If the remote branch does not exist yet, this machine is the creator: it writes the `squash-here` flag. Then a full sync (`full: true`: restore everything, no local-delete inference), then registers the scheduled tasks. |
| `sync` | The normal run (what the scheduler calls). Adaptive slot skip, lock (waits up to 20 s), fetch + reset to remote, pull phase, clone missing repos, apply retire tombstones, WIP import, tab import, companion install check, watcher check, scheduler-version check, squash-lock check, then push phase and commit/push (with race merge), then squash or daily gc. |
| `pull` | Same as sync but stops before pushing (`pullOnly`). Lock wait 0 s. |
| `restore` | Pull everything, push nothing (`pullOnly` + `full`): every file in the snapshot is written if missing, and no local delete is inferred. |
| `status` | Under the lock (waits up to 90 s): fetch, decrypt the manifest, print which machine wrote the snapshot and when, file count, plaintext GB, per-root counts, chunk count and encrypted GB. A wrong passphrase prints "Wrong passphrase". |
| `list` | Every vpath in the snapshot with size and mtime. Under the lock. |
| `verify [n]` | Decrypt `n` random files (default 25) and compare byte for byte with disk. Prints `verify: X identical, Y differ, Z not on this machine`. "Differ" is normal for a file that changed since the last push. |
| `squash` | Creates the `squash-here` flag on this machine if missing, then runs a sync that ends with a squash. |
| `forget "<folder>"` | Writes a retire tombstone for a dev-root folder and drops it from `repos.json`. Every machine moves its copy to the Recycle Bin on its next sync, only if clean, pushed and stash-free with no running chat. |
| `forget --undo "<folder>"` | Lifts the tombstone. Nothing is restored automatically. |
| `scheduler` | (Re)registers the scheduled tasks on this machine. |
| `watch` | The long-running reopen watcher (normally started at logon or by a sync). One per machine; exits when `vault.mjs` changes on disk. |
| `companion` | Forgets the "installed" marker and rebuilds + reinstalls the VS Code companion. |
| `vscode-state` | One tab import + export by hand. `vscode-state --force <project>` re-exports that project even if unchanged. |
| `wip` | One WIP import + export by hand. |
| `wip-state [dir]` | Prints the repo fingerprint, status, `contentHash` and what was last exported for a repo (default: current directory). |

Environment variables the reference honors: `CLAUDE_VAULT_PASSPHRASE` (passphrase without
the stored key, for tests and automation), `CLAUDE_VAULT_HOSTNAME` (host name override, tests
only), `CLAUDE_VAULT_ROOT_<NAME>` (root override), `CLAUDE_VAULT_VSCODE_WS` (workspaceStorage
override), `CLAUDE_VAULT_NO_WATCHER` (no watcher, no scheduler registration).

## Healthy log lines

```
pushed snapshot <sha8>: N files, K changed, X MB new, G chunks gc'd, T s (fetch .. pull .. wip .. vscode .. scan+export .. [vscExp .. wipExp .. scan .. chunk+manifest ..] push ..)
in sync (N files, T s; fetch .. pull .. ...)
pulled N file(s) from the vault (M up to date)
restored N chat/memory file(s) that had been deleted locally (chats are never deleted through the vault)
push race with <host>: merged our snapshot on top of theirs (attempt 1)
previous run took Ns (machine under load); skipping this slot so runs do not pile up
another sync is running, skipping
wip: exported <project> (2 changed, 1 untracked, bundle)
wip: applied <project> from <host>, snapshot 95s old, verified in 1.2s
wip: <project> diverged (local changes on this machine), not applying; files: ...
vscode-state: merged <project>: +3 from <host>, -1 closed, 5 unchanged (verified 5 s later; shows on next window open)
companion(<project>): merged live (watch): +3 opened from <host>, -0 closed, 4000 MB free
forget: NOT removing <folder> on this machine: <why>
```

`FATAL:` lines are real failures (wrong passphrase, cannot decrypt manifest, unexpected git
error). A FATAL inside the lock releases the lock before exiting.

## Operator recipes (reference implementation, Windows)

Task names in the reference: `ClaudeVaultPull` (every 2 minutes, despite the name it runs a
full `sync`), `ClaudeVaultSyncAtLogon` (`sync` at logon), `ClaudeVaultWatch` (`watch` at
logon). `ClaudeVaultSync` is a retired 10-minute task that the scheduler deletes; include it
in disable commands so an old machine is covered.

### Pause this machine

Disable the tasks FIRST, then stop the watcher (a sync running in between can respawn it):

```powershell
node <vault-dir>\vault.mjs sync   # optional final catch-up
'ClaudeVaultPull','ClaudeVaultSync','ClaudeVaultSyncAtLogon','ClaudeVaultWatch' | ForEach-Object { schtasks /Change /TN $_ /DISABLE 2>$null }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*vault.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item "$env:USERPROFILE\.claude-vault\watch.pid" -ErrorAction SilentlyContinue
'ClaudeVaultPull','ClaudeVaultSyncAtLogon','ClaudeVaultWatch' | ForEach-Object { (schtasks /Query /TN $_ /FO LIST | Select-String 'Status').Line.Trim() }
```

A pause affects only the machine it runs on. There is no remote switch: another machine must
be paused on itself (paste the same commands there).

### Resume this machine

```powershell
'ClaudeVaultPull','ClaudeVaultSyncAtLogon','ClaudeVaultWatch' | ForEach-Object { schtasks /Change /TN $_ /ENABLE 2>$null }
node <vault-dir>\vault.mjs sync
```

If the tasks are missing: `node <vault-dir>\vault.mjs scheduler`. After a pause during which
both machines changed things, the first sync does visible catch-up work (chat union, WIP
reconcile, tab merge). That is expected.

### Check health

```powershell
node <vault-dir>\vault.mjs status
Get-Content "$env:USERPROFILE\.claude-vault\sync.log" -Tail 15
node <vault-dir>\vault.mjs verify 30
git -C <vault-dir> log -8 --format="%ci  %s" vault    # each snapshot message names the machine
```

### Suggested equivalents on macOS and Linux (not in the reference)

The reference only prints a cron hint on non-Windows systems. Suggested mappings:

| Windows (reference) | macOS (suggestion) | Linux (suggestion) |
|---|---|---|
| Task Scheduler, every 2 min | launchd agent with `StartInterval` 120 | systemd user timer `OnUnitActiveSec=2min`, or cron `*/2 * * * *` |
| at-logon task | launchd `RunAtLoad` | systemd user service `WantedBy=default.target` |
| `run-hidden.vbs` | not needed (launchd has no window) | not needed |
| disable a task | `launchctl bootout gui/$UID <plist>` | `systemctl --user disable --now <timer>` |
| Recycle Bin | Finder Trash (`osascript` or a `trash` CLI) | `gio trash` |
| DPAPI key file | Keychain (`security add-generic-password` / `find-generic-password -w`) | libsecret (`secret-tool store` / `lookup`) |
