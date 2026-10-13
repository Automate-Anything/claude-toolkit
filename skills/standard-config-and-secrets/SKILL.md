---
name: standard-config-and-secrets
description: Standard for configuration and secrets management with zero hardcoded secrets. Covers the .env and .env.example pattern, loading environment variables in Node, Python, PHP and Java, validating required variables at startup, the config change workflow, .gitignore entries, a production configuration checklist and secret rotation principles. Read before adding or reading any environment variable, API key, password, token, database credential or connection string, before creating or editing .env.example or .gitignore, before wiring a new third-party service, and when the user says "add an env var", "where do I put this key", "set up the config", "rotate the secret", "is this key exposed" or "hardcoded secret".
---

# Standard 04 - Config and Secrets Management

No secret, API key, password, database credential or other sensitive value is ever hardcoded.

Related skills: `standard-security-fortress` (the wider security baseline),
`standard-git-workflow` (what must never be committed), `standard-local-dev-environment`
(per-stack local setup).

## Mandatory Configuration System
NO secrets, API keys, passwords, database credentials, or sensitive data EVER hardcoded in the codebase. Everything goes through environment variables or secure config systems.

## 1. The Golden Rule
```
Source code = PUBLIC. Secrets = PRIVATE. They NEVER mix.
```

## 2. Environment Variables (.env) - Universal Approach
```bash
# .env.example - TEMPLATE FILE (safe for Git, committed to repo)
# Copy to .env and fill in real values. NEVER commit the real .env.

# -- Database --
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database
DB_USER=your_user
DB_PASSWORD=your_password
DB_SSL=false

# -- Application --
APP_NAME=Your App
APP_URL=http://localhost:3000
APP_ENV=development
APP_DEBUG=true
APP_SECRET=generate-a-random-secret-min-32-chars
APP_PORT=3000

# -- Authentication --
JWT_SECRET=generate-random-min-64-chars
JWT_EXPIRY=86400
SESSION_SECRET=generate-random-min-32-chars
ENCRYPTION_KEY=generate-random-exactly-32-chars

# -- Email / SMTP --
MAIL_HOST=smtp.your-provider.com
MAIL_PORT=587
MAIL_USER=your-email@domain.com
MAIL_PASSWORD=your-app-password
MAIL_FROM=noreply@yourdomain.com
MAIL_FROM_NAME=Your App

# -- External API Keys (add as needed per project) --
# API_KEY_SERVICE_NAME=your-key-here
# API_SECRET_SERVICE_NAME=your-secret-here

# -- OAuth Providers (add as needed per project) --
# OAUTH_PROVIDER_CLIENT_ID=your-client-id
# OAUTH_PROVIDER_CLIENT_SECRET=your-client-secret

# -- File Storage --
UPLOAD_MAX_SIZE=5242880
UPLOAD_PATH=./uploads
# STORAGE_DRIVER=local
# STORAGE_BUCKET=your-bucket
# STORAGE_REGION=your-region
# STORAGE_ACCESS_KEY=your-key
# STORAGE_SECRET_KEY=your-secret

# -- Cache --
CACHE_DRIVER=file
CACHE_TTL=3600
# REDIS_URL=redis://localhost:6379

# -- Rate Limiting --
RATE_LIMIT_LOGIN=5
RATE_LIMIT_WINDOW=900
RATE_LIMIT_API=100

# -- Logging --
LOG_LEVEL=debug
LOG_FILE=./logs/app.log
```

**IMPORTANT**: The example above uses GENERIC placeholders. When starting a project, add ONLY the environment variables your project actually needs. Remove everything else. Do not pre-populate with vendor-specific keys until they are needed.

## 3. Loading Environment Variables by Stack

### Node.js / JavaScript
```javascript
require('dotenv').config(); // npm install dotenv
const dbHost = process.env.DB_HOST;

// Validate required vars at startup
const required = ['DB_HOST', 'DB_NAME', 'APP_SECRET'];
for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env: ${key}`);
}
```

### Python
```python
from dotenv import load_dotenv  # pip install python-dotenv
import os
load_dotenv()
DB_HOST = os.getenv('DB_HOST', 'localhost')
```

### PHP
```php
// composer require vlucas/phpdotenv
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();
$dbHost = $_ENV['DB_HOST'];
```

### Java / Spring Boot
```properties
# application.properties reads from environment automatically
spring.datasource.url=jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}
spring.datasource.username=${DB_USER}
spring.datasource.password=${DB_PASSWORD}
```

## 4. Config Change Workflow (Mandatory)
When ANY config change is needed:
1. Update `.env.example` with the new key and a descriptive placeholder
2. Tell the developer: "I updated .env.example. Add the new value to your local .env."
3. NEVER edit the real .env file through code
4. NEVER commit .env to version control
5. Document what the variable does in a comment above it

## 5. Gitignore (Critical)
```gitignore
# Secrets
.env
.env.*
!.env.example

# Logs & cache
logs/
*.log
cache/
tmp/
.cache/

# User content
uploads/

# Dependencies
node_modules/
vendor/
__pycache__/
.venv/
target/
build/
dist/

# IDE & OS
.vscode/
.idea/
*.swp
.DS_Store
Thumbs.db
```

## 6. Production Security Checklist
- [ ] All placeholders replaced with real credentials
- [ ] Environment set to production (APP_ENV=production)
- [ ] Debug mode OFF
- [ ] Database credentials are NOT defaults
- [ ] .env file permissions restricted (600 or 640)
- [ ] No secrets in source code (scan: `grep -r "password=" src/`)
- [ ] Config file not accessible via browser
- [ ] HTTPS enforced everywhere
- [ ] Error display disabled, logging enabled

## 7. Secret Management Principles
- Rotate secrets regularly (minimum quarterly)
- Use secret managers for teams (vault services, cloud secret managers)
- Revoke compromised keys immediately
- Never share secrets via email, chat, or tickets
- Monitor for leaked secrets (repository scanning)
- Separate secrets per environment (dev/staging/production)
- Principle of least privilege: each service gets only the keys it needs

## Implementation Requirement
ZERO tolerance for hardcoded secrets. Every sensitive value goes through environment variables. This is non-negotiable.

## Additional Rules

- The agent never prints a real secret value into chat, a log, a commit message, a document or a
  test fixture. Refer to secrets by the NAME of their environment variable.
- If a secret is found committed or pasted somewhere it should not be, treat it as compromised:
  tell the owner immediately and recommend rotation. Removing it from the file is not enough.
- Secrets shown to end users (API keys, generated credentials) are reveal-once, stored hashed and
  masked on later reads.
