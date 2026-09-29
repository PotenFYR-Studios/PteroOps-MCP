import type { MonitoringConfig } from "../config/schema.js";
import type { ConsoleService } from "../console/service.js";
import type { CrashLoopTracker } from "../intelligence/crash-loop/tracker.js";
import type { IncidentService } from "../incidents/service.js";
import type { Logger } from "../observability/logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type {
  MetricSampleRepository,
  ProcessEventRepository,
} from "../persistence/repositories/metrics.js";
import type { ServerCacheRepository } from "../persistence/repositories/servers.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { ServerSummary } from "../pterodactyl/types.js";
import { serverRefKey } from "../shared/types.js";
import { mapConcurrent } from "../shared/async.js";
import type { DistributedLock } from "../shared/locks.js";
import type { ConsoleStreamerManager } from "./streamer-manager.js";

export interface MonitorDeps {
  panels: PanelRegistry;
  config: MonitoringConfig;
  serverCache: ServerCacheRepository;
  metricRepository: MetricSampleRepository;
  processEventRepository: ProcessEventRepository;
  crashTracker: CrashLoopTracker;
  consoleService: ConsoleService;
  streamerManager: ConsoleStreamerManager;
  incidentService: IncidentService;
  lock: DistributedLock;
  logger: Logger;
  metrics: MetricsRegistry;
  clock?: () => number;
}

interface ServerRuntimeState {
  state: string | null;
  startTs: number | null;
  lastSeenTs: number;
}

const PRUNE_EVERY_TICKS = 20;

export class Monitor {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private tickCount = 0;
  private serverList: ServerSummary[] = [];
  private serverListAt = 0;
  private readonly runtimeStates = new Map<string, ServerRuntimeState>();
  private readonly clock: () => number;

