import { describe, expect, it } from "vitest";
import { analyzeDependencies } from "../../src/intelligence/dependencies/analyzer.js";

describe("DependencyAnalyzer", () => {
  it("parses package.json dependencies and detects unpinned versions", () => {
    const report = analyzeDependencies({
      files: {
        "package.json": JSON.stringify({
          name: "my-bot",
          engines: { node: ">=20" },
          dependencies: { express: "^4.19.0", badlib: "*" },
          devDependencies: { typescript: "^5.0.0" },
        }),
        "package-lock.json": "{}",
      },
      directoryListings: {},
    });
    const node = report.ecosystems.find((eco) => eco.ecosystem === "node");
    expect(node).toBeDefined();
    expect(node!.components.some((component) => component.name === "express")).toBe(true);
    expect(node!.components.some((component) => component.name === "node")).toBe(true);
    expect(node!.lockfiles).toContain("package-lock.json");
    expect(node!.issues.some((issue) => issue.id === "node.unpinned")).toBe(true);
  });

  it("flags a missing lockfile as evidence, not a hypothesis", () => {
    const report = analyzeDependencies({
      files: { "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) },
      directoryListings: {},
    });
    const issue = report.ecosystems[0]!.issues.find((item) => item.id === "node.no-lockfile");
    expect(issue).toBeDefined();
    expect(issue!.kind).toBe("evidence");
  });

  it("does not invent dependencies from unparseable manifests", () => {
    const report = analyzeDependencies({
      files: { "package.json": "{broken" },
      directoryListings: {},
    });
    const node = report.ecosystems.find((eco) => eco.ecosystem === "node");
    expect(node!.components).toHaveLength(0);
    expect(node!.issues.some((issue) => issue.id === "node.manifest-unparseable")).toBe(true);
  });

  it("parses requirements.txt with duplicates and unpinned entries", () => {
    const report = analyzeDependencies({
      files: {
        "requirements.txt": ["requests==2.31.0", "flask", "requests==2.31.0"].join("\n"),
      },
      directoryListings: {},
    });
    const python = report.ecosystems.find((eco) => eco.ecosystem === "python");
    expect(python!.components.map((component) => component.name)).toContain("requests");
    expect(python!.issues.some((issue) => issue.id === "python.unpinned")).toBe(true);
    expect(python!.issues.some((issue) => issue.id.startsWith("python.duplicate"))).toBe(true);
  });

  it("parses pom.xml dependencies", () => {
    const pom = `<project><dependencies>
      <dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>6.1.0</version></dependency>
      <dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>6.0.0</version></dependency>
    </dependencies></project>`;
    const report = analyzeDependencies({ files: { "pom.xml": pom }, directoryListings: {} });
    const jvm = report.ecosystems.find((eco) => eco.ecosystem === "jvm");
    expect(jvm!.components).toHaveLength(2);
    expect(jvm!.issues.some((issue) => issue.id.startsWith("jvm.duplicate"))).toBe(true);
  });

  it("detects duplicate Minecraft plugin jar versions as an error", () => {
    const report = analyzeDependencies({
      files: {},
      directoryListings: { plugins: ["EssentialsX-2.19.0.jar", "EssentialsX-2.20.1.jar", "LuckPerms-5.4.0.jar"] },
    });
    const minecraft = report.ecosystems.find((eco) => eco.ecosystem === "minecraft");
    expect(minecraft).toBeDefined();
    const duplicate = minecraft!.issues.find((issue) => issue.summary.includes("EssentialsX"));
    expect(duplicate).toBeDefined();
    expect(duplicate!.severity).toBe("error");
    expect(duplicate!.kind).toBe("evidence");
  });

  it("parses go.mod and cargo manifests", () => {
    const report = analyzeDependencies({
      files: {
        "go.mod": "module example.com/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)",
        "Cargo.toml": '[package]\nname = "app"\n\n[dependencies]\nserde = "1.0"\n',
      },
      directoryListings: {},
    });
    const go = report.ecosystems.find((eco) => eco.ecosystem === "go");
    expect(go!.components.some((component) => component.name === "github.com/gin-gonic/gin")).toBe(true);
    const rust = report.ecosystems.find((eco) => eco.ecosystem === "rust");
    expect(rust!.components.some((component) => component.name === "serde")).toBe(true);
  });

  it("reports missing evidence when nothing is found", () => {
    const report = analyzeDependencies({ files: {}, directoryListings: {} });
    expect(report.ecosystems).toHaveLength(0);
    expect(report.missingEvidence.length).toBeGreaterThan(0);
  });
});

describe("additional ecosystems", () => {
  it("parses composer.json", () => {
    const report = analyzeDependencies({
      files: {
        "composer.json": JSON.stringify({
          require: { "laravel/framework": "^11.0", "guzzlehttp/guzzle": "*" },
        }),
        "composer.lock": "{}",
      },
      directoryListings: {},
    });
    const php = report.ecosystems.find((eco) => eco.ecosystem === "php");
    expect(php).toBeDefined();
    expect(php!.components.some((component) => component.name === "laravel/framework")).toBe(true);
    expect(php!.issues.some((issue) => issue.id === "php.unpinned")).toBe(true);
  });

  it("parses Gemfile and flags a missing lockfile", () => {
    const report = analyzeDependencies({
      files: { Gemfile: 'gem "rails", "~> 7.1"\ngem "puma"' },
      directoryListings: {},
    });
    const ruby = report.ecosystems.find((eco) => eco.ecosystem === "ruby");
    expect(ruby).toBeDefined();
    expect(ruby!.components.map((component) => component.name)).toContain("rails");
    expect(ruby!.issues.some((issue) => issue.id === "ruby.no-lockfile")).toBe(true);
  });

  it("parses NuGet PackageReference and packages.config", () => {
    const report = analyzeDependencies({
      files: {
        "app.csproj": '<Project><ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13.0.3" /></ItemGroup></Project>',
        "packages.config": '<packages><package id="Serilog" version="3.1.1" /></packages>',
      },
      directoryListings: {},
    });
    const dotnet = report.ecosystems.find((eco) => eco.ecosystem === "dotnet");
    expect(dotnet).toBeDefined();
    const names = dotnet!.components.map((component) => component.name);
    expect(names).toContain("Newtonsoft.Json");
    expect(names).toContain("Serilog");
  });

  it("parses gradle version catalogs", () => {
    const report = analyzeDependencies({
      files: {
        "gradle/libs.versions.toml": [
          "[versions]",
          'kotlin = "1.9.24"',
          "[libraries]",
          'kotlin-stdlib = { module = "org.jetbrains.kotlin:kotlin-stdlib", version.ref = "kotlin" }',
        ].join("\n"),
      },
      directoryListings: {},
    });
    const jvm = report.ecosystems.find(
      (eco) => eco.ecosystem === "jvm" && eco.manifests.includes("gradle/libs.versions.toml"),
    );
    expect(jvm).toBeDefined();
    expect(jvm!.components[0]!.name).toBe("org.jetbrains.kotlin:kotlin-stdlib");
    expect(jvm!.components[0]!.version).toBe("1.9.24");
  });
});