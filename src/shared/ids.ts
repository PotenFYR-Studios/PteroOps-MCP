import { randomBytes } from "node:crypto";

export function createId(prefix?: string): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(6).toString("hex");
  const id = `${ts}-${rand}`;
  return prefix ? `${prefix}_${id}` : id;
}

export function shortId(id: string, length = 8): string {
  return id.length <= length ? id : id.slice(0, length);
}
