import type { RedactionEngine } from "../shared/redaction.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface LoggerOptions {
  level: LogLevel;
  pretty?: boolean;
  redactor?: RedactionEngine;
  sink?: (line: string) => void;
  bindings?: LogFields;
}

function defaultSink(line: string): void {
  process.stderr.write(`${line}\n`);
}

export class Logger {
  private readonly level: LogLevel;
  private readonly pretty: boolean;
  private readonly redactor?: RedactionEngine;
  private readonly sink: (line: string) => void;
  private readonly bindings: LogFields;

  constructor(options: LoggerOptions) {
    this.level = options.level;
    this.pretty = options.pretty ?? false;
    this.redactor = options.redactor;
    this.sink = options.sink ?? defaultSink;
    this.bindings = options.bindings ?? {};
  }

  child(bindings: LogFields): Logger {
    return new Logger({
      level: this.level,
      pretty: this.pretty,
      ...(this.redactor ? { redactor: this.redactor } : {}),
      sink: this.sink,
      bindings: { ...this.bindings, ...bindings },
    });
  }

  debug(message: string, fields?: LogFields): void {
    this.log("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.log("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.log("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.log("error", message, fields);
  }

  log(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const redactedMessage = this.redactor ? this.redactor.redact(message) : message;
    const merged: LogFields = { ...this.bindings, ...fields };
    const safeFields = this.redactor
      ? (this.redactor.redactUnknown(merged) as LogFields)
      : merged;
    const ts = new Date().toISOString();
    if (this.pretty) {
      const parts = Object.entries(safeFields)
        .map(([key, value]) => `${key}=${formatValue(value)}`)
        .join(" ");
      this.sink(`${ts} ${level.toUpperCase().padEnd(5)} ${redactedMessage}${parts ? ` ${parts}` : ""}`);
      return;
    }
    const payload: LogFields = { ts, level, msg: redactedMessage, ...safeFields };
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      serialized = JSON.stringify({ ts, level, msg: redactedMessage, error: "unserializable-fields" });
    }
    this.sink(serialized);
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value.includes(" ") ? JSON.stringify(value) : value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

export function createLogger(options: Partial<LoggerOptions> & { level?: LogLevel } = {}): Logger {
  return new Logger({
    level: options.level ?? "info",
    pretty: options.pretty ?? false,
    ...(options.redactor ? { redactor: options.redactor } : {}),
    ...(options.sink ? { sink: options.sink } : {}),
    ...(options.bindings ? { bindings: options.bindings } : {}),
  });
}
