#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadConfig } from "./config/loader.js";
import { buildServices } from "./container.js";
import { createMcpServer } from "./mcp/server.js";
import { runStdioTransport } from "./mcp/transports/stdio.js";
import { startHttpTransport, type HttpTransportHandle } from "./mcp/transports/http.js";
import { PteroOpsError } from "./shared/errors.js";
import { SERVER_NAME, VERSION } from "./shared/version.js";

const USAGE = `${SERVER_NAME} v${VERSION}: AI SRE & self-healing operations for Pterodactyl

Usage:
  pteroops [--transport stdio|http] [--config <path>]

Options:
  --transport <stdio|http>   MCP transport to serve (default: stdio)
  --config <path>            Config file (default: pteroops.config.yaml | .json, or PTEROOPS_CONFIG)
  --help                     Show this help
  --version                  Show version`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      transport: { type: "string" },
      config: { type: "string" },
      help: { type: "boolean" },
      version: { type: "boolean" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const transportName = values.transport ?? "stdio";
  if (transportName !== "stdio" && transportName !== "http") {
    process.stderr.write(`Unknown transport "${transportName}" (expected "stdio" or "http")\n`);
    process.exitCode = 1;
    return;
  }

  const loaded = loadConfig(values.config !== undefined ? { configPath: values.config } : {});
  const services = await buildServices(loaded.config);
  const { logger, config } = services;

  if (loaded.source) logger.info("configuration loaded", { source: loaded.source });
  logger.info("starting pteroops", {
    version: VERSION,
    transport: transportName,
    panels: Object.keys(config.panels),
  });

  let httpHandle: HttpTransportHandle | null = null;
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { reason });
    try {
      services.monitor.stop();
      services.scheduler.stop();
      services.streamerManager.stopAll();
      await services.consoleService.flush();
      if (httpHandle) await httpHandle.close();
      await services.database.close();
    } catch (error) {
      logger.warn("shutdown cleanup failed", { error: (error as Error).message });
    }
    process.exit(exitCode);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", { error: error.message, stack: error.stack });
    void shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
    });
    void shutdown("unhandledRejection", 1);
  });

  if (config.monitoring.enabled) {
    await services.monitor.start();
  } else {
    logger.info("monitoring disabled by configuration");
  }
  if (config.monitoring.enabled && config.schedules.length > 0) {
    await services.scheduler.start();
  }

  if (transportName === "http") {
    httpHandle = await startHttpTransport({
      services,
      createServer: () => createMcpServer(services).server,
      logger,
      metrics: services.metrics,
      config: { ...config.http, enabled: true },
      dashboard: services.dashboard,
    });
    return;
  }

  const bundle = createMcpServer(services);
  await runStdioTransport(bundle.server, logger);
  process.stdin.on("close", () => void shutdown("stdin closed"));
}

main().catch((error: unknown) => {
  const message =
    error instanceof PteroOpsError
      ? `${error.code}: ${error.message}${error.hint ? ` (${error.hint})` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(`pteroops failed to start: ${message}\n`);
  process.exit(1);
});
