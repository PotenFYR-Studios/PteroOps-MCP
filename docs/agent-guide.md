# Agent Guide. Operating PteroOps over MCP

Audience: AI agents, LLM applications, and developers building agents on top of PteroOps.
This document teaches **behavior**, not API signatures. Tool schemas: [`mcp-reference.md`](mcp-reference.md).

> **Status note:** all designed phases are implemented. 55 tools, 14 resources, 8 prompts.
> Per-tool details live in [`mcp-reference.md`](mcp-reference.md); honest limitations (Git
> dirty-state needs an active console, backup-restore rollback is manual) are listed in
> [`docs/status.md`](status.md). Always call `ptero_get_capabilities` first,
> it reports which tools are actually registered with the configured credentials.

---

## 1. Golden rules

1. **Call `ptero_get_capabilities` first.** It tells you which panels exist and which tools are
   usable. Never assume a tool exists because this guide mentions it.
2. **Diagnose before restart.** A restart destroys the crash evidence you need. Restart only
   after you have captured console context and either diagnosed the cause or received explicit
   user instruction.
3. **Evidence before action.** Before proposing anything mutating, state: what you observed,
   what you infer, how confident you are, what you would do, what could go wrong, how to undo it.
4. **Respect annotations and risk.** Every tool carries `readOnlyHint` / `destructiveHint`.
   `ptero_get_risk` classifies proposed actions. HIGH/CRITICAL actions require approval,
   never execute them unprompted.
5. **Policy overrides you.** If policy denies an action, do not retry variations to bypass it.
   Report the denial and its reason.
6. **Separate facts from hypotheses**, in your reasoning and your output. PteroOps returns
   `observedFacts`, `probableCauses[].confidence` and `missingEvidence[]` separately; keep them separate.
7. **Stay bounded.** Use the provided limits (`limit`, `window`, `maxLines`). Never request
   unbounded console output; PteroOps will cap it, but asking for it signals misunderstanding.
8. **Never put secrets in commands or logs.** No API keys, tokens or passwords in console
   commands, file content, or your own messages.
9. **One server at a time unless correlating.** With multi-server symptoms, run
   `ptero_investigate_incident` or at least check shared infrastructure before
   touching servers individually.
10. **Report incidents, don't hide them.** When you conclude a diagnosis, make sure an incident
    exists (`ptero_diagnose` opens one automatically when warranted).

---

## 2. The investigation ladder

Follow this order. Each rung answers a question; stop as soon as you can answer the user safely.

| # | Question | Tool(s) |
| --- | --- | --- |
| 1 | What exists? Which panels/capabilities? | `ptero_get_capabilities` |
| 2 | Which server(s) are affected? | `ptero_list_servers`, `ptero_get_server` |
| 3 | What is the current state and is it *healthy*? | `ptero_get_health`, `ptero_get_metrics` |
| 4 | What does the console say? | `ptero_console_query`, `ptero_analyze_logs` |
| 5 | What is actually running? | `ptero_detect_application` |
| 6 | Is it crash-looping? Since when? | `ptero_get_health` (status `crash_loop`), `ptero_list_incidents` |
| 7 | What changed recently? | `ptero_get_change_history` |
| 8 | Has this happened before? | `ptero_list_incidents` (fingerprint match), `ptero_get_incident` |
| 9 | What is the structured diagnosis? | `ptero_diagnose` |
| 10 | What should be done? | `ptero_propose_remediation` → approval → execute → verify |

**Anti-pattern:** jumping from rung 3 directly to `ptero_power_action: restart`. The only
justification for restart-before-diagnosis is explicit user instruction *after* you've explained
the trade-off (evidence loss).

---

## 3. Symptom → first move

| Symptom | First moves (in order) | Avoid until diagnosed |
| --- | --- | --- |
| Server keeps restarting | `ptero_get_health` → `ptero_console_query(severities=[error,fatal], window)-last 30m` → `ptero_get_change_history` | restarting, killing |
| Server offline unexpectedly | `ptero_get_metrics` (state history) → `ptero_console_query` around the last running timestamp | starting blindly |
| Memory climbing / OOM | `ptero_get_metrics` → `ptero_analyze_logs(patterns=[oom])` → detect application (heap flags) | raising limits without evidence of cause |
| Players/users can't connect | `ptero_get_health` (process ok?) → `ptero_network_diagnose` → console for bind errors | restarting proxy and backends together |
| Errors after a change | `ptero_get_change_history(around=<first error ts>)` → `ptero_analyze_logs` | editing files before reading them |
| Many servers down at once | `ptero_list_servers` → `ptero_investigate_incident`; check shared node/DB | independent per-server restarts |
| Disk filling up | `ptero_get_metrics` → `ptero_backup_status` → log/backup growth check | deleting files blind |
| Slow but running | `ptero_get_metrics` history vs baselines → dependency check | treating "running" as "healthy" |

---

## 4. Tool chooser (quick reference)

Always start here: `ptero_get_capabilities`.

