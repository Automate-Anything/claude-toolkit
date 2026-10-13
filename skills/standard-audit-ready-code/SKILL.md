---
name: standard-audit-ready-code
description: "Standard 38 of the engineering standards library: the pass/fail security requirements audits check (OWASP ASVS Level 2, MASVS, Top 10, Google CASA and OAuth verification, Meta Data Protection Assessment). Covers passwords, brute force limits, token generation, MFA, sessions and JWT, access control and IDOR, CSRF, input validation and injection, cryptography and TLS, security headers, CORS and rate limits, error responses and audit logging, data deletion, OAuth token storage, mobile storage, file uploads, dependency security, vulnerability testing, and the pre-deployment checklist. For database RLS see `security-rls-permissions`; for Apple review see `apple-app-store-submission`. Read it BEFORE writing code that handles auth, sessions, passwords, tokens, user input, file uploads, payments or PII, before a security audit or OAuth verification, and when the user says \"CASA\", \"OWASP\", \"security audit\", \"Google OAuth verification\", \"security headers\", \"IDOR\", \"CSRF\", \"JWT\", or \"will this pass an audit\"."
---

# Audit-Ready Code: pass CASA, Google, Meta and OWASP audits the first time

**Scope and what lives elsewhere.** In the source library this standard was always-active: it
applies to every line of code. This skill is the application-layer audit standard. It does not
repeat what these existing skills own:

- `security-rls-permissions`: multi-tenant database security (Row Level Security, role and page
  permissions, SECURITY DEFINER function ACLs, storage policies). The access control section below
  states the audit requirement; that skill is how to meet it at the database layer.
- `apple-app-store-submission`: everything Apple review checks (Sign in with Apple, account
  deletion, privacy manifest, privacy labels, App Tracking Transparency). Only the transport
  security requirement is kept here.
- `review-build`: the post-build gate that makes you PROVE a security change by attacking it.
- `error-alert-system`: how failures are captured and alerted. The logging section below covers
  what an auditor requires to be logged, not how alerts are routed.

If this standard and another security skill disagree, the stricter rule wins. If still unsure,
surface the conflict to the owner.

## PURPOSE
Every line of code in this project MUST be written to pass third-party security audits without remediation. This file codifies the exact requirements from: Google CASA (Cloud Application Security Assessment), Google OAuth Verification, Meta/Facebook Data Protection Assessment, Apple App Store Review, OWASP ASVS v4.0 Level 2, OWASP MASVS v2, and OWASP Top 10 (2021). These are not aspirational goals. They are pass/fail gates that block API access, app store approval, and platform partnerships.

## APPLIES TO: ALL code, ALL endpoints, ALL platforms, ALL environments.

---

## 1. AUTHENTICATION (OWASP ASVS V2 / CASA / Meta DPA)

### Password Policy (ASVS 2.1.1-2.1.12)
- Minimum **12 characters** (CASA requirement, non-negotiable)
- Allow up to **128 characters** - deny over 128
- Allow ALL Unicode characters including spaces and emoji
- **NO composition rules** (no "must include uppercase/number/symbol")
- **NO periodic rotation requirements**
- Allow paste into password fields (password managers)
- Provide password strength meter
- Check passwords against **breached password databases** (HaveIBeenPwned API or equivalent)
- Allow temporary password visibility toggle

### Credential Storage (ASVS 2.4.1-2.4.5)
```
PASSES: bcrypt with work factor >= 12, or Argon2id, or PBKDF2 with >= 100,000 iterations
FAILS:  MD5, SHA1, SHA256, SHA512 (without KDF), plaintext, reversible encryption
```
- Unique salt per credential, minimum 32 bits
- Server-side pepper (additional secret salt from environment variable)

### Brute Force Protection (ASVS 2.2.1)
- Maximum **100 failed attempts per hour** per account (CASA requirement)
- Implement exponential backoff or progressive delays
- Return HTTP **429** with `Retry-After` header when limit exceeded
- Log all failed authentication attempts with IP, timestamp, account

