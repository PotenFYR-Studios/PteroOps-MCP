import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { analyzeLogEvents } from "../../intelligence/logs/engine.js";
import { searchTextFiles } from "../../files/search.js";
import { validateFileContent } from "../../applications/validation.js";
import { assertSafePath, requirePanel, resolveRef, serverArg } from "./helpers.js";

const TEXT_EXTENSIONS = /\.(properties|ya?ml|json|env|toml|ini|cfg|conf|txt|log|sh|service|md|xml|gradle|kts)$/i;

export function debugTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_debug_context",
      title: "Collect code/config context for debugging",
      description:
        "AI code-debugging context: extracts file:line references from the recent stack traces, locates those files on the server, returns bounded code snippets with line numbers around each frame, validates referenced config files (JSON/YAML/properties/env syntax) and derives hints (e.g. which shipped plugin/mod matches a failing package). Read-only and evidence-only: unresolved frames report what was searched instead of guessing. Run ptero_diagnose first - this is the deep-dive that follows it.",
      inputSchema: {
        server: serverArg,
        windowMinutes: z.number().int().min(1).max(1440).optional(),
        maxFiles: z.number().int().min(1).max(6).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { anyOf: ["client.console.read", "client.server.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        requirePanel(services, ref, {
          anyOf: ["client.console.read", "client.server.read"],
        });
        const windowMinutes = Number(args.windowMinutes ?? 60);
        const now = Date.now();
        const events = await services.consoleService.window(ref, now - windowMinutes * 60_000, now, {
          limit: 5000,
        });
        const analysis = analyzeLogEvents(events);
        const result = await services.debugContext.build(ref, analysis, {
          configPaths: ["/server.properties", "/config.yml", "/config.yaml", "/application.yml", "/package.json"],
        });
        return {
          server: `${ref.panel}/${ref.serverId}`,
          windowMinutes,
          exceptions: result.exceptions,
          snippets: result.snippets,
          configValidation: result.configValidation,
          hints: result.hints,
          searchedPaths: result.searchedPaths,
          missingEvidence: result.missingEvidence,
          note: "snippets are bounded to a few lines around each frame; use ptero_read_file for full files and ptero_search_files to locate settings",
        };
      },
    },
    {
      name: "ptero_search_files",
      title: "Search text files on a server",
      description:
        "Bounded grep across a server's text files (config locations from the detected application profile by default, or explicit paths): plain text or regex, case sensitivity, per-file size cap, result cap. Use it to answer 'where is this setting defined?' without reading whole files or dumping logs. Binary files and jars are skipped and reported. Read-only.",
      inputSchema: {
        server: serverArg,
        query: z.string().min(1).max(200),
        regex: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        paths: z
          .array(z.string().max(300))
          .max(20)
          .optional()
          .describe("Explicit files/directories to search (default: profile config locations + root manifests)."),
        maxResults: z.number().int().min(1).max(200).optional(),
        maxFileSizeBytes: z.number().int().min(1024).max(2_000_000).optional(),
        includeLineNumbers: z.boolean().optional(),
        contextLines: z.number().int().min(0).max(3).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.files.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.files.read"] });
        const api = panel.clientApi!;
        const maxFileSize = Number(args.maxFileSizeBytes ?? 200_000);

        let candidates: string[] = [];
        const rawPaths = args.paths as string[] | undefined;
        if (rawPaths && rawPaths.length > 0) {
          candidates = rawPaths.map((path) => assertSafePath(path));
        } else {
          const detection = services.detector.detect(await services.signalCollector.collect(ref, {}));
          const profile =
            services.profiles.byId(detection.profileId ?? "") ??
            services.profiles.lookup(detection.application, detection.distribution);
          const rootListing = await api.listFiles(ref, "/").catch(() => []);
          candidates = rootListing
            .filter((entry) => !entry.directory && TEXT_EXTENSIONS.test(entry.name))
            .slice(0, 40)
            .map((entry) => `/${entry.name}`);
          for (const location of profile.configLocations) {
            const path = assertSafePath(location.startsWith("/") ? location : `/${location}`);
            if (!candidates.includes(path)) candidates.push(path);
          }
        }

        const files: Record<string, string> = {};
        const unreadable: string[] = [];
        for (const candidate of candidates.slice(0, 60)) {
          try {
            const content = await api.readFile(ref, candidate);
            if (content.length <= maxFileSize) {
              files[candidate] = content;
            } else {
              unreadable.push(`${candidate} (too large: ${String(content.length)} bytes)`);
            }
          } catch {
            unreadable.push(`${candidate} (not found or unreadable)`);
          }
        }
        const result = searchTextFiles(files, String(args.query), {
          ...(args.regex !== undefined ? { regex: args.regex === true } : {}),
          ...(args.caseSensitive !== undefined ? { caseSensitive: args.caseSensitive === true } : {}),
          ...(args.maxResults !== undefined ? { maxResults: Number(args.maxResults) } : {}),
        });
        const matches = result.matches.map((match) => ({
          file: match.file,
          line: match.line,
          text: services.redactor.redact(match.text),
        }));
        return {
          server: `${ref.panel}/${ref.serverId}`,
          query: String(args.query),
          matches,
          matchCount: matches.length,
          truncated: result.truncated,
          filesSearched: result.filesSearched,
          binarySkipped: result.filesSkipped,
          unreadable,
          note: "only the provided/default file set is searched; jars and other binaries are never scanned",
        };
      },
    },
  ];
}

export function configValidationTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_validate_config",
      title: "Validate a config file's syntax",
      description:
        "Syntax-checks a single configuration file on the server (server.properties, JSON, YAML, dotenv) and returns per-line issues (invalid entries, duplicate keys, parse errors). Use before editing a file, before restarting, or as a pre-change test. Read-only.",
      inputSchema: {
        server: serverArg,
        path: z.string().min(1).max(300),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.files.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const panel = requirePanel(services, ref, { allOf: ["client.files.read"] });
        const path = assertSafePath(String(args.path));
        const content = await panel.clientApi!.readFile(ref, path);
        const validation = validateFileContent(path, services.redactor.redact(content));
        return {
          server: `${ref.panel}/${ref.serverId}`,
          ...validation,
          note:
            validation.status === "skipped"
              ? "no syntax validator exists for this file type"
              : undefined,
        };
      },
    },
  ];
}
