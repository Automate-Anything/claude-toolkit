---
name: security-rls-permissions
description: Reusable DESIGN PATTERN for multi-tenant database security in any Supabase/Postgres app: Row Level Security (RLS), role and page permissions, tenant isolation, SECURITY DEFINER function ACLs, and storage policies. Use this pattern BEFORE writing or modifying any RLS policy; any SECURITY DEFINER function (it bypasses RLS, so if it takes a company_id/contact_id/location_id/user_id or row-id param it MUST verify the caller owns that target in-body and revoke anon/authenticated, or it is a cross-tenant IDOR); any database trigger; creating or altering a table or column; adding or changing permission resources or page access; writing storage bucket policies; or debugging 403 / permission-denied / cross-tenant data errors. Also use when the user mentions RLS, "row level security," permissions, roles, role_permissions, role_page_access, SECDEF, "security definer," grants, "is_blocked," tenant isolation, IDOR, or storage policies.
---

# RLS Policy Standards - Complete Guide

> ⚠️ **This is a DESIGN PATTERN to implement per repository, not a description of an existing system.** The table names, helper functions (`get_my_company_id()`, `get_user_location_ids()`, `is_owner_or_super_admin()`, etc.), the role ladder, and the config files named below are a REFERENCE implementation. Grep THIS repo before citing any of them; when this doc and the real code disagree, the code wins. Build the equivalents in your stack, then update this skill to name what actually exists here.

This guide covers an ENTIRE multi-tenant permission system. There are TWO separate systems:

| System | Database Table (e.g.) | Purpose | Enforced By |
|--------|----------------|---------|-------------|
| **Data Access** | `role_permissions` | What DATA can a user read/write | Database RLS policies |
| **Page Access** | `role_page_access` | What PAGES can a user see | Frontend app code |

---

## Identity Model - READ FIRST

The security system should be **id-based and single-tenant per user**. Non-negotiable design invariants:

```
caller is auth.uid() == public.users.id      (1:1 invariant, enforced by a new-user trigger)
caller's company is users.company_id          (read by a helper like get_my_company_id())
caller's role is users.role_id                (read by a helper like get_my_role_id())
caller's email is users.email                 (CONTACT data, NEVER identity)
```

Key invariants your schema should establish:
- `auth.uid() = public.users.id` is enforced at user creation by a new-auth-user trigger (illustrative name: `handle_new_auth_user`). Every RLS policy can then rely on it.
- **Every `users.id` belongs to exactly one company.** Do not rely on a multi-tenant membership table or a JWT active-company claim unless your design explicitly has one; the simplest, hardest-to-break design is one company per user row. If the same human needs access to two companies, they get two separate `users.id` rows (one per company), each with its own auth.users row, password, and profile.
- Email is **not unique** and must never be identity. Multiple `public.users` rows can share an email. They are distinguished by `id`, never by email. A sign-in flow that supports shared emails shows a picker (company-then-user) when an email maps to N>1 accounts.
- When two accounts share one human-facing email, the second account's `auth.users.email` must hold a synthetic placeholder that your signup flow assigns (Supabase's `auth.users.email` unique constraint forces this). `public.users.email` holds the real human-facing email for both. Route outbound auth mail by looking up `public.users.email` via `auth.user.id`, never by trusting `auth.email()`.

**Lesson, stated as a general principle:** identity must be id-based, never email-based. Do not rely on a multi-tenant membership table or a JWT active-company claim unless your design has one and enforces it. Email can be a placeholder, can be shared, and can change; only the `auth.uid() = users.id` link is deterministic.

If you're writing or reviewing RLS, read **"CRITICAL: Identity is `auth.uid()`, NEVER email"** below. Every other rule in this document depends on it.

---

## CRITICAL: Adding a New Protected Resource

When you add a protected resource (a table under RLS with a permission toggle), you MUST update several places that all have to agree. The exact filenames differ per repo; the WORKFLOW is what matters. Grep this repo for where each of these lives before you start.

### The places that must stay in sync

| Place (generic) | Example name in a repo | What to add |
|-----------------|------------------------|-------------|
| The RLS policies | `supabase/migrations/*.sql` | SELECT/INSERT/UPDATE/DELETE policies referencing the resource name |
| The new-company seeding function | e.g. `create_permissions_for_new_company()` | Add the resource so brand-new companies get permission rows |
| A backfill migration | `migrations/NNN_*.sql` | Grant the new resource to every existing role+company combo |
| The frontend permission defaults | e.g. `default_role_permissions.json` | Default permissions for the resource across ALL roles |
| The resource list the permission UI reads | e.g. `src/config/rolePermissions.ts` (a RESOURCES array) | Register the resource so it shows in the Role Permissions UI |
| Any special-behavior allowlist | e.g. a `RESOURCES_WITH_BULK_DELETE` array in the role-management screen | Add the resource if it supports that behavior (bulk delete, etc.) |

### Resource naming rule

Register each resource under a stable string key. A clean convention is `<entity>_table` derived from the underlying table:

| Resource Key | Table | Category |
|--------------|-------|----------|
| `<entity>_table` (e.g. `booking_table`) | `bookings` | operations |
| `contacts_table` | `contacts` | operations |
| `location_table` | `locations` | configuration |

Pick one convention and keep it identical in the RLS policies, the seeding function, the defaults JSON, and the UI resource list. If a special-behavior array (e.g. one listing resources that support bulk delete) exists, check whether your new resource belongs in it:

```typescript
const RESOURCES_WITH_BULK_DELETE = [
  'contacts_table',
  'product_table',
  'service_table',
  // Add a new resource here if it supports bulk delete
];
```

**The rule to internalize:** when you add a protected resource you must update N places (the RLS policies, the new-company seeding function, the backfill migration, the frontend defaults, and the UI resource list). Missing any one leaves users either locked out (no permission row exists) or with a toggle that shows in the UI but does nothing.

---

## The 6 Security Layers

Every database query should pass through these checks, in this order:

```
1. BLOCKED?       -> Is the user blocked? (If yes, deny all access)
2. AUTHENTICATED? -> Is the user logged in?
3. COMPANY?       -> Does the row belong to their company?
4. LOCATION?      -> Is the row in a location they can access?
5. PERMISSION?    -> Does their role allow this operation?
6. OWNERSHIP?     -> Is this row theirs (if restricted to own data)?
```

### Layer 1 (Blocked) - Critical First Check

**CRITICAL:** The `is_blocked` check must be the FIRST check in every RLS policy. If a user has `is_blocked = true` in the `public.users` table, they must be denied access to ALL operations, regardless of their role or permissions.

**How to check:**
```sql
-- Check if current user is blocked
NOT EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid()
  AND u.is_blocked = true
)
```

**Why first?** A blocked user should have zero access, even if they have owner permissions or are assigned to all locations. This is a security measure that overrides all other checks. Putting it first means no other clause can accidentally grant access to a blocked user.

### CRITICAL: Identity is `auth.uid()`, NEVER email

**Hard rule, no exceptions.** Every RLS policy that identifies a user MUST use `auth.uid()` (which equals `public.users.id` via the 1:1 invariant). Any policy that uses `auth.email()`, `auth.jwt() ->> 'email'`, `users.email = ...`, or a `*.login_email = ...` column for identity is a bug, even if it appears to work today.

