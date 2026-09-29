import type { DetectionSignals, DetectorOutput } from "../types.js";

const GAME_SIGNALS: Array<{ name: string; patterns: RegExp[] }> = [
  { name: "valheim", patterns: [/\bvalheim\b/i] },
  { name: "rust-dedicated", patterns: [/rustdedicated|steamcmd[^\n]*rust|\brust\b[^\n]*(dedicated|server)/i] },
  { name: "ark-survival", patterns: [/arkserver|ark[:\s_-]*survival|shootergame/i] },
  { name: "terraria", patterns: [/terraria|tshock/i] },
  { name: "7-days-to-die", patterns: [/7[_\s-]?days[_\s-]?to[_\s-]?die|sdtd/i] },
  { name: "counter-strike", patterns: [/counter[-_\s]?strike|\bsrcds\b|\bcs2\b|\bcsgo\b/i] },
  { name: "factorio", patterns: [/\bfactorio\b/i] },
  { name: "satisfactory", patterns: [/\bsatisfactory\b/i] },
  { name: "palworld", patterns: [/\bpalworld\b/i] },
  { name: "sample-sa-mp", patterns: [/\bsamp\b|multi[_\s-]?theft[_\s-]?auto/i] },
  { name: "garrys-mod", patterns: [/garrys?[_ -]?mod|\bgmod\b/i] },
  { name: "dayz", patterns: [/dayz/i] },
];

export function detectGameServer(signals: DetectionSignals): DetectorOutput | null {
  const evidence: DetectorOutput["evidence"] = [];
  let score = 0;
  const haystack = [
    signals.startupCommand,
    signals.invocation,
    signals.dockerImage,
    signals.eggName,
    signals.nestName,
    ...signals.variables.map((variable) => `${variable.name}=${variable.value}`),
  ]
    .filter(Boolean)
    .join(" ");
  const consoleText = signals.consoleLines.join("\n");

  let application: string | null = null;
  for (const game of GAME_SIGNALS) {
    if (game.patterns.some((pattern) => pattern.test(haystack))) {
      application = game.name;
      score += 0.45;
      evidence.push({ source: "startup", detail: `game server signal for ${game.name}` });
      break;
    }
  }
  if (!application) {
    for (const game of GAME_SIGNALS) {
      if (consoleText.length > 0 && game.patterns.some((pattern) => pattern.test(consoleText))) {
        application = game.name;
        score += 0.35;
        evidence.push({ source: "console", detail: `game server banner for ${game.name}` });
        break;
      }
    }
  }
  if (!application) return null;

  const steam = /\bsteamcmd\b|steam\/steamapps|steamapps\/common/i.test(haystack);
  if (steam) {
    score += 0.25;
    evidence.push({ source: "startup", detail: "steamcmd/steamapps present" });
  }
  if (signals.dockerImage && /steamcmd|gameserver|game-server/i.test(signals.dockerImage)) {
    score += 0.1;
    evidence.push({ source: "docker", detail: `game server image ${signals.dockerImage}` });
  }
  if (/server (is )?(started|running|listening)|server started successfully/i.test(consoleText)) {
    score += 0.1;
    evidence.push({ source: "console", detail: "game server startup banner observed" });
  }
  if (signals.variables.some((variable) => /server[_-]?port|game[_-]?port/i.test(variable.name))) {
    score += 0.05;
    evidence.push({ source: "startup", detail: "server/game port variable configured" });
  }

  if (score < 0.45) return null;
  return {
    runtime: "native",
    application,
    distribution: "dedicated-server",
    confidence: Math.min(0.85, Number(score.toFixed(2))),
    evidence,
  };
}

