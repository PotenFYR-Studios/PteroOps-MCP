import { createHash } from "node:crypto";

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function shortHash(input: string | Buffer, length = 16): string {
  return sha256Hex(input).slice(0, length);
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const HEX_RE = /\b(?:0x)?[0-9a-f]{8,}\b/gi;
const NUMBER_RE = /-?\d+(?:\.\d+)?/g;
const QUOTED_RE = /"[^"]*"|'[^']*'/g;
const PATH_RE = /(?:[A-Za-z]:)?(?:[\\/][\w.@+-]+){2,}[\\/]?/g;
const WHITESPACE_RE = /\s+/g;

export function normalizeForFingerprint(input: string): string {
  let text = input;
  text = text.replace(UUID_RE, "\u0001uuid\u0001");
  text = text.replace(IPV4_RE, "\u0001ip\u0001");
  text = text.replace(HEX_RE, "\u0001hex\u0001");
  text = text.replace(QUOTED_RE, "\u0001str\u0001");
  text = text.replace(PATH_RE, "\u0001path\u0001");
  text = text.replace(NUMBER_RE, "\u0001n\u0001");
  text = text.replace(WHITESPACE_RE, " ").trim();
  return text.length > 512 ? text.slice(0, 512) : text;
}

export function fingerprintOf(input: string): string {
  return shortHash(normalizeForFingerprint(input));
}

export function fingerprintOfExceptionHeader(headerLine: string): string {
  const withoutTimestamp = headerLine.replace(/^\s*\[[^\]]*\]\s*/, "");
  const withoutThread = withoutTimestamp.replace(/^[\w .$-]+\/(?:ERROR|WARN|INFO|DEBUG)\]\s*/i, "");
  return shortHash(normalizeForFingerprint(withoutThread));
}
