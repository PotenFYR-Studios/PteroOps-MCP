import type { Logger } from "../../observability/logger.js";
import type { BaselineRecord, BaselineStats } from "../../persistence/models.js";
import type { BaselineRepository } from "../../persistence/repositories/baselines.js";
import type { MetricSampleRepository } from "../../persistence/repositories/metrics.js";
import type { ServerRef } from "../../shared/types.js";
import { computeStats, detectAnomaly, type AnomalyResult } from "./stats.js";

export interface BaselineServiceDeps {
  metrics: MetricSampleRepository;
  baselines: BaselineRepository;
  logger: Logger;
  clock?: () => number;
}

export interface AnomalyHint {
  metric: string;
  hint: string;
  current: number;
  median: number;
  ratio: number;
  direction: "high" | "low";
}

export class BaselineService {
  private readonly clock: () => number;

  constructor(private readonly deps: BaselineServiceDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async update(ref: ServerRef, windowHours = 72): Promise<BaselineRecord[]> {
    const now = this.clock();
    const samples = await this.deps.metrics.range(ref, now - windowHours * 3_600_000, now, 5000);
    if (samples.length > 0) {
      const series: Array<{ metric: string; values: number[] }> = [
        {
          metric: "memory_percent",
          values: samples
            .filter((sample) => sample.memoryLimitBytes > 0)
            .map((sample) => (sample.memoryBytes / sample.memoryLimitBytes) * 100),
        },
        { metric: "cpu_percent", values: samples.map((sample) => sample.cpuPercent) },
        {
          metric: "disk_percent",
          values: samples
            .filter((sample) => sample.diskLimitBytes > 0)
            .map((sample) => (sample.diskBytes / sample.diskLimitBytes) * 100),
        },
      ];
      const updated: BaselineRecord[] = [];
      for (const entry of series) {
        if (entry.values.length < 10) continue;
        const stats = computeStats(entry.values);
        const record: BaselineRecord = {
          ref,
          metric: entry.metric,
          stats,
          windowMs: windowHours * 3_600_000,
          samples: entry.values.length,
          updatedAt: now,
        };
        await this.deps.baselines.upsert(record);
        updated.push(record);
      }
      if (updated.length > 0) {
        this.deps.logger.debug("baselines updated", {
          server: `${ref.panel}/${ref.serverId}`,
          metrics: updated.map((record) => record.metric),
        });
      }
      return updated;
    }
    return [];
  }

  async hints(ref: ServerRef): Promise<AnomalyHint[]> {
    const current = await this.deps.metrics.latest(ref);
    if (!current) return [];
    const hints: AnomalyHint[] = [];
    for (const baseline of await this.deps.baselines.list(ref)) {
      const value = metricValue(baseline.metric, current);
      if (value === null) continue;
      const anomaly = detectAnomaly(value, baseline.stats);
      if (anomaly.anomalous && anomaly.direction) {
        hints.push({
          metric: baseline.metric,
          hint: `${baseline.metric.replace(/_/g, " ")} is ${anomaly.ratio}× its normal baseline (median ${formatMetric(baseline.metric, baseline.stats.median)}, current ${formatMetric(baseline.metric, value)})`,
          current: value,
          median: baseline.stats.median,
          ratio: anomaly.ratio,
          direction: anomaly.direction,
        });
      }
    }
    return hints;
  }

  async anomalyFor(ref: ServerRef, metric: string, value: number): Promise<AnomalyResult | null> {
    const baseline = await this.deps.baselines.get(ref, metric);
    if (!baseline) return null;
    return detectAnomaly(value, baseline.stats);
  }

  async baselineStats(ref: ServerRef, metric: string): Promise<BaselineStats | null> {
    return (await this.deps.baselines.get(ref, metric))?.stats ?? null;
  }
}

function metricValue(
  metric: string,
  sample: {
    memoryBytes: number;
    memoryLimitBytes: number;
    cpuPercent: number;
    diskBytes: number;
    diskLimitBytes: number;
  },
): number | null {
  switch (metric) {
    case "memory_percent":
      return sample.memoryLimitBytes > 0
        ? (sample.memoryBytes / sample.memoryLimitBytes) * 100
        : null;
    case "cpu_percent":
      return sample.cpuPercent;
    case "disk_percent":
      return sample.diskLimitBytes > 0 ? (sample.diskBytes / sample.diskLimitBytes) * 100 : null;
    default:
      return null;
  }
}

function formatMetric(metric: string, value: number): string {
  if (metric.endsWith("_percent")) return `${value.toFixed(1)}%`;
  return String(Math.round(value));
}
