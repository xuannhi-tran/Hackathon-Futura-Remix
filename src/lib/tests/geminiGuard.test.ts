/**
 * Response caching, per-client rate limiting and the global Gemini quota guard.
 *
 * Redis is replaced by an in-memory fake (no network) and @google/genai by a
 * mock. The fake records the TTL of every key so the tests can assert that no
 * key is ever written without an expiry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gemini = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  Type: { OBJECT: "OBJECT", STRING: "STRING", ARRAY: "ARRAY" },
  GoogleGenAI: class {
    models = { generateContent: gemini.generateContent };
  },
}));

import { POST as extractPOST } from "../../app/api/extract/route";
import { POST as advicePOST } from "../../app/api/tailor-advice/route";
import { cacheKeyFor } from "../geminiGuard";
import {
  resolveRedisConfig,
  setRedisForTesting,
  type RedisLike,
} from "../redisClient";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory fake
// ─────────────────────────────────────────────────────────────────────────────

class FakeRedis implements RedisLike {
  store = new Map<string, { value: unknown; expiresAt: number | null }>();
  failing = false;

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
    const entry = this.live(key);
    return entry ? entry.value : null;
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
    this.store.set(key, {
      value: next,
      expiresAt: entry ? entry.expiresAt : null,
    });
    return next;
  }

  async decr(key: string) {
    this.check();
    const entry = this.live(key);
    const next = Number(entry?.value ?? 0) - 1;
    this.store.set(key, {
      value: next,
      expiresAt: entry ? entry.expiresAt : null,
    });
    return next;
  }

  keys() {
    return [...this.store.keys()];
  }

  keysWithoutTtl() {
    return [...this.store.entries()]
      .filter(([, entry]) => entry.expiresAt === null)
      .map(([key]) => key);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ENV_KEYS = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "RATE_LIMIT_SALT",
  "RATE_LIMIT_PER_10_MIN",
  "RATE_LIMIT_PER_DAY",
  "GLOBAL_DAILY_GEMINI_CAP",
  "GLOBAL_GEMINI_RPM_CAP",
  "EVAL_BYPASS_TOKEN",
];

let redis: FakeRedis;

const RAW_CITIZENSHIP = {
  citizenshipRequirement: { value: "citizenship", text: "Australian citizens" },
};

const ADVICE = {
  summary: "s",
  checks: ["c"],
  applicationTips: ["t"],
  recruiterQuestions: ["q"],
};

function extractRequest(
  adText: string,
  headers: Record<string, string> = {},
  ip = "203.0.113.7"
) {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, ...headers },
    body: JSON.stringify({ adText }),
  });
}

function adviceRequest(headers: Record<string, string> = {}, ip = "203.0.113.7") {
  return new Request("http://localhost/api/tailor-advice", {
    method: "POST",
    headers: { "x-forwarded-for": ip, ...headers },
    body: JSON.stringify({
      adText: "Some job",
      verdict: { status: "TAILOR", reason: "r" },
    }),
  });
}

function modelReturns(raw: unknown) {
  gemini.generateContent.mockResolvedValue({ text: JSON.stringify(raw) });
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.GEMINI_API_KEY = "test-key";

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-10T12:07:30Z"));

  gemini.generateContent.mockReset();
  modelReturns(RAW_CITIZENSHIP);

  redis = new FakeRedis();
  setRedisForTesting(redis);
});

afterEach(() => {
  setRedisForTesting(undefined);
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveRedisConfig", () => {
  it("accepts the Upstash names", () => {
    expect(
      resolveRedisConfig({
        UPSTASH_REDIS_REST_URL: "https://a",
        UPSTASH_REDIS_REST_TOKEN: "t",
      })
    ).toEqual({ url: "https://a", token: "t" });
  });

  it("accepts the Vercel KV names", () => {
    expect(
      resolveRedisConfig({
        KV_REST_API_URL: "https://b",
        KV_REST_API_TOKEN: "u",
      })
    ).toEqual({ url: "https://b", token: "u" });
  });

  it("returns null when neither pair is complete", () => {
    expect(resolveRedisConfig({ UPSTASH_REDIS_REST_URL: "https://a" })).toBeNull();
    expect(resolveRedisConfig({})).toBeNull();
  });
});

describe("cacheKeyFor", () => {
  it("ignores surrounding and repeated whitespace, and does not contain the ad", () => {
    const a = cacheKeyFor("Must be an  Australian citizen\n\n today ");
    const b = cacheKeyFor("Must be an Australian citizen today");

    expect(a).toBe(b);
    expect(a).not.toContain("Australian");
    expect(cacheKeyFor("A different ad")).not.toBe(a);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Caching
// ─────────────────────────────────────────────────────────────────────────────

describe("extract caching", () => {
  it("miss then hit: the second identical request does not call Gemini", async () => {
    const adText = "Applicants must be Australian citizens.";

    const first = await extractPOST(extractRequest(adText));
    const second = await extractPOST(extractRequest(adText));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);

    const a = (await first.json()).extraction;
    const b = (await second.json()).extraction;
    expect(b).toEqual(a);
    expect(b.citizenshipRequirement.text).toBe("Australian citizens");
  });

  it("stores the raw model JSON (not the ad text, not post-processed spans) with a 14-day TTL", async () => {
    const adText = "Applicants must be Australian citizens.";
    await extractPOST(extractRequest(adText));

    const cached = redis.store.get(cacheKeyFor(adText));
    expect(cached).toBeDefined();
    expect(cached!.value).toEqual(RAW_CITIZENSHIP);
    expect(cached!.expiresAt! - Date.now()).toBe(14 * 24 * 60 * 60 * 1000);

    for (const key of redis.keys()) {
      expect(key).not.toContain("Australian");
    }
    expect(JSON.stringify([...redis.store.values()])).not.toContain(
      "Applicants must be"
    );
  });

  it("a cache hit skips Gemini and still runs post-processing on the cached value", async () => {
    // Cached model output is empty; the deterministic scan must still find the
    // requirement, proving the post-processing ran on the cached value.
    const adText = "Australian citizens only.";
    await redis.set(cacheKeyFor(adText), {}, { ex: 60 });

    const response = await extractPOST(extractRequest(adText));
    const { extraction } = await response.json();

    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(extraction.citizenshipRequirement?.text).toBe("Australian citizens only");
  });

  it("does not cache a response that failed to parse", async () => {
    gemini.generateContent.mockResolvedValue({ text: "not json" });

    const adText = "Some ad text";
    const response = await extractPOST(extractRequest(adText));

    expect(response.status).toBe(200);
    expect(redis.store.has(cacheKeyFor(adText))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-client rate limit
// ─────────────────────────────────────────────────────────────────────────────

describe("per-client rate limit", () => {
  it("allows N requests then returns 429 with Retry-After", async () => {
    process.env.RATE_LIMIT_PER_10_MIN = "3";

    for (let i = 0; i < 3; i++) {
      const ok = await extractPOST(extractRequest(`ad number ${i}`));
      expect(ok.status).toBe(200);
    }

    const limited = await extractPOST(extractRequest("ad number 3"));

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await limited.json()).code).toBe("rate_limited");
    expect(gemini.generateContent).toHaveBeenCalledTimes(3);
  });

  it("defaults to 20 per 10 minutes", async () => {
    process.env.GLOBAL_GEMINI_RPM_CAP = "100";

    for (let i = 0; i < 20; i++) {
      const ok = await extractPOST(extractRequest(`ad ${i}`));
      expect(ok.status).toBe(200);
    }

    expect((await extractPOST(extractRequest("ad 20"))).status).toBe(429);
  });

  it("enforces the daily limit", async () => {
    process.env.RATE_LIMIT_PER_DAY = "2";

    expect((await extractPOST(extractRequest("one"))).status).toBe(200);
    expect((await extractPOST(extractRequest("two"))).status).toBe(200);
    expect((await extractPOST(extractRequest("three"))).status).toBe(429);
  });

  it("cache hits do not count against the limit", async () => {
    process.env.RATE_LIMIT_PER_10_MIN = "2";

    for (let i = 0; i < 6; i++) {
      expect((await extractPOST(extractRequest("same ad"))).status).toBe(200);
    }
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);

    // One slot used so far: one more distinct ad is fine, the next is limited.
    expect((await extractPOST(extractRequest("other ad"))).status).toBe(200);
    expect((await extractPOST(extractRequest("third ad"))).status).toBe(429);
  });

  it("limits clients independently, keyed on the first x-forwarded-for entry", async () => {
    process.env.RATE_LIMIT_PER_10_MIN = "1";

    expect((await extractPOST(extractRequest("a", {}, "198.51.100.1"))).status).toBe(200);
    expect((await extractPOST(extractRequest("b", {}, "198.51.100.1"))).status).toBe(429);
    expect((await extractPOST(extractRequest("c", {}, "198.51.100.2"))).status).toBe(200);
  });

  it("never stores a raw IP address", async () => {
    process.env.RATE_LIMIT_SALT = "pepper";
    await extractPOST(extractRequest("ad", {}, "198.51.100.77"));

    expect(redis.keys().length).toBeGreaterThan(0);
    expect(JSON.stringify(redis.keys())).not.toContain("198.51.100.77");
  });

  it("applies to /api/tailor-advice too, which has no cache", async () => {
    process.env.RATE_LIMIT_PER_10_MIN = "2";
    modelReturns(ADVICE);

    expect((await advicePOST(adviceRequest())).status).toBe(200);
    expect((await advicePOST(adviceRequest())).status).toBe(200);

    const limited = await advicePOST(adviceRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
    expect(gemini.generateContent).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Global quota guard
// ─────────────────────────────────────────────────────────────────────────────

describe("global Gemini quota guard", () => {
  it("returns 503 (not 500) once the daily cap is reached", async () => {
    process.env.GLOBAL_DAILY_GEMINI_CAP = "2";
    process.env.RATE_LIMIT_PER_10_MIN = "100";

    expect((await extractPOST(extractRequest("one"))).status).toBe(200);
    expect((await extractPOST(extractRequest("two"))).status).toBe(200);

    const busy = await extractPOST(extractRequest("three"));
    expect(busy.status).toBe(503);
    expect((await busy.json()).code).toBe("gemini_cap_reached");
    expect(busy.headers.get("Retry-After")).not.toBeNull();
    expect(gemini.generateContent).toHaveBeenCalledTimes(2);
  });

  it("defaults to a daily cap of 350", async () => {
    await redis.set("gemini:day:2026-03-10", 350, { ex: 60 });

    const busy = await extractPOST(extractRequest("fresh ad"));
    expect(busy.status).toBe(503);
  });

  it("enforces a per-minute cap (default 12) with a sliding window", async () => {
    process.env.RATE_LIMIT_PER_10_MIN = "100";
    process.env.GLOBAL_GEMINI_RPM_CAP = "2";

    expect((await extractPOST(extractRequest("one"))).status).toBe(200);
    expect((await extractPOST(extractRequest("two"))).status).toBe(200);
    expect((await extractPOST(extractRequest("three"))).status).toBe(503);

    // A minute later the window has moved on.
    vi.setSystemTime(new Date("2026-03-10T12:09:30Z"));
    expect((await extractPOST(extractRequest("four"))).status).toBe(200);
  });

  it("is shared between /api/extract and /api/tailor-advice", async () => {
    process.env.GLOBAL_DAILY_GEMINI_CAP = "2";
    process.env.RATE_LIMIT_PER_10_MIN = "100";

    expect((await extractPOST(extractRequest("one"))).status).toBe(200);
    modelReturns(ADVICE);
    expect((await advicePOST(adviceRequest())).status).toBe(200);

    const busy = await advicePOST(adviceRequest());
    expect(busy.status).toBe(503);
    expect((await busy.json()).code).toBe("gemini_cap_reached");

    modelReturns(RAW_CITIZENSHIP);
    expect((await extractPOST(extractRequest("two"))).status).toBe(503);
  });

  it("cache hits do not consume the global quota", async () => {
    process.env.GLOBAL_DAILY_GEMINI_CAP = "1";

    for (let i = 0; i < 4; i++) {
      expect((await extractPOST(extractRequest("same ad"))).status).toBe(200);
    }
  });

  it("maps Gemini 429 and 5xx to 503 with a code, and other failures stay 500", async () => {
    gemini.generateContent.mockRejectedValueOnce(
      Object.assign(new Error("quota"), { status: 429 })
    );
    const quota = await extractPOST(extractRequest("ad 1"));
    expect(quota.status).toBe(503);
    expect((await quota.json()).code).toBe("gemini_unavailable");

    gemini.generateContent.mockRejectedValueOnce(
      Object.assign(new Error("overloaded"), { status: 503 })
    );
    expect((await extractPOST(extractRequest("ad 2"))).status).toBe(503);

    gemini.generateContent.mockRejectedValueOnce(
      Object.assign(new Error("bad request"), { status: 400 })
    );
    expect((await extractPOST(extractRequest("ad 3"))).status).toBe(500);
  });

  it("maps Gemini 429 to 503 on /api/tailor-advice", async () => {
    gemini.generateContent.mockRejectedValueOnce(
      Object.assign(new Error("quota"), { status: 429 })
    );

    const response = await advicePOST(adviceRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("gemini_unavailable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Redis failure, no Redis, TTLs
// ─────────────────────────────────────────────────────────────────────────────

describe("resilience", () => {
  it("Redis throwing still lets /api/extract succeed", async () => {
    redis.failing = true;

    const response = await extractPOST(extractRequest("Australian citizens only."));

    expect(response.status).toBe(200);
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);
  });

  it("Redis throwing still lets /api/tailor-advice succeed", async () => {
    redis.failing = true;
    modelReturns(ADVICE);

    const response = await advicePOST(adviceRequest());

    expect(response.status).toBe(200);
    expect((await response.json()).advice.summary).toBe("s");
  });

  it("without Redis config, behaviour is unchanged: no caching, no limits", async () => {
    setRedisForTesting(undefined);
    process.env.RATE_LIMIT_PER_10_MIN = "1";
    process.env.GLOBAL_DAILY_GEMINI_CAP = "1";

    for (let i = 0; i < 4; i++) {
      expect((await extractPOST(extractRequest("same ad"))).status).toBe(200);
    }

    expect(gemini.generateContent).toHaveBeenCalledTimes(4);
  });

  it("every key written has a TTL, including the global counters", async () => {
    modelReturns(RAW_CITIZENSHIP);
    await extractPOST(extractRequest("ad one"));
    await extractPOST(extractRequest("ad one"));
    modelReturns(ADVICE);
    await advicePOST(adviceRequest());

    const keys = redis.keys();
    expect(keys.some((k) => k.startsWith("gemini:day:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("gemini:rpm:"))).toBe(true);
    expect(redis.keysWithoutTtl()).toEqual([]);

    const day = redis.store.get("gemini:day:2026-03-10")!;
    expect(day.expiresAt! - Date.now()).toBe(2 * 24 * 60 * 60 * 1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Eval bypass
// ─────────────────────────────────────────────────────────────────────────────

describe("eval bypass token", () => {
  beforeEach(() => {
    process.env.EVAL_BYPASS_TOKEN = "let-me-in";
    process.env.RATE_LIMIT_PER_10_MIN = "1";
  });

  it("skips the per-client limit and the cache when the token matches", async () => {
    const headers = { "x-eval-token": "let-me-in" };

    for (let i = 0; i < 4; i++) {
      expect((await extractPOST(extractRequest("same ad", headers))).status).toBe(200);
    }

    // No cache reads or writes: Gemini was called every time.
    expect(gemini.generateContent).toHaveBeenCalledTimes(4);
    expect(redis.store.has(cacheKeyFor("same ad"))).toBe(false);
    expect(redis.keys().some((k) => k.startsWith("rl:"))).toBe(false);
  });

  it("still counts toward the global counters", async () => {
    const headers = { "x-eval-token": "let-me-in" };
    await extractPOST(extractRequest("a", headers));
    await extractPOST(extractRequest("b", headers));

    expect(redis.store.get("gemini:day:2026-03-10")?.value).toBe(2);
  });

  it("is still subject to the global cap", async () => {
    process.env.GLOBAL_DAILY_GEMINI_CAP = "1";
    const headers = { "x-eval-token": "let-me-in" };

    expect((await extractPOST(extractRequest("a", headers))).status).toBe(200);
    expect((await extractPOST(extractRequest("b", headers))).status).toBe(503);
  });

  it("applies to /api/tailor-advice (per-client limit only)", async () => {
    modelReturns(ADVICE);
    const headers = { "x-eval-token": "let-me-in" };

    for (let i = 0; i < 3; i++) {
      expect((await advicePOST(adviceRequest(headers))).status).toBe(200);
    }
  });

  it("does nothing with a wrong or missing token", async () => {
    expect((await extractPOST(extractRequest("a", { "x-eval-token": "nope" }))).status).toBe(200);
    expect((await extractPOST(extractRequest("b", { "x-eval-token": "nope" }))).status).toBe(429);
    expect((await extractPOST(extractRequest("c"))).status).toBe(429);
  });

  it("does nothing when EVAL_BYPASS_TOKEN is unset, even with an empty header", async () => {
    delete process.env.EVAL_BYPASS_TOKEN;

    expect((await extractPOST(extractRequest("a", { "x-eval-token": "" }))).status).toBe(200);
    expect((await extractPOST(extractRequest("b", { "x-eval-token": "" }))).status).toBe(429);
  });
});
