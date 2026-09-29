import { describe, expect, it } from "vitest";
import { ApplicationDetector } from "../../src/applications/detector.js";
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

describe("game server detection", () => {
  it("identifies Valheim from steamcmd signals", () => {
    const result = detector.detect(
      signals({
        startupCommand: "./start_server.sh",
        eggName: "Valheim",
        dockerImage: "ghcr.io/pterodactyl/steamcmd:latest",
        variables: [{ name: "SERVER_PORT", value: "2456" }],
        consoleLines: ["Server started successfully"],
      }),
    );
    expect(result.application).toBe("valheim");
    expect(result.runtime).toBe("native");
    expect(result.distribution).toBe("dedicated-server");
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.evidence.some((item) => item.detail.includes("steamcmd"))).toBe(true);
  });

  it("identifies Rust dedicated servers without confusing them with the Rust language", () => {
    const result = detector.detect(
      signals({
        startupCommand: "steamcmd +force_install_dir /home/container +login anonymous +app_update 258550 +quit && ./RustDedicated -batchmode",
        rootFiles: [],
      }),
    );
    expect(result.application).toBe("rust-dedicated");
    expect(result.runtime).toBe("native");
  });

  it("does not flag a Rust language project as a game server", () => {
    const result = detector.detect(
      signals({
        startupCommand: "./target/release/my-service",
        rootFiles: ["Cargo.toml", "Cargo.lock"],
      }),
    );
    expect(result.application).toBe("rust-application");
    expect(result.runtime).toBe("rust");
  });

  it("identifies ARK and Counter-Strike signals", () => {
    const ark = detector.detect(
      signals({ dockerImage: "ghcr.io/ark-server", startupCommand: "./ShooterGameServer TheIsland" }),
    );
    expect(ark.application).toBe("ark-survival");
    const cs = detector.detect(signals({ startupCommand: "./srcds_run -game csgo" }));
    expect(cs.application).toBe("counter-strike");
  });
});

describe("PHP and Ruby detection", () => {
  it("detects Laravel from composer.json and artisan", () => {
    const result = detector.detect(
      signals({
        rootFiles: ["composer.json", "artisan", "index.php"],
        startupCommand: "php artisan serve --host 0.0.0.0",
        configFiles: {
          "composer.json": JSON.stringify({
            name: "acme/app",
            require: { "laravel/framework": "^11.0", php: "^8.2" },
          }),
        },
      }),
    );
    expect(result.runtime).toBe("php");
    expect(result.distribution).toBe("laravel");
    expect(result.application).toBe("php-application");
  });

  it("detects Rails from a Gemfile", () => {
    const result = detector.detect(
      signals({
        rootFiles: ["Gemfile", "config.ru"],
        startupCommand: "bundle exec puma",
        configFiles: { Gemfile: 'gem "rails", "~> 7.1"\ngem "puma"' },
      }),
    );
    expect(result.runtime).toBe("ruby");
    expect(result.distribution).toBe("rails");
  });

  it("detects Next.js among Node frameworks", () => {
    const result = detector.detect(
      signals({
        rootFiles: ["package.json"],
        startupCommand: "node_modules/.bin/next start",
        configFiles: {
          "package.json": JSON.stringify({ dependencies: { next: "^14.0.0", react: "^18.0.0" } }),
        },
      }),
    );
    expect(result.distribution).toBe("nextjs");
  });

  it("detects Rust web frameworks", () => {
    const result = detector.detect(
      signals({
        rootFiles: ["Cargo.toml"],
        startupCommand: "./target/release/api",
        configFiles: { "Cargo.toml": '[package]\nname = "api"\n\n[dependencies]\naxum = "0.7"\ntokio = { version = "1", features = ["full"] }\n' },
      }),
    );
    expect(result.runtime).toBe("rust");
    expect(result.distribution).toBe("axum");
  });
});

describe("docker-compose workload detection", () => {
  it("detects compose files and lists services", () => {
    const result = detector.detect(
      signals({
        rootFiles: ["docker-compose.yml", "start.sh"],
        configFiles: {
          "docker-compose.yml": [
            "services:",
            "  web:",
            "    image: nginx",
            "  db:",
            "    image: postgres:16",
          ].join("\n"),
        },
      }),
    );
    expect(result.application).toBe("docker-compose-workload");
    expect(result.runtime).toBe("container");
    expect(result.evidence.some((item) => item.detail.includes("web"))).toBe(true);
  });
});
