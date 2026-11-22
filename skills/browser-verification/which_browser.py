#!/usr/bin/env python3
"""
which_browser.py - find the USER'S browsers and Chrome profiles, and print the
exact command that opens a page in the right one. READ-ONLY: it never opens
anything itself. The agent runs the printed command.

Why: a plain `start <url>` lands in the default browser, in whichever profile's
window the user focused last. When the user runs several signed-in Chrome
profiles (or several browsers), that is often the wrong one, and the page opens
logged out or as the wrong account. This script does the looking in one call.

  py which_browser.py                          # report + recommended command
  py which_browser.py --url https://x.y/page   # fill the URL into the command
  py which_browser.py --for mycompany          # pick the profile whose account
                                               #   or display name contains this
  py which_browser.py --json                   # machine-readable, for agents
  py which_browser.py --accounts               # show full account emails
                                               #   (hidden by default: privacy)

Decision order (same as the skill text):
  1. --for given and exactly ONE profile matches  -> that profile, explicitly.
  2. --for given, several match                   -> no recommendation; the
                                                     candidates are listed so
                                                     the agent asks by Name.
  3. --for given, nothing matches                 -> same as 2, with the
                                                     active profiles as
                                                     candidates.
  4. no --for                                     -> plain open: the default
                                                     browser, its last-used
                                                     profile (what `start`
                                                     does anyway).

Stdlib only. Windows is the first-class target; macOS and Linux get profile
reading plus the plain `open` / `xdg-open` command.
"""
import argparse
import json
import os
import platform
import re
import subprocess
import sys

IS_WIN = platform.system() == "Windows"
IS_MAC = platform.system() == "Darwin"

# Chromium-family browsers that keep a `Local State` file with profiles.
# key -> (display name, exe name on Windows, Local State path per OS)
CHROMIUM = {
    "chrome": {
        "name": "Google Chrome",
        "exe": "chrome.exe",
        "proc": ["chrome.exe", "Google Chrome", "chrome"],
        "state": {
            "Windows": r"%LOCALAPPDATA%\Google\Chrome\User Data\Local State",
            "Darwin": "~/Library/Application Support/Google/Chrome/Local State",
            "Linux": "~/.config/google-chrome/Local State",
        },
    },
    "msedge": {
        "name": "Microsoft Edge",
        "exe": "msedge.exe",
        "proc": ["msedge.exe", "Microsoft Edge", "msedge"],
        "state": {
            "Windows": r"%LOCALAPPDATA%\Microsoft\Edge\User Data\Local State",
            "Darwin": "~/Library/Application Support/Microsoft Edge/Local State",
            "Linux": "~/.config/microsoft-edge/Local State",
        },
    },
    "brave": {
        "name": "Brave",
        "exe": "brave.exe",
        "proc": ["brave.exe", "Brave Browser", "brave"],
        "state": {
            "Windows": r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data\Local State",
            "Darwin": "~/Library/Application Support/BraveSoftware/Brave-Browser/Local State",
            "Linux": "~/.config/BraveSoftware/Brave-Browser/Local State",
        },
    },
}
# Non-Chromium: we can only say default / running.
OTHER = {
    "firefox": {"name": "Firefox", "exe": "firefox.exe", "proc": ["firefox.exe", "firefox"]},
}

# Windows ProgId prefixes -> browser key
PROGID_MAP = [
    ("ChromeHTML", "chrome"),
    ("ChromeBHTML", "chrome"),
    ("MSEdgeHTM", "msedge"),
    ("BraveHTML", "brave"),
    ("FirefoxURL", "firefox"),
    ("FirefoxHTML", "firefox"),
]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def mask_email(addr):
    """name@example.com -> n***@example.com (the domain is what helps decide)."""
    if not addr or "@" not in addr:
        return addr or ""
    user, domain = addr.split("@", 1)
    return (user[:1] + "***@" + domain) if user else "***@" + domain


_EMAIL_IN_TEXT = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+")


def mask_emails_in(text):
    """Mask every email address inside free text (a profile's display name, a
    window title). A profile is often NAMED with its address, and a mail tab
    puts the address in the window title, so masking only the account column
    would still print addresses in clear."""
    if not text or "@" not in text:
        return text or ""
    return _EMAIL_IN_TEXT.sub(lambda m: mask_email(m.group(0)), text)


