import type { ConsoleEvent } from "../../persistence/models.js";
import type { EvidenceItem, Severity } from "../../shared/types.js";
import { fingerprintOf } from "../../shared/hash.js";
import { formatDuration } from "../../shared/time.js";
import { truncate } from "../../shared/text.js";
import { classifyConsoleLine, isExceptionHeader, isStackContinuation, type LifecycleKind } from "./classify.js";
import { matchPatterns, type PatternAction } from "./patterns.js";

export interface LogIssue {
  fingerprint: string;
  exceptionType: string | null;
  severity: Severity;
  subsystem: string | null;
  count: number;
  firstSeen: number;
  lastSeen: number;
  sample: string;
  patternIds: string[];
  incidentId: string | null;
}

export interface StackTraceGroup {
  fingerprint: string;
  header: string;
  context: string[];
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface PatternHitSummary {
  id: string;
  label: string;
  severity: Severity;
  count: number;
  firstSeen: number;
  lastSeen: number;
  sample: string;
  commonCauses: string[];
  recommendedActions: PatternAction[];
}

export interface LifecycleSummaryEvent {
  ts: number;
  kind: LifecycleKind;
  detail: string;
}

export interface LogAnalysis {
  windowMs: number;
  from: number | null;
  to: number | null;
  totalEvents: number;
  bySeverity: Record<Severity, number>;
  issues: LogIssue[];
  stackTraces: StackTraceGroup[];
  patterns: PatternHitSummary[];
  lifecycle: LifecycleSummaryEvent[];
  truncated: boolean;
  summary: string;
}

export interface AnalyzeOptions {
  maxIssues?: number;
  maxStackTraces?: number;
  maxPatterns?: number;
  maxStackLines?: number;
}

const DEFAULT_MAX_ISSUES = 20;
const DEFAULT_MAX_STACK_TRACES = 10;
const DEFAULT_MAX_PATTERNS = 20;
const DEFAULT_MAX_STACK_LINES = 12;

export function analyzeLogEvents(events: ConsoleEvent[], options: AnalyzeOptions = {}): LogAnalysis {
  const maxIssues = options.maxIssues ?? DEFAULT_MAX_ISSUES;
  const maxStackTraces = options.maxStackTraces ?? DEFAULT_MAX_STACK_TRACES;
  const maxPatterns = options.maxPatterns ?? DEFAULT_MAX_PATTERNS;
  const maxStackLines = options.maxStackLines ?? DEFAULT_MAX_STACK_LINES;

  const bySeverity: Record<Severity, number> = { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
  const issueMap = new Map<string, LogIssue>();
  const stackMap = new Map<string, StackTraceGroup>();
  const patternMap = new Map<string, PatternHitSummary>();
  const lifecycle: LifecycleSummaryEvent[] = [];

  let from: number | null = null;
  let to: number | null = null;
  let activeStack: StackTraceGroup | null = null;
  let activeStackLines = 0;

  const sorted = [...events].sort((a, b) => a.ts - b.ts);

  for (const event of sorted) {
    bySeverity[event.severity] += 1;
    from = from === null || event.ts < from ? event.ts : from;
    to = to === null || event.ts > to ? event.ts : to;

    const classification = event.subsystem === "lifecycle"
      ? classifyConsoleLine(event.normalized)
      : null;
    const lifecycleKind = classification?.lifecycle ?? null;
    if (lifecycleKind) {
      lifecycle.push({ ts: event.ts, kind: lifecycleKind, detail: truncate(event.normalized, 220) });
    }

    if (isExceptionHeader(event.normalized) && !isStackContinuation(event.normalized)) {
      const fingerprint = event.fingerprint ?? fingerprintOf(event.normalized);
      const existing = stackMap.get(fingerprint);
      if (existing) {
        existing.count += 1;
        existing.lastSeen = Math.max(existing.lastSeen, event.ts);
        stackMap.set(fingerprint, existing);
      } else {
        stackMap.set(fingerprint, {
          fingerprint,
          header: truncate(event.normalized, 300),
          context: [],
          count: 1,
          firstSeen: event.ts,
          lastSeen: event.ts,
        });
      }
      activeStack = stackMap.get(fingerprint) ?? null;
      activeStackLines = 0;
    } else if (activeStack && isStackContinuation(event.normalized)) {
      if (activeStackLines < maxStackLines && activeStack.context.length < maxStackLines) {
        activeStack.context.push(truncate(event.normalized, 300));
      }
      activeStackLines += 1;
    } else if (!isStackContinuation(event.normalized)) {
      activeStack = null;
    }

    if (event.severity === "warn" || event.severity === "error" || event.severity === "fatal") {
      const fingerprint = event.fingerprint ?? fingerprintOf(event.normalized);
      const existing = issueMap.get(fingerprint);
      const patterns = matchPatterns(event.normalized).map((pattern) => pattern.id);
      if (existing) {
        existing.count += 1;
        existing.lastSeen = Math.max(existing.lastSeen, event.ts);
        for (const id of patterns) {
          if (!existing.patternIds.includes(id)) existing.patternIds.push(id);
        }
      } else {
        issueMap.set(fingerprint, {
          fingerprint,
          exceptionType: event.exceptionType,
          severity: event.severity,
          subsystem: event.subsystem,
          count: 1,
          firstSeen: event.ts,
          lastSeen: event.ts,
          sample: truncate(event.normalized, 300),
          patternIds: patterns,
          incidentId: event.incidentId,
        });
      }
    }

    for (const pattern of matchPatterns(event.normalized)) {
      const existing = patternMap.get(pattern.id);
      if (existing) {
        existing.count += 1;
        existing.firstSeen = Math.min(existing.firstSeen, event.ts);
        existing.lastSeen = Math.max(existing.lastSeen, event.ts);
      } else {
        patternMap.set(pattern.id, {
          id: pattern.id,
          label: pattern.label,
          severity: pattern.severity,
          count: 1,
          firstSeen: event.ts,
          lastSeen: event.ts,
          sample: truncate(event.normalized, 300),
          commonCauses: pattern.commonCauses,
          recommendedActions: pattern.recommendedActions,
        });
      }
    }
  }

  const issues = [...issueMap.values()]
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, maxIssues);
  const stackTraces = [...stackMap.values()]
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, maxStackTraces);
  const patterns = [...patternMap.values()]
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, maxPatterns);
  const lifecycleTrimmed = lifecycle.slice(-50);

  const windowMs = from !== null && to !== null ? Math.max(0, to - from) : 0;
  const truncated =
    issueMap.size > maxIssues || stackMap.size > maxStackTraces || patternMap.size > maxPatterns;

  return {
    windowMs,
    from,
    to,
    totalEvents: events.length,
    bySeverity,
    issues,
    stackTraces,
    patterns,
    lifecycle: lifecycleTrimmed,
    truncated,
    summary: buildSummary({
      totalEvents: events.length,
      bySeverity,
      issues,
      patterns,
      lifecycle,
      windowMs,
      truncated,
    }),
  };
}

