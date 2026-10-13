---
name: standard-database-design
description: Standard for database design and management across SQL and NoSQL. Covers universal data modeling, security and migration rules, SQL table and column naming, required columns, data types, character sets, indexes, foreign key behaviors and a SQL migration template, framework migration tools, document database structure with embed versus reference guidance, key-value naming and DynamoDB design, graph and time-series basics, backup strategy and seed data. Read before creating or altering any table, column, index, constraint, collection or document shape, before writing a migration, before choosing a data type for money, dates or IDs, and when the user says "design the schema", "add a table", "add a column", "write a migration", "what type should this be", "foreign key", "embed or reference" or "set up backups".
---

# Standard 14 - Database Design and Management

Related skills, each the authority on its part:

- `query-efficiency`: making queries, RPCs and RLS policies fast (N+1, indexes matched to real
  queries, EXPLAIN, measuring). Read it before writing any query.
- `security-rls-permissions`: row level security, permission tables and SECURITY DEFINER
  functions on Postgres.
- `money-truth-doctrine`: money paths.
- `standard-local-dev-environment`: the migration workflow day to day.

House rule for agents: before any database write (applying a migration, or any INSERT, UPDATE,
DELETE or DROP), pull the LIVE schema of every table, function and trigger it touches and verify
your SQL against it exactly. Migration files and memory drift; only the live database is truth.

**Applies to:** ALL database types. SQL (MySQL, PostgreSQL, SQLite, SQL Server, Oracle) AND NoSQL (MongoDB, DynamoDB, Redis, Cassandra, Firebase Firestore).

---

## Part 1: Universal Principles (All Databases)

### Data Modeling Rules
- Design schema BEFORE writing code. Think about queries first.
- Normalize to reduce redundancy (SQL) or denormalize strategically for read performance (NoSQL)
- Every entity needs a unique identifier (primary key, document ID, partition key)
- Every record needs timestamps: `created_at`, `updated_at`
- Plan for soft deletes (`deleted_at` or `is_deleted`) where data recovery matters
- Use consistent naming: lowercase, underscores, plural for collections/tables

### Security Rules (ALL Databases)
- NEVER store plaintext passwords. Use Argon2id or bcrypt.
- Encrypt sensitive fields at rest (PII, payment data, health records, tokens)
- Use parameterized queries (SQL) or sanitized inputs (NoSQL) to prevent injection
- In production: use a dedicated database user with minimal privileges
- Enable SSL/TLS for database connections
- Regular access reviews and audit logging
- Backup regularly. Test restores.

### Migration Rules (ALL Databases)
- EVERY schema change MUST be recorded in a migration file or tracked by a migration tool
- Include both forward (apply) and backward (rollback) operations
- NEVER modify a migration that has been applied. Create a new one.
- Keep schema documentation current
- Test rollback before considering a migration complete

---

## Part 2: SQL Databases (MySQL, PostgreSQL, SQLite, SQL Server)

### Table Naming
- **Plural nouns**: `users`, `orders`, `products`
- **Lowercase with underscores**: `user_profiles`, `order_items`
- **Junction tables**: alphabetical: `category_product`, `role_user`

### Column Naming
- **Lowercase with underscores**: `first_name`, `created_at`
- **Primary key**: `id` (auto-increment or UUID)
- **Foreign keys**: `{singular_table}_id` (e.g., `user_id`)
- **Booleans**: `is_active`, `has_verified`, `can_edit`
- **Timestamps**: `created_at`, `updated_at`, `deleted_at`

### Required Columns (Every Table)
```sql
id SERIAL PRIMARY KEY,                    -- PostgreSQL
-- or: id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,  -- MySQL
-- or: id INTEGER PRIMARY KEY AUTOINCREMENT,        -- SQLite
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

### Data Types
| Purpose | Recommended Type | NEVER Use |
|---------|-----------------|-----------|
| Short text | VARCHAR(255) or smaller | |
| Long text | TEXT or MEDIUMTEXT | |
| Money/currency | DECIMAL(10,2) | FLOAT, DOUBLE |
| Date + time | TIMESTAMP or DATETIME | |
| Date only | DATE | |
| Boolean | BOOLEAN (PG) / TINYINT(1) (MySQL) | |
| IDs | INT, BIGINT, or UUID | |
| JSON data | JSONB (PG) / JSON (MySQL) | TEXT for structured data |

### Character Set
- Always use `utf8mb4` (MySQL) or `UTF-8` (PostgreSQL) for full Unicode support

### Indexes
- Primary key on every table
- Index ALL foreign key columns
- Index columns in WHERE, ORDER BY, GROUP BY clauses
- Composite indexes for multi-column queries (leftmost prefix rule)
- UNIQUE indexes for uniqueness constraints
- Avoid over-indexing (slows writes)

### Foreign Keys & Relationships
```sql
-- CASCADE: delete children when parent deleted (sessions, logs)
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

