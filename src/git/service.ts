import type { ChangeLedger } from "../changes/ledger.js";
import type { ConsoleService } from "../console/service.js";
import type { GitConfig } from "../config/schema.js";
import type { Logger } from "../observability/logger.js";
import type { ConsoleCommandRunner } from "../pterodactyl/console-command.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { PolicyEngine } from "../security/policy.js";
import type { RedactionEngine } from "../shared/redaction.js";
import type { ServerRef } from "../shared/types.js";
import { PolicyDeniedError, ValidationError } from "../shared/errors.js";
import {
  credentialsFromGitConfig,
  resolveGitProvider,
  type GitCommit,
  type GitCompareResult,
} from "./providers.js";

export interface GitStatusReport {
  server: string;
  root: string;
  repository: boolean;
  branch: string | null;
  revision: string | null;
  remote: string | null;
  dirty: boolean | null;
  dirtyFiles: string[];
  recentCommits: Array<{ revision: string; subject: string }>;
  method: "files" | "files+console" | "files+provider" | "unknown";
  notes: string[];
  evidence: string[];
}

export interface GitServiceDeps {
  panels: PanelRegistry;
  consoleService: ConsoleService;
  runner: ConsoleCommandRunner;
  policy: PolicyEngine;
  changeLedger: ChangeLedger;
  redactor: RedactionEngine;
  gitConfig: GitConfig;
  logger: Logger;
  clock?: () => number;
}

const REVISION_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

export class GitService {
  constructor(private readonly deps: GitServiceDeps) {}

  async status(ref: ServerRef, root = "/"): Promise<GitStatusReport> {
    const safeRoot = assertSafeRoot(root);
    const panel = this.deps.panels.requireCapability(ref.panel, { allOf: ["client.files.read"] });
    const api = panel.clientApi!;
    const notes: string[] = [];
    const evidence: string[] = [];
    const base = safeRoot === "/" ? "" : safeRoot;

    const head = await api.readFile(ref, `${base}/.git/HEAD`).catch(() => null);
    if (!head) {
      return {
        server: `${ref.panel}/${ref.serverId}`,
        root: safeRoot,
        repository: false,
        branch: null,
        revision: null,
        remote: null,
        dirty: null,
        dirtyFiles: [],
        recentCommits: [],
        method: "files",
        notes: ["no .git/HEAD found at this path; the server has no git repository here"],
        evidence: [],
      };
    }

    let branch: string | null = null;
    let revision: string | null = null;
    const trimmedHead = head.trim();
    if (trimmedHead.startsWith("ref:")) {
      const refPath = trimmedHead.slice(4).trim();
      branch = refPath.replace(/^refs\/heads\//, "");
      const direct = await api.readFile(ref, `${base}/.git/${refPath}`).catch(() => null);
      if (direct && /^[0-9a-f]{40}$/i.test(direct.trim())) {
        revision = direct.trim().slice(0, 12);
      } else {
        const packed = await api.readFile(ref, `${base}/.git/packed-refs`).catch(() => null);
        const line = packed?.split("\n").find((entry) => entry.trim().endsWith(` ${refPath}`));
        revision = line ? line.trim().split(" ")[0]!.slice(0, 12) : null;
      }
      evidence.push(`HEAD points at ${refPath}${revision ? ` (${revision})` : ""}`);
    } else if (/^[0-9a-f]{40}$/i.test(trimmedHead)) {
      revision = trimmedHead.slice(0, 12);
      branch = null;
      evidence.push(`detached HEAD at ${revision}`);
    }

    let remote: string | null = null;
    const config = await api.readFile(ref, `${base}/.git/config`).catch(() => null);
    if (config) {
      const remoteMatch = /\[remote "([^"]+)"\][\s\S]*?url\s*=\s*(\S+)/.exec(config);
      if (remoteMatch) {
        remote = this.sanitizeRemote(remoteMatch[2]!);
        evidence.push(`remote "${remoteMatch[1]}" configured`);
      }
    }

    let dirty: boolean | null = null;
    const dirtyFiles: string[] = [];
    const recentCommits: Array<{ revision: string; subject: string }> = [];
    let method: GitStatusReport["method"] = "files";

    const consoleActive = await this.hasRecentConsoleActivity(ref);
    if (panel.capabilities.has("client.console.write") && consoleActive) {
      try {
        const statusResult = await this.deps.runner.run(ref, `git -C ${shellQuote(safeRoot)} status --porcelain`, (command) =>
          api.sendCommand(ref, command),
        );
        if (statusResult.markerFound) {
          const lines = statusResult.output
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith("__PTEROOPS_MARKER"));
          dirty = lines.length > 0;
          dirtyFiles.push(...lines.slice(0, 100));
          method = "files+console";
        } else {
          notes.push(
            "console did not return a shell prompt marker; working-tree status (dirty/clean) could not be determined",
          );
        }

        const logResult = await this.deps.runner.run(ref, `git -C ${shellQuote(safeRoot)} log --oneline -5`, (command) =>
          api.sendCommand(ref, command),
        );
        if (logResult.markerFound) {
          for (const line of logResult.output.slice(0, 20)) {
            const match = /^([0-9a-f]{7,40})\s+(.*)$/.exec(line.trim());
            if (match) {
              recentCommits.push({ revision: match[1]!, subject: match[2]!.slice(0, 120) });
            }
          }
        }
      } catch (error) {
        notes.push(`console git inspection failed: ${(error as Error).message}`);
      }
    } else {
      notes.push(
        consoleActive
          ? "client.console.write capability missing; dirty state and commit log require console access"
          : "no recent console activity; start the server or check the console stream to determine dirty state and commit log",
      );
    }

