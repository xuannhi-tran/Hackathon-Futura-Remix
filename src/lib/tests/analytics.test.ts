/**
 * Server analytics: silent no-op without a key, strict property whitelist,
 * eval-token and Do-Not-Track exclusion, anonymous id validation.
 * posthog-node is mocked; nothing touches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  constructed: 0,
  captured: [] as Array<{
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
  }>,
  throwOnConstruct: false,
  rejectCapture: false,
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor() {
      if (posthog.throwOnConstruct) throw new Error("boom");
      posthog.constructed++;
    }
    async captureImmediate(message: {
      distinctId: string;
      event: string;
      properties: Record<string, unknown>;
    }) {
      posthog.captured.push(message);
      if (posthog.rejectCapture) throw new Error("network");
    }
    async flush() {}
  },
}));

import { resolveDistinctId, trackServer } from "../analytics";
import { adLengthBucket, isValidAnonId } from "../analyticsSchema";

const UUID = "3b241101-e2bb-4255-8caf-4136c566a962";

const AD_TEXT =
  "Graduate Software Engineer at Acme. You must be an Australian citizen. Email jane@acme.example to apply.";

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  posthog.constructed = 0;
  posthog.captured = [];
  posthog.throwOnConstruct = false;
  posthog.rejectCapture = false;
  delete process.env.EVAL_BYPASS_TOKEN;
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
  process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
});

describe("without a key", () => {
  it("is a silent no-op and never throws", () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;

    expect(() =>
      trackServer(request({ "x-anon-id": UUID }), "analyse_job", {
        verdict: "SKIP",
      })
    ).not.toThrow();

    expect(posthog.constructed).toBe(0);
    expect(posthog.captured).toEqual([]);
  });
});

describe("failures never propagate", () => {
  it("survives a client that cannot be constructed", () => {
    posthog.throwOnConstruct = true;
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_other_key";

    expect(() =>
      trackServer(request(), "analyse_job", { verdict: "APPLY" })
    ).not.toThrow();
  });

  it("survives a capture that rejects", async () => {
    posthog.rejectCapture = true;

    expect(() =>
      trackServer(request(), "analyse_job", { verdict: "APPLY" })
    ).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("property whitelist", () => {
  it("drops unknown fields and free text, keeps structured values", () => {
    trackServer(request({ "x-anon-id": UUID }), "analyse_job", {
      verdict: "SKIP",
      ruleId: "T1_CITIZENSHIP",
      visaSubclass: "500",
      cacheHit: false,
      degraded: false,
      latencyMs: 1234.56,
      adLengthBucket: "1-3k",
      // forbidden:
      adText: AD_TEXT,
      evidence: { text: "Australian citizen", start: 5, end: 23 },
      extraction: { citizenshipRequirement: "Australian citizen" },
      email: "jane@acme.example",
    });

    expect(posthog.captured).toHaveLength(1);

    const { properties, distinctId, event } = posthog.captured[0];

    expect(event).toBe("analyse_job");
    expect(distinctId).toBe(UUID);
    expect(properties).toMatchObject({
      verdict: "SKIP",
      ruleId: "T1_CITIZENSHIP",
      visaSubclass: "500",
      cacheHit: false,
      degraded: false,
      latencyMs: 1235,
      adLengthBucket: "1-3k",
    });

    const allowed = new Set([
      "verdict",
      "ruleId",
      "visaSubclass",
      "cacheHit",
      "degraded",
      "latencyMs",
      "adLengthBucket",
    ]);
    for (const key of Object.keys(properties)) {
      expect(allowed.has(key) || key.startsWith("$")).toBe(true);
    }

    const serialised = JSON.stringify(posthog.captured);
    expect(serialised).not.toContain("Australian citizen");
    expect(serialised).not.toContain("jane@acme");
    expect(serialised).not.toContain("Acme");
  });

  it("drops a job-ad string even when passed as the value of an allowed key", () => {
    trackServer(request(), "analyse_job", {
      verdict: AD_TEXT,
      ruleId: AD_TEXT,
      adLengthBucket: AD_TEXT,
      visaSubclass: AD_TEXT,
      latencyMs: AD_TEXT,
    });

    expect(JSON.stringify(posthog.captured)).not.toContain("Acme");
    expect(Object.keys(posthog.captured[0].properties).filter((k) => !k.startsWith("$"))).toEqual([]);
  });

  it("rejects out-of-range enum values", () => {
    trackServer(request(), "request_refused", {
      reason: "because I said so",
      route: "/api/secret",
    });

    expect(Object.keys(posthog.captured[0].properties).filter((k) => !k.startsWith("$"))).toEqual([]);
  });

  it("ignores events that are not in the schema", () => {
    // @ts-expect-error deliberately not a valid event name
    trackServer(request(), "typed_something", { verdict: "SKIP" });

    expect(posthog.captured).toEqual([]);
  });

  it("marks events anonymous: no person profile, no geo-IP", () => {
    trackServer(request(), "tailor_advice_requested", {
      latencyMs: 10,
      success: true,
    });

    expect(posthog.captured[0].properties).toMatchObject({
      $process_person_profile: false,
      $geoip_disable: true,
    });
  });
});

describe("exclusions", () => {
  it("does not track requests carrying a valid eval token", () => {
    process.env.EVAL_BYPASS_TOKEN = "let-me-in";

    trackServer(request({ "x-eval-token": "let-me-in" }), "analyse_job", {
      verdict: "APPLY",
    });

    expect(posthog.captured).toEqual([]);
  });

  it("still tracks when the eval token is wrong", () => {
    process.env.EVAL_BYPASS_TOKEN = "let-me-in";

    trackServer(request({ "x-eval-token": "nope" }), "analyse_job", {
      verdict: "APPLY",
    });

    expect(posthog.captured).toHaveLength(1);
  });

  it("respects Do Not Track", () => {
    trackServer(request({ dnt: "1" }), "analyse_job", { verdict: "APPLY" });

    expect(posthog.captured).toEqual([]);
  });
});

describe("anonymous id", () => {
  it("accepts a UUID", () => {
    expect(resolveDistinctId(request({ "x-anon-id": UUID }))).toBe(UUID);
    expect(isValidAnonId(UUID)).toBe(true);
  });

  it.each([
    "",
    "not-a-uuid",
    "jane@acme.example",
    `${UUID}-extra`,
    "<script>alert(1)</script>",
    "3b241101e2bb42558caf4136c566a962",
  ])("falls back to 'unknown' for %j", (value) => {
    expect(resolveDistinctId(request({ "x-anon-id": value }))).toBe("unknown");
    expect(isValidAnonId(value)).toBe(false);
  });

  it("falls back to 'unknown' when the header is missing", () => {
    expect(resolveDistinctId(request())).toBe("unknown");
  });
});

describe("adLengthBucket", () => {
  it("never exposes the exact length", () => {
    expect(adLengthBucket(0)).toBe("<1k");
    expect(adLengthBucket(999)).toBe("<1k");
    expect(adLengthBucket(1000)).toBe("1-3k");
    expect(adLengthBucket(2999)).toBe("1-3k");
    expect(adLengthBucket(3000)).toBe("3-6k");
    expect(adLengthBucket(5999)).toBe("3-6k");
    expect(adLengthBucket(6000)).toBe(">6k");
  });
});
