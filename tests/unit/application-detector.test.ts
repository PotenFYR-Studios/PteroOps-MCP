import { describe, expect, it } from "vitest";
import { ApplicationDetector } from "../../src/applications/detector.js";
import { ApplicationProfileRegistry } from "../../src/applications/profiles/index.js";
import type { DetectionSignals } from "../../src/applications/types.js";

function signals(overrides: Partial<DetectionSignals> = {}): DetectionSignals {
  return {
    serverName: "test",
    startupCommand: null,
    dockerImage: null,
    invocation: null,
    eggName: null,
    nestName: null,
    variables: [],
    rootFiles: [],
    directoryFiles: {},
    configFiles: {},
    consoleLines: [],
    ...overrides,
  };
}

const detector = new ApplicationDetector();

describe("ApplicationDetector", () => {
  it("identifies Paper with version from multi-signal evidence", () => {
    const result = detector.detect(
      signals({
        startupCommand: "java -Xms128M -Xmx2048M -jar paper-1.21.4.jar",
        dockerImage: "ghcr.io/pterodactyl/yolks:java_21",
        eggName: "Paper",
        rootFiles: ["paper-1.21.4.jar", "server.properties", "plugins", "world"],
        directoryFiles: { plugins: ["EssentialsX.jar"] },
        consoleLines: [
          "Starting minecraft server version 1.21.4",
          "This server is running Paper version 1.21.4-232 (MC: 1.21.4)",
          'Done (14.512s)! For help, type "help"',
        ],
      }),
    );
    expect(result.application).toBe("minecraft");
    expect(result.runtime).toBe("java");
    expect(result.distribution).toBe("paper");
    expect(result.version).toBe("1.21.4");
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.evidence.length).toBeGreaterThan(2);
    expect(result.profileId).toBe("minecraft/paper");
  });

  it("identifies Fabric from the server launcher file", () => {
    const result = detector.detect(
      signals({
        startupCommand: "java -jar fabric-server-launch.jar",
        rootFiles: ["fabric-server-launch.jar", "server.properties", "mods"],
        directoryFiles: { mods: ["fabric-api.jar", "lithium.jar"] },
        consoleLines: ["Starting minecraft server version 1.20.6"],
      }),
    );
    expect(result.distribution).toBe("fabric");
    expect(result.application).toBe("minecraft");
  });

  it("identifies Velocity proxies", () => {
    const result = detector.detect(
      signals({
        startupCommand: "java -jar velocity.jar",
        rootFiles: ["velocity.jar", "velocity.toml", "forwarding.secret"],
        consoleLines: ["[INFO] Velocity 3.3.0-SNAPSHOT inizializzato"],
      }),
    );
    expect(result.distribution).toBe("velocity");
    expect(result.profileId).toBe("minecraft/velocity");
  });

  it("identifies Node.js applications and frameworks from package.json", () => {
    const result = detector.detect(
      signals({
        startupCommand: "node index.js",
        dockerImage: "node:20-alpine",
        rootFiles: ["package.json", "package-lock.json", "index.js"],
        configFiles: {
          "package.json": JSON.stringify({
            name: "discord-bot",
            engines: { node: ">=20" },
            dependencies: { "discord.js": "^14.0.0", express: "^4.18.0" },
          }),
        },
        consoleLines: ["[INFO] Now listening on port 3000"],
      }),
    );
    expect(result.runtime).toBe("node");
    expect(result.application).toBe("node-application");
    expect(result.distribution).toBe("express");
    expect(result.version).toBe("20");
    expect(result.profileId).toBe("nodejs/default");
    expect(JSON.stringify(result.evidence)).toContain("discord-bot");
  });

  it("identifies Python applications", () => {
    const result = detector.detect(
      signals({
        startupCommand: "python3 bot.py",
        rootFiles: ["bot.py", "requirements.txt"],
        consoleLines: ["Traceback (most recent call last):", "ModuleNotFoundError: No module named 'discord'"],
      }),
    );
    expect(result.runtime).toBe("python");
    expect(result.profileId).toBe("python/default");
  });

  it("falls back to a generic container detection with low confidence", () => {
    const result = detector.detect(
      signals({ dockerImage: "docker.io/library/redis:7" }),
    );
    expect(result.application).toBe("redis");
    expect(result.runtime).toBe("container");
    expect(result.confidence).toBeLessThan(0.4);
  });

  it("returns unknown instead of fabricating an application", () => {
    const result = detector.detect(signals());
    expect(result.application).toBe("unknown");
    expect(result.confidence).toBe(0);
    expect(result.evidence).toHaveLength(0);
  });

  it("does not fabricate a Minecraft version without evidence", () => {
    const result = detector.detect(
      signals({
        startupCommand: "java -jar server.jar",
        dockerImage: "ghcr.io/pterodactyl/yolks:java_21",
        rootFiles: ["server.jar", "server.properties"],
      }),
    );
    expect(result.application).toBe("minecraft");
    expect(result.version).toBeUndefined();
  });
});

describe("ApplicationProfileRegistry", () => {
  const registry = new ApplicationProfileRegistry();

  it("looks up exact distribution profiles", () => {
    expect(registry.lookup("minecraft", "paper").id).toBe("minecraft/paper");
    expect(registry.lookup("minecraft", "forge").displayName).toContain("Forge");
  });

  it("falls back to the generic Minecraft profile for unknown distributions", () => {
    const profile = registry.lookup("minecraft", "purpur");
    expect(profile.application).toBe("minecraft");
    expect(profile.distribution).toBeUndefined();
    expect(profile.id).toBe("minecraft/generic");
  });

  it("returns the unknown profile for unknown applications", () => {
    expect(registry.lookup("something-else").id).toBe("unknown");
  });

  it("can be extended with community profiles", () => {
    const custom = new ApplicationProfileRegistry([
      ...new ApplicationProfileRegistry().list(),
      {
        id: "minecraft/purpur",
        application: "minecraft",
        distribution: "purpur",
        runtime: "java",
        displayName: "Purpur",
        expectedPorts: [],
        readyMarkers: [],
        healthyStartupPatterns: [],
        fatalSignatures: [],
        expectedStartupMs: 180_000,
        gracefulStopCommand: "stop",
        configLocations: [],
        dependencyManifests: [],
        diagnosticCommands: [],
        backupTargets: [],
        commonFailureModes: [],
      },
    ]);
    expect(custom.lookup("minecraft", "purpur").id).toBe("minecraft/purpur");
  });
});
