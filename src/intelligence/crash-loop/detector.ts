import { formatDuration } from "../../shared/time.js";

export interface CrashLoopConfig {
  windowMs: number;
  minRestarts: number;
  maxHealthyRuntimeMs: number;
  cooldownMs: number;
}

export const DEFAULT_CRASH_LOOP_CONFIG: CrashLoopConfig = {
  windowMs: 15 * 60_000,
  minRestarts: 3,
  maxHealthyRuntimeMs: 10 * 60_000,
  cooldownMs: 5 * 60_000,
};

export interface ProcessObservation {
  ts: number;
  type: "start" | "exit";
  exitCode?: number;
}

export interface CrashRun {
  startedAt: number | null;
  endedAt: number;
  exitCode: number | null;
  runtimeMs: number | null;
}

export interface CrashAssessment {
  inCrashLoop: boolean;
  newDetection: boolean;
  restartCount: number;
  crashCount: number;
  windowMs: number;
  avgRuntimeMs: number | null;
  lastExitCode: number | null;
  confidence: number;
  evidence: string[];
}

export class CrashLoopDetector {
  private observations: ProcessObservation[] = [];
  private lastDetectionAt: number | null = null;
  private lastDetectionCrashCount = 0;

  constructor(private readonly config: CrashLoopConfig = DEFAULT_CRASH_LOOP_CONFIG) {}

  observe(observation: ProcessObservation): void {
    this.observations.push(observation);
    this.prune(observation.ts);
  }

  reset(): void {
    this.observations = [];
    this.lastDetectionAt = null;
    this.lastDetectionCrashCount = 0;
  }

  assess(now = Date.now()): CrashAssessment {
    this.prune(now);
    const runs = this.computeRuns();
    const startsInWindow = this.observations.filter((obs) => obs.type === "start").length;
    const crashes = runs.filter((run) => this.isCrash(run));
    const crashCount = crashes.length;
    const inCrashLoop = crashCount >= this.config.minRestarts;

    let confidence = 0;
    if (inCrashLoop) {
      confidence = Math.min(0.95, 0.6 + 0.08 * crashCount);
    } else if (crashCount === this.config.minRestarts - 1 && crashCount > 0) {
      confidence = 0.35;
    } else if (crashCount > 0) {
      confidence = 0.2;
    }

    const runtimes = runs
      .map((run) => run.runtimeMs)
      .filter((runtime): runtime is number => runtime !== null && runtime >= 0);
    const avgRuntimeMs =
      runtimes.length > 0
        ? Math.round(runtimes.reduce((sum, runtime) => sum + runtime, 0) / runtimes.length)
        : null;

    const lastExit = runs.length > 0 ? runs[runs.length - 1]! : null;
    const evidence: string[] = [];
    if (startsInWindow > 0) {
      evidence.push(
        `${startsInWindow} process starts within the last ${formatDuration(this.config.windowMs)}`,
      );
    }
    if (crashCount > 0) {
      evidence.push(
        `${crashCount} exit${crashCount === 1 ? "" : "s"} with a runtime shorter than ${formatDuration(this.config.maxHealthyRuntimeMs)}`,
      );
    }
    if (avgRuntimeMs !== null) {
      evidence.push(`average runtime between crashes: ${formatDuration(avgRuntimeMs)}`);
    }
    if (lastExit?.exitCode !== null && lastExit?.exitCode !== undefined) {
      evidence.push(`last exit code: ${lastExit.exitCode}`);
    }

    let newDetection = false;
    if (inCrashLoop) {
      const cooldownElapsed =
        this.lastDetectionAt === null || now - this.lastDetectionAt >= this.config.cooldownMs;
      const intensified = crashCount > this.lastDetectionCrashCount;
      if (cooldownElapsed || intensified) {
        newDetection = true;
        this.lastDetectionAt = now;
        this.lastDetectionCrashCount = crashCount;
      }
    }

    return {
      inCrashLoop,
      newDetection,
      restartCount: startsInWindow,
      crashCount,
      windowMs: this.config.windowMs,
      avgRuntimeMs,
      lastExitCode: lastExit?.exitCode ?? null,
      confidence,
      evidence,
    };
  }

  private isCrash(run: CrashRun): boolean {
    if (run.runtimeMs !== null) return run.runtimeMs < this.config.maxHealthyRuntimeMs;
    return run.exitCode !== null && run.exitCode !== 0;
  }

  private computeRuns(): CrashRun[] {
    const runs: CrashRun[] = [];
    let currentStart: ProcessObservation | null = null;
    for (const observation of this.observations) {
      if (observation.type === "start") {
        if (currentStart) {
          runs.push({
            startedAt: currentStart.ts,
            endedAt: observation.ts,
            exitCode: null,
            runtimeMs: observation.ts - currentStart.ts,
          });
        }
        currentStart = observation;
      } else if (observation.type === "exit") {
        runs.push({
          startedAt: currentStart?.ts ?? null,
          endedAt: observation.ts,
          exitCode: observation.exitCode ?? null,
          runtimeMs: currentStart ? observation.ts - currentStart.ts : null,
        });
        currentStart = null;
      }
    }
    return runs;
  }

  private prune(now: number): void {
    const cutoff = now - this.config.windowMs;
    while (this.observations.length > 0 && this.observations[0]!.ts < cutoff) {
      this.observations.shift();
    }
  }
}
