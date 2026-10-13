---
name: agent-access-and-toolchains
description: The map of HOW an agent gets access to everything a repo touches - build toolchains (Android, desktop, iOS), secrets (.env, signing keys, test logins), and dashboards (Supabase, Render, Cloudflare, Stripe, GitHub, RunPod) - plus what you can install yourself versus what only the owner can grant, and the law on handling secrets. Read it THE MOMENT you think "I don't have access to X" or "I can't build or verify this surface", BEFORE telling the user you are blocked. Most "no access" walls are self-serve (install a toolchain) or a known owner grant with a known path. Use when you hit a missing toolchain (gradle, cargo, xcode, adb), a missing env var or secret, a locked dashboard, "how do I build the app", "how do I deploy", signing keys, test credentials, a read-only API key, or "the other agent has access and I don't".
---

# Agent access and toolchains

> ## Adapt before use
> This is the generic map plus the install recipes that were verified on a
> Windows dev box. Section 5 is a fill-in inventory: once you know what THIS
> repo and THIS machine actually have, record it in the repo's own copy (names
> and paths only, never values). File names like `.env.example` are the
> expected shape; check the repo for the real ones.

> **Why this exists:** agents kept hitting "I don't have access to X" and
> stopping, when most of those walls were either self-serve (just install a
> toolchain) or a known owner grant. Nobody should be blocked by not knowing HOW
> to get access.

> **THE LAW ON SECRETS:** secrets are NEVER pasted into chat or into tool
> parameters. Files and dashboards only. Reference a secret by its env-var name
> or file path, never quote the value. Read it in-process (a script reads the
> var and uses it in a header); never echo it. This skill is the MAP (what
> exists, where it lives, how it is granted), never the values.

---

## 0. First move when you think you are blocked

1. **Is it a toolchain?** Section 1. Most are **self-serve: just install them**,
   no owner needed.
2. **Is it a secret or env var?** Section 2. The inventory is the committed env
   example file. The values come from the owner sharing the env file (never
   through chat).
3. **Is it a dashboard?** Section 3. The owner invites you to the team or
   project. Often you do not need the dashboard at all (section 4).
4. **Is it a read-only key that will not let you act?** Section 4. Look for
   where the write-capable credential legitimately lives before concluding "no
   access".

Only AFTER checking these, if still blocked, tell the user *exactly which item*
and *which grant path* you need. Never a vague "I don't have access."

A repo with several surfaces should have a script that prints, per surface,
whether its toolchain exists on this machine and SKIPS the rest. If it exists,
run it first. If it does not, that is a good thing to build.

---

## 1. Build toolchains: mostly self-serve

### Android: local Gradle. You can install everything yourself.
Verified working on a Windows box with no Android Studio.

- **JDK 17** (when the build targets Java 17):
  `winget install EclipseAdoptium.Temurin.17.JDK`.
