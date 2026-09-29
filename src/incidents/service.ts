import type { Logger } from "../observability/logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type {
  Incident,
  IncidentCause,
  IncidentData,
  IncidentEvidence,
  IncidentFilter,
} from "../persistence/models.js";
import type { IncidentRepository } from "../persistence/repositories/incidents.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { RISK_ORDER, type IncidentSeverity, type IncidentState, type ServerRef } from "../shared/types.js";

export interface EvidenceInput {
  kind: string;
  source: string;
  summary: string;
  detail?: Record<string, unknown> | null;
  ts?: number;
}

export interface OpenIncidentInput {
  ref: ServerRef;
  title: string;
  summary: string;
  severity: IncidentSeverity;
  fingerprint?: string | null;
  application?: string | null;
  confidence?: number | null;
  symptoms?: string[];
  probableCauses?: IncidentCause[];
  evidence?: EvidenceInput[];
  tags?: string[];
  parentId?: string | null;
}

export interface OpenIncidentResult {
  incident: Incident;
  deduped: boolean;
}

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const ALLOWED_TRANSITIONS: Record<IncidentState, IncidentState[]> = {
  detected: ["investigating", "suppressed", "resolved"],
  investigating: ["diagnosed", "suppressed", "resolved", "failed"],
  diagnosed: ["awaiting_approval", "remediating", "resolved", "suppressed"],
  awaiting_approval: ["remediating", "resolved", "suppressed", "failed"],
  remediating: ["verifying", "failed", "rolled_back"],
  verifying: ["resolved", "failed", "rolled_back"],
  failed: ["investigating", "suppressed", "resolved", "rolled_back"],
  rolled_back: ["investigating", "resolved", "suppressed"],
  resolved: ["investigating"],
  suppressed: ["investigating", "resolved"],
};

const FINAL_STATES = new Set<IncidentState>(["resolved", "rolled_back", "suppressed"]);

export class IncidentService {
  constructor(
    private readonly repository: IncidentRepository,
    private readonly logger?: Logger,
    private readonly clock: () => number = Date.now,
    private readonly metrics?: MetricsRegistry,
  ) {}

  async open(input: OpenIncidentInput): Promise<OpenIncidentResult> {
    const now = this.clock();
    if (input.fingerprint) {
      const existing = await this.repository.findOpenByFingerprint(input.ref, input.fingerprint);
      if (existing) {
        const merged = await this.mergeInto(existing, input, now);
        return { incident: merged, deduped: true };
      }
    }
    const incident = await this.repository.create({
      id: createId("inc"),
      ref: input.ref,
      parentId: input.parentId ?? null,
      application: input.application ?? null,
      title: input.title,
      summary: input.summary,
      severity: input.severity,
      state: "detected",
      fingerprint: input.fingerprint ?? null,
      confidence: input.confidence ?? null,
      detectedAt: now,
      data: {
        symptoms: input.symptoms ?? [],
        probableCauses: input.probableCauses ?? [],
        remediationAttempts: [],
        verifications: [],
        ...(input.tags ? { tags: input.tags } : {}),
      },
    });
    for (const evidence of input.evidence ?? []) {
      await this.addEvidence(incident, evidence);
    }
    this.logger?.info("incident opened", {
      incidentId: incident.id,
      panel: input.ref.panel,
      server: input.ref.serverId,
      severity: input.severity,
      title: input.title,
    });
    this.metrics?.increment("pteroops_incidents_total", 1, { severity: input.severity });
    await this.refreshOpenGauge(input.ref.tenant);
    return { incident: await this.get(input.ref.tenant, incident.id), deduped: false };
  }

  async get(tenant: string, id: string): Promise<Incident> {
    const incident = await this.repository.get(tenant, id);
    if (!incident) throw new NotFoundError(`Incident ${id} not found`);
    return incident;
  }

  async find(tenant: string, id: string): Promise<Incident | null> {
    return this.repository.get(tenant, id);
  }

  async list(filter: IncidentFilter): Promise<Incident[]> {
    return this.repository.list(filter);
  }

  async evidence(tenant: string, incidentId: string): Promise<IncidentEvidence[]> {
    return this.repository.listEvidence(tenant, incidentId);
  }

  async addEvidence(incident: Incident, evidence: EvidenceInput): Promise<void> {
    await this.repository.addEvidence({
      incidentId: incident.id,
      ref: incident.ref,
      ts: evidence.ts ?? this.clock(),
      kind: evidence.kind,
      source: evidence.source,
      summary: evidence.summary,
      detail: evidence.detail ?? null,
    });
  }

  async addNote(incident: Incident, actor: string, note: string): Promise<void> {
    const data = incident.data;
    data.notes = [...(data.notes ?? []), { ts: this.clock(), actor, note }];
    incident.updatedAt = this.clock();
    await this.repository.update(incident);
  }

