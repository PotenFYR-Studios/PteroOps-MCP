import type {
  Incident,
  IncidentCreate,
  IncidentData,
  IncidentEvidence,
  IncidentFilter,
} from "../models.js";
import type { IncidentSeverity, IncidentState, ServerRef } from "../../shared/types.js";
import { INCIDENT_FINAL_STATES } from "../../shared/types.js";
import type { SqlDatabase, SqlValue } from "../sql.js";
import { clampLimit, fromJson, toJson } from "./helpers.js";

interface IncidentRow {
  id: string;
  tenant: string;
  panel: string;
  server_id: string;
  parent_id: string | null;
  application: string | null;
  title: string;
  summary: string;
  severity: string;
  state: string;
  fingerprint: string | null;
  confidence: number | null;
  detected_at: number;
  updated_at: number;
  resolved_at: number | null;
  data: string;
}

interface EvidenceRow {
  id: number;
  incident_id: string;
  tenant: string;
  ts: number;
  kind: string;
  source: string;
  summary: string;
  detail: string | null;
}

export class IncidentRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(input: IncidentCreate): Promise<Incident> {
    await this.db.run(
      `INSERT INTO incidents
        (id, tenant, panel, server_id, parent_id, application, title, summary, severity, state,
         fingerprint, confidence, detected_at, updated_at, resolved_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      input.id,
      input.ref.tenant,
      input.ref.panel,
      input.ref.serverId,
      input.parentId ?? null,
      input.application ?? null,
      input.title,
      input.summary,
      input.severity,
      input.state,
      input.fingerprint ?? null,
      input.confidence ?? null,
      input.detectedAt,
      input.detectedAt,
      toJson(input.data),
    );
    const created = await this.get(input.ref.tenant, input.id);
    if (!created) throw new Error(`Failed to create incident ${input.id}`);
    return created;
  }

  async get(tenant: string, id: string): Promise<Incident | null> {
    const row = await this.db.get<IncidentRow>(
      `SELECT * FROM incidents WHERE tenant = ? AND id = ?`,
      tenant,
      id,
    );
    return row ? mapIncidentRow(row) : null;
  }

  async list(filter: IncidentFilter): Promise<Incident[]> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filter.tenant) {
      where.push("tenant = ?");
      params.push(filter.tenant);
    }
    if (filter.panel) {
      where.push("panel = ?");
      params.push(filter.panel);
    }
    if (filter.serverId) {
      where.push("server_id = ?");
      params.push(filter.serverId);
    }
    if (filter.states && filter.states.length > 0) {
      where.push(`state IN (${filter.states.map(() => "?").join(", ")})`);
      params.push(...filter.states);
    } else if (filter.openOnly) {
      where.push(`state NOT IN (${INCIDENT_FINAL_STATES.map(() => "?").join(", ")})`);
      params.push(...INCIDENT_FINAL_STATES);
    }
    if (filter.severity) {
      where.push("severity = ?");
      params.push(filter.severity);
    }
    if (filter.since !== undefined) {
      where.push("detected_at >= ?");
      params.push(filter.since);
    }
    const limit = clampLimit(filter.limit, 50, 500);
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.db.all<IncidentRow>(
      `SELECT * FROM incidents ${clause} ORDER BY detected_at DESC LIMIT ?`,
      ...params,
      limit,
    );
    return rows.map(mapIncidentRow);
  }

  async findOpenByFingerprint(ref: ServerRef, fingerprint: string): Promise<Incident | null> {
    const row = await this.db.get<IncidentRow>(
      `SELECT * FROM incidents
       WHERE tenant = ? AND panel = ? AND server_id = ? AND fingerprint = ?
         AND state NOT IN (${INCIDENT_FINAL_STATES.map(() => "?").join(", ")})
       ORDER BY detected_at DESC LIMIT 1`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      fingerprint,
      ...INCIDENT_FINAL_STATES,
    );
    return row ? mapIncidentRow(row) : null;
  }

  async update(incident: Incident): Promise<void> {
    await this.db.run(
      `UPDATE incidents SET
         parent_id = ?, application = ?, title = ?, summary = ?, severity = ?, state = ?,
         fingerprint = ?, confidence = ?, updated_at = ?, resolved_at = ?, data = ?
       WHERE tenant = ? AND id = ?`,
      incident.parentId,
      incident.application,
      incident.title,
      incident.summary,
      incident.severity,
      incident.state,
      incident.fingerprint,
      incident.confidence,
      incident.updatedAt,
      incident.resolvedAt,
      toJson(incident.data),
      incident.ref.tenant,
      incident.id,
    );
  }

  async addEvidence(evidence: {
    incidentId: string;
    ref: ServerRef;
    ts: number;
    kind: string;
    source: string;
    summary: string;
    detail?: Record<string, unknown> | null;
  }): Promise<number> {
    const id = await this.db.insert(
      `INSERT INTO incident_evidence (incident_id, tenant, ts, kind, source, summary, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      evidence.incidentId,
      evidence.ref.tenant,
      evidence.ts,
      evidence.kind,
      evidence.source,
      evidence.summary,
      toJson(evidence.detail ?? null),
    );
    await this.db.run(
      `UPDATE incidents SET updated_at = ? WHERE tenant = ? AND id = ?`,
      evidence.ts,
      evidence.ref.tenant,
      evidence.incidentId,
    );
    return id;
  }