- **Android SDK:** download the command-line tools zip from Google's repository
  (`https://dl.google.com/android/repository/`, the `commandlinetools-win-*_latest.zip`
  file; use `curl.exe -sL`, PowerShell's `Invoke-WebRequest` is slow), unzip to
  `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\`, then install packages:
  `sdkmanager --sdk_root=<sdk> "platform-tools" "platforms;android-NN" "build-tools;NN.0.0"`
  with NN matching the project's compileSdk.
- **License acceptance does not work from piped stdin in a non-interactive
  shell.** `sdkmanager --licenses` hangs or ignores the piped "y". The
  workaround is to write the license hash file(s) directly into
  `%LOCALAPPDATA%\Android\Sdk\licenses\` (the file `android-sdk-license`
  containing the accepted-license hash lines that a machine with accepted
  licenses has; copy them from one, or from the SDK's own license listing).
  This accepts Google's license on the owner's behalf, so say you did it.
- **Build:** from the Android project directory, set `JAVA_HOME` and
  `ANDROID_HOME`, then `.\gradlew.bat assembleDebug`. The wrapper downloads its
  own Gradle. No `local.properties` is needed if `ANDROID_HOME` is set.
- **The piece you cannot self-serve:** a good build reads the env file and
  HARD-FAILS if required client config is missing (the OAuth client id, the
  backend URL and public key). That guard is deliberate, so you cannot ship an
  app that cannot authenticate. If it trips, name the missing var and ask the
  owner for the complete env file.
- **Install on a device, screenshot, logcat:** the `android-device-bridge` skill.
  Never adb-install onto the owner's PERSONAL phone. Test device only.

### Desktop (Tauri): CI-only for releases; local builds are heavy.
- **Releases are built by CI.** The workflow file IS the recipe (toolchain,
  frontend build, `tauri build`, signing). **NEVER publish from a local build.**
  Probe the live update manifest before touching anything.
- **Local build (only if you must):** `rustup` with the `stable-msvc` toolchain
  + **Visual Studio Build Tools with the C++ workload** + the workspace's Tauri
  CLI. Landmines: set `RUST_MIN_STACK=67108864` or rustc can crash with
  `STATUS_STACK_BUFFER_OVERRUN`; kill any running copy of the app first (the
  linker cannot overwrite a locked exe); build the frontend before cargo.
- **Signing (owner / CI secrets):** the updater signing private key (the key
  file CONTENT, single-line base64, no trailing newline) and its password,
  stored as GitHub Actions secrets. The updater **public key** lives in the
  Tauri config and must match the private key that signs the release.
- Full detail: the `tauri-desktop-app` skill.

### iOS: macOS only. No Windows or Linux box can build it.
- macOS CI runners are the compiler. Do NOT attempt an iOS build off macOS.
  Full detail: the `ios-build-from-windows` skill.

---

## 2. Secrets and env

- **One env file, at the repo root, gitignored.** Never per-app copies drifting
  apart. It holds everything: database URL and keys, GPU provider keys, AI
  provider credentials, email provider key, payment keys, OAuth client ids.
- **The inventory is the committed example file** (every var, empty value).
  That is your checklist of what should exist. **Law: any env var the code
  reads MUST appear in the example file.** If you find one that does not, that
  is incomplete work to flag.
- **Grant:** the owner shares the env file directly, never through chat. A
  given machine may hold a PARTIAL env file (a real case: one box was missing a
  single OAuth client id, which blocked the Android build). If a var is
  missing, name it and ask. If the example file does not list a var you were
  told exists, your checkout may be stale: sync it first.
- **Server-only keys never get a client prefix.** A service-role key that
  bypasses row-level security must never be a `NEXT_PUBLIC_*` / `VITE_*` var
  and must never reach a client bundle. Public/anon keys are client-public by
  design.
- **Some values live only on the host** (Render env vars set by the owner), not
  in the local env file. You cannot read those locally; do not go hunting for
  them, and never pull a production secret into your shell to run a local
  script. Read logs and the database instead.
- **GitHub Actions secrets** (repo Settings, Secrets, Actions): signing keys,
  store API keys. Grant: repo collaborator access, or the owner runs
  `gh secret set`. A secret that IS in the local gitignored env file you may
  set into the GitHub vault yourself, piping it without echoing the value.
  Newline hygiene matters: `printf '%s' "$(cat keyfile)" | gh secret set NAME`
  (a trailing newline from a UI paste is a classic silent corruption).
- **Test login credentials:** a gitignored file at the repo root, referenced by
  PATH, never quoted. Never guess credentials at a login wall; read the file.
- **Store reviewer / demo accounts are load-bearing.** Never cap, downgrade or
  rotate the account an app-store reviewer logs in with, or review breaks.

---

## 3. Dashboards (owner invites)

| Dashboard | What it is for | How granted |
|---|---|---|
| **Supabase** | database, RLS, error tables, migrations | Owner invites. NOTE: a database URL in the env file already covers migrations, audits and the error/alert tables. You may not need the dashboard. |
| **Render** | production hosting for servers and SSR apps, their production env vars, deploy logs | Owner invites you to the team, or connects a Render MCP / API key |
| **Cloudflare** | Pages (static sites, download and update manifests), DNS, CDN, TLS | Owner invites |
| **Stripe** | products, prices, payments | Owner invites; the API keys themselves live in the env file / host |
| **GitHub** | code, Actions secrets, CI | Owner adds you as a collaborator |
| **RunPod** | GPU pods, serverless endpoints, volumes | Owner provides an API key (check whether it is read-only) |

---

## 4. You usually have more access than it looks

Before saying "no access", check what the credentials you DO hold unlock:

- **The database URL / service role is the big one.** It gives full database
  access for audits, migrations (with the owner's go-ahead), and the error and
  alert tables. Many "I need the dashboard" tasks are just a query.
- **A read-only provider key is not the end.** If the app itself calls a
  provider (a GPU endpoint, a messaging API), the credential it uses lives
  somewhere the app can read: the host's env, or a table in the database. If
  the app stores per-endpoint keys in a service-role-only table, reading one
  with the service role and using it in-process (never printed) is the
  intended path for operating that endpoint. See `gpu-training-and-serving`.
  This is for operating the owner's own infrastructure within the task you
  were given. It is not a license to escalate beyond it: creating, deleting or
  resizing paid resources is still the owner's call.
- **Your git push credential is separate from the host's git pull credential.**
  Your push can succeed while the host's deploys silently stop ("access to the
  Git repository was denied" on the host side). Main advances; production
  stays stale. That fix is owner-side (reconnect the host to GitHub).
- **Logs may be reachable through an MCP connector** even when you have no
  dashboard login. Check for one before asking the user to paste logs.

**What stays owner-only until granted:** setting host env vars, triggering or
rolling back a deploy, creating/deleting/resizing paid infrastructure, revoking
certificates, anything on a physical device (unlock, tap Allow, replug).

**Ask for durable grants, not one-off favors.** When the same wall is hit
twice, tell the owner the specific grant that removes them from the loop: a
read/write provider API key in the env file, a host API key plus a per-service
deploy hook URL, a stable SSH path, or moving a hand-restarted service to a
git-built one so code changes deploy themselves.

---

## 5. What THIS machine has versus gaps (fill in per repo)

Keep this section current in the repo's copy. Names and paths only.

**Has:**
- (example) repo checkout; database URL in the root env file; Node and pnpm;
  JDK 17 + Android SDK + build-tools; adb to the test device.

**Gaps, and the grant path for each:**
- (example) missing OAuth client id in this box's env file: owner shares the
  complete env file.
- (example) Rust/MSVC for desktop local builds: self-install; rarely needed
  because releases are CI.
- (example) macOS: not possible on this box; iOS is CI-only.
- (example) Render / Cloudflare / Stripe dashboards: owner invites, only if a
  task needs the dashboard rather than the env file or the database.

**Bottom line for a new agent:** list the three or four highest-value remaining
grants in order, so the owner can fix them in one sitting.

## Related

- `android-device-bridge` - adb to a physical test device.
- `ios-build-from-windows` - the macOS CI loop and TestFlight.
- `tauri-desktop-app` - desktop signing and release detail.
- `gpu-training-and-serving` - operating live GPU pods and endpoints.
- `infrastructure-overview-template` - where each surface runs and deploys.
- `error-alert-system` - triage needs only the database URL, which you usually have.
