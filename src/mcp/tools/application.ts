import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { collectDependencyReport } from "../../applications/dependency-service.js";
import { requirePanel, resolveRef, serverArg } from "./helpers.js";

export function applicationTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_detect_application",
      title: "Detect the running application",
      description:
        "Detects what is actually running inside the server (runtime, application, distribution, version) using multi-signal evidence: egg/docker image/startup command, files, config files and recent console output. Returns confidence and the evidence used; never invents versions. Read-only.",
      inputSchema: {
        server: serverArg,
        refresh: z.boolean().optional().describe("Bypass cached detection signals."),
      },
      annotations: { readOnlyHint: true },
      capabilities: { anyOf: ["client.server.read", "application.servers.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        requirePanel(services, ref, {
          anyOf: ["client.server.read", "application.servers.read"],
        });
        const signals = await services.signalCollector.collect(ref, {
          ...(args.refresh === true ? { bypassCache: true } : {}),
        });
        const detection = services.detector.detect(signals);
        const applicationLabel = `${detection.application}${detection.distribution ? `/${detection.distribution}` : ""}${detection.version ? ` ${detection.version}` : ""}`;
        await services.serverCache.updateApplication(ref, applicationLabel);
        const profile =
          services.profiles.byId(detection.profileId ?? "") ??
          services.profiles.lookup(detection.application, detection.distribution);
        return {
          server: `${ref.panel}/${ref.serverId}`,
          detection,
          profile: {
            id: profile.id,
            displayName: profile.displayName,
            expectedPorts: profile.expectedPorts,
            gracefulStopCommand: profile.gracefulStopCommand,
            configLocations: profile.configLocations,
            dependencyManifests: profile.dependencyManifests,
            diagnosticCommands: profile.diagnosticCommands,
            commonFailureModes: profile.commonFailureModes,
          },
        };
      },
    },
    {
      name: "ptero_analyze_dependencies",
      title: "Analyze dependencies",
      description:
        "Parses dependency manifests and plugin/mod directories (Node, Python, JVM, Go, Rust, Minecraft) and reports components plus evidence-backed issues (unpinned versions, missing lockfiles, duplicate plugins/mods, unparseable manifests). Evidence and hypotheses are separated; dependencies are never invented. Read-only.",
      inputSchema: { server: serverArg },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.files.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        requirePanel(services, ref, { allOf: ["client.files.read"] });
        const report = await collectDependencyReport(
          {
            panels: services.panels,
            maxFileSizeBytes: services.config.policy.maxFileSizeBytes,
            logger: services.logger,
          },
          ref,
        );
        return { server: `${ref.panel}/${ref.serverId}`, ...report };
      },
    },
  ];
}
