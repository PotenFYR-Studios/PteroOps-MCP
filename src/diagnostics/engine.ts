import type { DiagnosticsConfig } from "../config/schema.js";
import type { ApplicationDetector } from "../applications/detector.js";
import type { ApplicationSignalCollector } from "../applications/signal-collector.js";
import type { ApplicationProfileRegistry } from "../applications/profiles/index.js";
import type { ChangeLedger } from "../changes/ledger.js";
import type { ConsoleService } from "../console/service.js";
import { assessHealth, type HealthAssessment } from "../health/engine.js";
import type { CrashLoopTracker } from "../intelligence/crash-loop/tracker.js";
import type { CrashAssessment } from "../intelligence/crash-loop/detector.js";
import type { LogAnalysis } from "../intelligence/logs/engine.js";
import { analyzeLogEvents, issuesToEvidence } from "../intelligence/logs/engine.js";
import type { DebugContextBuilder, DebugContextResult } from "../intelligence/debug/debug-context.js";
import type { IncidentService } from "../incidents/service.js";
import type { Logger } from "../observability/logger.js";
import type { ChangeEvent, Incident } from "../persistence/models.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { PolicyEngine } from "../security/policy.js";
import { classifyRisk } from "../security/risk.js";
import type { DetectionResult } from "../applications/types.js";
import type { EvidenceItem, RiskLevel, ServerRef } from "../shared/types.js";
import { maxRisk } from "../shared/types.js";
import { formatDuration } from "../shared/time.js";

export interface ProbableCause {
  cause: string;
  confidence: number;
  kind: "observed" | "inferred" | "hypothesis";
  evidence: EvidenceItem[];
}

export interface RecommendedAction {
  action: string;
  description: string;
  risk: RiskLevel;
  requiresApproval: boolean;
  rollbackHint?: string;
}

export interface RelatedIncidentSummary {
  id: string;
  title: string;
  state: string;
  severity: string;
  detectedAt: number;
  fingerprint: string | null;
}

export interface Diagnosis {
  ref: ServerRef;
  generatedAt: number;
  serverName: string;
  state: string | null;
  application: DetectionResult | null;
  health: HealthAssessment | null;
  summary: string;
  observedFacts: string[];
  probableCauses: ProbableCause[];
  hypotheses: string[];
  recommendedActions: RecommendedAction[];
  missingEvidence: string[];
  risk: RiskLevel;
  confidenceBasis: string;
  incidentId: string | null;
  analysis: LogAnalysis | null;
  codeContext: DebugContextResult | null;
  crash: CrashAssessment;
  recentChanges: ChangeEvent[];
  relatedIncidents: RelatedIncidentSummary[];
  windowMinutes: number;
}

export interface DiagnoseOptions {
  windowMinutes?: number;
  includeDependencies?: boolean;
  openIncident?: boolean;
  bypassCache?: boolean;
}

export interface DiagnosticEngineDeps {
  panels: PanelRegistry;
  consoleService: ConsoleService;
  detector: ApplicationDetector;
  signalCollector: ApplicationSignalCollector;
  profiles: ApplicationProfileRegistry;
  crashTracker: CrashLoopTracker;
  incidentService: IncidentService;
  changeLedger: ChangeLedger;
  policyEngine: PolicyEngine;
  debugContext: DebugContextBuilder;
  logger: Logger;
  config: DiagnosticsConfig;
  clock?: () => number;
}

export class DiagnosticEngine {
  private readonly clock: () => number;

