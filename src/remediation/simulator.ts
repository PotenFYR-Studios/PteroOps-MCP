import type { ApplicationProfileRegistry } from "../applications/profiles/index.js";
import type { SafeFileEditor } from "../files/editor.js";
import type { Logger } from "../observability/logger.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { PolicyEngine } from "../security/policy.js";
import type { ServerRef } from "../shared/types.js";
import type { RemediationPlan } from "./types.js";

export interface SimulationCheck {
  name: string;
  status: "ok" | "warn" | "conflict" | "unknown";
  detail: string;
}

export interface SimulationResult {
  planId: string;
  checks: SimulationCheck[];
  conflicts: number;
  warnings: number;
  summary: string;
}

export interface RemediationSimulatorDeps {
  panels: PanelRegistry;
  editor: SafeFileEditor;
  profiles: ApplicationProfileRegistry;
  policy: PolicyEngine;
  logger: Logger;
}

export class RemediationSimulator {
  constructor(private readonly deps: RemediationSimulatorDeps) {}

  async simulate(ref: ServerRef, plan: RemediationPlan): Promise<SimulationResult> {
    const checks: SimulationCheck[] = [];

    for (const action of plan.actions) {
      switch (action.type) {
        case "file_edit": {
          const params = action.params as {
            path: string;
            expectedHash: string;
            edits?: Array<{ find: string; replace: string; replaceAll?: boolean }>;
            content?: string;
          };
          try {
            const preview = await this.deps.editor.preview(ref, {
              path: params.path,
              expectedHash: params.expectedHash,
              ...(params.edits ? { edits: params.edits } : {}),
              ...(params.content !== undefined ? { content: params.content } : {}),
            });
            checks.push({
              name: `edit ${params.path}`,
              status: "ok",
              detail: `patch applies cleanly (${preview.additions} additions, ${preview.removals} removals); file will change hash ${preview.beforeHash.slice(0, 8)} → ${preview.afterHash.slice(0, 8)}`,
            });
            const portChange = detectPortChange(params.edits, params.content);
            if (portChange) {
              checks.push(await this.checkPortChange(ref, portChange));
            }
            if (params.path === "server.properties" || params.path === "/server.properties") {
              checks.push({
                name: "config syntax",
                status: "ok",
                detail: "server.properties uses key=value lines; edits are applied verbatim and verified by re-read",
              });
            }
          } catch (error) {
            checks.push({
              name: `edit ${params.path}`,
              status: "conflict",
              detail: `patch cannot apply: ${(error as Error).message}`,
            });
          }
          break;
        }
        case "file_revert": {
          const params = action.params as { path: string; snapshotId: string; expectedHash: string };
          try {
            const current = await this.deps.editor.inspect(ref, params.path);
            checks.push({
              name: `revert ${params.path}`,
              status: current.hash === params.expectedHash ? "ok" : "conflict",
              detail:
                current.hash === params.expectedHash
                  ? "file is unchanged since the plan was created; revert will apply"
                  : `file changed since the plan was created (expected ${params.expectedHash.slice(0, 8)}, found ${current.hash.slice(0, 8)})`,
            });
          } catch (error) {
            checks.push({
              name: `revert ${params.path}`,
              status: "conflict",
              detail: `cannot inspect file: ${(error as Error).message}`,
            });
          }
          break;
        }
        case "startup_variable_change": {
          const params = action.params as { key: string; value: string };
          if (/memory/i.test(params.key)) {
            const numeric = Number(params.value.replace(/[^\d]/g, ""));
            checks.push({
              name: `startup variable ${params.key}`,
              status: Number.isFinite(numeric) && numeric > 0 ? "warn" : "conflict",
              detail:
                Number.isFinite(numeric) && numeric > 0
                  ? `memory changes require a restart and must stay within the server's allocation; new value "${params.value}"`
                  : `value "${params.value}" does not look like a memory amount`,
            });
          } else {
            checks.push({
              name: `startup variable ${params.key}`,
              status: "ok",
              detail: `will set ${params.key} = "${params.value}" (restart required)`,
            });
          }
          break;
        }
        case "restart_server":
          checks.push({
            name: "restart",
            status: "warn",
            detail: plan.blastRadius
              ? `restart interrupts this server${plan.blastRadius.dependents.length > 0 ? ` and may affect ${plan.blastRadius.dependents.length} dependent component(s)` : ""}`
              : "restart interrupts this server",
          });
          break;
        case "restore_backup": {
          const params = action.params as { backupUuid: string };
          const panel = this.deps.panels.get(ref.panel);
          if (panel.clientApi && panel.capabilities.has("client.backups")) {
            const backups = await panel.clientApi.listBackups(ref).catch(() => []);
            const backup = backups.find((candidate) => candidate.uuid === params.backupUuid);
            checks.push({
              name: "restore backup",
              status: backup ? "ok" : "conflict",
              detail: backup
                ? `backup "${backup.name}" exists (${Math.round(backup.bytes / 1024 / 1024)} MB, ${backup.createdAt ? new Date(backup.createdAt).toISOString() : "unknown date"}); restore stops the server first`
                : `backup ${params.backupUuid} was not found on the panel`,
            });
          } else {
            checks.push({
              name: "restore backup",
              status: "unknown",
              detail: "backup listing requires client.backups capability",
            });
          }
          break;
        }
        case "send_command": {
          const params = action.params as { command: string };
          const decision = this.deps.policy.evaluateCommand(ref, params.command, {
            automation: true,
            approved: true,
          });
          checks.push({
            name: "console command",
            status: decision.allowed ? "ok" : "conflict",
            detail: decision.allowed
              ? `command passes policy: "${params.command}"`
              : `command blocked by policy: ${decision.reason}`,
          });
          break;
        }
        case "create_backup":
          checks.push({
            name: "create backup",
            status: plan.risk === "HIGH" || plan.risk === "CRITICAL" ? "ok" : "warn",
            detail: "creates a backup before performing the risky change",
          });
          break;
      }
    }

    if (plan.blastRadius && plan.blastRadius.dependents.length > 0) {
      checks.push({
        name: "blast radius",
        status: plan.blastRadius.maintenanceRequired ? "warn" : "ok",
        detail: plan.blastRadius.estimatedImpact,
      });
    }

    const conflicts = checks.filter((check) => check.status === "conflict").length;
    const warnings = checks.filter((check) => check.status === "warn").length;
    const summary =
      conflicts > 0
        ? `${conflicts} conflict(s) detected: this plan would likely fail or be unsafe as specified`
        : warnings > 0
          ? `plan is applicable with ${warnings} warning(s)`
          : "plan is applicable; no conflicts detected";

    return { planId: plan.id, checks, conflicts, warnings, summary };
  }

