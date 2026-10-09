import { Redis } from "@upstash/redis";

/**
 * The few Redis commands the guard uses. Every write must carry a TTL, which is
 * why `set` requires `ex`; counters are created with `set ... nx` first so a
 * later `incr` never creates a key without an expiry.
 */
export interface RedisLike {
  get(key: string): Promise<unknown>;
  set(
    key: string,
    value: unknown,
    options: { ex: number; nx?: boolean }
  ): Promise<unknown>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  /**
   * Atomically pushes `value` to the head of a list, trims it to `max` entries
   * and sets its TTL, so a list key never exists without an expiry.
   */
  pushCapped(
    key: string,
    value: string,
    max: number,
    ttlSeconds: number
  ): Promise<unknown>;
}

type Env = Record<string, string | undefined>;

/**
 * Supported environment variables (first complete pair wins):
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL        + KV_REST_API_TOKEN
 */
export function resolveRedisConfig(
  env: Env = process.env
): { url: string; token: string } | null {
  const pairs: Array<[string, string]> = [
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ];

  for (const [urlName, tokenName] of pairs) {
    const url = env[urlName];
    const token = env[tokenName];
    if (url && token) return { url, token };
  }

  return null;
}

// undefined = use the environment; null/client = injected (tests).
let injected: RedisLike | null | undefined;
let envClient: { fingerprint: string; client: RedisLike } | undefined;

export function setRedisForTesting(client: RedisLike | null | undefined) {
  injected = client;
}

/** Returns a Redis client, or null when none is configured (caching and limits are then skipped). */
export function getRedis(): RedisLike | null {
  if (injected !== undefined) return injected;

  const config = resolveRedisConfig();
  if (!config) return null;

  const fingerprint = `${config.url}|${config.token.length}`;
  if (envClient?.fingerprint === fingerprint) return envClient.client;

  const redis = new Redis({ url: config.url, token: config.token });

  const client: RedisLike = {
    get: (key) => redis.get(key),
    set: (key, value, options) =>
      options.nx
        ? redis.set(key, value, { ex: options.ex, nx: true })
        : redis.set(key, value, { ex: options.ex }),
    incr: (key) => redis.incr(key),
    decr: (key) => redis.decr(key),
    pushCapped: (key, value, max, ttlSeconds) =>
      redis
        .multi()
        .lpush(key, value)
        .ltrim(key, 0, max - 1)
        .expire(key, ttlSeconds)
        .exec(),
  };

  envClient = { fingerprint, client };
  return client;
}
