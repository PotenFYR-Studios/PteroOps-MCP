import { beforeEach, describe, expect, it } from "vitest";
import { SqliteDatabase } from "../../src/persistence/sqlite/database.js";
import { MIGRATIONS } from "../../src/persistence/migrations.js";
import { ConsoleEventRepository, FingerprintRepository } from "../../src/persistence/repositories/console-events.js";
import type { ServerRef } from "../../src/shared/types.js";

const ref: ServerRef = { tenant: "t1", panel: "prod", serverId: "survival" };
const other: ServerRef = { tenant: "t2", panel: "prod", serverId: "survival" };
const T0 = 1_700_000_000_000;

let db: SqliteDatabase;
let repository: ConsoleEventRepository;
let fingerprints: FingerprintRepository;

beforeEach(async () => {
  db = await SqliteDatabase.inMemory(MIGRATIONS);
  repository = new ConsoleEventRepository(db);
  fingerprints = new FingerprintRepository(db);
});

async function insertLine(
  line: string,
  ts: number,
  severity: "info" | "warn" | "error" | "fatal" = "info",
  fingerprint: string | null = null,
): Promise<void> {
  await repository.insert([
    {
      ref,
      ts,
      raw: line,
      normalized: line,
      severity,
      subsystem: null,
      exceptionType: null,
      fingerprint,
      incidentId: null,
      correlationId: null,
    },
  ]);
}

describe("ConsoleEventRepository", () => {
  it("queries a time window in latest-first order by default", async () => {
    await insertLine("boot 1", T0);
    await insertLine("boot 2", T0 + 1000);
    await insertLine("boot 3", T0 + 2000);
    const page = await repository.query({ ref, since: T0, limit: 10 });
    expect(page.events.map((event) => event.normalized)).toEqual(["boot 3", "boot 2", "boot 1"]);
  });

  it("supports first-occurrence mode", async () => {
    await insertLine("error alpha", T0 + 5000, "error", "fp1");
    await insertLine("error alpha", T0 + 6000, "error", "fp1");
    const first = await repository.firstOccurrence(ref, { fingerprint: "fp1" });
    expect(first?.ts).toBe(T0 + 5000);
  });

  it("supports 'before the crash' context navigation", async () => {
    await insertLine("normal operation", T0);
    await insertLine("warning signs", T0 + 1000, "warn");
    await insertLine("the crash", T0 + 2000, "fatal");
    await insertLine("aftermath", T0 + 3000, "error");
    const page = await repository.query({ ref, mode: "before", around: T0 + 2000, limit: 10 });
    expect(page.events.map((event) => event.normalized)).toEqual(["normal operation", "warning signs"]);
  });

  it("filters by severity and text case-insensitively", async () => {
    await insertLine("all good", T0, "info");
    await insertLine("all bad: Disk Failure", T0 + 1000, "error");
    const page = await repository.query({ ref, severities: ["error", "fatal"], text: "disk failure", limit: 10 });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.normalized).toContain("Disk Failure");
  });

  it("filters with regex", async () => {
    await insertLine("player Steve joined", T0, "info");
    await insertLine("player Alex joined", T0 + 1000, "info");
    const page = await repository.query({ ref, regex: "Steve", limit: 10 });
    expect(page.events).toHaveLength(1);
  });

  it("enforces limits and reports truncation", async () => {
    for (let i = 0; i < 50; i++) await insertLine(`line ${i}`, T0 + i);
    const page = await repository.query({ ref, limit: 10 });
    expect(page.events).toHaveLength(10);
    expect(page.truncated).toBe(true);
  });

  it("never returns events of another tenant", async () => {
    await insertLine("tenant one data", T0);
    await repository.insert([
      {
        ref: other,
        ts: T0,
        raw: "tenant two data",
        normalized: "tenant two data",
        severity: "info",
        subsystem: null,
        exceptionType: null,
        fingerprint: null,
        incidentId: null,
        correlationId: null,
      },
    ]);
    const page = await repository.query({ ref, limit: 10 });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.normalized).toBe("tenant one data");
  });

  it("counts severities within a window", async () => {
    await insertLine("e1", T0, "error");
    await insertLine("e2", T0 + 1000, "fatal");
    await insertLine("i1", T0 + 2000, "info");
    await insertLine("old", T0 - 10_000, "error");
    expect(await repository.countSeverity(ref, T0, ["error", "fatal"])).toBe(2);
  });

  it("prunes by retention hours and max rows", async () => {
    for (let i = 0; i < 100; i++) await insertLine(`line ${i}`, T0 + i * 1000);
    const deletedByCount = await repository.prune(ref, {
      retentionHours: 24 * 365,
      maxEvents: 10,
      now: T0 + 100_000,
    });
    expect(deletedByCount).toBe(90);
    const remaining = await repository.query({ ref, limit: 100 });
    expect(remaining.events).toHaveLength(10);
    const deletedByAge = await repository.prune(ref, {
      retentionHours: 1,
      maxEvents: 1000,
      now: T0 + 3_700_000,
    });
    expect(deletedByAge).toBe(10);
    expect((await repository.query({ ref, limit: 100 })).events).toHaveLength(0);
  });
});

describe("FingerprintRepository", () => {
  it("upserts counts with first/last seen and keeps the first sample", async () => {
    await fingerprints.upsert({
      ref,
      fingerprint: "fp-oom",
      exceptionType: "java.lang.OutOfMemoryError",
      severity: "fatal",
      subsystem: "memory",
      ts: T0,
      sample: "first sample",
    });
    await fingerprints.upsert({
      ref,
      fingerprint: "fp-oom",
      exceptionType: "java.lang.OutOfMemoryError",
      severity: "fatal",
      subsystem: "memory",
      ts: T0 + 60_000,
      sample: "second sample",
    });
    const record = await fingerprints.get(ref, "fp-oom");
    expect(record?.count).toBe(2);
    expect(record?.firstSeen).toBe(T0);
    expect(record?.lastSeen).toBe(T0 + 60_000);
    expect(record?.sample).toBe("first sample");
  });

  it("returns top issues ordered by count", async () => {
    await fingerprints.upsert({ ref, fingerprint: "a", exceptionType: null, severity: "error", subsystem: null, ts: T0, sample: "a" });
    await fingerprints.upsert({ ref, fingerprint: "b", exceptionType: null, severity: "error", subsystem: null, ts: T0, sample: "b" });
    await fingerprints.upsert({ ref, fingerprint: "b", exceptionType: null, severity: "error", subsystem: null, ts: T0 + 1, sample: "b" });
    const top = await fingerprints.top(ref, T0 - 1, 10);
    expect(top[0]!.fingerprint).toBe("b");
    expect(top[0]!.count).toBe(2);
  });

  it("links incidents and prunes old fingerprints", async () => {
    await fingerprints.upsert({ ref, fingerprint: "x", exceptionType: null, severity: "error", subsystem: null, ts: T0, sample: "x" });
    await fingerprints.linkIncident(ref, "x", "inc-1");
    expect((await fingerprints.get(ref, "x"))?.incidentId).toBe("inc-1");
    const deleted = await fingerprints.prune(ref, T0 + 10_000);
    expect(deleted).toBe(1);
  });
});
