import type { RemediationConfig } from "../config/schema.js";
import type { ApprovalService } from "../approvals/service.js";
import type { ChangeLedger } from "../changes/ledger.js";
import type { SafeFileEditor } from "../files/editor.js";
import type { HealthService } from "../health/service.js";
import type { CrashLoopTracker } from "../intelligence/crash-loop/tracker.js";
import type { IncidentService } from "../incidents/service.js";
import type { Logger } from "../observability/logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { ApprovalRecord, Incident } from "../persistence/models.js";
import type { RemediationRepository } from "../persistence/repositories/remediations.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { PolicyEngine } from "../security/policy.js";
import { PolicyDeniedError, ValidationError, PteroOpsError } from "../shared/errors.js";
import { sleep } from "../shared/async.js";
import type { ServerRef } from "../shared/types.js";
import { riskActionKeyForRemediationAction } from "./plan-utils.js";
import type { TestEngine } from "./verification.js";
import type {
  RemediationAction,
  RemediationExecutionReport,
  RemediationPlan,
  RollbackStep,
} from "./types.js";

export interface RemediationExecutorDeps {
  panels: PanelRegistry;
  editor: SafeFileEditor;
  approvals: ApprovalService;
  remediations: RemediationRepository;
  incidents: IncidentService;
  changes: ChangeLedger;
  health: HealthService;
  crashTracker: CrashLoopTracker;
  policy: PolicyEngine;
  tests: TestEngine;
  config: RemediationConfig;
  metrics?: MetricsRegistry;
  logger: Logger;
  clock?: () => number;
  sleeper?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface ExecuteRemediationInput {
  plan: RemediationPlan;
  actor: string;
  dryRun?: boolean;
  approvalId?: string | null;
  signal?: AbortSignal;
}

interface ExecutedAction {
  action: RemediationAction;
  detail: Record<string, unknown>;
}

interface VerificationOutcome {
  passed: boolean;
  detail: string;
}

interface RollbackOutcome {
  complete: boolean;
  detail: string;
}

export class RemediationExecutor {
  private readonly clock: () => number;
  private readonly sleeper: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly deps: RemediationExecutorDeps) {
    this.clock = deps.clock ?? Date.now;
    this.sleeper =
      deps.sleeper ?? ((ms: number, signal?: AbortSignal) => (signal ? sleep(ms, signal) : sleep(ms)));
  }

