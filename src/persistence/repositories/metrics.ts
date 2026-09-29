import type { ServerRef } from "../../shared/types.js";
import type { SqlDatabase } from "../sql.js";
import type {
  MetricSample,
  MetricSampleInput,
  ProcessEvent,
  ProcessEventInput,
} from "../models.js";
import { clampLimit } from "./helpers.js";

interface MetricRow {
  id: number;
  tenant: string;
  panel: string;
  server_id: string;
  ts: number;
  state: string | null;
  cpu_percent: number;
  memory_bytes: number;
  memory_limit_bytes: number;
  disk_bytes: number;
  disk_limit_bytes: number;
  net_rx_bytes: number;
  net_tx_bytes: number;
  uptime_ms: number | null;
}

interface ProcessEventRow {
  id: number;
  tenant: string;
  panel: string;
  server_id: string;
  ts: number;
  kind: string;
  exit_code: number | null;
  runtime_ms: number | null;
  source: string;
}

export class MetricSampleRepository {
  constructor(private readonly db: SqlDatabase) {}

  async insert(sample: MetricSampleInput): Promise<void> {
    await this.db.run(
      `INSERT INTO metric_samples
        (tenant, panel, server_id, ts, state, cpu_percent, memory_bytes, memory_limit_bytes,
         disk_bytes, disk_limit_bytes, net_rx_bytes, net_tx_bytes, uptime_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sample.ref.tenant,
      sample.ref.panel,
      sample.ref.serverId,
      sample.ts,
      sample.state,
      sample.cpuPercent,
      sample.memoryBytes,
      sample.memoryLimitBytes,
      sample.diskBytes,
      sample.diskLimitBytes,
      sample.netRxBytes,
      sample.netTxBytes,
      sample.uptimeMs,
    );
  }

  async latest(ref: ServerRef): Promise<MetricSample | null> {
    const row = await this.db.get<MetricRow>(
      `SELECT * FROM metric_samples
       WHERE tenant = ? AND panel = ? AND server_id = ?
       ORDER BY ts DESC LIMIT 1`,
      ref.tenant,
      ref.panel,
      ref.serverId,
    );
    return row ? mapMetricRow(row) : null;
  }

  async range(ref: ServerRef, since: number, until: number, limit = 500): Promise<MetricSample[]> {
    const rows = await this.db.all<MetricRow>(
      `SELECT * FROM metric_samples
       WHERE tenant = ? AND panel = ? AND server_id = ? AND ts >= ? AND ts <= ?
       ORDER BY ts ASC LIMIT ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      since,
      until,
      clampLimit(limit, 500, 5000),
    );
    return rows.map(mapMetricRow);
  }

  async sampleCount(ref: ServerRef, since: number): Promise<number> {
    const row = await this.db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM metric_samples
       WHERE tenant = ? AND panel = ? AND server_id = ? AND ts >= ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      since,
    );
    return Number(row?.count ?? 0);
  }

  async prune(ref: ServerRef | undefined, retentionHours: number, now = Date.now()): Promise<number> {
    const cutoff = now - retentionHours * 3_600_000;
    if (ref) {
      return (
        await this.db.run(
          `DELETE FROM metric_samples
           WHERE tenant = ? AND panel = ? AND server_id = ? AND ts < ?`,
          ref.tenant,
          ref.panel,
          ref.serverId,
          cutoff,
        )
      ).changes;
    }
    return (await this.db.run(`DELETE FROM metric_samples WHERE ts < ?`, cutoff)).changes;
  }
}

export class ProcessEventRepository {
  constructor(private readonly db: SqlDatabase) {}

  async insert(event: ProcessEventInput): Promise<void> {
    await this.db.run(
      `INSERT INTO process_events (tenant, panel, server_id, ts, kind, exit_code, runtime_ms, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      event.ref.tenant,
      event.ref.panel,
      event.ref.serverId,
      event.ts,
      event.kind,
      event.exitCode ?? null,
      event.runtimeMs ?? null,
      event.source,
    );
  }

  async range(ref: ServerRef, since: number, until: number = Date.now()): Promise<ProcessEvent[]> {
    const rows = await this.db.all<ProcessEventRow>(
      `SELECT * FROM process_events
       WHERE tenant = ? AND panel = ? AND server_id = ? AND ts >= ? AND ts <= ?
       ORDER BY ts ASC`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      since,
      until,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
      ts: Number(row.ts),
      kind: row.kind as "started" | "exited",
      exitCode: row.exit_code === null ? null : Number(row.exit_code),
      runtimeMs: row.runtime_ms === null ? null : Number(row.runtime_ms),
      source: row.source as "poll" | "console",
    }));
  }

  async listServerRefs(): Promise<Array<{ tenant: string; panel: string; server_id: string }>> {
    return this.db.all<{ tenant: string; panel: string; server_id: string }>(
      `SELECT DISTINCT tenant, panel, server_id FROM process_events`,
    );
  }

  async prune(retentionDays: number, now = Date.now()): Promise<number> {
    return (await this.db.run(`DELETE FROM process_events WHERE ts < ?`, now - retentionDays * 86_400_000))
      .changes;
  }
}

function mapMetricRow(row: MetricRow): MetricSample {
  return {
    id: Number(row.id),
    ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
    ts: Number(row.ts),
    state: row.state,
    cpuPercent: Number(row.cpu_percent),
    memoryBytes: Number(row.memory_bytes),
    memoryLimitBytes: Number(row.memory_limit_bytes),
    diskBytes: Number(row.disk_bytes),
    diskLimitBytes: Number(row.disk_limit_bytes),
    netRxBytes: Number(row.net_rx_bytes),
    netTxBytes: Number(row.net_tx_bytes),
    uptimeMs: row.uptime_ms === null ? null : Number(row.uptime_ms),
  };
}
