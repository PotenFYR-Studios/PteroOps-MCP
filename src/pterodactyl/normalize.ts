import type { ServerRef } from "../shared/types.js";
import type {
  Allocation,
  ApplicationEgg,
  ApplicationLocation,
  ApplicationNest,
  ApplicationNode,
  ApplicationServerSummary,
  ApplicationUser,
  FileEntry,
  NormalizedResources,
  PteroListPayload,
  ServerDetail,
  ServerFeatureLimits,
  ServerLimits,
  ServerSummary,
  StartupInfo,
  StartupVariable,
} from "./types.js";

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : null;
}

function str(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return 0;
}

function bool(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function ms(value: unknown): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return num(value);
}

export function normalizeLimits(raw: unknown): ServerLimits {
  const record = asRecord(raw) ?? {};
  return {
    memoryMb: num(record.memory),
    diskMb: num(record.disk),
    cpuPercent: num(record.cpu),
    swapMb: num(record.swap),
    ioWeight: num(record.io),
    threads: str(record.threads),
    oomKiller: record.oom_disabled === undefined ? true : !bool(record.oom_disabled),
  };
}

export function normalizeFeatureLimits(raw: unknown): ServerFeatureLimits | null {
  const record = asRecord(raw);
  if (!record) return null;
  return {
    databases: num(record.databases),
    allocations: num(record.allocations),
    backups: num(record.backups),
  };
}

export function normalizeAllocation(raw: unknown): Allocation {
  const record = asRecord(raw) ?? {};
  return {
    id: num(record.id),
    ip: str(record.ip) ?? "0.0.0.0",
    port: num(record.port),
    alias: str(record.alias),
    primary: record.is_default === undefined ? bool(record.primary) : bool(record.is_default),
  };
}

export function normalizeStartupVariable(raw: unknown): StartupVariable {
  const record = asRecord(raw) ?? {};
  return {
    name: str(record.name) ?? "variable",
    description: str(record.description) ?? "",
    envVariable: str(record.env_variable) ?? str(record.envVariable) ?? "UNKNOWN",
    defaultValue: str(record.default_value) ?? "",
    serverValue: str(record.server_value) ?? "",
    editable: record.is_editable === undefined ? true : bool(record.is_editable),
  };
}

export function normalizeServerSummary(ref: ServerRef, raw: Raw, nodeName?: unknown): ServerSummary {
  return {
    ref,
    ...(str(raw.uuid) ? { uuid: str(raw.uuid)! } : {}),
    name: str(raw.name) ?? ref.serverId,
    description: str(raw.description) ?? "",
    node: str(raw.node) ?? str(nodeName),
    state: str(raw.status) ?? str(raw.state),
    suspended: bool(raw.is_suspended) || str(raw.status) === "suspended",
    installing: bool(raw.is_installing),
    transferring: bool(raw.is_transferring),
    limits: normalizeLimits(raw.limits ?? raw.container),
    featureLimits: normalizeFeatureLimits(raw.feature_limits),
    dockerImage: str(raw.docker_image) ?? str(asRecord(raw.container)?.image),
    invocation: str(raw.invocation) ?? str(asRecord(raw.container)?.startup_command),
    nodeMaintenance: bool(raw.is_node_under_maintenance),
  };
}

export function normalizeServerDetail(ref: ServerRef, raw: Raw): ServerDetail {
  const relationships = asRecord(raw.relationships) ?? {};
  const allocationData = asRecord(relationships.allocations)?.data;
  const allocations = Array.isArray(allocationData)
    ? allocationData.map((item) => normalizeAllocation(asRecord(item)?.attributes))
    : [];
  const variableData = asRecord(relationships.variables)?.data;
  const summary = normalizeServerSummary(ref, raw);
  const primary =
    allocations.find((allocation) => allocation.primary) ?? allocations[0] ?? null;
  const container = asRecord(raw.container);
  return {
    ...summary,
    owner: str(raw.user) ?? str(asRecord(raw.server_owner)?.username),
    egg: raw.egg === undefined ? null : num(raw.egg),
    nest: raw.nest === undefined ? null : num(raw.nest),
    allocations,
    primaryAllocation: primary,
    startupCommand: str(raw.startup) ?? str(container?.startup_command) ?? summary.invocation,
    ...(Array.isArray(variableData) && variableData.length > 0
      ? { variables: variableData.map((item) => normalizeStartupVariable(asRecord(item)?.attributes)) }
      : {}),
  };
}

