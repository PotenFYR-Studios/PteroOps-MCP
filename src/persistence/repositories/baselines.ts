import type { BaselineRecord, BaselineStats, KnownGoodRecord } from "../models.js";
import type { ServerRef } from "../../shared/types.js";
import type { SqlDatabase } from "../sql.js";
import { clampLimit, fromJson, toJson } from "./helpers.js";

interface BaselineRow {
  tenant: string;
  panel: string;
  server_id: string;
  metric: string;
  stats: string;
  window_ms: number;
  samples: number;
  updated_at: number;
}

export class BaselineRepository {
  constructor(private readonly db: SqlDatabase) {}

  async upsert(record: BaselineRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO baselines (tenant, panel, server_id, metric, stats, window_ms, samples, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant, panel, server_id, metric) DO UPDATE SET
         stats = excluded.stats,
         window_ms = excluded.window_ms,
         samples = excluded.samples,
         updated_at = excluded.updated_at`,
      record.ref.tenant,
      record.ref.panel,
      record.ref.serverId,
      record.metric,
      toJson(record.stats),
      record.windowMs,
      record.samples,
      record.updatedAt,
    );
  }

  async get(ref: ServerRef, metric: string): Promise<BaselineRecord | null> {
    const row = await this.db.get<BaselineRow>(
      `SELECT * FROM baselines WHERE tenant = ? AND panel = ? AND server_id = ? AND metric = ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      metric,
    );
    return row ? mapBaselineRow(row) : null;
  }

  async list(ref: ServerRef): Promise<BaselineRecord[]> {
    const rows = await this.db.all<BaselineRow>(
      `SELECT * FROM baselines WHERE tenant = ? AND panel = ? AND server_id = ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
    );
    return rows.map(mapBaselineRow);
  }
}

function mapBaselineRow(row: BaselineRow): BaselineRecord {
  return {
    ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
    metric: row.metric,
    stats: fromJson<BaselineStats>(row.stats) ?? {
      median: 0,
      p95: 0,
      max: 0,
      min: 0,
      ema: 0,
      mad: 0,
      samples: 0,
    },
    windowMs: Number(row.window_ms),
    samples: Number(row.samples),
    updatedAt: Number(row.updated_at),
  };
}

interface KnownGoodRow {
  id: string;
  tenant: string;
  panel: string;
  server_id: string;
  ts: number;
  health_score: number;
  application: string | null;
  config_hashes: string | null;
  startup_vars_hash: string | null;
  dependency_hash: string | null;
  git_revision: string | null;
}

export class KnownGoodRepository {
  constructor(private readonly db: SqlDatabase) {}

  async record(record: KnownGoodRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO known_good_states
        (id, tenant, panel, server_id, ts, health_score, application, config_hashes,
         startup_vars_hash, dependency_hash, git_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.ref.tenant,
      record.ref.panel,
      record.ref.serverId,
      record.ts,
      record.healthScore,
      record.application,
      toJson(record.configHashes),
      record.startupVarsHash,
      record.dependencyHash,
      record.gitRevision,
    );
  }

  async latest(ref: ServerRef): Promise<KnownGoodRecord | null> {
    const row = await this.db.get<KnownGoodRow>(
      `SELECT * FROM known_good_states
       WHERE tenant = ? AND panel = ? AND server_id = ?
       ORDER BY ts DESC LIMIT 1`,
      ref.tenant,
      ref.panel,
      ref.serverId,
    );
    return row ? mapKnownGoodRow(row) : null;
  }

  async list(ref: ServerRef, limit = 20): Promise<KnownGoodRecord[]> {
    const rows = await this.db.all<KnownGoodRow>(
      `SELECT * FROM known_good_states
       WHERE tenant = ? AND panel = ? AND server_id = ?
       ORDER BY ts DESC LIMIT ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      clampLimit(limit, 20, 100),
    );
    return rows.map(mapKnownGoodRow);
  }
}

function mapKnownGoodRow(row: KnownGoodRow): KnownGoodRecord {
  return {
    id: row.id,
    ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
    ts: Number(row.ts),
    healthScore: Number(row.health_score),
    application: row.application,
    configHashes: fromJson<Record<string, string>>(row.config_hashes) ?? {},
    startupVarsHash: row.startup_vars_hash,
    dependencyHash: row.dependency_hash,
    gitRevision: row.git_revision,
  };
}