function buildSummary(input: {
  totalEvents: number;
  bySeverity: Record<Severity, number>;
  issues: LogIssue[];
  patterns: PatternHitSummary[];
  lifecycle: LifecycleSummaryEvent[];
  windowMs: number;
  truncated: boolean;
}): string {
  const parts: string[] = [];
  parts.push(
    `${input.totalEvents} console events over ${input.windowMs > 0 ? formatDuration(input.windowMs) : "an instant"}`,
  );
  const notable = input.bySeverity.error + input.bySeverity.fatal;
  if (notable > 0) {
    parts.push(
      `${input.bySeverity.error} errors, ${input.bySeverity.fatal} fatal, ${input.bySeverity.warn} warnings`,
    );
  } else if (input.bySeverity.warn > 0) {
    parts.push(`${input.bySeverity.warn} warnings, no errors`);
  } else {
    parts.push("no errors or warnings");
  }
  const topIssue = input.issues[0];
  if (topIssue) {
    parts.push(
      `top issue: ${topIssue.exceptionType ?? topIssue.sample.slice(0, 80)} ×${topIssue.count}`,
    );
  }
  const exits = input.lifecycle.filter((event) => event.kind === "exited" || event.kind === "crash").length;
  const starts = input.lifecycle.filter((event) => event.kind === "started").length;
  if (starts > 0 || exits > 0) {
    parts.push(`${starts} start markers, ${exits} exit/crash markers`);
  }
  if (input.patterns.length > 0) {
    parts.push(`patterns: ${input.patterns.slice(0, 5).map((pattern) => pattern.id).join(", ")}`);
  }
  if (input.truncated) parts.push("(results truncated)");
  return parts.join("; ");
}

export function issuesToEvidence(issues: LogIssue[]): EvidenceItem[] {
  return issues.slice(0, 5).map((issue) => ({
    source: "console",
    detail: `${issue.exceptionType ?? "issue"} ×${issue.count} (first ${new Date(issue.firstSeen).toISOString()}, last ${new Date(issue.lastSeen).toISOString()}): ${issue.sample.slice(0, 180)}`,
    weight: Math.min(1, issue.count / 5),
    ts: issue.firstSeen,
  }));
}
