import type { DetectionSignals, DetectorOutput } from "../types.js";

const DISTRIBUTION_SIGNALS: Array<{ distribution: string; patterns: RegExp[] }> = [
  { distribution: "paper", patterns: [/\bpaper\b/i, /purpur/i] },
  { distribution: "spigot", patterns: [/\bspigot\b/i] },
  { distribution: "fabric", patterns: [/\bfabric\b/i] },
  { distribution: "neoforge", patterns: [/\bneoforge\b/i] },
  { distribution: "forge", patterns: [/\bforge\b/i] },
  { distribution: "velocity", patterns: [/\bvelocity\b/i] },
  { distribution: "bungeecord", patterns: [/\bbungee(?:cord)?\b/i] },
];

const VERSION_PATTERNS: RegExp[] = [
  /starting minecraft server version\s+([0-9][\w.-]*)/i,
  /\(mc:\s*([0-9][\w.-]*)\)/i,
  /minecraft server version\s+([0-9][\w.-]*)/i,
  /paper[-_]?([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i,
  /minecraft_server\.([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i,
];

export function detectMinecraft(signals: DetectionSignals): DetectorOutput | null {
  const evidence: DetectorOutput["evidence"] = [];
  let score = 0;
  const haystack = [
    signals.startupCommand,
    signals.invocation,
    signals.dockerImage,
    signals.eggName,
    signals.nestName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const fileSet = new Set(signals.rootFiles.map((name) => name.toLowerCase()));
  const consoleText = signals.consoleLines.join("\n").toLowerCase();

  if (haystack.includes("minecraft")) {
    score += 0.25;
    evidence.push({ source: "startup", detail: "startup/egg/docker references minecraft" });
  }
  if (signals.dockerImage && /itzg\/minecraft|minecraft-server|pterodactyl\/yolks.*java/i.test(signals.dockerImage)) {
    score += signals.dockerImage.includes("minecraft") ? 0.25 : 0.05;
  }

  let distribution: string | undefined;
  for (const signal of DISTRIBUTION_SIGNALS) {
    if (signal.patterns.some((pattern) => pattern.test(haystack))) {
      distribution = signal.distribution;
      score += 0.15;
      evidence.push({ source: "startup", detail: `distribution signal: ${signal.distribution}` });
      break;
    }
  }

  if (fileSet.has("server.properties")) {
    score += 0.3;
    evidence.push({ source: "file", detail: "server.properties present" });
  }
  const plugins = signals.directoryFiles["plugins"] ?? signals.directoryFiles["/plugins"];
  const mods = signals.directoryFiles["mods"] ?? signals.directoryFiles["/mods"];
  if (plugins && plugins.length > 0) {
    score += 0.1;
    if (!distribution) {
      distribution = "bukkit-family";
      evidence.push({ source: "file", detail: `${plugins.length} entries in plugins/` });
    } else {
      evidence.push({ source: "file", detail: `${plugins.length} entries in plugins/` });
    }
  }
  if (mods && mods.length > 0) {
    score += 0.1;
    if (!distribution) {
      distribution = "modded";
      evidence.push({ source: "file", detail: `${mods.length} entries in mods/` });
    } else {
      evidence.push({ source: "file", detail: `${mods.length} entries in mods/` });
    }
  }
  if (fileSet.has("fabric-server-launch.jar") || fileSet.has("fabric-server-launcher.jar")) {
    distribution = "fabric";
    score += 0.2;
    evidence.push({ source: "file", detail: "fabric server launcher present" });
  }
  for (const name of fileSet) {
    if (/^forge-.*\.jar$/.test(name)) {
      distribution = "forge";
      score += 0.2;
      evidence.push({ source: "file", detail: `forge jar present: ${name}` });
      break;
    }
    if (/^neoforge-.*\.jar$/.test(name)) {
      distribution = "neoforge";
      score += 0.2;
      evidence.push({ source: "file", detail: `neoforge jar present: ${name}` });
      break;
    }
    if (/^paper.*\.jar$/.test(name)) {
      distribution = "paper";
      score += 0.2;
      evidence.push({ source: "file", detail: `paper jar present: ${name}` });
      break;
    }
    if (/^velocity.*\.jar$/.test(name)) {
      distribution = "velocity";
      score += 0.2;
      evidence.push({ source: "file", detail: `velocity jar present: ${name}` });
      break;
    }
    if (/^bungeecord\.jar$/.test(name)) {
      distribution = "bungeecord";
      score += 0.2;
      evidence.push({ source: "file", detail: "BungeeCord.jar present" });
      break;
    }
  }
  if (fileSet.has("paper.yml") || fileSet.has("paper-global.yml")) {
    distribution = distribution ?? "paper";
    score += 0.1;
    evidence.push({ source: "file", detail: "Paper configuration present" });
  }
  if (fileSet.has("velocity.toml")) {
    distribution = "velocity";
    score += 0.2;
    evidence.push({ source: "file", detail: "velocity.toml present" });
  }
  if (fileSet.has("world") || fileSet.has("world_nether") || fileSet.has("world_the_end")) {
    score += 0.05;
    evidence.push({ source: "file", detail: "minecraft world directory present" });
  }

  let version: string | undefined;
  for (const pattern of VERSION_PATTERNS) {
    const match = pattern.exec(consoleText);
    if (match) {
      version = match[1];
      score += 0.25;
      evidence.push({ source: "console", detail: `reported server version ${version}` });
      break;
    }
  }
  if (!version) {
    for (const name of signals.rootFiles) {
      const match = /paper[-_]?([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i.exec(name);
      if (match) {
        version = match[1];
        evidence.push({ source: "file", detail: `version inferred from jar name ${name}` });
        break;
      }
    }
  }

  const consoleDistribution = /this server is running (paper|spigot|fabric|forge|neoforge|purpur|velocity|bungeecord)/i.exec(
    consoleText,
  );
  if (consoleDistribution) {
    distribution = consoleDistribution[1]!.toLowerCase();
    score += 0.15;
    evidence.push({ source: "console", detail: `console reports ${distribution}` });
  }
  if (/loading \d+ (plugins|mods)|done \(\d/.test(consoleText)) {
    score += 0.1;
    evidence.push({ source: "console", detail: "minecraft startup logs observed" });
  }
  if (/net\.minecraft|log4j|mojang/.test(consoleText)) {
    score += 0.1;
    evidence.push({ source: "console", detail: "minecraft runtime classes in console" });
  }

  if (score < 0.35) return null;
  return {
    runtime: "java",
    application: "minecraft",
    ...(distribution ? { distribution } : {}),
    ...(version ? { version } : {}),
    confidence: Math.min(0.98, Number(score.toFixed(2))),
    evidence,
  };
}