### Token & Secret Generation
```
PASSES: crypto.randomBytes(32) / crypto.getRandomValues() / secrets.token_hex(32)
FAILS:  Math.random(), uuid v1, sequential tokens, short tokens, predictable patterns
```
- All tokens minimum **256 bits** of entropy from CSPRNG
- `Math.random()` usage for ANY security purpose will **fail automated CASA scanners** (CWE-338)

### Multi-Factor Authentication (ASVS 2.2 / Meta DPA 3.1-15)
- MFA **required** on all admin interfaces (ASVS 4.3.1)
- MFA required for remote access to: code repos, deployment tools, cloud admin, SSH, email (Meta DPA)
- Offer TOTP/push notifications as primary, SMS/email as secondary only (ASVS 2.2.1)

### Service Authentication (ASVS 2.10)
- **ZERO hardcoded credentials** in source code (CWE-798 - auto-detected by scanners)
- All API keys, secrets, passwords in key vault or environment variables
- No default/shared accounts (no "admin/admin", "root/root", "sa/sa")
- Inter-service auth uses short-lived tokens, not static API keys

---

## 2. SESSION MANAGEMENT (OWASP ASVS V3 / CASA)

### Cookie Configuration (ASVS 3.4.1-3.4.5)
```javascript
// PASSES AUDIT
cookie: {
    secure: true,           // HTTPS only (ASVS 3.4.1)
    httpOnly: true,          // No JavaScript access (ASVS 3.4.2)
    sameSite: 'strict',      // CSRF protection (ASVS 3.4.3)
    path: '/',               // Most specific path (ASVS 3.4.5)
    maxAge: 1800000          // 30 min for sensitive apps
}
// Use __Host- prefix on session cookies (ASVS 3.4.4)
name: '__Host-SID'

// FAILS AUDIT
cookie: { }                  // Missing all security flags
name: 'sessionId'            // No __Host- prefix
```

### Session Lifecycle (ASVS 3.1-3.3)
- **Never** expose session tokens in URLs (ASVS 3.1.1)
- Generate **new session token** on every authentication (ASVS 3.2.1)
- Session tokens minimum **64 bits entropy** from CSPRNG (ASVS 3.2.2)
- **Invalidate session** on logout - back button must NOT resume session (ASVS 3.3.1)
- Invalidate all sessions on password change with option to view/terminate active sessions (ASVS 3.3.3)
- Idle timeout: **30 minutes** for standard apps, **15 minutes** for sensitive (ASVS 3.3.2)
- Absolute timeout: **12 hours** maximum (ASVS 3.3.2)

### Stateless Tokens / JWT (ASVS 3.5)
```javascript
// PASSES AUDIT
jwt.sign(payload, process.env.JWT_SECRET, {
    algorithm: 'HS256',      // Explicit algorithm
    expiresIn: '15m'         // Short-lived
});
jwt.verify(token, secret, { algorithms: ['HS256'] }); // Explicit algorithm list

// FAILS AUDIT
jwt.sign(payload, 'secret');              // Hardcoded, weak secret
jwt.sign(payload, secret);                // No algorithm specified
jwt.verify(token, secret);                // Accepts 'none' algorithm
jwt.sign(payload, secret, { expiresIn: '30d' }); // Excessively long TTL
```
- JWT secrets minimum **256 bits** from CSPRNG, stored in secrets manager
- Access tokens: **15 minutes** maximum TTL
- Refresh tokens: implement **rotation** (new refresh token on each use)
- Revocation mechanism for both token types

---

## 3. ACCESS CONTROL (OWASP ASVS V4 / CASA)

### Server-Side Enforcement (ASVS 4.1.1)
- **ALL access control enforced server-side** - never trust client-side checks
- Default **deny** - explicitly grant access, never explicitly deny
- Access controls **fail securely** on exceptions (deny on error)

### IDOR Prevention (ASVS 4.2.1 - CWE-639)
```javascript
// PASSES AUDIT - verify ownership on every request
const resource = await db.findOne({ id: req.params.id, userId: req.user.id });
if (!resource) return res.status(404).json({ error: 'Not found' });

// FAILS AUDIT - trusts client-provided ID without ownership check
const resource = await db.findById(req.params.id);
```
- Verify resource ownership on **every CRUD operation**
- In a multi-tenant database, enforce the same ownership rule with Row Level Security as well (see `security-rls-permissions`)
- Use UUIDs instead of sequential integer IDs for external references
- Test every endpoint by changing IDs to another user's resources

