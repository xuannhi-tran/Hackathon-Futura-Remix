/**
 * Server-side product analytics (PostHog).
 *
 * Privacy rules enforced here:
 *   - events and properties come only from analyticsSchema.ts (a strict
 *     whitelist); job ads, extracted spans and free text cannot pass through
 *   - events are anonymous: distinct_id is the browser's random UUID (validated)
 *     or "unknown"; no person profiles, no geo-IP
 *   - requests with a valid x-eval-token and requests with Do Not Track are
 *     never tracked
 *   - with no NEXT_PUBLIC_POSTHOG_KEY this is a silent no-op
 *   - nothing here can throw or delay a response: sending is scheduled with
 *     `after()` so the runtime flushes it after the response
 */

import { after } from "next/server";
import { PostHog } from "posthog-node";

import {
  ANON_ID_HEADER,
  isEventOnSide,
  isValidAnonId,
  sanitizeProperties,
  type ServerEvent,
} from "./analyticsSchema";
import { isEvalBypass } from "./geminiGuard";
import { evaluateJob } from "./rules";

import type { ExtractedJobAd, VisaProfile } from "../types/job";

const DEFAULT_HOST = "https://us.i.posthog.com";

let cached: { fingerprint: string; client: PostHog } | undefined;

function getClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;

  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_HOST;
  const fingerprint = `${key}|${host}`;

  if (cached?.fingerprint === fingerprint) return cached.client;

  try {
    const client = new PostHog(key, {
      host,
      flushAt: 1,
      flushInterval: 0,
      disableGeoip: true,
    });

    cached = { fingerprint, client };
    return client;
  } catch {
    return null;
  }
}

/** The browser's anonymous id from x-anon-id, or "unknown" if absent or invalid. */
export function resolveDistinctId(request: Request): string {
  const value = request.headers.get(ANON_ID_HEADER);

  return isValidAnonId(value) ? value : "unknown";
}

/**
 * Records one event. Fire-and-forget: never throws, never awaited by callers.
 */
export function trackServer(
  request: Request,
  event: ServerEvent,
  props: Record<string, unknown> = {}
): void {
  try {
    if (!isEventOnSide(event, "server")) return;
    if (request.headers.get("dnt") === "1") return;
    if (isEvalBypass(request)) return;

    const client = getClient();
    if (!client) return;

    const sending = client
      .captureImmediate({
        distinctId: resolveDistinctId(request),
        event,
        properties: {
          ...sanitizeProperties(event, props),
          $process_person_profile: false,
          $geoip_disable: true,
        },
      })
      .catch(() => undefined);

    try {
      // Lets the platform finish the send after the response (waitUntil).
      after(() => sending);
    } catch {
      // Outside a request scope: the send is already running.
    }
  } catch {
    // Analytics must never affect a request.
  }
}

/**
 * Verdict + rule + visa subclass for the analyse_job event, computed from the
 * extraction and the (structured) profile the client sent. Observation only:
 * the response to the client is unaffected. Returns {} if the profile is
 * missing or malformed.
 */
export function describeVerdict(
  extraction: ExtractedJobAd,
  rawProfile: unknown
): { verdict?: string; ruleId?: string; visaSubclass?: string } {
  try {
    const candidate = rawProfile as Partial<VisaProfile> | null | undefined;

    if (candidate?.subclass !== "500" && candidate?.subclass !== "485") {
      return {};
    }

    const profile: VisaProfile = {
      subclass: candidate.subclass,
      duringStudyTerm: candidate.duringStudyTerm === true,
      monthsRemaining:
        typeof candidate.monthsRemaining === "number" &&
        Number.isFinite(candidate.monthsRemaining)
          ? candidate.monthsRemaining
          : undefined,
    };

    const verdict = evaluateJob(extraction, profile);

    return {
      verdict: verdict.status,
      ruleId: verdict.ruleId,
      visaSubclass: profile.subclass,
    };
  } catch {
    return {};
  }
}
