---
name: standard-architecture-decisions
description: "Standard 29 of the engineering standards library: recording architecture decisions. Covers the ADR template, the ADR lifecycle and review process, the ADR index, system architecture documentation, diagramming (C4 levels, diagrams as code), technical debt tracking, API contract documentation, and documentation as code. Read it BEFORE making or changing any significant architectural choice (framework, database, hosting, auth approach, service boundary, major library), and when the user says \"ADR\", \"architecture decision\", \"why did we choose\", \"document this decision\", \"architecture diagram\", \"C4\", \"tech debt\", \"technical debt\", or \"should we use X or Y\"."
---

# Architecture Decision Records and system documentation

## PHILOSOPHY
Architecture decisions are the most expensive decisions in software. Document them when they are made, not when someone asks "why did we do it this way?" six months later. The best documentation is the documentation that exists.

## 1. ARCHITECTURE DECISION RECORD (ADR)

### What Is an ADR?
A short document that captures a single architectural decision: the context, the decision, and the consequences. ADRs create a decision log that explains WHY the system is the way it is.

### When to Write an ADR:
- Choosing a framework, language, or platform
- Selecting a database or data store
- Deciding on an authentication strategy
- Choosing between build vs buy
- Changing deployment strategy
- Adding a significant dependency
- Defining API contracts or data formats
- Any decision that would be costly to reverse

### ADR Template:

```markdown
# ADR-{NUMBER}: {TITLE}

## Status
[Proposed | Accepted | Deprecated | Superseded by ADR-XXX]

## Date
YYYY-MM-DD

## Context
What is the issue that we are seeing that is motivating this decision or change?
What forces are at play (technical, business, political)?
What constraints exist?

## Decision
What is the change that we are proposing and/or doing?
State the decision clearly and concisely.

## Consequences

### Positive
- What becomes easier or possible as a result of this change?

### Negative
- What becomes harder or impossible as a result of this change?

### Neutral
- What other changes might this decision require?

## Alternatives Considered
| Option | Pros | Cons | Why Rejected |
|--------|------|------|-------------|
| Option A | ... | ... | ... |
| Option B | ... | ... | ... |
```

### ADR Rules:
- Number ADRs sequentially (ADR-001, ADR-002, etc.)
- One decision per ADR
- Keep ADRs short (1-2 pages maximum)
- Never delete an ADR. Mark it deprecated or superseded.
- Store ADRs in the repository (`docs/adr/` or `docs/decisions/`)
- ADRs are immutable once accepted (create a new ADR to change a decision)
- Link related ADRs to each other

## 2. ADR LIFECYCLE

```
Proposed -> Accepted -> [Active]
                           |
                           v
                      Deprecated (no longer relevant)
                           OR
                      Superseded by ADR-XXX (replaced by new decision)
```

### Review Process:
- Author writes ADR with proposed status
- Team reviews (can be async via PR)
- Discuss alternatives and consequences
- Accept, modify, or reject
- Merge to repository

## 3. ADR INDEX

Maintain an index file at `docs/adr/README.md`:

```markdown
# Architecture Decision Records

| # | Title | Status | Date |
|---|-------|--------|------|
| ADR-001 | Use PostgreSQL as primary database | Accepted | 2025-01-15 |
| ADR-002 | JWT for API authentication | Accepted | 2025-01-20 |
| ADR-003 | Migrate from REST to GraphQL | Deprecated | 2025-02-01 |
| ADR-004 | Adopt event-driven architecture | Accepted | 2025-03-10 |
```

## 4. SYSTEM ARCHITECTURE DOCUMENTATION

### Document Structure:

```
docs/
  architecture/
    overview.md           # High-level system architecture
    components.md         # Component descriptions and responsibilities
    data-flow.md          # How data moves through the system
    infrastructure.md     # Deployment architecture
    security.md           # Security architecture
  adr/
    README.md             # ADR index
    001-database-choice.md
    002-auth-strategy.md
  api/
    README.md             # API overview
    endpoints.md          # Endpoint reference
  runbooks/
    deployment.md         # How to deploy
    rollback.md           # How to rollback
    incident-response.md  # How to respond to incidents
```

