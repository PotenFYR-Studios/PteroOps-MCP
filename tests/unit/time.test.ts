import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration, parseTimeArgument } from "../../src/shared/time.js";
import { ValidationError } from "../../src/shared/errors.js";

describe("time helpers", () => {
  it("parses duration strings", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("20m")).toBe(20 * 60_000);
    expect(parseDuration("2h")).toBe(2 * 3_600_000);
    expect(parseDuration("1d")).toBe(86_400_000);
    expect(parseDuration("1h30m")).toBe(90 * 60_000);
  });

  it("treats bare numbers as minutes", () => {
    expect(parseDuration("20")).toBe(20 * 60_000);
  });

  it("rejects invalid durations", () => {
    expect(() => parseDuration("twenty minutes")).toThrowError(ValidationError);
    expect(() => parseDuration("5x")).toThrowError(ValidationError);
    expect(() => parseDuration("")).toThrowError(ValidationError);
  });

  it("formats durations readably", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_600_000)).toBe("1h 0m");
    expect(formatDuration(172_800_000)).toBe("2d 0h");
  });

  it("parses relative and absolute times", () => {
    const now = 1_700_000_000_000;
    expect(parseTimeArgument("-20m", now)).toBe(now - 20 * 60_000);
    expect(parseTimeArgument("20m ago", now)).toBe(now - 20 * 60_000);
    expect(parseTimeArgument("now", now)).toBe(now);
    expect(parseTimeArgument("1700000000000", now)).toBe(now);
    expect(parseTimeArgument("2023-11-14T22:13:20.000Z", now)).toBe(now);
  });

  it("rejects unparseable times", () => {
    expect(() => parseTimeArgument("yesterday-ish")).toThrowError(ValidationError);
  });
});
