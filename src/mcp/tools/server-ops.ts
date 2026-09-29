import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { PolicyDeniedError } from "../../shared/errors.js";
import { requirePanel, resolveRef, serverArg } from "./helpers.js";

export function startupVariableTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_set_startup_variable",
      title: "Change a startup variable",
      description:
        "MUTATING: sets a startup variable (e.g. memory, JVM flags, jar file) and records the previous value in the change ledger. Requires a restart to take effect. MEDIUM risk, policy-checked (approval lists apply), audited. Read ptero_get_startup first to see valid variable names and current values.",
      inputSchema: {
        server: serverArg,
        key: z.string().min(1).max(64).describe("Variable name or env variable (e.g. SERVER_JARFILE, MEMORY)."),
        value: z.string().max(2000),
        reason: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      capabilities: { allOf: ["client.server.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.server.read"] });
        const decision = services.policyEngine.evaluateAction(ref, "startup_variable_change", {
          automation: false,
          approved: true,
        });
        if (!decision.allowed && decision.policyId === "approval.denied") {
          throw new PolicyDeniedError(decision.policyId, decision.reason);
        }
        const startup = await panel.clientApi!.getStartup(ref);
        const variable = startup.variables.find(
          (candidate) =>
            candidate.envVariable.toLowerCase() === String(args.key).toLowerCase() ||
            candidate.name.toLowerCase() === String(args.key).toLowerCase(),
        );
        await panel.clientApi!.updateStartupVariable(
          ref,
          variable?.envVariable ?? String(args.key),
          String(args.value),
        );
        await services.changeLedger.record({
          ref,
          actor: ctx.actor,
          origin: "mcp:set_startup_variable",
          action: "startup_variable_change",
          target: variable?.envVariable ?? String(args.key),
          result: "success",
          risk: decision.risk,
          reason: args.reason ? String(args.reason) : null,
          details: { from: variable?.serverValue ?? null, to: String(args.value) },
        });
        return {
          updated: true,
          key: variable?.envVariable ?? String(args.key),
          previousValue: variable?.serverValue ?? null,
          newValue: String(args.value),
          note: "restart the server for the new value to take effect (ptero_power_action restart after verifying the change)",
        };
      },
    },
  ];
}

export function databaseTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_list_databases",
      title: "List server databases",
      description:
        "Lists databases assigned to a server: host, name, user, connection origin. Password values are redacted from the response. Read-only.",
      inputSchema: { server: serverArg },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.databases"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.databases"] });
        const databases = await panel.clientApi!.listDatabases(ref);
        return {
          server: `${ref.panel}/${ref.serverId}`,
          databases: databases.map((database) => ({
            id: database.id,
            host: `${database.hostAddress}:${String(database.hostPort)}`,
            name: database.name,
            username: database.username,
            connectionsFrom: database.connectionsFrom,
            maxConnections: database.maxConnections,
            password: database.password ? "[REDACTED]" : null,
          })),
        };
      },
    },
    {
      name: "ptero_manage_database",
      title: "Create, rotate or delete a server database",
      description:
        "MUTATING database management. Actions: create (new database + user), rotate_password (new password, returned once, redacted in logs), delete (destroys the database). Delete is HIGH risk. Audited and ledger-recorded.",
      inputSchema: {
        server: serverArg,
        action: z.enum(["create", "rotate_password", "delete"]),
        databaseId: z.number().int().positive().optional().describe("Required for rotate_password and delete."),
        databaseName: z
          .string()
          .regex(/^[a-zA-Z0-9_]{1,48}$/)
          .optional()
          .describe("Required for create: database name (letters, digits, underscore)."),
        remote: z.string().max(48).optional().describe('Allowed connection origin for create (default "%").'),
        reason: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      capabilities: { allOf: ["client.databases"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.databases"] });
        const action = args.action as "create" | "rotate_password" | "delete";
        const riskKey =
          action === "delete" ? "database_modification" : action === "create" ? "file_write" : "database_modification";
        const decision = services.policyEngine.evaluateAction(ref, riskKey, {
          automation: false,
          approved: true,
        });
        if (!decision.allowed && ["approval.denied"].includes(decision.policyId)) {
          throw new PolicyDeniedError(decision.policyId, decision.reason);
        }

        if (action === "create") {
          if (!args.databaseName) {
            throw new PolicyDeniedError("validation", "databaseName is required for create");
          }
          const created = await panel.clientApi!.createDatabase(ref, {
            database: String(args.databaseName),
            ...(args.remote ? { remote: String(args.remote) } : {}),
          });
          await services.changeLedger.record({
            ref,
            actor: ctx.actor,
            origin: "mcp:manage_database",
            action: "database_create",
            target: created.name,
            result: "success",
            risk: decision.risk,
            reason: args.reason ? String(args.reason) : null,
          });
          return {
            created: true,
            database: { id: created.id, name: created.name, username: created.username, host: `${created.hostAddress}:${String(created.hostPort)}` },
            password: created.password ? "[REDACTED]" : null,
          };
        }
        if (!args.databaseId) {
          throw new PolicyDeniedError("validation", "databaseId is required for rotate_password and delete");
        }
        if (action === "rotate_password") {
          const rotated = await panel.clientApi!.rotateDatabasePassword(ref, Number(args.databaseId));
          await services.changeLedger.record({
            ref,
            actor: ctx.actor,
            origin: "mcp:manage_database",
            action: "database_rotate_password",
            target: rotated.name,
            result: "success",
            risk: decision.risk,
            reason: args.reason ? String(args.reason) : null,
          });
          return {
            rotated: true,
            database: { id: rotated.id, name: rotated.name, username: rotated.username },
            note: "the new password is stored on the panel; retrieve it from the panel UI if needed",
          };
        }
        await panel.clientApi!.deleteDatabase(ref, Number(args.databaseId));
        await services.changeLedger.record({
          ref,
          actor: ctx.actor,
          origin: "mcp:manage_database",
          action: "database_delete",
          target: String(args.databaseId),
          result: "success",
          risk: "HIGH",
          reason: args.reason ? String(args.reason) : null,
        });
        return { deleted: true, databaseId: Number(args.databaseId) };
      },
    },
  ];
}

