---
name: standard-local-dev-environment
description: Standard for local development environments across stacks, built on "clone, install, configure, run". Covers local setup for PHP, Node.js, Python, Java and Docker, the database migration workflow and migration file template, framework migration commands, local testing habits, common dev tooling requirements, and a deployment preparation checklist. Read before setting up a project to run locally, writing setup instructions or a docker-compose file, onboarding a new machine, creating a migration file by hand, or preparing a first deploy from local to production, and when the user says "get this running locally", "set up my dev environment", "it does not run on my machine", "how do I run this", "set up Docker" or "ready to deploy".
---

# Standard 10 - Local Development Environment

Every project must be runnable locally with minimal setup: zero to a working environment in under
30 minutes.

Related skills: `standard-config-and-secrets` (the .env pattern), `standard-database-design`
(schema and migration rules in depth), `standard-guided-setup` (walking a person through setup
one step at a time), `standard-testing-strategy`.

House rule for agents: before any database write (running a migration, or any INSERT, UPDATE,
DELETE or DROP), pull the LIVE schema of every object it touches and verify the SQL against it.
Migration files and memory drift; only the live database is truth.

## Principle: Clone, Install, Configure, Run
Every project MUST be runnable locally with minimal setup. A new developer should go from zero to a working local environment in under 30 minutes.

## 1. Environment Setup by Stack

### PHP (Apache/Nginx + MySQL)
- **Tools**: XAMPP, MAMP, Laravel Valet, Docker, or native Apache/Nginx
- **Local URL**: `http://localhost/project-name/` or `http://project-name.test`
- **Database**: MySQL via phpMyAdmin, MySQL Workbench, or CLI
- **Requirements**: mod_rewrite enabled, PHP extensions (pdo_mysql, mbstring, openssl, gd, curl)
- **Config**: .env file or config.php outside web root

### Node.js (Express, Next.js, React, Vue)
- **Tools**: Node.js + npm/yarn/pnpm, Vite, Next.js dev server, webpack-dev-server
- **Local URL**: `http://localhost:3000` (or configured port)
- **Database**: MongoDB (Compass), PostgreSQL (pgAdmin), MySQL, or SQLite
- **Requirements**: Node.js LTS version, package manager, .env file
- **Config**: `.env.local` file, loaded automatically by most frameworks

### Python (Django, Flask, FastAPI)
- **Tools**: Python 3.x, virtualenv/venv/conda, pip
- **Local URL**: `http://localhost:8000` (Django), `http://localhost:5000` (Flask)
- **Database**: SQLite (dev), PostgreSQL/MySQL (production-like)
- **Requirements**: Virtual environment, requirements.txt or pyproject.toml
- **Config**: .env file with python-dotenv, or framework-specific settings

### Java (Spring Boot, Jakarta EE)
- **Tools**: JDK 17+, Maven/Gradle, IntelliJ IDEA or VS Code
- **Local URL**: `http://localhost:8080`
- **Database**: H2 (dev), PostgreSQL/MySQL (production-like)
- **Requirements**: JDK, build tool, application.properties/.yml
- **Config**: application-dev.properties with environment variable references

### Docker (Any Stack)
- **Tools**: Docker Desktop, Docker Compose
- **Setup**: `docker-compose up` starts all services (app, database, cache, etc.)
- **Config**: docker-compose.yml + .env file
- **Advantage**: Identical environment across all developers

## 2. Database Management (Critical)

### Migration Workflow (All Stacks)
For EVERY database schema change:
1. Write the change in a migration file
2. Save with timestamp naming: `YYYY-MM-DD_NNN_description` (or use framework's migration system)
3. Include both UP (apply) and DOWN (rollback) operations
4. Include a header comment describing what the migration does
5. Announce the migration file in chat
6. Keep a current schema dump updated

### Migration File Template (Raw SQL):
```sql
-- Migration: [description]
-- Date: YYYY-MM-DD
-- Description: [what this migration does]

-- ============ UP (Apply) ============
[SQL statements here]

-- ============ DOWN (Rollback) ============
[Reverse SQL statements here]
```

### Framework Migration Tools:
- **Laravel**: `php artisan make:migration create_users_table`
- **Django**: `python manage.py makemigrations && python manage.py migrate`
- **Rails**: `rails generate migration CreateUsers`
- **Sequelize**: `npx sequelize-cli migration:generate --name create-users`
- **Prisma**: `npx prisma migrate dev --name create-users`
- **Flyway/Liquibase (Java)**: SQL or XML/YAML migration files
- **Alembic (Python)**: `alembic revision --autogenerate -m "create users"`

### Rules:
- NEVER make schema changes directly in the database without a migration file
- NEVER modify a migration that has already been applied. Create a new one.
- Keep schema documentation current (ERD diagram, schema dump, or ORM model docs)
- Use `IF NOT EXISTS` / `IF EXISTS` where possible for idempotent migrations

## 3. Testing Locally
- Test at the local URL after every change
- Check browser DevTools for console errors, network failures, responsive behavior
- Test API endpoints via browser, Postman, curl, or Thunder Client
- Check application logs for server-side errors
- Test on multiple screen sizes (use browser DevTools responsive mode)
- Run automated tests before committing: `npm test`, `pytest`, `php artisan test`, `mvn test`

## 4. Common Local Development Requirements
- Hot reload / auto-refresh for rapid development
- Debugging tools configured (VS Code debugger, browser DevTools, framework-specific debuggers)
- Linting and formatting on save (ESLint, Prettier, Flake8, Black, Checkstyle)
- Error display ON in development, OFF in production
- Verbose logging in development, structured logging in production

## 5. Deployment Preparation Checklist
When ready to deploy from local to production:
- [ ] All environment variables configured for production
- [ ] Debug mode disabled
- [ ] Database credentials are NOT default (root with empty password)
- [ ] HTTPS/SSL enforced
- [ ] Error display disabled (log errors, don't show to users)
- [ ] Assets minified and optimized
- [ ] All migrations applied to production database
- [ ] File permissions set correctly
- [ ] Automated backups configured
- [ ] Monitoring and alerting set up

## Remember
- Document the setup process in README.md
- Every DB change needs a migration file. No exceptions.
- Keep local and production configurations separate via environment variables
- Never commit secrets, even for local development
