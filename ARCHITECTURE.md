# Architecture

How PteroOps is put together and why. Module-level delivery status lives in
[`docs/status.md`](docs/status.md).

## Layering (strict dependency direction)

```
transport          stdio | Streamable HTTP | (future: hosted)
mcp surface        tools | resources | prompts
services           diagnosis, health, incidents, console, changes, files, monitoring
intelligence       logs, fingerprints, dependencies, crash-loop, correlation, baselines
adapters           Pterodactyl Client API | Application API | WebSocket console
persistence        repository interfaces | SQLite implementation | migrations
cross-cutting      config · security (capabilities, policy, redaction, audit) · observability
```

Rules enforced by review and tests:

- `mcp/*` imports services and shared types — never `fetch`, SQL, or adapters.
- engines are pure (injected clock/ids), fully unit-testable.
- repositories are interfaces; SQLite is one implementation. SQL stays portable.
- adapters own retry/timeout/rate-limit/circuit behavior; services never re-implement it.

## Runtime composition

`src/container.ts` builds the whole graph (panels, databases, engines, monitor) from validated
config. `src/index.ts` is the CLI entry: it loads config, starts the monitoring loop, then serves
either stdio or HTTP. One process, SQLite on disk, no external services required.

## Key flows

**Console ingest (persistent intelligence)**
`ConsoleStreamer (WebSocket, auto-reconnect)` → normalize → classify (severity/subsystem/exception)
→ fingerprint warn+ → store in `console_events` / `log_fingerprints` → crash tracker observations
→ retention pruning.

**Diagnosis (deterministic, no LLM inside the server)**
`ptero_diagnose` → server state + resources → application detection (egg/docker/files/console)
→ bounded console window → log intelligence (issues, stack traces, patterns) → crash-loop
assessment → change-ledger correlation → operational memory (similar incidents) → composed
`Diagnosis { observedFacts, probableCauses[confidence], recommendedActions[risk], missingEvidence }`
→ incident opened/updated. The **calling agent** is the LLM; PteroOps supplies structured evidence.

**Monitoring (proactive, no API spam)**
Interval tick → cached server list → concurrency-limited resource polls → metric samples →
state transitions → crash-loop detector (survives restarts via `process_events`) → crash-loop
incidents with console evidence → console streamer sync → periodic retention pruning.

## Resilience

| Concern | Policy |
| --- | --- |
| Timeout | per-request, AbortSignal propagated |
| Retries | GET only, exponential backoff + jitter, max 3; mutations never retried |
| Rate limits | 429 honors Retry-After; nearly-exhausted headers logged; counters |
| Circuit breaker | per panel, opens after 5 consecutive failures, half-open probe |
| WebSocket | reconnect with backoff, token refresh on `token expiring`, re-auth/-connect on expiry |
| Caching | server lists, detection signals (5 min), bounded |

## Persistence

SQLite via Node's built-in `node:sqlite` (no native build step). Numbered, append-only,
transactional migrations. Tenant scoping is mandatory in repository signatures. Tables cover
servers, console events, fingerprints, metric samples, process events, incidents + evidence +
relationships, change ledger, audit, and file snapshots. JSON columns hold evolving detail with
size caps; a PostgreSQL adapter is a new repository implementation, not a rewrite.

## Recorded decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | `node:sqlite` instead of `better-sqlite3` | Node 22+ ships SQLite; zero native toolchain friction, fewer supply-chain deps |
| D2 | Custom ~150-line structured logger instead of pino | stdout must stay protocol-clean for stdio transport; redaction hook built-in; no dep |
| D3 | Deterministic diagnosis first, LLM never called by the server itself | Testable, explainable, no hidden cost; the *calling agent* is the LLM |
| D4 | Evidence/incident detail stored as JSON columns (+ dedicated evidence/relationship tables) | Schema stability while the intelligence layer evolves |
| D5 | Stateless-capable HTTP transport with per-session transports | Supports both agent sandboxes (stateless) and long-lived clients |
| D6 | One binary, `--transport stdio\|http` | Comfortable single service; splittable later (hosted) without rewrites |
| D7 | Engines are pure functions/classes with injected clocks | Deterministic tests for crash-loop windows, retention, correlation |

## What would justify future infrastructure

- **PostgreSQL**: only when hosted multi-tenant concurrency or >1 service instance demands it.
  Repositories are the migration seam; SQL is kept to a portable subset.
- **Redis**: only for cross-instance caching/locks when the hosted deployment exists.
- **Queue/Kafka**: only when monitoring outgrows a single process's tick loop.
