---
name: standard-logging-monitoring
description: Observability standard covering log levels per environment, structured JSON log format, what must and must never be logged, security event logging, log storage, rotation and retention, health and readiness endpoints, key metrics and alert thresholds, error tracking requirements, audit trails, SLIs, SLOs and error budgets with a budget policy, distributed tracing and an observability maturity model. Read before adding logging to a service, choosing a log format or level, adding a health check, defining metrics, dashboards, alert thresholds or SLOs, building an audit log, or propagating request or trace IDs, and when the user says "add logging", "structured logs", "health check", "monitoring", "set up alerts", "SLO", "error budget", "audit trail", "tracing", "request ID" or "we found out from a user". For wiring catch blocks into the error and alert inbox read error-alert-system.
---

# Standard 20 - Logging and Monitoring

If you cannot see it, you cannot fix it.

**Scope and related skills.** `error-alert-system` is the authority on capturing errors into one
inbox: how to wire a catch block, severity, dedupe and fingerprinting, absence alerts, triage and
when an alert may be made quieter. This standard does not repeat that. It covers the rest of
observability: log levels and format, what to log, log management, health checks, metrics, audit
trails, SLOs and error budgets, and tracing. Section 6 below lists only the generic requirements
an error tracker must meet; for how to implement them, follow `error-alert-system`.
Also see `standard-security-fortress` (security events) and `standard-error-handling-ux` (what
the user sees).

## Philosophy
If you cannot see it, you cannot fix it. Every application needs structured logging and monitoring from day one, not bolted on after the first outage.

## 1. Log Levels

| Level | When to Use | Examples |
|-------|------------|---------|
| **DEBUG** | Detailed diagnostic info (dev only) | Variable values, function entry/exit, query params |
| **INFO** | Normal operations worth recording | User logged in, order created, email sent |
| **WARN** | Unexpected but handled situations | Retry attempt, deprecated API usage, slow query |
| **ERROR** | Failures that need attention | Database connection failed, API call failed, invalid data |
| **FATAL** | Application cannot continue | Out of memory, critical config missing, database unreachable |

### Rules:
- Development: LOG_LEVEL=debug (see everything)
- Staging: LOG_LEVEL=info
- Production: LOG_LEVEL=warn (or info if storage allows)

## 2. Structured Log Format

### Use JSON for machine-readable logs:
```json
{
    "timestamp": "2026-02-16T14:30:00.000Z",
    "level": "ERROR",
    "message": "Failed to process payment",
    "service": "payment-service",
    "request_id": "req-abc-123",
    "user_id": "usr-456",
    "error": {
        "type": "TimeoutError",
        "message": "Connection timed out after 10000ms"
    },
    "duration_ms": 10234,
    "environment": "production"
}
```

### Every Log Entry MUST Include:
- Timestamp (ISO 8601, UTC)
- Log level
- Message (human-readable description)
- Context (request ID, user ID, relevant entity IDs)

### NEVER Log:
- Passwords or password hashes
- API keys, tokens, or secrets
- Full credit card numbers (mask: ****1234)
- Personal health information
- Full session tokens
- Any data that could compromise user privacy if logs are exposed

## 3. What to Log

### ALWAYS Log:
- Authentication events (login, logout, failed login, password reset)
- Authorization failures (access denied, permission checks)
- Database errors and slow queries (> 1 second)
- External API calls (request, response status, duration)
- Business-critical events (order placed, payment processed, user created)
- Application startup and shutdown
- Configuration changes
- Scheduled job execution (start, end, success/failure)

### Security Events (Separate Log or Tagged):
- Failed login attempts (with IP address)
- CSRF token failures
- Rate limit hits
- Suspicious input patterns (SQL injection, XSS attempts)
- File upload rejections
- Privilege escalation attempts

## 4. Log Management

### Storage:
- Write to files with rotation (max 10MB per file, keep 30 days)
- Or stream to a centralized logging service
- Separate security logs from application logs
- Compress old logs

### Rotation:
- Rotate by size (10MB) or time (daily)
- Keep recent logs accessible, archive older ones
- Auto-delete after retention period (30-90 days depending on compliance)

### Centralized Logging (Production):
- Aggregate logs from all services into one searchable system
- Enable full-text search across logs
- Set up dashboards for common queries
- Retain based on compliance requirements

## 5. Monitoring & Alerting

### Health Checks:
```
GET /health    -> { "status": "ok", "timestamp": "...", "uptime": "..." }
GET /ready     -> { "status": "ready", "database": "connected", "cache": "connected" }
```
- Health endpoint: is the service running?
- Readiness endpoint: is the service ready to handle requests? (DB connected, cache warm, etc.)

### Key Metrics to Monitor:
- **Uptime**: target 99.9%+ availability
- **Response times**: p50, p95, p99 latency
- **Error rates**: percentage of 5xx responses
- **Database**: query times, connection pool usage, slow queries
- **Memory & CPU**: usage trends, spikes
- **Disk**: usage and growth rate
- **Queue depth**: if using message queues

### Alert Thresholds:
- Error rate > 1% for 5 minutes
- Response time p95 > 2 seconds for 5 minutes
- Disk usage > 85%
- Memory usage > 90%
- Database connection failures
- Health check failures (3 consecutive)
- Zero traffic (could indicate routing issue)

