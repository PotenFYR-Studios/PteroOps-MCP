import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { HttpConfig } from "../../config/schema.js";
import { isLoopback } from "../../config/loader.js";
import type { Services } from "../../container.js";
import type { Logger } from "../../observability/logger.js";
import type { MetricsRegistry } from "../../observability/metrics.js";
import type { DashboardService } from "../../ui/service.js";
import {
  renderChanges,
  renderIncident,
  renderIncidentsList,
  renderOverview,
  renderPolicies,
  renderTopology,
  escapeHtml,
} from "../../ui/render.js";
import { policySnapshot } from "../tools/helpers.js";
import { VERSION } from "../../shared/version.js";

export interface HttpTransportOptions {
  services: Services;
  createServer: () => McpServer;
  logger: Logger;
  metrics: MetricsRegistry;
  config: HttpConfig;
  dashboard?: DashboardService;
}

export interface HttpTransportHandle {
  server: Server;
  address: () => { host: string; port: number };
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function startHttpTransport(options: HttpTransportOptions): Promise<HttpTransportHandle> {
  const { config, logger, metrics, services } = options;
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const startedAt = Date.now();

  const unauthorized = (res: ServerResponse): void => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  };

  const isAuthorized = (req: IncomingMessage): boolean => {
    if (!config.authToken) return isLoopback(config.host);
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
    return tokenMatches(header.slice("Bearer ".length));
  };

  const tokenMatches = (candidate: string): boolean => {
    if (!config.authToken) return false;
    const provided = Buffer.from(candidate);
    const expected = Buffer.from(config.authToken);
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  };

