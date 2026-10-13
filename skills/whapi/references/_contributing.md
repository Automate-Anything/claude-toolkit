# Writing Guidelines for WHAPI References

## Key Principles

### 1. Error-First Structure

Always show the incorrect pattern first, then the correct one.
This trains agents to recognize what NOT to do before seeing the solution.

```markdown
**Incorrect (polling loop):**
[bad example]

**Correct (webhook):**
[good example]
```

### 2. Anti-Hallucination Section (Required)

Every reference file MUST include a list of parameters, fields, or tools
that DO NOT EXIST in the WHAPI API. This directly prevents AI from inventing
plausible-sounding but nonexistent parameters.

```markdown
**Anti-hallucination - parameters that do NOT exist:**
- `phone_number` - use `to` with full Chat ID format
- `message` - use `body` for text content
- `chat` - use `to` with Chat ID
```

### 3. Concrete Examples Only

Show exact JSON payloads, not abstract descriptions.
Always include the MCP tool name being used.

Good: `sendMessageText` with `{ "to": "...", "body": "..." }`
Bad: "call the send message function with the appropriate parameters"

### 4. Stability Warnings

If a feature is unstable or WhatsApp-dependent, say so explicitly.
Example: interactive buttons (`sendMessageInteractive`) may fail silently
depending on WhatsApp version - warn about this.

### 5. Quantified Impact

State what breaks when the rule is violated:
- "causes 400 Bad Request"
- "message is delivered but appears as audio, not voice note"
- "webhook events stop arriving"

### 6. Self-Contained Examples

Each example must be understandable without reading other files.
Include the MCP tool name, all required fields, and comments.

### 7. Impact Levels

| Level    | Description                                           |
|----------|-------------------------------------------------------|
| CRITICAL | Breaks the integration entirely; causes errors        |
| HIGH     | Causes wrong behavior, silent failures, data loss     |
| MEDIUM   | Suboptimal; degrades user experience or performance   |
