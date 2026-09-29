import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { PolicyDeniedError } from "../../shared/errors.js";
import { resolveRef, serverArg } from "./helpers.js";

export function gitTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_git_status",
      title: "Inspect the server's git repository",
      description:
        "Detects a git repository inside a server, reports branch, revision, remote (credentials stripped), working-tree cleanliness and recent commits. Dirty state and commit log require console access (client.console.write); without it only file-based facts are returned. Read-only.",
      inputSchema: {
        server: serverArg,
        root: z.string().max(200).optional().describe('Path of the repository within the server (default "/").'),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.files.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const status = await services.git.status(ref, args.root ? String(args.root) : "/");
        return status;
      },
    },
    {
      name: "ptero_git_deploy",
      title: "Deploy from git",
      description:
        "MUTATING: pulls the configured git remote into the server (Pterodactyl pull endpoint) and records the deployment in the change ledger. Requires files.write capability; git.url can override the remote. Not a rollback - after deploying, verify with ptero_run_tests. URL credentials are never returned.",
      inputSchema: {
        server: serverArg,
        root: z.string().max(200).optional(),
        url: z.string().url().max(500).optional().describe("Remote URL override (credentials allowed but never returned)."),
        branch: z.string().max(120).optional(),
        reason: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      capabilities: { allOf: ["client.files.write"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        return services.git.deploy(ref, {
          ...(args.root ? { root: String(args.root) } : {}),
          ...(args.url ? { url: String(args.url) } : {}),
          ...(args.branch ? { branch: String(args.branch) } : {}),
          actor: ctx.actor,
          approved: true,
          ...(args.reason ? { reason: String(args.reason) } : {}),
        });
      },
    },
    {
      name: "ptero_git_rollback",
      title: "Roll back to a git revision",
      description:
        "MUTATING, HIGH risk: hard-resets the working tree to a revision over the console, after refusing when uncommitted changes exist (override with force only after explicit operator confirmation). Requires console access. Recorded in the change ledger with before/after revisions. Verify health afterwards.",
      inputSchema: {
        server: serverArg,
        revision: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/)
          .describe("Target revision (branch, tag or commit sha)."),
        root: z.string().max(200).optional(),
        force: z.boolean().optional().describe("Proceed even with uncommitted changes (destroys them)."),
        confirm: z.boolean().optional().describe("Required: acknowledge the HIGH risk."),
        reason: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      capabilities: { allOf: ["client.console.write"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        if (args.confirm !== true) {
          throw new PolicyDeniedError(
            "git.confirmation-required",
            "git rollback is HIGH risk and requires confirm=true after explicit operator confirmation",
          );
        }
        return services.git.rollback(ref, {
          ...(args.root ? { root: String(args.root) } : {}),
          revision: String(args.revision),
          actor: ctx.actor,
          force: args.force === true,
          approved: true,
          ...(args.reason ? { reason: String(args.reason) } : {}),
        });
      },
    },
    {
      name: "ptero_git_history",
      title: "Git commit history and deployments",
      description:
        "Commit history and deployment record for a server: recent commits from the GitHub/GitLab API (when git.tokens are configured for the remote), plus every git deploy/rollback recorded in the change ledger. Optionally compares two revisions (files changed + commits) - useful for correlating a crash with a deployment. Read-only.",
      inputSchema: {
        server: serverArg,
        root: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        compareBase: z.string().max(120).optional().describe("Base revision for a comparison."),
        compareHead: z.string().max(120).optional().describe("Head revision for a comparison."),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.files.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        return services.git.history(ref, {
          ...(args.root ? { root: String(args.root) } : {}),
          ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
          ...(args.compareBase ? { compareBase: String(args.compareBase) } : {}),
          ...(args.compareHead ? { compareHead: String(args.compareHead) } : {}),
        });
      },
    },
  ];
}
