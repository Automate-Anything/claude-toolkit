# Vault file formats and on-disk layout

Every exact format the reference implementation (`../reference-impl/vault.mjs`) reads or
writes. Names are the reference names; rename freely in your own build, but keep the
semantics. "vpath" means a virtual path: `<rootName>/<forward/slash/relative/path>`, for
example `home/.claude/settings.json` or `dev/myapp/.env`.

## 1. The remote repository (one private git repo)

Branch: a dedicated branch (reference: `vault`), never `main`.

```
<vault-repo>/
  vault.mjs              the tool itself (plain, NOT encrypted; tool updates ride the sync)
  vault.config.json      roots + include/exclude rules (plain)
  setup.cmd              Windows bootstrap (plain)
  run-hidden.vbs         hidden-window launcher for scheduled tasks (plain)
  README.md, NEW-COMPUTER.md
  companion/             VS Code extension source (plain): extension.js, package.json
  .gitattributes         see section 9
  vault.salt             64 hex chars (32 random bytes) + newline. Public.
  vault.check            64 hex chars = hex(HMAC-SHA256(master, "check")) + newline. Public.
  manifest.enc           encrypted manifest (section 3)
  chunks/<id[0:2]>/<id>  encrypted chunks (section 2); id = 64 lowercase hex chars
  squash.lock            present only while a squash upload runs (section 8)
```

Nothing under `chunks/` or in `manifest.enc` is readable without the passphrase. File names
of the user's data never appear in the clear: they exist only inside the manifest.

## 2. Chunk format

```
plaintext piece  = up to 4 MiB (4 * 1024 * 1024 bytes) of one file
id               = hex( HMAC-SHA256( chunkIdKey, SHA-256(plaintext piece) ) )      64 hex chars
gz               = gzip(plaintext piece, level 6)
nonce            = first 12 bytes of id (id.slice(0, 24) as hex)
aad              = the 32 raw bytes of id
file bytes       = AES-256-GCM(encKey, nonce, aad).encrypt(gz)  ||  16-byte GCM tag
stored at        = chunks/<id[0:2]>/<id>
```

- An empty file still gets one chunk (the encryption of zero bytes).
- Deterministic nonce is safe here because the nonce is a function of the plaintext: the same
  (key, nonce) pair can only ever encrypt the identical plaintext, which yields identical
  ciphertext. Different plaintext gives a different id, so a different nonce.
- Dedup is automatic: identical content on any machine, in any file, at any time produces
  the same id and is stored once. A growing chat transcript only adds its new last chunk.
- Decrypt: split off the last 16 bytes as the tag, decrypt with the same nonce and AAD,
  gunzip.

## 3. Manifest (`manifest.enc`)

Encrypted with a RANDOM nonce (it changes every push):

```
file bytes = nonce(12 random bytes) || AES-256-GCM(encKey, nonce).encrypt(gzip(json, level 9)) || tag(16)
```

No AAD on the manifest. Plaintext JSON:

```json
{
  "version": 1,
  "generatedAt": "2026-01-01T12:00:00.000Z",
  "machine": "<hostname that wrote it>",
  "files": {
    "home/.claude/settings.json": { "mtime": 1767268800000, "size": 2048, "chunks": ["<id>"] },
    "home/.claude/projects/C--dev-myapp/<sessionId>.jsonl": { "mtime": 1767268800123, "size": 9123456, "chunks": ["<id>", "<id>", "<id>"] },
    "dev/myapp/.env": { "mtime": 1767268700000, "size": 512, "chunks": ["<id>"] }
  }
}
```

