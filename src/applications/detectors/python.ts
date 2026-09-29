import type { DetectionSignals, DetectorOutput } from "../types.js";

const PYTHON_MANIFESTS = ["requirements.txt", "pyproject.toml", "Pipfile", "setup.py"];

export function detectPython(signals: DetectionSignals): DetectorOutput | null {
  const evidence: DetectorOutput["evidence"] = [];
  let score = 0;
  const haystack = [signals.startupCommand, signals.invocation, signals.dockerImage]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const fileSet = new Set(signals.rootFiles.map((name) => name.toLowerCase()));
  const consoleText = signals.consoleLines.join("\n");

  let version: string | undefined;

  const manifest = PYTHON_MANIFESTS.find((name) => fileSet.has(name.toLowerCase()));
  if (manifest) {
    score += 0.4;
    evidence.push({ source: "file", detail: `${manifest} present` });
  }
  if (signals.configFiles["pyproject.toml"]) {
    const requires = /requires-python\s*=\s*"([^"]+)"/.exec(signals.configFiles["pyproject.toml"]);
    if (requires) {
      version = requires[1]!.replace(/[^\d.]/g, "") || undefined;
      evidence.push({ source: "file", detail: `pyproject requires-python: ${requires[1]}` });
    }
  }
  if (/\bpython3?\b|pip install|uvicorn|gunicorn|poetry run|pipenv/.test(haystack)) {
    score += 0.3;
    evidence.push({ source: "startup", detail: "startup command runs Python" });
  }
  if (signals.dockerImage && /\bpython(:|-)/i.test(signals.dockerImage)) {
    score += 0.25;
    evidence.push({ source: "docker", detail: `docker image ${signals.dockerImage}` });
  }
  for (const name of fileSet) {
    if (/^(main|app|bot|run|server)\.py$/.test(name)) {
      score += 0.15;
      evidence.push({ source: "file", detail: `entrypoint candidate ${name}` });
      break;
    }
  }
  if (/Traceback \(most recent call last\)|ModuleNotFoundError|ImportError/.test(consoleText)) {
    score += 0.15;
    evidence.push({ source: "console", detail: "python traceback observed" });
  }
  const consoleVersion = /Python (\d+\.\d+\.\d+)/.exec(consoleText);
  if (consoleVersion) {
    version = version ?? consoleVersion[1];
    evidence.push({ source: "console", detail: `python version ${consoleVersion[1]}` });
  }
  if (signals.directoryFiles["venv"] || signals.directoryFiles[".venv"]) {
    score += 0.05;
    evidence.push({ source: "file", detail: "virtualenv directory present" });
  }

  if (score < 0.3) return null;
  return {
    runtime: "python",
    application: "python-application",
    ...(version ? { version } : {}),
    confidence: Math.min(0.95, Number(score.toFixed(2))),
    evidence,
  };
}