Why this is non-negotiable:
- `public.users.email` is NOT unique. Two humans can share an email when they share an inbox. Email-based RLS would either return nothing for one of them (under-grant lockout) or return both rows (cross-account leak).
- `auth.users.email` may be a synthetic placeholder (assigned by your signup flow when two accounts share one human-facing email) that doesn't equal the user's real `public.users.email`. `auth.email()` returns the synthetic; matching it against `public.users.email` fails.
- The `auth.uid() = users.id` 1:1 invariant is enforced at user creation by a new-user trigger. It's the only deterministic identity link.
- Company/role helpers should be id-based (no email fallback). Anything you write that depends on them then inherits id-based identity automatically.

**Patterns to use:**

```sql
-- Identify the caller
WHERE u.id = auth.uid()

-- Identify the caller's company (single-tenant)
WHERE company_id = get_my_company_id()

-- Identify a service provider by their auth identity (when needed)
WHERE t.user_id = auth.uid() AND t.was_deleted = false

-- Cross-row "do these two users share a company?" check
-- Use a SECDEF helper (illustrative name auth_shares_company_with);
-- it's a simple users.company_id comparison.
WHERE public.auth_shares_company_with(:target_user_id)
```

**Patterns that are bugs (do NOT write these):**

```sql
-- BUG: email is not unique, lookup is non-deterministic
WHERE u.email = lower(auth.email())

-- BUG: a placeholder auth email won't match the human-facing public email
WHERE u.email = (auth.jwt() ->> 'email')

-- BUG: identifying by an email column instead of the auth id
WHERE some_table.login_email = lower(auth.email())

-- BUG: identifying by a username/alias column instead of the auth id
WHERE u.username = something

-- BUG: relying on a multi-tenant membership table your design doesn't have
WHERE EXISTS (SELECT 1 FROM user_companies WHERE ...)

-- BUG: relying on a JWT active-company claim your design doesn't set
WHERE company_id = (auth.jwt() -> 'app_metadata' ->> 'active_company_id')::uuid
```

If you find a policy using `auth.email()` for identity, or an email/username column for identity, or a membership table / active-company JWT claim your design doesn't actually maintain, it's a bug: open a migration to rewrite it to `auth.uid()`-based identity. Where existing code joins on an email column to find a user, replace it with a join through `users` on the id.

### A typical role ladder (adapt to your app)

Roles can be **global** rows in a `roles` table (no `company_id`), shared by every company, with per-company tuning living in `role_permissions` (data) and `role_page_access` (pages). A typical privilege ladder looks like this; adapt the names and count to your app. Privilege order high -> low (a `role_privilege_level` ladder): **owner(0) -> super_admin(1) -> admin(2) -> manager(3) -> front_desk(4) -> staff(5) -> viewer(6)**.

When you build a NEW page/resource and pick its per-role defaults, use this intent table as a REUSABLE example. You still write the value into every role in the defaults JSON and the seeding functions; this just tells you what the value SHOULD be for each.

| Role | Intended scope | Default a new page/resource to... |
|------|----------------|-----------------------------------|
| **owner** | Full access to everything, always. Locked in the permissions UI (cannot be edited). Treated as all-access in code at the page layer. | **ON / full** (view+edit+all). Never gate a page off for owner. |
| **super_admin** | Platform-internal. Full bypass in the permission hook. Hidden from the permissions card row. | **ON / full**, like owner. |
| **admin** | Company admin: full data + page permissions, but STILL location-scoped (only their assigned locations). | **ON / full** for almost everything. |
| **manager** | Runs a location end to end: operations + light config (catalog, location settings, schedules) + payroll/team management + most analytics/billing visibility. NOT account-ownership config. | ON for ops + config you'd trust a location manager with; OFF for owner-only account settings. |
| **front_desk** | **Front-line staff.** Runs the customer-facing floor: the core transactional flows, **take payments**, contacts, comms, inventory, promotions, plus **light config** (catalog editing, basic location settings). Location-scoped like manager. **Deliberately LACKS** team management, payroll, role permissions, billing/subscription, integrations setup, and bulk-delete. Think "manager minus the back office." | If a real front-line worker would use it to serve a customer or run the floor -> **ON** (mirror manager). If it's staff/payroll management, billing, integrations, role config, or any bulk delete -> **OFF**. |
| **staff** | An individual contributor (a service provider). Their own work items, checkout, contacts, basic comms. Defaults to OWN data (`can_view`/`can_edit`, not `*_all`). | ON only for daily work-delivery surfaces, usually own-scoped; OFF for management/config. |
| **viewer** | Read-only, minimal. Explicitly gets nothing in most notification/visibility gates. | OFF for almost everything; at most read-only on a narrow surface. |

**The front_desk rule of thumb when adding a page:** ask "would a front-line worker serving a customer need this?" The core transactional flows, payments, contacts, the catalog they sell from -> **yes, give front_desk access** (match manager). Anything in the back office (managing staff/payroll, editing role permissions, billing/subscription, wiring integrations, or bulk-deleting records) -> **no**. front_desk is location-scoped (NOT in the owner/super_admin location bypass), so it only ever sees its assigned locations.

> **A new role is NOT free.** Role NAMES get hardcoded in a handful of places that a new role silently breaks: RLS write-policy allowlists (a policy that says `... AND r.name IN ('owner','admin','manager')`), the privilege-ladder function and its client-side mirror (e.g. a `roleUtils.ts` ordering), triggers that notify or gate by role (e.g. a negative-stock notification trigger), the notification role catalog (a config like `notificationTypeRoles.ts` and any server-side mirror of it), and raw `{role.name}` UI renders (which should go through a `formatRoleName()` helper). When you add a role, grep for every place a role name is hardcoded before assuming it "just works":
> - Policies: `SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy;` then look for `r.name` / `ILIKE '%manager%'`.
> - Functions: `SELECT proname FROM pg_proc WHERE prosrc ~ '''(manager|staff|admin)'''`.
> - App code: grep the role names, plus `RoleName`, `ROLE_ORDER`, `MANAGER_AND_UP`, and any privilege-ladder constant, across the frontend and every server.

### Layer 3 (Location) - there is ONE rule: location membership

⛔ **Location access is membership (an assignment set). Full stop. It is NOT a role property, and role is
NEVER the question.** The ONLY question for "can this person access location X" is: *is X in the caller's
location assignment set* (in this reference implementation, `get_user_location_ids()`, backed by a
`user_locations` table), which is exactly "who is assigned to that location on the user page." When you
gate anything on location access (a query, an RLS policy, a feature toggle, a UI element), gate on **the
assignment set** (`get_user_location_ids()` in the DB, or the RLS-scoped location list in the client),
**never on the role**.

**Why `is_owner_or_super_admin()` appears in the policies, and why it does NOT create a second model:**
owners/super_admins should be **auto-assigned to EVERY location** by a trigger (illustrative name
`trg_auto_assign_owners_to_location`). So `get_user_location_ids()` **already returns all locations for
them**. The `is_owner_or_super_admin() OR ...` clause is therefore a pure **redundant safety net** (if the
auto-assignment somehow failed, the role bypass still lets them in). It changes NO answer that membership
doesn't already give. Reading that `OR` as "owners are a special access path, everyone else is the normal
path" is the classic mistake: it makes you gate features on the ROLE (`isOwnerOrSuperAdmin || ...`), which
then WRONGLY excludes an admin/manager who legitimately has multi-location access, and duplicates the DB's
location logic in the client where it drifts. It also "tests fine" because the owner (who tests it) always
passes, so the bug ships silently.

| Who | How their location access is decided | Note |
|-----|--------------------------------------|------|
| **Everyone** (owner, super_admin, admin, manager, front_desk, staff, viewer) | Membership assignment set (`get_user_location_ids()`) = who's assigned on the user page | This is the ONLY model. |
| Owner / super_admin | Same, BUT auto-assigned to ALL locations, so they can never *lose* a location | The role bypass in RLS is redundant belt-and-suspenders, not a separate rule. |

