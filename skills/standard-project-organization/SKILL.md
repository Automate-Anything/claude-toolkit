---
name: standard-project-organization
description: Standard for project folder structure, naming conventions and documentation placement across stacks. Covers organizing principles, reference folder layouts for full-stack web, React / Next.js / Vue SPAs, Python (Django, Flask, FastAPI) and Java Spring Boot, a universal naming convention table for files, folders, CSS classes, database tables, migrations and tests, rules for the docs folder and README, and general organization rules. Read before scaffolding a new project, creating a new top-level folder, deciding where a new file belongs, naming a file, folder, table or migration, or writing a README, and when the user says "set up the project structure", "where should this file go", "organize the repo", "restructure the folders" or "what should I name this".
---

# Standard 07 - Project Organization

A structure anyone can explain in thirty seconds. When a project already has an established
layout, follow it; use the patterns below for new projects and for deciding where new things go.

Related skills: `standard-assets-organization` (inside the assets folder),
`standard-database-design` (table and migration naming in depth), `standard-testing-strategy`
(test folder layout), `standard-project-info-template` (the fact sheet that records this
project's actual layout).

## Principles
1. Group by feature/concern, not by file type
2. One purpose per folder
3. Clear, descriptive names
4. Max 3-4 levels deep. No deeply nested chaos.
5. Shared utilities go in a dedicated shared/common folder
6. Static assets go in a dedicated assets/public/static folder
7. Tests mirror the source structure
8. Documentation lives in /docs

## Universal Structure Patterns

### Full-Stack Web (PHP, Node, Python)
```
project-root/
|-- src/ (or /app)             # Application source code
|   |-- controllers/           # Route handlers / request logic
|   |-- models/                # Data models / ORM definitions
|   |-- services/              # Business logic
|   |-- middleware/             # Auth, CORS, rate limiting, logging
|   |-- utils/                 # Helper functions
|   +-- views/ (or templates/) # Server-rendered templates (if applicable)
|-- api/                       # API endpoints (if separate from src)
|   +-- v1/                    # Versioned API routes
|-- assets/ (or public/static/)
|   |-- css/                   # Stylesheets
|   |-- js/                    # Client-side JavaScript
|   |-- images/                # Icons, backgrounds, content images
|   +-- fonts/                 # Custom fonts
|-- config/                    # App configuration (non-secret)
|-- database/
|   |-- migrations/            # Schema change files (timestamped)
|   |-- seeds/                 # Sample/test data
|   +-- schema.sql             # Current full schema dump
|-- docs/                      # Documentation
|-- tests/                     # Test files (mirror src structure)
|-- uploads/                   # User uploads (gitignored)
|-- logs/                      # Application logs (gitignored)
|-- cache/                     # Cache files (gitignored)
|-- .env.example               # Config template (safe for Git)
|-- .gitignore
+-- README.md
```

### React / Next.js / Vue / Frontend SPA
```
project-root/
|-- src/
|   |-- components/            # Reusable UI components
|   |   |-- ui/                # Base components (Button, Input, Card)
|   |   +-- layout/            # Layout components (Header, Sidebar, Footer)
|   |-- pages/ (or views/)     # Route-level page components
|   |-- hooks/                 # Custom hooks (React) / composables (Vue)
|   |-- services/              # API calls, external service integrations
|   |-- store/ (or context/)   # State management
|   |-- utils/                 # Helper functions
|   |-- styles/                # Global styles, design tokens, themes
|   |-- types/                 # TypeScript type definitions
|   +-- assets/                # Static assets imported by components
|-- public/                    # Static files served directly
|-- tests/                     # Test files
|-- .env.example
+-- package.json
```

### Python (Django / Flask / FastAPI)
```
project-root/
|-- app/ (or project_name/)
|   |-- models/                # Database models
|   |-- views/ (or routes/)    # Request handlers
|   |-- services/              # Business logic
|   |-- serializers/           # Data serialization (Django REST)
|   |-- middleware/             # Custom middleware
|   |-- utils/                 # Helpers
|   +-- templates/             # HTML templates
|-- static/                    # CSS, JS, images
|-- migrations/                # Database migrations (auto-generated)
|-- tests/
|-- requirements.txt (or pyproject.toml)
|-- .env.example
+-- manage.py (or main.py)
```

### Java (Spring Boot)
```
project-root/
|-- src/main/java/com/project/
|   |-- controller/            # REST controllers
|   |-- service/               # Business logic
|   |-- repository/            # Data access layer
|   |-- model/ (or entity/)    # JPA entities / data models
|   |-- dto/                   # Data transfer objects
|   |-- config/                # Configuration classes
|   |-- security/              # Auth, filters, JWT
|   +-- util/                  # Utility classes
|-- src/main/resources/
|   |-- static/                # CSS, JS, images
|   |-- templates/             # Thymeleaf / server templates
|   +-- application.properties # Config (uses env vars for secrets)
|-- src/test/                  # Test files
+-- pom.xml (or build.gradle)
```

## Naming Conventions (Universal)

| Element | Convention | Examples |
|---------|-----------|----------|
| Files (web assets) | kebab-case | `user-profile.css`, `form-validation.js` |
| Files (source code) | Language convention | `UserService.java`, `user_service.py`, `userService.js` |
| Folders | lowercase-with-dashes or lowercase | `api-routes/`, `middleware/`, `utils/` |
| CSS classes | BEM or kebab-case | `.card__title--large`, `.nav-link` |
| DB tables | plural_snake_case | `users`, `order_items`, `user_roles` |
| DB columns | snake_case | `first_name`, `created_at`, `is_active` |
| Migration files | Timestamp + description | `2026-02-16_001_create-users-table.sql` |
| Test files | Match source + suffix | `UserService.test.js`, `test_user_service.py` |

## Documentation Rules

### /docs/ folder
- Write `.md` files when building complex features
- Explain WHAT was built, WHY this approach, HOW it works
- Keep concise. No rambling.
- Organize by topic in subfolders: `docs/features/`, `docs/architecture/`, `docs/api/`

### README.md (every project MUST have)
- Project name and brief description
- Tech stack
- Setup instructions (clone, install dependencies, configure env, run)
- Project structure overview
- Contributing guidelines (if applicable)

## Organization Rules
1. Every file earns its place. No empty files, no placeholder files.
2. If a folder has only one file, consider whether the folder is needed.
3. Shared/reusable code goes in utils/, helpers/, or lib/. Not duplicated.
4. Third-party libraries go through package managers (npm, pip, composer, Maven). No manual lib/ folders unless absolutely necessary.
5. Keep config, code, assets, and docs clearly separated.
6. Tests live alongside source (co-located) or in a parallel /tests directory. Be consistent.
