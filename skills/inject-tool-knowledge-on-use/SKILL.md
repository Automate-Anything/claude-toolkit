---
name: inject-tool-knowledge-on-use
description: A design principle for building AI agents. When a tool has a special, non-obvious or easy-to-get-wrong way it must be used, do NOT keep that how-to in the agent's always-on system prompt (the brain). Intercept the agent at the moment it reaches for the tool, hand it the how-to, and let the corrected call through, or have the software layer build the payload from the agent's intent. Includes the frequency-and-length rule for deciding prompt vs inject-on-use, and the rule to always build the software backstop even when the knowledge lives in the prompt. This is a pattern to BUILD per repository. Read it when designing any agent tool, capability or message path, when deciding where a how-to or an API shape belongs, when a system prompt is getting long, or when an agent keeps getting a tool's format wrong. Use when the user mentions a bloated system prompt, tool instructions, "the agent keeps formatting it wrong", "where should this instruction go", a skill that must be read before a tool call, tool-call interception, or WhatsApp interactive buttons and lists.
---

# Inject tool knowledge at the moment of use, not in the brain

> ## ADAPT BEFORE USE: THIS IS A PATTERN, NOT INSTALLED CODE
> This describes how tool knowledge SHOULD be delivered to an agent. It is taken from a
> production assistant and stripped of that product's names. The interception mechanism
> does not exist in your repo until you build it. Once it does, update this skill with the
> real location of the hold/inject hook and the list of tools it governs.

A design principle for the people and agents BUILDING an AI agent.

## The principle

When there is a special, non-obvious or easy-to-get-wrong way to use a tool, the knowledge
of HOW to use it does not belong in the agent's always-on system prompt. It belongs at the
moment the agent reaches for the tool. The system intercepts the attempt, hands the agent
the how-to, and lets the corrected call through. The brain stays lean; the know-how
arrives exactly when it is relevant and never a moment before.

This is the same mechanism as a skill marked "read before": a governed tool call is HELD,
the skill body is injected, and the agent retries after reading. Generalize it: ANY
special tool usage can be taught this way, not only full skills.

## Why

The brain's context is precious and load-bearing (context is the moat). Filling it with
"here is the exact JSON for an interactive message" and fifty other tool mechanics makes
the agent slower and dumber and buries what matters. The agent does not need to carry
that; it needs it only in the instant it sends that kind of message. Delivering it on use
keeps the brain focused on judgment and keeps the mechanics reliable: the instruction is
delivered fresh every time, never half-remembered.

## The worked example (interactive messages on a messaging platform)

The agent decides "this is a multiple-choice question" or "this is a list of items". It
does NOT know the platform's API shape.

When it sends a message whose content is a list (more than one line starting with a
number), the send path notices and intercepts: "You are sending a multiple-choice list.
Use the interactive mechanism: reply buttons for a yes/no, or a list message for multiple
items, inside the platform's messaging window; an approved door-opener template outside
it." The agent re-sends in the right shape, **or better, the channel layer builds the
payload from the agent's intent**: it turns the numbered reply into buttons or a list on
the fly, and a tap comes back to the agent as the number.

The rules that fall out of it:
- **An agent NEVER writes the platform's API JSON.** The agent only DECIDES "this is a
  list" or "this is a yes/no". The channel layer builds the shape.
- **Numbered text is the universal floor on every channel.** The interactive shape is an
  enhancement where the platform allows it. If the enhancement fails, the numbered text
  still works.
- The words after the list always go as their own text.
- Outside the platform's window, the message is held and the door is a template.

The API JSON never lived in the brain.

## How to decide: inject on use vs the prompt

The deciding factors are FREQUENCY and LENGTH:

- **Rare + long instructions -> inject on use (software).** It is cheap to interrupt the
  agent once in a while, and too expensive to carry a long, rarely needed how-to in the
  brain always.
- **Used all the time -> put it in the prompt.** If the tool is used constantly, stopping
  to inject every single time is the bigger waste; the agent should just know it.

So: frequent use leans to the prompt, rare-and-long leans to inject on use. **When
genuinely unsure, lean inject on use.** A lean brain is worth more than saving one
interception.

## Always build the software backstop, even when it lives in the prompt

Even when a thing is decided to live in the prompt, STILL build the software interception
as a safety net. The agent should get it right from the prompt almost every time, so the
software rarely fires, but it is there for the time the agent forgets.

We do not RELY on the software (the prompt handles the common case), but the software
guarantees the floor. Same philosophy as the whole system: **the agent does the judgment,
software guarantees nothing slips.** Belt and suspenders.

The same reasoning is why formatting rules ("no long dashes, no bold, no AI filler") are
enforced by a deterministic strip in the send function, not only by a line in the prompt:
a prompt instruction fails often enough to matter, and code never does.

## The general rule for the build

| What it is | Where it lives |
|---|---|
| Tool mechanics, API shapes, step-by-step procedures | Injected at use: a skill held before the tool call, or a lighter interception, or built by the software layer from the agent's intent |
| Judgment, personality, the person's rules and context | In the brain, or fetched as memory |
| Facts the database already holds | Resolved by software before the turn and handed to the model, never fetched by a tool call |

Never put the how-to-operate-a-tool in the brain when it can be thrown to the agent at the
moment it tries to use the tool.

## Lifetime of injected knowledge

- The full how-to lives with the agent that is doing the work (a sub-agent, the hands) for
  the life of the task.
- A coordinating agent (a manager) keeps only a one-line pointer and has the worker
  re-read the how-to if the matter returns.
- Injected skill text ages out of the prompt after a while without use (about two hours
  in the source system); a re-read keeps it warm. It is never stuck in history forever
  and never gone mid-task.

## Checklist when you add or change a tool

1. Does using it correctly require knowledge the agent would not guess? If no, a good
   tool description is enough.
2. Is the how-to rare and long, or constant and short? Rare and long -> inject on use.
   Constant -> the prompt.
3. Can software build the payload from the agent's INTENT instead of teaching the agent
   the shape at all? If yes, do that; it is the strongest version.
4. Build the backstop regardless: detect the wrong shape at the send or call site, and
   either correct it or hold and inject.
5. Make sure there is a universal floor that works when the enhancement is unavailable.
6. Keep the skill header short, clear and findable, so the agent knows the how-to exists.
