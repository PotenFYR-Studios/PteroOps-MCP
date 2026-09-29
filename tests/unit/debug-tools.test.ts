import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockPanel } from "../helpers/mock-panel.js";
import { createTestServices, type TestServicesHandle } from "../helpers/services.js";
import { createMcpServer } from "../../src/mcp/server.js";
import {
  candidateServerPaths,
  extractSnippet,
  extractStackLocations,
} from "../../src/intelligence/debug/debug-context.js";
import { searchTextFiles } from "../../src/files/search.js";
import { validateFileContent } from "../../src/applications/validation.js";
import type { ServerRef } from "../../src/shared/types.js";

describe("stack location extraction", () => {
  it("parses Java frames", () => {
    const locations = extractStackLocations([
      "at com.example.economy.EconomyPlugin.onEnable(EconomyPlugin.java:42)",
      "at org.bukkit.plugin.java.JavaPlugin.setEnabled(JavaPlugin.java:1)",
    ]);
    expect(locations[0]).toEqual({
      runtime: "java",
      file: "EconomyPlugin",
      line: 42,
      symbol: "com.example.economy.EconomyPlugin.onEnable",
    });
    expect(locations[1]!.file).toBe("JavaPlugin");
  });

  it("parses Python frames", () => {
    const locations = extractStackLocations([`  File "/app/bot.py", line 87, in on_message`]);
    expect(locations[0]).toEqual({
      runtime: "python",
      file: "/app/bot.py",
      line: 87,
      symbol: "on_message",
    });
  });

  it("parses Node frames and skips internals", () => {
    const locations = extractStackLocations([
      "    at handler (/app/index.js:42:7)",
      "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ]);
    expect(locations).toHaveLength(1);
    expect(locations[0]!.file).toBe("/app/index.js");
    expect(locations[0]!.line).toBe(42);
  });
});

describe("path mapping and snippets", () => {
  it("maps container paths to server paths", () => {
    const candidates = candidateServerPaths(
      { runtime: "python", file: "/app/bot.py", line: 10, symbol: null },
      ["bot.py", "server.py"],
    );
    expect(candidates).toContain("/bot.py");
    const java = candidateServerPaths(
      { runtime: "java", file: "EconomyPlugin.java", line: 1, symbol: null },
      [],
    );
    expect(java).toContain("/EconomyPlugin.java");
  });

  it("extracts a bounded numbered snippet around a line", () => {
    const content = Array.from({ length: 40 }, (_v, index) => `line ${String(index + 1)}`).join("\n");
    const snippet = extractSnippet(content, 20, 6);
    expect(snippet.from).toBe(17);
    expect(snippet.to).toBe(22);
    expect(snippet.text).toContain("20 | line 20");
  });
});

describe("file search", () => {
  const files = {
    "/server.properties": "server-port=25565\nmotd=Hello",
    "/config.yml": "database:\n  url: mysql://db.internal\n",
  };

  it("finds plain text matches case-insensitively with line numbers", () => {
    const result = searchTextFiles(files, "MYSQL");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.file).toBe("/config.yml");
    expect(result.matches[0]!.line).toBe(2);
  });

  it("supports regex and truncates at the result cap", () => {
    const result = searchTextFiles(files, "^(server-port|motd)=", { regex: true, maxResults: 1 });
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("skips binary content", () => {
    const result = searchTextFiles({ "/plugin.jar": "PK\u0000binary" }, "PK");
    expect(result.matches).toHaveLength(0);
    expect(result.filesSkipped).toContain("/plugin.jar");
  });
});

describe("config validation", () => {
  it("accepts valid properties and flags duplicates", () => {
    expect(validateFileContent("server.properties", "motd=A\nport=25565").status).toBe("ok");
    const duplicate = validateFileContent("server.properties", "motd=A\nmotd=B");
    expect(duplicate.status).toBe("warn");
    expect(duplicate.issues[0]).toContain("duplicate key");
  });

  it("flags invalid JSON and YAML", () => {
    expect(validateFileContent("package.json", "{broken").status).toBe("error");
    expect(validateFileContent("config.yml", "a:\n  - b\n c: d").status).toBe("error");
  });
});

describe("debug tools over MCP", () => {
  let panel: MockPanel;
  let handle: TestServicesHandle;
  let client: Client;
  let closeClient: () => Promise<void>;
  let ref: ServerRef;

  beforeEach(async () => {
    panel = await MockPanel.start({
      servers: [
        {
          identifier: "bot",
          name: "Discord bot",
          state: "running",
          files: {
            "/": ["bot.py", "config.yml", "requirements.txt"],
            "/bot.py": Array.from({ length: 30 }, (_v, index) => `print("line ${String(index + 1)}")`).join("\n"),
            "/config.yml": "token: abc\ndatabase:\n  url: mysql://db.internal\n",
            "/requirements.txt": "discord.py==2.3.0\n",
          },
        },
      ],
    });
    handle = await createTestServices({ panelUrl: panel.url });
    ref = { tenant: "local", panel: "mock", serverId: "bot" };
    handle.services.consoleService.ingest(
      ref,
      "Traceback (most recent call last):",
      Date.now() - 5000,
    );
    handle.services.consoleService.ingest(
      ref,
      '  File "/app/bot.py", line 20, in on_message',
      Date.now() - 4990,
    );
    handle.services.consoleService.ingest(
      ref,
      "discord.errors.LoginFailure: Improper token has been passed.",
      Date.now() - 4980,
    );
    await handle.services.consoleService.flush();

    const bundle = createMcpServer(handle.services);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "debug-test", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), bundle.server.connect(serverTransport)]);
    closeClient = async () => {
      await client.close();
    };
  });

  afterEach(async () => {
    await closeClient();
    await handle.close();
    await panel.close();
  });

  async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    if (result.isError === true) throw new Error(JSON.stringify(parsed));
    return parsed;
  }

  it("registers the code-debugging tools", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toContain("ptero_debug_context");
    expect(names).toContain("ptero_search_files");
    expect(names).toContain("ptero_validate_config");
  });

  it("returns resolved code snippets for stack frames", async () => {
    const result = await call("ptero_debug_context", { server: "bot", windowMinutes: 60 });
    const snippets = result.snippets as Array<Record<string, unknown>>;
    expect(snippets.length).toBeGreaterThan(0);
    const resolved = snippets.find((snippet) => snippet.resolvedPath === "/bot.py");
    expect(resolved).toBeDefined();
    expect(String(resolved!.snippet)).toContain("20 | print");
    expect((result.exceptions as Array<Record<string, unknown>>).length).toBeGreaterThan(0);
  });

  it("searches files with bounded results", async () => {
    const result = await call("ptero_search_files", { server: "bot", query: "mysql" });
    const matches = result.matches as Array<Record<string, unknown>>;
    expect(matches.length).toBe(1);
    expect(matches[0]!.file).toBe("/config.yml");
    expect(matches[0]!.line).toBe(3);
  });

  it("validates a config file and reports syntax errors", async () => {
    const ok = await call("ptero_validate_config", { server: "bot", path: "/config.yml" });
    expect(ok.status).toBe("ok");
    panel.setFile("bot", "/config.yml", "token: abc\n  bad: indent");
    const broken = await call("ptero_validate_config", { server: "bot", path: "/config.yml" });
    expect(broken.status).toBe("error");
  });
});
