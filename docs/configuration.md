# Configuration Reference

PteroOps reads configuration from (in order of precedence):

1. CLI flags (`--config <path>`, `--transport stdio|http`)
2. Environment variables (see table below)
3. Config file: `pteroops.config.yaml` / `.yml` / `.json` (or `PTEROOPS_CONFIG` path)
4. Built-in defaults

Config file values may reference environment variables with `${VAR}` (expanded at load time;
missing variables are an error, never silently empty).

## Minimal configuration

```yaml
panels:
  production:
    url: https://panel.example.com
    clientKey: ${PTERO_PROD_CLIENT_KEY}
    applicationKey: ${PTERO_PROD_APP_KEY}
```

One key is enough. `clientKey` (`ptlc_*`) enables server/console/file/power/remediation tools;
`applicationKey` (`ptla_*`) enables panel administration tools (nodes, users, eggs, all servers).
Both together give the full surface. A tool the keys cannot support is not exposed.

## Full configuration example

```yaml
# pteroops.config.yaml
tenant: local                       # single-tenant default; see multi-tenant section

panels:
  production:
    url: https://panel.example.com
    clientKey: ${PTERO_PROD_CLIENT_KEY}
    applicationKey: ${PTERO_PROD_APP_KEY}
    timeoutMs: 15000                # per-request timeout
    maxRetries: 3                   # GET-only retries
  staging:
    url: https://staging.example.com
    clientKey: ${PTERO_STAGING_CLIENT_KEY}

defaultPanel: production

groups:                             # server groups for drift detection + canary remediation
  minecraft: ["production/*"]
  web: ["staging/*", "production/web-*"]

schedules:                          # proactive deterministic jobs (see below)
  - { name: nightly-audit, kind: dependency_audit, every: 24h, scope: ["*"] }
  - { name: disk-forecast, kind: anomaly_scan, every: 6h, scope: ["production/*"] }
  - { name: nightly-prune, kind: retention_prune, every: 24h, scope: ["*"] }
# kinds: health_scan | diagnose_scope | dependency_audit | backup_check | anomaly_scan | retention_prune

storage:
  driver: sqlite                    # sqlite | postgres
  dataDir: ./data                   # SQLite + snapshots live here (volume in Docker)
  # postgresUrl: postgres://user:pass@host:5432/pteroops
  # redisUrl: redis://127.0.0.1:6379   # distributed locks for scheduler/monitor (multi-instance)

retention:
  preset: default                   # default | compliance | custom
  auditDays: 0                      # 0 = keep forever
  changesDays: 0
  resolvedIncidentDays: 0

console:
  persist: true                     # store console lines
  retentionHours: 168               # 7 days
  maxEventsPerServer: 200000        # hard cap per server (oldest pruned)
  captureWarnAndAbove: false        # if true, only warn+ lines are stored
  backfillOnConnect: true           # store wings-provided history lines

monitoring:
  enabled: true
  intervalSeconds: 30               # polling cadence (avoid API spam)
  serverListCacheSeconds: 300
  concurrency: 4                    # parallel resource polls
  metricsRetentionHours: 72
  processEventsRetentionDays: 30

diagnostics:
  defaultWindowMinutes: 30
  maxEventsPerAnalysis: 5000
  bundleCacheSeconds: 60

remediation:
  healthTimeoutSeconds: 300         # how long to wait for health after a change
  healthPollSeconds: 10
  stabilizationSeconds: 60          # health must stay OK this long before commit
  requireFreshBackupMinutes: 0      # >0: auto-create a preflight backup for HIGH-risk plans
  maxActionsPerPlan: 10
  snapshotMaxBytes: 262144          # file snapshots are skipped above this size
  snapshotRetentionDays: 30

policy:
  protectedPaths: [".env", "*.pem", "*.key", "id_rsa*", "*.p12", "*.pfx"]
  blockedCommands: ["^rm -rf /", "^mkfs", "^dd if=", "^shutdown", "^reboot", "^:(){"]
  allowedCommands: []               # empty = allow all not blocked
  allowedServers: []                # empty = all configured servers; supports globs
  maxRestartsPerHour: 5
  maxFileSizeBytes: 2000000
  networkProbeAllowed: false        # opt in to TCP/HTTP reachability probes
  networkProbeTargets: []           # host:port entries; when set, probes use ONLY these

approval:
  autoApprove: [start_server, create_backup, restart_after_verified_crash]
  requireApproval: [file_write, dependency_update, git_deploy, git_rollback, restore_backup, kill_server, database_modification, startup_variable_change]
  deny: [delete_server, wipe_filesystem]
  defaultExpiryMinutes: 120

maintenanceWindows:
  - name: business-hours
    servers: ["production/*"]
    denyAutomation: ["09:00-18:00"]
  - name: nightly-automation
    servers: ["*"]
    allowAutoLowRisk: ["02:00-05:00"]

emergencyOverride: false            # when true, allows configured emergency bypasses (logged loudly)

git:
  enabled: false                    # reserved; git tools work without it
  repositories: {}                  # optional server → path mapping
  tokens:                           # enables commit history/compare over the provider API
    github: ${GITHUB_TOKEN}
    # gitlab: ${GITLAB_TOKEN}
  apiBase: {}                       # self-hosted GitLab: { gitlab: https://gitlab.example.com }

http:
  enabled: false                    # also enabled by --transport http
  host: 127.0.0.1
  port: 8080
  authToken: ${PTEROOPS_HTTP_TOKEN} # required for non-loopback binding
  exposeMetrics: true               # /metrics endpoint

log:
  level: info                       # debug | info | warn | error
  pretty: false                     # human-readable logs (dev only)

redaction:
  extraPatterns: []                 # additional regexes to redact
  extraSecrets: []                  # additional literal values to redact
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PTEROOPS_CONFIG` | Path to config file |
| `PTERO_PANELS_JSON` | Full panels map as JSON (alternative to file config) |
| `PTERO_PANEL_<NAME>_URL` | Panel URL (env bootstrap; `<NAME>` uppercased, non-alphanumeric → `_`) |
| `PTERO_PANEL_<NAME>_CLIENT_KEY` | Client API key for `<NAME>` |
| `PTERO_PANEL_<NAME>_APPLICATION_KEY` | Application API key for `<NAME>` |
| `PTERO_DEFAULT_PANEL` | Default panel name |
| `PTERO_TENANT` | Tenant id (default `local`) |
| `PTERO_DATA_DIR` | Data directory (default `./data`) |
| `PTERO_LOG_LEVEL` | Log level |
| `PTERO_LOG_PRETTY` | `1` for pretty logs |
| `PTERO_HTTP_ENABLED` / `PTERO_HTTP_HOST` / `PTERO_HTTP_PORT` | HTTP transport |
| `PTERO_HTTP_TOKEN` | Bearer token required on HTTP transport (non-loopback) |
| `PTERO_MONITORING_ENABLED` / `PTERO_MONITORING_INTERVAL` | Monitoring loop |
| `PTERO_CONSOLE_RETENTION_HOURS` / `PTERO_CONSOLE_PERSIST` | Console retention |
| `PTERO_DATABASE_DRIVER` / `PTERO_DATABASE_URL` | PostgreSQL storage (`postgres` + connection URL) |
| `PTERO_REDIS_URL` | Redis URL for distributed scheduler/monitor locks |
| `PTERO_GIT_GITHUB_TOKEN` / `PTERO_GIT_GITLAB_TOKEN` | Provider tokens for commit history |
| `PTERO_GIT_GITHUB_API_BASE` / `PTERO_GIT_GITLAB_API_BASE` | Provider API base overrides |
| `PTERO_EMERGENCY_OVERRIDE` | `1` to allow configured emergency bypasses |

