# Vendor notes

What earlier parity projects learned about specific systems. Read the entry for the system you are
replacing before Phase 1; add or extend an entry when a project ends (from that project's
`LESSONS.md`). Re-verify before relying on any note: vendors change their products.

Never put customer data, credentials, account identifiers or the owner's business details here.

## Entry format

### <Vendor / product> (version or date verified)

- **Tech:** (WebForms / JSF / PHP / SPA, frames, IE mode needed?)
- **Sandbox:** (does one exist, how to get it, what differs from live)
- **Login and session:** (timeout, captcha, MFA)
- **Navigation quirks:** (deep links that break, popups, frames)
- **Endpoints and data:** (useful endpoints, paging traps, export formats and their real byte format)
- **Behaviors staff rely on:** (shortcuts, remembered values, quirks)
- **Traps:** (GET links that act, save-on-blur fields, emails sent by default)

## Entries

### Forth CRM (formerly DebtPayPro), notes from public sources, October 2026

- **Tech:** web CRM for debt relief and other financial services. Not yet observed first-hand; fill in
  after the first shielded session (host names, framework, frames, login flow).
- **Sandbox:** none offered to at least one customer (support unreachable by phone and email, October
  2026). Use `no-sandbox-mode.md`. The "Client Services" demo team on the vendor site may answer when
  support does not.
- **Access:** access control with roles and teams; an admin can create custom roles, so a view-only
  assistant user is possible.
- **Endpoints and data:** RESTful OAuth CRM API and a Forth Pay API; "Managed Data Cloud" gives full
  access to CRM and processing data in Snowflake: the best read-only source for the data model and the
  data move. Detailed audit logs and history for every contact: read these instead of making new history.
- **Traps:** automated triggers (email, SMS, task automation), Clixsign e-signature sends, document
  builders, and Forth Pay (dedicated accounts, drafts, settlement payments, real money). Never test
  anything in Forth Pay. `blocked_hosts` already covers clixsign and forthpay host names; add any other
  payment or messaging hosts seen in `traffic.jsonl`.
- **Behaviors staff rely on:** (fill in from the first sessions)
