import type { ScheduleConfigEntry } from "../config/schema.js";
import type { ConsoleService } from "../console/service.js";
import type { DiagnosticEngine } from "../diagnostics/engine.js";
import type { HealthService } from "../health/service.js";
import type { BaselineService } from "../intelligence/baselines/service.js";
import { forecastDisk } from "../intelligence/baselines/forecast.js";
import type { IncidentService } from "../incidents/service.js";
import type { Logger } from "../observability/logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { ScheduleRecord } from "../persistence/models.js";
import type { AuditRepository } from "../persistence/repositories/audit.js";
import type { ChangeRepository } from "../persistence/repositories/changes.js";
import type { IncidentRepository } from "../persistence/repositories/incidents.js";
import type {
  MetricSampleRepository,
  ProcessEventRepository,
} from "../persistence/repositories/metrics.js";
import type { FileSnapshotRepository } from "../persistence/repositories/snapshots.js";
import type { ScheduleRepository } from "../persistence/repositories/schedules.js";
import type { ServerCacheRepository } from "../persistence/repositories/servers.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { ServerRef } from "../shared/types.js";
import { matchGlob } from "../shared/text.js";
import { parseDuration } from "../shared/time.js";
import { mapConcurrent } from "../shared/async.js";
import type { DistributedLock } from "../shared/locks.js";
import { collectDependencyReport } from "../applications/dependency-service.js";

export interface SchedulerRetention {
  metricRetentionHours: number;
  processEventsRetentionDays: number;
  snapshotRetentionDays: number;
  auditDays: number;
  changesDays: number;
  resolvedIncidentDays: number;
}

export interface SchedulerDeps {
  scheduleRepository: ScheduleRepository;
  configSchedules: ScheduleConfigEntry[];
  groups: Record<string, string[]>;
  panels: PanelRegistry;
  serverCache: ServerCacheRepository;
  health: HealthService;
  diagnostics: DiagnosticEngine;
  incidentService: IncidentService;
  consoleService: ConsoleService;
  baselines: BaselineService;
  snapshots: FileSnapshotRepository;
  metricRepository: MetricSampleRepository;
  processEventRepository: ProcessEventRepository;
  auditRepository: AuditRepository;
  changeRepository: ChangeRepository;
  incidentRepository: IncidentRepository;
  retention: SchedulerRetention;
  lock: DistributedLock;
  logger: Logger;
  metrics?: MetricsRegistry;
  clock?: () => number;
}

