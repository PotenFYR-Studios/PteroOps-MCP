import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockPanel, TEST_CLIENT_KEY, TEST_APPLICATION_KEY } from "../helpers/mock-panel.js";
import { createTestServices, type TestServicesHandle } from "../helpers/services.js";
import { createMcpServer } from "../../src/mcp/server.js";
import type { ServerRef } from "../../src/shared/types.js";

interface ToolCallResult {
  parsed: Record<string, unknown>;
  isError: boolean;
}

async function connect(handle: TestServicesHandle): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const bundle = createMcpServer(handle.services);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pteroops-test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), bundle.server.connect(serverTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  const text = result.content[0]?.text ?? "{}";
  return { parsed: JSON.parse(text) as Record<string, unknown>, isError: result.isError === true };
}

const MINUTE = 60_000;

describe("MCP vertical slice: crash loop investigation", () => {
  let panel: MockPanel;
  let handle: TestServicesHandle;
  let client: Client;
  let closeClient: () => Promise<void>;
  let ref: ServerRef;
  let firstOomTs: number;

  beforeEach(async () => {
    panel = await MockPanel.start({
      servers: [
        {
          identifier: "survival",
          name: "Survival",
          state: "running",
          files: {
            "/": ["server.properties", "server.jar", "plugins", "logs"],
            "/server.properties": "motd=Survival\nmax-players=20",
            "/plugins": ["EssentialsX-2.20.1.jar", "LuckPerms-5.4.102.jar"],
          },
        },
      ],
    });
    handle = await createTestServices({ panelUrl: panel.url });
    const services = handle.services;
    ref = { tenant: "local", panel: "mock", serverId: "survival" };

    const base = Date.now() - 12 * MINUTE;
    firstOomTs = base + 4 * MINUTE;

    services.changeLedger.record({
      ref,
      actor: "operator",
      origin: "mcp:write_patch",
      action: "file_write",
      target: "/plugins/EssentialsX.jar",
      beforeHash: "1111111111111111",
      afterHash: "2222222222222222",
      result: "success",
      risk: "MEDIUM",
      reason: "plugin update",
      ts: firstOomTs - 4 * MINUTE,
    });

    services.consoleService.ingest(ref, "[12:00:00] [Server thread/INFO]: Starting minecraft server version 1.21.4", base);
    services.consoleService.ingest(ref, "Server marked as running", base + 5_000);
    services.consoleService.ingest(ref, 'Done (14.512s)! For help, type "help"', base + 15_000);
    for (let i = 0; i < 3; i++) {
      const ts = firstOomTs + i * 3 * MINUTE;
      services.consoleService.ingest(ref, "java.lang.OutOfMemoryError: Java heap space", ts);
      services.consoleService.ingest(
        ref,
        "\tat net.minecraft.world.level.chunk.LevelChunkSection.recalcBlockCounts(LevelChunkSection.java:1)",
        ts + 10,
      );
      services.crashTracker.record(ref, { ts, kind: "started", source: "poll" });
      services.crashTracker.record(ref, { ts: ts + 30_000, kind: "exited", runtimeMs: 30_000, source: "poll" });
      services.consoleService.ingest(ref, "Server marked as offline", ts + 30_000);
    }
    await services.consoleService.flush();

    const connected = await connect(handle);
    client = connected.client;
    closeClient = connected.close;
  });

  afterEach(async () => {
    await closeClient();
    await handle.close();
    await panel.close();
  });

  it("registers the slice toolset", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    for (const expected of [
      "ptero_get_capabilities",
      "ptero_list_servers",
      "ptero_get_server",
      "ptero_get_metrics",
      "ptero_get_health",
      "ptero_console_query",
      "ptero_analyze_logs",
      "ptero_send_command",
      "ptero_power_action",
      "ptero_detect_application",
      "ptero_analyze_dependencies",
      "ptero_diagnose",
      "ptero_list_incidents",
      "ptero_get_incident",
      "ptero_get_change_history",
      "ptero_read_file",
      "ptero_list_files",
      "ptero_get_risk",
      "ptero_get_policy",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("reports capabilities and never leaks keys", async () => {
    const { parsed } = await call(client, "ptero_get_capabilities");
    const text = JSON.stringify(parsed);
    expect(text).not.toContain(TEST_CLIENT_KEY);
    expect(text).not.toContain(TEST_APPLICATION_KEY);
    const panels = parsed.panels as Array<Record<string, unknown>>;
    expect(panels[0]!.name).toBe("mock");
    expect((panels[0]!.capabilities as string[]).length).toBeGreaterThan(10);
    const logs = handle.logs.join("\n");
    expect(logs).not.toContain(TEST_CLIENT_KEY);
    expect(logs).not.toContain(TEST_APPLICATION_KEY);
  });

  it("lists servers and reads resources live from the panel", async () => {
    const { parsed } = await call(client, "ptero_list_servers");
    const servers = parsed.servers as Array<Record<string, unknown>>;
    expect(servers).toHaveLength(1);
    expect(servers[0]!.server).toBe("mock/survival");
    const metrics = await call(client, "ptero_get_metrics", { server: "survival" });
    expect((metrics.parsed.latest as Record<string, unknown>).state).toBe("running");
  });

  it("reports crash_loop health instead of 'running'", async () => {
    const { parsed } = await call(client, "ptero_get_health", { server: "survival" });
    expect(parsed.status).toBe("crash_loop");
    expect(Number(parsed.score)).toBeLessThanOrEqual(20);
    expect((parsed.checks as unknown[]).length).toBeGreaterThan(3);
  });

  it("answers 'show errors from the last 20 minutes' with grouped output", async () => {
    const { parsed } = await call(client, "ptero_console_query", {
      server: "survival",
      window: "20m",
      severities: ["error", "fatal"],
    });
    const groups = parsed.groups as Array<Record<string, unknown>>;
    expect(groups.length).toBeGreaterThan(0);
    const oomGroup = groups.find((group) => String(group.exceptionType ?? "").includes("OutOfMemoryError"));
    expect(oomGroup).toBeDefined();
    expect(Number(oomGroup!.count)).toBeGreaterThanOrEqual(2);
  });

  it("answers 'what happened before the crash' with bounded context", async () => {
    const { parsed } = await call(client, "ptero_console_query", {
      server: "survival",
      mode: "before",
      around: new Date(firstOomTs).toISOString(),
      limit: 10,
    });
    const events = parsed.events as Array<Record<string, unknown>>;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => Number(event.ts) < firstOomTs)).toBe(true);
  });

  it("detects the application with evidence and confidence", async () => {
    const { parsed } = await call(client, "ptero_detect_application", { server: "survival" });
    const detection = parsed.detection as Record<string, unknown>;
    expect(detection.application).toBe("minecraft");
    expect(detection.runtime).toBe("java");
    expect(detection.version).toBe("1.21.4");
    expect(Number(detection.confidence)).toBeGreaterThan(0.6);
    expect((detection.evidence as unknown[]).length).toBeGreaterThan(0);
  });

  it("analyzes logs with the OOM pattern and stack traces", async () => {
    const { parsed } = await call(client, "ptero_analyze_logs", { server: "survival", windowMinutes: 60 });
    const patternIds = (parsed.patterns as Array<Record<string, unknown>>).map((pattern) => pattern.id);
    expect(patternIds).toContain("oom_java");
    const issues = parsed.issues as Array<Record<string, unknown>>;
    expect(issues.length).toBeGreaterThan(0);
    expect(String(parsed.summary)).toContain("fatal");
  });

  it("analyzes dependencies from plugin listings", async () => {
    const { parsed } = await call(client, "ptero_analyze_dependencies", { server: "survival" });
    const ecosystems = parsed.ecosystems as Array<Record<string, unknown>>;
    const minecraft = ecosystems.find((eco) => eco.ecosystem === "minecraft");
    expect(minecraft).toBeDefined();
    expect((minecraft!.components as unknown[]).length).toBe(2);
  });

  it("correlates the change ledger around the first error", async () => {
    const { parsed } = await call(client, "ptero_get_change_history", {
      server: "survival",
      around: new Date(firstOomTs).toISOString(),
      window: "15m",
    });
    const changes = parsed.changes as Array<Record<string, unknown>>;
    expect(changes.length).toBe(1);
    expect(changes[0]!.action).toBe("file_write");
    expect(String(changes[0]!.target)).toContain("EssentialsX");
  });

  it("produces a diagnosis with causes, confidence, recommendations and an incident", async () => {
    const { parsed, isError } = await call(client, "ptero_diagnose", { server: "survival" });
    expect(isError).toBe(false);
    expect(parsed.summary).toBeTypeOf("string");
    const causes = parsed.probableCauses as Array<Record<string, unknown>>;
    expect(causes.length).toBeGreaterThan(0);
    const oomCause = causes.find((cause) => String(cause.cause).toLowerCase().includes("memory"));
    expect(oomCause).toBeDefined();
    expect(Number(oomCause!.confidence)).toBeGreaterThan(0.5);
    const changeCause = causes.find((cause) => String(cause.cause).includes("Recent change"));
    expect(changeCause).toBeDefined();
    const actions = parsed.recommendedActions as Array<Record<string, unknown>>;
    expect(actions.some((action) => action.action === "startup_variable_change")).toBe(true);
    expect(parsed.incidentId).toBeTruthy();
    expect((parsed.observedFacts as unknown[]).length).toBeGreaterThan(3);
    expect(parsed.missingEvidence).toBeDefined();

    const incidentResult = await call(client, "ptero_get_incident", {
      id: String(parsed.incidentId),
      includeEvidence: true,
    });
    expect(String((incidentResult.parsed.incident as Record<string, unknown>).title)).toContain("Crash loop");
    expect((incidentResult.parsed.evidence as unknown[]).length).toBeGreaterThan(0);
    expect((incidentResult.parsed.relatedChanges as unknown[]).length).toBeGreaterThan(0);
  });

  it("lists incidents and deduplicates repeated diagnoses into one incident", async () => {
    await call(client, "ptero_diagnose", { server: "survival" });
    await call(client, "ptero_diagnose", { server: "survival" });
    const { parsed } = await call(client, "ptero_list_incidents", { open: true });
    const incidents = parsed.incidents as Array<Record<string, unknown>>;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.state).toBe("detected");
  });

  it("guards restarts during a crash loop", async () => {
    const result = await call(client, "ptero_power_action", {
      server: "survival",
      action: "restart",
    });
    expect(result.isError).toBe(true);
    const error = result.parsed.error as Record<string, unknown>;
    expect(error.code).toBe("POLICY_DENIED");
    expect(String(error.message)).toContain("crash loop");
    expect(panel.requestsFor("/power")).toHaveLength(0);
  });

  it("refuses path traversal on file reads", async () => {
    const result = await call(client, "ptero_read_file", {
      server: "survival",
      path: "../../../etc/passwd",
    });
    expect(result.isError).toBe(true);
    const error = result.parsed.error as Record<string, unknown>;
    expect(error.code).toBe("VALIDATION");
    expect(String(error.message)).toContain("traversal");
  });

  it("audits mutating tools and records them in the change ledger", async () => {
    const sendResult = await call(client, "ptero_send_command", {
      server: "survival",
      command: "say maintenance soon",
      reason: "player notification",
    });
    expect(sendResult.isError).toBe(false);
    await handle.services.auditLog.flush();
    const auditEvents = await handle.services.auditRepository.list({ tenant: "local" });
    const audited = auditEvents.find((event) => event.tool === "ptero_send_command");
    expect(audited).toBeDefined();
    expect(audited!.success).toBe(true);
    const changes = await handle.services.changeRepository.list({ tenant: "local", action: "send_command" });
    expect(changes).toHaveLength(1);
  });

  it("blocks dangerous console commands via policy", async () => {
    const result = await call(client, "ptero_send_command", {
      server: "survival",
      command: "rm -rf / --no-preserve-root",
    });
    expect(result.isError).toBe(true);
    expect((result.parsed.error as Record<string, unknown>).code).toBe("POLICY_DENIED");
  });

  it("classifies risk for proposed actions", async () => {
    const { parsed } = await call(client, "ptero_get_risk", {
      action: "restore_backup",
      server: "survival",
    });
    expect(parsed.risk).toBe("HIGH");
    expect(parsed.requiresApproval).toBe(true);
  });
});