  async execute(input: ExecuteRemediationInput): Promise<RemediationExecutionReport> {
    const { plan, actor } = input;
    const ref = plan.ref;
    const tenant = ref.tenant;
    const now = this.clock();
    const steps: Array<{ seq: number; kind: string; status: string; detail: string }> = [];
    let seq = 0;
    const step = (
      kind: string,
      status: "ok" | "failed" | "skipped" | "rolled_back",
      detail: unknown,
    ): void => {
      seq += 1;
      void this.deps.remediations
        .addStep({
          remediationId: plan.id,
          seq,
          kind,
          status,
          detail: (detail ?? {}) as Record<string, unknown>,
          ts: this.clock(),
        })
        .catch((error: unknown) => {
          this.deps.logger.warn("failed to persist remediation step", {
            error: (error as Error).message,
          });
        });
      steps.push({
        seq,
        kind,
        status,
        detail: typeof detail === "string" ? detail : JSON.stringify(detail ?? {}),
      });
    };

    for (const action of plan.actions) {
      const key = riskActionKeyForRemediationAction(action.type);
      const decision = this.deps.policy.evaluateAction(ref, key, {
        automation: true,
        approved: true,
      });
      if (decision.policyId === "approval.denied") {
        throw new PolicyDeniedError(decision.policyId, decision.reason);
      }
    }

    let approvalRecord: ApprovalRecord | null = null;
    if (plan.requiresApproval && !input.dryRun && !input.approvalId) {
      throw new PolicyDeniedError(
        "approval.required",
        `This plan is ${plan.risk} risk and requires approval before execution.`,
        {
          hint: "Propose it (ptero_propose_remediation), get it approved (ptero_approve_action), then execute with the approvalId.",
        },
      );
    }
    if (input.approvalId) {
      approvalRecord = input.dryRun
        ? await this.deps.approvals.find(tenant, input.approvalId)
        : await this.deps.approvals.assertUsable(tenant, input.approvalId);
      if (approvalRecord && approvalRecord.plan.id !== plan.id) {
        throw new ValidationError(
          `Approval ${input.approvalId} was issued for plan ${approvalRecord.plan.id}, not ${plan.id}`,
        );
      }
    }

    const existingRecord = await this.deps.remediations.get(tenant, plan.id);
    if (existingRecord) {
      await this.deps.remediations.updatePlan(tenant, plan.id, plan);
      await this.setState(
        tenant,
        plan.id,
        input.dryRun ? "planned" : "executing",
        null,
        null,
      );
    } else {
      await this.deps.remediations.create({
        id: plan.id,
        ref,
        incidentId: plan.incidentId,
        approvalId: input.approvalId ?? null,
        plan,
        state: input.dryRun ? "planned" : "executing",
        risk: plan.risk,
        rollbackStrategy: plan.rollbackStrategy,
        startedAt: now,
      });
    }

    const incident = plan.incidentId ? await this.deps.incidents.find(tenant, plan.incidentId) : null;
    if (incident && !input.dryRun) {
      await this.safeTransition(incident, "remediating", actor, "remediation execution started");
    }

    const healthBefore = await this.safeHealthStatus(ref);

    if (input.dryRun) {
      for (const action of plan.actions) {
        step(`${action.type} (dry-run)`, "skipped", {
          description: action.description,
          risk: action.risk,
          requiresRestart: action.requiresRestart,
          ...(await this.dryRunDetail(ref, action)),
        });
      }
      await this.setState(
        tenant,
        plan.id,
        "planned",
        {
          success: true,
          summary: "dry-run only; nothing was changed",
          healthAfter: healthBefore,
          rollbackVerified: null,
          error: null,
        },
        this.clock(),
      );
      return {
        remediationId: plan.id,
        state: "planned",
        success: true,
        steps,
        healthBefore,
        healthAfter: healthBefore,
        rolledBack: false,
        rollbackVerified: null,
        summary: "dry-run complete: inspect the steps, then execute without dryRun",
        dryRun: true,
      };
    }

    const executed: ExecutedAction[] = [];
    let failure: PteroOpsError | null = null;

    if (plan.risk === "HIGH" || plan.risk === "CRITICAL") {
      const backupResult = await this.ensureFreshBackup(ref).catch((error) => ({
        skipped: true,
        reason: (error as Error).message,
      }));
      step("preflight:backup", "ok", backupResult);
    }

    for (const action of plan.actions) {
      try {
        const detail = await this.applyAction(ref, action, plan, actor);
        executed.push({ action, detail });
        step(`action:${action.type}`, "ok", detail);
      } catch (error) {
        failure = toPteroError(error);
        step(`action:${action.type}`, "failed", { error: failure.message });
        break;
      }
    }

    let restarted = executed.some((entry) => entry.action.type === "restart_server");
    if (!failure && plan.actions.some((action) => action.requiresRestart) && !restarted) {
      try {
        await this.powerAction(ref, "restart", "auto restart after change");
        restarted = true;
        step("action:restart_server (auto)", "ok", { reason: "changes require a restart" });
      } catch (error) {
        failure = toPteroError(error);
        step("action:restart_server (auto)", "failed", { error: failure.message });
      }
    }

    await this.deps.remediations.updatePlan(tenant, plan.id, plan);

    if (!failure) {
      await this.setState(tenant, plan.id, "verifying", null, null);
      if (incident) {
        await this.safeTransition(incident, "verifying", "system", "verification running");
      }
      const verification = await this.verifyHealthy(
        ref,
        input.signal ?? new AbortController().signal,
      );
      step("verification", verification.passed ? "ok" : "failed", verification.detail);
      if (verification.passed) {
        const tests = await this.deps.tests.run(ref, "post").catch((error) => ({
          passed: false,
          checks: [{ name: "post-tests", passed: false, detail: (error as Error).message }],
          suite: "post" as const,
          ranAt: this.clock(),
          durationMs: 0,
        }));
        const failedChecks = tests.checks.filter((check) => !check.passed);
        step("post-change-tests", tests.passed ? "ok" : "failed", {
          passed: tests.passed,
          failedChecks: failedChecks.map((check) => `${check.name}: ${check.detail}`),
        });
        if (!tests.passed) {
          failure = new ValidationError(
            `Post-change verification failed: ${failedChecks.map((check) => check.name).join(", ")}`,
          );
        }
      } else {
        failure = new ValidationError(`Health verification failed: ${verification.detail}`);
      }
    }

    const healthAfter = await this.safeHealthStatus(ref);

    if (!failure) {
      await this.setState(
        tenant,
        plan.id,
        "succeeded",
        {
          success: true,
          summary: `remediation applied and verified; health is ${healthAfter}`,
          healthAfter,
          rollbackVerified: null,
          error: null,
        },
        this.clock(),
      );
      if (approvalRecord) {
        await this.deps.approvals.markExecuted(tenant, approvalRecord.id);
      }
      if (incident) {
        await this.deps.incidents.recordRemediationAttempt(incident, {
          remediationId: plan.id,
          description: plan.actions.map((action) => action.description).join("; "),
          result: "succeeded",
        });
        await this.deps.incidents.recordVerification(incident, {
          passed: true,
          detail: `health after remediation: ${healthAfter}`,
        });
        const fresh = await this.deps.incidents.get(tenant, incident.id);
        await this.safeTransition(fresh, "resolved", "system", "remediation verified and resolved");
      }
      this.deps.logger.info("remediation succeeded", {
        remediationId: plan.id,
        healthAfter,
      });
      return {
        remediationId: plan.id,
        state: "succeeded",
        success: true,
        steps,
        healthBefore,
        healthAfter,
        rolledBack: false,
        rollbackVerified: null,
        summary: `remediation succeeded; health is ${healthAfter}`,
        dryRun: false,
      };
    }

    await this.setState(tenant, plan.id, "rolling_back", null, null);
    const rollbackOutcome = await this.rollback(ref, plan, executed, actor);
    step("rollback", rollbackOutcome.complete ? "ok" : "failed", rollbackOutcome.detail);
    const finalHealth = await this.safeHealthStatus(ref);
    const finalState = rollbackOutcome.complete && executed.length > 0 ? "rolled_back" : "failed";
    await this.setState(
      tenant,
      plan.id,
      finalState,
      {
        success: false,
        summary: rollbackOutcome.complete
          ? `remediation failed (${failure.message}); rolled back successfully`
          : `remediation failed (${failure.message}); rollback incomplete: ${rollbackOutcome.detail}`,
        healthAfter: finalHealth,
        rollbackVerified: rollbackOutcome.complete,
        error: failure.message,
      },
      this.clock(),
    );

    if (incident) {
      await this.deps.incidents.recordRemediationAttempt(incident, {
        remediationId: plan.id,
        description: plan.actions.map((action) => action.description).join("; "),
        result: rollbackOutcome.complete ? "failed and rolled back" : "failed; rollback incomplete",
      });
      await this.deps.incidents.recordVerification(incident, {
        passed: false,
        detail: rollbackOutcome.detail,
      });
      const fresh = await this.deps.incidents.get(tenant, incident.id);
      await this.safeTransition(
        fresh,
        rollbackOutcome.complete ? "rolled_back" : "failed",
        "system",
        rollbackOutcome.detail,
      );
    }
    this.deps.logger.warn("remediation failed", {
      remediationId: plan.id,
      error: failure.message,
      rolledBack: rollbackOutcome.complete,
    });

    return {
      remediationId: plan.id,
      state: finalState,
      success: false,
      steps,
      healthBefore,
      healthAfter: finalHealth,
      rolledBack: true,
      rollbackVerified: rollbackOutcome.complete,
      summary: rollbackOutcome.complete
        ? `remediation failed and was rolled back: ${failure.message}`
        : `remediation failed and rollback was incomplete: ${failure.message}`,
      dryRun: false,
    };
  }

