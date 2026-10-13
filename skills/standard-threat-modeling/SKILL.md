---
name: standard-threat-modeling
description: "Standard 28 of the engineering standards library: threat modeling and security design. Covers the STRIDE model with mitigations, the threat modeling process, attack surface analysis, OWASP Top 10 alignment, the security testing strategy (SAST, DAST, SCA, penetration tests and when each runs), a vulnerability disclosure policy with a security.txt template, security incident response, and security architecture patterns (defense in depth, zero trust, least privilege). Read it BEFORE designing a new system, a major feature, a new integration, or anything that adds an entry point or trust boundary, and before a security review, and when the user says \"threat model\", \"STRIDE\", \"attack surface\", \"OWASP Top 10\", \"security review\", \"pen test\", \"SAST\", \"DAST\", \"security.txt\", \"zero trust\", \"defense in depth\", or \"how could this be attacked\"."
---

# Threat Modeling: think like an attacker

## PHILOSOPHY
You cannot defend what you do not understand. Before writing a single line of security code, map your system, identify what attackers want, and design defenses around real threats, not hypothetical ones.

## 1. STRIDE THREAT MODEL

Analyze every component of your system through six threat categories:

| Threat | Description | Example | Mitigation |
|--------|------------|---------|-----------|
| **S**poofing | Pretending to be someone else | Stolen credentials, session hijacking | Strong authentication, MFA, token validation |
| **T**ampering | Modifying data or code | SQL injection, man-in-the-middle, file manipulation | Input validation, integrity checks, HTTPS, code signing |
| **R**epudiation | Denying an action was taken | User denies making a purchase | Audit logging, digital signatures, timestamps |
| **I**nformation Disclosure | Exposing data to unauthorized parties | Data breach, verbose error messages, directory listing | Encryption, access controls, minimal error info |
| **D**enial of Service | Making a service unavailable | DDoS, resource exhaustion, algorithmic complexity attack | Rate limiting, CDN, auto-scaling, input limits |
| **E**levation of Privilege | Gaining unauthorized access level | Broken access control, privilege escalation, IDOR | Least privilege, RBAC, input validation, secure defaults |

## 2. THREAT MODELING PROCESS

### Step 1: Define the System
- Draw a data flow diagram (DFD)
- Identify: entry points, data stores, processes, external entities
- Map trust boundaries (where privilege levels change)

### Step 2: Identify Threats
For each component and data flow, ask:
- Who would want to attack this?
- What do they gain?
- How could they do it?
- Apply STRIDE to each component

### Step 3: Rate Threats (DREAD)

| Factor | Description | Score |
|--------|------------|-------|
| **D**amage | How bad is the impact? | 1-10 |
| **R**eproducibility | How easy to reproduce? | 1-10 |
| **E**xploitability | How easy to exploit? | 1-10 |
| **A**ffected Users | How many users impacted? | 1-10 |
| **D**iscoverability | How easy to find? | 1-10 |

**Risk Score** = Average of all factors. Prioritize: 8-10 Critical, 5-7 High, 3-4 Medium, 1-2 Low.

### Step 4: Mitigate
- Design defenses for high and critical threats
- Accept risk for low threats (document the decision)
- Transfer risk where appropriate (insurance, third-party services)
- Eliminate risk by removing the feature if cost exceeds value

### Step 5: Validate
- Verify mitigations work (penetration testing)
- Re-assess when architecture changes
- Review threat model quarterly

## 3. ATTACK SURFACE ANALYSIS

### Minimize Attack Surface:
- **Disable what you do not use**: Unused endpoints, debug modes, admin panels, default accounts
- **Reduce entry points**: Fewer APIs, fewer ports, fewer protocols
- **Limit data exposure**: Return only what the client needs
- **Restrict access**: Default deny, whitelist over blacklist
- **Reduce privilege**: Services run with minimum required permissions

### Common Attack Surfaces:

| Surface | Threats | Controls |
|---------|---------|----------|
| Web forms | XSS, injection, CSRF | Input validation, output encoding, CSRF tokens |
| APIs | Broken auth, injection, data exposure | Authentication, authorization, rate limiting, input validation |
| File uploads | Malware, path traversal, DoS | File type validation, size limits, sandboxed storage |
| Authentication | Credential stuffing, brute force, session hijacking | MFA, rate limiting, secure session management |
| Database | SQL injection, data breach | Parameterized queries, encryption at rest, access controls |
| Third-party integrations | Supply chain attacks, data leaks | API key rotation, least privilege, webhook validation |
| Admin interfaces | Privilege escalation, unauthorized access | IP restriction, MFA, separate authentication, audit logging |
| Email | Phishing, header injection | SPF/DKIM/DMARC, input sanitization |

