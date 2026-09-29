# Monitoring & Observability

PteroOps exposes structured logs (stderr), Prometheus metrics, liveness/readiness probes and a
read-only web console. Everything below works in both stdio and HTTP modes; the HTTP endpoints
exist when `--transport http` is active.

## Endpoints (HTTP transport)

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness — process is up (no dependencies touched) |
| `GET /ready` | Readiness — database answers + at least one usable panel |
| `GET /metrics` | Prometheus text exposition (no secrets, no Pterodactyl data) |
| `GET /ui` | Read-only web console (overview, incidents, changes, topology, policies) |

All endpoints require `Authorization: Bearer <PTERO_HTTP_TOKEN>` whenever `authToken` is
configured. The web console additionally accepts `?token=...` once, sets an HttpOnly cookie, and
redirects to a clean URL.

## Metrics reference

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `pteroops_incidents_total` | counter | `severity` | Incidents opened (fingerprint dedup means repeats do not increment) |
| `pteroops_incidents_open` | gauge | `tenant` | Currently open incidents |
| `pteroops_remediations_total` | counter | `state` | Remediation transactions by state (`succeeded`, `rolled_back`, `failed`, …) |
| `pteroops_remediation_rollbacks_total` | counter | — | Rollbacks started (automatic or manual) |
| `pteroops_health_status` | gauge | `server`, `status` | 1 for the current health status of a server, 0 for the others |
| `pteroops_mcp_tool_requests_total` | counter | `tool` | MCP tool invocations |
| `pteroops_mcp_tool_failures_total` | counter | `tool`, `code` | Tool errors by structured error code |
| `pteroops_mcp_tool_duration_ms` | histogram | `tool` | Tool latency |
| `pteroops_pterodactyl_api_latency_ms` | histogram | `panel` | Pterodactyl API latency |
| `pteroops_pterodactyl_api_requests_total` | counter | `panel`, `method`, `status` | Panel API requests |
| `pteroops_pterodactyl_api_errors_total` | counter | `panel`, `status` | Panel API 4xx/5xx |
| `pteroops_pterodactyl_api_rate_limited_total` | counter | `panel` | 429s observed |
| `pteroops_pterodactyl_api_circuit_open_total` | counter | `panel` | Circuit breaker openings |
| `pteroops_console_events_ingested_total` | counter | — | Console lines accepted |
| `pteroops_console_events_stored_total` | counter | — | Console lines persisted |
| `pteroops_console_events_pruned_total` | counter | — | Console lines deleted by retention |
| `pteroops_console_stream_connected_total` | counter | `panel` | Console WS connections |
| `pteroops_console_stream_reconnects_total` | counter | `panel` | Console WS reconnects |
| `pteroops_metric_samples_stored_total` | counter | — | Resource samples stored |
| `pteroops_monitored_servers` | gauge | — | Servers in the monitor loop |
| `pteroops_monitor_tick_duration_ms` | histogram | — | Monitor tick duration |
| `pteroops_scheduler_jobs_total` | counter | `kind` | Scheduled jobs executed |

Names are prefixed `pteroops_` in Prometheus exposition; the in-code registry uses the bare names
(e.g. `mcp_tool_requests_total`).

## Prometheus scrape config

```yaml
scrape_configs:
  - job_name: pteroops
    scheme: http
    static_configs:
      - targets: ["127.0.0.1:8080"]
    authorization:
      credentials_file: /etc/prometheus/pteroops-token
```

## Alert examples

```yaml
groups:
  - name: pteroops
    rules:
      - alert: PteroOpsIncidentOpen
        expr: pteroops_incidents_open > 0
        for: 5m
        annotations:
          summary: "PteroOps has open incidents ({{ $value }})"
      - alert: PteroOpsCrashLoop
        expr: pteroops_health_status{status="crash_loop"} == 1
        for: 2m
        annotations:
          summary: "Server {{ $labels.server }} is crash-looping"
      - alert: PteroOpsToolFailures
        expr: increase(pteroops_mcp_tool_failures_total[15m]) > 10
        annotations:
          summary: "MCP tool failures are elevated for {{ $labels.tool }} ({{ $labels.code }})"
      - alert: PteroOpsPanelRateLimited
        expr: increase(pteroops_pterodactyl_api_rate_limited_total[15m]) > 5
        annotations:
          summary: "Panel {{ $labels.panel }} is rate limiting PteroOps"
      - alert: PteroOpsRemediationRollbacks
        expr: increase(pteroops_remediation_rollbacks_total[1h]) > 0
        annotations:
          summary: "A remediation rolled back — review the incident"
      - alert: PteroOpsMonitorStalled
        expr: pteroops_monitored_servers == 0
        for: 10m
        annotations:
          summary: "The monitor loop sees no servers"
```

## Structured logs

Logs are JSON lines on **stderr** (stdout stays protocol-clean for stdio MCP). Every record has
`ts`, `level`, `msg` plus bindings such as `panel`, `server`, `component`, `incidentId`,
`correlationId` (from MCP tool calls) and `tool`. All strings pass the redaction engine before
being written.

```json
{"ts":"2026-09-28T21:16:03.054Z","level":"info","msg":"change recorded","changeId":"...","panel":"production","server":"survival","action":"file_write","actor":"mcp-client","result":"success"}
```

Correlation IDs are returned in structured MCP errors (`error.correlationId`) and stored in audit
rows, so a single grep follows an action from MCP call to audit record to change ledger entry.

## Web console

`GET /ui` (with the bearer token or `?token=` once) renders:

- **Overview** — fleet counts, per-server health with scores, open incidents, recent changes
  (auto-refreshes every 30 s)
- **Incidents** — list and per-incident pages with probable causes, evidence and notes
- **Changes** — the change ledger with before/after hashes
- **Topology** — nodes and relations from the infrastructure graph
- **Policies** — the effective policy document

It is strictly read-only: no tool calls, no mutations. All values are HTML-escaped.

## What to alert on first

1. `pteroops_incidents_open` — something needs a human.
2. `pteroops_health_status{status="crash_loop"}` — the flagship failure mode.
3. `pteroops_remediation_rollbacks_total` — a fix made things worse and was undone.
4. `pteroops_pterodactyl_api_rate_limited_total` — lower the monitoring interval.
