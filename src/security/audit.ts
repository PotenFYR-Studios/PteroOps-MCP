import type { Logger } from "../observability/logger.js";
import type { AuditEvent, AuditEventInput, AuditFilter } from "../persistence/models.js";
import type { AuditRepository } from "../persistence/repositories/audit.js";
import type { StructuredErrorShape } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import type { RedactionEngine } from "../shared/redaction.js";

export interface RecordAuditInput {
  tenant: string;
  actor: string;
  tool: string;
  target?: string | null;
  action: string;
  decision: "allowed" | "denied" | "info";
  approvalId?: string | null;
  success: boolean;
  error?: StructuredErrorShape | null;
  correlationId?: string | null;
  details?: Record<string, unknown> | null;
}

export class AuditLog {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: AuditRepository,
    private readonly redactor: RedactionEngine,
    private readonly logger?: Logger,
    private readonly clock: () => number = Date.now,
  ) {}

  record(input: RecordAuditInput): void {
    const entry = this.buildEntry(input);
    if (!entry) return;
    this.pending = this.pending
      .then(async () => {
        await this.repository.append(entry);
      })
      .catch((error: unknown) => {
        this.logger?.error("failed to append audit event", {
          tool: input.tool,
          error: (error as Error).message,
        });
      });
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  async list(filter: AuditFilter): Promise<AuditEvent[]> {
    await this.flush();
    return this.repository.list(filter);
  }

  private buildEntry(input: RecordAuditInput): AuditEventInput | null {
    try {
      const redactedError = input.error
        ? (this.redactor.redactObject(input.error) as StructuredErrorShape)
        : null;
      const redactedDetails = input.details
        ? (this.redactor.redactObject(input.details) as Record<string, unknown>)
        : null;
      return {
        id: createId("aud"),
        ts: this.clock(),
        tenant: input.tenant,
        actor: this.redactor.redact(input.actor),
        tool: input.tool,
        target: input.target ?? null,
        action: input.action,
        decision: input.decision,
        approvalId: input.approvalId ?? null,
        success: input.success,
        error: redactedError,
        correlationId: input.correlationId ?? null,
        details: redactedDetails,
      };
    } catch (error) {
      this.logger?.error("failed to build audit event", {
        tool: input.tool,
        error: (error as Error).message,
      });
      return null;
    }
  }
}
