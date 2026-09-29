import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockPanel } from "../helpers/mock-panel.js";
import { createTestServices, type TestServicesHandle } from "../helpers/services.js";
import type { ServerRef } from "../../src/shared/types.js";

let panel: MockPanel;
let handle: TestServicesHandle;
let ref: ServerRef;

beforeEach(async () => {
  panel = await MockPanel.start({
    servers: [
      { identifier: "survival", name: "Survival", state: "running" },
      { identifier: "creative", name: "Creative", state: "offline" },
    ],
  });
  handle = await createTestServices({ panelUrl: panel.url });
  ref = { tenant: "local", panel: "mock", serverId: "survival" };
  const now = Date.now();
  for (const serverId of ["survival", "creative"]) {
    handle.services.serverCache.upsert({
      ref: { tenant: "local", panel: "mock", serverId },
      uuid: null,
      name: serverId,
      state: null,
      application: null,
      now,
    });
  }
});

afterEach(async () => {
  await handle.close();
  await panel.close();
});

describe("DiagnosticsScheduler", () => {
  it("runs due jobs and advances their schedule", async () => {
    await handle.services.scheduleRepository.upsert({
      id: "sched:prune",
      name: "nightly-prune",
      kind: "retention_prune",
      scope: ["*"],
      everyMs: 60_000,
      enabled: true,
      nextRun: Date.now() - 1000,
    });
    const ran = await handle.services.scheduler.runDue();
    expect(ran).toContain("nightly-prune");
    const record = (await handle.services.scheduleRepository.list())[0]!;
    expect(record.lastRun).not.toBeNull();
    expect(record.nextRun).toBeGreaterThan(Date.now() - 1000);
    expect(record.lastResult).toHaveProperty("consoleEventsDeleted");
  });

  it("skips jobs that are not due and disabled jobs", async () => {
    await handle.services.scheduleRepository.upsert({
      id: "sched:future",
      name: "future",
      kind: "health_scan",
      scope: ["*"],
      everyMs: 60_000,
      enabled: true,
      nextRun: Date.now() + 3_600_000,
    });
    await handle.services.scheduleRepository.upsert({
      id: "sched:off",
      name: "disabled",
      kind: "health_scan",
      scope: ["*"],
      everyMs: 60_000,
      enabled: false,
      nextRun: Date.now() - 1000,
    });
    const ran = await handle.services.scheduler.runDue();
    expect(ran).toHaveLength(0);
  });

  it("opens a deduplicated incident for unhealthy servers in a health scan", async () => {
    await handle.services.scheduleRepository.upsert({
      id: "sched:health-scan",
      name: "health-scan",
      kind: "health_scan",
      scope: ["*"],
      everyMs: 300_000,
      enabled: true,
      nextRun: Date.now() + 300_000,
    });
    const result = await handle.services.scheduler.runNow("health-scan");
    expect(result.scanned).toBe(2);
    expect(result.unhealthy).toBe(1);
    expect(await handle.services.incidentService.countOpen("local")).toBe(1);

    const incidents = await handle.services.incidentService.list({ tenant: "local", openOnly: true });
    expect(incidents[0]!.title).toContain("unhealthy");

    await handle.services.scheduler.runNow("health-scan");
    expect(await handle.services.incidentService.countOpen("local")).toBe(1);
  });

  it("computes baselines and anomaly hints from stored samples", async () => {
    const now = Date.now();
    for (let i = 0; i < 40; i++) {
      await handle.services.metricSampleRepository.insert({
        ref,
        ts: now - (40 - i) * 60_000,
        state: "running",
        cpuPercent: 20,
        memoryBytes: 400 * 1024 * 1024,
        memoryLimitBytes: 2048 * 1024 * 1024,
        diskBytes: 1000,
        diskLimitBytes: 10_000,
        netRxBytes: 0,
        netTxBytes: 0,
        uptimeMs: 1000,
      });
    }
    await handle.services.metricSampleRepository.insert({
      ref,
      ts: now,
      state: "running",
      cpuPercent: 20,
      memoryBytes: 1800 * 1024 * 1024,
      memoryLimitBytes: 2048 * 1024 * 1024,
      diskBytes: 1000,
      diskLimitBytes: 10_000,
      netRxBytes: 0,
      netTxBytes: 0,
      uptimeMs: 1000,
    });

    const baselines = await handle.services.baselines.update(ref);
    expect(baselines.map((record) => record.metric)).toContain("memory_percent");
    const hints = await handle.services.baselines.hints(ref);
    expect(hints.some((hint) => hint.metric === "memory_percent")).toBe(true);
    expect(hints[0]!.ratio).toBeGreaterThan(3);
  });
});