describe("MCP capability gating", () => {
  let panel: MockPanel;
  let handle: TestServicesHandle;
  let client: Client;
  let closeClient: () => Promise<void>;

  beforeEach(async () => {
    panel = await MockPanel.start();
    handle = await createTestServices({
      panelUrl: panel.url,
      clientKey: null,
      applicationKey: TEST_APPLICATION_KEY,
    });
    const connected = await connect(handle);
    client = connected.client;
    closeClient = connected.close;
  });

  afterEach(async () => {
    await closeClient();
    await handle.close();
    await panel.close();
  });

  it("hides client-only tools when only an application key is configured", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toContain("ptero_get_capabilities");
    expect(names).toContain("ptero_list_servers");
    expect(names).not.toContain("ptero_send_command");
    expect(names).not.toContain("ptero_power_action");
    expect(names).not.toContain("ptero_get_startup");
    expect(names).not.toContain("ptero_console_query");
  });

  it("still lists servers through the application API", async () => {
    const { parsed, isError } = await call(client, "ptero_list_servers");
    expect(isError).toBe(false);
    expect((parsed.servers as unknown[]).length).toBe(1);
  });
});

describe("MCP extended surface: patching, remediation, infrastructure", () => {
  let panel: MockPanel;
  let handle: TestServicesHandle;
  let client: Client;
  let closeClient: () => Promise<void>;
  let ref: ServerRef;

  beforeEach(async () => {
    panel = await MockPanel.start({
      servers: [
        {
          identifier: "survival",
          name: "Survival",
          state: "running",
          node: "node-1",
          variables: [{ envVariable: "MEMORY", serverValue: "2048" }],
          files: {
            "/": ["server.properties", "server.jar", "plugins"],
            "/server.properties": "motd=Survival\nmax-players=20",
            "/plugins": ["EssentialsX-2.20.1.jar"],
          },
          backups: [{ uuid: "backup-1", createdAt: new Date().toISOString(), bytes: 50 * 1024 * 1024 }],
          databases: [{ id: 1, name: "survival_db", hostAddress: "db.internal" }],
          schedules: [{ id: 1, name: "nightly-restart" }],
          allocations: [{ id: 1, ip: "10.0.0.9", port: 25565, primary: true }],
          subusers: [{ uuid: "sub-1", email: "helper@example.com", permissions: ["control.console"] }],
        },
      ],
    });
    handle = await createTestServices({ panelUrl: panel.url });
    ref = { tenant: "local", panel: "mock", serverId: "survival" };
    const remediation = handle.services.config.remediation;
    remediation.healthPollSeconds = 1;
    remediation.stabilizationSeconds = 0;
    remediation.healthTimeoutSeconds = 5;
    handle.services.consoleService.ingest(ref, "Server marked as running", Date.now() - 30_000);
    handle.services.consoleService.ingest(ref, 'Done (12.345s)! For help, type "help"', Date.now() - 25_000);
    await handle.services.consoleService.flush();
    handle.services.serverCache.upsert({
      ref,
      uuid: null,
      name: "Survival",
      state: "running",
      application: "minecraft/bukkit-family",
      now: Date.now(),
    });
    const connected = await connect(handle);
    client = connected.client;
    closeClient = connected.close;
  });

  afterEach(async () => {
    await closeClient();
    await handle.close();
    await panel.close();
  });

  it("registers the full operational toolset", async () => {
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(55);
    const names = tools.tools.map((tool) => tool.name);
    for (const expected of [
      "ptero_write_patch",
      "ptero_propose_remediation",
      "ptero_approve_action",
      "ptero_execute_remediation",
      "ptero_rollback_remediation",
      "ptero_run_tests",
      "ptero_remediation_stats",
      "ptero_simulate_remediation",
      "ptero_canary_remediate",
      "ptero_list_backups",
      "ptero_create_backup",
      "ptero_backup_status",
      "ptero_list_databases",
      "ptero_manage_database",
      "ptero_list_schedules",
      "ptero_manage_schedule",
      "ptero_manage_allocation",
      "ptero_manage_subuser",
      "ptero_set_startup_variable",
      "ptero_admin_list_nodes",
      "ptero_admin_list_users",
      "ptero_admin_list_nests",
      "ptero_git_status",
      "ptero_git_deploy",
      "ptero_git_rollback",
      "ptero_get_topology",
      "ptero_network_diagnose",
      "ptero_investigate_incident",
      "ptero_compare_known_good",
      "ptero_compare_server_group",
      "ptero_query_audit",
      "ptero_list_scheduler_jobs",
      "ptero_run_scheduler_job",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("supports the full write_patch flow (read hash, dry-run, apply, verify)", async () => {
    const read = await call(client, "ptero_read_file", { server: "survival", path: "/server.properties" });
    expect(read.parsed.hash).toBeTypeOf("string");

    const dryRun = await call(client, "ptero_write_patch", {
      server: "survival",
      path: "/server.properties",
      expectedHash: read.parsed.hash,
      edits: [{ find: "max-players=20", replace: "max-players=40" }],
      dryRun: true,
    });
    expect(dryRun.isError).toBe(false);
    expect(dryRun.parsed.dryRun).toBe(true);
    expect(String(dryRun.parsed.diff)).toContain("+max-players=40");
    expect(panel.readFile("survival", "/server.properties")).toContain("max-players=20");

    const applied = await call(client, "ptero_write_patch", {
      server: "survival",
      path: "/server.properties",
      expectedHash: read.parsed.hash,
      edits: [{ find: "max-players=20", replace: "max-players=40" }],
      reason: "raise cap",
    });
    expect(applied.isError).toBe(false);
    expect(applied.parsed.verified).toBe(true);
    expect(applied.parsed.snapshotId).toBeTruthy();
    expect(panel.readFile("survival", "/server.properties")).toContain("max-players=40");

    const stale = await call(client, "ptero_write_patch", {
      server: "survival",
      path: "/server.properties",
      expectedHash: read.parsed.hash,
      content: "overwritten",
    });
    expect(stale.isError).toBe(true);
    expect((stale.parsed.error as Record<string, unknown>).code).toBe("STALE_WRITE");
  });

  it("runs the propose -> simulate -> dry-run execute flow with policy gating", async () => {
    const proposed = await call(client, "ptero_propose_remediation", {
      server: "survival",
      action: "restart_server",
      reason: "operator requested a restart after the change window",
    });
    expect(proposed.isError).toBe(false);
    const approval = proposed.parsed.approval as Record<string, unknown>;
    expect(approval.state).toBe("proposed");
    expect(proposed.parsed.requiresApproval).toBe(true);

    const pendingExecution = await call(client, "ptero_execute_remediation", {
      approvalId: approval.id,
    });
    expect(pendingExecution.isError).toBe(true);
    expect((pendingExecution.parsed.error as Record<string, unknown>).code).toBe("POLICY_DENIED");

    const simulated = await call(client, "ptero_simulate_remediation", {
      approvalId: approval.id,
    });
    expect(simulated.isError).toBe(false);
    expect((simulated.parsed.checks as unknown[]).length).toBeGreaterThan(0);

    const dryRun = await call(client, "ptero_execute_remediation", {
      approvalId: approval.id,
      dryRun: true,
    });
    expect(dryRun.isError).toBe(false);
    expect(dryRun.parsed.dryRun).toBe(true);
    expect(panel.requestsFor("/power")).toHaveLength(0);

    const approved = await call(client, "ptero_approve_action", {
      approvalId: approval.id,
      decision: "approve",
      note: "confirmed",
    });
    expect(approved.isError).toBe(false);
    expect((approved.parsed.approval as Record<string, unknown>).state).toBe("approved");

    const executed = await call(client, "ptero_execute_remediation", {
      approvalId: approval.id,
    });
    expect(executed.isError).toBe(false);
    expect(executed.parsed.state).toBe("succeeded");
    expect(panel.requestsFor("/power").length).toBeGreaterThan(0);

    const stats = await call(client, "ptero_remediation_stats", { sinceDays: 30 });
    expect(stats.isError).toBe(false);
    expect((stats.parsed.stats as unknown[]).length).toBeGreaterThan(0);
    expect((stats.parsed.recent as Array<Record<string, unknown>>)[0]!.state).toBe("succeeded");
  });

  it("exposes infrastructure tools with real data", async () => {
    const backups = await call(client, "ptero_backup_status", { server: "survival" });
    expect(backups.isError).toBe(false);
    expect(backups.parsed.newestSuccessful).toBeTruthy();

    const databases = await call(client, "ptero_list_databases", { server: "survival" });
    expect(databases.isError).toBe(false);
    expect(JSON.stringify(databases.parsed)).toContain("survival_db");
    expect(JSON.stringify(databases.parsed)).toContain("[REDACTED]");

    const schedules = await call(client, "ptero_list_schedules", { server: "survival" });
    expect(schedules.isError).toBe(false);
    expect(JSON.stringify(schedules.parsed)).toContain("nightly-restart");

    const allocations = await call(client, "ptero_list_allocations", { server: "survival" });
    expect(allocations.isError).toBe(false);
    expect(JSON.stringify(allocations.parsed)).toContain("10.0.0.9");

    const subusers = await call(client, "ptero_list_subusers", { server: "survival" });
    expect(subusers.isError).toBe(false);
    expect(JSON.stringify(subusers.parsed)).toContain("helper@example.com");

    const nodes = await call(client, "ptero_admin_list_nodes");
    expect(nodes.isError).toBe(false);

    const topology = await call(client, "ptero_get_topology", { rebuild: true });
    expect(topology.isError).toBe(false);
    expect((topology.parsed.nodes as Array<Record<string, unknown>>).length).toBeGreaterThan(3);

    const knownGood = await call(client, "ptero_compare_known_good", { server: "survival", capture: true });
    expect(knownGood.isError).toBe(false);
    expect(knownGood.parsed.captured).toBe(true);

    const gitStatus = await call(client, "ptero_git_status", { server: "survival" });
    expect(gitStatus.isError).toBe(false);
    expect(gitStatus.parsed.repository).toBe(false);

    const audit = await call(client, "ptero_query_audit", { limit: 5 });
    expect(audit.isError).toBe(false);
    expect((audit.parsed.events as unknown[]).length).toBeGreaterThan(0);

    const investigation = await call(client, "ptero_investigate_incident", { panel: "mock" });
    expect(investigation.isError).toBe(false);
    expect(Number(investigation.parsed.serversExamined)).toBe(1);
    expect(JSON.stringify(investigation.parsed.affected)).toContain("mock/survival");

    const jobs = await call(client, "ptero_list_scheduler_jobs");
    expect(jobs.isError).toBe(false);

    const network = await call(client, "ptero_network_diagnose", { server: "survival" });
    expect(network.isError).toBe(false);
    expect((network.parsed.checks as unknown[]).length).toBeGreaterThan(0);
  });

  it("manages schedules, allocations and subusers through action tools", async () => {
    const created = await call(client, "ptero_manage_schedule", {
      server: "survival",
      action: "create",
      name: "hourly-backup",
      cron: { minute: "0", hour: "*" },
      tasks: [{ action: "backup", payload: "" }],
    });
    expect(created.isError).toBe(false);
    expect(created.parsed.created).toBe(true);

    const assign = await call(client, "ptero_manage_allocation", {
      server: "survival",
      action: "assign",
    });
    expect(assign.isError).toBe(false);
    expect(assign.parsed.assigned).toBe(true);

    const invited = await call(client, "ptero_manage_subuser", {
      server: "survival",
      action: "create",
      email: "newhelper@example.com",
      permissions: ["control.console"],
    });
    expect(invited.isError).toBe(false);
    expect(invited.parsed.created).toBe(true);

    const variable = await call(client, "ptero_set_startup_variable", {
      server: "survival",
      key: "MEMORY",
      value: "4096",
      reason: "memory increase",
    });
    expect(variable.isError).toBe(false);
    expect(variable.parsed.previousValue).toBe("2048");
    expect(variable.parsed.newValue).toBe("4096");
  });
});