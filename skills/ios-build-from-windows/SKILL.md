---
name: ios-build-from-windows
description: How to do ANY native iOS work from a Windows (or Linux) machine that has no Swift toolchain - compile, run tests, screenshot, wire-install to a physical iPhone over USB, pull files off the phone, and ship to TestFlight - by driving macOS GitHub Actions runners as the compiler. Read it BEFORE any iOS task on a non-Mac box: "build the iOS app", "does it compile", "typecheck iOS", "run the iOS tests", "put it on my iPhone", "wire install", "ship a TestFlight build", "cut an iOS release", "iPad / iPhone screenshots", "Appetize link", "the keyboard extension", "pull the screen recording off the phone". Covers the CI compile-and-test loop, the USB install path on Windows (pymobiledevice3 + the Apple Devices muxer), the browser simulator look-check, the release pipelines, screenshots, and every landmine that has cost a round (certificate quota, wrong-artifact installs, build numbers, one fix per build, Apple platform limits). For App Review rules, rejections and App Store Connect metadata, read `apple-app-store-submission` instead; this skill is the build-and-ship mechanics.
---

# iOS from a Windows box: build, verify, ship

> ## Adapt before use
> This describes how the iOS lane SHOULD be wired, taken from a production app
> built entirely from a Windows machine. Workflow file names, tag patterns,
> script names and target names below are EXAMPLES of the shape. Grep the repo
> for the real ones, and update this file with them once the pipelines exist.

> **The one fact that governs everything:** a Windows box has **no iOS
> toolchain**. `swiftc` is not there; UIKit, SwiftUI, AVFoundation and CryptoKit
> do not exist off Apple platforms. **The macOS GitHub runner is your compiler,
> test runner, screenshotter and signer.** There is no honest local shortcut.
> "The code looks right" is never a green build. Everything below is how you
> drive that remote toolchain from here.

---

## 0. Project shape that makes this workable

- **Generate the Xcode project, do not check it in.** An XcodeGen spec
  (`project.yml`) with directory globs means new source files are picked up
  automatically, and nobody hand-merges a `.xcodeproj` from a machine that
  cannot open it.
- **Put testable logic in a library target.** Typical split: the App target, a
  Core library (protocol, data, auth, errors), and any extensions (keyboard,
  share, widget). Unit tests can reach ONLY the library. App-target and
  extension-target logic is **compile-verified in CI only, never unit-tested**.
  To test app logic, extract the pure part into the library.
- **Config injection, with an honest stub.** A secrets/config source file ships
  in the repo with EMPTY defaults (so a build without secrets is an honest
  stub, never a fake sign-in). CI overwrites it from GitHub secrets so the
  built app is the REAL app.
- **Two version numbers.** The marketing version (user-visible) lives in the
  project spec. The build number is overridden per build by CI (section 5).

---

## 1. Compile and test (the "iOS typecheck"): after every batch of edits

Wrap it in one repo command if you can (a script that pushes, dispatches the
macOS build-and-test workflow, and reports pass/fail). Driving it by hand:

```bash
gh workflow run ios-build.yml --ref <branch>
gh run list --workflow=ios-build.yml --limit 3     # grab the run id
gh run watch <run-id> --exit-status                # several minutes wall time
gh run view <run-id> --json conclusion,status,jobs \
  -q '{conclusion, steps:[.jobs[].steps[]|{name,conclusion}]}'
```

What a good build workflow does: generate the project, inject secrets, run any
grep guards, resolve an available iPhone simulator, **`clean build test`** on
the Simulator (ad-hoc signed), **Thread Sanitizer** on the library tests, then
the optional simulator upload (section 3) and screenshots (section 4).

**Make it `workflow_dispatch` only.** macOS runners bill at about 10x the Linux
rate. Never add a push trigger.

**The rules that keep this honest:**

- **A dispatched workflow builds the REMOTE ref.** The work has to be committed
  and pushed first, or CI compiles stale code and you chase a ghost. Committing
  and pushing need the owner's go-ahead (standing rule: an agent never commits
  or pushes on its own initiative), so get that for the lane up front, and
  state plainly when a compile is blocked on it.
- **Watch exit 0 is necessary, not sufficient.** Read the per-step conclusions.
  Confirm "Build and test" AND "Thread Sanitizer" are both `success`, not just
  that the watch returned. A skipped or soft-failed step can hide under a green
  watch.
- **Verify each file by reading it first.** You cannot compile here, so a
  careful read is the only pre-flight: brace balance, symbol names, an
  exhaustive `switch` that a new enum case would break.
