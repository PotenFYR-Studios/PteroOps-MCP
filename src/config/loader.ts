import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigError } from "../shared/errors.js";
import { ConfigSchema, type PteroOpsConfig } from "./schema.js";

export interface LoadConfigOptions {
  configPath?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export interface LoadedConfig {
  config: PteroOpsConfig;
  source?: string;
}

const CONFIG_CANDIDATES = [
  "pteroops.config.yaml",
  "pteroops.config.yml",
  "pteroops.config.json",
];

const ENV_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const PANEL_ENV_RE =
  /^PTERO_PANEL_([A-Z0-9_]+?)_(URL|CLIENT_KEY|APPLICATION_KEY|TENANT|TIMEOUT_MS|MAX_RETRIES)$/;

type RawConfig = Record<string, unknown>;

export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const { raw, source } = loadRawConfig(options.configPath, env, cwd);
  const expanded = expandEnvValues(raw, env);
  applyPanelEnv(expanded, env);
  applyScalarEnv(expanded, env);

  const parsed = ConfigSchema.safeParse(expanded);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid configuration${source ? ` (${source})` : ""}:\n${issues}`);
  }
  const config = parsed.data;
  validateReferences(config);
  return source ? { config, source } : { config };
}

function loadRawConfig(
  explicitPath: string | undefined,
  env: Record<string, string | undefined>,
  cwd: string,
): { raw: RawConfig; source?: string } {
  const requested = explicitPath ?? env.PTEROOPS_CONFIG;
  if (requested) {
    const path = resolve(cwd, requested);
    if (!existsSync(path)) {
      throw new ConfigError(`Config file not found: ${path}`);
    }
    return { raw: parseConfigFile(path), source: path };
  }
  for (const candidate of CONFIG_CANDIDATES) {
    const path = resolve(cwd, candidate);
    if (existsSync(path)) {
      return { raw: parseConfigFile(path), source: path };
    }
  }
  return { raw: {} };
}

function parseConfigFile(path: string): RawConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read config file ${path}`, { cause: error });
  }
  try {
    const parsed = path.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigError(`Config file ${path} must contain a mapping at the top level`);
    }
    return parsed as RawConfig;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`Cannot parse config file ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

function expandEnvValues<T>(value: T, env: Record<string, string | undefined>, path: string[] = []): T {
  if (typeof value === "string") {
    return value.replace(ENV_RE, (_match, name: string) => {
      const replacement = env[name];
      if (replacement === undefined) {
        throw new ConfigError(
          `Environment variable ${name} referenced at ${path.join(".") || "(root)"} is not set`,
        );
      }
      return replacement;
    }) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => expandEnvValues(item, env, [...path, String(index)])) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = expandEnvValues(entry, env, [...path, key]);
    }
    return out as T;
  }
  return value;
}

function applyPanelEnv(config: RawConfig, env: Record<string, string | undefined>): void {
  const panels = ensureObject(config, "panels");

  if (env.PTERO_PANELS_JSON) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.PTERO_PANELS_JSON);
    } catch (error) {
      throw new ConfigError("PTERO_PANELS_JSON is not valid JSON", { cause: error });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigError("PTERO_PANELS_JSON must be a JSON object of panels");
    }
    for (const [name, panel] of Object.entries(parsed as Record<string, unknown>)) {
      panels[name] = panel;
    }
  }

  for (const [key, value] of Object.entries(env)) {
    const match = PANEL_ENV_RE.exec(key);
    if (!match || value === undefined) continue;
    const panelName = match[1]!.toLowerCase();
    const field = match[2]!;
    const panel = ensureObject(panels, panelName);
    switch (field) {
      case "URL":
        panel.url = value;
        break;
      case "CLIENT_KEY":
        panel.clientKey = value;
        break;
      case "APPLICATION_KEY":
        panel.applicationKey = value;
        break;
      case "TENANT":
        panel.tenant = value;
        break;
      case "TIMEOUT_MS":
        panel.timeoutMs = Number(value);
        break;
      case "MAX_RETRIES":
        panel.maxRetries = Number(value);
        break;
    }
  }
}

function applyScalarEnv(config: RawConfig, env: Record<string, string | undefined>): void {
  const set = (path: string[], value: unknown): void => {
    if (value === undefined) return;
    let cursor = config;
    for (const key of path.slice(0, -1)) {
      cursor = ensureObject(cursor, key);
    }
    cursor[path[path.length - 1]!] = value;
  };
  const bool = (value: string | undefined): boolean | undefined => {
    if (value === undefined) return undefined;
    return value === "1" || value.toLowerCase() === "true";
  };
  const num = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (Number.isNaN(parsed)) throw new ConfigError(`Expected a number but got "${value}"`);
    return parsed;
  };

  set(["defaultPanel"], env.PTERO_DEFAULT_PANEL);
  set(["tenant"], env.PTERO_TENANT);
  set(["storage", "dataDir"], env.PTERO_DATA_DIR);
  set(["log", "level"], env.PTERO_LOG_LEVEL);
  set(["log", "pretty"], bool(env.PTERO_LOG_PRETTY));
  set(["http", "enabled"], bool(env.PTERO_HTTP_ENABLED));
  set(["http", "host"], env.PTERO_HTTP_HOST);
  set(["http", "port"], num(env.PTERO_HTTP_PORT));
  set(["http", "authToken"], env.PTERO_HTTP_TOKEN);
  set(["monitoring", "enabled"], bool(env.PTERO_MONITORING_ENABLED));
  set(["monitoring", "intervalSeconds"], num(env.PTERO_MONITORING_INTERVAL));
  set(["console", "retentionHours"], num(env.PTERO_CONSOLE_RETENTION_HOURS));
  set(["console", "persist"], bool(env.PTERO_CONSOLE_PERSIST));
  set(["emergencyOverride"], bool(env.PTERO_EMERGENCY_OVERRIDE));
  set(["git", "tokens", "github"], env.PTERO_GIT_GITHUB_TOKEN);
  set(["git", "tokens", "gitlab"], env.PTERO_GIT_GITLAB_TOKEN);
  set(["git", "apiBase", "github"], env.PTERO_GIT_GITHUB_API_BASE);
  set(["git", "apiBase", "gitlab"], env.PTERO_GIT_GITLAB_API_BASE);
  set(["storage", "driver"], env.PTERO_DATABASE_DRIVER);
  set(["storage", "postgresUrl"], env.PTERO_DATABASE_URL);
  set(["storage", "redisUrl"], env.PTERO_REDIS_URL);
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (existing === undefined || existing === null) {
    const created: Record<string, unknown> = {};
    parent[key] = created;
    return created;
  }
  if (typeof existing !== "object" || Array.isArray(existing)) {
    throw new ConfigError(`Configuration key "${key}" must be an object`);
  }
  return existing as Record<string, unknown>;
}

function validateReferences(config: PteroOpsConfig): void {
  const panelNames = Object.keys(config.panels);
  if (panelNames.length === 0) {
    throw new ConfigError(
      "No panels configured. Add panels to the config file or set PTERO_PANEL_<NAME>_URL and PTERO_PANEL_<NAME>_CLIENT_KEY.",
    );
  }
  if (config.defaultPanel && !config.panels[config.defaultPanel]) {
    throw new ConfigError(
      `defaultPanel "${config.defaultPanel}" does not match any configured panel (${panelNames.join(", ")})`,
    );
  }
  if (config.tenants) {
    for (const [tenant, definition] of Object.entries(config.tenants)) {
      for (const panel of definition.panels) {
        if (!config.panels[panel]) {
          throw new ConfigError(`Tenant "${tenant}" references unknown panel "${panel}"`);
        }
      }
    }
  }
  if (config.http.enabled && !isLoopback(config.http.host) && !config.http.authToken) {
    throw new ConfigError(
      "http.authToken is required when the HTTP transport binds to a non-loopback address",
    );
  }
}

export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function panelTenant(config: PteroOpsConfig, panelName: string): string {
  if (config.tenants) {
    for (const [tenant, definition] of Object.entries(config.tenants)) {
      if (definition.panels.includes(panelName)) return tenant;
    }
  }
  return config.panels[panelName]?.tenant ?? config.tenant;
}

export function resolveDefaultPanel(config: PteroOpsConfig): string {
  if (config.defaultPanel) return config.defaultPanel;
  const first = Object.keys(config.panels)[0];
  if (!first) throw new ConfigError("No panels configured");
  return first;
}
