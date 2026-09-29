import type { HealthService } from "../health/service.js";
import type { IncidentService } from "../incidents/service.js";
import type { Logger } from "../observability/logger.js";
import type { ChangeRepository } from "../persistence/repositories/changes.js";
import type { MetricSampleRepository } from "../persistence/repositories/metrics.js";
import type { ServerCacheRepository } from "../persistence/repositories/servers.js";
import type { TopologyRepository } from "../persistence/repositories/topology.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { ServerRef } from "../shared/types.js";
import type { OverviewData, OverviewServer } from "./render.js";

export interface DashboardServiceDeps {
  panels: PanelRegistry;
  serverCache: ServerCacheRepository;
  changeRepository: ChangeRepository;
  health: HealthService;
  incidentService: IncidentService;
  metricRepository: MetricSampleRepository;
  topology: TopologyRepository;
  logger: Logger;
  maxServers?: number;
  cacheMs?: number;
  clock?: () => number;
}

interface CachedOverview {
  data: OverviewData;
  at: number;
}

export class DashboardService {
  private readonly maxServers: number;
  private readonly cacheMs: number;
  private readonly clock: () => number;
  private cached: CachedOverview | null = null;

  constructor(private readonly deps: DashboardServiceDeps) {
    this.maxServers = deps.maxServers ?? 25;
    this.cacheMs = deps.cacheMs ?? 30_000;
    this.clock = deps.clock ?? Date.now;
  }

  invalidate(): void {
    this.cached = null;
  }

  async overview(): Promise<OverviewData> {
    const now = this.clock();
    if (this.cached && now - this.cached.at < this.cacheMs) {
      return this.cached.data;
    }
    const tenant = this.deps.panels.default().tenant;
    const records = (await this.deps.serverCache.list(tenant)).slice(0, this.maxServers);
    const servers: OverviewServer[] = [];
    for (const record of records) {
      const ref: ServerRef = record.ref;
      let healthStatus = "unknown";
      let score = 0;
      try {
        const health = await this.deps.health.assess(ref, {});
        healthStatus = health.status;
        score = health.score;
      } catch (error) {
        this.deps.logger.debug("dashboard health assessment failed", {
          server: `${ref.panel}/${ref.serverId}`,
          error: (error as Error).message,
        });
      }
      servers.push({
        server: `${ref.panel}/${ref.serverId}`,
        name: record.name,
        state: record.state,
        application: record.application,
        health: healthStatus,
        score,
      });
    }
    const incidentList = await this.deps.incidentService.list({ tenant, openOnly: true, limit: 20 });
    const changeRecords = await this.deps.changeRepository.list({ tenant, limit: 50 });
    const healthCounts: Record<string, number> = {};
    for (const server of servers) {
      healthCounts[server.health] = (healthCounts[server.health] ?? 0) + 1;
    }
    const data: OverviewData = {
      generatedAt: now,
      panels: this.deps.panels.list().length,
      servers,
      incidentsOpen: incidentList.length,
      incidents: incidentList.map((incident) => ({
        id: incident.id,
        title: incident.title,
        severity: incident.severity,
        state: incident.state,
        server: `${incident.ref.panel}/${incident.ref.serverId}`,
        detectedAt: incident.detectedAt,
      })),
      changes: changeRecords.map((change) => ({
        id: change.id,
        server: `${change.ref.panel}/${change.ref.serverId}`,
        action: change.action,
        target: change.target,
        actor: change.actor,
        ts: change.ts,
        result: change.result,
      })),
      healthCounts,
    };
    this.cached = { data, at: now };
    return data;
  }
}
