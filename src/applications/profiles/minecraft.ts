import type { ApplicationProfile, FatalSignature } from "./types.js";

const SHARED_JAVA_FATALS: FatalSignature[] = [
  {
    id: "oom",
    pattern: /OutOfMemoryError|java heap space/i,
    label: "JVM out of memory",
    commonCauses: [
      "Heap size below working set",
      "Memory leak in application or plugin/mod",
      "Workload spike beyond allocation",
    ],
  },
  {
    id: "unsupported_class",
    pattern: /UnsupportedClassVersionError/i,
    label: "Java version mismatch",
    commonCauses: [
      "Artifact requires a newer Java runtime than the container provides",
      "Runtime updated without matching artifact update",
    ],
  },
  {
    id: "no_class_def",
    pattern: /NoClassDefFoundError|ClassNotFoundException/i,
    label: "Missing class/dependency",
    commonCauses: [
      "Dependency removed or not installed",
      "Plugin/mod built for another platform version",
    ],
  },
  {
    id: "port_bind",
    pattern: /Address already in use|Failed to bind to port/i,
    label: "Port binding failure",
    commonCauses: ["Another process holds the port", "Allocation mismatch with application config"],
  },
];

const MC_READY_MARKERS = [
  /Done \([0-9.]+s\)! For help, type "help"/i,
  /RCON running on/i,
  /Starting GS4 status listener/i,
];

function minecraftProfile(distribution: string, port: number, displayName: string): ApplicationProfile {
  const loaderFatals: FatalSignature[] = [
    {
      id: "loader_error",
      pattern: /Could not load|Failed to start|incompatible mod set|Duplicate mods/i,
      label: "Mod/plugin loading failure",
      commonCauses: [
        "Incompatible plugin/mod version added after an update",
        "Duplicate plugin/mod present",
        "Plugin requires a different server implementation",
      ],
    },
    {
      id: "eula",
      pattern: /You need to agree to the EULA|eula=false/i,
      label: "EULA not accepted",
      commonCauses: ["eula.txt not accepted after a fresh install or world reset"],
    },
    {
      id: "world_corrupt",
      pattern: /corrupt(?:ed)? (?:world|chunk)|Chunk file at .* is missing/i,
      label: "World/chunk corruption",
      commonCauses: ["Unclean shutdown during world write", "Disk full during save", "Storage corruption"],
    },
  ];
  return {
    id: `minecraft/${distribution}`,
    application: "minecraft",
    distribution,
    runtime: "java",
    displayName,
    expectedPorts: [{ port, protocol: "tcp", purpose: "game traffic" }],
    readyMarkers: MC_READY_MARKERS,
    healthyStartupPatterns: [/Loading libraries, please wait/i, /Starting minecraft server version/i],
    fatalSignatures: [...SHARED_JAVA_FATALS, ...loaderFatals],
    expectedStartupMs: 180_000,
    gracefulStopCommand: "stop",
    configLocations: [
      "server.properties",
      "bukkit.yml",
      "spigot.yml",
      "paper.yml",
      "config/paper-global.yml",
      "config/paper-world-defaults.yml",
      "velocity.toml",
      "config.yml",
    ],
    dependencyManifests: ["plugins/", "mods/"],
    diagnosticCommands: ["plugins", "version", "tps"],
    backupTargets: ["world", "world_nether", "world_the_end", "plugins", "mods", "config", "server.properties"],
    commonFailureModes: [
      "Plugin/mod update incompatible with server version",
      "Heap exhaustion with many plugins or large view distance",
      "World corruption after unclean shutdown",
      "Port conflict after double start",
    ],
  };
}

export const MINECRAFT_PROFILES: ApplicationProfile[] = [
  minecraftProfile("paper", 25565, "Paper (Minecraft)"),
  minecraftProfile("spigot", 25565, "Spigot (Minecraft)"),
  minecraftProfile("fabric", 25565, "Fabric (Minecraft)"),
  minecraftProfile("forge", 25565, "Forge (Minecraft)"),
  minecraftProfile("neoforge", 25565, "NeoForge (Minecraft)"),
  minecraftProfile("bukkit-family", 25565, "Minecraft (Bukkit family)"),
  minecraftProfile("modded", 25565, "Minecraft (modded)"),
  {
    ...minecraftProfile("velocity", 25577, "Velocity proxy"),
    expectedPorts: [{ port: 25577, protocol: "tcp", purpose: "proxy listener" }],
    diagnosticCommands: ["plugins", "velocity info", "server list"],
    backupTargets: ["plugins", "velocity.toml", "forwarding.secret"],
    commonFailureModes: [
      "Backend servers unreachable",
      "Forwarding secret mismatch",
      "Plugin incompatibility after proxy update",
    ],
  },
  {
    ...minecraftProfile("bungeecord", 25577, "BungeeCord proxy"),
    diagnosticCommands: ["bungee", "server list"],
    backupTargets: ["plugins", "config.yml"],
  },
  {
    ...minecraftProfile("minecraft", 25565, "Minecraft server"),
    id: "minecraft/generic",
    distribution: undefined,
  },
];
