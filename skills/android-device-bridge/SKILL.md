---
name: android-device-bridge
description: How to reach a physical Android test phone over Wi-Fi with adb to install a build and verify it on a REAL device - screenshots, logcat, driving the app. Read it BEFORE any Android task that needs a running device instead of just a compile: "install it on the phone", "screenshot the app on device", "check the app on a real phone", "read the device logs", "does it work on device", "adb", "the test phone", "adb says unauthorized", "adb says offline". Covers installing adb (platform-tools only, no Android Studio), the connect / reconnect dance over flaky Wi-Fi, the one-time on-device authorization that only a human can do, targeting the device explicitly, binary-safe screenshots on Windows, building the APK from your own checkout, and the rule that this is a real person's device.
---

# Android device bridge

> ## Adapt before use
> This describes the bridge as it ran in production. The device address is
> deliberately a PLACEHOLDER here: `<DEVICE_IP>:5555`. The real address, the
> device model and the app's package name and log tag belong in the repo's own
> gitignored notes or env file, not in this skill. Fill in the app-specific
> bits (package name, log tag, APK path) once you know them.

---

## 0. What this is (and is NOT)

There is a shared physical Android phone on the same local Wi-Fi as the dev
machine, exposed over adb TCP. It lets you do the thing a green
`gradlew assembleDebug` can NEVER prove: run the real APK on real hardware and
watch it. Install, screenshot, logcat, drive the app.

- **It shares the PHONE, not the CODE.** You build the APK from your OWN
  checkout; the bridge only installs and runs it. There is no code sync over
  this link.
- **It is a REAL PERSON's device.** Only automate inside the app under test and
  the system settings needed to test it. Never open unrelated apps, never touch
  personal data, never factory-reset or wipe.
- **It is the TEST phone.** Never adb-install onto the owner's PERSONAL phone.
- **The Wi-Fi is flaky.** A dropped connection is the network, NOT a code
  failure. Reconnect (section 2) rather than concluding the build is broken.

This is the Android counterpart to `browser-verification` (a real browser).
Reach for it whenever an Android task needs a running device.

---

## 1. Install adb (once per machine)

`adb` ships in Android **platform-tools**. You do NOT need Android Studio or the
full SDK just to install and drive a build over this bridge.

If it is missing, install platform-tools straight from Google. Prefer the direct
download: winget's package hash is often stale.

```powershell
$dest = "$env:LOCALAPPDATA\Android"
New-Item -ItemType Directory -Force $dest | Out-Null
Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" `
  -OutFile "$dest\platform-tools.zip" -UseBasicParsing
