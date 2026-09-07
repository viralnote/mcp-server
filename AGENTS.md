# AGENTS.md — @viralnote/mcp-server

Instructions for AI coding agents working on this repository, plus the
runtime facts an agent needs to use the server it produces.

## What this is

A stdio Model Context Protocol server (`npx -y @viralnote/mcp-server`) that
exposes the ViralNote social media API as MCP tools: create, schedule, and
publish posts to TikTok, Instagram, YouTube, X, Threads, LinkedIn, Facebook,
Pinterest, Bluesky, and Reddit; import media; read analytics; manage
webhooks. The hosted Streamable-HTTP equivalent lives at
`https://dashboard.viralnote.app/api/mcp/mcp` (OAuth one-click connect or
API key) and is the recommended path for clients that support it.

## Commands

```bash
npm install
npm run dev        # tsx src/index.ts (needs VIRALNOTE_API_KEY)
npm run build      # tsc -> dist/
npm start          # node dist/index.js
```

Smoke-test with the MCP inspector: `npx @modelcontextprotocol/inspector node dist/index.js`.

## Conventions

- `src/index.ts` is the whole server. Tool names, descriptions, and input
  schemas must stay identical to the hosted server's
  (`https://dashboard.viralnote.app/.well-known/mcp/server-card.json`);
  the card is the source of truth when they drift.
- Every tool call is a thin wrapper over one REST endpoint documented at
  `https://www.viralnote.app/openapi.json`. Do not add business logic here.
- Errors from the API are JSON `{ error: { code, message }, requestId }`.
  Surface `code` and `message` verbatim in the tool result; never swallow
  `payment_required` (it carries an `upgrade` URL the user needs).
- Bump `version` in `package.json` and `server.json` together; the
  registry entry `io.github.viralnote/mcp-server` is generated from
  `server.json`.
- Keep `.mcp.json` and `.cursor-plugin/plugin.json` in sync with the
  install snippet in `README.md`.

## Auth for the running server

`VIRALNOTE_API_KEY` (`vnd_...`) from https://dashboard.viralnote.app/developers/auth.
Scopes: `posts:read`, `posts:write`, `posts:publish`, `webhooks:manage`,
`credits:read`, `credits:write`. Full walkthrough: https://www.viralnote.app/auth.md

## Related

- Agent skill (SKILL.md): https://github.com/viralnote/viralnote-skill
- Claude Code plugin: https://github.com/viralnote/claude-plugin
- Docs for agents: https://www.viralnote.app/llms.txt · https://www.viralnote.app/agent.json
