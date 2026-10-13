---
name: competitor-data-migration
description: The playbook for migrating a customer OFF a competitor's system and INTO your app when the competitor offers no export - discovering the competitor's private API by reading its own dashboard's network calls, pulling the data from inside the customer's logged-in browser session, classifying each pulled section by content, mapping entities onto your schema, running everything through your existing importers under the operator's own permissions, and proving the result. Covers the connector architecture, endpoint discovery and paging traps, id-namespace traps, entity mapping decisions, where payment history really lives (usually the payment processor, not the competitor), importing recurring memberships without charging anyone, per-record fan-out pulls, signed waivers and consent records, idempotent re-runs, the "has a home vs must be built" scope split, and the run procedure. Read this BEFORE any work that moves a customer's data from another product into yours. Use when the user mentions migrating a customer, switching from a competitor, importing from another system, a connector, a bookmarklet, scraping a dashboard API, "they have no export", importing members / memberships / appointments / check-ins / packages / saved cards / payment history / waivers, or an import that skipped everything.
---

# Competitor data migration (via the competitor's own API)

> **Adapt before use.** This describes how a competitor migration SHOULD be built. It is taken from
> a real migration of a fitness studio off Exercise.com into a booking and POS platform: about
> 1,200 people, several hundred memberships, bookings, check-ins, class timetables and signed
> waivers. Nothing here is wired in your repo yet. File, table and field names are EXAMPLES. Each
> competitor gets its own section that you ADD to, so the next migration from the same system is
> follow-the-recipe. Record only what you verified live.

Only migrate data the customer owns and has authorized you to move, using the customer's own login.
Never keep the customer's competitor credentials in the repo.

---

## 0. Architecture: why a browser-side connector

Many competitors have NO export. But their dashboard reads a same-origin JSON API with the
customer's own session cookie. So:

- **The pull runs in the customer's browser, ON the competitor's site.** A helper bookmarklet (or a
  script run from the developer console) calls the same endpoints the dashboard calls and saves ONE
  bundle file. You cannot fetch the competitor's API from your own app's origin: cross-origin rules
  block it. Pull it on their tab, hand it over as a file.
- **Your app reads the bundle under the operator's login** and classifies each section BY CONTENT,
  never by file name. People rename files, concatenate them, and upload yesterday's.
- **Mapped rows go through your EXISTING importers**, under the operator's normal permissions. A
  connector is a parser plus a set of field mappers plus a run order. It is not a second import
  engine. Whatever validation, dedupe, rollback and tenant scoping your importers have, the
  migration inherits.
- A connector-only entity (something your standard CSV import has no importer for) gets its own
  importer in the same engine.

Suggested layout: `import/<competitor>/{parseBundle, fieldMappers, bookmarklet}`, one runner, one
migration page.

---

## 1. Discovering the API

- **Read the dashboard's own network calls. Do not guess paths.** Open the competitor's screens in a
  browser with the network panel open and record exactly what fires: the URL, the query filters,
  the paging parameters and the response envelope. In the source migration, guessing paths mostly
  returned 500s.
- **Look for a bootstrap record.** Many dashboards load a "platform" or "account" record first that
  carries links to most list endpoints. Start there.
- **Record the envelope per endpoint.** Is the list under a singular key, a plural key, or `data`?
  Is there a total in a `meta` block?
- **Capture per-record sections live, at a customer who USES them.** A profile tab that is empty
  for this customer fires no data endpoint, so its URL stays UNKNOWN. Write "unknown, not needed
  here" and move on. Do NOT ship guesses.
- **Write down the per-record section list from the competitor's own UI** (the tabs on a customer
  profile). That list is the real scope of "everything about a member", and it is what section 6
  is built from.

### Paging and filter traps (all real)

- **Some endpoints accept a "fetch everything" flag and return one page. Others page. One IGNORED
  paging entirely and returned the full set on every page.** Looping that one hits your page cap
  with duplicates. Dedupe by id, and do not loop endpoints you have verified ignore paging.
