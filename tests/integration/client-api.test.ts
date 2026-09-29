import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockPanel, TEST_CLIENT_KEY } from "../helpers/mock-panel.js";
import { PterodactylClientApi } from "../../src/pterodactyl/client-api.js";
import { PterodactylApplicationApi } from "../../src/pterodactyl/application-api.js";
import { createLogger } from "../../src/observability/logger.js";
import { MetricsRegistry } from "../../src/observability/metrics.js";
import { RedactionEngine } from "../../src/shared/redaction.js";
import { AuthError, NotFoundError, TimeoutError, UpstreamError } from "../../src/shared/errors.js";
import type { ServerRef } from "../../src/shared/types.js";

let panel: MockPanel;
let clientApi: PterodactylClientApi;
let applicationApi: PterodactylApplicationApi;
const ref: ServerRef = { tenant: "local", panel: "mock", serverId: "survival" };

function buildApis(options: { timeoutMs?: number; maxRetries?: number } = {}) {
  const logger = createLogger({ level: "error", sink: () => undefined });
  const metrics = new MetricsRegistry();
  const redactor = new RedactionEngine();
  clientApi = new PterodactylClientApi({
    panel: "mock",
    baseUrl: panel.url,
    apiKey: TEST_CLIENT_KEY,
    timeoutMs: options.timeoutMs ?? 5_000,
    maxRetries: options.maxRetries ?? 3,
    logger,
    metrics,
    redactor,
  });
  applicationApi = new PterodactylApplicationApi({
    panel: "mock",
    baseUrl: panel.url,
    apiKey: "ptla_test_application_key_1234567890",
    timeoutMs: options.timeoutMs ?? 5_000,
    maxRetries: options.maxRetries ?? 3,
    logger,
    metrics,
    redactor,
  });
}

beforeEach(async () => {
  panel = await MockPanel.start();
  buildApis();
});

afterEach(async () => {
  await panel.close();
});

describe("PterodactylClientApi against a mock panel", () => {
  it("lists and normalizes servers", async () => {
    const result = await clientApi.listServers({ tenant: "local", panel: "mock" });
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]!.name).toBe("Survival");
    expect(result.servers[0]!.state).toBe("running");
    expect(result.servers[0]!.limits.memoryMb).toBe(2048);
  });

  it("fetches server details with allocations", async () => {
    const detail = await clientApi.getServer(ref);
    expect(detail.uuid).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(detail.primaryAllocation?.port).toBe(25565);
  });

  it("normalizes resources with defensive field handling", async () => {
    const resources = await clientApi.getResources(ref, { memoryMb: 2048, diskMb: 10240 });
    expect(resources.state).toBe("running");
    expect(resources.memoryLimitBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(resources.cpuAbsolute).toBe(12.5);
  });

  it("returns startup command, image and variables", async () => {
    const startup = await clientApi.getStartup(ref);
    expect(startup.startupCommand).toContain("java");
    expect(startup.dockerImage).toContain("yolks");
  });

  it("lists and reads files", async () => {
    const listing = await clientApi.listFiles(ref, "/");
    expect(listing.map((entry) => entry.name)).toContain("server.properties");
    expect(listing.find((entry) => entry.name === "plugins")?.directory).toBe(true);
    const content = await clientApi.readFile(ref, "/server.properties");
    expect(content).toContain("max-players=20");
  });

  it("sends commands and power actions", async () => {
    await clientApi.sendCommand(ref, "say hello");
    await clientApi.setPower(ref, "restart");
    const bodies = panel.requestsFor("/command").map((request) => request.body);
    expect(bodies[0]).toContain("say hello");
    expect(panel.requestsFor("/power")[0]!.body).toContain("restart");
  });

  it("reads websocket credentials", async () => {
    const credentials = await clientApi.getWebsocket(ref);
    expect(credentials.token).toBe("mock.jwt.token");
    expect(credentials.socket.startsWith("ws://")).toBe(true);
  });

  it("retries GET requests on 5xx with backoff", async () => {
    panel.failNext(2, 500);
    const result = await clientApi.listServers({ tenant: "local", panel: "mock" });
    expect(result.servers).toHaveLength(1);
    expect(panel.requestsFor("/api/client").length).toBe(3);
  });

  it("never retries mutating POST requests", async () => {
    panel.failNext(1, 500);
    await expect(clientApi.setPower(ref, "restart")).rejects.toThrowError(UpstreamError);
    expect(panel.requestsFor("/power").length).toBe(1);
  });

  it("retries rate-limited GET requests", async () => {
    panel.failNext(1, 429);
    const result = await clientApi.listServers({ tenant: "local", panel: "mock" });
    expect(result.servers).toHaveLength(1);
    expect(panel.requestsFor("/api/client").length).toBeGreaterThanOrEqual(2);
  });

  it("maps 401 to AuthError without retrying", async () => {
    const logger = createLogger({ level: "error", sink: () => undefined });
    const badKeyApi = new PterodactylClientApi({
      panel: "mock",
      baseUrl: panel.url,
      apiKey: "ptlc_wrong_key_value_000000",
      timeoutMs: 5_000,
      maxRetries: 3,
      logger,
      metrics: new MetricsRegistry(),
      redactor: new RedactionEngine(),
    });
    const before = panel.requests.length;
    await expect(badKeyApi.listServers({ tenant: "local", panel: "mock" })).rejects.toThrowError(AuthError);
    expect(panel.requests.length - before).toBe(1);
  });

  it("maps 404 to NotFoundError", async () => {
    const missing: ServerRef = { tenant: "local", panel: "mock", serverId: "does-not-exist" };
    await expect(clientApi.getServer(missing)).rejects.toThrowError(NotFoundError);
  });

  it("aborts on timeout", async () => {
    panel.setDelay(1000);
    buildApis({ timeoutMs: 150, maxRetries: 0 });
    await expect(clientApi.listServers({ tenant: "local", panel: "mock" })).rejects.toThrowError(TimeoutError);
  });

  it("never leaks the API key into errors", async () => {
    panel.failNext(1, 401);
    try {
      await clientApi.listServers({ tenant: "local", panel: "mock" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(TEST_CLIENT_KEY);
    }
  });
});

describe("PterodactylApplicationApi against a mock panel", () => {
  it("lists application servers", async () => {
    const result = await applicationApi.listServers({ tenant: "local", panel: "mock" });
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]!.name).toBe("Survival");
  });
});
