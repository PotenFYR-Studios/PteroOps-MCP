export type ErrorCode =
  | "CONFIG"
  | "AUTH"
  | "CAPABILITY_MISSING"
  | "NOT_FOUND"
  | "VALIDATION"
  | "POLICY_DENIED"
  | "RISK_TOO_HIGH"
  | "STALE_WRITE"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UPSTREAM"
  | "INTERNAL";

export interface StructuredErrorShape {
  code: ErrorCode;
  message: string;
  hint?: string;
  retryable?: boolean;
  correlationId?: string;
  details?: Record<string, unknown>;
}

export interface PteroOpsErrorOptions {
  hint?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class PteroOpsError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly retryable: boolean;
  details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: PteroOpsErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.hint = options.hint;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }

  toShape(correlationId?: string): StructuredErrorShape {
    const shape: StructuredErrorShape = { code: this.code, message: this.message };
    if (this.hint !== undefined) shape.hint = this.hint;
    if (this.retryable) shape.retryable = true;
    if (correlationId !== undefined) shape.correlationId = correlationId;
    if (this.details !== undefined) shape.details = this.details;
    return shape;
  }
}

export class ConfigError extends PteroOpsError {
  constructor(message: string, options: PteroOpsErrorOptions = {}) {
    super("CONFIG", message, options);
  }
}

export class AuthError extends PteroOpsError {
  constructor(message: string, options: PteroOpsErrorOptions = {}) {
    super("AUTH", message, { retryable: false, ...options });
  }
}

export class CapabilityError extends PteroOpsError {
  readonly capability: string;

  constructor(capability: string, message?: string, options: PteroOpsErrorOptions = {}) {
    super(
      "CAPABILITY_MISSING",
      message ?? `The configured credentials do not provide capability "${capability}".`,
      { hint: "Add a suitable API key to the panel configuration.", ...options },
    );
    this.capability = capability;
    this.details = { ...this.details, capability };
  }
}

export class NotFoundError extends PteroOpsError {
  constructor(message: string, options: PteroOpsErrorOptions = {}) {
    super("NOT_FOUND", message, { retryable: false, ...options });
  }
}

export class ValidationError extends PteroOpsError {
  constructor(message: string, options: PteroOpsErrorOptions = {}) {
    super("VALIDATION", message, { retryable: false, ...options });
  }
}

export class PolicyDeniedError extends PteroOpsError {
  readonly policyId: string;

  constructor(policyId: string, message: string, options: PteroOpsErrorOptions = {}) {
    super("POLICY_DENIED", message, { retryable: false, ...options });
    this.policyId = policyId;
    this.details = { ...this.details, policyId };
  }
}

export class StaleWriteError extends PteroOpsError {
  constructor(message: string, options: PteroOpsErrorOptions = {}) {
    super("STALE_WRITE", message, { retryable: true, ...options });
  }
}

export class RateLimitedError extends PteroOpsError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, options: PteroOpsErrorOptions = {}) {
    super("RATE_LIMITED", message, { retryable: true, ...options });
    this.retryAfterMs = retryAfterMs;
    if (retryAfterMs !== undefined) this.details = { ...this.details, retryAfterMs };
  }
}

export class TimeoutError extends PteroOpsError {
  constructor(message: string, options: PteroOpsErrorOptions = {}) {
    super("TIMEOUT", message, { retryable: true, ...options });
  }
}

export class UpstreamError extends PteroOpsError {
  readonly status?: number;
  readonly endpoint?: string;
  readonly panel?: string;

  constructor(message: string, options: PteroOpsErrorOptions & { status?: number; endpoint?: string; panel?: string } = {}) {
    const retryable = options.status === undefined || options.status >= 500;
    super("UPSTREAM", message, { retryable, ...options });
    this.status = options.status;
    this.endpoint = options.endpoint;
    this.panel = options.panel;
  }
}

export class InternalError extends PteroOpsError {
  constructor(message: string, options: PteroOpsErrorOptions = {}) {
    super("INTERNAL", message, options);
  }
}
