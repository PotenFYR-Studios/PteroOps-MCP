import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import type { Services } from "../container.js";
import type { CapabilityRequirement } from "../security/capabilities.js";
import type { RedactionEngine } from "../shared/redaction.js";
import { PteroOpsError, type StructuredErrorShape } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { shortId } from "../shared/ids.js";
import { ValidationError } from "../shared/errors.js";

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolContext {
  services: Services;
  actor: string;
  correlationId: string;
  signal: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations: ToolAnnotations;
  capabilities?: CapabilityRequirement;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const MAX_PAYLOAD_CHARS = 512_000;

export interface RegisteredToolInfo {
  name: string;
  title: string;
  readOnly: boolean;
}

export class ToolRegistry {
  private readonly registered: RegisteredToolInfo[] = [];

  constructor(private readonly definitions: ToolDefinition[] | (() => ToolDefinition[])) {}

  list(): ToolDefinition[] {
    return [...this.resolveDefinitions()];
  }

  registeredInfo(): RegisteredToolInfo[] {
    return [...this.registered];
  }

  registerAll(server: McpServer, services: Services): void {
    for (const definition of this.resolveDefinitions()) {
      if (definition.capabilities && !services.panels.anySupports(definition.capabilities)) {
        services.logger.debug("tool not registered: capabilities unavailable", {
          tool: definition.name,
        });
        continue;
      }
      server.registerTool(
        definition.name,
        {
          title: definition.title,
          description: definition.description,
          inputSchema: definition.inputSchema,
          annotations: definition.annotations,
        },
        async (args: Record<string, unknown>, extra: { sessionId?: string; signal: AbortSignal }) =>
          this.handle(definition, services, args, extra),
      );
      this.registered.push({
        name: definition.name,
        title: definition.title,
        readOnly: definition.annotations.readOnlyHint,
      });
    }
    services.logger.info("mcp tools registered", { count: this.registered.length });
  }

  private resolveDefinitions(): ToolDefinition[] {
    return typeof this.definitions === "function" ? this.definitions() : this.definitions;
  }

  private async handle(
    definition: ToolDefinition,
    services: Services,
    args: Record<string, unknown>,
    extra: { sessionId?: string; signal: AbortSignal },
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }> {
    const correlationId = createId("mcp");
    const actor = extra.sessionId ? `mcp-session:${shortId(extra.sessionId)}` : "mcp-client";
    const startedAt = Date.now();
    services.metrics.increment("mcp_tool_requests_total", 1, { tool: definition.name });
    const ctx: ToolContext = { services, actor, correlationId, signal: extra.signal };

    try {
      const result = await definition.handler(args, ctx);
      const text = this.serialize(services.redactor, result);
      services.auditLog.record({
        tenant: this.resolveTenant(services, args),
        actor,
        tool: definition.name,
        target: this.describeTarget(args),
        action: definition.annotations.readOnlyHint ? "read" : "mutate",
        decision: "allowed",
        success: true,
        correlationId,
      });
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const shape = this.toStructuredError(services.redactor, error, correlationId);
      services.metrics.increment("mcp_tool_failures_total", 1, {
        tool: definition.name,
        code: shape.code,
      });
      if (shape.code === "INTERNAL") {
        services.logger.error("tool failed", {
          tool: definition.name,
          correlationId,
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
      } else {
        services.logger.warn("tool rejected", {
          tool: definition.name,
          correlationId,
          code: shape.code,
          message: shape.message,
        });
      }
      services.auditLog.record({
        tenant: this.resolveTenant(services, args),
        actor,
        tool: definition.name,
        target: this.describeTarget(args),
        action: definition.annotations.readOnlyHint ? "read" : "mutate",
        decision: shape.code === "POLICY_DENIED" || shape.code === "RISK_TOO_HIGH" ? "denied" : "info",
        success: false,
        error: shape,
        correlationId,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ error: shape }) }],
        isError: true,
      };
    } finally {
      services.metrics.observe("mcp_tool_duration_ms", Date.now() - startedAt, {
        tool: definition.name,
      });
    }
  }

  private serialize(redactor: RedactionEngine, result: unknown): string {
    let text: string;
    try {
      text = JSON.stringify(result, null, 2);
    } catch (error) {
      throw new PteroOpsError("INTERNAL", "Tool result could not be serialized", {
        cause: error,
      });
    }
    const redacted = redactor.redact(text);
    if (redacted.length > MAX_PAYLOAD_CHARS) {
      throw new ValidationError(
        "Tool result exceeded the payload limit; narrow the query (smaller window, fewer lines, or a specific server).",
        { details: { sizeChars: redacted.length, limitChars: MAX_PAYLOAD_CHARS } },
      );
    }
    return redacted;
  }

  private toStructuredError(
    redactor: RedactionEngine,
    error: unknown,
    correlationId: string,
  ): StructuredErrorShape {
    if (error instanceof PteroOpsError) {
      return redactor.redactObject(error.toShape(correlationId));
    }
    const message = error instanceof Error ? error.message : String(error);
    return redactor.redactObject({
      code: "INTERNAL" as const,
      message: `Unexpected internal error: ${message}`,
      retryable: false,
      correlationId,
    });
  }

  private resolveTenant(services: Services, args: Record<string, unknown>): string {
    const server = args.server;
    if (typeof server === "string" && server.includes("/")) {
      const panelName = server.split("/")[0]!;
      const panel = services.panels.tryGet(panelName);
      if (panel) return panel.tenant;
    }
    if (typeof args.panel === "string") {
      const panel = services.panels.tryGet(args.panel);
      if (panel) return panel.tenant;
    }
    return services.panels.default().tenant;
  }

  private describeTarget(args: Record<string, unknown>): string | null {
    if (typeof args.server === "string") return args.server;
    if (typeof args.panel === "string") return `panel:${args.panel}`;
    if (typeof args.id === "string") return `incident:${args.id}`;
    return null;
  }
}