---
name: browser-verification
description: How to open and drive a real browser via the chrome-devtools MCP to verify anything visual or interactive. Read this BEFORE any task where you open a page, click through a flow, fill a form, take a screenshot, read the console, inspect network requests, or confirm a UI actually renders/works. It covers which URL to open, that every session gets its OWN isolated browser, how to handle login walls (open the page, ask the user to log into YOUR window), and how to recover if the browser won't open. It ALSO covers the opposite case: opening a page or local .html file in the USER'S OWN logged-in default browser with one shell command, and how to tell which browser or Chrome profile to target when several are open. Use when the user says "check it in the browser," "open the page," "open it for me," "show me," "open it in my browser," "take a screenshot," "verify the UI," "see if it renders," "click through," or anything needing a live browser.
---

# Browser Verification (Chrome DevTools MCP)

A **chrome-devtools MCP** server is installed **globally** (user scope, in
`~/.claude.json`), so it is available in **every repository** with no per-repo
setup. It launches with `--isolated`. Its tools are named `mcp__chrome-devtools__*` - e.g. `navigate_page`, `new_page`, `click`, `fill`, `fill_form`, `hover`,
`press_key`, `take_screenshot`, `take_snapshot`, `list_console_messages`,
`list_network_requests`, `evaluate_script`, `wait_for`.

When the user says "the Chrome extension" or "check it in the browser," they mean
**this MCP**. Use it directly. Do NOT drive a browser through Bash/curl/Playwright
unless explicitly told to.

"Open it for me" and "show me" can mean either thing. If YOU need to verify the
page, use this MCP. If the USER needs the page in front of them in their own
logged-in browser, open it there with a single shell command: see "Opening a page
in the USER'S OWN default browser" below, including how to pick the right one
when several browsers or profiles are open.

> **If the `mcp__chrome-devtools__*` tools are not in your tool list:** the MCP
> hasn't loaded into this session yet (it loads at session start). Tell the user
> to restart Claude Code once; you cannot reload it yourself. It is configured
> globally and will be there in new sessions.

## This skill is the browser authority for ALL skills

Any other skill that says "open the browser / take a screenshot" (e.g. a design
review or UI review step) uses THIS mechanism for the browser itself. Keep that
skill's *logic* (before/after screenshots, per-fix commits, its checklist); only
the browser tool is the chrome-devtools MCP described here. One machine, one
browser mechanism.

## You get your OWN browser. You will not collide with other agents.

`--isolated` means **every session gets its own Chrome with a fresh temp
profile**, auto-cleaned on close. You never wait for another agent's window and
never assume a tab someone else opened is yours. Consequence: **your profile is
FRESH - no saved logins or cookies.** Authenticated pages start logged out (see
login walls below).

## Which URL do I open?

Match the surface to the work. **Figure out the repo's actual dev URL - do not
assume a port.** How to find it, in order:

1. Check the running dev server / terminal output for the URL it printed.
2. Check the project's config: `vite.config.*` (default **5173**), `package.json`
   scripts, `next.config.*` (Next default **3000**), a `.env`, or a README.
3. If a backend serves its own pages/API, find its port too (e.g. FastAPI/uvicorn
   default **8000**, often proxied under `/api`).
4. If you can't tell, ask the user rather than guessing.

| You are verifying... | Open |
|---|---|
| Uncommitted UI work in the working tree | the **local dev server** URL (only surface that shows unpushed code) - confirm it's running first; if nothing responds, start it or ask the user |
| A specific page | `<dev-url>/<path>` |
| An API route | `<api-url>/<route>` - for POST, prefer `evaluate_script` with `fetch`, or a quick Bash `curl` |
| A deployed/staging build | the deploy URL, when one exists |

> **Dev-server warm-up:** some dev servers (e.g. `next dev`) compile a route on
> first hit. If a page 404s or shows a "still compiling" state, hit it once to
> warm it, `wait_for`, then retry. A stale build cache can also cause this - > clearing it and restarting the dev server fixes it.

## Login walls: NORMAL - open the page, then ask the user to log YOU in

This is the blessed flow: **when you need the browser, you open it; if it needs a
login, you ask the user to log into your window, and they will.** A login wall is
not an error - it's a handoff. Because your isolated profile is always fresh,
protected pages start logged out.

**Do not guess, type, hardcode, or commit credentials - ever.** When you hit a
login screen:

1. Leave the browser window open on the login page.
2. Tell the user plainly: *"I've opened `<url>` in my browser window and it's
   asking me to log in (my profile is a fresh isolated one, so it starts logged
   out). Please log in to that Chrome window and tell me when you're done - then
   I'll continue."*
3. Wait. Once the user logs into YOUR window, continue. The session persists for
   the rest of that browser's life, so you're only asked once per run.

