import { describe, expect, it } from "vitest";

import {
  FULL_TIME_COVERED_BY_VERDICT,
  MAX_HEADS_UPS,
  evaluateHeadsUps,
  type HeadsUpProfile,
} from "../headsUp";
import { demoFixtures } from "../demoFixtures";
import { evaluateJob } from "../rules";

import type { EvidenceField, ExtractedJobAd, VisaProfile } from "../../types/job";

function field(text: string, value = text): EvidenceField {
  return { value, text, start: 10, end: 10 + text.length };
}

const STUDENT_500: HeadsUpProfile = {
  subclass: "500",
  duringStudyTerm: true,
  monthsRemaining: 18,
  yearsExperience: 0,
};

const GRADUATE_485: HeadsUpProfile = {
  subclass: "485",
  duringStudyTerm: false,
  monthsRemaining: 18,
  yearsExperience: 0,
};

function ids(job: ExtractedJobAd, profile: HeadsUpProfile) {
  return evaluateHeadsUps(job, profile).map((h) => h.id);
}

describe("EXPERIENCE_GAP", () => {
  const ask = (text: string): ExtractedJobAd => ({
    yearsExperience: field(text),
  });

  it("does not fire when the gap is 1 year", () => {
    expect(ids(ask("3+ years of experience"), { ...STUDENT_500, yearsExperience: 2 })).toEqual([]);
  });

  it("fires at a gap of exactly 2 years", () => {
    expect(ids(ask("3+ years of experience"), { ...STUDENT_500, yearsExperience: 1 })).toEqual([
      "EXPERIENCE_GAP",
    ]);
  });

  it("fires for a larger gap, with the exact message and the ad's evidence", () => {
    const [headsUp] = evaluateHeadsUps(ask("5+ years of experience"), STUDENT_500);

    expect(headsUp).toEqual({
      id: "EXPERIENCE_GAP",
      severity: "warn",
      message:
        "This ad asks for 5+ years of experience; your profile says 0. Consider whether it is realistic before applying.",
      evidence: { text: "5+ years of experience", start: 10, end: 32 },
    });
  });

  it("does not fire when the profile meets or exceeds the ask", () => {
    expect(ids(ask("3 years"), { ...STUDENT_500, yearsExperience: 3 })).toEqual([]);
    expect(ids(ask("3 years"), { ...STUDENT_500, yearsExperience: 10 })).toEqual([]);
  });

  it("uses the lower bound of a range, matching the Fit section's parsing", () => {
    // "3-5 years": the first number (3) is what evaluateFitSignals compares.
    expect(ids(ask("3-5 years"), { ...STUDENT_500, yearsExperience: 1 })).toEqual([
      "EXPERIENCE_GAP",
    ]);
    expect(ids(ask("3-5 years"), { ...STUDENT_500, yearsExperience: 2 })).toEqual([]);
  });

  it("does not fire without an experience ask, or with an unusable profile value", () => {
    expect(ids({}, STUDENT_500)).toEqual([]);
    expect(ids(ask("some experience"), STUDENT_500)).toEqual([]);
    expect(ids(ask("5+ years"), { ...STUDENT_500, yearsExperience: NaN })).toEqual([]);
  });

  it("applies to a 485 profile too", () => {
    expect(ids(ask("5+ years"), GRADUATE_485)).toEqual(["EXPERIENCE_GAP"]);
  });
});

describe("FULL_TIME_STUDENT_500", () => {
  const employment = (text: string): ExtractedJobAd => ({
    employmentType: field(text),
  });

  it("fires for a full-time ad, subclass 500, in study term", () => {
    const [headsUp] = evaluateHeadsUps(employment("Full-time"), STUDENT_500);

    expect(headsUp).toEqual({
      id: "FULL_TIME_STUDENT_500",
      severity: "warn",
      message:
        "Full-time hours may exceed the 48-hours-per-fortnight limit that applies to subclass 500 during study term. Check your actual visa conditions.",
      evidence: { text: "Full-time", start: 10, end: 19 },
    });
  });

  it.each(["full time", "Full Time", "FULLTIME", "Fixed term, full-time"])(
    "recognises %j as full-time",
    (text) => {
      expect(ids(employment(text), STUDENT_500)).toEqual(["FULL_TIME_STUDENT_500"]);
    }
  );

  it.each(["Part-time", "part time", "Permanent part-time", "Full-time or part-time"])(
    "does not fire for %j",
    (text) => {
      expect(ids(employment(text), STUDENT_500)).toEqual([]);
    }
  );

  it("does not fire for casual or missing employment type", () => {
    expect(ids(employment("Casual"), STUDENT_500)).toEqual([]);
    expect(ids({}, STUDENT_500)).toEqual([]);
  });

  it("does not fire for a 485 profile", () => {
    expect(ids(employment("Full-time"), GRADUATE_485)).toEqual([]);
  });

  it("does not fire for subclass 500 outside study term", () => {
    expect(ids(employment("Full-time"), { ...STUDENT_500, duringStudyTerm: false })).toEqual([]);
  });
});

