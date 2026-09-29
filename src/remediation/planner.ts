import type { ApprovalConfig, RemediationConfig } from "../config/schema.js";
import type { Logger } from "../observability/logger.js";
import type { FileSnapshotRepository } from "../persistence/repositories/snapshots.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { PolicyEngine } from "../security/policy.js";
import type { SafeFileEditor, PatchPreview } from "../files/editor.js";
import type { ServerRef } from "../shared/types.js";
import { ValidationError } from "../shared/errors.js";
import {
  computePlanRisk,
  createPlanId,
  describeRollbackStrategy,
  riskActionKeyForRemediationAction,
} from "./plan-utils.js";
import type { BlastRadiusAnalyzer } from "./blast-radius.js";
import type { RemediationEffectiveness } from "./effectiveness.js";
import type {
  FileEditOperation,
  RemediationAction,
  RemediationPlan,
} from "./types.js";

export interface RemediationPlannerDeps {
  panels: PanelRegistry;
  editor: SafeFileEditor;
  snapshots: FileSnapshotRepository;
  policy: PolicyEngine;
  blastRadius: BlastRadiusAnalyzer;
  effectiveness: RemediationEffectiveness;
  approvalConfig: ApprovalConfig;
  remediationConfig: RemediationConfig;
  logger: Logger;
  clock?: () => number;
}

export interface EnrichPlanInput {
  ref: ServerRef;
  actions: RemediationAction[];
  reason: string;
  expectedEffect: string;
  incidentId?: string | null;
  evidence?: Array<{ source: string; detail: string }>;
}

export interface FileEditPlanResult {
  plan: RemediationPlan;
  preview: PatchPreview;
}

export class RemediationPlanner {
  private readonly clock: () => number;

