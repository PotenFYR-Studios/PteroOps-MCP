import type { BaselineStats } from "../../persistence/models.js";

export function computeStats(values: number[]): BaselineStats {
  if (values.length === 0) {
    return { median: 0, p95: 0, max: 0, min: 0, ema: 0, mad: 0, samples: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = percentile(deviations, 0.5);
  const alpha = 0.3;
  let ema = values[0]!;
  for (const value of values.slice(1)) {
    ema = alpha * value + (1 - alpha) * ema;
  }
  return {
    median,
    p95,
    max: sorted[sorted.length - 1]!,
    min: sorted[0]!,
    ema,
    mad,
    samples: values.length,
  };
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

export interface AnomalyResult {
  anomalous: boolean;
  score: number;
  ratio: number;
  direction: "high" | "low" | null;
}

export function detectAnomaly(value: number, stats: BaselineStats): AnomalyResult {
  if (stats.samples < 10 || stats.median === 0) {
    return { anomalous: false, score: 0, ratio: stats.median === 0 ? 0 : value / stats.median, direction: null };
  }
  const ratio = value / stats.median;
  if (stats.mad > 0) {
    const modifiedZ = (0.6745 * (value - stats.median)) / stats.mad;
    const anomalous = Math.abs(modifiedZ) >= 3.5;
    return {
      anomalous,
      score: Math.round(modifiedZ * 100) / 100,
      ratio: Math.round(ratio * 100) / 100,
      direction: anomalous ? (modifiedZ > 0 ? "high" : "low") : null,
    };
  }
  const p95Anomalous = value > stats.p95 * 1.5 && value > stats.median * 1.5;
  return {
    anomalous: p95Anomalous,
    score: 0,
    ratio: Math.round(ratio * 100) / 100,
    direction: p95Anomalous ? "high" : null,
  };
}
