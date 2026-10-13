---
name: signalwire-docs
description: How to look up SignalWire documentation FAST and correctly whenever you're working on SignalWire telephony/messaging - call topology, live_translate, SWML connect and other SWML methods, the Calling/Relay REST API, Call Fabric subscribers/SATs, the browser SDK (@signalwire/js), or cXML/Twilio-compat. Use it instead of guessing the API: SignalWire has several overlapping call models that silently fail when you pick the wrong one. Gives the fast lookup paths (append `.md` to any docs URL; `/llms.txt` section indexes; the docs MCP server), the redirect gotchas, and the load-bearing facts about live translation that are easy to get wrong.
---

# SignalWire docs - fast, correct lookup

When SignalWire work needs a fact (a method, a parameter, whether something can be done
mid-call), **look it up - do not guess.** SignalWire has many overlapping call models
(cXML/LAML compat, SWML, Calling/Relay REST, Call Fabric, browser SDK) and the wrong one
silently fails or behaves differently. Guessing here wastes whole sessions.

## The fast paths (use these first)

1. **Append `.md` to ANY docs page URL** → clean Markdown, no SPA shell. Fetch it with
   **WebFetch**. It's smaller, faster, and quote-accurate.
   - `…/docs/swml/reference/calling/connect` → `…/docs/swml/reference/calling/connect.md`
2. **Section indexes: append `/llms.txt`** to a section URL for a link map of that section -
   the reliable way to find the *current* canonical URL of a page when a guessed path 404s.
   - `signalwire.com/docs/llms.txt` (top level),
     `…/swml/llms.txt`, `…/server-sdks/llms.txt`, `…/apis/llms.txt`,
     `…/browser-sdk/llms.txt`, `…/compatibility-api/llms.txt`
3. **Docs MCP server** (Claude Code / Cursor): `https://signalwire.com/docs/_mcp/server`.
   If it's connected this session its tools show up via ToolSearch - prefer it for searching
   across the docs. If not connected, the `.md` + `/llms.txt` + WebFetch path needs no setup.

**Redirect gotchas:**
- `developer.signalwire.com/...` 301-redirects to `signalwire.com/docs/...`. WebFetch returns
  the redirect target rather than following it - refetch the `signalwire.com/docs` URL (`.md`).
- Some reference pages now sit under a `/calling/` segment, e.g.
  `…/swml/reference/calling/connect.md`, `…/swml/reference/calling/live-translate.md`. A stale
  guess can bounce to `app.buildwithfern.com` (which 404s). When that happens, **fetch the
  section's `/llms.txt` first** and read the real URL from the index instead of guessing.

## The pages worth knowing

| Need | Page (add `.md`) |
|---|---|
| SWML overview / method list | `signalwire.com/docs/swml` and `…/swml/llms.txt` |
| SWML `connect` (bridge a call) | `signalwire.com/docs/swml/reference/calling/connect` |
| SWML `live_translate` | `signalwire.com/docs/swml/reference/calling/live-translate` |
| Real-time translation tutorial (canonical topology) | `signalwire.com/blog/real-time-voice-translation` |
| Calling/Relay REST API | `signalwire.com/docs/apis` (+ `…/apis/llms.txt`) |
| cXML / Twilio-compat (`<Dial><Conference>`) | `signalwire.com/docs/compatibility-api/cxml` |
| Browser SDK v4 (`@signalwire/js`) | `signalwire.com/docs/browser-sdk/v4/guides/overview` |
| Fabric auth / Subscriber Access Tokens | `signalwire.com/docs/browser-sdk/v4/guides/authentication` |
| Server SDKs / AI agents (SWAIG) | `signalwire.com/docs/server-sdks` |

## Load-bearing facts about LIVE TRANSLATION (easy to get wrong)

- **`live_translate` toggles mid-call** (start / stop / inject, repeatedly) - but ONLY on a
  **Relay call** (`relay_pstn_call` / `relay_sip_call` / `relay_webrtc_call`). A **cXML/LAML
  leg is refused: `422 invalid_call_id_passed`.** (Confirmed by docs and by live measurement.)
- **Provider-blessed topology = a 2-party `connect`, NOT a conference:**
  `answer → [record_call] → live_translate.start{…} → connect{from,to}`. No official example
  pairs a conference with `live_translate`; whether it taps a conference mix is unproven.
- **`connect.to` accepts** a phone number, SIP URI, **Resource Address** (`/private/<userId>`
  for a Call Fabric / browser-softphone user), `queue:…`, or `stream:…`. It has `serial` and
  `parallel` array forms for ring-hunt / ring-all - so multi-agent routing needs no conference.
- **`direction: ["local-caller","remote-caller"]`** - local-caller = the leg live_translate
  runs on; remote-caller = the connected party. Both = bidirectional.
- **Toggle transport (REST):** `POST https://{space}/api/calling/calls` with
  `{command:"calling.live_translate", id:<relayCallId>, params:{action}}`. `action` is a
  **nested object** for start/summarize/inject and the **bare string** `"stop"` for stop.
- **AI "Skills" (SWAIG / AgentBase)** are for LLM voice *bots* that answer calls - not for a
  human-agent ↔ human-caller call. Don't reach for them for a normal softphone call.

## How to use this well

1. Find the exact page via the table or `…/llms.txt`.
2. Fetch its `.md` form with WebFetch and a specific question.
3. When a doc and a live measurement can disagree (e.g. whether a specific leg accepts a
   command on a given space), trust the measurement - SignalWire spaces have surprised the
   docs before.
