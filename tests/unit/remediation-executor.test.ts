import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockPanel } from "../helpers/mock-panel.js";
import { createTestServices, type TestServicesHandle } from "../helpers/services.js";
import { PolicyDeniedError } from "../../src/shared/errors.js";
import { sha256Hex } from "../../src/shared/hash.js";
import type { ServerRef } from "../../src/shared/types.js";

const FILE = "/server.properties";
const ORIGINAL = "motd=Survival\nmax-players=20";

let panel: MockPanel;
let handle: TestServicesHandle;
let ref: ServerRef;

async function setup(): Promise<void> {
  panel = await MockPanel.start({
    servers: [
      {
        identifier: "survival",
        name: "Survival",
        state: "running",
        variables: [{ envVariable: "MEMORY", serverValue: "2048" }],
        files: {
          "/": ["server.properties", "server.jar", "plugins"],
          [FILE]: ORIGINAL,
          "/plugins": ["EssentialsX-2.20.1.jar"],
        },
      },
    ],
  });
  handle = await createTestServices({ panelUrl: panel.url });
  ref = { tenant: "local", panel: "mock", serverId: "survival" };
  const remediation = handle.services.config.remediation;
  remediation.healthPollSeconds = 1;
  remediation.stabilizationSeconds = 0;
  remediation.healthTimeoutSeconds = 5;
  handle.services.consoleService.ingest(ref, "Server marked as running", Date.now() - 60_000);
  handle.services.consoleService.ingest(
    ref,
    'Done (12.345s)! For help, type "help"',
    Date.now() - 55_000,
  );
  await handle.services.consoleService.flush();
}

beforeEach(setup);

afterEach(async () => {
  await handle.close();
  await panel.close();
});

