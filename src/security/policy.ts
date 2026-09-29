import type { ApprovalConfig, MaintenanceWindowConfig, PteroOpsConfig, PolicyConfig } from "../config/schema.js";
import type { RiskLevel, ServerRef } from "../shared/types.js";
import { RISK_ORDER } from "../shared/types.js";
import { matchGlob } from "../shared/text.js";
import { classifyRisk, maxOf, riskActionKeyForPower, type RiskAssessment } from "./risk.js";

export interface PolicyDecision {
  allowed: boolean;
  risk: RiskLevel;
  requiresApproval: boolean;
  reason: string;
  policyId: string;
  assessment?: RiskAssessment;
}

export interface EvaluateActionOptions {
  origin?: string;
  approved?: boolean;
  recentRestarts?: number;
  protectedPath?: boolean;
  sizeBytes?: number;
  automation?: boolean;
  now?: number;
}

export interface MaintenanceWindowMatch {
  window: MaintenanceWindowConfig;
  restriction: "denyAutomation" | "allowAutoLowRisk";
}

export class PolicyEngine {
  constructor(
    private readonly policy: PolicyConfig,
    private readonly approval: ApprovalConfig,
    private readonly windows: MaintenanceWindowConfig[],
    private readonly emergencyOverride: boolean,
  ) {}

  static fromConfig(config: PteroOpsConfig): PolicyEngine {
    return new PolicyEngine(
      config.policy,
      config.approval,
      config.maintenanceWindows,
      config.emergencyOverride,
    );
  }

  evaluateServerAccess(ref: ServerRef): PolicyDecision {
    if (this.policy.allowedServers.length === 0) {
      return this.allow("Server access permitted by default policy", "server.allowlist");
    }
    const targets = [`${ref.panel}/${ref.serverId}`, `${ref.tenant}/${ref.panel}/${ref.serverId}`];
    const matched = this.policy.allowedServers.some((pattern) =>
      targets.some((target) => matchGlob(pattern, target)),
    );
    if (matched) {
      return this.allow("Server matches the configured allowlist", "server.allowlist");
    }
    return this.deny(
      "Server is not in the configured allowlist (policy.allowedServers)",
      "server.allowlist",
    );
  }

  evaluateCommand(ref: ServerRef, command: string, options: EvaluateActionOptions = {}): PolicyDecision {
    const serverAccess = this.evaluateServerAccess(ref);
    if (!serverAccess.allowed) return serverAccess;

    if (command.trim() === "") {
      return this.deny("Empty command", "command.empty");
    }
    for (const pattern of this.policy.blockedCommands) {
      if (safeRegexTest(pattern, command)) {
        return this.deny(
          `Command matches blocked pattern "${pattern}" (policy.blockedCommands)`,
          "command.blocked",
        );
      }
    }
    if (this.policy.allowedCommands.length > 0) {
      const matched = this.policy.allowedCommands.some((pattern) => safeRegexTest(pattern, command));
      if (!matched) {
        return this.deny(
          "Command does not match any allowlist pattern (policy.allowedCommands is non-empty)",
          "command.allowlist",
        );
      }
    }
    return this.evaluateAction(ref, "send_command", options);
  }

  evaluateFileWrite(
    ref: ServerRef,
    path: string,
    options: EvaluateActionOptions & { sizeBytes?: number } = {},
  ): PolicyDecision {
    const serverAccess = this.evaluateServerAccess(ref);
    if (!serverAccess.allowed) return serverAccess;

    const protectedMatch = this.matchProtectedPath(path);
    if (protectedMatch) {
      return {
        allowed: false,
        risk: "HIGH",
        requiresApproval: true,
        reason: `Path matches protected path "${protectedMatch}" (policy.protectedPaths)`,
        policyId: "path.protected",
      };
    }
    if (options.sizeBytes !== undefined && options.sizeBytes > this.policy.maxFileSizeBytes) {
      return {
        allowed: false,
        risk: "MEDIUM",
        requiresApproval: true,
        reason: `File change of ${options.sizeBytes} bytes exceeds policy.maxFileSizeBytes (${this.policy.maxFileSizeBytes})`,
        policyId: "file.size",
      };
    }
    return this.evaluateAction(ref, "file_write", options);
  }

  evaluatePower(
    ref: ServerRef,
    action: "start" | "stop" | "restart" | "kill",
    options: EvaluateActionOptions = {},
  ): PolicyDecision {
    const serverAccess = this.evaluateServerAccess(ref);
    if (!serverAccess.allowed) return serverAccess;

    if (
      (action === "restart" || action === "start") &&
      options.recentRestarts !== undefined &&
      options.recentRestarts >= this.policy.maxRestartsPerHour
    ) {
      return this.deny(
        `Restart budget exceeded: ${options.recentRestarts} restarts in the last hour (policy.maxRestartsPerHour=${this.policy.maxRestartsPerHour})`,
        "restart.budget",
      );
    }
    return this.evaluateAction(ref, riskActionKeyForPower(action), options);
  }

