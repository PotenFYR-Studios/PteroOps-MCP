import type { RiskLevel } from "../shared/types.js";
import { RISK_ORDER } from "../shared/types.js";

export interface RiskActionDefinition {
  action: string;
  level: RiskLevel;
  description: string;
}

export const RISK_ACTIONS: Record<string, RiskActionDefinition> = {
  start_server: { action: "start_server", level: "LOW", description: "Start a stopped server" },
  stop_server: { action: "stop_server", level: "LOW", description: "Graceful stop of a server" },
  restart_server: { action: "restart_server", level: "MEDIUM", description: "Restart a server" },
  restart_after_verified_crash: {
    action: "restart_after_verified_crash",
    level: "LOW",
    description: "Restart after a verified crash loop with evidence",
  },
  kill_server: {
    action: "kill_server",
    level: "HIGH",
    description: "Force-kill a server process (data loss possible)",
  },
  send_command: {
    action: "send_command",
    level: "MEDIUM",
    description: "Send a console command to a server",
  },
  file_write: { action: "file_write", level: "MEDIUM", description: "Write or patch a file" },
  file_delete: { action: "file_delete", level: "HIGH", description: "Delete a file" },
  create_backup: { action: "create_backup", level: "LOW", description: "Create a backup" },
  restore_backup: {
    action: "restore_backup",
    level: "HIGH",
    description: "Restore a backup over live data",
  },
  delete_backup: { action: "delete_backup", level: "MEDIUM", description: "Delete a backup" },
  dependency_update: {
    action: "dependency_update",
    level: "MEDIUM",
    description: "Update or install a dependency",
  },
  startup_variable_change: {
    action: "startup_variable_change",
    level: "MEDIUM",
    description: "Change a startup variable or startup command",
  },
  allocation_change: {
    action: "allocation_change",
    level: "MEDIUM",
    description: "Change network allocations",
  },
  git_deploy: { action: "git_deploy", level: "MEDIUM", description: "Deploy from a Git repository" },
  git_rollback: {
    action: "git_rollback",
    level: "HIGH",
    description: "Roll back to an older Git revision",
  },
  database_modification: {
    action: "database_modification",
    level: "HIGH",
    description: "Modify a database",
  },
  delete_server: {
    action: "delete_server",
    level: "CRITICAL",
    description: "Delete a server and its data",
  },
  wipe_filesystem: {
    action: "wipe_filesystem",
    level: "CRITICAL",
    description: "Destructive filesystem operation",
  },
  clear_cache: { action: "clear_cache", level: "LOW", description: "Clear cache or temp files" },
  network_probe: {
    action: "network_probe",
    level: "LOW",
    description: "Read-only network reachability probe",
  },
  schedule_change: {
    action: "schedule_change",
    level: "MEDIUM",
    description: "Change scheduled tasks",
  },
};

export interface RiskAssessment {
  action: string;
  level: RiskLevel;
  reasons: string[];
  requiresApproval: boolean;
  known: boolean;
}

export interface ClassifyRiskOptions {
  protectedPath?: boolean;
  sizeBytes?: number;
  levelOverride?: RiskLevel;
}

export function classifyRisk(actionKey: string, options: ClassifyRiskOptions = {}): RiskAssessment {
  const definition = RISK_ACTIONS[actionKey];
  const reasons: string[] = [];
  let level: RiskLevel = definition?.level ?? "HIGH";
  let known = Boolean(definition);

  if (definition) {
    reasons.push(definition.description);
  } else {
    reasons.push(`Unknown action "${actionKey}" classified defensively as HIGH risk`);
    known = false;
  }

  if (options.protectedPath) {
    level = maxOf(level, "HIGH");
    reasons.push("Target path matches a protected path policy");
  }
  if (options.sizeBytes !== undefined && options.sizeBytes > 500_000) {
    reasons.push(`Large file change (${options.sizeBytes} bytes) increases review burden`);
  }
  if (options.levelOverride) {
    level = maxOf(level, options.levelOverride);
    reasons.push(`Risk raised to ${options.levelOverride} by explicit configuration`);
  }

  return {
    action: actionKey,
    level,
    reasons,
    requiresApproval: RISK_ORDER[level] >= RISK_ORDER.MEDIUM,
    known,
  };
}

export function maxOf(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export function riskForPowerAction(action: "start" | "stop" | "restart" | "kill"): RiskLevel {
  switch (action) {
    case "start":
      return "LOW";
    case "stop":
      return "LOW";
    case "restart":
      return "MEDIUM";
    case "kill":
      return "HIGH";
  }
}

export function riskActionKeyForPower(action: "start" | "stop" | "restart" | "kill"): string {
  switch (action) {
    case "start":
      return "start_server";
    case "stop":
      return "stop_server";
    case "restart":
      return "restart_server";
    case "kill":
      return "kill_server";
  }
}
