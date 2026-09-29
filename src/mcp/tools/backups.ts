import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { requirePanel, resolveRef, serverArg } from "./helpers.js";

export function backupTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_list_backups",
      title: "List server backups",
      description:
        "Lists backups with size, age, lock state and success flag. Read-only.",
      inputSchema: {
        server: serverArg,
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.backups"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.backups"] });
        const backups = await panel.clientApi!.listBackups(ref);
        const limit = Number(args.limit ?? 50);
        return {
          server: `${ref.panel}/${ref.serverId}`,
          total: backups.length,
          backups: backups.slice(0, limit).map((backup) => ({
            uuid: backup.uuid,
            name: backup.name,
            bytes: backup.bytes,
            createdAt: backup.createdAt,
            ageHours:
              backup.createdAt === null
                ? null
                : Math.round((Date.now() - backup.createdAt) / 3_600_000),
            successful: backup.successful,
            locked: backup.locked,
            checksumPresent: backup.checksum !== null,
          })),
          truncated: backups.length > limit,
        };
      },
    },
    {
      name: "ptero_create_backup",
      title: "Create a backup",
      description:
        "Creates a backup of the server files. MUTATING but LOW risk and audited; recommended before any HIGH-risk change. The backup is created asynchronously on the panel side.",
      inputSchema: {
        server: serverArg,
        name: z.string().max(120).optional(),
        ignoredFiles: z.string().max(2000).optional().describe("Newline-separated glob patterns to exclude."),
        reason: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      capabilities: { allOf: ["client.backups"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.backups"] });
        const backup = await panel.clientApi!.createBackup(ref, {
          ...(args.name ? { name: String(args.name) } : {}),
          ...(args.ignoredFiles ? { ignoredFiles: String(args.ignoredFiles) } : {}),
        });
        await services.changeLedger.record({
          ref,
          actor: ctx.actor,
          origin: "mcp:create_backup",
          action: "create_backup",
          target: backup.uuid,
          result: "success",
          risk: "LOW",
          reason: args.reason ? String(args.reason) : null,
        });
        return {
          created: true,
          backup: {
            uuid: backup.uuid,
            name: backup.name,
            bytes: backup.bytes,
            createdAt: backup.createdAt,
          },
          note: "the panel creates the backup asynchronously; check ptero_backup_status in a few minutes",
        };
      },
    },
    {
      name: "ptero_backup_status",
      title: "Backup intelligence",
      description:
        "Analyzes backup coverage for a server: newest usable backup and its age, success/failure history, suspicious sizes, lock state and warnings (no recent backup, repeated failures, no backups at all). Read-only; use before HIGH-risk operations.",
      inputSchema: { server: serverArg },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.backups"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.backups"] });
        const backups = await panel.clientApi!.listBackups(ref);
        const now = Date.now();
        const successful = backups.filter((backup) => backup.successful);
        const failed = backups.filter((backup) => !backup.successful);
        const newest = successful.reduce<(typeof successful)[number] | null>(
          (acc, backup) =>
            backup.createdAt !== null && (acc === null || acc.createdAt === null || backup.createdAt > (acc.createdAt ?? 0))
              ? backup
              : acc,
          null,
        );
        const sizes = successful.map((backup) => backup.bytes).filter((bytes) => bytes > 0);
        const medianSize = sizes.length > 0 ? sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)]! : 0;
        const warnings: string[] = [];
        if (backups.length === 0) {
          warnings.push("no backups exist for this server; a data-loss event cannot be recovered");
        }
        if (newest === null && backups.length > 0) {
          warnings.push("no successful backup exists; every recorded attempt failed");
        }
        if (newest?.createdAt !== null && newest !== null) {
          const ageDays = (now - newest.createdAt) / 86_400_000;
          if (ageDays > 7) {
            warnings.push(`newest successful backup is ${ageDays.toFixed(1)} days old`);
          }
        }
        if (failed.length >= 3 && failed.length >= successful.length) {
          warnings.push(`${failed.length} failed backup attempts vs ${successful.length} successful; backups are not reliable right now`);
        }
        if (medianSize > 0) {
          const suspicious = successful.filter(
            (backup) => backup.bytes > 0 && backup.bytes < medianSize * 0.2,
          );
          if (suspicious.length > 0) {
            warnings.push(
              `${suspicious.length} backup(s) are less than 20% of the median size (${Math.round(medianSize / 1024 / 1024)} MB) and may be incomplete`,
            );
          }
        }
        return {
          server: `${ref.panel}/${ref.serverId}`,
          total: backups.length,
          successful: successful.length,
          failed: failed.length,
          newestSuccessful: newest
            ? {
                uuid: newest.uuid,
                name: newest.name,
                bytes: newest.bytes,
                createdAt: newest.createdAt,
                ageHours: newest.createdAt === null ? null : Math.round((now - newest.createdAt) / 3_600_000),
                locked: newest.locked,
              }
            : null,
          warnings,
          summary:
            warnings.length === 0
              ? "backup coverage looks healthy"
              : `${warnings.length} backup warning(s)`,
        };
      },
    },
  ];
}
