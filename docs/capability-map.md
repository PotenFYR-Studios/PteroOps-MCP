# Capability Map

Every capability from the product comparison matrix, mapped to the PteroOps implementation.
Status is the same three-valued scheme used in [`docs/status.md`](status.md):
**IMPLEMENTED** · **PARTIAL** (works with a documented caveat) · **PLANNED**.

## Baseline Pterodactyl operations

| Capability | Status | Delivered by | Notes |
| --- | --- | --- | --- |
| Server discovery | IMPLEMENTED | `ptero_list_servers`, `ptero://servers` | Multi-panel, identity is `tenant/panel/serverId` |
| Server status | IMPLEMENTED | `ptero_get_server`, `ptero_get_health`, `ptero_get_resources` via get_metrics | Health is application-aware, not just `state == running` |
| CPU / RAM / disk | IMPLEMENTED | `ptero_get_metrics` | Live sample + stored history + stats + disk-growth estimate |
| Start / stop / restart / kill | IMPLEMENTED | `ptero_power_action` | Crash-loop guard, restart budget, HIGH-risk confirmation |
| Console (live) | IMPLEMENTED | WebSocket streamer + `ptero_console_watch` | Auto-reconnect, token refresh, bounded live capture |
| Persistent console | IMPLEMENTED | `ptero_console_query`, console retention | Classified, fingerprinted, pruned per policy |
| Console search | IMPLEMENTED | `ptero_console_query` (text/regex/severity/fingerprint, first/before modes) | "Show errors from the last 20 minutes", "what happened before the crash" |
| Files | IMPLEMENTED | `ptero_list_files`, `ptero_read_file`, `ptero_search_files` | Path-confined, size-capped, redacted |
| File editing | IMPLEMENTED | `ptero_write_patch`, `ptero_validate_config`, snapshots | Hash-guarded diff-first writes, stale-write refusal, verified re-read, rollback snapshot |
| Backups | IMPLEMENTED | `ptero_list_backups`, `ptero_create_backup`, `ptero_backup_status` | Coverage intelligence incl. stale/failing/suspicious warnings |
| Databases | IMPLEMENTED | `ptero_list_databases`, `ptero_manage_database` | Passwords never returned |
| Schedules | IMPLEMENTED | `ptero_list_schedules`, `ptero_manage_schedule` | Task commands pass the command policy |
| Allocations | IMPLEMENTED | `ptero_list_allocations`, `ptero_manage_allocation` | Assign / primary / notes / release |
| Subusers | IMPLEMENTED | `ptero_list_subusers`, `ptero_manage_subuser` | Invite / update / remove, audited |
| Admin API | IMPLEMENTED | `ptero_admin_list_nodes`, `ptero_admin_list_users`, `ptero_admin_list_nests` | Read-only by design; destructive admin ops are excluded |
| Authentication | IMPLEMENTED | `ptlc_*` / `ptla_*` capability registry | Tools unregister when keys cannot support them; secrets never printed |

## Foundations

