import { describe, expect, it } from "vitest";
import { SqliteDatabase } from "../../src/persistence/sqlite/database.js";
import { MIGRATIONS } from "../../src/persistence/migrations.js";
import { ApprovalRepository } from "../../src/persistence/repositories/approvals.js";
import { ApprovalService } from "../../src/approvals/service.js";
import { ConfigSchema } from "../../src/config/schema.js";
import { PolicyDeniedError, ValidationError } from "../../src/shared/errors.js";
import type { RemediationPlan } from "../../src/remediation/types.js";

const T0 = 1_700_000_000_000;

async function buildService(clock: () => number, overrides: Record<string, unknown> = {}) {
  const config = ConfigSchema.parse({
    panels: { mock: { url: "https://panel.example.com", clientKey: "ptlc_test_key_123456" } },
    ...overrides,
  });
  const db = await SqliteDatabase.inMemory(MIGRATIONS);
  const repository = new ApprovalRepository(db);
  return { service: new ApprovalService(repository, config.approval, undefined, clock), repository, db };
}

function plan(ref: { tenant: string; panel: string; serverId: string }): RemediationPlan {
  return {
    id: "plan-1",
    ref,
    incidentId: null,
    reason: "test plan",
    actions: [],
    risk: "MEDIUM",
    expectedEffect: "nothing",
    rollbackStrategy: "none",
    requiresApproval: true,
    dryRunSummary: [],
    blastRadius: null,
    evidence: [],
    expiresAt: null,
    createdAt: T0,
  };
}

const ref = { tenant: "local", panel: "mock", serverId: "survival" };

describe("ApprovalService", () => {
  it("creates a pending proposal with expiry", async () => {
    const { service } = await buildService(() => T0);
    const record = await service.propose({ ref, plan: plan(ref), proposedBy: "mcp-client" });
    expect(record.state).toBe("proposed");
    expect(record.expiresAt).toBe(T0 + 120 * 60_000);
    expect(await service.list({ tenant: "local" })).toHaveLength(1);
  });

  it("approves, executes and refuses double execution", async () => {
    const { service } = await buildService(() => T0);
    const record = await service.propose({ ref, plan: plan(ref), proposedBy: "mcp-client" });
    const approved = await service.approve("local", record.id, "operator", "looks good");
    expect(approved.state).toBe("approved");
    expect((await service.assertUsable("local", record.id)).id).toBe(record.id);
    await service.markExecuted("local", record.id);
    await expect(service.assertUsable("local", record.id)).rejects.toThrowError(PolicyDeniedError);
    await expect(service.markExecuted("local", record.id)).rejects.toThrowError(ValidationError);
  });

  it("refuses execution of pending or rejected proposals", async () => {
    const { service } = await buildService(() => T0);
    const pending = await service.propose({ ref, plan: plan(ref), proposedBy: "mcp-client" });
    await expect(service.assertUsable("local", pending.id)).rejects.toThrowError(/still pending/);
    await service.reject("local", pending.id, "operator", "not now");
    await expect(service.assertUsable("local", pending.id)).rejects.toThrowError(/rejected/);
  });

  it("expires stale proposals automatically", async () => {
    let now = T0;
    const { service } = await buildService(() => now);
    const record = await service.propose({ ref, plan: plan(ref), proposedBy: "mcp-client" });
    now = T0 + 121 * 60_000;
    const expired = await service.expireStale();
    expect(expired).toBe(1);
    expect((await service.get("local", record.id)).state).toBe("expired");
    await expect(service.assertUsable("local", record.id)).rejects.toThrowError(/expired/);
  });

  it("cannot decide expired proposals", async () => {
    let now = T0;
    const { service } = await buildService(() => now);
    const record = await service.propose({ ref, plan: plan(ref), proposedBy: "mcp-client" });
    now = T0 + 121 * 60_000;
    await expect(service.approve("local", record.id, "operator")).rejects.toThrowError(
      ValidationError,
    );
    expect((await service.get("local", record.id)).state).toBe("expired");
  });

  it("isolates approvals by tenant", async () => {
    const { service } = await buildService(() => T0);
    const record = await service.propose({ ref, plan: plan(ref), proposedBy: "mcp-client" });
    expect(await service.list({ tenant: "other" })).toHaveLength(0);
    expect(await service.find("other", record.id)).toBeNull();
  });
});
