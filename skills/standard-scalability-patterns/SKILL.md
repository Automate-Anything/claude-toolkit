---
name: standard-scalability-patterns
description: "Standard 30 of the engineering standards library: designing for scale and high availability. Covers horizontal versus vertical scaling and the scaling ladder, stateless design, load balancing algorithms and health checks, caching layers and strategies with invalidation, database scaling (read replicas, pooling, partitioning, sharding), asynchronous processing with queues and workers, rate limiting and throttling, high availability patterns (circuit breaker, retry with backoff, bulkhead, graceful degradation), auto-scaling, and multi-region architecture. Read it BEFORE designing anything expected to carry high traffic or large data, before adding a cache, queue, replica or load balancer, and when the user says \"scale\", \"scalability\", \"high traffic\", \"load balancer\", \"caching\", \"Redis\", \"queue\", \"background jobs\", \"read replica\", \"sharding\", \"circuit breaker\", \"rate limit\", \"auto-scaling\", \"multi-region\", or \"will this hold up under load\"."
---

# Scalability and High Availability Patterns

## PHILOSOPHY
Design for today, architect for tomorrow. Premature optimization is waste, but premature architecture is wisdom. Every system should have a clear scaling path even if it starts on a single server.

## 1. SCALABILITY FUNDAMENTALS

### Vertical vs Horizontal Scaling:

| Type | Method | Pros | Cons |
|------|--------|------|------|
| **Vertical** (Scale Up) | Bigger machine (more CPU, RAM) | Simple, no code changes | Hardware limits, single point of failure, expensive |
| **Horizontal** (Scale Out) | More machines | Near-infinite scaling, fault tolerant | Requires stateless design, more complex |

### The Scaling Path:
```
Single Server -> Read Replicas -> Caching Layer -> Load Balancer ->
Microservices -> Message Queues -> CDN -> Auto-scaling -> Multi-region
```

Rule: Do not jump ahead. Scale when you need to, not when you think you might need to. But DESIGN so that each step is possible.

## 2. STATELESS DESIGN

### The Golden Rule of Scalability:
**Every request can be handled by ANY server instance.**

### What This Means:
- No server-side session storage in memory
- No local file storage that other instances need
- No in-memory caches that are not shared
- No instance-specific configuration

### Session Storage Alternatives:

| Method | Best For | Tradeoff |
|--------|----------|----------|
| **JWT tokens** | API authentication, mobile apps | Stateless but cannot revoke easily |
| **Redis/Memcached** | Web sessions, shared state | Fast, but adds infrastructure |
| **Database sessions** | Simple apps, low traffic | Simple, but slower at scale |
| **Signed cookies** | Small session data | No server storage, but size limited |

### File Storage:
- Use object storage (S3, GCS, Azure Blob) instead of local filesystem
- Serve static files via CDN
- Generate uploads with signed URLs (client uploads directly to storage)

## 3. LOAD BALANCING

### Strategies:

| Algorithm | Description | Best For |
|-----------|------------|----------|
| **Round Robin** | Distribute evenly in sequence | Homogeneous servers, stateless apps |
| **Least Connections** | Send to server with fewest active connections | Variable request duration |
| **IP Hash** | Same client IP goes to same server | Soft session affinity (avoid if possible) |
| **Weighted** | Distribute based on server capacity | Mixed hardware |
| **Random** | Random server selection | Simple, surprisingly effective |

### Health Checks:
- Load balancer checks `/health` endpoint every 10-30 seconds
- Unhealthy instances removed from pool automatically
- Instances must pass health check before receiving traffic after deploy

### Rules:
- Use a load balancer even with a single server (makes scaling seamless later)
- Terminate TLS at the load balancer
- Enable connection draining for graceful shutdown
- Log at the load balancer level (request timing, error rates)

## 4. CACHING STRATEGY

### Cache Layers (Ordered by Speed):

