---
name: standard-guided-setup
description: Standard for guiding a person step by step through tasks outside the code, such as creating accounts, configuring external services, DNS, hosting, SSL, email providers, payment gateways, OAuth apps, developer tools, servers and deployment. Covers the one-step-at-a-time rule, verify before proceeding, research first, explaining the why, the areas where guided help is typically needed, the response format and the troubleshooting approach. Read before walking the user through any setup they must perform themselves in a dashboard, console, registrar, app store or terminal, and when the user says "walk me through", "how do I set up", "guide me", "step by step", "I have never done this", "where do I click", "help me configure" or "I am stuck on this setup screen".
---

# Standard 16 - Guided Setup Assistance

Use this mode when the human has to perform the steps (in a provider dashboard, a registrar, a
server console) and the agent's job is to guide. If the agent can do the task itself with its own
tools, it should do the work and report, and guide only the parts that need the human.

Related skills: `standard-local-dev-environment` (what a working local setup looks like),
`standard-config-and-secrets` (handling the keys these setups produce), `browser-verification`
(checking the result in a real browser).

## When This File Is Referenced
The user may need help with tasks beyond code: setting up services, configuring tools, creating accounts, understanding concepts. The AI adapts its approach accordingly.

## Core Rules

### 1. Step-by-step Approach (Mandatory)
- Break every task into small, clear steps
- Give ONE step at a time
- Wait for the user to confirm completion before moving to the next step
- Never dump 10 steps at once

### 2. Verify Before Proceeding
- After each step, ask: "Done? Let me know and I'll continue."
- If the user encounters an error, help troubleshoot before moving on
- Never assume a step was completed successfully

### 3. Research First
- Before giving instructions, verify the current way to do things
- Check if tools, services, or methods have changed
- Verify compatibility and requirements
- If unsure whether something is possible, say so and research it

### 4. Explain the "Why"
- Briefly explain WHY each step is needed (1 sentence max)
- This helps the user learn, not just follow blindly
- Keep explanations concise

## Areas Where Guided Help May Be Needed

### External Services & Accounts
- Domain registration and DNS configuration
- Hosting setup (shared, VPS, cloud)
- SSL certificate installation
- Email service setup (SMTP providers, transactional email)
- Payment gateway integration
- API account creation for third-party services
- Search engine webmaster tools setup
- Analytics setup
- OAuth provider configuration

### Development Tools
- Version control (Git) setup and usage
- Local server environment setup (any stack)
- Database management tools
- IDE/editor setup and extensions
- Browser DevTools usage
- API testing tools
- Package managers (npm, pip, composer, Maven, etc.)
- Containerization (Docker)

### Server & Infrastructure
- Web server configuration (Apache, Nginx, IIS)
- Language runtime configuration (PHP, Node, Python, Java)
- Database server configuration and optimization
- Scheduled tasks / cron jobs
- File permissions
- Backup automation
- CDN setup
- Load balancing

### Deployment
- File upload and deployment processes
- Database migration to production
- DNS configuration and domain pointing
- SSL/TLS setup on hosting
- Environment configuration (dev to staging to production)
- CI/CD pipeline setup

## Response Format in Guided Mode
```
Step [N]: [What to do]
Why: [Brief reason]
How: [Exact instructions]

Let me know when done.
```

## Troubleshooting Approach
When the user hits a problem:
1. Ask what error message or behavior they see
2. Ask for a screenshot if helpful
3. Research the specific error
4. Provide a targeted fix
5. Verify the fix worked before continuing

## Important Notes
- Never assume the user knows technical jargon. Explain when first used.
- Provide exact URLs when directing to external sites
- For paid services, mention pricing upfront
- For security-sensitive steps (API keys, passwords), remind about safety
- If a task is beyond what AI can help with (e.g., phone verification), say so clearly

## Additional Notes

- Ask one question at a time. When there is a choice to make, present it as lettered options
  with the trade-off of each, recommended option first, and wait for the reply.
- When a step produces a secret (API key, client secret, password), tell the user exactly where
  to store it (the name of the environment variable or the password manager) and ask them NOT to
  paste it into chat unless there is no alternative.
- Dashboards change. If the screen the user describes does not match your instructions, say so
  and re-check the current documentation instead of insisting.
