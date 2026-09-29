import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockPanel } from "../helpers/mock-panel.js";
import { createTestServices, type TestServicesHandle } from "../helpers/services.js";
import type { ServerRef } from "../../src/shared/types.js";

let panel: MockPanel;
let handle: TestServicesHandle;
let ref: ServerRef;

beforeEach(async () => {
  panel = await MockPanel.start({
    servers: [
      {
        identifier: "survival",
        name: "Survival",
        state: "running",
        files: {
          "/": ["server.properties", "plugins"],
          "/server.properties": "motd=A\nview-distance=10",
          "/plugins": ["EssentialsX.jar", "EssentialsX-2.jar", "LuckPerms.jar"],
        },
      },
      {
        identifier: "creative",
        name: "Creative",
        state: "running",
        files: {
          "/": ["server.properties", "plugins"],
          "/server.properties": "motd=B\nview-distance=6",
          "/plugins": ["EssentialsX.jar", "LuckPerms.jar"],
        },
      },
    ],
  });
  handle = await createTestServices({ panelUrl: panel.url });
  ref = { tenant: "local", panel: "mock", serverId: "survival" };
  const now = Date.now();
  for (const serverId of ["survival", "creative"]) {
    handle.services.serverCache.upsert({
      ref: { tenant: "local", panel: "mock", serverId },
      uuid: null,
      name: serverId,
      state: "running",
      application: null,
      now,
    });
  }
});

afterEach(async () => {
  await handle.close();
  await panel.close();
});

describe("DriftAnalyzer", () => {
  it("detects configuration drift and plugin duplicates across a group", async () => {
    const report = await handle.services.drift.compareGroup("minecraft", [
      ref,
      { tenant: "local", panel: "mock", serverId: "creative" },
    ]);
    expect(report.members).toHaveLength(2);
    const serverPropertiesDrift = report.fileDrifts.find((drift) => drift.file === "server.properties");
    expect(serverPropertiesDrift).toBeDefined();
    expect(serverPropertiesDrift!.outliers).toHaveLength(1);
    expect(serverPropertiesDrift!.outliers[0]!.diff).toContain("view-distance");
    expect(report.summary).toContain("differ");
  });

  it("reports no drift for identical members", async () => {
    panel.setFile("creative", "/server.properties", "motd=A\nview-distance=10");
    const report = await handle.services.drift.compareGroup("minecraft", [
      ref,
      { tenant: "local", panel: "mock", serverId: "creative" },
    ]);
    expect(report.fileDrifts).toHaveLength(0);
    expect(report.summary).toContain("no drift");
  });

  it("requires at least two members", async () => {
    const report = await handle.services.drift.compareGroup("minecraft", [ref]);
    expect(report.missingEvidence.length).toBeGreaterThan(0);
    expect(report.summary).toContain("fewer than two");
  });
});
