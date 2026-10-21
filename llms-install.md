# Install ViralNote in Cline

ViralNote connects an AI client to the user's own social media workspaces. Use
the hosted Streamable HTTP server when possible. No local server build is
needed for this connection.

## Recommended: hosted server with OAuth

1. In Cline, open **MCP Servers**, then **Remote Servers**.
2. Add a server named `viralnote` with URL
   `https://dashboard.viralnote.app/api/mcp/mcp` and Streamable HTTP transport.
3. Connect and complete the OAuth flow in the browser. The user signs in to
   their own ViralNote account and authorizes the requested scopes. Do not
   request or store the user's password in chat or configuration.
4. Confirm the connection by listing the user's authorized brands and connected
   social accounts. Do not create or publish a social post as an installation
   check.

For the Cline CLI, start the setup wizard with:

```sh
cline mcp install viralnote --transport http https://dashboard.viralnote.app/api/mcp/mcp
```

Leave automatic approval disabled. Users should review the target accounts,
content, and schedule before approving publishing or other changes.

## Alternative: stdio package with an API key

Requirements: Node.js 18 or newer and an API key created by the user at
https://dashboard.viralnote.app/developers/auth. Ask the user to enter the key
privately in Cline's server environment settings.

```json
{
  "mcpServers": {
    "viralnote": {
      "command": "npx",
      "args": ["-y", "@viralnote/mcp-server@0.2.4"],
      "env": {
        "VIRALNOTE_API_KEY": "USER_ENTERS_KEY_PRIVATELY"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Never commit a real API key. Verify this connection with a read such as
`list_social_accounts` or `list_posts`.

## Account requirements and support

A ViralNote account is required. Reads and drafts are available without a paid
plan; scheduling and publishing require an active publishing entitlement.
Capabilities depend on the connected social providers and granted permissions.

- Documentation: https://www.viralnote.app/mcp
- Privacy: https://www.viralnote.app/privacy
- Support: info@viralnote.app
