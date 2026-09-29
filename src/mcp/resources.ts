import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Services } from "../container.js";
import { policySnapshot } from "./tools/helpers.js";
import { collectDependencyReport } from "../applications/dependency-service.js";
import type { ServerRef } from "../shared/types.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

export function registerResources(server: McpServer, services: Services): void {
  const json = (uri: string, data: unknown): ReadResourceResult => ({
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: services.redactor.redact(JSON.stringify(data, null, 2)),
      },
    ],
  });

  server.registerResource(
    "capabilities",
    "ptero://capabilities",
    { description: "Configured panels, capabilities and policy summary", mimeType: "application/json" },
    async (uri) =>
      json(uri.href, {
        defaultPanel: services.defaultPanel,
        panels: services.panels.list().map((panel) => ({
          name: panel.name,
          tenant: panel.tenant,
          url: panel.url,
          capabilities: [...panel.capabilities].sort(),
        })),
        policy: policySnapshot(services),
      }),
  );

  server.registerResource(
    "servers",
    "ptero://servers",
    { description: "Server inventory (cached identity + last detection)", mimeType: "application/json" },
    async (uri) => {
      const tenants = new Set(services.panels.list().map((panel) => panel.tenant));
      const records = (
        await Promise.all([...tenants].map((tenant) => services.serverCache.list(tenant)))
      ).flat();
      return json(uri.href, {
        servers: records.map((record) => ({
          server: `${record.ref.panel}/${record.ref.serverId}`,
          tenant: record.ref.tenant,
          name: record.name,
          state: record.state,
          application: record.application,
          uuid: record.uuid,
          lastSeen: record.lastSeen,
        })),
        note: "Cached inventory; use the ptero_list_servers tool for a live view.",
      });
    },
  );

  server.registerResource(
    "incidents",
    "ptero://incidents",
    { description: "Open incidents", mimeType: "application/json" },
    async (uri) => {
      const incidents = await services.incidentRepository.list({ openOnly: true, limit: 100 });
      return json(uri.href, {
        incidents: incidents.map((incident) => ({
          id: incident.id,
          server: `${incident.ref.panel}/${incident.ref.serverId}`,
          title: incident.title,
          severity: incident.severity,
          state: incident.state,
          detectedAt: incident.detectedAt,
          fingerprint: incident.fingerprint,
        })),
      });
    },
  );

  server.registerResource(
    "changes",
    "ptero://changes",
    { description: "Recent change ledger entries", mimeType: "application/json" },
    async (uri) => {
      const changes = await services.changeRepository.list({
        tenant: services.panels.default().tenant,
        limit: 100,
      });
      return json(uri.href, {
        changes: changes.map((change) => ({
          id: change.id,
          server: `${change.ref.panel}/${change.ref.serverId}`,
          ts: change.ts,
          actor: change.actor,
          action: change.action,
          target: change.target,
          result: change.result,
          incidentId: change.incidentId,
        })),
      });
    },
  );

  server.registerResource(
    "policies",
    "ptero://policies",
    { description: "Effective policy configuration", mimeType: "application/json" },
    async (uri) => json(uri.href, policySnapshot(services)),
  );

  const registerServerResource = (
    name: string,
    pathSuffix: string,
    description: string,
    handler: (ref: ServerRef) => Promise<unknown>,
  ): void => {
    server.registerResource(
      `${name}-panel`,
      new ResourceTemplate(`ptero://server/{panel}/{serverId}/${pathSuffix}`, { list: undefined }),
      { description, mimeType: "application/json" },
      async (uri, variables) => {
        const ref: ServerRef = {
          tenant: services.panels.get(String(variables.panel)).tenant,
          panel: String(variables.panel),
          serverId: String(variables.serverId),
        };
        return json(uri.href, await handler(ref));
      },
    );
    server.registerResource(
      `${name}-default-panel`,
      new ResourceTemplate(`ptero://server/{serverId}/${pathSuffix}`, { list: undefined }),
      { description, mimeType: "application/json" },
      async (uri, variables) => {
        const panel = services.panels.default();
        const ref: ServerRef = {
          tenant: panel.tenant,
          panel: panel.name,
          serverId: String(variables.serverId),
        };
        return json(uri.href, await handler(ref));
      },
    );
  };

  registerServerResource(
    "server-health",
    "health",
    "Latest health assessment for a server",
    async (ref) => services.health.assess(ref),
  );

  registerServerResource(
    "server-application",
    "application",
    "Detected application and profile for a server",
    async (ref) => {
      const detection = services.detector.detect(await services.signalCollector.collect(ref));
      return { server: `${ref.panel}/${ref.serverId}`, detection };
    },
  );

  registerServerResource(
    "server-recent-errors",
    "recent-errors",
    "Top error fingerprints in the last 60 minutes",
    async (ref) => {
      const since = Date.now() - 60 * 60_000;
      const issues = services.consoleService.topIssues(ref, since, 20);
      return { server: `${ref.panel}/${ref.serverId}`, since, issues };
    },
  );

  registerServerResource(
    "server-dependencies",
    "dependencies",
    "Dependency summary and issues for a server",
    async (ref) => ({
      server: `${ref.panel}/${ref.serverId}`,
      ...(await collectDependencyReport(
        {
          panels: services.panels,
          maxFileSizeBytes: services.config.policy.maxFileSizeBytes,
          logger: services.logger,
        },
        ref,
      )),
    }),
  );

  server.registerResource(
    "incident",
    new ResourceTemplate("ptero://incident/{id}", { list: undefined }),
    { description: "Full incident document", mimeType: "application/json" },
    async (uri, variables) => {
      const id = String(variables.id);
      for (const tenant of new Set([services.config.tenant, ...services.panels.list().map((p) => p.tenant)])) {
        const incident = await services.incidentService.find(tenant, id);
        if (incident) {
          const evidence = await services.incidentService.evidence(tenant, incident.id);
          return json(uri.href, {
            ...incident,
            data: incident.data,
            evidence,
          });
        }
      }
      return json(uri.href, { error: "incident not found", id });
    },
  );

  services.logger.info("mcp resources registered");
}
