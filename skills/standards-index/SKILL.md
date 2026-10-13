---
name: standards-index
description: "The index of the engineering standards library: every numbered standard (00 through 39) with the skill that carries it and one line on when to read it, plus the cross-cutting non-negotiables that apply to every task. Read it at the START of a session, when you are not sure which standard applies to a task, before starting any new project or feature, and when the user says \"follow the standards\", \"which standard covers this\", \"what are the rules for\", \"the standards library\", \"rules index\", or names a standard by number (for example \"standard 21\" or \"rule 38\")."
---

# Standards Index: start here

The standards library is a set of generic engineering rules that apply to any project in any
language. Each standard is its own skill, named `standard-<topic>`. This index routes to them.

**If a task touches a topic listed below, READ that skill before acting.** When in doubt, read it.
Reading is cheap; shipping audit-failing or buggy code is not. Read the skill in full: do not infer
its content from the one-line trigger here.

## Cross-cutting non-negotiables (every task, every line of code)

These override convenience, speed, and "it's just a small change". If a task forces a violation,
stop and surface the conflict to the owner.

1. **Zero hardcoded secrets.** No API keys, passwords, tokens, or credentials in source code. Use
   environment variables or a secret manager. `.env.example` is tracked in git; `.env` is not.
2. **Parameterized queries only.** Never concatenate user input into SQL, OS commands, LDAP, or any
   other query language.
3. **Server-side validation always.** Client-side checks are UX, not security.
4. **Output encoding always.** Escape user-generated content before rendering. Never `innerHTML`,
   `dangerouslySetInnerHTML`, `{!! !!}`, or `|safe` with untrusted data.
5. **No `Math.random()` for security.** Use a CSPRNG (`crypto.randomBytes`,
   `crypto.getRandomValues`, `secrets.token_hex`) for tokens, IDs, salts, anything that must be
   unpredictable.
6. **Passwords: bcrypt (cost >= 12) or Argon2id only.** Never MD5, SHA1, SHA256 without a KDF, or
   plaintext.
7. **HTTPS / TLS 1.2+ everywhere.** No exceptions in production.
8. **"Done" requires user-verifiable evidence.** "It compiles", "tests pass", "the route returned
   200" are NOT done. Done means the user can perform a specific action and the feature works end
   to end. If you cannot verify it yourself, name the exact action the user must perform and wait.
   See `standard-ship-with-confidence`.
9. **No TODOs, FIXMEs, mocks, or placeholders pretending to be finished.** If a feature is partial,
   say so explicitly.
10. **Database changes require a migration file.** Never edit a production schema without a
    tracked, reversible migration. A rename or drop during live traffic uses expand-contract (see
    `standard-ship-with-confidence`). Before any database write, pull the live schema and verify
    against it.
11. **Git is the single source of truth.** Anything the project needs to run must be in version
    control. No untracked server-side files.
12. **Never commit, push, merge, or deploy without explicit owner instruction.** Offer at session
    end; do not act unilaterally.

## Session start