    if (recentCommits.length === 0 && remote) {
      const provider = resolveGitProvider(
          remote,
          credentialsFromGitConfig(this.deps.gitConfig),
          this.deps.logger,
        );
      if (provider) {
        try {
          const commits = await provider.listCommits({ limit: 5, ...(branch ? { ref: branch } : {}) });
          for (const commit of commits) {
            recentCommits.push({ revision: commit.revision, subject: commit.subject });
          }
          if (commits.length > 0) {
            method = "files+provider";
            evidence.push(`recent commits fetched via the ${provider.name} API`);
          }
        } catch (error) {
          notes.push(`git provider lookup failed: ${(error as Error).message}`);
        }
      } else {
        notes.push(
          "no provider token configured for this remote; commit history needs the console or git.tokens",
        );
      }
    }

    return {
      server: `${ref.panel}/${ref.serverId}`,
      root: safeRoot,
      repository: true,
      branch,
      revision,
      remote,
      dirty,
      dirtyFiles,
      recentCommits,
      method,
      notes,
      evidence,
    };
  }

  async deploy(
    ref: ServerRef,
    input: {
      root?: string;
      url?: string;
      branch?: string;
      actor: string;
      approved?: boolean;
      reason?: string;
    },
  ): Promise<Record<string, unknown>> {
    const safeRoot = assertSafeRoot(input.root ?? "/");
    const decision = this.deps.policy.evaluateAction(ref, "git_deploy", {
      automation: false,
      approved: input.approved === true,
    });
    if (!decision.allowed) {
      throw new PolicyDeniedError(decision.policyId, decision.reason, {
        details: { risk: decision.risk },
      });
    }
    const panel = this.deps.panels.requireCapability(ref.panel, { allOf: ["client.files.write"] });
    await panel.clientApi!.pullFromGit(ref, {
      root: safeRoot,
      ...(input.url ? { url: input.url } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
    });
    await this.deps.changeLedger.record({
      ref,
      actor: input.actor,
      origin: "mcp:git_deploy",
      action: "git_deploy",
      target: `${safeRoot}${input.branch ? `@${input.branch}` : ""}`,
      result: "success",
      risk: decision.risk,
      reason: input.reason ?? null,
      details: { root: safeRoot, url: input.url ? "[redacted-if-credentials]" : null },
    });
    return {
      deployed: true,
      root: safeRoot,
      branch: input.branch ?? null,
      note: "deployment pulls the repository on the panel side; re-run ptero_detect_application or ptero_run_tests afterwards if dependencies changed",
    };
  }

  async rollback(
    ref: ServerRef,
    input: { root?: string; revision: string; actor: string; force?: boolean; approved?: boolean; reason?: string },
  ): Promise<Record<string, unknown>> {
    const safeRoot = assertSafeRoot(input.root ?? "/");
    if (!REVISION_RE.test(input.revision)) {
      throw new ValidationError(
        `Invalid git revision "${input.revision}" (allowed: letters, digits, dot, slash, dash, underscore)`,
      );
    }
    const status = await this.status(ref, safeRoot);
    if (status.dirty === true && input.force !== true) {
      throw new PolicyDeniedError(
        "git.dirty",
        "The working tree has uncommitted changes; rolling back would destroy them.",
        {
          hint: "Commit or stash the changes outside PteroOps, or pass force=true after explicit operator confirmation.",
          details: { dirtyFiles: status.dirtyFiles.slice(0, 20) },
        },
      );
    }
    const decision = this.deps.policy.evaluateAction(ref, "git_rollback", {
      automation: false,
      approved: input.approved === true,
    });
    if (!decision.allowed) {
      throw new PolicyDeniedError(decision.policyId, decision.reason, {
        details: { risk: decision.risk },
      });
    }
    const panel = this.deps.panels.requireCapability(ref.panel, {
      allOf: ["client.console.write"],
    });
    const result = await this.deps.runner.run(
      ref,
      `git -C ${shellQuote(safeRoot)} reset --hard ${input.revision}`,
      (command) => panel.clientApi!.sendCommand(ref, command),
    );
    await this.deps.changeLedger.record({
      ref,
      actor: input.actor,
      origin: "mcp:git_rollback",
      action: "git_rollback",
      target: `${safeRoot}@${input.revision}`,
      beforeHash: status.revision,
      afterHash: input.revision,
      result: result.markerFound ? "success" : "failure",
      risk: decision.risk,
      reason: input.reason ?? null,
      details: { dirtyBefore: status.dirty, forced: input.force === true },
    });
    if (!result.markerFound) {
      return {
        rolledBack: false,
        note: "the console did not confirm the git command (the server console may not be a shell); verify manually with ptero_git_status",
      };
    }
    return {
      rolledBack: true,
      from: status.revision,
      to: input.revision,
      dirtyBefore: status.dirty,
      note: "restart the server if the runtime reads files at startup",
    };
  }

  async history(
    ref: ServerRef,
    input: {
      root?: string;
      limit?: number;
      compareBase?: string;
      compareHead?: string;
    } = {},
  ): Promise<Record<string, unknown>> {
    const safeRoot = assertSafeRoot(input.root ?? "/");
    const status = await this.status(ref, safeRoot);
    const missingEvidence: string[] = [];
    let commits: GitCommit[] = status.recentCommits.map((commit) => ({
      revision: commit.revision,
      subject: commit.subject,
      author: null,
      date: null,
      url: null,
    }));
    let compare: GitCompareResult | null = null;

    const provider = status.remote
      ? resolveGitProvider(status.remote, credentialsFromGitConfig(this.deps.gitConfig), this.deps.logger)
      : null;
    if (provider) {
      const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
      commits = await provider.listCommits({
        limit,
        ...(status.branch ? { ref: status.branch } : {}),
      });
      if (input.compareBase && input.compareHead) {
        compare = await provider.compare(input.compareBase, input.compareHead);
      }
    } else if (status.repository) {
      missingEvidence.push(
        "commit history requires either an active console stream or a provider token (git.tokens.github / git.tokens.gitlab)",
      );
    }

    const deployEvents = await this.deps.changeLedger.list({
      ref,
      action: "git_deploy",
      limit: 20,
    });
    const rollbackEvents = await this.deps.changeLedger.list({
      ref,
      action: "git_rollback",
      limit: 20,
    });
    const deploys = [...deployEvents, ...rollbackEvents]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20)
      .map((event) => ({
        ts: event.ts,
        action: event.action,
        target: event.target,
        actor: event.actor,
        result: event.result,
        beforeHash: event.beforeHash,
        afterHash: event.afterHash,
      }));

    return {
      server: `${ref.panel}/${ref.serverId}`,
      root: safeRoot,
      repository: status.repository,
      branch: status.branch,
      revision: status.revision,
      remote: status.remote,
      provider: provider?.name ?? null,
      commits,
      deploys,
      compare,
      notes: status.notes,
      missingEvidence,
    };
  }

  private sanitizeRemote(url: string): string {
    const redacted = this.deps.redactor.redact(url);
    return redacted.replace(/\/\/[^/@]+@/, "//");
  }

  private async hasRecentConsoleActivity(ref: ServerRef): Promise<boolean> {
    try {
      const page = await this.deps.consoleService.query({ ref, mode: "latest", limit: 1 });
      const latest = page.events[0];
      return latest !== undefined && Date.now() - latest.ts < 5 * 60_000;
    } catch {
      return false;
    }
  }
}

export function assertSafeRoot(root: string): string {
  if (root.includes("\0")) throw new ValidationError("invalid path");
  const normalized = root.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new ValidationError("path traversal is not allowed");
  }
  for (const part of parts) {
    if (!/^[\w@.+-]+$/.test(part)) {
      throw new ValidationError(`path segment contains invalid characters: ${part}`);
    }
  }
  return `/${parts.join("/")}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
