/**
 * Latency guard: Gemini timeout -> friendly 503 + refusal event, Redis timeout
 * fails open, and no ad text reaches any event. Gemini, PostHog and Redis are
 * all mocked; no network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gemini = vi.hoisted(() => ({
  generateContent: vi.fn(),
  constructorOptions: [] as unknown[],
}));

const posthog = vi.hoisted(() => ({
  captured: [] as Array<{
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
  }>,
}));

vi.mock("@google/genai", () => ({
  Type: { OBJECT: "OBJECT", STRING: "STRING", ARRAY: "ARRAY" },
  GoogleGenAI: class {
    models = { generateContent: gemini.generateContent };
    constructor(options: unknown) {
      gemini.constructorOptions.push(options);
    }
  },
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    async captureImmediate(message: (typeof posthog.captured)[number]) {
      posthog.captured.push(message);
    }
    async flush() {}
  },
}));

import * as extractRoute from "../../app/api/extract/route";
import * as adviceRoute from "../../app/api/tailor-advice/route";
import {
  GEMINI_TIMEOUT_MS,
  REDIS_TIMEOUT_MS,
  cacheKeyFor,
} from "../geminiGuard";
import { setRedisForTesting, type RedisLike } from "../redisClient";
import { FakeRedis } from "./fakeRedis";

const extractPOST = extractRoute.POST;
const advicePOST = adviceRoute.POST;

const UUID = "3b241101-e2bb-4255-8caf-4136c566a962";
const AD =
  "Applicants must be Australian citizens. Contact jane@acme.example at Acme Pty Ltd.";

const ENV_KEYS = [
  "RATE_LIMIT_PER_10_MIN",
  "GLOBAL_DAILY_GEMINI_CAP",
  "GLOBAL_GEMINI_RPM_CAP",
  "EVAL_BYPASS_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
];

function extractRequest(adText: string = AD) {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "x-anon-id": UUID, "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ adText }),
  });
}

function adviceRequest() {
  return new Request("http://localhost/api/tailor-advice", {
    method: "POST",
    headers: { "x-anon-id": UUID, "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({
      adText: AD,
      verdict: { status: "TAILOR", reason: "r" },
    }),
  });
}

function abortError() {
  return Object.assign(new Error("This operation was aborted"), {
    name: "AbortError",
    code: 20,
  });
}

function refusals() {
  return posthog.captured.filter((e) => e.event === "request_refused");
}

/** A Redis whose every command never settles. */
function hangingRedis(): RedisLike {
  const never = () => new Promise<never>(() => {});
  return {
    get: never,
    set: never,
    incr: never,
    decr: never,
    pushCapped: never,
  };
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.GEMINI_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";

  posthog.captured = [];
  gemini.constructorOptions = [];
  gemini.generateContent.mockReset();
  gemini.generateContent.mockResolvedValue({
    text: JSON.stringify({
      citizenshipRequirement: { value: "c", text: "Australian citizens" },
    }),
  });

  setRedisForTesting(new FakeRedis());
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  setRedisForTesting(undefined);
});