-- SET NULL: nullify reference when parent deleted (optional category)
FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL

-- RESTRICT: prevent deletion if children exist (company with employees)
FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
```

### SQL Migration Template
```sql
-- Migration: [description]
-- Date: YYYY-MM-DD

-- ============ UP (Apply) ============
CREATE TABLE IF NOT EXISTS table_name (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_table_column ON table_name(column_name);

-- ============ DOWN (Rollback) ============
DROP TABLE IF EXISTS table_name;
```

### Framework Migration Tools
- **Laravel**: `php artisan make:migration`
- **Django**: `python manage.py makemigrations`
- **Rails**: `rails generate migration`
- **Prisma**: `npx prisma migrate dev`
- **Sequelize**: `npx sequelize-cli migration:generate`
- **Flyway / Liquibase** (Java): SQL or XML migration files
- **Alembic** (Python): `alembic revision --autogenerate`
- **Knex.js**: `npx knex migrate:make`

---

## Part 3: NoSQL Databases

### Document Databases (MongoDB, Firestore, CouchDB)

**Collection Naming**: plural, lowercase (`users`, `orders`, `products`)

**Document Structure**:
```javascript
// Define a clear schema even though the DB is schemaless
{
    _id: ObjectId,            // Auto-generated unique identifier
    name: String,             // Required fields documented
    email: String,            // Unique constraint at application or DB level
    role: String,             // Enum-like values documented
    preferences: {            // Embedded subdocuments for tightly coupled data
        theme: "dark",
        language: "en"
    },
    organization_id: ObjectId, // Reference to another collection (like a foreign key)
    is_active: Boolean,
    created_at: Date,
    updated_at: Date
}
```

**When to Embed vs Reference**:
| Embed (nest inside document) | Reference (separate collection) |
|------------------------------|-------------------------------|
| Data is always read together | Data is shared across entities |
| One-to-few relationship | One-to-many or many-to-many |
| Data rarely changes | Data changes independently |
| Example: user.address | Example: user.organization_id |

**Schema Validation** (enforce structure):
- **MongoDB**: Use JSON Schema validators or Mongoose schemas
- **Firestore**: Use Security Rules + application-level validation
- **Application Layer**: Pydantic (Python), Zod/Joi (JS), class-validator (TS)

**Indexing**:
- Index fields used in queries (find, sort, filter)
- Compound indexes for multi-field queries
- Text indexes for search functionality
- TTL indexes for auto-expiring data (sessions, tokens)

### Key-Value Stores (Redis, DynamoDB, Memcached)

**Key Naming Convention**: `namespace:entity:id:field`
```
user:123:profile
session:abc-def-ghi
cache:products:featured
rate_limit:ip:203.0.113.7
```

**DynamoDB Considerations**:
- Design around access patterns FIRST (single-table design)
- Choose partition key for even distribution
- Use sort keys for range queries
- GSI (Global Secondary Index) for alternate access patterns

### Graph Databases (Neo4j, Amazon Neptune)
- Nodes represent entities, edges represent relationships
- Label nodes clearly: `:User`, `:Product`, `:Order`
- Name relationships as verbs: `:PURCHASED`, `:FOLLOWS`, `:BELONGS_TO`
- Index properties used in MATCH clauses

### Time-Series Databases (InfluxDB, TimescaleDB)
- Organize by measurement/metric name
- Tag frequently queried dimensions
- Set retention policies for automatic data cleanup
- Use downsampling for long-term storage

---

## Part 4: Data Integrity & Backup

### Backup Strategy (ALL Databases)
- Automated daily backups minimum
- Keep a current schema dump or model definition in the repository
- Test restore procedures regularly (untested backups are not backups)
- Store backups in a different location than the database
- Encrypt backup files at rest

### Seed Data
- Store sample/test data in a dedicated seeds directory
- Include realistic data for development
- NEVER include real production data or real credentials
- Useful for onboarding new developers

---

## Implementation Requirement
Every database change goes through migration files or migration tools. Schema documentation stays current. No direct database edits without a recorded migration. This applies to SQL AND NoSQL.

## Additional Rules (from a multi-tenant project copy)

- **Money, alternative to DECIMAL.** Storing money as an INTEGER count of the smallest unit
  (cents, or a finer unit such as millicents when sub-cent rates exist) is equally valid and
  avoids rounding questions entirely. Pick one representation per project and never mix. Never a
  float.
- **Migration order is load-bearing.** Migrations apply in a strict order. A new migration takes
  the next free number or timestamp and never reuses or renumbers an existing one.
- **Multi-tenant tables.** Every tenant-owned table carries the tenant key, and every index that
  serves a list query leads with it, matched to the real ORDER BY, for example
  `(tenant_id, created_at desc, id desc)`. An unindexed tenant scan is the classic multi-tenant
  performance cliff.
- **`updated_at` must actually update.** A column default only sets it on insert. Use a trigger
  (or the ORM's hook) so it changes on every update.