- **Do not trust an empty `git diff`.** In some sandboxes `git diff` output is
  silently suppressed. Verify edits by RE-READING the files.

---

## 2. Wire-install to a physical iPhone (the FAST iteration channel)

For iterating on a device, **a USB install beats TestFlight**: zero Apple upload
quota, no processing wait. Announce before you wire-install.

**The loop:**

1. Build a signed device IPA in CI. Typical trigger: a tag (example
   `ios-device-N`) fires a workflow that archives, exports **ad-hoc**, and
   uploads the IPA as a run artifact. A device IPA is signed, so there is no
   dry-run mode: the signing secrets are required.
2. Install with a **SHA-guarded** installer script, never by hand. This exists
   because of a real failure: two lanes pushed device tags 44 seconds apart,
   the installer grabbed "the newest green artifact" (the wrong run), and the
   owner kept crashing on a bug that was marked fixed. The script must:
   - map **tag -> remote sha -> the CI run whose head sha EQUALS that sha**
     (never "newest");
   - download to a per-run directory;
   - refuse to install unless the app AND every embedded extension stamp a
     bundle version equal to that run's number;
   - offer a download-and-verify-only mode.

**The Windows muxer piece (this is what actually makes USB install work):**

- `pymobiledevice3` (pip; invoke as `python -m pymobiledevice3`, the exe is
  usually not on PATH) talks to the muxer of the **Apple Devices** Microsoft
  Store app (`AppleMobileDeviceProcess.exe`) on localhost port 27015. NOT
  iTunes, NOT libimobiledevice, NOT Xcode.
- `python -m pymobiledevice3 usbmux list` must return a non-empty JSON array
  before you can install. When it returns `[]`, in order of likelihood:
  1. **Phone LOCKED.** A locked iPhone is invisible to usbmux. Unlock it and
     keep it awake.
  2. **Stale muxer.** Force-stop `AppleMobileDeviceProcess` (it respawns in
     about 10 seconds); verify port 27015 is listening.
  3. **Unplug and replug the cable WHILE the phone is UNLOCKED.** This is what
     finally surfaces it.
- One-time preconditions: Developer Mode ON, the Trust pairing accepted, the
  phone's UDID registered in the developer portal.
- **You cannot unlock or replug the phone.** That step is always the owner's
  hands. When `usbmux list` is `[]` and no one is at the phone, that is a
  HAND-OFF, not a failure.

### 2a. Pulling a FILE off the iPhone (a screen recording, a capture, a log)

Same channel, different verb. The media library is reachable over AFC (Apple
File Conduit) once `usbmux list` shows the phone.

```
python -m pymobiledevice3 usbmux list                  # confirm the phone is visible
python -m pymobiledevice3 afc ls /DCIM/100APPLE        # camera roll; videos are IMG_*.MP4
python -m pymobiledevice3 afc pull /DCIM/100APPLE/IMG_00NN.MP4 <local-path>
```

- **The Git Bash path-mangling trap.** In Git Bash an argument like `/DCIM` is
  rewritten by MSYS into a Windows path under the Git install directory and the
  `afc` command fails "file not found". **Run the `afc` commands from
  PowerShell** (no POSIX path translation), or prefix with `MSYS_NO_PATHCONV=1`.
- **Finding the newest recording.** Screen recordings land in `/DCIM/100APPLE`
  as the highest-numbered `IMG_*.MP4`. `afc` has no `stat`, so pull the
  top-numbered file (or a couple) and inspect locally with ffmpeg
  (`ffmpeg -i <file>`): a phone screen recording is portrait, HEVC, a few
  minutes long. Extract a frame or two (`-ss <t> -frames:v 1 frame.png`) and
  look at them to confirm the on-screen flow before handing the file to anyone.

---

## 3. Browser simulator look-check (Appetize) - no device needed

Have every green build re-upload the just-built Simulator app to a hosted
simulator service at a **stable link** (the public key in a repo variable, the
API token in a secret). It reuses the build (seconds, zero extra macOS minutes)
and runs only after tests pass, so the link always represents green.

- **It is a LOOK check only:** layout, flows, RTL, screens. **NOT feel:** not
  the microphone, not audio, not haptics, not system permission alerts. Those
  are device-only. Report its results as look-checks, never feel-checks.
- **Interactive session minutes are the scarce resource** on a free tier
  (uploads are unmetered; sessions are not). Open the link only when
  verification genuinely needs it, and close the tab right after.
