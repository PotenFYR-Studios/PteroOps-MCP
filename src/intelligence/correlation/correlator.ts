import type { ChangeLedger } from "../../changes/ledger.js";
import type { ConsoleService } from "../../console/service.js";
import type { CrashLoopTracker } from "../crash-loop/tracker.js";
import type { HealthService } from "../../health/service.js";
import type { IncidentService } from "../../incidents/service.js";
import type { Logger } from "../../observability/logger.js";
import type { PanelRegistry } from "../../pterodactyl/panels.js";
import type { TopologyRepository } from "../../persistence/repositories/topology.js";
import type { ServerCacheRepository } from "../../persistence/repositories/servers.js";
import type { ServerRef } from "../../shared/types.js";
import { mapConcurrent } from "../../shared/async.js";
import { matchGlob } from "../../shared/text.js";

export interface CorrelationScope {
  panel?: string;
  node?: string;
  server?: string;
  group?: string;
}

export interface AffectedServer {
  server: string;
  name: string;
  healthStatus: string;
  healthScore: number;
  crashLoop: boolean;
  crashCount: number;
  topIssue: string | null;
  firstErrorAt: number | null;
  changes: number;
}

export interface InvestigationReport {
  scope: CorrelationScope;
  generatedAt: number;
  serversExamined: number;
  affected: AffectedServer[];
  failing: AffectedServer[];
  timeline: Array<{ ts: number; event: string }>;
  sharedFindings: {
    temporalCluster: boolean;
    clusterWindowMs: number;
    sameNode: Array<{ node: string; servers: string[] }>;
    sharedDatabases: Array<{ database: string; servers: string[] }>;
  };
  parentIncidentId: string | null;
  recommendation: string;
  confidence: number;
  evidence: string[];
}

export interface CorrelatorDeps {
  panels: PanelRegistry;
  serverCache: ServerCacheRepository;
  health: HealthService;
  crashTracker: CrashLoopTracker;
  consoleService: ConsoleService;
  changeLedger: ChangeLedger;
  incidentService: IncidentService;
  topology: TopologyRepository;
  logger: Logger;
  maxServers?: number;
  clusterWindowMs?: number;
  clock?: () => number;
}

export class IncidentCorrelationEngine {
  private readonly maxServers: number;
  private readonly clusterWindowMs: number;
  private readonly clock: () => number;

  constructor(private readonly deps: CorrelatorDeps) {
    this.maxServers = deps.maxServers ?? 50;
    this.clusterWindowMs = deps.clusterWindowMs ?? 10 * 60_000;
    this.clock = deps.clock ?? Date.now;
  }

  async resolveScope(
    scope: CorrelationScope,
    groups: Record<string, string[]>,
  ): Promise<ServerRef[]> {
    if (scope.server) {
      const [panel, serverId] = scope.server.includes("/")
        ? scope.server.split("/", 2)
        : [scope.panel ?? this.deps.panels.default().name, scope.server];
      const panelConnection = this.deps.panels.tryGet(panel!);
      return [
        {
          tenant: panelConnection?.tenant ?? this.deps.panels.default().tenant,
          panel: panel!,
          serverId: serverId!,
        },
      ];
    }

    const refs: ServerRef[] = [];
    const tenants = new Set(this.deps.panels.list().map((panel) => panel.tenant));
    for (const tenant of tenants) {
      for (const record of await this.deps.serverCache.list(tenant)) {
        refs.push(record.ref);
      }
    }

    let filtered = refs;
    if (scope.node) {
      const hostEdges = await this.deps.topology.edgesFrom(
        `node:${scope.panel ?? ""}:${scope.node}`,
        "hosts",
      );
      const edgeServers = new Set(hostEdges.map((edge) => edge.dst));
      filtered = filtered.filter((ref) => edgeServers.has(`server:${ref.panel}:${ref.serverId}`));
    }
    if (scope.panel) {
      filtered = filtered.filter((ref) => ref.panel === scope.panel);
    }
    if (scope.group) {
      const patterns = groups[scope.group] ?? [];
      filtered = filtered.filter((ref) =>
        patterns.some((pattern) =>
          matchGlob(pattern, `${ref.panel}/${ref.serverId}`) ||
          matchGlob(pattern, `${ref.tenant}/${ref.panel}/${ref.serverId}`),
        ),
      );
    }
    return filtered.slice(0, this.maxServers);
  }

