export interface DependencyEntry {
  name: string;
  version: string | null;
  source: string;
  kind: "runtime" | "build" | "loader";
}

export interface DependencyIssue {
  id: string;
  severity: "info" | "warn" | "error";
  kind: "evidence" | "hypothesis";
  summary: string;
  items: string[];
}

export interface EcosystemReport {
  ecosystem: string;
  manifests: string[];
  lockfiles: string[];
  components: DependencyEntry[];
  issues: DependencyIssue[];
}

export interface DependencyReport {
  generatedAt: number;
  ecosystems: EcosystemReport[];
  componentCount: number;
  summary: string;
  missingEvidence: string[];
}

export interface DependencyAnalysisInput {
  files: Record<string, string>;
  directoryListings: Record<string, string[]>;
  now?: number;
}

const NODE_LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
const PY_MANIFESTS = ["requirements.txt", "pyproject.toml"];
const PY_LOCKFILES = ["poetry.lock", "Pipfile.lock", "uv.lock"];
const JVM_MANIFESTS = ["pom.xml", "build.gradle", "build.gradle.kts"];
const PHP_MANIFESTS = ["composer.json"];
const RUBY_MANIFESTS = ["Gemfile"];
const MC_DIRS = ["plugins", "mods"];

export function analyzeDependencies(input: DependencyAnalysisInput): DependencyReport {
  const now = input.now ?? Date.now();
  const ecosystems: EcosystemReport[] = [];
  const missingEvidence: string[] = [];
  const filesLower = lowerCaseKeys(input.files);
  const listingsLower = lowerCaseKeys(input.directoryListings);

  const node = analyzeNode(filesLower);
  if (node) ecosystems.push(node);
  const python = analyzePython(filesLower);
  if (python) ecosystems.push(python);
  const jvm = analyzeJvm(filesLower);
  if (jvm) ecosystems.push(jvm);
  const go = analyzeGo(filesLower);
  if (go) ecosystems.push(go);
  const rust = analyzeRust(filesLower);
  if (rust) ecosystems.push(rust);
  const php = analyzePhp(filesLower);
  if (php) ecosystems.push(php);
  const ruby = analyzeRuby(filesLower);
  if (ruby) ecosystems.push(ruby);
  const dotnet = analyzeDotnet(filesLower);
  if (dotnet) ecosystems.push(dotnet);
  const gradleCatalog = analyzeGradleCatalog(filesLower);
  if (gradleCatalog) ecosystems.push(gradleCatalog);
  const minecraft = analyzeMinecraft(listingsLower);
  if (minecraft) ecosystems.push(minecraft);

  if (ecosystems.length === 0) {
    missingEvidence.push(
      "No dependency manifests or plugin/mod directories were found; file access (client.files.read) is required for dependency analysis.",
    );
  }
  if (listingsLower["plugins"] && !filesLower["plugins"]) {
    missingEvidence.push("Plugin contents were not read; only file names are available for duplicate detection.");
  }

  const componentCount = ecosystems.reduce((sum, eco) => sum + eco.components.length, 0);
  const issueCount = ecosystems.reduce((sum, eco) => sum + eco.issues.length, 0);
  const summary =
    ecosystems.length === 0
      ? "No dependency information available."
      : `${componentCount} components across ${ecosystems.map((eco) => eco.ecosystem).join(", ")}; ${issueCount} issue(s) detected.`;

  return { generatedAt: now, ecosystems, componentCount, summary, missingEvidence };
}