**CRITICAL:** Never write `if (isOwnerOrSuperAdmin || userHasLocation)` in app code, and never think
"owner sees all, others see their assigned." Think "does the assignment set include this location / have
more than one?" That one check is correct for **every** role, including owner.

---

## Identity Model - details

Identity in this system has two layers. Understand both before writing identity logic.

| Layer | Stable across | Used for |
|-------|---------------|----------|
| `auth.users.id` (== `public.users.id`) | Forever (1:1 invariant) | RLS, SECDEF helpers, all server-side identity |
| `public.users.email` | Until user changes it | Contact destination, login, password-reset (with picker when N accounts share the email) |

### The 1:1 invariant

Every `auth.users` row has a corresponding `public.users` row with the same `id`. A new-auth-user trigger (illustrative name `handle_new_auth_user`) enforces this on user creation. RLS policies and SECDEF helpers depend on it: if a user has an `auth.users.id` but no `public.users.id` match, they sign in but RLS denies everything.

### One human, multiple companies - handled by separate accounts + a picker

The single-tenant-per-user design: **every `users.id` belongs to exactly one company.** When the same human (or two different humans) need accounts at multiple companies under the same email, they have **separate `users.id` rows**, one per company, each with its own auth row, password, and profile. A "Switch Account" UX (powered by an accounts-list endpoint and a switch-account endpoint) lets one human swap session between their accounts without retyping the password.

Login disambiguation when an email maps to multiple `users.id` rows uses pickers (in your auth screens plus your auth endpoints):

- **Email + password:** the server tries each candidate's password; the matching one wins. If 2+ accept the same password (rare), the server returns the picker.
- **OTP login (picker-first):** the server counts users at the email. **1 ->** sends the code to that user's auth email; **N>1 ->** returns `{ kind: 'pick', candidates }` BEFORE sending. The frontend renders a company-then-user picker; on user pick, it re-calls the OTP-request endpoint with the chosen `target_user_id` and the code is sent to that one auth row only. Verify returns the session.
- **Forgot password:** same pattern, picker first, then reset link sent to the picked user's auth email only.

