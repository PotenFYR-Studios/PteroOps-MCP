# Status

Living tracker: what is **IMPLEMENTED**, **PARTIAL** (with the exact caveat) or **PLANNED**.
Update it in the same change as the code, if this file and the code disagree, fix one immediately.

**Current milestone:** all phases delivered. **63 MCP tools, 14 resources, 8 prompts;
270 tests on SQLite (3 DB/Redis cases skipped without env) · 273/273 with PostgreSQL 16 + Redis 7;
lint/typecheck/build green; stdio + HTTP smoke-verified; web console; AI code debugging;
installers + release pipeline; org-styled documentation site.**

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| A | Foundation & Pterodactyl access | **DONE** |
| B | Console subsystem | **DONE** |
| C | Incidents, changes, audit | **DONE** |
| D | Detection, profiles, log & dependency intelligence | **DONE** |
| E | Health, crash-loop, diagnosis (vertical slice) | **DONE** |
| F | Remediation, approvals, policy, rollback | **DONE** |
| G | Git, network, topology, correlation | **DONE** |
| H | Baselines, forecasting, known-good, scheduler | **DONE** |
| I | Drift, blast radius, simulator, canary, effectiveness | **DONE** |

## Infrastructure

| Capability | Status | Notes |
| --- | --- | --- |
| SQLite persistence (`node:sqlite`) | **IMPLEMENTED** | default driver |
| PostgreSQL persistence (`pg`) | **IMPLEMENTED** | `storage.driver: postgres`; full suite passes against PG 16; CI service job |
| Redis distributed locks | **IMPLEMENTED** | `storage.redisUrl`; scheduler + monitor take cross-instance locks; CI service job |
| Read-only web console | **IMPLEMENTED** | `/ui` served by the HTTP transport; token via bearer/cookie/query; HTML-escaped; access-log-free |
| Audit export (JSON/CSV) | **IMPLEMENTED** | `ptero_export_audit`; retention presets incl. `compliance` (keep forever) |
| Prometheus metrics | **IMPLEMENTED** | incidents/remediations/health; see `docs/monitoring.md` |
| Deployment manifests | **IMPLEMENTED** | Dockerfile, docker-compose, `deploy/k8s.yaml`, `deploy/pteroops.service`, nginx/Caddy examples |
| Installers | **IMPLEMENTED** | `scripts/install.sh` / `scripts/install.ps1`: Node check, `source\|release\|npm` methods, PATH launcher, update, uninstall/purge, offline overrides |
| Release pipeline | **IMPLEMENTED** | `.github/workflows/release.yml`: gates → `npm pack` → GitHub release → optional npm publish |
| Docs site | **IMPLEMENTED** | `docs/site/` renders these docs; GitHub Pages workflow |

## Module highlights

| Module | Status | Notes |
| --- | --- | --- |
| Client API (servers, resources, startup, power, console, files, backups, databases, schedules, allocations, subusers, git pull) | **IMPLEMENTED** | mock-panel tested |
| Application API (servers, nodes, users, nests, eggs, locations) | **IMPLEMENTED** | admin tools exposed |
| WebSocket console streamer + manager | **IMPLEMENTED** | reconnect/backoff/token refresh |
| Console intelligence (classify, fingerprints, bounded query, retention) | **IMPLEMENTED** | |
| Log intelligence (16 pattern classes, stack traces, lifecycle) | **IMPLEMENTED** | positive + negative fixtures |
| Application detection | **IMPLEMENTED** | Minecraft, Node (+8 frameworks), Python, PHP, Ruby, Go, Rust, Java, dedicated game servers, docker-compose, generic container |
| Dependency analysis | **IMPLEMENTED** | Node, Python, JVM (Maven/Gradle + catalogs), Go, Rust, PHP, Ruby, .NET, Minecraft plugins/mods |
| Crash-loop detection + health engine | **IMPLEMENTED** | persistent via `process_events` |
| Diagnostic engine | **IMPLEMENTED** | facts/causes/confidence/missing evidence; code context from stack frames |
| AI code debugging | **IMPLEMENTED** | `ptero_debug_context`, `ptero_search_files`, `ptero_validate_config` |
| Incidents, change ledger, audit | **IMPLEMENTED** | metrics wired |
| Safe file editor + snapshots | **IMPLEMENTED** | hash-guarded, diff-first, verified |
| Approvals + transactional remediation + rollback + tests | **IMPLEMENTED** | dry-run, stabilization window, effectiveness stats |
| Blast radius / simulator / canary | **IMPLEMENTED** | |
| Topology + cross-server correlation | **IMPLEMENTED** | `ptero_investigate_incident` |
| Network diagnostics | **IMPLEMENTED** | probing opt-in, allocation-scoped |
| Git awareness | **PARTIAL** | files-based facts + provider API (GitHub/GitLab) history/compare + console-based dirty state when the egg exposes a shell |
| Baselines / forecasting / known-good | **IMPLEMENTED** | statistical, labeled estimates |
| Scheduler (health, diagnose, deps, backups, anomalies, retention) | **IMPLEMENTED** | distributed-lock safe |
| Drift / server groups / canary follow-ups | **IMPLEMENTED** | |
| MCP surface | **IMPLEMENTED** | 63 tools / 14 resources / 8 prompts |
| Transports + UI | **IMPLEMENTED** | stdio, HTTP, `/health`, `/ready`, `/metrics`, `/ui` |
| Tests | **IMPLEMENTED** | 270 (SQLite; 3 skipped without DB env) / 273 (PostgreSQL + Redis) incl. security, isolation, resolver, scheduler, UI |

## Honest limitations

| Limitation | Reality |
| --- | --- |
| Git dirty-state / commit log without provider tokens | Requires the server console to be a shell. Without an active console and without a GitHub/GitLab token, `dirty` is reported as `null` with a note instead of guessing. Commit *history* works over the provider API when `git.tokens` are configured. |
| Backup restore rollback | A backup restore cannot be automatically reversed; plans mark it as manual recovery and report incomplete rollback honestly. |
| Game-server detection | Heuristic (steamcmd/egg/image/console signals) with capped confidence (≤ 0.85); never fabricates versions. |
| Lifecycle metrics for MCP sessions | `mcp_http_sessions` gauge only; no request-level tracing beyond correlation IDs. |
| Hosted control plane | Architecture, tenant scoping, PostgreSQL and Redis (locks) are ready; no multi-tenant hosting UI/service exists. |
| Kafka / Kubernetes-based orchestration | Intentionally out of scope (deploy manifests exist; no orchestrator dependency). |
