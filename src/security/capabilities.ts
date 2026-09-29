import {
  APPLICATION_CAPABILITIES,
  CAPABILITIES,
  CLIENT_CAPABILITIES,
  type Capability,
} from "../shared/types.js";

export type KeyKind = "client" | "application" | "unknown";

export function detectKeyKind(key: string | undefined): KeyKind {
  if (!key) return "unknown";
  if (key.startsWith("ptlc_")) return "client";
  if (key.startsWith("ptla_")) return "application";
  return "unknown";
}

export interface PanelCredentials {
  clientKey?: string;
  applicationKey?: string;
}

export function capabilitiesForCredentials(credentials: PanelCredentials): Set<Capability> {
  const capabilities = new Set<Capability>();
  if (credentials.clientKey) {
    for (const capability of CLIENT_CAPABILITIES) capabilities.add(capability);
  }
  if (credentials.applicationKey) {
    for (const capability of APPLICATION_CAPABILITIES) capabilities.add(capability);
  }
  return capabilities;
}

export function credentialModes(credentials: PanelCredentials): KeyKind[] {
  const modes: KeyKind[] = [];
  const client = detectKeyKind(credentials.clientKey);
  const application = detectKeyKind(credentials.applicationKey);
  if (credentials.clientKey) modes.push(client === "unknown" ? "client" : client);
  if (credentials.applicationKey) modes.push(application === "unknown" ? "application" : application);
  return modes;
}

export function keyKindWarning(credentials: PanelCredentials): string[] {
  const warnings: string[] = [];
  if (credentials.clientKey && detectKeyKind(credentials.clientKey) === "unknown") {
    warnings.push("clientKey does not start with ptlc_; treating it as a client key");
  }
  if (credentials.applicationKey && detectKeyKind(credentials.applicationKey) === "unknown") {
    warnings.push("applicationKey does not start with ptla_; treating it as an application key");
  }
  return warnings;
}

export interface CapabilityRequirement {
  anyOf?: readonly Capability[];
  allOf?: readonly Capability[];
}

export function satisfiesCapabilities(
  available: ReadonlySet<Capability>,
  requirement: CapabilityRequirement | undefined,
): boolean {
  if (!requirement) return true;
  if (requirement.allOf && !requirement.allOf.every((capability) => available.has(capability))) {
    return false;
  }
  if (requirement.anyOf && !requirement.anyOf.some((capability) => available.has(capability))) {
    return false;
  }
  return true;
}

export function missingCapabilities(
  available: ReadonlySet<Capability>,
  requirement: CapabilityRequirement | undefined,
): Capability[] {
  if (!requirement) return [];
  const missing: Capability[] = [];
  for (const capability of requirement.allOf ?? []) {
    if (!available.has(capability)) missing.push(capability);
  }
  if (requirement.anyOf && !requirement.anyOf.some((capability) => available.has(capability))) {
    missing.push(...requirement.anyOf);
  }
  return missing;
}

export function describeCapabilities(): readonly Capability[] {
  return CAPABILITIES;
}
