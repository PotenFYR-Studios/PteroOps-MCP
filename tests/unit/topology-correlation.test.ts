import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockPanel } from "../helpers/mock-panel.js";
import { createTestServices, type TestServicesHandle } from "../helpers/services.js";
import type { ServerRef } from "../../src/shared/types.js";

let panel: MockPanel;
let handle: TestServicesHandle;
const refs: ServerRef[] = [];

beforeEach(async () => {
  panel = await MockPanel.start({
    servers: [
      { identifier: "survival", name: "Survival", state: "offline", node: "node-1" },
      { identifier: "creative", name: "Creative", state: "offline", node: "node-1" },
      { identifier: "lobby", name: "Lobby", state: "running", node: "node-2" },
    ],
  });
  handle = await createTestServices({ panelUrl: panel.url });
  for (const serverId of ["survival", "creative", "lobby"]) {
    refs.push({ tenant: "local", panel: "mock", serverId });
  }
  const now = Date.now();
  for (const ref of refs) {
    await handle.services.serverCache.upsert({
      ref,
      uuid: null,
      name: ref.serverId,
      state: null,
      application: null,
      now,
    });
  }
  await handle.services.topology.rebuild();
});

afterEach(async () => {
  await handle.close();
  await panel.close();
});

describe("TopologyBuilder", () => {
  it("builds nodes and edges from panels, servers, nodes and allocations", async () => {
    const graph = await handle.services.topology.graph();
    const kinds = new Set(graph.nodes.map((node) => node.kind));
    expect(kinds.has("panel")).toBe(true);
    expect(kinds.has("server")).toBe(true);
    expect(kinds.has("node")).toBe(true);
    const hostingEdges = graph.edges.filter((edge) => edge.relation === "hosts");
    expect(hostingEdges.length).toBe(3);
    const nodeOne = graph.nodes.find((node) => node.kind === "node" && node.label === "node-1");
    expect(nodeOne).toBeDefined();
  });

  it("returns neighborhoods for a focus node", async () => {
    const graph = await handle.services.topology.graph();
    const survival = graph.nodes.find((node) => node.label === "Survival")!;
    const neighbors = await handle.services.topology.neighbors(survival.id, 1);
    expect(neighbors.nodes.some((node) => node.label === "node-1")).toBe(true);
    expect(neighbors.nodes.some((node) => node.kind === "panel")).toBe(true);
  });
});

describe("IncidentCorrelationEngine", () => {
  it("correlates failures on a shared node into one parent incident", async () => {
    const report = await handle.services.correlator.investigate({ panel: "mock" }, {});
    expect(report.serversExamined).toBe(3);
    expect(report.failing.length).toBe(2);
    expect(report.sharedFindings.sameNode).toHaveLength(1);
    expect(report.sharedFindings.sameNode[0]!.node).toBe("node-1");
    expect(report.sharedFindings.sameNode[0]!.servers.sort()).toEqual([
      "mock/creative",
      "mock/survival",
    ]);
    expect(report.parentIncidentId).not.toBeNull();
    expect(report.recommendation).toContain("node-1");
    expect(report.confidence).toBeGreaterThan(0.5);

    const incident = await handle.services.incidentService.get("local", report.parentIncidentId!);
    expect(incident.title).toContain("node");
    expect(incident.data.tags).toContain("correlated");
    expect(incident.data.symptoms.length).toBe(2);

    const power = panel.requestsFor("/power");
    expect(power).toHaveLength(0);
  });

  it("deduplicates repeated investigations into the same parent incident", async () => {
    const first = await handle.services.correlator.investigate({ panel: "mock" }, {});
    const second = await handle.services.correlator.investigate({ panel: "mock" }, {});
    expect(second.parentIncidentId).toBe(first.parentIncidentId);
    expect(await handle.services.incidentService.countOpen("local")).toBe(1);
  });

  it("reports no correlation when failures do not share a domain", async () => {
    panel.setState("creative", "running");
    const report = await handle.services.correlator.investigate({ panel: "mock" }, {});
    expect(report.failing.length).toBe(1);
    expect(report.sharedFindings.sameNode).toHaveLength(0);
    expect(report.recommendation).toContain("survival");
  });
});
