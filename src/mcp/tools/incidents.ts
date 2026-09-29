import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { NotFoundError } from "../../shared/errors.js";
import { parseDuration, parseTimeArgument } from "../../shared/time.js";
import type { IncidentState } from "../../shared/types.js";
import type { Incident } from "../../persistence/models.js";
import { incidentTenantCandidates, requirePanel, resolveRef, serverArg } from "./helpers.js";

const incidentStateEnum = z.enum([
  "detected",
  "investigating",
  "diagnosed",
  "awaiting_approval",
  "remediating",
  "verifying",
  "resolved",
  "rolled_back",
  "failed",
  "suppressed",
]);

const incidentSeverityEnum = z.enum(["low", "medium", "high", "critical"]);

export function incidentTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_list_incidents",
      title: "List incidents",
      description:
        "Lists incidents with optional state/severity/server/time filters (open incidents by default). Incidents persist across restarts and are deduplicated by fingerprint. Read-only.",
      inputSchema: {
        state: incidentStateEnum.optional(),
        states: z.array(incidentStateEnum).optional(),
        severity: incidentSeverityEnum.optional(),
        server: z.string().optional(),
        open: z.boolean().optional().describe("Only non-final incidents (default true)."),
        since: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const filter: Parameters<typeof services.incidentRepository.list>[0] = {
          ...(args.open !== false ? { openOnly: true } : {}),
          ...(args.severity ? { severity: args.severity as "low" | "medium" | "high" | "critical" } : {}),
          ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
        };
        if (args.states) {
          filter.states = args.states as IncidentState[];
          delete filter.openOnly;
        } else if (args.state) {
          filter.states = [args.state as IncidentState];
          delete filter.openOnly;
        }
        if (args.server) {
          const ref = resolveRef(services, String(args.server));
          filter.tenant = ref.tenant;
          filter.panel = ref.panel;
          filter.serverId = ref.serverId;
        }
        if (args.since) {
          filter.since = parseTimeArgument(String(args.since));
        }
        const incidents = await services.incidentRepository.list(filter);
        return {
          incidents: incidents.map((incident) => compactIncident(incident)),
          total: incidents.length,
          note: "Use ptero_get_incident for full evidence and timeline.",
        };
      },
    },
    {
      name: "ptero_get_incident",
      title: "Get incident details",
      description:
        "Full incident document: symptoms, evidence, probable causes with confidence, related changes, remediation attempts and verification results. Read-only.",
      inputSchema: {
        id: z.string().min(1),
        includeEvidence: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const incident = await findIncident(services, String(args.id));
        const evidence =
          args.includeEvidence === false
            ? []
            : await services.incidentService.evidence(incident.ref.tenant, incident.id);
        const changes = await services.changeLedger.byIncident(incident.id, {
          tenant: incident.ref.tenant,
          limit: 50,
        });
        return {
          incident: fullIncident(incident),
          evidence,
          relatedChanges: changes.map((change) => ({
            id: change.id,
            ts: change.ts,
            action: change.action,
            target: change.target,
            actor: change.actor,
            result: change.result,
            beforeHash: change.beforeHash,
            afterHash: change.afterHash,
          })),
        };
      },
    },
    {
      name: "ptero_update_incident",
      title: "Update incident state or notes",
      description:
        "Transitions an incident state (investigating, diagnosed, suppressed, resolved, …) and/or appends a note. Does not touch servers or start remediation. Audited.",
      inputSchema: {
        id: z.string().min(1),
        state: incidentStateEnum.optional(),
        note: z.string().max(1000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const incident = await findIncident(services, String(args.id));
        let updated = incident;
        if (args.note) {
          await services.incidentService.addNote(incident, ctx.actor, String(args.note));
          updated = await services.incidentService.get(incident.ref.tenant, incident.id);
        }
        if (args.state) {
          updated = await services.incidentService.transition(
            incident.ref.tenant,
            incident.id,
            args.state as IncidentState,
            { actor: ctx.actor },
          );
        }
        return { incident: compactIncident(updated) };
      },
    },
    {
      name: "ptero_get_change_history",
      title: "Query the change ledger",
      description:
        "Every mutation recorded by PteroOps (commands, power actions, file writes, remediations): who/what/when with before/after hashes. Use 'around' to answer 'what changed right before the failure?'. Read-only.",
      inputSchema: {
        server: z.string().optional(),
        around: z.string().optional().describe("Center time (ISO, epoch ms, or -30m)."),
        window: z.string().optional().describe('Half-window around the center time (default "15m").'),
        incidentId: z.string().optional(),
        since: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const limit = Number(args.limit ?? 50);
        if (args.incidentId) {
          const changes = await services.changeLedger.byIncident(String(args.incidentId), { limit });
          return { changes: changes.map(changeWithServer), total: changes.length };
        }
        if (args.server) {
          const ref = resolveRef(services, String(args.server));
          if (args.around) {
            const center = parseTimeArgument(String(args.around));
            const windowMs = parseDuration(String(args.window ?? "15m"));
            const changes = await services.changeLedger.around(ref, center, windowMs);
            return {
              server: `${ref.panel}/${ref.serverId}`,
              around: new Date(center).toISOString(),
              windowMs,
              changes: changes.map(changeWithServer),
              hint:
                changes.length === 0
                  ? "No recorded changes in this window; changes made outside PteroOps are not visible."
                  : undefined,
            };
          }
          const changes = await services.changeLedger.recent(ref, {
            ...(args.since !== undefined
              ? { sinceMs: Date.now() - parseTimeArgument(String(args.since)) }
              : {}),
            limit,
          });
          return { server: `${ref.panel}/${ref.serverId}`, changes: changes.map(changeWithServer), total: changes.length };
        }
        const tenant = services.panels.default().tenant;
        const changes = await services.changeRepository.list({
          tenant,
          limit,
          ...(args.since !== undefined ? { since: parseTimeArgument(String(args.since)) } : {}),
        });
        return { changes: changes.map(changeWithServer), total: changes.length };
      },
    },
    {
      name: "ptero_diagnose",
      title: "Diagnose a server",
      description:
        "Runs the deterministic evidence pipeline: serve state, resources, application detection, log intelligence, crash-loop assessment, change correlation and operational memory, returning observed facts, probable causes with confidence, recommended actions with risk, missing evidence and an incident. Read-only (opens/updates an incident record only). Call this BEFORE proposing any remediation or restarting.",
      inputSchema: {
        server: serverArg,
        windowMinutes: z.number().int().min(1).max(1440).optional(),
        openIncident: z.boolean().optional().describe("Set false to inspect without opening an incident."),
        refresh: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { anyOf: ["client.server.read", "application.servers.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        requirePanel(services, ref, {
          anyOf: ["client.server.read", "application.servers.read"],
        });
        const diagnosis = await services.diagnostics.diagnose(ref, {
          ...(args.windowMinutes !== undefined ? { windowMinutes: Number(args.windowMinutes) } : {}),
          ...(args.openIncident !== undefined ? { openIncident: args.openIncident === true || args.openIncident === undefined } : {}),
          ...(args.refresh === true ? { bypassCache: true } : {}),
        });
        return diagnosis;
      },
    },
  ];
}