For the second account at a shared email, `auth.users.email` holds a synthetic placeholder string your signup flow assigns (Supabase's auth.users.email unique constraint forces this). `public.users.email` holds the real human-facing email for both accounts. A custom-email hook resolves outbound auth mail by looking up `public.users.email` via `auth.user.id`; never trust `auth.email()` as a recipient.

### `public.users` SELECT policy

`public.users` can have a single SELECT policy: self + same-company colleagues. Single-tenant-per-user makes this trivial because every user has exactly one `company_id`:

```sql
CREATE POLICY users_select_company ON public.users FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR company_id = public.get_my_company_id()
    OR public.auth_shares_company_with(id)
  );
```

`auth_shares_company_with(target_user_id)` is a `SECURITY DEFINER` helper that compares `users.company_id` for caller vs target. Under the single-tenant design this is identical in result to `company_id = get_my_company_id()`, but the SECDEF wrapper is kept as a safety net for any future refactor that introduces additional sharing rules.

### Blocking a user

`is_blocked` lives on `public.users` (single flag per `users.id`). Blocking only affects that specific account; other accounts at the same email (different `users.id` rows in different companies) are unaffected.

When `users.is_blocked = true`:
- The Layer-1 check in every RLS policy denies the row.
- Your session context (frontend) detects `is_blocked` on session load, signs the user out, and bounces them to a blocked screen.
- The auth screens render a clear blocked message with support contact info.
- Every auth endpoint (select-user, switch-account, otp/verify, signin) rejects blocked targets with the same message.

To remove someone from a company under the single-tenant design, **delete their `users.id`** (the admin's Users tab). That removes them from this company; their accounts elsewhere (under the same email but different `users.id`) are untouched.

---

## Location Auto-Assignment (Database Triggers)

Two triggers can live on the `locations` table:

| Trigger | What it does |
|---------|--------------|
| `trg_auto_assign_location_creator` | Adds the user who creates a location to the location assignment set |
| `trg_auto_assign_owners_to_location` | Adds ALL owners/super_admins in that company to the assignment set |

**Two layers of security:**
1. **RLS bypass:** `is_owner_or_super_admin()` lets owners/super_admins through.
2. **Auto-assignment:** they're also in the assignment set for all locations.

If one fails, the other still works.

---

## Permission Types (5 Toggles in UI)

The `role_permissions` table can have these columns:

| Permission | Meaning | When to Use |
|------------|---------|-------------|
| `can_view` | Can see this data type | Basic read access |
| `can_view_all` | Can see ALL records (vs only own) | Managers see all bookings |
| `can_edit` | Can create and modify records | Normal data entry |
| `can_edit_all` | Can modify ALL records (vs only own) | Managers edit anyone's records, OR an elevated "do it for everyone" action |
| `can_delete_bulk` | Can bulk-delete records | Only shown in UI for resources that support bulk delete |

### Special Case: elevated "for everyone" edits

`can_edit_all` on a resource can double as an elevated switch. Example: a `schedule_override_table` where `can_edit_all` controls a **"Force Close For Everyone"** power:
- `can_edit_all = true` -> can create location-wide overrides (closes for everyone).
- `can_edit = true` only -> can only create overrides for their own schedule.

---

## Table Categories (By Scope)

| Category | Has location_id? | Has owner column? | Example Tables |
|----------|------------------|-------------------|----------------|
| **A: Company-Only** | No | No | `roles`, `company_settings` |
| **B: Location-Scoped** | Yes | No | `product_inventory`, `purchase_orders`, `chat_messages` |
| **C: User-Owned** | Maybe | `user_id` | `saved_reports`, `commissions` |
| **D: Provider-Assigned** | Yes | `technician_id` (a per-provider owner column) | `bookings`, `schedule_override` |

(The example tables and column names above are illustrative. Category D uses whatever per-provider owner column your schema has; this reference calls it `technician_id`.)

---

## Category B Deep Dive: Location-Scoped Tables

### IMPORTANT: User Locations vs Provider Locations

There can be TWO different location assignment systems. Do NOT confuse them:

| System | Table (e.g.) | Purpose | Used For |
|--------|-------|---------|----------|
| **User Locations** (SECURITY) | `user_locations` | Which locations a USER can ACCESS | RLS policies, data filtering |
| **Provider Locations** (OPERATIONAL) | `technician_locations` | Which locations a PROVIDER can WORK at | Booking UI, availability |

```
SECURITY (controls data access):
users <------> user_locations <------> locations
        (who can SEE data for which locations)

OPERATIONAL (controls booking availability):
providers <------> technician_locations <------> locations
             (who can WORK at which locations)
```

**Example:** a manager (user) might have access to view data for ALL locations (user_locations), but they are NOT a service provider and don't appear in the operational provider-locations table at all.

**Example:** a provider might only be assigned to work at Location A (provider-locations), but as a user, they might have access to view reports for Locations A, B, and C (user_locations).

### Helper Functions for Location-Based RLS (names illustrative)

| Function | Returns | Description |
|----------|---------|-------------|
| `get_user_location_ids()` | `UUID[]` | Location IDs from the user's location assignment set |
| `get_my_company_id()` | `UUID` | Current user's company ID |
| `is_owner_or_super_admin()` | `BOOLEAN` | True if user is owner or super_admin only |

**How location access works (the ONE rule, see Layer 3 above):**
- `get_user_location_ids()` returns the user's assigned locations = who's assigned on the user page. This is the ONLY thing that decides location access, for EVERY role.
- Owners/super_admins are auto-assigned to ALL locations, so they get all locations, not via a special role rule, but because they're assigned to all of them.
- Admins/managers/etc. get exactly the locations they're explicitly assigned to.
- No bypass logic is needed in RLS; the auto-assignment handles it. ⛔ Gate on `get_user_location_ids()` (the assignment set), NEVER on `is_owner_or_super_admin()` (that's a redundant safety net, not the access model).

### Category B Policy Pattern

For tables with a `location_id` column:

```sql
-- The standard pattern for location-scoped access (includes blocked check)
NOT EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid()
  AND u.is_blocked = true
)
AND company_id = get_my_company_id()
AND (is_owner_or_super_admin() OR location_id = ANY(get_user_location_ids()))
```

**What this means:**
- **First:** blocked users are denied access immediately (Layer 1).
- Owners/super_admins bypass the location check via the explicit clause.
- Everyone else is filtered by their location assignment set.
- Admins only see their assigned locations (they are NOT owners/super_admins).

**Why both checks?**
1. `is_owner_or_super_admin()` is an explicit bypass for owners/super_admins.
2. `location_id = ANY(get_user_location_ids())` means the auto-assignment also gives them access.
3. Having both is a safety net: if one fails, the other still works.

### Category B: Full Policy Template

```sql
-- SELECT: Company + Location check (with owner/super_admin bypass)
CREATE POLICY "select_location_scoped" ON table_name
  FOR SELECT TO authenticated
  USING (
    -- Layer 1: Check if user is blocked
    NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.is_blocked = true
    )
    -- Layer 2-4: Company and location checks
    AND company_id = get_my_company_id()
    AND (is_owner_or_super_admin() OR location_id = ANY(get_user_location_ids()))
  );

-- INSERT: Company + Location check (with owner/super_admin bypass)
CREATE POLICY "insert_location_scoped" ON table_name
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Layer 1: Check if user is blocked
    NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.is_blocked = true
    )
    -- Layer 2-4: Company and location checks
    AND company_id = get_my_company_id()
    AND (is_owner_or_super_admin() OR location_id = ANY(get_user_location_ids()))
  );

-- UPDATE: Company + Location check (with owner/super_admin bypass)
CREATE POLICY "update_location_scoped" ON table_name
  FOR UPDATE TO authenticated
  USING (
    -- Layer 1: Check if user is blocked
    NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.is_blocked = true
    )
    -- Layer 2-4: Company and location checks
    AND company_id = get_my_company_id()
    AND (is_owner_or_super_admin() OR location_id = ANY(get_user_location_ids()))
  )
  WITH CHECK (
    -- Layer 1: Check if user is blocked
    NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.is_blocked = true
    )
    -- Layer 2-4: Company and location checks
    AND company_id = get_my_company_id()
    AND (is_owner_or_super_admin() OR location_id = ANY(get_user_location_ids()))
  );

-- DELETE: Company + Location check (with owner/super_admin bypass)
CREATE POLICY "delete_location_scoped" ON table_name
  FOR DELETE TO authenticated
  USING (
    -- Layer 1: Check if user is blocked
    NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.is_blocked = true
    )
    -- Layer 2-4: Company and location checks
    AND company_id = get_my_company_id()
    AND (is_owner_or_super_admin() OR location_id = ANY(get_user_location_ids()))
  );
```

### Handling NULL location_id

Some tables have rows where `location_id` can be NULL (e.g., company-wide records). Handle this:

```sql
-- If NULL location_id should be visible to everyone in the company:
-- Layer 1: Check if user is blocked
NOT EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid()
  AND u.is_blocked = true
)
-- Layer 2-4: Company and location checks (including NULL)
AND company_id = get_my_company_id()
AND (
  is_owner_or_super_admin()
  OR location_id IS NULL  -- Company-wide records visible to all
  OR location_id = ANY(get_user_location_ids())
)
```

### Illustrative Examples

**product_inventory** (strict location filtering):
```sql
CREATE POLICY "select_inventory_location" ON public.product_inventory
  FOR SELECT TO authenticated
  USING (
    -- Layer 1: Check if user is blocked
    NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.is_blocked = true
    )
    -- Layer 2-4: Company and location checks
    AND company_id = get_my_company_id()
    AND (is_owner_or_super_admin() OR location_id = ANY(get_user_location_ids()))
  );
```

**contacts_billing_invoices** (allows NULL for company-wide):
```sql
CREATE POLICY select_contacts_billing_invoices_location_based ON contacts_billing_invoices
  FOR SELECT TO authenticated
  USING (
    -- Layer 1: Check if user is blocked
    NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.is_blocked = true
    )
    -- Layer 2-4: Company and location checks
    AND company_id = get_my_company_id()
    AND (
      is_owner_or_super_admin()
      OR location_id IS NULL  -- Company-wide invoices visible to all
      OR location_id = ANY(get_user_location_ids())
    )
  );
```

**stock_transfers** (checking BOTH from and to locations):
```sql
CREATE POLICY "select_transfers_location" ON public.stock_transfers
  FOR SELECT TO authenticated
  USING (
    -- Layer 1: Check if user is blocked
    NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.is_blocked = true
    )
    -- Layer 2-4: Company and location checks
    AND company_id = get_my_company_id()
    AND (
      is_owner_or_super_admin()
      OR from_location_id = ANY(get_user_location_ids())
      OR to_location_id = ANY(get_user_location_ids())
    )
  );
```

---

## Table Write Behaviors

| Write Type | INSERT requires | UPDATE requires | DELETE | Examples |
|------------|-----------------|-----------------|--------|----------|
| **Standard** | `can_edit` | `can_edit` | `can_delete` | contacts, bookings, services |
| **Append-Only** | `can_view` | Blocked | Blocked | payments, time_clock, audit_logs |
| **Controlled** | Function only | Function only | Function only | balances, commissions |

---

## Complete Workflow: Auditing a Table for RLS

Use this checklist when ensuring a table has proper RLS:

### Phase 1: Discovery

```bash
# 1. Find all usages in the codebase
rg "from\(['\"]table_name" src/
rg "\.table_name" src/
rg "supabase.*table_name" src/

# 2. Check if the table has RLS enabled (inspect your schema dump)
```

### Phase 2: Determine Requirements

Answer these questions:
1. [ ] What category? (A=Company, B=Location, C=User-owned, D=Provider-assigned)
2. [ ] What write behavior? (Standard, Append-Only, Controlled)
3. [ ] Does it have an `is_deleted` column? (needs soft-delete trigger)
4. [ ] What resource name? (`<entity>_table`)
5. [ ] Who should have access? (Map roles to permissions)
6. [ ] **Does every policy include the `is_blocked` check as the first layer?** (CRITICAL: blocked users must be denied all access)

### Phase 3: Check if the Resource Exists

```bash
# Check if the resource is in the new-company seeding function
rg "create_permissions_for_new_company" supabase/migrations/ -A 30

# Check if the resource is in the frontend config
rg "resource_name" src/config/rolePermissions.ts
rg "resource_name" default_role_permissions.json
```

### Phase 4: Create/Fix Everything

If the resource is MISSING from any place:

1. **Create a migration to backfill existing companies:**
```sql
-- Backfill from a similar resource
INSERT INTO public.role_permissions (role_id, company_id, resource, can_view, can_edit, can_view_all, can_edit_all, can_delete_bulk)
SELECT
  rp.role_id,
  rp.company_id,
  'new_resource_table' as resource,
  rp.can_view,
  rp.can_edit,
  rp.can_view_all,
  rp.can_edit_all,
  false as can_delete_bulk
FROM public.role_permissions rp
WHERE rp.resource = 'similar_existing_resource_table'
AND NOT EXISTS (
  SELECT 1 FROM public.role_permissions existing
  WHERE existing.role_id = rp.role_id
    AND existing.company_id = rp.company_id
    AND existing.resource = 'new_resource_table'
);
```

2. **Update the new-company seeding function** (in the same migration).

3. **Update the frontend permission defaults** (add to ALL roles).

4. **Update the UI resource list** (add to the RESOURCES array).

### Phase 5: Test

1. [ ] Create a test company (triggers the seeding function).
2. [ ] Verify all roles have the new permission.
3. [ ] Test each operation (SELECT, INSERT, UPDATE, DELETE).
4. [ ] Verify existing companies got backfilled.

---

## Policy Templates

### Category A: Company-Only Tables (Standard Write)

```sql
-- SELECT
CREATE POLICY "select" ON table_name FOR SELECT TO authenticated
USING (
  -- Layer 1: Check if user is blocked
  NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.is_blocked = true
  )
  -- Layer 2-5: Company and permission checks
  AND company_id = get_my_company_id()
  AND EXISTS (
    SELECT 1 FROM users u
    JOIN role_permissions rp ON rp.role_id = u.role_id
    WHERE u.id = auth.uid()
    AND rp.company_id = u.company_id
    AND rp.resource = 'resource_table'
    AND (rp.can_view = true OR rp.can_view_all = true)
  )
);

-- INSERT
CREATE POLICY "insert" ON table_name FOR INSERT TO authenticated
WITH CHECK (
  -- Layer 1: Check if user is blocked
  NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.is_blocked = true
  )
  -- Layer 2-5: Company and permission checks
  AND company_id = get_my_company_id()
  AND EXISTS (
    SELECT 1 FROM users u
    JOIN role_permissions rp ON rp.role_id = u.role_id
    WHERE u.id = auth.uid()
    AND rp.company_id = u.company_id
    AND rp.resource = 'resource_table'
    AND (rp.can_edit = true OR rp.can_edit_all = true)
  )
);

-- UPDATE
CREATE POLICY "update" ON table_name FOR UPDATE TO authenticated
USING (
  -- Layer 1: Check if user is blocked
  NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.is_blocked = true
  )
  -- Layer 2-5: Company and permission checks
  AND company_id = get_my_company_id()
  AND EXISTS (
    SELECT 1 FROM users u
    JOIN role_permissions rp ON rp.role_id = u.role_id
    WHERE u.id = auth.uid()
    AND rp.company_id = u.company_id
    AND rp.resource = 'resource_table'
    AND (rp.can_edit = true OR rp.can_edit_all = true)
  )
);

-- DELETE
CREATE POLICY "delete" ON table_name FOR DELETE TO authenticated
USING (
  -- Layer 1: Check if user is blocked
  NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.is_blocked = true
  )
  -- Layer 2-5: Company and permission checks
  AND company_id = get_my_company_id()
  AND EXISTS (
    SELECT 1 FROM users u
    JOIN role_permissions rp ON rp.role_id = u.role_id
    WHERE u.id = auth.uid()
    AND rp.company_id = u.company_id
    AND rp.resource = 'resource_table'
    AND rp.can_edit_all = true
  )
);
```

### Category D: Provider-Assigned (Own vs All)

```sql
-- SELECT (provider sees own, managers see all)
CREATE POLICY "select" ON table_name FOR SELECT TO authenticated
USING (
  -- Layer 1: Check if user is blocked
  NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.is_blocked = true
  )
  -- Layer 2-6: Company, permission, and ownership checks
  AND company_id = get_my_company_id()
  AND (
    -- Has can_view_all = sees everything
    EXISTS (
      SELECT 1 FROM users u
      JOIN role_permissions rp ON rp.role_id = u.role_id
      WHERE u.id = auth.uid()
      AND rp.resource = 'resource_table'
      AND rp.can_view_all = true
    )
    OR
    -- Has can_view only = sees own records
    (
      EXISTS (
        SELECT 1 FROM users u
        JOIN role_permissions rp ON rp.role_id = u.role_id
        WHERE u.id = auth.uid()
        AND rp.resource = 'resource_table'
        AND rp.can_view = true
      )
      -- Identify the caller's provider row via a shared helper. Do NOT inline
      -- (SELECT id FROM technicians WHERE user_id = auth.uid() LIMIT 1): that bare
      -- LIMIT 1 has no ORDER BY / was_deleted filter, so a soft-deleted row can win
      -- and lock the user out of their own data. A helper like get_my_technician_id()
      -- orders by was_deleted so the active row wins; the scalar-subquery wrapper lets
      -- the planner hoist it (per-row eval -> once).
      AND technician_id = (SELECT get_my_technician_id())
    )
  )
);
```

---

## Soft Delete Handling

Soft delete (`is_deleted = true`) is technically an UPDATE, but should respect DELETE permissions.

**Solution:** use a trigger guard:

```sql
CREATE OR REPLACE FUNCTION check_soft_delete_permission()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.is_deleted = false OR OLD.is_deleted IS NULL)
     AND NEW.is_deleted = true THEN
    -- Layer 1: Check if user is blocked
    IF EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.is_blocked = true
    ) THEN
      RAISE EXCEPTION 'Permission denied: user is blocked';
    END IF;
    -- Layer 5: Check delete permission
    IF NOT EXISTS (
      SELECT 1 FROM users u
      JOIN role_permissions rp ON rp.role_id = u.role_id
      WHERE u.id = auth.uid()
      AND rp.resource = TG_ARGV[0]
      AND rp.can_delete_bulk = true
    ) THEN
      RAISE EXCEPTION 'Permission denied: cannot delete %', TG_ARGV[0];
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to table
CREATE TRIGGER guard_soft_delete
BEFORE UPDATE ON table_name
FOR EACH ROW
EXECUTE FUNCTION check_soft_delete_permission('resource_table');
```

---

## Column-Level Write Restrictions

Sometimes a user can UPDATE a row but should NOT be allowed to change a specific column. RLS policies work at the ROW level, not the column level. For column-level restrictions, use a **trigger** combined with a **special permission resource**.

### When to Use This

Use column-level restrictions when:
- A table is accessible to multiple roles.
- One specific column controls elevated/admin-level behavior.
- Non-admins can read the column but should NOT be able to set it.
- Admins should be able to grant this permission to specific roles via the UI.

**Example:** a `schedule_override` table has an `admin_location_override` column:
- When `true`: the override affects EVERYONE at that location (admin-level power).
- When `false`: the override only affects the provider using location hours.

A provider can create schedule overrides for themselves, but only users with a "Global Schedule Overrides" permission should be able to set `admin_location_override = true`.

### Complete Workflow: Adding a Column-Level Permission

When adding a new column-level restriction, you must update **4 areas**:

#### Step 1: Create the Permission Resource (Frontend Config)

In your permission-resource config (e.g. `src/config/rolePermissions.ts`), add a special resource with `isColumnPermission: true`:

```typescript
{
  key: 'schedule_global_override',  // Resource key
  uiName: 'Global Schedule Overrides',
  description: 'Allow creating overrides that affect ALL providers at a location',
  category: 'configuration',
  isColumnPermission: true,  // This makes it show as a single ON/OFF toggle
  parentResource: 'schedule_override_table'  // Groups it under the parent visually
}
```

#### Step 2: Add Default Permissions (JSON Config)

In your permission defaults (e.g. `default_role_permissions.json`), add the resource to ALL roles:

```json
"schedule_global_override": {
  "can_view": true,
  "can_edit": true,   // TRUE = can set the column, FALSE = cannot
  "can_view_all": false,
  "can_edit_all": false,
  "can_delete_bulk": false
}
```

Only set `can_edit: true` for roles that should have this permission by default (usually owner, admin).

#### Step 3: Create the Database Trigger

The trigger checks `can_edit` on the column-permission resource:

```sql
-- Generic function for column-level permission checks
CREATE OR REPLACE FUNCTION guard_column_permission()
RETURNS TRIGGER AS $$
DECLARE
  column_name TEXT := TG_ARGV[0];
  permission_resource TEXT := TG_ARGV[1];
  old_value BOOLEAN;
  new_value BOOLEAN;
  has_permission BOOLEAN;
BEGIN
  -- Layer 1: Check if user is blocked
  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.is_blocked = true
  ) THEN
    RAISE EXCEPTION 'Permission denied: user is blocked';
  END IF;

  -- Get old and new values
  EXECUTE format('SELECT ($1).%I', column_name) INTO old_value USING OLD;
  EXECUTE format('SELECT ($1).%I', column_name) INTO new_value USING NEW;

  -- If trying to set the column to TRUE (and it wasn't already TRUE)
  IF new_value = true AND (old_value IS NULL OR old_value = false) THEN
    -- Layer 5: Check if user has can_edit on the permission resource
    SELECT EXISTS (
      SELECT 1 FROM users u
      JOIN role_permissions rp ON rp.role_id = u.role_id
      WHERE u.id = auth.uid()
      AND rp.company_id = u.company_id
      AND rp.resource = permission_resource
      AND rp.can_edit = true
    ) INTO has_permission;

    IF NOT has_permission THEN
      RAISE EXCEPTION 'Permission denied: you do not have permission to set %', column_name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- INSERT variant (no OLD value)
CREATE OR REPLACE FUNCTION guard_column_permission_insert()
RETURNS TRIGGER AS $$
DECLARE
  column_name TEXT := TG_ARGV[0];
  permission_resource TEXT := TG_ARGV[1];
  new_value BOOLEAN;
  has_permission BOOLEAN;
BEGIN
  -- Layer 1: Check if user is blocked
  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.is_blocked = true
  ) THEN
    RAISE EXCEPTION 'Permission denied: user is blocked';
  END IF;

  EXECUTE format('SELECT ($1).%I', column_name) INTO new_value USING NEW;

  IF new_value = true THEN
    -- Layer 5: Check permission
    SELECT EXISTS (
      SELECT 1 FROM users u
      JOIN role_permissions rp ON rp.role_id = u.role_id
      WHERE u.id = auth.uid()
      AND rp.company_id = u.company_id
      AND rp.resource = permission_resource
      AND rp.can_edit = true
    ) INTO has_permission;

    IF NOT has_permission THEN
      RAISE EXCEPTION 'Permission denied: you do not have permission to set %', column_name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### Step 4: Apply Triggers to the Table

```sql
-- Guard UPDATE
CREATE TRIGGER guard_admin_location_override
BEFORE UPDATE ON schedule_override
FOR EACH ROW
EXECUTE FUNCTION guard_column_permission('admin_location_override', 'schedule_global_override');

-- Guard INSERT
CREATE TRIGGER guard_admin_location_override_insert
BEFORE INSERT ON schedule_override
FOR EACH ROW
EXECUTE FUNCTION guard_column_permission_insert('admin_location_override', 'schedule_global_override');
```

#### Step 5: Create Backfill Migration

Backfill the new resource for existing companies:

```sql
INSERT INTO public.role_permissions (role_id, company_id, resource, can_view, can_edit, can_view_all, can_edit_all, can_delete_bulk)
SELECT
  rp.role_id,
  rp.company_id,
  'schedule_global_override' as resource,
  true as can_view,
  CASE
    WHEN r.name IN ('owner', 'admin') THEN true
    ELSE false
  END as can_edit,
  false as can_view_all,
  false as can_edit_all,
  false as can_delete_bulk
FROM public.role_permissions rp
JOIN public.roles r ON r.id = rp.role_id
WHERE rp.resource = 'schedule_override_table'
AND NOT EXISTS (
  SELECT 1 FROM public.role_permissions existing
  WHERE existing.role_id = rp.role_id
    AND existing.company_id = rp.company_id
    AND existing.resource = 'schedule_global_override'
);
```

### How It Appears in the UI

Column-level permissions appear as a special section under their parent resource:

```
+---------------------------------------------------------+
| Date Exceptions                              [?]        |
+---------------------------------------------------------+
| View Own [toggle]  View All [toggle]  Edit Own [toggle] |
| Edit All [toggle]                                       |
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
| Special Permissions                                     |
| +-----------------------------------------------------+ |
| | Global Schedule Overrides [?]            [toggle]   | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```

The toggle is styled differently (amber background) to indicate it's a special permission.

### Important Notes

1. **Triggers are table-specific.** Only apply them to tables that need column-level restrictions.
2. **READ is not restricted.** Everyone can see the column value; only WRITE is restricted.
3. **Permission is role-based.** Admins can grant this permission to any role via the UI.
4. **Always guard both INSERT and UPDATE.** Users shouldn't set it on new rows either.
5. **The trigger checks `role_permissions`,** not hardcoded roles, so it respects UI changes.

---

## Page Access (Frontend - Separate System)

Page visibility is a SEPARATE system from data RLS. It is controlled by a `role_page_access` table and enforced in frontend code, NOT by RLS. Data RLS decides what rows the database returns; page access decides what the app lets a user navigate to. Both must be configured for a feature to work end to end.

### Key Files (names illustrative)

| File (generic) | Purpose |
|------|---------|
| Page defaults JSON (e.g. `default_page_access.json`) | Source of truth for all page keys |
| Page config (e.g. `src/config/pageAccess.ts`) | Definitions and helpers |
| Page-access manager UI (e.g. `PageAccessManager.tsx`) | UI for managing page access |
| Page-access hook (e.g. `usePageAccess`) | Hook to check page access |
| Migration | Database table and its seeding function |

### Page Key Naming Convention

- Main pages: `page:<name>` (e.g., `page:schedule`)
- Tabs: `tab:<parent>_<name>` (e.g., `tab:setup_company`)
- Sub-tabs: `tab:<parent>_<section>_<name>` (e.g., `tab:setup_settings_booking`)

### Adding a New Page/Tab

1. Add to the page defaults JSON with defaults for all roles.
2. Add to the page config PAGE_KEYS array.
3. Add to the page-access manager UI categories.
4. Update the SQL page-access seeding function.
5. Create a migration to backfill existing companies.
6. Add a visibility check in the component:
```typescript
const { hasAccess } = usePageAccess();
if (!hasAccess('page:my_page')) return null;
```

### ⚠️ CRITICAL: The Multi-File Consistency Rule

**ALL page-access changes MUST update the same set of places together.** In this reference implementation that is 4 places:

| Place (generic) | What to Update |
|------|----------------|
| Page defaults JSON | Add/remove the key with role defaults |
| Page config array | Add/remove from the PAGE_KEYS array |
| Page-access manager UI | Add/remove from the page categories |
| SQL seeding function in a migration | Add/remove from its page-keys array |

**NEVER:**
- Update one place without updating the others.
- Remove a key from the UI files but leave it in the config files (or vice versa).
- Assume a rename migration was already executed.
- Trust code comments about page structure without verifying.

**ALWAYS:**
- Verify current state in ALL of these places before making changes.
- Include a backfill INSERT for existing companies in migrations.
- Ask for clarification if unsure about the page hierarchy.

**If you remove a key from one place but not the others, the permission toggle will either:**
- Not appear in the Role Permissions UI (users can't control it), or
- Appear in the UI but not work (key missing from the database).

---

## Relationship Between Page Access and Data Access

A user might have:
- **Page access but no data** -> the page shows but is empty.
- **Data access but no page** -> they can query the API but can't navigate to the page.

**Both systems must be configured correctly.**

Example: a manager wants to see the Schedule page.
1. `role_page_access`: `page:schedule` = `true` -> they can see the page.
2. `role_permissions`: `booking_table.can_view_all = true` -> they see all bookings.

---

## CRITICAL: SECURITY DEFINER Function ACLs

> **READ THIS BEFORE WRITING ANY MIGRATION THAT CREATES OR REPLACES A `SECURITY DEFINER` FUNCTION.** Postgres's default makes "safe" require explicit work, and it is easy to ship SECDEF functions with cross-tenant exposure because a migration didn't apply this. Every new SECDEF function MUST be locked down.

### The trap

When you write `CREATE OR REPLACE FUNCTION public.my_fn(...) ... SECURITY DEFINER ...`, Postgres automatically grants `EXECUTE` to `PUBLIC`, which inherits to `anon` and `authenticated`. That means anyone with the project's anon API key can `POST /rest/v1/rpc/my_fn` with arbitrary parameters and the function will run **with the privileges of its owner** (typically `postgres`, bypassing every RLS policy).

For a function like `seed_<thing>_for_company(p_company_id uuid)`, this is a cross-tenant IDOR: the attacker passes a victim company's UUID, the SECDEF function runs as superuser, and the victim's data gets written. This class of bug is real and has shipped in seeding functions that took a caller-supplied company id.

### The mandatory pattern

Every SECDEF function in a new migration MUST be followed by ACL statements. Three patterns:

**Pattern A - Trigger-only function** (invoked only by the trigger mechanism, never called directly via PostgREST):

```sql
CREATE OR REPLACE FUNCTION public.my_trigger_fn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN /* ... */ RETURN NEW; END; $$;

REVOKE EXECUTE ON FUNCTION public.my_trigger_fn() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_trigger_fn() FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_trigger_fn() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.my_trigger_fn() TO service_role;
```

Triggers don't need `EXECUTE` for the trigger mechanism to invoke them; Postgres bypasses ACLs for trigger invocation. REVOKE is pure defense-in-depth.

**Pattern B - Client-callable RPC** (the frontend or a server invokes it via `supabase.rpc('my_fn', ...)`):

```sql
CREATE OR REPLACE FUNCTION public.my_rpc(...) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  -- MANDATORY in-body auth check.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_caller AND is_blocked = true) THEN
    RAISE EXCEPTION 'blocked';
  END IF;
  -- For functions that take a caller-supplied company_id, verify it matches.
  -- Use get_my_company_id() instead, or check users.company_id explicitly.
  -- /* ... function body ... */
END; $$;

REVOKE EXECUTE ON FUNCTION public.my_rpc(...) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_rpc(...) FROM anon;
GRANT  EXECUTE ON FUNCTION public.my_rpc(...) TO authenticated;
```

The in-body check is non-negotiable. RLS policies on tables the function reads/writes are BYPASSED because the function runs as the owner. The caller check is the ONLY defense against an authenticated user spoofing a victim's company UUID.

**Pattern C - Admin-only function** (only a trusted backend / superadmin service should call it):

```sql
REVOKE EXECUTE ON FUNCTION public.my_admin_fn(...) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_admin_fn(...) FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_admin_fn(...) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.my_admin_fn(...) TO service_role;
```

Only the `service_role` key (held by a trusted backend) can call it. No client path works.

### Decision rule

| What kind of function? | Pattern |
|---|---|
| `RETURNS trigger`, invoked by `CREATE TRIGGER ... EXECUTE FUNCTION my_fn()` | A (trigger-only) |
| Called from the frontend via `supabase.rpc(...)` or from an Edge Function with the anon key | B (client-callable) |
| Called only from a trusted backend / superadmin service / cron with the service_role key | C (admin-only) |
| Called by another SECDEF function via `PERFORM` / `SELECT`, but never directly via PostgREST | A or C (no client path exists, so a service_role grant is enough) |

If you genuinely don't know which pattern applies, **default to Pattern C** (admin-only, no client EXECUTE) and only loosen if you actually need a client path. The default-deny posture is safer than the default-open one Postgres ships with.

### In-body caller checks (when caller-supplied parameters could specify a victim's identity)

If the function takes ANY parameter that could specify a target (`p_company_id`, `p_user_id`, `p_location_id`, `p_contact_id`, `p_order_id`, etc.) the function MUST verify the caller has access to that target. The minimum check:

```sql
-- Block null callers, block blocked users.
IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
IF EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_blocked = true) THEN
  RAISE EXCEPTION 'blocked';
END IF;

-- Caller's company must match the target.
IF NOT EXISTS (
  SELECT 1 FROM public.users WHERE id = auth.uid() AND company_id = p_company_id
) THEN
  RAISE EXCEPTION 'unauthorized: cross-tenant access attempt';
END IF;
```

For functions whose target identity is derived (e.g., `p_user_id` must belong to the caller's company), join through `public.users.company_id` and compare against `get_my_company_id()`.

**Trigger functions are exempt from the parameter check** because they don't take user-supplied parameters; `NEW.company_id` comes from a row that RLS already gated.

**Service-role-only functions are exempt** because there's no client path; the caller is trusted.

### Checklist for every new SECDEF function in a migration

Before committing the migration:

- [ ] Function has `SET search_path TO 'public'` (or a specific schema), which prevents search-path attacks.
- [ ] If `RETURNS trigger`: Pattern A applied (REVOKE all, GRANT service_role).
- [ ] If client-callable: Pattern B applied (REVOKE PUBLIC + anon, GRANT authenticated) AND an in-body auth check exists.
- [ ] If admin-only: Pattern C applied (REVOKE PUBLIC + anon + authenticated, GRANT service_role).
- [ ] If the function takes any UUID/email/identity parameter: an in-body check that the parameter belongs to the caller's company.
- [ ] Verify with `SELECT (aclexplode(proacl)).grantee::regrole FROM pg_proc WHERE proname='my_fn';` after applying; it should show only postgres + service_role (and authenticated if Pattern B).

Consider a pre-commit or pre-tool hook that rejects any migration which creates a SECDEF function without an accompanying `REVOKE EXECUTE ... FROM PUBLIC` for the same function name. That's the automated safety net; the checklist above is the human one.

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Fix |
|---------|---------------|-----|
| **Shipping a `SECURITY DEFINER` function without REVOKE EXECUTE on it** | Postgres default grants EXECUTE to PUBLIC, so anyone with the anon API key can RPC-call it bypassing RLS | **Every SECDEF function MUST include REVOKE EXECUTE FROM PUBLIC / anon / authenticated, plus GRANT to the intended caller class.** See "CRITICAL: SECURITY DEFINER Function ACLs" above. |
| **SECDEF function takes a `p_company_id` (or similar) parameter without an in-body caller check** | RLS is bypassed inside a SECDEF function; the parameter is the only thing identifying the target. The caller can spoof any company. | Add `IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND company_id = p_company_id) THEN RAISE EXCEPTION 'unauthorized'; END IF;` near the top of the function body. |
| **Forgetting the `is_blocked` check in RLS policies** | Blocked users can still access data | **ALWAYS add the `is_blocked` check as the FIRST layer in every policy.** |
| Creating RLS but not adding the resource to config | Users get blocked because permission rows don't exist | Always update every place the resource must be registered |
| Using the same policy for SELECT and UPDATE | Different permission checks are needed | Create separate policies |
| Treating all tables as "standard" | Some are append-only or controlled | Check the write behavior first |
| Using `can_edit` for INSERT on append-only tables | Should use `can_view` | Check the table category |
| Forgetting to handle NULL location_id | Breaks for records without a location | Add `location_id IS NULL OR` |
| Hardcoding role names | Breaks for custom roles | Use `role_permissions` checks |
| Owner/super_admin not in the location assignment set | They can't access locations | Ensure the auto-assignment triggers exist |
| Forgetting GRANT before RLS | RLS policies never evaluate | Check table grants first |
| Not adding a soft-delete trigger | Users can soft-delete without permission | Add the trigger guard |
| Not updating the new-company seeding function | New companies don't get permissions | Update the function in the migration |
| Only backfilling for some roles | Missing permissions for other roles | Backfill for ALL existing role+company combos |
| Confusing the user-location table with the provider-location table | Different purposes: security vs operational | User-locations = who can SEE data; provider-locations = who can WORK |
| Using the provider-location table for RLS policies | Wrong table; that's for booking availability | Use the user-location assignment set (`get_user_location_ids()`) |
| Not adding a column-level trigger for admin-only columns | Non-admins can set admin-level flags | Add a `guard_admin_only_column` trigger |

---

## Quick Debugging: 403 on a Table

When you get a 403 error:

1. **Check table grants first** (most common issue):
```sql
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_name = 'your_table' AND table_schema = 'public';
```
If `authenticated` is missing, run:
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table TO authenticated;
```