### Architecture Overview Document Should Include:
1. **System Context Diagram**: How the system fits into the larger ecosystem
2. **Container Diagram**: Major components and their interactions
3. **Component Diagram**: Internal structure of each container
4. **Key Design Decisions**: Link to relevant ADRs
5. **Non-Functional Requirements**: Performance, scalability, security targets
6. **Technology Stack**: Languages, frameworks, databases, infrastructure

## 5. DIAGRAMMING

### Use Code-Based Diagrams (Version Controllable):

#### Mermaid (built into GitHub, GitLab, many tools):

```mermaid
graph TB
    Client[Client Browser] --> LB[Load Balancer]
    LB --> API[API Server]
    API --> DB[(Database)]
    API --> Cache[(Cache)]
    API --> Queue[Message Queue]
    Queue --> Worker[Background Worker]
    Worker --> DB
```

#### C4 Model (Recommended for Architecture):
- **Level 1 - System Context**: Your system and its external dependencies
- **Level 2 - Container**: High-level technology choices (web app, API, database)
- **Level 3 - Component**: Internal structure of each container
- **Level 4 - Code**: Class/module level (only for critical components)

### Diagram Rules:
- Keep diagrams up to date (stale diagrams are worse than none)
- Use code-based diagrams that live in the repository (Mermaid, PlantUML, Structurizr)
- Label all arrows (what data flows, what protocol)
- Include a legend if using custom notation
- Date every diagram

## 6. TECHNICAL DEBT TRACKING

### What Counts as Technical Debt:
- Code that works but is poorly structured
- Missing tests for critical paths
- Outdated dependencies
- Known performance bottlenecks
- Security vulnerabilities that have workarounds
- Documentation gaps

### Tracking Technical Debt:

```markdown
# Technical Debt Register

| ID | Description | Impact | Effort | Priority | Created | Owner |
|----|------------|--------|--------|----------|---------|-------|
| TD-001 | Auth module lacks unit tests | High (security risk) | Medium (2-3 days) | P1 | 2025-01-15 | Team |
| TD-002 | N+1 query on dashboard | Medium (slow page) | Low (1 day) | P2 | 2025-02-01 | Team |
| TD-003 | Legacy API v1 still active | Low (maintenance cost) | High (migration) | P3 | 2025-03-01 | Team |
```

### Rules:
- Document tech debt when you discover it
- Prioritize by impact and effort
- Allocate 10-20% of sprint capacity to debt reduction
- Never let critical debt (security, data integrity) accumulate
- Review debt register monthly

## 7. API CONTRACT DOCUMENTATION

### Document Every API:
- Endpoint, method, path
- Request format (headers, body, query params)
- Response format (success and error cases)
- Authentication requirements
- Rate limits
- Example requests and responses

### Tools:
- **OpenAPI/Swagger**: REST API specification
- **GraphQL Schema**: Self-documenting by design
- **AsyncAPI**: Event-driven API specification
- **Protobuf/gRPC**: Service definition files

### Rules:
- API documentation is generated from code or spec files (not hand-written)
- Every endpoint has at least one example
- Breaking changes are documented and versioned
- API docs are accessible to all developers (internal or partner)

## 8. DOCUMENTATION AS CODE

### Principles:
- Documentation lives next to the code it describes
- Documentation is reviewed in the same PR as code changes
- Documentation is tested (links checked, examples validated)
- Documentation has owners (same as code owners)

### What to Document:
| What | Where | When |
|------|-------|------|
| Architecture decisions | `docs/adr/` | When decision is made |
| System architecture | `docs/architecture/` | When architecture changes |
| API contracts | OpenAPI spec / inline | When API changes |
| Runbooks | `docs/runbooks/` | Before going to production |
| Onboarding | `docs/onboarding.md` | When process changes |
| README | Repository root | When project setup changes |

### What NOT to Document:
- Implementation details that change frequently (the code is the documentation)
- Information that can be generated from code
- Opinions or preferences (put those in ADRs)
- Anything that will be stale within a week

## IMPLEMENTATION REQUIREMENT
Every project has a README. Every architectural decision is recorded. Every API is documented. Every production service has a runbook. Documentation is not a task you do at the end. It is a practice you do continuously.

## RELATED SKILLS

- `standard-project-continuity`: the `docs/DECISIONS.md` file read at session start.
- `standard-api-design`: the API conventions that contract docs describe.
- `standard-threat-modeling`: security considerations for a new design.
