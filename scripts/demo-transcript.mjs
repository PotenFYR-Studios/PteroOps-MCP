// Generates docs/demo-transcript.md by running the real MCP server against a
// scripted mock Pterodactyl panel. Run: npm run build && npm run demo
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServices } from "../dist/container.js";
import { createMcpServer } from "../dist/mcp/server.js";
import { loadConfig } from "../dist/config/loader.js";
import { SqliteDatabase } from "../dist/persistence/sqlite/database.js";
import { MIGRATIONS } from "../dist/persistence/database.js";

const MINUTE = 60_000;
const base = Date.now() - 12 * MINUTE;
const firstOom = base + 4 * MINUTE;

function startMockPanel() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (payload) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const attributes = {
      server_owner: true,
      identifier: "survival",
      internal_id: 1,
      uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      name: "Survival",
      node: "node-1",
      description: "demo server",
      limits: { memory: 2048, swap: 0, disk: 10240, io: 500, cpu: 100, threads: null },
      invocation: "java -Xms128M -Xmx2048M -jar server.jar",
      docker_image: "ghcr.io/pterodactyl/yolks:java_21",
      feature_limits: { databases: 1, allocations: 1, backups: 1 },
      status: "running",
      is_suspended: false,
      is_installing: false,
      relationships: {
        allocations: {
          object: "list",
          data: [{ object: "allocation", attributes: { id: 1, ip: "10.0.0.9", port: 25565, is_default: true } }],
        },
      },
    };
    if (url.pathname === "/api/client") {
      json({ object: "list", data: [{ object: "server", attributes }] });
      return;
    }
    if (url.pathname === "/api/client/servers/survival") {
      json({ object: "server", attributes });
      return;
    }
    if (url.pathname.endsWith("/resources")) {
      json({
        object: "stats",
        attributes: {
          current_state: "starting",
          is_suspended: false,
          resources: {
            memory_bytes: 1_950 * 1024 * 1024,
            memory_limit_bytes: 2 * 1024 * 1024 * 1024,
            cpu_absolute: 85,
            disk_bytes: 5 * 1024 * 1024 * 1024,
            disk_limit_bytes: 10 * 1024 * 1024 * 1024,
            network_rx_bytes: 1000,
            network_tx_bytes: 2000,
            uptime: 30_000,
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith("/startup")) {
      json({
        object: "list",
        data: [],
        meta: {
          startup_command: "java -Xms128M -Xmx2048M -jar server.jar",
          raw_startup_command: "java -Xms128M -Xmx2048M -jar server.jar",
          docker_image: "ghcr.io/pterodactyl/yolks:java_21",
        },
      });
      return;
    }
    if (url.pathname.endsWith("/files/list")) {
      const directory = url.searchParams.get("directory") ?? "/";
      const listing = directory === "/" ? ["server.properties", "server.jar", "plugins"] : ["EssentialsX-2.20.1.jar", "LuckPerms-5.4.102.jar"];
      json({
        object: "list",
        data: listing.map((name) => ({
          object: "file_object",
          attributes: { name, size: 100, mode: "rw", mimetype: "text/plain", is_file: true, is_directory: false, is_symlink: false },
        })),
      });
      return;
    }
    if (url.pathname.endsWith("/files/contents")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("server-port=25565\nmax-players=20");
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ errors: [{ code: "NotFound", detail: "mock" }] }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function main() {
  const panel = await startMockPanel();
  const config = loadConfig({
    env: {
      PTERO_PANELS_JSON: JSON.stringify({
        production: { url: panel.url, clientKey: "ptlc_demo_key_1234567890" },
      }),
      PTERO_DEFAULT_PANEL: "production",
      PTERO_MONITORING_ENABLED: "0",
    },
    cwd: process.cwd(),
  }).config;
  const metrics = new (await import("../dist/observability/metrics.js")).MetricsRegistry();
  const logger = (await import("../dist/observability/logger.js")).createLogger({
    level: "warn",
    sink: () => undefined,
  });
  const database = await SqliteDatabase.inMemory(MIGRATIONS);
  const services = await buildServices(config, { database, metrics, logger });
  const ref = { tenant: "local", panel: "production", serverId: "survival" };

  services.changeLedger.record({
    ref,
    actor: "operator",
    origin: "mcp:git_deploy",
    action: "file_write",
    target: "/plugins/EssentialsX.jar",
    beforeHash: "1111111111111111",
    afterHash: "2222222222222222",
    result: "success",
    risk: "MEDIUM",
    reason: "plugin update",
    ts: firstOom - 4 * MINUTE,
  });
  const lines = [
    ["[12:00:00] [Server thread/INFO]: Starting minecraft server version 1.21.4", base],
    ["Server marked as running", base + 5_000],
    ['Done (14.512s)! For help, type "help"', base + 15_000],
  ];
  for (let i = 0; i < 3; i++) {
    const ts = firstOom + i * 3 * MINUTE;
    lines.push(["java.lang.OutOfMemoryError: Java heap space", ts]);
    lines.push(["\tat net.minecraft.world.level.chunk.LevelChunkSection.recalcBlockCounts(LevelChunkSection.java:1)", ts + 10]);
    services.crashTracker.record(ref, { ts, kind: "started", source: "poll" });
    services.crashTracker.record(ref, { ts: ts + 30_000, kind: "exited", runtimeMs: 30_000, source: "poll" });
    lines.push(["Server marked as offline", ts + 30_000]);
  }
  for (const [line, ts] of lines) services.consoleService.ingest(ref, line, ts);
  await services.consoleService.flush();
  await services.serverCache.upsert({
    ref,
    uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    name: "Survival",
    state: "starting",
    application: "minecraft/paper 1.21.4",
    now: Date.now(),
  });

  const bundle = createMcpServer(services);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "demo", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), bundle.server.connect(serverTransport)]);

  const transcript = [];
  transcript.push("# PteroOps demo transcript (generated)");
  transcript.push("");
  transcript.push("> Generated by `npm run demo`. Scenario: a Paper 1.21.4 server crash-looping");
  transcript.push("> with `OutOfMemoryError` after a plugin update, investigated end-to-end through the MCP API.");
  transcript.push("");

  const steps = [
    ["ptero_get_capabilities", {}],
    ["ptero_get_health", { server: "survival" }],
    ["ptero_analyze_logs", { server: "survival", windowMinutes: 60 }],
    ["ptero_detect_application", { server: "survival" }],
    ["ptero_get_change_history", { server: "survival", around: new Date(firstOom).toISOString(), window: "15m" }],
    ["ptero_diagnose", { server: "survival" }],
    ["ptero_debug_context", { server: "survival" }],
  ];
  for (const [name, args] of steps) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    transcript.push(`## ${name}`);
    transcript.push("");
    transcript.push("```json");
    transcript.push(text.length > 3500 ? `${text.slice(0, 3500)}\n… (truncated for readability)` : text);
    transcript.push("```");
    transcript.push("");
    console.log(`✓ ${name}`);
  }

  writeFileSync("docs/demo-transcript.md", transcript.join("\n"));
  await client.close();
  await database.close();
  panel.server.close();
  console.log("wrote docs/demo-transcript.md");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
