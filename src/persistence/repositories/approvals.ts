import type { ApprovalRecord } from "../models.js";
import type { ServerRef } from "../../shared/types.js";
import type { RemediationPlan } from "../../remediation/types.js";
import type { SqlDatabase, SqlValue } from "../sql.js";
import { clampLimit, fromJson, toJson } from "./helpers.js";

interface ApprovalRow {
  id: string;
  tenant: string;
  panel: string;
  server_id: string;
  incident_id: string | null;
  remediation_id: string | null;
  state: string;
  risk: string;
  plan: string;
  reason: string | null;
  proposed_by: string;
  decided_by: string | null;
  decision_note: string | null;
  expires_at: number | null;
  created_at: number;
  decided_at: number | null;
  executed_at: number | null;
}

export interface ApprovalCreate {
  id: string;
  ref: ServerRef;
  incidentId: string | null;
  remediationId: string | null;
  risk: ApprovalRecord["risk"];
  plan: RemediationPlan;
  reason: string | null;
  proposedBy: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface ApprovalFilter {
  tenant?: string;
  ref?: ServerRef;
  states?: ApprovalRecord["state"][];
  since?: number;
  limit?: number;
}

export class ApprovalRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(input: ApprovalCreate): Promise<ApprovalRecord> {
    await this.db.run(
      `INSERT INTO approvals
        (id, tenant, panel, server_id, incident_id, remediation_id, state, risk, plan, reason,
         proposed_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.ref.tenant,
      input.ref.panel,
      input.ref.serverId,
      input.incidentId,
      input.remediationId,
      input.risk,
      toJson(input.plan),
      input.reason,
      input.proposedBy,
      input.createdAt,
      input.expiresAt,
    );
    const created = await this.get(input.ref.tenant, input.id);
    if (!created) throw new Error(`Failed to create approval ${input.id}`);
    return created;
  }

  async get(tenant: string, id: string): Promise<ApprovalRecord | null> {
    const row = await this.db.get<ApprovalRow>(
      `SELECT * FROM approvals WHERE tenant = ? AND id = ?`,
      tenant,
      id,
    );
    return row ? mapApprovalRow(row) : null;
  }

  async list(filter: ApprovalFilter): Promise<ApprovalRecord[]> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filter.tenant) {
      where.push("tenant = ?");
      params.push(filter.tenant);
    }
    if (filter.ref) {
      where.push("panel = ? AND server_id = ?");
      params.push(filter.ref.panel, filter.ref.serverId);
    }
    if (filter.states && filter.states.length > 0) {
      where.push(`state IN (${filter.states.map(() => "?").join(", ")})`);
      params.push(...filter.states);
    }
    if (filter.since !== undefined) {
      where.push("created_at >= ?");
      params.push(filter.since);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.db.all<ApprovalRow>(
      `SELECT * FROM approvals ${clause} ORDER BY created_at DESC LIMIT ?`,
      ...params,
      clampLimit(filter.limit, 50, 500),
    );
    return rows.map(mapApprovalRow);
  }

  async update(record: ApprovalRecord): Promise<void> {
    await this.db.run(
      `UPDATE approvals SET state = ?, decided_by = ?, decision_note = ?, decided_at = ?,
         executed_at = ?, remediation_id = ?, expires_at = ?
       WHERE tenant = ? AND id = ?`,
      record.state,
      record.decidedBy,
      record.decisionNote,
      record.decidedAt,
      record.executedAt,
      record.remediationId,
      record.expiresAt,
      record.ref.tenant,
      record.id,
    );
  }

  async listExpirable(now: number): Promise<ApprovalRecord[]> {
    const rows = await this.db.all<ApprovalRow>(
      `SELECT * FROM approvals WHERE state = 'proposed' AND expires_at IS NOT NULL AND expires_at < ?`,
      now,
    );
    return rows.map(mapApprovalRow);
  }
}

function mapApprovalRow(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
    incidentId: row.incident_id,
    remediationId: row.remediation_id,
    state: row.state as ApprovalRecord["state"],
    risk: row.risk as ApprovalRecord["risk"],
    plan: fromJson<RemediationPlan>(row.plan) ?? ({} as RemediationPlan),
    reason: row.reason,
    proposedBy: row.proposed_by,
    decidedBy: row.decided_by,
    decisionNote: row.decision_note,
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    createdAt: Number(row.created_at),
    decidedAt: row.decided_at === null ? null : Number(row.decided_at),
    executedAt: row.executed_at === null ? null : Number(row.executed_at),
  };
}
