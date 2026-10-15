import { describe, expect, it } from "vitest";

import {
  DESCRIPTION_YEARS_MARGIN,
  LEVEL_THRESHOLDS,
  isAboveLevel,
  isEntryLevelProfile,
} from "../jobLevel";
import { requestedYearsFromText } from "../jobRecommendation";

describe("isAboveLevel: 0-1 years", () => {
  const excluded = [
    "Senior Software Engineer",
    "Sr. Developer",
    "Sr Developer",
    "Engineering Manager",
    "Product Manager",
    "General Manager",
    "Lead Developer",
    "Team Lead",
    "Principal Consultant",
    "Management Consultant",
    "Consultant",
    "Head of Data",
    "Director of Engineering",
    "Chief Technology Officer",
    "VP Engineering",
    "Vice President, Risk",
    "Staff Software Engineer",
    "Solutions Architect",
    "Partner, Tax",
    "Managing Consultant",
    "Associate Director",
    "Software Engineer (Senior)",
    "SENIOR DATA ANALYST",
  ];

  const kept = [
    "Graduate Software Engineer",
    "Junior Consultant",
    "Graduate Consultant",
    "Associate Consultant",
    "Consulting Analyst",
    "Associate Data Analyst",
    "Management Graduate Program",
    "Graduate Manager Trainee",
    "Associate Product Manager",
    "Software Engineer",
    "Data Analyst",
    "Software Engineering Intern",
    "Entry Level Developer",
    "Graduate Architect",
    "Junior Architect",
    // whole words only
    "Team Leader",
    "Leadership Graduate Program",
    "Lead Generation Specialist",
    "Retail Staff Member",
    "Staff Nurse",
    "Architectural Assistant",
    "Seniors Support Worker",
    "Management Accountant Graduate",
    "Head Chef",
    "Cadet Engineer",
    "Business Development Representative",
  ];

  it.each(excluded)("excludes %j", (title) => {
    expect(isAboveLevel(title, undefined, 0)).toBe(true);
    expect(isAboveLevel(title, "", 1)).toBe(true);
  });

  it.each(kept)("keeps %j", (title) => {
    expect(isAboveLevel(title, undefined, 0)).toBe(false);
    expect(isAboveLevel(title, undefined, 1)).toBe(false);
  });

  it("treats fractional experience under 2 as entry level", () => {
    expect(isEntryLevelProfile(1.5)).toBe(true);
    expect(isAboveLevel("Management Consultant", undefined, 1.5)).toBe(true);
  });
});

describe("isAboveLevel: 2-3 years", () => {
  it.each([
    "Senior Software Engineer",
    "Principal Engineer",
    "Lead Developer",
    "Head of Data",
    "Director of Engineering",
    "Chief Data Officer",
    "VP Engineering",
    "Engineering Manager",
    "Project Manager",
  ])("excludes %j", (title) => {
    expect(isAboveLevel(title, undefined, 2)).toBe(true);
    expect(isAboveLevel(title, undefined, 3)).toBe(true);
  });

  it.each([
    "Management Consultant", // consultant is allowed from 2 years
    "Consultant",
    "Solutions Architect",
    "Staff Software Engineer",
    "Partner Success Specialist",
    "Software Engineer",
    "Graduate Manager Trainee",
    "Associate Product Manager",
  ])("keeps %j", (title) => {
    expect(isAboveLevel(title, undefined, 2)).toBe(false);
    expect(isAboveLevel(title, undefined, 3)).toBe(false);
  });
});

describe("isAboveLevel: 4+ years", () => {
  it.each(["Director of Engineering", "Chief Technology Officer", "VP Engineering"])(
    "excludes %j",
    (title) => {
      expect(isAboveLevel(title, undefined, 4)).toBe(true);
      expect(isAboveLevel(title, undefined, 10)).toBe(true);
    }
  );

  it.each([
    "Senior Software Engineer",
    "Engineering Manager",
    "Principal Consultant",
    "Lead Developer",
    "Head of Data",
  ])("keeps %j", (title) => {
    expect(isAboveLevel(title, undefined, 4)).toBe(false);
    expect(isAboveLevel(title, undefined, 10)).toBe(false);
  });

  it("keeps the thresholds in one place", () => {
    expect(LEVEL_THRESHOLDS).toEqual({ midFrom: 2, experiencedFrom: 4 });
  });
});

describe("isAboveLevel: description years", () => {
  it("excludes a description asking for 5+ years at 0 years", () => {
    expect(isAboveLevel("Data Analyst", "You have 5+ years of experience.", 0)).toBe(true);
  });

  it("keeps it for a profile with 4 years", () => {
    expect(isAboveLevel("Data Analyst", "You have 5+ years of experience.", 4)).toBe(false);
  });

  it("uses the margin boundary: N must be at least profile + 3", () => {
    expect(DESCRIPTION_YEARS_MARGIN).toBe(3);
    expect(isAboveLevel("Data Analyst", "2 years experience", 0)).toBe(false);
    expect(isAboveLevel("Data Analyst", "3 years experience", 0)).toBe(true);
    expect(isAboveLevel("Data Analyst", "5 years experience", 2)).toBe(true);
    expect(isAboveLevel("Data Analyst", "4 years experience", 2)).toBe(false);
  });

  it("understands the common phrasings", () => {
    for (const text of [
      "Minimum 5 years experience required",
      "at least 6 years' experience",
      "7+ years of relevant experience",
      "5 to 8 years professional experience",
    ]) {
      expect(isAboveLevel("Data Analyst", text, 0)).toBe(true);
    }
  });

  it("keeps a job that states no years, or an empty description", () => {
    expect(isAboveLevel("Data Analyst", "Great team, great culture.", 0)).toBe(false);
    expect(isAboveLevel("Data Analyst", "", 0)).toBe(false);
    expect(isAboveLevel("Data Analyst", undefined, 0)).toBe(false);
  });

  it("does not treat unrelated numbers as years of experience", () => {
    expect(isAboveLevel("Data Analyst", "A 10 year old company with 500 staff and 12 offices.", 0)).toBe(false);
  });

  it("shares its parsing with the ranking code", () => {
    expect(requestedYearsFromText("3 years experience and 8+ years of experience")).toBe(8);
    expect(requestedYearsFromText("no numbers here")).toBeUndefined();
  });
});

describe("isAboveLevel: when unsure, keep", () => {
  it("keeps the job for an unusable profile value", () => {
    expect(isAboveLevel("Senior Manager", "10 years experience", NaN)).toBe(false);
    expect(isAboveLevel("Senior Manager", "10 years experience", -1)).toBe(false);
  });
});
