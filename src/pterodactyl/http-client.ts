import type { Logger } from "../observability/logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { RedactionEngine } from "../shared/redaction.js";
import {
  AuthError,
  NotFoundError,
  PteroOpsError,
  RateLimitedError,
  TimeoutError,
  UpstreamError,
} from "../shared/errors.js";
import { sleep } from "../shared/async.js";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface PteroHttpClientOptions {
  panel: string;
  baseUrl: string;
  apiKey: string;
  keyKind: "client" | "application" | "unknown";
  timeoutMs: number;
  maxRetries: number;
  logger: Logger;
  metrics: MetricsRegistry;
  redactor: RedactionEngine;
}

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  rawBody?: string;
  contentType?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  expectText?: boolean;
  maxRetries?: number;
}

export interface JsonResponse<T> {
  status: number;
  data: T;
  requestId: string | null;
}

interface CircuitState {
  failures: number;
  openedAt: number | null;
  probeInFlight: boolean;
}

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 30_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class PteroHttpClient {
  private readonly circuit: CircuitState = { failures: 0, openedAt: null, probeInFlight: false };

  constructor(private readonly options: PteroHttpClientOptions) {}

  get panel(): string {
    return this.options.panel;
  }

  async requestJson<T>(request: RequestOptions): Promise<JsonResponse<T>> {
    const { text, status, headers } = await this.send(request);
    if (text.trim() === "") {
      return { status, data: undefined as T, requestId: headers.get("x-request-id") };
    }
    try {
      return { status, data: JSON.parse(text) as T, requestId: headers.get("x-request-id") };
    } catch (error) {
      throw new UpstreamError(
        `Panel ${this.options.panel} returned invalid JSON for ${request.path}`,
        { endpoint: request.path, panel: this.options.panel, status, cause: error },
      );
    }
  }

  async requestText(request: RequestOptions): Promise<{ text: string; status: number }> {
    const { text, status } = await this.send({ ...request, expectText: true });
    return { text, status };
  }

  async requestEmpty(request: RequestOptions): Promise<{ status: number }> {
    const { status } = await this.send(request);
    return { status };
  }

  private async send(request: RequestOptions): Promise<{
    text: string;
    status: number;
    headers: Headers;
  }> {
    const method = request.method;
    const retryable =
      method === "GET" &&
      (request.maxRetries ?? this.options.maxRetries) > 0 &&
      !this.isCircuitOpen();
    const maxAttempts = retryable ? (request.maxRetries ?? this.options.maxRetries) + 1 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = Date.now();
      try {
        const response = await this.sendOnce(request, startedAt);
        this.circuit.failures = 0;
        this.circuit.openedAt = null;
        this.circuit.probeInFlight = false;
        return response;
      } catch (error) {
        lastError = error;
        const retryAfter = error instanceof RateLimitedError ? error.retryAfterMs : undefined;
        const shouldRetry =
          attempt < maxAttempts &&
          (error instanceof RateLimitedError ||
            error instanceof TimeoutError ||
            (error instanceof UpstreamError && error.status !== undefined && RETRYABLE_STATUSES.has(error.status)) ||
            (error instanceof UpstreamError && error.status === undefined));
        if (!shouldRetry) {
          this.recordFailure(error);
          throw error;
        }
        const backoff = Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.random() * 200;
        const delay = Math.max(backoff, retryAfter ?? 0);
        this.options.logger.warn("retrying pterodactyl request", {
          panel: this.options.panel,
          method,
          path: request.path,
          attempt,
          delayMs: Math.round(delay),
          error: (error as Error).message,
        });
        await sleep(Math.min(delay, 15_000), request.signal);
      }
    }
    this.recordFailure(lastError);
    throw lastError instanceof PteroOpsError
      ? lastError
      : new UpstreamError(`Request to ${request.path} failed`, {
          endpoint: request.path,
          panel: this.options.panel,
          cause: lastError,
        });
  }

  private async sendOnce(
    request: RequestOptions,
    startedAt: number,
  ): Promise<{ text: string; status: number; headers: Headers }> {
    if (this.isCircuitOpen()) {
      throw new UpstreamError(
        `Panel ${this.options.panel} circuit breaker is open after repeated failures; retry later`,
        { endpoint: request.path, panel: this.options.panel, status: 503 },
      );
    }
    const url = new URL(`${this.options.baseUrl}${request.path}`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const timeoutMs = request.timeoutMs ?? this.options.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    const onAbort = (): void => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", onAbort, { once: true });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      Accept: "application/json",
    };
    if (request.body !== undefined) headers["Content-Type"] = "application/json";
    if (request.rawBody !== undefined) {
      headers["Content-Type"] = request.contentType ?? "text/plain";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method,
        headers,
        ...(request.rawBody !== undefined
          ? { body: request.rawBody }
          : request.body !== undefined
            ? { body: JSON.stringify(request.body) }
            : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && !request.signal?.aborted) {
        throw new TimeoutError(
          `Request ${request.method} ${request.path} on panel ${this.options.panel} timed out after ${timeoutMs}ms`,
          { cause: error },
        );
      }
      throw new UpstreamError(
        `Network error calling ${request.method} ${request.path} on panel ${this.options.panel}: ${sanitizeNetworkError(error)}`,
        { endpoint: request.path, panel: this.options.panel, cause: error },
      );
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }

    const latency = Date.now() - startedAt;
    this.options.metrics.observe("ptero_api_latency_ms", latency, { panel: this.options.panel });
    this.options.metrics.increment("ptero_api_requests_total", 1, {
      panel: this.options.panel,
      method: request.method,
      status: String(response.status),
    });

    if (response.status >= 400) {
      const bodyText = await safeReadText(response);
      const parsed = tryParseJson(bodyText);
      const detail = extractErrorMessage(parsed) ?? `HTTP ${response.status}`;
      const redactedDetail = this.options.redactor.redact(detail);
      if (response.status === 401 || response.status === 403) {
        throw new AuthError(
          `Panel ${this.options.panel} rejected the API key (HTTP ${response.status}): ${redactedDetail}`,
          { details: { status: response.status, endpoint: request.path } },
        );
      }
      if (response.status === 404) {
        throw new NotFoundError(`${redactedDetail} (${request.method} ${request.path})`, {
          details: { endpoint: request.path, panel: this.options.panel },
        });
      }
      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        this.options.metrics.increment("ptero_api_rate_limited_total", 1, {
          panel: this.options.panel,
        });
        throw new RateLimitedError(
          `Panel ${this.options.panel} rate limited the request: ${redactedDetail}`,
          retryAfter,
          { details: { endpoint: request.path } },
        );
      }
      this.options.metrics.increment("ptero_api_errors_total", 1, {
        panel: this.options.panel,
        status: String(response.status),
      });
      throw new UpstreamError(
        `Panel ${this.options.panel} returned HTTP ${response.status} for ${request.method} ${request.path}: ${redactedDetail}`,
        { endpoint: request.path, panel: this.options.panel, status: response.status },
      );
    }

    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining !== null && Number(remaining) <= 5) {
      this.options.logger.warn("pterodactyl rate limit nearly exhausted", {
        panel: this.options.panel,
        remaining: Number(remaining),
      });
    }

    const text = await safeReadText(response);
    return { text, status: response.status, headers: response.headers };
  }

  private isCircuitOpen(): boolean {
    if (this.circuit.openedAt === null) return false;
    if (Date.now() - this.circuit.openedAt >= CIRCUIT_OPEN_MS) {
      if (!this.circuit.probeInFlight) {
        this.circuit.probeInFlight = true;
        return false;
      }
      return true;
    }
    return true;
  }

  private recordFailure(error: unknown): void {
    if (error instanceof UpstreamError && error.status !== undefined && error.status < 500) {
      return;
    }
    this.circuit.failures += 1;
    if (this.circuit.failures >= CIRCUIT_FAILURE_THRESHOLD && this.circuit.openedAt === null) {
      this.circuit.openedAt = Date.now();
      this.options.logger.warn("opening circuit breaker for panel", {
        panel: this.options.panel,
        failures: this.circuit.failures,
      });
      this.options.metrics.increment("ptero_api_circuit_open_total", 1, { panel: this.options.panel });
    }
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function tryParseJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractErrorMessage(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const errors = record.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    if (first !== null && typeof first === "object") {
      const detail = (first as Record<string, unknown>).detail;
      const code = (first as Record<string, unknown>).code;
      if (typeof detail === "string") {
        return typeof code === "string" ? `${code}: ${detail}` : detail;
      }
    }
    if (typeof first === "string") return first;
  }
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  return null;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), 60_000);
  return undefined;
}

function sanitizeNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = cause ? `${message} (${cause})` : message;
  return combined.replace(/ptl[ac]_[A-Za-z0-9]+/g, "[REDACTED]");
}
