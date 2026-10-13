---
name: voice-mishear-aliases
description: How to mine real voice-agent calls for words the speech recognizer got wrong (brand names, product names, foreign-language and domain terms) and turn them into a small, vetted heard-to-canonical alias list that the matcher uses to recover the intended word. Covers the hard approval gate, the two safety rules (never alias a phrase that is a real thing a caller could mean; require closeness or frequency), the eight-step workflow from pulling calls to verifying the seed, and the fidelity notes that keep the test honest. This is a pattern to IMPLEMENT per repository; verify table and script names against the current repo first. Read it BEFORE mining calls for mishearings, adding rows to an alias / phonetic table, or debugging "the agent heard the wrong product". Use when the user says "find more mishears to seed", "what misheard words came up", "mine the calls for aliases", "add to the alias table", "seed the database", "refresh the alias list", "the agent keeps mishearing X", or mentions phonetic aliases, STT errors, or transcription mistakes on names.
---

# Voice mishear aliases: mining real calls for a heard-to-canonical list

> ## Adapt before use
> This describes how things SHOULD be wired, taken from a production voice
> ordering system. Nothing here exists in a repo until you build it. Names like
> `phonetic_aliases`, `seed-aliases.txt`, `dry-run`, `alias-scan` are EXAMPLES
> of the shape: grep the current repo before citing any of them, and when this
> doc and the code disagree, the code wins. Update this file with the real
> table, script and tool names once built.

**Goal:** turn real call data into a small, SAFE set of `heard -> canonical`
pairs: the pairs that let the matcher recover a misheard brand or
foreign-language word. Example shape: a brand heard as a near-miss spelling, or
a two-word product where the recognizer mangled the brand ("tethem grape juice"
for a brand that starts with K).

This matters most where the vocabulary is outside the recognizer's comfort
zone: brand names, transliterated words, medication names, street and surname
lists, industry jargon.

Read this whole file before mining. The gates and the two safety rules are the
point. Getting them wrong seeds a false positive that silently corrupts real
orders.

Related skills: `retell-phone-agent` (where the calls come from),
`voice-agent-prompting`.

---

## RULE 0: NEVER seed without explicit human approval. (Hard gate.)

You may READ calls and the DB freely. You must NOT insert a single row into the
alias table until you have shown the owner the full candidate list, every
`heard -> canonical` pair with its evidence (frequency and similarity), and
they have explicitly approved it. Present, wait, seed only what they OK. If
they approve a subset, seed only that subset. No silent inserts. No "I'll just
add the obvious ones."

## RULE 1: only seed a pair if BOTH are true.

**(a) The whole `heard` PHRASE is NOT a real thing a caller could actually mean.**
Judge the phrase as a whole, not word by word. A nonsense two-word phrase is
fine even when one of its words is a real word, because nobody says that phrase
meaning anything real. But DROP anything that is real as a whole:
- real everyday words (examples that came up: `regular`, `falcon`, `swan`);
- real things in your own catalog or domain (a real dish, a real product the
  business SELLS);
- real place, brand or personal names.

This is the number one trap. A real-word alias rewrites legitimate requests: an
alias from `regular` to a pastry name turned "regular red peppers" into that
pastry plus "red peppers". ALWAYS sanity-check the phrase in context (grep the
transcripts) before trusting it. One short word looked like an obvious mishear
of a cake name, and was in fact a real dip that callers asked for five times.

**(b) AND it clears one of the two evidence gates:**
- **Very close:** edit similarity to its canonical of 0.8 or more
  (Levenshtein-based), OR
- **Frequent:** the heard form recurred 3 or more times across the corpus.

A pair that is neither close nor frequent is a guess. Leave it out.

Real-word mishears that are genuinely common are NOT seeded here. Note them as
"needs a later fuzzy / context-aware layer". Never a blind exact rewrite.

---

## The workflow

### 1. Pull the calls (read-only)
Use the voice platform's REST API the same way the repo's existing client does
(list calls, paginated, then get each call). The key comes from env. Fetch with
modest concurrency (about 4) and retry on 429. Save a temp dump in a scratch
location and delete it afterwards. NEVER print the API key.

### 2. Extract candidate mishears
From each call's transcript-with-tool-calls, read the tool-call invocations for
the tools that carry item names (add item, search, lookup), parse the
stringified arguments, and collect every item name with a frequency count. What
the agent PASSED to a tool is what it believed it heard.

Optionally also mine the raw transcript's user turns for self-corrections ("I
said...", "no, it's not..."). Those are the highest-confidence pairs.

### 3. Score against known canonicals
Keep a list of the correct canonical spellings you care about (the brands and
domain words that get mangled). For each distinct heard name, and its salient
tokens of 4 or more characters, compute edit similarity to the nearest
canonical. Exclude tokens that ARE the correct spelling already, and tokens in
the real-word blocklist (Rule 1a).

### 4. Apply the gates and build the candidate list
Keep the pairs that pass Rule 1a (not a real thing) AND Rule 1b (similarity 0.8
or more, OR frequency 3 or more). Record for each: `heard`, `canonical`,
`freq`, `sim`, and which gate it cleared. Write them to one file in
`heard => canonical` format, with a clearly separated "DROPPED: real word (NOT
seeded)" section listing what you excluded and why.

### 5. Baseline against the CURRENT matcher (informative, not a gate)
Run the heard forms through a dry-run harness to see what the matcher already
does without any alias. Each pair lands in one of three buckets:
1. already resolved (the alias is redundant);
2. UNRESOLVED (the alias is a pure win);
3. resolving to the WRONG item (the alias corrects a silent wrong add: the
   highest value).

Include the buckets in what you show the owner.

### 6. PRESENT for approval (Rule 0)
Show the full candidate table with evidence plus the baseline buckets. Wait for
explicit approval. Do not proceed otherwise.

### 7. Seed ONLY what was approved (idempotent)
Before the write, pull the LIVE schema of the alias table and check your insert
against it. Load the existing `lower(heard)` values and SKIP any that already
exist. Report rows before, inserted count, rows after. This is the ONLY write
step, and only after Rule 0 approval.

### 8. Verify the seed landed
Run an alias scan over a real call that contains a seeded mishear and confirm
the new pairs fire on a real transcript. This also surfaces PRE-EXISTING bad
rows in the table (a real-word alias from an older seed, a no-op row mapping a
word to itself). Report those to the owner separately. Do not silently touch them.

---

## Matching-fidelity notes (so the test reflects reality)

- **Score and store the way the live lookup compares.** If the live lookup is a
  plain lowercase + trim EXACT match, then a fuzzy or differently normalized
  test proves nothing. Read the lookup code first and mirror it.
- **Know which code paths actually READ the alias table.** In the source system
  only the single-item clarification search read it, not the main add or quick
  search paths. So seeding alone did not change the main matching: it prepared
  the data, and wiring it into the other paths was a separate decision. Say so
  when reporting, so the owner is not surprised that a seeded alias did not
  change a live result.
- **Similarity is Levenshtein (spelling), a proxy for phonetic closeness.** Good
  but imperfect: a pair can sound close and spell far, and so fail the 0.8
  gate. When a pair is phonetically obvious but spells far, rely on the
  frequency gate or flag it for the owner rather than forcing it in.

## Housekeeping

- Everything is read-only except the single approved seed insert.
- Delete temp call dumps when done. Call transcripts contain personal data.
- Never print secrets.
- Keep the curated candidate file and the two harness scripts (dry-run and
  alias scan) in the repo's testing folder so the next run is repeatable.