  async rollbackRemediation(
    tenant: string,
    remediationId: string,
    actor: string,
  ): Promise<RemediationExecutionReport> {
    const record = await this.deps.remediations.get(tenant, remediationId);
    if (!record) {
      throw new ValidationError(`Remediation ${remediationId} not found`);
    }
    const ref = record.ref;
    const steps: Array<{ seq: number; kind: string; status: string; detail: string }> = [];
    let seq = 0;
    const step = (
      kind: string,
      status: "ok" | "failed" | "skipped" | "rolled_back",
      detail: unknown,
    ): void => {
      seq += 1;
      void this.deps.remediations
        .addStep({
          remediationId,
          seq: 1000 + seq,
          kind,
          status,
          detail: (detail ?? {}) as Record<string, unknown>,
          ts: this.clock(),
        })
        .catch(() => undefined);
      steps.push({
        seq: 1000 + seq,
        kind,
        status,
        detail: typeof detail === "string" ? detail : JSON.stringify(detail ?? {}),
      });
    };

    if (record.state === "rolled_back") {
      return {
        remediationId,
        state: "rolled_back",
        success: true,
        steps,
        healthBefore: await this.safeHealthStatus(ref),
        healthAfter: await this.safeHealthStatus(ref),
        rolledBack: true,
        rollbackVerified: true,
        summary: "remediation was already rolled back",
        dryRun: false,
      };
    }

    const executed: ExecutedAction[] = record.plan.actions.map((action) => ({
      action,
      detail: {},
    }));
    await this.setState(tenant, remediationId, "rolling_back", record.result, null);
    const outcome = await this.rollback(ref, record.plan, executed, actor);
    step("manual-rollback", outcome.complete ? "ok" : "failed", outcome.detail);
    const healthAfter = await this.safeHealthStatus(ref);
    const finalState = outcome.complete ? "rolled_back" : "failed";
    await this.setState(
      tenant,
      remediationId,
      finalState,
      {
        success: outcome.complete,
        summary: outcome.complete
          ? `manual rollback completed: ${outcome.detail}`
          : `manual rollback incomplete: ${outcome.detail}`,
        healthAfter,
        rollbackVerified: outcome.complete,
        error: outcome.complete ? null : outcome.detail,
      },
      this.clock(),
    );

    if (record.incidentId) {
      const incident = await this.deps.incidents.find(tenant, record.incidentId);
      if (incident) {
        await this.deps.incidents.recordRemediationAttempt(incident, {
          remediationId,
          description: `manual rollback of ${remediationId}`,
          result: outcome.complete ? "rolled back" : "rollback incomplete",
        });
        await this.safeTransition(incident, "rolled_back", actor, outcome.detail);
      }
    }

    return {
      remediationId,
      state: finalState,
      success: outcome.complete,
      steps,
      healthBefore: healthAfter,
      healthAfter,
      rolledBack: outcome.complete,
      rollbackVerified: outcome.complete,
      summary: outcome.complete
        ? `rollback completed: ${outcome.detail}`
        : `rollback incomplete: ${outcome.detail}`,
      dryRun: false,
    };
  }

