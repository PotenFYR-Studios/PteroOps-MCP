import { describe, expect, it } from "vitest";
import { analyzeLogEvents } from "../../src/intelligence/logs/engine.js";
import { fingerprintOf } from "../../src/shared/hash.js";
import type { ConsoleEvent } from "../../src/persistence/models.js";
import type { Severity } from "../../src/shared/types.js";

let sequence = 0;

function event(line: string, ts: number, severity: Severity, exceptionType: string | null = null): ConsoleEvent {
  sequence += 1;
  return {
    id: sequence,
    ref: { tenant: "local", panel: "mock", serverId: "survival" },
    ts,
    raw: line,
    normalized: line,
    severity,
    subsystem: null,
    exceptionType,
    fingerprint: severity === "warn" || severity === "error" || severity === "fatal" ? fingerprintOf(line) : null,
    incidentId: null,
    correlationId: null,
  };
}

describe("LogIntelligenceEngine (analyzeLogEvents)", () => {
  const t0 = 1_700_000_000_000;

  it("groups 10,000 identical OOM errors into one issue with counts", () => {
    const events: ConsoleEvent[] = [];
    for (let i = 0; i < 10_000; i++) {
      events.push(
        event(
          `java.lang.OutOfMemoryError: Java heap space at ChunkMap.java:${1000 + i}`,
          t0 + i * 10,
          "fatal",
          "java.lang.OutOfMemoryError",
        ),
      );
    }
    const analysis = analyzeLogEvents(events);
    expect(analysis.issues).toHaveLength(1);
    expect(analysis.issues[0]!.count).toBe(10_000);
    expect(analysis.issues[0]!.exceptionType).toBe("java.lang.OutOfMemoryError");
    expect(analysis.issues[0]!.firstSeen).toBe(t0);
    expect(analysis.issues[0]!.lastSeen).toBe(t0 + 9999 * 10);
    expect(analysis.bySeverity.fatal).toBe(10_000);
    expect(analysis.summary).toContain("top issue");
  });

  it("does not group distinct errors together", () => {
    const events = [
      event("java.lang.OutOfMemoryError: Java heap space", t0, "fatal", "java.lang.OutOfMemoryError"),
      event("Address already in use", t0 + 1000, "error", null),
    ];
    const analysis = analyzeLogEvents(events);
    expect(analysis.issues.length).toBe(2);
  });

  it("groups stack traces under their header", () => {
    const events = [
      event("java.lang.IllegalStateException: plugin failed to enable", t0, "error", "java.lang.IllegalStateException"),
      event("\tat com.example.Plugin.onEnable(Plugin.java:42)", t0 + 10, "error"),
      event("\tat org.bukkit.plugin.java.JavaPlugin.setEnabled(JavaPlugin.java:1)", t0 + 20, "error"),
      event("\t... 12 more", t0 + 30, "error"),
      event("java.lang.IllegalStateException: plugin failed to enable", t0 + 60_000, "error", "java.lang.IllegalStateException"),
      event("\tat com.example.Plugin.onEnable(Plugin.java:99)", t0 + 60_010, "error"),
    ];
    const analysis = analyzeLogEvents(events);
    expect(analysis.stackTraces).toHaveLength(1);
    expect(analysis.stackTraces[0]!.count).toBe(2);
    expect(analysis.stackTraces[0]!.context.length).toBeGreaterThan(0);
  });

  it("collects lifecycle events", () => {
    const events = [
      event("Server marked as running", t0, "info"),
      event('Done (12.345s)! For help, type "help"', t0 + 12_000, "info"),
      event("Server marked as offline", t0 + 60_000, "info"),
    ];
    for (const item of events) item.subsystem = "lifecycle";
    const analysis = analyzeLogEvents(events);
    expect(analysis.lifecycle.map((entry) => entry.kind)).toEqual(["started", "ready", "exited"]);
  });

  it("matches patterns with counts and first/last", () => {
    const events = [
      event("java.lang.OutOfMemoryError: Java heap space", t0, "fatal", "java.lang.OutOfMemoryError"),
      event("java.lang.OutOfMemoryError: Java heap space", t0 + 1000, "fatal", "java.lang.OutOfMemoryError"),
    ];
    const analysis = analyzeLogEvents(events);
    const oom = analysis.patterns.find((pattern) => pattern.id === "oom_java");
    expect(oom).toBeDefined();
    expect(oom!.count).toBe(2);
    expect(oom!.firstSeen).toBe(t0);
    expect(oom!.commonCauses.length).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    const analysis = analyzeLogEvents([]);
    expect(analysis.totalEvents).toBe(0);
    expect(analysis.issues).toHaveLength(0);
    expect(analysis.summary).toContain("0 console events");
  });

  it("bounds issue output", () => {
    const events: ConsoleEvent[] = [];
    for (let i = 0; i < 50; i++) {
      const token = String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26));
      events.push(event(`distinct failure token ${token}`, t0 + i, "error"));
    }
    const analysis = analyzeLogEvents(events, { maxIssues: 5 });
    expect(analysis.issues).toHaveLength(5);
    expect(analysis.truncated).toBe(true);
  });
});