### CSRF Protection (ASVS 4.2.2 - CWE-352)
- Anti-CSRF tokens on **all state-changing requests**
- For SPAs with cookie-based auth: `SameSite=Strict` + custom request header
- For server-rendered forms: synchronizer token pattern

### Directory & File Exposure (ASVS 4.3.2)
- Directory listing **disabled**
- Block access to: `.git/`, `.svn/`, `.env`, `.DS_Store`, `node_modules/`, `composer.json`
- No source maps in production
- No `.map` files accessible

---

## 4. INPUT VALIDATION & OUTPUT ENCODING (OWASP ASVS V5 / CASA)

### Input Validation (ASVS 5.1)
- **Positive validation** (allow lists) for all input - define what IS allowed (ASVS 5.1.3)
- Validate data type, length, range, and format server-side
- HTTP parameter pollution defense (ASVS 5.1.1)
- Mass assignment protection - whitelist allowed fields (ASVS 5.1.2 / CWE-915)
- URL redirect/forward **allow lists only** - never redirect to user-supplied URLs (ASVS 5.1.5 / CWE-601)

### Injection Prevention (ASVS 5.3 / CWE-89, CWE-79, CWE-78)
```javascript
// SQL - PASSES
db.query('SELECT * FROM users WHERE id = ?', [userId]);
// SQL - FAILS
db.query(`SELECT * FROM users WHERE id = ${userId}`);

// XSS - PASSES
res.send(escapeHtml(userInput));
// In templates: use auto-escaping engines (React JSX, EJS <%=, Jinja2 {{ }})
// XSS - FAILS
res.send(userInput);
element.innerHTML = userInput;
// Never use: dangerouslySetInnerHTML, <%- %>, {{ | safe }}, {!! !!} with user data

// OS Command - PASSES
execFile('grep', ['-r', searchTerm, '/data'], callback);
// OS Command - FAILS
exec(`grep -r "${searchTerm}" /data`);
```

### Additional Injection Types (ASVS 5.2-5.5)
- **No `eval()`** with any user-influenced input (ASVS 5.2.4 / CWE-95)
- Template injection prevention (ASVS 5.2.5)
- SSRF protection with allow lists for outbound requests (ASVS 5.2.6 / CWE-918)
- LDAP injection prevention (ASVS 5.3.7)
- XML parser: disable external entities (XXE prevention) (ASVS 5.5.2 / CWE-611)
- Deserialization: integrity checks, avoid untrusted data (ASVS 5.5.3 / CWE-502)
- Use `JSON.parse()` never `eval()` for JSON (ASVS 5.5.4)

### Payload Limits
```javascript
// PASSES
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// FAILS
app.use(express.json()); // Unlimited payload - DoS vector
```

---

## 5. CRYPTOGRAPHY (OWASP ASVS V6 / CASA / Meta DPA)

### Encryption at Rest (ASVS 6.1.1 / Meta DPA 3.1-9)
- **ALL PII encrypted at rest** - names, emails, phone numbers, addresses, payment data, health data
- Use **AES-256-GCM** (authenticated encryption with unique 12-byte IV per operation)
- Encryption keys stored in secrets manager, **never in code or config files**
- Meta DPA requires written policy + evidence of encryption configuration

### Encryption in Transit (ASVS V9 / Meta DPA 3.1-11 / Apple ATS)
- **TLS 1.2 minimum** everywhere, TLS 1.3 preferred
- **SSL v2, v3 are PROHIBITED entirely** (Meta DPA)
- TLS 1.0/1.1 only for documented legacy device compatibility
- HSTS header: `max-age=63072000; includeSubDomains; preload`
- Apple ATS: requires Perfect Forward Secrecy (ECDHE), RSA 2048+ or ECC 256+, SHA-256+ certificates

### Prohibited Algorithms
```
NEVER USE: MD5, SHA1 (for security), RC4, DES, 3DES, ECB mode, export ciphers
NEVER USE: Math.random() for any security purpose (CWE-338)
ALWAYS USE: AES-256-GCM, SHA-256+, ECDSA P-256+, RSA 2048+, CSPRNG
```

