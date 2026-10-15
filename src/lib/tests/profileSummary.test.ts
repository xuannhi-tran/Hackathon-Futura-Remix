import { describe, expect, it } from "vitest";

import { buildProfileSummary } from "../profileSummary";

describe("buildProfileSummary", () => {
  it("builds the documented example", () => {
    expect(
      buildProfileSummary({
        visaSubclass: "500",
        duringStudyTerm: true,
        yearsExperience: 0,
        preferredLocation: "NSW",
      })
    ).toBe("Assuming: Student visa (500), in study term, 0 yrs experience, NSW.");
  });

  it("describes a 500 outside study term", () => {
    expect(
      buildProfileSummary({
        visaSubclass: "500",
        duringStudyTerm: false,
        yearsExperience: 3,
        preferredLocation: "VIC",
      })
    ).toBe("Assuming: Student visa (500), outside study term, 3 yrs experience, VIC.");
  });

  it("omits study-term wording for a 485", () => {
    expect(
      buildProfileSummary({
        visaSubclass: "485",
        duringStudyTerm: false,
        yearsExperience: 2,
        preferredLocation: "QLD",
      })
    ).toBe("Assuming: Graduate visa (485), 2 yrs experience, QLD.");
  });

  it("uses the singular for one year", () => {
    expect(
      buildProfileSummary({ visaSubclass: "485", duringStudyTerm: false, yearsExperience: 1, preferredLocation: "WA" })
    ).toContain("1 yr experience");
  });

  it("handles missing values without printing undefined or NaN", () => {
    const cases = [
      { visaSubclass: "500" as const, duringStudyTerm: true },
      { visaSubclass: "500" as const, duringStudyTerm: true, yearsExperience: NaN, preferredLocation: "   " },
      { visaSubclass: "485" as const, duringStudyTerm: false, yearsExperience: -1, preferredLocation: "" },
    ];

    for (const input of cases) {
      const text = buildProfileSummary(input);

      expect(text).not.toMatch(/undefined|NaN|null/);
      expect(text).toMatch(/^Assuming: .+, any location\.$/);
      expect(text).not.toContain("experience");
    }
  });

  it("trims the location", () => {
    expect(
      buildProfileSummary({ visaSubclass: "485", duringStudyTerm: false, yearsExperience: 0, preferredLocation: "  SA  " })
    ).toBe("Assuming: Graduate visa (485), 0 yrs experience, SA.");
  });
});