## 4. OWASP TOP 10 (2021+) ALIGNMENT

| # | Risk | Key Defenses |
|---|------|-------------|
| A01 | Broken Access Control | RBAC, deny by default, server-side enforcement, CORS |
| A02 | Cryptographic Failures | TLS everywhere, strong algorithms, proper key management |
| A03 | Injection | Parameterized queries, input validation, output encoding |
| A04 | Insecure Design | Threat modeling, secure design patterns, abuse case testing |
| A05 | Security Misconfiguration | Hardened defaults, no unnecessary features, automated config |
| A06 | Vulnerable Components | Dependency scanning, SBOM, automated updates |
| A07 | Authentication Failures | MFA, password policies, rate limiting, secure session management |
| A08 | Software and Data Integrity | Code signing, CI/CD integrity, dependency verification |
| A09 | Logging and Monitoring Failures | Centralized logging, alerting, audit trails |
| A10 | Server-Side Request Forgery (SSRF) | URL validation, allowlists, network segmentation |

## 5. SECURITY TESTING STRATEGY

### Testing Layers:

| Layer | Method | Frequency | Tools |
|-------|--------|-----------|-------|
| **Static Analysis (SAST)** | Scan source code for vulnerabilities | Every commit | SonarQube, Semgrep, CodeQL, Snyk Code |
| **Dynamic Analysis (DAST)** | Test running application | Weekly / pre-release | OWASP ZAP, Burp Suite, Nuclei |
| **Software Composition (SCA)** | Scan dependencies | Every build | Snyk, npm audit, pip audit, Dependabot |
| **Container Scanning** | Scan container images | Every build | Trivy, Grype, Docker Scout |
| **Infrastructure Scanning** | Scan IaC and cloud config | Every deployment | Checkov, tfsec, ScoutSuite |
| **Penetration Testing** | Manual expert testing | Quarterly / annually | Professional pentesters |
| **Bug Bounty** | Crowdsourced vulnerability discovery | Ongoing | HackerOne, Bugcrowd |

### Rules:
- SAST and SCA run in CI pipeline on every push
- Critical findings block the build
- Penetration test before major releases
- Remediate critical vulnerabilities within 24 hours
- Track all findings to resolution

## 6. VULNERABILITY DISCLOSURE POLICY

Every public-facing application should have:

### security.txt (RFC 9116)
Place at `/.well-known/security.txt`:
```
Contact: mailto:security@<your-domain>
Expires: 2027-01-01T00:00:00.000Z
Preferred-Languages: en
Policy: https://<your-domain>/security-policy
```

### Disclosure Policy Should Include:
- How to report (email, form, platform)
- What is in scope
- Expected response timeline (acknowledge within 48 hours)
- Safe harbor statement (no legal action for good-faith research)
- Whether you offer rewards/bounties
- Disclosure timeline (90 days is standard)

## 7. SECURITY INCIDENT RESPONSE

### Response Phases:
1. **Preparation**: Runbooks, contact lists, tools ready
2. **Identification**: Detect and confirm the incident
3. **Containment**: Stop the bleeding (isolate affected systems)
4. **Eradication**: Remove the threat (patch, revoke, clean)
5. **Recovery**: Restore normal operations
6. **Lessons Learned**: Postmortem, improve defenses

### Immediate Actions on Security Breach:
- Revoke compromised credentials
- Isolate affected systems
- Preserve evidence (do not wipe logs)
- Notify relevant parties (legal, management, affected users if required)
- Assess scope and impact
- Begin remediation

## 8. SECURITY ARCHITECTURE PATTERNS

### Defense in Depth:
Layer multiple security controls so no single failure compromises the system:
```
Internet -> WAF -> Load Balancer -> Reverse Proxy -> Application -> Database

WAF:            DDoS rules
Load Balancer:  TLS/SSL termination
Reverse Proxy:  Rate limiting, IP filtering
Application:    Auth/Authz, input validation
Database:       Encryption, access control
```

### Zero Trust:
- Never trust, always verify
- Every request is authenticated and authorized
- Least privilege access
- Micro-segmentation (network isolation between services)
- Continuous monitoring and validation

### Secure Defaults:
- Access denied by default
- Features disabled by default
- Encryption enabled by default
- Logging enabled by default
- Minimal permissions by default

## IMPLEMENTATION REQUIREMENT
Every project performs threat modeling before development begins. Every release includes security testing. Every vulnerability has a tracked remediation. Security is not a phase. It is a property of the system.

## RELATED SKILLS

- `standard-audit-ready-code`: the concrete pass/fail requirements for code.
- `standard-security-fortress`: detailed implementation of the controls.
- `security-rls-permissions`: multi-tenant database security.
- `review-build`: prove a security-sensitive change by attacking it.
