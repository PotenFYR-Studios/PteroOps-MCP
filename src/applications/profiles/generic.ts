import type { ApplicationProfile } from "./types.js";

export const NODE_PROFILE: ApplicationProfile = {
  id: "nodejs/default",
  application: "node-application",
  runtime: "node",
  displayName: "Node.js application",
  expectedPorts: [
    { port: 3000, protocol: "tcp", purpose: "typical web port" },
    { port: 8080, protocol: "tcp", purpose: "alternative web port" },
  ],
  readyMarkers: [/listening on|server (?:is )?(?:running|listening)|ready in \d+|started server/i],
  healthyStartupPatterns: [/node:internal|npm (?:start|run)|Now listening/i],
  fatalSignatures: [
    {
      id: "module_missing",
      pattern: /Cannot find module|ERR_MODULE_NOT_FOUND/i,
      label: "Missing Node module",
      commonCauses: [
        "Dependencies not installed (node_modules missing)",
        "Dependency removed from package.json but still imported",
        "Lockfile/manifest out of sync",
      ],
    },
    {
      id: "syntax",
      pattern: /SyntaxError/i,
      label: "JavaScript syntax error",
      commonCauses: ["Broken code deployment", "Wrong Node version for the syntax used"],
    },
    {
      id: "port_in_use",
      pattern: /EADDRINUSE/i,
      label: "Port already in use",
      commonCauses: ["Another process holds the port", "Stale process from a previous start"],
    },
    {
      id: "oom",
      pattern: /JavaScript heap out of memory|FATAL ERROR: Reached heap limit/i,
      label: "Node heap exhaustion",
      commonCauses: [
        "Memory leak",
        "Heap limit too low for workload (--max-old-space-size)",
        "Unbounded data structure growth",
      ],
    },
  ],
  expectedStartupMs: 60_000,
  gracefulStopCommand: null,
  configLocations: ["package.json", ".env", "config/*.json", "config/*.yaml", "config/*.yml"],
  dependencyManifests: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
  diagnosticCommands: [],
  backupTargets: ["package.json", "package-lock.json", "config", "data"],
  commonFailureModes: [
    "Missing node_modules after deploy",
    "Wrong Node version (engines mismatch)",
    "Port binding conflicts",
    "Heap exhaustion in long-running processes",
  ],
};

export const PYTHON_PROFILE: ApplicationProfile = {
  id: "python/default",
  application: "python-application",
  runtime: "python",
  displayName: "Python application",
  expectedPorts: [
    { port: 8000, protocol: "tcp", purpose: "typical ASGI/WSGI port" },
    { port: 5000, protocol: "tcp", purpose: "Flask default" },
  ],
  readyMarkers: [/running on http|uvicorn running|application startup complete|listening on/i],
  healthyStartupPatterns: [/\.py|uvicorn|gunicorn|flask|django/i],
  fatalSignatures: [
    {
      id: "module_missing",
      pattern: /ModuleNotFoundError|ImportError/i,
      label: "Missing Python module",
      commonCauses: [
        "requirements not installed in the active environment",
        "Wrong virtualenv",
        "Package removed from manifest but still imported",
      ],
    },
    {
      id: "syntax",
      pattern: /SyntaxError/i,
      label: "Python syntax error",
      commonCauses: ["Broken deployment", "Wrong Python version for the syntax used"],
    },
    {
      id: "permission",
      pattern: /PermissionError/i,
      label: "Permission error",
      commonCauses: ["File ownership changed by upload", "Path outside writable area"],
    },
  ],
  expectedStartupMs: 90_000,
  gracefulStopCommand: null,
  configLocations: ["config.py", "config.yaml", "config.json", ".env", "settings.py"],
  dependencyManifests: ["requirements.txt", "pyproject.toml", "Pipfile", "poetry.lock"],
  diagnosticCommands: [],
  backupTargets: ["config", "data", ".env", "requirements.txt"],
  commonFailureModes: [
    "Dependencies missing after environment reset",
    "Missing environment variables",
    "Wrong working directory for entrypoint",
  ],
};