function analyzeNode(files: Record<string, string>): EcosystemReport | null {
  const raw = files["package.json"];
  if (raw === undefined) return null;
  const report: EcosystemReport = {
    ecosystem: "node",
    manifests: ["package.json"],
    lockfiles: NODE_LOCKFILES.filter((lock) => lock in files),
    components: [],
    issues: [],
  };
  let parsed: {
    name?: string;
    engines?: { node?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    report.issues.push({
      id: "node.manifest-unparseable",
      severity: "error",
      kind: "evidence",
      summary: "package.json is not valid JSON; dependency information is unavailable.",
      items: [],
    });
    return report;
  }

  const sections: Array<{ deps?: Record<string, string>; kind: DependencyEntry["kind"] }> = [
    { deps: parsed.dependencies, kind: "runtime" },
    { deps: parsed.devDependencies, kind: "build" },
    { deps: parsed.peerDependencies, kind: "runtime" },
  ];
  const unpinned: string[] = [];
  const seen = new Map<string, string>();
  for (const section of sections) {
    for (const [name, version] of Object.entries(section.deps ?? {})) {
      report.components.push({
        name,
        version,
        source: "package.json",
        kind: section.kind,
      });
      if (version === "*" || version === "latest" || version === "") {
        unpinned.push(name);
      }
      const previous = seen.get(name);
      if (previous !== undefined && previous !== version) {
        report.issues.push({
          id: `node.duplicate-${name}`,
          severity: "warn",
          kind: "evidence",
          summary: `Package "${name}" is declared with conflicting versions (${previous} vs ${version}).`,
          items: [name],
        });
      }
      seen.set(name, version);
    }
  }
  if (unpinned.length > 0) {
    report.issues.push({
      id: "node.unpinned",
      severity: "warn",
      kind: "evidence",
      summary: `${unpinned.length} package(s) use floating versions ("*" or "latest"), making deployments non-reproducible.`,
      items: unpinned.slice(0, 10),
    });
  }
  if (report.lockfiles.length === 0 && report.components.length > 0) {
    report.issues.push({
      id: "node.no-lockfile",
      severity: "warn",
      kind: "evidence",
      summary: "No lockfile found for a project with dependencies; installs may drift between deploys.",
      items: [],
    });
  }
  if (parsed.engines?.node) {
    report.components.push({
      name: "node",
      version: parsed.engines.node,
      source: "package.json#engines",
      kind: "runtime",
    });
  }
  return report;
}

function analyzePython(files: Record<string, string>): EcosystemReport | null {
  const manifests = PY_MANIFESTS.filter((manifest) => manifest in files);
  if (manifests.length === 0) return null;
  const report: EcosystemReport = {
    ecosystem: "python",
    manifests,
    lockfiles: PY_LOCKFILES.filter((lock) => lock in files),
    components: [],
    issues: [],
  };
  const requirements = files["requirements.txt"];
  if (requirements !== undefined) {
    const unpinned: string[] = [];
    const seen = new Set<string>();
    for (const line of requirements.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
      const match = /^([A-Za-z0-9_.[\]]+)\s*([<>=!~]{1,2}[^;#\s]*)?/.exec(trimmed);
      if (!match) continue;
      const name = match[1]!;
      const version = match[2] ?? null;
      report.components.push({ name, version, source: "requirements.txt", kind: "runtime" });
      if (version === null) unpinned.push(name);
      if (seen.has(name)) {
        report.issues.push({
          id: `python.duplicate-${name}`,
          severity: "warn",
          kind: "evidence",
          summary: `Requirement "${name}" is listed more than once.`,
          items: [name],
        });
      }
      seen.add(name);
    }
    if (unpinned.length > 0) {
      report.issues.push({
        id: "python.unpinned",
        severity: "warn",
        kind: "evidence",
        summary: `${unpinned.length} requirement(s) are unpinned.`,
        items: unpinned.slice(0, 10),
      });
    }
  }
  const pyproject = files["pyproject.toml"];
  if (pyproject !== undefined) {
    const requires = /requires-python\s*=\s*"([^"]+)"/.exec(pyproject);
    if (requires) {
      report.components.push({
        name: "python",
        version: requires[1]!,
        source: "pyproject.toml",
        kind: "runtime",
      });
    }
    const depLines = /^\s*"?([A-Za-z0-9_.-]+)"?\s*=\s*"([^"]+)"/gm;
    let match: RegExpExecArray | null;
    let matched = 0;
    while ((match = depLines.exec(pyproject)) !== null && matched < 200) {
      if (/^\[|requires-python|name|version|description/.test(match[1]!)) continue;
      matched += 1;
      report.components.push({
        name: match[1]!,
        version: match[2]!,
        source: "pyproject.toml",
        kind: "runtime",
      });
    }
  }
  return report;
}