2. **Check if the permission row exists**:
```sql
SELECT * FROM role_permissions
WHERE resource = 'your_table_table'
AND company_id = 'user-company-id'
AND role_id = 'user-role-id';
```
If no row exists, the resource was never added to the seeding function or backfilled.

3. **Check the RLS policy logic**:
```sql
SELECT policyname, cmd, qual as using_clause
FROM pg_policies WHERE tablename = 'your_table';
```

---

## Files Summary (names illustrative)

When doing ANY permission work, these places may need updates. Grep this repo for their real names first.

| Place | When to Update |
|------|----------------|
| Migrations | New resource, backfill, function update, or trigger |
| Permission defaults JSON | New resource defaults |
| Permission-resource config | Resource shows in UI |
| Role-management UI | Bulk-delete resources list |
| Page defaults JSON | New page/tab visibility |
| Page config | New page/tab definition |
| Page-access manager UI | New page category in UI |
| Page-access seeding migration | Page-access function update |

## Helper Functions Reference (names illustrative)

Build the equivalents of this helper set in your stack; the names below read clearly and are used throughout this doc.

| Function | Returns | Purpose |
|----------|---------|---------|
| `get_my_company_id()` | `UUID` | Current user's company ID |
| `get_my_technician_id()` | `UUID` | Caller's provider id, active row preferred (`ORDER BY was_deleted`). Use in own-scoped policies instead of inlining a `LIMIT 1` sub-select. |
| `get_user_location_ids()` | `UUID[]` | Location IDs from the user's location assignment set |
| `is_owner_or_super_admin()` | `BOOLEAN` | True if the user is owner or super_admin |
| `auth.uid()` | `UUID` | Current user's ID from the JWT (matches `users.id`) |

