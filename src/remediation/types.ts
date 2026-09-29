import type { RiskLevel, ServerRef } from "../shared/types.js";

export type RemediationActionType =
  | "restart_server"
  | "file_edit"
  | "file_revert"
  | "startup_variable_change"
  | "send_command"
  | "create_backup"
  | "restore_backup";

export interface FileEditOperation {
  find: string;
  replace: string;
  replaceAll?: boolean;
}

export interface RemediationAction {
  type: RemediationActionType;
  description: string;
  risk: RiskLevel;
  requiresRestart: boolean;
  params: Record<string, unknown>;
  rollback: RollbackStep[];
}

export type RollbackStepType =
  | "reverse_patch"
  | "restore_snapshot"
  | "restore_startup_variable"
  | "restore_backup"
  | "restart_server"
  | "send_command";

export interface RollbackStep {
  type: RollbackStepType;
  description: string;
  params: Record<string, unknown>;
}

export interface BlastRadius {
  direct: string;
  dependents: string[];
  sameNode: string[];
  estimatedImpact: string;
  maintenanceRequired: boolean;
}

export interface RemediationPlan {
  id: string;
  ref: ServerRef;
  incidentId: string | null;
  reason: string;
  actions: RemediationAction[];
  risk: RiskLevel;
  expectedEffect: string;
  rollbackStrategy: string;
  requiresApproval: boolean;
  dryRunSummary: string[];
  blastRadius: BlastRadius | null;
  evidence: Array<{ source: string; detail: string }>;
  expiresAt: number | null;
  createdAt: number;
}

export interface PlanFileEditParams {
  path: string;
  expectedHash: string;
  edits?: FileEditOperation[];
  content?: string;
}

export interface PlanFileRevertParams {
  path: string;
  snapshotId: string;
  expectedHash: string;
}

export interface PlanStartupVariableParams {
  key: string;
  value: string;
  previousValue?: string | null;
}

export interface PlanCommandParams {
  command: string;
}

export interface PlanRestoreBackupParams {
  backupUuid: string;
}

export interface RemediationExecutionReport {
  remediationId: string;
  state: string;
  success: boolean;
  steps: Array<{ seq: number; kind: string; status: string; detail: string }>;
  healthBefore: string | null;
  healthAfter: string | null;
  rolledBack: boolean;
  rollbackVerified: boolean | null;
  summary: string;
  dryRun: boolean;
}
