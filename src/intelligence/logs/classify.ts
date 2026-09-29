import type { Severity } from "../../shared/types.js";

export type LifecycleKind = "started" | "ready" | "exited" | "crash";

export interface LineClassification {
  severity: Severity;
  subsystem: string | null;
  exceptionType: string | null;
  lifecycle: LifecycleKind | null;
}

const LEVEL_RE = /\b(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|SEVERE|FATAL|CRITICAL)\b/;
const BRACKET_LEVEL_RE =
  /\[[^\]]{0,60}?\b(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|SEVERE|FATAL|CRITICAL)\b[^\]]{0,20}?\]/;

const LEVEL_MAP: Record<string, Severity> = {
  TRACE: "debug",
  DEBUG: "debug",
  INFO: "info",
  NOTICE: "info",
  WARN: "warn",
  WARNING: "warn",
  ERROR: "error",
  SEVERE: "error",
  FATAL: "fatal",
  CRITICAL: "fatal",
};

const FATAL_KEYWORDS =
  /\bfatal\b|panic:|segmentation fault|core dumped|out of memory|\boom[- ]kill|sigsegv|sigabrt|sigkill|heap space|oomkilled/i;

const ERROR_KEYWORDS =
  /\berror\b|\bexception\b|failed|failure|refused|denied|unable to|cannot |can'?t |could not|not found|no such file|timed? out|unreachable|reset by peer|aborted|crash/i;

const WARN_KEYWORDS = /\bwarn(?:ing)?\b|deprecat|caution/i;
const DEBUG_KEYWORDS = /^\s*\[?(?:debug|trace)\]?|\bdebug:|trace:/i;

const STACK_CONTINUATION_RE =
  /^\s+at\s|^\s+\.\.\.\s+\d+\s+more|^Caused by: |^Suppressed: |^\s+File "[^"]+", line \d+|^\s*at [A-Za-z_$][\w$.]*\(/;

const JAVA_EXCEPTION_RE =
  /((?:[a-z][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error|Throwable))\b/;
const SIMPLE_EXCEPTION_RE = /\b([A-Z][A-Za-z0-9_]{2,}(?:Exception|Error|Throwable))\b/;
const SIGNAL_RE = /\b(SIGSEGV|SIGABRT|SIGKILL|SIGTERM|SIGBUS)\b/;
const EXIT_CODE_RE = /\bexit(?:ed|ing)?\s+(?:with\s+)?(?:code|status)\s+(\d+)/i;
const TRACEBACK_RE = /Traceback \(most recent call last\)/;

const CHAT_RE = /^<[A-Za-z0-9_]{2,16}>\s/;
const PREFIX_RE =
  /^\s*(?:\[[^\]]{0,40}\]\s*){0,3}(?:[A-Za-z0-9 ._$/-]{0,40}\/(?:INFO|WARN|ERROR|DEBUG|TRACE)\]:?\s*)?/;

interface SubsystemRule {
  subsystem: string;
  regex: RegExp;
}

const SUBSYSTEM_RULES: SubsystemRule[] = [
  { subsystem: "memory", regex: /outofmemory|heap|garbage collect|\bgc\b|memory limit|\boom\b/i },
  {
    subsystem: "database",
    regex: /\bsql\b|sqlstate|jdbc|mysql|mariadb|postgres|mongodb|redis|sqlite|database/i,
  },
  {
    subsystem: "network",
    regex:
      /econnrefused|econnreset|etimedout|ehostunreach|enetunreach|\bsocket\b|bind|port \d|dns\b|ssl\b|tls\b|handshake|websocket|connection/i,
  },
  {
    subsystem: "auth",
    regex: /authenticat|login|credential|permission denied|unauthorized|forbidden|access denied|token/i,
  },
  {
    subsystem: "storage",
    regex: /no space left|enospc|disk full|filesystem|files? (?:not found|missing)|i\/o error/i,
  },
  {
    subsystem: "module",
    regex: /cannot find module|modulenotfounderror|no module named|classnotfound|noclassdeffound|unable to load (?:module|plugin|class)|unknown module/i,
  },
  {
    subsystem: "config",
    regex: /invalid (?:config|configuration|setting)|failed to (?:load|parse|read) (?:the )?config|yamlerror|json\.decode|toml|unrecognized|unknown (?:option|property)|missing (?:property|option|setting)/i,
  },
  {
    subsystem: "process",
    regex: /exit(?:ed|ing)|process (?:finished|ended|stopped)|killed|signal|segmentation|panic/i,
  },
];

