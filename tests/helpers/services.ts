import { SqliteDatabase } from "../../src/persistence/sqlite/database.js";
import { MIGRATIONS } from "../../src/persistence/migrations.js";
import { buildServices, type Services } from "../../src/container.js";
import { loadConfig } from "../../src/config/loader.js";
import { createLogger } from "../../src/observability/logger.js";
import { MetricsRegistry } from "../../src/observability/metrics.js";
import { PostgresDatabase } from "../../src/persistence/postgres/database.js";
import type { SqlDatabase } from "../../src/persistence/sql.js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { TEST_CLIENT_KEY, TEST_APPLICATION_KEY } from "./mock-panel.js";

export interface TestServicesOptions {
  panelUrl: string;
  clientKey?: string | null;
  applicationKey?: string | null;
  panelName?: string;
  env?: Record<string, string | undefined>;
  collectLogs?: boolean;
}

export interface TestServicesHandle {
  services: Services;
  logs: string[];
  close: () => void | Promise<void>;
}

export async function createTestServices(
  options: TestServicesOptions,
): Promise<TestServicesHandle> {
  const panelName = options.panelName ?? "mock";
  const panel: Record<string, unknown> = { url: options.panelUrl };
  const clientKey = options.clientKey === undefined ? TEST_CLIENT_KEY : options.clientKey;
  const applicationKey =
    options.applicationKey === undefined ? TEST_APPLICATION_KEY : options.applicationKey;
  if (clientKey) panel.clientKey = clientKey;
  if (applicationKey) panel.applicationKey = applicationKey;

  const env: Record<string, string | undefined> = {
    PTERO_PANELS_JSON: JSON.stringify({ [panelName]: panel }),
    PTERO_DEFAULT_PANEL: panelName,
    PTERO_MONITORING_ENABLED: "0",
    ...options.env,
  };
  const loaded = loadConfig({ env, cwd: process.cwd() });
  const logs: string[] = [];
  const logger = createLogger({
    level: "debug",
    ...(options.collectLogs === false
      ? { sink: () => undefined }
      : { sink: (line: string) => logs.push(line) }),
  });
  const database = await createTestDatabase();
  const services = await buildServices(loaded.config, {
    database,
    metrics: new MetricsRegistry(),
    logger,
  });
  return {
    services,
    logs,
    close: async () => {
      await database.close();
    },
  };
}

export async function createTestDatabase(): Promise<SqlDatabase> {
  const postgresUrl = process.env.PTEROOPS_TEST_POSTGRES_URL;
  if (postgresUrl) {
    const schema = `pteroops_test_${process.pid.toString(36)}_${randomBytes(4).toString("hex")}`;
    const admin = new pg.Pool({ connectionString: postgresUrl, max: 1 });
    await admin.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await admin.end();
    const url = new URL(postgresUrl);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const database = await PostgresDatabase.open(url.toString(), MIGRATIONS);
    return database;
  }
  return SqliteDatabase.inMemory(MIGRATIONS);
}
