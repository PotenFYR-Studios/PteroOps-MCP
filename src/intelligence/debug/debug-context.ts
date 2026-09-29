import { validateFileContent, type FileValidationResult } from "../../applications/validation.js";
import type { Logger } from "../../observability/logger.js";
import type { PanelRegistry } from "../../pterodactyl/panels.js";
import type { ServerRef } from "../../shared/types.js";
import type { LogAnalysis } from "../logs/engine.js";

export interface StackLocation {
  runtime: "java" | "python" | "node" | "unknown";
  file: string;
  line: number | null;
  symbol: string | null;
}

export interface DebugSnippet {
  source: string;
  file: string;
  line: number | null;
  symbol: string | null;
  resolvedPath: string | null;
  from: number | null;
  to: number | null;
  snippet: string | null;
  note: string | null;
}

export interface DebugContextResult {
  exceptions: Array<{ exceptionType: string | null; count: number; sample: string }>;
  snippets: DebugSnippet[];
  configValidation: FileValidationResult[];
  hints: string[];
  searchedPaths: string[];
  missingEvidence: string[];
}

export interface DebugContextDeps {
  panels: PanelRegistry;
  logger: Logger;
  maxFiles?: number;
  maxSnippetLines?: number;
  maxFileBytes?: number;
}

export interface DebugContextOptions {
  configPaths?: string[];
}

const JAVA_FRAME_RE = /\bat\s+([\w$.<>]+)\(([^():"/\\]+?)(?:\.java)?(?::(\d+))?\)/;
const PYTHON_FRAME_RE = /File "([^"]+)", line (\d+)(?:, in (.+))?/;
const NODE_FRAME_RE = /\bat\s+(?:(.+?)\s+\()?([\w./@-]+\.(?:[cm]?js|ts|tsx|mjs|cjs))(?::(\d+))(?::(\d+))?\)?/;

const NOISE_RE =
  /java\.base\/|jdk\.|sun\.|java\.lang\.reflect|node:internal|node_modules\/|site-packages\/|\/usr\/lib\/|\/usr\/local\/lib\//;

const CONTAINER_PREFIXES = [
  "/home/container/",
  "/home/container",
  "/app/",
  "/srv/",
  "/opt/",
  "/home/",
  "/data/",
  "/server/",
];

export function extractStackLocations(lines: string[]): StackLocation[] {
  const locations: StackLocation[] = [];
  for (const line of lines) {
    if (NOISE_RE.test(line) && !/\.java|\.py|\.js|\.ts/.test(line)) continue;
    const java = JAVA_FRAME_RE.exec(line);
    if (java) {
      locations.push({
        runtime: "java",
        file: java[2]!,
        line: java[3] === undefined ? null : Number(java[3]),
        symbol: java[1]!,
      });
      continue;
    }
    const python = PYTHON_FRAME_RE.exec(line);
    if (python) {
      locations.push({
        runtime: "python",
        file: python[1]!,
        line: Number(python[2]),
        symbol: python[3] ?? null,
      });
      continue;
    }
    const node = NODE_FRAME_RE.exec(line);
    if (node && !NOISE_RE.test(line)) {
      locations.push({
        runtime: "node",
        file: node[2]!,
        line: node[3] === undefined ? null : Number(node[3]),
        symbol: node[1] ?? null,
      });
    }
  }
  return locations;
}

export function candidateServerPaths(location: StackLocation, rootFiles: string[]): string[] {
  const normalized = location.file.replace(/\\/g, "/");
  const candidates: string[] = [];
  const add = (path: string): void => {
    const cleaned = `/${path.replace(/^\/+/, "")}`;
    if (!candidates.includes(cleaned)) candidates.push(cleaned);
  };
  for (const prefix of CONTAINER_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      add(normalized.slice(prefix.length));
    }
  }
  add(normalized);
  const basename = normalized.split("/").pop() ?? normalized;
  add(basename);
  for (const rootFile of rootFiles) {
    if (rootFile.toLowerCase() === basename.toLowerCase()) {
      add(rootFile);
    }
  }
  return candidates;
}

export class DebugContextBuilder {
  private readonly maxFiles: number;
  private readonly maxSnippetLines: number;
  private readonly maxFileBytes: number;

  constructor(private readonly deps: DebugContextDeps) {
    this.maxFiles = deps.maxFiles ?? 3;
    this.maxSnippetLines = deps.maxSnippetLines ?? 24;
    this.maxFileBytes = deps.maxFileBytes ?? 200_000;
  }

