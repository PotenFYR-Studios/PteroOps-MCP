import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/loader.js";
import { ConfigError } from "../../src/shared/errors.js";

const env = {
  PTERO_PANEL_PROD_URL: "https://panel.example.com",
  PTERO_PANEL_PROD_CLIENT_KEY: "ptlc_prod_key_123456789",
  PTERO_PANEL_PROD_APPLICATION_KEY: "ptla_prod_key_123456789",
  PTERO_PANEL_STAGING_URL: "https://staging.example.com/",
  PTERO_PANEL_STAGING_CLIENT_KEY: "ptlc_staging_key_123456789",
  PTERO_DEFAULT_PANEL: "prod",
  PTERO_LOG_LEVEL: "debug",
  PTERO_DATA_DIR: "/tmp/pteroops-test",
};

describe("config loader", () => {
  it("bootstraps panels from environment variables", () => {
    const { config } = loadConfig({ env, cwd: "Z:\\definitely-not-a-real-dir" });
    expect(Object.keys(config.panels).sort()).toEqual(["prod", "staging"]);
    expect(config.panels.prod!.url).toBe("https://panel.example.com");
    expect(config.panels.prod!.clientKey).toBe("ptlc_prod_key_123456789");
    expect(config.panels.prod!.applicationKey).toBe("ptla_prod_key_123456789");
    expect(config.defaultPanel).toBe("prod");
    expect(config.log.level).toBe("debug");
    expect(config.storage.dataDir).toBe("/tmp/pteroops-test");
  });

  it("normalizes trailing slashes in panel URLs", () => {
    const { config } = loadConfig({ env, cwd: "Z:\\nope" });
    expect(config.panels.staging!.url).toBe("https://staging.example.com");
  });

  it("parses panels from PTERO_PANELS_JSON", () => {
    const { config } = loadConfig({
      env: {
        PTERO_PANELS_JSON: JSON.stringify({
          main: { url: "https://p.example.com", clientKey: "ptlc_json_key_123456789" },
        }),
        PTERO_DEFAULT_PANEL: "main",
      },
      cwd: "Z:\\nope",
    });
    expect(config.panels.main!.url).toBe("https://p.example.com");
  });

  it("fails with a clear ConfigError when no panels are configured", () => {
    expect(() => loadConfig({ env: {}, cwd: "Z:\\nope" })).toThrowError(ConfigError);
    expect(() => loadConfig({ env: {}, cwd: "Z:\\nope" })).toThrowError(/No panels configured/);
  });

  it("rejects panels without any key", () => {
    expect(() =>
      loadConfig({
        env: {
          PTERO_PANELS_JSON: JSON.stringify({ broken: { url: "https://p.example.com" } }),
        },
        cwd: "Z:\\nope",
      }),
    ).toThrowError(/at least one of clientKey or applicationKey/);
  });

  it("rejects an unknown default panel", () => {
    expect(() =>
      loadConfig({
        env: { ...env, PTERO_DEFAULT_PANEL: "nope" },
        cwd: "Z:\\nope",
      }),
    ).toThrowError(/does not match any configured panel/);
  });

  it("requires an auth token for non-loopback HTTP binding", () => {
    expect(() =>
      loadConfig({
        env: {
          ...env,
          PTERO_HTTP_ENABLED: "1",
          PTERO_HTTP_HOST: "0.0.0.0",
        },
        cwd: "Z:\\nope",
      }),
    ).toThrowError(/authToken is required/);
  });

  it("accepts non-loopback binding with a token", () => {
    const { config } = loadConfig({
      env: {
        ...env,
        PTERO_HTTP_ENABLED: "1",
        PTERO_HTTP_HOST: "0.0.0.0",
        PTERO_HTTP_TOKEN: "a-long-enough-token",
      },
      cwd: "Z:\\nope",
    });
    expect(config.http.host).toBe("0.0.0.0");
    expect(config.http.authToken).toBe("a-long-enough-token");
  });

  it("reports missing environment variable references and invalid JSON", () => {
    expect(() =>
      loadConfig({
        env: { PTERO_PANELS_JSON: "{not-json" },
        cwd: "Z:\\nope",
      }),
    ).toThrowError(/not valid JSON/);
  });
});