  async investigate(scope: CorrelationScope, groups: Record<string, string[]> = {}): Promise<InvestigationReport> {
    const now = this.clock();
    const refs = await this.resolveScope(scope, groups);
    const windowMs = 60 * 60_000;

    const examined = await mapConcurrent(refs, 4, async (ref) => {
      const [health, crash, topIssues, changes] = await Promise.all([
        this.deps.health.assess(ref, {}).catch(() => null),
        Promise.resolve(this.deps.crashTracker.assess(ref, now)),
        this.deps.consoleService.topIssues(ref, now - windowMs, 5),
        this.deps.changeLedger.recent(ref, { sinceMs: windowMs, limit: 10 }),
      ]);
      return { ref, health, crash, topIssues, changes };
    });

    const affected: AffectedServer[] = examined.map((entry) => {
      const top = entry.topIssues[0] ?? null;
      return {
        server: `${entry.ref.panel}/${entry.ref.serverId}`,
        name: entry.ref.serverId,
        healthStatus: entry.health?.status ?? "unknown",
        healthScore: entry.health?.score ?? 0,
        crashLoop: entry.crash.inCrashLoop,
        crashCount: entry.crash.crashCount,
        topIssue: top ? `${top.exceptionType ?? top.sample.slice(0, 60)} ×${top.count}` : null,
        firstErrorAt: top?.firstSeen ?? null,
        changes: entry.changes.length,
      };
    });

    const failing = affected.filter((entry) =>
      ["unhealthy", "crash_loop"].includes(entry.healthStatus) ||
      entry.crashLoop ||
      entry.healthStatus === "unknown",
    );

    const timeline: Array<{ ts: number; event: string }> = [];
    for (const entry of examined) {
      if (entry.health) {
        timeline.push({
          ts: now,
          event: `${entry.ref.panel}/${entry.ref.serverId}: health ${entry.health.status}`,
        });
      }
      if (entry.crash.crashCount > 0) {
        timeline.push({
          ts: now,
          event: `${entry.ref.panel}/${entry.ref.serverId}: ${entry.crash.crashCount} short exit(s)`,
        });
      }
      for (const change of entry.changes) {
        timeline.push({
          ts: change.ts,
          event: `${entry.ref.panel}/${entry.ref.serverId}: change ${change.action} on ${change.target} by ${change.actor}`,
        });
      }
      const top = entry.topIssues[0];
      if (top) {
        timeline.push({
          ts: top.firstSeen,
          event: `${entry.ref.panel}/${entry.ref.serverId}: first ${top.exceptionType ?? "issue"} (${top.count}×)`,
        });
      }
    }
    timeline.sort((a, b) => a.ts - b.ts);

    const failingTimes = examined
      .filter((entry) => failing.some((item) => item.server === `${entry.ref.panel}/${entry.ref.serverId}`))
      .map((entry) => entry.topIssues[0]?.firstSeen ?? null)
      .filter((ts): ts is number => ts !== null)
      .sort((a, b) => a - b);
    const temporalCluster =
      failingTimes.length >= 2 &&
      failingTimes[failingTimes.length - 1]! - failingTimes[0]! <= this.clusterWindowMs;

    const nodeGroups = new Map<string, string[]>();
    const dbGroups = new Map<string, string[]>();
    const topologyNodes = await this.deps.topology.nodes();
    for (const entry of failing) {
      const serverNodeId = `server:${entry.server.replace("/", ":")}`;
      for (const edge of await this.deps.topology.edgesTo(serverNodeId, "hosts")) {
        const nodeLabel =
          topologyNodes.find((node) => node.id === edge.src)?.label ?? edge.src;
        const list = nodeGroups.get(nodeLabel) ?? [];
        list.push(entry.server);
        nodeGroups.set(nodeLabel, list);
      }
      for (const dbEdge of await this.deps.topology.edgesFrom(serverNodeId, "uses_database")) {
        const list = dbGroups.get(dbEdge.dst) ?? [];
        list.push(entry.server);
        dbGroups.set(dbEdge.dst, list);
      }
    }
    const sameNode = [...nodeGroups.entries()]
      .filter(([, servers]) => servers.length >= 2)
      .map(([node, servers]) => ({ node, servers }));
    const sharedDatabases = [...dbGroups.entries()]
      .filter(([, servers]) => servers.length >= 2)
      .map(([database, servers]) => ({ database, servers }));

    const evidence: string[] = [];
    for (const entry of failing) {
      evidence.push(
        `${entry.server}: ${entry.healthStatus}${entry.topIssue ? `, top issue ${entry.topIssue}` : ""}`,
      );
    }
    if (temporalCluster) {
      evidence.push(
        `${failingTimes.length} failing servers produced their first errors within ${Math.round((failingTimes[failingTimes.length - 1]! - failingTimes[0]!) / 60_000)} minutes`,
      );
    }
    for (const group of sameNode) {
      evidence.push(`${group.servers.length} failing servers share node "${group.node}"`);
    }
    for (const group of sharedDatabases) {
      evidence.push(`${group.servers.length} failing servers use database ${group.database}`);
    }

    let recommendation: string;
    let confidence = 0.3;
    let parentIncidentId: string | null = null;

    if (sameNode.length > 0 || sharedDatabases.length > 0) {
      const finding = sameNode[0] ?? null;
      const target = finding ? `node "${finding.node}"` : `database ${sharedDatabases[0]!.database}`;
      recommendation = `Investigate ${target} before touching individual servers. Likely shared failure domain; restarting servers one by one will not fix it. Verify node maintenance status/resources or database availability first.`;
      confidence = 0.6 + Math.min(0.25, failing.length * 0.05) + (temporalCluster ? 0.1 : 0);
      parentIncidentId = await this.openParentIncident(scope, failing, {
        sameNode,
        sharedDatabases,
        temporalCluster,
        evidence,
      });
    } else if (temporalCluster && failing.length >= 2) {
      recommendation = `${failing.length} servers failed within ${Math.round(this.clusterWindowMs / 60_000)} minutes but no shared node or database was found in the topology. Rebuild topology (ptero_get_topology) and check for a recent change or deployment across the affected servers (ptero_get_change_history).`;
      confidence = 0.5;
      parentIncidentId = await this.openParentIncident(scope, failing, {
        sameNode,
        sharedDatabases,
        temporalCluster,
        evidence,
      });
    } else if (failing.length === 1) {
      recommendation = `Only ${failing[0]!.server} appears unhealthy. Run ptero_diagnose on that server.`;
      confidence = 0.4;
    } else {
      recommendation =
        failing.length === 0
          ? "No unhealthy servers found in scope; nothing to remediate."
          : "Failures appear independent (no temporal cluster, no shared dependency found). Diagnose each server separately with ptero_diagnose; do not mass-remediate.";
      confidence = 0.35;
    }

    this.deps.logger.info("correlation investigation complete", {
      scope,
      failing: failing.length,
      sameNode: sameNode.length,
      sharedDatabases: sharedDatabases.length,
      temporalCluster,
    });

    return {
      scope,
      generatedAt: now,
      serversExamined: examined.length,
      affected,
      failing,
      timeline: timeline.slice(-100),
      sharedFindings: {
        temporalCluster,
        clusterWindowMs: this.clusterWindowMs,
        sameNode,
        sharedDatabases,
      },
      parentIncidentId,
      recommendation,
      confidence: Math.round(Math.min(0.9, confidence) * 100) / 100,
      evidence,
    };
  }

