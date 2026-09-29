import type { ApprovalService } from "../approvals/service.js";
import type { Logger } from "../observability/logger.js";
import type { ServerRef } from "../shared/types.js";
import type { RemediationExecutor, ExecuteRemediationInput } from "./executor.js";
import type { RemediationExecutionReport, RemediationPlan } from "./types.js";

export interface CanaryProposal {
  ref: ServerRef;
  approvalId: string;
  planId: string;
  risk: string;
  summary: string;
}

export interface CanaryReport {
  canary: ServerRef;
  canaryReport: RemediationExecutionReport;
  proposals: CanaryProposal[];
  summary: string;
}

export interface CanaryServiceDeps {
  executor: RemediationExecutor;
  approvals: ApprovalService;
  logger: Logger;
}

export interface RunCanaryInput {
  canaryPlan: RemediationPlan;
  memberPlans: Array<{ ref: ServerRef; build: () => Promise<RemediationPlan> }>;
  actor: string;
  approvalId?: string | null;
  signal?: AbortSignal;
}

export class CanaryService {
  constructor(private readonly deps: CanaryServiceDeps) {}

  async run(input: RunCanaryInput): Promise<CanaryReport> {
    const canary = input.canaryPlan.ref;
    const executionInput: ExecuteRemediationInput = {
      plan: input.canaryPlan,
      actor: input.actor,
      ...(input.approvalId ? { approvalId: input.approvalId } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    };
    const canaryReport = await this.deps.executor.execute(executionInput);

    if (!canaryReport.success) {
      this.deps.logger.warn("canary remediation failed; no group proposals created", {
        canary: `${canary.panel}/${canary.serverId}`,
        summary: canaryReport.summary,
      });
      return {
        canary,
        canaryReport,
        proposals: [],
        summary: `canary failed on ${canary.panel}/${canary.serverId}: ${canaryReport.summary}. No proposals were created for the remaining group members.`,
      };
    }

    const proposals: CanaryProposal[] = [];
    for (const member of input.memberPlans) {
      try {
        const plan = await member.build();
        const approval = await this.deps.approvals.propose({
          ref: plan.ref,
          plan,
          reason: `canary ${canary.panel}/${canary.serverId} verified successfully: ${canaryReport.summary}`,
          proposedBy: `canary:${input.actor}`,
        });
        proposals.push({
          ref: member.ref,
          approvalId: approval.id,
          planId: plan.id,
          risk: plan.risk,
          summary: plan.dryRunSummary.join(" | "),
        });
      } catch (error) {
        this.deps.logger.warn("failed to build member plan for canary follow-up", {
          member: `${member.ref.panel}/${member.ref.serverId}`,
          error: (error as Error).message,
        });
      }
    }

    return {
      canary,
      canaryReport,
      proposals,
      summary:
        proposals.length === 0
          ? `canary on ${canary.panel}/${canary.serverId} succeeded; no member plans could be built`
          : `canary on ${canary.panel}/${canary.serverId} succeeded; ${proposals.length} proposal(s) created for the remaining group members (each requires approval)`,
    };
  }
}
