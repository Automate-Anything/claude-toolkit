# No sandbox: working on the live system through the parity shield

Use this when the old system offers no test environment and the work must happen in the owner's live
account. It replaces the sandbox with layers the owner controls. Read it in Phase 0 and follow it for
every session on the live system.

## Contents

1. The layers, and what each one guarantees
2. One-time setup (with the owner, each change shown first)
3. Every session
4. What the agent may and may not do on the live system
5. Learning behavior without making changes
6. Residual risks to tell the owner
7. Troubleshooting

## 1. The layers

| Layer | What it does | Who controls it |
|---|---|---|
| Dedicated assistant user with a custom view-only role (if the system has roles) | The system itself refuses changes; a separate audit trail; a lockout never hits the owner's login | Owner, in the system's admin |
| The parity shield (`scripts/shield/`) | A local proxy in front of a dedicated Chrome: only reads leave the machine; writes, risky GETs, payment/e-sign/dialer/credit-bureau hosts, websockets and non-HTTP traffic are blocked; client identifiers are masked in everything the browser receives | Owner starts and stops it; person-only commands need a real terminal |
| The in-page mask (`mask.js`, injected by the shield) | Masks record text the proxy cannot recognize: table cells, detail values, names in titles, headings and ARIA labels, input values | Automatic; `shield_check.js` reports whether it is on |
| The guard hook (`guard_hook.py`) | Claude Code refuses: opening the live system in any other browser, raw network bodies/memory/traces/uploads on it, unvetted page scripts, any shielded tool while the shield is down, person-only shield commands, edits to shield files | Installed in the app repo's settings by the owner |
| Operating rules (section 4) | Pacing, supervised first session, what never to touch | The agent, checked by the owner |

What is proven: `shieldctl.py selftest` runs unit tests and an end-to-end test with a real Chrome
against a fake CRM full of canary data. It proves that only reads arrive, that no canary reaches the DOM,
the accessibility tree, network bodies, the console or any log, that the gate tells the truth (including
the case where the page's security policy stops the mask from loading), and that nothing gets through
with the proxy down. Run it on the owner's machine before the first live session and after any update.

## 2. One-time setup

Do this with the owner. Show each command and each settings change before running it; the owner
decides.

1. Ask the owner to create the assistant user in the old system with a custom role that can view every
   screen staff use and cannot change, delete, export, send or pay. Their admin login, behind the shield,
   is used only in supervised sessions to see buttons the view-only role hides.
2. `python3 <skill>/scripts/shield/shieldctl.py setup` creates a private venv at `~/.parity-shield/venv`
   with the pinned mitmproxy (needs Python 3.12+; on macOS `brew install python@3.12`).
3. Copy `scripts/shield/shield.example.json` to `<app repo>/docs/parity/shield.json`. Set `targets` to the
   system's hosts (from the login page address, for example `["*.forthcrm.com"]`) and `log_dir` to the
   absolute path of `<app repo>/docs/parity/_raw/shield`. Leave every allow list empty.
4. `python3 <skill>/scripts/shield/shieldctl.py selftest` must end with `0 failed`.
5. Register a separate browser-tool server for the shielded Chrome (project scope, pinned version):

       claude mcp add --scope project chrome-shielded -- npx -y chrome-devtools-mcp@1.10.1 --browserUrl http://127.0.0.1:9333

   The normal browser tool stays as it is, for the new app on localhost.
6. Add the guard to `<app repo>/.claude/settings.json` (merge with what is there):

       {"hooks": {"PreToolUse": [{"matcher": "mcp__.*|Bash|Edit|Write|MultiEdit|NotebookEdit",
         "hooks": [{"type": "command", "command": "python3 \"$HOME/.claude/skills/legacy-app-parity/scripts/shield/guard_hook.py\" --config \"$CLAUDE_PROJECT_DIR/docs/parity/shield.json\""}]}]}}

7. Restart Claude Code so the new server and hook load.

## 3. Every session

1. Owner: `python3 <skill>/scripts/shield/shieldctl.py start --config docs/parity/shield.json`. The
   shielded Chrome opens on the shield's status page. If start refuses, nothing is running: read the message.
2. Owner, in their own terminal: `shieldctl.py login --host <login host>` and type LOGIN. They then sign in
   inside the shielded Chrome within the window (two minutes by default, five at most). Sign-in requests
   to that host only are allowed and logged; passwords are never written. After the first login the
   owner runs `shieldctl.py pin-login --config docs/parity/shield.json` to keep the exact sign-in paths.
3. Agent, with the `chrome-shielded` tools only: open `https://parity-shield.invalid/status` and confirm
   the run id matches `shieldctl.py status`. Then go to the system by clicking from its home screen.
4. On every page, before any read: `ready.js` until READY, then `shield_check.js`. Capture only when
   `ok` is true. If it is not, stop and say why.
5. Pace like a person: one tab, 3 to 5 seconds between navigations, a page cap agreed with the owner
   per session, after business hours when possible. Stop at once on HTTP 429, a captcha, an "unusual
   activity" page, or repeated session expiry.
6. Owner: `shieldctl.py stop` at the end. `shieldctl.py wipe` (owner) deletes logs and dry-run bodies
   when the parity work no longer needs them.

The first live session is supervised (about 30 minutes): menus first, then one screen of the most-used
task, then a review of `blocks.jsonl` together. If the session keeps expiring because a heartbeat request
is blocked, the owner decides whether that exact request is harmless and pins it with an expiry:
`shieldctl.py pin --config ... --method POST --host H --path /exact --reason "session keep-alive" --days 7`.

## 4. On the live system: the agent may and may not

May: navigate by clicking, open records and tabs, open dialogs then cancel, hover, type into fields to see
validation (the shield blocks the save), press keys, take screenshots and snapshots after the gate passes,
run `inventory.js`, `tokens.js`, `ready.js`, `shield_check.js`, and short read-only snippets (the guard
allows evaluate_script only for these).

May not (the guard enforces most of these): open the system in the normal browser; use
`get_network_request`, memory snapshots, performance traces, Lighthouse or file upload on it; read the
app's JavaScript state, cookies or storage; run `shieldctl login/pin/stop/wipe`; start mitmproxy; edit
`shield.json` or anything under `~/.parity-shield`; type real client data into any field; paste anything
from the live system into chat.

Network evidence comes from the shield, not the browser tool: `log_dir/traffic.jsonl` (route shapes,
statuses, body kinds), `log_dir/blocks.jsonl` (every blocked attempt with its reason), and
`log_dir/dryrun/` (what each blocked button would have sent, every value masked). Feed the dry-run index
to `net_schema.py --index <log_dir>/dryrun/index.jsonl` for the data model of every write.

## 5. Learning behavior without making changes

- **Dry runs.** Click Save, Submit, Delete: the shield blocks it and records exactly what would have been
  sent (field names, structure, masked values). That is the write side of the data model without a write.
- **History instead of new history.** Most systems keep an audit trail per record. Read the timelines of
  15 to 20 records at different stages (new, active, settling, finished, cancelled): every action staff
  took and what followed it (status changes, tasks, documents, payments scheduled) is already there.
  Past calculations (fees, settlements, schedules) are free characterization cases: inputs and outputs the
  old system already produced. Amounts are not masked; identifiers are.
- **Shadow the staff.** Staff do normal work while recording their screens; their browser can export a
  HAR file of that session. The agent never opens a HAR: run `net_schema.py --har file.har` and read only
  its value-free output, then delete the HAR (it holds session cookies).
- **The vendor's API or data export.** If the system has a read API or a data warehouse copy (Forth:
  REST API and Managed Data Cloud), use read-only credentials from `.env.local` for the data model and,
  later, the data move. GET only; never call write endpoints.