Example env-only bootstrap:

```bash
export PTERO_PANEL_PROD_URL=https://panel.example.com
export PTERO_PANEL_PROD_CLIENT_KEY=ptlc_xxxxxxxx
export PTERO_PANEL_PROD_APPLICATION_KEY=ptla_xxxxxxxx
```

## Scheduled jobs (`schedules`)

PteroOps-internal deterministic jobs, independent of Pterodactyl cron schedules. Each entry:

```yaml
schedules:
  - name: nightly-audit         # unique name (id is derived from it)
    kind: dependency_audit      # see kinds below
    every: 24h                  # 30m, 6h, 1d, 1w … (bare numbers are minutes)
    scope: ["*"]                # glob patterns over "panel/serverId", "tenant/panel/serverId" or "serverId"
    enabled: true
```

| Kind | What it does | Incidents opened |
| --- | --- | --- |
| `health_scan` | Health assessment of every server in scope | unhealthy / crash_loop (fingerprint-deduplicated) |
| `diagnose_scope` | Full diagnosis for unhealthy servers only | via the diagnostic engine |
| `dependency_audit` | Dependency analysis per server | error-level issues (e.g. duplicate plugins/mods) |
| `backup_check` | Backup coverage and age | "no usable backup exists" |
| `anomaly_scan` | Baselines update + disk forecast | anomalies ≥1.8× baseline; disk exhaustion <3 days |
| `retention_prune` | Console/metrics/process-events/snapshot pruning | — |

Run one immediately with the `ptero_run_scheduler_job` tool; inspect results with
`ptero_list_scheduler_jobs`.

## Groups (`groups`)

Named sets of servers matched by glob patterns. Used by:

- `ptero_compare_server_group` (configuration drift detection)
- `ptero_canary_remediate` (canary-then-propose for the rest of the group)

```yaml
groups:
  minecraft: ["production/survival", "production/creative", "staging/mc-*"]
```

## Remediation settings (`remediation`)

| Key | Default | Meaning |
| --- | --- | --- |
| `healthTimeoutSeconds` | 300 | Total time to wait for `healthy` after a change |
| `healthPollSeconds` | 10 | Poll interval during verification |
| `stabilizationSeconds` | 60 | Health must stay healthy/degraded this long before commit |
| `requireFreshBackupMinutes` | 0 | `>0`: HIGH/CRITICAL plans auto-create a backup if none is newer |
| `maxActionsPerPlan` | 10 | Safety cap on plan size |
| `snapshotMaxBytes` | 262144 | Files larger than this are not content-snapshotted (rollback refuses honestly) |
| `snapshotRetentionDays` | 30 | Snapshot pruning age |

## Network probing

Reachability checks are **off by default** (`policy.networkProbeAllowed: false`). When enabled,
PteroOps only probes:

1. the server's own allocation addresses (never `0.0.0.0`/loopback), or
2. exactly the `policy.networkProbeTargets` entries (`host:port`) when configured.

It never scans arbitrary hosts from tool input.

## Multi-tenant configuration

```yaml
tenants:
  acme:
    panels: [production, staging]
  globex:
    panels: [globex-main]
panels:
  production: { url: ..., clientKey: ${ACME_PROD_KEY} }
  staging:    { url: ..., clientKey: ${ACME_STAGING_KEY} }
  globex-main: { url: ..., clientKey: ${GLOBEX_KEY} }
```

Every record is stored with its tenant; repositories enforce isolation.

## Storage backends

| Driver | When | Notes |
| --- | --- | --- |
| `sqlite` (default) | Single instance, laptop, small hosts | Zero setup; single-writer; files live in `dataDir` |
| `postgres` | Multi-instance or hosted deployments | Set `storage.driver: postgres` + `storage.postgresUrl` (or `PTERO_DATABASE_URL`); migrations run automatically and are dialect-specific |
| `redisUrl` | Multi-instance | Optional; scheduler and monitor take distributed locks so only one instance runs each job/tick. Without it, locks are in-process only. |

```yaml
storage:
  driver: postgres
  postgresUrl: postgres://pteroops:secret@db.internal:5432/pteroops
  redisUrl: redis://cache.internal:6379
```

Multi-instance checklist: PostgreSQL driver + Redis URL + at least one HTTP instance with
`PTERO_HTTP_TOKEN`. Every instance runs the same config; locks prevent duplicate monitoring and
scheduled jobs.

## Retention presets

| Preset | Behavior |
| --- | --- |
| `default` | Console (7d), metric samples (72h) and process events (30d) are pruned; incidents, changes and audit are kept forever |
| `compliance` | Nothing security-relevant is pruned: audit/changes/resolved-incident retention is forced to "forever" regardless of the day values |
| `custom` | Uses your `auditDays` / `changesDays` / `resolvedIncidentDays` values (0 = forever); pruning runs in the `retention_prune` scheduled job |

Compliance export lives in the `ptero_export_audit` tool (JSON or CSV, bounded, redacted).

## Git provider tokens

Commit history and revision comparison use the GitHub/GitLab APIs. Configure tokens when the
server consoles cannot run shell commands:

```yaml
git:
  tokens:
    github: ${GITHUB_TOKEN}          # fine-grained read-only token is enough
    gitlab: ${GITLAB_TOKEN}
  apiBase: {}                        # self-hosted GitLab only
```

Tokens are redacted from all outputs; a repository remote with embedded credentials is returned
without the userinfo part.

## Secrets handling

- Prefer `${ENV}` references or env bootstrap; never commit real keys.
- All configured key values are registered with the redaction engine at startup, so they
  cannot leak accidentally through logs, errors, MCP responses, audit records or incidents.
- The HTTP transport requires `authToken` when bound to a non-loopback interface.
- Git remote URLs are returned with credentials stripped.

## Validation

Config is validated with zod at load. Common errors:

| Symptom | Cause |
| --- | --- |
| `ConfigError: panels.production.url must be a valid URL` | missing scheme |
| `ConfigError: at least one of clientKey/applicationKey required` | panel without keys |
| `ConfigError: environment variable PTERO_X is not set` | `${PTERO_X}` referenced but unset |
| `defaultPanel does not match any configured panel` | typo in panel name |
| `http.authToken is required when the HTTP transport binds to a non-loopback address` | bind 0.0.0.0 without token |
| `ConfigError: Invalid duration` for `every` | schedule interval without a unit (use `30m`, `6h`, `1d`) |
