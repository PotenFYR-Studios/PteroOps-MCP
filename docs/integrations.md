# Integrations — Where PteroOps Is Usable

PteroOps speaks MCP over **stdio** and **Streamable HTTP**, so anything that can host an MCP
client can operate it. This page gives copy-paste setups. Live surface per release:
[`docs/status.md`](status.md).

## Prerequisites

- Node.js 22.13+ (24+ recommended). The one-liner installers below check this for you and can
  install Node when asked:
  - macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.sh | bash`
  - Windows: `irm https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.ps1 | iex`
- A Pterodactyl panel URL and at least one API key (`ptlc_*` and/or `ptla_*`)

The examples below use the paths the installer creates — `~/.pteroops/app/dist/index.js`
(macOS/Linux) and `%LOCALAPPDATA%\PteroOps\app\dist\index.js` (Windows). Manual installs: use
`node /path/to/PteroOps-MCP/dist/index.js` instead. Full install options:
[installation.md](installation.md).

## Claude Desktop

`claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "pteroops": {
      "command": "npx",
      "args": ["-y", "pteroops-mcp", "--transport", "stdio"],
      "env": {
        "PTERO_PANEL_PROD_URL": "https://panel.example.com",
        "PTERO_PANEL_PROD_CLIENT_KEY": "ptlc_...",
        "PTERO_PANEL_PROD_APPLICATION_KEY": "ptla_...",
        "PTERO_DEFAULT_PANEL": "prod"
      }
    }
  }
}
```

Then ask: *"Use pteroops to find out why the survival server keeps restarting."*

## Claude Code

```bash
claude mcp add pteroops -- npx -y pteroops-mcp --transport stdio
# or point at a config file:
claude mcp add pteroops -- env PTEROOPS_CONFIG=/etc/pteroops.yaml npx -y pteroops-mcp
```

## Cursor

`.cursor/mcp.json` (project) or Cursor Settings → MCP:

```json
{
  "mcpServers": {
    "pteroops": {
      "command": "node",
      "args": ["/opt/pteroops/dist/index.js", "--transport", "stdio"],
      "env": { "PTEROOPS_CONFIG": "/etc/pteroops.yaml" }
    }
  }
}
```

## VS Code (GitHub Copilot, MCP)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "pteroops": {
      "type": "stdio",
      "command": "node",
      "args": ["/opt/pteroops/dist/index.js"],
      "env": { "PTEROOPS_CONFIG": "/etc/pteroops.yaml" }
    }
  }
}
```

## Custom agents (SDK)

TypeScript (stdio via `@modelcontextprotocol/sdk`):

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "my-sre-agent", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: "node",
  args: ["/opt/pteroops/dist/index.js", "--transport", "stdio"],
  env: { ...process.env, PTEROOPS_CONFIG: "/etc/pteroops.yaml" },
}));

const caps = await client.callTool({ name: "ptero_get_capabilities", arguments: {} });
const health = await client.callTool({
  name: "ptero_get_health",
  arguments: { server: "prod/survival" },
});
```

Python (`mcp` package):

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

params = StdioServerParameters(command="node", args=["/opt/pteroops/dist/index.js"],
                               env={"PTEROOPS_CONFIG": "/etc/pteroops.yaml"})
async with stdio_client(params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()
        result = await session.call_tool("ptero_get_health", {"server": "prod/survival"})
```

## HTTP deployment (Streamable HTTP)

```bash
node dist/index.js --transport http
# endpoints:
#   POST/GET/DELETE /mcp   MCP Streamable HTTP
#   GET /health            liveness
#   GET /ready             readiness (config, database, panel reachability)
#   GET /metrics           Prometheus text (when enabled)
```

Client (TypeScript):

```ts
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8080/mcp"), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.PTEROOPS_HTTP_TOKEN}` } },
});
```

Notes:

- Set `PTERO_HTTP_TOKEN` (or `http.authToken`) whenever the listener is not loopback-only.
- Run behind TLS (reverse proxy) for anything remote; do not expose plain HTTP.
- `/health` and `/ready` are safe for orchestrators; `/metrics` optionally exposes operational
  counters (no secrets, no Pterodactyl data).

## Docker

```bash
docker build -t pteroops .
docker run -d --name pteroops \
  -v pteroops-data:/app/data \
  -e PTERO_PANEL_PROD_URL=https://panel.example.com \
  -e PTERO_PANEL_PROD_CLIENT_KEY=ptlc_... \
  -e PTERO_PANEL_PROD_APPLICATION_KEY=ptla_... \
  -p 127.0.0.1:8080:8080 \
  pteroops --transport http
```

- Runs as non-root; data persists in the `/app/data` volume (SQLite, snapshots).
- Health check built in (`/health`).
- No secrets in the image; pass at runtime.
- For stdio over Docker (`docker run -i`), command stays `pteroops --transport stdio`.

## Automation platforms (n8n, Zapier-style, cron agents)

Any platform with an MCP client node can call PteroOps over Streamable HTTP with a bearer token.
Typical automations: nightly `ptero_diagnose` sweep, weekly `ptero_analyze_dependencies`,
alert-driven `ptero_investigate_incident`.

## Safety expectations per integration

Every integration shares the same guarantees: capability gating, policy enforcement, approvals
for risky actions, redaction, and audit. Agents that ignore approvals (e.g., standing scripts with
auto-approval misconfigured) are a configuration risk — keep `approval.autoApprove` minimal and
scope `policy.allowedServers` where the platform supports it.
