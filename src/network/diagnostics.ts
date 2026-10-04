import { connect } from "node:net";
import type { ApplicationProfile, ApplicationProfileRegistry } from "../applications/profiles/index.js";
import type { ConsoleService } from "../console/service.js";
import type { Logger } from "../observability/logger.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { ServerCacheRepository } from "../persistence/repositories/servers.js";
import type { RedactionEngine } from "../shared/redaction.js";
import type { ServerRef } from "../shared/types.js";

export interface NetworkCheck {
  name: string;
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
}

export interface NetworkReport {
  server: string;
  checks: NetworkCheck[];
  summary: string;
  probedTargets: string[];
}

export interface TcpProbeResult {
  ok: boolean;
  error?: string;
}

export interface HttpProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface NetworkDiagnosticDeps {
  panels: PanelRegistry;
  consoleService: ConsoleService;
  profiles: ApplicationProfileRegistry;
  serverCache: ServerCacheRepository;
  redactor: RedactionEngine;
  logger: Logger;
  networkProbeAllowed: boolean;
  networkProbeTargets: string[];
  probeTcp?: (host: string, port: number, timeoutMs: number) => Promise<TcpProbeResult>;
  probeHttp?: (url: string, timeoutMs: number) => Promise<HttpProbeResult>;
  clock?: () => number;
}

const PROBE_TIMEOUT_MS = 3_000;
const HTTP_TIMEOUT_MS = 4_000;
const MAX_PROBES = 3;

export class NetworkDiagnosticEngine {
  private readonly clock: () => number;

