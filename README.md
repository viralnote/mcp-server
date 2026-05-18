# @viralnote/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server for the **ViralNote** social media API.

Plug it into Claude Desktop, Claude Code, Cursor, or any other MCP-aware host and your agent can schedule posts, manage media, and read analytics across X, Instagram, Facebook, TikTok, LinkedIn, YouTube, Pinterest, Bluesky, Threads, and Reddit — as native MCP tool calls. No glue code.

## Install

### Claude Desktop / Claude Code / Cursor

Add to your MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, similar on other platforms):

```json
{
  "mcpServers": {
    "viralnote": {
      "command": "npx",
      "args": ["-y", "@viralnote/mcp-server"],
      "env": {
        "VIRALNOTE_API_KEY": "vn_live_..."
      }
    }
  }
}
```

Restart your MCP host. The ViralNote tools will be available immediately.

### Local install

```bash
npm install -g @viralnote/mcp-server
```

Then reference `viralnote-mcp` directly in your MCP config:

```json
{
  "mcpServers": {
    "viralnote": {
      "command": "viralnote-mcp",
      "env": { "VIRALNOTE_API_KEY": "vn_live_..." }
    }
  }
}
```

## Configuration

| Env var | Required | Default | Notes |
|---|---|---|---|
| `VIRALNOTE_API_KEY` | yes | — | Generate at [viralnote.app/developers/auth](https://viralnote.app/developers/auth). Grant `posts:read`, `posts:write`, plus `webhooks:*` if your agent should manage webhooks. |
| `VIRALNOTE_API_BASE` | no | `https://viralnote.app/api/v1` | Override for staging/self-hosted instances. |

## Tools exposed

| Tool | Purpose |
|---|---|
| `list_posts` | List posts (filter by status/platform, paginated) |
| `get_post` | Read one post including per-platform publish results |
| `create_post` | Create a draft (`is_draft: true`) or scheduled post |
| `update_post` | Update a draft or scheduled post |
| `delete_post` | Delete (cancels if scheduled) |
| `publish_post` | Publish a draft now |
| `list_media` | List media library items |
| `import_media` | Import by URL (200MB) or base64 data (3MB) |
| `delete_media` | Delete a media item |
| `list_social_accounts` | List connected social accounts |
| `list_analytics` | Published posts with per-platform metrics |
| `list_post_results` | Per-platform delivery results (success/error) |
| `list_webhooks` | List webhook subscriptions |
| `create_webhook` | Subscribe to events |
| `delete_webhook` | Unsubscribe |

For most users, the **HTTP MCP server at `https://viralnote.app/api/mcp/mcp`** is simpler than installing this stdio package — see https://viralnote.app/developers/mcp for the HTTP config snippet. Use this stdio package when your MCP client doesn't support HTTP transport.

The underlying REST endpoints and request/response shapes are documented at [viralnote.app/developers/docs](https://viralnote.app/developers/docs).

## Example agent prompts

> "Show me my last 5 scheduled posts."
> Tool: `list_posts` with `{ status: "scheduled", limit: 5 }`.

> "Schedule this caption to Instagram for tomorrow at 9am, attaching the photo I uploaded yesterday."
> Tools: `list_media` → find item → `create_post` with `{ platforms: ["instagram"], caption, libraryItemId, scheduledFor, status: "scheduled" }`.

> "Pull this Dropbox link into my library, then publish it to X immediately."
> Tools: `import_media` → `create_post` (draft) → `publish_post`.

## Development

```bash
git clone https://github.com/viralnote/mcp-server
cd mcp-server
npm install
npm run build
VIRALNOTE_API_KEY=vn_live_... npm start
```

For local iteration without rebuilding:

```bash
VIRALNOTE_API_KEY=vn_live_... npm run dev
```

## License

MIT — see `LICENSE`. Pull requests welcome.
