/**
 * Response caching, per-client rate limiting and a global quota guard for the
 * routes that call Gemini (/api/extract and /api/tailor-advice).
 *
 * Storage is Upstash Redis (see redisClient.ts). With no Redis configured every
 * function here is a no-op, so local development and unit tests behave exactly
 * as before. Redis failures never fail a request: caching and limiting simply
 * stop applying (fail open).
 *
 * Rules for every key written:
 *   - it has a TTL (counters are created with `SET ... EX .. NX`, then `INCR`)
 *   - it never contains the ad text or a raw IP address
 *
 * Why not @upstash/ratelimit: it needs Lua scripting on the real client, which
 * cannot be swapped for an in-memory fake in unit tests, and the global
 * counters need the same sliding window anyway. The sliding window below is the
 * same weighted two-window counter, built from get/set/incr/decr.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { EXTRACT_CACHE_VERSION } from "./extractPrompt";
import { getRedis, type RedisLike } from "./redisClient";

export const CACHE_TTL_SECONDS = 14 * 24 * 60 * 60;

const DAY_SECONDS = 24 * 60 * 60;

const DEFAULTS = {
  perClient10Min: 20,
  perClientDay: 60,
  globalDaily: 350,
  globalRpm: 12,
};

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function logRedisProblem(error: unknown) {
  // Name only: never log messages, URLs or tokens.
  console.warn(
    "Redis unavailable, continuing without it:",
    error instanceof Error ? error.name : "unknown error"
  );
}

/** Per-attempt deadline for a Gemini call; there are no retries. */
export const GEMINI_TIMEOUT_MS = 20_000;

/** Client options for every Gemini call: a hard timeout, SDK retries stay off. */
export const GEMINI_HTTP_OPTIONS = { timeout: GEMINI_TIMEOUT_MS } as const;

/** Budget for each group of Redis calls; past it the request carries on without Redis. */
export const REDIS_TIMEOUT_MS = 1_500;

class RedisTimeoutError extends Error {
  name = "RedisTimeoutError";
}

/** Rejects if `work` takes longer than REDIS_TIMEOUT_MS. Callers already fail open on a rejection. */
function withRedisTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RedisTimeoutError()), REDIS_TIMEOUT_MS);
  });

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

// --------------------------------------------------
// Responses
// --------------------------------------------------

