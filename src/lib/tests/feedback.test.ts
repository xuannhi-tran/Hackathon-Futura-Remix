/**
 * POST /api/feedback: strict validation, own rate limit (no Gemini quota),
 * capped Redis list with a TTL, and no comment/email in logs or analytics.
 * Redis and PostHog are mocked; nothing touches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  constructed: 0,
  captured: [] as Array<{
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
  }>,
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

import { POST } from "../../app/api/feedback/route";
import { sanitizeProperties } from "../analyticsSchema";
import { setRedisForTesting } from "../redisClient";
import { FakeRedis } from "./fakeRedis";

const UUID = "3b241101-e2bb-4255-8caf-4136c566a962";
const KEY = "feedback:v1";
const COMMENT = "The wording on the visa step confused me, zebra-quokka-7731.";
const EMAIL = "jane.tester@example.org";

const ENV_KEYS = [
  "FEEDBACK_RATE_LIMIT_PER_10_MIN",
  "FEEDBACK_RATE_LIMIT_PER_DAY",
  "RATE_LIMIT_PER_10_MIN",
  "GLOBAL_DAILY_GEMINI_CAP",
  "GLOBAL_GEMINI_RPM_CAP",
  "EVAL_BYPASS_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
];

let redis: FakeRedis;

function request(
  body: unknown,
  headers: Record<string, string> = {},
  ip = "203.0.113.5"
) {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "x-anon-id": UUID, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function stored(): Array<Record<string, unknown>> {
  return (redis.lists.get(KEY)?.items ?? []).map((item) => JSON.parse(item));
}

let logged: unknown[][];

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";

  posthog.captured = [];
  posthog.constructed = 0;

  redis = new FakeRedis();
  setRedisForTesting(redis);

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-10T12:07:30Z"));

  logged = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  }
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  setRedisForTesting(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("storing feedback", () => {
  it("stores a rating with comment and email, newest first, under feedback:v1", async () => {
    const first = await POST(request({ rating: "up", comment: COMMENT, email: EMAIL }));
    const second = await POST(request({ rating: "down" }));

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(second.status).toBe(200);

    const entries = stored();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ rating: "down" });
    expect(entries[1]).toMatchObject({
      rating: "up",
      comment: COMMENT,
      email: EMAIL,
    });
    expect(typeof entries[0].at).toBe("string");
  });

  it("trims text and treats empty comment/email as absent", async () => {
    await POST(request({ rating: "up", comment: "   ", email: "" }));
    await POST(request({ rating: "down", comment: "  hello  ", email: ` ${EMAIL} ` }));

    const [second, first] = stored();
    expect(first.comment).toBeUndefined();
    expect(first.email).toBeUndefined();
    expect(second).toMatchObject({ comment: "hello", email: EMAIL });
  });

  it("puts a TTL on the feedback key", async () => {
    await POST(request({ rating: "up" }));

    const list = redis.lists.get(KEY)!;
    expect(list.expiresAt - Date.now()).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it("every key written has a TTL", async () => {
    await POST(request({ rating: "up", comment: COMMENT }));

    expect(redis.keysWithoutTtl()).toEqual([]);
    expect(redis.lists.get(KEY)!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("keeps at most 500 entries, dropping the oldest", async () => {
    process.env.FEEDBACK_RATE_LIMIT_PER_10_MIN = "1000";
    process.env.FEEDBACK_RATE_LIMIT_PER_DAY = "1000";

    for (let i = 0; i < 505; i++) {
      await POST(request({ rating: i % 2 ? "up" : "down", comment: `c${i}` }));
    }

    const entries = stored();
    expect(entries).toHaveLength(500);
    expect(entries[0].comment).toBe("c504");
    expect(entries[499].comment).toBe("c5");
  });
});

describe("validation", () => {
  const maxComment = "a".repeat(500);
  const longEmail = `${"a".repeat(246)}@example.com`; // 258 chars

  const invalid: Array<[string, unknown]> = [
    ["missing rating", { comment: "hi" }],
    ["rating not up/down", { rating: "sideways" }],
    ["rating wrong type", { rating: 5 }],
    ["comment over 500 chars", { rating: "up", comment: "a".repeat(501) }],
    ["comment not a string", { rating: "up", comment: { text: "hi" } }],
    ["email over 254 chars", { rating: "up", email: longEmail }],
    ["email without @", { rating: "up", email: "not-an-email" }],
    ["email with spaces", { rating: "up", email: "a b@example.com" }],
    ["email without a dot in the domain", { rating: "up", email: "a@b" }],
    ["unknown field", { rating: "up", adText: "job ad" }],
    ["array body", [{ rating: "up" }]],
    ["null body", null],
    ["string body", '"up"'],
    ["invalid JSON", "{rating:"],
    ["oversized body", { rating: "up", comment: "a".repeat(20_000) }],
  ];

  for (const [name, body] of invalid) {
    it(`rejects ${name} with 400 and stores nothing`, async () => {
      const response = await POST(request(body));

      expect(response.status).toBe(400);
      expect(typeof (await response.json()).error).toBe("string");
      expect(stored()).toEqual([]);
      expect(posthog.captured).toEqual([]);
    });
  }

  it("accepts a comment of exactly 500 chars and an email of exactly 254 chars", async () => {
    const padded = `${"a".repeat(254 - "@example.com".length)}@example.com`;
    expect(padded.length).toBe(254);

    const response = await POST(
      request({ rating: "down", comment: maxComment, email: padded })
    );

    expect(response.status).toBe(200);
    expect(stored()[0].email).toBe(padded);
  });
});

describe("rate limit", () => {
  it("allows N then returns 429 with Retry-After", async () => {
    process.env.FEEDBACK_RATE_LIMIT_PER_10_MIN = "2";

    expect((await POST(request({ rating: "up" }))).status).toBe(200);
    expect((await POST(request({ rating: "up" }))).status).toBe(200);

    const limited = await POST(request({ rating: "up" }));

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await limited.json()).code).toBe("rate_limited");
    expect(stored()).toHaveLength(2);
  });

  it("defaults to 5 per 10 minutes per client", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await POST(request({ rating: "up" }))).status).toBe(200);
    }
    expect((await POST(request({ rating: "up" }))).status).toBe(429);
    expect((await POST(request({ rating: "up" }, {}, "198.51.100.9"))).status).toBe(200);
  });

  it("does not touch the Gemini quota counters or the Gemini per-client limit", async () => {
    process.env.GLOBAL_DAILY_GEMINI_CAP = "1";

    for (let i = 0; i < 3; i++) await POST(request({ rating: "up" }));

    const keys = redis.keys();
    expect(keys.some((k) => k.startsWith("gemini:"))).toBe(false);
    expect(keys.some((k) => k.startsWith("rl:"))).toBe(false);
    expect(keys.some((k) => k.startsWith("rlfb:"))).toBe(true);
  });

  it("does not store a raw IP address", async () => {
    await POST(request({ rating: "up", comment: "hi" }, {}, "198.51.100.77"));

    expect(JSON.stringify(redis.keys())).not.toContain("198.51.100.77");
    expect(JSON.stringify([...redis.lists.values()])).not.toContain("198.51.100.77");
  });
});

describe("Redis unavailable", () => {
  it("returns success and stores nothing when Redis is not configured", async () => {
    setRedisForTesting(undefined);

    const response = await POST(
      request({ rating: "up", comment: COMMENT, email: EMAIL })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(redis.lists.size).toBe(0);
  });

  it("returns 503 when Redis throws, logging only the error name", async () => {
    redis.failing = true;

    const response = await POST(
      request({ rating: "up", comment: COMMENT, email: EMAIL })
    );

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("feedback_unavailable");
    expect(posthog.captured).toEqual([]);
    expect(logged.length).toBeGreaterThan(0);
  });
});

describe("privacy", () => {
  it("never logs the comment or email", async () => {
    await POST(request({ rating: "up", comment: COMMENT, email: EMAIL }));
    redis.failing = true;
    await POST(request({ rating: "down", comment: COMMENT, email: EMAIL }));
    await POST(request({ rating: "down", comment: "a".repeat(501), email: EMAIL }));
    await POST(request(`{"rating":"up","comment":"${COMMENT}","email":"${EMAIL}"`));

    const output = JSON.stringify(logged);
    expect(output).not.toContain("zebra-quokka-7731");
    expect(output).not.toContain("jane.tester");
    expect(output).not.toContain("example.org");
  });

  it("sends PostHog only feedback_submitted with the rating", async () => {
    await POST(request({ rating: "down", comment: COMMENT, email: EMAIL }));

    expect(posthog.captured).toHaveLength(1);

    const [event] = posthog.captured;
    expect(event.event).toBe("feedback_submitted");
    expect(event.distinctId).toBe(UUID);
    expect(event.properties.rating).toBe("down");

    const keys = Object.keys(event.properties).filter((k) => !k.startsWith("$"));
    expect(keys).toEqual(["rating"]);

    const output = JSON.stringify(posthog.captured);
    expect(output).not.toContain("zebra-quokka-7731");
    expect(output).not.toContain("jane.tester");
  });

  it("the analytics whitelist drops comment, email and bad ratings", () => {
    expect(
      sanitizeProperties("feedback_submitted", {
        rating: "up",
        comment: COMMENT,
        email: EMAIL,
      })
    ).toEqual({ rating: "up" });

    expect(sanitizeProperties("feedback_submitted", { rating: COMMENT })).toEqual({});
  });

  it("does not track requests with a valid eval token, and skips their rate limit", async () => {
    process.env.EVAL_BYPASS_TOKEN = "let-me-in";
    process.env.FEEDBACK_RATE_LIMIT_PER_10_MIN = "1";
    const headers = { "x-eval-token": "let-me-in" };

    for (let i = 0; i < 3; i++) {
      expect((await POST(request({ rating: "up" }, headers))).status).toBe(200);
    }

    expect(posthog.captured).toEqual([]);
  });

  it("does nothing in analytics without a PostHog key", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;

    const response = await POST(request({ rating: "up" }));

    expect(response.status).toBe(200);
    expect(posthog.constructed).toBe(0);
  });
});
