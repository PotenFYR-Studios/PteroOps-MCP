import type { RemediationAction, BlastRadius } from "./types.js";
import type { RiskLevel } from "../shared/types.js";
import { maxRisk } from "../shared/types.js";
import { createId } from "../shared/ids.js";
import { riskActionKeyForPower } from "../security/risk.js";

export interface ActionWithRisk {
  action: RemediationAction;
  riskActionKey: string;
}

export function riskActionKeyForRemediationAction(type: RemediationAction["type"]): string {
  switch (type) {
    case "restart_server":
      return riskActionKeyForPower("restart");
    case "file_edit":
    case "file_revert":
      return "file_write";
    case "startup_variable_change":
      return "startup_variable_change";
    case "send_command":
      return "send_command";
    case "create_backup":
      return "create_backup";
    case "restore_backup":
      return "restore_backup";
  }
}

export function computePlanRisk(actions: RemediationAction[]): RiskLevel {
  return actions.reduce<RiskLevel>((acc, action) => maxRisk(acc, action.risk), "LOW");
}

export function describeRollbackStrategy(actions: RemediationAction[]): string {
  const steps = actions.flatMap((action) => action.rollback);
  if (steps.length === 0) return "no automated rollback (no reversible actions)";
  const descriptions = [...new Set(steps.map((step) => step.description))];
  return descriptions.join("; ");
}

export function createPlanId(): string {
  return createId("plan");
}

export function summarizeBlastRadius(blast: BlastRadius | null): string[] {
  if (!blast) return [];
  const lines: string[] = [`direct target: ${blast.direct}`];
  if (blast.sameNode.length > 0) lines.push(`shares a node with: ${blast.sameNode.join(", ")}`);
  if (blast.dependents.length > 0) lines.push(`dependents: ${blast.dependents.join(", ")}`);
  lines.push(`estimated impact: ${blast.estimatedImpact}`);
  if (blast.maintenanceRequired) lines.push("maintenance window recommended");
  return lines;
}