- For paged endpoints, page until a short page OR the reported total is reached.
- **A filter that sounds like what you want can mean the opposite.** In the source system the
  "visits" list mixed two different things: real check-ins (a check-in time, no appointment id) and
  reserved appointment or class bookings (an appointment id, no check-in). "Check-in is not null"
  gave check-ins; "check-in is null" gave reservations; unfiltered gave BOTH. Verify each filter by
  counting: the parts must add up to the unfiltered total.
- **A variant path of the same resource may simply be broken.** One versioned path returned 500
  while its sibling worked. Note the working one.
- **A bulk "list all" endpoint may be scoped to the caller.** A bulk signatures endpoint returned
  only the logged-in user's own. Those must be fanned out per record (section 5).
- **A list form may not exist at all.** Appointments had no working bulk list; each had to be
  fetched by id. For a one-time migration a few hundred calls with modest concurrency is fine.

---

## 2. Where the data really lives: check the payment processor

**The critical discovery in the source migration: payment history was not in the competitor at
all.** The competitor's "Charges" and "Invoices" tabs loaded straight from the payment processor.
The competitor held only the CURRENT subscription state and the next upcoming invoice.

So before you plan a payment-history import, watch where those tabs' requests actually go. If they
go to the processor:

- Payment history is a SERVER-SIDE read of the customer's connected processor account, with the
  customer's authorization. It is a separate pass, not part of the browser connector. Reuse your
  existing processor customer-import path.
- The key is the processor CUSTOMER id, which the competitor's subscription object usually carries
  for each member.
- That same pass gives you saved payment methods.
- Map charges, invoices and refunds onto your orders, payments and refunds.

**Saved cards never migrate out of the competitor.** They live at the processor. Import them from
the connected processor account as a separate, explicit step, and nobody is charged until the
customer authorizes it.

---

## 3. Entity mapping: decide by the DATA, and write the decision down

These decisions generalize well beyond fitness.

- **Staff become staff, minus service accounts.** Skip by email domain (the competitor's own
  domain) and by local part (billing, signup, it, support, noreply, test, info). Skip the owner's
  own existing login. Mark imported staff as "no invite" so a migration never sends a wave of
  invitation emails to placeholder users.
