import type { Severity, ServerRef } from "../../shared/types.js";
import { caseInsensitiveLike, type SqlDatabase, type SqlValue } from "../sql.js";
import type {
  ConsoleEvent,
  ConsoleEventInput,
  ConsoleEventPage,
  ConsoleQuery,
  FingerprintSummary,
  LogFingerprintRecord,
} from "../models.js";
import { clampLimit, escapeLikePattern } from "./helpers.js";

interface ConsoleRow {
  id: number;
  tenant: string;
  panel: string;
  server_id: string;
  ts: number;
  raw: string;
  normalized: string;
  severity: string;
  subsystem: string | null;
  exception_type: string | null;
  fingerprint: string | null;
  incident_id: string | null;
  correlation_id: string | null;
}

interface FingerprintRow {
  tenant: string;
  panel: string;
  server_id: string;
  fingerprint: string;
  exception_type: string | null;
  severity: string;
  subsystem: string | null;
  count: number;
  first_seen: number;
  last_seen: number;
  sample: string;
  incident_id: string | null;
}

export interface FingerprintUpsert {
  ref: ServerRef;
  fingerprint: string;
  exceptionType: string | null;
  severity: Severity;
  subsystem: string | null;
  ts: number;
  sample: string;
}

export class ConsoleEventRepository {
  constructor(private readonly db: SqlDatabase) {}

