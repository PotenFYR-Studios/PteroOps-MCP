import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import type { ToolRegistry } from "../registry.js";
import { credentialModes, keyKindWarning } from "../../security/capabilities.js";
import {
  boundedList,
  policySnapshot,
  redactVariables,
  requirePanel,
  resolveRef,
  serverArg,
} from "./helpers.js";

export function serverTools(registry: ToolRegistry): ToolDefinition[] {
  return [
    {
      name: "ptero_get_capabilities",
      title: "Get PteroOps capabilities",
      description:
        "Reports configured panels, which API-key modes are active (client/application), which capabilities and tools are available, and a summary of the active policy. Call this FIRST before using other tools; if a capability or panel is missing, no amount of retrying will make the tool work.",
      inputSchema: {
        panel: z.string().optional().describe("Restrict the report to one configured panel."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const panels = args.panel
          ? [services.panels.get(String(args.panel))]
          : services.panels.list();
        const registeredTools = registry.registeredInfo().map((tool) => tool.name);
        return {
          defaultPanel: services.defaultPanel,
          panels: panels.map((panel) => ({
            name: panel.name,
            tenant: panel.tenant,
            url: panel.url,
            modes: credentialModes(panel.credentials),
            warnings: keyKindWarning(panel.credentials),
            capabilities: [...panel.capabilities].sort(),
            hasClientApi: panel.clientApi !== null,
            hasApplicationApi: panel.applicationApi !== null,
          })),
          registeredTools,
          policy: policySnapshot(services),
        };
      },
    },
    {
      name: "ptero_list_servers",
      title: "List Pterodactyl servers",
      description:
        "Lists servers visible across configured panels with identity (tenant/panel/serverId), name, state and last detected application. Read-only; use before any per-server operation.",
      inputSchema: {
        panel: z.string().optional().describe("Restrict to one panel."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum servers to return (default 200)."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const panels = args.panel
          ? [services.panels.get(String(args.panel))]
          : services.panels.list();
        const limit = Number(args.limit ?? 200);
        const rows: Array<Record<string, unknown>> = [];
        for (const panel of panels) {
          if (panel.clientApi && panel.capabilities.has("client.server.read")) {
            const servers = await panel.clientApi.allServers({ tenant: panel.tenant, panel: panel.name });
            for (const server of servers) {
              const cached = await services.serverCache.get(server.ref);
              rows.push({
                server: `${panel.name}/${server.ref.serverId}`,
                tenant: panel.tenant,
                name: server.name,
                uuid: server.uuid ?? null,
                state: server.state,
                suspended: server.suspended,
                application: cached?.application ?? null,
                memoryMb: server.limits.memoryMb,
                diskMb: server.limits.diskMb,
              });
            }
          } else if (panel.applicationApi && panel.capabilities.has("application.servers.read")) {
            const servers = await panel.applicationApi.allServers({ tenant: panel.tenant, panel: panel.name });
            for (const server of servers) {
              const cached = await services.serverCache.get(server.ref);
              rows.push({
                server: `${panel.name}/${server.ref.serverId}`,
                tenant: panel.tenant,
                name: server.name,
                uuid: server.uuid ?? null,
                state: server.state,
                application: cached?.application ?? null,
                source: "application-api",
              });
            }
          }
        }
        const bounded = boundedList(rows, limit);
        return {
          servers: bounded.items,
          total: rows.length,
          truncated: bounded.truncated,
        };
      },
    },
    {
      name: "ptero_get_server",
      title: "Get server details",
      description:
        "Full metadata for one server: limits, allocations, owner, docker image/startup basics. Read-only. Use ptero_get_health for operational status and ptero_get_startup for variables.",
      inputSchema: {
        server: serverArg,
        includeAllocations: z.boolean().optional(),
        includeVariables: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, {
          anyOf: ["client.server.read", "application.servers.read"],
        });
        const includeAllocations = args.includeAllocations !== false;
        const includeVariables = args.includeVariables === true;
        if (panel.clientApi && panel.capabilities.has("client.server.read")) {
          const detail = await panel.clientApi.getServer(ref, {
            includeAllocations,
            includeVariables,
          });
          const startup = includeVariables
            ? await panel.clientApi.getStartup(ref).catch(() => null)
            : null;
          return {
            server: `${ref.panel}/${ref.serverId}`,
            tenant: ref.tenant,
            ...detail,
            ...(startup
              ? {
                  startupCommand: startup.startupCommand,
                  dockerImage: startup.dockerImage,
                  variables: redactVariables(startup.variables),
                }
              : {}),
          };
        }
        const detail = await panel.applicationApi!.getServer(ref);
        return { server: `${ref.panel}/${ref.serverId}`, tenant: ref.tenant, ...detail };
      },
    },
    {
      name: "ptero_get_startup",
      title: "Get startup configuration",
      description:
        "Startup command, docker image and startup variables for a server. Values that look like secrets are redacted. Read-only.",
      inputSchema: { server: serverArg },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.server.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.server.read"] });
        const startup = await panel.clientApi!.getStartup(ref);
        return {
          server: `${ref.panel}/${ref.serverId}`,
          startupCommand: startup.startupCommand,
          rawStartupCommand: startup.rawStartupCommand,
          dockerImage: startup.dockerImage,
          variables: redactVariables(startup.variables),
        };
      },
    },
    {
      name: "ptero_get_metrics",
      title: "Get server metrics",
      description:
        "Latest resource sample plus recent history and simple statistics (avg/max, disk growth estimate). Read-only. For a health verdict use ptero_get_health instead of interpreting numbers yourself.",
      inputSchema: {
        server: serverArg,
        windowMinutes: z.number().int().min(1).max(1440).optional(),
        series: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { anyOf: ["client.server.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.server.read"] });
        const windowMinutes = Number(args.windowMinutes ?? 60);
        const now = Date.now();
        const since = now - windowMinutes * 60_000;
        let latest = await services.metricSampleRepository.latest(ref);
        let latestIsLive = false;
        try {
          const resources = await panel.clientApi!.getResources(ref);
          latestIsLive = true;
          latest = {
            id: -1,
            ref,
            ts: now,
            state: resources.state,
            cpuPercent: resources.cpuAbsolute,
            memoryBytes: resources.memoryBytes,
            memoryLimitBytes: resources.memoryLimitBytes,
            diskBytes: resources.diskBytes,
            diskLimitBytes: resources.diskLimitBytes,
            netRxBytes: resources.networkRxBytes,
            netTxBytes: resources.networkTxBytes,
            uptimeMs: resources.uptimeMs,
          };
        } catch (error) {
          ctx.services.logger.debug("live resource fetch failed; using stored samples", {
            error: (error as Error).message,
          });
        }
        const samples = await services.metricSampleRepository.range(ref, since, now, 500);
        const stats = computeStats(samples);
        return {
          server: `${ref.panel}/${ref.serverId}`,
          latest: latest
            ? {
                ts: latest.ts,
                live: latestIsLive,
                state: latest.state,
                cpuPercent: round(latest.cpuPercent),
                memoryBytes: latest.memoryBytes,
                memoryLimitBytes: latest.memoryLimitBytes,
                memoryPercent:
                  latest.memoryLimitBytes > 0
                    ? round((latest.memoryBytes / latest.memoryLimitBytes) * 100)
                    : null,
                diskBytes: latest.diskBytes,
                diskLimitBytes: latest.diskLimitBytes,
                diskPercent:
                  latest.diskLimitBytes > 0
                    ? round((latest.diskBytes / latest.diskLimitBytes) * 100)
                    : null,
                uptimeMs: latest.uptimeMs,
              }
            : null,
          windowMinutes,
          sampleCount: samples.length,
          stats,
          ...(args.series
            ? {
                series: samples.slice(-120).map((sample) => ({
                  ts: sample.ts,
                  state: sample.state,
                  cpu: round(sample.cpuPercent),
                  memMB: Math.round(sample.memoryBytes / 1024 / 1024),
                  diskMB: Math.round(sample.diskBytes / 1024 / 1024),
                })),
              }
            : {}),
          note: latestIsLive ? undefined : "live fetch unavailable; values come from stored samples",
        };
      },
    },
    {
      name: "ptero_get_health",
      title: "Get server health",
      description:
        "Computes application health (healthy/degraded/unhealthy/crash_loop/starting/unknown) from process state, resources, error rate, restart frequency and readiness markers, with per-check details and evidence. Use this instead of interpreting raw state; 'running' does not mean healthy. Read-only.",
      inputSchema: {
        server: serverArg,
        refresh: z.boolean().optional().describe("Bypass cached application signals."),
      },
      annotations: { readOnlyHint: true },
      capabilities: { anyOf: ["client.server.read", "application.servers.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const assessment = await services.health.assess(ref, { refresh: args.refresh === true });
        return { server: `${ref.panel}/${ref.serverId}`, ...assessment };
      },
    },
    {
      name: "ptero_run_health_check",
      title: "Run a fresh health check",
      description:
        "Forces a fresh health assessment including application readiness signals, without trusting any cache. Read-only; may take a few seconds because it inspects files/console.",
      inputSchema: { server: serverArg },
      annotations: { readOnlyHint: true },
      capabilities: { anyOf: ["client.server.read", "application.servers.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        services.signalCollector.invalidate(ref);
        const assessment = await services.health.assess(ref, { refresh: true });
        return { server: `${ref.panel}/${ref.serverId}`, ...assessment };
      },
    },
  ];
}

function computeStats(
  samples: Array<{
    cpuPercent: number;
    memoryBytes: number;
    diskBytes: number;
    ts: number;
  }>,
): Record<string, unknown> | null {
  if (samples.length === 0) return null;
  const cpu = samples.map((sample) => sample.cpuPercent);
  const memory = samples.map((sample) => sample.memoryBytes);
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const spanMs = last.ts - first.ts;
  const diskGrowthBytesPerHour =
    spanMs >= 60_000
      ? Math.round(((last.diskBytes - first.diskBytes) / spanMs) * 3_600_000)
      : null;
  return {
    cpuAvg: round(cpu.reduce((sum, value) => sum + value, 0) / cpu.length),
    cpuMax: round(Math.max(...cpu)),
    memoryAvgMB: Math.round(memory.reduce((sum, value) => sum + value, 0) / memory.length / 1024 / 1024),
    memoryMaxMB: Math.round(Math.max(...memory) / 1024 / 1024),
    diskGrowthBytesPerHour,
    diskGrowthNote:
      diskGrowthBytesPerHour !== null && diskGrowthBytesPerHour > 0
        ? "estimate based on stored samples; project exhaustion from the current disk allocation"
        : undefined,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
