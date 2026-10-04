import type { CrashAssessment } from "../intelligence/crash-loop/detector.js";
import type { HealthStatus, ServerRef } from "../shared/types.js";
import { formatDuration } from "../shared/time.js";

export interface HealthCheck {
  name: string;
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
}

export interface HealthAssessment {
  ref: ServerRef;
  status: HealthStatus;
  score: number;
  checks: HealthCheck[];
  explanation: string;
  evidence: string[];
  assessedAt: number;
}

export interface HealthInput {
  ref: ServerRef;
  serverName: string;
  state: string | null;
  suspended: boolean;
  installing?: boolean;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  diskBytes: number | null;
  diskLimitBytes: number | null;
  cpuAveragePercent: number | null;
  uptimeMs: number | null;
  recentErrors: { count: number; windowMs: number } | null;
  crash: CrashAssessment;
  readyMarkerSeen: boolean | null;
  readyMarkerExpected: boolean;
  expectedStartupMs: number | null;
  assessedAt: number;
}

const ERROR_RATE_FAIL_PER_MINUTE = 20;
const ERROR_RATE_WARN_PER_MINUTE = 4;
const MEMORY_WARN_RATIO = 0.88;
const MEMORY_FAIL_RATIO = 0.96;
const DISK_WARN_RATIO = 0.9;
const DISK_FAIL_RATIO = 0.96;
const CPU_WARN_PERCENT = 95;