  async build(
    ref: ServerRef,
    analysis: LogAnalysis,
    options: DebugContextOptions = {},
  ): Promise<DebugContextResult> {
    const exceptions = analysis.issues
      .filter((issue) => issue.severity === "fatal" || issue.severity === "error")
      .slice(0, 2)
      .map((issue) => ({
        exceptionType: issue.exceptionType,
        count: issue.count,
        sample: issue.sample,
      }));
    const missingEvidence: string[] = [];
    const hints: string[] = [];

    if (analysis.stackTraces.length === 0) {
      missingEvidence.push(
        "no stack traces in the current window; increase the window or wait for the next failure",
      );
    }
    const stackLines = analysis.stackTraces.flatMap((group) => [group.header, ...group.context]);
    const locations = extractStackLocations(stackLines);
    const appLocations = locations.filter((location) => !NOISE_RE.test(location.file));
    if (appLocations.length === 0 && stackLines.length > 0) {
      hints.push(
        "all stack frames point at the runtime or libraries; the failing code may be inside a plugin/mod or a dependency",
      );
    }

    const panel = this.deps.panels.tryGet(ref.panel);
    const clientApi = panel?.clientApi ?? null;
    const canRead = Boolean(clientApi && panel?.capabilities.has("client.files.read"));
    if (!canRead) {
      missingEvidence.push(
        "file access (client.files.read) is required to fetch source/config snippets around stack frames",
      );
    }

    const snippets: DebugSnippet[] = [];
    const searchedPaths: string[] = [];
    const configValidation: FileValidationResult[] = [];

    if (canRead && clientApi) {
      const rootListing = await clientApi.listFiles(ref, "/").catch(() => []);
      const rootFiles = rootListing.map((entry) => entry.name);
      const seen = new Set<string>();
      for (const location of appLocations) {
        if (snippets.length >= this.maxFiles) break;
        const candidates = candidateServerPaths(location, rootFiles);
        let resolved: string | null = null;
        for (const candidate of candidates) {
          searchedPaths.push(candidate);
          const content = await clientApi.readFile(ref, candidate).catch(() => null);
          if (content === null || content.includes("\u0000")) continue;
          resolved = candidate;
          if (content.length <= this.maxFileBytes) {
            const snippet = extractSnippet(content, location.line, this.maxSnippetLines);
            snippets.push({
              source: "stack-trace",
              file: location.file,
              line: location.line,
              symbol: location.symbol,
              resolvedPath: candidate,
              from: snippet.from,
              to: snippet.to,
              snippet: snippet.text,
              note: null,
            });
            if (isConfigPath(candidate)) {
              configValidation.push(validateFileContent(candidate, content));
            }
          } else {
            snippets.push({
              source: "stack-trace",
              file: location.file,
              line: location.line,
              symbol: location.symbol,
              resolvedPath: candidate,
              from: null,
              to: null,
              snippet: null,
              note: `file is ${String(content.length)} bytes; snippet not extracted (cap ${String(this.maxFileBytes)})`,
            });
          }
          break;
        }
        if (resolved === null && !seen.has(location.file)) {
          seen.add(location.file);
          snippets.push({
            source: "stack-trace",
            file: location.file,
            line: location.line,
            symbol: location.symbol,
            resolvedPath: null,
            from: null,
            to: null,
            snippet: null,
            note: "file not found on the server; it may live inside a jar/package or be generated at runtime",
          });
        }
      }

      const configLocations = options.configPaths ?? this.defaultConfigPaths;
      for (const configPath of configLocations) {
        if (configValidation.some((entry) => entry.file === configPath)) continue;
        const content = await clientApi.readFile(ref, configPath).catch(() => null);
        if (content === null || content.length > this.maxFileBytes) continue;
        configValidation.push(validateFileContent(configPath, content));
      }

      const invalid = configValidation.filter((entry) => entry.status === "error");
      for (const entry of invalid) {
        hints.push(`${entry.file} does not parse: ${entry.issues.join("; ")}`);
      }
      const symbolHints = this.symbolHints(appLocations, rootFiles);
      hints.push(...symbolHints);
    }

    return {
      exceptions,
      snippets,
      configValidation,
      hints,
      searchedPaths: [...new Set(searchedPaths)].slice(0, 40),
      missingEvidence,
    };
  }

  private defaultConfigPaths = [
    "/server.properties",
    "/config.yml",
    "/config.yaml",
    "/application.yml",
    "/package.json",
  ];

  private symbolHints(locations: StackLocation[], rootFiles: string[]): string[] {
    const hints: string[] = [];
    for (const location of locations) {
      const symbolHead = (location.symbol ?? "").split(".")[0] ?? "";
      if (symbolHead === "" || symbolHead === "com" || symbolHead === "org" || symbolHead === "net") continue;
      const lower = symbolHead.toLowerCase();
      const match = rootFiles.find((name) => name.toLowerCase().includes(lower));
      if (match) {
        hints.push(
          `stack frames reference "${symbolHead}" and the server ships "${match}" - the failure may come from that component`,
        );
      }
      break;
    }
    return hints;
  }
}

export function extractSnippet(
  content: string,
  line: number | null,
  radius: number,
): { from: number; to: number; text: string } {
  const lines = content.split(/\r?\n/);
  if (line === null || line <= 0) {
    const text = lines.slice(0, radius).join("\n");
    return { from: 1, to: Math.min(lines.length, radius), text };
  }
  const from = Math.max(1, line - Math.floor(radius / 2));
  const to = Math.min(lines.length, from + radius - 1);
  const slice = lines.slice(from - 1, to);
  const text = slice
    .map((text, index) => `${String(from + index).padStart(5)} | ${text}`)
    .join("\n");
  return { from, to, text };
}

function isConfigPath(path: string): boolean {
  const lower = path.toLowerCase();
  return /\.(properties|ya?ml|json|env|toml|ini|cfg|conf)$/.test(lower) || lower.endsWith("package.json");
}
