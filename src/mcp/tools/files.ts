import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { PolicyDeniedError, ValidationError } from "../../shared/errors.js";
import { assertSafePath, requirePanel, resolveRef, serverArg } from "./helpers.js";
import { sha256Hex } from "../../shared/hash.js";

const editOperation = z.object({
  find: z.string().min(1).max(20_000).describe("Exact text to find (must be unique unless replaceAll)."),
  replace: z.string().max(50_000),
  replaceAll: z.boolean().optional(),
});

export function fileTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_list_files",
      title: "List server files",
      description:
        "Lists a directory inside a server's filesystem. Paths are confined to the server root (traversal rejected). Read-only; results are bounded.",
      inputSchema: {
        server: serverArg,
        path: z.string().optional().describe('Directory path, default "/".'),
        limit: z.number().int().min(1).max(1000).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.files.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.files.read"] });
        const path = assertSafePath(args.path === undefined ? "/" : String(args.path));
        const entries = await panel.clientApi!.listFiles(ref, path);
        const limit = Number(args.limit ?? 500);
        const sorted = [...entries].sort((a, b) => {
          if (a.directory !== b.directory) return a.directory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return {
          server: `${ref.panel}/${ref.serverId}`,
          path,
          total: sorted.length,
          truncated: sorted.length > limit,
          entries: sorted.slice(0, limit).map((entry) => ({
            name: entry.name,
            directory: entry.directory,
            size: entry.size,
            modifiedAt: entry.modifiedAt,
            mimetype: entry.mimetype,
          })),
        };
      },
    },
    {
      name: "ptero_read_file",
      title: "Read a server file",
      description:
        "Reads a text file from a server (size-capped, path-confined). Protected paths are refused and secret-looking values are redacted in the response. Read-only. Use ptero_list_files first if you do not know the exact path.",
      inputSchema: {
        server: serverArg,
        path: z.string().min(1),
        maxBytes: z.number().int().min(256).max(2_000_000).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.files.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.files.read"] });
        const path = assertSafePath(String(args.path));
        const decision = services.policyEngine.evaluateFileWrite(ref, path, {
          automation: false,
          approved: true,
        });
        if (decision.policyId === "path.protected") {
          throw new ValidationError(
            `Reading "${path}" is blocked by policy (protected path).`,
            { hint: "Remove the path from policy.protectedPaths only if the operator explicitly allows it." },
          );
        }
        const content = await panel.clientApi!.readFile(ref, path);
        const maxBytes = Number(args.maxBytes ?? services.config.policy.maxFileSizeBytes);
        if (content.length > maxBytes) {
          throw new ValidationError(
            `File is ${content.length} bytes which exceeds the limit of ${maxBytes} bytes.`,
            { hint: "Raise maxBytes (up to 2,000,000) or read a smaller file." },
          );
        }
        const redacted = services.redactor.redact(content);
        const hashUsable = redacted === content;
        return {
          server: `${ref.panel}/${ref.serverId}`,
          path,
          bytes: content.length,
          truncated: false,
          redacted: !hashUsable,
          hash: hashUsable ? sha256Hex(content) : null,
          hashNote: hashUsable
            ? "pass this hash as expectedHash to ptero_write_patch"
            : "content contained secrets and was redacted; the hash refers to the redacted text and cannot be used for ptero_write_patch",
          content: redacted,
        };
      },
    },
    {
      name: "ptero_write_patch",
      title: "Safely edit a server file",
      description:
        "Edits a file with diff-first safety: requires the exact hash from ptero_read_file (stale-write protection), takes a snapshot for rollback, returns the unified diff, applies the change, then re-reads and verifies the result. MUTATING and policy-checked (protected paths refused, size caps enforced). Use dryRun=true to preview the diff without changing anything. Prefer this over rewriting whole files; it refuses to overwrite content that changed since you read it.",
      inputSchema: {
        server: serverArg,
        path: z.string().min(1),
        expectedHash: z
          .string()
          .min(16)
          .describe("SHA-256 hash returned by ptero_read_file (prevents stale overwrites)."),
        edits: z
          .array(editOperation)
          .min(1)
          .max(50)
          .optional()
          .describe("Structured find/replace operations applied in order."),
        content: z
          .string()
          .max(2_000_000)
          .optional()
          .describe("Full replacement content (only when a structured edit is impossible)."),
        dryRun: z.boolean().optional(),
        reason: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      capabilities: { allOf: ["client.files.read", "client.files.write"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        requirePanel(services, ref, {
          allOf: ["client.files.read", "client.files.write"],
        });
        const path = assertSafePath(String(args.path));
        if (!args.edits && args.content === undefined) {
          throw new ValidationError("Provide edits or content");
        }
        if (args.edits && args.content !== undefined) {
          throw new ValidationError("Provide either edits or content, not both");
        }
        const plan = {
          path,
          expectedHash: String(args.expectedHash),
          ...(args.edits
            ? { edits: args.edits as Array<{ find: string; replace: string; replaceAll?: boolean }> }
            : {}),
          ...(args.content !== undefined ? { content: String(args.content) } : {}),
        };
        const decision = services.policyEngine.evaluateFileWrite(ref, path, {
          automation: false,
          approved: true,
          ...(args.content !== undefined ? { sizeBytes: String(args.content).length } : {}),
        });
        if (!decision.allowed && decision.policyId === "path.protected") {
          throw new PolicyDeniedError(decision.policyId, decision.reason);
        }
        if (args.dryRun === true) {
          const preview = await services.fileEditor.preview(ref, plan);
          return preview;
        }
        const result = await services.fileEditor.apply(ref, plan, {
          actor: ctx.actor,
          origin: "mcp:write_patch",
          ...(args.reason ? { reason: String(args.reason) } : {}),
        });
        return {
          ...result,
          rollbackHint: result.snapshotId
            ? `rollback available via snapshot ${result.snapshotId} (ptero_rollback_remediation or revert plan)`
            : "file was larger than the snapshot limit; no automatic rollback content stored",
        };
      },
    },
  ];
}