- **One quarantined test record**, only for what nothing above can show, and only with the owner: a
  clearly fake record (`ZZTEST`), contact details that lead to the owner (their own email domain and
  phone), a made-up SSN, no bank details, triggers checked first (exclude the test tag if possible). The
  owner, not the agent, clicks the write buttons, in their own normal browser, while the agent watches the
  result through the shield. Never test anything that moves money (Forth Pay drafts, settlements, refunds).

## 6. Residual risks (say these to the owner plainly)

- A name that appears only in free text in an unusual place, before it was seen anywhere else, can slip
  past both mask layers. The shield learns names as it sees them, and screenshots show far less than the
  raw page, but no masking is perfect. This is why the owner's compliance setup must allow masked capture.
- Some reads change state in the system: opening an unread message may mark it read, opening an edit
  screen may lock the record, and "last viewed" stamps are written. Avoid inboxes and edit screens during
  business hours, and tell the owner.
- Everything the agent sees is masked, so behavior that depends on the real values (search by name,
  duplicate detection) has to be confirmed on the quarantined test record or with the owner.
- Images, PDFs and downloads from record pages are withheld (they can be scans, signatures, statements),
  so their layout is learned from the owner's screenshots or the export/API route.
- The shield cannot stop the vendor's own server from doing something on a read. Old systems that act
  on plain GET links are covered by the risky-word filter, which also blocks some harmless pages: the
  owner can allow an exact page with `allow_get`, after checking it.

## 7. Troubleshooting

| Symptom | Do this |
|---|---|
| `shieldctl start` refuses | Read the message: profile already open (run stop), port busy, config invalid, or the shield did not come up healthy. Chrome is never started in that case. |
| `shield_check` not ok, mask "absent" | The page's security policy blocked the mask (`strict-dynamic` without a nonce). Do not capture that page; note it for the owner's screenshots. |
| `shield_check` not ok, status error | Wrong browser (use the chrome-shielded tools) or the shield stopped. `shieldctl.py status`. |
| Pages show "Blocked by the read-only shield" | Expected for writes. If a pure read is blocked by a risky word, the owner may add an exact `allow_get` after checking it. |
| Login fails | Was the login window open, for the right host, and still within its time? The owner reruns `shieldctl.py login`. |
| Session keeps expiring | A blocked heartbeat. Review `blocks.jsonl` with the owner; pin it only if it is harmless. |
| The app shows errors after a blocked save | Expected. Reload the page before continuing. |
