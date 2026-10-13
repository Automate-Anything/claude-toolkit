---
name: deploy-freshness
description: How every surface of an app picks up a new deployment without stranding a user on stale code - browser apps, a static marketing site, a desktop app, and mobile apps each have a different update model. Read it BEFORE changing the deploy pipeline, cache headers, a service worker, the version endpoint, or any auto-reload / update-prompt code, and before shipping an API or schema change that an old client could still call. It encodes the guarantee that a user with the app already open NEVER gets a broken or stale page after a deploy. Use when the user mentions deploy, stale page, cache, refresh, "new version", build id, chunk load error, "Failed to fetch dynamically imported module", service worker, auto-update, updater, or "they're seeing the old version".
---

# Deploy freshness: never a stale page

> ## Adapt before use
> This describes how freshness SHOULD be wired. The cache-header and
> chunk-recovery layers are the industry-standard pattern; the build-id prompt
> and skew-rejection layers are a design that closes the gap they leave. Nothing
> here exists in a repo until you build it, and header names, routes and env
> names below are EXAMPLES. Read the repo's real deploy path before copying
> anything, and update this file with the real names once it is built. Repos
> often carry stubbed or experimental update logic next to the live mechanism:
> port only what is actually in the deploy path, never dead code.

> **The guarantee:** a user with a surface already open never gets stranded on
> old code after a deploy. Either they seamlessly get the new version, or they
> are clearly told to refresh. Never a silent white screen, a broken API call
> against a changed backend, or a dead lazy chunk.

---

## 0. Why this is not one problem

An app with several surfaces has several different update models. A single
"auto-reload" answer is wrong. Match each surface to its real mechanism:

| Surface | Ships as | Update model |
|---|---|---|
| Browser app / portal | SPA or SSR app on a host (Render, Cloudflare Pages) | section 1: cache headers + chunk-error reload + build-id prompt |
| Marketing / landing site | static export | section 2: cache headers + 404 rule (no app state to strand) |
| Desktop app | native binary (Tauri, Electron) | section 3: signed updater, checked on launch and on an interval |
| Android app | Play Store (or a self-hosted APK) | section 4: store update, optional in-app update API |
| iOS app | App Store | section 4: store update, no silent forced update |

The browser is the urgent one: open tabs live for hours or days. The native apps
are store or updater problems.

---

## 1. Browser apps: the core, three layers

### 1a. Cache headers: the linchpin

HTML must never be cached. Content-hashed assets cache forever. Bundlers
(Next, Vite) already content-hash their static output; the job is to make the
**HTML documents** always fresh, so a returning tab fetches markup that points at
chunks which still exist.

- HTML documents: `Cache-Control: no-cache` (that is, `max-age=0, must-revalidate`).
- Hashed static assets: `public, max-age=31536000, immutable`. The framework
  usually sets this; verify it survives any custom header rules and any CDN
  cache rule in front.

**Never blanket `no-cache` everything.** That throws away the immutable-asset
win and hurts every page load.

### 1b. Chunk-load recovery: the reactive rescue

When a deploy replaces hashed chunks, an open tab navigating to a lazy route
imports a file that no longer exists. Catch it and reload once.

- Vite exposes this as the `vite:preloadError` event.
- In Next (and generally): a route-level error boundary plus a global
  `unhandledrejection` check for `ChunkLoadError` or "Failed to fetch dynamically
  imported module".
- **Reload once, not in a loop.** Guard with a sessionStorage flag that is
  cleared on a successful load, so a genuinely 404ing chunk cannot spin the tab.

### 1c. Build-id detection: the proactive layer

The reactive layer only fires on navigation to a purged chunk. A tab sitting
open on one working screen, calling the API, never navigates. A changed API
would break it silently. Close that gap:

