import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Services } from "../container.js";
import { SERVER_NAME, VERSION } from "../shared/version.js";
import { ToolRegistry, type ToolDefinition } from "./registry.js";
import { serverTools } from "./tools/servers.js";
import { consoleTools } from "./tools/console.js";
import { mutationTools } from "./tools/mutations.js";
import { fileTools } from "./tools/files.js";
import { applicationTools } from "./tools/application.js";
import { incidentTools } from "./tools/incidents.js";
import { riskTools } from "./tools/risk.js";
import { backupTools } from "./tools/backups.js";
import {
  databaseTools,
  networkTools,
  scheduleTools,
  startupVariableTools,
  subuserTools,
} from "./tools/server-ops.js";
import { adminTools } from "./tools/admin.js";
import { remediationTools } from "./tools/remediation.js";
import { gitTools } from "./tools/git.js";
import { infrastructureTools } from "./tools/infra.js";
import { configValidationTools, debugTools } from "./tools/debug.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

const INSTRUCTIONS = [
  "PteroOps is an AI SRE layer for Pterodactyl. Golden rules:",
  "1. Call ptero_get_capabilities first; only use tools it reports.",
  "2. Diagnose before restart: restarting destroys crash evidence. Use ptero_diagnose / ptero_analyze_logs first.",
  "3. Evidence before action: state observed facts, inferences and confidence separately (they are returned separately).",
  "4. Mutating tools are audited and policy-checked; HIGH/CRITICAL actions require explicit confirmation and approvals.",
  "5. Never claim a fix worked because an API call succeeded — verify with ptero_get_health.",
  "6. Keep queries bounded; use windows/limits, never ask for unbounded console dumps.",
].join("\n");

export interface McpServerBundle {
  server: McpServer;
  registry: ToolRegistry;
}

export function createMcpServer(services: Services): McpServerBundle {
  const definitions: ToolDefinition[] = [];
  const registry = new ToolRegistry(() => definitions);
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  definitions.push(
    ...serverTools(registry),
    ...consoleTools(),
    ...mutationTools(),
    ...fileTools(),
    ...applicationTools(),
    ...incidentTools(),
    ...riskTools(),
    ...backupTools(),
    ...databaseTools(),
    ...scheduleTools(),
    ...networkTools(),
    ...subuserTools(),
    ...startupVariableTools(),
    ...adminTools(),
    ...remediationTools(),
    ...gitTools(),
    ...infrastructureTools(),
    ...debugTools(),
    ...configValidationTools(),
  );

  registerResources(server, services);
  registerPrompts(server, services);
  registry.registerAll(server, services);

  return { server, registry };
}
