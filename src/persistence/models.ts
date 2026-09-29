import type { ServerRef, Severity, IncidentSeverity, IncidentState, RiskLevel } from "../shared/types.js";
import type { StructuredErrorShape } from "../shared/errors.js";
import type { RemediationPlan } from "../remediation/types.js";

export interface ConsoleEvent {
  id: number;
  ref: ServerRef;
  ts: number;
  raw: string;
  normalized: string;
  severity: Severity;
  subsystem: string | null;
  exceptionType: string | null;
  fingerprint: string | null;
  incidentId: string | null;
  correlationId: string | null;
}

export interface ConsoleEventInput {
  ref: ServerRef;
  ts: number;
  raw: string;
  normalized: string;
  severity: Severity;
  subsystem?: string | null;
  exceptionType?: string | null;
  fingerprint?: string | null;
  incidentId?: string | null;
  correlationId?: string | null;
}

export type ConsoleQueryMode = "latest" | "first" | "before" | "events";

export interface ConsoleQuery {
  ref: ServerRef;
  since?: number;
  until?: number;
  severities?: Severity[];
  text?: string;
  regex?: string;
  fingerprint?: string;
  incidentId?: string;
  mode?: ConsoleQueryMode;
  around?: number;
  limit?: number;
  order?: "asc" | "desc";
}

export interface ConsoleEventPage {
  events: ConsoleEvent[];
  truncated: boolean;
}

export interface FingerprintSummary {
  fingerprint: string;
  exceptionType: string | null;
  severity: Severity;
  subsystem: string | null;
  count: number;
  firstSeen: number;
  lastSeen: number;
  sample: string;
  incidentId: string | null;
}

export interface MetricSample {
  id: number;
  ref: ServerRef;
  ts: number;
  state: string | null;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  diskBytes: number;
  diskLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
  uptimeMs: number | null;
}

export interface MetricSampleInput {
  ref: ServerRef;
  ts: number;
  state: string | null;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  diskBytes: number;
  diskLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
  uptimeMs: number | null;
}

export interface ProcessEvent {
  id: number;
  ref: ServerRef;
  ts: number;
  kind: "started" | "exited";
  exitCode: number | null;
  runtimeMs: number | null;
  source: "poll" | "console";
}

export interface ProcessEventInput {
  ref: ServerRef;
  ts: number;
  kind: "started" | "exited";
  exitCode?: number | null;
  runtimeMs?: number | null;
  source: "poll" | "console";
}

export interface IncidentCause {
  cause: string;
  confidence: number;
  kind: "observed" | "inferred" | "hypothesis";
  evidence: Array<{ source: string; detail: string; weight?: number; ts?: number }>;
}

export interface IncidentData {
  symptoms: string[];
  probableCauses: IncidentCause[];
  remediationAttempts: Array<{
    ts: number;
    remediationId?: string;
    description: string;
    result: string;
  }>;
  verifications: Array<{ ts: number; passed: boolean; detail: string }>;
  tags?: string[];
  notes?: Array<{ ts: number; actor: string; note: string }>;
}

export interface Incident {
  id: string;
  ref: ServerRef;
  parentId: string | null;
  application: string | null;
  title: string;
  summary: string;
  severity: IncidentSeverity;
  state: IncidentState;
  fingerprint: string | null;
  confidence: number | null;
  detectedAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  data: IncidentData;
}

export interface IncidentCreate {
  id: string;
  ref: ServerRef;
  parentId?: string | null;
  application?: string | null;
  title: string;
  summary: string;
  severity: IncidentSeverity;
  state: IncidentState;
  fingerprint?: string | null;
  confidence?: number | null;
  detectedAt: number;
  data: IncidentData;
}

export interface IncidentEvidence {
  id: number;
  incidentId: string;
  ts: number;
  kind: string;
  source: string;
  summary: string;
  detail: Record<string, unknown> | null;
}

export interface IncidentFilter {
  tenant?: string;
  panel?: string;
  serverId?: string;
  states?: IncidentState[];
  openOnly?: boolean;
  severity?: IncidentSeverity;
  since?: number;
  limit?: number;
}

export interface ChangeEvent {
  id: string;
  ref: ServerRef;
  ts: number;
  actor: string;
  origin: string;
  action: string;
  target: string;
  beforeHash: string | null;
  afterHash: string | null;
  beforeRef: string | null;
  afterRef: string | null;
  incidentId: string | null;
  reason: string | null;
  approvalId: string | null;
  risk: RiskLevel | null;
  result: "success" | "failure";
  details: Record<string, unknown> | null;
}

