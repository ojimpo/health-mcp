#!/usr/bin/env node

// 引数があればCLIモード、なければMCPサーバーモード（otp-mcpの構成を踏襲）。
const _firstArg = process.argv[2];
if (_firstArg) {
  const { runCli } = await import("./cli.js");
  await runCli(process.argv.slice(2));
  process.exit(0);
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ACTIVITY_CATEGORIES,
  STATE_CATEGORIES,
  getDashboard,
  getIngestStatus,
  getRecords,
  getSources,
  formatHistory,
  formatRecent,
  formatRecords,
  formatSources,
  formatStatus,
} from "./health.js";

const ALL_CATEGORIES = [...ACTIVITY_CATEGORIES, ...STATE_CATEGORIES];

function createServer(): Server {
  const server = new Server(
    { name: "health-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_current_status",
        description:
          "Get the current snapshot of the personal health dashboard (health.ojimpo.com): " +
          "overall health score/status (NORMAL/CAUTION/CRITICAL) and cultural activity score/status (RICH/MODERATE/LOW), " +
          "per-category cards (this week vs previous week with change), condition state cards (sleep/readiness/stress/weight/outing/CTL), " +
          "and trend comments. Scores are percentages of personal baselines (100 = baseline met). " +
          "Use this first for any 'how am I doing' question.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_score_history",
        description:
          "Get the score time series: one row per date with overall health_score and cultural_score, " +
          "plus optional per-category score columns. range 1m/3m = daily points, 1y = weekly points. " +
          `Valid category names — activity: ${ACTIVITY_CATEGORIES.join(", ")}; state: ${STATE_CATEGORIES.join(", ")}. ` +
          "Add only the categories you need to keep output small.",
        inputSchema: {
          type: "object",
          properties: {
            range: {
              type: "string",
              enum: ["1m", "3m", "1y"],
              description: "Time range (default 3m). 1m/3m = daily, 1y = weekly.",
            },
            categories: {
              type: "array",
              items: { type: "string", enum: ALL_CATEGORIES },
              description: "Optional category columns to include in addition to the overall scores.",
            },
          },
        },
      },
      {
        name: "get_recent_activities",
        description:
          "List the most recent concrete activities across all sources (e.g. tracks listened, workouts, movies watched, commits) " +
          "as human-readable lines with relative time. The backend keeps the latest 8.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", minimum: 1, maximum: 8, description: "Max items (default 8)." },
          },
        },
      },
      {
        name: "list_sources",
        description:
          "List all configured data sources with their category, display_type (activity/card_only/state), " +
          "classification (baseline/event/health_only/both), status, and baseline (base_value per aggregation period). " +
          "Use to discover valid 'source' and 'category' values for query_records.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "query_records",
        description:
          "Query raw daily activity records (one row per date x source x category: minutes, raw_value, raw_unit). " +
          "Requires a from/to date range (YYYY-MM-DD). Filter by source and/or category (see list_sources). " +
          "For ranges over ~2 months prefer group_by week or month to keep output small; " +
          "raw mode is capped by 'limit' and reports truncation.",
        inputSchema: {
          type: "object",
          properties: {
            from: { type: "string", description: "Start date YYYY-MM-DD (inclusive)." },
            to: { type: "string", description: "End date YYYY-MM-DD (inclusive)." },
            source: { type: "string", description: "Filter by source id, e.g. lastfm." },
            category: { type: "string", description: "Filter by category, e.g. music." },
            group_by: {
              type: "string",
              enum: ["week", "month"],
              description: "Aggregate sums per period instead of raw rows.",
            },
            limit: {
              type: "number",
              minimum: 1,
              maximum: 2000,
              description: "Max raw rows (default 500).",
            },
          },
          required: ["from", "to"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case "get_current_status": {
          const [dash, ingest] = await Promise.all([getDashboard("1m"), getIngestStatus()]);
          return { content: [{ type: "text", text: formatStatus(dash, ingest) }] };
        }
        case "get_score_history": {
          const range = String(args?.range ?? "3m");
          const categories = Array.isArray(args?.categories) ? args.categories.map(String) : [];
          const dash = await getDashboard(range);
          return { content: [{ type: "text", text: formatHistory(dash, categories) }] };
        }
        case "get_recent_activities": {
          const limit = args?.limit ? Number(args.limit) : 8;
          const dash = await getDashboard("1m");
          return { content: [{ type: "text", text: formatRecent(dash.recent_activities, limit) }] };
        }
        case "list_sources": {
          const sources = await getSources();
          return { content: [{ type: "text", text: formatSources(sources) }] };
        }
        case "query_records": {
          const res = await getRecords({
            from: String(args?.from ?? ""),
            to: String(args?.to ?? ""),
            source: args?.source ? String(args.source) : undefined,
            category: args?.category ? String(args.category) : undefined,
            group_by: args?.group_by ? String(args.group_by) : undefined,
            limit: args?.limit ? Number(args.limit) : undefined,
          });
          return { content: [{ type: "text", text: formatRecords(res) }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (e) {
      return { content: [{ type: "text", text: `エラー: ${(e as Error).message}` }], isError: true };
    }
  });

  return server;
}

// Transport選択: http（claude.ai / リモート）or stdio（Claude Code / Desktop、デフォルト）
const transport = process.env.TRANSPORT;
if (transport === "http") {
  const { startHttpServer } = await import("./http-server.js");
  const port = parseInt(process.env.PORT || "3000", 10);
  const authToken = process.env.MCP_AUTH_TOKEN;
  startHttpServer(createServer, { port, ...(authToken ? { authToken } : {}) });
} else {
  const server = createServer();
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
}