function analyzeJvm(files: Record<string, string>): EcosystemReport | null {
  const manifests = JVM_MANIFESTS.filter((manifest) => manifest in files);
  if (manifests.length === 0) return null;
  const report: EcosystemReport = {
    ecosystem: "jvm",
    manifests,
    lockfiles: [],
    components: [],
    issues: [],
  };
  const pom = files["pom.xml"];
  if (pom !== undefined) {
    const dependencyBlocks = /<dependency>([\s\S]*?)<\/dependency>/g;
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = dependencyBlocks.exec(pom)) !== null) {
      const block = match[1]!;
      const artifact = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec(block)?.[1];
      const group = /<groupId>\s*([^<]+?)\s*<\/groupId>/.exec(block)?.[1];
      const version = /<version>\s*([^<]+?)\s*<\/version>/.exec(block)?.[1] ?? null;
      if (!artifact || !group) continue;
      const name = `${group}:${artifact}`;
      report.components.push({ name, version, source: "pom.xml", kind: "runtime" });
      if (seen.has(name)) {
        report.issues.push({
          id: `jvm.duplicate-${name}`,
          severity: "warn",
          kind: "evidence",
          summary: `Maven dependency "${name}" is declared more than once.`,
          items: [name],
        });
      }
      seen.add(name);
    }
  }
  const gradle = files["build.gradle"] ?? files["build.gradle.kts"];
  if (gradle !== undefined) {
    const dependencyLine = /(?:implementation|api|compileOnly|runtimeOnly)\s*\(?\s*["']([^"':]+):([^"':]+):([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = dependencyLine.exec(gradle)) !== null) {
      report.components.push({
        name: `${match[1]}:${match[2]}`,
        version: match[3]!,
        source: files["build.gradle"] ? "build.gradle" : "build.gradle.kts",
        kind: "runtime",
      });
    }
  }
  return report;
}

function analyzeGo(files: Record<string, string>): EcosystemReport | null {
  const gomod = files["go.mod"];
  if (gomod === undefined) return null;
  const report: EcosystemReport = {
    ecosystem: "go",
    manifests: ["go.mod"],
    lockfiles: "go.sum" in files ? ["go.sum"] : [],
    components: [],
    issues: [],
  };
  const moduleMatch = /^module\s+(\S+)/m.exec(gomod);
  if (moduleMatch) {
    report.components.push({
      name: moduleMatch[1]!,
      version: null,
      source: "go.mod",
      kind: "runtime",
    });
  }
  const requireLine = /^\s*(?:require\s+)?([\w.\-/]+)\s+(v[\w.\-+]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = requireLine.exec(gomod)) !== null) {
    if (match[1] === "module" || match[1] === "go") continue;
    report.components.push({
      name: match[1]!,
      version: match[2]!,
      source: "go.mod",
      kind: "runtime",
    });
  }
  if (report.lockfiles.length === 0 && report.components.length > 1) {
    report.issues.push({
      id: "go.no-sum",
      severity: "info",
      kind: "evidence",
      summary: "go.sum is missing; dependency checksums are not pinned.",
      items: [],
    });
  }
  return report;
}

function analyzeRust(files: Record<string, string>): EcosystemReport | null {
  const cargo = files["cargo.toml"];
  if (cargo === undefined) return null;
  const report: EcosystemReport = {
    ecosystem: "rust",
    manifests: ["Cargo.toml"],
    lockfiles: "cargo.lock" in files ? ["Cargo.lock"] : [],
    components: [],
    issues: [],
  };
  const sectionRe = /^\[(dependencies|dev-dependencies|build-dependencies)([^\]]*)\]$/gm;
  let sectionMatch: RegExpExecArray | null;
  const sections: Array<{ start: number; kind: DependencyEntry["kind"] }> = [];
  while ((sectionMatch = sectionRe.exec(cargo)) !== null) {
    sections.push({
      start: sectionMatch.index + sectionMatch[0].length,
      kind: sectionMatch[1] === "dependencies" ? "runtime" : "build",
    });
  }
  for (let i = 0; i < sections.length; i++) {
    const start = sections[i]!.start;
    const end = i + 1 < sections.length ? sections[i + 1]!.start : cargo.length;
    const body = cargo.slice(start, end);
    const entryRe = /^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/gm;
    let entry: RegExpExecArray | null;
    while ((entry = entryRe.exec(body)) !== null) {
      report.components.push({
        name: entry[1]!,
        version: entry[2]!,
        source: "Cargo.toml",
        kind: sections[i]!.kind,
      });
    }
  }
  if (report.lockfiles.length === 0 && report.components.length > 0) {
    report.issues.push({
      id: "rust.no-lockfile",
      severity: "warn",
      kind: "evidence",
      summary: "Cargo.lock is missing for a project with dependencies; builds may resolve differently over time.",
      items: [],
    });
  }
  return report;
}

