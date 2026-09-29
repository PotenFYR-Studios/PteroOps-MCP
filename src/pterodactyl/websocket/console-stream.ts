import WebSocket from "ws";
import type { Logger } from "../../observability/logger.js";
import type { MetricsRegistry } from "../../observability/metrics.js";
import type { PterodactylClientApi } from "../client-api.js";
import type { ServerRef } from "../../shared/types.js";

export type DaemonServerStatus = "offline" | "starting" | "running" | "stopping";

export interface ConsoleStreamEvents {
  onLine: (line: string, ts: number) => void;
  onDaemonMessage: (line: string, ts: number) => void;
  onStatus: (status: DaemonServerStatus, ts: number) => void;
}

export interface ConsoleStreamerOptions {
  ref: ServerRef;
  panelUrl: string;
  clientApi: PterodactylClientApi;
  logger: Logger;
  metrics?: MetricsRegistry;
  events: ConsoleStreamEvents;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export type StreamerState = "idle" | "connecting" | "connected" | "reconnecting" | "stopped";

const STATUS_CODES: Record<string, DaemonServerStatus> = {
  "0": "offline",
  "1": "starting",
  "2": "running",
  "3": "stopping",
};

export class ConsoleStreamer {
  private socket: WebSocket | null = null;
  private state: StreamerState = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private cancelled = false;

  constructor(private readonly options: ConsoleStreamerOptions) {}

  get currentState(): StreamerState {
    return this.state;
  }

  start(): void {
    if (this.stopped) return;
    if (this.state === "connected" || this.state === "connecting") return;
    this.connect().catch((error) => {
      this.options.logger.warn("console stream connect failed", {
        panel: this.options.ref.panel,
        server: this.options.ref.serverId,
        error: (error as Error).message,
      });
      this.scheduleReconnect();
    });
  }

  stop(): void {
    this.stopped = true;
    this.state = "stopped";
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.cancelled = true;
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.state = this.reconnectAttempt === 0 ? "connecting" : "reconnecting";
    const credentials = await this.options.clientApi.getWebsocket(this.options.ref);
    if (!credentials.socket || !credentials.token) {
      throw new Error("panel returned empty websocket credentials");
    }
    if (this.stopped) return;
    const origin = new URL(this.options.panelUrl).origin;
    const socket = new WebSocket(credentials.socket, { headers: { Origin: origin } });
    this.socket = socket;
    let authToken = credentials.token;

    socket.on("open", () => {
      this.state = "connected";
      this.reconnectAttempt = 0;
      this.cancelled = false;
      this.options.metrics?.increment("console_stream_connected_total", 1, {
        panel: this.options.ref.panel,
      });
      socket.send(JSON.stringify({ event: "auth", args: [authToken] }));
    });

    socket.on("message", (data: WebSocket.RawData) => {
      const text = typeof data === "string" ? data : data.toString();
      this.handleMessage(text, {
        refreshToken: async () => {
          const refreshed = await this.options.clientApi.getWebsocket(this.options.ref);
          authToken = refreshed.token;
          return authToken;
        },
        socket,
      }).catch((error) => {
        this.options.logger.debug("console message handling failed", {
          error: (error as Error).message,
        });
      });
    });

    socket.on("error", (error: Error) => {
      this.options.logger.debug("console stream error", {
        panel: this.options.ref.panel,
        server: this.options.ref.serverId,
        error: error.message,
      });
    });

    socket.on("close", () => {
      if (this.cancelled || this.stopped) return;
      this.socket = null;
      this.scheduleReconnect();
    });
  }

  private async handleMessage(
    text: string,
    context: { refreshToken: () => Promise<string>; socket: WebSocket },
  ): Promise<void> {
    let message: { event?: string; args?: unknown[] };
    try {
      message = JSON.parse(text) as { event?: string; args?: unknown[] };
    } catch {
      return;
    }
    const event = message.event ?? "";
    const args = Array.isArray(message.args) ? message.args : [];
    const now = Date.now();

    switch (event) {
      case "auth":
        this.options.logger.debug("console stream authenticated", {
          panel: this.options.ref.panel,
          server: this.options.ref.serverId,
        });
        return;
      case "token expiring": {
        try {
          const token = await context.refreshToken();
          context.socket.send(JSON.stringify({ event: "auth", args: [token] }));
          this.options.metrics?.increment("console_stream_token_refresh_total", 1, {
            panel: this.options.ref.panel,
          });
        } catch (error) {
          this.options.logger.warn("failed to refresh console token", {
            error: (error as Error).message,
          });
        }
        return;
      }
      case "token expired":
        context.socket.close();
        return;
      case "console output": {
        const line = String(args[0] ?? "");
        if (line) this.options.events.onLine(line, now);
        return;
      }
      case "daemon message": {
        const line = String(args[0] ?? "");
        if (line) this.options.events.onDaemonMessage(line, now);
        return;
      }
      case "status": {
        const code = String(args[0] ?? "");
        const status = STATUS_CODES[code];
        if (status) this.options.events.onStatus(status, now);
        return;
      }
      default:
        return;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const base = this.options.reconnectBaseMs ?? 1000;
    const max = this.options.reconnectMaxMs ?? 30_000;
    const delay = Math.min(max, base * 2 ** this.reconnectAttempt) + Math.random() * 500;
    this.reconnectAttempt += 1;
    this.state = "reconnecting";
    this.options.metrics?.increment("console_stream_reconnects_total", 1, {
      panel: this.options.ref.panel,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
  }
}
