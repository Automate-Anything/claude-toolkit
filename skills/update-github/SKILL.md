---
name: update-github
description: How to make changes to a GitHub repository owned by this account (repo SETTINGS like description / homepage / topics / visibility, issues, releases, and any GitHub REST API call) from a non-interactive session, WITHOUT claiming you cannot. Read this the moment you are about to tell the user "I can't do that on GitHub", "the GitHub MCP is down", "gh is not logged in", "you'll have to do it yourself", or "that needs GitHub settings I can't reach" about a repo this account owns. The account's git credential manager holds an admin-scoped GitHub token that works as a REST API bearer token, so almost everything is doable from here. Covers: where the credential is, how to pull it, how to call the API, and the pushing-vs-settings vs owner-approval rules. Triggers: GitHub settings, repo description, homepage, topics, make public/private, visibility, GitHub API, gh CLI, "update the repo", "set the About section", "I can't reach GitHub", bookingpro-api-docs, Automate-Anything.
---

# Update GitHub: you almost certainly CAN, so do not say you cannot

## The rule that exists because an agent broke it

**Before you tell the user you cannot do something on a GitHub repo this account
owns, you MUST actually try it.** Do not reason your way to "I can't" from
surface signals and then report that as fact. This skill exists because an agent
repeatedly told the owner "I can't change the repo settings, that needs the
GitHub API and I have no auth here" while an admin-scoped token was sitting in
the git credential manager the whole time. The owner had to push back three
times before the agent tried the actual call, which worked on the first attempt.

That was a lie, even though the agent believed it. A confident "I can't" that
turns out to be false is worse than "let me try": it makes the owner do work
that was never theirs, and it teaches them not to trust your "I can't".

**The signals that feel like "no access" but are NOT:**

- The GitHub MCP server failed to connect this session. (That is one path, not
  the only one.)
- `gh auth status` says "not logged into any GitHub hosts". (`gh` is not the
  only way to call the API.)
- There is no `GH_TOKEN` / `GITHUB_TOKEN` in the environment. (The token is not
  in an env var; it is in the credential manager.)

None of those mean you lack access. They mean you have not looked in the right
place yet.

## Where the API key (credential) lives, and how to use it

This account's git uses the **git credential manager** (`credential.helper =
manager`). The same credential that authorizes `git push` over HTTPS is a
**GitHub personal token that works as a REST API bearer token**, and for this
account's own repos it has **admin scope** (`admin: true`, `push: true`).

**Pull the token (works from any directory, no repo context needed):**

```bash
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
```

**Verify it before trusting it** (identity + that it is not empty):

```bash
[ -n "$TOKEN" ] && curl -s -o /dev/null -w "user API: %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" https://api.github.com/user
```

A `200` means you are authenticated and can call the whole GitHub REST API as
this account. Never print the token value; redact it (`password=<redacted>`) in
any output.

## What you can do with it (examples, all verified working)

Repo settings are a plain REST call. Fill `TOKEN` as above, then:

**Description + homepage** (PATCH the repo):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo> \
  -d '{"description":"...","homepage":"https://..."}'
```

**Topics** (PUT, replaces the whole set):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PUT \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/topics \
  -d '{"names":["api","rest-api","openapi","..."]}'
```

The same token drives the rest of the API: issues, labels, releases, branch
settings, collaborators, and so on. When in doubt, check the endpoint in the
GitHub REST docs and call it with this bearer token.

**`gh` is an alternative, not a requirement.** If you prefer `gh` and it is not
logged in, you can still use the raw `curl` calls above. (Logging `gh` in needs
an interactive browser/device flow that a non-interactive session cannot
complete, so do not block on it.)

## Verify as the public sees it

After a settings change, confirm it **unauthenticated** (no token header), which
is what the world actually gets:

```bash
curl -s https://api.github.com/repos/<owner>/<repo> | grep -E '"(description|homepage|visibility)"'
curl -s https://api.github.com/repos/<owner>/<repo>/topics -H "Accept: application/vnd.github+json"
```

## The boundaries that DO still apply

Being able to do it does not remove the owner's standing rules. Two things are
about permission, not capability, and they do not change:

1. **Pushing commits is gated by the commit/push approval rule.** You can push to
   the public docs repo, but you still ask for the explicit go-ahead each time
   (it is hook-enforced), exactly as for any commit. Capability is not consent.
2. **Destructive or high-blast-radius settings need explicit owner approval
   before you do them**, not after. That includes: **changing visibility**
   (public <-> private), **renaming or transferring** a repo, **deleting** a
   repo / branch / release / tag, **archiving**, and changing who can access it.
   For those, describe what you are about to do and get a clear yes first. Low
   risk, reversible metadata (description, homepage, topics, an issue label) you
   can just do when the owner asked for the outcome.

If a specific call genuinely fails (a `403` scope error, a `404` meaning the
token cannot see that repo, a `422` validation error), THEN report that, with
the actual status code and what it means, and say what would unblock it. That is
an honest "I tried and here is the real obstacle", which is the opposite of the
guessed "I can't" this skill exists to prevent.

## The one-line version

The GitHub token is in the git credential manager
(`printf "protocol=https\nhost=github.com\n\n" | git credential fill`), it has
admin on this account's repos, and it works as a REST API bearer token. So
before you say you cannot change something on GitHub, pull it and try. Only
visibility/rename/transfer/delete-class changes need the owner's yes first.
