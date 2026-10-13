---
name: tauri-desktop-app
description: The operating manual for a Tauri desktop app (TypeScript front end in a WebView + Rust back end) - how it is built, how it runs and gets its config baked in, how a release reaches BOTH the website download AND every already-installed user through the signed auto-updater, the release and verify flow, machine-owned versioning, the signing keys and where they live, and every landmine that has cost a round. Read it THE MOMENT you touch a Tauri app, its updater, the release pipeline, the download page, the installer, code signing, `tauri dev` / `tauri build`, or hear "cut a desktop release", "why isn't the new version downloading", "update the installed apps", "how do users get the update", "signature verification failed", "the installed app never updates", or think "I don't have the desktop toolchain or the signing key". Complements `agent-access-and-toolchains` and `deploy-freshness`.
---

# Tauri desktop app: build, run, release, update

> ## Adapt before use
> This describes how a Tauri release path SHOULD be wired, taken from a
> production Windows app. Paths, script names, artifact names (`App-Setup.exe`)
> and the feed URL below are EXAMPLES of the shape. Grep the repo for the real
> ones and update this file once the pipeline exists. **When this doc and the
> code disagree, the CODE wins:** read the code, then fix this doc.

**The one fact that governs releases:** a desktop release is not "on main". A
release is **built by CI into a signed installer**, and it reaches users **two
independent ways**: the website download (a new manual install) AND the in-app
auto-updater (every already-installed app). Both are fed by the SAME artifacts
(the update manifest plus the versioned installer) published to one place, so
they can never diverge. If you change desktop code and it does not end up in
those two places, **the users do not have your change.** Most of this skill is
how to make that happen correctly.

---

## 0. What it is

- A **Tauri** app: a TypeScript/Vite front end in a WebView, and a **Rust** back
  end (`src-tauri/`) for everything the OS gates (global hotkeys, always-on-top
  windows, clipboard, tray, taskbar, text injection into other apps).
- `src-tauri/tauri.conf.json` holds the product name, the bundle identifier, the
  version (machine-owned, section 3) and the updater config.
- The TS side usually sits in the JS workspace. The Rust side does NOT: it is
  its own Cargo crate, invisible to the workspace's build, typecheck and tests.
- **Capabilities** (`src-tauri/capabilities/*.json`) are the security allow-list
  for front-end-to-Rust calls. **A new `invoke` command must be granted there
  or it is denied at runtime.** Each window can have its own capability file.
- Give the dev front end a fixed port from the repo's port map. Never hardcode
  one ad hoc.

---

## 1. Run it locally (dev)

```bash
# The FRONT END only, in a browser tab (no Rust; a stub of the Tauri internals
# object can be injected to look-check the UI):
pnpm --filter <desktop-package> dev

# The REAL app (Rust back end + WebView front end), live:
cd <desktop-dir> && RUST_MIN_STACK=67108864 pnpm tauri dev
# First Rust compile takes minutes; it watches src-tauri and rebuilds on change.

# TS checks (Rust is NOT covered by these):
pnpm --filter <desktop-package> typecheck
pnpm --filter <desktop-package> test

# Rust checks:
cd <desktop-dir>/src-tauri && RUST_MIN_STACK=67108864 cargo check
cd <desktop-dir>/src-tauri && RUST_MIN_STACK=67108864 cargo test
```

- **`tauri dev` opens a real window.** Borderless, always-on-top or
  multi-monitor behavior is genuinely interactive. You usually cannot automate
  it headlessly. Make the math unit-testable in Rust and say plainly that the
  live behavior needs hands.
- **Kill any running release exe before a `cargo` / `tauri` build,** or the
  linker fails on the locked binary.
- A green JS build proves the TS compiles. It says **nothing** about the Rust
  back end or the installer.

---

## 2. How the built app gets its config: BAKED IN AT BUILD TIME

A desktop app is a shipped binary. It cannot read a server env file at runtime.
Its config is **compiled into the bundle** by Vite from the workspace env file:

- Point Vite's `envDir` at the repo root and set `envPrefix` to the client
  prefixes in use (`VITE_`, `NEXT_PUBLIC_`), so one root env file feeds every
  surface.
