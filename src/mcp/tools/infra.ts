import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { matchGlob } from "../../shared/text.js";
import { parseTimeArgument } from "../../shared/time.js";
import { resolveRef, serverArg } from "./helpers.js";

function toCsv(headers: string[], rows: string[][]): string {
  const cell = (value: string): string =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [headers.join(","), ...rows.map((row) => row.map(cell).join(","))].join("\n");
}

export function infrastructureTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_get_topology",
      title: "Get infrastructure topology",
      description:
        "Returns the infrastructure graph: panels, nodes, servers, allocations, databases, applications and git repositories with their relationships (hosts, uses_database, proxies_to, deploys_from). Rebuilds the graph from the panels when stale. Use focus/depth to explore around one node. Read-only.",
      inputSchema: {
        focus: z.string().max(200).optional().describe('Node reference like "server:panel/serverId" or "node:panel/name".'),
        depth: z.number().int().min(1).max(4).optional(),
        rebuild: z.boolean().optional(),
        kind: z.string().max(32).optional(),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const fresh = await services.topology.graph();
        if (args.rebuild === true || fresh.nodes.length === 0) {
          await services.topology.rebuild();
        }
        const graph = await services.topology.graph();
        if (args.focus) {
          const neighbors = await services.topology.neighbors(String(args.focus), Number(args.depth ?? 1));
          return {
            focus: String(args.focus),
            depth: Number(args.depth ?? 1),
            nodes: neighbors.nodes,
            edges: neighbors.edges,
          };
        }
        const nodes = args.kind
          ? graph.nodes.filter((node) => node.kind === String(args.kind))
          : graph.nodes;
        return {
          updatedAt: graph.updatedAt,
          nodeCount: nodes.length,
          edgeCount: graph.edges.length,
          nodes: nodes.slice(0, 500),
          edges: graph.edges.slice(0, 1000),
          hint: "use focus=<nodeId> to see a neighborhood",
        };
      },
    },
    {
      name: "ptero_network_diagnose",
      title: "Diagnose server networking",
      description:
        "Scoped network diagnosis: allocations and primary port, profile expected port vs allocation, server.properties port match, console bind failures, and (when probing is enabled) TCP/HTTP reachability of allocation addresses. Never scans arbitrary hosts: targets come from the server's own allocations or policy.networkProbeTargets. Read-only.",
      inputSchema: {
        server: serverArg,
        checks: z.array(z.string()).max(10).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { anyOf: ["client.server.read", "application.servers.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        return services.network.diagnose(ref, {
          ...(args.checks ? { checks: args.checks as string[] } : {}),
        });
      },
    },
    {
      name: "ptero_investigate_incident",
      title: "Investigate a multi-server incident",
      description:
        "Correlates failures across servers: resolves the scope (server, node, panel, group or all), assesses each server's health and crash state, aligns timelines, checks shared nodes and databases, and produces one correlated parent incident with the least-destructive recommendation when a shared failure domain is found. Use this INSTEAD of restarting servers one by one when several fail together. Read-only except for incident records.",
      inputSchema: {
        server: z.string().optional(),
        node: z.string().max(120).optional().describe("Node name to scope (from ptero_admin_list_nodes or topology)."),
        panel: z.string().max(64).optional(),
        group: z.string().max(64).optional().describe("Configured server group name."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const scope = {
          ...(args.server ? { server: String(args.server) } : {}),
          ...(args.node ? { node: String(args.node) } : {}),
          ...(args.panel ? { panel: String(args.panel) } : {}),
          ...(args.group ? { group: String(args.group) } : {}),
        };
        if (Object.keys(scope).length === 0) {
          scope.panel = services.defaultPanel;
        }
        return services.correlator.investigate(scope, services.config.groups);
      },
    },
    {
      name: "ptero_compare_known_good",
      title: "Compare against the last known-good state",
      description:
        "Diff of the current server state versus the last recorded known-good state: config file hashes, startup variables, dependency manifests, git revision, application and health score. If no known-good state exists yet it is captured now (when the server is healthy enough). Read-only.",
      inputSchema: { server: serverArg, capture: z.boolean().optional() },
      annotations: { readOnlyHint: true },
      capabilities: { anyOf: ["client.server.read", "application.servers.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        if (args.capture === true) {
          const captured = await services.knownGood.capture(ref, { force: true });
          return { captured: captured !== null, record: captured };
        }
        const comparison = await services.knownGood.compare(ref);
        if (!comparison) {
          return { server: `${ref.panel}/${ref.serverId}`, summary: "known-good state unavailable" };
        }
        return { server: `${ref.panel}/${ref.serverId}`, ...comparison };
      },
    },
    {
      name: "ptero_compare_server_group",
      title: "Compare configuration across a server group",
      description:
        "Detects configuration drift inside a configured server group (config.groups): compares config file hashes and startup variables across members, shows meaningful unified diffs for outliers, and highlights which server diverges. Read-only.",
      inputSchema: {
        group: z.string().min(1).describe("Group name from the configuration."),
        files: z.array(z.string()).max(20).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.files.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const groupName = String(args.group);
        const patterns = services.config.groups[groupName];
        if (!patterns) {
          return {
            error: `unknown group "${groupName}"`,
            configuredGroups: Object.keys(services.config.groups),
          };
        }
        const members = [];
        const tenants = new Set(services.panels.list().map((panel) => panel.tenant));
        for (const tenant of tenants) {
          for (const cached of await services.serverCache.list(tenant)) {
            const targets = [
              `${cached.ref.panel}/${cached.ref.serverId}`,
              `${cached.ref.tenant}/${cached.ref.panel}/${cached.ref.serverId}`,
            ];
            if (patterns.some((pattern) => targets.some((target) => matchGlob(pattern, target)))) {
              members.push(cached.ref);
            }
          }
        }
        if (members.length === 0) {
          return {
            group: groupName,
            members: [],
            summary: "no cached servers match this group yet; run ptero_list_servers first",
          };
        }
        return services.drift.compareGroup(groupName, members);
      },
    },
    {
      name: "ptero_query_audit",
      title: "Query the audit trail",
      description:
        "Append-only audit trail of every tool invocation: actor, tool, target, decision, approval, success/failure, correlation id. Use for compliance and incident forensics. Secrets are redacted. Read-only.",
      inputSchema: {
        tool: z.string().max(64).optional(),
        actor: z.string().max(120).optional(),
        success: z.boolean().optional(),
        correlationId: z.string().max(64).optional(),
        since: z.string().max(64).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const events = await services.auditRepository.list({
          tenant: services.panels.default().tenant,
          ...(args.tool ? { tool: String(args.tool) } : {}),
          ...(args.actor ? { actor: String(args.actor) } : {}),
          ...(args.success !== undefined ? { success: args.success === true } : {}),
          ...(args.correlationId ? { correlationId: String(args.correlationId) } : {}),
          ...(args.since ? { since: parseTimeArgument(String(args.since)) } : {}),
          limit: Number(args.limit ?? 100),
        });
        return { events, total: events.length };
      },
    },
    {
      name: "ptero_export_audit",
      title: "Export the audit trail",
      description:
        "Exports audit events (compliance / forensics) as JSON or CSV within a time range, with optional tool/actor filters. Bounded to 100k rows per call; secrets are redacted. Use the retention preset 'compliance' to keep audit records forever. Read-only.",
      inputSchema: {
        format: z.enum(["json", "csv"]).optional(),
        since: z.string().max(64).optional().describe('Start time (ISO, epoch ms, or relative like -30d).'),
        until: z.string().max(64).optional(),
        tool: z.string().max(64).optional(),
        actor: z.string().max(120).optional(),
        limit: z.number().int().min(1).max(100_000).optional(),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const now = Date.now();
        const since = args.since !== undefined ? parseTimeArgument(String(args.since), now) : now - 30 * 86_400_000;
        const until = args.until !== undefined ? parseTimeArgument(String(args.until), now) : now;
        const tenant = services.panels.default().tenant;
        const events = await services.auditRepository.allForExport(
          tenant,
          since,
          until,
          Number(args.limit ?? 10_000),
        );
        const filtered = events.filter(
          (event) =>
            (!args.tool || event.tool === String(args.tool)) &&
            (!args.actor || event.actor === String(args.actor)),
        );
        if (args.format === "csv") {
          return {
            format: "csv",
            rows: filtered.length,
            csv: toCsv(
              ["id", "ts", "actor", "tool", "target", "action", "decision", "success", "approvalId", "correlationId", "errorCode"],
              filtered.map((event) => [
                event.id,
                new Date(event.ts).toISOString(),
                event.actor,
                event.tool,
                event.target ?? "",
                event.action,
                event.decision,
                event.success ? "true" : "false",
                event.approvalId ?? "",
                event.correlationId ?? "",
                event.error?.code ?? "",
              ]),
            ),
          };
        }
        return {
          format: "json",
          rows: filtered.length,
          window: { since: new Date(since).toISOString(), until: new Date(until).toISOString() },
          events: filtered,
        };
      },
    },
    {
      name: "ptero_list_scheduler_jobs",
      title: "List PteroOps scheduled jobs",
      description:
        "Lists PteroOps-internal scheduled diagnostics (config.schedules): kind, scope, interval, last/next run and last result. These are PteroOps jobs, not Pterodactyl cron schedules (for those use ptero_list_schedules). Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      handler: async (_args, ctx) => {
        return { schedules: ctx.services.scheduler.list() };
      },
    },
    {
      name: "ptero_run_scheduler_job",
      title: "Run a scheduled job now",
      description:
        "Triggers one PteroOps scheduled job immediately (health scan, dependency audit, backup check, anomaly scan, retention prune, diagnose scope) and returns its result. Deterministic analysis only; audited.",
      inputSchema: {
        name: z.string().min(1).describe("Schedule name or id from ptero_list_scheduler_jobs."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async (args, ctx) => {
        return ctx.services.scheduler.runNow(String(args.name));
      },
    },
  ];
}
