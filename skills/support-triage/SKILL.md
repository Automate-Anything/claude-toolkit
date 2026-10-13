---
name: support-triage
description: How to process ONE incoming customer support request end to end in a SaaS product - pull it, investigate against the customer's LIVE data and the LIVE code, cross-check the error/alert board, classify it, draft the reply in the house style, get the owner's approval, then send and close it yourself from a script. Read this the moment the owner says "check request #N", pastes a request's "copy for AI" payload, forwards a "new support request" or "still waiting on a first reply" email, or says "process this request / support ticket / customer message", "triage support", "answer this customer", "reply to the customer", "handle this chat". Also read it before BUILDING a support inbox, a request board, a request-number scheme, a diagnostics bundle, or the get/reply/resolve scripts, because it carries the data-model decisions and every landmine that already bit. Use when the user mentions a customer request, support ticket, support chat, a requests board, a diagnostic bundle, a request number, unread replies, or a satisfaction survey.
---

# Support Triage

> ## Adapt before use
> This describes how support triage SHOULD be wired, taken from a production SaaS
> where it runs daily. The scripts, tables and endpoints named here are EXAMPLES
> of the shape, not things that exist in this repo. Grep first. If a name here
> disagrees with the live code or database, the code wins. Once the real system
> exists in this repo, replace the example names with the real ones and add the
> repo's own landmines to section 10.

How to take ONE customer support request from "just landed" to "answered and closed."

---

## 0. The rule that never bends

> **Nothing reaches the customer, and nothing is closed, without the owner's explicit approval of THAT item.**
> Investigate and DRAFT, show the owner the draft in full, wait. Approval means a message from the
> owner, sent AFTER you showed the draft, approving that specific send or resolve. "Process them
> all" picks what you work on next; it does not approve a send.
>
> **Once approved, YOU do it.** Send with the reply script, close with the resolve script. Never ask
> the owner to paste a reply into the board, and never ask them to log you into a browser to send
> one. (That happened once and cost a full round trip for a one-line send.)

Two things sit OUTSIDE this approval rule and follow their own rules:

- Changing CODE to fix a bug the request uncovered follows the repo's normal rules (edit freely,
  never commit or push unless the owner explicitly asks in that conversation).
- Changing a customer's DATA for them (their settings, a record of theirs) always needs the owner's
  yes, even when it is obviously what the customer wants.

---

## 1. The toolbelt: three commands, nothing else

A support agent needs exactly three scripted actions. If the repo does not have them, build them
before you triage by hand (see the `scripted-admin-actions` skill for how to build them safely).

| When | Command (example names) |
|---|---|
| The owner says "check request #12", or you want the queue | `get_request 12` / `get_request open` |
| The owner approved a reply | `reply_request 12 <reply.txt>` |
| The request is fully handled | `resolve_request 12 "<one-sentence summary>" [--no-survey]` |

- **get** is read-only. It prints exactly what the board's "copy for AI" button copies: the
  requester, what they said, the whole conversation, the diagnostics bundle, and any OTHER recent
  request from the same person. `open` lists every open request and flags the ones with NO REPLY
  YET.
- **reply** calls the SAME endpoint as the board's Send button, so it stores the reply, emails the
  customer the branded "we replied" email, and logs the email. It does not reimplement any of
  that. It authenticates as a named staff user through a one-off server-side login that it signs
  out afterwards (default the owner, a flag to change who). It refuses text containing an em dash
  or en dash. Put the approved text in a file in your scratchpad and pass the path.
- **resolve** marks the request resolved and stamps the one-sentence summary. Know exactly which
  side effects it has and which it skips compared with the board's Resolve button. In the
  reference system the script did NOT send the customer the "resolved" email (the button did), and
  resolving a ticket queued a satisfaction survey two hours later. Hence `--no-survey` for a
  duplicate, a test, or anything the customer never got a real answer on.

**After sending, VERIFY.** The reply row exists, and the outbound email log shows a sent status to
the customer's address. Report it with that evidence. Do not report "sent" from the script's exit
code alone.

---

## 2. The data model (what a "request" is)

Decide this once and write it down, because every confusion below came from it being fuzzy.

- **One number for everything.** Customers and staff say "Request #12". Use ONE global sequence
  across every kind of request (tickets, chats, whatever else), assigned by a trigger at insert.
  That number goes on the board, in the new-request emails, in customer emails, and is what all
  three commands accept.
- **A per-tenant ticket number is NOT that number.** If each company's first ticket is "1", that
  number is useless for staff. Do not quote it and do not look requests up by it.
- **Different channels are the same thing from our side.** A ticket and a chat are both "a customer
  wrote in and is waiting." Model the differences explicitly so nobody guesses:

