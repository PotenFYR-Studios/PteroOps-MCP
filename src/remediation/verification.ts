import type { ApplicationDetector } from "../applications/detector.js";
import type { ApplicationSignalCollector } from "../applications/signal-collector.js";
import type { ApplicationProfileRegistry } from "../applications/profiles/index.js";
import { validateFileContent } from "../applications/validation.js";
import type { ConsoleService } from "../console/service.js";
import type { HealthService } from "../health/service.js";
import type { CrashLoopTracker } from "../intelligence/crash-loop/tracker.js";
import type { Logger } from "../observability/logger.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { ServerRef } from "../shared/types.js";

export type TestSuite = "pre" | "post" | "smoke";

export interface TestCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface TestReport {
  suite: TestSuite;
  passed: boolean;
  checks: TestCheck[];
  ranAt: number;
  durationMs: number;
}

export interface TestEngineDeps {
  panels: PanelRegistry;
  consoleService: ConsoleService;
  health: HealthService;
  detector: ApplicationDetector;
  signalCollector: ApplicationSignalCollector;
  profiles: ApplicationProfileRegistry;
  crashTracker: CrashLoopTracker;
  logger: Logger;
  errorRateLimitPerMinute?: number;
  clock?: () => number;
}

export class TestEngine {
  private readonly errorRateLimit: number;
  private readonly clock: () => number;

  constructor(private readonly deps: TestEngineDeps) {
    this.errorRateLimit = deps.errorRateLimitPerMinute ?? 5;
    this.clock = deps.clock ?? Date.now;
  }

  async run(ref: ServerRef, suite: TestSuite): Promise<TestReport> {
    const startedAt = this.clock();
    const checks: TestCheck[] = [];

    const crash = this.deps.crashTracker.assess(ref);
    checks.push({
      name: "crash-loop",
      passed: !crash.inCrashLoop,
      detail: crash.inCrashLoop
        ? `crash loop active: ${crash.evidence.join("; ")}`
        : "no crash loop detected",
    });

    let detection = null;
    try {
      detection = this.deps.detector.detect(await this.deps.signalCollector.collect(ref, {}));
      checks.push({
        name: "application-detection",
        passed: detection.application !== "unknown",
        detail:
          detection.application === "unknown"
            ? "application could not be detected from any signal"
            : `${detection.application}${detection.distribution ? `/${detection.distribution}` : ""} (confidence ${detection.confidence})`,
      });
    } catch (error) {
      checks.push({
        name: "application-detection",
        passed: false,
        detail: `detection failed: ${(error as Error).message}`,
      });
    }

    try {
      const signals = await this.deps.signalCollector.collect(ref, { includeConsole: false });
      const validationIssues: string[] = [];
      for (const [file, content] of Object.entries(signals.configFiles)) {
        const validation = validateFileContent(file, content);
        if (validation.status === "error") {
          validationIssues.push(`${file}: ${validation.issues.join("; ")}`);
        }
      }
      checks.push({
        name: "config-syntax",
        passed: validationIssues.length === 0,
        detail:
          validationIssues.length === 0
            ? `no syntax errors in ${String(Object.keys(signals.configFiles).length)} readable config file(s)`
            : validationIssues.join(" | "),
      });
    } catch (error) {
      checks.push({
        name: "config-syntax",
        passed: false,
        detail: `config validation failed: ${(error as Error).message}`,
      });
    }

    let healthStatus = "unknown";
    try {
      const health = await this.deps.health.assess(ref, {});
      healthStatus = health.status;
      const acceptable =
        suite === "post"
          ? health.status === "healthy"
          : health.status === "healthy" || health.status === "degraded" || health.status === "starting";
      checks.push({
        name: "health",
        passed: acceptable,
        detail: `${health.status} (score ${health.score}): ${health.explanation}`,
      });
    } catch (error) {
      checks.push({
        name: "health",
        passed: false,
        detail: `health assessment failed: ${(error as Error).message}`,
      });
    }
    void healthStatus;

    const errorWindowMs = 10 * 60_000;
    const errorCount = await this.deps.consoleService.countWarnAndAboveSince(
      ref,
      this.clock() - errorWindowMs,
    );
    const perMinute = errorCount / (errorWindowMs / 60_000);
    checks.push({
      name: "error-rate",
      passed: perMinute <= this.errorRateLimit,
      detail: `${errorCount} warn/error lines in 10m (${perMinute.toFixed(1)}/min, limit ${this.errorRateLimit})`,
    });

    if ((suite === "post" || suite === "smoke") && detection && detection.application !== "unknown") {
      const profile =
        this.deps.profiles.byId(detection.profileId ?? "") ??
        this.deps.profiles.lookup(detection.application, detection.distribution);
      if (profile.readyMarkers.length > 0) {
        const events = await this.deps.consoleService.window(
          ref,
          this.clock() - 15 * 60_000,
          this.clock(),
          { limit: 500 },
        );
        const ready = events.some((event) =>
          profile.readyMarkers.some((pattern) => pattern.test(event.normalized)),
        );
        checks.push({
          name: "ready-marker",
          passed: ready,
          detail: ready
            ? `ready marker observed (${profile.displayName})`
            : `no ready marker observed in the last 15m (expected for ${profile.displayName})`,
        });
      }
    }

    const passed = checks.every((check) => check.passed);
    const durationMs = this.clock() - startedAt;
    this.deps.logger.info("verification suite complete", {
      suite,
      passed,
      checks: checks.length,
      server: `${ref.panel}/${ref.serverId}`,
    });
    void healthStatus;
    return { suite, passed, checks, ranAt: startedAt, durationMs };
  }
}
