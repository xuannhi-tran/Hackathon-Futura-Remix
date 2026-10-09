/**
 * Client analytics: no-op without a key, anonymous id handling, whitelist,
 * Do Not Track. posthog-js is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ph = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: ph }));

import {
  analyticsHeaders,
  getAnonId,
  trackAppOpenedOnce,
  trackClient,
} from "../analyticsClient";
import { isValidAnonId } from "../analyticsSchema";

const AD_TEXT = "You must be an Australian citizen. Email jane@acme.example.";

beforeEach(() => {
  ph.init.mockReset();
  ph.capture.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("without a key", () => {
  it("sends no header, initialises nothing, never throws", async () => {
    expect(analyticsHeaders()).toEqual({});
    expect(() => trackClient("job_saved", { verdict: "APPLY" })).not.toThrow();
    expect(() => trackAppOpenedOnce()).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });
});

describe("with a key", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
  });

  it("generates a stable anonymous UUID even when localStorage is unavailable", () => {
    const first = getAnonId();

    expect(isValidAnonId(first)).toBe(true);
    expect(getAnonId()).toBe(first);
    expect(analyticsHeaders()).toEqual({ "x-anon-id": first });
  });

  it("initialises PostHog privately: no autocapture, recording, heatmaps; DNT respected", async () => {
    trackClient("job_removed", {});

    await vi.waitFor(() => expect(ph.init).toHaveBeenCalled());

    const [key, options] = ph.init.mock.calls[0];
    expect(key).toBe("phc_test_key");
    expect(options).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: false,
      disable_session_recording: true,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: false,
      persistence: "localStorage",
      respect_dnt: true,
    });
    expect(options.bootstrap.distinctID).toBe(getAnonId());
  });

  it("drops anything outside the whitelist, including ad text", async () => {
    trackClient("job_saved", {
      verdict: "TAILOR",
      adText: AD_TEXT,
      title: "Graduate Engineer",
    });
    trackClient("job_saved", { verdict: AD_TEXT });

    await vi.waitFor(() => expect(ph.capture).toHaveBeenCalledTimes(2));

    expect(ph.capture.mock.calls[0]).toEqual(["job_saved", { verdict: "TAILOR" }]);
    expect(ph.capture.mock.calls[1]).toEqual(["job_saved", {}]);
    expect(JSON.stringify(ph.capture.mock.calls)).not.toContain("jane@acme");
  });

  it("ignores unknown events", async () => {
    // @ts-expect-error deliberately not a valid event name
    trackClient("keystroke", { verdict: "APPLY" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it("does nothing when the browser sends Do Not Track", async () => {
    vi.stubGlobal("navigator", { doNotTrack: "1" });

    expect(analyticsHeaders()).toEqual({});
    trackClient("job_removed", {});

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it("swallows PostHog failures", async () => {
    ph.init.mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => trackClient("job_removed", {})).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("app_opened is sent once per session", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    });

    trackAppOpenedOnce();
    trackAppOpenedOnce();

    await vi.waitFor(() => expect(ph.capture).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ph.capture.mock.calls.filter(([name]) => name === "app_opened")).toHaveLength(1);
  });
});
