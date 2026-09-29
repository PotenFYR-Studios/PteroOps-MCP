import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { MockPanel } from "../helpers/mock-panel.js";
import { createTestServices, type TestServicesHandle } from "../helpers/services.js";
import { NetworkDiagnosticEngine } from "../../src/network/diagnostics.js";
import { createLogger } from "../../src/observability/logger.js";
import { RedactionEngine } from "../../src/shared/redaction.js";
import { ApplicationProfileRegistry } from "../../src/applications/profiles/index.js";
import { ServerCacheRepository } from "../../src/persistence/repositories/servers.js";
import { SqliteDatabase } from "../../src/persistence/sqlite/database.js";
import { MIGRATIONS } from "../../src/persistence/migrations.js";
import type { ServerRef } from "../../src/shared/types.js";

let panel: MockPanel;
let handle: TestServicesHandle;
let ref: ServerRef;

beforeEach(async () => {
  panel = await MockPanel.start({
    servers: [
      {
        identifier: "web",
        name: "Web app",
        state: "running",
        allocations: [{ id: 1, ip: "10.10.0.5", port: 8080, primary: true }],
        files: {
          "/": ["package.json", "index.js"],
          "/package.json": JSON.stringify({ name: "web", dependencies: { express: "^4.19.0" } }),
        },
      },
    ],
  });
  handle = await createTestServices({ panelUrl: panel.url });
  ref = { tenant: "local", panel: "mock", serverId: "web" };
});

afterEach(async () => {
  await handle.close();
  await panel.close();
});

describe("NetworkDiagnosticEngine", () => {
  it("reports allocations and skips probing when disabled", async () => {
    const report = await handle.services.network.diagnose(ref, {});
    const allocationCheck = report.checks.find((check) => check.name === "allocations");
    expect(allocationCheck?.status).toBe("ok");
    expect(JSON.stringify(allocationCheck?.detail)).toContain("8080");
    const reachability = report.checks.find((check) => check.status === "unknown");
    expect(reachability?.detail).toContain("networkProbeAllowed");
    expect(report.probedTargets).toHaveLength(0);
  });

  it("probes only scoped allocation targets when enabled", async () => {
    const probed: string[] = [];
    const engine = new NetworkDiagnosticEngine({
      panels: handle.services.panels,
      consoleService: handle.services.consoleService,
      profiles: new ApplicationProfileRegistry(),
      serverCache: new ServerCacheRepository(await SqliteDatabase.inMemory(MIGRATIONS)),
      redactor: new RedactionEngine(),
      logger: createLogger({ level: "error", sink: () => undefined }),
      networkProbeAllowed: true,
      networkProbeTargets: [],
      probeTcp: async (host, port) => {
        probed.push(`${host}:${String(port)}`);
        return { ok: true };
      },
      probeHttp: async () => ({ ok: true, status: 200 }),
    });
    const report = await engine.diagnose(ref, { checks: ["tcp"] });
    expect(probed).toEqual(["10.10.0.5:8080"]);
    const tcpCheck = report.checks.find((check) => check.name.startsWith("tcp "));
    expect(tcpCheck?.status).toBe("ok");
  });

  it("uses configured probe targets instead of allocations", async () => {
    const probed: string[] = [];
    const engine = new NetworkDiagnosticEngine({
      panels: handle.services.panels,
      consoleService: handle.services.consoleService,
      profiles: new ApplicationProfileRegistry(),
      serverCache: new ServerCacheRepository(await SqliteDatabase.inMemory(MIGRATIONS)),
      redactor: new RedactionEngine(),
      logger: createLogger({ level: "error", sink: () => undefined }),
      networkProbeAllowed: true,
      networkProbeTargets: ["db.internal:3306"],
      probeTcp: async (host, port) => {
        probed.push(`${host}:${String(port)}`);
        return { ok: false, error: "connection refused" };
      },
    });
    const report = await engine.diagnose(ref, { checks: ["tcp"] });
    expect(probed).toEqual(["db.internal:3306"]);
    const tcpCheck = report.checks.find((check) => check.name.startsWith("tcp "));
    expect(tcpCheck?.status).toBe("fail");
    expect(tcpCheck?.detail).toContain("NOT reachable");
  });

  it("never probes bind-all or loopback addresses", async () => {
    panel.servers.get("web")!.allocations = [{ id: 1, ip: "0.0.0.0", port: 8080, primary: true }];
    const probed: string[] = [];
    const engine = new NetworkDiagnosticEngine({
      panels: handle.services.panels,
      consoleService: handle.services.consoleService,
      profiles: new ApplicationProfileRegistry(),
      serverCache: new ServerCacheRepository(await SqliteDatabase.inMemory(MIGRATIONS)),
      redactor: new RedactionEngine(),
      logger: createLogger({ level: "error", sink: () => undefined }),
      networkProbeAllowed: true,
      networkProbeTargets: [],
      probeTcp: async (host, port) => {
        probed.push(`${host}:${String(port)}`);
        return { ok: true };
      },
    });
    const report = await engine.diagnose(ref, { checks: ["tcp"] });
    expect(probed).toHaveLength(0);
    expect(report.checks.some((check) => check.detail.includes("bind-all"))).toBe(true);
  });
});