function rateLimited(retryAfterSeconds: number): Response {
  return Response.json(
    {
      error: "Too many requests. Please wait a little and try again.",
      code: "rate_limited",
      retryAfterSeconds,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

function busy(
  code: "gemini_cap_reached" | "gemini_unavailable" | "gemini_timeout",
  retryAfterSeconds: number,
  message = "The AI service is busy right now. Please try again later."
): Response {
  return Response.json(
    {
      error: message,
      code,
      retryAfterSeconds,
    },
    { status: 503, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

// --------------------------------------------------
// Sliding window (weighted current + previous fixed window)
// --------------------------------------------------

async function hitSlidingWindow(
  redis: RedisLike,
  prefix: string,
  windowSeconds: number,
  limit: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const nowSeconds = Date.now() / 1000;
  const index = Math.floor(nowSeconds / windowSeconds);
  const intoWindow = nowSeconds - index * windowSeconds;

  const currentKey = `${prefix}:${index}`;
  const previousKey = `${prefix}:${index - 1}`;

  await redis.set(currentKey, 0, { ex: windowSeconds * 2, nx: true });
  const current = await redis.incr(currentKey);
  const previous = Number(await redis.get(previousKey)) || 0;

  const weighted = previous * (1 - intoWindow / windowSeconds) + current;

  if (weighted <= limit) return { allowed: true, retryAfterSeconds: 0 };

  // A refused request does not use up capacity.
  await redis.decr(currentKey);

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - intoWindow)),
  };
}

// --------------------------------------------------
// Eval bypass
// --------------------------------------------------

/** True when EVAL_BYPASS_TOKEN is set and the x-eval-token header matches it. */
export function isEvalBypass(request: Request): boolean {
  const expected = process.env.EVAL_BYPASS_TOKEN;
  const provided = request.headers.get("x-eval-token");

  if (!expected || !provided) return false;

  // Compare fixed-length digests so length does not leak.
  return timingSafeEqual(
    createHash("sha256").update(expected).digest(),
    createHash("sha256").update(provided).digest()
  );
}

// --------------------------------------------------
// Per-client rate limit
// --------------------------------------------------

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";

  return sha256(`${process.env.RATE_LIMIT_SALT ?? ""}|${ip}`).slice(0, 32);
}

type ClientLimitConfig = {
  /** Redis key prefix; separate prefixes keep the limits independent. */
  prefix: string;
  per10MinEnv: string;
  per10MinDefault: number;
  perDayEnv: string;
  perDayDefault: number;
};

async function enforceLimits(
  request: Request,
  config: ClientLimitConfig
): Promise<Response | null> {
  if (isEvalBypass(request)) return null;

  const redis = getRedis();
  if (!redis) return null;

  const check = async (): Promise<Response | null> => {
    const id = clientKey(request);

    const tenMinutes = await hitSlidingWindow(
      redis,
      `${config.prefix}:${id}:10m`,
      600,
      intFromEnv(config.per10MinEnv, config.per10MinDefault)
    );
    if (!tenMinutes.allowed) return rateLimited(tenMinutes.retryAfterSeconds);

    const day = await hitSlidingWindow(
      redis,
      `${config.prefix}:${id}:1d`,
      DAY_SECONDS,
      intFromEnv(config.perDayEnv, config.perDayDefault)
    );
    if (!day.allowed) return rateLimited(day.retryAfterSeconds);

    return null;
  };

  try {
    return await withRedisTimeout(check());
  } catch (error) {
    logRedisProblem(error);
  }

  return null;
}

/** Returns a 429 response when this client is over its limits, otherwise null. */
export function enforceClientLimit(request: Request): Promise<Response | null> {
  return enforceLimits(request, {
    prefix: "rl",
    per10MinEnv: "RATE_LIMIT_PER_10_MIN",
    per10MinDefault: DEFAULTS.perClient10Min,
    perDayEnv: "RATE_LIMIT_PER_DAY",
    perDayDefault: DEFAULTS.perClientDay,
  });
}

/**
 * Per-client limit for /api/feedback. Its own counters and defaults (5 per
 * 10 minutes, 20 per day); it never touches the Gemini quota.
 */
export function enforceFeedbackLimit(
  request: Request
): Promise<Response | null> {
  return enforceLimits(request, {
    prefix: "rlfb",
    per10MinEnv: "FEEDBACK_RATE_LIMIT_PER_10_MIN",
    per10MinDefault: 5,
    perDayEnv: "FEEDBACK_RATE_LIMIT_PER_DAY",
    perDayDefault: 20,
  });
}

// --------------------------------------------------
// Global Gemini quota (shared by every route that calls Gemini)
// --------------------------------------------------

/**
 * Reserves one Gemini call against the global per-day and per-minute caps.
 * Returns a 503 response when either cap is reached, otherwise null.
 * The eval bypass does NOT skip this: those calls count too.
 */
export async function reserveGeminiCall(): Promise<Response | null> {
  const redis = getRedis();
  if (!redis) return null;

  const reserve = async (): Promise<Response | null> => {
    const now = new Date();
    const dayKey = `gemini:day:${now.toISOString().slice(0, 10)}`;
    const secondsToMidnight = Math.max(
      1,
      Math.ceil(
        (Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + 1
        ) -
          now.getTime()) /
          1000
      )
    );

    await redis.set(dayKey, 0, { ex: 2 * DAY_SECONDS, nx: true });
    const used = await redis.incr(dayKey);

    if (used > intFromEnv("GLOBAL_DAILY_GEMINI_CAP", DEFAULTS.globalDaily)) {
      await redis.decr(dayKey);
      return busy("gemini_cap_reached", secondsToMidnight);
    }

    const minute = await hitSlidingWindow(
      redis,
      "gemini:rpm",
      60,
      intFromEnv("GLOBAL_GEMINI_RPM_CAP", DEFAULTS.globalRpm)
    );

    if (!minute.allowed) {
      // Give the daily slot back: this call will not happen.
      await redis.decr(dayKey);
      return busy("gemini_cap_reached", minute.retryAfterSeconds);
    }

    return null;
  };

  try {
    return await withRedisTimeout(reserve());
  } catch (error) {
    logRedisProblem(error);
  }

  return null;
}

/** True for the abort the SDK raises when GEMINI_TIMEOUT_MS passes. */
export function isGeminiTimeout(error: unknown): boolean {
  const candidate = error as { name?: unknown; cause?: unknown } | null;

  return (
    candidate?.name === "AbortError" ||
    candidate?.name === "TimeoutError" ||
    (candidate?.cause != null && isGeminiTimeout(candidate.cause))
  );
}

export type GeminiFailure = {
  reason: "upstream_timeout" | "upstream_error";
  response: Response;
};

/** Maps a Gemini timeout, 429 or 5xx to a 503 response; null for anything else. */
export function classifyGeminiFailure(error: unknown): GeminiFailure | null {
  if (isGeminiTimeout(error)) {
    return {
      reason: "upstream_timeout",
      response: busy(
        "gemini_timeout",
        10,
        "The analysis took too long, please try again."
      ),
    };
  }

  const candidate = error as { status?: unknown; code?: unknown } | null;

  for (const value of [candidate?.status, candidate?.code]) {
    if (typeof value === "number" && (value === 429 || value >= 500)) {
      return {
        reason: "upstream_error",
        response: busy("gemini_unavailable", 60),
      };
    }
  }

  return null;
}

// --------------------------------------------------
// Response cache (raw model JSON only)
// --------------------------------------------------

/**
 * sha256 of the version + the ad text with whitespace trimmed and collapsed.
 * The ad text itself is never stored.
 */
export function cacheKeyFor(
  adText: string,
  version: string = EXTRACT_CACHE_VERSION
): string {
  const normalised = adText.trim().replace(/\s+/g, " ");

  return `extract:${sha256(`${version}\n${normalised}`)}`;
}

export async function readCachedExtraction(
  adText: string
): Promise<Record<string, unknown> | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const value = await withRedisTimeout(redis.get(cacheKeyFor(adText)));

    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch (error) {
    logRedisProblem(error);
    return null;
  }
}

export async function writeCachedExtraction(
  adText: string,
  rawExtraction: Record<string, unknown>
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await withRedisTimeout(
      redis.set(cacheKeyFor(adText), rawExtraction, {
        ex: CACHE_TTL_SECONDS,
      })
    );
  } catch (error) {
    logRedisProblem(error);
  }
}
