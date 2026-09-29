import { describe, expect, it } from "vitest";
import {
  capabilitiesForCredentials,
  detectKeyKind,
  satisfiesCapabilities,
} from "../../src/security/capabilities.js";

describe("capability registry", () => {
  it("detects ptlc_ and ptla_ key kinds", () => {
    expect(detectKeyKind("ptlc_abc123")).toBe("client");
    expect(detectKeyKind("ptla_abc123")).toBe("application");
    expect(detectKeyKind("weird_key")).toBe("unknown");
    expect(detectKeyKind(undefined)).toBe("unknown");
  });

  it("grants client capabilities for a client key only", () => {
    const caps = capabilitiesForCredentials({ clientKey: "ptlc_x" });
    expect(caps.has("client.server.read")).toBe(true);
    expect(caps.has("client.console.write")).toBe(true);
    expect(caps.has("application.servers.read")).toBe(false);
  });

  it("grants application capabilities for an application key only", () => {
    const caps = capabilitiesForCredentials({ applicationKey: "ptla_x" });
    expect(caps.has("application.servers.read")).toBe(true);
    expect(caps.has("client.server.read")).toBe(false);
  });

  it("unions capabilities when both keys are present", () => {
    const caps = capabilitiesForCredentials({ clientKey: "ptlc_x", applicationKey: "ptla_y" });
    expect(caps.has("client.files.write")).toBe(true);
    expect(caps.has("application.nodes.read")).toBe(true);
  });

  it("satisfies allOf and anyOf requirements", () => {
    const caps = capabilitiesForCredentials({ clientKey: "ptlc_x" });
    expect(satisfiesCapabilities(caps, { allOf: ["client.server.read"] })).toBe(true);
    expect(satisfiesCapabilities(caps, { allOf: ["client.server.read", "application.servers.write"] })).toBe(false);
    expect(
      satisfiesCapabilities(caps, { anyOf: ["application.servers.read", "client.server.read"] }),
    ).toBe(true);
    expect(satisfiesCapabilities(caps, undefined)).toBe(true);
  });
});
