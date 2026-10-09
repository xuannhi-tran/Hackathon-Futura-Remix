/**
 * Browser-side product analytics (PostHog), explicit events only.
 *
 * Silent no-op unless NEXT_PUBLIC_POSTHOG_KEY is set and the browser has not
 * sent Do Not Track. The anonymous id is a random UUID kept in localStorage
 * (in memory if storage is unavailable). Nothing here can throw or block the UI.
 */

import {
  ANON_ID_HEADER,
  isEventOnSide,
  isValidAnonId,
  sanitizeProperties,
  type ClientEvent,
} from "./analyticsSchema";

const STORAGE_KEY = "jobcompass_anon_id";
const SESSION_KEY = "jobcompass_app_opened";
const DEFAULT_HOST = "https://us.i.posthog.com";

type PostHogLike = {
  init: (key: string, options: Record<string, unknown>) => unknown;
  capture: (event: string, properties?: Record<string, unknown>) => unknown;
};

let memoryId: string | undefined;
let loading: Promise<PostHogLike | null> | undefined;

function doNotTrack(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      (navigator.doNotTrack === "1" ||
        (navigator as { globalPrivacyControl?: boolean })
          .globalPrivacyControl === true)
    );
  } catch {
    return false;
  }
}

export function isAnalyticsEnabled(): boolean {
  // Literal access so Next.js can inline the build-time value.
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY) && !doNotTrack();
}

/** Anonymous per-browser id: random UUID, localStorage with in-memory fallback. */
export function getAnonId(): string {
  if (memoryId) return memoryId;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValidAnonId(stored)) {
      memoryId = stored;
      return stored;
    }
  } catch {
    // Storage unavailable: use the in-memory id below.
  }

  const fresh = crypto.randomUUID();
  memoryId = fresh;

  try {
    localStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    // Keep the in-memory id.
  }

  return fresh;
}

/** Header that lets the API routes attribute server events to this browser. */
export function analyticsHeaders(): Record<string, string> {
  try {
    return isAnalyticsEnabled() ? { [ANON_ID_HEADER]: getAnonId() } : {};
  } catch {
    return {};
  }
}

function loadPostHog(): Promise<PostHogLike | null> {
  if (loading) return loading;

  loading = (async () => {
    try {
      if (!isAnalyticsEnabled()) return null;

      const { default: posthog } = await import("posthog-js");

      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_HOST,
        autocapture: false,
        capture_pageview: true,
        capture_pageleave: false,
        disable_session_recording: true,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        // false overrides the project's remote config: no $web_vitals or
        // network-timing events, so only $pageview and our own events are sent.
        capture_performance: false,
        capture_exceptions: false,
        disable_surveys: true,
        persistence: "localStorage",
        respect_dnt: true,
        person_profiles: "identified_only",
        // Same id the API routes receive in x-anon-id.
        bootstrap: { distinctID: getAnonId() },
      });

      return posthog as unknown as PostHogLike;
    } catch {
      return null;
    }
  })();

  return loading;
}

/** Starts PostHog (if enabled). Safe to call repeatedly. */
export function initAnalytics(): void {
  try {
    void loadPostHog();
  } catch {
    // Never affects the UI.
  }
}

/** Fire-and-forget event with whitelisted properties only. */
export function trackClient(
  event: ClientEvent,
  props: Record<string, unknown> = {}
): void {
  try {
    if (!isEventOnSide(event, "client") || !isAnalyticsEnabled()) return;

    const properties = sanitizeProperties(event, props);

    void loadPostHog()
      .then((posthog) => posthog?.capture(event, properties))
      .catch(() => undefined);
  } catch {
    // Never affects the UI.
  }
}

/** app_opened, once per browser session. */
export function trackAppOpenedOnce(): void {
  try {
    if (!isAnalyticsEnabled()) return;

    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // No sessionStorage: fall through and send (once per page load).
    }

    trackClient("app_opened");
  } catch {
    // Never affects the UI.
  }
}
