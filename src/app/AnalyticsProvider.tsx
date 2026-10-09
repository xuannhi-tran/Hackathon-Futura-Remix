"use client";

import { useEffect } from "react";

import { initAnalytics, trackAppOpenedOnce } from "../lib/analyticsClient";

/** Starts anonymous analytics once. Renders nothing; a no-op without a PostHog key. */
export default function AnalyticsProvider() {
  useEffect(() => {
    initAnalytics();
    trackAppOpenedOnce();
  }, []);

  return null;
}
