import { randomUUID } from "node:crypto";
import type { Logger } from "../observability/logger.js";

export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
  close(): Promise<void>;
}

export class InProcessLock implements DistributedLock {
  private readonly held = new Map<string, number>();

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.held.get(key);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.held.set(key, now + ttlMs);
    return true;
  }

  async release(key: string): Promise<void> {
    this.held.delete(key);
  }

  async close(): Promise<void> {
    this.held.clear();
  }
}

interface RedisClientLike {
  set(
    key: string,
    value: string,
    options: { NX: true; PX: number },
  ): Promise<string | null>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  quit(): Promise<unknown>;
}

export class RedisLock implements DistributedLock {
  private readonly tokens = new Map<string, string>();

  private constructor(private readonly client: RedisClientLike) {}

  static async connect(url: string, logger?: Logger): Promise<RedisLock> {
    const { createClient } = await import("redis");
    const client = createClient({ url });
    client.on("error", (error: unknown) => {
      logger?.warn("redis client error", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await client.connect();
    logger?.info("redis lock backend connected");
    return new RedisLock(client as unknown as RedisClientLike);
  }

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const token = randomUUID();
    const result = await this.client.set(key, token, { NX: true, PX: ttlMs });
    if (result === null) return false;
    this.tokens.set(key, token);
    return true;
  }

  async release(key: string): Promise<void> {
    const token = this.tokens.get(key);
    if (!token) return;
    this.tokens.delete(key);
    await this.client.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      { keys: [key], arguments: [token] },
    );
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export async function createLock(
  redisUrl: string | undefined,
  logger?: Logger,
): Promise<DistributedLock> {
  if (redisUrl) {
    return RedisLock.connect(redisUrl, logger);
  }
  return new InProcessLock();
}