describe("GitService", () => {
  it("detects a repository from .git files with branch and revision", async () => {
    const revision = "a".repeat(40);
    panel.setFile("web", "/.git/HEAD", "ref: refs/heads/main\n");
    panel.setFile("web", "/.git/refs/heads/main", revision);
    panel.setFile(
      "web",
      "/.git/config",
      '[remote "origin"]\n\turl = https://user:secret-token@github.com/acme/web.git\n',
    );
    const status = await handle.services.git.status(ref, "/");
    expect(status.repository).toBe(true);
    expect(status.branch).toBe("main");
    expect(status.revision).toBe(revision.slice(0, 12));
    expect(status.remote).toBe("https://github.com/acme/web.git");
    expect(status.remote).not.toContain("secret-token");
  });

  it("reports missing repositories honestly", async () => {
    const status = await handle.services.git.status(ref, "/");
    expect(status.repository).toBe(false);
    expect(status.notes.join(" ")).toContain("no .git/HEAD");
  });

  it("rejects path traversal in the repository root", async () => {
    await expect(handle.services.git.status(ref, "../../etc")).rejects.toThrowError(/traversal/);
  });

  it("deploys through the pull endpoint and records the change", async () => {
    const result = await handle.services.git.deploy(ref, {
      actor: "test",
      branch: "main",
      approved: true,
      reason: "unit test",
    });
    expect(result.deployed).toBe(true);
    expect(panel.requestsFor("/files/pull")).toHaveLength(1);
    const changes = await handle.services.changeRepository.list({ tenant: "local", action: "git_deploy" });
    expect(changes).toHaveLength(1);
  });

  it("validates rollback revisions against command injection", async () => {
    await expect(
      handle.services.git.rollback(ref, {
        revision: "main; rm -rf /",
        actor: "test",
        approved: true,
      }),
    ).rejects.toThrowError(/Invalid git revision/);
  });

  it("combines provider commits with the deployment ledger in history", async () => {
    const providerServer = createServer((req, res) => {
      if ((req.url ?? "").includes("/commits")) {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify([
            {
              sha: "f".repeat(40),
              commit: { message: "deploy fix", author: { name: "Dev", date: "2026-01-06T10:00:00Z" } },
            },
          ]),
        );
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
    const address = providerServer.address();
    const providerPort = typeof address === "object" && address ? address.port : 0;

    panel.setFile("web", "/.git/HEAD", "ref: refs/heads/main\n");
    panel.setFile("web", "/.git/refs/heads/main", "a".repeat(40));
    panel.setFile("web", "/.git/config", '[remote "origin"]\n\turl = https://github.com/acme/web.git\n');
    handle.services.config.git.tokens.github = "ghp_test";
    handle.services.config.git.apiBase.github = `http://127.0.0.1:${String(providerPort)}`;
    await handle.services.changeLedger.record({
      ref,
      actor: "operator",
      origin: "mcp:git_deploy",
      action: "git_deploy",
      target: "/@main",
      result: "success",
    });

    const history = await handle.services.git.history(ref, { limit: 5 });
    expect(history.provider).toBe("github");
    expect((history.commits as unknown[]).length).toBe(1);
    expect((history.deploys as unknown[]).length).toBe(1);
    await new Promise<void>((resolve) => providerServer.close(() => resolve()));
  });
});
