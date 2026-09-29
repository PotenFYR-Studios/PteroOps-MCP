import { afterAll, describe, expect, it } from "vitest";
import { createLock, InProcessLock, RedisLock } from "../../src/shared/locks.js";

describe("InProcessLock", () => {
  it("grants one holder at a time and re-grants after release", async () => {
    const lock = new InProcessLock();
    expect(await lock.acquire("k", 1000)).toBe(true);
    expect(await lock.acquire("k", 1000)).toBe(false);
    await lock.release("k");
    expect(await lock.acquire("k", 1000)).toBe(true);
  });

  it("expires holds after the TTL", async () => {
    let now = 1_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const lock = new InProcessLock();
      expect(await lock.acquire("k", 50)).toBe(true);
      expect(await lock.acquire("k", 50)).toBe(false);
      now += 100;
      expect(await lock.acquire("k", 50)).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("createLock falls back to in-process without a URL", async () => {
    const lock = await createLock(undefined);
    expect(lock).toBeInstanceOf(InProcessLock);
    await lock.close();
  });
});

const redisUrl = process.env.PTEROOPS_TEST_REDIS_URL;
const redisAvailable = Boolean(redisUrl);

describe.skipIf(!redisAvailable)("RedisLock (requires PTEROOPS_TEST_REDIS_URL)", () => {
  const locks: RedisLock[] = [];

  afterAll(async () => {
    for (const lock of locks) await lock.close();
  });

  async function twoClients(): Promise<[RedisLock, RedisLock]> {
    const a = await RedisLock.connect(redisUrl!);
    const b = await RedisLock.connect(redisUrl!);
    locks.push(a, b);
    return [a, b];
  }

  it("allows only one instance to hold a key", async () => {
    const [a, b] = await twoClients();
    const key = `pteroops:test:lock:${Date.now()}`;
    expect(await a.acquire(key, 5000)).toBe(true);
    expect(await b.acquire(key, 5000)).toBe(false);
    await a.release(key);
    expect(await b.acquire(key, 5000)).toBe(true);
    await b.release(key);
  });

  it("does not release a lock held by another instance", async () => {
    const [a, b] = await twoClients();
    const key = `pteroops:test:lock:${Date.now()}:owner`;
    expect(await a.acquire(key, 5000)).toBe(true);
    await b.release(key);
    expect(await a.acquire(key, 5000)).toBe(false);
    await a.release(key);
  });

  it("expires locks after their TTL", async () => {
    const [a, b] = await twoClients();
    const key = `pteroops:test:lock:${Date.now()}:ttl`;
    expect(await a.acquire(key, 60)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await b.acquire(key, 5000)).toBe(true);
    await b.release(key);
  });
});