export function normalizeResources(
  raw: Raw,
  fallbackLimits?: { memoryMb?: number; diskMb?: number },
): NormalizedResources {
  const resources = asRecord(raw.resources) ?? raw;
  const memoryBytes = num(resources.memory_bytes);
  const memoryLimitBytes =
    num(resources.memory_limit_bytes) > 0
      ? num(resources.memory_limit_bytes)
      : num(resources.memory_limit_mb) > 0
        ? num(resources.memory_limit_mb) * 1024 * 1024
        : (fallbackLimits?.memoryMb ?? 0) * 1024 * 1024;
  const diskBytes = num(resources.disk_bytes);
  const diskLimitBytes =
    num(resources.disk_limit_bytes) > 0
      ? num(resources.disk_limit_bytes)
      : num(resources.disk_limit_mb) > 0
        ? num(resources.disk_limit_mb) * 1024 * 1024
        : (fallbackLimits?.diskMb ?? 0) * 1024 * 1024;
  const uptimeRaw = resources.uptime ?? resources.uptime_ms;
  return {
    state: str(raw.current_state) ?? str(raw.state),
    suspended: bool(raw.is_suspended),
    memoryBytes,
    memoryLimitBytes,
    cpuAbsolute: num(resources.cpu_absolute ?? resources.cpu_percent),
    diskBytes,
    diskLimitBytes,
    networkRxBytes: num(resources.network_rx_bytes ?? resources.network_receive_bytes),
    networkTxBytes: num(resources.network_tx_bytes ?? resources.network_transmit_bytes),
    uptimeMs: uptimeRaw === undefined || uptimeRaw === null ? null : num(uptimeRaw),
  };
}

export function normalizeStartupFromList(
  items: Array<{ attributes: Raw }>,
  meta: Raw,
): StartupInfo {
  return {
    startupCommand: str(meta.startup_command) ?? "",
    rawStartupCommand: str(meta.raw_startup_command),
    dockerImage: str(meta.docker_image) ?? "",
    variables: items.map((item) => normalizeStartupVariable(item.attributes)),
  };
}

export function normalizeFileEntry(raw: Raw): FileEntry {
  const attributes = asRecord(raw.attributes) ?? raw;
  return {
    name: str(attributes.name) ?? "",
    size: num(attributes.size),
    mode: str(attributes.mode) ?? "",
    mimetype: str(attributes.mimetype) ?? "application/octet-stream",
    directory: bool(attributes.is_directory),
    file: bool(attributes.is_file),
    symlink: bool(attributes.is_symlink),
    modifiedAt: attributes.modified_at ? ms(attributes.modified_at) : null,
  };
}

export function extractPagination(payload: PteroListPayload): {
  total: number;
  currentPage: number;
  totalPages: number;
} {
  const pagination = asRecord(payload.meta?.pagination) ?? {};
  return {
    total: num(pagination.total),
    currentPage: num(pagination.current_page) || 1,
    totalPages: Math.max(1, num(pagination.total_pages) || 1),
  };
}

export function normalizeApplicationServer(ref: ServerRef, raw: Raw): ApplicationServerSummary {
  const summary = normalizeServerSummary(ref, raw);
  const egg = raw.egg === undefined ? null : num(raw.egg);
  return {
    ...summary,
    externalId: raw.external_id === undefined ? null : num(raw.external_id),
    user: raw.user === undefined ? null : num(raw.user),
    allocationId: raw.allocation === undefined ? null : num(raw.allocation),
    dockerImage: summary.dockerImage ?? str(raw.image),
    ...(egg !== null ? { egg } : {}),
  };
}

export function normalizeNode(raw: Raw): ApplicationNode {
  const allocationData = asRecord(asRecord(raw.relationships)?.allocations)?.data;
  return {
    id: num(raw.id),
    name: str(raw.name) ?? "node",
    fqdn: str(raw.fqdn),
    scheme: str(raw.scheme) ?? "https",
    maintenance: bool(raw.maintenance_mode),
    memoryBytes: num(raw.memory) * 1024 * 1024,
    diskBytes: num(raw.disk) * 1024 * 1024,
    memoryOverallocate: num(raw.memory_overallocate),
    diskOverallocate: num(raw.disk_overallocate),
    allocationCount: Array.isArray(allocationData)
      ? allocationData.length
      : num(raw.allocation_count),
    serverCount: num(raw.servers_count),
  };
}

export function normalizeLocation(raw: Raw): ApplicationLocation {
  return {
    id: num(raw.id),
    short: str(raw.short) ?? "",
    long: str(raw.long) ?? "",
  };
}

export function normalizeNest(raw: Raw): ApplicationNest {
  const eggs = asRecord(raw.relationships)?.eggs;
  const eggData = asRecord(eggs)?.data;
  return {
    id: num(raw.id),
    name: str(raw.name) ?? "",
    description: str(raw.description) ?? "",
    eggCount: Array.isArray(eggData) ? eggData.length : num(raw.egg_count),
  };
}

export function normalizeEgg(raw: Raw): ApplicationEgg {
  const dockerImagesRaw = asRecord(raw.docker_images) ?? {};
  const dockerImages: Record<string, string> = {};
  for (const [key, value] of Object.entries(dockerImagesRaw)) {
    const image = str(value);
    if (image) dockerImages[key] = image;
  }
  const firstImage = Object.values(dockerImages)[0] ?? null;
  return {
    id: num(raw.id),
    nestId: raw.nest === undefined ? null : num(raw.nest),
    name: str(raw.name) ?? "egg",
    description: str(raw.description) ?? "",
    dockerImage: firstImage,
    dockerImages,
    startup: str(raw.startup),
  };
}

export function normalizeUser(raw: Raw): ApplicationUser {
  return {
    id: num(raw.id),
    externalId: str(raw.external_id),
    username: str(raw.username) ?? "",
    email: str(raw.email) ?? "",
    rootAdmin: bool(raw.root_admin),
    serverCount: num(raw.servers_count),
  };
}
