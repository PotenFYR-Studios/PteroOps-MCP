import { parse as parseYaml } from "yaml";

export interface FileValidationResult {
  file: string;
  status: "ok" | "warn" | "error" | "skipped";
  issues: string[];
}

const MAX_VALIDATION_BYTES = 512_000;

export function validateFileContent(file: string, content: string): FileValidationResult {
  if (content.length > MAX_VALIDATION_BYTES) {
    return { file, status: "skipped", issues: ["file exceeds the validation size cap"] };
  }
  const lower = file.toLowerCase();
  if (lower.endsWith("server.properties") || lower.endsWith(".properties")) {
    return validateProperties(file, content);
  }
  if (lower.endsWith(".json") || lower.endsWith(".json5")) {
    return validateJson(file, content);
  }
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
    return validateYaml(file, content);
  }
  if (lower.endsWith(".env") || lower === ".env") {
    return validateDotenv(file, content);
  }
  if (lower.endsWith(".toml") || lower.endsWith(".gradle") || lower.endsWith(".sh") || lower.endsWith(".jar")) {
    return { file, status: "skipped", issues: [`no validator for ${lower.split(".").pop() ?? "this file type"}`] };
  }
  return { file, status: "skipped", issues: [] };
}

function validateProperties(file: string, content: string): FileValidationResult {
  const issues: string[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) {
      issues.push(`line ${String(index + 1)}: not a key=value entry ("${trimmed.slice(0, 60)}")`);
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (key === "") {
      issues.push(`line ${String(index + 1)}: empty key`);
      continue;
    }
    if (seen.has(key)) {
      issues.push(`line ${String(index + 1)}: duplicate key "${key}" (last value wins)`);
    }
    seen.add(key);
  }
  return {
    file,
    status: issues.length > 0 ? "warn" : "ok",
    issues,
  };
}

function validateJson(file: string, content: string): FileValidationResult {
  try {
    JSON.parse(content);
    return { file, status: "ok", issues: [] };
  } catch (error) {
    return {
      file,
      status: "error",
      issues: [`invalid JSON: ${(error as Error).message}`],
    };
  }
}

function validateYaml(file: string, content: string): FileValidationResult {
  try {
    parseYaml(content);
    return { file, status: "ok", issues: [] };
  } catch (error) {
    const message = (error as Error).message.split("\n")[0] ?? "parse error";
    return { file, status: "error", issues: [`invalid YAML: ${message}`] };
  }
}

function validateDotenv(file: string, content: string): FileValidationResult {
  const issues: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index]!.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed) && !/^export\s+[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)) {
      issues.push(`line ${String(index + 1)}: not a KEY=value entry ("${trimmed.slice(0, 60)}")`);
    }
  }
  return { file, status: issues.length > 0 ? "warn" : "ok", issues };
}
