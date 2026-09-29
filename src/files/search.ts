export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  filesSearched: string[];
  filesSkipped: string[];
  truncated: boolean;
}

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
  maxLineLength?: number;
}

export function searchTextFiles(
  files: Record<string, string>,
  query: string,
  options: SearchOptions = {},
): SearchResult {
  const maxResults = Math.min(Math.max(options.maxResults ?? 50, 1), 500);
  const maxLineLength = options.maxLineLength ?? 300;
  const matches: SearchMatch[] = [];
  const filesSearched: string[] = [];
  const filesSkipped: string[] = [];
  let truncated = false;

  let regex: RegExp | null = null;
  if (options.regex) {
    try {
      regex = new RegExp(query, options.caseSensitive ? "" : "i");
    } catch {
      regex = null;
    }
  }
  const needle = options.caseSensitive ? query : query.toLowerCase();

  outer: for (const [file, content] of Object.entries(files)) {
    if (content.includes("\u0000")) {
      filesSkipped.push(file);
      continue;
    }
    filesSearched.push(file);
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const haystack = options.caseSensitive ? line : line.toLowerCase();
      const hit = regex !== null ? regex.test(line) : haystack.includes(needle);
      if (!hit) continue;
      matches.push({
        file,
        line: index + 1,
        text: line.length > maxLineLength ? `${line.slice(0, maxLineLength - 1)}…` : line,
      });
      if (matches.length >= maxResults) {
        truncated = true;
        break outer;
      }
    }
  }

  return { matches, filesSearched, filesSkipped, truncated };
}
