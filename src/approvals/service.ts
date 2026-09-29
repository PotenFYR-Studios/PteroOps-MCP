import type { ApprovalConfig } from "../config/schema.js";
import type { Logger } from "../observability/logger.js";
import type { ApprovalRecord, ApprovalState } from "../persistence/models.js";
import type { ApprovalFilter, ApprovalRepository } from "../persistence/repositories/approvals.js";
import type { RemediationPlan } from "../remediation/types.js";
import { NotFoundError, PolicyDeniedError, ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import type { ServerRef } from "../shared/types.js";

export interface ProposeApprovalInput {
  ref: ServerRef;
  plan: RemediationPlan;
  incidentId?: string | null;
  remediationId?: string | null;
  reason?: string | null;
  proposedBy: string;
}

export class ApprovalService {
  constructor(
    private readonly repository: ApprovalRepository,
    private readonly config: ApprovalConfig,
    private readonly logger?: Logger,
    private readonly clock: () => number = Date.now,
  ) {}

  async propose(input: ProposeApprovalInput): Promise<ApprovalRecord> {
    const now = this.clock();
    const expiresAt = input.plan.expiresAt ?? now + this.config.defaultExpiryMinutes * 60_000;
    const record = await this.repository.create({
      id: createId("apr"),
      ref: input.ref,
      incidentId: input.incidentId ?? input.plan.incidentId ?? null,
      remediationId: input.remediationId ?? null,
      risk: input.plan.risk,
      plan: { ...input.plan, expiresAt },
      reason: input.reason ?? input.plan.reason,
      proposedBy: input.proposedBy,
      createdAt: now,
      expiresAt,
    });
    this.logger?.info("approval proposed", {
      approvalId: record.id,
      risk: record.risk,
      expiresAt,
      server: `${input.ref.panel}/${input.ref.serverId}`,
    });
    return record;
  }

  async get(tenant: string, id: string): Promise<ApprovalRecord> {
    const record = await this.repository.get(tenant, id);
    if (!record) throw new NotFoundError(`Approval ${id} not found`);
    return record;
  }

  async find(tenant: string, id: string): Promise<ApprovalRecord | null> {
    return this.repository.get(tenant, id);
  }

  async list(filter: ApprovalFilter): Promise<ApprovalRecord[]> {
    await this.expireStale();
    return this.repository.list(filter);
  }

  async approve(tenant: string, id: string, actor: string, note?: string): Promise<ApprovalRecord> {
    const record = await this.assertDecidable(tenant, id);
    record.state = "approved";
    record.decidedBy = actor;
    record.decisionNote = note ?? null;
    record.decidedAt = this.clock();
    await this.repository.update(record);
    this.logger?.info("approval granted", { approvalId: id, actor });
    return record;
  }

  async reject(tenant: string, id: string, actor: string, note?: string): Promise<ApprovalRecord> {
    const record = await this.assertDecidable(tenant, id);
    record.state = "rejected";
    record.decidedBy = actor;
    record.decisionNote = note ?? null;
    record.decidedAt = this.clock();
    await this.repository.update(record);
    this.logger?.info("approval rejected", { approvalId: id, actor });
    return record;
  }

  async markExecuted(tenant: string, id: string): Promise<ApprovalRecord> {
    const record = await this.get(tenant, id);
    if (record.state !== "approved") {
      throw new ValidationError(
        `Approval ${id} is in state "${record.state}" and cannot be marked executed`,
      );
    }
    record.state = "executed";
    record.executedAt = this.clock();
    await this.repository.update(record);
    return record;
  }

  async assertUsable(tenant: string, id: string): Promise<ApprovalRecord> {
    const record = await this.get(tenant, id);
    if (record.state === "proposed") {
      throw new PolicyDeniedError(
        `approval.pending`,
        `Approval ${id} is still pending; approve it before execution.`,
        {
          hint: "Call ptero_approve_action with decision=approve after the operator explicitly confirms.",
        },
      );
    }
    if (record.state === "rejected") {
      throw new PolicyDeniedError("approval.rejected", `Approval ${id} was rejected.`);
    }
    if (record.state === "executed") {
      throw new PolicyDeniedError("approval.executed", `Approval ${id} was already executed.`);
    }
    if (record.state === "expired") {
      throw new PolicyDeniedError("approval.expired", `Approval ${id} has expired; propose again.`);
    }
    if (record.expiresAt !== null && record.expiresAt < this.clock()) {
      record.state = "expired";
      await this.repository.update(record);
      throw new PolicyDeniedError("approval.expired", `Approval ${id} has expired; propose again.`);
    }
    return record;
  }

  async expireStale(now = this.clock()): Promise<number> {
    const expirable = await this.repository.listExpirable(now);
    for (const record of expirable) {
      record.state = "expired";
      await this.repository.update(record);
    }
    if (expirable.length > 0) {
      this.logger?.info("expired stale approvals", { count: expirable.length });
    }
    return expirable.length;
  }

  private async assertDecidable(tenant: string, id: string): Promise<ApprovalRecord> {
    const record = await this.get(tenant, id);
    if (
      record.expiresAt !== null &&
      record.expiresAt < this.clock() &&
      record.state === "proposed"
    ) {
      record.state = "expired";
      await this.repository.update(record);
    }
    if (record.state !== "proposed") {
      throw new ValidationError(
        `Approval ${id} is in state "${record.state}" and cannot be decided`,
        { hint: 'Only proposals in state "proposed" can be approved or rejected.' },
      );
    }
    return record;
  }
}

export type { ApprovalState };