export const JAVA_APP_PROFILE: ApplicationProfile = {
  id: "java/default",
  application: "java-application",
  runtime: "java",
  displayName: "Java application",
  expectedPorts: [],
  readyMarkers: [/started .* in [\d.]+ seconds|started application|ready/i],
  healthyStartupPatterns: [/java|jvm|spring|quarkus/i],
  fatalSignatures: [
    {
      id: "oom",
      pattern: /OutOfMemoryError|java heap space/i,
      label: "JVM out of memory",
      commonCauses: ["Heap size below working set", "Memory leak"],
    },
    {
      id: "unsupported_class",
      pattern: /UnsupportedClassVersionError/i,
      label: "Java version mismatch",
      commonCauses: ["Artifact requires a newer JRE than available"],
    },
    {
      id: "no_class_def",
      pattern: /NoClassDefFoundError|ClassNotFoundException/i,
      label: "Missing class/dependency",
      commonCauses: ["Missing dependency on the classpath", "Packaging excluded a transitive dependency"],
    },
  ],
  expectedStartupMs: 120_000,
  gracefulStopCommand: null,
  configLocations: ["application.properties", "application.yml", "config/"],
  dependencyManifests: ["pom.xml", "build.gradle", "build.gradle.kts"],
  diagnosticCommands: [],
  backupTargets: ["config", "application.properties", "application.yml", "data"],
  commonFailureModes: ["Heap exhaustion", "Missing classpath entries", "Configuration drift between environments"],
};

export const GO_PROFILE: ApplicationProfile = {
  id: "go/default",
  application: "go-application",
  runtime: "go",
  displayName: "Go application",
  expectedPorts: [],
  readyMarkers: [/listening|serving|ready/i],
  healthyStartupPatterns: [/goroutine|go\d/i],
  fatalSignatures: [
    {
      id: "panic",
      pattern: /panic:/i,
      label: "Go panic",
      commonCauses: ["Nil dereference", "Unhandled error path", "Config value out of contract"],
    },
  ],
  expectedStartupMs: 15_000,
  gracefulStopCommand: null,
  configLocations: ["config.yaml", "config.yml", "config.json", ".env"],
  dependencyManifests: ["go.mod", "go.sum"],
  diagnosticCommands: [],
  backupTargets: ["config", "data"],
  commonFailureModes: ["Bad configuration causing startup panic", "Port binding failures"],
};

export const RUST_PROFILE: ApplicationProfile = {
  id: "rust/default",
  application: "rust-application",
  runtime: "rust",
  displayName: "Rust application",
  expectedPorts: [],
  readyMarkers: [/listening|ready|started/i],
  healthyStartupPatterns: [/compiled|release|tokio/i],
  fatalSignatures: [
    {
      id: "panic",
      pattern: /panicked at/i,
      label: "Rust panic",
      commonCauses: ["Unwrap on error", "Invalid configuration value"],
    },
  ],
  expectedStartupMs: 15_000,
  gracefulStopCommand: null,
  configLocations: ["config.toml", "config.yaml", ".env"],
  dependencyManifests: ["Cargo.toml", "Cargo.lock"],
  diagnosticCommands: [],
  backupTargets: ["config", "data"],
  commonFailureModes: ["Configuration errors", "Port binding failures"],
};

export const CONTAINER_PROFILE: ApplicationProfile = {
  id: "container/generic",
  application: "container",
  runtime: "container",
  displayName: "Generic container workload",
  expectedPorts: [],
  readyMarkers: [],
  healthyStartupPatterns: [],
  fatalSignatures: [],
  expectedStartupMs: 60_000,
  gracefulStopCommand: null,
  configLocations: [],
  dependencyManifests: [],
  diagnosticCommands: [],
  backupTargets: [],
  commonFailureModes: [
    "Application-specific detection unavailable; inspect console output manually",
  ],
};

export const PHP_PROFILE: ApplicationProfile = {
  id: "php/default",
  application: "php-application",
  runtime: "php",
  displayName: "PHP application",
  expectedPorts: [
    { port: 8000, protocol: "tcp", purpose: "php built-in/artisan serve" },
    { port: 8080, protocol: "tcp", purpose: "web server" },
  ],
  readyMarkers: [/development server.*started|running on http|listening on|server started/i],
  healthyStartupPatterns: [/php|artisan|composer/i],
  fatalSignatures: [
    {
      id: "parse_error",
      pattern: /PHP Parse error|syntax error, unexpected/i,
      label: "PHP syntax error",
      commonCauses: ["Broken deployment", "Wrong PHP version for the code"],
    },
    {
      id: "fatal_error",
      pattern: /PHP Fatal error/i,
      label: "PHP fatal error",
      commonCauses: ["Missing extension", "Uncaught exception", "Missing dependency"],
    },
  ],
  expectedStartupMs: 30_000,
  gracefulStopCommand: null,
  configLocations: [".env", "config/", "composer.json"],
  dependencyManifests: ["composer.json", "composer.lock"],
  diagnosticCommands: [],
  backupTargets: ["storage", "config", ".env", "composer.json"],
  commonFailureModes: ["Missing PHP extensions", "Unwritable storage/cache directories", "Wrong APP_KEY"],
};

