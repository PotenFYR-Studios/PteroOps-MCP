import { beforeEach, describe, expect, it } from "vitest";
import { SqliteDatabase } from "../../src/persistence/sqlite/database.js";
import { MIGRATIONS } from "../../src/persistence/migrations.js";
import { IncidentRepository } from "../../src/persistence/repositories/incidents.js";
import { ChangeRepository } from "../../src/persistence/repositories/changes.js";
import { AuditRepository } from "../../src/persistence/repositories/audit.js";
import { IncidentService } from "../../src/incidents/service.js";
import { ChangeLedger } from "../../src/changes/ledger.js";
import { AuditLog } from "../../src/security/audit.js";
import { RedactionEngine } from "../../src/shared/redaction.js";
import { ValidationError } from "../../src/shared/errors.js";
import type { ServerRef } from "../../src/shared/types.js";

const ref: ServerRef = { tenant: "t1", panel: "prod", serverId: "survival" };
const T0 = 1_700_000_000_000;

let db: SqliteDatabase;
let incidents: IncidentService;
let ledger: ChangeLedger;
let audit: AuditLog;
let changeRepository: ChangeRepository;
let redactor: RedactionEngine;

beforeEach(async () => {
  db = await SqliteDatabase.inMemory(MIGRATIONS);
  let tick = 0;
  const clock = () => T0 + tick++ * 1000;
  incidents = new IncidentService(new IncidentRepository(db), undefined, clock);
  changeRepository = new ChangeRepository(db);
  ledger = new ChangeLedger(changeRepository, undefined, clock);
  redactor = new RedactionEngine();
  audit = new AuditLog(new AuditRepository(db), redactor, undefined, clock);
});