export class DiagnosticsScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly clock: () => number;

  constructor(private readonly deps: SchedulerDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async seed(): Promise<void> {
    const existing = new Map(
      (await this.deps.scheduleRepository.list()).map((record) => [record.id, record]),
    );
    const now = this.clock();
    for (const entry of this.deps.configSchedules) {
      const id = `sched:${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      let everyMs: number;
      try {
        everyMs = parseDuration(entry.every);
      } catch {
        this.deps.logger.warn("invalid schedule interval; using 24h", {
          schedule: entry.name,
          every: entry.every,
        });
        everyMs = 86_400_000;
      }
      const prior = existing.get(id);
      await this.deps.scheduleRepository.upsert({
        id,
        name: entry.name,
        kind: entry.kind,
        scope: entry.scope,
        everyMs,
        enabled: entry.enabled,
        lastRun: prior?.lastRun ?? null,
        nextRun: prior?.nextRun ?? now + everyMs,
        lastResult: prior?.lastResult ?? null,
      });
    }
  }

  async start(checkIntervalMs = 60_000): Promise<void> {
    if (this.timer) return;
    await this.seed();
    this.timer = setInterval(() => {
      void this.runDue().catch((error) => {
        this.deps.logger.error("scheduler run failed", { error: (error as Error).message });
      });
    }, checkIntervalMs);
    this.timer.unref?.();
    const count = (await this.deps.scheduleRepository.list()).filter(
      (record) => record.enabled,
    ).length;
    if (count > 0) {
      this.deps.logger.info("scheduler started", { schedules: count });
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runDue(now = this.clock()): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    const ran: string[] = [];
    try {
      for (const record of await this.deps.scheduleRepository.list()) {
        if (!record.enabled) continue;
        if (record.nextRun !== null && record.nextRun > now) continue;
        const lockKey = `pteroops:scheduler:${record.id}`;
        const acquired = await this.deps.lock.acquire(lockKey, record.everyMs);
        if (!acquired) {
          this.deps.logger.debug("scheduled job skipped: another instance holds the lock", {
            schedule: record.name,
          });
          continue;
        }
        try {
          const result = await this.runJob(record).catch((error) => ({
            error: (error as Error).message,
          }));
          const finishedAt = this.clock();
          await this.deps.scheduleRepository.markRun(record.id, finishedAt, result);
          await this.deps.scheduleRepository.upsert({
            id: record.id,
            name: record.name,
            kind: record.kind,
            scope: record.scope,
            everyMs: record.everyMs,
            enabled: record.enabled,
            lastRun: finishedAt,
            nextRun: finishedAt + record.everyMs,
            lastResult: result,
          });
          ran.push(record.name);
          this.deps.metrics?.increment("scheduler_jobs_total", 1, { kind: record.kind });
          this.deps.logger.info("scheduled job finished", {
            schedule: record.name,
            kind: record.kind,
          });
        } finally {
          await this.deps.lock.release(lockKey);
        }
      }
    } finally {
      this.running = false;
    }
    return ran;
  }

  async list(): Promise<ScheduleRecord[]> {
    return this.deps.scheduleRepository.list();
  }

  async runNow(name: string): Promise<Record<string, unknown>> {
    const record = (await this.deps.scheduleRepository.list()).find(
      (candidate) => candidate.name === name || candidate.id === name,
    );
    if (!record) {
      return {
        error: `no schedule named "${name}"`,
        available: (await this.list()).map((entry) => entry.name),
      };
    }
    const result = await this.runJob(record);
    await this.deps.scheduleRepository.markRun(record.id, this.clock(), result);
    return result;
  }

  private async resolveScope(record: ScheduleRecord): Promise<ServerRef[]> {
    const refs: ServerRef[] = [];
    const tenants = new Set(this.deps.panels.list().map((panel) => panel.tenant));
    for (const tenant of tenants) {
      for (const cached of await this.deps.serverCache.list(tenant)) {
        const targets = [
          `${cached.ref.panel}/${cached.ref.serverId}`,
          `${cached.ref.tenant}/${cached.ref.panel}/${cached.ref.serverId}`,
          cached.ref.serverId,
        ];
        if (
          record.scope.some(
            (pattern) => pattern === "*" || targets.some((target) => matchGlob(pattern, target)),
          )
        ) {
          refs.push(cached.ref);
        }
      }
    }
    return refs.slice(0, 100);
  }

  private async runJob(record: ScheduleRecord): Promise<Record<string, unknown>> {
    switch (record.kind) {
      case "health_scan":
        return this.jobHealthScan(record);
      case "diagnose_scope":
        return this.jobDiagnoseScope(record);
      case "dependency_audit":
        return this.jobDependencyAudit(record);
      case "backup_check":
        return this.jobBackupCheck(record);
      case "anomaly_scan":
        return this.jobAnomalyScan(record);
      case "retention_prune":
        return this.jobRetentionPrune(record);
    }
  }

  private async jobHealthScan(record: ScheduleRecord): Promise<Record<string, unknown>> {
    const refs = await this.resolveScope(record);
    let unhealthy = 0;
    let incidents = 0;
    await mapConcurrent(refs, 4, async (ref) => {
      const health = await this.deps.health.assess(ref, {}).catch(() => null);
      if (!health) return;
      if (health.status === "unhealthy" || health.status === "crash_loop") {
        unhealthy += 1;
        const opened = await this.deps.incidentService.open({
          ref,
          title: `Scheduled health scan: ${health.status} on ${ref.serverId}`,
          summary: health.explanation,
          severity: health.status === "crash_loop" ? "critical" : "high",
          fingerprint: `scheduled-health:${health.status}:${ref.panel}/${ref.serverId}`,
          confidence: 0.8,
          symptoms: health.checks
            .filter((check) => check.status === "fail")
            .map((check) => `${check.name}: ${check.detail}`),
          evidence: [
            {
              kind: "health-scan",
              source: "scheduler",
              summary: `${health.status} (score ${health.score}): ${health.explanation}`,
            },
          ],
          tags: ["scheduled"],
        });
        if (!opened.deduped) incidents += 1;
      }
    });
    return { scope: record.scope, scanned: refs.length, unhealthy, newIncidents: incidents };
  }

  private async jobDiagnoseScope(record: ScheduleRecord): Promise<Record<string, unknown>> {
    const refs = await this.resolveScope(record);
    const diagnosed: string[] = [];
    await mapConcurrent(refs, 2, async (ref) => {
      const health = await this.deps.health.assess(ref, {}).catch(() => null);
      if (!health) return;
      if (health.status === "healthy" || health.status === "starting") return;
      await this.deps.diagnostics.diagnose(ref, {}).catch(() => null);
      diagnosed.push(`${ref.panel}/${ref.serverId}`);
    });
    return { scope: record.scope, examined: refs.length, diagnosed };
  }

  private async jobDependencyAudit(record: ScheduleRecord): Promise<Record<string, unknown>> {
    const refs = await this.resolveScope(record);
    let issueCount = 0;
    let errorIssues = 0;
    let audited = 0;
    await mapConcurrent(refs, 3, async (ref) => {
      try {
        const report = await collectDependencyReport(
          {
            panels: this.deps.panels,
            maxFileSizeBytes: 2_000_000,
            logger: this.deps.logger,
          },
          ref,
        );
        audited += 1;
        const errors = report.ecosystems.flatMap((ecosystem) =>
          ecosystem.issues.filter((issue) => issue.severity === "error"),
        );
        issueCount += report.ecosystems.reduce(
          (sum, ecosystem) => sum + ecosystem.issues.length,
          0,
        );
        if (errors.length > 0) {
          errorIssues += 1;
          await this.deps.incidentService.open({
            ref,
            title: `Dependency audit found ${errors.length} error-level issue(s) on ${ref.serverId}`,
            summary: errors.map((issue) => issue.summary).join(" | "),
            severity: "medium",
            fingerprint: `scheduled-deps:${errors[0]!.id}:${ref.panel}/${ref.serverId}`,
            confidence: 0.7,
            evidence: errors.map((issue) => ({
              kind: "dependency-issue",
              source: "scheduler",
              summary: issue.summary,
            })),
            tags: ["scheduled", "dependencies"],
          });
        }
      } catch (error) {
        this.deps.logger.debug("dependency audit failed for server", {
          server: `${ref.panel}/${ref.serverId}`,
          error: (error as Error).message,
        });
      }
    });
    return { scope: record.scope, audited, issues: issueCount, serversWithErrors: errorIssues };
  }

  private async jobBackupCheck(record: ScheduleRecord): Promise<Record<string, unknown>> {
    const refs = await this.resolveScope(record);
    const warnings: string[] = [];
    const cutoff = this.clock() - 7 * 86_400_000;
    await mapConcurrent(refs, 3, async (ref) => {
      const panel = this.deps.panels.tryGet(ref.panel);
      if (!panel?.clientApi || !panel.capabilities.has("client.backups")) return;
      try {
        const backups = await panel.clientApi.listBackups(ref);
        const successful = backups.filter((backup) => backup.successful);
        const latest = successful.reduce<number | null>(
          (acc, backup) =>
            backup.createdAt !== null && (acc === null || backup.createdAt > acc)
              ? backup.createdAt
              : acc,
          null,
        );
        if (latest === null) {
          warnings.push(`${ref.panel}/${ref.serverId}: no successful backup on record`);
          await this.deps.incidentService.open({
            ref,
            title: `No usable backup exists for ${ref.serverId}`,
            summary:
              "Backup check found no successful backups; a data-loss event cannot be recovered.",
            severity: "medium",
            fingerprint: `scheduled-backup:missing:${ref.panel}/${ref.serverId}`,
            confidence: 0.9,
            tags: ["scheduled", "backup"],
          });
        } else if (latest < cutoff) {
          warnings.push(
            `${ref.panel}/${ref.serverId}: newest backup is ${Math.round((this.clock() - latest) / 86_400_000)} days old`,
          );
        }
      } catch (error) {
        this.deps.logger.debug("backup check failed", {
          server: `${ref.panel}/${ref.serverId}`,
          error: (error as Error).message,
        });
      }
    });
    return { scope: record.scope, checked: refs.length, warnings };
  }

  private async jobAnomalyScan(record: ScheduleRecord): Promise<Record<string, unknown>> {
    const refs = await this.resolveScope(record);
    const anomalies: string[] = [];
    let incidents = 0;
    await mapConcurrent(refs, 3, async (ref) => {
      await this.deps.baselines.update(ref);
      for (const hint of await this.deps.baselines.hints(ref)) {
        if (hint.direction === "high" && hint.ratio >= 1.8) {
          anomalies.push(`${ref.panel}/${ref.serverId}: ${hint.hint}`);
          await this.deps.incidentService.open({
            ref,
            title: `Anomaly detected on ${ref.serverId}: ${hint.metric}`,
            summary: hint.hint,
            severity: "medium",
            fingerprint: `scheduled-anomaly:${hint.metric}:${ref.panel}/${ref.serverId}`,
            confidence: 0.65,
            tags: ["scheduled", "anomaly"],
          });
        }
      }
      const samples = (
        await this.deps.metricRepository.range(
          ref,
          this.clock() - 7 * 86_400_000,
          this.clock(),
          5000,
        )
      )
        .filter((sample) => sample.diskLimitBytes > 0)
        .map((sample) => ({ ts: sample.ts, diskBytes: sample.diskBytes }));
      const limitBytes = (await this.deps.metricRepository.latest(ref))?.diskLimitBytes ?? 0;
      const forecast = forecastDisk(samples, limitBytes);
      if (forecast && forecast.daysUntilFull !== null && forecast.daysUntilFull < 3) {
        anomalies.push(
          `${ref.panel}/${ref.serverId}: disk exhaustion estimated in ${forecast.daysUntilFull} days at ${Math.round(forecast.growthBytesPerDay / 1024 / 1024)} MB/day`,
        );
        const opened = await this.deps.incidentService.open({
          ref,
          title: `Disk exhaustion forecast for ${ref.serverId}`,
          summary: `At the current growth rate (${Math.round(forecast.growthBytesPerDay / 1024 / 1024)} MB/day, estimate based on ${forecast.basedOnSamples} samples), the disk allocation may be exhausted in ~${forecast.daysUntilFull} days.`,
          severity: "high",
          fingerprint: `scheduled-anomaly:disk-forecast:${ref.panel}/${ref.serverId}`,
          confidence: 0.6,
          tags: ["scheduled", "forecast"],
        });
        if (!opened.deduped) incidents += 1;
      }
    });
    return { scope: record.scope, scanned: refs.length, anomalies, newIncidents: incidents };
  }

  private async jobRetentionPrune(record: ScheduleRecord): Promise<Record<string, unknown>> {
    const refs = await this.resolveScope(record);
    let consoleDeleted = 0;
    for (const ref of refs) {
      consoleDeleted += await this.deps.consoleService.prune(ref);
    }
    const metricsDeleted = await this.deps.metricRepository.prune(
      undefined,
      this.deps.retention.metricRetentionHours,
    );
    const processDeleted = await this.deps.processEventRepository.prune(
      this.deps.retention.processEventsRetentionDays,
    );
    const snapshotsDeleted = await this.deps.snapshots.prune(
      this.deps.retention.snapshotRetentionDays * 86_400_000,
    );
    const now = this.clock();
    const tenant = this.deps.panels.default().tenant;
    const auditDeleted =
      this.deps.retention.auditDays > 0
        ? await this.deps.auditRepository.prune(tenant, now - this.deps.retention.auditDays * 86_400_000)
        : 0;
    const changesDeleted =
      this.deps.retention.changesDays > 0
        ? await this.deps.changeRepository.prune(
            tenant,
            now - this.deps.retention.changesDays * 86_400_000,
          )
        : 0;
    const incidentsDeleted =
      this.deps.retention.resolvedIncidentDays > 0
        ? await this.deps.incidentRepository.pruneResolved(
            tenant,
            now - this.deps.retention.resolvedIncidentDays * 86_400_000,
          )
        : 0;
    return {
      scope: record.scope,
      consoleEventsDeleted: consoleDeleted,
      metricSamplesDeleted: metricsDeleted,
      processEventsDeleted: processDeleted,
      snapshotsDeleted,
      auditEventsDeleted: auditDeleted,
      changeEventsDeleted: changesDeleted,
      resolvedIncidentsDeleted: incidentsDeleted,
    };
  }
}

export type { ScheduleRecord };