| Capability | Status | Delivered by | Notes |
| --- | --- | --- | --- |
| Multi-tenant foundation | IMPLEMENTED | tenant-scoped repositories, `tenants` config, PostgreSQL driver, Redis locks | Isolation enforced below the MCP layer; per-tenant incidents, console, files, audit |
| Audit logs | IMPLEMENTED | append-only `audit_events`, `ptero_query_audit`, `ptero_export_audit`, compliance retention preset | Actor, tool, target, decision, approval, correlation id; CSV/JSON export; never scrubbed of audit truth, always redacted of secrets |
| Monitoring | IMPLEMENTED | monitor loop, scheduler, `/metrics`, `/ui` | Samples, transitions, proactive incidents, 6 scheduled job kinds, Prometheus + console |
| Intelligent log analysis | IMPLEMENTED | `ptero_analyze_logs` (16 pattern classes, stack traces, lifecycle) | Deterministic, bounded, positive+negative fixtures |
| Application detection | IMPLEMENTED | `ptero_detect_application` (+ profiles) | Multi-signal confidence/evidence; never fabricates versions |
| Dependency analysis | IMPLEMENTED | `ptero_analyze_dependencies` | Node, Python, JVM (Maven/Gradle/catalogs), Go, Rust, Composer, Bundler, NuGet, MC plugins/mods |
| Crash-loop diagnosis | IMPLEMENTED | crash-loop detector/tracker, `ptero_get_health`, `ptero_diagnose` | Windowed, persistent, evidence-backed; restart guard |
| AI code debugging | IMPLEMENTED | `ptero_debug_context`, `ptero_search_files`, `ptero_validate_config`, `ptero_diagnose.codeContext` | Stack frames → server files → bounded numbered snippets + config validation + symbol matching, all evidence-based |
| Automated testing | IMPLEMENTED | `ptero_run_tests` (pre/post/smoke), TestEngine inside remediation transactions | Crash state, detection, health, error rate, ready markers, config syntax |
| Automatic rollback | IMPLEMENTED | remediation executor | Verification/stabilization failure → automatic rollback; incomplete rollbacks reported honestly |
| Git integration | PARTIAL | `ptero_git_status`, `ptero_git_history`, `ptero_git_deploy`, `ptero_git_rollback`, known-good revisions | Provider API (GitHub/GitLab) for history/compare; dirty-state still needs a shell-capable console stream (`dirty: null` + note otherwise) |
| Network diagnosis | IMPLEMENTED | `ptero_network_diagnose` | Allocation/port/config checks; probes opt-in and scoped to allocations or configured targets |
| Application health checks | IMPLEMENTED | health engine + `ptero_get_health`, `ptero_run_health_check` | Ready markers from profiles, restart frequency, error rate, pressure checks with explanations |
| Cross-server reasoning | IMPLEMENTED | `ptero_investigate_incident`, `IncidentCorrelationEngine` | Temporal clustering × topology; one parent incident; no per-server thrash |
| Infrastructure topology | IMPLEMENTED | `ptero_get_topology`, `/ui/topology` | Panels/nodes/servers/allocations/databases/apps/repos + relations, focus/depth queries |
| Persistent incidents | IMPLEMENTED | incident service + `ptero_list_incidents`, `ptero_get_incident`, `ptero_update_incident` | Fingerprint dedup, state machine, evidence rows, relationships, notes; survive restarts |
| AI change history | IMPLEMENTED | change ledger + `ptero_get_change_history`, `/ui/changes`, `ptero_compare_known_good` | Before/after hashes, actors, incident links, git deploys, "what changed before this started" |
| Self-healing | IMPLEMENTED | planner + executor + rollback + policy/approvals | LOW may auto-approve; MEDIUM+ needs approval; CRITICAL never automated |
| Proactive monitoring | IMPLEMENTED | monitor + scheduler (`health_scan`, `diagnose_scope`, `anomaly_scan`, `backup_check`, `dependency_audit`, `retention_prune`) | Deterministic first; incidents only when warranted |
| Scheduled AI diagnostics | IMPLEMENTED | scheduler + `ptero_list_scheduler_jobs`, `ptero_run_scheduler_job` | Deterministic analyzers on schedule; the LLM is the caller when it wants more |
| AI remediation | IMPLEMENTED | `ptero_propose_remediation`, `ptero_execute_remediation`, `ptero_rollback_remediation`, `ptero_simulate_remediation`, `ptero_canary_remediate` | Dry-run, blast radius, effectiveness stats, transactional execution |
| Approval workflow | IMPLEMENTED | approvals service + `ptero_approve_action` | proposed → approved/rejected/expired/executed, deny-wins, expiry, full audit |
| Application-aware troubleshooting | IMPLEMENTED | profiles + diagnosis + tests + debug context | Paper/Node/Python/etc. fatal signatures, ready markers, config locations, diagnostic commands |
| Multi-server incident investigation | IMPLEMENTED | `ptero_investigate_incident` | Scope: server, node, panel, group; shared failure domains detected before any action |

## Beyond the matrix (PteroOps-specific)

| Capability | Delivered by |
| --- | --- |
| Cross-server incident correlation | `ptero_investigate_incident` (parent/child incidents) |
| Configuration drift across groups | `ptero_compare_server_group` |
| Blast-radius analysis | `ptero_propose_remediation` (plan.blastRadius) |
| Remediation simulator | `ptero_simulate_remediation` |
| Canary remediation | `ptero_canary_remediate` |
| Remediation effectiveness statistics | `ptero_remediation_stats` |
| Known-good state diff | `ptero_compare_known_good` |
| Disk exhaustion forecasting | `ptero_get_metrics` + `anomaly_scan` job |
| Baseline anomaly hints | `ptero_get_metrics` + `anomaly_scan` job |
| Read-only web console | `GET /ui` |
| Compliance audit export | `ptero_export_audit` |
| Demo transcript generator | `npm run demo` |

## Not built (and why)

| Capability | Reason |
| --- | --- |
| Destructive admin verbs (delete server, wipe filesystem) | Deliberately excluded: CRITICAL risk, no safe automation path in an AI surface |
| Hosted multi-tenant control plane | Infrastructure parts are ready (tenant scoping, PostgreSQL, Redis locks); the hosted product itself is out of this repository's scope |
| Kafka / Kubernetes orchestration | The project's scope discipline: not justified for a single-service MCP server; deployment manifests are provided instead |
| Black-box ML models | Deterministic, explainable analysis only; confidence is always evidence-derived |
