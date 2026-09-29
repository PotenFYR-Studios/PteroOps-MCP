import type {
  AllocationInfo,
  BackupInfo,
  DatabaseInfo,
  ScheduleInfo,
  ScheduleTask,
  SubuserInfo,
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

function ms(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof value === "number" && value > 0) return value;
  return null;
}

function attributesOf(raw: unknown): Raw {
  const root = asRecord(raw) ?? {};
  return asRecord(root.attributes) ?? root;
}

export function normalizeBackup(raw: unknown): BackupInfo {
  const attributes = attributesOf(raw);
  const ignored = attributes.ignored_files;
  return {
    uuid: str(attributes.uuid) ?? "",
    name: str(attributes.name) ?? "backup",
    bytes: num(attributes.bytes),
    checksum: str(attributes.sha256_hash),
    createdAt: ms(attributes.created_at),
    completedAt: ms(attributes.completed_at),
    successful: attributes.is_successful === undefined ? true : bool(attributes.is_successful),
    locked: bool(attributes.is_locked),
    ignoredFiles: Array.isArray(ignored) ? ignored.map((item) => String(item)) : [],
    ...(attributes.is_restoring === undefined ? {} : { isRestoring: bool(attributes.is_restoring) }),
  };
}

export function normalizeDatabase(raw: unknown): DatabaseInfo {
  const attributes = attributesOf(raw);
  const host = asRecord(attributes.host) ?? {};
  const passwordAttribute = asRecord(
    asRecord(asRecord(attributes.relationships)?.password)?.attributes,
  );
  return {
    id: num(attributes.id),
    hostAddress: str(host.address) ?? str(attributes.host) ?? "",
    hostPort: num(host.port),
    name: str(attributes.name) ?? "",
    username: str(attributes.username) ?? "",
    connectionsFrom: str(attributes.connections_from) ?? "%",
    maxConnections: num(attributes.max_connections),
    password: passwordAttribute ? str(passwordAttribute.password) : null,
  };
}

export function normalizeScheduleTask(raw: unknown): ScheduleTask {
  const attributes = attributesOf(raw);
  return {
    id: attributes.id === undefined ? null : num(attributes.id),
    action: str(attributes.action) ?? "command",
    payload: str(attributes.payload) ?? "",
    timeOffset: num(attributes.time_offset),
    continueOnFailure: bool(attributes.continue_on_failure),
  };
}

export function normalizeSchedule(raw: unknown): ScheduleInfo {
  const attributes = attributesOf(raw);
  const cron = asRecord(attributes.cron) ?? {};
  const taskData = asRecord(asRecord(attributes.relationships)?.tasks)?.data;
  return {
    id: num(attributes.id),
    name: str(attributes.name) ?? "schedule",
    cron: {
      minute: str(cron.minute) ?? "0",
      hour: str(cron.hour) ?? "*",
      dayOfMonth: str(cron.day_of_month) ?? "*",
      month: str(cron.month) ?? "*",
      dayOfWeek: str(cron.day_of_week) ?? "*",
    },
    active: bool(attributes.is_active),
    processing: bool(attributes.is_processing),
    onlyWhenOnline: bool(attributes.only_when_online),
    lastRunAt: ms(attributes.last_run_at),
    nextRunAt: ms(attributes.next_run_at),
    tasks: Array.isArray(taskData)
      ? taskData.map((item) => normalizeScheduleTask(item))
      : [],
  };
}

export function normalizeSubuser(raw: unknown): SubuserInfo {
  const attributes = attributesOf(raw);
  const permissions = attributes.permissions;
  return {
    uuid: str(attributes.uuid) ?? "",
    username: str(attributes.username) ?? "",
    email: str(attributes.email) ?? "",
    twoFactorEnabled: bool(attributes["2fa_enabled"] ?? attributes.two_factor_enabled),
    createdAt: ms(attributes.created_at),
    permissions: Array.isArray(permissions) ? permissions.map((item) => String(item)) : [],
  };
}

export function normalizeAllocationInfo(raw: unknown): AllocationInfo {
  const attributes = attributesOf(raw);
  return {
    id: num(attributes.id),
    ip: str(attributes.ip) ?? "0.0.0.0",
    ipAlias: str(attributes.ip_alias),
    port: num(attributes.port),
    notes: str(attributes.notes),
    primary: bool(attributes.is_default),
  };
}
