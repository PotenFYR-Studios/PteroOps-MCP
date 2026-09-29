import pg from "pg";
import type { Logger } from "../../observability/logger.js";
import {
  runMigrations,
  type Migration,
  type SqlDatabase,
  type SqlRunResult,
  type SqlValue,
} from "../sql.js";

const { Pool } = pg;
type PoolType = pg.Pool;
type PoolClientType = pg.PoolClient;

export class PostgresDatabase implements SqlDatabase {
  readonly dialect = "postgres" as const;
  private readonly pool: PoolType;

  private constructor(pool: PoolType) {
    this.pool = pool;
  }

  static async open(
    connectionString: string,
    migrations: Migration[],
    logger?: Logger,
    options: { maxConnections?: number } = {},
  ): Promise<PostgresDatabase> {
    const pool = new Pool({
      connectionString,
      max: options.maxConnections ?? 10,
    });
    const database = new PostgresDatabase(pool);
    await database.ping();
    await runMigrations(database, migrations, logger);
    return database;
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async run(sql: string, ...params: SqlValue[]): Promise<SqlRunResult> {
    const result = await this.pool.query(translatePlaceholders(sql), params);
    return { changes: result.rowCount ?? 0, lastInsertRowid: 0 };
  }

  async get<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
    const result = await this.pool.query(translatePlaceholders(sql), params);
    return result.rows[0] as T | undefined;
  }

  async all<T>(sql: string, ...params: SqlValue[]): Promise<T[]> {
    const result = await this.pool.query(translatePlaceholders(sql), params);
    return result.rows as T[];
  }

  async insert(sql: string, ...params: SqlValue[]): Promise<number> {
    const result = await this.pool.query(`${translatePlaceholders(sql)} RETURNING id`, params);
    const row = result.rows[0] as { id?: number | string } | undefined;
    return row?.id === undefined ? 0 : Number(row.id);
  }

  async transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new PostgresTransaction(client, 0));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PostgresTransaction implements SqlDatabase {
  readonly dialect = "postgres" as const;

  constructor(
    private readonly client: PoolClientType,
    private readonly depth: number,
  ) {}

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async run(sql: string, ...params: SqlValue[]): Promise<SqlRunResult> {
    const result = await this.client.query(translatePlaceholders(sql), params);
    return { changes: result.rowCount ?? 0, lastInsertRowid: 0 };
  }

  async get<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
    const result = await this.client.query(translatePlaceholders(sql), params);
    return result.rows[0] as T | undefined;
  }

  async all<T>(sql: string, ...params: SqlValue[]): Promise<T[]> {
    const result = await this.client.query(translatePlaceholders(sql), params);
    return result.rows as T[];
  }

  async insert(sql: string, ...params: SqlValue[]): Promise<number> {
    const result = await this.client.query(
      `${translatePlaceholders(sql)} RETURNING id`,
      params,
    );
    const row = result.rows[0] as { id?: number | string } | undefined;
    return row?.id === undefined ? 0 : Number(row.id);
  }

  async transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    const savepoint = `pteroops_sp_${String(this.depth + 1)}`;
    await this.client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await fn(new PostgresTransaction(this.client, this.depth + 1));
      await this.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await this.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
      throw error;
    }
  }

  async ping(): Promise<void> {
    await this.client.query("SELECT 1");
  }

  async close(): Promise<void> {
    return;
  }
}

export function translatePlaceholders(sql: string): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  let counter = 0;
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    if (quote) {
      out += char;
      if (char === quote) {
        if (sql[index + 1] === quote) {
          out += quote;
          index += 2;
          continue;
        }
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === "?") {
      counter += 1;
      out += `$${String(counter)}`;
      index += 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}
