export function matchGlob(pattern: string, value: string): boolean {
  const regex = globToRegExp(pattern);
  return regex.test(value);
}

export function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (const char of pattern) {
    if (char === "*") out += ".*";
    else if (char === "?") out += ".";
    else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