export function scheduleTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_list_schedules",
      title: "List scheduled tasks",
      description: "Lists cron schedules with their tasks, activation state and next run time. Read-only.",
      inputSchema: { server: serverArg },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.schedules"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.schedules"] });
        const schedules = await panel.clientApi!.listSchedules(ref);
        return {
          server: `${ref.panel}/${ref.serverId}`,
          schedules: schedules.map((schedule) => ({
            id: schedule.id,
            name: schedule.name,
            cron: `${schedule.cron.minute} ${schedule.cron.hour} ${schedule.cron.dayOfMonth} ${schedule.cron.month} ${schedule.cron.dayOfWeek}`,
            active: schedule.active,
            onlyWhenOnline: schedule.onlyWhenOnline,
            lastRunAt: schedule.lastRunAt,
            nextRunAt: schedule.nextRunAt,
            tasks: schedule.tasks.map((task) => ({
              action: task.action,
              payload: task.payload,
              timeOffset: task.timeOffset,
            })),
          })),
        };
      },
    },
    {
      name: "ptero_manage_schedule",
      title: "Create, toggle, run or delete a schedule",
      description:
        "MUTATING schedule management. Actions: create (cron + tasks), toggle (enable/disable), execute (run now), delete. Audited and ledger-recorded.",
      inputSchema: {
        server: serverArg,
        action: z.enum(["create", "toggle", "execute", "delete"]),
        scheduleId: z.number().int().positive().optional().describe("Required except for create."),
        name: z.string().max(120).optional(),
        cron: z
          .object({
            minute: z.string().max(10).default("0"),
            hour: z.string().max(10).default("*"),
            dayOfMonth: z.string().max(10).default("*"),
            month: z.string().max(10).default("*"),
            dayOfWeek: z.string().max(10).default("*"),
          })
          .optional(),
        tasks: z
          .array(
            z.object({
              action: z.enum(["command", "power", "backup"]),
              payload: z.string().max(2000),
              timeOffset: z.number().int().min(0).max(3600).optional(),
            }),
          )
          .max(10)
          .optional(),
        onlyWhenOnline: z.boolean().optional(),
        reason: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      capabilities: { allOf: ["client.schedules"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.schedules"] });
        const action = args.action as "create" | "toggle" | "execute" | "delete";
        if (action === "create") {
          const cron = args.cron as
            | { minute?: string; hour?: string; dayOfMonth?: string; month?: string; dayOfWeek?: string }
            | undefined;
          const tasks = args.tasks as
            | Array<{ action: "command" | "power" | "backup"; payload: string; timeOffset?: number }>
            | undefined;
          if (!args.name || !cron) {
            throw new PolicyDeniedError("validation", "name and cron are required for create");
          }
          for (const task of tasks ?? []) {
            if (task.action === "command") {
              const decision = services.policyEngine.evaluateCommand(ref, task.payload, {
                automation: false,
                approved: true,
              });
              if (!decision.allowed) {
                throw new PolicyDeniedError(decision.policyId, `Task command rejected: ${decision.reason}`);
              }
            }
          }
          const created = await panel.clientApi!.createSchedule(ref, {
            name: String(args.name),
            minute: cron.minute,
            hour: cron.hour,
            dayOfMonth: cron.dayOfMonth,
            month: cron.month,
            dayOfWeek: cron.dayOfWeek,
            ...(args.onlyWhenOnline !== undefined ? { onlyWhenOnline: args.onlyWhenOnline === true } : {}),
            ...(tasks ? { tasks } : {}),
          });
          await services.changeLedger.record({
            ref,
            actor: ctx.actor,
            origin: "mcp:manage_schedule",
            action: "schedule_create",
            target: String(created.id),
            result: "success",
            risk: "MEDIUM",
            reason: args.reason ? String(args.reason) : null,
          });
          return { created: true, scheduleId: created.id, name: created.name };
        }
        if (!args.scheduleId) {
          throw new PolicyDeniedError("validation", "scheduleId is required");
        }
        if (action === "toggle") {
          await panel.clientApi!.toggleSchedule(ref, Number(args.scheduleId));
        } else if (action === "execute") {
          await panel.clientApi!.executeSchedule(ref, Number(args.scheduleId));
        } else {
          await panel.clientApi!.deleteSchedule(ref, Number(args.scheduleId));
        }
        await services.changeLedger.record({
          ref,
          actor: ctx.actor,
          origin: "mcp:manage_schedule",
          action: `schedule_${action}`,
          target: String(args.scheduleId),
          result: "success",
          risk: action === "delete" ? "MEDIUM" : "LOW",
          reason: args.reason ? String(args.reason) : null,
        });
        return { ok: true, action, scheduleId: Number(args.scheduleId) };
      },
    },
  ];
}

