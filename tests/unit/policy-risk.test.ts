import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../../src/security/policy.js";
import { classifyRisk, riskForPowerAction } from "../../src/security/risk.js";
import { ConfigSchema } from "../../src/config/schema.js";

const config = ConfigSchema.parse({
  panels: { mock: { url: "https://panel.example.com", clientKey: "ptlc_test_key_123456" } },
  policy: {
    allowedServers: [],
    protectedPaths: [".env", "*.pem", "server.properties.backup"],
    blockedCommands: ["^rm\\s+-rf\\s+/", "^op\\s+"],
    allowedCommands: [],
  },
  approval: {
    autoApprove: ["start_server"],
    requireApproval: ["file_write", "restore_backup"],
    deny: ["delete_server"],
  },
});

const engine = PolicyEngine.fromConfig(config);
const ref = { tenant: "local", panel: "mock", serverId: "survival" };

describe("RiskClassifier", () => {
  it("maps documented action levels", () => {
    expect(classifyRisk("restart_server").level).toBe("MEDIUM");
    expect(classifyRisk("kill_server").level).toBe("HIGH");
    expect(classifyRisk("delete_server").level).toBe("CRITICAL");
    expect(classifyRisk("create_backup").level).toBe("LOW");
    expect(riskForPowerAction("kill")).toBe("HIGH");
    expect(riskForPowerAction("start")).toBe("LOW");
  });

  it("never classifies destructive operations as low risk", () => {
    for (const action of ["delete_server", "wipe_filesystem", "restore_backup", "kill_server"]) {
      expect(["HIGH", "CRITICAL"]).toContain(classifyRisk(action).level);
    }
  });

  it("classifies unknown actions defensively as HIGH", () => {
    const assessment = classifyRisk("mystery_action");
    expect(assessment.known).toBe(false);
    expect(assessment.level).toBe("HIGH");
  });

  it("escalates protected paths", () => {
    expect(classifyRisk("file_write", { protectedPath: true }).level).toBe("HIGH");
  });
});

describe("PolicyEngine", () => {
  it("allows ordinary commands by default", () => {
    const decision = engine.evaluateCommand(ref, "say hello", { automation: false, approved: true });
    expect(decision.allowed).toBe(true);
  });

  it("blocks configured command patterns with an explainable reason", () => {
    const decision = engine.evaluateCommand(ref, "op Notch", { automation: false, approved: true });
    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toBe("command.blocked");
    expect(decision.reason).toContain("blocked pattern");
  });

  it("enforces an allowlist when configured", () => {
    const allowlistEngine = PolicyEngine.fromConfig(
      ConfigSchema.parse({
        panels: { mock: { url: "https://panel.example.com", clientKey: "ptlc_test_key_123456" } },
        policy: { allowedCommands: ["^(say|list|help)\\b"] },
      }),
    );
    expect(allowlistEngine.evaluateCommand(ref, "say hi", { automation: false, approved: true }).allowed).toBe(true);
    expect(allowlistEngine.evaluateCommand(ref, "stop", { automation: false, approved: true }).allowed).toBe(false);
  });

  it("refuses protected file writes", () => {
    const decision = engine.evaluateFileWrite(ref, "/.env", { automation: false, approved: true });
    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toBe("path.protected");
  });

  it("refuses oversized file writes", () => {
    const decision = engine.evaluateFileWrite(ref, "/config.yml", {
      automation: false,
      approved: true,
      sizeBytes: config.policy.maxFileSizeBytes + 1,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toBe("file.size");
  });

  it("denies actions on the deny list regardless of approval", () => {
    const decision = engine.evaluateAction(ref, "delete_server", {
      automation: false,
      approved: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toBe("approval.denied");
  });

  it("marks requireApproval actions as approval-gated", () => {
    const denied = engine.evaluateAction(ref, "file_write", { automation: false });
    expect(denied.allowed).toBe(false);
    expect(denied.requiresApproval).toBe(true);
    const approved = engine.evaluateAction(ref, "file_write", { automation: false, approved: true });
    expect(approved.allowed).toBe(true);
  });

  it("enforces server allowlists with glob patterns", () => {
    const restricted = PolicyEngine.fromConfig(
      ConfigSchema.parse({
        panels: { mock: { url: "https://panel.example.com", clientKey: "ptlc_test_key_123456" } },
        policy: { allowedServers: ["mock/*"] },
      }),
    );
    expect(restricted.evaluateServerAccess({ ...ref, serverId: "survival" }).allowed).toBe(true);
    expect(restricted.evaluateServerAccess({ ...ref, panel: "other" }).allowed).toBe(false);
  });

  it("enforces restart budgets", () => {
    const decision = engine.evaluatePower(ref, "restart", {
      automation: false,
      approved: true,
      recentRestarts: config.policy.maxRestartsPerHour,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toBe("restart.budget");
  });

  it("denies automation inside maintenance windows", () => {
    const windowEngine = PolicyEngine.fromConfig(
      ConfigSchema.parse({
        panels: { mock: { url: "https://panel.example.com", clientKey: "ptlc_test_key_123456" } },
        maintenanceWindows: [
          { name: "business-hours", servers: ["mock/*"], denyAutomation: ["00:00-23:59"] },
        ],
      }),
    );
    const decision = windowEngine.evaluateAction(ref, "restart_server", { automation: true });
    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toBe("maintenance.window");
  });

  it("emergency override bypasses maintenance windows", () => {
    const overrideEngine = PolicyEngine.fromConfig(
      ConfigSchema.parse({
        panels: { mock: { url: "https://panel.example.com", clientKey: "ptlc_test_key_123456" } },
        maintenanceWindows: [
          { name: "business-hours", servers: ["mock/*"], denyAutomation: ["00:00-23:59"] },
        ],
        emergencyOverride: true,
      }),
    );
    const decision = overrideEngine.evaluateAction(ref, "restart_server", {
      automation: true,
      approved: true,
    });
    expect(decision.allowed).toBe(true);
  });
});
