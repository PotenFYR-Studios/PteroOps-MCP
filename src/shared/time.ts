import { ValidationError } from "./errors.js";

const DURATION_PART_RE = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)/gi;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function parseDuration(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      throw new ValidationError(`Invalid duration: ${input}`);
    }
    return input;
  }
  const text = input.trim().toLowerCase();
  if (text === "") throw new ValidationError("Empty duration");
  if (/^\d+$/.test(text)) return Number(text) * 60_000;
  let total = 0;
  let matched = false;
  DURATION_PART_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = DURATION_PART_RE.exec(text)) !== null) {
    if (match.index !== lastIndex) {
      throw new ValidationError(`Invalid duration: ${input}`);
    }
    lastIndex = match.index + match[0].length;
    matched = true;
    total += Number(match[1]) * UNIT_MS[match[2]!.toLowerCase()]!;
  }
  if (!matched || lastIndex !== text.length) {
    throw new ValidationError(`Invalid duration: ${input} (use forms like 30s, 20m, 2h, 1d)`);
  }
  return total;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function parseTimeArgument(input: string | number, now = Date.now()): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new ValidationError(`Invalid time: ${input}`);
    return input < 10_000_000_000 ? input * 1000 : input;
  }
  const text = input.trim();
  if (text === "" || text === "now") return now;
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (/^[-+]/.test(text)) {
    const negative = text.startsWith("-");
    const duration = parseDuration(text.replace(/^[-+]/, ""));
    return negative ? now - duration : now + duration;
  }
  const agoMatch = /^(.*?)\s+ago$/i.exec(text);
  if (agoMatch) {
    return now - parseDuration(agoMatch[1]!);
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    throw new ValidationError(
      `Cannot parse time "${input}" (use ISO 8601, epoch millis, "-20m" or "20m ago")`,
    );
  }
  return parsed;
}

export function clampTimeWindow(
  since: number | undefined,
  until: number | undefined,
  maxWindowMs: number,
  now = Date.now(),
): { since: number; until: number } {
  const end = until ?? now;
  const start = since ?? end - maxWindowMs;
  if (start > end) throw new ValidationError("Time window start is after end");
  if (end - start > maxWindowMs) {
    return { since: end - maxWindowMs, until: end };
  }
  return { since: start, until: end };
}
