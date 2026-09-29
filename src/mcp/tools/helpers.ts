import { z } from "zod";
import type { Services } from "../../container.js";
import type { PanelConnection } from "../../pterodactyl/panels.js";
import { resolveServerArgument } from "../../pterodactyl/client-api.js";
import type { StartupVariable } from "../../pterodactyl/types.js";
import type { ServerRef } from "../../shared/types.js";
import { ValidationError } from "../../shared/errors.js";
import type { CapabilityRequirement } from "../../security/capabilities.js";

export const serverArg = z
  .string()
  .min(1)
  .describe('Server reference: "panel/serverId" or just "serverId" for the default panel.');

export function resolveRef(services: Services, server: string): ServerRef {
  return resolveServerArgument(services.config, server, services.defaultPanel);
}

export function requirePanel(
  services: Services,
  ref: ServerRef,
  requirement: CapabilityRequirement,
): PanelConnection {
  return services.panels.requireCapability(ref.panel, requirement);
}

const SENSITIVE_VARIABLE_RE = /pass|secret|token|key|rcon|dsn|credential/i;

export function redactVariables(variables: StartupVariable[]): StartupVariable[] {
  return variables.map((variable) =>
    SENSITIVE_VARIABLE_RE.test(variable.envVariable)
      ? { ...variable, serverValue: variable.serverValue ? "[REDACTED]" : "" }
      : variable,
  );
}

export function assertSafePath(input: string): string {
  if (input.includes("\0")) {
    throw new ValidationError("Path contains a null byte");
  }
  if (input.length > 512) {
    throw new ValidationError("Path is too long (max 512 characters)");
  }
  const normalized = input.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new ValidationError("Path traversal is not allowed");
  }
  for (const part of parts) {
    if (/[\u0000-\u001f<>|"*?]/.test(part)) {
      throw new ValidationError(`Path segment contains invalid characters: ${part}`);
    }
  }
  return `/${parts.join("/")}`;
}

export function policySnapshot(services: Services): Record<string, unknown> {
  const { policy, approval, maintenanceWindows, emergencyOverride } = services.config;
  return {
    allowedServers: policy.allowedServers,
    protectedPaths: policy.protectedPaths,
    blockedCommandPatterns: policy.blockedCommands,
    allowedCommandPatterns: policy.allowedCommands,
    allowAllCommandsUnlessBlocked: policy.allowedCommands.length === 0,
    maxRestartsPerHour: policy.maxRestartsPerHour,
    maxFileSizeBytes: policy.maxFileSizeBytes,
    autoApprove: approval.autoApprove,
    requireApproval: approval.requireApproval,
    deny: approval.deny,
    maintenanceWindows: maintenanceWindows.map((window) => ({
      name: window.name,
      servers: window.servers,
      denyAutomation: window.denyAutomation,
      allowAutoLowRisk: window.allowAutoLowRisk,
    })),
    emergencyOverride,
  };
}

export function incidentTenantCandidates(services: Services): string[] {
  const tenants = new Set<string>([services.config.tenant]);
  for (const panel of services.panels.list()) tenants.add(panel.tenant);
  return [...tenants];
}

export function truncateLine(line: string, max = 400): string {
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

export function boundedList<T>(items: T[], limit: number): { items: T[]; truncated: boolean } {
  return { items: items.slice(0, limit), truncated: items.length > limit };
}
