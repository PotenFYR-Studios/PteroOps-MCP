# AGENTS.md — Guide for coding agents working on PteroOps-MCP

This file tells AI coding agents (Claude Code, opencode, Cursor, Copilot, Codex, …) how to work
in this repository. Humans should read [`docs/`](docs/README.md) instead — much of this
duplicates it in agent-optimized form on purpose.

## What this repository is

PteroOps-MCP is a production-grade MCP server that turns Pterodactyl into an AI-operable SRE
platform: persistent console intelligence, application detection, crash-loop and health analysis,
incidents, change ledger, and (later phases) policy-controlled self-healing with rollback.
Read the [`README.md`](README.md) and [`docs/agent-guide.md`](docs/agent-guide.md) before your
first change.

## Read-first order (do not skip)

1. `docs/status.md` — what actually exists right now (trust this over any assumption)
2. `ARCHITECTURE.md` — layering and dependency rules you must not violate
3. `docs/mcp-reference.md` — the MCP surface contract
4. `CONTRIBUTING.md` — quality gates and what tests a change is expected to carry
5. `docs/agent-guide.md` — how agents *operate* the product (informs tool behavior)

## Commands

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` (fix: `npm run lint:fix`) |
| Format | `npm run format` |
| Tests | `npm run test` (watch: `npm run test:watch`) |
| Build | `npm run build` (outputs `dist/`) |
| Run stdio | `node dist/index.js --transport stdio` |
| Run HTTP | `node dist/index.js --transport http` |
| Dev (tsc watch) | `npm run dev` |
| Docs site (dev) | `npm run docs:install && npm run docs:dev` |
| Docs site (build) | `npm run docs:build` |

A change is only complete when `npm run lint && npm run typecheck && npm run test && npm run build`
all pass. If those scripts do not exist yet, you are in the bootstrap phase — create them as
part of the scaffold task.

## Repository map (current, see ARCHITECTURE.md)

```
src/config         config schema + loader (zod, env expansion)
src/shared         errors, ServerRef types, ids, hashing, redaction, diff, time helpers
src/observability  structured logger (stderr!), metrics registry
src/security       capabilities, risk, policy, audit
src/pterodactyl    HTTP client, Client/Application APIs, WebSocket console, console command runner
src/persistence    repository interfaces + sqlite implementation + migrations
src/console        persistent console ingest/classify/query/retention
src/intelligence   logs, crash-loop, dependencies, correlation, baselines, drift, debug context (stack -> file snippets)
src/applications   detectors, profiles, signal collector, dependency service
src/health         health engine + service
src/incidents      incident service
src/changes        change ledger
src/diagnostics    deterministic diagnosis engine
src/files          safe file editor (hash, snapshot, diff, verify), bounded text search
src/approvals      approval lifecycle
src/remediation    types, planner, executor, rollback, verification, simulator, canary, effectiveness, blast radius
src/git            git adapter (status/deploy/rollback via files + console)
src/network        scoped network diagnostics
src/topology       infra graph builder
src/known-good     known-good state capture/compare
src/monitoring     monitor loop, streamer manager, scheduler
src/ui             read-only web console (render + dashboard service)
src/mcp            server, registry, tools, resources, prompts, transports
docs/              markdown docs (docs/*.md) + rendered docs site (docs/site, Vite + React + Tailwind)
scripts/           install.sh / install.ps1 (one-liner installers) + demo transcript generator
deploy/            Docker/K8s/systemd/reverse-proxy manifests
tests/             unit | repository | integration | mcp
```

`docs/status.md` is the module-level truth — keep it current.

## Non-negotiable rules

1. **stdout is protocol.** With the stdio transport, stdout carries MCP JSON-RPC only. All
   logging goes to stderr (`src/observability/logger.ts` handles this). Never `console.log`.
2. **No secrets, ever.** Every externally-facing string passes the redaction engine (logs,
   errors, MCP payloads, audit, console captures, incidents). Never log keys, tokens, or
   Authorization headers. New secret-bearing fields require a redaction test.
3. **Strict TypeScript, zod at boundaries.** No `any` in exported signatures; validate all
   inputs at MCP/config/adapter boundaries. Prefer narrow types over casts.
4. **Layering.** `mcp → services → engines/adapters → persistence`. MCP code never touches SQL
   or `fetch` directly. Engines are pure (injected clock/ids) and unit-tested.
5. **Evidence before action / diff before write / diagnose before restart.** These are product
   invariants, not slogans. Tools that would encourage action-before-evidence are rejected.
6. **No comments in code** unless they capture non-obvious intent (a regex's purpose, a protocol
   quirk, a security rationale). Never narrate what the next line does.
7. **No fake implementations.** No mocks in `src/`, no stub tools, no pseudocode. If something
   is not real yet, it does not exist and is labeled PLANNED in `docs/status.md`.
8. **Mutating actions** must go through: capability check → policy/risk → audit → change ledger.
   Use the shared wrappers rather than re-implementing per tool.
9. **Bounded outputs.** Every list/query tool enforces limits, pagination metadata, and payload
   caps. Console/log data is grouped and sampled — never dumped.
10. **Errors are structured** (`{code, message, hint?, retryable?, correlationId}`), typed in
    `src/shared/errors.ts`, never raw stack traces in MCP responses.

## Adding things (checklists)

**New MCP tool:** implement service logic first → register with `inputSchema` (zod), truthful
annotations, required capabilities, description that says when NOT to use it → add audit
wrapper → add MCP integration test → update `docs/mcp-reference.md` **and**
`docs/status.md`.

**New application detector:** add to `src/applications/detectors/`, export evidence-weighted
confidence (never 1.0 fabrications), add fixtures + unit tests, register in the detector list,
document supported signals in the detector's profile doc.

**New pattern/fingerprint rule:** add to `src/intelligence/logs/patterns.ts`, include positive
and negative fixtures in tests (false positives are bugs), keep it deterministic.

**New persistent entity:** define repository interface first → SQLite migration (append-only) →
tenant-scoped methods → repository tests (including isolation) → update `docs/configuration.md`
(storage section).

**New remediation action type:** assign risk level per `src/security/risk.ts`,
define rollback strategy, dry-run behavior, and verification test before writing executor code.

## Commit / PR conventions

- Small, focused commits; imperative subject (`add console fingerprint upsert`), no tool chatter.
- A PR states: what changed, commands run, docs/status updates included.
- Never commit `.env`, tokens, `data/`, or `dist/`.

## When unsure

Ask in the PR/issue rather than inventing behavior. If you must choose a design, prefer
operational safety > correctness > testability > extensibility > performance > DX, and record
the decision in `ARCHITECTURE.md` under "Recorded decisions".