  constructor(private readonly deps: NetworkDiagnosticDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async diagnose(ref: ServerRef, options: { checks?: string[] } = {}): Promise<NetworkReport> {
    const desired = options.checks ? new Set(options.checks) : null;
    const include = (name: string): boolean => !desired || desired.has(name) || desired.has("all");
    const checks: NetworkCheck[] = [];
    const probedTargets: string[] = [];

    const panel = this.deps.panels.requireCapability(ref.panel, {
      anyOf: ["client.server.read", "application.servers.read"],
    });

    let allocations: Array<{ ip: string; port: number; primary: boolean }> = [];
    let serverName = ref.serverId;

    if (panel.clientApi && panel.capabilities.has("client.server.read")) {
      const detail = await panel.clientApi.getServer(ref, { includeAllocations: true });
      serverName = detail.name;
      allocations = (detail.allocations ?? []).map((allocation) => ({
        ip: allocation.ip,
        port: allocation.port,
        primary: allocation.primary,
      }));
    }

    const cached = await this.deps.serverCache.get(ref);
    const profile = this.profileFor(cached?.application ?? null);
    const primary = allocations.find((allocation) => allocation.primary) ?? allocations[0] ?? null;

    if (include("allocations")) {
      if (allocations.length === 0) {
        checks.push({
          name: "allocations",
          status: panel.capabilities.has("client.server.read") ? "fail" : "unknown",
          detail: "no network allocations found; the application cannot receive traffic",
        });
      } else {
        const duplicatePorts = [...new Set(allocations.map((allocation) => allocation.port).filter(
          (port, index, list) => list.indexOf(port) !== index,
        ))];
        checks.push({
          name: "allocations",
          status: duplicatePorts.length > 0 ? "warn" : primary ? "ok" : "warn",
          detail: `allocations: ${allocations
            .map((allocation) => `${allocation.ip}:${allocation.port}${allocation.primary ? "*" : ""}`)
            .join(", ")}${primary ? "" : " (no primary allocation marked)"}${
            duplicatePorts.length > 0 ? `: duplicate ports: ${duplicatePorts.join(", ")}` : ""
          }`,
        });
      }
    }

    if (include("expected-port") && profile && primary) {
      const expected = profile.expectedPorts[0];
      if (expected && expected.port !== primary.port) {
        const configNote =
          panel.clientApi && panel.capabilities.has("client.files.read")
            ? await this.checkServerPropertiesPort(ref, primary.port)
            : "";
        checks.push({
          name: "expected-port",
          status: "warn",
          detail: `profile ${profile.displayName} usually binds ${expected.port}, but the primary allocation is ${primary.port}; the application must be configured for ${primary.port}${configNote}`,
        });
      } else if (expected) {
        checks.push({
          name: "expected-port",
          status: "ok",
          detail: `primary allocation port ${primary.port} matches the ${profile.displayName} default`,
        });
      }
    }

    if (include("console-bind-signals")) {
      const bindPage = await this.deps.consoleService.query({
        ref,
        since: this.clock() - 30 * 60_000,
        text: "bind",
        limit: 20,
      });
      const bindErrors = bindPage.events.filter((event) =>
        /already in use|failed to bind|eaddrinuse/i.test(event.normalized),
      );
      checks.push({
        name: "console-bind-signals",
        status: bindErrors.length > 0 ? "fail" : "ok",
        detail:
          bindErrors.length > 0
            ? `${bindErrors.length} bind failure(s) in the last 30m: ${bindErrors[0]!.normalized.slice(0, 160)}`
            : "no bind failures in the last 30m",
      });
    }

    const targets = this.probeTargets(allocations);
    if ((include("tcp") || include("http")) && !this.deps.networkProbeAllowed) {
      checks.push({
        name: "reachability",
        status: "unknown",
        detail:
          "network probing is disabled (policy.networkProbeAllowed=false); enable it to test allocation reachability from the MCP host",
      });
    } else if (include("tcp")) {
      if (targets.length === 0) {
        checks.push({
          name: "reachability",
          status: "unknown",
          detail:
            "no probeable allocation addresses (bind-all or loopback addresses cannot be probed remotely); configure policy.networkProbeTargets with host:port entries to test specific endpoints",
        });
      }
      for (const target of targets.slice(0, MAX_PROBES)) {
        probedTargets.push(`${target.host}:${String(target.port)}`);
        const result = await this.tcpProbe(target.host, target.port);
        checks.push({
          name: `tcp ${target.host}:${String(target.port)}`,
          status: result.ok ? "ok" : "fail",
          detail: result.ok
            ? `${target.purpose} is reachable from the MCP host`
            : `${target.purpose} is NOT reachable from the MCP host: ${result.error ?? "connection failed"}`,
        });
      }
    }

    if (include("http") && this.deps.networkProbeAllowed && targets.length > 0 && profile) {
      const webRuntime = ["node", "python", "java", "container", "go", "rust"].includes(
        profile.runtime,
      );
      if (webRuntime) {
        for (const target of targets.slice(0, 2)) {
          const url = `http://${target.host}:${String(target.port)}/`;
          const result = await this.httpProbe(url);
          checks.push({
            name: `http ${url}`,
            status: result.ok ? "ok" : "warn",
            detail: result.ok
              ? `HTTP endpoint responded with status ${String(result.status ?? "unknown")}`
              : `HTTP probe failed: ${result.error ?? "no response"} (may be normal for non-web workloads)`,
          });
        }
      }
    }

    const failCount = checks.filter((check) => check.status === "fail").length;
    const warnCount = checks.filter((check) => check.status === "warn").length;
    return {
      server: `${ref.panel}/${ref.serverId}`,
      checks,
      summary:
        failCount > 0
          ? `${failCount} network problem(s) detected on ${serverName}`
          : warnCount > 0
            ? `${warnCount} network warning(s) on ${serverName}`
            : `no network problems detected on ${serverName}`,
      probedTargets,
    };
  }

  private probeTargets(
    allocations: Array<{ ip: string; port: number; primary: boolean }>,
  ): Array<{ host: string; port: number; purpose: string }> {
    const configured = this.deps.networkProbeTargets
      .map((entry) => {
        const [host, port] = entry.split(":");
        return { host: host ?? "", port: Number(port ?? 0), purpose: `configured target ${entry}` };
      })
      .filter((target) => target.host !== "" && target.port > 0);
    if (configured.length > 0) return configured;
    return allocations
      .filter(
        (allocation) =>
          allocation.ip !== "0.0.0.0" &&
          allocation.ip !== "127.0.0.1" &&
          allocation.ip !== "::" &&
          allocation.ip !== "::1",
      )
      .slice(0, 5)
      .map((allocation) => ({
        host: allocation.ip,
        port: allocation.port,
        purpose: allocation.primary ? "primary allocation" : "allocation",
      }));
  }

  private profileFor(label: string | null): ApplicationProfile | null {
    if (!label) return null;
    const applicationPart = label.split(" ")[0] ?? "";
    const [application, distribution] = applicationPart.split("/");
    if (!application) return null;
    return this.deps.profiles.lookup(application, distribution);
  }

  private async checkServerPropertiesPort(ref: ServerRef, allocationPort: number): Promise<string> {
    try {
      const panel = this.deps.panels.requireCapability(ref.panel, { allOf: ["client.files.read"] });
      const content = await panel.clientApi!.readFile(ref, "/server.properties");
      const match = /^server-port\s*=\s*(\d+)/m.exec(content);
      if (!match) return " (server.properties has no server-port entry)";
      const configured = Number(match[1]);
      return configured === allocationPort
        ? ` (server.properties already uses ${allocationPort})`
        : `: server.properties currently uses ${configured}, which does NOT match the allocation`;
    } catch {
      return "";
    }
  }

  private async tcpProbe(host: string, port: number): Promise<TcpProbeResult> {
    if (this.deps.probeTcp) return this.deps.probeTcp(host, port, PROBE_TIMEOUT_MS);
    return new Promise((resolve) => {
      const socket = connect({ host, port, timeout: PROBE_TIMEOUT_MS });
      const finish = (result: TcpProbeResult): void => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };
      socket.on("connect", () => finish({ ok: true }));
      socket.on("timeout", () => finish({ ok: false, error: "timeout" }));
      socket.on("error", (error: Error) => finish({ ok: false, error: error.message }));
    });
  }

  private async httpProbe(url: string): Promise<HttpProbeResult> {
    if (this.deps.probeHttp) return this.deps.probeHttp(url, HTTP_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "manual",
      });
      return { ok: response.status < 500, status: response.status };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}
