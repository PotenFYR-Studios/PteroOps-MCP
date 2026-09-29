export interface DiskForecast {
  currentBytes: number;
  limitBytes: number;
  growthBytesPerDay: number;
  daysUntilFull: number | null;
  estimate: true;
  basedOnSamples: number;
  spanHours: number;
}

export interface DiskSample {
  ts: number;
  diskBytes: number;
}

const MIN_SAMPLES = 10;
const MIN_SPAN_MS = 2 * 3_600_000;
const MAX_SPAN_DAYS = 30;

export function forecastDisk(
  samples: DiskSample[],
  limitBytes: number,
  options: { minSamples?: number; minSpanMs?: number } = {},
): DiskForecast | null {
  const minSamples = options.minSamples ?? MIN_SAMPLES;
  const minSpanMs = options.minSpanMs ?? MIN_SPAN_MS;
  const sorted = [...samples].sort((a, b) => a.ts - b.ts);
  if (sorted.length < minSamples) return null;
  const spanMs = sorted[sorted.length - 1]!.ts - sorted[0]!.ts;
  if (spanMs < minSpanMs || spanMs > MAX_SPAN_DAYS * 86_400_000) return null;
  if (limitBytes <= 0) return null;

  const n = sorted.length;
  const meanX = sorted.reduce((sum, sample) => sum + sample.ts, 0) / n;
  const meanY = sorted.reduce((sum, sample) => sum + sample.diskBytes, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const sample of sorted) {
    numerator += (sample.ts - meanX) * (sample.diskBytes - meanY);
    denominator += (sample.ts - meanX) ** 2;
  }
  if (denominator === 0) return null;
  const slopePerMs = numerator / denominator;
  const growthBytesPerDay = slopePerMs * 86_400_000;
  const currentBytes = sorted[sorted.length - 1]!.diskBytes;
  let daysUntilFull: number | null = null;
  if (growthBytesPerDay > 0) {
    daysUntilFull = (limitBytes - currentBytes) / growthBytesPerDay;
    if (!Number.isFinite(daysUntilFull) || daysUntilFull < 0) daysUntilFull = 0;
  }
  return {
    currentBytes,
    limitBytes,
    growthBytesPerDay: Math.round(growthBytesPerDay),
    daysUntilFull: daysUntilFull === null ? null : Math.round(daysUntilFull * 10) / 10,
    estimate: true,
    basedOnSamples: n,
    spanHours: Math.round((spanMs / 3_600_000) * 10) / 10,
  };
}
