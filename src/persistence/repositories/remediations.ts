import type {
  RemediationRecord,
  RemediationResult,
  RemediationState,
  RemediationStepRecord,
} from "../models.js";
import type { ServerRef, RiskLevel } from "../../shared/types.js";
import type { RemediationPlan } from "../../remediation/types.js";
import type { SqlDatabase, SqlValue } from "../sql.js";
import { clampLimit, fromJson, toJson } from "./helpers.js";

interface RemediationRow {
  id: string;
  tenant: string;
  panel: string;
  server_id: string;
  incident_id: string | null;
  approval_id: string | null;
  plan: string;
  state: string;
  risk: string;
  rollback_strategy: string;
  started_at: number;
  finished_at: number | null;
  result: string | null;
}

interface StepRow {
  id: number;
  remediation_id: string;
  seq: number;
  kind: string;
  status: string;
  detail: string | null;
  ts: number;
}

export interface RemediationCreate {
  id: string;
  ref: ServerRef;
  incidentId: string | null;
  approvalId: string | null;
  plan: RemediationPlan;
  state: RemediationState;
  risk: RiskLevel;
  rollbackStrategy: string;
  startedAt: number;
}

export interface RemediationFilter {
  tenant?: string;
  ref?: ServerRef;
  incidentId?: string;
  states?: RemediationState[];
  since?: number;
  limit?: number;
}

export class RemediationRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(input: RemediationCreate): Promise<RemediationRecord> {
    await this.db.run(
      `INSERT INTO remediations
        (id, tenant, panel, server_id, incident_id, approval_id, plan, state, risk, rollback_strategy, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.ref.tenant,
      input.ref.panel,
      input.ref.serverId,
      input.incidentId,
      input.approvalId,
      toJson(input.plan),
      input.state,
      input.risk,
      input.rollbackStrategy,
      input.startedAt,
    );
    const created = await this.get(input.ref.tenant, input.id);
    if (!created) throw new Error(`Failed to create remediation ${input.id}`);
    return created;
  }

  async get(tenant: string, id: string): Promise<RemediationRecord | null> {
    const row = await this.db.get<RemediationRow>(
      `SELECT * FROM remediations WHERE tenant = ? AND id = ?`,
      tenant,
      id,
    );
    return row ? mapRemediationRow(row) : null;
  }

  async list(filter: RemediationFilter): Promise<RemediationRecord[]> {
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
    if (filter.incidentId) {
      where.push("incident_id = ?");
      params.push(filter.incidentId);
    }
    if (filter.states && filter.states.length > 0) {
      where.push(`state IN (${filter.states.map(() => "?").join(", ")})`);
      params.push(...filter.states);
    }
    if (filter.since !== undefined) {
      where.push("started_at >= ?");
      params.push(filter.since);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.db.all<RemediationRow>(
      `SELECT * FROM remediations ${clause} ORDER BY started_at DESC LIMIT ?`,
      ...params,
      clampLimit(filter.limit, 50, 500),
    );
    return rows.map(mapRemediationRow);
  }

  async updateState(
    tenant: string,
    id: string,
    state: RemediationState,
    result: RemediationResult | null,
    finishedAt: number | null,
  ): Promise<void> {
    await this.db.run(
      `UPDATE remediations SET state = ?, result = ?, finished_at = ? WHERE tenant = ? AND id = ?`,
      state,
      toJson(result),
      finishedAt,
      tenant,
      id,
    );
  }

  async updatePlan(tenant: string, id: string, plan: RemediationPlan): Promise<void> {
    await this.db.run(
      `UPDATE remediations SET plan = ? WHERE tenant = ? AND id = ?`,
      toJson(plan),
      tenant,
      id,
    );
  }

  async addStep(step: {
    remediationId: string;
    seq: number;
    kind: string;
    status: "ok" | "failed" | "skipped" | "rolled_back";
    detail?: Record<string, unknown> | null;
    ts: number;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO remediation_steps (remediation_id, seq, kind, status, detail, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
      step.remediationId,
      step.seq,
      step.kind,
      step.status,
      toJson(step.detail ?? null),
      step.ts,
    );
  }

  async steps(remediationId: string): Promise<RemediationStepRecord[]> {
    const rows = await this.db.all<StepRow>(
      `SELECT * FROM remediation_steps WHERE remediation_id = ? ORDER BY seq ASC`,
      remediationId,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      remediationId: row.remediation_id,
      seq: Number(row.seq),
      kind: row.kind,
      status: row.status as RemediationStepRecord["status"],
      detail: fromJson<Record<string, unknown>>(row.detail),
      ts: Number(row.ts),
    }));
  }

  async countByStateSince(since: number): Promise<Array<{ state: string; count: number }>> {
    const rows = await this.db.all<{ state: string; count: number | string }>(
      `SELECT state, COUNT(*) as count FROM remediations WHERE started_at >= ? GROUP BY state`,
      since,
    );
    return rows.map((row) => ({ state: row.state, count: Number(row.count) }));
  }
}

function mapRemediationRow(row: RemediationRow): RemediationRecord {
  return {
    id: row.id,
    ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
    incidentId: row.incident_id,
    approvalId: row.approval_id,
    plan: fromJson<RemediationPlan>(row.plan) ?? ({} as RemediationPlan),
    state: row.state as RemediationState,
    risk: row.risk as RiskLevel,
    rollbackStrategy: row.rollback_strategy,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    result: fromJson<RemediationResult>(row.result),
  };
}
