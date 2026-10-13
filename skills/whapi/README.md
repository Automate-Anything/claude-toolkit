# WHAPI Agent Skill - Contributor Guide

This skill contains WHAPI WhatsApp API guidance optimized for AI agents and LLMs.
It follows the [Agent Skills Open Standard](https://agentskills.io/).

## Skill Structure

```
whapi/
├── SKILL.md           # Agent-facing skill manifest - read this first
├── AGENTS.md          # Navigation guide for AI agents
├── CLAUDE.md          # Alias → AGENTS.md (for Claude Desktop)
├── README.md          # This file (for human contributors)
└── references/
    ├── _template.md       # Template for new reference files
    ├── _sections.md       # Section (category) definitions
    ├── _contributing.md   # Writing guidelines
    └── *.md               # Individual reference files
```

## Reference File Naming Convention

Each reference file is prefixed by its category:

| Prefix          | Category          | Impact   |
|-----------------|-------------------|----------|
| `core-`         | Core Concepts     | CRITICAL |
| `msg-`          | Messaging         | CRITICAL / HIGH |
| `recv-`         | Receiving         | CRITICAL / MEDIUM |
| `groups-`       | Groups            | HIGH |
| `channels-`     | Channels          | HIGH |
| `communities-`  | Communities       | MEDIUM |
| `pattern-`      | Integration Patterns | HIGH / MEDIUM |

## Creating a New Reference

1. Copy the template:
   ```
   cp references/_template.md references/core-your-topic.md
   ```

2. Fill in the frontmatter (title, impact, tags).

3. Write the content following these principles:
   - Show the **incorrect** example first, then the correct one
   - Include an **Anti-hallucination** section listing parameters that do NOT exist
   - Quantify the impact when possible ("causes 400 error", "breaks webhook delivery")
   - Keep examples self-contained and runnable

4. Add the file to `AGENTS.md` under the correct section.

## Writing Guidelines

See `references/_contributing.md` for detailed guidelines.

## References

- https://whapi.readme.io/reference
- https://support.whapi.cloud/help-desk
