import type { DetectionSignals, DetectorOutput } from "../types.js";

const FRAMEWORK_SIGNALS: Array<{ name: string; packages: string[] }> = [
  { name: "nextjs", packages: ["next"] },
  { name: "nestjs", packages: ["@nestjs/core"] },
  { name: "nuxt", packages: ["nuxt"] },
  { name: "sveltekit", packages: ["@sveltejs/kit"] },
  { name: "astro", packages: ["astro"] },
  { name: "remix", packages: ["@remix-run/node", "@remix-run/react"] },
  { name: "express", packages: ["express"] },
  { name: "fastify", packages: ["fastify"] },
  { name: "hono", packages: ["hono"] },
  { name: "koa", packages: ["koa"] },
  { name: "@hapi/hapi", packages: ["@hapi/hapi"] },
  { name: "discord.js", packages: ["discord.js"] },
  { name: "socket.io", packages: ["socket.io"] },
];

export function detectNodeJs(signals: DetectionSignals): DetectorOutput | null {
  const evidence: DetectorOutput["evidence"] = [];
  let score = 0;
  const haystack = [signals.startupCommand, signals.invocation, signals.dockerImage]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const fileSet = new Set(signals.rootFiles.map((name) => name.toLowerCase()));
  const consoleText = signals.consoleLines.join("\n");

  let applicationName: string | undefined;
  let version: string | undefined;
  let distribution: string | undefined;

  const packageJsonRaw = signals.configFiles["package.json"];
  if (packageJsonRaw) {
    try {
      const parsed = JSON.parse(packageJsonRaw) as {
        name?: string;
        engines?: { node?: string };
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      score += 0.55;
      applicationName = parsed.name;
      evidence.push({
        source: "file",
        detail: `package.json present${parsed.name ? ` (name: ${parsed.name})` : ""}`,
      });
      if (parsed.engines?.node) {
        version = parsed.engines.node.replace(/[^\d.]/g, "") || undefined;
        evidence.push({ source: "file", detail: `engines.node: ${parsed.engines.node}` });
      }
      const deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
      for (const framework of FRAMEWORK_SIGNALS) {
        if (framework.packages.some((pkg) => pkg in deps)) {
          distribution = framework.name;
          score += 0.1;
          evidence.push({ source: "file", detail: `framework detected: ${framework.name}` });
          break;
        }
      }
    } catch {
      score += 0.3;
      evidence.push({ source: "file", detail: "package.json present (unparseable)" });
    }
  } else if (fileSet.has("package.json")) {
    score += 0.3;
    evidence.push({ source: "file", detail: "package.json present" });
  }
  for (const lockfile of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
    if (fileSet.has(lockfile)) {
      score += 0.1;
      evidence.push({ source: "file", detail: `${lockfile} present` });
      break;
    }
  }
  if (/\bnode\b|npm |yarn |pnpm |ts-node|tsx |bun /.test(haystack)) {
    score += 0.25;
    evidence.push({ source: "startup", detail: "startup command runs a Node.js runtime" });
  }
  if (signals.dockerImage && /\bnode(:|-)/i.test(signals.dockerImage)) {
    score += 0.25;
    evidence.push({ source: "docker", detail: `docker image ${signals.dockerImage}` });
  }
  if (/node:internal|npm ERR!|Cannot find module|at Object\.<anonymous>/.test(consoleText)) {
    score += 0.15;
    evidence.push({ source: "console", detail: "node runtime output observed" });
  }
  const nodeVersion = /Now using node v?(\d+\.\d+\.\d+)/.exec(consoleText);
  if (nodeVersion) {
    version = version ?? nodeVersion[1];
    evidence.push({ source: "console", detail: `node version ${nodeVersion[1]}` });
  }

  if (score < 0.3) return null;
  return {
    runtime: "node",
    application: "node-application",
    ...(distribution ? { distribution } : {}),
    ...(version ? { version } : {}),
    confidence: Math.min(0.96, Number(score.toFixed(2))),
    evidence: applicationName
      ? [
          ...evidence,
          { source: "file", detail: `package name: ${applicationName}`, weight: 0.2 },
        ]
      : evidence,
  };
}
