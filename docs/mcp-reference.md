# MCP Reference

Complete surface of the PteroOps MCP server: **63 tools, 14 resources, 8 prompts**.
Live availability also depends on configured credentials, call `ptero_get_capabilities` first.
A tool whose required capability is missing from every panel is **not registered**.

Legend: **RO** read-only · **MUT** mutates state · Risk = default classification ·
`server` = `"panel/serverId"` or `"serverId"` (default panel). Mutating tools are audited and
recorded in the change ledger. All responses pass the redaction engine.

---

## Discovery, capabilities & policy

| Tool | Mode | Purpose |
| --- | --- | --- |
| `ptero_get_capabilities` | RO | Panels, key modes, capabilities, registered tools, policy summary. **Call first.** |
| `ptero_list_servers` | RO | Inventory across panels with cached application detection. |
| `ptero_get_server` | RO | Limits, allocations, owner, docker/startup basics. |
| `ptero_get_startup` | RO | Startup command, docker image, variables (secret-looking values redacted). |
| `ptero_get_metrics` | RO | Live sample + stored history + stats (avg/max, disk-growth estimate). |
| `ptero_get_health` | RO | `healthy/degraded/unhealthy/crash_loop/starting/unknown` with per-check evidence. |
| `ptero_run_health_check` | RO | Fresh assessment bypassing caches. |
| `ptero_get_risk` | RO | Classifies a proposed action (LOW–CRITICAL), explains why, approval state. |
| `ptero_get_policy` | RO | Effective policy: allowed servers, protected paths, command patterns, budgets, windows. |

## Runtime mutations

| Tool | Mode | Risk | Purpose |
| --- | --- | --- | --- |
| `ptero_power_action` | MUT | LOW–HIGH | start/stop/restart/kill. Crash-loop guard refuses restart unless `force=true` + reason; HIGH needs `confirm=true`; restart budget enforced. |
| `ptero_send_command` | MUT | MEDIUM | One console command, policy-checked, audited, ledger-recorded. |
| `ptero_set_startup_variable` | MUT | MEDIUM | Change a startup variable (memory/JVM flags/jar) with previous value recorded; restart noted. |

## Console & logs

| Tool | Mode | Purpose |
| --- | --- | --- |
| `ptero_console_query` | RO | Persistent console search: windows, severities, text/regex, fingerprint; modes `latest`, `first`, `before` ("what happened before the crash"), `events`. |
| `ptero_console_watch` | RO | Bounded live capture (5–120 s) when history is empty. |
| `ptero_analyze_logs` | RO | Fingerprinted issues, grouped stack traces, 16 pattern classes, lifecycle events, bounded summary. |

## Files

| Tool | Mode | Risk | Purpose |
| --- | --- | --- | --- |
| `ptero_list_files` | RO | — | Path-confined directory listing. |
| `ptero_read_file` | RO | — | Size-capped read with protected-path policy, secret redaction and a SHA-256 `hash` for write_patch. |
| `ptero_write_patch` | MUT | MEDIUM | Hash-guarded diff-first editing: structured find/replace or full content, snapshot for rollback, re-read verification. `dryRun` previews. Refuses stale writes. |

## Application & dependencies

| Tool | Mode | Purpose |
| --- | --- | --- |
| `ptero_detect_application` | RO | runtime/application/distribution/version with confidence + evidence + profile (ready markers, fatal signatures, rollback targets). |
| `ptero_analyze_dependencies` | RO | Manifests + plugin/mod listings → components and evidence-backed issues. |
| `ptero_debug_context` | RO | AI code debugging: stack frames → server files → bounded numbered snippets, config validation, symbol-to-plugin matching, hints; unresolved frames report what was searched. |
| `ptero_search_files` | RO | Bounded text/regex search across profile config locations and manifests with line numbers; jars/binaries skipped and reported. |
| `ptero_validate_config` | RO | Syntax validation for properties/JSON/YAML/dotenv with per-line issues (duplicate keys, parse errors). |