1. If `CLAUDE.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, or `docs/INFRASTRUCTURE.md` exist in
   the project, read them. They are the source of truth for project state.
2. If they do not exist, tell the owner, offer to scaffold them, and wait. Details in
   `standard-project-continuity`.
3. Read the project facts (paths, hosting, stack, domains): `standard-project-info-template`.

## The catalog

Three of these were always-active in the source library and apply to every session:
`standard-project-continuity` (31), `standard-audit-ready-code` (38), and
`standard-ship-with-confidence` (39).

### Project context and meta-rules

| # | Skill | Read when |
|---|-------|-----------|
| 00 | `standard-project-info-template` | Starting any session, or any task that needs to know where the project lives, what stack it uses, or how it is deployed. |
| 31 | `standard-project-continuity` | Starting any session. Ending any session. Setting up `CLAUDE.md` and `docs/` for a new project. |
| 38 | `standard-audit-ready-code` | Any code that handles auth, sessions, user input, payments, or PII, or that will be reviewed for CASA, Google OAuth, Meta DPA, or OWASP compliance. When in doubt whether a security rule applies, read it. |
| 39 | `standard-ship-with-confidence` | Before claiming "done", "shipped", or "working". Before any deploy. When debugging a reported bug. |

### Security

| # | Skill | Read when |
|---|-------|-----------|
| 01 | `standard-security-fortress` | Building auth, forms, file uploads, API tokens, session handling, encryption, rate limiting, security headers. |
| 04 | `standard-config-and-secrets` | Working with `.env` files, secrets, environment variables, deployment configuration, secret rotation. |
| 25 | `standard-data-privacy-compliance` | Storing or processing PII. GDPR, CCPA, HIPAA, consent, data deletion, breach response. |
| 26 | `standard-supply-chain-security` | Adding or updating dependencies. Lockfiles, SBOMs, vulnerability scanning. |
| 28 | `standard-threat-modeling` | Designing a new system or major feature. Doing a security review. Writing a `security.txt`. |

### Frontend and UX

| # | Skill | Read when |
|---|-------|-----------|
| 02 | SEO excellence: see the existing `seo` skill | Any public-facing page. Meta tags, schema, sitemaps, Core Web Vitals. |
| 03 | `standard-assets-organization` | Setting up CSS and JS structure, design tokens, BEM, the asset loading strategy. |
| 05 | `standard-clean-urls` | Writing URLs, links, redirects, rewrite rules, server config, routing. |
| 06 | Mobile responsive design: see the existing `mobile-view-optimization` skill | Any responsive web work. Mobile-first layouts, breakpoints, touch targets, PWA. |
| 09 | `standard-design-system` | Defining colors, typography, spacing, shadows, components. Setting up a design token system. |
| 11 | `standard-accessibility-wcag` | Any UI work. WCAG 2.1 AA is the bar: keyboard navigation, screen readers, contrast, focus, motion. |
| 12 | `standard-error-handling-ux` | Writing error pages, loading states, empty states, form validation, network error handling. |
| 23 | `standard-internationalization` | Multi-language support. RTL. Date, number, and currency formatting. |

### Backend, API, and data

| # | Skill | Read when |
|---|-------|-----------|
| 13 | `standard-api-design` | Designing or modifying any HTTP API. REST conventions, JSON envelope, status codes, CORS, pagination, versioning. |
| 14 | `standard-database-design` | Schema design, migrations, indexes, naming, SQL and NoSQL patterns. |
| 22 | `standard-backup-disaster-recovery` | Setting up backups, planning RPO and RTO, designing for disaster recovery. |
| 27 | `standard-infrastructure-as-code` | Docker, Kubernetes, Terraform, IaC, environment parity. |
| 30 | `standard-scalability-patterns` | High-traffic design. Caching, queues, load balancing, circuit breakers, auto-scaling, multi-region. |

### Mobile and cross-platform

| # | Skill | Read when |
|---|-------|-----------|
| 32 | `standard-cross-platform-development` | React Native and Expo work. Monorepo structure. Platform-specific code. Web support. |
| 33 | `standard-mobile-app-design` | Building native mobile UI. Material Design, HIG, navigation, safe areas, dark mode, haptics, RTL. For visual design craft read `mobile-app-ui-design`. |
| 34 | `standard-app-store-deployment` | Releasing to Google Play. APK signing and keystores. Versioning. OTA updates. For Apple review read `apple-app-store-submission`. |
| 35 | `standard-mobile-app-architecture` | Mobile state management. Navigation. Offline-first. Push notifications. Deep links. |
| 36 | `standard-native-device-apis` | Camera, location, biometrics, secure storage, file system, permissions, haptics, audio and video. |
| 37 | `standard-real-time-sync` | Real-time sync across platforms. WebSocket. Offline queue. Conflict resolution. |

### Engineering practice

| # | Skill | Read when |
|---|-------|-----------|
| 07 | `standard-project-organization` | Setting up the folder structure for a new project, or reorganizing an existing one. |
| 08 | AI communication style: converted separately, see the note below | Reference for response format, migration docs, and feature docs. |
| 10 | `standard-local-dev-environment` | Setting up the project to run locally. Migration workflows. Multi-stack dev environments. |
| 15 | `standard-git-workflow` | Branching strategy, commit messages, `.gitignore`, end-of-session backup. |
| 16 | `standard-guided-setup` | The owner needs step-by-step help with external services, accounts, or tools rather than code. |
| 17 | `standard-testing-strategy` | Writing tests. Designing the test pyramid. Security and performance testing. |
| 18 | `standard-performance-optimization` | Optimizing speed. Performance budgets, caching strategy, Core Web Vitals, CDN. Also read `page-performance` and `query-efficiency`. |
| 19 | `standard-code-quality` | Linting and formatting setup. Code review. Complexity management. |
| 20 | `standard-logging-monitoring` | Adding logging, monitoring, SLOs and SLIs, error tracking, distributed tracing. |
| 21 | `standard-ci-cd-pipeline` | Setting up CI/CD. Choosing a deployment strategy (rolling, blue/green, canary, feature flags). DORA metrics. |
| 24 | `standard-incident-management` | Responding to a production incident. Writing runbooks. Postmortems. |
| 29 | `standard-architecture-decisions` | Making any significant architectural decision. Writing ADRs. Tracking technical debt. |

### Unnumbered companions

| Source | Skill | Read when |
|--------|-------|-----------|
| Master protocol | Converted separately, see the note below | Starting work on any web or app project. The umbrella spec: architecture, security, design, SEO, communication, git, in compressed form. |
| Master web design prompt | Converted separately, see the note below | Building any visual UI. The designer persona and the list of design tells to avoid. Also read `ui-ux-pro-max`. |

**Note on rows without a `standard-` name.** Standards 02, 06, 08 and the two master files had no
`standard-<topic>` skill when this index was written. Before relying on the fallback named in the
row, list the `skills/` folder for a matching skill (a `standard-` skill for SEO, responsive
design or communication style, or a master protocol skill). If one exists, prefer it and update
this index.

## Existing toolkit skills that go deeper than a standard

A standard gives the generic rule. These skills carry the detailed, field-tested version. When
both apply, read both; where they disagree, the stricter rule wins.

| Topic | Skill |
|-------|-------|
| Multi-tenant database security (RLS, SECURITY DEFINER, storage policies) | `security-rls-permissions` |
| Apple App Store review and submission | `apple-app-store-submission` |
| The post-build review gate | `review-build` |
| Visual design for mobile screens | `mobile-app-ui-design` |
| Making a web app good on a phone | `mobile-view-optimization` |
| Capturing, alerting on, and triaging errors | `error-alert-system` |
| Query and data access speed | `query-efficiency` |
| React rendering speed | `page-performance` |
| Verifying a UI change in a real browser | `browser-verification` |

## How to use this index

- **In doubt, read.** Triggers are intentionally broad. The cost of reading a skill you did not
  strictly need is low. The cost of skipping one you did need is a bug, a security hole, or a
  rejected store submission.
- **Read in full, not by skimming.** Each standard's structure matters; partial reading misses
  constraints.
- **The non-negotiables above are the floor, not the ceiling.** The detailed standards raise the
  bar further when their topics are involved.
- **If two skills seem to conflict** (for example `standard-security-fortress` and
  `standard-audit-ready-code` on auth), the stricter rule wins. When still unsure, surface the
  conflict to the owner.
- **Adapt before use.** The standards are generic. Where a project already has a real system for
  something a standard describes, follow the project and note the difference.
