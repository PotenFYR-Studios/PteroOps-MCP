import { describe, expect, it } from "vitest";
import { computeStats, detectAnomaly } from "../../src/intelligence/baselines/stats.js";
import { forecastDisk } from "../../src/intelligence/baselines/forecast.js";

describe("baseline statistics", () => {
  it("computes median, p95, mad and ema", () => {
    const stats = computeStats([10, 12, 11, 13, 12, 14, 12, 11, 13, 12, 100]);
    expect(stats.median).toBe(12);
    expect(stats.p95).toBe(100);
    expect(stats.max).toBe(100);
    expect(stats.min).toBe(10);
    expect(stats.mad).toBe(1);
    expect(stats.samples).toBe(11);
    expect(stats.ema).toBeGreaterThan(10);
  });

  it("detects an anomalous spike with modified z-score", () => {
    const stable = [50, 51, 49, 50, 52, 48, 50, 51, 49, 50, 50, 51, 49, 50, 52, 48, 50, 51, 49, 50];
    const stats = computeStats(stable);
    expect(detectAnomaly(50, stats).anomalous).toBe(false);
    const spike = detectAnomaly(120, stats);
    expect(spike.anomalous).toBe(true);
    expect(spike.direction).toBe("high");
    expect(spike.ratio).toBeGreaterThan(2);
  });

  it("does not flag without enough samples", () => {
    const stats = computeStats([10, 11, 12]);
    expect(detectAnomaly(500, stats).anomalous).toBe(false);
  });
});

describe("disk forecasting", () => {
  const hour = 3_600_000;
  const start = 1_700_000_000_000;

  it("estimates exhaustion with linear growth", () => {
    const samples = Array.from({ length: 48 }, (_v, index) => ({
      ts: start + index * hour,
      diskBytes: 1024 ** 3 + index * 20 * 1024 ** 2,
    }));
    const forecast = forecastDisk(samples, 4 * 1024 ** 3);
    expect(forecast).not.toBeNull();
    expect(forecast!.estimate).toBe(true);
    expect(forecast!.growthBytesPerDay).toBeGreaterThan(0);
    expect(forecast!.daysUntilFull).toBeGreaterThan(1);
    expect(forecast!.daysUntilFull).toBeLessThan(10);
  });

  it("returns null without enough history", () => {
    const samples = [
      { ts: start, diskBytes: 1024 },
      { ts: start + hour, diskBytes: 2048 },
    ];
    expect(forecastDisk(samples, 10_000)).toBeNull();
  });

  it("reports no exhaustion date when disk is shrinking", () => {
    const samples = Array.from({ length: 24 }, (_v, index) => ({
      ts: start + index * hour,
      diskBytes: 10 * 1024 ** 3 - index * 1024 ** 2,
    }));
    const forecast = forecastDisk(samples, 10 * 1024 ** 3);
    expect(forecast).not.toBeNull();
    expect(forecast!.daysUntilFull).toBeNull();
  });
});
