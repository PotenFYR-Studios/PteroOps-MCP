import type { ApplicationDetector } from "../applications/detector.js";
import type { ApplicationSignalCollector } from "../applications/signal-collector.js";
import type { ApplicationProfileRegistry } from "../applications/profiles/index.js";
import type { ConsoleService } from "../console/service.js";
import type { CrashLoopTracker } from "../intelligence/crash-loop/tracker.js";
import type { Logger } from "../observability/logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { ServerRef } from "../shared/types.js";
import { assessHealth, type HealthAssessment } from "./engine.js";

export interface HealthServiceDeps {
  panels: PanelRegistry;
  detector: ApplicationDetector;
  signalCollector: ApplicationSignalCollector;
  profiles: ApplicationProfileRegistry;
  crashTracker: CrashLoopTracker;
  consoleService: ConsoleService;
  logger: Logger;
  metrics?: MetricsRegistry;
  clock?: () => number;
}

export interface HealthAssessOptions {
  refresh?: boolean;
  includeApplication?: boolean;
}

export class HealthService {
  private readonly clock: () => number;

  constructor(private readonly deps: HealthServiceDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async assess(ref: ServerRef, options: HealthAssessOptions = {}): Promise<HealthAssessment> {
    const now = this.clock();
    const panel = this.deps.panels.requireCapability(ref.panel, {
      anyOf: ["client.server.read", "application.servers.read"],
    });

    let serverName = ref.serverId;
    let state: string | null = null;
    let memoryBytes: number | null = null;
    let memoryLimitBytes: number | null = null;
    let diskBytes: number | null = null;
    let diskLimitBytes: number | null = null;
    let uptimeMs: number | null = null;
    let installing = false;

    if (panel.clientApi && panel.capabilities.has("client.server.read")) {
      const detail = await panel.clientApi.getServer(ref, { includeAllocations: false });
      serverName = detail.name;
      state = detail.state;
      installing = detail.installing;
      const resources = await panel.clientApi.getResources(ref, {
        memoryMb: detail.limits.memoryMb,
        diskMb: detail.limits.diskMb,
      });
      state = resources.state ?? state;
      memoryBytes = resources.memoryBytes;
      memoryLimitBytes = resources.memoryLimitBytes;
      diskBytes = resources.diskBytes;
      diskLimitBytes = resources.diskLimitBytes;
      uptimeMs = resources.uptimeMs;
    } else if (panel.applicationApi) {
      const detail = await panel.applicationApi.getServer(ref);
      serverName = detail.name;
      state = detail.state;
    }

    let readyMarkerSeen: boolean | null = null;
    let readyMarkerExpected = false;
    let expectedStartupMs: number | null = null;

    if (options.includeApplication ?? true) {
      try {
        const detection = this.deps.detector.detect(
          await this.deps.signalCollector.collect(ref, {
            ...(options.refresh !== undefined ? { bypassCache: options.refresh } : {}),
          }),
        );
        const profile =
          this.deps.profiles.byId(detection.profileId ?? "") ??
          this.deps.profiles.lookup(detection.application, detection.distribution);
        readyMarkerExpected = profile.readyMarkers.length > 0;
        expectedStartupMs = profile.expectedStartupMs;
        const recent = await this.deps.consoleService.window(ref, now - 6 * 3_600_000, now, {
          limit: 300,
        });
        if (recent.length > 0) {
          readyMarkerSeen = recent.some((event) =>
            profile.readyMarkers.some((pattern) => pattern.test(event.normalized)),
          );
        }
      } catch (error) {
        this.deps.logger.debug("health: application signals unavailable", {
          error: (error as Error).message,
        });
      }
    }

    const crash = this.deps.crashTracker.assess(ref, now);
    const healthWindowMs = 10 * 60_000;
    const recentErrorCount = await this.deps.consoleService.countWarnAndAboveSince(
      ref,
      now - healthWindowMs,
    );

    const assessment = assessHealth({
      ref,
      serverName,
      state,
      suspended: false,
      installing,
      memoryBytes,
      memoryLimitBytes,
      diskBytes,
      diskLimitBytes,
      cpuAveragePercent: null,
      uptimeMs,
      recentErrors: { count: recentErrorCount, windowMs: healthWindowMs },
      crash,
      readyMarkerSeen,
      readyMarkerExpected,
      expectedStartupMs,
      assessedAt: now,
    });
    this.deps.metrics?.setGauge("pteroops_health_status", 1, {
      server: `${ref.panel}/${ref.serverId}`,
      status: assessment.status,
    });
    for (const status of ["healthy", "degraded", "unhealthy", "crash_loop", "starting", "unknown"]) {
      if (status === assessment.status) continue;
      this.deps.metrics?.setGauge("pteroops_health_status", 0, {
        server: `${ref.panel}/${ref.serverId}`,
        status,
      });
    }
    return assessment;
  }
}