### Key Management (ASVS 6.4 / CASA)
- Use a key vault / secrets manager (ASVS 6.4.1)
- Keys must be **replaceable** without code changes (ASVS 1.6.3)
- Client-side secrets treated as inherently insecure (ASVS 1.6.4)
- Rotate encryption keys on schedule, revoke compromised keys immediately

---

## 6. HTTP SECURITY HEADERS (OWASP ASVS V14.4 / CASA)

**ALL of these headers are REQUIRED on EVERY response. Missing headers fail CASA scans.**

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-site
Content-Type: application/json; charset=utf-8
```

**Headers to REMOVE (information disclosure - ASVS 14.3.3):**
```
X-Powered-By: REMOVE COMPLETELY
Server: REMOVE OR ANONYMIZE
X-AspNet-Version: REMOVE
X-AspNetMvc-Version: REMOVE
```

**Implementation:**
```javascript
// Node.js/Express - use helmet
const helmet = require('helmet');
app.use(helmet());
app.disable('x-powered-by');
```

**CSP Rules:**
- No `unsafe-inline` in script-src (use nonces or hashes instead)
- No `unsafe-eval` in script-src
- Use Subresource Integrity (SRI) for all CDN-loaded assets (ASVS 14.2.3)
- `frame-ancestors 'none'` replaces X-Frame-Options

---

## 7. API SECURITY (OWASP ASVS V13 / OWASP API Top 10)

### Request Validation
- Validate incoming `Content-Type` header matches expected type (ASVS 13.2.1)
- JSON schema validation on all request bodies (ASVS 13.2.2)
- Reject unexpected HTTP methods per endpoint (ASVS 14.5.1)
- No sensitive data in URL query strings or path parameters (ASVS 13.1.1)

### CORS Configuration (ASVS 14.5.3)
```javascript
// PASSES AUDIT - specific origin whitelist
cors({
    origin: ['https://<your-domain>', 'https://app.<your-domain>'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
});

// FAILS AUDIT
cors({ origin: '*' });                    // Wildcard origin
cors({ origin: '*', credentials: true }); // Wildcard + credentials (browser blocks, but still fails)
cors({ origin: 'null' });                 // Null origin (ASVS 14.5.3)
```

### Rate Limiting (ASVS V11 / OWASP API4)
```javascript
// PASSES AUDIT
const rateLimit = require('express-rate-limit');

// Global limiter
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true }));