| Layer | Speed | Scope | Examples |
|-------|-------|-------|---------|
| **Browser Cache** | Instant | Per user | Cache-Control headers, Service Worker |
| **CDN Cache** | ~10ms | Global | Static assets, API responses |
| **Application Cache** | ~1ms | Per instance or shared | Redis, Memcached |
| **Database Cache** | ~5ms | Per database | Query cache, materialized views |

### Caching Patterns:

#### Cache-Aside (Lazy Loading):
```
1. Check cache
2. If HIT -> return cached value
3. If MISS -> query database -> store in cache -> return
```
Best for: Read-heavy workloads, data that does not change frequently.

#### Write-Through:
```
1. Write to cache AND database simultaneously
2. Reads always from cache
```
Best for: Data that is read immediately after writing.

#### Write-Behind (Write-Back):
```
1. Write to cache only
2. Asynchronously flush to database
```
Best for: High write throughput (accepts some data loss risk).

### Cache Invalidation Rules:
- Set TTL (Time To Live) on every cached item
- Invalidate on write (when source data changes)
- Use cache keys that include version or timestamp
- Monitor cache hit rate (target: 80%+ for frequently accessed data)
- Avoid caching highly personalized or rapidly changing data

## 5. DATABASE SCALING

### Read Scaling:

| Pattern | How | When |
|---------|-----|------|
| **Read Replicas** | Route reads to replica databases | Read-heavy workloads (80%+ reads) |
| **Caching** | Cache frequent queries in Redis/Memcached | Hot data, computed results |
| **Materialized Views** | Pre-computed query results | Complex aggregations, dashboards |
| **Search Index** | Offload search to dedicated engine | Full-text search, faceted search |

### Write Scaling:

| Pattern | How | When |
|---------|-----|------|
| **Vertical Scaling** | Bigger database server | First step, up to hardware limits |
| **Write-Behind Caching** | Buffer writes in cache, flush async | High write throughput |
| **Partitioning (Sharding)** | Split data across multiple databases | Massive datasets |
| **Event Sourcing** | Append-only event log, rebuild state | Complex domains, audit requirements |
| **CQRS** | Separate read and write models | Different read/write patterns |

### Database Connection Pooling:
- Use connection pools (PgBouncer, ProxySQL, HikariCP)
- Set pool size based on: `connections = (cores * 2) + effective_spindle_count`
- Monitor active connections and wait times
- Set connection timeouts (do not let queries run forever)

## 6. ASYNCHRONOUS PROCESSING

### When to Go Async:
- Email sending
- Image/video processing
- Report generation
- Third-party API calls
- Data export/import
- Notification delivery
- Analytics processing
- Any task taking > 500ms that does not need immediate response

### Message Queue Patterns:

| Pattern | Description | Use Case |
|---------|------------|----------|
| **Work Queue** | One message, one consumer | Task processing, job queue |
| **Pub/Sub** | One message, many consumers | Event broadcasting, notifications |
| **Request/Reply** | Async request with response | Service-to-service communication |
| **Dead Letter Queue** | Failed messages go to separate queue | Error handling, retry later |

### Queue Technologies:

| Tool | Best For |
|------|----------|
| **Redis (Bull/BullMQ)** | Simple job queues, lightweight |
| **RabbitMQ** | Complex routing, reliability |
| **Apache Kafka** | Event streaming, high throughput, replay |
| **AWS SQS** | Managed, serverless, simple |
| **NATS** | Lightweight, cloud-native |

### Rules:
- Every queue consumer must be idempotent (processing the same message twice is safe)
- Implement retry with exponential backoff
- Use dead letter queues for messages that repeatedly fail
- Monitor queue depth (growing queue = consumers cannot keep up)
- Set message TTL (do not process stale messages)

## 7. RATE LIMITING & THROTTLING

### Algorithms:

| Algorithm | Description | Best For |
|-----------|------------|----------|
| **Fixed Window** | X requests per time window | Simple, predictable |
| **Sliding Window** | Smoothed fixed window | More fair distribution |
| **Token Bucket** | Tokens replenish at fixed rate, burst allowed | APIs with burst tolerance |
| **Leaky Bucket** | Requests processed at fixed rate | Steady throughput |

