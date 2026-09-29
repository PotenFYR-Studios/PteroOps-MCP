export const REDACTED = "[REDACTED]";

interface RedactionPattern {
  name: string;
  regex: RegExp;
}

const SECRET_KEY_RE =
  /^(?:.*[-_.])?(?:password|passwd|pwd|secret|token|api[-_]?key|apikey|authorization|auth|cookie|private[-_]?key|client[-_]?key|application[-_]?key|credentials?)$/i;

const DEFAULT_PATTERNS: RedactionPattern[] = [
  { name: "pterodactyl-key", regex: /\bptl[ac]_[A-Za-z0-9]{16,}\b/g },
  { name: "bearer", regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g },
  {
    name: "private-key",
    regex:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { name: "openai-key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "github-token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { name: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    name: "connection-string",
    regex:
      /(?<=(?:mysql|mariadb|postgres(?:ql)?|redis|mongodb(?:\+srv)?|amqp|ftp|sftp):\/\/)[^\s:@/]+:[^\s@/]+@/gi,
  },
  {
    name: "password-assignment",
    regex: /\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*["']?([^\s"',;]{4,})["']?/gi,
  },
];

export interface RedactionOptions {
  extraPatterns?: string[];
  extraSecrets?: string[];
}

export interface RedactionReport {
  class: string;
  applied: number;
}

export class RedactionEngine {
  private readonly patterns: RedactionPattern[];
  private readonly secrets: string[] = [];
  private readonly counts = new Map<string, number>();

  constructor(options: RedactionOptions = {}) {
    this.patterns = [...DEFAULT_PATTERNS];
    for (const pattern of options.extraPatterns ?? []) {
      this.patterns.push({ name: "custom", regex: new RegExp(pattern, "g") });
    }
    for (const secret of options.extraSecrets ?? []) {
      this.registerSecret(secret);
    }
  }

  registerSecret(value: string | undefined | null): void {
    if (!value || value.length < 6) return;
    if (this.secrets.includes(value)) return;
    this.secrets.push(value);
  }

  get hitCounts(): ReadonlyMap<string, number> {
    return this.counts;
  }

  redact(input: string): string {
    let text = input;
    for (const secret of this.secrets) {
      if (text.includes(secret)) {
        text = text.split(secret).join(REDACTED);
        this.bump("registered-secret");
      }
    }
    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      text = text.replace(pattern.regex, (match, group1?: string) => {
        this.bump(pattern.name);
        if (pattern.name === "password-assignment" && typeof group1 === "string") {
          return match.replace(group1, REDACTED);
        }
        return REDACTED;
      });
    }
    return text;
  }

  redactUnknown(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return this.redact(value);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return value;
    }
    if (typeof value === "function" || typeof value === "symbol") return REDACTED;
    if (depth > 12) return REDACTED;
    if (typeof value === "object") {
      if (seen.has(value)) return REDACTED;
      seen.add(value);
      if (Array.isArray(value)) {
        return value.map((item) => this.redactUnknown(item, depth + 1, seen));
      }
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_KEY_RE.test(key) && entry !== null && entry !== undefined) {
          this.bump("secret-key");
          out[key] = REDACTED;
        } else {
          out[key] = this.redactUnknown(entry, depth + 1, seen);
        }
      }
      return out;
    }
    return REDACTED;
  }

  redactObject<T>(value: T): T {
    return this.redactUnknown(value) as T;
  }

  private bump(name: string): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }
}