  const uiAuthorized = (req: IncomingMessage, url: URL): boolean => {
    if (!config.authToken) return isLoopback(config.host);
    const header = req.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return tokenMatches(header.slice("Bearer ".length));
    }
    const cookie = req.headers.cookie ?? "";
    const cookieToken = /(?:^|;\s*)pteroops_token=([^;]+)/.exec(cookie)?.[1];
    if (cookieToken && tokenMatches(decodeURIComponent(cookieToken))) return true;
    const queryToken = url.searchParams.get("token");
    return queryToken !== null && tokenMatches(queryToken);
  };

  const sendHtml = (res: ServerResponse, status: number, html: string): void => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  };

  const handleUi = async (url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!uiAuthorized(req, url)) {
      sendHtml(
        res,
        401,
        `<!doctype html><html><body style="font-family:monospace;background:#0f1115;color:#d7dae0;padding:40px">
        <h2>401 — token required</h2>
        <p>Open <code>/ui?token=YOUR_TOKEN</code> once; a session cookie will be stored.</p></body></html>`,
      );
      return;
    }
    const queryToken = url.searchParams.get("token");
    if (queryToken && config.authToken && tokenMatches(queryToken)) {
      res.writeHead(302, {
        location: url.pathname + (url.searchParams.get("id") ? `?id=${encodeURIComponent(url.searchParams.get("id")!)}` : ""),
        "set-cookie": `pteroops_token=${encodeURIComponent(queryToken)}; HttpOnly; SameSite=Strict; Path=/ui`,
      });
      res.end();
      return;
    }
    if (!options.dashboard) {
      sendHtml(res, 503, "<!doctype html><p>dashboard unavailable</p>");
      return;
    }
    const dashboard = options.dashboard;
    if (url.pathname === "/ui" || url.pathname === "/ui/") {
      sendHtml(res, 200, renderOverview(await dashboard.overview()));
      return;
    }
    if (url.pathname === "/ui/incidents") {
      const incidents = await services.incidentService.list({
        tenant: services.panels.default().tenant,
        limit: 100,
      });
      sendHtml(
        res,
        200,
        renderIncidentsList(
          incidents.map((incident) => ({
            id: incident.id,
            title: incident.title,
            severity: incident.severity,
            state: incident.state,
            server: `${incident.ref.panel}/${incident.ref.serverId}`,
            detectedAt: incident.detectedAt,
          })),
        ),
      );
      return;
    }
    if (url.pathname === "/ui/incident") {
      const id = url.searchParams.get("id") ?? "";
      const tenant = services.panels.default().tenant;
      const incident = await services.incidentService.find(tenant, id);
      if (!incident) {
        sendHtml(res, 404, `<!doctype html><body style="font-family:monospace;background:#0f1115;color:#d7dae0;padding:40px"><p>incident not found</p></body>`);
        return;
      }
      const evidence = await services.incidentService.evidence(tenant, id);
      sendHtml(
        res,
        200,
        renderIncident({
          id: incident.id,
          title: incident.title,
          summary: incident.summary,
          severity: incident.severity,
          state: incident.state,
          server: `${incident.ref.panel}/${incident.ref.serverId}`,
          detectedAt: incident.detectedAt,
          resolvedAt: incident.resolvedAt,
          application: incident.application,
          probableCauses: incident.data.probableCauses.map((cause) => ({
            cause: cause.cause,
            confidence: cause.confidence,
            kind: cause.kind,
          })),
          symptoms: incident.data.symptoms,
          notes: incident.data.notes ?? [],
          evidence: evidence.map((item) => ({
            ts: item.ts,
            kind: item.kind,
            source: item.source,
            summary: item.summary,
          })),
        }),
      );
      return;
    }
    if (url.pathname === "/ui/changes") {
      const changes = await services.changeRepository.list({
        tenant: services.panels.default().tenant,
        limit: 200,
      });
      sendHtml(
        res,
        200,
        renderChanges(
          changes.map((change) => ({
            id: change.id,
            server: `${change.ref.panel}/${change.ref.serverId}`,
            action: change.action,
            target: change.target,
            actor: change.actor,
            ts: change.ts,
            result: change.result,
            beforeHash: change.beforeHash,
            afterHash: change.afterHash,
          })),
        ),
      );
      return;
    }
    if (url.pathname === "/ui/topology") {
      sendHtml(
        res,
        200,
        renderTopology({
          nodes: await services.topologyRepository.nodes(),
          edges: await services.topologyRepository.edges(),
        }),
      );
      return;
    }
    if (url.pathname === "/ui/policies") {
      sendHtml(res, 200, renderPolicies(policySnapshot(services)));
      return;
    }
    sendHtml(res, 404, `<!doctype html><body style="font-family:monospace;background:#0f1115;color:#d7dae0;padding:40px"><p>not found: ${escapeHtml(url.pathname)}</p></body>`);
  };

  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        throw new Error("request body too large");
      }
      chunks.push(buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (text.trim() === "") return undefined;
    return JSON.parse(text) as unknown;
  };

  const handleMcp = async (
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> => {
    const sessionHeader = req.headers["mcp-session-id"];
    const sessionId = typeof sessionHeader === "string" ? sessionHeader : undefined;
    let transport = sessionId ? sessions.get(sessionId) : undefined;

    if (!transport) {
      if (req.method !== "POST") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing mcp-session-id" }));
        return;
      }
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, created);
          metrics.setGauge("mcp_http_sessions", sessions.size);
          logger.info("mcp http session started", { sessionId: id });
        },
      });
      created.onclose = () => {
        if (created.sessionId) sessions.delete(created.sessionId);
        metrics.setGauge("mcp_http_sessions", sessions.size);
      };
      const server = options.createServer();
      await server.connect(created);
      transport = created;
    }

    await transport.handleRequest(req, res, parsedBody);
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      try {
        if (url.pathname === "/health") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ok", version: VERSION, uptimeMs: Date.now() - startedAt }));
          return;
        }
        if (url.pathname === "/ready") {
          try {
            await services.database.get("SELECT 1 as ok");
          } catch {
            res.writeHead(503, { "content-type": "application/json" });
            res.end(JSON.stringify({ status: "unavailable", reason: "database" }));
            return;
          }
          const panels = services.panels.list().filter((panel) => panel.clientApi || panel.applicationApi);
          if (panels.length === 0) {
            res.writeHead(503, { "content-type": "application/json" });
            res.end(JSON.stringify({ status: "unavailable", reason: "no usable panels" }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ready", panels: panels.length }));
          return;
        }
        if (url.pathname === "/metrics") {
          if (!config.exposeMetrics) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "metrics disabled" }));
            return;
          }
          if (!config.authToken && !isLoopback(config.host)) {
            unauthorized(res);
            return;
          }
          if (config.authToken && !isAuthorized(req)) {
            unauthorized(res);
            return;
          }
          res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
          res.end(metrics.renderPrometheus());
          return;
        }
        if (url.pathname === "/mcp") {
          if (!isAuthorized(req)) {
            unauthorized(res);
            return;
          }
          const parsedBody = req.method === "POST" ? await readBody(req) : undefined;
          await handleMcp(req, res, parsedBody);
          return;
        }
        if (url.pathname.startsWith("/ui")) {
          await handleUi(url, req, res);
          return;
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      } catch (error) {
        logger.error("http request failed", {
          path: url.pathname,
          error: (error as Error).message,
        });
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal error" }));
        }
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  logger.info("http transport listening", {
    host: config.host,
    port: config.port,
    authRequired: Boolean(config.authToken),
  });

  return {
    server,
    address: () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        return { host: address.address, port: address.port };
      }
      return { host: config.host, port: config.port };
    },
    close: async () => {
      for (const transport of sessions.values()) {
        try {
          await transport.close();
        } catch {
          continue;
        }
      }
      sessions.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
