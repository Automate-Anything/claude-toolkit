---
name: browser-verification
description: How to open and drive a real browser via the chrome-devtools MCP to verify anything visual or interactive. Read this BEFORE any task where you open a page, click through a flow, fill a form, take a screenshot, read the console, inspect network requests, or confirm a UI actually renders/works. It covers which URL to open, that every session gets its OWN isolated browser, how to handle login walls (open the page, ask the user to log into YOUR window), and how to recover if the browser won't open. Use when the user says "check it in the browser," "open the page," "open it for me," "show me," "take a screenshot," "verify the UI," "see if it renders," "click through," or anything needing a live browser.
---

# Browser Verification (Chrome DevTools MCP)

A **chrome-devtools MCP** server is installed **globally** (user scope, in
`~/.claude.json`), so it is available in **every repository** with no per-repo
setup. It launches with `--isolated`. Its tools are named `mcp__chrome-devtools__*` - e.g. `navigate_page`, `new_page`, `click`, `fill`, `fill_form`, `hover`,
`press_key`, `take_screenshot`, `take_snapshot`, `list_console_messages`,
`list_network_requests`, `evaluate_script`, `wait_for`.

When the user says "open it for me," "the Chrome extension," "show me," or "check
it in the browser," they mean **this MCP**. Use it directly. Do NOT drive a
browser through Bash/curl/Playwright unless explicitly told to - those don't let
the user SEE anything, and seeing is usually the point.

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