export const RUBY_PROFILE: ApplicationProfile = {
  id: "ruby/default",
  application: "ruby-application",
  runtime: "ruby",
  displayName: "Ruby application",
  expectedPorts: [{ port: 3000, protocol: "tcp", purpose: "Rails/Puma default" }],
  readyMarkers: [/listening on|puma starting|rails.*started|server running/i],
  healthyStartupPatterns: [/ruby|rails|puma|bundler/i],
  fatalSignatures: [
    {
      id: "load_error",
      pattern: /LoadError|cannot load such file/i,
      label: "Ruby LoadError",
      commonCauses: ["Missing gem", "Bundle not installed", "Wrong Ruby version"],
    },
    {
      id: "bundler",
      pattern: /Bundler::|Could not find gem/i,
      label: "Bundler dependency error",
      commonCauses: ["bundle install not run after deployment", "Gemfile.lock out of sync"],
    },
  ],
  expectedStartupMs: 45_000,
  gracefulStopCommand: null,
  configLocations: ["config/", ".env", "config/database.yml"],
  dependencyManifests: ["Gemfile", "Gemfile.lock"],
  diagnosticCommands: [],
  backupTargets: ["config", "db", "storage"],
  commonFailureModes: ["Missing gems after deploy", "Database configuration errors"],
};

export const GAME_SERVER_PROFILE: ApplicationProfile = {
  id: "game-server/generic",
  application: "game-server",
  runtime: "native",
  displayName: "Dedicated game server",
  expectedPorts: [],
  readyMarkers: [/server (is )?(started|running|listening)|server started successfully/i],
  healthyStartupPatterns: [/steamcmd|steamapps|dedicated/i],
  fatalSignatures: [
    {
      id: "steam_update",
      pattern: /SteamCMD.*(?:error|failed)|app_update.*failed/i,
      label: "SteamCMD update failure",
      commonCauses: ["Steam rate limiting or offline", "Disk full during update", "Corrupted app cache"],
    },
    {
      id: "port_bind",
      pattern: /address already in use|could not bind|bind failed/i,
      label: "Port binding failure",
      commonCauses: ["Another instance holds the port", "Allocation mismatch"],
    },
  ],
  expectedStartupMs: 300_000,
  gracefulStopCommand: null,
  configLocations: [],
  dependencyManifests: [],
  diagnosticCommands: [],
  backupTargets: ["savegames", "Saves", "server", "config"],
  commonFailureModes: ["SteamCMD update failures", "Save file corruption after unclean shutdown", "Port conflicts"],
};

export const COMPOSE_WORKLOAD_PROFILE: ApplicationProfile = {
  id: "compose/generic",
  application: "docker-compose-workload",
  runtime: "container",
  displayName: "Docker Compose workload",
  expectedPorts: [],
  readyMarkers: [],
  healthyStartupPatterns: [/docker|compose/i],
  fatalSignatures: [
    {
      id: "docker_error",
      pattern: /docker: (?:Error|error)|Cannot connect to the Docker daemon|compose.*failed/i,
      label: "Docker/Compose failure",
      commonCauses: ["Docker daemon unavailable inside the container", "Compose configuration error", "Image pull failure"],
    },
  ],
  expectedStartupMs: 120_000,
  gracefulStopCommand: null,
  configLocations: ["docker-compose.yml", "compose.yaml", ".env"],
  dependencyManifests: ["docker-compose.yml", "compose.yaml"],
  diagnosticCommands: [],
  backupTargets: ["volumes", "data"],
  commonFailureModes: ["Nested container support missing in the egg", "Port collisions with the allocation"],
};

export const UNKNOWN_PROFILE: ApplicationProfile = {
  id: "unknown",
  application: "unknown",
  runtime: "unknown",
  displayName: "Unknown application",
  expectedPorts: [],
  readyMarkers: [],
  healthyStartupPatterns: [],
  fatalSignatures: [],
  expectedStartupMs: 120_000,
  gracefulStopCommand: null,
  configLocations: [],
  dependencyManifests: [],
  diagnosticCommands: [],
  backupTargets: [],
  commonFailureModes: [],
};