const LIFECYCLE_READY_RE =
  /done \([\d.]+s\)! for help|ready to accept|startup complete|server started|now listening|listening on|ready in \d|started successfully|startup finished/i;
const LIFECYCLE_STARTED_RE =
  /server marked as (?:starting|running)|container (?:marked as )?started|starting (?:server|process|application)|initializing server|loading server/i;
const LIFECYCLE_CRASH_RE =
  /crashed|crash detected|segmentation fault|\boom[- ]kill|out of memory|fatal error|core dumped/i;
const LIFECYCLE_EXITED_RE =
  /server marked as offline|container stopped|server stopped|shutting down|shutdown complete|stopping server|exiting on signal|process (?:exited|finished|ended)|application exited|exited with|server is (?:now )?stopping/i;

export function isStackContinuation(line: string): boolean {
  return STACK_CONTINUATION_RE.test(line);
}

export function isExceptionHeader(line: string): boolean {
  return (
    JAVA_EXCEPTION_RE.test(line) ||
    SIMPLE_EXCEPTION_RE.test(line) ||
    TRACEBACK_RE.test(line) ||
    SIGNAL_RE.test(line) ||
    /^[A-Za-z_$][\w$]*(?:Exception|Error)(: |$)/.test(line.trim())
  );
}

export function extractExceptionType(line: string): string | null {
  const java = JAVA_EXCEPTION_RE.exec(line);
  if (java) return java[1]!;
  const signal = SIGNAL_RE.exec(line);
  if (signal) return signal[1]!;
  const simple = SIMPLE_EXCEPTION_RE.exec(line);
  if (simple) return simple[1]!;
  const exitCode = EXIT_CODE_RE.exec(line);
  if (exitCode) return `ExitCode(${exitCode[1]})`;
  return null;
}

export function classifyConsoleLine(normalized: string): LineClassification {
  const probe = normalized.slice(0, 200);
  const lifecycle = detectLifecycle(normalized);
  if (lifecycle === "ready") {
    return { severity: "info", subsystem: "lifecycle", exceptionType: null, lifecycle };
  }

  const exceptionType = extractExceptionType(normalized);
  let severity = detectSeverity(probe, normalized);
  if (severity === "info" && exceptionType && isExceptionHeader(normalized)) {
    severity = "error";
  }

  let subsystem: string | null = null;
  if (lifecycle) {
    subsystem = "lifecycle";
  } else {
    for (const rule of SUBSYSTEM_RULES) {
      if (rule.regex.test(normalized)) {
        subsystem = rule.subsystem;
        break;
      }
    }
  }
  return { severity, subsystem, exceptionType, lifecycle };
}

function detectLifecycle(line: string): LifecycleKind | null {
  if (LIFECYCLE_READY_RE.test(line)) return "ready";
  if (LIFECYCLE_CRASH_RE.test(line)) return "crash";
  if (LIFECYCLE_STARTED_RE.test(line)) return "started";
  if (LIFECYCLE_EXITED_RE.test(line)) return "exited";
  return null;
}

function detectSeverity(probe: string, full: string): Severity {
  const bracket = BRACKET_LEVEL_RE.exec(probe);
  if (bracket) {
    const mapped = LEVEL_MAP[bracket[1]!];
    if (mapped) return mapped;
  }
  const word = LEVEL_RE.exec(probe);
  if (word) {
    const mapped = LEVEL_MAP[word[1]!];
    if (mapped && (mapped === "fatal" || isLikelyLevelToken(probe, word.index))) {
      return mapped;
    }
  }
  const stripped = full.replace(PREFIX_RE, "");
  if (CHAT_RE.test(stripped)) return "info";
  if (FATAL_KEYWORDS.test(full)) return "fatal";
  if (ERROR_KEYWORDS.test(full)) return "error";
  if (WARN_KEYWORDS.test(full)) return "warn";
  if (DEBUG_KEYWORDS.test(full)) return "debug";
  return "info";
}

function isLikelyLevelToken(text: string, index: number): boolean {
  const before = text[index - 1];
  const after = text[index + 1];
  const beforeOk = index === 0 || before === " " || before === "[" || before === ":" || before === "(";
  const afterOk =
    index === text.length - 1 || after === " " || after === "]" || after === ":" || after === ")" || after === "-";
  return beforeOk && afterOk;
}
