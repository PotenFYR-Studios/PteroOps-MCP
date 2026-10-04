# Contributing

Thanks for helping build PteroOps, the AI operations layer for Pterodactyl.

## Ground rules

1. **Small, reviewable slices.** One coherent change per PR; imperative commit subjects
   (`add console fingerprint upsert`). No drive-by rewrites.
2. **Nothing is done until it is tested.** `npm run lint && npm run typecheck && npm run test && npm run build`
   must pass. A behavior change without a test is incomplete.
3. **Update the docs.** If you change the MCP surface, update `docs/mcp-reference.md` and
   `docs/status.md` in the same change. Record design decisions under "Recorded decisions" in
   `ARCHITECTURE.md`.
4. **Evidence discipline.** Features that encourage acting before evidence (auto-restart loops,
   blind writes, "HTTP 200 = fixed") are rejected, see `AGENTS.md`, rule 5.
5. **No secrets.** Never commit `.env`, tokens, `data/`, or `dist/`. Everything user-visible
   passes the redaction engine; new secret-bearing fields need a redaction test.
6. **No fake implementations.** No stubs, no mocks in `src/`, no pseudocode. If it is not real,
   it is PLANNED in `docs/status.md`.
7. **No code comments** unless they capture non-obvious intent (a regex's purpose, a protocol
   quirk, a security rationale). Code should explain itself.

## Where things live

| Change | Location | Tests |
| --- | --- | --- |
| New detector | `src/applications/detectors/` + register in `detector.ts` | `tests/unit/application-detector.test.ts` |
| New profile | `src/applications/profiles/` | detector/profile tests |
| New log pattern/fingerprint rule | `src/intelligence/logs/patterns.ts` | positive + negative fixtures |
| New MCP tool | service logic first → `src/mcp/tools/*` → capability + annotations | `tests/mcp/` |
| New repository | migration in `src/persistence/sqlite/migrations.ts` → repository → docs | `tests/repository/` |
| New policy rule | `src/security/policy.ts` | `tests/unit/policy-risk.test.ts` |

## Development setup

```bash
npm install
npm run test:watch        # while developing
npm run lint:fix
npm run typecheck
```

Test infrastructure lives in `tests/helpers/`:

- `mock-panel.ts`, scriptable Pterodactyl HTTP server (auth, pagination, failure injection)
- `services.ts`, builds the full service graph against an in-memory database
- MCP tests connect over an in-memory transport (no stdio/HTTP needed)

## Commit / PR checklist

- [ ] What changed and where it is documented (`docs/`, `ARCHITECTURE.md`, `SECURITY.md`)
- [ ] Commands run (lint/typecheck/test/build)
- [ ] Status/doc updates included
- [ ] Security considered: capabilities, policy, redaction, tenant scoping
- [ ] No secrets, no `.env`, no `data/`, no `dist/`

## Good first contributions

- New application detectors (Rust frameworks, game servers beyond Minecraft)
- New log patterns with positive/negative fixtures
- More dependency parsers (Maven lockfiles, NuGet)
- Documentation improvements for agent workflows (`docs/agent-guide.md`)