describe("IncidentService", () => {
  it("creates incidents with evidence", async () => {
    const { incident, deduped } = await incidents.open({
      ref,
      title: "Crash loop detected",
      summary: "3 short exits",
      severity: "critical",
      fingerprint: "fp-1",
      symptoms: ["OOM ×3"],
      evidence: [{ kind: "console", source: "console", summary: "OutOfMemoryError" }],
    });
    expect(deduped).toBe(false);
    expect(incident.state).toBe("detected");
    expect(await incidents.evidence(ref.tenant, incident.id)).toHaveLength(1);
  });

  it("deduplicates repeated fingerprints into the open incident", async () => {
    const first = await incidents.open({
      ref,
      title: "Failures detected",
      summary: "one",
      severity: "high",
      fingerprint: "fp-dup",
    });
    const second = await incidents.open({
      ref,
      title: "Failures detected",
      summary: "two",
      severity: "critical",
      fingerprint: "fp-dup",
      evidence: [{ kind: "console", source: "console", summary: "more evidence" }],
    });
    expect(second.deduped).toBe(true);
    expect(second.incident.id).toBe(first.incident.id);
    expect(second.incident.severity).toBe("critical");
    expect(await incidents.evidence(ref.tenant, first.incident.id)).toHaveLength(1);
    expect(await incidents.countOpen(ref.tenant)).toBe(1);
  });

  it("enforces the state machine", async () => {
    const { incident } = await incidents.open({
      ref,
      title: "t",
      summary: "s",
      severity: "medium",
      fingerprint: "fp-state",
    });
    const investigating = await incidents.transition(ref.tenant, incident.id, "investigating");
    expect(investigating.state).toBe("investigating");
    const diagnosed = await incidents.transition(ref.tenant, incident.id, "diagnosed");
    expect(diagnosed.state).toBe("diagnosed");
    await expect(
      incidents.transition(ref.tenant, incident.id, "verifying"),
    ).rejects.toThrowError(ValidationError);
    const resolved = await incidents.transition(ref.tenant, incident.id, "resolved");
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it("persists and rereads incidents across service instances", async () => {
    const { incident } = await incidents.open({
      ref,
      title: "Persistent",
      summary: "s",
      severity: "low",
      fingerprint: null,
    });
    const reopened = new IncidentService(new IncidentRepository(db));
    expect((await reopened.get(ref.tenant, incident.id)).title).toBe("Persistent");
  });

  it("keeps tenants isolated", async () => {
    await incidents.open({ ref, title: "t1 incident", summary: "s", severity: "low" });
    const otherTenant = await incidents.list({ tenant: "t2" });
    expect(otherTenant).toHaveLength(0);
  });

  it("finds similar incidents by fingerprint with recency bounds", async () => {
    await incidents.open({
      ref,
      title: "past",
      summary: "s",
      severity: "high",
      fingerprint: "fp-similar",
    });
    const similar = await incidents.similar(ref.tenant, ["fp-similar"], 30, 5);
    expect(similar).toHaveLength(1);
    const stale = await incidents.similar(ref.tenant, ["fp-similar"], 0, 5);
    expect(stale).toHaveLength(0);
  });
});

describe("ChangeLedger", () => {
  it("records changes with hashes and finds them around a timestamp", async () => {
    await ledger.record({
      ref,
      actor: "mcp-client",
      origin: "mcp:write_patch",
      action: "file_write",
      target: "/plugins/EssentialsX.jar",
      beforeHash: "aaa",
      afterHash: "bbb",
      result: "success",
      risk: "MEDIUM",
      ts: T0,
    });
    const around = await ledger.around(ref, T0 + 60_000, 5 * 60_000);
    expect(around).toHaveLength(1);
    expect(around[0]!.afterHash).toBe("bbb");
    const outside = await ledger.around(ref, T0 + 10 * 60_000, 60_000);
    expect(outside).toHaveLength(0);
  });

  it("counts actions in a window for restart budgets", async () => {
    for (let i = 0; i < 3; i++) {
      await ledger.record({
        ref,
        actor: "a",
        origin: "mcp",
        action: "restart_server",
        target: "power:restart",
        result: "success",
        ts: T0 + i,
      });
    }
    expect(await ledger.countAction(ref, "restart_server", 3_600_000)).toBe(3);
  });

  it("links changes to incidents", async () => {
    await ledger.record({
      ref,
      actor: "a",
      origin: "mcp",
      action: "file_write",
      target: "/config.yml",
      result: "success",
      incidentId: "inc-42",
      ts: T0,
    });
    expect(await ledger.byIncident("inc-42")).toHaveLength(1);
  });

  it("isolates changes by tenant in listings", async () => {
    await ledger.record({
      ref,
      actor: "a",
      origin: "mcp",
      action: "file_write",
      target: "/x",
      result: "success",
      ts: T0,
    });
    const other = await changeRepository.list({ tenant: "t2" });
    expect(other).toHaveLength(0);
  });
});

describe("AuditLog", () => {
  it("appends redacted audit events", async () => {
    audit.record({
      tenant: ref.tenant,
      actor: "mcp-client",
      tool: "ptero_send_command",
      target: "prod/survival",
      action: "mutate",
      decision: "allowed",
      success: true,
      correlationId: "corr-1",
      details: { command: "say hello", token: "ptlc_abcdefghijklmnopqrstuvwx" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const events = await audit.list({ tenant: ref.tenant, correlationId: "corr-1" });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toContain("ptlc_");
    expect(events[0]!.success).toBe(true);
  });

  it("redacts secrets inside error shapes", async () => {
    audit.record({
      tenant: ref.tenant,
      actor: "mcp-client",
      tool: "ptero_read_file",
      action: "read",
      decision: "info",
      success: false,
      error: { code: "INTERNAL", message: "leaked ptla_abcdefghijklmnopqrstuvwx in message" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const events = await audit.list({ tenant: ref.tenant });
    expect(JSON.stringify(events)).not.toContain("ptla_");
  });

  it("never throws when the repository fails", async () => {
    const brokenDb = await SqliteDatabase.inMemory(MIGRATIONS);
    const brokenAudit = new AuditLog(new AuditRepository(brokenDb), redactor);
    await brokenDb.close();
    expect(() =>
      brokenAudit.record({
        tenant: "t",
        actor: "a",
        tool: "t",
        action: "read",
        decision: "info",
        success: true,
      }),
    ).not.toThrow();
  });
});
