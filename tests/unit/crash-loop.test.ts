import { describe, expect, it } from "vitest";
import { CrashLoopDetector, DEFAULT_CRASH_LOOP_CONFIG } from "../../src/intelligence/crash-loop/detector.js";

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

describe("CrashLoopDetector", () => {
  it("detects start→crash ×3 within the window", () => {
    const detector = new CrashLoopDetector();
    let ts = T0;
    for (let i = 0; i < 3; i++) {
      detector.observe({ ts, type: "start" });
      detector.observe({ ts: ts + 30_000, type: "exit", exitCode: 1 });
      ts += 60_000;
    }
    const assessment = detector.assess(ts);
    expect(assessment.inCrashLoop).toBe(true);
    expect(assessment.crashCount).toBe(3);
    expect(assessment.restartCount).toBe(3);
    expect(assessment.confidence).toBeGreaterThan(0.6);
    expect(assessment.evidence.join(" ")).toContain("3 exit");
  });

  it("does not flag a healthy long-running process", () => {
    const detector = new CrashLoopDetector();
    detector.observe({ ts: T0, type: "start" });
    detector.observe({ ts: T0 + 60 * MINUTE, type: "exit", exitCode: 0 });
    const assessment = detector.assess(T0 + 61 * MINUTE);
    expect(assessment.inCrashLoop).toBe(false);
    expect(assessment.crashCount).toBe(0);
  });

  it("ignores crashes outside the evaluation window", () => {
    const detector = new CrashLoopDetector();
    let ts = T0;
    for (let i = 0; i < 3; i++) {
      detector.observe({ ts, type: "start" });
      detector.observe({ ts: ts + 10_000, type: "exit", exitCode: 1 });
      ts += 60_000;
    }
    const assessment = detector.assess(T0 + DEFAULT_CRASH_LOOP_CONFIG.windowMs + 60_000);
    expect(assessment.inCrashLoop).toBe(false);
    expect(assessment.crashCount).toBeLessThan(DEFAULT_CRASH_LOOP_CONFIG.minRestarts);
  });

  it("reports newDetection only once per cooldown unless intensity grows", () => {
    const detector = new CrashLoopDetector();
    let ts = T0;
    for (let i = 0; i < 3; i++) {
      detector.observe({ ts, type: "start" });
      detector.observe({ ts: ts + 20_000, type: "exit", exitCode: 1 });
      ts += 60_000;
    }
    const first = detector.assess(ts);
    expect(first.inCrashLoop).toBe(true);
    expect(first.newDetection).toBe(true);
    const second = detector.assess(ts + 10_000);
    expect(second.inCrashLoop).toBe(true);
    expect(second.newDetection).toBe(false);
    detector.observe({ ts: ts + 20_000, type: "start" });
    detector.observe({ ts: ts + 35_000, type: "exit", exitCode: 1 });
    const escalated = detector.assess(ts + 40_000);
    expect(escalated.newDetection).toBe(true);
    expect(escalated.crashCount).toBe(4);
  });

  it("respects a stricter configured threshold", () => {
    const detector = new CrashLoopDetector({
      ...DEFAULT_CRASH_LOOP_CONFIG,
      minRestarts: 5,
    });
    let ts = T0;
    for (let i = 0; i < 3; i++) {
      detector.observe({ ts, type: "start" });
      detector.observe({ ts: ts + 10_000, type: "exit", exitCode: 1 });
      ts += 30_000;
    }
    expect(detector.assess(ts).inCrashLoop).toBe(false);
  });

  it("captures exit codes and average runtime", () => {
    const detector = new CrashLoopDetector();
    detector.observe({ ts: T0, type: "start" });
    detector.observe({ ts: T0 + 40_000, type: "exit", exitCode: 137 });
    detector.observe({ ts: T0 + 60_000, type: "start" });
    detector.observe({ ts: T0 + 90_000, type: "exit", exitCode: 137 });
    detector.observe({ ts: T0 + 120_000, type: "start" });
    detector.observe({ ts: T0 + 150_000, type: "exit", exitCode: 137 });
    const assessment = detector.assess(T0 + 160_000);
    expect(assessment.lastExitCode).toBe(137);
    expect(assessment.avgRuntimeMs).toBe(Math.round((40_000 + 30_000 + 30_000) / 3));
  });
});