describe("suppression when the verdict already says it", () => {
  const FULL_TIME = field("Full-time");

  const covered: Array<[string, ExtractedJobAd, HeadsUpProfile]> = [
    [
      "T1_STUDENT_500_STUDY_TERM_HOURS",
      { employmentType: FULL_TIME, hoursPerWeek: field("38 hours per week") },
      STUDENT_500,
    ],
    [
      "T1_FULL_WORK_RIGHTS_STUDENT_500",
      {
        employmentType: FULL_TIME,
        workRightsRequirement: field("Full working rights are required"),
      },
      STUDENT_500,
    ],
    [
      "T2_PERMANENT_FULL_TIME",
      { employmentType: field("Permanent full-time") },
      STUDENT_500,
    ],
    [
      "T2_GRADUATE_ROLE_TIMING_REVIEW",
      {
        title: "Graduate Software Engineer",
        employmentType: FULL_TIME,
        hoursPerWeek: field("38 hours per week"),
      },
      { ...STUDENT_500, monthsRemaining: 3 },
    ],
  ];

  it("covers exactly the four documented rule ids", () => {
    expect([...FULL_TIME_COVERED_BY_VERDICT].sort()).toEqual(
      [
        "T1_FULL_WORK_RIGHTS_STUDENT_500",
        "T1_STUDENT_500_STUDY_TERM_HOURS",
        "T2_GRADUATE_ROLE_TIMING_REVIEW",
        "T2_PERMANENT_FULL_TIME",
      ].sort()
    );
  });

  it.each(covered)("%s: the verdict gives that reason and no full-time heads-up is added", (ruleId, job, profile) => {
    expect(evaluateJob(job, profile).ruleId).toBe(ruleId);
    expect(ids(job, profile)).not.toContain("FULL_TIME_STUDENT_500");
  });

  it.each(covered)("%s: the same ad does produce the heads-up if the verdict were a different rule", (_ruleId, job, profile) => {
    // Sanity check that suppression, not a failed match, is what hides it:
    // drop the pieces that drive the covered rule and the heads-up appears.
    const plain: ExtractedJobAd = { employmentType: job.employmentType };
    const plainProfile = { ...profile, monthsRemaining: 18 };

    if (plain.employmentType?.text === "Permanent full-time") return;

    expect(evaluateJob(plain, plainProfile).status).toBe("APPLY");
    expect(ids(plain, plainProfile)).toEqual(["FULL_TIME_STUDENT_500"]);
  });

  it("still fires beside an unrelated TAILOR verdict", () => {
    const job: ExtractedJobAd = {
      employmentType: FULL_TIME,
      sponsorship: field("No visa sponsorship"),
    };

    expect(evaluateJob(job, STUDENT_500).ruleId).toBe("T2_NO_SPONSORSHIP");
    expect(ids(job, STUDENT_500)).toEqual(["FULL_TIME_STUDENT_500"]);
  });

  it("still fires beside a SKIP for a different reason", () => {
    const job: ExtractedJobAd = {
      employmentType: FULL_TIME,
      citizenshipRequirement: field("Australian citizens only"),
    };

    expect(evaluateJob(job, STUDENT_500).ruleId).toBe("T1_CITIZENSHIP");
    expect(ids(job, STUDENT_500)).toEqual(["FULL_TIME_STUDENT_500"]);
  });

  it("an experience heads-up is never suppressed by a covered verdict", () => {
    const [, job, profile] = covered[2];

    expect(ids({ ...job, yearsExperience: field("5+ years") }, profile)).toEqual([
      "EXPERIENCE_GAP",
    ]);
  });
});

describe("ordering and cap", () => {
  it("returns both warnings together, at most MAX_HEADS_UPS", () => {
    const job: ExtractedJobAd = {
      yearsExperience: field("5+ years"),
      employmentType: field("Full-time"),
    };

    const result = evaluateHeadsUps(job, STUDENT_500);

    expect(result.map((h) => h.id)).toEqual(["EXPERIENCE_GAP", "FULL_TIME_STUDENT_500"]);
    expect(result.length).toBeLessThanOrEqual(MAX_HEADS_UPS);
    expect(MAX_HEADS_UPS).toBe(3);
  });
});

describe("the verdict never changes", () => {
  const profiles: VisaProfile[] = [
    { subclass: "500", duringStudyTerm: true, monthsRemaining: 18 },
    { subclass: "500", duringStudyTerm: false, monthsRemaining: 3 },
    { subclass: "485", duringStudyTerm: false, monthsRemaining: 12 },
  ];

  const jobs: ExtractedJobAd[] = [
    ...demoFixtures.map((fixture) => fixture.extraction),
    { employmentType: field("Full-time"), yearsExperience: field("8+ years") },
    { employmentType: field("Permanent full-time"), yearsExperience: field("4 years") },
    { citizenshipRequirement: field("Australian citizens only"), employmentType: field("Full-time") },
    { hoursPerWeek: field("40 hours per week"), employmentType: field("Full-time") },
    {},
  ];

  it("evaluateJob returns an identical verdict with and without heads-ups, and the job is untouched", () => {
    for (const job of jobs) {
      for (const visa of profiles) {
        const before = evaluateJob(job, visa);
        const snapshot = JSON.stringify(job);

        evaluateHeadsUps(job, { ...visa, yearsExperience: 0 });

        expect(evaluateJob(job, visa)).toEqual(before);
        expect(JSON.stringify(job)).toBe(snapshot);
      }
    }
  });

  it("has at least a handful of fixtures to compare", () => {
    expect(jobs.length).toBeGreaterThanOrEqual(5);
  });
});
