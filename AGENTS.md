# Agent instructions (toolkit)

This file carries the cross-agent rules and skill index for coding agents that do
not run Claude Code's hooks (Cursor, Codex, and any other agent that reads an
`AGENTS.md`). Claude Code enforces these same rules mechanically through hooks;
here they are written as instructions so every agent follows them.

## Rules every agent must follow

- **Never use em dashes or en dashes** (the `-` and `-` characters, U+2014 / U+2013).
  Use regular hyphens, commas, colons, or separate sentences. This applies to
  every message and every file you write.
- **Never commit, push, or run history/tree-changing git** (`git commit`, `push`,
  `reset`, `checkout -- `, `stash`, `clean`, `rebase`, `merge`, `branch -D`) on
  your own initiative. Do it only when the user explicitly asks in that
  conversation. Making a code change is permission to EDIT, not to commit.
- **Do not run destructive shell commands** (`rm -rf`, force-delete, mass
  overwrite) unless the user explicitly asked for that exact action.
- **Before a database write** (a migration, an `INSERT`/`UPDATE`/`DELETE`/`DROP`),
  pull the LIVE schema of every table/function/trigger it touches and verify your
  SQL against it byte for byte. Migration files and memory drift; only the live
  database is truth.
- **Ask one question at a time, as multiple choice.** Give each option its
  trade-off and put your recommended option first. Use the agent's question
  popup when it has one; otherwise ask in the chat with lettered options and
  wait for the reply.
- **A swallowed error must be surfaced.** A catch block or DB exception handler in
  a backend path (webhook, cron, route, job) that logs but never reports the
  failure is a silent production bug. Report it, or mark it a conscious benign
  catch. See the `error-alert-system` skill.
- **Self-Answer Test before any question.** Try, in order: common sense, the
  industry standard, the conversation so far, then the code and the live system.
  If any of them answers it, decide, state the decision in one line, and proceed.
  Ask only when the answer is truly the owner's to give.
- **Fix the source, not the symptom.** Fix the code that writes the bad value,
  not every place that reads it. If a problem comes back, the last fix was a
  symptom patch.
- **Documents are for the agent, the chat is for the owner.** Never park a
  question in a document or send the owner to read one. Say it in the chat.
- **Never remove a feature a user can use, and never take an irreversible
  action, without the owner's explicit, specific yes.**
- **Done means user-verifiable end to end**, on every target screen size and
  every surface the change touches. "It compiles" or "tests pass" is not done.
  The report names what was verified and what was not.
- **Respect a shared checkout.** Never revert or reformat changes you did not
  make. When asked to commit, stage by exact path, never "add all", unless the
  owner asked for a full release.
- **Check for prior work on every branch before building a feature.**
- **Record every decision the owner gives** in the project's decision log, and
  never ask him to decide it again.
- **Never fabricate.** Do not claim a test, a read, or a number that did not
  happen. Say "I don't know" and go find out.
- **Secrets by path or variable name only.** Never paste a secret value into the
  chat, a tool parameter, or a file.

## Skills

The skills live in the sibling `skills/` folder (one folder per skill, each with a
`SKILL.md`). They are the same format Claude Code, Cursor, and Codex all read.
Before doing work a skill covers, read that skill first. Highlights:

- **The owner (read these first in any new project):** `how-the-founder-thinks`
  (how he decides, what he rejects, what he counts as done), `founders-style`
  (how he writes and how to write to him), `working-with-the-owner` and
  `working-agreements` (the standing agreements for working in his repos).
- Engineering standards: `page-performance`, `query-efficiency`,
  `security-rls-permissions`, `report-verification`, `error-alert-system`,
  `latency-and-efficiency`, `nextjs-supabase-performance`,
  `auth-and-access-control`, `url-structure`, `timezone-handling`,
  `ui-conventions`.
- Working discipline: `verify-before-done`, `database-write-safety`,
  `debugging-discipline`, `safe-file-and-git-operations`.
- The standards library: `standards-index` lists every `standard-*` skill
  (security, config and secrets, design system, accessibility, API design,
  database design, testing, code quality, logging, CI/CD, backups, i18n,
  incidents, privacy, supply chain, infrastructure as code, threat modeling,
  architecture decisions, scalability, cross-platform and mobile apps, real-time
  sync, audit-ready code, ship with confidence) and when each applies.
- Product judgment + review: `build-with-the-user-in-mind`, `review-build`,
  `acting-as-the-manager`.
