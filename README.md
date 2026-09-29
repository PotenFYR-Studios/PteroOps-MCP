<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:8b5cf6,50:ec4899,100:f97316&height=220&section=header&text=PteroOps&fontSize=64&fontColor=ffffff&fontAlignY=34&desc=AI%20SRE%20%C2%B7%20Self-healing%20%C2%B7%20Pterodactyl&descSize=20&descAlignY=56&animation=twinkling" width="100%" alt="PteroOps banner"/>

[![CI](https://img.shields.io/github/actions/workflow/status/PotenFYR-Studios/PteroOps-MCP/ci.yml?branch=main&style=for-the-badge&logo=githubactions&label=CI&color=2ea043&labelColor=1c1e26)](https://github.com/PotenFYR-Studios/PteroOps-MCP/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-8b5cf6.svg?style=for-the-badge&labelColor=1c1e26)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-ec4899.svg?style=for-the-badge&logo=nodedotjs&logoColor=white&labelColor=1c1e26)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20HTTP-f97316.svg?style=for-the-badge&labelColor=1c1e26)](https://modelcontextprotocol.io)
[![PRs](https://img.shields.io/badge/PRs-welcome-2ea043.svg?style=for-the-badge&labelColor=1c1e26)](CONTRIBUTING.md)

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&pause=1200&color=8B5CF6&center=true&vCenter=true&width=900&lines=Diagnose+before+restart.+Evidence+before+action.;Crash+loops+%E2%86%92+root+cause+%E2%86%92+safe+fix+%E2%86%92+automatic+rollback.;63+tools+%C2%B7+persistent+incidents+%C2%B7+cross-server+reasoning;Your+Pterodactyl+panel%2C+operated+safely+by+AI.)](https://github.com/PotenFYR-Studios/PteroOps-MCP)

**PteroOps** turns Pterodactyl into an AI-operable SRE platform: persistent console intelligence, application detection, crash-loop and health diagnosis, incidents, change correlation, and policy-controlled remediation with rollback — exposed through the Model Context Protocol.

[Docs](docs/README.md) · [Getting Started](docs/getting-started.md) · [Installation](docs/installation.md) · [Capability Map](docs/capability-map.md) · [Issues](https://github.com/PotenFYR-Studios/PteroOps-MCP/issues)

</div>

---

## Install

Pick a method — every one below is supported, tested and documented in
[docs/installation.md](docs/installation.md).

| Method | Best for | One command |
| --- | --- | --- |
| **Installer (macOS/Linux)** | normal users, always current | `curl -fsSL https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.sh \| bash` |
| **Installer (Windows)** | normal users, always current | `irm https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.ps1 \| iex` |
| **npm / npx** | Node users, CI, version pinning | `npx -y pteroops-mcp@latest --help` or `npm install -g pteroops-mcp` |
| **Prebuilt release** | no build toolchain, offline-ish | `PTEROOPS_METHOD=release PTEROOPS_VERSION=0.1.0 bash scripts/install.sh` |
| **Build from source** | contributing, auditing | `git clone … && npm install && npm run build` |
| **Docker** | servers, homelabs | `docker run -d -v pteroops-data:/app/data … pteroops --transport http` |
| **Docker Compose** | with a compose-managed stack | `docker compose up -d` |
| **Kubernetes** | clusters | `kubectl apply -f deploy/k8s.yaml` |
| **systemd** | bare-metal servers | `deploy/pteroops.service` |
| **Offline / air-gapped** | no internet on the target | `PTEROOPS_SOURCE_DIR=… bash scripts/install.sh` |

> Commands that call `scripts/install.sh` assume you are inside a checkout. If you downloaded the
> script instead, drop the `scripts/` prefix — the file itself is named `install.sh`.

**Installer details:** it checks Node.js ≥ 22 (and can install it: `PTEROOPS_INSTALL_NODE=1` /
`-InstallNode`), installs with your choice of `--method source|release|npm`, drops a `pteroops`
launcher on your PATH, creates the data directory and prints the exact MCP config block.
Updating = re-running the same one-liner. Uninstalling keeps your data unless you purge:

```bash
bash scripts/install.sh --uninstall [--purge]
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.ps1))) -Uninstall [-Purge]
```

> Where things land: macOS/Linux `~/.pteroops/{app|runtime,data}` + `~/.local/bin/pteroops`;
> Windows `%LOCALAPPDATA%\PteroOps\{app|runtime,data}` + `…\bin\pteroops.cmd`. Manual installs
> and Docker are unchanged.

## Why PteroOps

Posting `GET /status` is table stakes. PteroOps is the layer that **actually understands** what
runs inside your servers:

- **Persistent console intelligence** — every line stored, classified and fingerprinted, so
  10,000 identical errors become one issue with a count, first/last occurrence and evidence.
- **Application awareness** — detects `paper 1.21.4`, `node/express`, `python`, Valheim, … from
  egg/docker/files/console with confidence + evidence, then applies a real profile
  (fatal signatures, ready markers, config locations, rollback targets).
- **Change correlation** — every mutation lands in a change ledger with before/after hashes.
  "What changed 4 minutes before the first error?" is one tool call.
- **Cross-server reasoning** — shared nodes, databases and proxies are checked *before* touching
  anything; correlated outages become one parent incident, not twelve alerts.
- **Transactional remediation** — plan → risk → approval → backup → apply → verify → stabilize →
  or **automatic rollback**. Success means the app is healthy, not that HTTP returned 200.
- **AI code debugging** — stack frames are mapped back to server files with bounded, numbered
  snippets; config files are syntax-validated; failing symbols are matched to shipped plugins.
- **Never gets ahead of you** — policy engine, approvals, dry-runs, maintenance windows,
  crash-loop restart guard, protected files, redacted secrets.

## Use it

PteroOps runs in two modes; both serve the same tools, the same incidents and the same audit
trail:

| Mode | Command | Used by |
| --- | --- | --- |
| **stdio** (default) | `pteroops --transport stdio` (or `npx -y pteroops-mcp`) | Claude Desktop, Claude Code, Cursor, VS Code — the client starts the process |
| **HTTP** (server) | `pteroops --transport http --config pteroops.config.yaml` | remote agents, n8n/automation, fleets — endpoints `/mcp`, `/ui`, `/health`, `/ready`, `/metrics` |

1. **Grab an API key.** Panel → avatar → **Account → API Credentials → Create API Key**
   (`ptlc_…`; add a `ptla_…` key for admin tools). Step-by-step:
   [docs/getting-started.md](docs/getting-started.md#step-1--get-your-pterodactyl-api-key).
2. **Point your AI app at it.** Claude Desktop (stdio):

```json
{
  "mcpServers": {
    "pteroops": {
      "command": "node",
      "args": ["~/.pteroops/app/dist/index.js"],
      "env": {
        "PTERO_PANEL_PROD_URL": "https://panel.example.com",
        "PTERO_PANEL_PROD_CLIENT_KEY": "ptlc_...",
        "PTERO_DEFAULT_PANEL": "prod"
      }
    }
  }
}
```

Zero-install alternative — the client runs it via npx (published builds):

```json
{ "mcpServers": { "pteroops": { "command": "npx", "args": ["-y", "pteroops-mcp"],
  "env": { "PTERO_PANEL_PROD_URL": "https://panel.example.com",
           "PTERO_PANEL_PROD_CLIENT_KEY": "ptlc_..." } } } }
```

Remote/server mode — Claude Code, Cursor, VS Code and custom agents can also speak Streamable
HTTP: `pteroops --transport http` behind TLS, then
`claude mcp add pteroops --transport http https://pteroops.example.com/mcp --header "Authorization: Bearer $PTERO_HTTP_TOKEN"`.
Reverse-proxy examples: [`deploy/nginx.conf.example`](deploy/nginx.conf.example),
[`deploy/Caddyfile.example`](deploy/Caddyfile.example). Full recipes:
[docs/integrations.md](docs/integrations.md).

> On Windows the installed path is `%LOCALAPPDATA%\PteroOps\app\dist\index.js` (the installer
> prints the exact block). Prefer a config file to env vars? Point `PTEROOPS_CONFIG=~/pteroops.yaml`
> at a [config file](docs/configuration.md) and drop the `env` block.

3. **Ask.**

> - "Use pteroops to check the health of all my servers and explain anything unhealthy. Do not restart anything."
> - "The creative server broke after last night's update — what changed and why?"
> - "Several servers went down at once. Investigate the shared cause before restarting anything."
> - "Propose a fix for the crash loop, show me the risk and rollback, then wait for my approval."

Watch instead of asking? The HTTP mode serves a read-only console at `http://127.0.0.1:8080/ui`
(append `?token=…` once), plus Prometheus metrics at `/metrics`.

## The whole loop, one story

> *"My Minecraft server keeps restarting. Find out why."*

`ptero_get_health` → **crash_loop**, 4 short exits, avg runtime 38s · `ptero_analyze_logs` →
`java.lang.OutOfMemoryError` ×4 with grouped stack trace · `ptero_detect_application` →
`paper 1.21.4` (0.94, with evidence) · `ptero_debug_context` → the failing class and the config
around it · `ptero_get_change_history` → `EssentialsX.jar` replaced 4 minutes before the first
OOM · `ptero_diagnose` → causes with confidence, recommendations with risk + rollback, incident
opened · you approve → `ptero_execute_remediation` → restart → health check → stabilization →
**succeeded**, or rollback if it got worse. Fully audited, fully reversible.

A real captured session is in
[docs/demo-transcript.md](docs/demo-transcript.md) — regenerate it yourself with `npm run demo`.

## Capability coverage

Everything in the classic comparison matrix is implemented — discovery, status, resources, power,
console, files, backups, databases, schedules, allocations, subusers, admin API, auth,
multi-tenancy, audit — plus the parts that make it an SRE layer:

| Build / Improve | What PteroOps ships |
| --- | --- |
| Application detection | Multi-signal detection + declarative profiles (Minecraft ×7, Node +8 frameworks, Python, PHP, Ruby, Go, Rust, game servers, compose, container) |
| Dependency analysis | Node, Python, JVM (Maven/Gradle/catalogs), Go, Rust, Composer, Bundler, NuGet, Minecraft plugins/mods |
| Crash-loop diagnosis | Windowed detector + restart guard + persistent process events |
| AI code debugging | `ptero_debug_context`, `ptero_search_files`, `ptero_validate_config` |
| Automated testing | Pre/post/smoke suites incl. config syntax, ready markers, health |
| Automatic rollback | Transactional executor with stabilization window and reverse operations |
| Git integration | Status, deploy, rollback, GitHub/GitLab commit history + revision compare |
| Network diagnosis | Allocations, port/config match, scoped reachability probes (opt-in) |
| Application health checks | Ready markers, restarts, error rate, memory/disk pressure with evidence |
| Intelligent log analysis | 16 pattern classes, stack traces, lifecycle, fingerprints, bounded output |
| Cross-server reasoning | `ptero_investigate_incident` with failure-domain detection |
| Infrastructure topology | Panels/nodes/servers/allocations/databases/apps/repos graph |
| Persistent incidents | Fingerprint dedup, evidence, relationships, state machine |
| AI change history | Change ledger with hashes + known-good diff |
| Self-healing | Policy + approvals + remediation transactions + rollback + effectiveness stats |
| Proactive monitoring | Monitor loop, 6 scheduled job kinds, anomaly + disk forecasts |
| Scheduled AI diagnostics | Deterministic analyzers on a schedule; the model gets the findings |
| AI remediation / approvals | Plan, simulate, dry-run, approve, execute, roll back — MEDIUM+ gated |
| Multi-server incident investigation | One call scoped to server/node/panel/group |

The full mapping (including the honest PARTIAL on Git dirty-state) lives in
[docs/capability-map.md](docs/capability-map.md).

## MCP surface

**63 tools · 14 resources · 8 prompts**, all capability-gated, annotated and audited:

| Group | Tools |
| --- | --- |
| Discovery & policy | `get_capabilities`, `list_servers`, `get_server`, `get_startup`, `get_metrics`, `get_health`, `run_health_check`, `get_risk`, `get_policy` |
| Console & logs | `console_query`, `console_watch`, `analyze_logs`, `send_command`, `power_action` |
| Files & code | `list_files`, `read_file`, `write_patch`, `search_files`, `validate_config`, `debug_context` |
| Application & deps | `detect_application`, `analyze_dependencies` |
| Diagnosis & incidents | `diagnose`, `list_incidents`, `get_incident`, `update_incident`, `get_change_history`, `query_audit`, `export_audit` |
| Remediation | `propose_remediation`, `approve_action`, `execute_remediation`, `rollback_remediation`, `simulate_remediation`, `canary_remediate`, `run_tests`, `remediation_stats` |
| Backups & server ops | `list_backups`, `create_backup`, `backup_status`, `list_databases`, `manage_database`, `list_schedules`, `manage_schedule`, `list_allocations`, `manage_allocation`, `list_subusers`, `manage_subuser`, `set_startup_variable` |
| Infra & Git | `get_topology`, `network_diagnose`, `investigate_incident`, `compare_known_good`, `compare_server_group`, `git_status`, `git_history`, `git_deploy`, `git_rollback` |
| Scheduler & admin | `list_scheduler_jobs`, `run_scheduler_job`, `admin_list_nodes`, `admin_list_users`, `admin_list_nests` |

Plus resources (`ptero://servers`, `ptero://server/{id}/health`, …) and prompts
(`diagnose-server`, `investigate-crash-loop`, `prepare-remediation`, …). Schemas, annotations and
when-NOT-to-use notes: [docs/mcp-reference.md](docs/mcp-reference.md).

## Configuration at a glance

```yaml
# pteroops.config.yaml  (or pure env vars — the installer's JSON block works too)
panels:
  production:
    url: https://panel.example.com
    clientKey: ${PTERO_PROD_CLIENT_KEY}       # ptlc_…
    applicationKey: ${PTERO_PROD_APP_KEY}     # ptla_… (admin tools)

defaultPanel: production
groups:                { minecraft: ["production/*"] }        # drift + canary
schedules:
  - { name: nightly-audit, kind: dependency_audit, every: 24h, scope: ["*"] }
policy:
  blockedCommands: ["^rm\\s+-rf\\s+/", "^mkfs"]
  networkProbeAllowed: false               # probes are opt-in and scoped
approval:
  requireApproval: [file_write, restore_backup, git_rollback]
storage:
  driver: sqlite                           # or postgres for multi-instance
  # redisUrl: redis://127.0.0.1:6379      # distributed locks
```

Every option and env var: [docs/configuration.md](docs/configuration.md).

## Security by default

- Tools whose capabilities the configured keys can't satisfy are **never registered**
  (`ptero_get_capabilities` proves it).
- Risk levels LOW→CRITICAL; MEDIUM+ needs approval; CRITICAL cannot be automated at all.
- File edits require the current hash (stale-write refusal), snapshot first, diff and re-verify.
- Crash-loop guard refuses blind restarts; restart budgets are enforced.
- Every secret-bearing string passes the redaction engine (logs, errors, MCP, audit, console,
  incidents) — covered by a dedicated test corpus.
- Multi-tenant isolation is enforced in repositories, not just handlers.

Threat model: [SECURITY.md](SECURITY.md).

## Deployment

**Docker** (single command):

```bash
docker run -d --name pteroops -v pteroops-data:/app/data \
  -e PTERO_PANEL_PROD_URL=https://panel.example.com \
  -e PTERO_PANEL_PROD_CLIENT_KEY=ptlc_... \
  -e PTERO_HTTP_TOKEN=$(openssl rand -hex 32) \
  -p 127.0.0.1:8080:8080 pteroops --transport http
# MCP: http://127.0.0.1:8080/mcp · console: /ui · metrics: /metrics
```

**Docker Compose:** `docker compose up -d` (edit the env defaults in `docker-compose.yml`).

**Kubernetes:** `kubectl apply -f deploy/k8s.yaml` — Deployment + PVC + Service + probes; create
the `pteroops-secrets` secret first (the manifest documents the command). For multi-instance
replicas switch storage to PostgreSQL and set a Redis URL for distributed locks.

**systemd:** copy `dist/` and `deploy/pteroops.service` to the server, create the `pteroops`
user, put your env in `/etc/pteroops/pteroops.env` and `systemctl enable --now pteroops`.

**Remote access:** run with `--transport http` behind TLS (`deploy/nginx.conf.example` or
`deploy/Caddyfile.example`); always set `PTERO_HTTP_TOKEN` off-loopback. Every deployment option
(plus upgrading, uninstalling and air-gapped installs) is covered in
[docs/installation.md](docs/installation.md).

## Documentation

Rendered site (GitHub Pages, built from the markdown below): **<https://potenfyr-studios.github.io/PteroOps-MCP/>** ·
local: `npm run docs:install && npm run docs:dev`.

| Document | For |
| --- | --- |
| [docs/README.md](docs/README.md) | Index of everything in `docs/` |
| [docs/getting-started.md](docs/getting-started.md) | Absolute beginners: keys, install, connect, first prompts, troubleshooting, FAQ |
| [docs/installation.md](docs/installation.md) | Installer flags, manual install, Docker, update, uninstall, offline installs |
| [docs/capability-map.md](docs/capability-map.md) | Every capability → the tools that deliver it |
| [docs/agent-guide.md](docs/agent-guide.md) | AI agents: investigation ladder, tool chooser, evidence semantics |
| [docs/mcp-reference.md](docs/mcp-reference.md) | Tool/resource/prompt reference with annotations |
| [docs/monitoring.md](docs/monitoring.md) | Prometheus metrics, alert rules, logs, web console |
| [docs/configuration.md](docs/configuration.md) | Config file, env vars, policy, schedules, storage backends |
| [docs/integrations.md](docs/integrations.md) | Claude, Cursor, VS Code, custom agents, HTTP, Docker |
| [docs/demo-transcript.md](docs/demo-transcript.md) | Real captured crash-loop investigation |
| [docs/site/](docs/site/README.md) | The docs website source (Vite + React + Tailwind) |
| [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) | Design and threats |

## Development

```bash
npm run lint        # eslint (incl. no-floating-promises)
npm run typecheck   # strict TypeScript
npm run test        # vitest: 270 tests (SQLite); 273 with PostgreSQL + Redis env vars
npm run build       # tsc → dist/
npm run demo        # regenerate docs/demo-transcript.md from a real run
npm run docs:dev    # docs site dev server (first run: npm run docs:install)
```

All four gates must pass before a change is complete. CI runs Node 22 + 24, a PostgreSQL 16
service job and a Redis 7 job; the mock panel + in-memory MCP transport exercise the full
investigation and remediation flows end-to-end.

## Contributing

Small slices, tests with every behavior change, docs/status updated in the same change — see
[CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for coding agents.

## License

MIT — see [LICENSE](LICENSE).