export function networkTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_list_allocations",
      title: "List network allocations",
      description: "Lists the server's network allocations with the primary marked. Read-only.",
      inputSchema: { server: serverArg },
      annotations: { readOnlyHint: true },
      capabilities: { anyOf: ["client.server.read", "client.allocations"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { anyOf: ["client.server.read", "client.allocations"] });
        const allocations = panel.capabilities.has("client.allocations")
          ? await panel.clientApi!.listAllocations(ref)
          : (await panel.clientApi!.getServer(ref, { includeAllocations: true })).allocations.map(
              (allocation) => ({
                id: allocation.id,
                ip: allocation.ip,
                ipAlias: allocation.alias,
                port: allocation.port,
                notes: null,
                primary: allocation.primary,
              }),
            );
        return {
          server: `${ref.panel}/${ref.serverId}`,
          allocations: allocations.map((allocation) => ({
            id: allocation.id,
            address: `${allocation.ip}:${String(allocation.port)}`,
            alias: allocation.ipAlias,
            notes: allocation.notes,
            primary: allocation.primary,
          })),
        };
      },
    },
    {
      name: "ptero_manage_allocation",
      title: "Assign, promote, annotate or release an allocation",
      description:
        "MUTATING network allocation management. Actions: assign (request a new allocation from the panel), primary (make an allocation the primary), notes (annotate), release (return an allocation to the pool). Primary changes require a restart to take effect in most applications. Audited.",
      inputSchema: {
        server: serverArg,
        action: z.enum(["assign", "primary", "notes", "release"]),
        allocationId: z.number().int().positive().optional().describe("Required except for assign."),
        notes: z.string().max(300).optional().describe("Required for the notes action."),
        reason: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      capabilities: { allOf: ["client.allocations"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.allocations"] });
        const action = args.action as "assign" | "primary" | "notes" | "release";
        const decision = services.policyEngine.evaluateAction(ref, "allocation_change", {
          automation: false,
          approved: true,
        });
        if (!decision.allowed && decision.policyId === "approval.denied") {
          throw new PolicyDeniedError(decision.policyId, decision.reason);
        }
        if (action === "assign") {
          const allocation = await panel.clientApi!.assignAllocation(ref);
          await services.changeLedger.record({
            ref,
            actor: ctx.actor,
            origin: "mcp:manage_allocation",
            action: "allocation_assign",
            target: `${allocation.ip}:${String(allocation.port)}`,
            result: "success",
            risk: decision.risk,
            reason: args.reason ? String(args.reason) : null,
          });
          return { assigned: true, allocation: { id: allocation.id, address: `${allocation.ip}:${String(allocation.port)}` }, note: "restart the server for the application to see the new port" };
        }
        if (!args.allocationId) {
          throw new PolicyDeniedError("validation", "allocationId is required");
        }
        if (action === "primary") {
          await panel.clientApi!.setPrimaryAllocation(ref, Number(args.allocationId));
        } else if (action === "notes") {
          await panel.clientApi!.updateAllocationNotes(ref, Number(args.allocationId), String(args.notes ?? ""));
        } else {
          await panel.clientApi!.releaseAllocation(ref, Number(args.allocationId));
        }
        await services.changeLedger.record({
          ref,
          actor: ctx.actor,
          origin: "mcp:manage_allocation",
          action: `allocation_${action}`,
          target: String(args.allocationId),
          result: "success",
          risk: decision.risk,
          reason: args.reason ? String(args.reason) : null,
        });
        return { ok: true, action, allocationId: Number(args.allocationId) };
      },
    },
  ];
}

