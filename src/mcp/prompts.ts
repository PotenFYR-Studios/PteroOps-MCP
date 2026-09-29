import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Services } from "../container.js";

export function registerPrompts(server: McpServer, services: Services): void {
  const defaultPanel = services.defaultPanel;

  server.registerPrompt(
    "diagnose-server",
    {
      title: "Diagnose a server",
      description:
        "Evidence-first investigation of an unhealthy or suspicious server. Restarting before diagnosis is prohibited.",
      argsSchema: { server: z.string().describe('Server reference ("panel/serverId" or "serverId")') },
    },
    ({ server: serverArg }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Diagnose the Pterodactyl server "${serverArg || `<serverId> (default panel: ${defaultPanel})`}" using PteroOps.`,
              "",
              "Work strictly evidence-first:",
              "1. ptero_get_health — establish the current status and its evidence.",
              "2. ptero_get_metrics — look for resource pressure (memory/disk/cpu) and trend, not just the current value.",
              "3. ptero_analyze_logs (window 60m) — identify fingerprinted issues, stack traces and pattern hits.",
              "4. ptero_detect_application — identify runtime/application/distribution/version before interpreting errors.",
              "5. ptero_get_change_history (around the first error) — correlate failures with recent changes.",
              "6. ptero_diagnose — produce the structured diagnosis (facts, causes with confidence, missing evidence).",
              "7. Only then summarize for the user: observed, meaning, confidence, proposed action, risk, rollback.",
              "",
              "Do not restart, kill or change anything as part of this investigation. If evidence is missing, say exactly what is missing instead of guessing.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "investigate-crash-loop",
    {
      title: "Investigate a crash loop",
      description: "Structured workflow for a server that keeps restarting.",
      argsSchema: { server: z.string().describe("Server reference") },
    },
    ({ server: serverArg }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Investigate the suspected crash loop on "${serverArg}".`,
              "",
              "1. ptero_get_health — confirm crash_loop status and capture the restart evidence.",
              "2. ptero_console_query with mode=first for the top fatal fingerprint — establish the FIRST occurrence time.",
              "3. ptero_analyze_logs (window covering the first occurrence) — group issues and lifecycle events.",
              "4. ptero_get_change_history around the first occurrence — what changed within ~15 minutes before it?",
              "5. ptero_list_incidents — has this fingerprint occurred before, and what was recorded then?",
              "6. ptero_diagnose — combine evidence into probable causes with confidence.",
              "",
              "Never restart the server as part of this investigation: it destroys evidence and the loop will repeat. If you conclude a fix, present it as a proposal with risk and rollback before any execution.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "safe-restart",
    {
      title: "Restart a server safely",
      description: "Preconditions, evidence capture and post-restart verification for a justified restart.",
      argsSchema: { server: z.string().describe("Server reference") },
    },
    ({ server: serverArg }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `The user wants to restart "${serverArg}". Before doing it:`,
              "",
              "1. Explain why a restart is needed and what evidence will be lost (console buffer, crash state).",
              "2. ptero_get_health + ptero_analyze_logs — capture the current state and top issues so the restart is not blind.",
              "3. ptero_detect_application — know the graceful stop behavior (e.g. Minecraft: 'stop', not kill).",
              "4. Check the crash-loop guard: if ptero_get_health reports crash_loop, a restart requires force=true AND an explicit user decision — recommend diagnosis instead.",
              "5. ptero_power_action with action=restart (confirm=true if challenged).",
              "6. ptero_get_health until the server is healthy (poll with backoff; startup can take minutes). Report the outcome: healthy or not, with evidence.",
              "",
              "If the server does not become healthy, do not restart again — start a diagnosis.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "review-recent-changes",
    {
      title: "Review recent changes",
      description: "Correlate a symptom time with the change ledger.",
      argsSchema: {
        server: z.string().optional().describe("Server reference (optional; omit for all servers)"),
        around: z.string().optional().describe("Symptom time (ISO, epoch ms, or relative like -1h)"),
      },
    },
    ({ server: serverArg, around }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Review changes recorded by PteroOps${serverArg ? ` for "${serverArg}"` : ""}${around ? ` around ${around}` : ""}.`,
              "",
              "1. ptero_get_change_history with around/window (default ±15m) to list mutations with before/after hashes and actors.",
              "2. For each candidate change, check whether error fingerprints (ptero_analyze_logs) begin shortly after its timestamp.",
              "3. Distinguish correlation from causation: state the time delta, the evidence, and what is still unknown.",
              "4. Remember that changes made outside PteroOps are invisible — say so if the ledger is empty.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "investigate-multi-server-incident",
    {
      title: "Investigate a multi-server incident",
      description: "Correlate failures across servers before touching any of them.",
      argsSchema: {
        scope: z.string().optional().describe('Optional scope: a server, node name, panel, or group.'),
      },
    },
    ({ scope }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Several servers may be failing${scope ? ` (scope: ${scope})` : ""}. Investigate the shared cause BEFORE any per-server action.`,
              "",
              "1. ptero_list_servers — establish which servers are affected and their states.",
              "2. ptero_investigate_incident with the scope — it correlates health, crash state, timelines, shared nodes, databases and recent changes, and opens one parent incident if a shared failure domain exists.",
              "3. ptero_get_topology — inspect the shared node/database/proxy if the correlation points there.",
              "4. ptero_admin_list_nodes (with an application key) — check node maintenance mode; a node in maintenance explains mass failures.",
              "5. ptero_get_change_history — look for a deployment or change that predates the failures across several servers.",
              "",
              "Do NOT restart databases, nodes or each server individually before the shared cause is excluded. Propose the least-destructive remediation, and remember HIGH-risk actions need explicit approval.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "prepare-remediation",
    {
      title: "Prepare a remediation proposal",
      description: "Turn a diagnosis into an approved-ready proposal with risk and rollback.",
      argsSchema: {
        server: z.string().describe("Server reference"),
        incidentId: z.string().optional().describe("Incident id from ptero_diagnose"),
      },
    },
    ({ server: serverArg, incidentId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Prepare a remediation for "${serverArg}"${incidentId ? ` (incident ${incidentId})` : ""}.`,
              "",
              "1. Ensure a diagnosis exists: ptero_diagnose (or ptero_get_incident) with probable causes and missing evidence.",
              "2. Choose the least-destructive fix consistent with the evidence. Available proposal actions: restart_server, file_edit (structured find/replace), file_revert (snapshot), startup_variable_change, restore_backup.",
              "3. ptero_propose_remediation — this does NOT execute anything. Inspect the returned plan: actions, risk, rollback strategy, blast radius, dry-run summary and historical effectiveness.",
              "4. ptero_simulate_remediation (approvalId) — verify patch freshness, port conflicts and policy blocks.",
              "5. ptero_execute_remediation with dryRun=true — show the user exactly what would happen.",
              "6. Only after the human operator explicitly confirms: ptero_approve_action then ptero_execute_remediation. Success means the health check and stabilization window pass; otherwise PteroOps rolls back automatically.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "verify-remediation",
    {
      title: "Verify a remediation",
      description: "Post-change verification and rollback decision.",
      argsSchema: {
        remediationId: z.string().describe("Remediation id from ptero_execute_remediation"),
      },
    },
    ({ remediationId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Verify remediation ${remediationId}.`,
              "",
              "1. ptero_get_incident or check the execution report: did the transaction end in succeeded, rolled_back or failed?",
              "2. ptero_get_health — confirm the server is healthy AND stable (not just briefly running).",
              "3. ptero_run_tests with suite=post — ready markers and error rate must pass.",
              "4. ptero_compare_known_good — confirm the new state is intentional and there is no unexpected drift.",
              "5. If the application did not improve: do NOT stack more changes. Use ptero_rollback_remediation (or let the transaction roll back), then re-diagnose with the new evidence.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "analyze-performance-regression",
    {
      title: "Analyze a performance regression",
      description: "Compare metrics against baselines instead of guessing.",
      argsSchema: {
        server: z.string().describe("Server reference"),
        window: z.string().optional().describe('Comparison window, e.g. "7d"'),
      },
    },
    ({ server: serverArg, window: argsWindow }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Analyze a possible performance regression on "${serverArg}"${argsWindow ? ` over ${argsWindow}` : ""}.`,
              "",
              "1. ptero_get_metrics — current values plus stored history and stats (avg/max, disk growth estimate).",
              "2. ptero_get_health — memory/disk pressure checks and recent error rate.",
              "3. ptero_analyze_logs — error volume changes often reveal the regression source (e.g. +600% after a deploy).",
              "4. ptero_get_change_history — correlate the regression start with deployments or config changes.",
              "5. ptero_investigate_incident if several servers regressed together.",
              "6. State observed facts vs hypotheses and confidence; do not propose a fix (e.g. raising limits) without identifying the consumer of the resource.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  services.logger.info("mcp prompts registered");
}
