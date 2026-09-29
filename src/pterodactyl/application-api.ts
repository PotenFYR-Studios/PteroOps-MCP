import type { Logger } from "../observability/logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { RedactionEngine } from "../shared/redaction.js";
import type { ServerRef } from "../shared/types.js";
import { detectKeyKind } from "../security/capabilities.js";
import { PteroHttpClient } from "./http-client.js";
import {
  extractPagination,
  normalizeApplicationServer,
  normalizeEgg,
  normalizeLocation,
  normalizeNest,
  normalizeNode,
  normalizeServerDetail,
  normalizeUser,
} from "./normalize.js";
import type {
  ApplicationEgg,
  ApplicationLocation,
  ApplicationNest,
  ApplicationNode,
  ApplicationServerSummary,
  ApplicationUser,
  PteroItemPayload,
  PteroListPayload,
  ServerDetail,
} from "./types.js";

export interface PterodactylApplicationApiOptions {
  panel: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  logger: Logger;
  metrics: MetricsRegistry;
  redactor: RedactionEngine;
}

export class PterodactylApplicationApi {
  readonly http: PteroHttpClient;

  constructor(options: PterodactylApplicationApiOptions) {
    this.http = new PteroHttpClient({
      panel: options.panel,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      keyKind: detectKeyKind(options.apiKey),
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      logger: options.logger,
      metrics: options.metrics,
      redactor: options.redactor,
    });
  }

  async listServers(
    ref: { tenant: string; panel: string },
    page = 1,
    perPage = 50,
  ): Promise<{ servers: ApplicationServerSummary[]; total: number; totalPages: number }> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: "/api/application/servers",
      query: { page, per_page: perPage },
    });
    const payload = response.data;
    const servers = (payload?.data ?? []).map((item) =>
      normalizeApplicationServer(
        {
          tenant: ref.tenant,
          panel: ref.panel,
          serverId: String(item.attributes.identifier ?? item.attributes.id ?? ""),
        },
        item.attributes,
      ),
    );
    const pagination = extractPagination(payload ?? { data: [] });
    return { servers, total: pagination.total, totalPages: pagination.totalPages };
  }

  async allServers(
    ref: { tenant: string; panel: string },
    maxPages = 25,
  ): Promise<ApplicationServerSummary[]> {
    const all: ApplicationServerSummary[] = [];
    let page = 1;
    for (;;) {
      const result = await this.listServers(ref, page, 100);
      all.push(...result.servers);
      if (page >= result.totalPages || page >= maxPages) break;
      page += 1;
    }
    return all;
  }

  async getServer(ref: ServerRef): Promise<ServerDetail> {
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "GET",
      path: `/api/application/servers/${encodeURIComponent(ref.serverId)}?include=allocations,variables`,
    });
    return normalizeServerDetail(ref, response.data?.attributes ?? {});
  }

  async listNodes(page = 1, perPage = 100): Promise<{ nodes: ApplicationNode[]; total: number }> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: "/api/application/nodes",
      query: { page, per_page: perPage, include: "allocations" },
    });
    const payload = response.data;
    const nodes = (payload?.data ?? []).map((item) => normalizeNode(item.attributes));
    return { nodes, total: extractPagination(payload ?? { data: [] }).total };
  }

  async listLocations(): Promise<ApplicationLocation[]> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: "/api/application/locations",
      query: { per_page: 100 },
    });
    return (response.data?.data ?? []).map((item) => normalizeLocation(item.attributes));
  }

  async listUsers(page = 1, perPage = 100): Promise<{ users: ApplicationUser[]; total: number }> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: "/api/application/users",
      query: { page, per_page: perPage },
    });
    const payload = response.data;
    const users = (payload?.data ?? []).map((item) => normalizeUser(item.attributes));
    return { users, total: extractPagination(payload ?? { data: [] }).total };
  }

  async listNests(): Promise<ApplicationNest[]> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: "/api/application/nests",
      query: { per_page: 100, include: "eggs" },
    });
    return (response.data?.data ?? []).map((item) => normalizeNest(item.attributes));
  }

  async listEggs(nestId?: number): Promise<ApplicationEgg[]> {
    const path = nestId
      ? `/api/application/nests/${nestId}/eggs`
      : `/api/application/eggs`;
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path,
      query: { per_page: 100, include: "nest" },
    });
    return (response.data?.data ?? []).map((item) => normalizeEgg(item.attributes));
  }

  async getEgg(nestId: number, eggId: number): Promise<ApplicationEgg> {
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "GET",
      path: `/api/application/nests/${String(nestId)}/eggs/${String(eggId)}`,
      query: { include: "variables" },
    });
    return normalizeEgg(response.data?.attributes ?? {});
  }
}