  private async openParentIncident(
    scope: CorrelationScope,
    failing: AffectedServer[],
    context: {
      sameNode: Array<{ node: string; servers: string[] }>;
      sharedDatabases: Array<{ database: string; servers: string[] }>;
      temporalCluster: boolean;
      evidence: string[];
    },
  ): Promise<string | null> {
    try {
      const first = failing[0]!;
      const [panelName, serverId] = first.server.split("/", 2);
      const panel = this.deps.panels.get(panelName);
      const fingerprintBase =
        context.sameNode.length > 0
          ? `correlated:node:${context.sameNode[0]!.node}`
          : context.sharedDatabases.length > 0
            ? `correlated:db:${context.sharedDatabases[0]!.database}`
            : `correlated:temporal:${scope.panel ?? "all"}`;
      const title =
        context.sameNode.length > 0
          ? `Correlated outage: ${context.sameNode[0]!.servers.length} servers on node "${context.sameNode[0]!.node}"`
          : context.sharedDatabases.length > 0
            ? `Correlated outage: shared database ${context.sharedDatabases[0]!.database}`
            : `Correlated outage across ${failing.length} servers`;
      const result = await this.deps.incidentService.open({
        ref: {
          tenant: panel.tenant,
          panel: panelName!,
          serverId: serverId!,
        },
        title,
        summary: `${failing.length} servers are failing: ${failing.map((entry) => entry.server).join(", ")}`,
        severity: failing.length >= 3 ? "critical" : "high",
        fingerprint: fingerprintBase,
        confidence: 0.7,
        symptoms: failing.map(
          (entry) => `${entry.server}: ${entry.healthStatus}${entry.topIssue ? ` (${entry.topIssue})` : ""}`,
        ),
        evidence: context.evidence.map((detail) => ({
          kind: "correlation",
          source: "correlation-engine",
          summary: detail,
        })),
        tags: ["correlated"],
      });
      return result.incident.id;
    } catch (error) {
      this.deps.logger.warn("failed to open correlated parent incident", {
        error: (error as Error).message,
      });
      return null;
    }
  }
}
