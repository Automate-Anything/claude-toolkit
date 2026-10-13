---
name: standard-supply-chain-security
description: "Standard 26 of the engineering standards library: software supply chain security. Covers how to evaluate a dependency before adopting it, lockfile enforcement, automated vulnerability scanning, the Software Bill of Materials (SBOM), a dependency update strategy, private and internal packages, protection against typosquatting, dependency confusion and malicious updates, and vendoring critical dependencies. Read it BEFORE adding, upgrading or removing any package, before setting up dependency scanning or automated update bots, and when the user says \"add a package\", \"npm install\", \"upgrade dependencies\", \"npm audit\", \"vulnerability\", \"CVE\", \"lockfile\", \"SBOM\", \"Dependabot\", \"Renovate\", \"typosquatting\", \"dependency confusion\", or \"is this library safe\"."
---

# Supply Chain Security: dependencies you can trust

> **Agent rule.** Where this standard says lockfiles are committed, it describes the repository
> convention. An agent updates the lockfile in the working tree; it commits only when the owner
> explicitly asks.

## PHILOSOPHY
Your application is only as secure as its weakest dependency. A single compromised package can expose millions of users. Treat dependencies as attack surface.

## 1. DEPENDENCY MANAGEMENT RULES

### Before Adding ANY Dependency:
- Is it actively maintained? (check last commit date, issue response time)
- How many weekly downloads? (popularity = more eyes on security)
- How many maintainers? (bus factor: 1 maintainer = high risk)
- What is its dependency tree? (does it pull in 200 sub-dependencies?)
- Can you achieve this with standard library or existing dependencies?
- Is it licensed compatibly? (MIT, Apache 2.0 = safe; GPL = viral, check implications)

### Rules:
- **Fewer dependencies = less risk.** Every dependency is a liability.
- Prefer well-known, widely-used packages over niche ones
- Evaluate alternatives before adding new dependencies
- Document WHY each dependency was chosen (architecture decision record)

## 2. LOCKFILE ENFORCEMENT (CRITICAL)

| Language | Lockfile | Command to Generate |
|----------|---------|-------------------|
| Node.js | package-lock.json / yarn.lock / pnpm-lock.yaml | `npm install` / `yarn` / `pnpm install` |
| Python | Pipfile.lock / poetry.lock / requirements.txt (pinned) | `pipenv lock` / `poetry lock` / `pip freeze` |
| PHP | composer.lock | `composer install` |
| Java | pom.xml (with pinned versions) / gradle.lockfile | Explicit version pinning |
| Ruby | Gemfile.lock | `bundle install` |
| Go | go.sum | `go mod tidy` |
| Rust | Cargo.lock | `cargo build` |

### Rules:
- ALWAYS commit lockfiles to version control
- CI/CD uses lockfile for reproducible builds (`npm ci`, not `npm install`)
- Lockfile changes should be reviewed in code review (new/updated deps are security-relevant)
- Never ignore lockfile conflicts. Resolve them carefully.

## 3. VULNERABILITY SCANNING (AUTOMATED)

### Run on Every Build:
```bash
# Node.js
npm audit
# or: npx auditjs ossi  (for OSS Index scanning)

# Python
pip audit
# or: safety check

# PHP
composer audit

# Java
mvn dependency-check:check  # OWASP Dependency-Check
# or: gradle dependencyCheckAnalyze

# Ruby
bundle audit check

# Go
govulncheck ./...

# Rust
cargo audit
```

### Rules:
- Scan runs in CI pipeline on every push
- Critical/high vulnerabilities block the build
- Medium vulnerabilities tracked as technical debt (fix within 30 days)
- Low vulnerabilities reviewed quarterly
- Subscribe to security advisories for critical dependencies

## 4. SOFTWARE BILL OF MATERIALS (SBOM)

### What Is an SBOM?
A complete inventory of every component in your software: dependencies, their versions, licenses, and known vulnerabilities. Required by:
- US Executive Order 14028 (federal software)
- EU Cyber Resilience Act (all software sold in EU)
- Many enterprise procurement processes

### Generate SBOM:
```bash
# Node.js (CycloneDX format)
npx @cyclonedx/cyclonedx-npm --output-file sbom.json

# Python
pip install cyclonedx-bom
cyclonedx-py environment --output sbom.json

# General (Syft - works with any language)
syft . -o cyclonedx-json > sbom.json
```

### Rules:
- Generate SBOM as part of release process
- Include SBOM in release artifacts
- Review SBOM for unexpected or unauthorized components
- Use SBOM to track which products are affected when a new CVE is announced

## 5. DEPENDENCY UPDATE STRATEGY

### Cadence:
- **Security patches**: Apply within 24-48 hours of disclosure
- **Minor updates**: Review and apply monthly
- **Major updates**: Plan and execute quarterly (with testing)

### Automation:
- Use automated dependency update tools (Dependabot, Renovate, Snyk)
- Auto-create PRs for dependency updates
- Auto-merge patch updates that pass all tests
- Require manual review for major version bumps

### Before Updating:
- Read the changelog (breaking changes?)
- Run full test suite against the update
- Check if other dependencies are compatible
- Deploy to staging first

## 6. PRIVATE/INTERNAL PACKAGES

If your organization publishes internal packages:
- Use a private registry (npm private, PyPI private, Artifactory, Nexus)
- Require package signing
- Scan internal packages with the same rigor as external ones
- Version internal packages following semver
- Document internal package APIs

## 7. PROTECTION AGAINST COMMON ATTACKS

| Attack | Description | Prevention |
|--------|------------|-----------|
| **Typosquatting** | Malicious package with similar name (e.g., `lodsah` vs `lodash`) | Verify package names carefully. Use lockfiles. |
| **Dependency Confusion** | Public package replaces internal package | Scope internal packages. Configure registry priority. |
| **Compromised Maintainer** | Legitimate maintainer account hijacked | Pin versions. Review lockfile diffs. Monitor advisories. |
| **Malicious Update** | Legitimate package pushes malicious update | Pin versions. Delay auto-updates. Scan on install. |
| **Protestware** | Maintainer intentionally sabotages own package | Pin versions. Review changelogs. Vendor critical deps. |

## 8. VENDORING CRITICAL DEPENDENCIES

For mission-critical applications, consider vendoring (copying dependency source into your repo) for:
- Core security libraries
- Dependencies with a single maintainer
- Dependencies that have gone unmaintained
- Any dependency where a surprise change would be catastrophic

## IMPLEMENTATION REQUIREMENT
Every project audits dependencies on every build. Every lockfile is committed and enforced. Every new dependency is evaluated before adoption. Supply chain security is not paranoia. It is engineering.

## RELATED SKILLS

- `standard-ci-cd-pipeline`: where the audit step runs.
- `standard-audit-ready-code`: the dependency and build requirements auditors check.
- `standard-threat-modeling`: the wider security testing strategy.
