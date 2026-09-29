import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { PolicyDeniedError } from "../../shared/errors.js";
import { parseDuration, parseTimeArgument } from "../../shared/time.js";
import type { Severity } from "../../shared/types.js";
import { truncateLine, requirePanel, resolveRef, serverArg } from "./helpers.js";
import { analyzeLogEvents } from "../../intelligence/logs/engine.js";
import { LOG_PATTERNS } from "../../intelligence/logs/patterns.js";
import { sleep } from "../../shared/async.js";

const severityEnum = z.enum(["debug", "info", "warn", "error", "fatal"]);

export function consoleTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_console_query",
      title: "Query persistent console history",
      description:
        "Searches stored console history with time windows, severities, text/regex, fingerprint or lifecycle-event filters. Modes: latest (default), first (first occurrence of a match), before (context immediately before a timestamp — e.g. 'what happened before the crash'), events (lifecycle/warning+ only). Results are bounded and grouped-friendly; never returns unbounded dumps. Read-only.",
      inputSchema: {
        server: serverArg,
        window: z.string().optional().describe('How far back to search, e.g. "20m", "2h". Ignored when "since" is given.'),
        since: z.string().optional().describe("Start time (ISO 8601, epoch ms, or relative like -20m)."),
        until: z.string().optional().describe("End time (ISO 8601, epoch ms, or relative)."),
        around: z
          .string()
          .optional()
          .describe("Reference time for mode=before, or center for time filtering."),
        aroundWindow: z
          .string()
          .optional()
          .describe('Half-window around "around" (default "15m").'),
        severities: z.array(severityEnum).optional(),
        text: z.string().max(200).optional().describe("Case-insensitive substring filter."),
        regex: z.string().max(200).optional().describe("Case-insensitive regex filter (applied after SQL filters; keep it simple)."),
        fingerprint: z.string().max(64).optional(),
        mode: z.enum(["latest", "first", "before", "events"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.console.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        requirePanel(services, ref, { allOf: ["client.console.read"] });
        const now = Date.now();
        const mode = (args.mode as "latest" | "first" | "before" | "events" | undefined) ?? "latest";
        const around =
          args.around !== undefined ? parseTimeArgument(String(args.around), now) : undefined;
        let since = args.since !== undefined ? parseTimeArgument(String(args.since), now) : undefined;
        const until = args.until !== undefined ? parseTimeArgument(String(args.until), now) : undefined;
        if (args.aroundWindow !== undefined && around !== undefined) {
          const half = parseDuration(String(args.aroundWindow));
          since = since ?? around - half;
        }
        if (since === undefined && args.window !== undefined) {
          since = now - parseDuration(String(args.window));
        }
        const page = await services.consoleService.query({
          ref,
          mode,
          ...(since !== undefined ? { since } : {}),
          ...(until !== undefined ? { until } : {}),
          ...(around !== undefined ? { around } : {}),
          ...(args.severities ? { severities: args.severities as Severity[] } : {}),
          ...(args.text !== undefined ? { text: String(args.text) } : {}),
          ...(args.regex !== undefined ? { regex: String(args.regex) } : {}),
          ...(args.fingerprint !== undefined ? { fingerprint: String(args.fingerprint) } : {}),
          ...(args.order !== undefined ? { order: args.order as "asc" | "desc" } : {}),
          ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
        });
        const grouped = groupByFingerprint(page.events);
        return {
          server: `${ref.panel}/${ref.serverId}`,
          mode,
          returned: page.events.length,
          truncated: page.truncated,
          groups: grouped.groups,
          events: page.events.map((event) => ({
            ts: event.ts,
            severity: event.severity,
            subsystem: event.subsystem,
            exceptionType: event.exceptionType,
            fingerprint: event.fingerprint,
            line: truncateLine(event.normalized),
          })),
        };
      },
    },
    {
      name: "ptero_console_watch",
      title: "Watch live console output (bounded)",
      description:
        "Captures live console output for a bounded number of seconds (5–120) and returns the collected lines. Use only when stored history is empty; prefer ptero_console_query for history. Read-only.",
      inputSchema: {
        server: serverArg,
        seconds: z.number().int().min(5).max(120).optional(),
        maxLines: z.number().int().min(10).max(500).optional(),
        filter: z.string().max(100).optional().describe("Optional case-insensitive substring filter."),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.console.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        requirePanel(services, ref, { allOf: ["client.console.read"] });
        const seconds = Number(args.seconds ?? 15);
        const maxLines = Number(args.maxLines ?? 200);
        const startedAt = Date.now();
        services.streamerManager.ensure(ref);
        await sleep(seconds * 1000, ctx.signal);
        const events = await services.consoleService.window(ref, startedAt - 2000, Date.now(), {
          limit: maxLines,
        });
        const filter = args.filter ? String(args.filter).toLowerCase() : null;
        const filtered = filter
          ? events.filter((event) => event.normalized.toLowerCase().includes(filter))
          : events;
        return {
          server: `${ref.panel}/${ref.serverId}`,
          capturedSeconds: seconds,
          lines: filtered.map((event) => ({
            ts: event.ts,
            severity: event.severity,
            line: truncateLine(event.normalized),
          })),
          note:
            filtered.length === 0
              ? "No output captured. The server may be offline or the console stream may not be connected."
              : undefined,
        };
      },
    },
    {
      name: "ptero_analyze_logs",
      title: "Analyze console logs",
      description:
        "Runs deterministic log intelligence over a window: fingerprinted issues with counts and first/last occurrence, grouped stack traces, pattern hits (OOM, segfault, port bind, DB, auth, permissions, disk, rate limit, module, config, TLS, dependency) and lifecycle events. Use this instead of pasting raw logs; raw evidence remains available via ptero_console_query. Read-only.",
      inputSchema: {
        server: serverArg,
        windowMinutes: z.number().int().min(1).max(1440).optional(),
        patterns: z.array(z.string()).optional().describe("Restrict results to these pattern ids."),
        minSeverity: severityEnum.optional(),
        limit: z.number().int().min(50).max(20000).optional(),
      },
      annotations: { readOnlyHint: true },
      capabilities: { allOf: ["client.console.read"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        requirePanel(services, ref, { allOf: ["client.console.read"] });
        const windowMinutes = Number(args.windowMinutes ?? 60);
        const now = Date.now();
        const events = await services.consoleService.window(ref, now - windowMinutes * 60_000, now, {
          limit: Number(args.limit ?? 5000),
        });
        const analysis = analyzeLogEvents(events);
        const severityRank: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
        const minRank = severityRank[String(args.minSeverity ?? "warn")] ?? 2;
        const patternFilter = args.patterns ? new Set(args.patterns as string[]) : null;
        const issues = analysis.issues.filter(
          (issue) => severityRank[issue.severity]! >= minRank,
        );
        const patterns = analysis.patterns.filter(
          (pattern) => !patternFilter || patternFilter.has(pattern.id),
        );
        return {
          server: `${ref.panel}/${ref.serverId}`,
          windowMinutes,
          summary: analysis.summary,
          bySeverity: analysis.bySeverity,
          totalEvents: analysis.totalEvents,
          issues,
          stackTraces: analysis.stackTraces,
          patterns,
          lifecycle: analysis.lifecycle.slice(-20),
          truncated: analysis.truncated,
          consoleEventsInspected: events.length,
          availablePatternIds: LOG_PATTERNS.map((pattern) => pattern.id),
        };
      },
    },
    {
      name: "ptero_send_command",
      title: "Send a console command",
      description:
        "Sends one console command to a server. MUTATING and audited: policy may block the command pattern, and the change ledger records it. Do NOT use console commands to 'test' fixes before diagnosing, and never send stop/restart commands while investigating a crash loop (use ptero_diagnose first). Empty commands and blocked patterns are rejected.",
      inputSchema: {
        server: serverArg,
        command: z.string().min(1).max(500),
        reason: z.string().max(300).optional().describe("Why this command is necessary (recorded in the ledger)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      capabilities: { allOf: ["client.console.write"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const command = String(args.command);
        const decision = services.policyEngine.evaluateCommand(ref, command, {
          automation: false,
          approved: true,
        });
        if (!decision.allowed) {
          throw new PolicyDeniedError(decision.policyId, decision.reason, {
            hint: "Adjust policy.allowedCommands/blockedCommands or use an approved remediation path.",
            details: { risk: decision.risk, command },
          });
        }
        const panel = requirePanel(services, ref, { allOf: ["client.console.write"] });
        await panel.clientApi!.sendCommand(ref, command);
        await services.changeLedger.record({
          ref,
          actor: ctx.actor,
          origin: "mcp:send_command",
          action: "send_command",
          target: "console",
          result: "success",
          risk: decision.risk,
          reason: args.reason ? String(args.reason) : null,
          details: { command, correlationId: ctx.correlationId },
        });
        return {
          sent: true,
          server: `${ref.panel}/${ref.serverId}`,
          risk: decision.risk,
          policy: decision.reason,
          ledger: "change recorded",
        };
      },
    },
  ];
}

function groupByFingerprint(
  events: Array<{
    fingerprint: string | null;
    normalized: string;
    ts: number;
    severity: string;
    exceptionType?: string | null;
  }>,
): { groups: Array<Record<string, unknown>> } {
  const map = new Map<string, { count: number; first: number; last: number; sample: string; severity: string; exceptionType?: string | null }>();
  for (const event of events) {
    const key = event.fingerprint ?? `text:${event.normalized.slice(0, 80)}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.first = Math.min(existing.first, event.ts);
      existing.last = Math.max(existing.last, event.ts);
    } else {
      map.set(key, {
        count: 1,
        first: event.ts,
        last: event.ts,
        sample: event.normalized.slice(0, 200),
        severity: event.severity,
        exceptionType: event.exceptionType ?? null,
      });
    }
  }
  const groups = [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 25)
    .map(([fingerprint, value]) => ({
      fingerprint,
      count: value.count,
      firstSeen: value.first,
      lastSeen: value.last,
      severity: value.severity,
      exceptionType: value.exceptionType,
      sample: value.sample,
    }));
  return { groups };
}
