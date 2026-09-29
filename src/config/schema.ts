import { z } from "zod";

export const PanelSchema = z
  .object({
    url: z
      .string()
      .url()
      .transform((value) => value.replace(/\/+$/, "")),
    clientKey: z.string().min(8).optional(),
    applicationKey: z.string().min(8).optional(),
    tenant: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
    maxRetries: z.number().int().min(0).max(5).default(3),
  })
  .refine((panel) => Boolean(panel.clientKey || panel.applicationKey), {
    message: "at least one of clientKey or applicationKey is required",
  });

export const StorageSchema = z.object({
  driver: z.enum(["sqlite", "postgres"]).default("sqlite"),
  dataDir: z.string().default("./data"),
  postgresUrl: z.string().optional(),
  redisUrl: z.string().optional(),
});

export const RetentionSchema = z.object({
  preset: z.enum(["default", "compliance", "custom"]).default("default"),
  auditDays: z.number().int().min(0).max(3650).default(0),
  changesDays: z.number().int().min(0).max(3650).default(0),
  resolvedIncidentDays: z.number().int().min(0).max(3650).default(0),
});

export const ConsoleSchema = z.object({
  persist: z.boolean().default(true),
  retentionHours: z.number().int().min(1).default(168),
  maxEventsPerServer: z.number().int().min(1000).default(200_000),
  captureWarnAndAbove: z.boolean().default(false),
  backfillOnConnect: z.boolean().default(true),
});

export const MonitoringSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().int().min(10).max(3600).default(30),
  serverListCacheSeconds: z.number().int().min(30).max(3600).default(300),
  concurrency: z.number().int().min(1).max(32).default(4),
  metricsRetentionHours: z.number().int().min(1).default(72),
  processEventsRetentionDays: z.number().int().min(1).default(30),
});

export const PolicySchema = z.object({
  protectedPaths: z
    .array(z.string())
    .default([".env", "*.pem", "*.key", "id_rsa*", "*.p12", "*.pfx"]),
  blockedCommands: z
    .array(z.string())
    .default(["^rm\\s+-rf\\s+/", "^mkfs", "^dd\\s+if=", "^shutdown", "^reboot", "^:(){"]),
  allowedCommands: z.array(z.string()).default([]),
  allowedServers: z.array(z.string()).default([]),
  maxRestartsPerHour: z.number().int().min(1).max(60).default(5),
  maxFileSizeBytes: z.number().int().min(1024).max(50_000_000).default(2_000_000),
  networkProbeTargets: z.array(z.string()).default([]),
  networkProbeAllowed: z.boolean().default(false),
});

export const ApprovalSchema = z.object({
  autoApprove: z
    .array(z.string())
    .default(["start_server", "create_backup", "restart_after_verified_crash"]),
  requireApproval: z
    .array(z.string())
    .default([
      "file_write",
      "dependency_update",
      "git_deploy",
      "git_rollback",
      "restore_backup",
      "kill_server",
      "database_modification",
      "startup_variable_change",
    ]),
  deny: z.array(z.string()).default(["delete_server", "wipe_filesystem"]),
  defaultExpiryMinutes: z.number().int().min(5).max(1440).default(120),
});

export const MaintenanceWindowSchema = z.object({
  name: z.string().min(1),
  servers: z.array(z.string()).default(["*"]),
  denyAutomation: z.array(z.string()).default([]),
  allowAutoLowRisk: z.array(z.string()).default([]),
});

export const LogSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  pretty: z.boolean().default(false),
});

export const HttpSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(8080),
  authToken: z.string().min(8).optional(),
  exposeMetrics: z.boolean().default(true),
});

export const GitSchema = z.object({
  enabled: z.boolean().default(false),
  repositories: z.record(z.string(), z.string()).default({}),
  tokens: z
    .object({
      github: z.string().optional(),
      gitlab: z.string().optional(),
    })
    .default({}),
  apiBase: z
    .object({
      github: z.string().url().optional(),
      gitlab: z.string().url().optional(),
    })
    .default({}),
});

export const RedactionSchema = z.object({
  extraPatterns: z.array(z.string()).default([]),
  extraSecrets: z.array(z.string()).default([]),
});

export const DiagnosticsSchema = z.object({
  defaultWindowMinutes: z.number().int().min(1).max(1440).default(30),
  maxEventsPerAnalysis: z.number().int().min(100).max(50_000).default(5_000),
  bundleCacheSeconds: z.number().int().min(0).max(600).default(60),
});

export const RemediationSchema = z.object({
  healthTimeoutSeconds: z.number().int().min(30).max(3600).default(300),
  healthPollSeconds: z.number().int().min(2).max(60).default(10),
  stabilizationSeconds: z.number().int().min(0).max(600).default(60),
  requireFreshBackupMinutes: z.number().int().min(0).max(10_080).default(0),
  maxActionsPerPlan: z.number().int().min(1).max(20).default(10),
  snapshotMaxBytes: z.number().int().min(4096).max(10_000_000).default(262_144),
  snapshotRetentionDays: z.number().int().min(1).max(365).default(30),
});

export const ScheduleConfigSchema = z.object({
  name: z.string().min(1),
  kind: z.enum([
    "health_scan",
    "diagnose_scope",
    "dependency_audit",
    "backup_check",
    "anomaly_scan",
    "retention_prune",
  ]),
  every: z.string().default("24h"),
  scope: z.array(z.string()).default(["*"]),
  enabled: z.boolean().default(true),
});

export const ConfigSchema = z.object({
  tenant: z.string().min(1).default("local"),
  tenants: z.record(z.string(), z.object({ panels: z.array(z.string()) })).optional(),
  panels: z.record(z.string(), PanelSchema),
  defaultPanel: z.string().optional(),
  groups: z.record(z.string(), z.array(z.string())).default({}),
  schedules: z.array(ScheduleConfigSchema).default([]),
  storage: StorageSchema.default({}),
  retention: RetentionSchema.default({}),
  console: ConsoleSchema.default({}),
  monitoring: MonitoringSchema.default({}),
  diagnostics: DiagnosticsSchema.default({}),
  remediation: RemediationSchema.default({}),
  policy: PolicySchema.default({}),
  approval: ApprovalSchema.default({}),
  maintenanceWindows: z.array(MaintenanceWindowSchema).default([]),
  emergencyOverride: z.boolean().default(false),
  git: GitSchema.default({}),
  http: HttpSchema.default({}),
  log: LogSchema.default({}),
  redaction: RedactionSchema.default({}),
});

export type PanelConfig = z.infer<typeof PanelSchema>;
export type PteroOpsConfig = z.infer<typeof ConfigSchema>;
export type PolicyConfig = z.infer<typeof PolicySchema>;
export type ApprovalConfig = z.infer<typeof ApprovalSchema>;
export type ConsoleConfig = z.infer<typeof ConsoleSchema>;
export type MonitoringConfig = z.infer<typeof MonitoringSchema>;
export type HttpConfig = z.infer<typeof HttpSchema>;
export type DiagnosticsConfig = z.infer<typeof DiagnosticsSchema>;
export type RemediationConfig = z.infer<typeof RemediationSchema>;
export type ScheduleConfigEntry = z.infer<typeof ScheduleConfigSchema>;
export type StorageConfig = z.infer<typeof StorageSchema>;
export type RetentionConfig = z.infer<typeof RetentionSchema>;
export type GitConfig = z.infer<typeof GitSchema>;
export type MaintenanceWindowConfig = z.infer<typeof MaintenanceWindowSchema>;