export function assessHealth(input: HealthInput): HealthAssessment {
  const checks: HealthCheck[] = [];
  const evidence: string[] = [];

  const stateCheck = evaluateState(input);
  checks.push(stateCheck);

  if (input.memoryBytes !== null && input.memoryLimitBytes !== null && input.memoryLimitBytes > 0) {
    const ratio = input.memoryBytes / input.memoryLimitBytes;
    const detail = `memory at ${(ratio * 100).toFixed(1)}% of limit (${formatBytes(input.memoryBytes)} / ${formatBytes(input.memoryLimitBytes)})`;
    if (ratio >= MEMORY_FAIL_RATIO) {
      checks.push({ name: "memory-pressure", status: "fail", detail });
      evidence.push(`memory usage ${(ratio * 100).toFixed(1)}% of allocation`);
    } else if (ratio >= MEMORY_WARN_RATIO) {
      checks.push({ name: "memory-pressure", status: "warn", detail });
    } else {
      checks.push({ name: "memory-pressure", status: "ok", detail });
    }
  } else {
    checks.push({ name: "memory-pressure", status: "unknown", detail: "memory metrics unavailable" });
  }

  if (input.diskBytes !== null && input.diskLimitBytes !== null && input.diskLimitBytes > 0) {
    const ratio = input.diskBytes / input.diskLimitBytes;
    const detail = `disk at ${(ratio * 100).toFixed(1)}% of allocation (${formatBytes(input.diskBytes)} / ${formatBytes(input.diskLimitBytes)})`;
    if (ratio >= DISK_FAIL_RATIO) {
      checks.push({ name: "disk-pressure", status: "fail", detail });
      evidence.push(`disk usage ${(ratio * 100).toFixed(1)}% of allocation`);
    } else if (ratio >= DISK_WARN_RATIO) {
      checks.push({ name: "disk-pressure", status: "warn", detail });
    } else {
      checks.push({ name: "disk-pressure", status: "ok", detail });
    }
  } else {
    checks.push({ name: "disk-pressure", status: "unknown", detail: "disk metrics unavailable" });
  }

  if (input.cpuAveragePercent !== null) {
    const detail = `average CPU ${input.cpuAveragePercent.toFixed(1)}%`;
    checks.push({
      name: "cpu-usage",
      status: input.cpuAveragePercent >= CPU_WARN_PERCENT ? "warn" : "ok",
      detail,
    });
  } else {
    checks.push({ name: "cpu-usage", status: "unknown", detail: "cpu metrics unavailable" });
  }

  if (input.recentErrors && input.recentErrors.windowMs > 0) {
    const perMinute = (input.recentErrors.count / input.recentErrors.windowMs) * 60_000;
    const detail = `${input.recentErrors.count} error/fatal lines in ${formatDuration(input.recentErrors.windowMs)} (${perMinute.toFixed(1)}/min)`;
    if (perMinute >= ERROR_RATE_FAIL_PER_MINUTE) {
      checks.push({ name: "error-rate", status: "fail", detail });
      evidence.push(detail);
    } else if (perMinute >= ERROR_RATE_WARN_PER_MINUTE) {
      checks.push({ name: "error-rate", status: "warn", detail });
    } else {
      checks.push({ name: "error-rate", status: "ok", detail });
    }
  } else {
    checks.push({ name: "error-rate", status: "unknown", detail: "no console data available" });
  }

  if (input.crash.crashCount > 0) {
    const detail = `${input.crash.crashCount} short-lived process exits in ${formatDuration(input.crash.windowMs)}`;
    checks.push({
      name: "restart-frequency",
      status: input.crash.inCrashLoop ? "fail" : "warn",
      detail,
    });
    evidence.push(...input.crash.evidence.slice(0, 3));
  } else {
    checks.push({ name: "restart-frequency", status: "ok", detail: "no recent crashes observed" });
  }

  if (input.readyMarkerExpected) {
    if (input.readyMarkerSeen === true) {
      checks.push({ name: "ready-marker", status: "ok", detail: "application ready marker observed" });
    } else if (
      input.state === "running" &&
      input.expectedStartupMs !== null &&
      input.uptimeMs !== null &&
      input.uptimeMs > input.expectedStartupMs
    ) {
      checks.push({
        name: "ready-marker",
        status: "warn",
        detail: `no ready marker after ${formatDuration(input.uptimeMs)} (expected within ${formatDuration(input.expectedStartupMs)})`,
      });
      evidence.push("application has not reported readiness since start");
    } else {
      checks.push({ name: "ready-marker", status: "unknown", detail: "readiness not yet determinable" });
    }
  }

  const hasFail = checks.some((check) => check.status === "fail");
  const hasWarn = checks.some((check) => check.status === "warn");
  const state = input.state;
  const offline = state === "offline" || state === "suspended" || input.suspended;

  let status: HealthStatus;
  if (input.crash.inCrashLoop) {
    status = "crash_loop";
  } else if (state === "starting" || input.installing) {
    status = "starting";
  } else if (offline) {
    status = "unhealthy";
  } else if (hasFail) {
    status = "unhealthy";
  } else if (hasWarn) {
    status = "degraded";
  } else if (state === "running") {
    status = "healthy";
  } else {
    status = "unknown";
  }

  let score = 100;
  for (const check of checks) {
    if (check.status === "fail") score -= 30;
    else if (check.status === "warn") score -= 10;
  }
  if (status === "crash_loop") score = Math.min(score, 20);
  if (status === "unhealthy") score = Math.min(score, 45);
  if (status === "starting") score = Math.min(score, 70);
  score = Math.max(0, Math.min(100, score));

  const failing = checks.filter((check) => check.status === "fail");
  const warning = checks.filter((check) => check.status === "warn");
  const explanationParts: string[] = [`${input.serverName}: ${status}`];
  if (failing.length > 0) {
    explanationParts.push(failing.map((check) => `${check.name}: ${check.detail}`).join("; "));
  }
  if (warning.length > 0) {
    explanationParts.push(`warnings: ${warning.map((check) => check.name).join(", ")}`);
  }
  if (status === "healthy") explanationParts.push("all checks passed");
  if (status === "starting") explanationParts.push("startup in progress");

  return {
    ref: input.ref,
    status,
    score,
    checks,
    explanation: explanationParts.join(": "),
    evidence,
    assessedAt: input.assessedAt,
  };
}

function evaluateState(input: HealthInput): HealthCheck {
  if (input.suspended) {
    return { name: "process-state", status: "fail", detail: "server is suspended" };
  }
  switch (input.state) {
    case "running":
      return { name: "process-state", status: "ok", detail: "process is running" };
    case "starting":
      return { name: "process-state", status: "ok", detail: "process is starting" };
    case "stopping":
      return { name: "process-state", status: "warn", detail: "process is stopping" };
    case "offline":
      return { name: "process-state", status: "fail", detail: "process is offline" };
    case "installing":
      return { name: "process-state", status: "warn", detail: "server is installing" };
    default:
      return {
        name: "process-state",
        status: input.state === null ? "unknown" : "warn",
        detail: `process state: ${input.state ?? "unknown"}`,
      };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
