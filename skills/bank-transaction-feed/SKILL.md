---
name: bank-transaction-feed
description: How to set up a daily, automatic feed of a business's bank transactions, delivered straight from the bank with no per-transaction cost. The bank drops a BAI2 file into an SFTP folder every morning; a scheduled job picks it up, parses it, and loads every transaction. Use this whenever the user wants to pull bank transactions, automate bank reconciliation, get a daily transaction file from a bank, replace a paid transaction-data service, or wire a client's bank account into their system. Covers the three parts: what it takes from the person (the bank request and account eligibility), what it takes from code (the SFTP pickup and the BAI2 parse), and how to set it up end to end. Triggers on BAI2, SFTP bank file, previous-day reporting, treasury management feed, daily bank transactions, bank reconciliation automation, "pull transactions from the bank."
---

# Daily Bank Transaction Feed (BAI2 over SFTP)

Get every bank transaction, automatically, every morning, straight from the bank. The bank puts one file (BAI2 format) into an SFTP folder each day. A scheduled job pulls it, reads it, and loads the transactions. Set it up once; there is no per-transaction fee after that.

It has three parts. **What the person does** (ask the bank, set up the account). **What the code does** (pull the file, parse it). **How to set it up** (the order of operations).

---

## Part 1. What it takes from the person

The business owner, not the developer, has to do two things.

**1. Have a business account.** Banks offer this to business, commercial, and corporate accounts. They usually will not turn it on for a personal account. Any real business qualifies.

**2. Ask the bank to turn it on.** Send this to the bank's relationship manager or treasury / cash-management team (not a branch teller):

> Hi [banker],
>
> We'd like a daily automated feed of our account activity for [company], account(s) [numbers or "all our business accounts"].
>
> - **Previous-day balance and transaction reporting** (prior-day balances plus full transaction detail).
> - In **BAI2 format**.
> - Delivered by **SFTP**, one file each morning for the prior business day.
>
> Please send the enrollment form and setup steps, whether you host the SFTP or deliver to ours, the SSH key exchange process, the file-naming convention and delivery time, and any fee.
>
> This is a treasury / cash-management service; happy to be routed there.
>
> Thanks, [name]

The words that get you to the right desk: **"previous-day reporting," "BAI2," "treasury management."**

What the bank gives back: SFTP connection details, the SSH key exchange, a file-naming convention, and a delivery time. Expect a few weeks and an enrollment form. This bank lead time is the long part; start it first.

---

## Part 2. What it takes from code

Two jobs: **pull the file** and **parse it**. Keep both simple.

### Pulling the file (SFTP)

One side hosts the SFTP folder; the other connects. Two options, pick whichever the bank supports:

- **Bank hosts, you pull (default, simplest).** You generate an SSH key pair, give the bank the **public** key, keep the **private** key secret. Each morning your job connects, downloads any new file, archives it.
- **You host, bank pushes.** You run an SFTP endpoint (a managed service like AWS Transfer Family is easiest), create a login for the bank, load the bank's public key. The bank drops the file; your job watches the folder.

Rule: only ever share **public** keys. Private keys and any passwords live in a secrets manager or environment variable, never in the repo.

Use three folders per feed so the flow is auditable:
- `received/` : new files land here
- `processed/` : files that loaded successfully move here
- `failed/` : files that errored move here and raise an alert

### Parsing the file (BAI2)

Do not hand-roll a parser. Use a library:
- **Python:** `pip install bai2` (parses to a structured object). `bai2-to-csv` if you just want flat rows.
- **Node:** `bai2-parser` (`BAI2.fromFile()`, outputs JSON or CSV).

You only need to know this much about the format to use it:
- Plain text, one record per line, each line starts with a 2-digit code. `01` file header, `02` group, `03` account (carries balances), `16` a transaction, `49`/`98`/`99` trailers with control totals.
- **Amounts are in cents, no decimal point.** `6962782` means `$69,627.82`. Divide by 100.
- **Credit vs debit comes from the transaction's type code, not a sign.** Roughly: 100-399 = money in (deposits, ACH credits, incoming wires), 400-699 = money out (checks paid, ACH debits, outgoing wires, fees). Get the exact code list from the bank.
- **Control totals** at `49`/`98`/`99` let you verify the file: account total = sum of its transactions, group = sum of accounts, file = sum of groups. Always check these after parsing instead of trusting the parse. A valid file begins with `01` and ends with `99`.

### The daily job, in order

1. Connect to the SFTP location.
2. Download any new file into `received/`.
3. Parse it and verify the control totals.
4. Write the transactions to the database/ledger.
5. On success move the file to `processed/`; on any error move it to `failed/` and alert. Never skip silently.
6. Run it on a schedule (cron) a little after the bank's delivery time. No file (weekend/holiday) means the job just exits.

Reconciliation (matching each transaction to the tenant, invoice, or customer it belongs to) is plain programmed rules on top of the loaded data. Keep it deterministic and auditable.

---

## Part 3. How to set it up (end to end)

1. **Confirm eligibility.** Business account, not personal.
2. **Person sends the bank request** (Part 1). Do this first; it is the slow step.
3. **Agree the connection and the specifics with the bank:** SFTP host and keys, BAI2 previous-day content, one file each morning, unique date+timestamp file names, which accounts, any fee.
4. **Get a test file** (ask the bank, or download a Prior-Day BAI2 report from the bank's portal) and confirm you can pull and parse it and the control totals tie out.
5. **Build the daily job** (Part 2): SFTP pull, parse, load, move to processed/failed, schedule it.
6. **Go live**, then add reconciliation rules.
7. **Repeat per bank.** Same format, new connection; a multi-bank client just does the setup once per bank.

---

## Gotchas

- Personal/retail accounts may be refused. Confirm the account type before promising it.
- The bank's enrollment is the long pole; start it early.
- Insist on unique file names (date + timestamp) so you never overwrite or double-process. A reprocess needs a new name.
- Know how the bank handles weekends/holidays (empty file, no file, or rolled into the next business day) so the job doesn't false-alarm.
- Each bank's transaction type codes vary slightly; get that bank's list.
- Always validate control totals; never trust a parse blindly.
- Secrets (private keys, passwords) stay out of the repo.