  evaluateAction(ref: ServerRef, actionKey: string, options: EvaluateActionOptions = {}): PolicyDecision {
    const serverAccess = this.evaluateServerAccess(ref);
    if (!serverAccess.allowed) return serverAccess;

    if (this.approval.deny.includes(actionKey)) {
      return {
        allowed: false,
        risk: "CRITICAL",
        requiresApproval: false,
        reason: `Action "${actionKey}" is denied by policy (approval.deny)`,
        policyId: "approval.denied",
      };
    }

    const assessment = classifyRisk(actionKey, {
      ...(options.protectedPath !== undefined ? { protectedPath: options.protectedPath } : {}),
      ...(options.sizeBytes !== undefined ? { sizeBytes: options.sizeBytes } : {}),
    });
    const risk = assessment.level;

    const automation = options.automation ?? true;
    if (automation && !this.emergencyOverride) {
      const windowMatch = this.matchMaintenanceWindow(ref, options.now ?? Date.now());
      if (windowMatch && windowMatch.restriction === "denyAutomation") {
        return {
          allowed: false,
          risk,
          requiresApproval: true,
          reason: `Automation denied by maintenance window "${windowMatch.window.name}" (denyAutomation)`,
          policyId: "maintenance.window",
          assessment,
        };
      }
      if (
        windowMatch &&
        windowMatch.restriction === "allowAutoLowRisk" &&
        RISK_ORDER[risk] <= RISK_ORDER.LOW
      ) {
        return {
          allowed: true,
          risk,
          requiresApproval: false,
          reason: `Allowed by maintenance window "${windowMatch.window.name}" (allowAutoLowRisk)`,
          policyId: "maintenance.window",
          assessment,
        };
      }
    }

    const requiresApproval = this.requiresApproval(actionKey, risk);
    if (requiresApproval && !options.approved) {
      return {
        allowed: false,
        risk,
        requiresApproval: true,
        reason: assessApprovalReason(this.approval, actionKey, risk),
        policyId: "approval.required",
        assessment,
      };
    }
    return {
      allowed: true,
      risk,
      requiresApproval,
      reason: options.approved
        ? "Action allowed with approval"
        : assessApprovalReason(this.approval, actionKey, risk),
      policyId: "approval.default",
      assessment,
    };
  }

  matchMaintenanceWindow(ref: ServerRef, now: number): MaintenanceWindowMatch | null {
    const targets = [`${ref.panel}/${ref.serverId}`, `${ref.tenant}/${ref.panel}/${ref.serverId}`];
    const current = minutesOfDay(now);
    for (const window of this.windows) {
      const applies = window.servers.some((pattern) =>
        targets.some((target) => matchGlob(pattern, target)),
      );
      if (!applies) continue;
      for (const range of window.denyAutomation) {
        if (inTimeRange(current, range)) {
          return { window, restriction: "denyAutomation" };
        }
      }
      for (const range of window.allowAutoLowRisk) {
        if (inTimeRange(current, range)) {
          return { window, restriction: "allowAutoLowRisk" };
        }
      }
    }
    return null;
  }

  requiresApproval(actionKey: string, risk: RiskLevel): boolean {
    if (risk === "CRITICAL") return true;
    if (this.approval.deny.includes(actionKey)) return true;
    if (this.approval.requireApproval.includes(actionKey)) return true;
    if (this.approval.autoApprove.includes(actionKey)) return RISK_ORDER[risk] >= RISK_ORDER.HIGH;
    return RISK_ORDER[risk] >= RISK_ORDER.MEDIUM;
  }

  matchProtectedPath(path: string): string | null {
    const normalized = path.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    const basename = segments[segments.length - 1] ?? normalized;
    for (const pattern of this.policy.protectedPaths) {
      if (pattern.includes("/")) {
        if (matchGlob(pattern, normalized)) return pattern;
      } else if (matchGlob(pattern, basename)) {
        return pattern;
      } else if (segments.some((segment) => matchGlob(pattern, segment))) {
        return pattern;
      }
    }
    return null;
  }

  private allow(reason: string, policyId: string): PolicyDecision {
    return { allowed: true, risk: "LOW", requiresApproval: false, reason, policyId };
  }

  private deny(reason: string, policyId: string): PolicyDecision {
    return { allowed: false, risk: "HIGH", requiresApproval: true, reason, policyId };
  }
}

function assessApprovalReason(approval: ApprovalConfig, actionKey: string, risk: RiskLevel): string {
  if (approval.deny.includes(actionKey)) return `Action "${actionKey}" is denied by policy`;
  if (approval.requireApproval.includes(actionKey)) {
    return `Action "${actionKey}" requires approval (approval.requireApproval)`;
  }
  if (approval.autoApprove.includes(actionKey) && RISK_ORDER[risk] < RISK_ORDER.HIGH) {
    return `Action "${actionKey}" is auto-approved (approval.autoApprove)`;
  }
  return `Risk level ${risk} requires approval`;
}

function safeRegexTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function minutesOfDay(epochMs: number): number {
  const date = new Date(epochMs);
  return date.getHours() * 60 + date.getMinutes();
}

function inTimeRange(currentMinutes: number, range: string): boolean {
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(range.trim());
  if (!match) return false;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  if (start <= end) return currentMinutes >= start && currentMinutes < end;
  return currentMinutes >= start || currentMinutes < end;
}

export function combineRiskLevels(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>((acc, level) => maxOf(acc, level), "LOW");
}
