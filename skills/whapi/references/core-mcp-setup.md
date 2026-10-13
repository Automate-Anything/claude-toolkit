---
title: Setting Up the WHAPI MCP Server
impact: CRITICAL
impactDescription: Without correct MCP configuration, no WHAPI tools are available to the AI agent
tags: mcp, setup, cursor, claude, npm, npx, api-token, whapi-mcp
---

## Setting Up the WHAPI MCP Server

WHAPI provides the `whapi-mcp` npm package - a full-featured MCP server with 165 tools
covering all API capabilities: messaging, groups, channels, communities, commerce, stories, and calls.
The API token from your WHAPI channel dashboard is required.

---

### Quick Run (no permanent installation)

Try WHAPI MCP immediately without adding it to your config:

**PowerShell:**
```powershell
$env:API_TOKEN="YOUR_TOKEN"; npx -y whapi-mcp@latest
```

**Bash / macOS / Linux:**
```bash
API_TOKEN="YOUR_TOKEN" npx -y whapi-mcp@latest
```

Requirements: Node.js 18 or newer must be installed.

---

### Installation - Cursor

Add to `%USERPROFILE%\.cursor\mcp.json`:

```json
{
  "mcpServers": {
    "whapi-mcp": {
      "command": "npx",
      "args": ["-y", "whapi-mcp@latest"],
      "env": { "API_TOKEN": "YOUR_TOKEN" }
    }
  }
}
```

---

### Installation - Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "whapi-mcp": {
      "command": "npx",
      "args": ["-y", "whapi-mcp@latest"],
      "env": { "API_TOKEN": "YOUR_TOKEN" }
    }
  }
}
```

---

### Where to Get Your API Token

1. Register or log in at [panel.whapi.cloud/dashboard](https://panel.whapi.cloud/dashboard)
2. Open your channel
3. Copy the **Token** from the channel settings page

The token is channel-specific - each WHAPI channel has its own token.

> **Important:** The token only works after a WhatsApp number is connected to the channel.
> If you just created the channel, pair your WhatsApp number first:
> [Pair your number - Getting Started Guide](https://support.whapi.cloud/help-desk/getting-started/getting-started#pair-your-number)

---

### Token is Missing or Invalid (404 error)

If `checkHealth` returns 404 ("Channel not found"), or API calls fail with channel errors:

1. Open [panel.whapi.cloud/dashboard](https://panel.whapi.cloud/dashboard)
2. Select your channel
3. Verify the token is copied correctly (no extra spaces)
4. Verify a WhatsApp number is connected to the channel
   - If not connected: follow the [pairing guide](https://support.whapi.cloud/help-desk/getting-started/getting-started#pair-your-number)
5. Update `API_TOKEN` in your MCP config and restart the client

---

### Testing the Connection

After configuration, restart Cursor or Claude Desktop.
Then call the health check tool to confirm everything works:

```json
// Tool: checkHealth
// No arguments required
// If the channel is connected and operational, status.text will be "AUTH"
// For full status meaning, see the Prerequisites table in SKILL.md
```

---

**Anti-hallucination - configuration fields that do NOT exist:**
- `token` env variable - the correct variable name is `API_TOKEN`
- `WHAPI_TOKEN` - the correct variable name is `API_TOKEN`
- `apiKey` env variable - use `API_TOKEN`
- `BASE_URL` env variable - not required, the MCP uses the default WHAPI endpoint
- `whapi-mcp-core` - this package does not exist; use `whapi-mcp`
- `whapi-mcp-optimal` - this package is deprecated; use `whapi-mcp`

Reference: [MCP Integration Guide](https://support.whapi.cloud/help-desk/integrations/mcp-model-context-protocol)
