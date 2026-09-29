import type { AuditEvent, AuditEventInput, AuditFilter } from "../models.js";
import type { StructuredErrorShape } from "../../shared/errors.js";
import type { SqlDatabase, SqlValue } from "../sql.js";
import { clampLimit, fromJson, toJson } from "./helpers.js";

interface AuditRow {
  id: string;
  ts: number;
  tenant: string;
  actor: string;
  tool: string;
  target: string | null;
  action: string;
  decision: string;
  approval_id: string | null;
  success: number;
  error: string | null;
  correlation_id: string | null;
  details: string | null;
}

export class AuditRepository {
  constructor(private readonly db: SqlDatabase) {}

  async append(input: AuditEventInput): Promise<void> {
    await this.db.run(
      `INSERT INTO audit_events
        (id, ts, tenant, actor, tool, target, action, decision, approval_id, success, error, correlation_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.ts,
      input.tenant,
      input.actor,
      input.tool,
      input.target ?? null,
      input.action,
      input.decision,
      input.approvalId ?? null,
      input.success ? 1 : 0,
      toJson(input.error ?? null),
      input.correlationId ?? null,
      toJson(input.details ?? null),
    );
  }

  async list(filter: AuditFilter): Promise<AuditEvent[]> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filter.tenant) {
      where.push("tenant = ?");
      params.push(filter.tenant);
    }
    if (filter.tool) {
      where.push("tool = ?");
      params.push(filter.tool);
    }
    if (filter.actor) {
      where.push("actor = ?");
      params.push(filter.actor);
    }
    if (filter.success !== undefined) {
      where.push("success = ?");
      params.push(filter.success ? 1 : 0);
    }
    if (filter.correlationId) {
      where.push("correlation_id = ?");
      params.push(filter.correlationId);
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
    const rows = await this.db.all<AuditRow>(
      `SELECT * FROM audit_events ${clause} ORDER BY ts DESC LIMIT ?`,
      ...params,
      limit,
    );
    return rows.map((row) => ({
      id: row.id,
      ts: Number(row.ts),
      tenant: row.tenant,
      actor: row.actor,
      tool: row.tool,
      target: row.target,
      action: row.action,
      decision: row.decision as AuditEvent["decision"],
      approvalId: row.approval_id,
      success: row.success === 1,
      error: fromJson<StructuredErrorShape>(row.error),
      correlationId: row.correlation_id,
      details: fromJson<Record<string, unknown>>(row.details),
    }));
  }

  async prune(tenant: string, before: number): Promise<number> {
    return (
      await this.db.run(`DELETE FROM audit_events WHERE tenant = ? AND ts < ?`, tenant, before)
    ).changes;
  }

  async allForExport(
    tenant: string,
    since: number,
    until: number,
    maxRows = 100_000,
  ): Promise<AuditEvent[]> {
    const rows = await this.db.all<AuditRow>(
      `SELECT * FROM audit_events WHERE tenant = ? AND ts >= ? AND ts <= ?
       ORDER BY ts ASC LIMIT ?`,
      tenant,
      since,
      until,
      maxRows,
    );
    return rows.map((row) => ({
      id: row.id,
      ts: Number(row.ts),
      tenant: row.tenant,
      actor: row.actor,
      tool: row.tool,
      target: row.target,
      action: row.action,
      decision: row.decision as AuditEvent["decision"],
      approvalId: row.approval_id,
      success: row.success === 1,
      error: fromJson<StructuredErrorShape>(row.error),
      correlationId: row.correlation_id,
      details: fromJson<Record<string, unknown>>(row.details),
    }));
  }
}