  private async checkPortChange(
    ref: ServerRef,
    portChange: number,
  ): Promise<SimulationCheck> {
    try {
      const panel = this.deps.panels.requireCapability(ref.panel, {
        allOf: ["client.server.read"],
      });
      const detail = await panel.clientApi!.getServer(ref, { includeAllocations: true });
      const allocations = detail.allocations ?? [];
      const match = allocations.find((allocation) => allocation.port === portChange);
      if (match) {
        return {
          name: `port ${portChange}`,
          status: "ok",
          detail: `port ${portChange} is an allocation of this server; configuration and allocation agree`,
        };
      }
      const primary = detail.primaryAllocation;
      return {
        name: `port ${portChange}`,
        status: "conflict",
        detail: `port ${portChange} is not allocated to this server (allocations: ${allocations.map((allocation) => allocation.port).join(", ") || "none"}); the application would fail to bind or be unreachable${primary ? ` (primary is ${primary.port})` : ""}`,
      };
    } catch (error) {
      return {
        name: `port ${portChange}`,
        status: "unknown",
        detail: `could not verify allocations: ${(error as Error).message}`,
      };
    }
  }
}

function detectPortChange(
  edits: Array<{ find: string; replace: string; replaceAll?: boolean }> | undefined,
  content: string | undefined,
): number | null {
  const portPattern = /\b(?:server[-_]port|port)\s*[=:]\s*"?(\d{2,5})"?/i;
  if (edits) {
    for (const edit of edits) {
      if (/port/i.test(edit.find)) {
        const match = portPattern.exec(edit.replace) ?? /(\d{2,5})/.exec(edit.replace);
        if (match) return Number(match[1]);
      }
    }
  }
  if (content) {
    const match = portPattern.exec(content);
    if (match) return Number(match[1]);
  }
  return null;
}
