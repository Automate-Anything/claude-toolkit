---
name: standard-project-info-template
description: Fill-in template for a per-project fact sheet (name, type, paths, repository, hosting, domains, tech stack, project-specific rules, notes) that tells any agent the basic facts of the repo it is working in. Read this when starting a new project, when setting up agent instructions for a repo, when the user says "set up the project info", "fill in the project info", "create a project fact sheet", "document this project for the agent", or when you notice a repo has no single place that records its stack, environments and house rules.
---

# Standard 00 - Project Info Template

This is a per-project fill-in, not a rule set. Every repository should carry ONE short fact sheet
that an agent (or a new developer) reads first. Copy the template below into the project, fill in
every placeholder, and keep it current.

## Where the filled-in copy lives

- Put it where the agent already looks: the project's `CLAUDE.md` / `AGENTS.md`, or a file those
  point to (for example `docs/project-info.md` or `.claude/00-project-info.md`).
- One copy per project. Do not keep a second copy in another folder; they drift.
- It is committed to the repository, so treat it as public.

## Rules for filling it in

1. Fill in every placeholder. Do NOT delete unfilled sections: either fill them or replace the
   value with `N/A`.
2. NEVER write a secret into this file: no passwords, API keys, tokens, private key contents,
   or connection strings with credentials. Record WHERE the secret lives (a password manager
   entry name, the name of an environment variable, the path of a key file on the developer's
   machine), never the secret itself.
3. Prefer hostnames and names of environments over raw identifiers. If a server address or
   account ID is sensitive for this project, write "see password manager" instead.
4. Ask the owner for facts you cannot verify from the repo. Do not guess a domain, a host, or a
   branch strategy.
5. Update the sheet in the same change that makes it stale (new domain, new service, new
   database, changed branch strategy).

## The template

```markdown
# Project Information

This file is a per-project fact sheet. Fill in the placeholders below for the current project.
Do NOT delete unfilled sections - either fill them or replace the value with `N/A`.

## Project Overview
- **Name**: <PROJECT_NAME>
- **Type**: <e.g., Web application, Mobile app, API service, Static site>
- **Platform**: <e.g., Windows / macOS / Linux, IDE used>
- **Description**: <one-sentence summary of what this project does>

## Paths
- **Local root**: <absolute path to project root on this machine>
- **Repository remote**: <Git remote URL, or "TBD" if not yet created>
- **Branch strategy**: <e.g., main (production), develop (integration), feature branches>

## Server / Hosting (if applicable)
- **Provider**: <e.g., a VPS provider, a cloud platform, a static host, self-hosted>
- **Host / IP**: <hostname or IP, or "N/A">
- **User**: <SSH user, or "N/A">
- **Auth**: <e.g., SSH key path, password manager reference, or "N/A" - never the secret itself>
- **Port**: <e.g., 22, or "N/A">
- **Connect command**: <full ssh / connection command, or "N/A">

## Domains (if applicable)
- **Production**: <e.g., https://example.com>
- **Staging**: <e.g., https://staging.example.com>
- **API**: <e.g., https://api.example.com>

## Tech Stack
- **Frontend**: <e.g., React, Vue, plain HTML/CSS/JS>
- **Backend**: <e.g., Node/Express, Django, PHP, Spring>
- **Database**: <e.g., PostgreSQL, MySQL, MongoDB, SQLite>
- **Other services**: <e.g., Redis, object storage, mail provider>

## Key Rules (Project-Specific)
- NEVER hardcode URLs or secrets - use environment config
- The agent never commits, pushes, or runs history-changing git on its own initiative.
  It does so only when the owner explicitly asks. At the end of a session it may remind
  the owner that there are uncommitted changes and suggest a commit message.
- All changes go through Git, never edit server files directly
- <add any project-specific rules here>

## Notes
<Any additional context an AI assistant should know about this project: known constraints,
in-flight migrations, naming quirks, etc.>
```

## Optional sections worth adding for larger projects

Some projects outgrow the basic sheet. When a repo has several deployable parts or hard
invariants, add these (pattern taken from a multi-app project's version of this standard):

- **Surfaces table**: one row per deployable or package (marketing site, web app, admin console,
  API service, worker, shared contracts package, migrations package, design tokens) with its path
  and a one-line description. State explicitly what does NOT exist (for example "there is no
  native mobile app in this repo") so a reviewer asking "is it added everywhere relevant?" has a
  closed list to check.
- **The change chain**: when one feature normally touches several places, write the chain down,
  for example: database migration, then API repository and router, then the shared contract,
  then the client API layer and page, then any background reader. A field added in only one link
  of the chain is a gap.
- **Invariants (never regress these)**: a short, named list of load-bearing rules for this
  project, each with a one-line reason and the test or check that enforces it. Typical entries:
  tenant isolation, offline or mock-first test runs, what may never appear in logs, fail-closed
  permission gating, migration ordering, how money is stored.

## Related skills

- `standard-config-and-secrets`: where secrets and environment values belong.
- `standard-project-organization`: folder layout and naming the fact sheet should describe.
- `standard-git-workflow`: branch and commit conventions referenced by "Branch strategy".