  constructor(private readonly deps: RemediationPlannerDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async buildFileEditPlan(
    ref: ServerRef,
    input: {
      path: string;
      edits?: FileEditOperation[];
      content?: string;
      reason: string;
      incidentId?: string | null;
      evidence?: Array<{ source: string; detail: string }>;
    },
  ): Promise<FileEditPlanResult> {
    if (!input.edits && input.content === undefined) {
      throw new ValidationError("Provide edits or content for the file change");
    }
    const current = await this.deps.editor.inspect(ref, input.path);
    const preview = await this.deps.editor.preview(ref, {
      path: input.path,
      expectedHash: current.hash,
      ...(input.edits ? { edits: input.edits } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
    });
    const snapshotId =
      (await this.deps.snapshots.latestForPath(ref, input.path))?.id ?? null;
    const action: RemediationAction = {
      type: "file_edit",
      description: `edit ${input.path} (+${preview.additions}/-${preview.removals} lines)`,
      risk: "MEDIUM",
      requiresRestart: needsRestartForPath(input.path),
      params: {
        path: input.path,
        expectedHash: current.hash,
        ...(input.edits ? { edits: input.edits } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
      },
      rollback:
        snapshotId !== null
          ? [
              {
                type: "reverse_patch",
                description: `restore ${input.path} from pre-change snapshot`,
                params: { path: input.path, snapshotId },
              },
            ]
          : [
              {
                type: "reverse_patch",
                description: `restore ${input.path} using the snapshot taken at apply time`,
                params: { path: input.path },
              },
            ],
    };
    const plan = await this.enrich({
      ref,
      actions: [action],
      reason: input.reason,
      expectedEffect: `file ${input.path} updated and verified by re-read`,
      ...(input.incidentId !== undefined ? { incidentId: input.incidentId } : {}),
      ...(input.evidence ? { evidence: input.evidence } : {}),
    });
    return { plan, preview };
  }

  async buildFileRevertPlan(
    ref: ServerRef,
    input: { path: string; reason: string; incidentId?: string | null; snapshotId?: string },
  ): Promise<RemediationPlan> {
    const snapshot = input.snapshotId
      ? await this.deps.snapshots.get(ref.tenant, input.snapshotId)
      : await this.deps.snapshots.latestForPath(ref, input.path);
    if (!snapshot || snapshot.path !== input.path) {
      throw new ValidationError(
        `No file snapshot is available for ${input.path}; only files changed through PteroOps can be reverted automatically`,
      );
    }
    if (snapshot.content === null) {
      throw new ValidationError(
        `Snapshot ${snapshot.id} has no stored content (too large) and cannot be reverted`,
      );
    }
    const current = await this.deps.editor.inspect(ref, input.path);
    const action: RemediationAction = {
      type: "file_revert",
      description: `revert ${input.path} to snapshot ${snapshot.id} (taken ${new Date(snapshot.createdAt).toISOString()})`,
      risk: "MEDIUM",
      requiresRestart: needsRestartForPath(input.path),
      params: { path: input.path, snapshotId: snapshot.id, expectedHash: current.hash },
      rollback: [],
    };
    return this.enrich({
      ref,
      actions: [action],
      reason: input.reason,
      expectedEffect: `file ${input.path} restored to its previous content`,
      ...(input.incidentId !== undefined ? { incidentId: input.incidentId } : {}),
    });
  }

  async buildStartupVariablePlan(
    ref: ServerRef,
    input: { key: string; value: string; reason: string; incidentId?: string | null },
  ): Promise<RemediationPlan> {
    const panel = this.deps.panels.requireCapability(ref.panel, { allOf: ["client.server.read"] });
    const startup = await panel.clientApi!.getStartup(ref);
    const variable = startup.variables.find(
      (candidate) =>
        candidate.envVariable.toLowerCase() === input.key.toLowerCase() ||
        candidate.name.toLowerCase() === input.key.toLowerCase(),
    );
    const action: RemediationAction = {
      type: "startup_variable_change",
      description: `set startup variable ${input.key} from "${variable?.serverValue ?? "(current)"}" to "${input.value}"`,
      risk: "MEDIUM",
      requiresRestart: true,
      params: {
        key: variable?.envVariable ?? input.key,
        value: input.value,
        previousValue: variable?.serverValue ?? null,
      },
      rollback: [
        {
          type: "restore_startup_variable",
          description: `restore startup variable ${input.key} to its previous value`,
          params: {
            key: variable?.envVariable ?? input.key,
            value: variable?.serverValue ?? variable?.defaultValue ?? "",
          },
        },
      ],
    };
    return this.enrich({
      ref,
      actions: [action],
      reason: input.reason,
      expectedEffect: `startup variable ${input.key} changed and server restarted`,
      ...(input.incidentId !== undefined ? { incidentId: input.incidentId } : {}),
    });
  }

  async buildRestartPlan(
    ref: ServerRef,
    input: { reason: string; incidentId?: string | null },
  ): Promise<RemediationPlan> {
    const current = this.deps.panels.requireCapability(ref.panel, {
      allOf: ["client.server.read"],
    });
    const detail = await current.clientApi!.getServer(ref, { includeAllocations: false });
    const action: RemediationAction = {
      type: "restart_server",
      description: `restart server ${detail.name}`,
      risk: "MEDIUM",
      requiresRestart: false,
      params: {},
      rollback: [],
    };
    return this.enrich({
      ref,
      actions: [action],
      reason: input.reason,
      expectedEffect: "server process restarted and becomes healthy",
      ...(input.incidentId !== undefined ? { incidentId: input.incidentId } : {}),
    });
  }

  async buildRestoreBackupPlan(
    ref: ServerRef,
    input: { backupUuid: string; reason: string; incidentId?: string | null },
  ): Promise<RemediationPlan> {
    const panel = this.deps.panels.requireCapability(ref.panel, { allOf: ["client.backups"] });
    const backups = await panel.clientApi!.listBackups(ref);
    const backup = backups.find((candidate) => candidate.uuid === input.backupUuid);
    if (!backup) {
      throw new ValidationError(`Backup ${input.backupUuid} not found for this server`);
    }
    const action: RemediationAction = {
      type: "restore_backup",
      description: `stop the server, restore backup "${backup.name}" (${Math.round(backup.bytes / 1024 / 1024)} MB, created ${backup.createdAt ? new Date(backup.createdAt).toISOString() : "unknown"}), then start it again`,
      risk: "HIGH",
      requiresRestart: true,
      params: { backupUuid: input.backupUuid },
      rollback: [
        {
          type: "restore_backup",
          description: "manual recovery only: a backup restore cannot be automatically reversed",
          params: { manual: true },
        },
      ],
    };
    return this.enrich({
      ref,
      actions: [action],
      reason: input.reason,
      expectedEffect: "server data restored from backup and healthy",
      ...(input.incidentId !== undefined ? { incidentId: input.incidentId } : {}),
    });
  }

  async enrich(input: EnrichPlanInput): Promise<RemediationPlan> {
    if (input.actions.length === 0) {
      throw new ValidationError("A remediation plan needs at least one action");
    }
    if (input.actions.length > this.deps.remediationConfig.maxActionsPerPlan) {
      throw new ValidationError(
        `Plan has ${input.actions.length} actions, more than remediation.maxActionsPerPlan (${this.deps.remediationConfig.maxActionsPerPlan})`,
      );
    }
    const now = this.clock();
    const risk = computePlanRisk(input.actions);
    const requiresApproval = input.actions.some((action) => {
      const key = riskActionKeyForRemediationAction(action.type);
      return this.deps.policy.requiresApproval(key, action.risk);
    });
    const dryRunSummary = [
      ...input.actions.map(
        (action, index) => `${index + 1}. ${action.description} [${action.risk}${action.requiresRestart ? ", restart required" : ""}]`,
      ),
    ];
    const effectivenessHint = await this.deps.effectiveness.hintFor(input.actions);
    if (effectivenessHint) dryRunSummary.push(effectivenessHint);

    let blastRadius = null;
    try {
      blastRadius = await this.deps.blastRadius.analyze(input.ref, input.actions[0]!.type);
      for (const line of blastLines(blastRadius)) dryRunSummary.push(line);
    } catch (error) {
      this.deps.logger.debug("blast radius analysis unavailable", {
        error: (error as Error).message,
      });
    }

    return {
      id: createPlanId(),
      ref: input.ref,
      incidentId: input.incidentId ?? null,
      reason: input.reason,
      actions: input.actions,
      risk,
      expectedEffect: input.expectedEffect,
      rollbackStrategy: describeRollbackStrategy(input.actions),
      requiresApproval,
      dryRunSummary,
      blastRadius,
      evidence: input.evidence ?? [],
      expiresAt: now + this.deps.approvalConfig.defaultExpiryMinutes * 60_000,
      createdAt: now,
    };
  }
}

function blastLines(blast: {
  direct: string;
  dependents: string[];
  sameNode: string[];
  estimatedImpact: string;
  maintenanceRequired: boolean;
}): string[] {
  const lines = [`blast radius: ${blast.estimatedImpact}`];
  if (blast.dependents.length > 0) lines.push(`dependents: ${blast.dependents.join("; ")}`);
  if (blast.sameNode.length > 0) lines.push(`co-located servers: ${blast.sameNode.join(", ")}`);
  if (blast.maintenanceRequired) lines.push("maintenance window recommended");
  return lines;
}

function needsRestartForPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".jar") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".properties") ||
    lower.endsWith(".json") ||
    lower.endsWith(".toml") ||
    lower.includes("/config/") ||
    lower === "/server.properties"
  );
}
