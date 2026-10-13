---
name: standard-security-fortress
description: Generic application security baseline for any stack (PHP, Node, Python, Java) covering input validation and sanitization, SQL injection, XSS, CSRF, session cookies, file uploads, password hashing and authentication, API tokens, encryption, rate limiting, security headers, safe error handling, database and dependency security, plus a pre-launch security testing checklist. Read before building or changing any form, endpoint, login or signup flow, password reset, session or cookie handling, file upload, API token, or anything that renders user-supplied content, and whenever the user says "is this secure", "harden this", "security review", "add rate limiting", "security headers", "CSRF", "XSS" or "SQL injection". For Postgres row level security and permission systems read security-rls-permissions instead.
---

# Standard 01 - Security Fortress

Generic, stack-agnostic security baseline. It applies to every page, endpoint and feature.

**How this relates to other skills (do not duplicate, read them for their part):**

- `security-rls-permissions`: the authority on Postgres row level security, role and location
  scoping, SECURITY DEFINER functions and storage bucket policies. This standard does not cover
  those.
- `standard-config-and-secrets`: where keys and credentials live.
- `standard-api-design`: CORS, auth headers and rate limit headers on APIs.
- `standard-logging-monitoring` and `error-alert-system`: what to log and how failures are
  surfaced.
- `review-build`: the post-build gate that requires you to attack your own security-sensitive
  change.

## Mandatory Security Implementation
These security measures MUST be applied to EVERY page, EVERY endpoint, and EVERY feature. No exceptions. Security is the foundation, not an afterthought.

## 1. Input Validation & Sanitization (Critical)
- Validate ALL user inputs on BOTH client and server side
- Trim whitespace, strip dangerous characters, escape output
- Validate data types, lengths, ranges, and formats before processing
- Never trust any data from the client (forms, URLs, headers, cookies)

**By Language:**
- **PHP**: `htmlspecialchars($input, ENT_QUOTES, 'UTF-8')`, `filter_var()`, `trim()`, `stripslashes()`
- **Node.js**: Use `validator.js`, `express-validator`, or `joi` for schema validation. Use `DOMPurify` for HTML sanitization.
- **Python**: Use `bleach` for HTML sanitization, Django's built-in validators, or Pydantic/marshmallow for schema validation.
- **Java**: Use `OWASP Java Encoder`, Bean Validation (`@Valid`), Spring's `@Validated`

## 2. SQL Injection Prevention (Critical)
- **NEVER** concatenate user input into SQL queries
- **ALWAYS** use parameterized queries / prepared statements
- **ALWAYS** validate data types before database operations
- Use an ORM when possible (Eloquent, Sequelize, SQLAlchemy, Hibernate)

**By Language:**
- **PHP**: `$stmt = $pdo->prepare("SELECT * FROM users WHERE email = ?"); $stmt->execute([$email]);`
- **Node.js**: Use `knex.js`, `prisma`, `sequelize`, or parameterized queries with your DB driver
- **Python**: Django ORM (automatic), or `cursor.execute("SELECT * FROM users WHERE email = %s", [email])`
- **Java**: JPA/Hibernate (automatic), or `PreparedStatement` with `?` placeholders

## 3. XSS Protection (Critical)
- Escape ALL user-generated content before rendering in HTML
- Use Content Security Policy (CSP) headers on every page
- Use framework template engines that auto-escape by default (React JSX, Django templates, Blade, Thymeleaf)
- Never use `innerHTML`, `dangerouslySetInnerHTML`, `{!! !!}`, or `|safe` with user data unless explicitly sanitized

## 4. CSRF Protection (Critical)
- Generate unique CSRF tokens for EVERY form
- Validate tokens on EVERY form submission
- Most frameworks handle this automatically when configured:
  - **PHP/Laravel**: `@csrf` directive
  - **Django**: `{% csrf_token %}`
  - **Express**: `csurf` middleware or `csrf-csrf` package
  - **Spring**: CSRF enabled by default in Spring Security
  - **React/SPA**: Use the `SameSite` cookie attribute + custom headers

## 5. Session Security (Critical)
- Set cookie flags: `HttpOnly`, `Secure`, `SameSite=Strict` (or Lax)
- Regenerate session ID on login and privilege changes
- Set session expiration timeouts
- Use secure session storage (server-side, not just cookies)
- Invalidate sessions on logout