## Diagnosis & incidents

| Tool | Mode | Purpose |
| --- | --- | --- |
| `ptero_diagnose` | RO | Deterministic pipeline → observed facts, probable causes with confidence, recommendations with risk, missing evidence, incident. Run before any remediation. |
| `ptero_list_incidents` / `ptero_get_incident` | RO | Filtered list; full incident with evidence rows + correlated changes. |
| `ptero_update_incident` | MUT (low) | State transitions (state machine enforced) and notes. Never touches servers. |
| `ptero_get_change_history` | RO | Change ledger: per server, around a timestamp, or per incident, with before/after hashes. |
| `ptero_query_audit` | RO | Append-only audit trail (actor, tool, decision, approval, correlation id). |
| `ptero_export_audit` | RO | Compliance export of audit events (JSON or CSV, time-bounded, redacted). |

## Remediation, approvals & verification

| Tool | Mode | Risk | Purpose |
| --- | --- | --- | --- |
| `ptero_propose_remediation` | MUT (proposal only) | plan risk | Builds the plan: actions, risk, rollback strategy, blast radius, dry-run summary, historical effectiveness, expiry. Creates a pending approval for MEDIUM+. Executes nothing. Actions: `restart_server`, `file_edit`, `file_revert`, `startup_variable_change`, `restore_backup`. |
| `ptero_approve_action` | MUT (low) | — | approve/reject a pending proposal; deny-listed actions cannot be approved; expiry enforced. |
| `ptero_simulate_remediation` | RO | — | Pre-flight: patch freshness, port/allocation conflicts, policy blocks, restart implications. |
| `ptero_execute_remediation` | MUT | plan risk | The transaction: approval gate → baseline health → optional preflight backup → actions → restart → health wait + stabilization → post-change tests → success or **automatic rollback**. `dryRun` executes nothing. |
| `ptero_rollback_remediation` | MUT | HIGH | Executes the declared rollback (reverse patch / snapshot restore / startup variable restore); reports incomplete rollbacks honestly. |
| `ptero_canary_remediate` | MUT | plan risk | Applies the approved plan to one canary, verifies, then creates proposals for remaining group members. |
| `ptero_run_tests` | RO | — | Profile test suite: crash state, detection, health, error rate, ready markers. `pre`/`post`/`smoke`. |
| `ptero_remediation_stats` | RO | — | Explainable effectiveness history (attempts/success/rollback) + recent executions. |

## Backups, databases, schedules, network, users

| Tool | Mode | Risk | Purpose |
| --- | --- | --- | --- |
| `ptero_list_backups` | RO | — | Backups with size, age, lock, success. |
| `ptero_create_backup` | MUT | LOW | Creates a backup (pre-step for risky changes). |
| `ptero_backup_status` | RO | — | Coverage intelligence: newest usable age, failure streaks, suspicious sizes, warnings. |
| `ptero_list_databases` | RO | — | Databases (passwords redacted). |
| `ptero_manage_database` | MUT | MEDIUM–HIGH | create / rotate_password / delete. |
| `ptero_list_schedules` / `ptero_manage_schedule` | RO/MUT | MEDIUM | Pterodactyl cron schedules: list; create/toggle/execute/delete (commands policy-checked). |
| `ptero_list_allocations` | RO | — | Allocations with primary marked. |
| `ptero_manage_allocation` | MUT | MEDIUM | assign / primary / notes / release. |
| `ptero_list_subusers` / `ptero_manage_subuser` | RO/MUT | MEDIUM | Access list; invite/update/remove. |

## Infrastructure & Git

