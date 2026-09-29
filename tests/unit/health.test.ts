import { describe, expect, it } from "vitest";
import { assessHealth, type HealthInput } from "../../src/health/engine.js";
import type { CrashAssessment } from "../../src/intelligence/crash-loop/detector.js";
import type { ServerRef } from "../../src/shared/types.js";

const ref: ServerRef = { tenant: "local", panel: "mock", serverId: "survival" };

function baseInput(overrides: Partial<HealthInput> = {}): HealthInput {
  const noCrash: CrashAssessment = {
    inCrashLoop: false,
    newDetection: false,
    restartCount: 0,
    crashCount: 0,
    windowMs: 15 * 60_000,
    avgRuntimeMs: null,
    lastExitCode: null,
    confidence: 0,
    evidence: [],
  };
  return {
    ref,
    serverName: "Survival",
    state: "running",
    suspended: false,
    memoryBytes: 500 * 1024 * 1024,
    memoryLimitBytes: 2 * 1024 * 1024 * 1024,
    diskBytes: 1 * 1024 * 1024 * 1024,
    diskLimitBytes: 10 * 1024 * 1024 * 1024,
    cpuAveragePercent: 20,
    uptimeMs: 3_600_000,
    recentErrors: { count: 0, windowMs: 600_000 },
    crash: noCrash,
    readyMarkerSeen: true,
    readyMarkerExpected: true,
    expectedStartupMs: 180_000,
    assessedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("HealthEngine", () => {
  it("reports healthy for a quiet, resourced server", () => {
    const health = assessHealth(baseInput());
    expect(health.status).toBe("healthy");
    expect(health.score).toBe(100);
  });

  it("reports crash_loop over 'running'", () => {
    const health = assessHealth(
      baseInput({
        crash: {
          inCrashLoop: true,
          newDetection: true,
          restartCount: 4,
          crashCount: 4,
          windowMs: 15 * 60_000,
          avgRuntimeMs: 38_000,
          lastExitCode: 137,
          confidence: 0.9,
          evidence: ["4 process starts", "4 short exits"],
        },
      }),
    );
    expect(health.status).toBe("crash_loop");
    expect(health.score).toBeLessThanOrEqual(20);
    expect(health.evidence.length).toBeGreaterThan(0);
    expect(health.explanation).toContain("crash_loop");
  });

  it("is unhealthy when memory is exhausted", () => {
    const health = assessHealth(
      baseInput({
        memoryBytes: 1_990 * 1024 * 1024,
        memoryLimitBytes: 2 * 1024 * 1024 * 1024,
      }),
    );
    expect(health.status).toBe("unhealthy");
    expect(health.checks.find((check) => check.name === "memory-pressure")?.status).toBe("fail");
  });

  it("is degraded on elevated error rate", () => {
    const health = assessHealth(
      baseInput({ recentErrors: { count: 60, windowMs: 600_000 } }),
    );
    expect(health.status).toBe("degraded");
  });

  it("is unhealthy when offline", () => {
    const health = assessHealth(baseInput({ state: "offline" }));
    expect(health.status).toBe("unhealthy");
  });

  it("reports starting during startup", () => {
    const health = assessHealth(baseInput({ state: "starting", readyMarkerSeen: null }));
    expect(health.status).toBe("starting");
  });

  it("warns when the ready marker never appears", () => {
    const health = assessHealth(
      baseInput({
        readyMarkerSeen: false,
        uptimeMs: 600_000,
        expectedStartupMs: 180_000,
      }),
    );
    const check = health.checks.find((item) => item.name === "ready-marker");
    expect(check?.status).toBe("warn");
    expect(health.status).not.toBe("healthy");
  });

  it("always includes explanation and per-check evidence", () => {
    const health = assessHealth(baseInput({ state: "offline" }));
    expect(health.explanation.length).toBeGreaterThan(0);
    expect(health.checks.length).toBeGreaterThanOrEqual(5);
  });
});
