# PteroOps Documentation

Everything you need, from "what is this" to the full MCP surface reference.

> Rendered site: **<https://potenfyr-studios.github.io/PteroOps-MCP/>** — the pages you are reading,
> built by `docs/site/` (Vite + React + Tailwind) from this directory. Run it locally with
> `npm run docs:install && npm run docs:dev`.

## Start here

| Document | Read it when |
| --- | --- |
| [Getting Started](getting-started.md) | You are new to PteroOps (or MCP). Panels keys, install, connect your AI app, first prompts, troubleshooting, FAQ — no prior knowledge assumed |
| [Installation](installation.md) | You want the one-liner installers, Docker, install flags, updating, uninstalling or offline installs |

## Operate it

| Document | Read it when |
| --- | --- |
| [Agent Guide](agent-guide.md) | You are an AI agent or building one: investigation ladder, tool chooser, evidence/confidence semantics, the do-not list |
| [MCP Reference](mcp-reference.md) | You need exact tool schemas, annotations, capability requirements and error shapes |
| [Capability Map](capability-map.md) | You want to see which tools deliver which SRE capability |
| [Configuration](configuration.md) | You are tuning panels, policy, approvals, schedules, storage (SQLite/PostgreSQL/Redis) or transports |
| [Monitoring](monitoring.md) | You are wiring Prometheus, alerts, structured logs or the web console |
| [Integrations](integrations.md) | You are connecting Claude Desktop/Code, Cursor, VS Code, n8n or a custom agent |
| [Demo Transcript](demo-transcript.md) | You want to see a real captured investigation before running one |

## Understand it

| Document | Contents |
| --- | --- |
| [Status](status.md) | What is implemented, partial or planned right now — the living tracker |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Layering, module map, resilience model, recorded decisions |
| [SECURITY.md](../SECURITY.md) | Threat boundary, guarantees, operator checklist |

## Conventions

- Three-valued statuses everywhere: **IMPLEMENTED**, **PARTIAL** (with the exact caveat), **PLANNED**.
- Examples are runnable as written; commands that mutate production include safety notes.
- If a document and the code disagree, the code is wrong or the document is stale — file an issue
  or a PR fixing exactly one of them.
