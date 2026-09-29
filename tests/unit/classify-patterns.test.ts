import { describe, expect, it } from "vitest";
import { classifyConsoleLine, isExceptionHeader, isStackContinuation } from "../../src/intelligence/logs/classify.js";
import { matchPatterns } from "../../src/intelligence/logs/patterns.js";

describe("console classification", () => {
  it("detects Minecraft bracket levels", () => {
    expect(classifyConsoleLine("[12:31:44] [Server thread/ERROR]: Failed to load plugin").severity).toBe("error");
    expect(classifyConsoleLine("[12:31:44] [Server thread/WARN]: Deprecated API").severity).toBe("warn");
    expect(classifyConsoleLine("[12:31:44] [Server thread/INFO]: Done (12.345s)!").severity).toBe("info");
  });

  it("detects Java stack trace exception types", () => {
    const result = classifyConsoleLine(
      "java.lang.OutOfMemoryError: Java heap space",
    );
    expect(result.severity).toBe("fatal");
    expect(result.exceptionType).toBe("java.lang.OutOfMemoryError");
    expect(result.subsystem).toBe("memory");
  });

  it("detects Python tracebacks", () => {
    expect(isExceptionHeader("Traceback (most recent call last):")).toBe(true);
    const result = classifyConsoleLine("ModuleNotFoundError: No module named 'requests'");
    expect(result.exceptionType).toBe("ModuleNotFoundError");
    expect(result.subsystem).toBe("module");
  });

  it("detects lifecycle markers", () => {
    expect(classifyConsoleLine("Server marked as running").lifecycle).toBe("started");
    expect(classifyConsoleLine('Done (14.512s)! For help, type "help"').lifecycle).toBe("ready");
    expect(classifyConsoleLine("Server marked as offline").lifecycle).toBe("exited");
  });

  it("does not flag player chat as errors", () => {
    const result = classifyConsoleLine("<Steve> there was an error in my inventory yesterday");
    expect(result.severity).toBe("info");
  });

  it("recognizes stack continuation lines", () => {
    expect(isStackContinuation("\tat net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:123)")).toBe(true);
    expect(isStackContinuation("\t... 12 more")).toBe(true);
    expect(isStackContinuation("Caused by: java.lang.IllegalStateException: broken")).toBe(true);
    expect(isStackContinuation("Server marked as offline")).toBe(false);
  });

  it("extracts exit codes", () => {
    expect(classifyConsoleLine("Server process exited with code 137").exceptionType).toBe("ExitCode(137)");
  });

  it("maps subsystems", () => {
    expect(classifyConsoleLine("ERROR: communications link failure to mysql").subsystem).toBe("database");
    expect(classifyConsoleLine("jdbc: connection refused at 10.0.0.4:3306").subsystem).toBe("database");
    expect(classifyConsoleLine("connection refused to 10.0.0.4:25565").subsystem).toBe("network");
    expect(classifyConsoleLine("Permission denied while writing world/level.dat").subsystem).toBe("auth");
    expect(classifyConsoleLine("no space left on device").subsystem).toBe("storage");
  });
});

describe("pattern library", () => {
  it("matches OOM patterns (positive)", () => {
    expect(matchPatterns("java.lang.OutOfMemoryError: Java heap space").map((p) => p.id)).toContain("oom_java");
    expect(matchPatterns("Out of memory: Killed process 1234 (java)").map((p) => p.id)).toContain("oom_system");
  });

  it("matches port bind, disk full, module missing, config invalid", () => {
    expect(matchPatterns("Address already in use").map((p) => p.id)).toContain("port_bind");
    expect(matchPatterns("ENOSPC: no space left on device").map((p) => p.id)).toContain("disk_full");
    expect(matchPatterns("Cannot find module 'express'").map((p) => p.id)).toContain("module_missing");
    expect(matchPatterns("YAMLException: bad indentation of a mapping entry").map((p) => p.id)).toContain("config_invalid");
  });

  it("does not match benign lines (negative cases)", () => {
    expect(matchPatterns("Done (12.345s)! For help, type \"help\"")).toHaveLength(0);
    expect(matchPatterns("Loaded 41 plugins successfully")).toHaveLength(0);
    expect(matchPatterns("Player Steve joined the game")).toHaveLength(0);
  });

  it("is deterministic", () => {
    const line = "connection refused to mysql at 10.1.2.3:3306";
    expect(matchPatterns(line)).toEqual(matchPatterns(line));
  });
});