- Verify with a **screenshot** (see `browser-verification`). An accessibility
  `wait_for` can never see INTO the simulator: it is a video canvas.
- The app link is public. Do not stay signed into a real account in a session.

---

## 4. Screenshots (App Store / review)

- **Opt-in in the build workflow** via a dispatch input. Boot ONE iPhone
  simulator and capture each screen. A five-device sweep was infeasible: a
  runner can take many minutes to boot one simulator, and five blew the job
  timeout.
- **iPad:** a separate dispatch workflow that boots the largest iPad Pro
  simulator, whose native render matches the App Store's largest iPad slot (no
  framing, no upscale). Check the current required pixel sizes in
  `apple-app-store-submission`.
- **Build a screenshot harness into the app:** launch arguments that route
  straight to a given screen or state, so CI can capture it without tapping
  through the UI.
- **Apple accepts Simulator screenshots.** A physical device is NOT required.
  `xcrun simctl status_bar <device> override --time 9:41 ...` gives the clean
  marketing status bar.
- The PNGs upload as a run artifact: `gh run download <run-id> -n <artifact>`.

---

## 5. Ship to TestFlight

A release workflow fired by a tag (example `ios-release-*`), designed to be
**dormant by default and self-guarding:**

- **Secrets absent: DRY RUN.** Proves the project archives for a device
  (unsigned), then stops. Green with no Apple account needed.
- **Secrets present: REAL.** Signed archive through an App Store Connect API key
  (automatic signing, `-allowProvisioningUpdates`), export, upload to TestFlight.

**The mechanics that bite if you forget them:**

- **Build number = the release workflow's run number, NOT the tag number.** Tag
  15 can produce build 17. **Query App Store Connect for the state of builds;
  do not guess.** A small status workflow that reads builds, processing state
  and beta groups and prints a READY / PROCESSING verdict pays for itself.
- **The tag's sha decides the build content.** The uncommitted working tree
  does NOT ride. Tag the exact, CI-green commit.
- **ONE fix per TestFlight build.** Owner law: he judges each build on his
  phone against ONE expectation. Bundling two things destroys his ability to
  verify, even when nothing is broken. Hold everything else back and tag the
  minimal sha. Tell him explicitly what IS and IS NOT in each build. (Wire
  builds are exempt: a wire build is the branch tip, whatever it holds.)
- **The App Store Connect API key must be Admin role.** An App Manager key
  fails cloud signing with "Cloud signing permission error".
- **The store reviewer login is a real, unrestricted account.** Never cap,
  downgrade or rotate it, or review breaks.
- **A build attaches only to a MATCHING marketing version.** A build stamped
  1.0 will not appear in the build picker of a version record still called
  0.1.0. If a record is stuck in review with an old build, remove it from
  review (it becomes editable), fix the version number, then attach.
- **ITMS-90683 (rejected upload)** means a missing usage-description string for
  a capability the code links (a real case: an audio session option that
  allows Bluetooth made Apple demand the Bluetooth usage description). Grep the
  code for the framework before removing a capability to satisfy the reject;
  usually the right fix is to add the string and ship the next build.

Tagging and pushing a release tag are owner-authorized actions, like any push.
TestFlight can run autonomously once the owner has authorized the lane.
**Submitting a build to public App Store review is the owner's gated action:**
you guide them through App Store Connect, you do not click it through an API.
Everything about review itself (guidelines, the information-request reply, the
required screen recording, demo account, review notes) is in
`apple-app-store-submission`.

---

## 6. The landmines that have each cost a round

- **CERTIFICATE QUOTA (hard blocker).** Every CI run on a fresh runner can mint
  a throwaway "Apple Development" certificate through cloud signing. After
  roughly a dozen, Apple's quota is full and the archive fails with "maximum
  number of certificates, choose one to revoke". **Only the owner can fix it:**
  revoke the pile of "Apple Development" certificates in the developer portal,
  **KEEP the "Distribution Managed" one** (it is cloud-managed and never
  multiplies), then `gh run rerun`. This is a pause-and-hand-off.
- **MIXED LINE ENDINGS PER FILE.** On a Windows checkout some files are CRLF
  and most are LF. Edit tools preserve each file's existing line endings, but a
  NEW file must match its neighbors, and a whole-file flip shows up as a giant
  diff. Check with `grep -lU $'\r' <file>` in Git Bash.
