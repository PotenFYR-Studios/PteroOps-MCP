import { join } from "node:path";
import type { StorageConfig } from "../config/schema.js";
import { ConfigError } from "../shared/errors.js";
import type { Logger } from "../observability/logger.js";
import { MIGRATIONS } from "./migrations.js";
import { PostgresDatabase } from "./postgres/database.js";
import { SqliteDatabase } from "./sqlite/database.js";
import type { SqlDatabase } from "./sql.js";

export async function createDatabase(
  storage: StorageConfig,
  logger?: Logger,
): Promise<SqlDatabase> {
  if (storage.driver === "postgres") {
    const url = storage.postgresUrl ?? process.env.PTERO_DATABASE_URL;
    if (!url) {
      throw new ConfigError(
        "storage.driver is \"postgres\" but no connection URL is configured",
        {
          hint: "Set storage.postgresUrl in the config file or the PTERO_DATABASE_URL environment variable.",
        },
      );
    }
    return PostgresDatabase.open(url, MIGRATIONS, logger);
  }
  return SqliteDatabase.open(join(storage.dataDir, "pteroops.sqlite"), MIGRATIONS, logger);
}

export { MIGRATIONS };