### How `get_user_location_ids()` Works

```sql
-- Returns location IDs from the user's location assignment set for the current user
-- No bypass logic - owners/super_admins are auto-assigned to all locations
RETURN location IDs from user_locations WHERE user_id = current_user
```

**Note:** since owners and super_admins are automatically assigned to ALL locations (via triggers), they get all location IDs. Admins only get locations they're explicitly assigned to.

---

## Storage Bucket Policies (DIFFERENT from Table RLS)

**CRITICAL:** storage bucket policies are NOT the same as table RLS policies. They live on the `storage.objects` table and have different patterns.

### Key Differences from Table RLS

| Aspect | Table RLS | Storage Bucket RLS |
|--------|-----------|-------------------|
| Table | Your table (e.g., `products`) | `storage.objects` |
| Filter column | `company_id` | `bucket_id` + folder path |
| Path checking | N/A | `storage.foldername(name)` |
| Common pattern | `company_id = get_my_company_id()` | `bucket_id = 'bucket-name' AND folder = company_id` |

### Example Buckets and Their Policies

| Bucket | Path Pattern | Policy Type |
|--------|--------------|-------------|
| `profile-photos` | `{company_id}/{user_id}.{ext}` | Company-folder scoped |
| `product-images` | `{folder}/{timestamp}-{random}.jpg` | Simple authenticated |
| `purchase-order-documents` | `{company_id}/{filename}` | Company-folder scoped |
| `call-recordings` | `{company_id}/{filename}` | Company-folder scoped |