## 6. File Upload Security (Critical)
- Strict whitelist of allowed file extensions and MIME types
- Check file content (magic bytes), not just the extension
- Limit file size (default: 5MB unless otherwise specified)
- Rename uploaded files (use UUID or hash, never user-provided names)
- Store uploads outside the web root when possible
- Scan for malware if handling untrusted files

## 7. Authentication & Authorization (Critical)
- Hash passwords with Argon2id (preferred) or bcrypt. NEVER MD5, SHA1, or SHA256 for passwords.
- Implement role-based access control (RBAC) on EVERY protected route
- Support multi-factor authentication (TOTP, SMS, email codes)
- Account lockout after repeated failed login attempts (5 attempts / 15 minutes)
- Secure password reset flow (time-limited tokens, email verification)

## 8. API Token Management
- Generate tokens with cryptographically secure random bytes (minimum 32 bytes / 256 bits)
- Store HASHED tokens in the database (like passwords)
- Set expiration times (default: 24 hours for access tokens, longer for refresh tokens)
- Implement token refresh/rotation for long-lived sessions
- Provide token revocation capability
- Rate limit per token

## 9. Data Encryption
- Encrypt sensitive data at rest (PII, payment info, medical data, tokens)
- Use AES-256-GCM or equivalent authenticated encryption
- Store encryption keys in environment variables or secret managers, NEVER in code
- Use TLS 1.2+ for all data in transit
- Fields to encrypt: email, phone, address, payment details, health data, API tokens

## 10. Rate Limiting (Critical)
- Implement on ALL forms, auth endpoints, and API routes
- Dual strategy: IP-based AND account-based
- Recommended limits:
  - Login: 5 attempts / 15 minutes
  - API: 100 requests / hour per token
  - Forms: 10 submissions / 5 minutes per IP
  - Password reset: 3 requests / hour per email

## 11. Security Headers (Mandatory on Every Response)
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0 (deprecated, rely on CSP instead)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
Strict-Transport-Security: max-age=31536000; includeSubDomains (HTTPS only)
```

## 12. Error Handling & Logging
- NEVER expose system information, stack traces, file paths, or SQL errors to users
- Log ALL security events with timestamps: failed logins, permission denials, suspicious activity
- Log to files, never to the browser/response
- NEVER log passwords, tokens, PII, or sensitive data
- Rotate log files to prevent disk exhaustion

## 13. Database Security
- Use a separate database user with minimal privileges (not root/admin)
- Enable SSL for database connections in production
- Apply regular security updates and patches
- Use firewall rules to restrict database access to application servers only

## 14. Dependency Security
- Keep all dependencies up to date
- Run vulnerability scans regularly: `npm audit`, `pip audit`, `composer audit`, OWASP Dependency-Check
- Remove unused dependencies
- Pin dependency versions to prevent supply chain attacks

## Security Testing Checklist
Before any page goes live:
- [ ] SQL injection testing (parameterized queries confirmed)
- [ ] XSS vulnerability testing (output escaping confirmed)
- [ ] CSRF protection verification (tokens on all forms)
- [ ] Authentication bypass testing
- [ ] Authorization testing (role-based access verified)
- [ ] Input validation testing (all fields validated server-side)
- [ ] File upload security testing (whitelist, size, content)
- [ ] Session management testing (secure flags, regeneration)
- [ ] Security headers present on all responses
- [ ] No secrets in source code
- [ ] Error pages do not leak system information

## Additional Rules (multi-tenant and permissioned apps)

These come from a multi-tenant project's copy of the standards library and hold for any app with
more than one customer or role:

- **Fail closed.** A missing, null or unreadable permission record means DENY. Never default to
  allow.
- **Hiding a link is not access control.** Navigation, the route guard and the API must all
  enforce the same rule. The API is the one that matters; the UI only mirrors it.
- **Cross-tenant misses look like "not found".** A request for another tenant's record returns
  404 or an empty result, never the record, and never an error that confirms the record exists.
- **Secrets are reveal-once.** API keys and generated credentials are shown to the user exactly
  once at creation, stored hashed, and masked on every later read.
- **Logs and errors carry identifiers only.** Record IDs (tenant, user, record, request), never
  secret values and never private content (message bodies, recordings, transcripts, documents).
  Scrub free-text error fields before they are logged or stored.
