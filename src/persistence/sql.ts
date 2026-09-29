export type SqlValue = string | number | bigint | boolean | Uint8Array | Date | null;

export interface SqlRunResult {
  changes: number;
  lastInsertRowid: number;
}

export type SqlDialect = "sqlite" | "postgres";

export interface SqlDatabase {
  readonly dialect: SqlDialect;
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: SqlValue[]): Promise<SqlRunResult>;
  get<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  insert(sql: string, ...params: SqlValue[]): Promise<number>;
  transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface Migration {
  id: number;
  name: string;
  sqlite: string;
  postgres: string;
}

export function caseInsensitiveLike(db: SqlDatabase): string {
  return db.dialect === "postgres" ? "ILIKE" : "LIKE";
}

export async function runMigrations(
  db: SqlDatabase,
  migrations: Migration[],
  logger?: { info: (message: string, fields?: Record<string, unknown>) => void },
): Promise<void> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL)",
  );
  const applied = new Set(
    (
      await db.all<{ id: number | bigint }>("SELECT id FROM _migrations")
    ).map((row) => Number(row.id)),
  );
  const pending = migrations
    .filter((migration) => !applied.has(migration.id))
    .sort((a, b) => a.id - b.id);
  for (const migration of pending) {
    const ddl = db.dialect === "postgres" ? migration.postgres : migration.sqlite;
    await db.transaction(async (tx) => {
      await tx.exec(ddl);
      await tx.run(
        `INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)`,
        migration.id,
        migration.name,
        Date.now(),
      );
    });
    logger?.info("applied migration", { id: migration.id, name: migration.name });
  }
}

export type SqlParam = string | number | bigint | Uint8Array | null;

export function normalizeSqlValue(value: SqlValue, dialect: SqlDialect): SqlParam {
  if (typeof value === "boolean") return dialect === "postgres" ? (value ? 1 : 0) : value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  return value;
}
