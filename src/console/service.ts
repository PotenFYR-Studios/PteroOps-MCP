import type { ConsoleConfig } from "../config/schema.js";
import type { Logger } from "../observability/logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type {
  ConsoleEvent,
  ConsoleEventInput,
  ConsoleEventPage,
  ConsoleQuery,
  FingerprintSummary,
} from "../persistence/models.js";
import type {
  ConsoleEventRepository,
  FingerprintRepository,
  FingerprintUpsert,
} from "../persistence/repositories/console-events.js";
import type { RedactionEngine } from "../shared/redaction.js";
import type { ServerRef } from "../shared/types.js";
import { fingerprintOf } from "../shared/hash.js";
import { classifyConsoleLine } from "../intelligence/logs/classify.js";
import { normalizeConsoleLine } from "../intelligence/logs/normalize.js";

export interface ConsoleServiceDeps {
  consoleRepository: ConsoleEventRepository;
  fingerprintRepository: FingerprintRepository;
  redactor: RedactionEngine;
  logger: Logger;
  metrics?: MetricsRegistry;
  config: ConsoleConfig;
  clock?: () => number;
}

export interface IngestLine {
  line: string;
  ts: number;
}

export class ConsoleService {
  private readonly clock: () => number;
  private readonly eventBuffer: ConsoleEventInput[] = [];
  private readonly fingerprintBuffer = new Map<string, FingerprintUpsert>();
  private lastFlush = 0;
  private flushing: Promise<void> | null = null;

  constructor(private readonly deps: ConsoleServiceDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  ingest(ref: ServerRef, rawLine: string, ts?: number): ConsoleEventInput | null {
    const at = ts ?? this.clock();
    const normalizedLine = normalizeConsoleLine(rawLine);
    if (normalizedLine.normalized.trim() === "") return null;

    const classification = classifyConsoleLine(normalizedLine.normalized);
    if (
      this.deps.config.captureWarnAndAbove &&
      classification.severity !== "warn" &&
      classification.severity !== "error" &&
      classification.severity !== "fatal" &&
      classification.lifecycle === null
    ) {
      return null;
    }

    const raw = this.deps.redactor.redact(normalizedLine.raw);
    const normalized = this.deps.redactor.redact(normalizedLine.normalized);

    const input: ConsoleEventInput = {
      ref,
      ts: normalizedLine.embeddedTimestamp ?? at,
      raw,
      normalized,
      severity: classification.severity,
      subsystem: classification.subsystem,
      exceptionType: classification.exceptionType,
      fingerprint: null,
      incidentId: null,
      correlationId: null,
    };

    const shouldFingerprint =
      classification.severity === "warn" ||
      classification.severity === "error" ||
      classification.severity === "fatal" ||
      classification.exceptionType !== null ||
      (classification.lifecycle !== null && classification.lifecycle !== "ready");

    if (shouldFingerprint) {
      const fingerprint = fingerprintOf(
        classification.exceptionType
          ? `${classification.exceptionType} ${normalized}`
          : normalized,
      );
      input.fingerprint = fingerprint;
      const key = `${ref.tenant}\u0000${ref.panel}\u0000${ref.serverId}\u0000${fingerprint}`;
      const existing = this.fingerprintBuffer.get(key);
      if (existing) {
        this.fingerprintBuffer.set(key, { ...existing, ts: Math.max(existing.ts, input.ts) });
      } else {
        this.fingerprintBuffer.set(key, {
          ref,
          fingerprint,
          exceptionType: classification.exceptionType,
          severity: classification.severity,
          subsystem: classification.subsystem,
          ts: input.ts,
          sample: normalized.slice(0, 500),
        });
      }
    }

    this.enqueue(input);
    this.deps.metrics?.increment("console_events_ingested_total");
    return input;
  }

  async ingestBatch(ref: ServerRef, lines: IngestLine[]): Promise<number> {
    let stored = 0;
    for (const line of lines) {
      if (this.ingest(ref, line.line, line.ts)) stored += 1;
    }
    await this.flush();
    return stored;
  }

  async flush(): Promise<void> {
    if (this.eventBuffer.length === 0 && this.fingerprintBuffer.size === 0) return;
    if (this.flushing) {
      await this.flushing;
      return;
    }
    const events = this.eventBuffer.splice(0, this.eventBuffer.length);
    const fingerprints = [...this.fingerprintBuffer.values()];
    this.fingerprintBuffer.clear();
    this.lastFlush = this.clock();
    this.flushing = (async () => {
      for (const fingerprint of fingerprints) {
        await this.deps.fingerprintRepository.upsert(fingerprint);
      }
      await this.deps.consoleRepository.insert(events);
      this.deps.metrics?.increment("console_events_stored_total", events.length);
    })().finally(() => {
      this.flushing = null;
    });
    await this.flushing;
  }

  async query(query: ConsoleQuery): Promise<ConsoleEventPage> {
    await this.flush();
    return this.deps.consoleRepository.query(query);
  }

  async window(
    ref: ServerRef,
    since: number,
    until: number,
    options: { severities?: ConsoleQuery["severities"]; limit?: number } = {},
  ): Promise<ConsoleEvent[]> {
    const page = await this.query({
      ref,
      since,
      until,
      mode: "latest",
      limit: options.limit ?? 2000,
      ...(options.severities ? { severities: options.severities } : {}),
    });
    return page.events;
  }

  async topIssues(ref: ServerRef, since: number, limit = 20): Promise<FingerprintSummary[]> {
    await this.flush();
    return this.deps.fingerprintRepository.top(ref, since, limit);
  }

  async linkFingerprintIncident(
    ref: ServerRef,
    fingerprint: string,
    incidentId: string,
  ): Promise<void> {
    await this.deps.fingerprintRepository.linkIncident(ref, fingerprint, incidentId);
  }

  async countErrorsSince(ref: ServerRef, since: number): Promise<number> {
    await this.flush();
    return this.deps.consoleRepository.countSeverity(ref, since, ["error", "fatal"]);
  }

  async countWarnAndAboveSince(ref: ServerRef, since: number): Promise<number> {
    await this.flush();
    return this.deps.consoleRepository.countSeverity(ref, since, ["warn", "error", "fatal"]);
  }

  async prune(ref: ServerRef, now?: number): Promise<number> {
    await this.flush();
    const deleted = await this.deps.consoleRepository.prune(ref, {
      retentionHours: this.deps.config.retentionHours,
      maxEvents: this.deps.config.maxEventsPerServer,
      ...(now !== undefined ? { now } : {}),
    });
    if (deleted > 0) {
      this.deps.logger.info("pruned console events", {
        panel: ref.panel,
        server: ref.serverId,
        deleted,
      });
      this.deps.metrics?.increment("console_events_pruned_total", deleted);
    }
    return deleted;
  }

  private enqueue(input: ConsoleEventInput): void {
    this.eventBuffer.push(input);
    const sizeLimit = 200;
    const timeLimit = 750;
    if (this.eventBuffer.length >= sizeLimit || this.clock() - this.lastFlush >= timeLimit) {
      void this.flush();
    }
  }
}