  private async setState(
    tenant: string,
    id: string,
    state: Parameters<RemediationRepository["updateState"]>[2],
    result: Parameters<RemediationRepository["updateState"]>[3],
    finishedAt: number | null,
  ): Promise<void> {
    await this.deps.remediations.updateState(tenant, id, state, result, finishedAt);
    this.deps.metrics?.increment("pteroops_remediations_total", 1, { state });
    if (state === "rolling_back") {
      this.deps.metrics?.increment("pteroops_remediation_rollbacks_total");
    }
  }

  private async applyAction(
    ref: ServerRef,
    action: RemediationAction,
    plan: RemediationPlan,
    actor: string,
  ): Promise<Record<string, unknown>> {
    const panel = this.deps.panels;
    switch (action.type) {
      case "create_backup": {
        const connection = panel.requireCapability(ref.panel, { allOf: ["client.backups"] });
        const backup = await connection.clientApi!.createBackup(ref, {
          name: `pteroops-${plan.id}`,
        });
        await this.deps.changes.record({
          ref,
          actor,
          origin: "remediation",
          action: "create_backup",
          target: backup.uuid,
          result: "success",
          risk: "LOW",
          incidentId: plan.incidentId ?? null,
          reason: plan.reason,
          details: { remediationId: plan.id },
        });
        return { backupUuid: backup.uuid, name: backup.name };
      }
      case "file_edit": {
        const params = action.params as {
          path: string;
          expectedHash: string;
          edits?: Array<{ find: string; replace: string; replaceAll?: boolean }>;
          content?: string;
        };
        const result = await this.deps.editor.apply(
          ref,
          {
            path: params.path,
            expectedHash: params.expectedHash,
            ...(params.edits ? { edits: params.edits } : {}),
            ...(params.content !== undefined ? { content: params.content } : {}),
          },
          {
            actor,
            origin: "remediation",
            reason: plan.reason,
            remediationId: plan.id,
            ...(plan.incidentId ? { incidentId: plan.incidentId } : {}),
          },
        );
        const base = {
          path: result.path,
          beforeHash: result.beforeHash,
          afterHash: result.afterHash,
          additions: result.additions,
          removals: result.removals,
          snapshotId: result.snapshotId,
        };
        const existingRollback = action.rollback.find((step) => step.type === "reverse_patch");
        if (existingRollback) {
          existingRollback.params = {
            ...existingRollback.params,
            snapshotId: result.snapshotId,
            expectedHash: result.afterHash,
          };
        } else {
          action.rollback = [
            {
              type: "reverse_patch",
              description: `restore ${result.path} to its pre-change content`,
              params: {
                path: result.path,
                snapshotId: result.snapshotId,
                expectedHash: result.afterHash,
              },
            },
          ];
        }
        return base;
      }
      case "file_revert": {
        const params = action.params as { path: string; snapshotId: string; expectedHash: string };
        const result = await this.deps.editor.revert(
          ref,
          { path: params.path, snapshotId: params.snapshotId, expectedHash: params.expectedHash },
          {
            actor,
            origin: "remediation",
            reason: plan.reason,
            remediationId: plan.id,
            ...(plan.incidentId ? { incidentId: plan.incidentId } : {}),
          },
        );
        action.rollback = [
          {
            type: "restore_snapshot",
            description: `re-apply the state before the revert of ${params.path}`,
            params: {
              path: result.path,
              snapshotId: result.snapshotId,
              expectedHash: result.afterHash,
            },
          },
        ];
        return {
          path: result.path,
          beforeHash: result.beforeHash,
          afterHash: result.afterHash,
          snapshotId: result.snapshotId,
        };
      }
      case "startup_variable_change": {
        const params = action.params as { key: string; value: string; previousValue: string | null };
        const connection = panel.requireCapability(ref.panel, { allOf: ["client.server.read"] });
        const startup = await connection.clientApi!.getStartup(ref);
        const variable = startup.variables.find(
          (candidate) => candidate.envVariable.toLowerCase() === params.key.toLowerCase(),
        );
        const previousValue = variable?.serverValue ?? params.previousValue ?? "";
        await connection.clientApi!.updateStartupVariable(ref, params.key, params.value);
        await this.deps.changes.record({
          ref,
          actor,
          origin: "remediation",
          action: "startup_variable_change",
          target: params.key,
          beforeHash: null,
          afterHash: null,
          result: "success",
          risk: "MEDIUM",
          incidentId: plan.incidentId ?? null,
          reason: plan.reason,
          details: { remediationId: plan.id, from: previousValue, to: params.value },
        });
        action.rollback = [
          {
            type: "restore_startup_variable",
            description: `restore startup variable ${params.key} to "${previousValue}"`,
            params: { key: params.key, value: previousValue },
          },
        ];
        return { key: params.key, from: previousValue, to: params.value };
      }
      case "send_command": {
        const params = action.params as { command: string };
        const decision = this.deps.policy.evaluateCommand(ref, params.command, {
          automation: true,
          approved: true,
        });
        if (!decision.allowed) {
          throw new PolicyDeniedError(decision.policyId, decision.reason);
        }
        const connection = panel.requireCapability(ref.panel, { allOf: ["client.console.write"] });
        await connection.clientApi!.sendCommand(ref, params.command);
        await this.deps.changes.record({
          ref,
          actor,
          origin: "remediation",
          action: "send_command",
          target: "console",
          result: "success",
          risk: "MEDIUM",
          incidentId: plan.incidentId ?? null,
          reason: plan.reason,
          details: { remediationId: plan.id, command: params.command },
        });
        return { command: params.command };
      }
      case "restart_server":
        await this.powerAction(ref, "restart", plan.reason);
        return { restarted: true };
      case "restore_backup": {
        const params = action.params as { backupUuid: string };
        const connection = panel.requireCapability(ref.panel, {
          allOf: ["client.backups", "client.power"],
        });
        await connection.clientApi!.setPower(ref, "stop");
        await this.waitForState(ref, ["offline"], 120_000);
        await connection.clientApi!.restoreBackup(ref, params.backupUuid);
        await connection.clientApi!.setPower(ref, "start");
        await this.deps.changes.record({
          ref,
          actor,
          origin: "remediation",
          action: "restore_backup",
          target: params.backupUuid,
          result: "success",
          risk: "HIGH",
          incidentId: plan.incidentId ?? null,
          reason: plan.reason,
          details: { remediationId: plan.id },
        });
        return { backupUuid: params.backupUuid, restarted: true };
      }
    }
  }