| Tool | Mode | Purpose |
| --- | --- | --- |
| `ptero_get_topology` | RO | Panels/nodes/servers/allocations/databases/apps/repos + relations; `focus`/`depth` neighborhoods; `rebuild` refreshes from panels. |
| `ptero_network_diagnose` | RO | Allocations, expected/primary port, server.properties match, console bind failures; TCP/HTTP probes only when `policy.networkProbeAllowed` and only against allocation addresses or configured targets. |
| `ptero_investigate_incident` | RO | Multi-server correlation: scope (server/node/panel/group), timelines, shared nodes/databases, one parent incident, least-destructive recommendation. |
| `ptero_compare_known_good` | RO | Diff current vs last known-good state (config hashes, startup vars, deps, git revision, health). `capture=true` forces a snapshot. |
| `ptero_compare_server_group` | RO | Config drift inside a configured group with unified diffs for outliers. |
| `ptero_git_status` | RO | Repo detection, branch, revision, remote (credentials stripped), dirty state + commits (console or GitHub/GitLab provider). |
| `ptero_git_history` | RO | Commit history via GitHub/GitLab API (when `git.tokens` are configured), deployment/rollback ledger entries, optional revision compare with files-changed summary. |
| `ptero_git_deploy` | MUT | Pull/deploy via the panel pull endpoint; ledger-recorded. |
| `ptero_git_rollback` | MUT (HIGH, `confirm`) | Hard reset to a revision after a dirty-state check; refuses uncommitted changes without `force=true`. |

## Scheduler & admin

| Tool | Mode | Purpose |
| --- | --- | --- |
| `ptero_list_scheduler_jobs` | RO | PteroOps-internal scheduled jobs (config `schedules`) with last/next run and result. |
| `ptero_run_scheduler_job` | MUT (low) | Runs one job now (health scan, dependency audit, backup check, anomaly scan, retention prune, diagnose scope). |
| `ptero_admin_list_nodes` / `ptero_admin_list_users` / `ptero_admin_list_nests` | RO | Application-API views (need `ptla_`): nodes with maintenance flag, users, nests + eggs. |

---

## Resources

| URI | Content |
| --- | --- |
| `ptero://capabilities` | Panels, capabilities, policy summary |
| `ptero://servers` | Cached inventory (state + last detection) |
| `ptero://incidents` | Open incidents |
| `ptero://changes` | Recent change ledger entries |
| `ptero://policies` | Effective policy |
| `ptero://server/{panel}/{serverId}/health` · `/application` · `/recent-errors` · `/dependencies` | Per-server compact JSON (also available with a bare `serverId` for the default panel) |
| `ptero://incident/{id}` | Full incident + evidence |

## Prompts

| Prompt | Guidance |
| --- | --- |
| `diagnose-server` | Evidence-first ladder; restart prohibited during investigation |
| `investigate-crash-loop` | First occurrence, fingerprints, change correlation, past incidents |
| `investigate-multi-server-incident` | Correlate before touching anything; failure-domain first |
| `safe-restart` | Preconditions, evidence capture, post-restart verification |
| `review-recent-changes` | Change-ledger correlation, correlation ≠ causation |
| `prepare-remediation` | Proposal with risk/rollback/blast radius, simulate, dry-run, approval |
| `verify-remediation` | Post-change verification; rollback decision instead of stacking changes |
| `analyze-performance-regression` | Metrics/baselines/comparison, no guessing |

## Error shape

```json
{
  "error": {
    "code": "POLICY_DENIED",
    "message": "The server appears to be in a crash loop (3 short exits recently). ...",
    "hint": "Run ptero_diagnose ...",
    "details": { "crashEvidence": ["..."] },
    "correlationId": "m3k2-9f0a1c2d3e4f"
  }
}
```

Codes: `CONFIG`, `AUTH`, `CAPABILITY_MISSING`, `NOT_FOUND`, `VALIDATION`, `POLICY_DENIED`,
`RISK_TOO_HIGH`, `STALE_WRITE`, `RATE_LIMITED`, `TIMEOUT`, `UPSTREAM`, `INTERNAL`.
Oversized results return a `VALIDATION` error instructing you to narrow the query.

## Server-level instructions

Advertised to clients: capability-check first, diagnose before restart, evidence before action,
mutations are audited/policy-checked, verify health after changes, keep queries bounded.