| Need | Use | Not this |
| --- | --- | --- |
| Inventory | `ptero_list_servers` | many `ptero_get_server` calls |
| One server's details | `ptero_get_server` | — |
| Is it OK? | `ptero_get_health` | eyeballing `state == running` |
| Raw numbers | `ptero_get_metrics` | — |
| "What errors happened?" | `ptero_console_query` | dumping the whole console |
| "What do these errors mean?" | `ptero_analyze_logs` | pasting logs into your own context manually |
| What is running here? | `ptero_detect_application` | filename guessing in messages |
| Dependency problems | `ptero_analyze_dependencies` | guessing from console alone |
| Full investigation | `ptero_diagnose` | chaining 8 tools yourself when one call does it |
| Incident history | `ptero_list_incidents` / `ptero_get_incident` | memory of the conversation |
| What changed? | `ptero_get_change_history` | asking the user to remember |
| Fix planning | `ptero_propose_remediation` | `ptero_write_patch` / `ptero_power_action` directly |
| Executing an approved fix | `ptero_execute_remediation` | manual multi-step changes |
| Restart (justified) | `ptero_power_action: restart` | `kill` unless process is wedged |
| Console command | `ptero_send_command` | using commands to do what file tools should do |

---

## 5. Worked example, crash loop

```
1. ptero_get_capabilities                          → panel "production" has client.console.read/write
2. ptero_list_servers                              → production/survival, state "starting" (restarts often)
3. ptero_get_health {server:"survival"}            → status "crash_loop", evidence: 4 starts, avg runtime 38s
4. ptero_console_query {server, window:"45m", severities:["error","fatal"], limit:50}
                                                   → fatal: "java.lang.OutOfMemoryError: Java heap space"
5. ptero_detect_application {server}               → paper 1.21.4, confidence 0.94, evidence [...]
6. ptero_analyze_logs {server, window:"45m"}       → issue #1: OOM, 4 occurrences, first 12:31:44,
                                                     last 12:44:02; stack trace grouped; patterns: oom_java
7. ptero_get_change_history {server, around:"12:31:00", window:"20m"}
                                                   → change at 12:27:10: plugins/EssentialsX.jar replaced
                                                     (actor: user, before_hash→after_hash)
8. ptero_diagnose {server}                         → probable cause: JVM heap exhaustion with new
                                                     EssentialsX build (correlation: 4m before first OOM),
                                                     confidence 0.78; recommendations: raise heap OR revert
                                                     plugin (rollback: restore file snapshot), missing
                                                     evidence: allocator usage for that plugin
9. ptero_get_incident {id}                         → incident with evidence, timeline; no restart performed
```

Your user-facing summary (explainability template):

- **Observed:** 4 OOM crashes in 45 min; plugin JAR changed 4 min before first crash.
- **Meaning:** the new EssentialsX build exhausts the heap; the change is the likely trigger.
- **Confidence:** 0.78, strong temporal correlation, but not yet proven the plugin is the sole consumer.
- **Proposed:** revert the plugin JAR (rollback: restore snapshot) or raise heap; both require approval.
- **Risk / rollback:** MEDIUM (file restore is HIGH if chosen), snapshot exists, reverse action is re-apply.

---

## 6. Multi-server example

```
1. ptero_list_servers                      → 6 servers on node "wolverine-02" all offline
2. ptero_investigate_incident {node:"wolverine-02"}
   → timeline alignment (< 90s spread), shared node identified, one parent incident proposed
3. Do NOT restart each server.            → remediation targets the node-level cause first
```

If the tools for this do not exist yet in your release, say so; do not improvise per-server
actions and call it correlation.

---

## 7. Reading evidence and confidence

| Concept | Where | Meaning |
| --- | --- | --- |
| `observedFacts` | diagnostics, detection | Directly measured or read; no interpretation |
| `probableCauses[].kind=inferred` | diagnostics | Concluded from facts via deterministic rules (e.g. pattern × timing) |
| `hypotheses` | diagnostics | Plausible but unverified; requires more evidence |
| `confidence` (0–1) | detection, causes | Derived from evidence weight/count, never random; treat < 0.5 as "ask, don't act" |
| `missingEvidence` | diagnostics | What would raise confidence; request it before acting on weak causes |
| `evidence[]` | everywhere | Source, timestamp, excerpt/fingerprint, quote these, don't paraphrase away |

**Confidence communication:** HIGH (exact fatal signature + known incompatible dependency),
MEDIUM (strong correlation, incomplete evidence), LOW (weak circumstantial). Never present a
probable cause as a fact.

---

## 8. Risk, approvals, and dry-run

| Risk | Meaning for you |
| --- | --- |
| LOW | May be auto-approved where configured; still audited |
| MEDIUM | Requires approval unless the operator configured otherwise |
| HIGH | Explicit approval required, ask the user in plain language |
| CRITICAL | Never automated. Explicit approval + strong confirmation; policy may deny outright |

Rules: every mutating proposal states **exact actions, affected files/servers, reason, expected
effect, risk, rollback, expiry**. Use `dryRun` whenever offered and show the exact operation,
diff, restart requirement and rollback before asking for approval. If verification after a fix
fails, the system rolls back and records it, report that outcome, never hide it.

---

## 9. Do-not list

- Do not restart before diagnosing (unless the user explicitly instructs it after you explain).
- Do not execute HIGH/CRITICAL actions without approval ("the user seemed to want it" is not approval).
- Do not edit files without reading them first, or without a diff + rollback path.
- Do not treat `ptero_power_action` returning success as "fixed", verify with `ptero_get_health`.
- Do not request unbounded console dumps; use filters, windows and limits.
- Do not repeat a past remediation just because operational memory shows it worked before,
  revalidate the evidence for the *current* failure.
- Do not put secrets in any tool input or message.
- Do not present hypotheses as facts, or confidence as certainty.
