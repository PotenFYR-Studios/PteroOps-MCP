import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../observability/logger.js";
import {
  normalizeSqlValue,
  runMigrations,
  type Migration,
  type SqlDatabase,
  type SqlParam,
  type SqlRunResult,
  type SqlValue,
} from "../sql.js";

export class SqliteDatabase implements SqlDatabase {
  readonly dialect = "sqlite" as const;
  private readonly raw: DatabaseSync;

  private constructor(raw: DatabaseSync) {
    this.raw = raw;
  }

  static async open(
    path: string,
    migrations: Migration[],
    logger?: Logger,
  ): Promise<SqliteDatabase> {
    let database: SqliteDatabase;
    if (path === ":memory:") {
      database = new SqliteDatabase(new DatabaseSync(":memory:"));
    } else {
      const absolute = resolve(path);
      mkdirSync(dirname(absolute), { recursive: true });
      database = new SqliteDatabase(new DatabaseSync(absolute));
    }
    database.raw.exec("PRAGMA journal_mode = WAL");
    database.raw.exec("PRAGMA synchronous = NORMAL");
    database.raw.exec("PRAGMA foreign_keys = ON");
    database.raw.exec("PRAGMA busy_timeout = 5000");
    await runMigrations(database, migrations, logger);
    return database;
  }

  static async inMemory(migrations: Migration[], logger?: Logger): Promise<SqliteDatabase> {
    return SqliteDatabase.open(":memory:", migrations, logger);
  }

  async exec(sql: string): Promise<void> {
    this.raw.exec(sql);
  }

  async run(sql: string, ...params: SqlValue[]): Promise<SqlRunResult> {
    const result = this.raw.prepare(sql).run(...toSqliteParams(params));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  async get<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
    const row = this.raw.prepare(sql).get(...toSqliteParams(params));
    return row === undefined ? undefined : (row as T);
  }

  async all<T>(sql: string, ...params: SqlValue[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...toSqliteParams(params)) as T[];
  }

  async insert(sql: string, ...params: SqlValue[]): Promise<number> {
    const result = await this.run(sql, ...params);
    return result.lastInsertRowid;
  }

  async transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    this.raw.exec("BEGIN");
    try {
      const result = await fn(this);
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  async ping(): Promise<void> {
    this.raw.prepare("SELECT 1").get();
  }

  async close(): Promise<void> {
    this.raw.close();
  }
}

function toSqliteParams(values: SqlValue[]): SqlParam[] {
  return values.map((value) => normalizeSqlValue(value, "sqlite"));
}
