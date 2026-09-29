import type { Logger } from "../../observability/logger.js";
import type { ProcessEventRepository } from "../../persistence/repositories/metrics.js";
import type { ServerRef } from "../../shared/types.js";
import { serverRefKey } from "../../shared/types.js";
import {
  CrashLoopDetector,
  DEFAULT_CRASH_LOOP_CONFIG,
  type CrashAssessment,
  type CrashLoopConfig,
} from "./detector.js";

export interface ProcessRecord {
  ts: number;
  kind: "started" | "exited";
  exitCode?: number | null;
  runtimeMs?: number | null;
  source: "poll" | "console";
}

export class CrashLoopTracker {
  private readonly detectors = new Map<string, CrashLoopDetector>();

  constructor(
    private readonly repository: ProcessEventRepository,
    private readonly config: CrashLoopConfig = DEFAULT_CRASH_LOOP_CONFIG,
    private readonly logger?: Logger,
  ) {}

  record(ref: ServerRef, event: ProcessRecord): CrashAssessment {
    void this.repository
      .insert({
        ref,
        ts: event.ts,
        kind: event.kind,
        exitCode: event.exitCode ?? null,
        runtimeMs: event.runtimeMs ?? null,
        source: event.source,
      })
      .catch((error: unknown) => {
        this.logger?.warn("failed to persist process event", {
          error: (error as Error).message,
        });
      });
    const detector = this.detectorFor(ref);
    detector.observe({
      ts: event.ts,
      type: event.kind === "started" ? "start" : "exit",
      ...(event.exitCode !== null && event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
    });
    const assessment = detector.assess(event.ts);
    if (assessment.inCrashLoop && assessment.newDetection) {
      this.logger?.warn("crash loop detected", {
        panel: ref.panel,
        server: ref.serverId,
        crashes: assessment.crashCount,
        confidence: assessment.confidence,
      });
    }
    return assessment;
  }

  assess(ref: ServerRef, now = Date.now()): CrashAssessment {
    return this.detectorFor(ref).assess(now);
  }

  async rebuild(ref: ServerRef, sinceMs = 24 * 3_600_000): Promise<void> {
    const now = Date.now();
    const events = await this.repository.range(ref, now - sinceMs, now);
    const detector = this.detectorFor(ref);
    detector.reset();
    for (const event of events) {
      detector.observe({
        ts: event.ts,
        type: event.kind === "started" ? "start" : "exit",
        ...(event.exitCode !== null ? { exitCode: event.exitCode } : {}),
      });
    }
  }

  reset(ref: ServerRef): void {
    this.detectors.delete(serverRefKey(ref));
  }

  private detectorFor(ref: ServerRef): CrashLoopDetector {
    const key = serverRefKey(ref);
    let detector = this.detectors.get(key);
    if (!detector) {
      detector = new CrashLoopDetector(this.config);
      this.detectors.set(key, detector);
    }
    return detector;
  }
}
