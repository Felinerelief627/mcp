/**
 * WireBoard MCP server.
 *
 * Exposes the WireBoard REST surface as MCP tools. Each tool wraps the
 * corresponding method on WireBoardClient and returns the unwrapped
 * data payload as JSON text.
 *
 * Design notes:
 * - One singleton WireBoardClient per process. HTTP keep-alive makes
 *   reusing the client faster than rebuilding it per call.
 * - Proactive client-side rate limiting (default 100 calls/min) below the
 *   API's 120/min cap so LLM bursts space themselves out instead of tripping
 *   429s. The SDK still auto-retries 429 as a backstop.
 * - Relative date strings ("last 7 days", "yesterday", "this month") are
 *   resolved before being sent on the wire, so the LLM can talk in natural
 *   date language and the API still gets YYYY-MM-DD.
 * - All tools are read-only. The WireBoard public API is read-only in v1.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  WireBoardApiError,
  WireBoardAuthError,
  WireBoardClient,
} from "@wireboard/api";

import { resolveRange } from "./dates.js";
import { TokenBucket } from "./rateLimit.js";
import { VERSION } from "./version.js";

const DEFAULT_RATE_PER_MINUTE = (() => {
  const parsed = Number(process.env.WIREBOARD_MCP_RATE_PER_MINUTE);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 100;
})();

const BREAKDOWN_DIMENSIONS = [
  "country", "device", "browser", "os", "language",
  "url", "ref_url", "ref_medium", "ref_source", "ref_search", "ref_social",
  "entry_url", "exit_url",
] as const;

const LIVE_CATEGORIES = [
  "visitors", "top_pages",
  "top_referrers", "top_mediums", "top_sources", "top_search", "top_social",
  "top_countries", "top_devices", "top_browsers", "top_oses",
  "top_languages", "top_screens",
  "time_spent", "pages_per_session", "performance",
  "life_events", "events", "geo", "active_sessions",
] as const;

const DATE_RANGE_DESC =
  "Date range. Accepts natural strings ('today', 'yesterday', " +
  "'last 7 days', 'last 30 days', 'this week', 'last week', " +
  "'this month', 'last month') or an explicit 'YYYY-MM-DD..YYYY-MM-DD' " +
  "range. UTC. If you have separate from/to dates, use the explicit form.";

const SITE_ID_PROP = {
  type: "string" as const,
  description: "Site ID. Get it from list_sites if you don't know it.",
};

// ─── Tool catalogue ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "list_sites",
    description:
      "List every site in the WireBoard account. Returns each site's ID, domain, " +
      "and peak-concurrent-visitors over the last 30 days. Call this first if you " +
      "don't know which site_id to use for the other tools.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_account",
    description:
      "Get the team-owner identity (email, name) and the abilities of the token " +
      "in use. Useful for verifying which account the MCP is connected to.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_aggregate",
    description:
      "Period totals for one site: visitors, pageviews, bounce_rate, visit_duration. " +
      "Use this for 'how many visitors did site X get in date range Y' style questions.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: SITE_ID_PROP,
        range: { type: "string", description: DATE_RANGE_DESC },
      },
      required: ["site_id", "range"],
    },
  },
  {
    name: "get_timeseries",
    description:
      "One metric bucketed over time (hour or day). Use for 'plot pageviews per day " +
      "this month' or 'visitors per hour today'. Returns an array of {time, value} points.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: SITE_ID_PROP,
        range: { type: "string", description: DATE_RANGE_DESC },
        metric: {
          type: "string",
          enum: ["visitors", "pageviews"],
          description: "Which metric to plot.",
        },
        interval: {
          type: "string",
          enum: ["hour", "day"],
          description: "Bucket size. Use 'hour' for short ranges, 'day' for longer.",
        },
      },
      required: ["site_id", "range", "metric", "interval"],
    },
  },
  {
    name: "get_history",
    description:
      "Per-day breakdown with visitors, returning_visitors, pageviews, bounce_rate, " +
      "and avg_duration in a single call. Use when the user wants a 'daily report' " +
      "or wants returning-visitor comparisons. Returns one row per UTC day in the range.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: SITE_ID_PROP,
        range: { type: "string", description: DATE_RANGE_DESC },
      },
      required: ["site_id", "range"],
    },
  },
  {
    name: "get_breakdown",
    description:
      "Top-N rows by one dimension (country, device, browser, url, etc.). Use for " +
      "'top countries last week', 'most-used browsers', 'top referrer sources'. The " +
      "dimension determines which field appears in each row alongside the visitor count.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: SITE_ID_PROP,
        range: { type: "string", description: DATE_RANGE_DESC },
        dimension: {
          type: "string",
          enum: [...BREAKDOWN_DIMENSIONS],
          description:
            "Which dimension to break down by. ref_url/ref_medium/ref_source/ref_search/ref_social " +
            "are a partition of referrers (a referrer lands in exactly one).",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "Max rows to return. Default 50, max 500.",
        },
      },
      required: ["site_id", "range", "dimension"],
    },
  },
  {
    name: "get_top_urls",
    description:
      "Per-URL metrics (visitors, pageviews, bounce_rate, avg_duration) with optional " +
      "filtering. Use for 'top pages under /blog', 'find the homepage's stats', 'which " +
      "checkout pages have the worst bounce rate'. Paginated via limit and offset.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: SITE_ID_PROP,
        range: { type: "string", description: DATE_RANGE_DESC },
        prefix: {
          type: "string",
          description:
            "Match URLs whose value starts with this string. URLs are stored as full URLs " +
            "(scheme + host + path), so pass a full prefix like 'https://yoursite.com/blog/', " +
            "NOT just '/blog/'. If you only have a path the user mentioned, use `contains` " +
            "instead (matches the path as a substring anywhere in the URL).",
        },
        contains: {
          type: "string",
          description:
            "Match URLs that contain this substring anywhere. Use this when the user gives " +
            "you a path or a keyword without specifying the full URL (e.g. user says " +
            "'checkout pages' → contains='/checkout').",
        },
        exact: {
          type: "string",
          description:
            "Match the URL that equals this string exactly. Like `prefix`, this is a full " +
            "URL: scheme + host + path.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "Max rows. Default 50, max 500.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          maximum: 10000,
          description: "Pagination offset. Default 0.",
        },
      },
      required: ["site_id", "range"],
    },
  },
  {
    name: "query_events",
    description:
      "Query custom events (purchases, form submits, button clicks, etc.). Filter by " +
      "category/action/label or UTM fields, group by any combination of those, paginate. " +
      "Use for 'how many Purchase events from utm_source=newsletter last week' or " +
      "'top event categories this month'.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: SITE_ID_PROP,
        range: { type: "string", description: DATE_RANGE_DESC },
        group_by: {
          type: "array",
          items: { type: "string" },
          description:
            "Fields to group by. Allowed: category, action, label, utm_campaign, " +
            "utm_source, utm_medium, utm_content, utm_term. Default: ['category', 'action', 'label'].",
        },
        filter: {
          type: "object",
          description:
            "Filters as {field: value}. Allowed top-level fields: category, action, label, " +
            "utm_*. Event props go under {'props': {'key': 'value'}} which translates to " +
            "filter[props.key]=value on the wire.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          description: "Max rows. Default 50, max 1000.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          maximum: 10000,
          description: "Pagination offset. Default 0.",
        },
      },
      required: ["site_id", "range"],
    },
  },
  {
    name: "get_live_state",
    description:
      "Current real-time snapshot for a site: live visitor count, top pages right now, " +
      "current top referrers, active sessions, etc. Use for 'what's happening on the site " +
      "right now', 'who's currently on the checkout page', 'how many visitors live'.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: SITE_ID_PROP,
        categories: {
          type: "array",
          items: { type: "string", enum: [...LIVE_CATEGORIES] },
          description:
            "Subset of the 20 live categories to include. Omit to get all categories. " +
            "Smaller subsets are faster.",
        },
      },
      required: ["site_id"],
    },
  },
  {
    name: "list_dimensions",
    description:
      "Lists every dimension, metric, and limit the API supports. Use as a self-discovery " +
      "tool when the user asks something like 'what can you tell me about my analytics' " +
      "or when you're unsure which dimension key to pass to get_breakdown.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// ─── Server + shared state ──────────────────────────────────────────────────

let clientSingleton: WireBoardClient | null = null;

function getClient(): WireBoardClient {
  if (clientSingleton) return clientSingleton;
  const token = process.env.WIREBOARD_TOKEN;
  if (!token) {
    throw new Error(
      "WIREBOARD_TOKEN env var is required. Set it in your MCP client's config " +
        "(e.g. Claude Desktop mcpServers.wireboard.env).",
    );
  }
  clientSingleton = new WireBoardClient({ token });
  return clientSingleton;
}

const bucket = new TokenBucket(DEFAULT_RATE_PER_MINUTE, 60);

// ─── Dispatch ───────────────────────────────────────────────────────────────

async function dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
  const wb = getClient();

  switch (name) {
    case "list_sites":
      return wb.sites();
    case "get_account":
      return wb.account();
    case "list_dimensions":
      return wb.dimensions();
    case "get_live_state":
      return wb.liveState({
        site_id: requiredStr(args, "site_id"),
        categories: args.categories as Parameters<WireBoardClient["liveState"]>[0]["categories"],
      });
  }

  const siteId = requiredStr(args, "site_id");
  const { from, to } = (() => {
    const range = requiredStr(args, "range");
    return resolveRange(range);
  })();

  switch (name) {
    case "get_aggregate":
      return wb.aggregate({ site_id: siteId, from, to });
    case "get_timeseries":
      return wb.timeseries({
        site_id: siteId,
        from,
        to,
        metric: requiredStr(args, "metric") as "visitors" | "pageviews",
        interval: requiredStr(args, "interval") as "hour" | "day",
      });
    case "get_history":
      return wb.history({ site_id: siteId, from, to });
    case "get_breakdown":
      return wb.breakdown({
        site_id: siteId,
        from,
        to,
        dimension: requiredStr(args, "dimension") as (typeof BREAKDOWN_DIMENSIONS)[number],
        limit: args.limit as number | undefined,
      });
    case "get_top_urls":
      return wb.urls({
        site_id: siteId,
        from,
        to,
        prefix: args.prefix as string | undefined,
        contains: args.contains as string | undefined,
        exact: args.exact as string | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      });
    case "query_events":
      return wb.events({
        site_id: siteId,
        from,
        to,
        group_by: args.group_by as Parameters<WireBoardClient["events"]>[0]["group_by"],
        filter: args.filter as Record<string, unknown> | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      });
  }

  throw new Error(`Unknown tool: ${name}`);
}

function requiredStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`argument '${key}' is required and must be a non-empty string`);
  }
  return v;
}

function errorPayload(msg: string): { content: { type: "text"; text: string }[]; isError: true } {
  console.error(`[wireboard-mcp] ${msg}`);
  return {
    content: [{ type: "text", text: JSON.stringify({ error: msg }) }],
    isError: true,
  };
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const server = new Server(
    { name: "WireBoard", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    await bucket.acquire();
    try {
      const result = await dispatch(name, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      if (err instanceof WireBoardAuthError) {
        return errorPayload(`Authentication failed (${err.httpStatus}): ${err.message}`);
      }
      if (err instanceof WireBoardApiError) {
        const code = err.code ?? "validation_error";
        return errorPayload(`API error [${code}, HTTP ${err.httpStatus}]: ${err.message}`);
      }
      if (err instanceof Error) {
        return errorPayload(err.message);
      }
      return errorPayload(String(err));
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