### Company-Folder Scoped Pattern (Most Secure)

Most buckets should require files to be in a company folder. The policy checks that the first folder in the path equals the caller's company id:

```sql
-- Check that first folder in path = user's company_id
(storage.foldername(name))[1] = (
  SELECT company_id::text FROM users WHERE id = auth.uid() LIMIT 1
)
```

**This means your CODE must upload to `{companyId}/filename`, not just `filename`.**

### Example: Profile Photos

**Policy:**
```sql
CREATE POLICY "Users can upload profile photos for their company"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  -- Layer 1: Check if user is blocked
  NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.is_blocked = true
  )
  -- Layer 2-3: Bucket and company checks
  AND bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = (
    SELECT company_id::text FROM users WHERE id = auth.uid() LIMIT 1
  )
);
```

**Note:** storage bucket policies should also include the `is_blocked` check as the first layer, to prevent blocked users from uploading or accessing files.

**Code must match this pattern:**
```typescript
// CORRECT - includes company folder
const fileName = `${companyId}/${userId}.${fileExt}`;
await supabase.storage.from('profile-photos').upload(fileName, file);

// WRONG - missing company folder, will get 403
const fileName = `${userId}.${fileExt}`;
await supabase.storage.from('profile-photos').upload(fileName, file);
```

### Before Creating Storage Policies