  async transition(
    tenant: string,
    id: string,
    state: IncidentState,
    options: { actor?: string; note?: string } = {},
  ): Promise<Incident> {
    const incident = await this.get(tenant, id);
    if (incident.state === state) return incident;
    const allowed = ALLOWED_TRANSITIONS[incident.state];
    if (!allowed.includes(state)) {
      throw new ValidationError(
        `Invalid incident transition ${incident.state} → ${state} (allowed: ${allowed.join(", ")})`,
      );
    }
    incident.state = state;
    incident.updatedAt = this.clock();
    if (FINAL_STATES.has(state)) {
      incident.resolvedAt = incident.updatedAt;
    }
    if (options.note) {
      incident.data.notes = [
        ...(incident.data.notes ?? []),
        { ts: incident.updatedAt, actor: options.actor ?? "system", note: options.note },
      ];
    }
    await this.repository.update(incident);
    this.logger?.info("incident transitioned", {
      incidentId: incident.id,
      state,
      actor: options.actor ?? "system",
    });
    await this.refreshOpenGauge(tenant);
    return incident;
  }

  private async refreshOpenGauge(tenant: string): Promise<void> {
    if (!this.metrics) return;
    const open = await this.repository.countOpen(tenant);
    this.metrics.setGauge("pteroops_incidents_open", open, { tenant });
  }

  async recordRemediationAttempt(
    incident: Incident,
    attempt: { remediationId?: string; description: string; result: string },
  ): Promise<void> {
    incident.data.remediationAttempts.push({ ts: this.clock(), ...attempt });
    incident.updatedAt = this.clock();
    await this.repository.update(incident);
  }

  async recordVerification(
    incident: Incident,
    verification: { passed: boolean; detail: string },
  ): Promise<void> {
    incident.data.verifications.push({ ts: this.clock(), ...verification });
    incident.updatedAt = this.clock();
    await this.repository.update(incident);
  }

  async setProbableCauses(incident: Incident, causes: IncidentCause[]): Promise<void> {
    incident.data.probableCauses = causes;
    incident.updatedAt = this.clock();
    await this.repository.update(incident);
  }

  async associateFingerprint(incident: Incident, fingerprint: string): Promise<void> {
    if (!incident.fingerprint) {
      incident.fingerprint = fingerprint;
      incident.updatedAt = this.clock();
      await this.repository.update(incident);
    }
  }

  async similar(
    tenant: string,
    fingerprints: string[],
    sinceDays = 30,
    limit = 5,
  ): Promise<Incident[]> {
    const since = this.clock() - sinceDays * 86_400_000;
    return this.repository.findByFingerprints(tenant, fingerprints, since, limit);
  }

  async relate(parentId: string, childId: string, relation: string): Promise<void> {
    await this.repository.relate(parentId, childId, relation);
  }

  async countOpen(tenant: string): Promise<number> {
    return this.repository.countOpen(tenant);
  }

  private async mergeInto(
    existing: Incident,
    input: OpenIncidentInput,
    now: number,
  ): Promise<Incident> {
    const data: IncidentData = existing.data;
    const mergedSymptoms = new Set([...data.symptoms, ...(input.symptoms ?? [])]);
    data.symptoms = [...mergedSymptoms];
    if (input.probableCauses && input.probableCauses.length > 0) {
      const existingCauses = new Set(data.probableCauses.map((cause) => cause.cause));
      for (const cause of input.probableCauses) {
        if (!existingCauses.has(cause.cause)) data.probableCauses.push(cause);
      }
    }
    if (input.confidence !== null && input.confidence !== undefined) {
      existing.confidence = Math.max(existing.confidence ?? 0, input.confidence);
    }
    if (SEVERITY_RANK[input.severity] > SEVERITY_RANK[existing.severity]) {
      existing.severity = input.severity;
    }
    if (input.application) existing.application = input.application;
    existing.summary = input.summary;
    existing.updatedAt = now;
    await this.repository.update(existing);
    for (const evidence of input.evidence ?? []) {
      await this.addEvidence(existing, evidence);
    }
    this.logger?.info("incident updated (deduplicated)", {
      incidentId: existing.id,
      fingerprint: input.fingerprint,
    });
    return this.get(existing.ref.tenant, existing.id);
  }
}

export function riskLevelToIncidentSeverity(level: string): IncidentSeverity {
  if (level === "CRITICAL") return "critical";
  if (level === "HIGH") return "high";
  if (level === "MEDIUM") return "medium";
  return "low";
}

export function severityRank(severity: IncidentSeverity): number {
  return SEVERITY_RANK[severity];
}

export function isFinalState(state: IncidentState): boolean {
  return FINAL_STATES.has(state);
}

export function compareRisk(a: string, b: string): number {
  return (RISK_ORDER[a as keyof typeof RISK_ORDER] ?? 0) - (RISK_ORDER[b as keyof typeof RISK_ORDER] ?? 0);
}
