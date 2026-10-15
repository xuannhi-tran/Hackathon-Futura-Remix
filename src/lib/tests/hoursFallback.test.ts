/**
 * fallbackHoursPerWeek: a conservative regex layer for hoursPerWeek, which the
 * model otherwise fills alone. Tests cover the matcher, the route wiring (stub
 * model, no network) and a sweep over every corpus / hold-out ad.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({ response: {} as Record<string, unknown> }));

vi.mock("@google/genai", () => ({
  Type: { OBJECT: "OBJECT", STRING: "STRING", ARRAY: "ARRAY" },
  GoogleGenAI: class {
    models = {
      generateContent: async () => ({ text: JSON.stringify(stub.response) }),
    };
  },
}));

import { POST } from "../../app/api/extract/route";
import { fallbackHoursPerWeek } from "../extractionFallbacks";
import { writeCachedExtraction } from "../geminiGuard";
import { setRedisForTesting } from "../redisClient";
import { evaluateJob } from "../rules";
import { FakeRedis } from "./fakeRedis";

import type { ExtractedJobAd, VisaProfile } from "../../types/job";

const student500: VisaProfile = {
  subclass: "500",
  duringStudyTerm: true,
  monthsRemaining: 18,
};

const ROOT = path.join(process.cwd(), "job_description_txt");

function readAd(dir: string, file: string) {
  return readFileSync(path.join(ROOT, dir, file), "utf8");
}

async function extract(adText: string): Promise<ExtractedJobAd> {
  process.env.GEMINI_API_KEY = "test-key";

  const response = await POST(
    new Request("http://localhost/api/extract", {
      method: "POST",
      body: JSON.stringify({ adText }),
    })
  );

  expect(response.status).toBe(200);

  return ((await response.json()) as { extraction: ExtractedJobAd }).extraction;
}

beforeEach(() => {
  stub.response = {};
  setRedisForTesting(null);
});

afterEach(() => {
  setRedisForTesting(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// The matcher
// ─────────────────────────────────────────────────────────────────────────────

describe("fallbackHoursPerWeek: matches clear weekly commitments", () => {
  const positives: Array<[string, string, string]> = [
    ["minimum N hours per week", "Availability for minimum 30 hours per week on a roster.", "minimum 30 hours per week"],
    ["minimum of N", "A minimum of 24 hours per week is required.", "minimum of 24 hours per week"],
    ["at least N hours", "You will work at least 20 hours a week.", "at least 20 hours a week"],
    ["N+ hours per week", "Commitment: 15+ hours per week.", "15+ hours per week"],
    ["N hours per week", "Full time, 38 hours per week.", "38 hours per week"],
    ["N hrs/week", "Hours: 40 hrs/week", "40 hrs/week"],
    ["N hours a week", "Roughly 25 hours a week.", "25 hours a week"],
    ["N hours weekly", "You will work 30 hours weekly.", "30 hours weekly"],
    ["N-M hours per week", "Between 20-30 hours per week.", "20-30 hours per week"],
    ["decimal hours", "Part-time (0.8 FTE — 30.4 hours per week)", "30.4 hours per week"],
  ];

  it.each(positives)("%s", (_name, ad, expected) => {
    const result = fallbackHoursPerWeek(ad);

    expect(result?.text).toBe(expected);
    // No span, no claim: the evidence is an exact slice of the ad.
    expect(ad.slice(result!.start, result!.end)).toBe(result!.text);
  });

  it("repeating the same figure is still clear", () => {
    const ad = "Part-time (0.8 FTE — 30.4 hours per week).\nPosition: 30.4 hours per week.";

    expect(fallbackHoursPerWeek(ad)?.text).toBe("30.4 hours per week");
    expect(fallbackHoursPerWeek(ad)?.start).toBe(ad.indexOf("30.4"));
  });
});

describe("fallbackHoursPerWeek: returns nothing when in doubt", () => {
  const negatives: Array<[string, string]> = [
    ["up to N hours", "Work up to 20 hours per week."],
    ["Up to Nhrs (header style)", "Hours Per Week: Up to 38hrs per week"],
    ["maximum N hours", "Maximum 20 hours per week during semester."],
    ["maximum of N", "A maximum of 24 hours a week."],
    ["no more than N hours", "You will work no more than 20 hours per week."],
    ["not exceed N hours", "Hours will not exceed 20 hours per week."],
    ["at most N hours", "At most 16 hours per week."],
    ["less than N hours", "Less than 20 hours per week."],
    ["training hours", "You will complete 4 hours per week of training."],
    ["study hours", "Allow 10 hours per week for study."],
    ["leave", "You accrue leave for every 38 hours per week worked."],
    ["overtime", "Overtime of 5 hours per week may be required."],
    ["pay context ($)", "Earn $35 for 38 hours per week."],
    ["salary context", "Salary reflects 38 hours per week."],
    ["paid context", "Paid for 20 hours per week."],
    ["hourly rate", "Rate of 35 per hour."],
    ["per fortnight", "Rostered for 76 hours per fortnight."],
    ["per month", "Around 120 hours per month."],
    ["no period", "Allow 30 hours of preparation."],
    ["company-size number", "We are a team of 30 people across 12 offices."],
    ["years / other numbers", "3 years experience, 2 roles, 40 staff."],
    ["three-digit hours", "Over 100 hours per week of support."],
    ["different figures", "Roster is 38 hours per week, but this stream is 20 hours per week."],
    ["a ceiling disagreeing with a figure", "Up to 38 hours per week. Comparison: 24 hrs/wk."],
  ];

  it.each(negatives)("%s", (_name, ad) => {
    expect(fallbackHoursPerWeek(ad)).toBeUndefined();
  });

  it("returns nothing for empty text", () => {
    expect(fallbackHoursPerWeek("")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ad 26 and the verdict
// ─────────────────────────────────────────────────────────────────────────────

describe("dev-set ad 26 (Healthscope)", () => {
  const ad26 = readAd("dev_set", "26_healthscope_graduate_enrolled_nurse.txt");

  it("yields a span containing '30 hours per week' that rules.ts reads as 30", () => {
    const result = fallbackHoursPerWeek(ad26)!;

    expect(result.text).toBe("minimum 30 hours per week");
    expect(result.text).toContain("30 hours per week");
    expect(ad26.slice(result.start, result.end)).toBe(result.text);

    // rules.ts reads the first number in the span: 30 weekly = 60 per fortnight.
    const verdict = evaluateJob({ hoursPerWeek: result }, student500);
    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_STUDENT_500_STUDY_TERM_HOURS");
  });

  it("is SKIP for a 500 study-term profile when the model leaves hoursPerWeek empty", async () => {
    // What the model returned in the failing run: a visa-plan span, no hours.
    stub.response = {
      visaPlanRequirement: { value: "visa plan", text: "proposed next visa plans" },
    };

    const extraction = await extract(ad26);
    const verdict = evaluateJob(extraction, student500);

    expect(extraction.hoursPerWeek?.text).toBe("minimum 30 hours per week");
    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_STUDENT_500_STUDY_TERM_HOURS");
  });

  it("is not SKIP for a 485 profile (the hours rule is for 500 in study term)", async () => {
    stub.response = {
      visaPlanRequirement: { value: "visa plan", text: "proposed next visa plans" },
    };

    const extraction = await extract(ad26);

    expect(
      evaluateJob(extraction, { subclass: "485", duringStudyTerm: false, monthsRemaining: 18 }).status
    ).toBe("TAILOR");
  });

  it("cached entries benefit without a cache-version bump", async () => {
    const redis = new FakeRedis();
    setRedisForTesting(redis);

    // An entry cached earlier, with the empty hoursPerWeek the model produced.
    await writeCachedExtraction(ad26, {
      visaPlanRequirement: { value: "visa plan", text: "proposed next visa plans" },
    });

    const response = await POST(
      new Request("http://localhost/api/extract", {
        method: "POST",
        body: JSON.stringify({ adText: ad26 }),
      })
    );
    const { extraction } = (await response.json()) as { extraction: ExtractedJobAd };

    expect(extraction.hoursPerWeek?.text).toBe("minimum 30 hours per week");
    expect(evaluateJob(extraction, student500).ruleId).toBe(
      "T1_STUDENT_500_STUDY_TERM_HOURS"
    );
  });
});

describe("route wiring", () => {
  it("never overrides a model-provided hoursPerWeek", async () => {
    const ad = "Part-time role. Roster: 10 hours per week on Saturdays. Minimum 40 hours per week otherwise.";

    stub.response = { hoursPerWeek: { value: "10", text: "10 hours per week" } };

    const extraction = await extract(ad);

    expect(extraction.hoursPerWeek?.text).toBe("10 hours per week");
    expect(extraction.hoursPerWeek?.start).toBe(ad.indexOf("10 hours per week"));
  });

  it("a part-time 'up to 20 hours' ad is unaffected", async () => {
    const ad = "Part-time position. Work up to 20 hours per week, flexible around study.";

    const extraction = await extract(ad);

    expect(extraction.hoursPerWeek).toBeUndefined();
    expect(evaluateJob(extraction, student500).status).toBe("APPLY");
  });

  it("a model span that is not in the ad is discarded and the fallback may fill it", async () => {
    stub.response = { hoursPerWeek: { value: "38", text: "38 hours invented" } };

    const extraction = await extract("Hours: 38 hours per week");

    expect(extraction.hoursPerWeek?.text).toBe("38 hours per week");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sweep over every corpus and hold-out ad
// ─────────────────────────────────────────────────────────────────────────────

describe("sweep over all corpus and hold-out ads", () => {
  const ads = ["dev_set", "hold_out"].flatMap((dir) =>
    readdirSync(path.join(ROOT, dir))
      .filter((file) => file.endsWith(".txt"))
      .sort()
      .map((file) => ({ id: `${dir}/${file}`, text: readAd(dir, file) }))
  );

  const fired = ads
    .map((ad) => ({ ...ad, result: fallbackHoursPerWeek(ad.text) }))
    .filter((ad) => ad.result);

  it("covers every ad file", () => {
    expect(ads).toHaveLength(51); // 35 dev set + 16 hold-out
  });

  it("fires only on the reviewed ads, each with an exact span", () => {
    expect(fired.map((ad) => [ad.id, ad.result!.text])).toEqual([
      ["dev_set/26_healthscope_graduate_enrolled_nurse.txt", "minimum 30 hours per week"],
      ["dev_set/28_cabrini_health_graduate_rn.txt", "30.4 hours per week"],
    ]);

    for (const ad of fired) {
      expect(ad.text.slice(ad.result!.start, ad.result!.end)).toBe(ad.result!.text);
    }
  });

  it("does not fire on the annotated ads whose notes quote other hours", () => {
    const byId = (id: string) => ads.find((ad) => ad.id === id)!;

    // Header says "Up to 38hrs"; the author's notes mention 24hrs/wk.
    expect(fallbackHoursPerWeek(byId("dev_set/11_hne_registered_nurse_armidale.txt").text)).toBeUndefined();
    // Header says 36 hours per week; the author's notes mention 24 hrs/wk.
    expect(fallbackHoursPerWeek(byId("dev_set/07_gold_coast_data_analyst.txt").text)).toBeUndefined();
  });
});
