import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import type { Services } from "../../container.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import { matchGlob } from "../../shared/text.js";
import { incidentTenantCandidates, resolveRef, serverArg } from "./helpers.js";
import type { ServerRef } from "../../shared/types.js";

const editOperation = z.object({
  find: z.string().min(1).max(20_000),
  replace: z.string().max(50_000),
  replaceAll: z.boolean().optional(),
});

const remediationActionEnum = z.enum([
  "restart_server",
  "file_revert",
  "file_edit",
  "startup_variable_change",
  "restore_backup",
]);

export function remediationTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_propose_remediation",
      title: "Propose a remediation",
      description:
        "Builds a complete remediation plan WITHOUT executing anything: exact actions, risk level, rollback strategy (snapshot/patch/reverse operations), blast radius, dry-run summary, historical effectiveness and expiry. For MEDIUM+ risk a pending approval is created (ptero_approve_action). Always propose before executing; never apply a fix by hand while PteroOps can do it transactionally.",
      inputSchema: {
        server: serverArg,
        action: remediationActionEnum,
        reason: z.string().min(1).max(500).describe("Why this change is needed (recorded everywhere)."),
        incidentId: z.string().max(80).optional(),
        filePath: z.string().max(200).optional().describe("Required for file_edit and file_revert."),
        edits: z.array(editOperation).min(1).max(50).optional(),
        content: z.string().max(2_000_000).optional(),
        snapshotId: z.string().max(80).optional().describe("Specific snapshot for file_revert (default: latest)."),
        variableKey: z.string().max(64).optional(),
        variableValue: z.string().max(2000).optional(),
        backupUuid: z.string().max(80).optional().describe("Required for restore_backup."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      capabilities: { anyOf: ["client.server.read", "application.servers.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const action = String(args.action);
        const reason = String(args.reason);
        const incidentId = args.incidentId ? String(args.incidentId) : null;

        let plan;
        let preview: unknown = null;
        if (action === "restart_server") {
          plan = await services.planner.buildRestartPlan(ref, { reason, incidentId });
        } else if (action === "file_edit") {
          if (!args.filePath) throw new ValidationError("filePath is required for file_edit");
          const result = await services.planner.buildFileEditPlan(ref, {
            path: String(args.filePath),
            ...(args.edits
              ? { edits: args.edits as Array<{ find: string; replace: string; replaceAll?: boolean }> }
              : {}),
            ...(args.content !== undefined ? { content: String(args.content) } : {}),
            reason,
            incidentId,
          });
          plan = result.plan;
          preview = result.preview;
        } else if (action === "file_revert") {
          if (!args.filePath) throw new ValidationError("filePath is required for file_revert");
          plan = await services.planner.buildFileRevertPlan(ref, {
            path: String(args.filePath),
            reason,
            incidentId,
            ...(args.snapshotId ? { snapshotId: String(args.snapshotId) } : {}),
          });
        } else if (action === "startup_variable_change") {
          if (!args.variableKey || args.variableValue === undefined) {
            throw new ValidationError("variableKey and variableValue are required for startup_variable_change");
          }
          plan = await services.planner.buildStartupVariablePlan(ref, {
            key: String(args.variableKey),
            value: String(args.variableValue),
            reason,
            incidentId,
          });
        } else if (action === "restore_backup") {
          if (!args.backupUuid) throw new ValidationError("backupUuid is required for restore_backup");
          plan = await services.planner.buildRestoreBackupPlan(ref, {
            backupUuid: String(args.backupUuid),
            reason,
            incidentId,
          });
        } else {
          throw new ValidationError(`Unsupported action ${action}`);
        }

        const approval = await services.approvalService.propose({
          ref: plan.ref,
          plan,
          reason,
          proposedBy: ctx.actor,
        });
        if (!plan.requiresApproval) {
          await services.approvalService.approve(
            plan.ref.tenant,
            approval.id,
            "pteroops:auto-approval",
            "LOW/MEDIUM action allowed by policy",
          );
        }
        return {
          plan,
          approval: {
            id: approval.id,
            state: plan.requiresApproval ? "proposed" : "approved",
            risk: plan.risk,
            expiresAt: approval.expiresAt,
          },
          requiresApproval: plan.requiresApproval,
          preview,
          next:
            plan.requiresApproval
              ? "review the dry-run summary, confirm with the operator, then ptero_approve_action and ptero_execute_remediation"
              : "auto-approved by policy: ptero_execute_remediation with this approvalId (or dryRun=true first)",
        };
      },
    },
    {
      name: "ptero_approve_action",
      title: "Approve or reject a proposal",
      description:
        "Decision on a pending remediation proposal. Approving is an operator action: only approve after an explicit confirmation from the human operator. Deny-listed actions cannot be approved at all. Decisions are audited and expire automatically.",
      inputSchema: {
        approvalId: z.string().min(1),
        decision: z.enum(["approve", "reject"]),
        note: z.string().max(500).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const approvalId = String(args.approvalId);
        const tenant = await findApprovalTenant(services, approvalId);
        if (args.decision === "approve") {
          const record = await services.approvalService.approve(
            tenant,
            approvalId,
            ctx.actor,
            args.note ? String(args.note) : undefined,
          );
          return { approval: compactApproval(record), next: "execute with ptero_execute_remediation" };
        }
        const record = await services.approvalService.reject(
          tenant,
          approvalId,
          ctx.actor,
          args.note ? String(args.note) : undefined,
        );
        return { approval: compactApproval(record) };
      },
    },
    {
      name: "ptero_execute_remediation",
      title: "Execute an approved remediation",
      description:
        "Executes a remediation as a transaction: policy/approval gate -> baseline health -> optional preflight backup -> actions (file edits verify by re-read) -> restart if required -> health wait + stabilization window -> post-change tests -> success, or AUTOMATIC ROLLBACK when health gets worse. dryRun=true executes nothing and returns the exact operation list. Reports every step and both health states.",
      inputSchema: {
        approvalId: z.string().min(1).describe("Approval created by ptero_propose_remediation."),
        dryRun: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const approvalId = String(args.approvalId);
        const tenant = await findApprovalTenant(services, approvalId);
        const approval =
          args.dryRun === true
            ? await services.approvalService.find(tenant, approvalId)
            : await services.approvalService.assertUsable(tenant, approvalId);
        if (!approval) {
          throw new NotFoundError(`Approval ${approvalId} not found`);
        }
        const report = await services.executor.execute({
          plan: approval.plan,
          actor: ctx.actor,
          dryRun: args.dryRun === true,
          approvalId,
          signal: ctx.signal,
        });
        return report;
      },
    },
    {
      name: "ptero_rollback_remediation",
      title: "Roll back a remediation",
      description:
        "Executes the declared rollback strategy of a remediation (reverse patch, snapshot restore, startup variable restore). Also used to undo a successful remediation manually. Reports which steps succeeded; a rollback that cannot complete (e.g. backup restore) is reported honestly rather than faked.",
      inputSchema: {
        remediationId: z.string().min(1),
        reason: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const remediationId = String(args.remediationId);
        const tenant = await findRemediationTenant(services, remediationId);
        return services.executor.rollbackRemediation(tenant, remediationId, ctx.actor);
      },
    },
    {
      name: "ptero_simulate_remediation",
      title: "Simulate a remediation plan",
      description:
        "Logical pre-flight for a proposal: patch applicability and hash freshness, port/allocation conflicts, policy blocks, restart/load implications and blast radius. NOT a guarantee of success - it catches the conflicts that are visible before execution.",
      inputSchema: {
        approvalId: z.string().min(1),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const approvalId = String(args.approvalId);
        const tenant = await findApprovalTenant(services, approvalId);
        const approval = await services.approvalService.get(tenant, approvalId);
        return services.simulator.simulate(approval.plan.ref, approval.plan);
      },
    },
    {
      name: "ptero_canary_remediate",
      title: "Canary remediation across a group",
      description:
        "Applies an approved remediation to ONE canary server first, verifies health and stabilization, and only then creates approval proposals for the remaining group members (each still needs approval). Use for fleet-wide changes instead of mass-applying everywhere at once. The canary plan itself must be approved before this call.",
      inputSchema: {
        server: serverArg.describe("The canary server (must be a member of the group)."),
        group: z.string().min(1),
        approvalId: z.string().min(1).describe("Approved plan for the canary server."),
        action: z.enum(["restart_server", "file_edit", "file_revert", "startup_variable_change"]),
        reason: z.string().min(1).max(500),
        filePath: z.string().max(200).optional(),
        edits: z.array(editOperation).min(1).max(50).optional(),
        content: z.string().max(2_000_000).optional(),
        variableKey: z.string().max(64).optional(),
        variableValue: z.string().max(2000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const canaryRef = resolveRef(services, String(args.server));
        const groupName = String(args.group);
        const patterns = services.config.groups[groupName];
        if (!patterns) {
          throw new ValidationError(`unknown group "${groupName}"`, {
            hint: `configured groups: ${Object.keys(services.config.groups).join(", ") || "none"}`,
          });
        }
        const members: ServerRef[] = [];
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
        const others = members.filter(
          (member) => !(member.panel === canaryRef.panel && member.serverId === canaryRef.serverId),
        );
        if (others.length === 0) {
          throw new ValidationError(`group "${groupName}" has no other members besides the canary`);
        }
        const approvalId = String(args.approvalId);
        const tenant = await findApprovalTenant(services, approvalId);
        const approval = await services.approvalService.assertUsable(tenant, approvalId);
        if (approval.plan.ref.panel !== canaryRef.panel || approval.plan.ref.serverId !== canaryRef.serverId) {
          throw new ValidationError(
            `approval ${approvalId} was created for ${approval.plan.ref.panel}/${approval.plan.ref.serverId}, not for the canary ${canaryRef.panel}/${canaryRef.serverId}`,
          );
        }

        const buildAction = String(args.action);
        return services.canary.run({
          canaryPlan: approval.plan,
          approvalId,
          actor: ctx.actor,
          signal: ctx.signal,
          memberPlans: others.map((member) => ({
            ref: member,
            build: async () => {
              if (buildAction === "restart_server") {
                return services.planner.buildRestartPlan(member, {
                  reason: String(args.reason),
                });
              }
              if (buildAction === "file_edit") {
                if (!args.filePath) throw new ValidationError("filePath is required for file_edit");
                const result = await services.planner.buildFileEditPlan(member, {
                  path: String(args.filePath),
                  ...(args.edits
                    ? { edits: args.edits as Array<{ find: string; replace: string; replaceAll?: boolean }> }
                    : {}),
                  ...(args.content !== undefined ? { content: String(args.content) } : {}),
                  reason: String(args.reason),
                });
                return result.plan;
              }
              if (buildAction === "file_revert") {
                if (!args.filePath) throw new ValidationError("filePath is required for file_revert");
                return services.planner.buildFileRevertPlan(member, {
                  path: String(args.filePath),
                  reason: String(args.reason),
                });
              }
              if (buildAction === "startup_variable_change") {
                if (!args.variableKey || args.variableValue === undefined) {
                  throw new ValidationError("variableKey and variableValue are required");
                }
                return services.planner.buildStartupVariablePlan(member, {
                  key: String(args.variableKey),
                  value: String(args.variableValue),
                  reason: String(args.reason),
                });
              }
              throw new ValidationError(`Unsupported canary action ${buildAction}`);
            },
          })),
        });
      },
    },
    {
      name: "ptero_run_tests",
      title: "Run verification tests",
      description:
        "Runs the application-profile test suite for a server: crash-loop state, application detection, health, error rate in the console window and (for post/smoke) presence of the application's ready marker. Use suite=pre before a change and suite=post after it; PteroOps itself runs post tests inside remediation transactions.",
      inputSchema: {
        server: serverArg,
        suite: z.enum(["pre", "post", "smoke"]).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { anyOf: ["client.server.read", "application.servers.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        return services.testEngine.run(ref, (args.suite as "pre" | "post" | "smoke" | undefined) ?? "smoke");
      },
    },
    {
      name: "ptero_remediation_stats",
      title: "Remediation effectiveness history",
      description:
        "Explainable operational statistics per remediation action type: attempts, successes, failures, rollbacks and success rate over the last N days. Use it to inform proposals; it is not a black-box model.",
      inputSchema: {
        sinceDays: z.number().int().min(1).max(365).optional(),
        action: z.string().max(64).optional(),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const stats = await services.effectiveness.stats({
          ...(args.sinceDays !== undefined ? { sinceDays: Number(args.sinceDays) } : {}),
          tenant: services.panels.default().tenant,
        });
        const filtered = args.action
          ? stats.filter((entry) => entry.action === String(args.action))
          : stats;
        const remediations = await services.remediationRepository.list({
          tenant: services.panels.default().tenant,
          limit: 20,
        });
        return {
          stats: filtered,
          recent: remediations.map((record) => ({
            id: record.id,
            server: `${record.ref.panel}/${record.ref.serverId}`,
            state: record.state,
            risk: record.risk,
            startedAt: record.startedAt,
            summary: record.result?.summary ?? null,
          })),
        };
      },
    },
  ];
}

async function findApprovalTenant(services: Services, approvalId: string): Promise<string> {
  for (const tenant of incidentTenantCandidates(services)) {
    if (await services.approvalService.find(tenant, approvalId)) return tenant;
  }
  throw new NotFoundError(`Approval ${approvalId} not found`, {
    hint: "Create a proposal first with ptero_propose_remediation.",
  });
}

async function findRemediationTenant(services: Services, remediationId: string): Promise<string> {
  for (const tenant of incidentTenantCandidates(services)) {
    if (await services.remediationRepository.get(tenant, remediationId)) return tenant;
  }
  throw new NotFoundError(`Remediation ${remediationId} not found`);
}

function compactApproval(record: {
  id: string;
  state: string;
  risk: string;
  plan: { id: string; dryRunSummary: string[]; rollbackStrategy: string };
  expiresAt: number | null;
  decidedBy: string | null;
}): Record<string, unknown> {
  return {
    id: record.id,
    state: record.state,
    risk: record.risk,
    planId: record.plan.id,
    expiresAt: record.expiresAt,
    decidedBy: record.decidedBy,
    dryRunSummary: record.plan.dryRunSummary,
    rollbackStrategy: record.plan.rollbackStrategy,
  };
}