- `mtime` is integer milliseconds since the epoch (floor of the file's mtime).
- `chunks` is ordered; concatenating the decrypted chunks reproduces the file.
- The manifest is a full snapshot: a file absent from it is absent from the vault.

## 4. Keys

```
master     = scrypt(passphrase, salt = bytes(vault.salt hex), keylen = 32, N = 2^15 (32768), r = 8, p = 1, maxmem = 128 MiB)
encKey     = HMAC-SHA256(master, "enc")       AES-256-GCM key for chunks and manifest
chunkIdKey = HMAC-SHA256(master, "chunkid")   keyed id so ids leak nothing about content
check      = hex(HMAC-SHA256(master, "check"))  stored in vault.check
```

A wrong passphrase is detected by comparing `check` with `vault.check`; it reveals nothing
else. The first machine creates `vault.salt` and `vault.check`.

## 5. Machine-local directory (`~/.claude-vault/`, never pushed as-is)

```
~/.claude-vault/
  key.dpapi            the passphrase, OS-protected (Windows: DPAPI SecureString export; see SKILL.md)
  state.json           machine state (section 6)
  sync.log             append-only log, rotated to sync.log.1 at 5 MiB
  sync.lock            the lock file: contains the owning PID
  watch.pid            PID of the reopen watcher
  squash-here          flag file: only a machine holding it ever squashes (contents: hostname)
  vault-dir.txt        absolute path of the tool clone (the companion reads it)
  <name>-<ver>.vsix    the companion package last built
  windows/<project>.alive     companion heartbeat (contents: the folder path)
  pending/<project>.json      tab merge plan waiting for an open window (section 7.3)
  closed/<project>.jsonl      explicit tab-close events from the companion (section 7.4)
  reopen/<project>.json       legacy reopen request for the watcher (section 7.5)

  --- these ride the vault (they are under the "home" root, so they are synced) ---
  claude-json-slice.json      portable slice of ~/.claude.json (section 10)
  repos.json                  repo list (section 11)
  retired.json                retire tombstones (section 12)
  retired/<folder>/**         .env files saved from retired folders
  wip/<host>/<project>/meta.json, commits.bundle, untracked/**   (section 13)
  wip/<host>/status.json      conflicts and refusals for the companion to show
  wip/<host>/backup.log       every pre-apply local backup (stash sha)
```

## 6. `state.json` (machine-local)

```json
{
  "files": { "<vpath>": { "mtime": 0, "size": 0, "chunks": ["<id>"] } },
  "lastGc": 0, "lastSquash": 0,
  "lastRunMs": 0, "lastRunEnd": 0,
  "lastPushTiming": "vscExp 0.4 wipExp 1.4 scan 2.6 chunk+manifest 0.5",
  "schedulerVersion": 7,
  "repoCloneFailed": { "<repo>": 0 },
  "companionInstalled": "<version>@<sourceHash>",
  "companionAttempt": { "key": "<version>@<sourceHash>", "at": 0 },
  "vscodeNeverOpenedLoggedAt": 0,
  "tabs": { "<project>": { "open": { "<sid>": { "title": "", "openedAt": "", "lastActiveAt": 0 } }, "closed": { "<sid>": { "closedAt": "", "title": "" } }, "lastExportAt": 0, "template": "", "exportedHash": "" } },
  "wip": {
    "exp": { "<project>": { "fp": "<fingerprint>", "hashes": ["<last 30 exported contentHashes>"] } },
    "app": { "<project>": { "from": "<host>", "fromHash": "", "appliedLocalHash": "", "at": "", "untracked": [], "divergedHash": "", "behindHash": "", "missingHead": "" } },
    "fetched": { "<project>": 0 }
  },
  "retired": { "<folder>": { "done": true, "at": "" } }
}
```

`state.files` is "what the vault and this disk agreed on after the last sync". It is the
baseline for deciding whether a missing or changed file is a local delete, a local edit, or
a remote change.

## 7. Open-tab sync files

### 7.1 Per-host published tab set: `~/.claude/vscode-state/hosts/<host>/<project>.json`

Synced. Each host writes ONLY its own folder.

```json
{
  "project": "myapp",
  "host": "<hostname>",
  "exportedAt": "2026-01-01T12:00:00.000Z",
  "tabs":   { "<sessionId>": { "title": "Fix login bug", "openedAt": "2026-01-01T11:00:00.000Z", "lastActiveAt": 1767268800000 } },
  "closed": { "<sessionId>": { "closedAt": "2026-01-01T11:30:00.000Z", "title": "Old chat" } },
  "template": "<one VS Code webview editor entry JSON string, with {{USER}} and {{CLAUDE_EXT_VER}} placeholders>"
}
```

- `lastActiveAt` = mtime of the chat transcript, identical on every machine.
- Tombstones older than 30 days are dropped; a tab reopened after `closedAt` removes its
  tombstone.
- Project file names are sanitized: characters `<>:"/\|?*` become `_`.

### 7.2 Merge rule

```
target = union over hosts of tabs (per sid keep the newest openedAt; remember which hosts have it)
closed = per sid the newest closedAt over all hosts
for each sid in closed: if target[sid].openedAt <= closedAt then remove sid from target
adds    = target sids not open locally, oldest lastActiveAt first (companion opens newest first)
removes = local sids that are in closed and not in target
```

### 7.3 Pending plan: `~/.claude-vault/pending/<project>.json` (local)

```json
{ "project": "myapp",
  "adds":    [ { "sid": "<sessionId>", "title": "", "from": ["<host>"], "lastActiveAt": 0 } ],
  "removes": [ { "sid": "<sessionId>", "title": "" } ],
  "hosts": ["<other hosts>"],
  "at": "<iso time, also used as the plan id>" }
```

### 7.4 Close events: `~/.claude-vault/closed/<project>.jsonl` (local)

One line per explicit user close of a Claude tab: `{"title":"<tab label>","at":"<iso>"}`.
Only lines newer than the last export are considered. A tombstone is created only when a
session that was open at the last export is gone from the DB AND a close event with its
title exists.

### 7.5 Reopen request (legacy path): `~/.claude-vault/reopen/<project>.json`

`{ "folder": "<abs path>", "project": "", "requestedAt": "", "hash": "", "from": "<host>", "how": "auto|ask|command" }`

### 7.6 VS Code storage touched

`<VS Code user dir>/User/workspaceStorage/<hash>/state.vscdb`, SQLite table
`ItemTable(key TEXT, value)`. Matched to a folder through
`workspaceStorage/<hash>/workspace.json` (`{"folder": "file:///c%3A/dev/myapp"}`).
Keys:

| Key | Holds |
|---|---|
| `Anthropic.claude-code` | the Claude extension's memento: `panelTabSessions` ([{sessionId, title}]) and `panelSessionIds` |
| `memento/workbench.parts.editor` | VS Code's editor layout; `editorpart.state.serializedGrid.root` is a tree of branch/leaf nodes; each leaf has `editors` [{id, value}] and `mru`; Claude tabs are `id = "workbench.editors.webviewInput"` whose `value` JSON has `viewType` containing `claudeVSCodePanel` and `state` JSON with `sessionID` |
| `memento/webviewView.claudeVSCodeSidebarSecondary` | the chat in the secondary sidebar (exported in the older format only) |

Window-open detection also reads `<VS Code user dir>/User/globalStorage/storage.json`
(`windowsState.openedWindows[].folder`, `windowsState.lastActiveWindow.folder`).

## 8. `squash.lock` (in the repo, transient)

`{"host":"<hostname>","at":"<iso>"}`. Another host that sees it younger than 30 minutes
pulls but does not push. An older lock, or one written by itself, is deleted.

## 9. `.gitattributes`

```
chunks/** -delta -text -diff
manifest.enc -delta -text -diff
* text=auto eol=lf
*.cmd text eol=crlf
*.vbs text eol=crlf
```

Plus repo-local git config set by `setup`: `user.name=claude-vault`,
`user.email=claude-vault@users.noreply.github.com`, `core.autocrlf=false`,
`core.compression=0`, `gc.auto=0`, and `credential.helper` reset to empty then
`!gh auth git-credential` (repo-local only).

## 10. `claude-json-slice.json`

The portable part of `~/.claude.json` (that file mixes portable settings with
machine-specific state, so it is never synced whole):

```json
{ "mcpServers": { "...": {} },
  "projects": { "<abs project path>": { "allowedTools": [], "mcpServers": {}, "enabledMcpjsonServers": [], "disabledMcpjsonServers": [], "hasTrustDialogAccepted": true, "hasClaudeMdExternalIncludesApproved": true, "mcpContextUris": [] } } }
```

Serialized canonically (keys sorted, string arrays de-duplicated and sorted, `JSON.stringify(x, null, 1)`)
so two machines with the same settings produce identical bytes. Rewritten only when the text
changes (stable mtime). On restore it is merged into `~/.claude.json`: top-level
`mcpServers` shallow-merged, per project `{...local, ...slice}`, `allowedTools` set-union,
per-project `mcpServers` shallow-merged. Every other key of `~/.claude.json` is untouched.

## 11. `repos.json`

```json
[ { "name": "myapp", "url": "https://github.com/<org-or-user>/myapp.git" } ]
```

Every direct child of the dev root that has a `.git` folder, with its `origin` URL. Merged
with the existing list (never shrinks on its own; a fresh machine must not wipe it), minus
retired names, sorted by name.

## 12. `retired.json`

```json
{ "old-project": { "at": "<iso>", "by": "<host>" },
  "revived":     { "at": "<iso>", "by": "<host>", "undone": true } }
```

Merged per folder name: the entry with the newest `at` wins (a later undo beats an earlier
forget and the reverse).

## 13. WIP snapshot: `~/.claude-vault/wip/<host>/<project>/`

`meta.json`:

```json
{ "project": "myapp", "host": "<hostname>", "exportedAt": "<iso>",
  "branch": "feature-x", "head": "<sha>", "upstream": "origin/feature-x", "upstreamSha": "<sha>",
  "status": "<sorted 'XY path' lines>", "untracked": ["new-file.ts"],
  "clean": false,
  "basedOn": "<contentHash of the other host's snapshot this tree continues from, or null>",
  "diffStat": "<git diff HEAD --stat>",
  "stash": "<sha from git stash create, or null>",
  "hasBundle": true,
  "tooLarge": 0,
  "contentHash": "<sha256>" }
```

- `contentHash` = SHA-256 over `head + "\n" + status + "\n"`, then `git diff HEAD --binary --no-color`,
  then for each untracked file `path + "\n"` + its bytes. Machine independent.
- `commits.bundle` = `git bundle create` of `refs/claude-vault/head` (HEAD) and, if any,
  `refs/claude-vault/stash` (the stash-create commit), excluding `^<basis>` where basis is the
  merge-base with the upstream (else with origin/HEAD, origin/main, origin/master, origin/dev).
  The temporary refs are deleted right after.
- `untracked/<path>` mirrors untracked, non-ignored files (mtime preserved).
- `clean: true` means clean AND fully pushed; then no bundle and no untracked copy.
- Cap: bundle + untracked above 200 MiB is dropped; `tooLarge` holds the size, metadata only.

`status.json` (per host, read by the companion):

```json
{ "myapp": { "diverged": true, "from": "<host>", "at": "<iso>", "files": ["src/a.ts"], "exportedAt": "<iso>" },
  "old":   { "retireRefused": true, "why": "uncommitted changes: x.ts", "at": "<iso>", "by": "<host>" } }
```

## 14. `vault.config.json`

```json
{
  "roots": { "home": "%USERPROFILE%", "dev": "C:\\dev" },
  "excludeDirNames": ["node_modules", ".venv", "venv", "__pycache__", ".git", ".tscache", "dist", ".next", ".turbo"],
  "include": [
    { "root": "home", "type": "dir", "path": ".claude", "exclude": [".credentials.json*", "sessions/", "ide/", "shell-snapshots/", "cache/", "debug/", "downloads/", "backups/", "session-env/", "security/", "statsig/", "telemetry/", "skills/gstack/", "*.lock", "*.vault-tmp", ".last-cleanup", ".last-update-result.json", "mcp-needs-auth-cache.json"] },
    { "root": "dev", "type": "envfiles", "path": "", "maxDepth": 4 }
  ]
}
```

- Roots expand `%VAR%` and a leading `~`; an env var `CLAUDE_VAULT_ROOT_<NAME>` overrides a root
  (used for tests).
- Include types: `dir` (whole tree minus excludes), `file` (one file), `envfiles` (every
  `.env` or `.env.<anything>` not ending in `.example`, up to `maxDepth` levels, skipping
  `excludeDirNames`).
- Exclude rule syntax: `dir/` (that directory), `*suffix`, `prefix*`, or an exact relative path.
- Symlinks and reparse points are skipped.