- **Emit a build id.** A stable token per deploy (the git commit sha or the
  host's deploy id), baked into the client at build time AND served from a tiny
  version route that returns the *current server's* build id.
- **Check on focus and navigation, not a tight poll.** On `visibilitychange`
  (tab refocused) and on route change, fetch the version route. Cheap and
  event-driven: it fires only when the user comes back to the tab. A slow
  backstop poll (every few minutes) is optional, not required.
- **Compare, then prompt. Do not force.** If the served build id differs from
  the tab's baked-in id, a new version is live. Show a small, dismissible "A new
  version is available, refresh" banner. **Do not auto-reload a tab the user is
  working in:** a forced reload mid-task loses in-progress work (an unsaved
  form, a recording, a half-built cart). The user refreshes when they are
  between tasks. If the app has a provably safe moment (idle, nothing unsaved),
  a silent reload there is fine.
- **Exception: a hard break.** If an API call returns a typed "client too old"
  signal (1d), escalate from the gentle banner to a blocking "please refresh"
  state, because continuing is broken, not merely stale.

### 1d. API / schema skew safety

An old tab that reaches the backend after a breaking change must fail loud and
safe, not corrupt data:

- The client sends its build id as a header on API calls.
- The server MAY reject with a typed error when the skew is incompatible. Not on
  every mismatch: only when the contract actually broke. The client maps that to
  the hard-break state in 1c.
- Tie it into the error system: a spike of skew rejections is an alert. It means
  a deploy shipped a breaking change without a compatible transition.
- Where the gap is the database rather than the API (code deployed before its
  migration), cover the window with the `maintenance-banner` skill.

---

## 2. The static marketing site

The simplest case: no app state, no auth session, no long-lived tab doing work.
The standard Cloudflare Pages recipe:

- `_headers`: HTML `no-cache`, hashed assets `immutable`. If the site also hosts
  download payloads or update manifests (an installer, a `latest.json`), mark
  those `no-cache` too.
- `_redirects` (or the host equivalent): a missing hashed asset returns **404**,
  never the HTML fallback. Otherwise a dynamic import gets `text/html` and fails
  with a MIME error instead of a clean, catchable 404.
- A visitor reloads and gets the new page. Nothing to detect.

---

## 3. Desktop app

Not the browser model: a native binary. The updater is the mechanism, and it is
a real task, not a config toggle.

- Configure the updater with a signed update feed (an endpoint returning the
  latest version plus a signature). It checks on launch and can check on an
  interval.
- Updates are **signed.** Ship the public key in the app; keep the private key
  in the release secret store, never the repo.
- Policy: check on launch, download in the background, apply on next restart or
  at a provably idle moment. Never interrupt active work to update.
- The full release path, including the version and cache landmines, is in the
  `tauri-desktop-app` skill.

## 4. Mobile (Android / iOS)

Store-governed. The browser mechanism does not apply.

- **Android:** the Play Store handles updates; optionally use the in-app update
  API for a soft or forced prompt. A forced in-app update is appropriate only
  for a genuine hard break.
- **iOS:** App Store updates. An app cannot self-update, and there is no silent
  forced update. A "please update" gate must pass review and be honest about
  why. A freshness nudge is the most that is possible.
- **Both:** the build-id header from 1d still applies. A stale app hitting a
  changed API must get the same typed "too old" signal and show an update
  prompt.
- **A webview shell (Capacitor) is both worlds:** the native shell updates
  through the store, the web layer may update over the air. Decide and document
  which changes need which channel.

---

## 5. The rule that ties it together

Every surface answers the same two questions:

1. **Does a returning user get fresh code?** (headers / store / updater)
2. **If they are stuck on old code, do they fail loud and recover, never
   silently break?** (chunk reload, build-id prompt, skew rejection)

A surface that cannot answer both is not done.

**Verify it for real:** actually deploy twice and confirm an open tab picks it
up. "The header looks right" is not a result. After any deploy, confirm each
surface serves the build you pushed: a health or version route that returns the
commit, checked against your push.

---

## 6. What NOT to do

- **No service worker** unless there is a concrete reason (real offline use, an
  installable PWA). A service worker adds its own stale-cache failure mode: it
  can serve an old bundle to the very tab testing the deploy. Do not add caching
  infrastructure to solve a freshness problem. If the app already has one, treat
  it as a first-class freshness surface: prompt-style registration, a
  network-first strategy for navigations, and remember that errors reported
  from a sticky old-worker tab after a deploy are stragglers, not proof the fix
  failed (compare last-fired time to deploy time).
- **No forced auto-reload of a tab the user is working in.** Prompt; let the
  user pick the moment.
- **No blanket `no-cache`** on everything.
- **No copying update logic you have not traced into the deploy path.**

## Related

- `error-alert-system` - a spike of skew rejections is an alert.
- `maintenance-banner` - the code-versus-schema window.
- `tauri-desktop-app` - the desktop updater release path in full.
- `page-performance` - why the immutable-asset caching matters.
- `release-and-deploy-sequence` - the push that triggers all of this.