- Give every var an honest fallback:
  - Auth URL + public key absent: the app runs an **honest offline stub**, never
    a fake login.
  - Backend URL blank: falls back to the local dev server. **Production builds
    must have the production URL baked in.**
  - Web portal URL blank: falls back to the hosted portal.
- **CI bakes the production values** from GitHub Actions secrets and variables
  into the build env before the release script runs, so the shipped installer
  is the REAL app.
- **A server-only key must NEVER carry a client prefix or reach the desktop
  bundle.** A service-role key bypasses row-level security; anyone can unpack
  an installer. The anon/public key is client-public by design.
- **The signing keys are NOT bundled.** They never touch the front end. They are
  used only by `tauri build` to sign the installer and the update manifest.

---

## 3. Versioning: machine-owned, strictly increasing (do NOT hand-bump)

A version-stamping script runs BEFORE Tauri reads its config (called explicitly
at the top of the release script, so the stamp is authoritative).

- **version = `<major>.<minor>.<patch>`, where patch = `git rev-list --count HEAD`**
  (the commit count), then floored above whatever the last published release
  metadata recorded, so a **rebuild at the same commit still produces a HIGHER
  version** and can never collide.
- **WHY:** humans forgot to bump. Three builds shipped with the same version
  number and different bytes, so an installed app compared its version to the
  identical published one, decided it was current, and never updated. A version
  that can repeat is a version the updater cannot trust.
- **Never hand-edit the version for a release.** The script owns it. The
  major.minor is bumped by hand ONLY for a deliberate product milestone.
- The version is a commit count, so it is NOT a human-readable "what changed".
  The user-facing note is separate (section 4b).

---

## 4. THE RELEASE: how a change reaches users (both channels)

A release produces four artifacts and publishes them to one static location
that the marketing site serves (for example a `downloads/` folder in the
landing site's public directory, deployed by Cloudflare Pages):

| Artifact | Who consumes it | Purpose |
|---|---|---|
| `App-Setup-<version>.exe` | the auto-updater (through the manifest url) | the signed installer at a **new path per release** (cache-proof) |
| `App-Setup.exe` | the website **download button** | the STABLE-named copy the page links to |
| `latest.json` | the in-app updater's endpoint | `{version, notes, pub_date, platforms.<target>.{signature, url}}` |
| `RELEASE.json` | the download button + the freshness sweep | `{version, notes, builtAt, sha256, bytes, commit}`; the button prints the version and build date |

### 4a. The normal path: CI builds it (you do NOT build installers by hand)

A GitHub Actions workflow on a Windows runner is the release pipeline. Triggers:

- **a push to the production branch** touching the desktop app, shared packages,
  the lockfile, or the workflow itself (so a shared-package change that alters
  the installer rebuilds too);
- **`workflow_dispatch`** (a button, or `gh workflow run`);
- **a daily cron "freshness sweep"** that republishes ONLY if the published
  installer is behind the production branch's desktop tree (it compares the
  commit recorded in `RELEASE.json`).

What it does: preflight the signing secrets, run the release script (stamp the
version, `tauri build`, sign, compose the manifest and release metadata, copy
the versioned and stable installers into the publish folder, keep the current
plus 2 previous versioned installers), commit the refreshed artifacts back to
the production branch with a `[skip actions]` message, then verify the LIVE
site actually serves the new version.

> **So: to ship a desktop change, it has to land on the production branch.**
> The push trigger builds the installer, and CI commits and publishes it.
> Landing it there is an owner-authorized action like any other push. The
> automated `[skip actions]` installer commit is that publish. It is NOT a code
> change and does not re-trigger CI.

### 4b. The "what's new" line

The version is a number. The user-facing note comes from the **release commit's
subject** (or an explicit release-note env var), cleaned of the
conventional-commit prefix. It rides in the manifest's `notes` and the updater
shows it on the install card, so a user sees WHAT changed, not just a number.

**Owner rule: every update card states one line of what is new.** The release
commit's subject IS that line. Write it as a clean, user-facing sentence, with
no em dashes.

