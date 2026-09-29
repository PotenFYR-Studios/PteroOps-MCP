import type { ApplicationDetector } from "../applications/detector.js";
import type { ApplicationSignalCollector } from "../applications/signal-collector.js";
import type { HealthService } from "../health/service.js";
import type { Logger } from "../observability/logger.js";
import type { KnownGoodRecord } from "../persistence/models.js";
import type { KnownGoodRepository } from "../persistence/repositories/baselines.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { ServerRef } from "../shared/types.js";
import { createId } from "../shared/ids.js";
import { sha256Hex } from "../shared/hash.js";

export interface KnownGoodServiceDeps {
  panels: PanelRegistry;
  detector: ApplicationDetector;
  signalCollector: ApplicationSignalCollector;
  health: HealthService;
  repository: KnownGoodRepository;
  logger: Logger;
  clock?: () => number;
}

export interface KnownGoodDiff {
  field: string;
  knownGood: string;
  current: string;
}

export interface KnownGoodComparison {
  knownGood: KnownGoodRecord;
  current: Omit<KnownGoodRecord, "id">;
  differences: KnownGoodDiff[];
  identical: boolean;
  summary: string;
}

const CONFIG_HASH_FILES = [
  "server.properties",
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "velocity.toml",
];

const DEPENDENCY_FILES = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml"];

export class KnownGoodService {
  private readonly clock: () => number;

