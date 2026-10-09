import type { RedisLike } from "../redisClient";

/** In-memory Redis for tests. Records TTLs so tests can assert every key expires. */
export class FakeRedis implements RedisLike {
  store = new Map<string, { value: unknown; expiresAt: number | null }>();
  failing = false;
  lists = new Map<string, { items: string[]; expiresAt: number }>();

  private live(key: string) {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  private check() {
    if (this.failing) throw new Error("redis down");
  }

  async get(key: string) {
    this.check();
    return this.live(key)?.value ?? null;
  }

  async set(
    key: string,
    value: unknown,
    options: { ex: number; nx?: boolean }
  ) {
    this.check();
    if (options.nx && this.live(key)) return null;
    this.store.set(key, {
      value: JSON.parse(JSON.stringify(value)),
      expiresAt: Date.now() + options.ex * 1000,
    });
    return "OK";
  }

  async incr(key: string) {
    this.check();
    const entry = this.live(key);
    const next = Number(entry?.value ?? 0) + 1;
    this.store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  async decr(key: string) {
    this.check();
    const entry = this.live(key);
    const next = Number(entry?.value ?? 0) - 1;
    this.store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  /** Newest first, capped, with a TTL set in the same operation. */
  async pushCapped(key: string, value: string, max: number, ttl: number) {
    this.check();
    const entry = this.lists.get(key) ?? { items: [], expiresAt: 0 };
    entry.items = [value, ...entry.items].slice(0, max);
    entry.expiresAt = Date.now() + ttl * 1000;
    this.lists.set(key, entry);
  }

  keys() {
    return [...this.store.keys(), ...this.lists.keys()];
  }

  keysWithoutTtl() {
    return [...this.store.entries()]
      .filter(([, entry]) => entry.expiresAt === null)
      .map(([key]) => key);
  }
}
