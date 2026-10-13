---
name: auth-and-access-control
description: The DESIGN decisions around authentication, tenancy and roles that come BEFORE and AROUND row-level security, for any hosted multi-user product. It covers what security-rls-permissions does not: choosing the tenancy model (one-user-one-company versus organizations with seats), the login and signup flow rules, why identity is a stable id and never an email, turning RLS on at table creation, designing roles and permissions as data, the questions to ask the owner before adding any permission-controlled resource, the two populations (platform staff versus customer users) with staff tiers and an access log, the cross-tenant test that actually proves isolation, and the build order. Read it BEFORE designing any login or signup flow, before creating the first user, organization or membership table, before adding a role or a permission-controlled feature, before giving the owner or staff access to customer data, and before declaring any access rule "working". Use when the owner mentions auth, login, signup, sessions, sign-in, password reset, organizations, tenants, multi-tenancy, seats, members, invitations, roles, permissions, admin access, impersonation, "who can see what", staff access, support access, or account enumeration.
---

# Auth and Access Control: the design layer

> ## Adapt before use
> This describes how authentication, tenancy and roles SHOULD be designed. Nothing here exists
> in a repo until you build it. It came from two places: a multi-tenant product where these
> answers were refined over months, and a later project that needed a different tenancy shape
> and so had to separate the PRINCIPLES from the first project's schema. The table, column and
> function names below (`users`, `org_id`, `current_org_id()`, `is_platform_staff()`) are
> EXAMPLES of the shape. Grep the repo before citing any of them. When this document and the
> code disagree, the code wins. Once the system is built, rewrite this file to describe reality
> and delete this note.

> **Read with `security-rls-permissions`.** That skill is the detailed reference implementation:
> the six security layers, policy templates per table category, SECURITY DEFINER lockdown
> patterns, page access, storage policies, debugging a 403. It assumes ONE tenancy shape (one
> user row per company). This skill is the layer above it: which shape to pick, what the flows
> must guarantee, how roles are designed, where staff fit, and how to prove any of it. Where a
> rule is fully covered there, this file points to it instead of repeating it.

---

## 0. The two systems people conflate

Keep these separate in your head or the design goes wrong immediately.

| | **Data access** | **Page access** |
|---|---|---|
| Question | What ROWS can this user read and write? | What SCREENS can this user see? |
| Enforced by | **The database** (row policies) | The frontend |
| If it fails | **A data breach.** Another tenant's data leaves the server. | A cosmetic bug. A user sees a menu item they cannot use. |

> **The database is the security boundary. The UI is a convenience.**

Hiding a button is not access control. Anyone can open devtools, read the JavaScript, and call
the API directly. If the only thing stopping a user from reading another organization's data is
that the UI did not render a link, you have no access control at all.

Build both. Never let the second substitute for the first.

---

## 1. Decide the tenancy model on paper FIRST

Everything else depends on this, and it is the most expensive thing to change later. Do not copy
another project's tables: a schema encodes that project's assumptions.

| Model | Shape | Good when | Cost |
|---|---|---|---|
| **One user, one tenant** | Every user row belongs to exactly one company. The same human at two companies has two separate accounts, with a picker at login. | Staff of a business who work for that business only. Simplest and hardest to break: no membership table, no "active tenant" claim to get wrong. | Account switching is a real feature you must build. A shared email needs careful handling in the auth provider. |
| **Organizations with seats** | A person is one account; membership rows link people to organizations with a role per membership. | Products sold per seat, consultants across clients, anything where one identity legitimately spans organizations. | Every policy must resolve "which organization is this request for" and prove the caller is a member. More places to leak. |

Write down, before any table exists:

- What an organization is, and what a seat is.
- Whether a person can belong to more than one organization.
- **What happens when someone is removed.** Does their content transfer, get deleted, or go
  orphaned? Decide before you build seats, not after someone leaves.
- Where **platform staff** sit relative to all of it (section 6).

Then use the model consistently. Do not write a policy that leans on a membership table or an
"active organization" token claim your design does not actually maintain.

---

## 2. IDENTITY IS AN ID, NEVER AN EMAIL

> **Hard rule, no exceptions. Every policy, query and permission check identifies a user by a
> stable id, never by email address.**

This is the most expensive rule to retrofit. The SQL patterns (correct and buggy) are in
`security-rls-permissions`. The reasoning, so you can defend it:

- **People change their email.** Someone marries, changes provider, or moves from a personal to
  a work address. If identity is the email, changing it either orphans everything they own or
  needs a migration across every table that stored it. With an id, an email change is one
  `UPDATE` on one column and nothing else moves.