export function detectPhp(signals: DetectionSignals): DetectorOutput | null {
  const evidence: DetectorOutput["evidence"] = [];
  let score = 0;
  const haystack = [signals.startupCommand, signals.invocation, signals.dockerImage]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const fileSet = new Set(signals.rootFiles.map((name) => name.toLowerCase()));

  if (fileSet.has("composer.json") || fileSet.has("index.php") || fileSet.has("artisan")) {
    score += 0.4;
    evidence.push({
      source: "file",
      detail: fileSet.has("artisan")
        ? "artisan present (Laravel project)"
        : fileSet.has("composer.json")
          ? "composer.json present"
          : "index.php present",
    });
  }
  if (/\bphp\b|php-fpm|artisan serve/.test(haystack)) {
    score += 0.3;
    evidence.push({ source: "startup", detail: "startup runs PHP" });
  }
  if (signals.dockerImage && /php/i.test(signals.dockerImage)) {
    score += 0.25;
    evidence.push({ source: "docker", detail: `docker image ${signals.dockerImage}` });
  }
  let distribution: string | undefined;
  const composer = signals.configFiles["composer.json"];
  if (composer) {
    try {
      const parsed = JSON.parse(composer) as {
        require?: Record<string, string>;
        name?: string;
      };
      const requires = parsed.require ?? {};
      if ("laravel/framework" in requires) distribution = "laravel";
      else if (/^symfony\//.test(Object.keys(requires).join(" "))) distribution = "symfony";
      else if ("wordpress/wordpress" in requires || (parsed.name ?? "").includes("wordpress")) {
        distribution = "wordpress";
      }
      score += 0.1;
      evidence.push({
        source: "file",
        detail: `composer.json parsed${distribution ? ` (${distribution})` : ""}`,
      });
    } catch {
      evidence.push({ source: "file", detail: "composer.json present (unparseable)" });
    }
  }
  if (score < 0.4) return null;
  return {
    runtime: "php",
    application: "php-application",
    ...(distribution ? { distribution } : {}),
    confidence: Math.min(0.9, Number(score.toFixed(2))),
    evidence,
  };
}

export function detectRuby(signals: DetectionSignals): DetectorOutput | null {
  const evidence: DetectorOutput["evidence"] = [];
  let score = 0;
  const haystack = [signals.startupCommand, signals.invocation, signals.dockerImage]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const fileSet = new Set(signals.rootFiles.map((name) => name.toLowerCase()));

  if (fileSet.has("gemfile") || fileSet.has("rakefile")) {
    score += 0.4;
    evidence.push({ source: "file", detail: "Gemfile present" });
  }
  if (/\bruby\b|\bbundle\b|\brails\b|puma|unicorn/.test(haystack)) {
    score += 0.3;
    evidence.push({ source: "startup", detail: "startup runs Ruby" });
  }
  if (signals.dockerImage && /ruby/i.test(signals.dockerImage)) {
    score += 0.25;
    evidence.push({ source: "docker", detail: `docker image ${signals.dockerImage}` });
  }
  const gemfile = signals.configFiles["Gemfile"];
  let distribution: string | undefined;
  if (gemfile) {
    if (/gem ["']rails["']/.test(gemfile)) distribution = "rails";
    else if (/gem ["']sinatra["']/.test(gemfile)) distribution = "sinatra";
    score += 0.1;
    evidence.push({
      source: "file",
      detail: `Gemfile parsed${distribution ? ` (${distribution})` : ""}`,
    });
  }
  if (score < 0.4) return null;
  return {
    runtime: "ruby",
    application: "ruby-application",
    ...(distribution ? { distribution } : {}),
    confidence: Math.min(0.9, Number(score.toFixed(2))),
    evidence,
  };
}

export function detectComposeWorkload(signals: DetectionSignals): DetectorOutput | null {
  const evidence: DetectorOutput["evidence"] = [];
  const composeFile = signals.rootFiles.find((name) =>
    /^(docker-)?compose\.ya?ml$/i.test(name),
  );
  if (!composeFile) return null;
  let score = 0.5;
  evidence.push({ source: "file", detail: `${composeFile} present` });
  const content = signals.configFiles[composeFile] ?? signals.configFiles["docker-compose.yml"];
  let services: string[] = [];
  if (content) {
    const matches = content.matchAll(/^\s{2}([A-Za-z0-9_.-]+):\s*$/gm);
    services = [...matches].map((match) => match[1]!).filter((name) => name !== "services");
    if (services.length > 0) {
      score += 0.15;
      evidence.push({
        source: "file",
        detail: `compose services: ${services.slice(0, 8).join(", ")}${services.length > 8 ? ` (+${services.length - 8} more)` : ""}`,
      });
    }
  }
  // A Pterodactyl server running a compose workload usually has an entry script
  const entry = signals.rootFiles.find((name) => /^(start|entrypoint|run)\.sh$/i.test(name));
  if (entry) {
    score += 0.1;
    evidence.push({ source: "file", detail: `${entry} entry script present` });
  }
  return {
    runtime: "container",
    application: "docker-compose-workload",
    ...(services.length > 0 ? { distribution: `${services.length}-services` } : {}),
    confidence: Math.min(0.75, Number(score.toFixed(2))),
    evidence,
  };
}