  async listEvidence(tenant: string, incidentId: string, limit = 200): Promise<IncidentEvidence[]> {
    const rows = await this.db.all<EvidenceRow>(
      `SELECT * FROM incident_evidence WHERE tenant = ? AND incident_id = ? ORDER BY ts ASC LIMIT ?`,
      tenant,
      incidentId,
      clampLimit(limit, 200, 1000),
    );
    return rows.map((row) => ({
      id: Number(row.id),
      incidentId: row.incident_id,
      ts: Number(row.ts),
      kind: row.kind,
      source: row.source,
      summary: row.summary,
      detail: fromJson<Record<string, unknown>>(row.detail),
    }));
  }

  async relate(parentId: string, childId: string, relation: string): Promise<void> {
    await this.db.run(
      `INSERT INTO incident_relationships (parent_id, child_id, relation, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (parent_id, child_id, relation) DO NOTHING`,
      parentId,
      childId,
      relation,
      Date.now(),
    );
  }

  async listChildren(parentId: string): Promise<string[]> {
    const rows = await this.db.all<{ child_id: string }>(
      `SELECT child_id FROM incident_relationships WHERE parent_id = ?`,
      parentId,
    );
    return rows.map((row) => row.child_id);
  }

  async findByFingerprints(
    tenant: string,
    fingerprints: string[],
    since: number,
    limit = 5,
  ): Promise<Incident[]> {
    if (fingerprints.length === 0) return [];
    const placeholders = fingerprints.map(() => "?").join(", ");
    const rows = await this.db.all<IncidentRow>(
      `SELECT * FROM incidents
       WHERE tenant = ? AND fingerprint IN (${placeholders}) AND detected_at >= ?
       ORDER BY detected_at DESC LIMIT ?`,
      tenant,
      ...fingerprints,
      since,
      clampLimit(limit, 5, 50),
    );
    return rows.map(mapIncidentRow);
  }

  async countOpen(tenant: string): Promise<number> {
    const row = await this.db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM incidents
       WHERE tenant = ? AND state NOT IN (${INCIDENT_FINAL_STATES.map(() => "?").join(", ")})`,
      tenant,
      ...INCIDENT_FINAL_STATES,
    );
    return Number(row?.count ?? 0);
  }

  async pruneResolved(tenant: string, before: number): Promise<number> {
    return (
      await this.db.run(
        `DELETE FROM incidents
         WHERE tenant = ? AND resolved_at IS NOT NULL AND resolved_at < ?
           AND state IN ('resolved','rolled_back','suppressed')`,
        tenant,
        before,
      )
    ).changes;
  }
}

function mapIncidentRow(row: IncidentRow): Incident {
  const data = fromJson<IncidentData>(row.data) ?? {
    symptoms: [],
    probableCauses: [],
    remediationAttempts: [],
    verifications: [],
  };
  return {
    id: row.id,
    ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
    parentId: row.parent_id,
    application: row.application,
    title: row.title,
    summary: row.summary,
    severity: row.severity as IncidentSeverity,
    state: row.state as IncidentState,
    fingerprint: row.fingerprint,
    confidence: row.confidence === null ? null : Number(row.confidence),
    detectedAt: Number(row.detected_at),
    updatedAt: Number(row.updated_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
    data,
  };
}
