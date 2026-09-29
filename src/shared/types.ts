export const CAPABILITIES = [
  "client.server.read",
  "client.console.read",
  "client.console.write",
  "client.power",
  "client.files.read",
  "client.files.write",
  "client.backups",
  "client.databases",
  "client.schedules",
  "client.allocations",
  "client.users.read",
  "application.servers.read",
  "application.servers.write",
  "application.nodes.read",
  "application.users.read",
  "application.users.write",
  "application.nests.read",
  "application.locations.read",
  "application.databases.read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CLIENT_CAPABILITIES: readonly Capability[] = CAPABILITIES.filter((c) =>
  c.startsWith("client."),
);
export const APPLICATION_CAPABILITIES: readonly Capability[] = CAPABILITIES.filter((c) =>
  c.startsWith("application."),
);

export interface ServerRef {
  tenant: string;
  panel: string;
  serverId: string;
}

export function serverRefKey(ref: ServerRef): string {
  return `${ref.tenant}/${ref.panel}/${ref.serverId}`;
}

export function serverRefLabel(ref: ServerRef): string {
  return `${ref.panel}/${ref.serverId}`;
}

export type PowerAction = "start" | "stop" | "restart" | "kill";

export const POWER_SIGNALS: Record<PowerAction, string> = {
  start: "start",
  stop: "stop",
  restart: "restart",
  kill: "kill",
};

export type HealthStatus =
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "crash_loop"
  | "starting"
  | "unknown";

export type Severity = "debug" | "info" | "warn" | "error" | "fatal";

export const SEVERITY_ORDER: Record<Severity, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export type IncidentState =
  | "detected"
  | "investigating"
  | "diagnosed"
  | "awaiting_approval"
  | "remediating"
  | "verifying"
  | "resolved"
  | "rolled_back"
  | "failed"
  | "suppressed";

export const INCIDENT_FINAL_STATES: readonly IncidentState[] = [
  "resolved",
  "rolled_back",
  "suppressed",
];

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 10,
  MEDIUM: 20,
  HIGH: 30,
  CRITICAL: 40,
};

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export interface EvidenceItem {
  source: string;
  detail: string;
  weight?: number;
  ts?: number;
}

export interface DetectedApplication {
  runtime: string;
  application: string;
  distribution?: string;
  version?: string;
  confidence: number;
  evidence: EvidenceItem[];
}

export interface ProcessStateChange {
  ref: ServerRef;
  ts: number;
  kind: "started" | "exited";
  exitCode?: number;
  runtimeMs?: number;
  source: "poll" | "console";
}