  async insert(events: ConsoleEventInput[]): Promise<void> {
    if (events.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const event of events) {
        await tx.run(
          `INSERT INTO console_events
            (tenant, panel, server_id, ts, raw, normalized, severity, subsystem, exception_type, fingerprint, incident_id, correlation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          event.ref.tenant,
          event.ref.panel,
          event.ref.serverId,
          event.ts,
          event.raw,
          event.normalized,
          event.severity,
          event.subsystem ?? null,
          event.exceptionType ?? null,
          event.fingerprint ?? null,
          event.incidentId ?? null,
          event.correlationId ?? null,
        );
      }
    });
  }

  async query(query: ConsoleQuery): Promise<ConsoleEventPage> {
    const limit = clampLimit(query.limit, 100, 1000);
    const mode = query.mode ?? "latest";
    const where: string[] = ["tenant = ?", "panel = ?", "server_id = ?"];
    const params: SqlValue[] = [query.ref.tenant, query.ref.panel, query.ref.serverId];

    if (query.since !== undefined) {
      where.push("ts >= ?");
      params.push(query.since);
    }
    if (query.until !== undefined) {
      where.push("ts <= ?");
      params.push(query.until);
    }
    if (query.severities && query.severities.length > 0) {
      where.push(`severity IN (${query.severities.map(() => "?").join(", ")})`);
      params.push(...query.severities);
    }
    if (query.text) {
      where.push(`normalized ${caseInsensitiveLike(this.db)} ? ESCAPE '\\'`);
      params.push(`%${escapeLikePattern(query.text)}%`);
    }
    if (query.fingerprint) {
      where.push("fingerprint = ?");
      params.push(query.fingerprint);
    }
    if (query.incidentId) {
      where.push("incident_id = ?");
      params.push(query.incidentId);
    }
    if (mode === "events") {
      where.push("(severity IN ('warn','error','fatal') OR subsystem = 'lifecycle')");
    }

    let order = query.order ?? (mode === "first" ? "asc" : "desc");
    if (mode === "before") {
      const around = query.around ?? Date.now();
      where.push("ts < ?");
      params.push(around);
      order = "desc";
    }

    const fetchLimit = query.regex ? Math.min(limit * 40, 5000) : limit;
    const sql = `
      SELECT * FROM console_events
      WHERE ${where.join(" AND ")}
      ORDER BY ts ${order === "asc" ? "ASC" : "DESC"}, id ${order === "asc" ? "ASC" : "DESC"}
      LIMIT ?
    `;
    let rows = await this.db.all<ConsoleRow>(sql, ...params, fetchLimit);
    let truncated = false;

    if (query.regex) {
      let regex: RegExp;
      try {
        regex = new RegExp(query.regex, "i");
      } catch {
        throw new Error(`Invalid regex: ${query.regex}`);
      }
      const filtered = rows.filter((row) => regex.test(row.normalized));
      truncated = filtered.length > limit || rows.length === fetchLimit;
      rows = filtered.slice(0, limit);
    } else {
      truncated = rows.length === fetchLimit;
    }

    if (mode === "before") {
      rows = rows.slice().reverse();
    }

    return { events: rows.map((row) => mapConsoleRow(row)), truncated };
  }

  async firstOccurrence(
    ref: ServerRef,
    options: { text?: string; fingerprint?: string; since?: number } = {},
  ): Promise<ConsoleEvent | null> {
    const page = await this.query({
      ref,
      mode: "first",
      limit: 1,
      ...(options.text !== undefined ? { text: options.text } : {}),
      ...(options.fingerprint !== undefined ? { fingerprint: options.fingerprint } : {}),
      ...(options.since !== undefined ? { since: options.since } : {}),
    });
    return page.events[0] ?? null;
  }

  async lastOccurrence(
    ref: ServerRef,
    options: { text?: string; fingerprint?: string; until?: number } = {},
  ): Promise<ConsoleEvent | null> {
    const page = await this.query({
      ref,
      mode: "latest",
      limit: 1,
      ...(options.text !== undefined ? { text: options.text } : {}),
      ...(options.fingerprint !== undefined ? { fingerprint: options.fingerprint } : {}),
      ...(options.until !== undefined ? { until: options.until } : {}),
    });
    return page.events[0] ?? null;
  }

  async countSeverity(ref: ServerRef, since: number, severities: Severity[]): Promise<number> {
    const row = await this.db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM console_events
       WHERE tenant = ? AND panel = ? AND server_id = ? AND ts >= ?
         AND severity IN (${severities.map(() => "?").join(", ")})`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      since,
      ...severities,
    );
    return Number(row?.count ?? 0);
  }

  async prune(
    ref: ServerRef,
    options: { retentionHours: number; maxEvents: number; now?: number },
  ): Promise<number> {
    const now = options.now ?? Date.now();
    const cutoff = now - options.retentionHours * 3_600_000;
    const deletedByAge = (
      await this.db.run(
        `DELETE FROM console_events WHERE tenant = ? AND panel = ? AND server_id = ? AND ts < ?`,
        ref.tenant,
        ref.panel,
        ref.serverId,
        cutoff,
      )
    ).changes;

    const countRow = await this.db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM console_events
       WHERE tenant = ? AND panel = ? AND server_id = ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
    );
    const total = Number(countRow?.count ?? 0);
    let deletedByCount = 0;
    if (total > options.maxEvents) {
      const excess = total - options.maxEvents;
      deletedByCount = (
        await this.db.run(
          `DELETE FROM console_events WHERE id IN (
             SELECT id FROM console_events
             WHERE tenant = ? AND panel = ? AND server_id = ?
             ORDER BY ts ASC LIMIT ?
           )`,
          ref.tenant,
          ref.panel,
          ref.serverId,
          excess,
        )
      ).changes;
    }
    return deletedByAge + deletedByCount;
  }

  async deleteForServer(ref: ServerRef): Promise<number> {
    return (
      await this.db.run(
        `DELETE FROM console_events WHERE tenant = ? AND panel = ? AND server_id = ?`,
        ref.tenant,
        ref.panel,
        ref.serverId,
      )
    ).changes;
  }
}

export class FingerprintRepository {
  constructor(private readonly db: SqlDatabase) {}

