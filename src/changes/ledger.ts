import type { Logger } from "../observability/logger.js";
import type { ChangeEvent, ChangeEventInput, ChangeFilter } from "../persistence/models.js";
import type { ChangeRepository } from "../persistence/repositories/changes.js";
import { createId } from "../shared/ids.js";
import type { ServerRef } from "../shared/types.js";

export interface RecordChangeInput {
  ref: ServerRef;
  actor: string;
  origin: string;
  action: string;
  target: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  beforeRef?: string | null;
  afterRef?: string | null;
  incidentId?: string | null;
  reason?: string | null;
  approvalId?: string | null;
  risk?: ChangeEventInput["risk"];
  result: "success" | "failure";
  details?: Record<string, unknown> | null;
  ts?: number;
}

export class ChangeLedger {
  constructor(
    private readonly repository: ChangeRepository,
    private readonly logger?: Logger,
    private readonly clock: () => number = Date.now,
  ) {}

  async record(input: RecordChangeInput): Promise<ChangeEvent> {
    const event: ChangeEvent = {
      id: createId("chg"),
      ref: input.ref,
      ts: input.ts ?? this.clock(),
      actor: input.actor,
      origin: input.origin,
      action: input.action,
      target: input.target,
      beforeHash: input.beforeHash ?? null,
      afterHash: input.afterHash ?? null,
      beforeRef: input.beforeRef ?? null,
      afterRef: input.afterRef ?? null,
      incidentId: input.incidentId ?? null,
      reason: input.reason ?? null,
      approvalId: input.approvalId ?? null,
      risk: input.risk ?? null,
      result: input.result,
      details: input.details ?? null,
    };
    await this.repository.record(event);
    this.logger?.info("change recorded", {
      changeId: event.id,
      panel: input.ref.panel,
      server: input.ref.serverId,
      action: input.action,
      target: input.target,
      actor: input.actor,
      result: input.result,
    });
    return event;
  }

  async recent(
    ref: ServerRef,
    options: { sinceMs?: number; limit?: number; until?: number } = {},
  ): Promise<ChangeEvent[]> {
    const until = options.until ?? this.clock();
    const since = until - (options.sinceMs ?? 3_600_000);
    return this.repository.list({
      ref,
      since,
      until,
      limit: options.limit ?? 50,
    });
  }

  async around(ref: ServerRef, ts: number, windowMs: number): Promise<ChangeEvent[]> {
    return this.repository.list({
      ref,
      since: ts - windowMs,
      until: ts + windowMs,
      limit: 100,
    });
  }

  async byIncident(
    incidentId: string,
    options: { tenant?: string; limit?: number } = {},
  ): Promise<ChangeEvent[]> {
    return this.repository.list({
      incidentId,
      ...(options.tenant ? { tenant: options.tenant } : {}),
      limit: options.limit ?? 100,
    });
  }

  async linkIncident(changeId: string, incidentId: string): Promise<void> {
    await this.repository.linkIncident(changeId, incidentId);
  }

  async list(filter: ChangeFilter): Promise<ChangeEvent[]> {
    return this.repository.list(filter);
  }

  async countAction(ref: ServerRef, action: string, sinceMs: number): Promise<number> {
    return this.repository.countAction(ref, action, this.clock() - sinceMs);
  }
}
