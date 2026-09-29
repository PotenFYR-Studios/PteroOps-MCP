import type { ConsoleService } from "../console/service.js";
import type { CrashLoopTracker } from "../intelligence/crash-loop/tracker.js";
import type { Logger } from "../observability/logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { ServerSummary } from "../pterodactyl/types.js";
import type { ServerRef } from "../shared/types.js";
import { serverRefKey } from "../shared/types.js";
import {
  ConsoleStreamer,
  type DaemonServerStatus,
  type StreamerState,
} from "../pterodactyl/websocket/console-stream.js";

export interface StreamerManagerDeps {
  panels: PanelRegistry;
  consoleService: ConsoleService;
  crashTracker: CrashLoopTracker;
  logger: Logger;
  metrics?: MetricsRegistry;
  clock?: () => number;
}

interface StreamStatus {
  status: DaemonServerStatus | null;
  startTs: number | null;
}

export class ConsoleStreamerManager {
  private readonly streamers = new Map<string, ConsoleStreamer>();
  private readonly statuses = new Map<string, StreamStatus>();

  constructor(private readonly deps: StreamerManagerDeps) {}

  sync(servers: ServerSummary[]): void {
    const wanted = new Set<string>();
    for (const server of servers) {
      const key = serverRefKey(server.ref);
      const shouldStream = server.state === "running" || server.state === "starting";
      if (shouldStream) {
        wanted.add(key);
        this.ensure(server.ref);
      }
    }
    for (const [key, streamer] of this.streamers) {
      if (!wanted.has(key)) {
        streamer.stop();
        this.streamers.delete(key);
        this.statuses.delete(key);
      }
    }
    this.deps.metrics?.setGauge("console_streams_active", this.streamers.size);
  }

  ensure(ref: ServerRef): void {
    const key = serverRefKey(ref);
    if (this.streamers.has(key)) return;
    const panel = this.deps.panels.tryGet(ref.panel);
    if (!panel?.clientApi || !panel.capabilities.has("client.console.read")) return;
    const streamer = new ConsoleStreamer({
      ref,
      panelUrl: panel.url,
      clientApi: panel.clientApi,
      logger: this.deps.logger.child({ panel: ref.panel, server: ref.serverId }),
      ...(this.deps.metrics ? { metrics: this.deps.metrics } : {}),
      events: {
        onLine: (line, ts) => this.handleLine(ref, line, ts),
        onDaemonMessage: (line, ts) => this.handleDaemonMessage(ref, line, ts),
        onStatus: (status, ts) => this.handleStatus(ref, status, ts),
      },
    });
    this.streamers.set(key, streamer);
    streamer.start();
  }

  stopAll(): void {
    for (const streamer of this.streamers.values()) streamer.stop();
    this.streamers.clear();
    this.statuses.clear();
  }

  status(): Array<{ ref: ServerRef; state: StreamerState }> {
    return [...this.streamers.entries()].map(([key, streamer]) => ({
      ref: parseKey(key),
      state: streamer.currentState,
    }));
  }

  private handleLine(ref: ServerRef, line: string, ts: number): void {
    this.deps.consoleService.ingest(ref, line, ts);
  }

  private handleDaemonMessage(ref: ServerRef, line: string, ts: number): void {
    this.deps.consoleService.ingest(ref, `[Pterodactyl Daemon] ${line}`, ts);
    if (/marked as offline|out of memory|killed/i.test(line)) {
      this.deps.consoleService.ingest(ref, `[Pterodactyl Daemon] shutdown event: ${line}`, ts);
    }
  }

  private handleStatus(ref: ServerRef, status: DaemonServerStatus, ts: number): void {
    const key = serverRefKey(ref);
    const previous = this.statuses.get(key) ?? { status: null, startTs: null };
    if (previous.status === status) return;

    const wasLive = previous.status === "starting" || previous.status === "running";
    const becomesLive = status === "starting" || status === "running";

    if (!wasLive && becomesLive) {
      this.statuses.set(key, { status, startTs: ts });
      this.deps.crashTracker.record(ref, { ts, kind: "started", source: "console" });
    } else if (wasLive && status === "offline") {
      const runtimeMs = previous.startTs !== null ? ts - previous.startTs : null;
      this.statuses.set(key, { status, startTs: null });
      this.deps.crashTracker.record(ref, {
        ts,
        kind: "exited",
        runtimeMs,
        source: "console",
      });
    } else {
      this.statuses.set(key, { status, startTs: previous.startTs });
    }
  }
}

function parseKey(key: string): ServerRef {
  const [tenant, panel, ...rest] = key.split("/");
  return { tenant: tenant ?? "local", panel: panel ?? "", serverId: rest.join("/") };
}
