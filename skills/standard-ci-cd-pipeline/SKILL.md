---
name: standard-ci-cd-pipeline
description: "Standard 21 of the engineering standards library: how a CI/CD pipeline should be built. Covers the CI steps that run on every push (install, lint, format, type check, test, build, security audit, coverage), the CD stages on merge to main, deployment strategies (rolling, blue/green, canary, feature flags) and how to choose one, the environment strategy, secrets in CI, quality gate thresholds, migrations in the pipeline, rollback plans, GitHub Actions and GitLab CI examples, DORA metrics, and pipeline anti-patterns. Read it BEFORE setting up or changing a CI workflow, a deploy pipeline, a release process, or a rollback plan, and when the user says \"set up CI\", \"CI/CD\", \"GitHub Actions\", \"GitLab CI\", \"pipeline\", \"deploy strategy\", \"blue/green\", \"canary\", \"feature flag rollout\", \"quality gates\", \"DORA metrics\", or \"how should we deploy this\"."
---

# CI/CD Pipeline: automated quality gates

> **Agent rule (overrides anything below that implies otherwise).** This standard describes how the
> project and its pipeline should be set up. An agent never commits, pushes, merges, runs
> history-changing git, triggers a deploy, or publishes a release on its own initiative. It does
> those only when the owner explicitly asks in the current conversation. Otherwise: make the change,
> say exactly what is ready, and offer the next step.

The pipeline below runs automatically when a human pushes or merges. "Merge to main triggers a
deploy" is a description of the pipeline, not permission for an agent to merge or push. An agent
writes the workflow files and explains them; the owner decides when code is pushed, merged, and
deployed.

## PHILOSOPHY
Code that is not automatically tested and deployed is code that will break in production. Automate everything that can be automated. A human should never be the only thing between bad code and production.

## 1. CONTINUOUS INTEGRATION (CI) - ON EVERY PUSH

### Pipeline Steps (in order):
```
1. INSTALL    -> Install dependencies (npm install, pip install, composer install)
2. LINT       -> Run linter (ESLint, Flake8, PHP_CodeSniffer, Checkstyle)
3. FORMAT     -> Check formatting (Prettier, Black, php-cs-fixer --dry-run)
4. TYPE CHECK -> Static type analysis (TypeScript, mypy, PHPStan, SpotBugs)
5. UNIT TEST  -> Run unit tests (Jest, pytest, PHPUnit, JUnit)
6. BUILD      -> Compile/bundle (webpack, vite, javac, go build)
7. INTEG TEST -> Run integration tests (API tests, DB tests)
8. SECURITY   -> Dependency audit (npm audit, pip audit, composer audit)
9. COVERAGE   -> Check test coverage meets minimum threshold
```

### Rules:
- ALL steps must pass before a PR can be merged
- Pipeline runs on every push to every branch
- Pipeline runs on every pull request
- Failed pipeline = blocked merge. No exceptions.
- Keep pipeline fast (< 10 minutes for CI, < 30 minutes total)

## 2. CONTINUOUS DEPLOYMENT (CD) - ON MERGE TO MAIN

### Deployment Pipeline:
```
1. MERGE TO MAIN  -> Triggers deployment pipeline
2. BUILD           -> Production build (minified, optimized)
3. TEST (again)    -> Full test suite against production build
4. DEPLOY STAGING  -> Deploy to staging environment
5. SMOKE TEST      -> Automated checks on staging (health check, critical paths)
6. DEPLOY PROD     -> Deploy to production (if staging passes)
7. HEALTH CHECK    -> Verify production is healthy after deploy
8. NOTIFY          -> Alert team of successful/failed deployment
```

### Deployment Strategies (Detailed):

#### Rolling Deployment
Replace instances one at a time. Zero downtime.
```
Instance 1: v1 -> v2 (while 2,3,4 serve v1)
Instance 2: v1 -> v2 (while 3,4 serve v1)
Instance 3: v1 -> v2 (while 4 serves v1)
Instance 4: v1 -> v2 (complete)
```
- **Best for**: Most deployments, simple applications
- **Risk**: Both versions run simultaneously during rollout
- **Rollback**: Reverse the rolling update

#### Blue/Green Deployment
Two identical environments. Deploy to inactive, switch traffic instantly.
```
BLUE (v1) <- traffic          GREEN (v2) deploying...
BLUE (v1) <- traffic          GREEN (v2) ready, smoke tested
BLUE (v1) standby            GREEN (v2) <- traffic switched
```
- **Best for**: Zero-risk deployments, instant rollback needed
- **Risk**: Requires double infrastructure (temporary)
- **Rollback**: Switch traffic back to blue (instant)

#### Canary Deployment
Route small percentage of traffic to new version, monitor, gradually increase.
```
Phase 1:  v2 gets 5% of traffic    -> monitor 15 minutes
Phase 2:  v2 gets 25% of traffic   -> monitor 15 minutes
Phase 3:  v2 gets 50% of traffic   -> monitor 15 minutes
Phase 4:  v2 gets 100% of traffic  -> done
```
- **Best for**: High-risk changes, large user bases
- **Risk**: Small subset of users see issues first
- **Rollback**: Route 100% back to v1 at any phase
- **Automated canary**: Abort if error rate or latency exceeds threshold

#### Feature Flags
Deploy code to production but control visibility via configuration.
```
if (featureFlags.isEnabled('new-checkout', user)) {
    showNewCheckout();
} else {
    showOldCheckout();
}
```
- **Best for**: Gradual rollouts, A/B testing, kill switches
- **Risk**: Code complexity, flag debt (clean up old flags)
- **Rollback**: Disable the flag (instant, no deployment needed)

