<p align="center">
  <a href="https://wireboard.io">
    <img src="https://wireboard.io/img/logo-blue.png" alt="WireBoard" height="64">
  </a>
</p>

<h1 align="center"><code>wireboard-mcp</code></h1>

<p align="center">
  Official Model Context Protocol server for <a href="https://wireboard.io">WireBoard</a>.
</p>

<p align="center">
  Lets LLM agents (Claude Desktop, Cursor, VS Code, etc.) query your real-time and historical analytics in conversation. Built on top of the official <a href="https://www.npmjs.com/package/@wireboard/api"><code>@wireboard/api</code></a> JavaScript SDK.
</p>

---

## Install

Two ways to install, pick whichever fits your setup.

### Option A: Desktop Extension (recommended for Claude Desktop users)

Download `wireboard-mcp-x.y.z.mcpb` from the [GitHub releases page](https://github.com/wireboard/mcp/releases) and double-click it. One file works on Windows, macOS, and Linux — Claude Desktop ships its own Node runtime, so there are no system dependencies to install.

Claude Desktop will prompt for your WireBoard API token, store it securely in your OS keychain, and the WireBoard tools become available immediately.

If double-click doesn't open the file, install it via Claude Desktop → Settings → Extensions → Advanced Settings → **Install Extension**.

### Option B: npm install (for Cursor, VS Code, headless / CI, automation)

```sh
npm install -g @wireboard/mcp
```

Requires Node 18+. Then configure your MCP client of choice.

#### Claude Desktop config

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "wireboard": {
      "command": "wireboard-mcp",
      "env": {
        "WIREBOARD_TOKEN": "your_token_here"
      }
    }
  }
}
```

Restart Claude Desktop. The WireBoard tools will appear automatically.

#### Cursor / VS Code / other MCP clients

Use the same command + env-var pattern in your client's MCP config.

## Mint a token

You need a WireBoard API token before either install path will work. Mint one at [Settings → API](https://wireboard.io/dashboard/settings/api) with the `analytics:read` ability for REST tools and `live:read` for the live snapshot tool.

## What you can ask

Once configured, ask Claude things like:

- "How many visitors did my site get last week?"
- "Show me the top 10 referrers for the past 30 days."
- "What's happening on my site right now?"
- "Which pages under /checkout have the worst bounce rate this month?"
- "How many Purchase events fired from utm_source=newsletter yesterday?"
- "Compare visitor counts day by day for the past two weeks."

Claude will pick the right tool, call it, and answer in natural language.

## Available tools

| Tool | What |
| ---- | ---- |
| `list_sites` | Every site in the account |
| `get_account` | Token-owner identity + abilities |
| `get_aggregate` | Period totals: visitors, pageviews, bounce rate, duration |
| `get_timeseries` | One metric (visitors or pageviews) bucketed by hour or day |
| `get_history` | Per-day visitors / returning / pageviews / bounce / duration |
| `get_breakdown` | Top-N rows by dimension (country, device, browser, referrer, etc.) |
| `get_top_urls` | Per-URL metrics with prefix / contains / exact filters |
| `query_events` | Custom event queries with grouping and filtering |
| `get_live_state` | Real-time snapshot (live visitor count, top pages, active sessions, etc.) |
| `list_dimensions` | Meta: every dimension, metric, and limit the API supports |

All tools accept natural date ranges: `"today"`, `"yesterday"`, `"last 7 days"` (or `"30d"` shorthand), `"this week"`, `"last week"`, `"this month"`, `"last month"`, or explicit `"YYYY-MM-DD..YYYY-MM-DD"`. Always UTC.

## Rate limiting

The MCP proactively caps itself at **100 requests/minute** (under the API's 120/minute limit) so LLM bursts space themselves out instead of hitting 429s. Override with the `WIREBOARD_MCP_RATE_PER_MINUTE` env var if you have a use case that needs different pacing.

The underlying SDK still auto-retries on 429 as a backstop.

## Security

- **Treat your token like a credential.** It has full `analytics:read` and `live:read` scope on every site in the account.
- **Don't commit your MCP client config to a public repo with the token in it.** Use an env var or a secret manager and reference it from your config.
- **Revoke and rotate** if a token leaks. Settings → API in your dashboard.

The MCP is read-only: it can fetch data, never modify it. The WireBoard public API itself is read-only in v1.

## Logging

Logs go to stderr (so they don't interfere with the MCP protocol on stdout).

## Source and contributing

- **npm:** [`@wireboard/mcp`](https://www.npmjs.com/package/@wireboard/mcp)
- **Repository:** [`github.com/wireboard/mcp`](https://github.com/wireboard/mcp)
- **Releases (.mcpb downloads):** [`github.com/wireboard/mcp/releases`](https://github.com/wireboard/mcp/releases)
- **Issues:** [`github.com/wireboard/mcp/issues`](https://github.com/wireboard/mcp/issues)
- **Underlying SDK:** [`@wireboard/api`](https://www.npmjs.com/package/@wireboard/api) ([source](https://github.com/wireboard/api-js))
- **WireBoard docs:** <https://wireboard.io/docs/api-overview>

### Building locally

```sh
npm install
npm test               # run vitest
npm run build          # bundle TS → dist/index.js (esbuild, ~600 KB)
npm run build:mcpb     # also pack dist/wireboard-mcp-<version>.mcpb
```

The `.mcpb` is a zip of `manifest.json`, `icon.png`, and the single bundled `dist/index.js`. All runtime dependencies are inlined by esbuild.

## License

[MIT](./LICENSE).
