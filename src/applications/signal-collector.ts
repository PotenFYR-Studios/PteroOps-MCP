import type { ConsoleService } from "../console/service.js";
import type { Logger } from "../observability/logger.js";
import type { ServerRef } from "../shared/types.js";
import { serverRefKey } from "../shared/types.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { DetectionSignals } from "./types.js";

export interface SignalCollectorDeps {
  panels: PanelRegistry;
  consoleService?: ConsoleService;
  logger: Logger;
  maxFileSizeBytes: number;
  clock?: () => number;
}

export interface CollectOptions {
  includeFiles?: boolean;
  includeConsole?: boolean;
  consoleWindowMs?: number;
  bypassCache?: boolean;
}

const CONFIG_FILES_TO_READ = [
  "server.properties",
  "package.json",
  "pyproject.toml",
  "go.mod",
  "velocity.toml",
  "Cargo.toml",
  "composer.json",
  "Gemfile",
  "docker-compose.yml",
  "compose.yaml",
];

const DIRECTORIES_TO_LIST = ["plugins", "mods"];

const SENSITIVE_VARIABLE_RE = /pass|secret|token|key|rcon/i;

const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  signals: DetectionSignals;
  at: number;
}

export class ApplicationSignalCollector {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly clock: () => number;

  constructor(private readonly deps: SignalCollectorDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  invalidate(ref: ServerRef): void {
    this.cache.delete(serverRefKey(ref));
  }

  async collect(ref: ServerRef, options: CollectOptions = {}): Promise<DetectionSignals> {
    const includeFiles = options.includeFiles ?? true;
    const includeConsole = options.includeConsole ?? true;
    const cacheKey = `${serverRefKey(ref)}|${includeFiles ? "f" : ""}${includeConsole ? "c" : ""}`;
    if (!options.bypassCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && this.clock() - cached.at < CACHE_TTL_MS) {
        return cached.signals;
      }
    }
    const signals = await this.collectFresh(ref, { includeFiles, includeConsole, ...options });
    this.cache.set(cacheKey, { signals, at: this.clock() });
    return signals;
  }

  private async collectFresh(
    ref: ServerRef,
    options: Required<Pick<CollectOptions, "includeFiles" | "includeConsole">> & CollectOptions,
  ): Promise<DetectionSignals> {
    const panel = this.deps.panels.get(ref.panel);
    const clientApi = panel.clientApi;
    const applicationApi = panel.applicationApi;

    const signals: DetectionSignals = {
      serverName: ref.serverId,
      startupCommand: null,
      dockerImage: null,
      invocation: null,
      eggName: null,
      nestName: null,
      variables: [],
      rootFiles: [],
      directoryFiles: {},
      configFiles: {},
      consoleLines: [],
    };

    if (clientApi && panel.capabilities.has("client.server.read")) {
      const [detail, startup] = await Promise.all([
        this.safe(() => clientApi.getServer(ref, { includeAllocations: false })),
        this.safe(() => clientApi.getStartup(ref)),
      ]);
      if (detail) {
        signals.serverName = detail.name;
        signals.invocation = detail.invocation;
        signals.dockerImage = detail.dockerImage;
      }
      if (startup) {
        signals.startupCommand = startup.startupCommand || null;
        signals.dockerImage = startup.dockerImage || signals.dockerImage;
        signals.variables = startup.variables.map((variable) => ({
          name: variable.envVariable,
          value: SENSITIVE_VARIABLE_RE.test(variable.envVariable) ? "[redacted]" : variable.serverValue,
        }));
      }
    } else if (applicationApi && panel.capabilities.has("application.servers.read")) {
      const detail = await this.safe(() => applicationApi.getServer(ref));
      if (detail) {
        signals.serverName = detail.name;
        signals.invocation = detail.invocation;
        signals.startupCommand = detail.startupCommand ?? detail.invocation;
        signals.dockerImage = detail.dockerImage;
      }
    }

    if (options.includeFiles && clientApi && panel.capabilities.has("client.files.read")) {
      const rootListing = await this.safe(() => clientApi.listFiles(ref, "/"));
      if (rootListing) {
        signals.rootFiles = rootListing.map((entry) => entry.name);
      }
      for (const directory of DIRECTORIES_TO_LIST) {
        const listing = await this.safe(() => clientApi.listFiles(ref, `/${directory}`));
        if (listing && listing.length > 0) {
          signals.directoryFiles[directory] = listing.map((entry) => entry.name);
        }
      }
      for (const file of CONFIG_FILES_TO_READ) {
        if (!signals.rootFiles.some((name) => name.toLowerCase() === file.toLowerCase())) continue;
        const content = await this.safe(() => clientApi.readFile(ref, `/${file}`));
        if (content !== null && content.length <= this.deps.maxFileSizeBytes) {
          signals.configFiles[file] = content.slice(0, this.deps.maxFileSizeBytes);
        }
      }
    }

    if (options.includeConsole && this.deps.consoleService) {
      const windowMs = options.consoleWindowMs ?? 30 * 60_000;
      const now = this.clock();
      const events = await this.deps.consoleService.window(ref, now - windowMs, now, { limit: 400 });
      signals.consoleLines = events.map((event) => event.normalized);
    }

    return signals;
  }

  private async safe<T>(operation: () => Promise<T>): Promise<T | null> {
    try {
      return await operation();
    } catch (error) {
      this.deps.logger.debug("signal collection call failed", {
        error: (error as Error).message,
      });
      return null;
    }
  }
}