Expand-Archive -Path "$dest\platform-tools.zip" -DestinationPath $dest -Force
& "$dest\platform-tools\adb.exe" version   # expect: Android Debug Bridge version 1.0.x
```

Everything below assumes `$adb = "$env:LOCALAPPDATA\Android\platform-tools\adb.exe"`.
In Git Bash, use the same path in `/c/Users/<you>/AppData/Local/...` form.

> **PowerShell gotcha:** adb writes normal status text to **stderr**. Do NOT
> pipe adb through `2>&1` in Windows PowerShell. It wraps each line as a
> NativeCommandError and can flip `$?` to false even on success. Just call adb
> directly and read its output; redirect only when you truly want to suppress.

---

## 2. Connect (and the reconnect dance)

```powershell
$adb = "$env:LOCALAPPDATA\Android\platform-tools\adb.exe"
$D   = "<DEVICE_IP>:5555"
& $adb connect $D
& $adb devices        # want:  <DEVICE_IP>:5555   device
```

If it says `offline` or `unable to connect` (the Wi-Fi dropped):

```powershell
& $adb disconnect $D
& $adb connect $D
```

The reconnect is normal and expected. **If a task fails mid-run, reconnect
first and retry before suspecting the code.**

If the address stopped working entirely, the phone's DHCP lease may have
changed. That is a question for the owner (or a reason to give the phone a
reserved address on the router), not something to brute-force by scanning the
network.

---

## 3. The one-time authorization (`unauthorized` to `device`)

The first time a new computer connects, `adb devices` shows the phone as
**`unauthorized`**. Android requires the DEVICE OWNER to approve this computer's
debugging key. A computer cannot authorize itself; that is the whole point of
the security model. **An agent on the dev machine cannot clear this alone.
Someone must tap the phone.**

On the phone:

1. Unlock it.
2. An **"Allow USB debugging?"** dialog shows this computer's RSA key
   fingerprint. Tap **Allow**, and check **"Always allow from this computer"**
   so it persists across reconnects.
3. If no dialog appears (it was dismissed, or a stale deny is cached):
   **Settings, Developer options, Revoke USB debugging authorizations**
   (confirm), then toggle **Wireless debugging** off and back on. Then re-run
   `adb connect` from the machine.

After Allow, `adb devices` reads `device` and the commands in section 5 work.

> When you hit `unauthorized` and no one is at the phone, that is a HAND-OFF
> point, not a failure. Do the machine-side work you can (build the APK, write
> the verification steps) and tell the owner exactly what to tap. Never report
> the bridge "broken" for a pending Allow.

---

## 4. Build the APK (from your own checkout)

The bridge installs YOUR build. Build it first:

```bash
cd <android-project-dir> && ./gradlew assembleDebug
# output: app/build/outputs/apk/debug/app-debug.apk
```

It needs a JDK on PATH (17 or newer for current Gradle plugins) and the repo's
env file with the client config (gitignored; ask the owner if missing). A
native Android project is Gradle, usually NOT part of the JS workspace build.
If this machine has no JDK, install the toolchain yourself (see
`agent-access-and-toolchains`: it is self-serve), or hand the build to a machine
that has it and use the bridge to install what it produced.

---

## 5. Drive the device (always target it with `-s`)

Once authorized, name the device explicitly in EVERY command. There may be other
devices or emulators attached, and `-s` removes all ambiguity:

```powershell
# Install / reinstall a build (-r keeps app data):
& $adb -s $D install -r <path>\app-debug.apk

# Screenshot: capture on the device, then PULL (do NOT `> shot.png` in PowerShell):
& $adb -s $D shell screencap -p /sdcard/shot.png
& $adb -s $D pull /sdcard/shot.png "<scratch-dir>\shot.png"
& $adb -s $D shell rm /sdcard/shot.png

# App logs (filter to the app's own log tag):
& $adb -s $D logcat -d -s <AppTag>:*

# Confirm identity and that the package is installed:
& $adb -s $D shell getprop ro.product.model
& $adb -s $D shell pm list packages | Select-String <package-name>

# Launch the app, tap, type: inside the app under test + system settings ONLY.
& $adb -s $D shell monkey -p <package-name> -c android.intent.category.LAUNCHER 1
& $adb -s $D shell input tap <x> <y>
& $adb -s $D shell input text "hello"
```

> **Binary-safe screenshots (a verified pitfall):**
> `adb exec-out screencap -p > shot.png` in PowerShell CORRUPTS the PNG. The
> `>` redirect re-encodes the stream (and can prepend a byte-order mark), so the
> file starts with `ef bb bf` instead of the PNG magic bytes `89 50 4e 47` and
> image readers reject it. Use `screencap` to the device and then `adb pull`,
> which copies raw bytes. Write artifacts to a scratch directory, not the repo,
> then read the pulled PNG.

---

## 6. Rules (non-negotiable)

- **Real person's device.** Automate only inside the app under test and the
  system settings needed to test it. No unrelated apps, no personal data, no
  wipe or reset.
- **Test phone only.** Never install onto the owner's personal phone.
- **A Wi-Fi drop is not a code bug.** Reconnect before concluding anything
  about the build.
- **`unauthorized` is a hand-off,** not a failure. A person must tap Allow.
- **Build from your own checkout.** The bridge shares the phone, never the code.
- **Report honestly which you did:** built versus installed versus verified on
  device, and screenshot the evidence.
- **Keep the device address out of committed files.** It is an internal
  identifier.

## Related

- `agent-access-and-toolchains` - installing the JDK and Android SDK yourself.
- `browser-verification` - the same idea for a real browser.
- `ios-build-from-windows` - the iOS counterpart (USB install to an iPhone).
- `deploy-freshness` - how an installed Android app learns it is out of date.