export function subuserTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_list_subusers",
      title: "List subusers",
      description: "Lists users with access to this server and their permissions. Read-only.",
      inputSchema: { server: serverArg },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.users.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.users.read"] });
        const users = await panel.clientApi!.listSubusers(ref);
        return {
          server: `${ref.panel}/${ref.serverId}`,
          subusers: users.map((user) => ({
            uuid: user.uuid,
            username: user.username,
            email: user.email,
            twoFactorEnabled: user.twoFactorEnabled,
            createdAt: user.createdAt,
            permissions: user.permissions,
          })),
        };
      },
    },
    {
      name: "ptero_manage_subuser",
      title: "Invite, update or remove a subuser",
      description:
        "MUTATING subuser management. Actions: create (invite by email with permissions), update (replace permissions), delete (revoke access). Permissions use Pterodactyl permission keys (e.g. control.console, control.start, files.read). Audited.",
      inputSchema: {
        server: serverArg,
        action: z.enum(["create", "update", "delete"]),
        email: z.string().email().optional().describe("Required for create."),
        userUuid: z.string().min(1).optional().describe("Required for update and delete."),
        permissions: z.array(z.string().min(1).max(64)).max(64).optional(),
        reason: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      capabilities: { allOf: ["client.users.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.users.read"] });
        const action = args.action as "create" | "update" | "delete";
        if (action === "create") {
          if (!args.email) {
            throw new PolicyDeniedError("validation", "email is required for create");
          }
          const created = await panel.clientApi!.createSubuser(ref, {
            email: String(args.email),
            permissions: (args.permissions as string[] | undefined) ?? ["control.console", "control.start", "control.stop"],
          });
          await services.changeLedger.record({
            ref,
            actor: ctx.actor,
            origin: "mcp:manage_subuser",
            action: "subuser_create",
            target: created.email,
            result: "success",
            risk: "MEDIUM",
            reason: args.reason ? String(args.reason) : null,
          });
          return { created: true, subuser: { uuid: created.uuid, email: created.email, permissions: created.permissions } };
        }
        if (!args.userUuid) {
          throw new PolicyDeniedError("validation", "userUuid is required");
        }
        if (action === "update") {
          await panel.clientApi!.updateSubuser(ref, String(args.userUuid), (args.permissions as string[] | undefined) ?? []);
        } else {
          await panel.clientApi!.deleteSubuser(ref, String(args.userUuid));
        }
        await services.changeLedger.record({
          ref,
          actor: ctx.actor,
          origin: "mcp:manage_subuser",
          action: `subuser_${action}`,
          target: String(args.userUuid),
          result: "success",
          risk: action === "delete" ? "MEDIUM" : "LOW",
          reason: args.reason ? String(args.reason) : null,
        });
        return { ok: true, action, userUuid: String(args.userUuid) };
      },
    },
  ];
}