  private async rollback(
    ref: ServerRef,
    plan: RemediationPlan,
    executed: ExecutedAction[],
    actor: string,
  ): Promise<RollbackOutcome> {
    const details: string[] = [];
    let complete = true;
    for (const entry of [...executed].reverse()) {
      for (const step of entry.action.rollback) {
        const result = await this.executeRollbackStep(ref, step, plan, actor);
        details.push(`${step.type}: ${result ? "ok" : "failed"}: ${step.description}`);
        if (!result) complete = false;
      }
    }
    if (executed.length === 0) {
      details.push("no executed actions needed rollback");
    }
    return { complete, detail: details.join("; ") };
  }

  private async executeRollbackStep(
    ref: ServerRef,
    step: RollbackStep,
    plan: RemediationPlan,
    actor: string,
  ): Promise<boolean> {
    try {
      switch (step.type) {
        case "reverse_patch":
        case "restore_snapshot": {
          const params = step.params as { path: string; snapshotId?: string };
          if (!params.snapshotId || params.snapshotId === null) {
            this.deps.logger.warn("rollback snapshot unavailable", { path: params.path });
            return false;
          }
          const current = await this.deps.editor.inspect(ref, params.path);
          await this.deps.editor.revert(
            ref,
            { path: params.path, snapshotId: params.snapshotId, expectedHash: current.hash },
            {
              actor,
              origin: "remediation:rollback",
              reason: `rollback of ${plan.id}`,
              remediationId: plan.id,
              ...(plan.incidentId ? { incidentId: plan.incidentId } : {}),
            },
          );
          return true;
        }
        case "restore_startup_variable": {
          const params = step.params as { key: string; value: string };
          const connection = this.deps.panels.requireCapability(ref.panel, {
            allOf: ["client.server.read"],
          });
          await connection.clientApi!.updateStartupVariable(ref, params.key, params.value);
          return true;
        }
        case "restart_server":
          await this.powerAction(ref, "restart", `rollback of ${plan.id}`);
          return true;
        case "restore_backup":
          return false;
        case "send_command":
          return false;
      }
    } catch (error) {
      this.deps.logger.warn("rollback step failed", {
        step: step.type,
        error: (error as Error).message,
      });
      return false;
    }
  }

