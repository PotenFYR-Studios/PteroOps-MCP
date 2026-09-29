import type { ApplicationSignalCollector } from "../../applications/signal-collector.js";
import type { Logger } from "../../observability/logger.js";
import type { PanelRegistry } from "../../pterodactyl/panels.js";
import type { ServerRef } from "../../shared/types.js";
import { sha256Hex } from "../../shared/hash.js";
import { formatUnifiedDiff } from "../../shared/diff.js";
import { mapConcurrent } from "../../shared/async.js";

export interface DriftReport {
  group: string;
  members: string[];
  filesChecked: string[];
  fileDrifts: Array<{
    file: string;
    baselineHash: string;
    outliers: Array<{ server: string; hash: string; diff: string | null }>;
  }>;
  startupVariableDrifts: Array<{
    key: string;
    values: Array<{ server: string; value: string }>;
  }>;
  missingEvidence: string[];
  summary: string;
}

export interface DriftAnalyzerDeps {
  panels: PanelRegistry;
  signalCollector: ApplicationSignalCollector;
  logger: Logger;
  clock?: () => number;
}

const DRIFT_FILES = [
  "server.properties",
  "paper.yml",
  "config/paper-global.yml",
  "spigot.yml",
  "bukkit.yml",
  "package.json",
  "pyproject.toml",
  "velocity.toml",
];

const SENSITIVE_VARIABLE_RE = /pass|secret|token|key|rcon|dsn|credential/i;

export class DriftAnalyzer {
  constructor(private readonly deps: DriftAnalyzerDeps) {}

  async compareGroup(groupName: string, members: ServerRef[]): Promise<DriftReport> {
    if (members.length < 2) {
      return {
        group: groupName,
        members: members.map((ref) => `${ref.panel}/${ref.serverId}`),
        filesChecked: [],
        fileDrifts: [],
        startupVariableDrifts: [],
        missingEvidence: ["a group needs at least two servers to compare"],
        summary: `group "${groupName}" has fewer than two members`,
      };
    }

    const missingEvidence: string[] = [];
    const perServer = await mapConcurrent(members, 4, async (ref) => {
      try {
        const signals = await this.deps.signalCollector.collect(ref, {
          includeConsole: false,
          bypassCache: true,
        });
        return { ref, signals, error: null as string | null };
      } catch (error) {
        return { ref, signals: null, error: (error as Error).message };
      }
    });

    const filesChecked = new Set<string>();
    const fileContents = new Map<string, Map<string, string>>();
    for (const entry of perServer) {
      if (!entry.signals) {
        missingEvidence.push(
          `${entry.ref.panel}/${entry.ref.serverId}: signals unavailable (${entry.error ?? "unknown error"})`,
        );
        continue;
      }
      for (const file of DRIFT_FILES) {
        const content = entry.signals.configFiles[file];
        if (content === undefined) continue;
        filesChecked.add(file);
        const byServer = fileContents.get(file) ?? new Map<string, string>();
        byServer.set(`${entry.ref.panel}/${entry.ref.serverId}`, content);
        fileContents.set(file, byServer);
      }
    }

    const fileDrifts: DriftReport["fileDrifts"] = [];
    for (const [file, contents] of fileContents) {
      if (contents.size < 2) continue;
      const hashCounts = new Map<string, { hash: string; servers: string[] }>();
      for (const [server, content] of contents) {
        const hash = sha256Hex(content);
        const entry = hashCounts.get(hash) ?? { hash, servers: [] };
        entry.servers.push(server);
        hashCounts.set(hash, entry);
      }
      if (hashCounts.size <= 1) continue;
      const baseline = [...hashCounts.values()].sort((a, b) => b.servers.length - a.servers.length)[0]!;
      const baselineContent = contents.get(baseline.servers[0]!)!;
      const outliers: DriftReport["fileDrifts"][number]["outliers"] = [];
      for (const [hash, entry] of hashCounts) {
        if (hash === baseline.hash) continue;
        for (const server of entry.servers) {
          const content = contents.get(server)!;
          let diff: string | null = null;
          if (content.length < 100_000 && baselineContent.length < 100_000) {
            diff = formatUnifiedDiff(baselineContent, content, { label: file, context: 2 }).text;
          }
          outliers.push({ server, hash: hash.slice(0, 12), diff });
        }
      }
      if (outliers.length > 0) {
        fileDrifts.push({ file, baselineHash: baseline.hash.slice(0, 12), outliers });
      }
    }

    const startupVariableDrifts: DriftReport["startupVariableDrifts"] = [];
    const variableMaps = await mapConcurrent(members, 4, async (ref) => {
      try {
        const panel = this.deps.panels.requireCapability(ref.panel, { allOf: ["client.server.read"] });
        const startup = await panel.clientApi!.getStartup(ref);
        return {
          server: `${ref.panel}/${ref.serverId}`,
          variables: new Map(startup.variables.map((variable) => [variable.envVariable, variable.serverValue])),
        };
      } catch {
        return null;
      }
    });
    const validVariableMaps = variableMaps.filter(
      (entry): entry is { server: string; variables: Map<string, string> } => entry !== null,
    );
    if (validVariableMaps.length >= 2) {
      const keys = new Set<string>();
      for (const entry of validVariableMaps) {
        for (const key of entry.variables.keys()) keys.add(key);
      }
      for (const key of keys) {
        const values = validVariableMaps.map((entry) => ({
          server: entry.server,
          value: SENSITIVE_VARIABLE_RE.test(key)
            ? "[REDACTED]"
            : (entry.variables.get(key) ?? "(absent)"),
        }));
        const distinct = new Set(values.map((entry) => entry.value));
        if (distinct.size > 1) {
          startupVariableDrifts.push({ key, values });
        }
      }
    }

    return {
      group: groupName,
      members: members.map((ref) => `${ref.panel}/${ref.serverId}`),
      filesChecked: [...filesChecked],
      fileDrifts,
      startupVariableDrifts,
      missingEvidence,
      summary:
        fileDrifts.length === 0 && startupVariableDrifts.length === 0
          ? `no drift detected across ${String(members.length)} servers in group "${groupName}" (files checked: ${[...filesChecked].join(", ") || "none"})`
          : `${fileDrifts.length} configuration file(s) and ${startupVariableDrifts.length} startup variable(s) differ across group "${groupName}"`,
    };
  }
}