async function findIncident(services: Parameters<typeof resolveRef>[0], id: string): Promise<Incident> {
  for (const tenant of incidentTenantCandidates(services)) {
    const incident = await services.incidentService.find(tenant, id);
    if (incident) return incident;
  }
  throw new NotFoundError(`Incident ${id} not found`, {
    hint: "Use ptero_list_incidents to find valid incident ids.",
  });
}

function compactIncident(incident: Incident): Record<string, unknown> {
  return {
    id: incident.id,
    server: `${incident.ref.panel}/${incident.ref.serverId}`,
    tenant: incident.ref.tenant,
    title: incident.title,
    summary: incident.summary,
    severity: incident.severity,
    state: incident.state,
    application: incident.application,
    fingerprint: incident.fingerprint,
    confidence: incident.confidence,
    detectedAt: incident.detectedAt,
    updatedAt: incident.updatedAt,
    resolvedAt: incident.resolvedAt,
    parentId: incident.parentId,
  };
}

function fullIncident(incident: Incident): Record<string, unknown> {
  return {
    ...compactIncident(incident),
    symptoms: incident.data.symptoms,
    probableCauses: incident.data.probableCauses,
    remediationAttempts: incident.data.remediationAttempts,
    verifications: incident.data.verifications,
    notes: incident.data.notes ?? [],
    tags: incident.data.tags ?? [],
  };
}

function changeWithServer(change: {
  ref: { panel: string; serverId: string };
  id: string;
  ts: number;
  actor: string;
  origin: string;
  action: string;
  target: string;
  beforeHash: string | null;
  afterHash: string | null;
  incidentId: string | null;
  reason: string | null;
  result: string;
  risk: string | null;
}): Record<string, unknown> {
  return {
    id: change.id,
    server: `${change.ref.panel}/${change.ref.serverId}`,
    ts: change.ts,
    actor: change.actor,
    origin: change.origin,
    action: change.action,
    target: change.target,
    beforeHash: change.beforeHash,
    afterHash: change.afterHash,
    incidentId: change.incidentId,
    reason: change.reason,
    risk: change.risk,
    result: change.result,
  };
}
