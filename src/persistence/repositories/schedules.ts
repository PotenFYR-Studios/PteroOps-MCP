import type { ScheduleKind, ScheduleRecord } from "../models.js";
import type { SqlDatabase } from "../sql.js";
import { fromJson, toJson } from "./helpers.js";

interface ScheduleRow {
  id: string;
  name: string;
  kind: string;
  scope: string;
  every_ms: number;
  enabled: number;
  last_run: number | null;
  next_run: number | null;
  last_result: string | null;
}

export interface ScheduleUpsert {
  id: string;
  name: string;
  kind: ScheduleKind;
  scope: string[];
  everyMs: number;
  enabled: boolean;
  lastRun?: number | null;
  nextRun?: number | null;
  lastResult?: Record<string, unknown> | null;
}

export class ScheduleRepository {
  constructor(private readonly db: SqlDatabase) {}

  async upsert(record: ScheduleUpsert): Promise<void> {
    await this.db.run(
      `INSERT INTO schedules (id, name, kind, scope, every_ms, enabled, last_run, next_run, last_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         scope = excluded.scope,
         every_ms = excluded.every_ms,
         enabled = excluded.enabled,
         next_run = excluded.next_run`,
      record.id,
      record.name,
      record.kind,
      toJson(record.scope),
      record.everyMs,
      record.enabled ? 1 : 0,
      record.lastRun ?? null,
      record.nextRun ?? null,
      toJson(record.lastResult ?? null),
    );
  }

  async list(): Promise<ScheduleRecord[]> {
    const rows = await this.db.all<ScheduleRow>(`SELECT * FROM schedules ORDER BY name ASC`);
    return rows.map(mapScheduleRow);
  }

  async markRun(id: string, lastRun: number, result: Record<string, unknown>): Promise<void> {
    await this.db.run(
      `UPDATE schedules SET last_run = ?, last_result = ? WHERE id = ?`,
      lastRun,
      toJson(result),
      id,
    );
  }
}

function mapScheduleRow(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ScheduleKind,
    scope: fromJson<string[]>(row.scope) ?? ["*"],
    everyMs: Number(row.every_ms),
    enabled: row.enabled === 1,
    lastRun: row.last_run === null ? null : Number(row.last_run),
    nextRun: row.next_run === null ? null : Number(row.next_run),
    lastResult: fromJson<Record<string, unknown>>(row.last_result),
  };
}
