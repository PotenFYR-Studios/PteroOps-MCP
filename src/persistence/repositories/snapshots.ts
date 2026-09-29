import type { FileSnapshotRecord } from "../models.js";
import type { ServerRef } from "../../shared/types.js";
import type { SqlDatabase } from "../sql.js";
import { clampLimit } from "./helpers.js";

interface SnapshotRow {
  id: string;
  tenant: string;
  panel: string;
  server_id: string;
  path: string;
  hash: string;
  size: number;
  content: string | null;
  created_at: number;
  reason: string | null;
  incident_id: string | null;
  remediation_id: string | null;
}

export interface FileSnapshotCreate {
  id: string;
  ref: ServerRef;
  path: string;
  hash: string;
  size: number;
  content: string | null;
  createdAt: number;
  reason?: string | null;
  incidentId?: string | null;
  remediationId?: string | null;
}

export class FileSnapshotRepository {
  constructor(private readonly db: SqlDatabase) {}

  async record(snapshot: FileSnapshotCreate): Promise<void> {
    await this.db.run(
      `INSERT INTO file_snapshots
        (id, tenant, panel, server_id, path, hash, size, content, created_at, reason, incident_id, remediation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      snapshot.id,
      snapshot.ref.tenant,
      snapshot.ref.panel,
      snapshot.ref.serverId,
      snapshot.path,
      snapshot.hash,
      snapshot.size,
      snapshot.content,
      snapshot.createdAt,
      snapshot.reason ?? null,
      snapshot.incidentId ?? null,
      snapshot.remediationId ?? null,
    );
  }

  async get(tenant: string, id: string): Promise<FileSnapshotRecord | null> {
    const row = await this.db.get<SnapshotRow>(
      `SELECT * FROM file_snapshots WHERE tenant = ? AND id = ?`,
      tenant,
      id,
    );
    return row ? mapSnapshotRow(row) : null;
  }

  async latestForPath(ref: ServerRef, path: string): Promise<FileSnapshotRecord | null> {
    const row = await this.db.get<SnapshotRow>(
      `SELECT * FROM file_snapshots
       WHERE tenant = ? AND panel = ? AND server_id = ? AND path = ?
       ORDER BY created_at DESC LIMIT 1`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      path,
    );
    return row ? mapSnapshotRow(row) : null;
  }

  async listForServer(ref: ServerRef, limit = 100): Promise<FileSnapshotRecord[]> {
    const rows = await this.db.all<SnapshotRow>(
      `SELECT * FROM file_snapshots
       WHERE tenant = ? AND panel = ? AND server_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      clampLimit(limit, 100, 500),
    );
    return rows.map(mapSnapshotRow);
  }

  async prune(maxAgeMs: number, now = Date.now()): Promise<number> {
    return (await this.db.run(`DELETE FROM file_snapshots WHERE created_at < ?`, now - maxAgeMs))
      .changes;
  }
}

function mapSnapshotRow(row: SnapshotRow): FileSnapshotRecord {
  return {
    id: row.id,
    ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
    path: row.path,
    hash: row.hash,
    size: Number(row.size),
    content: row.content,
    createdAt: Number(row.created_at),
    reason: row.reason,
    incidentId: row.incident_id,
    remediationId: row.remediation_id,
  };
}
