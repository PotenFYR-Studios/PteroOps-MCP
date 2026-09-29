import { z } from "zod";
import type { ToolDefinition } from "../registry.js";

export function adminTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_admin_list_nodes",
      title: "List Pterodactyl nodes (admin)",
      description:
        "Application-API view of nodes: fqdn, maintenance flag, memory/disk allocation, server counts. Requires an application key (ptla_). Read-only.",
      inputSchema: {
        panel: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["application.nodes.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const panel = services.panels.requireCapability(
          args.panel ? String(args.panel) : undefined,
          { allOf: ["application.nodes.read"] },
        );
        const { nodes, total } = await panel.applicationApi!.listNodes();
        const limit = Number(args.limit ?? 200);
        return {
          panel: panel.name,
          total,
          nodes: nodes.slice(0, limit).map((node) => ({
            id: node.id,
            name: node.name,
            fqdn: node.fqdn,
            scheme: node.scheme,
            maintenance: node.maintenance,
            memoryBytes: node.memoryBytes,
            diskBytes: node.diskBytes,
            memoryOverallocate: node.memoryOverallocate,
            diskOverallocate: node.diskOverallocate,
            allocationCount: node.allocationCount,
            serverCount: node.serverCount,
          })),
          truncated: nodes.length > limit,
        };
      },
    },
    {
      name: "ptero_admin_list_users",
      title: "List panel users (admin)",
      description:
        "Application-API view of panel users: username, email, admin flag, server counts. Requires an application key (ptla_). Read-only.",
      inputSchema: {
        panel: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["application.users.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const panel = services.panels.requireCapability(
          args.panel ? String(args.panel) : undefined,
          { allOf: ["application.users.read"] },
        );
        const { users, total } = await panel.applicationApi!.listUsers();
        const limit = Number(args.limit ?? 200);
        return {
          panel: panel.name,
          total,
          users: users.slice(0, limit).map((user) => ({
            id: user.id,
            username: user.username,
            email: user.email,
            rootAdmin: user.rootAdmin,
            serverCount: user.serverCount,
          })),
          truncated: users.length > limit,
        };
      },
    },
    {
      name: "ptero_admin_list_nests",
      title: "List nests and eggs (admin)",
      description:
        "Application-API view of nests and their eggs: names, docker images, startup commands. Useful for understanding what kinds of servers exist on the panel. Requires an application key (ptla_). Read-only.",
      inputSchema: {
        panel: z.string().optional(),
        nestId: z.number().int().positive().optional().describe("Restrict to one nest."),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["application.nests.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const panel = services.panels.requireCapability(
          args.panel ? String(args.panel) : undefined,
          { allOf: ["application.nests.read"] },
        );
        const nests = await panel.applicationApi!.listNests();
        const limit = Number(args.limit ?? 300);
        const eggs = args.nestId
          ? await panel.applicationApi!.listEggs(Number(args.nestId))
          : (
              await Promise.all(
                nests.slice(0, 10).map((nest) => panel.applicationApi!.listEggs(nest.id)),
              )
            ).flat();
        return {
          panel: panel.name,
          nests: nests.map((nest) => ({
            id: nest.id,
            name: nest.name,
            description: nest.description,
            eggCount: nest.eggCount,
          })),
          eggs: eggs.slice(0, limit).map((egg) => ({
            id: egg.id,
            nestId: egg.nestId,
            name: egg.name,
            dockerImage: egg.dockerImage,
            startup: egg.startup,
          })),
          truncated: eggs.length > limit,
        };
      },
    },
  ];
}