1. **Check existing policies** for the bucket in your migrations.
2. **Follow the same pattern.** Don't create conflicting policies.
3. **Verify the code matches.** The file path in code must match the policy's expectations.

### Common Storage Policy Mistakes

| Mistake | Result | Fix |
|---------|--------|-----|
| Code uploads without a company folder | 403 Unauthorized | Add a `${companyId}/` prefix to the file path |
| Creating a new policy without checking existing ones | Conflicts/duplicates | Search migrations for existing policies first |
| Using the wrong bucket name in code | 404 Bucket not found | Verify the bucket name matches exactly |
| Double path (e.g., `bucket/bucket/file`) | 403 or path issues | Don't include the bucket name in the file path |

### Storage Policy Debugging

When you get a 403 on a storage upload:

1. **Check the file path in code.** Does it include the company folder if required?
2. **Check existing policies:** `grep -r "bucket_id = 'bucket-name'" supabase/migrations/`
3. **Compare with working uploads.** Find similar upload code that works and compare patterns.

---

## Related Skills

The following sibling skills may be relevant when doing security work:
- `query-efficiency` - for writing efficient queries and RLS helpers that the planner can hoist.
- `error-alert-system` - for surfacing permission-denied and 403 failures so they don't go unseen.
- `build-with-the-user-in-mind` - for the thoroughness and review standard.