### What to Rate Limit:
- API endpoints (per user, per IP, per API key)
- Login attempts (prevent brute force)
- Password reset requests
- File uploads
- Expensive operations (search, export, report generation)
- Webhook deliveries

### Implementation:
- Return `429 Too Many Requests` when limit exceeded
- Include `Retry-After` header
- Use distributed rate limiting (Redis-based) for multi-instance deployments
- Different limits for different tiers (free vs paid)
- Log rate limit hits for abuse detection

## 8. HIGH AVAILABILITY PATTERNS

### Circuit Breaker:
Prevents cascading failures when a dependency is down:
```
CLOSED (normal) -> failures exceed threshold -> OPEN (reject all calls)
       ^                                              |
       |                                              v
       +--- success <- HALF-OPEN (allow test call) <- timeout expires
```

Rules:
- Monitor failure rate per dependency
- Open circuit at 50%+ failure rate (configurable)
- Test with single request after timeout period
- Return fallback response when circuit is open

### Bulkhead:
Isolate components so one failure does not sink the ship:
- Separate thread pools per dependency
- Separate connection pools per service
- Independent resource limits for different features
- A slow payment API should not slow down the product catalog

### Graceful Degradation:
When under extreme load, shed non-critical functionality:

| Load Level | Strategy |
|-----------|----------|
| Normal | Full functionality |
| High | Disable non-essential features (recommendations, analytics) |
| Critical | Serve cached/static content, disable writes |
| Emergency | Maintenance page with status updates |

### Retry with Backoff:
```
Attempt 1: immediate
Attempt 2: wait 1 second
Attempt 3: wait 2 seconds
Attempt 4: wait 4 seconds
Attempt 5: wait 8 seconds (then give up)
```
Add jitter (random delay) to prevent thundering herd.

### Timeouts:
- EVERY external call must have a timeout
- Connect timeout: 1-5 seconds
- Read timeout: 5-30 seconds (depends on operation)
- Overall request timeout: 30-60 seconds
- No timeout = potential thread/connection leak

## 9. AUTO-SCALING

### Scaling Triggers:

| Metric | Scale Up When | Scale Down When |
|--------|-------------|----------------|
| CPU | > 70% for 3 minutes | < 30% for 10 minutes |
| Memory | > 80% for 3 minutes | < 40% for 10 minutes |
| Request count | > threshold per instance | < threshold per instance |
| Queue depth | > threshold messages | < threshold messages |
| Response time | > SLA target | Consistently below target |

### Rules:
- Scale up fast, scale down slow (prevent flapping)
- Set minimum instances (never scale to zero for production)
- Set maximum instances (prevent runaway costs)
- Test auto-scaling before you need it
- Monitor scaling events and costs

## 10. MULTI-REGION ARCHITECTURE

### When You Need It:
- Users in multiple geographic regions
- Regulatory requirements (data residency)
- Disaster recovery requirements (< 1 hour RTO)
- Ultra-high availability requirements (99.99%+)

### Patterns:
- **Active-Passive**: One region handles traffic, other on standby
- **Active-Active**: Both regions handle traffic simultaneously
- **Follow-the-Sun**: Traffic routed to region based on time of day

### Data Replication:
- **Synchronous**: Strong consistency, higher latency
- **Asynchronous**: Eventual consistency, lower latency
- Choose based on data criticality (financial = sync, analytics = async)

## IMPLEMENTATION REQUIREMENT
Design for statelessness from day one. Cache aggressively. Use async processing for anything that can wait. Set timeouts on every external call. Every service has a scaling path documented. You do not need to build for millions of users today, but you must be able to get there without a rewrite.

## RELATED SKILLS

- `query-efficiency`: making individual queries fast (N+1, indexes, RLS cost). Read it alongside this.
- `page-performance`: the frontend rendering side of performance.
- `standard-infrastructure-as-code`: the containers and orchestration that scale.
- `standard-logging-monitoring`: the metrics that tell you when to scale.
