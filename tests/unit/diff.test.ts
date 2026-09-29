import { describe, expect, it } from "vitest";
import { formatUnifiedDiff, diffLines } from "../../src/shared/diff.js";

describe("diff engine", () => {
  it("produces context, additions and removals", () => {
    const oldText = "line one\nline two\nline three\nline four";
    const newText = "line one\nline 2\nline three\nline four\nline five";
    const lines = diffLines(oldText, newText);
    expect(lines.some((line) => line.type === "add" && line.line === "line 2")).toBe(true);
    expect(lines.some((line) => line.type === "remove" && line.line === "line two")).toBe(true);
    expect(lines.filter((line) => line.type === "context").length).toBeGreaterThanOrEqual(3);
  });

  it("formats a unified diff with correct counts", () => {
    const diff = formatUnifiedDiff("a\nb\nc\nd\ne\nf\ng\nh", "a\nb\nc\nX\ne\nf\ng\nh", {
      label: "config.yml",
    });
    expect(diff.text).toContain("--- config.yml");
    expect(diff.text).toContain("-d");
    expect(diff.text).toContain("+X");
    expect(diff.additions).toBe(1);
    expect(diff.removals).toBe(1);
  });

  it("handles identical content", () => {
    const diff = formatUnifiedDiff("same\ncontent", "same\ncontent");
    expect(diff.text).toBe("");
    expect(diff.additions).toBe(0);
  });

  it("handles empty old file", () => {
    const diff = formatUnifiedDiff("", "fresh\ncontent");
    expect(diff.additions).toBe(2);
    expect(diff.text).toContain("+fresh");
  });

  it("handles many separate hunks", () => {
    const oldLines = Array.from({ length: 60 }, (_v, index) => `line ${String(index)}`);
    const newLines = [...oldLines];
    newLines[2] = "changed early";
    newLines[57] = "changed late";
    const diff = formatUnifiedDiff(oldLines.join("\n"), newLines.join("\n"));
    expect(diff.additions).toBe(2);
    expect(diff.removals).toBe(2);
    expect((diff.text.match(/^@@/gm) ?? []).length).toBe(2);
  });

  it("falls back to a coarse diff for huge files", () => {
    const big = Array.from({ length: 3000 }, (_v, index) => `line ${String(index)}`).join("\n");
    const changed = big.replace("line 5", "line five");
    const diff = formatUnifiedDiff(big, changed);
    expect(diff.additions).toBe(1);
    expect(diff.removals).toBe(1);
  });
});