  async upsert(entry: FingerprintUpsert): Promise<void> {
    await this.db.run(
      `INSERT INTO log_fingerprints
        (tenant, panel, server_id, fingerprint, exception_type, severity, subsystem, count, first_seen, last_seen, sample, incident_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
       ON CONFLICT (tenant, panel, server_id, fingerprint) DO UPDATE SET
         count = log_fingerprints.count + 1,
         last_seen = CASE WHEN excluded.last_seen > log_fingerprints.last_seen
                          THEN excluded.last_seen ELSE log_fingerprints.last_seen END,
         exception_type = COALESCE(log_fingerprints.exception_type, excluded.exception_type),
         subsystem = COALESCE(log_fingerprints.subsystem, excluded.subsystem)`,
      entry.ref.tenant,
      entry.ref.panel,
      entry.ref.serverId,
      entry.fingerprint,
      entry.exceptionType,
      entry.severity,
      entry.subsystem,
      entry.ts,
      entry.ts,
      entry.sample,
    );
  }

  async top(ref: ServerRef, since: number, limit = 20): Promise<FingerprintSummary[]> {
    const rows = await this.db.all<FingerprintRow>(
      `SELECT * FROM log_fingerprints
       WHERE tenant = ? AND panel = ? AND server_id = ? AND last_seen >= ?
       ORDER BY count DESC, last_seen DESC
       LIMIT ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      since,
      clampLimit(limit, 20, 200),
    );
    return rows.map(mapFingerprintRow);
  }

  async get(ref: ServerRef, fingerprint: string): Promise<FingerprintSummary | null> {
    const row = await this.db.get<FingerprintRow>(
      `SELECT * FROM log_fingerprints
       WHERE tenant = ? AND panel = ? AND server_id = ? AND fingerprint = ?`,
      ref.tenant,
      ref.panel,
      ref.serverId,
      fingerprint,
    );
    return row ? mapFingerprintRow(row) : null;
  }

  async linkIncident(ref: ServerRef, fingerprint: string, incidentId: string): Promise<void> {
    await this.db.run(
      `UPDATE log_fingerprints SET incident_id = ?
       WHERE tenant = ? AND panel = ? AND server_id = ? AND fingerprint = ?`,
      incidentId,
      ref.tenant,
      ref.panel,
      ref.serverId,
      fingerprint,
    );
  }

  async prune(ref: ServerRef, before: number): Promise<number> {
    return (
      await this.db.run(
        `DELETE FROM log_fingerprints
         WHERE tenant = ? AND panel = ? AND server_id = ? AND last_seen < ?`,
        ref.tenant,
        ref.panel,
        ref.serverId,
        before,
      )
    ).changes;
  }
}

function mapFingerprintRow(row: FingerprintRow): FingerprintSummary {
  return {
    fingerprint: row.fingerprint,
    exceptionType: row.exception_type,
    severity: row.severity as Severity,
    subsystem: row.subsystem,
    count: Number(row.count),
    firstSeen: Number(row.first_seen),
    lastSeen: Number(row.last_seen),
    sample: row.sample,
    incidentId: row.incident_id,
  };
}

function mapConsoleRow(row: ConsoleRow): ConsoleEvent {
  return {
    id: Number(row.id),
    ref: { tenant: row.tenant, panel: row.panel, serverId: row.server_id },
    ts: Number(row.ts),
    raw: row.raw,
    normalized: row.normalized,
    severity: row.severity as Severity,
    subsystem: row.subsystem,
    exceptionType: row.exception_type,
    fingerprint: row.fingerprint,
    incidentId: row.incident_id,
    correlationId: row.correlation_id,
  };
}

export function fingerprintRecordFromSummary(
  ref: ServerRef,
  summary: FingerprintSummary,
): LogFingerprintRecord {
  return {
    fingerprint: summary.fingerprint,
    ref,
    exceptionType: summary.exceptionType,
    severity: summary.severity,
    subsystem: summary.subsystem,
    count: summary.count,
    firstSeen: summary.firstSeen,
    lastSeen: summary.lastSeen,
    sample: summary.sample,
    incidentId: summary.incidentId,
  };
}
