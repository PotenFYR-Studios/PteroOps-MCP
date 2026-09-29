import type { Logger } from "../observability/logger.js";
import type { PteroOpsConfig } from "../config/schema.js";
import { panelTenant } from "../config/loader.js";
import type { ServerRef } from "../shared/types.js";
import { ValidationError } from "../shared/errors.js";
import { PteroHttpClient } from "./http-client.js";
import {
  extractPagination,
  normalizeFileEntry,
  normalizeResources,
  normalizeServerDetail,
  normalizeServerSummary,
  normalizeStartupFromList,
} from "./normalize.js";
import {
  normalizeAllocationInfo,
  normalizeBackup,
  normalizeDatabase,
  normalizeSchedule,
  normalizeSubuser,
} from "./resource-normalize.js";
import type {
  AllocationInfo,
  BackupInfo,
  DatabaseInfo,
  FileEntry,
  NormalizedResources,
  PteroItemPayload,
  PteroListPayload,
  ScheduleInfo,
  ServerDetail,
  ServerSummary,
  StartupInfo,
  SubuserInfo,
  WebsocketCredentials,
} from "./types.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { RedactionEngine } from "../shared/redaction.js";
import { detectKeyKind } from "../security/capabilities.js";

export interface PterodactylClientApiOptions {
  panel: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  logger: Logger;
  metrics: MetricsRegistry;
  redactor: RedactionEngine;
}

export class PterodactylClientApi {
  readonly http: PteroHttpClient;

