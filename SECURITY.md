# Security Policy

Pterodactyl access is infrastructure-admin access: a `ptla_*` key can delete servers and a
`ptlc_*` key can execute arbitrary commands inside containers. PteroOps treats this as the
highest trust boundary in the system.

The enforcement points live in `src/security/` (capabilities, policy, risk, audit), the config
loader and the MCP wrappers; this document is the summary operators should read first.

## Guarantees in the current release

- **Capability gating** — tools whose required capabilities are not provided by the configured
  keys are never registered (`ptero_get_capabilities` reports the live state).
- **Zod validation everywhere** — MCP inputs, config, and adapter boundaries.
- **Redaction engine** — Pterodactyl keys, bearer/JWT tokens, private keys, common cloud tokens,
  connection strings, password assignments, plus every configured key value, are redacted from
  logs, errors, MCP responses, audit events, console captures, and incidents.
  Covered by a dedicated test corpus.
- **Path confinement** — file reads/listings reject traversal (`..`), null bytes, control
  characters, and over-long paths; protected-path patterns are policy-checked.
- **Command policy** — operator-defined blocked/allowlisted patterns, risk classification,
  audit + change-ledger recording. Console commands are honestly documented as powerful:
  the real boundary remains the Pterodactyl permission model plus policy.
- **Crash-loop guard** — restart/kill while a crash loop is active is refused unless
  `force=true` with a reason, preventing blind restart loops.
- **HIGH/CRITICAL confirmation** — kill and similar actions require `confirm=true` after an
  explicit user decision; `deny`-listed actions are rejected regardless.
- **HTTP transport** — bearer token required for non-loopback binding (enforced at config load);
  timed-safe token comparison; loopback-only by default.
- **Tenant isolation** — every persistent record carries a tenant; repositories require it and
  isolation is tested.
- **No secrets in the image** — Docker passes secrets at runtime; `.env` files are git-ignored.
- **Supply chain** — `npm audit --omit=dev --audit-level=high` runs in CI; the production
  dependency tree is intentionally small.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report privately via GitHub Security
Advisories ("Report a vulnerability") on the repository, or by contacting the maintainers.
Include: affected version/commit, reproduction steps, impact, and any suggested fix.
We aim to acknowledge within 72 hours and to ship a fix or mitigation before public disclosure.

## Operator checklist

1. Use separate panels/keys for staging and production; set `policy.allowedServers` per panel.
2. Bind HTTP to loopback (`127.0.0.1`) or terminate TLS in a reverse proxy and always set
   `PTERO_HTTP_TOKEN` for remote access.
3. Keep `approval.autoApprove` minimal; treat MEDIUM+ as human-approved by default.
4. Review `ptero_query_audit` and `ptero_get_change_history` periodically.
5. Rotate panel keys; rotation never requires code changes (config/env only).
6. Treat generated API keys as high-value: they appear in no PteroOps output by design —
   if one ever does, it is a security bug; report it.
