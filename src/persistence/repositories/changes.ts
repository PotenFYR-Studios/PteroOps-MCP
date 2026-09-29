import type { ChangeEvent, ChangeEventInput, ChangeFilter } from "../models.js";
import type { RiskLevel } from "../../shared/types.js";
import type { SqlDatabase, SqlValue } from "../sql.js";
import { clampLimit, fromJson, toJson } from "./helpers.js";

interface ChangeRow {
  id: string;
  tenant: string;
  panel: string;
  server_id: string;
  ts: number;
  actor: string;
  origin: string;
  action: string;
  target: string;
  before_hash: string | null;
  after_hash: string | null;
  before_ref: string | null;
  after_ref: string | null;
  incident_id: string | null;
  reason: string | null;
  approval_id: string | null;
  risk: string | null;
  result: string;
  details: string | null;
}

export class ChangeRepository {
  constructor(private readonly db: SqlDatabase) {}

  async record(input: ChangeEventInput): Promise<void> {
    await this.db.run(
      `INSERT INTO change_events
        (id, tenant, panel, server_id, ts, actor, origin, action, target, before_hash, after_hash,
         before_ref, after_ref, incident_id, reason, approval_id, risk, result, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.ref.tenant,
      input.ref.panel,
      input.ref.serverId,
      input.ts,
      input.actor,
      input.origin,
      input.action,
      input.target,
      input.beforeHash ?? null,
      input.afterHash ?? null,
      input.beforeRef ?? null,
      input.afterRef ?? null,
      input.incidentId ?? null,
      input.reason ?? null,
      input.approvalId ?? null,
      input.risk ?? null,
      input.result,
      toJson(input.details ?? null),
    );
  }

  async list(filter: ChangeFilter): Promise<ChangeEvent[]> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filter.ref) {
      where.push("tenant = ? AND panel = ? AND server_id = ?");
      params.push(filter.ref.tenant, filter.ref.panel, filter.ref.serverId);
    } else if (filter.tenant) {
      where.push("tenant = ?");
      params.push(filter.tenant);
    }
    if (filter.incidentId) {
      where.push("incident_id = ?");
      params.push(filter.incidentId);
    }
    if (filter.action) {
      where.push("action = ?");
      params.push(filter.action);
    }
    if (filter.actor) {
      where.push("actor = ?");
      params.push(filter.actor);
    }
    if (filter.since !== undefined) {
      where.push("ts >= ?");
      params.push(filter.since);
    }
    if (filter.until !== undefined) {
      where.push("ts <= ?");
      params.push(filter.until);
    }
    const limit = clampLimit(filter.limit, 100, 1000);
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.db.all<ChangeRow>(
      `SELECT * FROM change_events ${clause} ORDER BY ts DESC LIMIT ?`,
      ...params,
      limit,
    );
    return rows.map(mapChangeRow);
  }

  async countAction(
    ref: { tenant: string; panel: string; serverId: string },
    action: string,
    since: number,
  ): Promise<number> {
    const row = await this.db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM change_events
       WHERE tenant = ? AND panel = ? AND server_id = ? AND action = ? AND ts >= ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      action,
      since,
    );
    return Number(row?.count ?? 0);
  }

  async linkIncident(id: string, incidentId: string): Promise<void> {
    await this.db.run(`UPDATE change_events SET incident_id = ? WHERE id = ?`, incidentId, id);
  }

  async prune(tenant: string, before: number): Promise<number> {
    return (
      await this.db.run(`DELETE FROM change_events WHERE tenant = ? AND ts < ?`, tenant, before)
    ).changes;
  }
}

function mapChangeRow(row: ChangeRow): ChangeEvent {
  return {
    id: row.id,
    ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
    ts: Number(row.ts),
    actor: row.actor,
    origin: row.origin,
    action: row.action,
    target: row.target,
    beforeHash: row.before_hash,
    afterHash: row.after_hash,
    beforeRef: row.before_ref,
    afterRef: row.after_ref,
    incidentId: row.incident_id,
    reason: row.reason,
    approvalId: row.approval_id,
    risk: row.risk as RiskLevel | null,
    result: row.result as "success" | "failure",
    details: fromJson<Record<string, unknown>>(row.details),
  };
}
