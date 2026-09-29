import { describe, expect, it } from "vitest";
import { RedactionEngine, REDACTED } from "../../src/shared/redaction.js";

describe("RedactionEngine", () => {
  const engine = new RedactionEngine();

  it("redacts pterodactyl client and application keys", () => {
    const text = `clientKey=ptlc_abcdefghijklmnopqrstuvwx applicationKey=ptla_0123456789abcdefghijklmn`;
    const redacted = engine.redact(text);
    expect(redacted).not.toContain("ptlc_");
    expect(redacted).not.toContain("ptla_");
    expect(redacted).toContain(REDACTED);
  });

  it("redacts bearer tokens", () => {
    const redacted = engine.redact("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("redacts JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const redacted = engine.redact(`token=${jwt}`);
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("redacts multiline private keys", () => {
    const key = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const redacted = engine.redact(`key:\n${key}\ndone`);
    expect(redacted).not.toContain("MIIEowIBAAKCAQEA");
    expect(redacted).toContain("done");
  });

  it("redacts common third-party tokens", () => {
    const corpus = [
      "sk-abcdefghijklmnopqrstuvwxyz123456",
      "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      "AKIAIOSFODNN7EXAMPLE",
      "xoxb-1234567890-abcdefghijklm",
    ];
    for (const secret of corpus) {
      const redacted = engine.redact(`value: ${secret} end`);
      expect(redacted).not.toContain(secret);
      expect(redacted).toContain(REDACTED);
    }
  });

  it("redacts database URLs with credentials but keeps the scheme", () => {
    const redacted = engine.redact("mysql://admin:s3cr3t-password@db.internal:3306/panel");
    expect(redacted).not.toContain("s3cr3t-password");
    expect(redacted).toContain("mysql://");
  });

  it("redacts password assignments", () => {
    const redacted = engine.redact("password=SuperSecret123");
    expect(redacted).not.toContain("SuperSecret123");
  });

  it("redacts registered secrets even without a recognizable pattern", () => {
    const custom = new RedactionEngine();
    custom.registerSecret("my-custom-opaque-value-42");
    const redacted = custom.redact("the value is my-custom-opaque-value-42 ok");
    expect(redacted).not.toContain("my-custom-opaque-value-42");
  });

  it("deep-redacts objects including secret-like keys", () => {
    const payload = {
      server: "survival",
      credentials: "visible-but-sensitive",
      nested: {
        password: "hunter2",
        list: ["ptlc_abcdefghijklmnopqrstuvwx", { token: "abc.def.ghi" }],
      },
    };
    const redacted = engine.redactObject(payload);
    expect(redacted.nested.password).toBe(REDACTED);
    expect(redacted.nested.list[0]).toBe(REDACTED);
    expect(JSON.stringify(redacted)).not.toContain("hunter2");
    expect(JSON.stringify(redacted)).not.toContain("ptlc_");
  });

  it("never leaves configured key material in output", () => {
    const configured = new RedactionEngine();
    const key = "ptlc_THIS_IS_A_CONFIGURED_KEY_VALUE";
    configured.registerSecret(key);
    expect(configured.redact(`key is ${key}`)).not.toContain(key);
  });

  it("does not redact ordinary prose", () => {
    const text = "The server restarted after an unexpected connection reset at 12:00.";
    expect(engine.redact(text)).toBe(text);
  });

  it("handles cyclic objects without hanging", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const redacted = engine.redactObject(cyclic) as Record<string, unknown>;
    expect(redacted.name).toBe("loop");
  });
});