export interface ChangeEventInput {
  id: string;
  ref: ServerRef;
  ts: number;
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
  risk?: RiskLevel | null;
  result: "success" | "failure";
  details?: Record<string, unknown> | null;
}

export interface ChangeFilter {
  ref?: ServerRef;
  tenant?: string;
  incidentId?: string;
  action?: string;
  actor?: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface AuditEvent {
  id: string;
  ts: number;
  tenant: string;
  actor: string;
  tool: string;
  target: string | null;
  action: string;
  decision: "allowed" | "denied" | "info";
  approvalId: string | null;
  success: boolean;
  error: StructuredErrorShape | null;
  correlationId: string | null;
  details: Record<string, unknown> | null;
}

export interface AuditEventInput {
  id: string;
  ts: number;
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

export interface AuditFilter {
  tenant?: string;
  tool?: string;
  actor?: string;
  since?: number;
  until?: number;
  success?: boolean;
  correlationId?: string;
  limit?: number;
}

export interface ServerRecord {
  ref: ServerRef;
  uuid: string | null;
  name: string;
  state: string | null;
  application: string | null;
  firstSeen: number;
  lastSeen: number;
}

export interface LogFingerprintRecord {
  fingerprint: string;
  ref: ServerRef;
  exceptionType: string | null;
  severity: Severity;
  subsystem: string | null;
  count: number;
  firstSeen: number;
  lastSeen: number;
  sample: string;
  incidentId: string | null;
}

export type ApprovalState = "proposed" | "approved" | "rejected" | "expired" | "executed";

export interface ApprovalRecord {
  id: string;
  ref: ServerRef;
  incidentId: string | null;
  remediationId: string | null;
  state: ApprovalState;
  risk: RiskLevel;
  plan: RemediationPlan;
  reason: string | null;
  proposedBy: string;
  decidedBy: string | null;
  decisionNote: string | null;
  expiresAt: number | null;
  createdAt: number;
  decidedAt: number | null;
  executedAt: number | null;
}

export type RemediationState =
  | "planned"
  | "awaiting_approval"
  | "executing"
  | "verifying"
  | "succeeded"
  | "rolling_back"
  | "rolled_back"
  | "failed";

export interface RemediationResult {
  success: boolean;
  summary: string;
  healthAfter: string | null;
  rollbackVerified: boolean | null;
  error: string | null;
}

export interface RemediationRecord {
  id: string;
  ref: ServerRef;
  incidentId: string | null;
  approvalId: string | null;
  plan: RemediationPlan;
  state: RemediationState;
  risk: RiskLevel;
  rollbackStrategy: string;
  startedAt: number;
  finishedAt: number | null;
  result: RemediationResult | null;
}

export interface RemediationStepRecord {
  id: number;
  remediationId: string;
  seq: number;
  kind: string;
  status: "ok" | "failed" | "skipped" | "rolled_back";
  detail: Record<string, unknown> | null;
  ts: number;
}

export interface FileSnapshotRecord {
  id: string;
  ref: ServerRef;
  path: string;
  hash: string;
  size: number;
  content: string | null;
  createdAt: number;
  reason: string | null;
  incidentId: string | null;
  remediationId: string | null;
}

export interface BaselineStats {
  median: number;
  p95: number;
  max: number;
  min: number;
  ema: number;
  mad: number;
  samples: number;
}

export interface BaselineRecord {
  ref: ServerRef;
  metric: string;
  stats: BaselineStats;
  windowMs: number;
  samples: number;
  updatedAt: number;
}

export interface KnownGoodRecord {
  id: string;
  ref: ServerRef;
  ts: number;
  healthScore: number;
  application: string | null;
  configHashes: Record<string, string>;
  startupVarsHash: string | null;
  dependencyHash: string | null;
  gitRevision: string | null;
}

export type ScheduleKind =
  | "health_scan"
  | "diagnose_scope"
  | "dependency_audit"
  | "backup_check"
  | "anomaly_scan"
  | "retention_prune";

export interface ScheduleRecord {
  id: string;
  name: string;
  kind: ScheduleKind;
  scope: string[];
  everyMs: number;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number | null;
  lastResult: Record<string, unknown> | null;
}

export interface TopologyNodeRecord {
  id: string;
  tenant: string;
  kind: "panel" | "node" | "server" | "allocation" | "database" | "application" | "proxy" | "repository";
  ref: string;
  label: string;
  attrs: Record<string, unknown> | null;
}

export interface TopologyEdgeRecord {
  src: string;
  dst: string;
  relation: string;
  attrs: Record<string, unknown> | null;
}