describe("RemediationExecutor", () => {
  it("executes a file edit transaction and resolves the incident", async () => {
    const services = handle.services;
    const incident = (await services.incidentService.open({
      ref,
      title: "Player cap issue",
      summary: "players cannot join",
      severity: "medium",
      fingerprint: "test-cap",
    })).incident;

    const { plan } = await services.planner.buildFileEditPlan(ref, {
      path: FILE,
      edits: [{ find: "max-players=20", replace: "max-players=40" }],
      reason: "raise player cap",
      incidentId: incident.id,
    });
    expect(plan.requiresApproval).toBe(true);
    expect(plan.rollbackStrategy.length).toBeGreaterThan(0);

    const approval = await services.approvalService.propose({
      ref,
      plan,
      proposedBy: "test",
    });
    await services.approvalService.approve("local", approval.id, "operator");

    const report = await services.executor.execute({
      plan,
      actor: "test",
      approvalId: approval.id,
    });

    expect(report.success).toBe(true);
    expect(report.state).toBe("succeeded");
    expect(report.healthAfter).toBe("healthy");
    expect(panel.readFile("survival", FILE)).toContain("max-players=40");

    const changes = await services.changeRepository.list({
      tenant: "local",
      action: "file_write",
    });
    expect(changes).toHaveLength(1);

    const executed = await services.approvalService.get("local", approval.id);
    expect(executed.state).toBe("executed");

    const updatedIncident = await services.incidentService.get("local", incident.id);
    expect(updatedIncident.state).toBe("resolved");
    expect(updatedIncident.data.remediationAttempts).toHaveLength(1);
    expect(updatedIncident.data.verifications[0]!.passed).toBe(true);

    const record = await services.remediationRepository.get("local", plan.id);
    expect(record?.state).toBe("succeeded");
    expect((await services.remediationRepository.steps(plan.id)).length).toBeGreaterThan(3);
  });

  it("rolls back automatically when health does not recover", async () => {
    const services = handle.services;
    const plan = await services.planner.buildStartupVariablePlan(ref, {
      key: "MEMORY",
      value: "4096",
      reason: "raise memory",
    });
    const approval = await services.approvalService.propose({ ref, plan, proposedBy: "test" });
    await services.approvalService.approve("local", approval.id, "operator");

    panel.setState("survival", "offline");
    const report = await services.executor.execute({
      plan,
      actor: "test",
      approvalId: approval.id,
    });

    expect(report.success).toBe(false);
    expect(report.state).toBe("rolled_back");
    expect(report.rolledBack).toBe(true);
    expect(report.rollbackVerified).toBe(true);

    const variable = panel.servers.get("survival")!.variables!.find(
      (candidate) => candidate.envVariable === "MEMORY",
    );
    expect(variable?.serverValue).toBe("2048");

    const record = await services.remediationRepository.get("local", plan.id);
    expect(record?.state).toBe("rolled_back");
    const steps = await services.remediationRepository.steps(plan.id);
    expect(steps.some((step) => step.kind === "rollback" && step.status === "ok")).toBe(true);
  });

  it("dry-run executes nothing but reports the steps", async () => {
    const services = handle.services;
    const { plan } = await services.planner.buildFileEditPlan(ref, {
      path: FILE,
      content: "replaced entirely",
      reason: "test dry-run",
    });
    const approval = await services.approvalService.propose({ ref, plan, proposedBy: "test" });
    const report = await services.executor.execute({
      plan,
      actor: "test",
      approvalId: approval.id,
      dryRun: true,
    });
    expect(report.dryRun).toBe(true);
    expect(report.success).toBe(true);
    expect(panel.readFile("survival", FILE)).toBe(ORIGINAL);
    expect(
      await services.changeRepository.list({ tenant: "local", action: "file_write" }),
    ).toHaveLength(0);
  });

  it("refuses execution without an approval for approval-required plans", async () => {
    const services = handle.services;
    const plan = await services.planner.buildRestartPlan(ref, { reason: "test" });
    const approval = await services.approvalService.propose({ ref, plan, proposedBy: "test" });
    await expect(
      services.executor.execute({ plan, actor: "test" }),
    ).rejects.toThrowError(PolicyDeniedError);
    await expect(
      services.executor.execute({ plan, actor: "test", approvalId: approval.id }),
    ).rejects.toThrowError(/pending/);
  });

  it("fails safely when the file changed between plan and execution", async () => {
    const services = handle.services;
    const { plan } = await services.planner.buildFileEditPlan(ref, {
      path: FILE,
      edits: [{ find: "max-players=20", replace: "max-players=40" }],
      reason: "stale test",
    });
    const approval = await services.approvalService.propose({ ref, plan, proposedBy: "test" });
    await services.approvalService.approve("local", approval.id, "operator");
    panel.setFile("survival", FILE, `${ORIGINAL}\nchanged-by-human=true`);

    const report = await services.executor.execute({
      plan,
      actor: "test",
      approvalId: approval.id,
    });
    expect(report.success).toBe(false);
    expect(report.state).toBe("failed");
    expect(report.steps.some((step) => step.status === "failed")).toBe(true);
    expect(panel.readFile("survival", FILE)).toContain("changed-by-human=true");
  });

  it("records rollback of a succeeded remediation via ptero_rollback path", async () => {
    const services = handle.services;
    const { plan } = await services.planner.buildFileEditPlan(ref, {
      path: FILE,
      edits: [{ find: "motd=Survival", replace: "motd=Welcome" }],
      reason: "rollback test",
    });
    const approval = await services.approvalService.propose({ ref, plan, proposedBy: "test" });
    await services.approvalService.approve("local", approval.id, "operator");
    const report = await services.executor.execute({ plan, actor: "test", approvalId: approval.id });
    expect(report.success).toBe(true);
    expect(panel.readFile("survival", FILE)).toContain("Welcome");

    const rollback = await services.executor.rollbackRemediation("local", plan.id, "operator");
    expect(rollback.success).toBe(true);
    expect(panel.readFile("survival", FILE)).toBe(ORIGINAL);
    expect(sha256Hex(panel.readFile("survival", FILE)!)).toBe(sha256Hex(ORIGINAL));
  });
});
