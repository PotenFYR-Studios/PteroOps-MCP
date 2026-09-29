import type { Logger } from "../observability/logger.js";
import type { PanelRegistry } from "../pterodactyl/panels.js";
import type { ServerRef } from "../shared/types.js";
import { analyzeDependencies, type DependencyReport } from "../intelligence/dependencies/analyzer.js";

export const DEPENDENCY_FILES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "requirements.txt",
  "pyproject.toml",
  "poetry.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "go.mod",
  "go.sum",
  "Cargo.toml",
  "Cargo.lock",
  "composer.json",
  "composer.lock",
  "Gemfile",
  "Gemfile.lock",
  "packages.config",
  "packages.lock.json",
];

export const DEPENDENCY_DIRS = ["plugins", "mods", "gradle"];

export interface DependencyServiceDeps {
  panels: PanelRegistry;
  maxFileSizeBytes: number;
  logger: Logger;
}

export async function collectDependencyReport(
  deps: DependencyServiceDeps,
  ref: ServerRef,
): Promise<DependencyReport> {
  const panel = deps.panels.requireCapability(ref.panel, { allOf: ["client.files.read"] });
  const files: Record<string, string> = {};
  const directoryListings: Record<string, string[]> = {};

  const rootListing = await panel.clientApi!.listFiles(ref, "/").catch(() => []);
  const rootNames = new Set(rootListing.map((entry) => entry.name.toLowerCase()));
  for (const file of DEPENDENCY_FILES) {
    if (!rootNames.has(file.toLowerCase())) continue;
    await readInto(files, deps, ref, `/${file}`, file);
  }
  const csproj = rootListing.find((entry) => entry.name.toLowerCase().endsWith(".csproj"));
  if (csproj) {
    await readInto(files, deps, ref, `/${csproj.name}`, csproj.name);
  }
  for (const dir of DEPENDENCY_DIRS) {
    try {
      const listing = await panel.clientApi!.listFiles(ref, `/${dir}`);
      directoryListings[dir] = listing.map((entry) => entry.name);
      if (dir === "gradle") {
        const catalog = listing.find((entry) => entry.name.toLowerCase() === "libs.versions.toml");
        if (catalog) {
          await readInto(files, deps, ref, `/gradle/${catalog.name}`, "gradle/libs.versions.toml");
        }
      }
    } catch {
      continue;
    }
  }
  return analyzeDependencies({ files, directoryListings });
}

async function readInto(
  files: Record<string, string>,
  deps: DependencyServiceDeps,
  ref: ServerRef,
  path: string,
  key: string,
): Promise<void> {
  const panel = deps.panels.requireCapability(ref.panel, { allOf: ["client.files.read"] });
  try {
    const content = await panel.clientApi!.readFile(ref, path);
    if (content.length <= deps.maxFileSizeBytes) {
      files[key] = content;
    }
  } catch (error) {
    deps.logger.debug("dependency manifest read failed", {
      file: path,
      error: (error as Error).message,
    });
  }
}
