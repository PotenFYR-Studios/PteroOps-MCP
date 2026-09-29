import type { BlastRadius, RemediationActionType } from "./types.js";
import type { TopologyRepository } from "../persistence/repositories/topology.js";
import type { Logger } from "../observability/logger.js";
import type { ServerRef } from "../shared/types.js";
import { RISK_ORDER } from "../shared/types.js";

export interface BlastRadiusAnalyzerDeps {
  topology: TopologyRepository;
  logger?: Logger;
}

const MEDIUM_RISK_ACTIONS: RemediationActionType[] = [
  "restart_server",
  "file_edit",
  "file_revert",
  "startup_variable_change",
];

export class BlastRadiusAnalyzer {
  constructor(private readonly deps: BlastRadiusAnalyzerDeps) {}

  async analyze(ref: ServerRef, actionType: RemediationActionType): Promise<BlastRadius> {
    const nodes = await this.deps.topology.nodes(ref.tenant);
    const labelOf = new Map(nodes.map((node) => [node.id, node.label]));
    const serverId = `server:${ref.panel}:${ref.serverId}`;

    const hostEdge = (await this.deps.topology.edgesTo(serverId, "hosts")).find((edge) =>
      edge.src.startsWith("node:"),
    );
    const sameNode = hostEdge
      ? (await this.deps.topology.edgesFrom(hostEdge.src, "hosts"))
          .filter((edge) => edge.dst !== serverId)
          .map((edge) => labelOf.get(edge.dst) ?? edge.dst)
      : [];

    const dependents = new Set<string>();
    for (const edge of await this.deps.topology.edgesTo(serverId, "proxies_to")) {
      dependents.add(`proxy ${labelOf.get(edge.src) ?? edge.src} routes players here`);
    }
    for (const edge of await this.deps.topology.edgesFrom(serverId, "proxies_to")) {
      dependents.add(`backend ${labelOf.get(edge.dst) ?? edge.dst} is served by this proxy`);
    }
    for (const dbEdge of await this.deps.topology.edgesFrom(serverId, "uses_database")) {
      const database = dbEdge.dst;
      const dbLabel = labelOf.get(database) ?? database;
      for (const userEdge of await this.deps.topology.edgesTo(database, "uses_database")) {
        if (userEdge.src === serverId) continue;
        dependents.add(`${labelOf.get(userEdge.src) ?? userEdge.src} shares database ${dbLabel}`);
      }
    }

    const maintenanceRequired = dependents.size > 0 && MEDIUM_RISK_ACTIONS.includes(actionType);
    const impactParts: string[] = [`changes are scoped to ${ref.panel}/${ref.serverId}`];
    if (sameNode.length > 0) {
      impactParts.push(
        `${sameNode.length} other server(s) share its node (node-level events affect all)`,
      );
    }
    if (dependents.size > 0) {
      impactParts.push(`${dependents.size} dependent relationship(s) may observe disruption`);
    }
    if (dependents.size === 0 && sameNode.length === 0) {
      impactParts.push("no known dependents; blast radius limited to this server");
    }

    return {
      direct: `${ref.panel}/${ref.serverId}`,
      dependents: [...dependents],
      sameNode,
      estimatedImpact: impactParts.join("; "),
      maintenanceRequired: maintenanceRequired && RISK_ORDER.HIGH >= RISK_ORDER.MEDIUM,
    };
  }
}