describe("Gemini timeout", () => {
  it("builds the client with a 20s timeout and no retry options", async () => {
    await extractPOST(extractRequest());
    await advicePOST(adviceRequest());

    expect(GEMINI_TIMEOUT_MS).toBe(20_000);
    expect(gemini.constructorOptions).toHaveLength(2);
    for (const options of gemini.constructorOptions) {
      expect(options).toMatchObject({ httpOptions: { timeout: 20_000 } });
      expect(
        (options as { httpOptions: Record<string, unknown> }).httpOptions
      ).not.toHaveProperty("retryOptions");
    }
  });

  it("declares maxDuration = 30 on both routes", () => {
    expect(extractRoute.maxDuration).toBe(30);
    expect(adviceRoute.maxDuration).toBe(30);
  });

  it("/api/extract returns the friendly 503 once and records upstream_timeout with latency", async () => {
    gemini.generateContent.mockRejectedValue(abortError());

    const response = await extractPOST(extractRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("The analysis took too long, please try again.");
    expect(body.code).toBe("gemini_timeout");
    expect(response.headers.get("Retry-After")).not.toBeNull();
    // No retry.
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);

    expect(refusals()).toHaveLength(1);
    expect(refusals()[0].properties).toMatchObject({
      reason: "upstream_timeout",
      route: "extract",
    });
    expect(typeof refusals()[0].properties.latencyMs).toBe("number");
    expect(
      posthog.captured.filter((e) => e.event === "analyse_job")
    ).toHaveLength(0);
  });

  it("/api/tailor-advice returns the friendly 503 and records upstream_timeout", async () => {
    gemini.generateContent.mockRejectedValue(abortError());

    const response = await advicePOST(adviceRequest());

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe(
      "The analysis took too long, please try again."
    );
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);
    expect(refusals()[0].properties).toMatchObject({
      reason: "upstream_timeout",
      route: "tailor-advice",
    });
    expect(typeof refusals()[0].properties.latencyMs).toBe("number");
  });

  it("recognises a timeout wrapped as a cause", async () => {
    gemini.generateContent.mockRejectedValue(
      Object.assign(new Error("fetch failed"), { cause: abortError() })
    );

    const response = await extractPOST(extractRequest());

    expect((await response.json()).code).toBe("gemini_timeout");
  });

  it("records upstream_error with latency for 429 and 5xx", async () => {
    for (const status of [429, 503]) {
      gemini.generateContent.mockRejectedValueOnce(
        Object.assign(new Error("upstream"), { status })
      );
      const response = await extractPOST(extractRequest(`ad ${status}`));
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe("gemini_unavailable");
    }

    expect(refusals().map((e) => e.properties.reason)).toEqual([
      "upstream_error",
      "upstream_error",
    ]);
    for (const event of refusals()) {
      expect(typeof event.properties.latencyMs).toBe("number");
    }
  });

  it("still returns 500 for other Gemini failures", async () => {
    gemini.generateContent.mockRejectedValue(
      Object.assign(new Error("bad request"), { status: 400 })
    );

    expect((await extractPOST(extractRequest())).status).toBe(500);
    expect(refusals()).toHaveLength(0);
  });
});

describe("Redis timeout fails open", () => {
  it("a Redis that never answers delays /api/extract by at most the timeout budget, then succeeds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setRedisForTesting(hangingRedis());

    const pending = extractPOST(extractRequest());

    // Cache read, client limit, global reservation, cache write: one budget each.
    await vi.advanceTimersByTimeAsync(REDIS_TIMEOUT_MS * 4);
    const response = await pending;

    expect(response.status).toBe(200);
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);
    expect((await response.json()).extraction).toBeDefined();
  });

  it("a Redis that never answers does not block /api/tailor-advice", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setRedisForTesting(hangingRedis());
    gemini.generateContent.mockResolvedValue({
      text: JSON.stringify({
        summary: "s",
        checks: [],
        applicationTips: [],
        recruiterQuestions: [],
      }),
    });

    const pending = advicePOST(adviceRequest());
    await vi.advanceTimersByTimeAsync(REDIS_TIMEOUT_MS * 2);

    expect((await pending).status).toBe(200);
  });

  it("a slow Redis within the budget still serves the cache", async () => {
    const redis = new FakeRedis();
    await redis.set(
      cacheKeyFor(AD),
      { citizenshipRequirement: { value: "c", text: "Australian citizens" } },
      { ex: 60 }
    );
    setRedisForTesting(redis);

    const response = await extractPOST(extractRequest());

    expect(response.status).toBe(200);
    expect(gemini.generateContent).not.toHaveBeenCalled();
  });
});

describe("no ad text in events", () => {
  it("keeps the ad, its contact details and company out of every event on every failure path", async () => {
    gemini.generateContent.mockRejectedValueOnce(abortError());
    await extractPOST(extractRequest());

    gemini.generateContent.mockRejectedValueOnce(
      Object.assign(new Error("Acme jane@acme.example"), { status: 503 })
    );
    await extractPOST(extractRequest("Another ad from Acme Pty Ltd"));

    gemini.generateContent.mockRejectedValueOnce(abortError());
    await advicePOST(adviceRequest());

    expect(posthog.captured.length).toBeGreaterThanOrEqual(3);

    const serialised = JSON.stringify(posthog.captured);
    expect(serialised).not.toContain("jane@acme");
    expect(serialised).not.toContain("Acme");
    expect(serialised).not.toContain("Applicants must");
    expect(serialised).not.toContain("citizens");
    expect(serialised).not.toContain("aborted");

    const allowed = new Set([
      "reason",
      "route",
      "latencyMs",
      "$process_person_profile",
      "$geoip_disable",
    ]);
    for (const event of posthog.captured) {
      expect(Object.keys(event.properties).every((k) => allowed.has(k))).toBe(
        true
      );
    }
  });
});
