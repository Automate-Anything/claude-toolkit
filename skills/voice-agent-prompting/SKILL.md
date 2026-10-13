---
name: voice-agent-prompting
description: How to write the instructions for a voice / phone AI agent so it sounds like a person, plus the discipline for porting an owner's finished voice prompt into code without changing a word. Covers the structure (short labelled sections, one rule per line, plain enough for a four-year-old, samples marked as register not lines, guidelines at the bottom), the sounding-human guidelines with the real failure behind each, getting through a phone menu, what a speech model does with a prompt that a text model does not, how a change is verified (a real call, never a test alone), and prompt porting (copy byte-for-byte, the agent never sees a decision, resolved versus passthrough variables, renderer traps, render every branch). Read it BEFORE writing or editing any prompt a voice model reads, a phone persona, a call guideline file, or a prompt template with variables. Use when the user mentions a voice prompt, phone agent instructions, "it sounds robotic", "sounds AI-ish", filler words, "Got it", dead air, barge-in, an IVR / phone menu prompt, "here is my prompt", "port this prompt", "match this to what we have", "put this prompt in the code", or prompt variables leaking into what the agent says.
---

# Voice agent prompting: how to make it sound like a person

This is a writing discipline, not a system to build, so there is no "adapt
before use" block. Two notes instead: any file or function name below is an
EXAMPLE of the shape, and every rule here came from a real call. The parenthesis
after a rule is the failure that produced it. Keep that habit in your own
prompt files.

Related skills: `retell-phone-agent`, `self-hosted-voice-agent`,
`voice-mishear-aliases`.

---

## 1. First principles

- **Nothing that decides lives in a prompt.** Money, approvals, who gets
  through, what may be dialed: rows and code. The prompt says how the agent
  talks, never what the agent may do.
- **Prompt assets are frozen text.** No date, no name, no id inside the static
  body, so the system prompt is a stable cache prefix. Per-call values arrive as
  variables.
- **Persona first, rules second, guidelines last.** Who the agent is, then the
  rules in short labelled sections, then the communication guidelines at the
  bottom.
- Keep one guidelines file for calls with your own user and a separate one for
  calls with a stranger (a company the agent phones, or someone phoning in).
  They sound different.

---

## 2. The shape of a voice prompt (structure a four-year-old could follow)

A speech model does not read a prompt the way a text model does. It follows the
most recent, the most concrete, and the most repeated thing. It copies sample
phrases word for word. It fills silence with words unless told what silence is
for. So the prompt is built like this, in this order:

1. **Who you are, in three lines:** the name, whose side you are on, what kind
   of person you sound like. ("You are X. You run this person's errands for
   them. A capable friend who happens to handle their admin.")
2. **One job, one sentence,** at the top of a task prompt: "YOUR ONE JOB: get
   the answer. Never hang up empty."
3. **Steps, numbered, in the order they happen on the call:** greet and say why;
   let them collect the info (they drive, you answer); get the thing; confirm
   the numbers as you go; get the name and the reference number; save; close.
   One step, one heading. Under each, one rule per line.
4. **The rule that overrides the others, in capitals, once:** "THE USER NEVER
   DOES YOUR THINKING FOR YOU." "DO NOT SPEAK TO PEOPLE" (a menu agent).
   Capitals are for the one rule that must win. A prompt full of capitals has
   none.
5. **Every branch as its own heading, named by what the model will hear:** "ID
   REJECTED: the system heard the ID but says it cannot find it", "IF THEY SAY
   YOU NEED TO CALL A DIFFERENT NUMBER", "IF ASKED WHETHER YOU ARE A PERSON".
   The model finds the branch by the words it just heard.
6. **The communication guidelines at the bottom.** The bottom is what a speech
   model has most recently read when it starts to speak.
7. **Output, last line:** everything is spoken aloud; plain sentences, no lists,
   no symbols.

Rules for every line:
- One rule, one line, one idea. No "and also". No paragraph.
- Concrete words the model can match to what it hears: "when they say hold on,
  give me a minute, one moment, let me check". Not "when appropriate".
- Say what to do, then what not to do, then why in a parenthesis when the why is
  a real event ("heard on a test call, <date>"). The why keeps the next editor
  from undoing it.
- **Sample phrases are the register, never the line.** Say so in the prompt
  ("the phrases here show the register; they are not lines to use"), give
  several of each, never one. A first live call repeated "One sec" and "I'm on
  it, keep going" word for word because the prompt gave one sample of each.
- Numbers, money, dates: say exactly how they are spoken ("eighty-one
  seventy-one"; IDs digit by digit; addresses like a person, the ZIP as digits).
- Nothing visual: no markdown the model might read aloud, no bullets in what it
  is told to say.

---

## 3. How it sounds human (the guidelines, and why each line exists)

- **Say less.** The right answer to the other side working, reading, or pausing
  is silence. "Okay", "Sure", "Got it", "Perfect", "No problem" are the fillers
  that sound robotic (heard on a test call: "Sure. Take your time" over and over).
- **Answer only what was asked.** "Can I get your name?" gets the name, not the
  name plus the company plus the reason. The info-dump is a script tell.
- **Never the same sentence twice.** Said three times, it sounds recorded.
- **Never leave a direct question hanging.** Silence after a question is the
  loudest tell. Someone said "hello?" into it and hung up.
- **Never go silent after "are you a person?"** First time: light, and moving
  on. Second time: honest ("I'm an automated assistant calling for a customer of
  yours") plus a reason to keep going. Then: a supervisor, an offer to hold,
  "it's routine". Never claim to be human. Never promise a person will call back
  unless that is actually arranged.
- **React like a person when tested.** A joke name, a nonsense figure: a light,
  amused double-check, never blind recording of it.
- **Silence while the other side works,** for at least two minutes. One "still
  here whenever you're ready" after that, never twice.
- **Talking over each other:** stop mid-sentence, listen, answer the new
  question. Never finish the half-said sentence a few words at a time.
- **To a machine, say nothing you would say to a person.** "I'll hold" said to a
  hold recording is a bizarre line on the transcript. Answer a menu with the
  digit or the exact option word, never a sentence.
- **Hedge a little.** "Let me see...", "um, one sec", "I think that's... yeah."
  Slick and over-confident is the giveaway; a touch of imperfection is what
  makes it believable. The voice itself must carry emotion, so use the
  provider's newest expressive model. A slight accent on calls placed to
  companies can read as more human than flawless delivery.
- **Do not lead with what you already know.** Use it only when the other side
  raises it.

### Rulings from live calls (keep adding to this list in your own repo)

- **No "Got it".** On a live call the agent opened turn after turn with "Got
  it", also where it made no sense. The cause was a line of the prompt itself:
  "You react to what they just said before you answer it. A word is enough." A
  speech model turns "a word" into the same word every time. **Never tell a
  voice model to acknowledge.** Tell it to start with the answer, and list the
  filler words it may not open with.
- **The agent never hands the thinking back.** No "which first?", no "what
  should I look at?". It decides, says why in a phrase, and starts. The one
  allowed question is a yes or no before money or anything irreversible.
- **"Pay it" is one yes.** The agent pays and says so in one sentence. It does
  not ask again and does not read out the ways to pay.
- **One line before the work, then a working sound.** "Give me a minute while I
  check that", then a typing sound until it is back. Never "still working",
  never "almost there".
- **No dead silence on the line, ever, and no repeated phrase.** (Silence while
  the OTHER side works is right; silence while YOUR side works needs the
  working sound.)
- **The voice, the room tone and the typing come from the providers,** the
  newest they have, never hand-made. The owner's ear decides. An agent never
  declares a sound "good".
- **A result is said once,** in the agent's own words, at the next natural
  point, never mid-sentence.

---

## 4. Getting through a company's phone menu (the menu phase)

A menu agent has one job, reach a person, and it talks only to machines. Each
rule is from a real failure:

- Every digit goes through the keypad tool. "Pressing one" said aloud does nothing.
- A voice menu gets the short option word, never a sentence ("I'm a provider" to
  "say yes or press one" loops forever).
- A recording gets nothing at all: an empty reply. Stage directions
  ("(waiting)", "[silence]") are read ALOUD by the voice, so never write them.
- A menu that lists options is a question. Answer it when it finishes. Language
  first, then the department, then a person. Letting a menu repeat three times
  is a failure.
- Never the same thing more than twice. Then the next rung of the ladder: the
  option word, "representative", 0, the department's other name.
- Check the read-back of any number entered, digit by digit. Tones get dropped.
  Re-enter in two chunks before concluding anything.
- Ignore optional offers (a survey, a fax). Hang up at once on a wrong number or
  a robocall.
- Patience through holds and transfers. Hold music is not a person.
- The instant a person or a helpful bot speaks: stop being the menu agent, be
  the caller.

The path per company and department should be LEARNED from calls and stored as
a shared row. Build the menu plan per call at dial time from that row, the
user's own directions, and the goal. Never hand-write it, never store it as a
prompt.

---

## 5. What a speech model does that a text model does not (design for it)

- **It speaks the sample.** Give several samples or none.
- **It fills a pause.** Tell it what the pause is (the typing, the other side
  working) and that silence is the answer.
- **It reads the last thing best.** The guidelines and the output rule go at the
  bottom.
- **It takes a short answer wrong.** On money and security, say back what was
  understood before acting. Never take an unclear answer as a yes.
- **It reads what it sees.** No markdown, no digits it would read as a number,
  no symbols.
- **It mispronounces names from their spelling.** Where the model reads the name
  in its instructions, say in one line how it is pronounced. Where text is
  turned straight into speech (a pre-made greeting, a voice note), respell the
  name phonetically AT THE SPEECH BOUNDARY ONLY (one `spokenForm` helper);
  everywhere a person reads, the brand spelling stays. A pronunciation
  dictionary on the voice is the clean fix when the TTS provider supports one.
- **It hears the room.** Raw audio with turn-taking by loudness (server VAD)
  lets a television or a car cut it off and get answered. Clean the caller's
  audio with the model's own noise reduction and detect the end of a turn by
  what was said (semantic VAD). Make both settings, not code.
- **It does not know the time.** Give it the local time of the other side when
  the greeting matters.
- **It cannot tell a machine from a person by itself.** Name the three kinds it
  may reach (a menu, a person or a helpful bot, an unhelpful machine) and the
  one question that tells them apart: "can this do what the call is for?"
- **It is a fresh mind each turn.** It must never be handed a decision to make
  from a variable you already know. See section 7.

---

## 6. How a change is verified

- A test proves the rule is in the text and in the right place. It cannot prove
  the model keeps it.
- **Every change is heard on a real call before it is called done.** The owner
  listens, or you read the transcript of a call the owner agreed to open.
- A finding from a call becomes ONE line in the guidelines file with its date
  and what happened, never a code change, so nobody undoes it without knowing why.
- Do not place a live call from a builder session on your own initiative. The
  owner's own call is the proof.

---

## 7. Porting an owner's finished prompt into code (the faithful-port discipline)

When the owner hands you a prompt they already perfected by hand (in a workflow
tool, a doc, the provider dashboard), your job is NOT to write or improve it.
Your job is to **copy the exact text into the repo and translate only the
variables** so they resolve to the same output the old system produced.

### RULE 1: copy byte-for-byte. Never rewrite.

Do NOT reword. Do NOT "improve". Do NOT de-duplicate. Do NOT add sections. Do
NOT remove sections. Do NOT fix grammar, spacing, capitalization, or trailing
spaces. A line with a trailing space and a lowercase start goes in EXACTLY like
that.

The ONLY thing you may change is the **syntax of a variable expression**, and
only so it resolves to the same output value in this repo. The owner does not
care how the variable looks in the file; they care that the resolved output is
identical.

**Never invent content.** The bug that created this rule: a developer "rewrote"
an opening prompt, adding a greeting, a "current call context" block and extra
advice, and changing the role, none of which the owner wrote. That is the
cardinal sin. If it is not in the owner's pasted text, it does not go in the file.

If something looks genuinely wrong or missing in the owner's text, do NOT fix
it. Ask. They decide.

### RULE 2: the agent must NEVER see a decision.

A voice agent is a fresh mind each turn. It must never read an "if this, else
that". Every decision that can be answered from a variable you ALREADY know is
resolved BEFORE the prompt reaches the agent. The agent sees exactly ONE flat,
already-decided instruction: never the condition, never the variable name,
never the other branch.

Flags like `account_exists` or `has_pending_order` are decision INPUTS. They
must not appear as text in the rendered prompt. The template holds a ternary;
the renderer evaluates it and emits ONLY the chosen branch:

```
{{ account_exists == 'true' ? 'Transfer to the order agent...' : '<the whole new-account block>' }}
```

- true: the agent sees only `Transfer to the order agent...`
- false: the agent sees only the new-account block, with nothing about accounts existing.

The value may live in the outgoing payload. It must never live in the prompt
the agent reads.

**Nested decisions must ALSO fully resolve.** If the chosen branch itself
contains a decision, that inner one is pre-resolved too. Nested expressions are
the number one place a decision leaks through as raw text.

### RULE 3: every variable is one of exactly two buckets.

**Bucket A, RESOLVED (baked in before sending).** The value is known at call
start from your DB or the phone lookup: the business name, the account flags,
the tenant, the ZIP. Write it as an expression the renderer evaluates, so the
agent sees the literal value or the resolved branch. NO braces survive into
what the agent reads.

**Bucket B, PASSTHROUGH (kept as a live provider variable).** The value is
filled by the voice platform at runtime, or updated mid-call: the caller's name
once learned, the platform's current-time variable. These must survive verbatim
into the platform so it binds its own runtime variable. With a `{{ }}` renderer
that means an expression that evaluates to the literal braces:

```
{{ "{{caller_name}}" }}        renders to        {{caller_name}}
```

NEVER resolve a passthrough. NEVER reformat it. Why: the value may be set or
updated in the middle of a call and the platform populates it live. Resolve it
on your side and that live update is impossible.

**How to tell them apart.** "Do we know this value from the database or the
phone the moment the call starts?" is Bucket A. "Does the platform fill this, or
is it set live during the call?" is Bucket B. When unsure, ASK THE OWNER.

### Translating variables from the old system

The owner's text will be full of the old system's references (a workflow node
path ending in a key, for example). That node does not exist in the repo. What
matters is the VALUE it resolved to, which in the repo is computed by one
call-start function. The reference's container name is irrelevant; only the
trailing key matters. A renderer that matches on the trailing key lets you
paste the owner's expression nearly as-is.

If a variable the prompt needs is not yet emitted by call start, STOP and tell
the owner. The backend contract and the prompt move together. Do not fake it.

### Renderer traps (each silently produces a prompt that leaks a decision)

- **Trap 1: nested `{{ }}` inside an outer `{{ }}`.** A naive renderer closes
  the OUTER expression at the FIRST inner `}}`, mis-parses the ternary, and
  dumps the rest of the block as raw literal text with a dangling fragment at
  the end. Fix one of two ways (the output is what matters, not the method):
  preferred, make the renderer brace-depth aware once (an inner `{{` increments
  depth; the end is the `}}` at depth 0), which fixes nesting for EVERY prompt;
  or pre-resolve the inner decision in the same pass so no nesting is needed.
- **Trap 2: a foreign expression syntax is NOT evaluated.** If the old tool used
  `${ }` inside template strings and your renderer only evaluates `{{ }}`, a
  pasted `${ ... ? ... : ... }` reaches the agent as a whole broken ternary.
  Translate it into the resolving form.
- **Trap 3: a stray or wrong container name in the old reference is harmless**
  when resolution is by key. Do not "fix" it.
- **Trap 4: the passthrough must DECODE, not resolve.** Confirm it survives
  verbatim as live braces.
- **Trap 5: a ternary that "looks right" in the file is not proof.** Only the
  rendered output is proof.

### ALWAYS test the render before claiming it works

Run the ACTUAL renderer against the ACTUAL block for EVERY combination of the
driving variables and read the output with your own eyes. For two boolean
flags that is four renders. Confirm each output contains exactly the expected
single instruction and NONE of the other branch: no variable names, no `? :`,
no stray braces or backticks.

### Workflow for porting one prompt

1. Get the owner's exact pasted text. That is the source of truth.
2. Go section by section, top to bottom. Static text: copy verbatim, spacing
   and casing included. Passthrough variable: keep the passthrough form.
   Resolved variable or ternary: write it so the renderer evaluates it to the
   same output, and confirm call start emits the driving variable.
3. For every decision, TEST that the agent sees only the resolved branch. Watch
   nested decisions especially.
4. Do NOT write the file until the owner approves the section. They review
   section by section. Assemble approved sections and write once at the end
   unless told otherwise.
5. Note any new call-start variable the port depends on, for the backend.

**What the owner reviews and what they do not.** The owner reviews the
agent-specific text (identity, role, the flow): their hand-crafted content.
Shared boilerplate at the end (tool-response safety, human transfer,
communication guidelines, output) should be identical across agents: keep ONE
canonical copy and paste it verbatim. If the owner's pasted text includes
boilerplate that differs from the canonical copy, ASK. Do not silently pick one.

When a prompt is ported from another system, also strip references to tools
that do not exist on the new agent, with the owner's approval: an agent told to
call a tool it does not have tries anyway and the call fails.