def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def state_path(key):
    raw = CHROMIUM[key]["state"].get(platform.system())
    if not raw:
        return None
    return os.path.expanduser(os.path.expandvars(raw))


# --------------------------------------------------------------------------- #
# Default browser
# --------------------------------------------------------------------------- #
def default_browser():
    """Return {key, name, progid, exe} for what a plain open goes to."""
    if IS_WIN:
        import winreg
        progid = None
        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice",
            ) as k:
                progid = winreg.QueryValueEx(k, "ProgId")[0]
        except OSError:
            pass
        key = None
        for prefix, k in PROGID_MAP:
            if progid and progid.startswith(prefix):
                key = k
                break
        exe = None
        if progid:
            try:
                with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, progid + r"\shell\open\command") as k:
                    cmd = winreg.QueryValueEx(k, None)[0]
                exe = cmd.split('"')[1] if cmd.startswith('"') else cmd.split(" ")[0]
            except OSError:
                pass
        name = (CHROMIUM.get(key) or OTHER.get(key) or {}).get("name") or (progid or "unknown")
        return {"key": key, "name": name, "progid": progid, "exe": exe}
    if IS_MAC:
        # LaunchServices is awkward to read; a plain `open` goes to the default.
        return {"key": None, "name": "system default (open)", "progid": None, "exe": None}
    try:
        out = subprocess.run(["xdg-settings", "get", "default-web-browser"],
                             capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        out = ""
    key = None
    for k in list(CHROMIUM) + list(OTHER):
        if k in out.lower() or (k == "chrome" and "google-chrome" in out):
            key = k
    return {"key": key, "name": out or "system default (xdg-open)", "progid": None, "exe": None}


# --------------------------------------------------------------------------- #
# Executables (Windows App Paths, else PATH)
# --------------------------------------------------------------------------- #
def exe_path(key):
    info = CHROMIUM.get(key) or OTHER.get(key)
    if not info:
        return None
    if IS_WIN:
        import winreg
        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\\" + info["exe"]) as k:
                    p = winreg.QueryValueEx(k, None)[0]
                    if p and os.path.isfile(p):
                        return p
            except OSError:
                continue
        return None
    if IS_MAC:
        apps = {"chrome": "/Applications/Google Chrome.app", "msedge": "/Applications/Microsoft Edge.app",
                "brave": "/Applications/Brave Browser.app", "firefox": "/Applications/Firefox.app"}
        p = apps.get(key)
        return p if p and os.path.isdir(p) else None
    import shutil
    for cand in {"chrome": ["google-chrome", "google-chrome-stable", "chromium"],
                 "msedge": ["microsoft-edge"], "brave": ["brave-browser"], "firefox": ["firefox"]}.get(key, []):
        p = shutil.which(cand)
        if p:
            return p
    return None


# --------------------------------------------------------------------------- #
# Running browsers (one row per browser, with its current window title)
# --------------------------------------------------------------------------- #
def running_browsers():
    found = {}
    if IS_WIN:
        import csv
        import io
        # One filtered tasklist per browser: `tasklist /v` over EVERY process
        # has to fetch every window title and routinely takes >15s.
        for key, info in list(CHROMIUM.items()) + list(OTHER.items()):
            try:
                out = subprocess.run(
                    ["tasklist", "/v", "/fo", "csv", "/nh", "/fi", f"imagename eq {info['exe']}"],
                    capture_output=True, text=True, timeout=20, encoding="utf-8", errors="replace").stdout
            except Exception:
                continue
            for row in csv.reader(io.StringIO(out)):
                if len(row) < 9 or row[0].lower() != info["exe"]:
                    continue
                title = row[-1]
                r = found.setdefault(key, {"key": key, "name": info["name"], "processes": 0, "window_titles": []})
                r["processes"] += 1
                if title and title != "N/A" and title not in r["window_titles"]:
                    r["window_titles"].append(title)
    else:
        try:
            out = subprocess.run(["ps", "-A", "-o", "comm="], capture_output=True, text=True, timeout=10).stdout
        except Exception:
            out = ""
        for line in out.splitlines():
            base = os.path.basename(line.strip())
            for key, info in list(CHROMIUM.items()) + list(OTHER.items()):
                if base in info["proc"] or base.lower() == key:
                    r = found.setdefault(key, {"key": key, "name": info["name"], "processes": 0, "window_titles": []})
                    r["processes"] += 1
    return list(found.values())


# --------------------------------------------------------------------------- #
# Chromium profiles
# --------------------------------------------------------------------------- #
def chromium_profiles():
    """Every profile of every installed Chromium browser."""
    profiles = []
    for key in CHROMIUM:
        path = state_path(key)
        if not path or not os.path.isfile(path):
            continue
        ls = read_json(path)
        if not ls:
            continue
        prof = ls.get("profile") or {}
        last_used = prof.get("last_used")
        active = prof.get("last_active_profiles") or []
        cache = prof.get("info_cache") or {}
        for d, info in cache.items():
            profiles.append({
                "browser": key,
                "browser_name": CHROMIUM[key]["name"],
                "dir": d,
                "name": info.get("name") or d,
                "account": info.get("user_name") or "",
                "is_last_used": d == last_used,
                "has_open_window": d in active,   # Chrome keeps last_active_profiles = profiles with a window
            })
    return profiles


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def plain_commands(url):
    if IS_WIN:
        return {
            "powershell": f'Start-Process "{url}"',
            "bash": f'cmd.exe //c start "" "{url}"',
        }
    if IS_MAC:
        return {"shell": f'open "{url}"'}
    return {"shell": f'xdg-open "{url}"'}


def profile_commands(p, url):
    exe = exe_path(p["browser"])
    if IS_WIN:
        exe_arg = f'"{exe}"' if exe else p["browser"]
        return {
            "powershell": f"Start-Process {exe_arg} -ArgumentList '--profile-directory=\"{p['dir']}\"', '\"{url}\"'",
            "bash": f"\"{exe or p['browser']}\" --profile-directory=\"{p['dir']}\" \"{url}\" &"
                    if exe else f"{p['browser']} --profile-directory=\"{p['dir']}\" \"{url}\" &",
        }
    if IS_MAC:
        app = exe or {"chrome": "Google Chrome", "msedge": "Microsoft Edge", "brave": "Brave Browser"}[p["browser"]]
        return {"shell": f'open -a "{app}" --args --profile-directory="{p["dir"]}" "{url}"'}
    return {"shell": f'{exe or p["browser"]} --profile-directory="{p["dir"]}" "{url}" &'}


# --------------------------------------------------------------------------- #
# Decision
# --------------------------------------------------------------------------- #
def decide(default, profiles, want, url):
    """Return (recommended | None, candidates[])."""
    default_key = default.get("key")

    def pub(p):
        return {"browser": p["browser_name"], "dir": p["dir"], "name": p["name"]}

    if want:
        w = want.lower()
        # match_name = the display name as Chrome has it; p["name"] may be masked for printing.
        hits = [p for p in profiles
                if w in (p["account"] or "").lower() or w in (p.get("match_name") or p["name"] or "").lower()]
        # Prefer the default browser when the same account exists in several browsers.
        if len(hits) > 1 and default_key:
            in_default = [p for p in hits if p["browser"] == default_key]
            if len(in_default) == 1:
                hits = in_default
        if len(hits) == 1:
            p = hits[0]
            if p["is_last_used"] and p["browser"] == default_key:
                return ({
                    "kind": "plain",
                    "reason": f"'{want}' matches {p['name']} ({p['browser_name']} {p['dir']}), which is already the last-used profile of the default browser: a plain open lands there.",
                    "profile": pub(p),
                    "command": plain_commands(url),
                }, [])
            return ({
                "kind": "profile",
                "reason": f"'{want}' matches exactly one profile: {p['name']} ({p['browser_name']} {p['dir']}). Target it explicitly.",
                "profile": pub(p),
                "command": profile_commands(p, url),
            }, [])
        if len(hits) > 1:
            # Tie-break: several profiles share the domain, but the user is
            # sitting in exactly one of them right now (the last-used profile
            # with a window open). That one is signed in and in front of them.
            live = [p for p in hits if p["is_last_used"] and p["has_open_window"]]
            if len(live) == 1:
                p = live[0]
                names = ", ".join(f"{h['name']} ({h['dir']})" for h in hits)
                return ({
                    "kind": "plain" if p["browser"] == default_key else "profile",
                    "reason": f"'{want}' matches several profiles ({names}); {p['name']} ({p['dir']}) is the one the user is in right now (last used, window open), so it wins.",
                    "profile": pub(p),
                    "command": plain_commands(url) if p["browser"] == default_key else profile_commands(p, url),
                }, [])
            return (None, [pub(p) for p in hits[:3]])
        # nothing matched: offer the profiles with open windows, else last used
        cands = [p for p in profiles if p["has_open_window"]] or [p for p in profiles if p["is_last_used"]]
        return (None, [pub(p) for p in cands[:3]])

    # No hint: plain open. Say where it will land.
    land = [p for p in profiles if p["browser"] == default_key and p["is_last_used"]]
    where = f"{land[0]['name']} ({land[0]['dir']})" if land else "its last-used profile"
    return ({
        "kind": "plain",
        "reason": f"No account requested. A plain open goes to the default browser ({default['name']}), profile {where}.",
        "profile": pub(land[0]) if land else None,
        "command": plain_commands(url),
    }, [])


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #
def print_report(default, running, profiles, rec, cands, show_accounts):
    print(f"Default browser : {default['name']}" + (f"  ({default['exe']})" if default.get("exe") else ""))
    if running:
        print("Running now     :")
        for r in running:
            titles = "; ".join(r["window_titles"][:3]) if r["window_titles"] else "(no window title)"
            print(f"  {r['name']:<16} {titles}")
    else:
        print("Running now     : none of chrome / edge / brave / firefox")
    print("Profiles        :")
    if not profiles:
        print("  (no Chromium Local State found)")
    for p in profiles:
        flags = []
        if p["is_last_used"]:
            flags.append("LAST USED")
        if p["has_open_window"]:
            flags.append("open")
        acct = p["account"] if show_accounts else mask_email(p["account"])
        print(f"  {p['browser_name']:<16} {p['dir']:<11} {p['name']:<28} {acct:<28} {' '.join(flags)}")
    print()
    if rec:
        print(f"Recommended ({rec['kind']}): {rec['reason']}")
        for shell, cmd in rec["command"].items():
            print(f"  [{shell}] {cmd}")
    else:
        print("No single profile fits. Ask the user, naming these (display names only):")
        for c in cands:
            print(f"  - {c['name']}  ({c['browser']} {c['dir']})")
    if not show_accounts:
        print("\n(email addresses masked everywhere, also in profile names and window titles; --accounts shows them. Decide with them, never paste the list into chat.)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="<url>", help="the page to open; filled into the command")
    ap.add_argument("--for", dest="want", default=None,
                    help="account email, domain, or profile display name the page needs")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--accounts", action="store_true", help="show full account emails (default: masked)")
    a = ap.parse_args()

    default = default_browser()
    running = running_browsers()
    profiles = chromium_profiles()
    # Privacy: an email address is shown only with --accounts, wherever it sits.
    # A display name that is (or contains) an address is masked HERE, once, so
    # every place that prints a name (the table, the reason, the candidates,
    # the JSON) gets the masked form. --for still matches the real name.
    for p in profiles:
        p["match_name"] = p["name"]
        if not a.accounts:
            p["name"] = mask_emails_in(p["name"])
    if not a.accounts:
        for r in running:
            r["window_titles"] = [mask_emails_in(t) for t in r["window_titles"]]
    rec, cands = decide(default, profiles, a.want, a.url)

    if a.json:
        out_profiles = []
        for p in profiles:
            q = dict(p)
            q.pop("match_name", None)
            if not a.accounts:
                q["account"] = mask_email(q["account"])
            out_profiles.append(q)
        print(json.dumps({
            "os": platform.system(),
            "default_browser": default,
            "running": running,
            "profiles": out_profiles,
            "recommended": rec,
            "candidates": cands,
        }, indent=2))
        return 0
    print_report(default, running, profiles, rec, cands, a.accounts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