- **SHARED INDEX.** When several agents share one working tree, a bare
  `git commit` sweeps other lanes' staged files, and even
  `git commit -- <path>` can sweep their uncommitted hunks in a file you also
  touched. When the owner has asked you to commit lane work: stage exact
  pathspecs and commit with `git commit -F <msgfile> -- <exact paths>`. Never
  `git add -A` or `git add .` here. (The one exception is an owner-ordered full
  deploy: see `release-and-deploy-sequence`.) Other lanes' unmerged files may
  sit in the tree; leave them.
- **TEST REACH.** Tests see only the library target. Anything else is
  compile-verified only. Say so when you report.
- **REDACTION SPLIT IN ERROR REPORTING.** If the error reporter redacts user
  text (correct for error messages: a crash string could carry user content),
  the ONE consented free-text channel (a "report a problem" box) must NOT be
  redacted, or the inbox arrives empty. This matters most for non-Latin
  scripts, where a script-based redactor wipes the whole message. Trim and cap
  the length, keep the text intact, scrub only the surrounding metadata, and
  guard the split with an inverse test pair. Everywhere else, IDENTIFIERS only
  ever leave the phone.
- **Newer-Swift-mode warnings** in the archive log (async-unavailable locks,
  main-actor conformance) are WARNINGS under the older language mode, not
  errors. They do not block.

---

## 7. Apple platform limits (things an owner may ask for that iOS FORBIDS)

Know these so you propose the honest adaptation instead of promising the
impossible:

- **iOS apps cannot self-update.** TestFlight and the App Store own the pipe. A
  freshness nudge is the most that is possible.
- **A keyboard extension cannot record audio or trigger system dictation.** The
  microphone has to live in the companion app; the keyboard hands off to it
  through a URL scheme or a shared-container bridge. The honest one-tap
  fallback is `advanceToNextInputMode` (hand off to the phone's own keyboard).
- **No API to prompt keyboard-enable or Full Access in-app.** The shortest
  legal path is opening the app's Settings page.
- **A keyboard extension can READ App Group defaults without Full Access but
  only WRITE with it.** So a "keyboard ran once" stamp is honest proof, but
  granting Full Access in Settings does not run the keyboard, so the stamp is
  legitimately absent until the keyboard types once. Design onboarding around
  that ordering.
- **Clipboard:** any `UIPasteboard.string` read from an extension fires the
  "pasted from" alert; metadata reads (change count, has-strings) never do. The
  "Paste from Other Apps" Settings row does not exist until iOS's first paste
  prompt on that install, which needs a real foreign copy on the clipboard, so
  a fresh install cannot complete it in onboarding. `UIPasteControl` does not
  work inside a keyboard extension.
- **iOS 26 draws a Liquid Glass container around every third-party keyboard.**
  An opaque custom panel sits inside it as a gray slab. The fix that worked:
  a near-clear panel background (alpha about 0.01, NOT fully clear, because iOS
  drops touches on fully transparent keyboard pixels), do not draw your own
  outer corners, gate it with `#available(iOS 26.0, *)`, keep the keys solid.
  Three attempts at height / corner / constraint fixes failed before the real
  cause was found. Do not repeat them.
- **No API for installed apps, most-used apps, or focusing another app's
  field.** The honest adaptation is a curated launcher of URL-scheme apps.
- **Custom keyboards should look like Apple's.** Real iOS grays and a soft gray
  key shadow. A hard black shadow reads as an Android Material tile and gets
  reported as "looks like Android".

---

## 8. Rules (non-negotiable)

- **The macOS runner is the compiler.** Never claim a compile without a green
  CI run.
- **CI builds what is pushed.** Nothing uncommitted is ever in a build. Commits,
  pushes and tags happen only on the owner's instruction.
- **Exact pathspecs** on a shared tree.
- **One fix per TestFlight build;** tell the owner what IS and IS NOT in it.
- **Announce before a wire-install;** the unlock and replug are the owner's hands.
- **Certificate quota and a genuinely missing secret are the only two real
  blockers.** Everything else, keep working. Secrets by file-path reference,
  never pasted into chat or parameters.
- **Report honestly which you did:** compiled (CI) versus look-checked (browser
  simulator) versus verified on device (wire install / TestFlight), with the
  evidence.
- **A fix lands on every surface it is relevant to.** A shared contract change
  (a protocol, a settings shape, an entitlement check) reaches every client;
  iOS is one of them.

## Related

- `apple-app-store-submission` - App Review, rejections, metadata, the review reply.
- `android-device-bridge` - the Android counterpart (real device over adb).
- `agent-access-and-toolchains` - how to get every secret and dashboard.
- `browser-verification` - driving the hosted simulator in a real browser.
- `deploy-freshness` - why a stale app still needs a "too old" signal.