  constructor(private readonly deps: DiagnosticEngineDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async diagnose(ref: ServerRef, options: DiagnoseOptions = {}): Promise<Diagnosis> {
    const now = this.clock();
    const windowMinutes = options.windowMinutes ?? this.deps.config.defaultWindowMinutes;
    const windowMs = windowMinutes * 60_000;
    const since = now - windowMs;

    const panel = this.deps.panels.requireCapability(ref.panel, {
      anyOf: ["client.server.read", "application.servers.read"],
    });

    let serverName = ref.serverId;
    let state: string | null = null;
    let memoryBytes: number | null = null;
    let memoryLimitBytes: number | null = null;
    let diskBytes: number | null = null;
    let diskLimitBytes: number | null = null;
    let uptimeMs: number | null = null;
    const observedFacts: string[] = [];

    if (panel.clientApi && panel.capabilities.has("client.server.read")) {
      const detail = await panel.clientApi.getServer(ref, { includeAllocations: false });
      serverName = detail.name;
      state = detail.state;
      const resources = await panel.clientApi.getResources(ref, {
        memoryMb: detail.limits.memoryMb,
        diskMb: detail.limits.diskMb,
      });
      state = resources.state ?? state;
      memoryBytes = resources.memoryBytes;
      memoryLimitBytes = resources.memoryLimitBytes;
      diskBytes = resources.diskBytes;
      diskLimitBytes = resources.diskLimitBytes;
      uptimeMs = resources.uptimeMs;
    } else if (panel.applicationApi) {
      const detail = await panel.applicationApi.getServer(ref);
      serverName = detail.name;
      state = detail.state;
    }

    observedFacts.push(`process state: ${state ?? "unknown"}`);
    if (uptimeMs !== null) observedFacts.push(`uptime: ${formatDuration(uptimeMs)}`);
    if (memoryBytes !== null && memoryLimitBytes !== null && memoryLimitBytes > 0) {
      observedFacts.push(
        `memory: ${(memoryBytes / 1024 / 1024).toFixed(0)} MB of ${(memoryLimitBytes / 1024 / 1024).toFixed(0)} MB (${((memoryBytes / memoryLimitBytes) * 100).toFixed(1)}%)`,
      );
    }
    if (diskBytes !== null && diskLimitBytes !== null && diskLimitBytes > 0) {
      observedFacts.push(
        `disk: ${(diskBytes / 1024 / 1024).toFixed(0)} MB of ${(diskLimitBytes / 1024 / 1024).toFixed(0)} MB (${((diskBytes / diskLimitBytes) * 100).toFixed(1)}%)`,
      );
    }

    const detection = this.deps.detector.detect(
      await this.deps.signalCollector.collect(ref, {
        ...(options.bypassCache !== undefined ? { bypassCache: options.bypassCache } : {}),
      }),
    );
    observedFacts.push(
      `application: ${detection.application}${detection.distribution ? `/${detection.distribution}` : ""}${detection.version ? ` ${detection.version}` : ""} (confidence ${detection.confidence})`,
    );

    const events = await this.deps.consoleService.window(ref, since, now, {
      limit: this.deps.config.maxEventsPerAnalysis,
    });
    const analysis = analyzeLogEvents(events);
    if (analysis.totalEvents > 0) {
      observedFacts.push(analysis.summary);
    } else {
      observedFacts.push(`no console events recorded in the last ${windowMinutes}m`);
    }

    const crash = this.deps.crashTracker.assess(ref, now);
    if (crash.crashCount > 0) {
      observedFacts.push(...crash.evidence);
    }

    let codeContext: DebugContextResult | null = null;
    try {
      codeContext = await this.deps.debugContext.build(ref, analysis, {
        configPaths: profileConfigPaths(this.deps.profiles, detection),
      });
      if (codeContext.snippets.some((snippet) => snippet.resolvedPath !== null)) {
        observedFacts.push(
          `code context: ${String(codeContext.snippets.filter((snippet) => snippet.resolvedPath !== null).length)} referenced file(s) located and excerpted`,
        );
      }
      for (const validation of codeContext.configValidation) {
        if (validation.status === "error") {
          observedFacts.push(`configuration parse error in ${validation.file}: ${validation.issues.join("; ")}`);
        }
      }
    } catch (error) {
      this.deps.logger.debug("code context collection failed", {
        error: (error as Error).message,
      });
    }


    const profile =
      this.deps.profiles.byId(detection.profileId ?? "") ??
      this.deps.profiles.lookup(detection.application, detection.distribution);
    const readyMarkerSeen =
      analysis.lifecycle.length === 0
        ? null
        : analysis.lifecycle.some((event) => event.kind === "ready");
    const healthWindowMs = Math.min(windowMs, 10 * 60_000);
    const recentErrorCount = await this.deps.consoleService.countWarnAndAboveSince(
      ref,
      now - healthWindowMs,
    );
    const health = assessHealth({
      ref,
      serverName,
      state,
      suspended: false,
      memoryBytes,
      memoryLimitBytes,
      diskBytes,
      diskLimitBytes,
      cpuAveragePercent: null,
      uptimeMs,
      recentErrors: { count: recentErrorCount, windowMs: healthWindowMs },
      crash,
      readyMarkerSeen,
      readyMarkerExpected: profile.readyMarkers.length > 0,
      expectedStartupMs: profile.expectedStartupMs,
      assessedAt: now,
    });
    observedFacts.push(`health assessment: ${health.status} (score ${health.score})`);

    const recentChanges = await this.deps.changeLedger.recent(ref, {
      sinceMs: Math.max(windowMs, 6 * 3_600_000),
      limit: 25,
    });
    const lastChange = recentChanges[0];
    if (lastChange) {
      observedFacts.push(
        `last recorded change: ${lastChange.action} on ${lastChange.target} at ${new Date(lastChange.ts).toISOString()} by ${lastChange.actor}`,
      );
    }

    const topIssues = await this.deps.consoleService.topIssues(ref, since, 10);
    const relatedIncidents = await this.findRelated(
      ref,
      topIssues.map((issue) => issue.fingerprint),
    );

    const probableCauses: ProbableCause[] = [];
    const hypotheses: string[] = [];
    const missingEvidence: string[] = [];

    this.buildPatternCauses({ analysis, crash, memoryBytes, memoryLimitBytes, probableCauses });
    const changeCorrelation = this.buildChangeCorrelation(analysis, recentChanges);
    if (changeCorrelation) probableCauses.push(changeCorrelation.cause);
    this.buildMemoryInference(analysis, memoryBytes, memoryLimitBytes, probableCauses);
    this.buildRecurringCause(relatedIncidents, probableCauses);
    this.buildHypotheses({ state, analysis, crash, probableCauses, hypotheses, missingEvidence, events: events.length });
    this.buildMissingEvidence({ analysis, detection, recentChanges, events: events.length, missingEvidence });

    const recommendedActions = this.buildActions(analysis);
    const risk = recommendedActions.reduce<RiskLevel>(
      (acc, action) => maxRisk(acc, action.risk),
      "LOW",
    );

    const confidenceBasis =
      probableCauses.length === 0
        ? "No deterministic cause identified; diagnosis is based on observed facts only."
        : `Highest cause confidence ${probableCauses[0]!.confidence.toFixed(2)} derived from ${probableCauses[0]!.evidence.length} evidence item(s).`;

    let incidentId: string | null = null;
    const shouldOpenIncident =
      (options.openIncident ?? true) &&
      (crash.inCrashLoop || analysis.bySeverity.fatal > 0 || topIssues.some((issue) => issue.severity === "fatal"));

    if (shouldOpenIncident) {
      incidentId = await this.openOrUpdateIncident(ref, {
        serverName,
        detection,
        analysis,
        crash,
        probableCauses,
        relatedIncidents,
        changeCause: changeCorrelation?.cause ?? null,
      });
      if (incidentId) {
        const topFingerprint = topIssues[0]?.fingerprint;
        if (topFingerprint) {
          await this.deps.consoleService.linkFingerprintIncident(ref, topFingerprint, incidentId);
        }
        if (changeCorrelation) {
          await this.deps.changeLedger.linkIncident(changeCorrelation.change.id, incidentId);
        }
        observedFacts.push(`incident ${incidentId} opened/updated`);
      }
    }

    const summary = this.buildSummary({
      serverName,
      state,
      detection,
      analysis,
      crash,
      probableCauses,
      incidentId,
    });

    return {
      ref,
      generatedAt: now,
      serverName,
      state,
      application: detection,
      health,
      summary,
      observedFacts,
      probableCauses,
      hypotheses,
      recommendedActions,
      missingEvidence,
      risk,
      confidenceBasis,
      incidentId,
      analysis,
      codeContext,
      crash,
      recentChanges,
      relatedIncidents,
      windowMinutes,
    };
  }

  private async findRelated(ref: ServerRef, fingerprints: string[]): Promise<Incident[]> {
    if (fingerprints.length === 0) return [];
    try {
      return await this.deps.incidentService.similar(ref.tenant, fingerprints, 30, 5);
    } catch (error) {
      this.deps.logger.debug("similar incident lookup failed", {
        error: (error as Error).message,
      });
      return [];
    }
  }

  private buildPatternCauses(input: {
    analysis: LogAnalysis;
    crash: CrashAssessment;
    memoryBytes: number | null;
    memoryLimitBytes: number | null;
    probableCauses: ProbableCause[];
  }): void {
    const { analysis, crash, memoryBytes, memoryLimitBytes, probableCauses } = input;
    const memoryRatio =
      memoryBytes !== null && memoryLimitBytes !== null && memoryLimitBytes > 0
        ? memoryBytes / memoryLimitBytes
        : null;

    for (const pattern of analysis.patterns.slice(0, 3)) {
      const evidence: EvidenceItem[] = [
        {
          source: "console",
          detail: `${pattern.label} observed ${pattern.count}×: ${pattern.sample.slice(0, 180)}`,
          weight: 0.6,
          ts: pattern.firstSeen,
        },
      ];
      let confidence = pattern.severity === "fatal" ? 0.75 : pattern.severity === "error" ? 0.62 : 0.45;
      if (pattern.count >= 3) confidence += 0.05;
      if (crash.inCrashLoop) {
        confidence += 0.1;
        evidence.push({
          source: "crash-loop",
          detail: crash.evidence.join("; "),
          weight: 0.5,
        });
      }
      if ((pattern.id === "oom_java" || pattern.id === "oom_system") && memoryRatio !== null && memoryRatio >= 0.85) {
        confidence += 0.08;
        evidence.push({
          source: "metrics",
          detail: `memory utilization ${(memoryRatio * 100).toFixed(1)}% at diagnosis time`,
          weight: 0.4,
        });
      }
      probableCauses.push({
        cause: pattern.label,
        confidence: Math.min(0.9, Number(confidence.toFixed(2))),
        kind: "inferred",
        evidence,
      });
    }
  }

  private buildChangeCorrelation(
    analysis: LogAnalysis,
    changes: ChangeEvent[],
  ): { cause: ProbableCause; change: ChangeEvent } | null {
    const firstError = analysis.issues.reduce<number | null>(
      (acc, issue) => (acc === null || issue.firstSeen < acc ? issue.firstSeen : acc),
      null,
    );
    if (firstError === null || changes.length === 0) return null;
    const correlationWindowStart = firstError - 15 * 60_000;
    const candidates = changes
      .filter((change) => change.ts >= correlationWindowStart && change.ts <= firstError + 2 * 60_000)
      .sort((a, b) => b.ts - a.ts);
    const change = candidates[0];
    if (!change) return null;
    const deltaMinutes = (firstError - change.ts) / 60_000;
    let confidence = 0.55;
    if (change.action === "file_write" || change.action === "dependency_update") confidence += 0.15;
    if (deltaMinutes >= 0 && deltaMinutes <= 5) confidence += 0.1;
    return {
      change,
      cause: {
        cause: `Recent change "${change.action}" on "${change.target}" ${deltaMinutes >= 0 ? `${deltaMinutes.toFixed(0)} minute(s) before` : "around"} the first error`,
        confidence: Math.min(0.85, Number(confidence.toFixed(2))),
        kind: "inferred",
        evidence: [
          {
            source: "change-ledger",
            detail: `${change.action} on ${change.target} at ${new Date(change.ts).toISOString()} by ${change.actor} (result: ${change.result})`,
            weight: 0.7,
            ts: change.ts,
          },
          ...(change.beforeHash && change.afterHash
            ? [
                {
                  source: "change-ledger",
                  detail: `content hash ${change.beforeHash.slice(0, 12)} → ${change.afterHash.slice(0, 12)}`,
                  weight: 0.3,
                },
              ]
            : []),
        ],
      },
    };
  }

  private buildMemoryInference(
    analysis: LogAnalysis,
    memoryBytes: number | null,
    memoryLimitBytes: number | null,
    probableCauses: ProbableCause[],
  ): void {
    if (memoryBytes === null || memoryLimitBytes === null || memoryLimitBytes <= 0) return;
    const ratio = memoryBytes / memoryLimitBytes;
    if (ratio >= 0.9 && probableCauses.length === 0 && analysis.bySeverity.error + analysis.bySeverity.fatal > 0) {
      probableCauses.push({
        cause: "Resource pressure: memory utilization is near the allocation limit",
        confidence: 0.5,
        kind: "inferred",
        evidence: [
          {
            source: "metrics",
            detail: `memory at ${(ratio * 100).toFixed(1)}% of allocation while errors are occurring`,
            weight: 0.5,
          },
        ],
      });
    }
  }

  private buildRecurringCause(relatedIncidents: Incident[], probableCauses: ProbableCause[]): void {
    const past = relatedIncidents[0];
    if (!past) return;
    probableCauses.push({
      cause: `Recurring failure: identical fingerprint seen in incident ${past.id} ("${past.title}", state: ${past.state})`,
      confidence: past.state === "resolved" ? 0.72 : 0.6,
      kind: "inferred",
      evidence: [
        {
          source: "operational-memory",
          detail: `incident ${past.id} detected ${new Date(past.detectedAt).toISOString()} with fingerprint ${past.fingerprint ?? "n/a"}`,
          weight: 0.6,
          ts: past.detectedAt,
        },
        {
          source: "operational-memory",
          detail:
            "revalidate: the current environment may differ from the previous occurrence; do not repeat the old fix blindly",
          weight: 0.2,
        },
      ],
    });
  }

  private buildHypotheses(input: {
    state: string | null;
    analysis: LogAnalysis;
    crash: CrashAssessment;
    probableCauses: ProbableCause[];
    hypotheses: string[];
    missingEvidence: string[];
    events: number;
  }): void {
    const { state, analysis, crash, probableCauses, hypotheses } = input;
    if (probableCauses.length === 0) {
      if (state === "offline" || state === "stopped") {
        hypotheses.push(
          "The process is offline without a fatal signature; it may have been stopped manually or exited without console capture.",
        );
      }
      if (crash.inCrashLoop) {
        hypotheses.push(
          "Repeated restarts observed but no known failure signature matched; the crash cause may require reading the full startup log.",
        );
      }
      if (analysis.bySeverity.error > 0 && analysis.patterns.length === 0) {
        hypotheses.push(
          "Errors occurred which do not match the known pattern library; inspect the top issues manually.",
        );
      }
      if (hypotheses.length === 0) {
        hypotheses.push(
          "No strong signal in the current window; consider a longer window or wait for the next failure to be captured.",
        );
      }
    }
  }

  private buildMissingEvidence(input: {
    analysis: LogAnalysis;
    detection: DetectionResult;
    recentChanges: ChangeEvent[];
    events: number;
    missingEvidence: string[];
  }): void {
    const { analysis, detection, recentChanges, events, missingEvidence } = input;
    if (events === 0) {
      missingEvidence.push(
        "No console history is stored for this window; enable console streaming/persistence so crashes are captured.",
      );
    }
    if (detection.confidence < 0.5) {
      missingEvidence.push(
        "Application detection confidence is low; file access (client.files.read) or more console output would improve it.",
      );
    }
    if (analysis.patterns.length === 0 && analysis.bySeverity.error + analysis.bySeverity.fatal > 0) {
      missingEvidence.push("Errors are present but none match known patterns; raw error samples are attached.");
    }
    if (recentChanges.length === 0) {
      missingEvidence.push(
        "No changes are recorded in the ledger; changes made outside PteroOps are invisible to correlation.",
      );
    }
  }

  private buildActions(analysis: LogAnalysis): RecommendedAction[] {
    const actions: RecommendedAction[] = [];
    const seen = new Set<string>();
    for (const pattern of analysis.patterns) {
      for (const recommended of pattern.recommendedActions) {
        if (seen.has(recommended.action)) continue;
        seen.add(recommended.action);
        const assessment = classifyRisk(recommended.action);
        actions.push({
          action: recommended.action,
          description: recommended.description,
          risk: assessment.level,
          requiresApproval: this.deps.policyEngine.requiresApproval(recommended.action, assessment.level),
          ...(recommended.action === "file_write"
            ? { rollbackHint: "restore the pre-change snapshot recorded in the change ledger" }
            : {}),
          ...(recommended.action === "startup_variable_change"
            ? { rollbackHint: "restore the previous startup variable value" }
            : {}),
        });
      }
      if (actions.length >= 5) break;
    }
    return actions;
  }

  private async openOrUpdateIncident(
    ref: ServerRef,
    input: {
      serverName: string;
      detection: DetectionResult;
      analysis: LogAnalysis;
      crash: CrashAssessment;
      probableCauses: ProbableCause[];
      relatedIncidents: Incident[];
      changeCause: ProbableCause | null;
    },
  ): Promise<string | null> {
    try {
      const topIssue = input.analysis.issues.find((issue) => issue.severity === "fatal") ?? input.analysis.issues[0];
      const fingerprint = topIssue?.fingerprint ?? (input.crash.inCrashLoop ? `crash-loop:${ref.panel}/${ref.serverId}` : null);
      if (!fingerprint) return null;
      const severity =
        input.crash.inCrashLoop || topIssue?.severity === "fatal" ? "critical" : "high";
      const title = input.crash.inCrashLoop
        ? `Crash loop detected on ${input.serverName}`
        : `Failures detected on ${input.serverName}`;
      const evidence: Array<{ kind: string; source: string; summary: string; ts?: number }> = [];
      if (topIssue) {
        evidence.push({
          kind: "log-issue",
          source: "console",
          summary: `${topIssue.exceptionType ?? "issue"} ×${topIssue.count}: ${topIssue.sample.slice(0, 200)}`,
          ts: topIssue.firstSeen,
        });
      }
      for (const item of issuesToEvidence(input.analysis.issues).slice(0, 3)) {
        evidence.push({ kind: "log-issue", source: item.source, summary: item.detail, ...(item.ts ? { ts: item.ts } : {}) });
      }
      for (const line of input.crash.evidence) {
        evidence.push({ kind: "crash-loop", source: "crash-detector", summary: line });
      }
      if (input.changeCause) {
        for (const item of input.changeCause.evidence) {
          evidence.push({ kind: "change", source: item.source, summary: item.detail, ...(item.ts ? { ts: item.ts } : {}) });
        }
      }
      const result = await this.deps.incidentService.open({
        ref,
        title,
        summary: input.analysis.summary,
        severity,
        fingerprint,
        application: `${input.detection.application}${input.detection.distribution ? `/${input.detection.distribution}` : ""}`,
        confidence: input.probableCauses[0]?.confidence ?? null,
        symptoms: input.analysis.issues.slice(0, 5).map((issue) => `${issue.exceptionType ?? issue.sample.slice(0, 80)} ×${issue.count}`),
        probableCauses: input.probableCauses.map((cause) => ({
          cause: cause.cause,
          confidence: cause.confidence,
          kind: cause.kind,
          evidence: cause.evidence,
        })),
        evidence,
      });
      return result.incident.id;
    } catch (error) {
      this.deps.logger.warn("failed to open incident from diagnosis", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  private buildSummary(input: {
    serverName: string;
    state: string | null;
    detection: DetectionResult;
    analysis: LogAnalysis;
    crash: CrashAssessment;
    probableCauses: ProbableCause[];
    incidentId: string | null;
  }): string {
    const parts: string[] = [];
    parts.push(
      `${input.serverName} is ${input.state ?? "in an unknown state"}${input.crash.inCrashLoop ? " and appears to be crash-looping" : ""}.`,
    );
    parts.push(
      `Detected ${input.detection.application}${input.detection.distribution ? `/${input.detection.distribution}` : ""}${input.detection.version ? ` ${input.detection.version}` : ""} (confidence ${input.detection.confidence}).`,
    );
    if (input.probableCauses.length > 0) {
      const top = input.probableCauses[0]!;
      parts.push(`Most probable cause: ${top.cause} (confidence ${top.confidence}).`);
    } else {
      parts.push("No deterministic cause identified yet.");
    }
    parts.push(input.analysis.summary);
    if (input.incidentId) parts.push(`Incident: ${input.incidentId}.`);
    return parts.join(" ");
  }
}

function profileConfigPaths(
  registry: ApplicationProfileRegistry,
  detection: DetectionResult,
): string[] {
  const profile =
    registry.byId(detection.profileId ?? "") ??
    registry.lookup(detection.application, detection.distribution);
  const paths = profile.configLocations.map((location) =>
    location.startsWith("/") ? location : `/${location}`,
  );
  if (!paths.includes("/server.properties")) paths.push("/server.properties");
  return paths;
}