  private async powerAction(
    ref: ServerRef,
    action: "start" | "stop" | "restart" | "kill",
    reason: string,
  ): Promise<void> {
    const connection = this.deps.panels.requireCapability(ref.panel, { allOf: ["client.power"] });
    if (action === "restart" || action === "start") {
      this.deps.crashTracker.reset(ref);
    }
    await connection.clientApi!.setPower(ref, action);
    await this.deps.changes.record({
      ref,
      actor: "remediation-executor",
      origin: "remediation",
      action: `power:${action}`,
      target: `power:${action}`,
      result: "success",
      risk: action === "restart" ? "MEDIUM" : "LOW",
      reason,
    });
  }

  private async ensureFreshBackup(ref: ServerRef): Promise<Record<string, unknown>> {
    const minutes = this.deps.config.requireFreshBackupMinutes;
    if (minutes <= 0) return { required: false };
    const connection = this.deps.panels.requireCapability(ref.panel, { allOf: ["client.backups"] });
    const backups = await connection.clientApi!.listBackups(ref);
    const cutoff = this.clock() - minutes * 60_000;
    const fresh = backups.find(
      (backup) => backup.successful && backup.createdAt !== null && backup.createdAt >= cutoff,
    );
    if (fresh) {
      return { required: true, existing: fresh.uuid, createdAt: fresh.createdAt };
    }
    const created = await connection.clientApi!.createBackup(ref, {
      name: `pteroops-preflight-${Date.now()}`,
    });
    this.deps.logger.info("created pre-remediation backup", { backupUuid: created.uuid });
    return { required: true, created: created.uuid };
  }

