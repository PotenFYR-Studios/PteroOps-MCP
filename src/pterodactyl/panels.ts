import type { Capability } from "../shared/types.js";
import { CapabilityError, ConfigError } from "../shared/errors.js";
import type { PanelCredentials } from "../security/capabilities.js";
import { capabilitiesForCredentials, missingCapabilities, satisfiesCapabilities, type CapabilityRequirement } from "../security/capabilities.js";
import type { PterodactylClientApi } from "./client-api.js";
import type { PterodactylApplicationApi } from "./application-api.js";

export interface PanelConnection {
  name: string;
  tenant: string;
  url: string;
  credentials: PanelCredentials;
  capabilities: Set<Capability>;
  clientApi: PterodactylClientApi | null;
  applicationApi: PterodactylApplicationApi | null;
}

export function createPanelConnection(input: {
  name: string;
  tenant: string;
  url: string;
  credentials: PanelCredentials;
  clientApi: PterodactylClientApi | null;
  applicationApi: PterodactylApplicationApi | null;
}): PanelConnection {
  return {
    ...input,
    capabilities: capabilitiesForCredentials(input.credentials),
  };
}

export class PanelRegistry {
  private readonly panels: Map<string, PanelConnection>;

  constructor(
    panels: PanelConnection[],
    private readonly defaultPanelName: string,
  ) {
    this.panels = new Map(panels.map((panel) => [panel.name, panel]));
    if (!this.panels.has(defaultPanelName)) {
      throw new ConfigError(`Default panel "${defaultPanelName}" is not configured`);
    }
  }

  get(name?: string): PanelConnection {
    const key = name ?? this.defaultPanelName;
    const panel = this.panels.get(key);
    if (!panel) {
      throw new ConfigError(
        `Unknown panel "${key}" (configured: ${[...this.panels.keys()].join(", ")})`,
      );
    }
    return panel;
  }

  tryGet(name: string): PanelConnection | null {
    return this.panels.get(name) ?? null;
  }

  default(): PanelConnection {
    return this.get(this.defaultPanelName);
  }

  list(): PanelConnection[] {
    return [...this.panels.values()];
  }

  supports(name: string, requirement: CapabilityRequirement | undefined): boolean {
    const panel = this.panels.get(name);
    if (!panel) return false;
    return satisfiesCapabilities(panel.capabilities, requirement);
  }

  anySupports(requirement: CapabilityRequirement | undefined): boolean {
    if (!requirement) return true;
    return this.list().some((panel) => satisfiesCapabilities(panel.capabilities, requirement));
  }

  requireCapability(name: string | undefined, requirement: CapabilityRequirement | undefined): PanelConnection {
    const panel = this.get(name);
    if (satisfiesCapabilities(panel.capabilities, requirement)) return panel;
    const missing = missingCapabilities(panel.capabilities, requirement);
    throw new CapabilityError(
      missing.join(", ") || "unknown",
      `Panel "${panel.name}" is missing required capabilities: ${missing.join(", ")}`,
      {
        details: { panel: panel.name, missing },
        hint: "Add a suitable API key (ptlc_ for client operations, ptla_ for panel administration) to this panel's configuration.",
      },
    );
  }
}
