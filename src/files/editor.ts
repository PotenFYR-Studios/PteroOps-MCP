import type { PterodactylClientApi } from "../pterodactyl/client-api.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { Logger } from "../observability/logger.js";
import type { FileSnapshotRepository } from "../persistence/repositories/snapshots.js";
import type { ChangeLedger } from "../changes/ledger.js";
import type { PolicyEngine } from "../security/policy.js";
import type { RedactionEngine } from "../shared/redaction.js";
import type { ServerRef } from "../shared/types.js";
import type { FileEditOperation } from "../remediation/types.js";
import { InternalError, NotFoundError, StaleWriteError, ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { sha256Hex } from "../shared/hash.js";
import { formatUnifiedDiff } from "../shared/diff.js";

export interface FileInspection {
  path: string;
  exists: boolean;
  hash: string;
  size: number;
  content: string;
}

export interface PatchPlan {
  path: string;
  expectedHash: string;
  edits?: FileEditOperation[];
  content?: string;
}

export interface PatchPreview {
  path: string;
  beforeHash: string;
  afterHash: string;
  additions: number;
  removals: number;
  diff: string;
  bytesAfter: number;
  dryRun: true;
}

export interface PatchResult extends Omit<PatchPreview, "dryRun"> {
  dryRun: false;
  verified: boolean;
  snapshotId: string | null;
}

export interface SafeFileEditorDeps {
  panels: PanelRegistry;
  snapshots: FileSnapshotRepository;
  changeLedger: ChangeLedger;
  policy: PolicyEngine;
  redactor: RedactionEngine;
  logger: Logger;
  maxSnapshotBytes?: number;
  clock?: () => number;
}

export interface WriteOptions {
  actor: string;
  origin: string;
  reason?: string;
  incidentId?: string;
  remediationId?: string;
  dryRun?: boolean;
}

export class SafeFileEditor {
  private readonly maxSnapshotBytes: number;
  private readonly clock: () => number;

  constructor(private readonly deps: SafeFileEditorDeps) {
    this.maxSnapshotBytes = deps.maxSnapshotBytes ?? 256 * 1024;
    this.clock = deps.clock ?? Date.now;
  }

  async inspect(ref: ServerRef, path: string): Promise<FileInspection> {
    const api = this.api(ref);
    const content = await api.readFile(ref, path);
    return {
      path,
      exists: true,
      hash: sha256Hex(content),
      size: content.length,
      content,
    };
  }

  async preview(ref: ServerRef, plan: PatchPlan): Promise<PatchPreview> {
    const current = await this.inspect(ref, plan.path);
    this.assertFresh(plan.path, plan.expectedHash, current.hash);
    const next = this.computeNextContent(current.content, plan);
    const diff = formatUnifiedDiff(current.content, next, { label: plan.path });
    return {
      path: plan.path,
      beforeHash: current.hash,
      afterHash: sha256Hex(next),
      additions: diff.additions,
      removals: diff.removals,
      diff: this.deps.redactor.redact(diff.text),
      bytesAfter: next.length,
      dryRun: true,
    };
  }

  async apply(ref: ServerRef, plan: PatchPlan, options: WriteOptions): Promise<PatchResult> {
    const current = await this.inspect(ref, plan.path);
    this.assertFresh(plan.path, plan.expectedHash, current.hash);
    const next = this.computeNextContent(current.content, plan);

    const policyDecision = this.deps.policy.evaluateFileWrite(ref, plan.path, {
      automation: true,
      approved: true,
      sizeBytes: next.length,
    });
    if (!policyDecision.allowed) {
      throw new ValidationError(policyDecision.reason, {
        hint: "Policy denied this write (protected path, size cap, or deny list). Adjust policy via the operator.",
        details: { policyId: policyDecision.policyId },
      });
    }

    const diff = formatUnifiedDiff(current.content, next, { label: plan.path });

    if (options.dryRun) {
      return {
        path: plan.path,
        beforeHash: current.hash,
        afterHash: sha256Hex(next),
        additions: diff.additions,
        removals: diff.removals,
        diff: this.deps.redactor.redact(diff.text),
        bytesAfter: next.length,
        dryRun: false,
        verified: false,
        snapshotId: null,
      };
    }

    const snapshotId = await this.createSnapshot(ref, plan.path, current.content, options);

    const api = this.api(ref);
    await api.writeFile(ref, plan.path, next);

    let verified = false;
    let verificationError: string | null = null;
    try {
      const reread = await api.readFile(ref, plan.path);
      verified = sha256Hex(reread) === sha256Hex(next);
      if (!verified) verificationError = "content hash differs after write";
    } catch (error) {
      verificationError = (error as Error).message;
    }

    await this.deps.changeLedger.record({
      ref,
      actor: options.actor,
      origin: options.origin,
      action: "file_write",
      target: plan.path,
      beforeHash: current.hash,
      afterHash: sha256Hex(next),
      result: verified ? "success" : "failure",
      reason: options.reason ?? null,
      incidentId: options.incidentId ?? null,
      details: {
        snapshotId,
        additions: diff.additions,
        removals: diff.removals,
        verified,
        ...(verificationError ? { verificationError } : {}),
        ...(options.remediationId ? { remediationId: options.remediationId } : {}),
      },
    });

    if (!verified) {
      throw new InternalError(
        `File write to ${plan.path} could not be verified${verificationError ? `: ${verificationError}` : ""}`,
        { details: { snapshotId, path: plan.path } },
      );
    }

    return {
      path: plan.path,
      beforeHash: current.hash,
      afterHash: sha256Hex(next),
      additions: diff.additions,
      removals: diff.removals,
      diff: this.deps.redactor.redact(diff.text),
      bytesAfter: next.length,
      dryRun: false,
      verified,
      snapshotId,
    };
  }

  async revert(
    ref: ServerRef,
    input: { path: string; snapshotId: string; expectedHash: string },
    options: WriteOptions,
  ): Promise<PatchResult> {
    const snapshot = await this.deps.snapshots.get(ref.tenant, input.snapshotId);
    if (!snapshot || snapshot.path !== input.path) {
      throw new NotFoundError(`Snapshot ${input.snapshotId} for ${input.path} not found`);
    }
    if (snapshot.content === null) {
      throw new ValidationError(
        `Snapshot ${input.snapshotId} has no stored content (file was larger than the snapshot limit) and cannot be reverted`,
      );
    }
    const current = await this.inspect(ref, input.path);
    this.assertFresh(input.path, input.expectedHash, current.hash);
    const diff = formatUnifiedDiff(current.content, snapshot.content, { label: input.path });
    const rollbackSnapshotId = await this.createSnapshot(ref, input.path, current.content, options);
    const api = this.api(ref);
    await api.writeFile(ref, input.path, snapshot.content);
    const reread = await api.readFile(ref, input.path);
    const verified = sha256Hex(reread) === snapshot.hash;
    await this.deps.changeLedger.record({
      ref,
      actor: options.actor,
      origin: options.origin,
      action: "file_revert",
      target: input.path,
      beforeHash: current.hash,
      afterHash: snapshot.hash,
      result: verified ? "success" : "failure",
      reason: options.reason ?? null,
      incidentId: options.incidentId ?? null,
      details: {
        snapshotId: snapshot.id,
        rollbackSnapshotId,
        ...(options.remediationId ? { remediationId: options.remediationId } : {}),
      },
    });
    if (!verified) {
      throw new InternalError(`Revert of ${input.path} could not be verified`);
    }
    return {
      path: input.path,
      beforeHash: current.hash,
      afterHash: snapshot.hash,
      additions: diff.additions,
      removals: diff.removals,
      diff: this.deps.redactor.redact(diff.text),
      bytesAfter: snapshot.content.length,
      dryRun: false,
      verified,
      snapshotId: rollbackSnapshotId,
    };
  }

  private computeNextContent(current: string, plan: PatchPlan): string {
    if (plan.content !== undefined && plan.edits !== undefined) {
      throw new ValidationError("Provide either edits or content, not both");
    }
    if (plan.content !== undefined) {
      return plan.content;
    }
    if (!plan.edits || plan.edits.length === 0) {
      throw new ValidationError("Patch plan must include edits or content");
    }
    if (plan.edits.length > 50) {
      throw new ValidationError("Too many edits in one patch (max 50)");
    }
    let result = current;
    for (const [index, edit] of plan.edits.entries()) {
      if (edit.find === "") {
        throw new ValidationError(`Edit ${index + 1} has an empty find string`);
      }
      const occurrences = countOccurrences(result, edit.find);
      if (occurrences === 0) {
        throw new ValidationError(
          `Edit ${index + 1}: find text not found in the file (it may have changed since it was read)`,
        );
      }
      if (occurrences > 1 && !edit.replaceAll) {
        throw new ValidationError(
          `Edit ${index + 1}: find text matches ${occurrences} times; make it unique or set replaceAll=true`,
        );
      }
      result = edit.replaceAll
        ? result.split(edit.find).join(edit.replace)
        : result.replace(edit.find, edit.replace);
    }
    return result;
  }

  private assertFresh(path: string, expectedHash: string, actualHash: string): void {
    if (expectedHash !== actualHash) {
      throw new StaleWriteError(
        `File ${path} changed since it was read (expected hash ${expectedHash.slice(0, 12)}…, found ${actualHash.slice(0, 12)}…; refusing to overwrite`,
        {
          hint: "Re-read the file (ptero_read_file), review the new content, and regenerate the patch.",
          details: { path, expectedHash, actualHash },
        },
      );
    }
  }

  private async createSnapshot(
    ref: ServerRef,
    path: string,
    content: string,
    options: WriteOptions,
  ): Promise<string | null> {
    if (content.length > this.maxSnapshotBytes) {
      this.deps.logger.warn("file too large for content snapshot", {
        path,
        bytes: content.length,
        limit: this.maxSnapshotBytes,
      });
      return null;
    }
    const id = createId("snap");
    await this.deps.snapshots.record({
      id,
      ref,
      path,
      hash: sha256Hex(content),
      size: content.length,
      content,
      createdAt: this.clock(),
      reason: options.reason ?? null,
      incidentId: options.incidentId ?? null,
      remediationId: options.remediationId ?? null,
    });
    return id;
  }

  private api(ref: ServerRef): PterodactylClientApi {
    const panel = this.deps.panels.requireCapability(ref.panel, {
      allOf: ["client.files.read", "client.files.write"],
    });
    if (!panel.clientApi) {
      throw new InternalError(`Panel ${ref.panel} has no client API configured`);
    }
    return panel.clientApi;
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let index = 0;
  for (;;) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    if (count > 1000) break;
    index = found + needle.length;
  }
  return count;
}
