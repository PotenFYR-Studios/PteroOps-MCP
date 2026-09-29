const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g;

const ISO_TIMESTAMP_RE =
  /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?(?:Z|[+-]\d{2}:?\d{2})?)\]?\s*/;

export const MAX_CONSOLE_LINE_LENGTH = 4000;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export interface NormalizedConsoleLine {
  raw: string;
  normalized: string;
  embeddedTimestamp: number | null;
}

export function normalizeConsoleLine(rawInput: string): NormalizedConsoleLine {
  const raw = rawInput.length > MAX_CONSOLE_LINE_LENGTH ? rawInput.slice(0, MAX_CONSOLE_LINE_LENGTH) : rawInput;
  let text = stripAnsi(raw).replace(/\r/g, "");
  let embeddedTimestamp: number | null = null;
  const match = ISO_TIMESTAMP_RE.exec(text);
  if (match) {
    const parsed = Date.parse(match[1]!.replace(",", "."));
    if (!Number.isNaN(parsed)) {
      embeddedTimestamp = parsed;
      text = text.slice(match[0].length);
    }
  }
  text = text.replace(/\s+$/, "");
  return { raw, normalized: text, embeddedTimestamp };
}

export function extractMinecraftTimestamp(line: string): number | null {
  const match = /^\[(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?\]\s*/.exec(line);
  if (!match) return null;
  const now = new Date();
  now.setHours(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0));
  return now.getTime();
}
