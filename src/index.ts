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
  { name: "viralnote", version: "0.2.3" },
  { capabilities: { tools: {} } }
);

// Platform ids accepted everywhere the API takes a platform name.
const PLATFORMS = [
  "twitter",
  "facebook",
  "instagram",
  "linkedin",
  "reddit",
  "youtube",
  "bluesky",
  "threads",
  "tiktok",
  "pinterest",
] as const;

// Tool catalog — kept in one place so it's easy to scan and grow.
const tools = [
  {
    name: "list_posts",
    description:
      "List the user's posts. Returns post objects with id, caption, status, target platforms, scheduled time, and attached media ids, plus a `cursor` field when more pages exist. Use this to find a post's id before calling get_post, update_post, delete_post, or publish_post, or to review upcoming scheduled content. For per-platform delivery outcomes or metrics, prefer list_post_results or list_analytics instead.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "scheduled", "publishing", "published", "failed"],
          description:
            "Filter by lifecycle state: draft (saved, no publish time), scheduled (queued for a future time), publishing (delivery in progress), published (delivered), failed (delivery errored). Omit to list all.",
        },
        platform: {
          type: "string",
          enum: [...PLATFORMS],
          description: "Only return posts that target this platform. Omit to include all platforms.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 20,
          description: "Maximum posts per page (1-50).",
        },
        cursor: {
          type: "string",
          description: "Opaque pagination cursor from the previous response. Omit for the first page.",
        },
      },
    },
  },
  {
    name: "get_post",
    description:
      "Fetch a single post by id, including its full per-platform publish results (success or error per platform). Use after list_posts to inspect one post in detail, or after publish_post to check how delivery went. Returns an error if the id does not exist or belongs to another account.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "The post's id, as returned by list_posts or create_post." },
      },
      required: ["postId"],
    },
  },
  {
    name: "create_post",
    description:
      "Create a new post as a draft or schedule it for automatic publishing. With status='draft' (or is_draft=true) the post is saved with no publish time; with scheduledFor set it is queued and publishes automatically at that time. Returns the created post object including its id. Media must already exist in the library — call import_media or list_media first to get a media id. The user must have connected each target platform (verify with list_social_accounts if unsure). To publish an existing draft immediately, use publish_post rather than creating a new post.",
    inputSchema: {
      type: "object",
      properties: {
        caption: {
          type: "string",
          description: "The post text, used for all target platforms. Platform-specific length limits apply at publish time.",
        },
        platforms: {
          type: "array",
          items: { type: "string", enum: [...PLATFORMS] },
          minItems: 1,
          description: "Platforms to publish to. Each must already be connected to the user's ViralNote account.",
        },
        libraryItemId: {
          type: "string",
          description: "Id of one media library item to attach (from list_media or import_media). Mutually exclusive with mediaIds.",
        },
        mediaIds: {
          type: "array",
          items: { type: "string" },
          description: "Media library item ids for a multi-image carousel post, up to 10. Mutually exclusive with libraryItemId. Platform support for carousels varies.",
        },
        scheduledFor: {
          type: "string",
          description: "When to auto-publish, as an ISO 8601 UTC timestamp (e.g. 2026-07-10T09:00:00Z). Must be in the future. Required for scheduled posts; omit for drafts.",
        },
        is_draft: {
          type: "boolean",
          default: false,
          description: "Convenience flag: true saves the post as a draft (status='draft'). False with scheduledFor set schedules it.",
        },
        status: {
          type: "string",
          enum: ["draft", "scheduled"],
          description: "Explicit lifecycle state. Overrides is_draft when both are passed.",
        },
      },
      required: ["platforms"],
    },
  },
  {
    name: "update_post",
    description:
      "Edit a draft or scheduled post before it publishes. Send only the fields to change — omitted fields keep their current values. Returns the updated post object. Posts that are already publishing, published, or failed cannot be edited. Common uses: reschedule by passing a new scheduledFor, fix a caption, swap attached media, or convert a draft to scheduled by passing status='scheduled' together with scheduledFor.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Id of the draft or scheduled post to edit, from list_posts." },
        caption: { type: "string", description: "Replacement post text." },
        platforms: {
          type: "array",
          items: { type: "string", enum: [...PLATFORMS] },
          description: "Replacement list of target platforms (replaces the whole list, not a merge).",
        },
        libraryItemId: { type: "string", description: "Replacement single media item id. Mutually exclusive with mediaIds." },
        mediaIds: {
          type: "array",
          items: { type: "string" },
          description: "Replacement carousel media ids (up to 10). Mutually exclusive with libraryItemId.",
        },
        scheduledFor: {
          type: "string",
          description: "New auto-publish time, ISO 8601 UTC, in the future.",
        },
        status: {
          type: "string",
          enum: ["draft", "scheduled"],
          description: "Move between draft and scheduled. Scheduling requires scheduledFor to be set (here or previously).",
        },
      },
      required: ["postId"],
    },
  },
  {
    name: "delete_post",
    description:
      "Permanently delete a post by id. If the post is scheduled, this cancels the pending publish. This does not retract content already delivered to social platforms — it only removes the ViralNote record. Irreversible: confirm with the user before deleting. Use update_post instead if the goal is to fix or reschedule a post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Id of the post to delete, from list_posts." },
      },
      required: ["postId"],
    },
  },
  {
    name: "publish_post",
    description:
      "Publish an existing draft post to all of its target platforms immediately, skipping the schedule queue. Only valid on posts with status='draft' — returns an error for scheduled or already-published posts. Returns the post with delivery kicked off; individual platforms can still succeed or fail independently, so follow up with get_post or list_post_results to confirm the outcome.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Id of the draft post to publish, from list_posts or create_post." },
      },
      required: ["postId"],
    },
  },
  {
    name: "list_media",
    description:
      "List items in the user's media library. Returns each item's id, name, type, and folder, plus a `cursor` field when more pages exist. Use this to find a media id to attach to a post via create_post or update_post, or to check whether a file was already imported before calling import_media.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["image", "video", "gif", "clip"],
          description: "Filter by media kind. 'clip' is a short-form clip generated by ViralNote's AI clipping.",
        },
        folder: { type: "string", description: "Only items in this library folder (exact name match). Omit for all folders." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "Maximum items per page (1-50)." },
        cursor: { type: "string", description: "Opaque pagination cursor from the previous response. Omit for the first page." },
        sort: { type: "string", enum: ["newest", "oldest"], default: "newest", description: "Sort order by upload date." },
      },
    },
  },
  {
    name: "import_media",
    description:
      "Import a file into the media library so it can be attached to posts. Two modes: (1) URL mode — pass `url` with an HTTPS direct-download link (up to 200MB; Dropbox and Canva share links supported via the matching `source`); (2) inline mode — pass `data` with base64-encoded bytes (3MB max before encoding) plus `mimeType`, with source='direct'. Exactly one of `url` or `data` must be provided. Returns the created library item including the id to use in create_post. For files over 3MB, always use URL mode.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: ["dropbox", "canva", "direct"],
          description: "Origin of the file: 'dropbox' or 'canva' when url is a share link from those services; 'direct' for base64 data or a generic HTTPS URL.",
        },
        url: {
          type: "string",
          description: "HTTPS direct-download URL of the file, up to 200MB. Mutually exclusive with `data`.",
        },
        data: {
          type: "string",
          description: "Base64-encoded file bytes, 3MB maximum raw size. Mutually exclusive with `url`; requires `mimeType`.",
        },
        name: {
          type: "string",
          description: "Display name for the library item, including the file extension (e.g. 'clip-01.mp4').",
        },
        mimeType: {
          type: "string",
          description: "MIME type such as video/mp4 or image/png. Required with `data`; optional with `url` (detected from the download).",
        },
        bytes: {
          type: "integer",
          description: "Optional declared file size in bytes, letting the API reject oversized files before downloading.",
        },
      },
      required: ["source", "name"],
    },
  },
  {
    name: "delete_media",
    description:
      "Permanently delete a media library item by id. The file cannot be recovered — confirm with the user before deleting. Use list_media to find the item's id and verify it is the right file (check name and type) first.",
    inputSchema: {
      type: "object",
      properties: {
        mediaId: { type: "string", description: "Id of the media library item to delete, from list_media or import_media." },
      },
      required: ["mediaId"],
    },
  },
  {
    name: "list_social_accounts",
    description:
      "List the social accounts connected to the user's ViralNote account: platform and account identity for each. Takes no parameters. Use before create_post to confirm the intended target platforms are actually connected — posting to an unconnected platform fails. Note that connecting or disconnecting accounts happens in the ViralNote dashboard UI (OAuth); it cannot be done through this API.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_analytics",
    description:
      "List published posts with their latest per-platform metrics: views, likes, comments, shares, and engagement. Metrics are collected periodically by ViralNote, so values are the most recent snapshot rather than real-time. Use to report on content performance or find top-performing posts; use list_post_results instead when the question is whether delivery succeeded. Paginated via cursor.",
    inputSchema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: [...PLATFORMS],
          description: "Only include metrics for posts targeting this platform. Omit for all platforms.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "Maximum posts per page (1-50)." },
        cursor: { type: "string", description: "Opaque pagination cursor from the previous response. Omit for the first page." },
      },
    },
  },
  {
    name: "list_post_results",
    description:
      "Check delivery outcomes: returns recent published or failed posts with each platform's individual result (success, or the error that occurred). Pass postId to inspect one post's delivery; omit it to scan recent posts filtered by status. Use after publish_post to verify delivery, or when the user asks why a post didn't appear on a platform. For engagement metrics rather than delivery status, use list_analytics.",
    inputSchema: {
      type: "object",
      properties: {
        postId: {
          type: "string",
          description: "Restrict to a single post's results. When set, status and limit are ignored.",
        },
        status: {
          type: "string",
          enum: ["published", "failed"],
          default: "published",
          description: "Which recent posts to scan when postId is omitted: successfully published, or failed deliveries.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "Maximum posts to return (1-50)." },
      },
    },
  },
  {
    name: "list_webhooks",
    description:
      "List all webhook subscriptions on the account: each subscription's id, target URL, and subscribed events. Takes no parameters. Use to find a webhookId before delete_webhook, or to check whether an event is already covered before calling create_webhook (avoids duplicate subscriptions).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_webhook",
    description:
      "Subscribe a URL to ViralNote event notifications. ViralNote sends an HTTP POST with a JSON payload to the URL each time a subscribed event fires — for example post.published when a post goes live, or post.failed when delivery errors. Returns the created subscription including its id. The URL must be an HTTPS endpoint you control and that is publicly reachable. Check list_webhooks first to avoid duplicating an existing subscription.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Publicly reachable HTTPS endpoint that will receive event POSTs.",
        },
        events: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Event names to subscribe to, e.g. 'post.published', 'post.failed'.",
        },
      },
      required: ["url", "events"],
    },
  },
  {
    name: "delete_webhook",
    description:
      "Delete a webhook subscription by id. The target URL immediately stops receiving event notifications. Irreversible, but a subscription can be recreated with create_webhook. Use list_webhooks to find the id and confirm which URL/events it covers before deleting.",
    inputSchema: {
      type: "object",
      properties: {
        webhookId: { type: "string", description: "Id of the webhook subscription to delete, from list_webhooks." },
      },
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