- **Email is not reliably unique.** Two people can share an inbox. One person can hold two
  accounts. If email is the key, a lookup returns either the wrong row (**a cross-account leak**)
  or no row (**a lockout**). Both show up under exactly the conditions you least want.
- **The auth provider's email may not be the user-facing one.** Auth systems sometimes hold a
  synthetic or placeholder address. Matching the provider's email against the profile email then
  fails silently.

**The invariant to enforce at account creation:**

```
the authenticated caller's id  ==  the users table primary key      (1:1, forever)
```

Enforce it in a trigger or function at signup so every policy can rely on it without re-checking.

**The payoff:** a user can change their email freely. It is profile data, like a display name,
not the thing they *are*.

**Corollary: email is contact data.** Store it, index it for the login lookup, let people change
it. Never join on it, never derive permissions from it, never use it as a foreign key.

---

## 3. Login and signup flow rules

These are the guarantees the flows must give, whatever auth provider you use.

- **Signup establishes the 1:1 invariant in the same transaction** that creates the account. A
  user who can sign in but has no profile row is denied everywhere by the policies, and it looks
  like a random bug.
- **The account-active check comes first, everywhere.** One flag, checked before anything else
  in every policy AND in every auth endpoint (sign-in, select-account, switch-account, code
  verify). A blocked account is denied with one clear message, then signed out. This is the
  emergency stop; it must be impossible to bypass.
- **Error messages must not leak existence.** "Invalid credentials", never "no account with that
  email". The second turns the login form into an account enumerator. The same goes for password
  reset ("if an account exists, we sent a link") and for signup.
- **When one email maps to several accounts, show a picker BEFORE sending anything.** Do not send
  a code or a reset link to an ambiguous target. (The picker-first flows are spelled out in
  `security-rls-permissions`, "One human, multiple companies".)
- **Send auth mail to the address in your own profile table, looked up by id.** Never trust the
  auth provider's email field as the recipient.
- **Cache the session on the client and read it from one place.** One session hook or context,
  not a network "who am I" call per component. (See `page-performance`, session caching, and for
  server components `nextjs-supabase-performance`, Part 1.)
- **Removing someone is a real operation with a decided outcome** (section 1). So is leaving.
- **Never hardcode, guess, or commit credentials** while testing a flow. If you hit a login wall
  in your own browser, ask the owner to log in to that window (see `browser-verification`).

---

## 4. Row security goes on at table creation. Not later.

> **Every table holding user or organization data gets row-level security the moment it is
> created, in the same migration.**

A table created without it is readable by anyone who can reach the API, and it stays that way
until someone notices. "We will add policies later" is how a breach happens, because *later* is
after data is in it and after code depends on the current behavior.

**The checklist for any new tenant-scoped table:**

- [ ] Row security ENABLED in the same migration as `CREATE TABLE`.
- [ ] Table grants in place (without them the policies never run; see `database-write-safety`).
- [ ] A policy for **each** of SELECT, INSERT, UPDATE and DELETE. A missing policy means "denied"
      for normal users, which is safe but will look like a mysterious bug, and **wide open for
      privileged connections**.
- [ ] Every policy scopes to the caller's organization.
- [ ] Tested as a **real, non-privileged user**, not an admin or service connection (section 7).
- [ ] Tested **cross-tenant explicitly**: log in as organization A, try to read a known row from
      organization B, expect zero rows. This is the test that matters and the one most often
      skipped.

**Deny by default.** Start with no access and grant deliberately. The reverse (open, then
restrict) leaves gaps nobody enumerates.

**Elevated functions are the main leak vector.** A function that runs with its owner's rights
bypasses every row policy. If it takes an id as a parameter (an organization id, a user id, a
record id) it MUST verify in its own body that the caller is entitled to that target, or any
authenticated user can pass any id and read anything. That is an IDOR, and it is trivially
exploitable: change a value in a request and get someone else's data. Two design rules sit above
the mechanics:

- **Prefer a no-argument function** that derives everything from the caller's own id. If there
  is no id parameter, there is no id to forge. Take a parameter only when you must, and then
  check it.
- **Every new or changed elevated function gets read line by line.** It is the highest-value
  security review in the codebase, and it is a small, finite amount of reading.

The mandatory lockdown patterns (explicit search path, revoke the default execute grant, the
three caller classes, the in-body ownership check) are in `security-rls-permissions`, "SECURITY
DEFINER Function ACLs". Follow them exactly.

---

## 5. Roles and permissions

A person's rights come from their membership in an organization, not from a global property of
the person.

**The layers, checked in order:**

