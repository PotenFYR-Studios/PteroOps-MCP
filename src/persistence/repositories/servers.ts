import type { ServerRecord } from "../models.js";
import type { ServerRef } from "../../shared/types.js";
import type { SqlDatabase } from "../sql.js";

interface ServerRow {
  tenant: string;
  panel: string;
  server_id: string;
  uuid: string | null;
  name: string;
  state: string | null;
  application: string | null;
  first_seen: number;
  last_seen: number;
}

export interface ServerUpsert {
  ref: ServerRef;
  uuid: string | null;
  name: string;
  state: string | null;
  application: string | null;
  now: number;
}

export class ServerCacheRepository {
  constructor(private readonly db: SqlDatabase) {}

  async upsert(record: ServerUpsert): Promise<void> {
    await this.db.run(
      `INSERT INTO servers (tenant, panel, server_id, uuid, name, state, application, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant, panel, server_id) DO UPDATE SET
         uuid = COALESCE(excluded.uuid, servers.uuid),
         name = excluded.name,
         state = excluded.state,
         application = COALESCE(excluded.application, servers.application),
         last_seen = excluded.last_seen`,
      record.ref.tenant,
      record.ref.panel,
      record.ref.serverId,
      record.uuid,
      record.name,
      record.state,
      record.application,
      record.now,
      record.now,
    );
  }

  async list(tenant: string): Promise<ServerRecord[]> {
    const rows = await this.db.all<ServerRow>(
      `SELECT * FROM servers WHERE tenant = ? ORDER BY name ASC`,
      tenant,
    );
    return rows.map(mapServerRow);
  }

  async get(ref: ServerRef): Promise<ServerRecord | null> {
    const row = await this.db.get<ServerRow>(
      `SELECT * FROM servers WHERE tenant = ? AND panel = ? AND server_id = ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
    );
    return row ? mapServerRow(row) : null;
  }

  async findByUuid(tenant: string, uuid: string): Promise<ServerRecord | null> {
    const row = await this.db.get<ServerRow>(
      `SELECT * FROM servers WHERE tenant = ? AND uuid = ? LIMIT 1`,
      tenant,
      uuid,
    );
    return row ? mapServerRow(row) : null;
  }

  async count(tenant: string): Promise<number> {
    const row = await this.db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM servers WHERE tenant = ?`,
      tenant,
    );
    return Number(row?.count ?? 0);
  }

  async updateApplication(ref: ServerRef, application: string, now = Date.now()): Promise<void> {
    await this.db.run(
      `UPDATE servers SET application = ?, last_seen = ?
       WHERE tenant = ? AND panel = ? AND server_id = ?`,
      application,
      now,
      ref.tenant,
      ref.panel,
      ref.serverId,
    );
  }
}

function mapServerRow(row: ServerRow): ServerRecord {
  return {
    ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
    uuid: row.uuid,
    name: row.name,
    state: row.state,
    application: row.application,
    firstSeen: Number(row.first_seen),
    lastSeen: Number(row.last_seen),
  };
}