Never reuse another agent's session. If the user would rather you not proceed,
respect that.

If the user only needs to LOOK at the page themselves (you do not need to drive
it), skip the login wall entirely: open it in their own browser, where they are
already logged in. See "Opening a page in the USER'S OWN default browser" below.

> **Sensitive data:** if a project handles private/regulated data (health,
> financial, personal), don't paste that data into chat, commits, or externally
> shared screenshots. Screenshots handed back to the user are fine; treat them as
> sensitive. Check the repo's own docs for any such rules before browsing its data.

## The happy path (do this)

1. **Confirm the target is reachable.** For local work, make sure the dev server
   is up (quick check that the URL responds). If not, start it or ask the user.
2. `navigate_page` (or `new_page`) to the chosen URL.
3. `take_snapshot` for the accessibility tree (best for finding elements to act
   on). Use `take_screenshot` when the user wants to SEE it or layout is the point.
4. Interact: `click`, `fill`, `fill_form`, `hover`, `press_key`. Use `wait_for`
   after navigations/async loads instead of guessing at timing.
5. Verify behavior with `list_console_messages` (JS errors) and
   `list_network_requests` (4xx/5xx) - not just eyeballing.
6. Report with **evidence** (screenshot, console text, failing request), not just
   "it works."

## Opening a page in the USER'S OWN default browser

Everything above is about the isolated browser YOU drive through the MCP. That
browser is yours: the user cannot see it, and it has none of their logins, tabs,
or clipboard. Sometimes the goal is the opposite: the user needs the page in
front of THEM, in the browser they already use and are already logged into, so
they can look at it, copy from it, or sign in themselves. Do not try to do that
through the MCP browser, and do not tell the user to go find and open a file.
Open it for them.

### When to use which

| The goal | Use |
|---|---|
| YOU need to inspect, click, screenshot, or read the console/network | The isolated chrome-devtools browser (the rest of this skill) |
| The USER needs to see it, copy from it, or use their own logged-in account | Their own browser, with the commands below |
| Both (very common) | Verify in the isolated browser first, then open it for the user |

### The method (Windows)

One shell command. Windows' `start` hands the target to whatever app is
registered for it, which for a web page or an `.html` file is the user's default
browser. It opens as a new tab in their existing window.

From the Bash tool (Git Bash):

```bash
cmd.exe //c start "" "C:\path\to\page.html"
cmd.exe //c start "" "https://example.com/page"
```

From the PowerShell tool:

```powershell
Start-Process "C:\path\to\page.html"
Start-Process "https://example.com/page"
```

Details that make it work:

- In Git Bash the switch is `//c`, with two slashes. A single `/c` gets rewritten
  into a file path by Git Bash and the command fails.
- The empty `""` right after `start` is required. `start` treats the first quoted
  argument as a window title, so without it a quoted path is taken as the title
  and nothing opens.
- Use an absolute path, in Windows form with backslashes, inside quotes.
- To force a fresh load of a local file the user already has open, pass it as a
  URL with a throwaway query string:
  `cmd.exe //c start "" "file:///C:/path/to/page.html?v=2"`
- The command returns immediately and prints nothing. It cannot tell you whether
  the page rendered. Ask the user what they see, or verify the same page
  separately in the isolated MCP browser.
- macOS equivalent: `open "path-or-url"`. Linux: `xdg-open "path-or-url"`.

### More than one browser or profile: work out which one BEFORE you open

A plain `start` lands in the DEFAULT browser, in the profile of whichever of its
windows was focused most recently. When the user runs several Chrome profiles
(each signed into a different account) or several browsers, that can be the wrong
one: the page opens logged out, or logged in as the wrong account, which defeats
the whole point. So look first. All three checks are read-only. Run them from the
PowerShell tool.

**1. Which browser is the default** (this is where a plain `start` goes):

```powershell
$p = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice').ProgId
$p
(Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$p\shell\open\command").'(default)'
```

`ChromeHTML` = Chrome, `MSEdgeHTM` = Edge, `FirefoxURL-...` = Firefox,
`BraveHTML` = Brave.

**2. Which browsers are actually open right now:**

```powershell
Get-Process chrome,msedge,firefox,brave -ErrorAction SilentlyContinue |
  Where-Object MainWindowTitle | Select-Object Name, MainWindowTitle
```

You get one row per running browser (not per window), with the title of its
current window. The title often names the signed-in account (a Gmail tab shows
the address), which is a strong hint. The command exits 1 when one of the listed
browsers is not running; that is expected, read the output anyway.

**3. Which profiles exist, and which one is active:**