An **in-app announcement** (a what's-new inbox, a bell) is DELIBERATELY a
**separate, post-live step**, not part of the build. Post it only after the live
manifest actually serves the new version. Posting during the build advertised a
version before it was installable: the bell said the new version was available
while the site still served the old one and the Install button had nothing to
install.

### 4c. Manual release (rare: only if CI is unavailable)

The release script can do the whole publish locally. It REQUIRES the signing key
and password in env or it hard-fails (it must refuse to publish a feed-less or
unsigned release). A `--no-build` mode publishes an already-built bundle. You
almost never do this. If you do, the published artifacts are then committed
with exact pathspecs, on the owner's instruction, and you run the live
verification CI would have run.

---

## 5. How an ALREADY-INSTALLED app updates itself

Tauri's updater plugin, configured under `plugins.updater` in the Tauri config:

- **endpoint:** the public URL of `latest.json`.
- **pubkey:** the minisign public key baked into the app. It verifies the
  installer's signature, so a tampered or wrong installer is refused.
- **`createUpdaterArtifacts: true`** so `tauri build` emits the `.sig` that the
  manifest carries.

Client flow:

1. On a cadence, and on demand when the user opens what's-new, the app calls
   `check()`, which fetches the manifest. If its version differs from the
   running one, the app holds a pending update and offers Install with the
   one-line note.
2. Accept: `downloadAndInstall()` (downloads the versioned installer, **verifies
   the signature against the pubkey**, installs), then `relaunch()`.
3. **When it may install silently** is a small policy module: only when the
   window is unfocused AND idle past a threshold, and NEVER mid-task or with an
   unsaved draft. A silent relaunch must never interrupt the user or lose work.
4. A failed check keeps any offer already held (a transient failure must not
   withdraw a valid one) and is reported to the error system, identifiers only,
   so a stuck updater is never silent.

**Every installed user gets a new version automatically once the live manifest
names a higher version than theirs.** No action from them. The website download
is only for NEW installs. Both are the same artifacts, so they never disagree.

---

## 6. Signing keys and secrets

**Never paste a secret value into chat, a commit, or a tool parameter.**
Reference by name or path.

| Name | What it is | Lives in | Used by |
|---|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the minisign private key **CONTENT** (single-line base64, **NO trailing newline or whitespace**) | GitHub Actions secrets | `tauri build` in CI, to sign the installer and manifest |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | that key's password | same | same |
| `plugins.updater.pubkey` | the matching PUBLIC key | committed in the Tauri config | the installed app, to verify a download |
| client auth URL + public key, backend URL, portal URL | client-public config | root env file, baked into the build | the app at runtime |

- The signing secrets are the ONLY thing that gates a signed release. If they
  are missing, the CI preflight must **fail loudly** with the exact fix. There
  is no "unsigned but shipped" path: Tauri hard-fails a build that has a pubkey
  but no private key.
- **A trailing newline from a UI paste is the classic corruption.** It sails
  through setup and then breaks verification. Set it newline-free:
  `printf '%s' "$(cat <keyfile>)" | gh secret set TAURI_SIGNING_PRIVATE_KEY`.
- The private key and the pubkey are generated once with Tauri's signer and
  MUST be a pair, or every auto-update fails signature verification. **Losing
  the private key strands every installed app** on its current version (they
  can only verify updates signed by it). Back it up where the owner keeps
  release secrets.
- **Blocked by "I don't have the signing key"?** It is an owner-held secret in
  the CI vault. CI uses it automatically; you do not need it locally unless
  doing a manual release.

---

## 7. The landmines (each has cost a round: check BEFORE you hit them)

- **RUSTC STACK CRASH.** A Rust build without `RUST_MIN_STACK=67108864` can
  crash with `STATUS_STACK_BUFFER_OVERRUN` on Windows. Always export it for
  `cargo` and `tauri` builds. Kill the running exe first; stop the dev front
  end before cargo.
- **THE VERSION MUST NOT REPEAT** (section 3). A repeated version means
  installed apps never update.
- **CACHE-PROOF INSTALLER PATH.** The manifest url points at the VERSIONED
  installer, a new path per release, because a CDN cache rule was observed
  serving STALE installer bytes under the stable name, which produced
  "signature verification failed" during a release burst. The stable name is
  only for the download-page link. Mark the download payloads and manifests
  `no-cache` in the static host's headers file (HTML too); `immutable` only for
  content-hashed assets.
- **KEEP 2 PREVIOUS INSTALLERS.** Pruning to only the current one returned 404
  to a client that had fetched the manifest just before a release and then went
  to download the now-deleted artifact. Do not lower the retention.
- **`[skip actions]`, NOT `[skip ci]`, on the automated installer commit.** Both
  skip GitHub Actions, but the static host's own deploy also reads skip markers:
  `[skip ci]` can make Cloudflare Pages skip the deploy that publishes the
  installer. Do not change the wording.
- **ANNOUNCE POST-LIVE,** not during the build (4b).
- **THE SERVER DEPLOYS SEPARATELY.** A protocol change that needs both the
  desktop app and the backend is two deploys from possibly two branches. The
  desktop release does not carry the server change.
- **SHARED CHECKOUT / SHARED INDEX.** When many agents share one tree: stage
  EXACT pathspecs, never `-A` or `.`. A bare `git commit` sweeps other lanes'
  staged files, and even `git commit -- <path>` can sweep their uncommitted
  hunks in a file you also touched. Commit with a message file plus exact
  paths, and only when the owner asked.
- **LINE ENDINGS ARE MIXED PER FILE** on a Windows checkout. Edit tools preserve
  each file's line endings, but verify you did not flip a whole file (a flip
  shows as a diff about twice the file's line count). `git diff` is sometimes
  silently suppressed in a sandbox: re-read files to verify.
- **FRESHNESS IS VERIFIED, NOT ASSUMED.** After a release, confirm the LIVE site
  serves the new version: `curl -fsSL <feed-url> | jq .version` must equal the
  pushed version, and the versioned installer must download with the sha256
  recorded in `RELEASE.json`. CI does this; if you release by hand, you must.
- **"IS IT INSTALLED" IS NOT "IS THE CODE RIGHT".** The app may be uninstalled
  on the dev box on purpose. Check the build tree, not the Start menu.
- **WINDOWS TASKBAR PIN / BADGE NEEDS THE AppUserModelID.** Pinning and badging
  depend on the process claiming its AUMID. A pin that "fell back" to a generic
  icon was the app's bug, not Windows'.
- **GLOBAL HOTKEY STATE.** A low-level keyboard hook in Rust and a state machine
  in TS must agree on toggle versus hold state. A desync ate about one tap in
  five. Also watch remote settings that re-apply on every sign-in
  (remote-wins) and silently undo a local change.

---

## 8. The "always update everywhere" checklist

When you change desktop code, before you call it done:

1. **It is on the production branch** (owner-authorized), so the CI trigger
   built and published the installer, the manifest and the release metadata.
2. **The release commit subject is a clean one-line "what's new".**
3. **CI went green AND the live feed serves the new version**
   (`curl ... | jq '{version,notes}'`). A green push is not a served release
   until this matches.
4. **The in-app announcement is posted AFTER it is live.**
5. **Other surfaces checked.** A shared contract (a wire protocol, a formatter,
   auth/session, an entitlement check, the settings shape) reaches web, Android
   and iOS too. Fix it on EVERY surface it touches and say which you changed
   versus verified. A Rust-only window/tray change is desktop-only; a lifecycle
   or protocol change usually is not.
6. **Failures are wired into the alert system.** Every `catch` that returns a
   fallback reports the error, IDENTIFIERS ONLY (see `error-alert-system`). A
   desktop app may have no HTTP route of its own; report over the channel it
   already has.
7. **Any solved problem is recorded** in the repo's fix log (cause + solution).

---

## 9. Rules (non-negotiable)

- **A desktop change reaches users only through the published installer and the
  manifest.** "On main" is not "shipped". Verify the live feed.
- **Never hand-bump the version.**
- **Signing secrets gate every release** and live only in the CI vault (plus the
  gitignored env file for a manual build). By name or path, never pasted.
- **`RUST_MIN_STACK=67108864` for every Rust build;** kill the running exe first.
- **Never publish from a local build** when CI is available.
- **Exact pathspecs, message-file commits, only on the owner's instruction.**
- **Announce post-live.**
- **Report honestly:** built (CI green) versus served (live manifest) versus
  verified on a machine (installed and exercised).

## Related

- `agent-access-and-toolchains` - toolchain install and every secret's grant path.
- `deploy-freshness` - the serve-fresh laws this depends on.
- `error-alert-system` - wiring every new failure path.
- `ios-build-from-windows`, `android-device-bridge` - the sibling clients.
- `release-and-deploy-sequence` - how work reaches the production branch.