1. **Is the account active?** The emergency stop.
2. **Does the user belong to this organization?** The tenant boundary. **This is the check that
   prevents a breach**; everything below it is refinement.
3. **Does their role permit this action on this resource?** Read versus write versus delete.
4. **(If you add sub-scoping)** Is the specific record within their scope (their location, their
   own records)?

**Designing the roles themselves:**

- **Start with fewer roles than you think.** Roles are expensive to remove once code branches on
  their names. Two or three that clearly differ beat seven that overlap.
- **Store permissions as data, not as hardcoded role names in policies.** A table shaped like
  `role_permissions(role, resource, can_view, can_edit, can_delete)` means a permission change is
  a row update. A policy that reads "where the role name is manager" means a code change and a
  migration, and adding a role later silently breaks every place a name was hardcoded.
- **Write the defaults for every role when adding a resource.** A resource with no row for a role
  is undefined behavior. Make it explicit.
- **One role is always full-access** (the organization owner) and must never be gated off by
  accident.

> **A new role is not free.** Role *names* end up hardcoded in policies, helper functions, UI
> and notification config. Before adding one, grep for every existing role name across the
> codebase and the live database and expect to find surprises. (The exact greps are in
> `security-rls-permissions`.)

### Adding a permission-controlled resource: ASK FIRST

When a new feature or table needs permission controls, do not guess. These are product decisions
only the owner can make, and a wrong guess is either a lockout or a leak. Ask before implementing
anything:

1. **Security level.** Is it tenant-wide (every user in the company sees every record, like a
   catalog or a contact list) or scope-level (users see only records for the locations or teams
   they are assigned to, like bookings or schedules)?
2. **Default permissions per role.** Owner and admin get full access automatically; do not ask
   about those. For each remaining role: can they view all? Edit all? Delete? View and edit only
   their own? Nothing?
3. **The resource name.** Propose one that follows the repo's convention and confirm it.

Ask them as one short multiple-choice message, recommended option first. Example of the exchange:

```
Owner: "Add inventory management."

Agent: "I'll add inventory with permission controls. Three decisions:
 1. Scope: (a) company-wide, everyone sees all inventory [recommended, it matches products],
    or (b) per location.
 2. Manager defaults: (a) view, edit and delete [recommended], or (b) view and edit only.
    Staff defaults: (a) view only [recommended], or (b) view and edit.
 3. Resource key: inventory_table. OK?"

Owner: "Company-wide. Manager everything. Staff view only. Yes."

Agent: [updates every place the resource must be registered]
```

Only after the answers, update EVERY place the resource must be registered: the type or enum,
the resource list the permission UI reads, the per-role defaults, the "seed a new tenant"
function, and a backfill for EXISTING tenants. Missing any one causes either a lockout or a
toggle that does nothing. The full table of places is in `security-rls-permissions`, "Adding a
New Protected Resource".

Absolute rules:
1. **Never guess** whether a resource needs scope-level security. Ask.
2. **Never assume** what each role should get. Ask.
3. **Always update every registration place**, for new tenants AND existing ones.
4. **Test after implementing**: verify the permissions actually behave in the UI and against the
   API as a non-privileged user.

Never hardcode role ids in a skill, a rule file, or app code. Look them up by name at the point
of use.

---

## 6. TWO POPULATIONS: platform staff versus customer users

There are **two different kinds of people** in a hosted product, and conflating them is a design
error that is painful to unwind later.

| | **Platform staff** (us) | **Customer users** (them) |
|---|---|---|
| Who | The owner, employees, developers, support | Subscribers: individuals and organization seats |
| Belongs to | The platform itself | A customer organization |
| Scoped by | Nothing, or a staff role | Their organization |
| Reaches | The admin portal; potentially any organization's data | Only their own organization |
| Example | The owner reviewing a support issue; a developer debugging a failed job | A user reading their own records |

**Design rule: platform staff are NOT a role inside a customer organization.** Do not model the
owner as an "admin" of every organization. That breaks the tenant boundary conceptually and makes
every policy ambiguous. Model staff as a **separate axis**: a person is either platform staff or
a customer user, and the tenant check either applies to them or is explicitly bypassed by a staff
check.

### Owner access: full, and deliberately so

The owner needs access to everything, **including customer content**. That is a legitimate
operational requirement: support, debugging, abuse investigation, and understanding what the
product actually does in the field. Build it as an explicit, named capability, not as an accident
of being an admin somewhere.

**Full access has obligations that are cheaper to build in than to retrofit:**