| | Ticket (example) | Chat (example) |
|---|---|---|
| Their words | subject + description | message rows with a sender type |
| Our replies | comment rows (author is a required staff user) | message rows with sender type "rep" |
| Diagnostics | a JSON field on the ticket | a JSON field on the conversation |
| "Answered" means | a first-responded timestamp is set | a rep message exists |
| Assign / claim | yes | no |

- **A converted request keeps its number.** A chat converted to a ticket keeps the same request
  number, and from then on the ticket IS the request.
- **One customer can open two requests for one problem minutes apart** (a chat and a ticket). The
  get command lists the same person's other recent requests for exactly this reason. Answer ONCE,
  on one of them, and resolve the other with `--no-survey` and a summary naming the request it
  duplicates.
- **A request is a conversation the customer can keep writing in.** Their reply reopens a
  resolved, closed, or waiting-on-customer request, bumps last activity, and notifies the team.
  The customer can also close their own request (no survey, leaves a visible "the customer closed
  this request" line).
- **Unread needs no column.** Record each customer view as an activity-log row; unread = a public,
  non-system comment by someone else that is newer than that person's last view. Only the person
  who opened the request has unread on it. To make a reply show as read or unread in a test, add
  or remove those rows. Do not bolt a read flag onto the ticket.

---

## 3. How a request reaches us (and why nothing is allowed to sit)

- The moment a request lands, an email goes to every support agent plus the owner. The subject
  leads with the request number, and the body carries a copy-paste block for an agent.
- **Every morning one digest lists every request still waiting on a FIRST reply, oldest first, and
  repeats daily until each is answered or resolved.** If the owner forwards that digest, run the
  queue command.
- The owner's board has a "copy for AI" button whose output equals the get command's output.
- **Do not offer live chat you do not staff.** In the reference system nobody staffed chat, so a
  customer who got no agent in a few minutes was told "we will reply right here and email you."
  That is a ticket with worse expectations, so live chat was removed as an entry point and every
  new request became a written one. Treat every unanswered chat as a message waiting on a written
  reply, open a late reply with an apology for the wait, and do not add a way to start a chat back
  unless someone will actually sit on it.
- The customer-facing surface should be ONE box ("What do you need help with?"). No subject, no
  category, no priority. Derive the subject from the first line and default the rest. Next to it,
  a "my requests" view with our replies and their replies back.
- **How the customer learns we replied** must be redundant: the reply email (its button opens that
  exact request), an in-app notice with a View button, a banner on the help panel, a count on the
  "my requests" tab, and a "new reply" mark on the request. All of them read ONE unread source.

---

## 4. Investigate BEFORE you classify

Do not guess how a feature works, and do not take the customer's diagnosis as the diagnosis. A
report of "the site double booked me" turned out to be a record the customer's own staff deleted
in a connected calendar.

1. **Start from their data, not the code.** Resolve the account, location and contact from the
   bundle and SELECT the actual rows they are talking about. Pull the column list of any table
   before you query it. Guessed column names fail.
2. **Reconstruct the timeline.** For "X happened and should not have": pull every row in the
   disputed window INCLUDING cancelled and deleted ones, with created and updated timestamps, plus
   the audit log for those row ids (the list of changed fields tells you which code path wrote).
   Put it in order. The answer is usually visible in the order of events.
3. **Then trace the code path** that wrote the surprising value, end to end, in the LIVE code.
   Migration files lie; the live database and the live code are the truth.
4. **Check what they did around the report.** What the customer changed right before and after
   writing in (a record they cancelled, a reason they typed, a block they added) tells you what
   they actually saw.
5. **Use the domain skill** for the area so the explanation is correct, not plausible. For money or
   charge questions, pull the payment processor's own numbers first.
6. **Media:** a video or audio attachment goes through the `media-review` skill, never frame by
   frame.

**Diagnostics are context, not authority, and are identifiers only.** A bundle captures what the
browser saw, which includes noise. Example: bundles listed analytics pings with status 0 as
"failed API calls" until the capture was fixed to exclude them. Ignore that class of entry. Never
quote ids or raw bundle contents back to the customer.

---

## 5. Cross-check the error/alert board (every time it could be a bug)

Query the alert store for the customer's account id and the route, most recent first. See the
`error-alert-system` skill.

- **Already alerted and resolved:** tell the customer warmly that we caught it on our side and it
  is fixed.
- **Alerted and still open:** say it is a known issue being fixed. Promise no date.
- **Real bug with NO alert:** that is a capture gap. Fix the capture at the source as well as the
  bug. A customer should never be the monitoring system.

---

## 6. Classify

| Bucket | Meaning | What you do |
|---|---|---|
| **Knowledge gap** (most) | Works as designed; they need it explained, or a setting is wrong. | Draft the answer. If the docs failed them, hand off to `help-center-upkeep` (Mode B) after answering. |
| **Bug** | The code does the wrong thing. | Root-cause it, fix the SOURCE, then answer. Never draft "works fine" over a real bug. |
| **Feature request** | Does not exist. | Decline gracefully unless it is a small generic win; note it for the owner. |
| **Product gap behind a knowledge gap** | It worked as designed, but the product gave them no way to see what happened, so they blamed us. | Answer the customer AND fix or raise the gap. |

The fourth bucket is the one agents miss. Example: a record removed by an outside integration
looked to the customer like our bug, because nothing on the record said why it was gone. The fix
was to stamp a visible reason on the record ("Deleted from the connected calendar"), so the next
customer answers their own question.

Search the help center before writing a long answer, and link an article if a good one exists.

---

## 7. Draft the reply (house style)

- Warm, direct, plain, first person. Answer first. NO em dashes or en dashes.
- Late reply: say sorry for the delay in the first line.
- Say what happened in order, with their own names, days and times in THEIR timezone. Convert from
  UTC and check the weekday; a wrong weekday destroys the customer's trust in the whole answer.
- Say what you do not know. If you cannot tell who did something, say what you can see and what it
  rules out. Never invent a cause.
- Give the concrete next step, and offer to make a settings change for them when that is easier
  (doing it still needs the owner's yes).
- End by asking for the specific example if they may have meant a different incident.
- No internal ids, no table names, no jargon.

---

## 8. Present to the owner, then act

Present compactly: requester and company, request number, classification in one line, whether an
alert existed, any duplicate request, any bug or product gap you found, and the draft in full.
Then wait.

On approval:

1. Send with the reply script, then verify the reply row and the email.
2. If the same person has a duplicate request, resolve the duplicate with `--no-survey`.
3. Leave the answered request OPEN while you are waiting on the customer. Resolve only when the
   issue is actually cleared. Never resolve a bug before its fix is written and verified.
4. Docs gap: hand off to `help-center-upkeep`.

Billing requests (more trial time, a plan change, a refund) follow the same rule zero: preview,
show the owner, act only on the explicit yes. See `scripted-admin-actions`.

---

## 9. If you are BUILDING this system

Minimum that makes triage possible without a UI login:

1. One global request-number sequence across every request table, set by a trigger.
2. A diagnostics bundle captured at submit time (identifiers only: account, location, user, route,
   recent failed calls, app version). Exclude third-party analytics pings from "failed calls".
3. A new-request fan-out email to agents plus the owner, with the number first.
4. A daily "still waiting on a first reply" digest that repeats until answered.
5. The three scripts, where reply reuses the board's own endpoint.
6. An outbound email log so "did the customer get it" is a query, not a guess.
7. A satisfaction survey queued on resolve, with a way to suppress it.
8. A board with a "copy for AI" button.

---

## 10. Landmines (each one happened)

- **Code that needs a migration must not sit beside an unapplied migration.** If the owner's deploy
  ships everything in the working tree, code selecting a new column can go live before its
  migration runs. That took the support board down once. Apply the migration first (with
  approval), or hold the dependent code until it is applied, and put up a maintenance notice if a
  gap is unavoidable.
- **A reply needs a real author.** If replies require a staff user row, a staff login with no
  matching user row cannot author a reply at all, and a code path that inserts a null author
  fails for everyone. If a reply returns "failed to send", check the author before anything else.
- **Resolving queues a survey.** Suppress it when a survey would be wrong.
- **The activity log table has a fixed column list.** A service that sends one extra field the
  table does not have gets every insert rejected, and if the caller swallows the error nobody
  notices for weeks. Pull the live columns; do not trust the service's idea of them.
- **Constrained enums bite.** A notification-log column that only allows two event types will
  reject the third one you invent. Pull the constraint before adding an event type.
- **Any direct UPDATE on a request bumps "last activity."** For a backfill, pause the
  updated-at trigger inside the transaction so the board does not reorder itself.
- **Some kinds of request cannot be assigned or claimed** on the board. Know which.
- **Running the support service locally against the PRODUCTION database:** its background jobs
  (digests, surveys, fan-outs) must be OFF, or your dev machine emails real customers. Start it
  with jobs disabled, every time. Without it running, the local app's help panel shows a load
  error, which is expected.

Related skills: `error-alert-system` (alert cross-check), `help-center-upkeep` (docs gaps),
`media-review` (video and audio), `scripted-admin-actions` (the scripts and billing actions).
