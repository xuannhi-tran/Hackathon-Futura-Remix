/**
 * The complete list of analytics events and the only properties each may carry.
 *
 * Shared by the server (analytics.ts) and the browser (analyticsClient.ts).
 * Every property is a boolean, a number, or a string from a fixed set or a
 * strict short pattern, so free text (job ads, extracted spans, anything a user
 * typed) cannot pass through: unknown keys and non-matching values are dropped.
 */

export const ANON_ID_HEADER = "x-anon-id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidAnonId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export const AD_LENGTH_BUCKETS = ["<1k", "1-3k", "3-6k", ">6k"] as const;

export type AdLengthBucket = (typeof AD_LENGTH_BUCKETS)[number];

/** Coarse size of the ad; the exact length is never sent. */
export function adLengthBucket(length: number): AdLengthBucket {
  if (length < 1000) return "<1k";
  if (length < 3000) return "1-3k";
  if (length < 6000) return "3-6k";
  return ">6k";
}

type PropertySpec =
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "pattern"; pattern: RegExp };

const VERDICT: PropertySpec = {
  kind: "enum",
  values: ["APPLY", "TAILOR", "SKIP"],
};

export const EVENT_SCHEMAS = {
  // ── server ──────────────────────────────────────────────────────────────
  analyse_job: {
    side: "server",
    properties: {
      verdict: VERDICT,
      ruleId: { kind: "pattern", pattern: /^[A-Z][A-Z0-9_]{1,59}$/ },
      visaSubclass: { kind: "enum", values: ["500", "485"] },
      cacheHit: { kind: "boolean" },
      degraded: { kind: "boolean" },
      latencyMs: { kind: "number" },
      adLengthBucket: { kind: "enum", values: AD_LENGTH_BUCKETS },
    },
  },
  tailor_advice_requested: {
    side: "server",
    properties: {
      latencyMs: { kind: "number" },
      success: { kind: "boolean" },
    },
  },
  request_refused: {
    side: "server",
    properties: {
      reason: {
        kind: "enum",
        values: ["rate_limited", "quota_cap", "upstream_error"],
      },
      route: { kind: "enum", values: ["extract", "tailor-advice"] },
    },
  },
  // ── browser ─────────────────────────────────────────────────────────────
  app_opened: { side: "client", properties: {} },
  job_saved: { side: "client", properties: { verdict: VERDICT } },
  job_removed: { side: "client", properties: {} },
  suggestions_viewed: { side: "client", properties: {} },
} as const satisfies Record<
  string,
  { side: "server" | "client"; properties: Record<string, PropertySpec> }
>;

export type AnalyticsEvent = keyof typeof EVENT_SCHEMAS;

export type ServerEvent = {
  [E in AnalyticsEvent]: (typeof EVENT_SCHEMAS)[E]["side"] extends "server"
    ? E
    : never;
}[AnalyticsEvent];

export type ClientEvent = Exclude<AnalyticsEvent, ServerEvent>;

export function isEventOnSide(
  event: string,
  side: "server" | "client"
): event is AnalyticsEvent {
  return (
    Object.prototype.hasOwnProperty.call(EVENT_SCHEMAS, event) &&
    EVENT_SCHEMAS[event as AnalyticsEvent].side === side
  );
}

function accepts(spec: PropertySpec, value: unknown): boolean {
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "enum":
      return typeof value === "string" && spec.values.includes(value);
    case "pattern":
      return typeof value === "string" && spec.pattern.test(value);
  }
}

/** Keeps only whitelisted keys whose values fit their spec. */
export function sanitizeProperties(
  event: AnalyticsEvent,
  props: Record<string, unknown> | undefined
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const specs = EVENT_SCHEMAS[event].properties as Record<string, PropertySpec>;

  for (const [key, spec] of Object.entries(specs)) {
    const value = props?.[key];

    if (!accepts(spec, value)) continue;

    out[key] =
      spec.kind === "number"
        ? Math.min(Math.max(Math.round(value as number), 0), 600_000)
        : (value as string | boolean);
  }

  return out;
}
