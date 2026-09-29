import type { ConsoleService } from "../console/service.js";
import type { Logger } from "../observability/logger.js";
import type { ServerRef } from "../shared/types.js";
import type { ConsoleCommandResult } from "./types.js";
import { createId } from "../shared/ids.js";
import { sleep } from "../shared/async.js";

export interface ConsoleCommandRunnerDeps {
  consoleService: ConsoleService;
  logger: Logger;
  clock?: () => number;
  timeoutMs?: number;
  pollMs?: number;
}

export interface RunCommandOptions {
  timeoutMs?: number;
  includeOutput?: boolean;
}

export class ConsoleCommandRunner {
  private readonly clock: () => number;
  private readonly timeoutMs: number;
  private readonly pollMs: number;

  constructor(private readonly deps: ConsoleCommandRunnerDeps) {
    this.clock = deps.clock ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 10_000;
    this.pollMs = deps.pollMs ?? 250;
  }

  async run(
    ref: ServerRef,
    command: string,
    send: (command: string) => Promise<void>,
    options: RunCommandOptions = {},
  ): Promise<ConsoleCommandResult> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const marker = `__PTEROOPS_MARKER_${createId("m").replace(/-/g, "")}__`;
    const startedAt = this.clock();
    await send(`${command} ; echo ${marker}`);
    const output: string[] = [];
    const deadline = startedAt + timeoutMs;
    let markerFound = false;

    while (this.clock() < deadline) {
      await sleep(this.pollMs);
      const page = await this.deps.consoleService.query({
        ref,
        since: startedAt - 1500,
        mode: "latest",
        limit: 200,
        order: "asc",
      });
      for (const event of page.events) {
        const line = event.normalized;
        if (line.includes(marker)) {
          markerFound = true;
          const index = line.indexOf(marker);
          const tail = line.slice(0, index).trimEnd();
          if (tail !== "" && !output.includes(tail)) output.push(tail);
          break;
        }
        if (event.ts >= startedAt && !output.includes(line)) {
          output.push(line);
        }
      }
      if (markerFound) break;
    }

    if (!markerFound) {
      this.deps.logger.debug("console command marker not observed", { command });
    }
    return {
      command,
      output: options.includeOutput === false ? [] : output.slice(-200),
      markerFound,
    };
  }
}
