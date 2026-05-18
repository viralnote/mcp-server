#!/usr/bin/env node
/**
 * ViralNote MCP server
 *
 * Exposes the ViralNote REST API as Model Context Protocol tools so that
 * Claude Desktop, Claude Code, Cursor, and any other MCP-aware host can
 * schedule posts, manage media, and read analytics directly.
 *
 * Install in your MCP config:
 *
 *   {
 *     "mcpServers": {
 *       "viralnote": {
 *         "command": "npx",
 *         "args": ["-y", "@viralnote/mcp-server"],
 *         "env": { "VIRALNOTE_API_KEY": "vnd_..." }
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.VIRALNOTE_API_BASE || "https://viralnote.app/api/v1";
const API_KEY = process.env.VIRALNOTE_API_KEY;

if (!API_KEY) {
  console.error("[viralnote-mcp] VIRALNOTE_API_KEY environment variable is required.");
  console.error("[viralnote-mcp] Generate a key at https://viralnote.app/developers/auth");
  process.exit(1);
}

type FetchResult = { status: number; data: unknown };

async function vnFetch(path: string, init: RequestInit = {}): Promise<FetchResult> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "x-api-key": API_KEY!,
      Accept: "application/json",
      ...(init.body && !((init.headers as Record<string, string>) || {})["Content-Type"]
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }
  return { status: res.status, data };
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: asText(data) }] };
}

function err(status: number, data: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `ViralNote API error ${status}\n${asText(data)}`,
      },
    ],
  };
}

const server = new Server(
  { name: "viralnote", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// Tool catalog — kept in one place so it's easy to scan and grow.
const tools = [
  {
    name: "list_posts",
    description:
      "List the user's posts. Filter by status (draft, scheduled, publishing, published, failed) and/or platform. Paginated.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "scheduled", "publishing", "published", "failed"] },
        platform: { type: "string", description: "e.g. instagram, twitter, tiktok" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        cursor: { type: "string", description: "Pagination cursor from a previous response" },
      },
    },
  },
  {
    name: "get_post",
    description: "Read one post by id, including its per-platform publish results.",
    inputSchema: {
      type: "object",
      properties: { postId: { type: "string" } },
      required: ["postId"],
    },
  },
  {
    name: "create_post",
    description:
      "Create a draft or scheduled post. Pass is_draft=true to save as draft (no schedule). Otherwise set scheduledFor (ISO 8601 UTC) to schedule. Use libraryItemId for single media or mediaIds for carousels (max 10).",
    inputSchema: {
      type: "object",
      properties: {
        caption: { type: "string" },
        platforms: { type: "array", items: { type: "string" }, minItems: 1 },
        libraryItemId: { type: "string", description: "Single media item id" },
        mediaIds: { type: "array", items: { type: "string" }, description: "For carousels" },
        scheduledFor: { type: "string", description: "ISO 8601 UTC timestamp" },
        is_draft: { type: "boolean", default: false, description: "Convenience: true sets status='draft'. False (and with scheduledFor) sets status='scheduled'." },
        status: { type: "string", enum: ["draft", "scheduled"], description: "Explicit status. Overrides is_draft if both passed." },
      },
      required: ["platforms"],
    },
  },
  {
    name: "update_post",
    description: "Update a draft or scheduled post. Pass only the fields you want to change.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string" },
        caption: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
        libraryItemId: { type: "string" },
        mediaIds: { type: "array", items: { type: "string" } },
        scheduledFor: { type: "string" },
        status: { type: "string", enum: ["draft", "scheduled"] },
      },
      required: ["postId"],
    },
  },
  {
    name: "delete_post",
    description: "Delete a post (cancels it if scheduled). Irreversible.",
    inputSchema: {
      type: "object",
      properties: { postId: { type: "string" } },
      required: ["postId"],
    },
  },
  {
    name: "publish_post",
    description: "Publish a draft post immediately. Skips the schedule queue.",
    inputSchema: {
      type: "object",
      properties: { postId: { type: "string" } },
      required: ["postId"],
    },
  },
  {
    name: "list_media",
    description:
      "List items in the user's media library. Filter by type (image, video, gif, clip) and folder. Paginated.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["image", "video", "gif", "clip"] },
        folder: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        cursor: { type: "string" },
        sort: { type: "string", enum: ["newest", "oldest"], default: "newest" },
      },
    },
  },
  {
    name: "import_media",
    description:
      "Import a file into the library. Two modes: (1) by URL — pass `url` (HTTPS direct-download, 200MB cap, e.g. Dropbox/Canva); (2) by base64 — pass `data` (raw bytes, 3MB cap) + `mimeType`. Use `source: 'direct'` for base64 uploads from agent memory.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["dropbox", "canva", "direct"] },
        url: { type: "string", description: "HTTPS direct-download URL (mutually exclusive with `data`)" },
        data: { type: "string", description: "base64-encoded file bytes, 3MB raw max (mutually exclusive with `url`)" },
        name: { type: "string" },
        mimeType: { type: "string", description: "Required when using `data`; optional with `url`" },
        bytes: { type: "integer", description: "Optional file size in bytes for early rejection" },
      },
      required: ["source", "name"],
    },
  },
  {
    name: "delete_media",
    description: "Delete a media library item. Irreversible.",
    inputSchema: {
      type: "object",
      properties: { mediaId: { type: "string" } },
      required: ["mediaId"],
    },
  },
  {
    name: "list_social_accounts",
    description: "List the social accounts the user has connected to ViralNote.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_analytics",
    description:
      "List published posts with their per-platform analytics (views, likes, comments, shares, engagement). Filter by platform. Note: ViralNote refreshes metrics periodically; this returns the latest collected values.",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string", description: "e.g. instagram, twitter" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        cursor: { type: "string" },
      },
    },
  },
  {
    name: "list_post_results",
    description:
      "List recent published or failed posts with per-platform delivery results (success or error per platform). Use to see which platforms a post landed on and what errors occurred.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Optional — restrict to one post." },
        status: { type: "string", enum: ["published", "failed"], default: "published" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: "list_webhooks",
    description: "List the user's webhook subscriptions.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_webhook",
    description: "Subscribe to ViralNote events (e.g. post.published, post.failed) at a URL you control.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        events: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["url", "events"],
    },
  },
  {
    name: "delete_webhook",
    description: "Delete a webhook subscription.",
    inputSchema: {
      type: "object",
      properties: { webhookId: { type: "string" } },
      required: ["webhookId"],
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs || {}) as Record<string, unknown>;

  switch (name) {
    case "list_posts": {
      const qp = new URLSearchParams();
      if (args.status) qp.set("status", String(args.status));
      if (args.platform) qp.set("platform", String(args.platform));
      if (args.limit) qp.set("limit", String(args.limit));
      if (args.cursor) qp.set("cursor", String(args.cursor));
      const r = await vnFetch(`/posts?${qp.toString()}`);
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "get_post": {
      const r = await vnFetch(`/posts/${encodeURIComponent(String(args.postId))}`);
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "create_post": {
      const { is_draft, ...rest } = args as Record<string, unknown>;
      const body: Record<string, unknown> = { ...rest };
      if (is_draft === true && !body.status) body.status = "draft";
      else if (rest.scheduledFor && !body.status) body.status = "scheduled";
      const r = await vnFetch("/posts", { method: "POST", body: JSON.stringify(body) });
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "update_post": {
      const { postId, ...patch } = args;
      const r = await vnFetch(`/posts/${encodeURIComponent(String(postId))}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "delete_post": {
      const r = await vnFetch(`/posts/${encodeURIComponent(String(args.postId))}`, { method: "DELETE" });
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "publish_post": {
      const r = await vnFetch(`/posts/${encodeURIComponent(String(args.postId))}/publish`, { method: "POST" });
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "list_media": {
      const qp = new URLSearchParams();
      if (args.type) qp.set("type", String(args.type));
      if (args.folder) qp.set("folder", String(args.folder));
      if (args.limit) qp.set("limit", String(args.limit));
      if (args.cursor) qp.set("cursor", String(args.cursor));
      if (args.sort) qp.set("sort", String(args.sort));
      const r = await vnFetch(`/media?${qp.toString()}`);
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "import_media": {
      const r = await vnFetch("/media/import", { method: "POST", body: JSON.stringify(args) });
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "delete_media": {
      const r = await vnFetch(`/media/${encodeURIComponent(String(args.mediaId))}`, { method: "DELETE" });
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "list_social_accounts": {
      const r = await vnFetch("/social-accounts");
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "list_analytics": {
      const qp = new URLSearchParams();
      qp.set("status", "published");
      if (args.platform) qp.set("platform", String(args.platform));
      qp.set("limit", String(args.limit || 20));
      if (args.cursor) qp.set("cursor", String(args.cursor));
      const r = await vnFetch(`/posts?${qp.toString()}`);
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "list_post_results": {
      if (args.postId) {
        const r = await vnFetch(`/posts/${encodeURIComponent(String(args.postId))}`);
        return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
      }
      const qp = new URLSearchParams();
      qp.set("status", String(args.status || "published"));
      qp.set("limit", String(args.limit || 20));
      const r = await vnFetch(`/posts?${qp.toString()}`);
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "list_webhooks": {
      const r = await vnFetch("/webhooks");
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "create_webhook": {
      const r = await vnFetch("/webhooks", { method: "POST", body: JSON.stringify(args) });
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    case "delete_webhook": {
      const r = await vnFetch(`/webhooks/${encodeURIComponent(String(args.webhookId))}`, { method: "DELETE" });
      return r.status >= 200 && r.status < 300 ? ok(r.data) : err(r.status, r.data);
    }
    default:
      return err(400, { error: { code: "unknown_tool", message: `Unknown tool: ${name}` } });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[viralnote-mcp] connected. Listening on stdio.");
