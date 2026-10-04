import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { PolicyDeniedError } from "../../shared/errors.js";
import { riskActionKeyForPower } from "../../security/risk.js";
import { requirePanel, resolveRef, serverArg } from "./helpers.js";
import type { PowerAction } from "../../shared/types.js";
import { POWER_SIGNALS } from "../../shared/types.js";

const HOUR_MS = 3_600_000;

export function mutationTools(): ToolDefinition[] {
  return [
    {
      name: "ptero_power_action",
      title: "Control server power",
      description:
        "Starts, stops, restarts or kills a server. MUTATING and audited. Rules: (1) never restart before diagnosing, a restart destroys crash evidence and, for crash loops, guarantees another crash; (2) 'kill' is HIGH risk and requires confirm=true after explicit user confirmation; (3) restarts are refused when the server is detected in a crash loop unless force=true with a reason; (4) restart budgets (policy.maxRestartsPerHour) are enforced.",
      inputSchema: {
        server: serverArg,
        action: z.enum(["start", "stop", "restart", "kill"]),
        reason: z.string().max(300).optional(),
        confirm: z.boolean().optional().describe("Required for HIGH-risk actions (kill)."),
        force: z.boolean().optional().describe("Override the crash-loop guard (requires reason)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      capabilities: { allOf: ["client.power"] },
      handler: async (args, ctx) => {
        const services = ctx.services;
        const ref = resolveRef(services, String(args.server));
        const action = args.action as PowerAction;
        const panel = requirePanel(services, ref, { allOf: ["client.power"] });

        const crash = services.crashTracker.assess(ref);
        if ((action === "restart" || action === "kill") && crash.inCrashLoop && args.force !== true) {
          throw new PolicyDeniedError(
            "power.crash-loop-guard",
            `The server appears to be in a crash loop (${crash.crashCount} short exits recently). Restarting will likely repeat the failure and destroys evidence.`,
            {
              hint: "Run ptero_diagnose and ptero_console_query first, or pass force=true with a reason if the user explicitly wants the restart.",
              details: { crashEvidence: crash.evidence },
            },
          );
        }

        const recentRestarts = await services.changeLedger.countAction(
          ref,
          "restart_server",
          HOUR_MS,
        );
        const decision = services.policyEngine.evaluatePower(ref, action, {
          automation: false,
          approved: true,
          recentRestarts,
        });
        if (!decision.allowed) {
          throw new PolicyDeniedError(decision.policyId, decision.reason, {
            details: { risk: decision.risk, action },
          });
        }
        if (decision.risk === "CRITICAL" || decision.risk === "HIGH") {
          if (args.confirm !== true) {
            throw new PolicyDeniedError(
              "power.confirmation-required",
              `Action "${action}" is ${decision.risk} risk and requires explicit confirmation.`,
              {
                hint: "Confirm with the user, then call again with confirm=true.",
                details: { risk: decision.risk },
              },
            );
          }
        }

        if (action === "start" || action === "restart") {
          services.crashTracker.reset(ref);
        }
        await panel.clientApi!.setPower(ref, POWER_SIGNALS[action]);
        await services.changeLedger.record({
          ref,
          actor: ctx.actor,
          origin: "mcp:power_action",
          action: riskActionKeyForPower(action),
          target: `power:${action}`,
          result: "success",
          risk: decision.risk,
          reason: args.reason ? String(args.reason) : null,
          details: { action, correlationId: ctx.correlationId },
        });
        return {
          ok: true,
          server: `${ref.panel}/${ref.serverId}`,
          action,
          risk: decision.risk,
          reminder:
            action === "restart" || action === "kill"
              ? "Verify with ptero_get_health once the server is up; success of the API call is not proof of health."
              : undefined,
        };
      },
    },
  ];
}