function analyzeMinecraft(listings: Record<string, string[]>): EcosystemReport | null {
  const present = MC_DIRS.filter((dir) => (listings[dir] ?? []).length > 0);
  if (present.length === 0) return null;
  const report: EcosystemReport = {
    ecosystem: "minecraft",
    manifests: present.map((dir) => `${dir}/`),
    lockfiles: [],
    components: [],
    issues: [],
  };
  for (const dir of present) {
    const entries = (listings[dir] ?? []).filter((name) => name.toLowerCase().endsWith(".jar"));
    const baseNames = new Map<string, string[]>();
    for (const entry of entries) {
      const versionMatch = /-(\d[\w.+-]*)\.jar$/i.exec(entry);
      const base = versionMatch ? entry.slice(0, versionMatch.index) : entry.replace(/\.jar$/i, "");
      report.components.push({
        name: base,
        version: versionMatch?.[1] ?? null,
        source: `${dir}/`,
        kind: "runtime",
      });
      const list = baseNames.get(base) ?? [];
      list.push(entry);
      baseNames.set(base, list);
    }
    for (const [base, versions] of baseNames) {
      if (versions.length > 1) {
        report.issues.push({
          id: `minecraft.duplicate-${base}`,
          severity: "error",
          kind: "evidence",
          summary: `Multiple versions of "${base}" are installed in ${dir}/: ${versions.join(", ")}. Duplicate plugins/mods commonly prevent startup or cause undefined behavior.`,
          items: versions,
        });
      }
    }
  }
  return report;
}

function lowerCaseKeys<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

function analyzePhp(files: Record<string, string>): EcosystemReport | null {
  const raw = files["composer.json"];
  if (raw === undefined) return null;
  const report: EcosystemReport = {
    ecosystem: "php",
    manifests: PHP_MANIFESTS,
    lockfiles: "composer.lock" in files ? ["composer.lock"] : [],
    components: [],
    issues: [],
  };
  let parsed: {
    require?: Record<string, string>;
    "require-dev"?: Record<string, string>;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    report.issues.push({
      id: "php.manifest-unparseable",
      severity: "error",
      kind: "evidence",
      summary: "composer.json is not valid JSON; dependency information is unavailable.",
      items: [],
    });
    return report;
  }
  const unpinned: string[] = [];
  for (const [name, version] of Object.entries({
    ...(parsed.require ?? {}),
    ...(parsed["require-dev"] ?? {}),
  })) {
    if (name === "php" || name.startsWith("ext-")) continue;
    report.components.push({ name, version, source: "composer.json", kind: "runtime" });
    if (version === "*" || version === "") unpinned.push(name);
  }
  if (unpinned.length > 0) {
    report.issues.push({
      id: "php.unpinned",
      severity: "warn",
      kind: "evidence",
      summary: `${unpinned.length} composer package(s) use floating versions.`,
      items: unpinned.slice(0, 10),
    });
  }
  if (report.lockfiles.length === 0 && report.components.length > 0) {
    report.issues.push({
      id: "php.no-lockfile",
      severity: "warn",
      kind: "evidence",
      summary: "composer.lock is missing; installs may drift between deploys.",
      items: [],
    });
  }
  return report;
}

