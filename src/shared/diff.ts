export interface DiffLine {
  type: "context" | "add" | "remove";
  line: string;
  oldLine: number | null;
  newLine: number | null;
}

const MAX_DIFF_LINES = 2500;

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return coarseDiff(oldLines, newLines);
  }
  const n = oldLines.length;
  const m = newLines.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        oldLines[i] === newLines[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push({ type: "context", line: oldLines[i]!, oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      out.push({ type: "remove", line: oldLines[i]!, oldLine: i + 1, newLine: null });
      i++;
    } else {
      out.push({ type: "add", line: newLines[j]!, oldLine: null, newLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "remove", line: oldLines[i]!, oldLine: i + 1, newLine: null });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", line: newLines[j]!, oldLine: null, newLine: j + 1 });
    j++;
  }
  return out;
}

export interface UnifiedDiff {
  text: string;
  additions: number;
  removals: number;
}

export function formatUnifiedDiff(
  oldText: string,
  newText: string,
  options: { context?: number; label?: string } = {},
): UnifiedDiff {
  const context = options.context ?? 3;
  const label = options.label ?? "file";
  const lines = diffLines(oldText, newText);
  let additions = 0;
  let removals = 0;
  for (const line of lines) {
    if (line.type === "add") additions++;
    if (line.type === "remove") removals++;
  }

  const changeIndices: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]!.type !== "context") changeIndices.push(index);
  }
  const hunks: string[] = [];
  if (changeIndices.length > 0) {
    const groups: Array<[number, number]> = [];
    let groupStart = changeIndices[0]!;
    let lastChange = changeIndices[0]!;
    for (const index of changeIndices.slice(1)) {
      if (index - lastChange > context * 2) {
        groups.push([groupStart, lastChange]);
        groupStart = index;
      }
      lastChange = index;
    }
    groups.push([groupStart, lastChange]);

    for (const [groupStartIndex, groupEndIndex] of groups) {
      const hunkStart = Math.max(0, groupStartIndex - context);
      const hunkEnd = Math.min(lines.length - 1, groupEndIndex + context);
      const hunkLines = lines.slice(hunkStart, hunkEnd + 1);
      const firstOld = hunkLines.find((line) => line.oldLine !== null)?.oldLine;
      const firstNew = hunkLines.find((line) => line.newLine !== null)?.newLine;
      const firstAdd = hunkLines.find((line) => line.type === "add")?.newLine;
      const firstRemove = hunkLines.find((line) => line.type === "remove")?.oldLine;
      const oldStart = oldText === "" ? 0 : firstOld ?? Math.max(1, (firstAdd ?? 1) - 1);
      const newStart = newText === "" ? 0 : firstNew ?? Math.max(1, (firstRemove ?? 1) - 1);
      const oldCount = hunkLines.filter((line) => line.type !== "add").length;
      const newCount = hunkLines.filter((line) => line.type !== "remove").length;
      hunks.push(
        [
          `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
          ...hunkLines.map((line) => {
            if (line.type === "add") return `+${line.line}`;
            if (line.type === "remove") return `-${line.line}`;
            return ` ${line.line}`;
          }),
        ].join("\n"),
      );
    }
  }
  const text = hunks.length === 0 ? "" : `--- ${label}\n+++ ${label}\n${hunks.join("\n")}`;
  return { text, additions, removals };
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

function coarseDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const out: DiffLine[] = [];
  const common = Math.min(oldLines.length, newLines.length);
  for (let i = 0; i < common; i++) {
    if (oldLines[i] === newLines[i]) {
      out.push({ type: "context", line: oldLines[i]!, oldLine: i + 1, newLine: i + 1 });
    } else {
      out.push({ type: "remove", line: oldLines[i]!, oldLine: i + 1, newLine: null });
      out.push({ type: "add", line: newLines[i]!, oldLine: null, newLine: i + 1 });
    }
  }
  for (let i = common; i < oldLines.length; i++) {
    out.push({ type: "remove", line: oldLines[i]!, oldLine: i + 1, newLine: null });
  }
  for (let i = common; i < newLines.length; i++) {
    out.push({ type: "add", line: newLines[i]!, oldLine: null, newLine: i + 1 });
  }
  return out;
}