  constructor(options: PterodactylClientApiOptions) {
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
  ): Promise<{ servers: ServerSummary[]; total: number; totalPages: number; currentPage: number }> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: "/api/client",
      query: { page, per_page: perPage },
    });
    const payload = response.data;
    const servers = (payload?.data ?? []).map((item) =>
      normalizeServerSummary(
        { tenant: ref.tenant, panel: ref.panel, serverId: String(item.attributes.identifier ?? "") },
        item.attributes,
        item.attributes.node,
      ),
    );
    const pagination = extractPagination(payload ?? { data: [] });
    return { servers, ...pagination };
  }

  async allServers(
    ref: { tenant: string; panel: string },
    maxPages = 25,
  ): Promise<ServerSummary[]> {
    const all: ServerSummary[] = [];
    let page = 1;
    for (;;) {
      const result = await this.listServers(ref, page, 100);
      all.push(...result.servers);
      if (page >= result.totalPages || page >= maxPages) break;
      page += 1;
    }
    return all;
  }

  async getServer(
    ref: ServerRef,
    options: { includeAllocations?: boolean; includeVariables?: boolean } = {},
  ): Promise<ServerDetail> {
    const include: string[] = [];
    if (options.includeAllocations ?? true) include.push("allocations");
    if (options.includeVariables) include.push("variables");
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "GET",
      path: `/api/client/servers/${encodeURIComponent(ref.serverId)}`,
      ...(include.length > 0 ? { query: { include: include.join(",") } } : {}),
    });
    return normalizeServerDetail(ref, response.data?.attributes ?? {});
  }

  async getResources(
    ref: ServerRef,
    fallbackLimits?: { memoryMb?: number; diskMb?: number },
  ): Promise<NormalizedResources> {
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "GET",
      path: `/api/client/servers/${encodeURIComponent(ref.serverId)}/resources`,
    });
    return normalizeResources(response.data?.attributes ?? {}, fallbackLimits);
  }

  async getStartup(ref: ServerRef): Promise<StartupInfo> {
    const response = await this.http.requestJson<
      PteroListPayload & { meta?: Record<string, unknown> }
    >({
      method: "GET",
      path: `/api/client/servers/${encodeURIComponent(ref.serverId)}/startup`,
    });
    const payload = response.data;
    return normalizeStartupFromList(payload?.data ?? [], payload?.meta ?? {});
  }

  async sendCommand(ref: ServerRef, command: string): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: `/api/client/servers/${encodeURIComponent(ref.serverId)}/command`,
      body: { command },
    });
  }

  async setPower(ref: ServerRef, signal: string): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: `/api/client/servers/${encodeURIComponent(ref.serverId)}/power`,
      body: { signal },
    });
  }

  async listFiles(ref: ServerRef, directory = "/"): Promise<FileEntry[]> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: `/api/client/servers/${encodeURIComponent(ref.serverId)}/files/list`,
      query: { directory },
    });
    return (response.data?.data ?? []).map((item) => normalizeFileEntry(item));
  }

  async readFile(ref: ServerRef, file: string): Promise<string> {
    const response = await this.http.requestText({
      method: "GET",
      path: `/api/client/servers/${encodeURIComponent(ref.serverId)}/files/contents`,
      query: { file },
    });
    return response.text;
  }

  async writeFile(ref: ServerRef, file: string, content: string): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: `/api/client/servers/${encodeURIComponent(ref.serverId)}/files/write`,
      query: { file },
      rawBody: content,
      contentType: "text/plain",
    });
  }

  async getWebsocket(ref: ServerRef): Promise<WebsocketCredentials> {
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "GET",
      path: `/api/client/servers/${encodeURIComponent(ref.serverId)}/websocket`,
    });
    const root = (response.data ?? {}) as unknown as Record<string, unknown>;
    const inner = (root.data as Record<string, unknown> | undefined) ?? root;
    const source = (inner.attributes as Record<string, unknown> | undefined) ?? inner;
    return {
      token: String(source.token ?? ""),
      socket: String(source.socket ?? ""),
    };
  }

  private serverPath(ref: ServerRef, suffix: string): string {
    return `/api/client/servers/${encodeURIComponent(ref.serverId)}${suffix}`;
  }

  async updateStartupVariable(ref: ServerRef, key: string, value: string): Promise<void> {
    await this.http.requestEmpty({
      method: "PUT",
      path: this.serverPath(ref, "/startup/variable"),
      body: { key, value },
    });
  }

  async listBackups(ref: ServerRef): Promise<BackupInfo[]> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: this.serverPath(ref, "/backups"),
    });
    return (response.data?.data ?? []).map((item) => normalizeBackup(item));
  }

  async createBackup(
    ref: ServerRef,
    options: { name?: string; ignoredFiles?: string } = {},
  ): Promise<BackupInfo> {
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "POST",
      path: this.serverPath(ref, "/backups"),
      body: {
        ...(options.name ? { name: options.name } : {}),
        ...(options.ignoredFiles ? { ignored_files: options.ignoredFiles } : {}),
      },
    });
    return normalizeBackup(response.data ?? {});
  }

  async deleteBackup(ref: ServerRef, backupUuid: string): Promise<void> {
    await this.http.requestEmpty({
      method: "DELETE",
      path: this.serverPath(ref, `/backups/${encodeURIComponent(backupUuid)}`),
    });
  }

  async setBackupLocked(ref: ServerRef, backupUuid: string, locked: boolean): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: this.serverPath(
        ref,
        `/backups/${encodeURIComponent(backupUuid)}/${locked ? "lock" : "unlock"}`,
      ),
    });
  }

  async restoreBackup(ref: ServerRef, backupUuid: string): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: this.serverPath(ref, `/backups/${encodeURIComponent(backupUuid)}/restore`),
    });
  }

  async listDatabases(ref: ServerRef): Promise<DatabaseInfo[]> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: this.serverPath(ref, "/databases"),
      query: { include: "password" },
    });
    return (response.data?.data ?? []).map((item) => normalizeDatabase(item));
  }

  async createDatabase(
    ref: ServerRef,
    options: { database: string; remote?: string },
  ): Promise<DatabaseInfo> {
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "POST",
      path: this.serverPath(ref, "/databases"),
      query: { include: "password" },
      body: {
        database: options.database,
        remote: options.remote ?? "%",
      },
    });
    return normalizeDatabase(response.data ?? {});
  }

  async rotateDatabasePassword(ref: ServerRef, databaseId: number): Promise<DatabaseInfo> {
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "POST",
      path: this.serverPath(ref, `/databases/${String(databaseId)}/rotate-password`),
      query: { include: "password" },
    });
    return normalizeDatabase(response.data ?? {});
  }

  async deleteDatabase(ref: ServerRef, databaseId: number): Promise<void> {
    await this.http.requestEmpty({
      method: "DELETE",
      path: this.serverPath(ref, `/databases/${String(databaseId)}`),
    });
  }

  async listSchedules(ref: ServerRef): Promise<ScheduleInfo[]> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: this.serverPath(ref, "/schedules"),
      query: { include: "tasks" },
    });
    return (response.data?.data ?? []).map((item) => normalizeSchedule(item));
  }

  async createSchedule(
    ref: ServerRef,
    schedule: {
      name: string;
      minute?: string;
      hour?: string;
      dayOfMonth?: string;
      month?: string;
      dayOfWeek?: string;
      active?: boolean;
      onlyWhenOnline?: boolean;
      tasks?: Array<{ action: string; payload: string; timeOffset?: number }>;
    },
  ): Promise<ScheduleInfo> {
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "POST",
      path: this.serverPath(ref, "/schedules"),
      body: {
        name: schedule.name,
        minute: schedule.minute ?? "0",
        hour: schedule.hour ?? "*",
        day_of_month: schedule.dayOfMonth ?? "*",
        month: schedule.month ?? "*",
        day_of_week: schedule.dayOfWeek ?? "*",
        is_active: schedule.active ?? true,
        only_when_online: schedule.onlyWhenOnline ?? false,
        ...(schedule.tasks
          ? {
              tasks: schedule.tasks.map((task) => ({
                action: task.action,
                payload: task.payload,
                time_offset: task.timeOffset ?? 0,
              })),
            }
          : {}),
      },
    });
    return normalizeSchedule(response.data ?? {});
  }

  async executeSchedule(ref: ServerRef, scheduleId: number): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: this.serverPath(ref, `/schedules/${String(scheduleId)}/execute`),
    });
  }

  async toggleSchedule(ref: ServerRef, scheduleId: number): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: this.serverPath(ref, `/schedules/${String(scheduleId)}/toggle`),
    });
  }

  async deleteSchedule(ref: ServerRef, scheduleId: number): Promise<void> {
    await this.http.requestEmpty({
      method: "DELETE",
      path: this.serverPath(ref, `/schedules/${String(scheduleId)}`),
    });
  }

  async listAllocations(ref: ServerRef): Promise<AllocationInfo[]> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: this.serverPath(ref, "/network/allocations"),
    });
    return (response.data?.data ?? []).map((item) => normalizeAllocationInfo(item));
  }

  async assignAllocation(ref: ServerRef): Promise<AllocationInfo> {
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "POST",
      path: this.serverPath(ref, "/network/allocations"),
    });
    return normalizeAllocationInfo(response.data ?? {});
  }

  async setPrimaryAllocation(ref: ServerRef, allocationId: number): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: this.serverPath(ref, `/network/allocations/${String(allocationId)}/primary`),
    });
  }

  async updateAllocationNotes(ref: ServerRef, allocationId: number, notes: string): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: this.serverPath(ref, `/network/allocations/${String(allocationId)}`),
      body: { notes },
    });
  }

  async releaseAllocation(ref: ServerRef, allocationId: number): Promise<void> {
    await this.http.requestEmpty({
      method: "DELETE",
      path: this.serverPath(ref, `/network/allocations/${String(allocationId)}`),
    });
  }

  async listSubusers(ref: ServerRef): Promise<SubuserInfo[]> {
    const response = await this.http.requestJson<PteroListPayload>({
      method: "GET",
      path: this.serverPath(ref, "/users"),
    });
    return (response.data?.data ?? []).map((item) => normalizeSubuser(item));
  }

  async createSubuser(
    ref: ServerRef,
    options: { email: string; permissions: string[] },
  ): Promise<SubuserInfo> {
    const response = await this.http.requestJson<PteroItemPayload>({
      method: "POST",
      path: this.serverPath(ref, "/users"),
      body: { email: options.email, permissions: options.permissions },
    });
    return normalizeSubuser(response.data ?? {});
  }

  async updateSubuser(ref: ServerRef, userUuid: string, permissions: string[]): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: this.serverPath(ref, `/users/${encodeURIComponent(userUuid)}`),
      body: { permissions },
    });
  }

  async deleteSubuser(ref: ServerRef, userUuid: string): Promise<void> {
    await this.http.requestEmpty({
      method: "DELETE",
      path: this.serverPath(ref, `/users/${encodeURIComponent(userUuid)}`),
    });
  }

  async pullFromGit(
    ref: ServerRef,
    options: { root: string; url?: string; branch?: string },
  ): Promise<void> {
    await this.http.requestEmpty({
      method: "POST",
      path: this.serverPath(ref, "/files/pull"),
      body: {
        root: options.root,
        ...(options.url ? { url: options.url } : {}),
        ...(options.branch ? { branch: options.branch } : {}),
      },
    });
  }
}

export function resolveServerArgument(
  config: PteroOpsConfig,
  argument: string,
  defaultPanel: string,
): ServerRef {
  const trimmed = argument.trim();
  if (trimmed === "") throw new ValidationError("server argument must not be empty");
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) {
    return { tenant: panelTenant(config, defaultPanel), panel: defaultPanel, serverId: trimmed };
  }
  const panel = trimmed.slice(0, slashIndex);
  const serverId = trimmed.slice(slashIndex + 1);
  if (!panel || !serverId) {
    throw new ValidationError(`Invalid server reference "${argument}" (expected "panel/serverId")`);
  }
  if (!config.panels[panel]) {
    throw new ValidationError(
      `Unknown panel "${panel}" in server reference "${argument}" (configured: ${Object.keys(config.panels).join(", ")})`,
    );
  }
  return { tenant: panelTenant(config, panel), panel, serverId };
}
