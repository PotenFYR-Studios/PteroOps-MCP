export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

export function fromJson<T>(text: string | null | undefined): T | null {
  if (text === undefined || text === null || text === "") return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function clampLimit(limit: number | undefined, def: number, max: number): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return def;
  return Math.min(Math.floor(limit), max);
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