- Money paths: `money-truth-doctrine`, `pos-checkout-design`,
  `payment-processor-integration-checklist`, `saas-subscription-billing`,
  `commission-system-design`, `memberships-and-packages-design`,
  `serialized-inventory-and-consignment`, `bank-transaction-feed` (getting the daily transactions and balances), `bank-reconciliation` (matching them).
- Reports: `report-verification`, `analytics-reports-architecture`.
- AI agents: `internal-ai-agent-architecture`, `ai-model-platform`,
  `multi-agent-assistant-architecture`, `inject-tool-knowledge-on-use`,
  `ai-data-migration-agent`, `universal-migration-connector`,
  `competitor-data-migration`.
- Phone and voice: `retell-phone-agent`, `voice-agent-prompting`,
  `self-hosted-voice-agent`, `phone-number-provisioning`,
  `voice-mishear-aliases`, `signalwire-docs`.
- Messaging: `whatsapp-whapi-integration` (with the vendor reference `whapi`),
  `whatsapp-self-hosted-evolution`, `iproyal-proxies`, `email-infrastructure`,
  `release-announcements`.
- Running a product: `support-triage`, `help-center-upkeep`,
  `customer-onboarding-doors`, `public-api-upkeep`, `scripted-admin-actions`,
  `ticketing-system`, `ticketing-client-onboarding`, `hosted-website-builder`,
  `conference-booth-playbook`.
- Deploy and operations: `release-and-deploy-sequence`, `deploy-freshness`,
  `maintenance-banner`, `alert-patrol`, `agent-access-and-toolchains`,
  `infrastructure-overview-template`, `update-github`,
  `cloudflare-pages-management`, `gpu-training-and-serving`.
- Apps on devices: `apple-app-store-submission`, `ios-build-from-windows`,
  `android-device-bridge`, `tauri-desktop-app`.
- Growth: `seo`, `local-seo-playbook`, and the Google Ads set (`google-ads-audit`,
  `keyword-research`, `ad-copy-generation`, `budget-optimization`,
  `competitor-analysis`, `conversion-tracking`, `landing-page-audit`,
  `quality-score-optimization`).
- Platform: `browser-verification`, `media-review`, `claude-model-skill`, `claude-vault`,
  `claude-subscription-one-click-setup`.
- Stripe: `stripe-best-practices`, `stripe-docs`, `stripe-directory`,
  `stripe-projects`, `connect-recommend`, `upgrade-stripe`.
- Design: `ui-ux-pro-max`, `apple-design`, `design-taste-frontend` (and its
  siblings `design-taste-frontend-v1`, `gpt-taste`, `high-end-visual-design`,
  `minimalist-ui`, `industrial-brutalist-ui`, `redesign-existing-projects`,
  `stitch-design-taste`, `image-to-code`, `imagegen-frontend-web`,
  `imagegen-frontend-mobile`, `brandkit`, `full-output-enforcement`).
- Motion: `motion-design`, `ui-animation`, `motion-dev-animations`.
- Mobile: `mobile-view-optimization` (make an existing web app genuinely good on
  a phone, screen by screen, without changing desktop), `mobile-app-ui-design`
  (the design bar for any mobile surface).
- Product animation: `product-animation-core` (read first), then
  `product-animation-website` (silent looping mockups on a site) or
  `product-animation-social-video` (voiced, captioned product-UI videos).
- Video: `ai-video-production` (films and ads with generated footage),
  `remotion-best-practices`.
- Process pack (third party, use when a task calls for it): `brainstorming`,
  `writing-plans`, `executing-plans`, `subagent-driven-development`,
  `dispatching-parallel-agents`, `systematic-debugging`,
  `test-driven-development`, `requesting-code-review`, `receiving-code-review`,
  `verification-before-completion`, `using-git-worktrees`,
  `finishing-a-development-branch`, `writing-skills`. Where one of these says to
  commit, merge, or push, the git rule above still wins.
- Authoring: `skill-creator` (write, improve, and eval-test new skills; follow its house
  conventions, including the no-em-dash rule).
- `install-toolkit`: how to install/update this toolkit in a repo.

Skills that describe a system to BUILD (error alerts, RLS, the money-truth
doctrine, and "how it should be wired" sections) carry an "adapt before use" note.
They describe how things SHOULD be wired; update them once the real system exists
in this repo.