  private async verifyHealthy(ref: ServerRef, signal: AbortSignal): Promise<VerificationOutcome> {
    const deadline = this.clock() + this.deps.config.healthTimeoutSeconds * 1000;
    let lastStatus = "unknown";
    while (this.clock() < deadline) {
      if (signal.aborted) return { passed: false, detail: "verification cancelled" };
      const health = await this.deps.health.assess(ref, {});
      lastStatus = health.status;
      if (health.status === "healthy") {
        const stabilizationEnd = this.clock() + this.deps.config.stabilizationSeconds * 1000;
        let stable = true;
        let stableDetail = "healthy";
        while (this.clock() < stabilizationEnd) {
          await this.sleeper(this.deps.config.healthPollSeconds * 1000, signal);
          if (signal.aborted) return { passed: false, detail: "verification cancelled" };
          const followUp = await this.deps.health.assess(ref, {});
          if (followUp.status !== "healthy" && followUp.status !== "degraded") {
            stable = false;
            stableDetail = `health degraded to ${followUp.status} during stabilization`;
            break;
          }
          stableDetail = followUp.status;
        }
        return stable
          ? { passed: true, detail: `healthy and stable (${stableDetail})` }
          : { passed: false, detail: stableDetail };
      }
      if (health.status === "crash_loop" || health.status === "unhealthy") {
        await this.sleeper(this.deps.config.healthPollSeconds * 1000, signal);
        continue;
      }
      await this.sleeper(this.deps.config.healthPollSeconds * 1000, signal);
    }
    return {
      passed: false,
      detail: `health did not become healthy within ${this.deps.config.healthTimeoutSeconds}s (last status: ${lastStatus})`,
    };
  }

  private async waitForState(ref: ServerRef, states: string[], timeoutMs: number): Promise<void> {
    const connection = this.deps.panels.requireCapability(ref.panel, {
      allOf: ["client.server.read"],
    });
    const deadline = this.clock() + timeoutMs;
    while (this.clock() < deadline) {
      const resources = await connection.clientApi!.getResources(ref);
      if (resources.state && states.includes(resources.state)) return;
      await this.sleeper(3_000);
    }
    throw new ValidationError(
      `Server did not reach state ${states.join("/")} within ${timeoutMs}ms`,
    );
  }

  private async dryRunDetail(
    ref: ServerRef,
    action: RemediationAction,
  ): Promise<Record<string, unknown>> {
    try {
      if (action.type === "file_edit") {
        const params = action.params as {
          path: string;
          expectedHash: string;
          edits?: Array<{ find: string; replace: string; replaceAll?: boolean }>;
          content?: string;
        };
        const preview = await this.deps.editor.preview(ref, {
          path: params.path,
          expectedHash: params.expectedHash,
          ...(params.edits ? { edits: params.edits } : {}),
          ...(params.content !== undefined ? { content: params.content } : {}),
        });
        return {
          preview: `+${preview.additions}/-${preview.removals} lines`,
          diff: preview.diff,
          afterHash: preview.afterHash,
        };
      }
      if (action.type === "startup_variable_change") {
        const params = action.params as { key: string; value: string; previousValue?: string };
        return { key: params.key, from: params.previousValue ?? "(current)", to: params.value };
      }
      return { preview: "action will run as described" };
    } catch (error) {
      return { preview: `cannot preview: ${(error as Error).message}` };
    }
  }

  private async safeHealthStatus(ref: ServerRef): Promise<string | null> {
    try {
      const health = await this.deps.health.assess(ref, {});
      return health.status;
    } catch (error) {
      this.deps.logger.debug("health assessment unavailable", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async safeTransition(
    incident: Incident | null,
    state: Parameters<IncidentService["transition"]>[2],
    actor: string,
    note: string,
  ): Promise<void> {
    if (!incident) return;
    try {
      await this.deps.incidents.transition(incident.ref.tenant, incident.id, state, { actor, note });
    } catch (error) {
      this.deps.logger.debug("incident transition skipped", {
        state,
        error: (error as Error).message,
      });
    }
  }
}

function toPteroError(error: unknown): PteroOpsError {
  if (error instanceof PteroOpsError) return error;
  return new ValidationError(error instanceof Error ? error.message : String(error));
}
