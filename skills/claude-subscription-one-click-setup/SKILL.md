---
name: claude-subscription-one-click-setup
description: >-
  How to let a user connect their Claude Pro/Max SUBSCRIPTION to a backend app with one
  button ("Sign in with Claude"), so the app runs on the user's own plan with no API key,
  exactly as Claude Code does. Read this BEFORE building any "sign in with Claude", BYOK
  subscription, or Claude-OAuth connect flow; before storing or refreshing a Claude OAuth
  token server-side; before adding multi-account switching or usage-limit rollover across
  Claude subscriptions; or when a subscription token fails with "OAuth access token has
  expired". Covers the public OAuth client, authorization-code + PKCE with the stateless-PKCE
  trick, the one-box paste that also accepts a setup-token and an API key, encrypted storage,
  refresh-at-call-time, the live model list, and the exact gotchas that cost days.
---

# Connect a Claude subscription to a backend with one button

> ## STATUS: THIS IS A RECIPE TO BUILD, NOT INSTALLED CODE
> Nothing here exists in your repo until you build it. The endpoint names, column names, and the
> reference code below are a template; adapt them to your stack (any language, any web framework,
> any datastore) and keep the shapes. The **public constants** in section 1 are real and
> hard-codeable; the **flow, the stateless-PKCE trick, the refresh-at-call-time rule, and the
> gotchas** are the load-bearing parts. Verify against Anthropic's current docs if a value ever
> stops working.

This skill is the complete, self-contained recipe for letting a person connect their **Claude
Pro / Max subscription** to a server app and have the app make model calls on that person's own
plan, with **no Anthropic API key**, the same way Claude Code authenticates. It is written to be
copied into any project in any language. Nothing here is specific to one codebase.

It took a lot of trial and error to get right. The hard-won facts are called out as **GOTCHA**.
Follow the pieces in order; they are small, and the whole thing is maybe a day of work once you
know the shape below.

---

## 0. The one thing to understand first (why this is even possible)

Anthropic's **Messages API does not accept a subscription login.** `POST /v1/messages` accepts
only a Console **API key** (`sk-ant-api...`) or Workload Identity Federation. A Pro/Max
**subscription** has no API key. So you cannot "just call the API" on a subscription.

What a subscription *can* do is authenticate the way **Claude Code** does: through Claude
Code's **public OAuth client**, using the authorization-code grant with PKCE. The resulting
**OAuth access token** is then sent to the normal Anthropic endpoints as a **Bearer** token with
a specific beta header, and Anthropic serves it against the user's plan (subject to the plan's
usage limits). This is a supported, public flow (it is what the `claude` CLI and the Agent SDK
use). You are not reverse-engineering anything private; you are using the same public client id.

Two consequences shape everything below:

1. **The sign-in itself must go through Anthropic's own login page in a browser.** There is no
   way to do a pure server-to-server "exchange my username/password for a token" flow, and you
   should not try to build one (it would also be against Anthropic's terms, which disallow
   *offering* claude.ai login as a product to third parties). The user signs in on Anthropic's
   page; your server only kicks it off and finishes the exchange. (Letting a user sign into
   **their own** account to run **their own** assistant is fine; building a login-as-a-service
   for other people is not.)

2. **OAuth access tokens are short-lived** (on the order of minutes to an hour). You must
   **refresh at call time**, not only at sign-in, or a job that runs an hour later fails with
   `OAuth access token has expired`. This is the single most common mistake. See section 7.

---

## 1. Constants (all public, not secrets)

These are Claude Code's public OAuth client values. They are safe to hard-code.

```
CLIENT_ID          = 9d1c250a-e61b-44d9-88ed-5944d1962f5e
AUTHORIZE_URL      = https://claude.ai/oauth/authorize
TOKEN_URL          = https://platform.claude.com/v1/oauth/token
REDIRECT_URI       = https://platform.claude.com/oauth/code/callback
SCOPE              = user:inference user:profile user:sessions:claude_code user:mcp_servers
MODELS_URL         = https://api.anthropic.com/v1/models            # GET, paginate ?limit=100&after_id=...
MESSAGES_URL       = https://api.anthropic.com/v1/messages
OAUTH_BETA_HEADER  = anthropic-beta: oauth-2025-04-20
ANTHROPIC_VERSION  = anthropic-version: 2023-06-01
```

