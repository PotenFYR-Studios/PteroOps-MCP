import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { classifyRisk, RISK_ACTIONS } from "../../security/risk.js";
import { policySnapshot, resolveRef } from "./helpers.js";

export function riskTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_get_risk",
      title: "Classify action risk",
      description:
        "Classifies a proposed action's risk (LOW/MEDIUM/HIGH/CRITICAL), explains why, and reports whether policy requires approval or denies it outright. Use BEFORE proposing a remediation or mutation, and never automate HIGH/CRITICAL without explicit approval. Read-only.",
      inputSchema: {
        action: z
          .string()
          .min(1)
          .describe("Action key, e.g. restart_server, file_write, restore_backup, kill_server, delete_server."),
        server: z.string().optional(),
        protectedPath: z.boolean().optional(),
        sizeBytes: z.number().int().min(0).optional(),
        approved: z.boolean().optional().describe("Whether approval has been granted."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const action = String(args.action);
        const assessment = classifyRisk(action, {
          ...(args.protectedPath !== undefined ? { protectedPath: args.protectedPath === true } : {}),
          ...(args.sizeBytes !== undefined ? { sizeBytes: Number(args.sizeBytes) } : {}),
        });
        const requiresApproval = services.policyEngine.requiresApproval(action, assessment.level);
        const result: Record<string, unknown> = {
          action,
          known: assessment.known,
          risk: assessment.level,
          reasons: assessment.reasons,
          requiresApproval,
          deniedByPolicy: services.config.approval.deny.includes(action),
          autoApproved: services.config.approval.autoApprove.includes(action),
          knownActions: assessment.known ? undefined : Object.keys(RISK_ACTIONS),
        };
        if (args.server) {
          const ref = resolveRef(services, String(args.server));
          const decision = services.policyEngine.evaluateAction(ref, action, {
            automation: false,
            approved: args.approved === true,
            ...(args.protectedPath !== undefined ? { protectedPath: args.protectedPath === true } : {}),
            ...(args.sizeBytes !== undefined ? { sizeBytes: Number(args.sizeBytes) } : {}),
          });
          result.policyDecision = {
            allowed: decision.allowed,
            reason: decision.reason,
            policyId: decision.policyId,
            requiresApproval: decision.requiresApproval,
          };
          result.server = `${ref.panel}/${ref.serverId}`;
        }
        return result;
      },
    },
    {
      name: "ptero_get_policy",
      title: "Get effective policy",
      description:
        "Returns the active policy: allowed servers, protected paths, blocked/allowed command patterns, restart budgets, file-size caps, approval rules and maintenance windows. Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      handler: async (_args, ctx) => {
        return {
          policy: policySnapshot(ctx.services),
          approval: {
            autoApprove: ctx.services.config.approval.autoApprove,
            requireApproval: ctx.services.config.approval.requireApproval,
            deny: ctx.services.config.approval.deny,
          },
        };
      },
    },
  ];
}