- **One competitor concept can split several ways. Split by what the data says, not by its name.**
  The competitor's "packages" were really four things:
  - a recurring month or year price: a MEMBERSHIP PLAN (price, interval and anchor day from the
    processor price's metadata);
  - a one-time payment: a PREPAID PACKAGE template;
  - freeze fees and overdue fees: NOT imported as products. They map to SETTINGS (a freeze fee on
    the plan, a late fee on the location);
  - free day passes with no price: skipped.
  - A day or week interval price is a PASS: treat it as a package template, not a membership.
- **A sold item splits by payment type and expiry.** Subscription and not expired: a live
  membership. One-time purchase: a customer package. Expired: history only, skipped.
- **Retired definitions still referenced by live subscriptions must be re-created.** A plan the
  competitor no longer lists but that members are still on gets re-created INACTIVE, from the sold
  name plus the amount and interval most common among those members' processor prices.
- **Customers become contacts.** Tags and lifecycle stage become tags. **A tag that means "opted
  out of SMS" becomes a REAL opt-out**, not a label.
- **An event that needs a parent fails honestly when the parent is not there.** A gym check-in
  attaches to an active membership; a check-in whose member has only expired subscriptions has
  nothing to attach to and is skipped with a clear reason. About a third were skipped that way.
  Expected, and it belongs in the preflight report, not in an error log.
- **Recurring timetables are their own entity.** A recurring group class series is imported as a
  series plus enrollments. A recurring ONE-TO-ONE slot is an appointment, not a class: exclude it
  from the series import.
- **An appointment may be two objects.** The attendee record (who, status, fees, which package paid)
  and the calendar event (start and end, service, staff, timezone, recurring-series link). Neither
  alone is a booking. Map ONE booking per (event, attendee), read times in the event's own
  timezone, and map statuses explicitly (completed, reserved, cancelled, no-show).

### Importing recurring memberships WITHOUT charging anyone

Your membership importer probably writes a safe default status with placeholder payment
references. After import, the connector PATCHES each membership to:

- its real status (active, paused, cancelling at period end);
- **manual billing**, so your renewal job SKIPS it and nobody is charged;
- its real next renewal date and activation date.

Only after cards are imported from the processor and the customer explicitly switches a membership
to automatic billing does anything charge. Never let a migration silently start billing people.

---

## 4. Landmines already hit. Do not re-learn these.

1. **A database CHECK constraint on "entity type" that is SEPARATE from the code's type union and
   from the rollback allowlist.** Adding a new import entity required widening the constraint too.
   Without it the step threw a constraint violation and aborted the run BEFORE that entity. An
   existing entity was also missing from it. Whenever you add an import entity, widen every list it
   appears in, in the same change.
2. **Two id families on one record.** An attendee record carried BOTH a "client record id" and a
   "user id". Contacts had been imported keyed on the user id. Keying bookings on the client id
   resolved to ZERO contacts, and every booking was skipped as "member not imported". **Before a
   run, prove the join:** check that the foreign key you plan to use matches the key you imported
   on, for a sample, 100 percent. A run that skips everything is almost always this.
3. **The importer reads a specific field name and silently ignores a near miss.** Status had to be
   passed as the display name the importer matches against the company's status list. A
   similar-looking field was ignored, so every booking fell through to the default status. After a
   run, reconcile status COUNTS against the source, not just the row total.
4. **A NOT NULL display column the source does not carry.** Bookings needed a client name; the
   source records had none. The runner batch-fetches name and phone for the resolved contacts and
   denormalizes them onto each row. A contact with no name is skipped. **Never write a placeholder
   name.**
5. **A long "in (...)" id list becomes a 400.** Passing about a thousand ids in one filter exceeded
   the request URL length. Send every such lookup in chunks (150 ids per request worked).
6. **The dev server can abort a long browser-driven import.** Hot reload or a context update
   remounts the page and resets it to the upload screen, silently ending the run. The reliable
   workaround in development is to call the runner function directly, outside the page component.
   In a production build, verify that the full-page run completes.
7. **The "is this bundle empty?" check must count every section type.** A file holding only
   signatures or only appointments was rejected as empty.
8. **An importer with no external id needs its own idempotency rule**, such as "this contact
   already has a submission on this template."
9. **Credentials in a local env file get malformed.** Watch for an email concatenated onto a
   password. Keep them local and out of the repo.
10. **The bundle can be large.** A signatures pull that included base64 images was 33 MB. Save each
    pull to a file FIRST, so the import survives a lapsed browser session.

---

## 5. Per-record fan-out pulls

When data exists only per record (a member's signed waiver, a patient's notes):

- Loop the already-pulled record ids with a small worker pool (about 8 concurrent). About 1,200
  members took roughly two minutes.
- Keep only real rows. A signature record with NO signed-at time was a pending request that was
  never completed (about one in six). It is not a signature.
- Save the result as its own dated file. Additional pulls (appointments, signatures) are SEPARATE
  bundles the parser recognizes by content.

### Signed waivers and consent are real compliance data

- Map each signature to a signed form submission on a company form created for the purpose (found
  by name, else created), with the full waiver text, the signer's name and the signed date. Latest
  signature wins per person. Stamp the signature image where your viewer renders it.
- If your consent log requires a parent (for example exactly one of a membership id or a recurring
  charge id must be set), you can write a consent row ONLY for people who have that parent. For
  leads and lapsed members with a signature but no membership, store the form submission only, and
  DOCUMENT the count. Never insert a row that violates the constraint, and never invent a parent.
- Use the consent type and source values your constraint already allows (the closest fit was a
  "membership agreement" type and an "admin import" source). Keep a text snapshot, a stable version
  label derived from a hash of the text, and accepted-at set to the signed time.
- **Make every write skip-if-present and run the post-step for ALL signed members on every run**,
  so a re-run heals a partial failure.

---

## 6. Scope: what HAS A HOME versus what MUST BE BUILT

Go through the competitor's per-record section list and sort every section into two tracks. Show
the customer this list before you start.

- **Has a home (import now).** In the source migration: staff, services, classes, products with
  variants and inventory, package templates, membership plans, contacts, tags and lifecycle stage,
  memberships, customer packages, check-ins, class series and enrollments, saved cards (through the
  processor), payment history (through the processor), appointments, waiver signatures, account and
  service balances, dependents, class attendance history.
- **No home yet (build first, behind the right feature gate, THEN import).** There: exercise
  library, workout plans, measurements, nutrition, scored assessments, progress photos, videos,
  resources, a client journal, online training. This customer used almost none of them, but the
  next one might, so each is a real build task rather than a silent drop.

Anything vertical-specific you build to hold this data sits behind that vertical's gate, so other
kinds of business never see it.

---

## 7. Run procedure

1. **Create the account from the right template** for that kind of business, so the vertical's
   features, timezone and defaults are on before any data arrives. Log the operator in.
2. **Pull FRESH data** on the competitor's site and save one bundle. Yesterday's bundle is fine to
   validate with. Re-pull for go-live.
3. **Upload, and read the preflight**: counts per entity and the skip reasons. Then start.
4. **Verify committed counts per entity in the database, then walk the real screens**: the member
   list, the calendar, the class schedule, check-in. Reconcile statuses, not just totals. The
   source run produced 370 bookings with zero errors, and the status split matched the source
   exactly.
5. **Afterwards:** import saved cards from the processor (nobody is charged until authorized), set
   the payment method per membership, and deactivate the template's placeholder plans and services
   the customer does not actually have. Show the owner the list first.

### Order and idempotency

- Fix an import ORDER, so parents exist before children: staff, services, plans and templates,
  contacts, memberships and packages, check-ins, class series, bookings, form submissions.
- **Every row gets a stable external id that includes the competitor and the source id family**, in
  the shape `<competitor>:<kind>:<source id>`. Re-running upserts by that id, so a second run
  changes nothing and a failed run can simply be run again.
- Stamp an import batch id and a source system on every row. Your automations rely on those markers
  to stay quiet: no reminder texts for imported appointments, no credits drained by imported
  bookings, no notification flood.

---

## 8. Extend the per-competitor notes after every migration

For each competitor keep a section listing: every verified endpoint with its exact filter, paging
behavior and envelope; every mapping decision and the data that justified it; every new landmine;
and items moved from "no home" to "has a home" as you build them. Verified facts only. A guessed
endpoint in this file costs the next agent an afternoon.

### Worked notes: Exercise.com (verified at one studio, re-verify before reuse)

- Authentication is the session cookie, same origin. A platform record carries links to most list
  endpoints. List wrappers are singular-keyed with a total in a meta block.
- Catalog endpoints (staff, services, package definitions, products and variants, locations,
  lifecycle stages, reminders, email templates, coupons, tax rates) return everything in one page
  with a fetch-all flag.
- Paged at 100 per page: clients, sold packages, visits, class series, standing enrollments.
- The processor-prices endpoint ignores paging. Dedupe by id and do not loop.
- Visits mix check-ins and reservations. Filter on check-in time and on appointment id, and confirm
  the counts add up.
- Per-appointment detail must be fetched by id. The attendee comes from the linked visit, and the
  member key is the visit's USER id, not its client id.
- Charges and invoices live at the payment processor. A per-user account endpoint returns the
  member's subscription object, including the processor customer id.
- Signatures are per member, with the full waiver text, an image and a signed-at time. The bulk
  endpoint is scoped to the caller.

## Related skills

- `memberships-and-packages-design`: the tables this data lands in, and why imported rows must not
  trigger auto-cover.
- `payment-processor-integration-checklist`: importing customers and saved cards from a processor.
- `report-verification`: reconcile counts against the source before calling it done.
- `browser-verification`: reading a logged-in site's network calls and walking the result.
