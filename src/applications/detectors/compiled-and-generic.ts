import type { DetectionSignals, DetectorOutput } from "../types.js";

export function detectGenericJava(signals: DetectionSignals): DetectorOutput | null {
  const evidence: DetectorOutput["evidence"] = [];
  let score = 0;
  const haystack = [signals.startupCommand, signals.invocation, signals.dockerImage]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const consoleText = signals.consoleLines.join("\n");

  const jarFiles = signals.rootFiles.filter((name) => name.toLowerCase().endsWith(".jar"));
  const isJavaStartup = /\bjava\b|-xmx|-xms/.test(haystack);
  if (isJavaStartup) {
    score += 0.4;
    evidence.push({ source: "startup", detail: "startup command runs a JVM" });
  }
  if (jarFiles.length > 0) {
    score += 0.25;
    evidence.push({ source: "file", detail: `jar file present: ${jarFiles[0]}` });
  }
  if (signals.dockerImage && /\b(java|openjdk|jdk|jre|eclipse-temurin|yolks)/i.test(signals.dockerImage)) {
    score += 0.2;
    evidence.push({ source: "docker", detail: `docker image ${signals.dockerImage}` });
  }
  if (/Exception in thread|at [a-z][\w.]*\.[A-Z][\w$]*\(/.test(consoleText)) {
    score += 0.2;
    evidence.push({ source: "console", detail: "java stack trace observed" });
  }
  if (score < 0.4) return null;

  const mainJar = jarFiles.find((name) => /server|app|application/i.test(name)) ?? jarFiles[0];
  return {
    runtime: "java",
    application: "java-application",
    ...(mainJar ? { distribution: mainJar.replace(/\.jar$/i, "") } : {}),
    confidence: Math.min(0.7, Number(score.toFixed(2))),
    evidence,
  };
}

export function detectGo(signals: DetectionSignals): DetectorOutput | null {
  const evidence: DetectorOutput["evidence"] = [];
  let score = 0;
  const haystack = [signals.startupCommand, signals.invocation, signals.dockerImage]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const fileSet = new Set(signals.rootFiles.map((name) => name.toLowerCase()));
  const consoleText = signals.consoleLines.join("\n");

  if (fileSet.has("go.mod")) {
    score += 0.5;
    evidence.push({ source: "file", detail: "go.mod present" });
  }
  if (signals.configFiles["go.mod"]) {
    const moduleName = /^module\s+(\S+)/m.exec(signals.configFiles["go.mod"]);
    if (moduleName) {
      evidence.push({ source: "file", detail: `go module ${moduleName[1]}` });
    }
  }
  if (/\.\/[a-z0-9_-]+$|\bgo run\b/.test(haystack)) {
    score += 0.2;
    evidence.push({ source: "startup", detail: "startup runs a compiled Go binary" });
  }
  if (signals.dockerImage && /golang|\bgo:/.test(signals.dockerImage)) {
    score += 0.25;
    evidence.push({ source: "docker", detail: `docker image ${signals.dockerImage}` });
  }
  if (/goroutine \d+ \[running\]|panic:/.test(consoleText)) {
    score += 0.25;
    evidence.push({ source: "console", detail: "go runtime panic observed" });
  }
  if (score < 0.4) return null;
  return {
    runtime: "go",
    application: "go-application",
    confidence: Math.min(0.9, Number(score.toFixed(2))),
    evidence,
  };
}

export function detectRust(signals: DetectionSignals): DetectorOutput | null {
  const evidence: DetectorOutput["evidence"] = [];
  let score = 0;
  const haystack = [signals.startupCommand, signals.invocation, signals.dockerImage]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const fileSet = new Set(signals.rootFiles.map((name) => name.toLowerCase()));
  const consoleText = signals.consoleLines.join("\n");

  if (fileSet.has("cargo.toml") || fileSet.has("cargo.lock")) {
    score += 0.5;
    evidence.push({ source: "file", detail: "Cargo manifest present" });
  }
  if (/target\/release|\.\/target\//.test(haystack)) {
    score += 0.25;
    evidence.push({ source: "startup", detail: "startup runs a compiled Rust binary" });
  }
  if (signals.dockerImage && /rust/.test(signals.dockerImage)) {
    score += 0.25;
    evidence.push({ source: "docker", detail: `docker image ${signals.dockerImage}` });
  }
  if (/thread '.*' panicked at|stack backtrace:/.test(consoleText)) {
    score += 0.25;
    evidence.push({ source: "console", detail: "rust panic observed" });
  }
  let distribution: string | undefined;
  const cargo = signals.configFiles["Cargo.toml"];
  if (cargo) {
    const frameworks: Array<[string, RegExp]> = [
      ["axum", /^\s*axum\s*=/m],
      ["actix-web", /^\s*actix-web\s*=/m],
      ["rocket", /^\s*rocket\s*=/m],
      ["warp", /^\s*warp\s*=/m],
      ["poem", /^\s*poem\s*=/m],
    ];
    for (const [name, pattern] of frameworks) {
      if (pattern.test(cargo)) {
        distribution = name;
        score += 0.1;
        evidence.push({ source: "file", detail: `Rust framework detected: ${name}` });
        break;
      }
    }
  }
  if (score < 0.4) return null;
  return {
    runtime: "rust",
    application: "rust-application",
    ...(distribution ? { distribution } : {}),
    confidence: Math.min(0.9, Number(score.toFixed(2))),
    evidence,
  };
}

export function detectGenericContainer(signals: DetectionSignals): DetectorOutput | null {
  if (!signals.dockerImage) return null;
  const image = signals.dockerImage;
  const repo = image.split(":")[0]!.split("/").pop() ?? image;
  return {
    runtime: "container",
    application: repo,
    distribution: image,
    confidence: 0.35,
    evidence: [
      {
        source: "docker",
        detail: `docker image ${image} (no application-specific signals found)`,
        weight: 0.35,
      },
    ],
  };
}
