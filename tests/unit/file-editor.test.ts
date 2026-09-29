import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockPanel } from "../helpers/mock-panel.js";
import { createTestServices, type TestServicesHandle } from "../helpers/services.js";
import type { ServerRef } from "../../src/shared/types.js";
import { sha256Hex } from "../../src/shared/hash.js";
import { StaleWriteError, ValidationError } from "../../src/shared/errors.js";

const FILE = "/server.properties";
const ORIGINAL = "motd=Survival\nmax-players=20\nview-distance=10";

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
        variables: [{ envVariable: "MEMORY", serverValue: "2048" }],
        files: {
          "/": ["server.properties", "server.jar", "plugins"],
          [FILE]: ORIGINAL,
          "/plugins": ["EssentialsX-2.20.1.jar"],
        },
        backups: [{ uuid: "backup-old", createdAt: new Date().toISOString(), bytes: 10 * 1024 * 1024 }],
      },
    ],
  });
  handle = await createTestServices({ panelUrl: panel.url });
  ref = { tenant: "local", panel: "mock", serverId: "survival" };
});

afterEach(async () => {
  await handle.close();
  await panel.close();
});

describe("SafeFileEditor", () => {
  it("reads a file with its hash", async () => {
    const inspection = await handle.services.fileEditor.inspect(ref, FILE);
    expect(inspection.hash).toBe(sha256Hex(ORIGINAL));
    expect(inspection.content).toBe(ORIGINAL);
  });

  it("previews a patch without writing", async () => {
    const preview = await handle.services.fileEditor.preview(ref, {
      path: FILE,
      expectedHash: sha256Hex(ORIGINAL),
      edits: [{ find: "view-distance=10", replace: "view-distance=6" }],
    });
    expect(preview.additions).toBe(1);
    expect(preview.removals).toBe(1);
    expect(preview.diff).toContain("-view-distance=10");
    expect(preview.diff).toContain("+view-distance=6");
    expect(panel.readFile("survival", FILE)).toBe(ORIGINAL);
  });

  it("applies a patch, verifies by re-read and snapshots the original", async () => {
    const result = await handle.services.fileEditor.apply(
      ref,
      {
        path: FILE,
        expectedHash: sha256Hex(ORIGINAL),
        edits: [{ find: "max-players=20", replace: "max-players=40" }],
      },
      { actor: "test", origin: "test", reason: "unit test" },
    );
    expect(result.verified).toBe(true);
    expect(result.snapshotId).not.toBeNull();
    const onDisk = panel.readFile("survival", FILE)!;
    expect(onDisk).toContain("max-players=40");
    expect(sha256Hex(onDisk)).toBe(result.afterHash);

    const snapshot = await handle.services.snapshotRepository.get(ref.tenant, result.snapshotId!);
    expect(snapshot?.content).toBe(ORIGINAL);

    const changes = await handle.services.changeRepository.list({ tenant: "local", action: "file_write" });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.beforeHash).toBe(result.beforeHash);
    expect(changes[0]!.afterHash).toBe(result.afterHash);
  });

  it("refuses stale writes when the file changed since it was read", async () => {
    const expectedHash = sha256Hex(ORIGINAL);
    panel.setFile("survival", FILE, `${ORIGINAL}\nops=Steve`);
    await expect(
      handle.services.fileEditor.apply(
        ref,
        { path: FILE, expectedHash, edits: [{ find: "max-players=20", replace: "max-players=40" }] },
        { actor: "test", origin: "test" },
      ),
    ).rejects.toThrowError(StaleWriteError);
  });

  it("refuses non-unique find text unless replaceAll is set", async () => {
    await expect(
      handle.services.fileEditor.preview(ref, {
        path: FILE,
        expectedHash: sha256Hex(ORIGINAL),
        edits: [{ find: "m", replace: "x" }],
      }),
    ).rejects.toThrowError(/matches .* times/);
  });

  it("reverts from a snapshot with verification", async () => {
    const applied = await handle.services.fileEditor.apply(
      ref,
      { path: FILE, expectedHash: sha256Hex(ORIGINAL), content: "completely different" },
      { actor: "test", origin: "test" },
    );
    const reverted = await handle.services.fileEditor.revert(
      ref,
      { path: FILE, snapshotId: applied.snapshotId!, expectedHash: applied.afterHash },
      { actor: "test", origin: "test" },
    );
    expect(reverted.verified).toBe(true);
    expect(panel.readFile("survival", FILE)).toBe(ORIGINAL);
    expect(reverted.snapshotId).not.toBeNull();
  });

  it("rejects reverting a snapshot for a different path", async () => {
    const applied = await handle.services.fileEditor.apply(
      ref,
      { path: FILE, expectedHash: sha256Hex(ORIGINAL), content: "x" },
      { actor: "test", origin: "test" },
    );
    await expect(
      handle.services.fileEditor.revert(
        ref,
        { path: "/other.properties", snapshotId: applied.snapshotId!, expectedHash: sha256Hex("x") },
        { actor: "test", origin: "test" },
      ),
    ).rejects.toThrowError(/not found/);
  });

  it("rejects patches larger than the policy limit", async () => {
    const big = `big=${"x".repeat(2_100_000)}`;
    await expect(
      handle.services.fileEditor.apply(
        ref,
        { path: FILE, expectedHash: sha256Hex(ORIGINAL), content: big },
        { actor: "test", origin: "test" },
      ),
    ).rejects.toThrowError(ValidationError);
  });
});