  constructor(private readonly deps: KnownGoodServiceDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async capture(
    ref: ServerRef,
    options: { force?: boolean; application?: string | null } = {},
  ): Promise<KnownGoodRecord | null> {
    const snapshot = await this.snapshot(ref, options.application);
    if (!options.force && snapshot.healthScore < 80) {
      this.deps.logger.debug("not capturing known-good state: health score below threshold", {
        score: snapshot.healthScore,
      });
      return null;
    }
    const record: KnownGoodRecord = { id: createId("kg"), ...snapshot };
    await this.deps.repository.record(record);
    this.deps.logger.info("known-good state captured", {
      server: `${ref.panel}/${ref.serverId}`,
      healthScore: record.healthScore,
    });
    return record;
  }

  async latest(ref: ServerRef): Promise<KnownGoodRecord | null> {
    return this.deps.repository.latest(ref);
  }

  async compare(ref: ServerRef): Promise<KnownGoodComparison | null> {
    const knownGood = await this.deps.repository.latest(ref);
    if (!knownGood) {
      const captured = await this.capture(ref, { force: true });
      if (!captured) return null;
      return {
        knownGood: captured,
        current: captured,
        differences: [],
        identical: true,
        summary: "no previous known-good state existed; the current state has been recorded as the baseline",
      };
    }
    const current = await this.snapshot(ref, knownGood.application);
    const differences: KnownGoodDiff[] = [];

    const configKeys = new Set([
      ...Object.keys(knownGood.configHashes),
      ...Object.keys(current.configHashes),
    ]);
    for (const key of configKeys) {
      const before = knownGood.configHashes[key] ?? "(absent)";
      const after = current.configHashes[key] ?? "(absent)";
      if (before !== after) {
        differences.push({
          field: `config:${key}`,
          knownGood: before === "(absent)" ? "(absent)" : before.slice(0, 12),
          current: after === "(absent)" ? "(absent)" : after.slice(0, 12),
        });
      }
    }
    if (knownGood.startupVarsHash !== current.startupVarsHash) {
      differences.push({
        field: "startup variables",
        knownGood: knownGood.startupVarsHash?.slice(0, 12) ?? "(unknown)",
        current: current.startupVarsHash?.slice(0, 12) ?? "(unknown)",
      });
    }
    if (knownGood.dependencyHash !== current.dependencyHash) {
      differences.push({
        field: "dependency manifests",
        knownGood: knownGood.dependencyHash?.slice(0, 12) ?? "(unknown)",
        current: current.dependencyHash?.slice(0, 12) ?? "(unknown)",
      });
    }
    if ((knownGood.gitRevision ?? "") !== (current.gitRevision ?? "")) {
      differences.push({
        field: "git revision",
        knownGood: knownGood.gitRevision ?? "(not a repository)",
        current: current.gitRevision ?? "(not a repository)",
      });
    }
    if (knownGood.application !== current.application) {
      differences.push({
        field: "application",
        knownGood: knownGood.application ?? "(unknown)",
        current: current.application ?? "(unknown)",
      });
    }
    if (knownGood.healthScore !== current.healthScore) {
      differences.push({
        field: "health score",
        knownGood: String(knownGood.healthScore),
        current: String(current.healthScore),
      });
    }

    const identical = differences.length === 0;
    return {
      knownGood,
      current,
      differences,
      identical,
      summary: identical
        ? "current state matches the last known-good state"
        : `${differences.length} difference(s) vs the last known-good state (${new Date(knownGood.ts).toISOString()})`,
    };
  }

  private async snapshot(
    ref: ServerRef,
    applicationOverride?: string | null,
  ): Promise<Omit<KnownGoodRecord, "id">> {
    const now = this.clock();
    let healthScore = 0;
    let application: string | null = applicationOverride ?? null;
    try {
      const health = await this.deps.health.assess(ref, {});
      healthScore = health.score;
    } catch (error) {
      this.deps.logger.debug("known-good health assessment failed", {
        error: (error as Error).message,
      });
    }

    const configHashes: Record<string, string> = {};
    let dependencyHash: string | null = null;
    let startupVarsHash: string | null = null;
    let gitRevision: string | null = null;

    try {
      const signals = await this.deps.signalCollector.collect(ref, { includeConsole: false });
      for (const file of CONFIG_HASH_FILES) {
        const content = signals.configFiles[file];
        if (content !== undefined) {
          configHashes[file] = sha256Hex(content);
        }
      }
      const dependencyParts = DEPENDENCY_FILES.filter((file) => signals.configFiles[file] !== undefined)
        .map((file) => `${file}:${sha256Hex(signals.configFiles[file]!)}`);
      dependencyHash = dependencyParts.length > 0 ? sha256Hex(dependencyParts.join("\n")) : null;
      if (!application) {
        const detection = this.deps.detector.detect(signals);
        application =
          detection.application === "unknown"
            ? null
            : `${detection.application}${detection.distribution ? `/${detection.distribution}` : ""}${detection.version ? ` ${detection.version}` : ""}`;
      }
    } catch (error) {
      this.deps.logger.debug("known-good signal collection failed", {
        error: (error as Error).message,
      });
    }

    try {
      const panel = this.deps.panels.requireCapability(ref.panel, { allOf: ["client.server.read"] });
      const startup = await panel.clientApi!.getStartup(ref);
      const pairs = startup.variables
        .map((variable) => `${variable.envVariable}=${variable.serverValue}`)
        .sort();
      startupVarsHash = sha256Hex(pairs.join("\n"));
    } catch (error) {
      this.deps.logger.debug("known-good startup variables unavailable", {
        error: (error as Error).message,
      });
    }

    try {
      const panel = this.deps.panels.requireCapability(ref.panel, { allOf: ["client.files.read"] });
      gitRevision = await readGitRevision(panel, ref);
    } catch (error) {
      this.deps.logger.debug("known-good git revision unavailable", {
        error: (error as Error).message,
      });
    }

    return {
      ref,
      ts: now,
      healthScore,
      application,
      configHashes,
      startupVarsHash,
      dependencyHash,
      gitRevision,
    };
  }
}

async function readGitRevision(
  panel: { clientApi: { readFile: (ref: ServerRef, path: string) => Promise<string> } | null },
  ref: ServerRef,
): Promise<string | null> {
  if (!panel.clientApi) return null;
  const head = await panel.clientApi.readFile(ref, ".git/HEAD").catch(() => null);
  if (!head) return null;
  const trimmed = head.trim();
  if (trimmed.startsWith("ref:")) {
    const refPath = trimmed.slice(4).trim();
    const revision = await panel.clientApi.readFile(ref, `.git/${refPath}`).catch(() => null);
    if (revision && /^[0-9a-f]{40}$/i.test(revision.trim())) {
      return revision.trim().slice(0, 12);
    }
    const packed = await panel.clientApi.readFile(ref, ".git/packed-refs").catch(() => null);
    if (packed) {
      const line = packed
        .split("\n")
        .find((entry) => entry.endsWith(` ${refPath}`));
      if (line) return line.split(" ")[0]!.slice(0, 12);
    }
    return `${refPath}@unknown`;
  }
  return /^[0-9a-f]{40}$/i.test(trimmed) ? trimmed.slice(0, 12) : null;
}
