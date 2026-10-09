/**
 * Analytics events emitted by /api/extract and /api/tailor-advice.
 * Gemini, PostHog and Redis are all mocked; no network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));

const posthog = vi.hoisted(() => ({
  constructed: 0,
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
  },
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor() {
      posthog.constructed++;
    }
    async captureImmediate(message: (typeof posthog.captured)[number]) {
      posthog.captured.push(message);
    }
    async flush() {}
  },
}));

import { POST as extractPOST } from "../../app/api/extract/route";
import { POST as advicePOST } from "../../app/api/tailor-advice/route";
import { setRedisForTesting } from "../redisClient";
import { FakeRedis } from "./fakeRedis";

const UUID = "3b241101-e2bb-4255-8caf-4136c566a962";
const AD = "Applicants must be Australian citizens. Contact jane@acme.example.";

const PROFILE_500 = {
  subclass: "500",
  duringStudyTerm: true,
  monthsRemaining: 18,
};

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

function extractRequest(
  adText: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "x-anon-id": UUID, "x-forwarded-for": "203.0.113.9", ...headers },
    body: JSON.stringify({ adText, ...extra }),
  });
}

function adviceRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/tailor-advice", {
    method: "POST",
    headers: { "x-anon-id": UUID, "x-forwarded-for": "203.0.113.9", ...headers },
    body: JSON.stringify({
      adText: AD,
      verdict: { status: "TAILOR", reason: "r" },
    }),
  });
}

function events(name?: string) {
  return posthog.captured.filter((e) => !name || e.event === name);
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.GEMINI_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";

  posthog.captured = [];
  posthog.constructed = 0;

  gemini.generateContent.mockReset();
  gemini.generateContent.mockResolvedValue({
    text: JSON.stringify({
      citizenshipRequirement: { value: "c", text: "Australian citizens" },
    }),
  });

  setRedisForTesting(new FakeRedis());
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  setRedisForTesting(undefined);
});

describe("analyse_job", () => {
  it("reports verdict, rule, subclass, cacheHit, degraded, latency and a length bucket", async () => {
    const response = await extractPOST(
      extractRequest(AD, { visaProfile: PROFILE_500 })
    );
    expect(response.status).toBe(200);

    const [event] = events("analyse_job");
    expect(event.distinctId).toBe(UUID);
    expect(event.properties).toMatchObject({
      verdict: "SKIP",
      ruleId: "T1_CITIZENSHIP",
      visaSubclass: "500",
      cacheHit: false,
      degraded: false,
      adLengthBucket: "<1k",
    });
    expect(typeof event.properties.latencyMs).toBe("number");
  });

  it("never sends the ad text, spans or the exact length", async () => {
    await extractPOST(extractRequest(AD, { visaProfile: PROFILE_500 }));

    const serialised = JSON.stringify(posthog.captured);
    expect(serialised).not.toContain("jane@acme");
    expect(serialised).not.toContain("Applicants must");
    expect(serialised).not.toContain("Australian citizens");
    for (const e of posthog.captured) {
      expect(Object.values(e.properties)).not.toContain(AD.length);
    }
  });

  it("reports cacheHit true on a cached ad", async () => {
    await extractPOST(extractRequest(AD, { visaProfile: PROFILE_500 }));
    await extractPOST(extractRequest(AD, { visaProfile: PROFILE_500 }));

    const hits = events("analyse_job").map((e) => e.properties.cacheHit);
    expect(hits).toEqual([false, true]);
  });

  it("reports degraded when the model output was unusable and fallbacks ran", async () => {
    gemini.generateContent.mockResolvedValue({ text: "not json" });

    await extractPOST(extractRequest("Australian citizens only.", { visaProfile: PROFILE_500 }));

    expect(events("analyse_job")[0].properties.degraded).toBe(true);
  });

  it("omits verdict fields when the client sent no profile, and ignores a malformed profile", async () => {
    await extractPOST(extractRequest(AD));
    await extractPOST(
      extractRequest("Another ad", { visaProfile: { subclass: "999", monthsRemaining: "x" } })
    );

    for (const e of events("analyse_job")) {
      expect(e.properties.verdict).toBeUndefined();
      expect(e.properties.visaSubclass).toBeUndefined();
    }
  });

  it("falls back to distinct id 'unknown' for an invalid x-anon-id", async () => {
    await extractPOST(extractRequest(AD, {}, { "x-anon-id": "jane@acme.example" }));

    expect(events("analyse_job")[0].distinctId).toBe("unknown");
  });
});

describe("request_refused", () => {
  it("rate_limited on 429", async () => {
    process.env.RATE_LIMIT_PER_10_MIN = "1";

    await extractPOST(extractRequest("one"));
    const limited = await extractPOST(extractRequest("two"));

    expect(limited.status).toBe(429);
    expect(events("request_refused")[0].properties).toMatchObject({
      reason: "rate_limited",
      route: "extract",
    });
  });

  it("quota_cap on the global cap", async () => {
    process.env.GLOBAL_DAILY_GEMINI_CAP = "0";

    const busy = await extractPOST(extractRequest("one"));

    expect(busy.status).toBe(503);
    expect(events("request_refused")[0].properties).toMatchObject({
      reason: "quota_cap",
      route: "extract",
    });
  });

  it("upstream_error when Gemini itself fails", async () => {
    gemini.generateContent.mockRejectedValue(
      Object.assign(new Error("overloaded"), { status: 503 })
    );

    const busy = await extractPOST(extractRequest("one"));

    expect(busy.status).toBe(503);
    expect(events("request_refused")[0].properties).toMatchObject({
      reason: "upstream_error",
      route: "extract",
    });
    expect(events("analyse_job")).toHaveLength(0);
  });
});

describe("tailor_advice_requested", () => {
  const ADVICE = JSON.stringify({
    summary: "s",
    checks: [],
    applicationTips: [],
    recruiterQuestions: [],
  });

  it("reports success and latency", async () => {
    gemini.generateContent.mockResolvedValue({ text: ADVICE });

    await advicePOST(adviceRequest());

    const [event] = events("tailor_advice_requested");
    expect(event.properties.success).toBe(true);
    expect(typeof event.properties.latencyMs).toBe("number");
    expect(JSON.stringify(posthog.captured)).not.toContain("jane@acme");
  });

  it("reports success false on a failure", async () => {
    gemini.generateContent.mockRejectedValue(
      Object.assign(new Error("bad"), { status: 400 })
    );

    const response = await advicePOST(adviceRequest());

    expect(response.status).toBe(500);
    expect(events("tailor_advice_requested")[0].properties.success).toBe(false);
  });

  it("reports refusals with the tailor-advice route", async () => {
    process.env.RATE_LIMIT_PER_10_MIN = "1";
    gemini.generateContent.mockResolvedValue({ text: ADVICE });

    await advicePOST(adviceRequest());
    const limited = await advicePOST(adviceRequest());

    expect(limited.status).toBe(429);
    expect(events("request_refused")[0].properties).toMatchObject({
      reason: "rate_limited",
      route: "tailor-advice",
    });
  });
});

describe("exclusions and no-op", () => {
  it("tracks nothing for eval-token requests, including refusals", async () => {
    process.env.EVAL_BYPASS_TOKEN = "let-me-in";
    process.env.GLOBAL_DAILY_GEMINI_CAP = "1";
    const headers = { "x-eval-token": "let-me-in" };

    await extractPOST(extractRequest("one", { visaProfile: PROFILE_500 }, headers));
    const busy = await extractPOST(extractRequest("two", {}, headers));

    expect(busy.status).toBe(503);
    expect(posthog.captured).toEqual([]);
  });

  it("does nothing and builds no client without NEXT_PUBLIC_POSTHOG_KEY", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;

    const response = await extractPOST(extractRequest(AD, { visaProfile: PROFILE_500 }));

    expect(response.status).toBe(200);
    expect(posthog.constructed).toBe(0);
    expect(posthog.captured).toEqual([]);
  });
});
