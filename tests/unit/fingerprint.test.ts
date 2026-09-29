import { describe, expect, it } from "vitest";
import { fingerprintOf, normalizeForFingerprint, shortHash } from "../../src/shared/hash.js";

describe("fingerprinting", () => {
  it("collapses numbers, UUIDs, IPs, hex, quoted strings and paths", () => {
    const a = "Player Steve teleported to 123,64,-456 in world_nether (uuid 550e8400-e29b-41d4-a716-446655440000)";
    const b = "Player Alex teleported to 789,12,-3 in world_nether (uuid f47ac10b-58cc-4372-a567-0e02b2c3d479)";
    expect(normalizeForFingerprint(a).replace(/Steve|Alex/, "X")).toBe(
      normalizeForFingerprint(b).replace(/Steve|Alex/, "X"),
    );
  });

  it("produces identical fingerprints for identical errors with different values", () => {
    const first = "java.lang.OutOfMemoryError: Java heap space at net.minecraft.server.ChunkMap.tick(ChunkMap.java:1234)";
    const second = "java.lang.OutOfMemoryError: Java heap space at net.minecraft.server.ChunkMap.tick(ChunkMap.java:9876)";
    expect(fingerprintOf(first)).toBe(fingerprintOf(second));
  });

  it("keeps genuinely different errors distinct", () => {
    const oom = fingerprintOf("java.lang.OutOfMemoryError: Java heap space");
    const exception = fingerprintOf(
      "java.lang.IllegalArgumentException: Name cannot be longer than 16 characters",
    );
    expect(oom).not.toBe(exception);
  });

  it("is stable across repeated calls", () => {
    const text = "Failed to bind to port 25565: Address already in use";
    expect(fingerprintOf(text)).toBe(fingerprintOf(text));
    expect(shortHash(text)).toBe(shortHash(text));
  });

  it("strips IPv4 addresses", () => {
    const normalized = normalizeForFingerprint("Connection refused to 10.0.0.12:3306 from 192.168.1.5");
    expect(normalized).not.toContain("10.0.0.12");
    expect(normalized).not.toContain("192.168.1.5");
  });

  it("collapses Windows and POSIX paths", () => {
    const posix = normalizeForFingerprint("could not open /home/container/plugins/essentialsx/config.yml");
    const windows = normalizeForFingerprint("could not open C:\\Users\\admin\\plugins\\essentialsx\\config.yml");
    expect(posix).toContain("path");
    expect(windows).toContain("path");
  });

  it("caps extremely long lines", () => {
    const long = "x".repeat(2000);
    expect(normalizeForFingerprint(long).length).toBeLessThanOrEqual(512);
  });
});