The `REDIRECT_URI` points at Anthropic's own callback page, which simply **displays a code** for
the user to copy. That is deliberate: it means your server needs no public callback endpoint and
no inbound redirect handling. The user copies the code and pastes it into your app.

---

## 2. The flow, end to end (what the user sees)

1. User clicks **"Sign in with your Claude subscription"**.
2. A new browser tab opens to `AUTHORIZE_URL` (Anthropic's page). The user approves.
3. Anthropic's page shows a **code** of the form `CODE#STATE` (a code, then `#`, then the state).
4. The user copies that whole string and pastes it into **one input box** in your app, hits Save.
5. Your server exchanges it at `TOKEN_URL` for `{ access_token, refresh_token, expires_in, account }`.
6. Your server stores the tokens (encrypted) and can now call Claude on the user's plan.
7. (Nice to have) Your app fetches the live model list so the user picks a model.

The same one box also accepts a pasted **setup-token** (`sk-ant-oat...`, from `claude setup-token`)
and a plain **API key** (`sk-ant-...`). Classify the pasted string and branch (section 6).

---

## 3. The non-obvious trick that makes it pleasant: stateless PKCE

PKCE normally needs you to generate a random `code_verifier`, remember it between "start" and
"finish", and send it at exchange time. Remembering it means a session or a DB row that must
survive the round trip through the browser. That is fragile and annoying.

**Instead, derive the verifier from the `state` with an HMAC under a server secret.** Then
nothing has to persist: the browser carries only the `state` (it is inside the pasted
`CODE#STATE`), and at exchange time the server recomputes the exact same verifier from that state.

```
state     = base64url(randomBytes(24))
verifier  = base64url( HMAC_SHA256( serverSecretKey, "pkce:" + state ) )
challenge = base64url( SHA256( verifier ) )
```

`serverSecretKey` is any stable 32-byte server secret. It can be the **same key** you use to
encrypt stored tokens (section 8). It never leaves the server.

This is the whole reason the UX is "click, approve, paste, done" with no server-side session.

---

## 4. Server endpoint: START

`POST /oauth/start` -> returns `{ url, state }`. No body needed.

```
state      = base64url(randomBytes(24))
verifier   = base64url(HMAC_SHA256(serverSecretKey, "pkce:" + state))
challenge  = base64url(SHA256(verifier))
url = AUTHORIZE_URL + "?" + urlencode({
  code: "true",
  client_id: CLIENT_ID,
  response_type: "code",
  redirect_uri: REDIRECT_URI,
  scope: SCOPE,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: state,
})
return { url, state }
```

`base64url` = standard base64 with `+`->`-`, `/`->`_`, and trailing `=` stripped.

Reference implementation (TypeScript, Node `crypto`; trivially portable):

```ts
import { createHash, createHmac, randomBytes } from "node:crypto";

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifierForState = (serverKey: Buffer, state: string) =>
  b64url(createHmac("sha256", serverKey).update(`pkce:${state}`).digest());

export function start(serverKey: Buffer): { url: string; state: string } {
  const state = b64url(randomBytes(24));
  const challenge = b64url(createHash("sha256").update(verifierForState(serverKey, state)).digest());
  const q = new URLSearchParams({
    code: "true", client_id: CLIENT_ID, response_type: "code", redirect_uri: REDIRECT_URI,
    scope: SCOPE, code_challenge: challenge, code_challenge_method: "S256", state,
  });
  return { url: `${AUTHORIZE_URL}?${q}`, state };
}
```

---

## 5. Server endpoint: FINISH (exchange the pasted code)

`POST /oauth/finish` with body `{ code }` where `code` is the pasted `CODE#STATE`.

```
split the pasted string on the FIRST "#": left = code, right = state
verifier = base64url(HMAC_SHA256(serverSecretKey, "pkce:" + state))   # recomputed, not stored
POST TOKEN_URL  (content-type: application/x-www-form-urlencoded), body:
    grant_type=authorization_code
    code=<code>
    state=<state>
    client_id=<CLIENT_ID>
    redirect_uri=<REDIRECT_URI>
    code_verifier=<verifier>
Use a 90-SECOND timeout (this endpoint is slow).
On 2xx, response JSON: { access_token, refresh_token, expires_in, account: { email_address } }
Store: {
  access_token,
  refresh_token,                                  # may be absent; keep "" then
  expires_at: expires_in ? Date.now()+expires_in*1000 : 0,   # 0 = never
  account_email: account?.email_address ?? "",
}
```

```ts
export async function finish(serverKey: Buffer, pasted: string, fetchImpl = fetch) {
  const i = pasted.indexOf("#");
  if (i <= 0) throw new Error("expected CODE#STATE");
  const code = pasted.slice(0, i), state = pasted.slice(i + 1);
  const body = new URLSearchParams({
    grant_type: "authorization_code", code, state,
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: verifierForState(serverKey, state),
  });
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 90_000);
  try {
    const res = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString(), signal: ac.signal });
    if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
    const j = await res.json();
    return {
      accessToken: j.access_token, refreshToken: j.refresh_token ?? "",
      expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : 0,
      accountEmail: j.account?.email_address ?? "",
    };
  } finally { clearTimeout(t); }
}
```

**GOTCHA - the code is single-use and expires in minutes.** If the exchange fails, the most
likely cause is a reused or stale code (the user clicked Sign in twice, or waited too long). Show
a precise message: *"That code belongs to an earlier sign-in attempt or was already used. Click
Sign in again, approve, and paste the whole CODE#STATE once."* Do not show a generic error; this
exact wording saves support round-trips.

---

## 6. The one box: accept three kinds of paste

Users will paste one of three things into the same input. Classify the trimmed string:

```
if it matches /^sk-ant-oat/            -> SETUP TOKEN  (claude setup-token output)
else if it does NOT start with "sk-"   -> OAUTH CODE   (the CODE#STATE from the browser)
     and matches /^[^\s#]+#[^\s#]+$/
else                                   -> API KEY      (a plain sk-ant-... key)
```

- **OAUTH CODE**: run FINISH (section 5). Store `kind = "oauth"`, with refresh token + expiry.
- **SETUP TOKEN**: store the string as the access token, `kind = "setup_token"`,
  `refresh_token = ""`, `expires_at = 0` (one-year token, does not refresh via this flow;
  the user re-pastes a new one yearly).
- **API KEY**: store the string, `kind = "api_key"`, `expires_at = 0`.

Order matters: test `sk-ant-oat` BEFORE the generic `sk-` check, or a setup-token is misread as an
API key.

---

## 7. Calling Claude with the connection + REFRESH AT CALL TIME

Build request headers by credential kind:

```
OAUTH or SETUP TOKEN:  authorization: Bearer <token>
                       anthropic-version: 2023-06-01
                       anthropic-beta: oauth-2025-04-20       # REQUIRED for a subscription token
API KEY:               x-api-key: <token>
                       anthropic-version: 2023-06-01
```

**GOTCHA - refresh before the token is used, not only at sign-in.** OAuth access tokens are
short-lived. Any code path that is about to make a model call must first check and refresh:

```
if kind == "oauth" and refresh_token and Date.now() >= expires_at - 10*60*1000:
    POST TOKEN_URL (form): grant_type=refresh_token, refresh_token=<rt>, client_id=<CLIENT_ID>   (90s timeout)
    response: { access_token, refresh_token?, expires_in }
    token = access_token
    refresh_token = response.refresh_token ?? old refresh_token   # some refreshes rotate it, some don't
    expires_at = expires_in ? Date.now()+expires_in*1000 : 0
    persist the rotated values
A setup-token / API key (expires_at == 0, no refresh_token) is used as-is.
```

Put this at the **call site** (where the token is pulled right before an API request), not only in
the sign-in handler. A background job that starts hours after sign-in will fail otherwise. This is
the mistake that looks like "it worked when I tested it, then broke overnight."

**Health ping** (to prove a connection is good): `POST MESSAGES_URL` with the subscription headers
and a tiny body `{ model: "claude-haiku-4-5", max_tokens: 1, messages: [{role:"user",content:"ping"}] }`.
HTTP 200 or 429 means the sign-in is valid (429 = valid but rate/usage limited). 401/403 means the
token is bad and the user must re-auth.

**GOTCHA - a usage limit is HTTP 429.** When the plan's limit is hit, calls return 429, not an auth
error. Treat 429 as "this account is used up right now," not as "re-auth." (This is the hook for
multi-account rollover, section 11.)

---

## 8. Storing the tokens (encrypted, server-side)

Never store a token in plaintext, never return it to the browser, never log it.

- Keep one **32-byte server master key** (env var, e.g. `TOKEN_SEAL_KEY`, base64 or hex). This can
  be the **same** key used for the stateless-PKCE HMAC (section 3). Set it once as infrastructure;
  it is not something the user provides.
- Seal each token with **AES-256-GCM**. Store `iv(12) | authTag(16) | ciphertext`. Use a stable,
  per-record **associated data (AAD)** - the row id is ideal - so a sealed blob cannot be moved to
  another row and still decrypt.
- Store, per connection: a name, `kind` (`oauth`/`setup_token`/`api_key`), the sealed access token,
  the sealed refresh token (null for setup-token/api-key), `expires_at` (0 = never),
  `account_email`, and a **plaintext masked tail** (last 4 chars) purely for display.
- Decrypt only in memory, at the moment of a call. The plaintext never leaves the process.

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export function seal(token: string, key: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv); c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
export function unseal(blob: Buffer, key: Buffer, aad: string): string {
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12)); d.setAAD(Buffer.from(aad));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8");
}
```

If your app is multi-tenant and has a per-user encryption key system, note that **this token is
infrastructure, not user content**: it belongs to the operator/account, not to an end user, so a
single server master key (the pattern above) is the right fit, the same way a TOTP secret or a
service credential is sealed. Do not force it through a per-end-user key system.

**Least privilege:** if a background worker reads the active token to make calls, give it a narrow,
single-purpose read (e.g. a stored procedure that returns only the active row's sealed blob) rather
than a broad read of the whole token table. The blob is still ciphertext either way; this just
limits blast radius.

---

## 9. The model list (what the user can pick)

`GET MODELS_URL` with the credential headers (section 7), paginating `?limit=100&after_id=<last_id>`
while `has_more`. Return the models newest-first, deduped by id. This is the same list Claude Code
shows. Use it to populate a model picker after the user connects.

```
headers = subscription headers (Bearer + oauth beta) OR x-api-key, per kind
loop: GET MODELS_URL?limit=100[&after_id=...] -> { data:[{id,display_name,created_at}], has_more, last_id }
collect, dedupe by id, sort by created_at desc
```

---

## 10. The client button (the part that quietly breaks)

```
[ text input: account name ]
[ "Sign in with your Claude subscription" ]
[ text input: paste the code (or a token) ]   [ Save ]
```

**GOTCHA - open the tab synchronously, set its URL after the await.** Browsers block a popup that
is opened *after* an `await`. So on the click handler, FIRST `const tab = window.open("", "_blank")`
synchronously, THEN call `/oauth/start`, THEN `tab.location.href = url`. Also render `url` as a
plain fallback link in case the popup was still blocked.

```ts
async function signIn() {
  const tab = window.open("", "_blank");            // sync, before any await
  const { url } = await api("/oauth/start", { method: "POST" });
  if (tab) tab.location.href = url;                 // point it after start returns
  setFallbackLink(url);                             // also show as a clickable link
}
```

**GOTCHA - stop password managers from eating the pasted code.** Make the paste input
`type="text"` with `autocomplete="off" data-1p-ignore data-lpignore="true"`. A password manager
will otherwise overwrite the pasted sign-in code with a saved password and the exchange fails.

**GOTCHA - guard Save against double-submit.** A sign-in code works exactly once. If Enter and a
click both fire, the second exchange fails with "already used." Disable Save while one is in flight.

After a successful Save, fetch the model list (section 9) and show it.

---

## 11. Multiple accounts and automatic usage-limit rollover (optional but recommended)

If a user has several Claude subscriptions, you can chain them so that when one is **used up**, the
app continues to the next automatically, and only falls back to a paid API key (or another provider)
when all are exhausted.

- Store many connections with an **order** (a rank, or "active first, then the rest").
- At call time, resolve the **ordered list** of usable tokens (refresh each as in section 7).
- Try the first. **On HTTP 429 (usage limit), advance to the next account and retry the same
  request.** Only when every account 429s do you give up (to your API-key fallback, or an error).
- Keep per-account usage records so you can see which account/model answered and how much it used.

Do NOT treat 401/403 as "move to next" - that is a broken/expired connection for that account, which
should surface for re-auth, not silently skip. Only 429 (and other transient 5xx/overload) rolls over.

---

## 12. Secrets hygiene checklist

- The access token, refresh token, setup-token, and API key are all secrets: sealed at rest,
  never returned to the browser, never logged. Add a log redactor for `sk-ant-oat` and `sk-ant-api`
  prefixes if your logs could ever capture a body.
- The `CLIENT_ID`, URLs, scope, and beta header are **public**; hard-coding them is fine.
- The server master key (`TOKEN_SEAL_KEY`) is the one real secret you introduce. 32 random bytes,
  set once in the environment. Rotating it invalidates all stored tokens (users re-connect), so
  treat it like any long-lived infra key.

---

## 13. The failure modes you will actually hit, and the fix

| Symptom | Cause | Fix |
|---|---|---|
| Exchange returns 4xx right after approving | code reused / stale / pasted twice | single-use; re-run Sign in, paste once; guard double-submit (section 10) |
| Works at first, fails ~1h later with "OAuth access token has expired" | no refresh at call time | refresh-at-call-time (section 7), not only at sign-in |
| Popup never opens | `window.open` called after `await` | open the tab synchronously on click, set URL after (section 10) |
| Pasted code gets mangled | password manager overwrote the input | `type=text autocomplete=off data-1p-ignore data-lpignore=true` |
| 401/403 on calls | bad/expired token, or missing beta header | ensure `anthropic-beta: oauth-2025-04-20` on subscription tokens; re-auth if still failing |
| 429 on calls | the plan's usage limit is reached (NOT an auth problem) | show "limit reached, try later"; or roll to the next account (section 11); do not retry-loop |
| Token exchange times out | `TOKEN_URL` is slow | 90-second timeout on the exchange and refresh calls |
| A sealed token won't decrypt | wrong key, or the blob was moved between records | bind the AAD to the record id; one master key; re-seal on re-connect |

---

## 14. Minimal build order (checklist)

1. Pick/generate the 32-byte server master key; set it in the environment.
2. Implement `seal`/`unseal` (section 8) and the stateless-PKCE `verifier`/`challenge` (section 3).
3. `POST /oauth/start` (section 4).
4. `POST /oauth/finish` + the one-box classifier (sections 5-6); store the connection.
5. Call-time helper that refreshes then returns the token + builds headers (section 7).
6. `GET /models` (section 9).
7. The button + one box + model list in the UI, with the three gotchas (section 10).
8. (Optional) ordering + 429 rollover across accounts (section 11).
9. Health-ping to prove it (section 7). Confirm a call succeeds AGAIN an hour later (proves refresh).

That ninth step is the real acceptance test: a call that succeeds immediately AND a call that
succeeds an hour later. If both pass, the refresh is wired correctly and you are done.