// Strict limiter for auth endpoints
app.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), loginHandler);
app.post('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }), registerHandler);
app.post('/forgot-password', rateLimit({ windowMs: 60 * 60 * 1000, max: 3 }), resetHandler);

// FAILS AUDIT - no rate limiting at all on auth endpoints
app.post('/login', loginHandler);
```
- Return **429 Too Many Requests** with `Retry-After` header
- Include rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Dual strategy: per-IP AND per-account

### GraphQL Specific (ASVS 13.4)
- Query depth limiting to prevent DoS (ASVS 13.4.1)
- Query cost/complexity analysis
- Authorization at business logic layer, not GraphQL layer (ASVS 13.4.2)
- Disable introspection in production

### Response Security
- Return **only necessary fields** - never expose entire database records
- Anti-caching headers for sensitive responses: `Cache-Control: no-store`
- No sensitive data in client-side storage (localStorage, sessionStorage, IndexedDB) (ASVS 8.2.2)

---

## 8. ERROR HANDLING & LOGGING (OWASP ASVS V7 / Meta DPA)

### Error Responses (ASVS 7.4)
```javascript
// PASSES AUDIT - generic message with tracking ID
res.status(500).json({
    error: 'An unexpected error occurred',
    referenceId: 'ERR-a1b2c3d4'    // For internal lookup
});

// FAILS AUDIT - leaks internals
res.status(500).json({
    error: err.message,             // Stack trace, file paths
    stack: err.stack,               // Full stack trace
    query: 'SELECT * FROM users...' // SQL query
});
```
- **Never expose**: stack traces, file paths, SQL queries, server config, dependency versions
- Debug mode **disabled** in production (ASVS 14.3.2)
- Custom error pages for 404, 403, 500 that follow the design system

### Audit Logging (ASVS 7.1-7.3 / Meta DPA 3.1-22)

**MUST log (with timestamp, user ID, IP, success/failure):**
- All authentication events (login, logout, failed login, password change)
- All authorization failures (access denied, permission escalation attempts)
- All input validation failures
- All access control decisions
- Admin privilege changes
- Security-relevant configuration changes

**NEVER log:**
- Passwords (even hashed)
- Session tokens (except as truncated hash)
- API keys / secrets
- Credit card numbers
- PII beyond what's needed for investigation
- Health information

**Meta DPA specifics:**
- Review logs minimum every **7 days** using automated SIEM (manual review unacceptable)
- Retain logs minimum **30 days**
- Protect logs from unauthorized access and tampering
- Log deletion/editing must itself be logged

### Log Format (structured JSON)
```json
{
    "timestamp": "2026-04-16T14:30:00.000Z",
    "level": "WARN",
    "event": "AUTH_FAILURE",
    "message": "Failed login attempt",
    "userId": "usr-456",
    "ip": "192.168.1.1",
    "requestId": "req-abc-123",
    "success": false
}
```

---

## 9. DATA PROTECTION (OWASP ASVS V8 / GDPR / Meta DPA / Apple)

### Data Minimization
- Collect **only** data needed for current features (Google OAuth policy, Apple 5.1.1(iii))
- No "future-proofing" data collection (Google rejects this explicitly)
- Return only necessary fields in API responses
- Purge data when no longer needed

### Data Deletion (Meta DPA 3.1-5,6 / Apple 5.1.1(v) / GDPR)
- Users **must** be able to request deletion of their data
- Deletion within **120 days maximum** (Meta DPA), "as soon as reasonably possible"
- Cascade deletion: when user is deleted, ALL their data is deleted
- Apps with account creation **must** offer in-app account deletion (Apple requirement)
- Implement data deletion callback endpoint for Facebook Login

### Sensitive Data in Client (ASVS 8.2)
- Anti-caching headers on sensitive responses (ASVS 8.2.1)
- **No sensitive data in localStorage, sessionStorage, IndexedDB, or cookies** (ASVS 8.2.2)
- Clear authenticated data on session termination (ASVS 8.2.3)
- Sensitive data only in HTTP request body, **never in query strings** (ASVS 8.3.1)

### OAuth Token Handling (Google / Meta)
```javascript
// PASSES AUDIT
// 1. Encrypt tokens before storage
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', keyFromSecretsManager, iv);
// 2. Store encrypted token + IV + auth tag in database
// 3. Decrypt only in-memory during API calls
// 4. Never log tokens
// 5. Revoke when no longer needed

// FAILS AUDIT
db.insert({ google_token: accessToken });           // Plaintext storage
console.log('Token:', accessToken);                  // Logged in cleartext
localStorage.setItem('google_token', accessToken);   // Client-side storage
```

### Mobile Data Storage (OWASP MASVS-STORAGE)
- iOS: **Keychain** for tokens and secrets (never UserDefaults or plist)
- Android: **Keystore** for cryptographic keys, **EncryptedSharedPreferences** for tokens
- No sensitive data in: application logs, backups, clipboard, screenshots, keyboard caches
- Use `expo-secure-store` for React Native (maps to Keychain/Keystore)

---

## 10. FILE UPLOAD SECURITY (OWASP ASVS V12 / CASA)

- Validate file type by **content/magic bytes**, not just extension (ASVS 12.2.1)
- Strict whitelist of allowed extensions and MIME types
- Maximum file size enforced (ASVS 12.1.1)
- Check compressed files against maximum uncompressed size (ASVS 12.1.2)
- Rename files on upload (UUID, never user-provided names)
- Store uploads **outside web root** with limited permissions (ASVS 12.4.1)
- Never execute uploaded files (ASVS 12.5.2)
- No direct use of user-submitted filenames (path traversal - ASVS 12.3.1 / CWE-22)
- Antivirus scanning for untrusted uploads (ASVS 12.4.2)
- Serve from separate domain or as `Content-Disposition: attachment` (ASVS 1.12.2)

---

## 11. DEPENDENCY & BUILD SECURITY (OWASP ASVS V14 / CASA / Meta DPA)

### Dependencies (ASVS 14.2 / Meta DPA 3.1-12)
- **All components up to date** - no known vulnerabilities (ASVS 14.2.1)
- Run `npm audit` / `pip audit` / `composer audit` on **every build** - critical/high = build failure
- Maintain **Software Bill of Materials** (SBOM) (ASVS 14.2.5)
- Remove unused features, components, sample apps, documentation (ASVS 14.2.2)
- Use **SRI hashes** for all CDN-loaded scripts/styles (ASVS 14.2.3)
- Pin dependency versions via lockfiles, tracked in the repo
- Meta DPA: maintain inventory of libraries, packages, containers, and OS versions
- Meta DPA: defined timeline for patching, prioritized by CVSS severity
- **No deprecated or end-of-life software** in production (Meta DPA)

### Build Configuration (ASVS 14.1, 14.3)
- **Debug mode disabled** in production (ASVS 14.3.2 - auto-detected by scanners)
- No version information in HTTP response headers (ASVS 14.3.3)
- Secure, repeatable build pipeline (ASVS 14.1.1)
- No deprecated client-side technologies: Flash, Silverlight, ActiveX, Java applets (ASVS 1.14.6)

### Pre-Commit Security
- Use pre-commit hooks (Husky) to block:
  - Hardcoded secrets (use gitleaks or trufflehog patterns)
  - `.env` files
  - Private keys
  - `Math.random()` in security contexts

---

## 12. VULNERABILITY TESTING (Meta DPA 3.1-12 / CASA)

### Required Testing (Annual Minimum)
- **Penetration test** OR **vulnerability scan** OR **static analysis** - at least annually (Meta DPA)
- Evidence must include: scope, methodology, date (within 12 months), summary of unremediated issues
- Cloud configuration testing required annually for backend environments (Meta DPA)

### Recommended Automated Scanning
- **DAST**: OWASP ZAP against staging environment (CASA-recommended)
- **SAST**: Semgrep, SonarQube, or equivalent against codebase
- **SCA**: npm audit, Snyk, or OWASP Dependency-Check for dependencies
- **Secrets**: gitleaks or trufflehog against repository history
- **Headers**: Test at securityheaders.com (target A+ grade)
- **TLS**: Test at ssllabs.com (target A+ grade)

### CASA-Specific Scanning
- CASA uses OWASP ZAP with pre-built configs (`zap-casa-config.conf` for web, `zap-casa-api-config.conf` for API)
- SAST: FluidAttacks Free CLI (note: incompatible with TypeScript/JavaScript - use Semgrep/Fortify instead)
- All 73 CASA requirements map to OWASP ASVS v4.0 with CWE classifications
- No CWE findings with HIGH probability of exploit = pass
- No CWE findings with MEDIUM probability of exploit = pass (revalidation)

---

## 13. PLATFORM-SPECIFIC REQUIREMENTS

### Google OAuth Verification
- Privacy policy: hosted on verified domain, publicly accessible, not behind login, not a PDF
- Homepage: on your own verified domain (not GitHub Pages, Notion, Webflow)
- Request **only scopes needed for current features** - Google rejects "future" scope requests
- Demo video must show: production environment, consent screen in English, browser URL bar with client_id, how each scope is used
- Same Google account must own both Cloud Console project and Search Console domain
- Annual CASA recertification for restricted scopes

### Meta/Facebook Data Protection Assessment
- Encryption at rest: written policy + evidence required
- Encryption in transit: TLS 1.2+, written policy + Qualys SSL scan evidence
- App secrets: **never exposed to client devices or compiled code**
- Use `appsecret_proof` parameter on all server-to-server Graph API calls
- Implement data deletion callback POST endpoint
- MFA on all remote access to dev tools (repos, CI/CD, cloud admin, SSH)
- Account access review at least every **12 months**
- Security awareness training for all staff annually

### Apple App Store Review
- **App Transport Security**: TLS 1.2+, PFS (ECDHE), RSA 2048+ or ECC 256+, SHA-256+ certs
- No fingerprinting or alternative identifiers without App Tracking Transparency permission
- Everything else Apple checks (privacy manifest, Sign in with Apple, App Tracking Transparency,
  in-app account deletion, privacy nutrition labels) is covered in the `apple-app-store-submission`
  skill. Read it before any iOS submission.

### Google Play
- Data Safety form: accurately declare all data collected, shared, and purposes
- Update Data Safety form when adding new SDKs or data collection
- Google Play Protect scans for: malware, spyware, billing fraud, privilege escalation, phishing

---

## 14. CONFIGURATION SECURITY CHECKLIST

**Before ANY deployment to production, verify ALL of these:**

### Authentication & Sessions
- [ ] Passwords: min 12 chars, breached DB check, bcrypt >= 12 rounds
- [ ] Session cookies: `__Host-` prefix, Secure, HttpOnly, SameSite=Strict
- [ ] New session token on login, invalidation on logout
- [ ] All sessions terminated on password change
- [ ] JWT: explicit algorithm, short TTL, secret from env/vault
- [ ] Rate limiting on login (5/15min), registration (10/hr), password reset (3/hr)
- [ ] MFA on admin interfaces

### Access Control
- [ ] All authorization server-side, default deny
- [ ] IDOR protection on every CRUD endpoint (ownership verified)
- [ ] CSRF protection on all state-changing requests
- [ ] Directory listing disabled, .git/.env blocked

### Input/Output
- [ ] All DB queries parameterized (zero string concatenation)
- [ ] All output context-encoded (HTML, JS, URL, CSS)
- [ ] No eval(), no exec() with user input
- [ ] File uploads: type whitelist, size limit, renamed, outside web root
- [ ] URL redirects: allow list only

### Cryptography & Transport
- [ ] TLS 1.2+ enforced, no fallback to insecure
- [ ] HSTS header with includeSubDomains
- [ ] PII encrypted at rest (AES-256-GCM)
- [ ] All secrets in vault/env vars, zero in code
- [ ] No Math.random() for security, only CSPRNG

### Headers & Configuration
- [ ] All 9 security headers present (see Section 6)
- [ ] X-Powered-By and Server headers removed
- [ ] Debug mode disabled
- [ ] No version info in headers
- [ ] SRI on all CDN assets
- [ ] CSP without unsafe-inline/unsafe-eval

### Logging & Monitoring
- [ ] Auth events logged with timestamp, user, IP, success/failure
- [ ] No passwords, tokens, PII in logs
- [ ] Generic error messages to users, detailed logs server-side
- [ ] Logs reviewed at minimum weekly (automated preferred)

### Dependencies & Build
- [ ] Zero known critical/high vulnerabilities in dependencies
- [ ] All dependencies up to date
- [ ] No deprecated software
- [ ] Lockfiles committed and enforced
- [ ] Pre-commit hooks blocking secrets

### Data Protection
- [ ] Data deletion endpoint functional
- [ ] Privacy policy accurate and publicly accessible
- [ ] Only collecting data needed for current features
- [ ] OAuth tokens encrypted at rest, never logged
- [ ] No sensitive data in URLs, localStorage, or client storage

---

## ENFORCEMENT

This is not a reference document. This is a build standard. Every requirement above maps to a specific audit check that will be performed by authorized assessors (TAC Security, Bishop Fox, Leviathan, DEKRA) or automated scanners (OWASP ZAP, Fortify, Semgrep). A single failure blocks:
- Google API access (restricted scopes)
- Meta platform access
- Apple App Store approval
- SOC 2 certification
- Enterprise customer procurement

**Write the code right the first time. Remediation after an audit finding costs 10x more than building it correctly.**

## RELATED SKILLS

- `security-rls-permissions`: database-layer tenant isolation.
- `apple-app-store-submission`: Apple review requirements.
- `standard-security-fortress`: detailed implementation patterns for these controls.
- `standard-threat-modeling`: STRIDE and the security testing strategy.
- `standard-data-privacy-compliance`: GDPR, CCPA, consent, data subject rights.
- `standard-supply-chain-security`: dependency scanning and SBOM.
- `review-build`: attack the change to prove it is secure.