- **Log every staff access to customer content.** Who looked, at what, when, and ideally why.
  This protects the owner as much as the user: an audit trail is what lets you demonstrate that
  access was legitimate. It is also what makes staff access *safe to grant broadly*.
- **Make it a distinct code path**, not a wildcard in a normal policy. An explicit "is platform
  staff" check is auditable. A role that silently satisfies every organization check is not.
- **Say so in the privacy terms.** If staff can read customer content, customers are entitled to
  know that before they put anything in. This is a product and legal decision, not a technical
  one. Flag it to the owner; do not decide it in code.

### Staff tiers

Employees and developers should **not** automatically get what the owner gets. A starting shape,
to refine when you design it:

| Tier | Intended access |
|---|---|
| **Owner** | Everything, including customer content. The only unrestricted tier. |
| **Employee / support** | Operational surfaces: accounts, subscriptions, job status, error alerts. Customer *content* only when a support case requires it, and logged. |
| **Developer** | Technical surfaces: errors, logs, jobs, runs. Should rarely need customer content; prefer anonymized or aggregate views. |

**Default staff to the narrowest tier that does the job, and widen deliberately.** A developer
debugging a failed job usually needs the error and the job metadata, not the customer's file and
not its contents. Build the surface that answers the question without exposing the content, and
you avoid most of the access decisions entirely.

> **Errors are a content-access path too.** Any "copy the error context" control dumps whatever
> was logged. If customer content can appear in error metadata, that control exposes it to
> everyone who can see errors. The fix is to log identifiers, not payloads. (See
> `error-alert-system`.)

---

## 7. Testing: what actually proves it works

**Test as a real, unprivileged user.** A service or admin connection bypasses row policies
entirely, so testing that way proves nothing about what a normal user can reach. This is the
single most common way people conclude their policies work when they do not.

**The cross-tenant test is mandatory** for every tenant-scoped table:

1. Create two organizations with data in each.
2. Authenticate as a normal member of organization A.
3. Try to read, update and delete a known row from organization B, directly against the API, not
   through the UI.
4. **Expect zero rows and a denial on every attempt.**

**Also test:**
- A blocked account: denied everywhere.
- A low-privilege role: denied on write.
- Every elevated function, called with an id the caller does not own.
- A removed member: denied immediately, including on an already-open session.

"The policy looks right" is not a result. Run the cross-tenant test and paste what came back
(see `verify-before-done`, and the attack step in `review-build`).

**Row policies are a per-row cost.** A correct policy can still be the slowest thing on the page.
If it is expensive, make it cheaper by restructuring, never by weakening it. Mechanics in
`query-efficiency` Rule 4.

---

## 8. Gotchas

- **Identity is an id, never an email.** The most expensive one to retrofit.
- **A table without row security is public** to anyone reaching the API.
- **A missing policy for one verb** silently denies normal users and allows privileged ones.
- **An elevated function with an id parameter and no ownership check is an IDOR.**
- **No explicit search path on an elevated function is a privilege-escalation vector.**
- **Functions are executable by everyone by default.** Revoke, then grant.
- **Hiding a UI element is not access control.**
- **Testing as an admin proves nothing.**
- **Secrets live in the host's secret store, never in the repo.** Every variable the code reads
  appears in the example env file with an EMPTY value. Never put a server secret in frontend
  code or in a variable the bundler ships to the browser.
- **Error messages must not leak existence.**
- **A permission denial that should not have happened is worth capturing** as an error, with ids
  and no payload.

---

## 9. Build order

1. **Decide the tenancy model on paper first**: what an organization is, what a seat is, what
   happens when someone is removed, and where platform staff sit relative to all of it.
2. **The identity invariant**: the auth id equals the users-table primary key, enforced at
   signup. Get this right before any other table exists.
3. **Organizations and membership**, with row security from the first migration.
4. **The helper functions** ("my organization id", "do I have access to this organization").
   No-argument where possible, explicit search path, default grants revoked.
5. **The first protected table**, end to end, with all four policies and a passing cross-tenant
   test. This is the template every later table copies.
6. **Roles and permissions as data.**
7. **The platform-staff axis**: the staff check, the staff tiers, and the access log for staff
   reads of customer content. Build the log **with** the access, never after.
8. **Page access as a separate, frontend-only layer**, never as a substitute for step 5.

---

## Related

- `security-rls-permissions`: the detailed reference implementation.
- `database-write-safety`: before any migration that touches these tables.
- `verify-before-done`: the cross-tenant test is the "did it actually work" check here.
- `query-efficiency`: the per-row cost of policies.
- `error-alert-system`: capturing unexpected denials without leaking content.
- `review-build`: prove a security change by attacking it.