```powershell
$ls = Get-Content "$env:LOCALAPPDATA\Google\Chrome\User Data\Local State" -Raw -Encoding UTF8 | ConvertFrom-Json
$ls.profile.last_used              # the profile a plain `start` will land in
$ls.profile.last_active_profiles   # normally the profiles that have a window open
$ls.profile.info_cache.PSObject.Properties | ForEach-Object {
  [pscustomobject]@{ Dir = $_.Name; Name = $_.Value.name; Account = $_.Value.user_name }
}
```

`Dir` is the folder name (`Default`, `Profile 3`, ...) and is what you target
with. `Name` is the label the user sees in Chrome's profile picker. `Account` is
the signed-in Google account. Other Chromium browsers keep the same file in their
own folder: Edge at `$env:LOCALAPPDATA\Microsoft\Edge\User Data\Local State`,
Brave at `$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data\Local State`.

**4. Decide, in this order:**

1. The user named a browser or profile: use that one.
2. The page needs a specific account (an admin console, a mailbox, a workspace
   app): pick the profile whose `Account` or `Name` matches it.
3. The right profile is the same as `last_used`, in the default browser: a plain
   `start` is already correct, use it.
4. The right profile is a different one: target it explicitly (below).
5. You cannot tell which account the page needs: ask the user in chat, naming the
   two or three candidate profiles by `Name`. Do not guess. A wrong guess opens a
   logged-out page in a window the user was not looking at.

**5. Target a specific browser or profile explicitly:**

```powershell
# A specific Chrome profile (use the Dir value, NOT the display Name)
Start-Process chrome -ArgumentList '--profile-directory="Profile 3"', '"https://example.com/page"'

# A specific browser that is not the default
Start-Process msedge "https://example.com/page"
Start-Process msedge -ArgumentList '--profile-directory="Default"', '"https://example.com/page"'
```

`chrome` and `msedge` resolve by short name because Windows registers them under
App Paths. If that profile already has a window open the page becomes a new tab
in it; if not, Chrome opens a window for that profile. Use the PowerShell tool
for profile targeting: the nested quotes around a profile folder with a space in
it do not survive Git Bash reliably.

**Privacy:** the profile list contains the user's personal account addresses. Use
it to decide, and name only the candidates when you have to ask. Never paste the
whole list into chat, a doc, a commit, a log, or an error report.

### Related trick: putting formatted content on the user's clipboard

When the user needs to paste rich content (an email signature, a formatted table)
and copying from a page is error-prone, the PowerShell tool can put it on their
clipboard as formatted content, not as code:

```powershell
Set-Clipboard -AsHtml -Value $htmlFragment
```

This works in Windows PowerShell 5.1. Pass only the fragment (for example the
`<table>...</table>`), not a whole HTML document. Warn the user first, because it
overwrites whatever they had copied.

### Cautions

- This acts on the user's real desktop. Only do it when the user asked to see
  something, or clearly expects it. Never open pages unprompted.
- Never open a URL that carries a secret or token in it: it lands in their
  browser history.
- Opening a production page for the user to look at is fine. You still never
  perform write, charge, or send actions there.
- You cannot click, read, or screenshot the user's browser. If you need to
  observe the page, that is the isolated MCP browser's job.
- Images referenced by a local page still load from the network. If a remote
  image was requested before it went live, the browser may have cached the
  failure. Give the image URL a new query string to bypass it.

## If the browser won't open: the ONE error to recognize

If a `mcp__chrome-devtools__*` call fails with a message like:

> The browser is already running for `...chrome-profile`.
> Use --isolated to run multiple browser instances.

the diagnosis is fixed: **the server your session attached to started WITHOUT
`--isolated`** (a stale server). A correct server uses a unique temp profile and
never hits the shared one.

**Does NOT fix it:** retrying in a loop; asking the user to close the Chrome
window; falling back to "looks fine / I read the code." If the task was to LOOK,
you must look.

**DOES fix it:** get a fresh `--isolated` server. You can't restart your own MCP
server from inside the session, so tell the user:

> *"I can't open a browser: chrome-devtools MCP says the shared profile is in
> use, which means my server started without `--isolated` (a stale server). Please
> fully quit and reopen Claude Code so every session relaunches its MCP server,
> then tell me and I'll retry."*

Then PAUSE. Don't proceed with browser work until it's resolved, and never
pretend you verified.

## If the MCP tools disappear entirely

If `mcp__chrome-devtools__*` tools are simply GONE ("not connected" / vanished),
the server died. Tell the user it looks disconnected and ask them to restart
Claude Code (you can't relaunch it yourself). Don't silently fall back to scraping.

## Don'ts
- Don't use another agent's tab/window - open your own page.
- Don't hardcode or guess credentials.
- Don't assume a port; determine the repo's real dev/API URL.
- Don't paste sensitive/regulated data into chat or commits from a browsed page.
- Don't substitute Bash/curl/Playwright for the MCP unless told to.
- Don't claim a UI works without observing it (snapshot/screenshot + clean
  console/network).
