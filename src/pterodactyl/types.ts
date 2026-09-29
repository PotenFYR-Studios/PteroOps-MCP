import type { ServerRef } from "../shared/types.js";

export interface PteroPagination {
  total: number;
  count: number;
  perPage: number;
  currentPage: number;
  totalPages: number;
}

export interface PteroListPayload {
  data: Array<{ object: string; attributes: Record<string, unknown> }>;
  meta?: { pagination?: Record<string, unknown> };
}

export interface PteroItemPayload {
  object?: string;
  attributes: Record<string, unknown>;
}

export interface ServerLimits {
  memoryMb: number;
  diskMb: number;
  cpuPercent: number;
  swapMb: number;
  ioWeight: number;
  threads: string | null;
  oomKiller: boolean;
}

export interface ServerFeatureLimits {
  databases: number;
  allocations: number;
  backups: number;
}

export interface Allocation {
  id: number;
  ip: string;
  port: number;
  alias: string | null;
  primary: boolean;
}

export interface StartupVariable {
  name: string;
  description: string;
  envVariable: string;
  defaultValue: string;
  serverValue: string;
  editable: boolean;
}

export interface ServerSummary {
  ref: ServerRef;
  uuid?: string;
  name: string;
  description: string;
  node: string | null;
  state: string | null;
  suspended: boolean;
  installing: boolean;
  transferring: boolean;
  limits: ServerLimits;
  featureLimits: ServerFeatureLimits | null;
  dockerImage: string | null;
  invocation: string | null;
  nodeMaintenance: boolean;
}

export interface ServerDetail extends ServerSummary {
  owner: string | null;
  egg: number | null;
  nest: number | null;
  allocations: Allocation[];
  primaryAllocation: Allocation | null;
  startupCommand: string | null;
}

export interface NormalizedResources {
  state: string | null;
  suspended: boolean;
  memoryBytes: number;
  memoryLimitBytes: number;
  cpuAbsolute: number;
  diskBytes: number;
  diskLimitBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number | null;
}

export interface StartupInfo {
  startupCommand: string;
  rawStartupCommand: string | null;
  dockerImage: string;
  variables: StartupVariable[];
}

export interface FileEntry {
  name: string;
  size: number;
  mode: string;
  mimetype: string;
  directory: boolean;
  file: boolean;
  symlink: boolean;
  modifiedAt: number | null;
}

export interface WebsocketCredentials {
  token: string;
  socket: string;
}

export interface BackupInfo {
  uuid: string;
  name: string;
  bytes: number;
  checksum: string | null;
  createdAt: number | null;
  completedAt: number | null;
  successful: boolean;
  locked: boolean;
  ignoredFiles: string[];
  isRestoring?: boolean;
}

export interface DatabaseInfo {
  id: number;
  hostAddress: string;
  hostPort: number;
  name: string;
  username: string;
  connectionsFrom: string;
  maxConnections: number;
  password: string | null;
}

export interface ScheduleTask {
  id: number | null;
  action: string;
  payload: string;
  timeOffset: number;
  continueOnFailure: boolean;
}

export interface ScheduleInfo {
  id: number;
  name: string;
  cron: {
    minute: string;
    hour: string;
    dayOfMonth: string;
    month: string;
    dayOfWeek: string;
  };
  active: boolean;
  processing: boolean;
  onlyWhenOnline: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  tasks: ScheduleTask[];
}

export interface SubuserInfo {
  uuid: string;
  username: string;
  email: string;
  twoFactorEnabled: boolean;
  createdAt: number | null;
  permissions: string[];
}

export interface AllocationInfo {
  id: number;
  ip: string;
  ipAlias: string | null;
  port: number;
  notes: string | null;
  primary: boolean;
}

export interface ConsoleCommandResult {
  command: string;
  output: string[];
  markerFound: boolean;
}

export interface ApplicationNode {
  id: number;
  name: string;
  fqdn: string | null;
  scheme: string;
  maintenance: boolean;
  memoryBytes: number;
  diskBytes: number;
  memoryOverallocate: number;
  diskOverallocate: number;
  allocationCount: number;
  serverCount: number;
}

export interface ApplicationLocation {
  id: number;
  short: string;
  long: string;
}

export interface ApplicationNest {
  id: number;
  name: string;
  description: string;
  eggCount: number;
}

export interface ApplicationEgg {
  id: number;
  nestId: number | null;
  name: string;
  description: string;
  dockerImage: string | null;
  dockerImages: Record<string, string>;
  startup: string | null;
}

export interface ApplicationServerSummary extends ServerSummary {
  externalId: number | null;
  user: number | null;
  allocationId: number | null;
}

export interface ApplicationUser {
  id: number;
  externalId: string | null;
  username: string;
  email: string;
  rootAdmin: boolean;
  serverCount: number;
}