#### Feature Flag Rules:
- Every feature flag has an owner and expiration date
- Remove flags within 30 days of full rollout
- Track active flags in a central registry
- Test both flag states in CI
- Use percentage-based rollouts for gradual exposure

#### Choosing a Strategy:

| Scenario | Strategy |
|----------|---------|
| Standard release, low risk | Rolling |
| Critical service, zero tolerance for downtime | Blue/Green |
| Major change, need to validate with real traffic | Canary |
| Feature not ready for all users yet | Feature Flag |
| Hotfix that must go out immediately | Rolling (fast) or Blue/Green |
| Database schema change | Blue/Green with backward-compatible migration |

## 3. ENVIRONMENT STRATEGY

| Environment | Purpose | Deploys From | Access |
|-------------|---------|-------------|--------|
| **Local** | Development | Working copy | Developer only |
| **CI** | Automated testing | Every push | Automated |
| **Staging** | Pre-production testing | main branch | Team |
| **Production** | Live users | After staging approval | Public |

### Rules:
- Each environment has its own configuration (.env per environment)
- Staging mirrors production as closely as possible
- Never test against production database
- Use separate database instances per environment

## 4. SECRET MANAGEMENT IN CI/CD

- NEVER store secrets in code or pipeline config files
- Use CI/CD platform's secret management (encrypted environment variables)
- Secrets are injected at runtime, never visible in logs
- Rotate CI/CD secrets on the same schedule as application secrets
- Principle of least privilege: each pipeline step gets only the secrets it needs

## 5. QUALITY GATES (MINIMUM THRESHOLDS)

| Gate | Minimum | Ideal |
|------|---------|-------|
| Unit test pass rate | 100% | 100% |
| Test coverage (critical paths) | 80% | 90%+ |
| Linting errors | 0 | 0 |
| Security vulnerabilities (high/critical) | 0 | 0 |
| Build warnings | < 10 | 0 |
| Performance regression | < 10% slower | No regression |

## 6. DATABASE MIGRATIONS IN CI/CD

- Run migrations automatically as part of deployment
- Migration runs BEFORE new application code starts
- If migration fails, abort deployment (do not start new code)
- Test migration rollback in staging before production
- Keep migrations backward-compatible when possible (allows rollback without data loss)

## 7. ROLLBACK PLAN

Every deployment must have a rollback strategy:
- Keep previous version available for instant rollback
- Database migrations should be reversible
- Feature flags allow disabling new features without rollback
- Monitor key metrics for 15-30 minutes after deploy
- Automated rollback if error rate exceeds threshold

## 8. PIPELINE CONFIGURATION EXAMPLES

### GitHub Actions
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: npm install
      - name: Lint
        run: npm run lint
      - name: Test
        run: npm test
      - name: Build
        run: npm run build
```

### GitLab CI
```yaml
stages: [lint, test, build, deploy]
lint:
  stage: lint
  script: npm run lint
test:
  stage: test
  script: npm test
```

### The pattern is the same regardless of platform:
Install > Lint > Test > Build > Deploy

## 9. DORA METRICS (Engineering Performance)

Track these four metrics to measure your team's delivery performance:

| Metric | Elite | High | Medium | Low |
|--------|-------|------|--------|-----|
| **Deployment Frequency** | Multiple per day | Weekly to monthly | Monthly to 6-monthly | Less than once per 6 months |
| **Lead Time for Changes** | < 1 hour | 1 day to 1 week | 1 to 6 months | > 6 months |
| **Mean Time to Restore (MTTR)** | < 1 hour | < 1 day | 1 day to 1 week | > 6 months |
| **Change Failure Rate** | 0-15% | 16-30% | 16-30% | > 30% |

### How to Improve Each Metric:
- **Deployment Frequency**: Smaller PRs, feature flags, automated pipelines
- **Lead Time**: Reduce PR review time, automate testing, trunk-based development
- **MTTR**: Better monitoring, runbooks, automated rollback, blameless postmortems
- **Change Failure Rate**: Better testing, code review, staging environments, canary deploys

## 10. PIPELINE ANTI-PATTERNS

| Anti-Pattern | Problem | Solution |
|-------------|---------|---------|
| Manual deployment | Error-prone, not reproducible | Automate everything |
| No staging environment | Bugs found in production | Mirror production in staging |
| Skipping tests to deploy faster | Technical debt, outages | Tests are non-negotiable |
| Long-running pipelines (> 30 min) | Slow feedback, developers ignore | Parallelize, cache dependencies |
| No rollback plan | Stuck with broken deployments | Every deploy is reversible |
| Deploying on Fridays | Weekend incidents | Deploy early in the week (or have strong monitoring + on-call) |
| No deployment notifications | Team unaware of changes | Notify on every deploy |
| Same pipeline for all branches | Waste on feature branches | Full pipeline on main, lighter on branches |

## IMPLEMENTATION REQUIREMENT
Every project has a CI pipeline from the first commit. Every merge to main is tested automatically. Every deployment is automated and reversible. DORA metrics are tracked to measure and improve delivery performance. Manual deployment to production is not professional engineering.

## RELATED SKILLS

- `standard-ship-with-confidence`: deploy ordering, post-deploy smoke test, definition of done.
- `standard-supply-chain-security`: the dependency audit step in detail.
- `standard-infrastructure-as-code`: the containers and environments the pipeline deploys to.
- `standard-incident-management`: what to do when a deploy goes wrong.
