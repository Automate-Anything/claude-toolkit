---
name: standard-incident-management
description: "Standard 24 of the engineering standards library: incident management. Covers severity classification (SEV1 to SEV4) with response times, the detect, triage, respond, resolve, review workflow, the blameless postmortem template, the runbook template for critical services, status page rules, and internal, external and resolution communication templates. Read it WHEN responding to a production incident or outage, and BEFORE writing a runbook, a postmortem, an on-call process, or a status page update, and when the user says \"production is down\", \"incident\", \"outage\", \"SEV1\", \"postmortem\", \"root cause analysis\", \"RCA\", \"runbook\", \"on-call\", \"status page\", or \"what do we tell customers\"."
---

# Incident Management and On-Call: when things break

> **Agent rule.** During an incident an agent investigates, reads logs, and proposes the fix or the
> rollback. It does not deploy, roll back, restart services, or change production data on its own
> initiative: it states the recommended action and waits for the owner to ask for it.

## PHILOSOPHY
Every system fails. The question is not "will it break?" but "how fast do we detect, respond, and recover?" World-class teams have documented procedures before the first outage, not after.

## 1. SEVERITY CLASSIFICATION

| Severity | Definition | Response Time | Examples |
|----------|-----------|--------------|---------|
| **SEV1** - Critical | Service completely down, data loss, security breach | < 15 minutes | Database unreachable, entire site down, data breach |
| **SEV2** - Major | Major feature broken, significant user impact | < 1 hour | Payment processing failed, auth broken, data corruption |
| **SEV3** - Minor | Feature degraded, workaround available | < 4 hours | Slow queries, minor UI bugs, email delays |
| **SEV4** - Low | Cosmetic, no user impact | Next business day | Typo, minor styling, log noise |

## 2. INCIDENT RESPONSE WORKFLOW

```
DETECT -> TRIAGE -> RESPOND -> RESOLVE -> REVIEW
```

### Step 1: DETECT
- Automated monitoring catches the issue (alert fires)
- OR user reports the issue
- Log the incident immediately with timestamp and initial assessment

### Step 2: TRIAGE
- Classify severity (SEV1-4)
- Identify affected systems and users
- Assign an Incident Commander (IC) for SEV1-2
- Open a communication channel (dedicated chat, war room)

### Step 3: RESPOND
- IC coordinates response, delegates tasks
- Communicate to stakeholders ("We are aware and investigating")
- Update status page if user-facing
- Work the problem systematically (check logs, metrics, recent deploys)

### Step 4: RESOLVE
- Implement fix (or rollback)
- Verify service is restored
- Monitor for recurrence (30+ minutes)
- Update status page: "Resolved"
- Notify stakeholders

### Step 5: REVIEW (Blameless Postmortem)
- Conduct within 48 hours of resolution
- Document: what happened, timeline, root cause, contributing factors
- Identify action items to prevent recurrence
- Track action items to completion
- Share learnings with the team

## 3. BLAMELESS POSTMORTEM TEMPLATE

```markdown
# Incident Postmortem: [Title]

## Summary
[1-2 sentence description of what happened]

## Impact
- Duration: [start time] to [end time] ([X] minutes/hours)
- Users affected: [number or percentage]
- Revenue impact: [if applicable]
- Data loss: [yes/no, details]

## Timeline
| Time (UTC) | Event |
|-----------|-------|
| HH:MM | Alert fired / Issue reported |
| HH:MM | Incident commander assigned |
| HH:MM | Root cause identified |
| HH:MM | Fix deployed |
| HH:MM | Service restored |

## Root Cause
[What actually caused the incident. Technical details.]

## Contributing Factors
[What conditions allowed this to happen. Missing tests? No monitoring? Bad deploy?]

## What Went Well
- [Things the team did right during response]

## What Could Be Improved
- [Things that slowed detection or resolution]

## Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| [Specific preventive action] | [Name] | [Date] | Open |

## Lessons Learned
[Key takeaways for the team]
```

## 4. RUNBOOK TEMPLATE

For every critical service, maintain a runbook:

```markdown
# Runbook: [Service Name]

## Service Overview
- Purpose: [what this service does]
- Dependencies: [database, cache, APIs it calls]
- Dependents: [who calls this service]

## Health Check
- Endpoint: GET /health
- Dashboard: [link]
- Key metrics: [response time, error rate, throughput]

## Common Issues & Fixes

### Issue: High error rate
1. Check application logs for error patterns
2. Check database connection pool
3. Check dependent service health
4. If caused by recent deploy: rollback

### Issue: High latency
1. Check database slow query log
2. Check cache hit rate
3. Check CPU/memory usage
4. Identify hot paths in traces

## Escalation
- Level 1: On-call engineer
- Level 2: Team lead
- Level 3: Engineering manager
```

## 5. STATUS PAGE

For user-facing incidents:
- Acknowledge within 15 minutes
- Update every 30 minutes during active incident
- Post resolution summary
- Components to track: Website, API, Database, Email, Payments, Auth

## 6. COMMUNICATION TEMPLATES

### Internal (to team):
"[SEV level] incident in progress. [Service] is [down/degraded]. IC: [name]. Working channel: [link]. Updates every 30 minutes."

### External (to users):
"We are currently experiencing issues with [feature]. Our team is actively working on a fix. We will provide updates as we have them. We apologize for the inconvenience."

### Resolution (to users):
"The issue with [feature] has been resolved. Service has been fully restored as of [time]. We have identified the root cause and are implementing measures to prevent recurrence."

## IMPLEMENTATION REQUIREMENT
Every project with users needs an incident response plan BEFORE the first incident. Runbooks for critical services. Postmortems for every SEV1-2. No finger-pointing. Fix the system, not the blame.

## RELATED SKILLS

- `error-alert-system`: how failures get captured and alerted in the first place, and how to triage an alert.
- `standard-ship-with-confidence`: check the logs first, post-deploy smoke test.
- `standard-backup-disaster-recovery`: recovery procedures when data is affected.
- `standard-logging-monitoring`: the monitoring that detects incidents.