function analyzeRuby(files: Record<string, string>): EcosystemReport | null {
  const gemfile = files["gemfile"];
  if (gemfile === undefined) return null;
  const report: EcosystemReport = {
    ecosystem: "ruby",
    manifests: RUBY_MANIFESTS,
    lockfiles: "gemfile.lock" in files ? ["Gemfile.lock"] : [],
    components: [],
    issues: [],
  };
  const gemLine = /^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm;
  let match: RegExpExecArray | null;
  const unpinned: string[] = [];
  while ((match = gemLine.exec(gemfile)) !== null) {
    const name = match[1]!;
    const version = match[2] ?? null;
    report.components.push({ name, version, source: "Gemfile", kind: "runtime" });
    if (version === null) unpinned.push(name);
  }
  if (unpinned.length > 0) {
    report.issues.push({
      id: "ruby.unpinned",
      severity: "info",
      kind: "evidence",
      summary: `${unpinned.length} gem(s) have no version constraint in the Gemfile.`,
      items: unpinned.slice(0, 10),
    });
  }
  if (report.lockfiles.length === 0 && report.components.length > 0) {
    report.issues.push({
      id: "ruby.no-lockfile",
      severity: "warn",
      kind: "evidence",
      summary: "Gemfile.lock is missing; bundle installs may resolve differently over time.",
      items: [],
    });
  }
  return report;
}

function analyzeDotnet(files: Record<string, string>): EcosystemReport | null {
  const csprojName = Object.keys(files).find((name) => name.endsWith(".csproj"));
  const packagesConfig = files["packages.config"];
  if (csprojName === undefined && packagesConfig === undefined) return null;
  const report: EcosystemReport = {
    ecosystem: "dotnet",
    manifests: [csprojName ?? "packages.config"],
    lockfiles: "packages.lock.json" in files ? ["packages.lock.json"] : [],
    components: [],
    issues: [],
  };
  const seen = new Set<string>();
  if (csprojName !== undefined) {
    const content = files[csprojName]!;
    const references = /<PackageReference\s+[^>]*Include="([^"]+)"[^>]*?(?:Version="([^"]+)")?/gi;
    let match: RegExpExecArray | null;
    while ((match = references.exec(content)) !== null) {
      const name = match[1]!;
      report.components.push({
        name,
        version: match[2] ?? null,
        source: csprojName,
        kind: "runtime",
      });
      seen.add(name);
    }
  }
  if (packagesConfig !== undefined) {
    const entries = /<package\s+[^>]*id="([^"]+)"[^>]*version="([^"]+)"/gi;
    let match: RegExpExecArray | null;
    while ((match = entries.exec(packagesConfig)) !== null) {
      const name = match[1]!;
      if (seen.has(name)) continue;
      report.components.push({
        name,
        version: match[2]!,
        source: "packages.config",
        kind: "runtime",
      });
      seen.add(name);
    }
    report.issues.push({
      id: "dotnet.legacy-packages-config",
      severity: "info",
      kind: "evidence",
      summary: "packages.config is legacy; PackageReference in the csproj is the modern format.",
      items: [],
    });
  }
  return report;
}

function analyzeGradleCatalog(files: Record<string, string>): EcosystemReport | null {
  const raw = files["gradle/libs.versions.toml"];
  if (raw === undefined) return null;
  const report: EcosystemReport = {
    ecosystem: "jvm",
    manifests: ["gradle/libs.versions.toml"],
    lockfiles: [],
    components: [],
    issues: [],
  };
  const versions = new Map<string, string>();
  const versionSection = /\[versions\]([\s\S]*?)(?:\n\[|$)/.exec(raw);
  if (versionSection) {
    const line = /^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/gm;
    let match: RegExpExecArray | null;
    while ((match = line.exec(versionSection[1]!)) !== null) {
      versions.set(match[1]!, match[2]!);
    }
  }
  const librarySection = /\[libraries\]([\s\S]*?)(?:\n\[|$)/.exec(raw);
  if (librarySection) {
    const entry = /^\s*([A-Za-z0-9_-]+)\s*=\s*\{([^}]*)\}/gm;
    let match: RegExpExecArray | null;
    while ((match = entry.exec(librarySection[1]!)) !== null) {
      const body = match[2]!;
      const module = /module\s*=\s*"([^"]+)"/.exec(body)?.[1];
      const versionRef = /version\.ref\s*=\s*"([^"]+)"/.exec(body)?.[1];
      if (!module) continue;
      report.components.push({
        name: module,
        version: versionRef ? (versions.get(versionRef) ?? versionRef) : null,
        source: "gradle/libs.versions.toml",
        kind: "runtime",
      });
    }
  }
  if (report.components.length === 0) return null;
  return report;
}