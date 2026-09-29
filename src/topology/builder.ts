import type { Logger } from "../observability/logger.js";
import type {
  TopologyEdgeRecord,
  TopologyNodeRecord,
} from "../persistence/models.js";
import type { TopologyRepository } from "../persistence/repositories/topology.js";
import type { ServerCacheRepository } from "../persistence/repositories/servers.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { ServerRef } from "../shared/types.js";
import { mapConcurrent } from "../shared/async.js";

export interface TopologyBuildResult {
  nodes: TopologyNodeRecord[];
  edges: TopologyEdgeRecord[];
  serversProcessed: number;
  errors: string[];
}

export interface TopologyGraph {
  nodes: TopologyNodeRecord[];
  edges: TopologyEdgeRecord[];
  updatedAt: number | null;
}

export interface TopologyBuilderDeps {
  panels: PanelRegistry;
  serverCache: ServerCacheRepository;
  topology: TopologyRepository;
  logger: Logger;
  clock?: () => number;
}

export class TopologyBuilder {
  private readonly clock: () => number;

  constructor(private readonly deps: TopologyBuilderDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async rebuild(tenantFilter?: string): Promise<TopologyBuildResult> {
    const nodes = new Map<string, TopologyNodeRecord>();
    const edges: TopologyEdgeRecord[] = [];
    const errors: string[] = [];
    let serversProcessed = 0;

    const addNode = (node: TopologyNodeRecord): void => {
      nodes.set(node.id, node);
    };
    const addEdge = (edge: TopologyEdgeRecord): void => {
      if (!edges.some((existing) => existing.src === edge.src && existing.dst === edge.dst && existing.relation === edge.relation)) {
        edges.push(edge);
      }
    };

    for (const panel of this.deps.panels.list()) {
      if (tenantFilter && panel.tenant !== tenantFilter) continue;
      addNode({
        id: `panel:${panel.name}`,
        tenant: panel.tenant,
        kind: "panel",
        ref: panel.name,
        label: panel.name,
        attrs: { url: panel.url },
      });

      let servers: Array<{ ref: ServerRef; name: string; state: string | null; node: string | null; uuid?: string }> = [];
      try {
        if (panel.clientApi && panel.capabilities.has("client.server.read")) {
          const list = await panel.clientApi.allServers({ tenant: panel.tenant, panel: panel.name });
          servers = list.map((server) => ({
            ref: server.ref,
            name: server.name,
            state: server.state,
            node: server.node,
            ...(server.uuid ? { uuid: server.uuid } : {}),
          }));
        } else if (panel.applicationApi && panel.capabilities.has("application.servers.read")) {
          const list = await panel.applicationApi.allServers({ tenant: panel.tenant, panel: panel.name });
          servers = list.map((server) => ({
            ref: server.ref,
            name: server.name,
            state: server.state,
            node: server.node,
            ...(server.uuid ? { uuid: server.uuid } : {}),
          }));
        }
      } catch (error) {
        errors.push(`panel ${panel.name}: ${(error as Error).message}`);
        continue;
      }

      await mapConcurrent(servers, 4, async (server) => {
        serversProcessed += 1;
        const serverNodeId = `server:${panel.name}:${server.ref.serverId}`;
        const cached = await this.deps.serverCache.get(server.ref);
        addNode({
          id: serverNodeId,
          tenant: panel.tenant,
          kind: "server",
          ref: `${panel.name}/${server.ref.serverId}`,
          label: server.name,
          attrs: {
            state: server.state,
            application: cached?.application ?? null,
            uuid: server.uuid ?? null,
          },
        });
        addEdge({
          src: `panel:${panel.name}`,
          dst: serverNodeId,
          relation: "manages",
          attrs: null,
        });
        if (cached?.application) {
          const appNodeId = `app:${panel.name}:${server.ref.serverId}:${cached.application}`;
          addNode({
            id: appNodeId,
            tenant: panel.tenant,
            kind: "application",
            ref: cached.application,
            label: cached.application,
            attrs: null,
          });
          addEdge({ src: serverNodeId, dst: appNodeId, relation: "runs", attrs: null });
        }

        if (panel.clientApi && panel.capabilities.has("client.server.read")) {
          try {
            const detail = await panel.clientApi.getServer(server.ref, {
              includeAllocations: true,
            });
            if (detail.node) {
              const nodeId = `node:${panel.name}:${detail.node}`;
              addNode({
                id: nodeId,
                tenant: panel.tenant,
                kind: "node",
                ref: detail.node,
                label: detail.node,
                attrs: null,
              });
              addEdge({ src: nodeId, dst: serverNodeId, relation: "hosts", attrs: null });
            }
            for (const allocation of detail.allocations ?? []) {
              const allocId = `alloc:${panel.name}:${server.ref.serverId}:${String(allocation.port)}`;
              addNode({
                id: allocId,
                tenant: panel.tenant,
                kind: "allocation",
                ref: `${allocation.ip}:${String(allocation.port)}`,
                label: `${allocation.ip}:${String(allocation.port)}${allocation.primary ? " (primary)" : ""}`,
                attrs: { ip: allocation.ip, port: allocation.port, primary: allocation.primary },
              });
              addEdge({
                src: serverNodeId,
                dst: allocId,
                relation: "has_allocation",
                attrs: { primary: allocation.primary },
              });
            }
          } catch (error) {
            errors.push(`server ${server.ref.serverId}: ${(error as Error).message}`);
          }
        }

        if (panel.clientApi && panel.capabilities.has("client.databases")) {
          try {
            const databases = await panel.clientApi.listDatabases(server.ref);
            for (const database of databases) {
              const dbId = `db:${panel.name}:${database.hostAddress}:${database.name}`;
              addNode({
                id: dbId,
                tenant: panel.tenant,
                kind: "database",
                ref: `${database.hostAddress}:${String(database.hostPort)}/${database.name}`,
                label: `${database.name} @ ${database.hostAddress}`,
                attrs: {
                  host: database.hostAddress,
                  port: database.hostPort,
                  database: database.name,
                },
              });
              addEdge({ src: serverNodeId, dst: dbId, relation: "uses_database", attrs: null });
            }
          } catch {
            return;
          }
        }

        if (panel.clientApi && panel.capabilities.has("client.files.read")) {
          try {
            const head = await panel.clientApi.readFile(server.ref, ".git/HEAD");
            if (head) {
              const repoId = `repo:${panel.name}:${server.ref.serverId}`;
              addNode({
                id: repoId,
                tenant: panel.tenant,
                kind: "repository",
                ref: ".git",
                label: `git repository on ${server.name}`,
                attrs: null,
              });
              addEdge({ src: serverNodeId, dst: repoId, relation: "deploys_from", attrs: null });

              if (cached?.application && /velocity|bungeecord/i.test(cached.application)) {
                const velocityToml = await panel.clientApi
                  .readFile(server.ref, "velocity.toml")
                  .catch(() => null);
                if (velocityToml) {
                  for (const backend of parseVelocityBackends(velocityToml)) {
                    const backendServer = servers.find(
                      (candidate) =>
                        candidate.name.toLowerCase() === backend.toLowerCase() ||
                        candidate.ref.serverId.toLowerCase() === backend.toLowerCase(),
                    );
                    if (backendServer) {
                      addEdge({
                        src: serverNodeId,
                        dst: `server:${panel.name}:${backendServer.ref.serverId}`,
                        relation: "proxies_to",
                        attrs: null,
                      });
                    }
                  }
                }
              }
            }
          } catch {
            return;
          }
        }
      });
    }

    const nodeList = [...nodes.values()];
    const now = this.clock();
    const tenantSet = new Set(nodeList.map((node) => node.tenant));
    for (const tenant of tenantSet) {
      const tenantNodes = nodeList.filter((node) => node.tenant === tenant);
      const tenantNodeIds = new Set(tenantNodes.map((node) => node.id));
      const tenantEdges = edges.filter(
        (edge) => tenantNodeIds.has(edge.src) && tenantNodeIds.has(edge.dst),
      );
      await this.deps.topology.replaceTenantGraph(tenant, tenantNodes, tenantEdges, now);
    }

    this.deps.logger.info("topology rebuilt", {
      nodes: nodeList.length,
      edges: edges.length,
      servers: serversProcessed,
    });
    return { nodes: nodeList, edges, serversProcessed, errors };
  }

  async graph(tenant?: string): Promise<TopologyGraph> {
    return {
      nodes: await this.deps.topology.nodes(tenant),
      edges: await this.deps.topology.edges(tenant),
      updatedAt: await this.deps.topology.lastUpdated(),
    };
  }

  async neighbors(
    nodeId: string,
    depth = 1,
  ): Promise<{ nodes: TopologyNodeRecord[]; edges: TopologyEdgeRecord[] }> {
    const allNodes = new Map((await this.deps.topology.nodes()).map((node) => [node.id, node]));
    const seen = new Set<string>([nodeId]);
    const collectedEdges: TopologyEdgeRecord[] = [];
    let frontier = [nodeId];
    for (let level = 0; level < depth; level++) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const edge of [
          ...(await this.deps.topology.edgesFrom(current)),
          ...(await this.deps.topology.edgesTo(current)),
        ]) {
          if (!collectedEdges.some((existing) => existing.src === edge.src && existing.dst === edge.dst && existing.relation === edge.relation)) {
            collectedEdges.push(edge);
          }
          const other = edge.src === current ? edge.dst : edge.src;
          if (!seen.has(other)) {
            seen.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
    return {
      nodes: [...seen].map((id) => allNodes.get(id)).filter((node): node is TopologyNodeRecord => Boolean(node)),
      edges: collectedEdges,
    };
  }
}

export function parseVelocityBackends(toml: string): string[] {
  const backends: string[] = [];
  const serversSection = /\[servers\]([\s\S]*?)(?:\n\[|$)/.exec(toml);
  const target = serversSection ? serversSection[1]! : toml;
  const line = /^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/gm;
  let match: RegExpExecArray | null;
  while ((match = line.exec(target)) !== null) {
    const value = match[2]!;
    const host = value.includes(":") ? value.split(":")[0]! : value;
    if (host && host !== "servers" && !host.includes("=")) backends.push(host);
    if (backends.length > 50) break;
  }
  return backends;
}