## 6. Error Tracking

### Requirements:
- Capture unhandled exceptions with full stack trace
- Group similar errors together
- Track error frequency and trend
- Include request context (URL, user, browser, etc.)
- Alert on new error types
- Mark errors as resolved, track regressions

### Implementation:
- Use try/catch at service boundaries
- Use global error handlers (uncaughtException, unhandledRejection)
- Report errors with context, not just the message
- Deduplicate: 1000 identical errors = 1 error with count of 1000

## 7. Audit Trail

For compliance-sensitive applications:
- Log WHO did WHAT to WHICH resource and WHEN
- Format: `{ actor, action, resource, resource_id, timestamp, ip_address }`
- Audit logs are append-only (never modified or deleted)
- Separate storage from application logs
- Retention based on compliance requirements (often 1-7 years)

## 8. SLOs, SLIs, and Error Budgets (Google SRE Model)

### Service Level Indicators (SLIs)
What you measure. The actual metrics that define service quality:

| SLI | How to Measure | Good Threshold |
|-----|---------------|---------------|
| **Availability** | Successful requests / Total requests | > 99.9% |
| **Latency** | p50, p95, p99 response times | p99 < 500ms |
| **Throughput** | Requests per second | Within capacity plan |
| **Error Rate** | Failed requests / Total requests | < 0.1% |
| **Correctness** | Correct responses / Total responses | 100% |
| **Freshness** | Time since last data update | < acceptable staleness |

### Service Level Objectives (SLOs)
The target you commit to. SLOs are internal promises about service quality:

```
Example SLOs:
- 99.9% of requests return successfully (availability)
- 99% of requests complete in < 200ms (latency)
- 99.99% of data writes are durable (durability)
- Zero data corruption incidents per quarter (correctness)
```

### SLO Rules:
- Set SLOs based on user expectations, not what is technically possible
- Measure SLOs over rolling 30-day windows
- Start conservative and tighten over time
- Document SLOs alongside the service
- Review SLOs quarterly

### Error Budgets
The amount of unreliability you can tolerate:

```
Error Budget = 1 - SLO

Example:
  SLO: 99.9% availability
  Error Budget: 0.1% = ~43 minutes of downtime per 30 days

  If you burn through your error budget:
  - Stop deploying new features
  - Focus entirely on reliability
  - No risky changes until budget recovers
```

### Error Budget Policy:
| Budget Remaining | Action |
|-----------------|--------|
| > 50% | Normal development velocity. Deploy freely. |
| 25-50% | Increased caution. Extra review for risky changes. |
| 10-25% | Slow down. Only critical features and bug fixes. |
| < 10% | Freeze. Reliability work only. No new features. |
| Exhausted (0%) | Full stop. All engineering effort on reliability until budget recovers. |

### Implementing SLOs:
1. Define SLIs for each service
2. Set SLOs based on user needs (not internal desire)
3. Calculate error budget
4. Build dashboards showing SLO compliance and remaining budget
5. Create alerts at budget burn rate thresholds
6. Hold regular SLO review meetings

## 9. Distributed Tracing

### For Microservices and Multi-Service Architectures:
- Assign a unique **trace ID** to each incoming request
- Pass trace ID through all downstream service calls
- Each service logs with the trace ID
- Reconstruct the full request path across services

### Trace Context:
```
Request -> API Gateway -> Auth Service -> User Service -> Database
  trace_id: abc-123 propagated through ALL services
  Each service creates a "span" with timing data
```

### Rules:
- Propagate trace headers (W3C Trace Context or B3 format)
- Log trace ID in every log entry
- Sample traces in production (100% logging is expensive at scale)
- Use tracing to identify bottlenecks and failure points

## 10. Observability Maturity Model

| Level | Capabilities | Tools |
|-------|-------------|-------|
| **Level 0** | No logging or monitoring | None |
| **Level 1** | Basic logging to files, manual checking | Log files, tail -f |
| **Level 2** | Centralized logging, basic alerting | ELK Stack, Grafana, basic alerts |
| **Level 3** | Structured logging, dashboards, SLOs defined | Structured JSON logs, SLO dashboards |
| **Level 4** | Distributed tracing, error budgets, automated response | Full observability stack, auto-scaling on metrics |
| **Level 5** | Predictive monitoring, chaos engineering, self-healing | ML-based anomaly detection, chaos testing |

Target Level 3 minimum for production services. Level 4+ for critical services.

## Implementation Requirement
Every application has structured logging from day one. Every production environment has monitoring and alerting. SLOs are defined for every user-facing service. Error budgets drive development velocity decisions. You should never learn about a problem from a user. You should know before they do.

## Additional Rules (identifiers only)

From a multi-tenant project's copy of the standards:

- **Logs and errors carry identifiers, never content.** Log the IDs (tenant, user, record, call,
  request) needed to find the thing. Never log secret values (credentials, API key plaintext,
  JWTs, passwords) and never log private content (message bodies, recordings, voicemail,
  transcripts, documents, health or financial details).
- **Scrub free text before it is stored.** Error messages from third parties and user input can
  contain personal data. Pass free-text error fields through a scrubbing function before they
  reach any log, error store or alert.
- **Mask on read.** Where a secret must be shown in an admin screen or a log viewer, show a
  masked form (last four characters), never the full value.
