import type { Severity } from "../../shared/types.js";

export interface PatternAction {
  action: string;
  description: string;
}

export interface LogPattern {
  id: string;
  label: string;
  severity: Severity;
  regexes: RegExp[];
  commonCauses: string[];
  recommendedActions: PatternAction[];
}

export const LOG_PATTERNS: LogPattern[] = [
  {
    id: "oom_java",
    label: "Java heap exhaustion (OutOfMemoryError)",
    severity: "fatal",
    regexes: [/java\.lang\.outofmemoryerror/i, /\boutofmemoryerror\b/i, /java heap space/i],
    commonCauses: [
      "Heap (-Xmx) too small for the current workload",
      "Memory leak in the application or a plugin/mod",
      "Sudden workload spike (players, chunks, queue backlog)",
    ],
    recommendedActions: [
      { action: "startup_variable_change", description: "Increase the memory limit or JVM heap settings" },
      { action: "file_write", description: "Reduce memory-heavy configuration (view distance, plugins)" },
    ],
  },
  {
    id: "oom_system",
    label: "System OOM kill",
    severity: "fatal",
    regexes: [
      /\boom[- ]kill/i,
      /out of memory: killed process/i,
      /memory cgroup out of memory/i,
      /killed process \d+ \((?:java|node|python)/i,
    ],
    commonCauses: [
      "Container memory limit exceeded (not just the JVM heap)",
      "Coexisting processes consume more than the allocated memory",
      "Application memory leak",
    ],
    recommendedActions: [
      { action: "startup_variable_change", description: "Raise the server memory allocation" },
      { action: "file_write", description: "Reduce application memory footprint" },
    ],
  },
  {
    id: "segfault",
    label: "Segmentation fault / hard crash",
    severity: "fatal",
    regexes: [/segmentation fault/i, /\bsigsegv\b/i, /core dumped/i, /\bsigabrt\b/i],
    commonCauses: [
      "Native library crash (JVM native code, plugin natives)",
      "Incompatible native dependency after an update",
      "Corrupted binary or file",
    ],
    recommendedActions: [
      { action: "file_write", description: "Revert the most recent native/plugin/mod update" },
      { action: "restore_backup", description: "Restore a known-good state if a revert is not possible" },
    ],
  },
  {
    id: "process_exit",
    label: "Process exit with code",
    severity: "warn",
    regexes: [/exit(?:ed|ing)?\s+(?:with\s+)?(?:code|status)\s+\d+/i, /exited abnormally/i, /killed by signal/i],
    commonCauses: [
      "Application crash (non-zero exit code)",
      "External stop or kill (code 137/143)",
      "Startup failure that immediately terminates the process",
    ],
    recommendedActions: [
      { action: "startup_variable_change", description: "Review startup configuration for fatal mistakes" },
      { action: "file_write", description: "Revert recent configuration or dependency changes" },
    ],
  },
  {
    id: "port_bind",
    label: "Port binding failure",
    severity: "error",
    regexes: [
      /address already in use/i,
      /\beaddrinuse\b/i,
      /failed to bind|bind(?:ing)? failed|can'?t bind/i,
      /port .* (?:already in use|in use)/i,
    ],
    commonCauses: [
      "Another process (or a stale instance) already listens on the port",
      "Allocation mismatch between Pterodactyl and the application config",
      "Previous shutdown did not release the port",
    ],
    recommendedActions: [
      { action: "send_command", description: "Inspect listening ports inside the server" },
      { action: "restart_server", description: "Restart to release a stale port holder" },
    ],
  },
  {
    id: "db_conn",
    label: "Database connection failure",
    severity: "error",
    regexes: [
      /communications link failure/i,
      /could not connect to (?:database|mysql|postgres|mariadb)/i,
      /\bsqlstate\b/i,
      /connection refused.*(?:3306|5432|27017)/i,
      /(?:mysql|postgres|mongo).* (?:connection|connect) (?:refused|failed|timed out)/i,
      /jdbc.*(?:exception|refused|timeout)/i,
    ],
    commonCauses: [
      "Database server down or unreachable",
      "Wrong credentials or connection string",
      "Database connection limit reached",
    ],
    recommendedActions: [
      { action: "file_write", description: "Correct the database connection configuration" },
      { action: "network_probe", description: "Verify database reachability from the node" },
    ],
  },
  {
    id: "auth_fail",
    label: "Authentication failure",
    severity: "error",
    regexes: [
      /authentication failed/i,
      /invalid (?:credentials|password|token|username)/i,
      /wrong password/i,
      /unauthorized/i,
    ],
    commonCauses: [
      "Changed or rotated credentials not updated in all places",
      "Environment variable (password/token) missing or empty",
      "Account locked or permissions changed",
    ],
    recommendedActions: [
      { action: "file_write", description: "Update stored credentials or tokens consistently" },
    ],
  },
  {
    id: "permission",
    label: "Permission denied",
    severity: "error",
    regexes: [/permission denied/i, /\beacces\b/i, /operation not permitted/i, /access is denied/i],
    commonCauses: [
      "File ownership or permissions changed (often by an upload)",
      "Policy/allowlist prevents access to the path",
      "Feature not enabled in the application configuration",
    ],
    recommendedActions: [
      { action: "send_command", description: "Inspect file permissions for the affected path" },
    ],
  },
  {
    id: "disk_full",
    label: "Disk full / quota exceeded",
    severity: "fatal",
    regexes: [/no space left on device/i, /\benospc\b/i, /disk (?:is )?full/i, /quota exceeded/i],
    commonCauses: [
      "Log, world or backup growth exceeded the disk allocation",
      "Runaway file writes (crash dumps, debug logs)",
      "Expected backups retained without rotation",
    ],
    recommendedActions: [
      { action: "clear_cache", description: "Remove unnecessary logs/caches within approved paths" },
      { action: "create_backup", description: "Capture a backup before cleanup" },
    ],
  },
  {
    id: "rate_limit",
    label: "Rate limited",
    severity: "warn",
    regexes: [/rate limit/i, /too many requests/i, /\b429\b.*(?:too many|rate)/i, /throttl/i],
    commonCauses: [
      "External API quota exceeded",
      "Retry storm from a misconfigured client",
    ],
    recommendedActions: [
      { action: "file_write", description: "Reduce request frequency or add backoff" },
    ],
  },
  {
    id: "module_missing",
    label: "Missing module/class/plugin",
    severity: "error",
    regexes: [
      /cannot find module/i,
      /modulenotfounderror/i,
      /no module named/i,
      /classnotfoundexception/i,
      /noclassdeffounderror/i,
      /unable to load (?:module|plugin|class)/i,
      /unknown (?:plugin|module)/i,
    ],
    commonCauses: [
      "Dependency not installed or removed",
      "Plugin/mod incompatible with the current runtime version",
      "Typo in configuration module path",
    ],
    recommendedActions: [
      { action: "dependency_update", description: "Install or fix the missing dependency" },
      { action: "file_write", description: "Correct the module reference in configuration" },
    ],
  },
  {
    id: "config_invalid",
    label: "Invalid configuration",
    severity: "error",
    regexes: [
      /invalid (?:config|configuration|setting)/i,
      /failed to (?:load|parse|read) (?:the )?config/i,
      /yaml(?:error|exception)/i,
      /json\.decode(?:error)?/i,
      /\btoml(?:error)?\b/i,
      /unrecognized (?:option|property)/i,
      /missing (?:required )?(?:property|option|setting)/i,
    ],
    commonCauses: [
      "Recent manual edit introduced a syntax error",
      "Configuration schema changed after an update",
      "Wrong indentation or encoding",
    ],
    recommendedActions: [
      { action: "file_write", description: "Fix or revert the invalid configuration file" },
    ],
  },
  {
    id: "conn_fail",
    label: "Connection failure",
    severity: "error",
    regexes: [
      /\beconnrefused\b/i,
      /\beconnreset\b/i,
      /\betimedout\b/i,
      /\behostunreach\b/i,
      /\benetunreach\b/i,
      /connection (?:refused|reset|timed out|closed)/i,
      /broken pipe/i,
    ],
    commonCauses: [
      "Dependent service is down or restarting",
      "Network path or proxy misconfiguration",
      "Firewall or allocation rules blocking traffic",
    ],
    recommendedActions: [
      { action: "network_probe", description: "Check reachability of the dependent service" },
      { action: "file_write", description: "Correct host/port configuration" },
    ],
  },
  {
    id: "tls",
    label: "TLS/certificate failure",
    severity: "error",
    regexes: [
      /certificate (?:expired|verify failed|has expired)/i,
      /self[- ]signed certificate/i,
      /ssl(?:error| handshake)/i,
      /handshake failure/i,
    ],
    commonCauses: [
      "Expired or mismatched certificate",
      "Self-signed certificate not trusted",
      "Clock skew on the host",
    ],
    recommendedActions: [
      { action: "file_write", description: "Install a valid certificate or update trust settings" },
    ],
  },
  {
    id: "dependency_incompat",
    label: "Dependency/runtime incompatibility",
    severity: "error",
    regexes: [
      /incompatible (?:mod|plugin|version|dependency)/i,
      /(?:mod|plugin) .{0,80} requires/i,
      /requires (?:minecraft|forge|fabric|neoforge|java|node) (?:version )?[<>=~^]/i,
      /unsupported (?:java|node|python) version/i,
    ],
    commonCauses: [
      "Component updated without matching runtime/dependency update",
      "Wrong variant of a mod/plugin installed",
      "Runtime version changed after an update",
    ],
    recommendedActions: [
      { action: "dependency_update", description: "Align dependency and runtime versions" },
      { action: "restore_backup", description: "Restore the previous working dependency set" },
    ],
  },
];

export function matchPatterns(text: string): LogPattern[] {
  const hits: LogPattern[] = [];
  for (const pattern of LOG_PATTERNS) {
    for (const regex of pattern.regexes) {
      if (regex.test(text)) {
        hits.push(pattern);
        break;
      }
    }
  }
  return hits;
}

export function patternById(id: string): LogPattern | null {
  return LOG_PATTERNS.find((pattern) => pattern.id === id) ?? null;
}
