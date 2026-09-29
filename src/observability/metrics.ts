export type Labels = Record<string, string | number>;

const DEFAULT_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

interface HistogramState {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

function labelKey(name: string, labels: Labels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return name;
  const serialized = entries.map(([k, v]) => `${k}="${String(v)}"`).join(",");
  return `${name}{${serialized}}`;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramState>();
  private readonly help = new Map<string, string>();

  counter(name: string, help?: string): void {
    if (help) this.help.set(name, help);
    if (!this.counters.has(name)) this.counters.set(name, 0);
  }

  increment(name: string, value = 1, labels: Labels = {}): void {
    const key = labelKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  setGauge(name: string, value: number, labels: Labels = {}): void {
    this.gauges.set(labelKey(name, labels), value);
  }

  observe(name: string, valueMs: number, labels: Labels = {}): void {
    const key = labelKey(name, labels);
    let state = this.histograms.get(key);
    if (!state) {
      state = { buckets: DEFAULT_BUCKETS_MS, counts: new Array(DEFAULT_BUCKETS_MS.length).fill(0), sum: 0, count: 0 };
      this.histograms.set(key, state);
    }
    state.sum += valueMs;
    state.count += 1;
    for (let i = 0; i < state.buckets.length; i++) {
      if (valueMs <= state.buckets[i]!) state.counts[i]! += 1;
    }
  }

  snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    const emittedHelp = new Set<string>();
    const emitHelp = (name: string): void => {
      const base = name.split("{")[0]!;
      if (emittedHelp.has(base)) return;
      emittedHelp.add(base);
      const help = this.help.get(base);
      if (help) lines.push(`# HELP ${base} ${help}`);
      lines.push(`# TYPE ${base} ${base.endsWith("_total") ? "counter" : "gauge"}`);
    };
    for (const [key, value] of this.counters) {
      emitHelp(key);
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of this.gauges) {
      emitHelp(key);
      lines.push(`${key} ${value}`);
    }
    for (const [key, state] of this.histograms) {
      const braceIndex = key.indexOf("{");
      const name = braceIndex === -1 ? key : key.slice(0, braceIndex);
      const labelPart =
        braceIndex === -1 ? "" : key.slice(braceIndex + 1, -1).length > 0 ? key.slice(braceIndex + 1, -1) : "";
      if (!emittedHelp.has(name)) {
        emittedHelp.add(name);
        lines.push(`# TYPE ${name} histogram`);
      }
      let cumulative = 0;
      for (let i = 0; i < state.buckets.length; i++) {
        cumulative = state.counts[i]!;
        const labels = labelPart ? `${labelPart},le="${state.buckets[i]}"` : `le="${state.buckets[i]}"`;
        lines.push(`${name}_bucket{${labels}} ${cumulative}`);
      }
      const infLabels = labelPart ? `${labelPart},le="+Inf"` : `le="+Inf"`;
      lines.push(`${name}_bucket{${infLabels}} ${state.count}`);
      const suffix = labelPart ? `{${labelPart}}` : "";
      lines.push(`${name}_sum${suffix} ${state.sum}`);
      lines.push(`${name}_count${suffix} ${state.count}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