  constructor(private readonly deps: MonitorDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.deps.config.intervalSeconds * 1000);
    this.timer.unref?.();
    this.deps.logger.info("monitor started", {
      intervalSeconds: this.deps.config.intervalSeconds,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    const startedAt = this.clock();
    const lockKey = "pteroops:monitor:tick";
    let locked = false;
    try {
      locked = await this.deps.lock.acquire(
        lockKey,
        this.deps.config.intervalSeconds * 2000,
      );
      if (!locked) {
        this.deps.logger.debug("monitor tick skipped: another instance holds the lock");
        return;
      }
      this.tickCount += 1;
      const servers = await this.getServers();
      await mapConcurrent(servers, this.deps.config.concurrency, async (server) => {
        try {
          await this.pollServer(server);
        } catch (error) {
          this.deps.logger.debug("server poll failed", {
            panel: server.ref.panel,
            server: server.ref.serverId,
            error: (error as Error).message,
          });
        }
      });
      this.deps.streamerManager.sync(servers);
      this.deps.metrics?.setGauge("monitored_servers", servers.length);
      if (this.tickCount % PRUNE_EVERY_TICKS === 0) {
        await this.prune(servers);
      }
    } catch (error) {
      this.deps.logger.error("monitor tick failed", { error: (error as Error).message });
      this.deps.metrics?.increment("monitor_tick_failures_total");
    } finally {
      if (locked) {
        await this.deps.lock.release(lockKey).catch(() => undefined);
      }
      this.deps.metrics?.observe("monitor_tick_duration_ms", this.clock() - startedAt);
      this.ticking = false;
    }
  }

  private async getServers(): Promise<ServerSummary[]> {
    const now = this.clock();
    if (now - this.serverListAt < this.deps.config.serverListCacheSeconds * 1000) {
      return this.serverList;
    }
    const collected: ServerSummary[] = [];
    for (const panel of this.deps.panels.list()) {
      try {
        if (panel.clientApi && panel.capabilities.has("client.server.read")) {
          const servers = await panel.clientApi.allServers({ tenant: panel.tenant, panel: panel.name });
          for (const server of servers) {
            await this.deps.serverCache.upsert({
              ref: server.ref,
              uuid: server.uuid ?? null,
              name: server.name,
              state: server.state,
              application: null,
              now,
            });
            collected.push(server);
          }
        } else if (panel.applicationApi && panel.capabilities.has("application.servers.read")) {
          const servers = await panel.applicationApi.allServers({ tenant: panel.tenant, panel: panel.name });
          for (const server of servers) {
            await this.deps.serverCache.upsert({
              ref: server.ref,
              uuid: server.uuid ?? null,
              name: server.name,
              state: server.state,
              application: null,
              now,
            });
            collected.push(server);
          }
        }
      } catch (error) {
        this.deps.logger.warn("failed to refresh server list for panel", {
          panel: panel.name,
          error: (error as Error).message,
        });
      }
    }
    if (collected.length > 0) {
      const deduped = new Map(collected.map((server) => [serverRefKey(server.ref), server]));
      this.serverList = [...deduped.values()];
      this.serverListAt = now;
    }
    return this.serverList;
  }

  private async pollServer(server: ServerSummary): Promise<void> {
    const panel = this.deps.panels.tryGet(server.ref.panel);
    if (!panel?.clientApi || !panel.capabilities.has("client.server.read")) return;
    const resources = await panel.clientApi.getResources(server.ref, {
      memoryMb: server.limits.memoryMb,
      diskMb: server.limits.diskMb,
    });
    const now = this.clock();
    await this.deps.metricRepository.insert({
      ref: server.ref,
      ts: now,
      state: resources.state,
      cpuPercent: resources.cpuAbsolute,
      memoryBytes: resources.memoryBytes,
      memoryLimitBytes: resources.memoryLimitBytes,
      diskBytes: resources.diskBytes,
      diskLimitBytes: resources.diskLimitBytes,
      netRxBytes: resources.networkRxBytes,
      netTxBytes: resources.networkTxBytes,
      uptimeMs: resources.uptimeMs,
    });
    this.deps.metrics?.increment("metric_samples_stored_total");

    const key = serverRefKey(server.ref);
    const previous = this.runtimeStates.get(key);
    const current = resources.state;
    const isLive = current === "running" || current === "starting";
    const wasLive = previous?.state === "running" || previous?.state === "starting";

    if (previous && wasLive && !isLive) {
      const runtimeMs = previous.startTs !== null ? now - previous.startTs : null;
      const assessment = this.deps.crashTracker.record(server.ref, {
        ts: now,
        kind: "exited",
        runtimeMs,
        source: "poll",
      });
      await this.maybeOpenCrashLoopIncident(server, assessment.crashCount, assessment.confidence);
    }
    if (previous && !wasLive && isLive) {
      this.deps.crashTracker.record(server.ref, { ts: now, kind: "started", source: "poll" });
      this.runtimeStates.set(key, { state: current, startTs: now, lastSeenTs: now });
      return;
    }
    if (isLive && previous?.startTs === null) {
      this.runtimeStates.set(key, { state: current, startTs: now, lastSeenTs: now });
      return;
    }
    this.runtimeStates.set(key, {
      state: current,
      startTs: isLive ? (previous?.startTs ?? now) : null,
      lastSeenTs: now,
    });
  }

  private async maybeOpenCrashLoopIncident(
    server: ServerSummary,
    crashCount: number,
    confidence: number,
  ): Promise<void> {
    if (crashCount < 3) return;
    const assessment = this.deps.crashTracker.assess(server.ref);
    if (!assessment.inCrashLoop || !assessment.newDetection) return;
    const since = this.clock() - assessment.windowMs;
    const topIssues = await this.deps.consoleService.topIssues(server.ref, since, 5);
    try {
      await this.deps.incidentService.open({
        ref: server.ref,
        title: `Crash loop detected on ${server.name}`,
        summary: `Detected ${assessment.crashCount} short-lived exits within ${Math.round(assessment.windowMs / 60000)} minutes.`,
        severity: "critical",
        fingerprint: `crash-loop:${server.ref.panel}/${server.ref.serverId}`,
        confidence,
        symptoms: assessment.evidence,
        evidence: [
          { kind: "crash-loop", source: "crash-detector", summary: assessment.evidence.join("; ") },
          ...topIssues.slice(0, 3).map((issue) => ({
            kind: "log-issue",
            source: "console",
            summary: `${issue.exceptionType ?? "issue"} ×${issue.count}: ${issue.sample.slice(0, 160)}`,
            ts: issue.firstSeen,
          })),
        ],
      });
      this.deps.metrics?.increment("crash_loop_incidents_total", 1, {
        panel: server.ref.panel,
      });
    } catch (error) {
      this.deps.logger.warn("failed to open crash loop incident", {
        error: (error as Error).message,
      });
    }
  }

  private async prune(servers: ServerSummary[]): Promise<void> {
    try {
      await this.deps.metricRepository.prune(undefined, this.deps.config.metricsRetentionHours);
      await this.deps.processEventRepository.prune(this.deps.config.processEventsRetentionDays);
      for (const server of servers) {
        await this.deps.consoleService.prune(server.ref);
      }
    } catch (error) {
      this.deps.logger.warn("retention pruning failed", { error: (error as Error).message });
    }
  }
}
