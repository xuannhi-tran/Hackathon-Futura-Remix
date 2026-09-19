import { describe, expect, it } from "vitest";
import { mockExtractJobAd } from "../mockExtraction";
import { evaluateJob } from "../rules";

describe("eligibility decoder", () => {
  it("returns SKIP when Australian citizenship is required", () => {
    const adText =
      "Applicants must be an Australian citizen and eligible for security clearance.";

    const extracted = mockExtractJobAd(adText);
    const verdict = evaluateJob(extracted);

    expect(extracted.citizenshipRequirement).toBeDefined();
    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_CITIZENSHIP");
    expect(verdict.reason).toBe("This role requires Australian citizenship.");
    expect(verdict.evidence?.text).toBe("Australian citizen");
  });

  it("returns SKIP when permanent residency is required", () => {
    const adText = "This role is open to permanent residents only.";

    const extracted = mockExtractJobAd(adText);
    const verdict = evaluateJob(extracted);

    expect(extracted.residencyRequirement).toBeDefined();
    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_PERMANENT_RESIDENCY");
    expect(verdict.reason).toBe(
      "This role requires Australian permanent residency."
    );
    expect(verdict.evidence?.text).toBe("permanent residents only");
  });

  it("returns SKIP when NV1 security clearance is required", () => {
    const adText =
      "Candidates must hold NV1 security clearance before commencing.";

    const extracted = mockExtractJobAd(adText);
    const verdict = evaluateJob(extracted);

    expect(extracted.securityClearance).toBeDefined();
    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_SECURITY_CLEARANCE");
    expect(verdict.reason).toBe("This role requires a security clearance.");
    expect(verdict.evidence?.text).toBe("NV1 security clearance");
  });

  it("returns SKIP when Baseline security clearance is required", () => {
    const adText =
      "Applicants must be eligible for Baseline security clearance.";

    const extracted = mockExtractJobAd(adText);
    const verdict = evaluateJob(extracted);

    expect(extracted.securityClearance).toBeDefined();
    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_SECURITY_CLEARANCE");
    expect(verdict.evidence?.text).toBe("Baseline security clearance");
  });

  it("returns APPLY when no hard eligibility blocker is found", () => {
    const adText =
      "We are looking for a junior software engineer with JavaScript experience.";

    const extracted = mockExtractJobAd(adText);
    const verdict = evaluateJob(extracted);

    expect(extracted.citizenshipRequirement).toBeUndefined();
    expect(extracted.residencyRequirement).toBeUndefined();
    expect(extracted.securityClearance).toBeUndefined();

    expect(verdict.status).toBe("APPLY");
    expect(verdict.ruleId).toBeUndefined();
    expect(verdict.reason).toBe("No eligibility blockers detected.");
  });

  it("extracts the correct evidence span for citizenship", () => {
    const adText =
      "Applicants must be an Australian citizen and eligible for security clearance.";

    const extracted = mockExtractJobAd(adText);
    const evidence = extracted.citizenshipRequirement;

    expect(evidence).toBeDefined();

    if (!evidence) return;

    const highlightedText = adText.slice(evidence.start, evidence.end);

    expect(highlightedText).toBe("Australian citizen");
  });

  it("extracts the correct evidence span for permanent residency", () => {
    const adText = "This role is open to permanent residents only.";

    const extracted = mockExtractJobAd(adText);
    const evidence = extracted.residencyRequirement;

    expect(evidence).toBeDefined();

    if (!evidence) return;

    const highlightedText = adText.slice(evidence.start, evidence.end);

    expect(highlightedText).toBe("permanent residents only");
  });

  it("matches eligibility phrases case-insensitively", () => {
    const adText = "APPLICANTS MUST BE AN AUSTRALIAN CITIZEN.";

    const extracted = mockExtractJobAd(adText);
    const verdict = evaluateJob(extracted);

    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_CITIZENSHIP");
    expect(verdict.evidence?.text).toBe("AUSTRALIAN CITIZEN");
  });

  const student500 = {
    subclass: "500" as const,
    duringStudyTerm: true,
    monthsRemaining: 18,
  };

  it("returns TAILOR for full working rights on subclass 500", () => {
    const verdict = evaluateJob(
      {
        workRightsRequirement: {
          value: "Full working rights required",
          text: "full Australian working rights",
          start: 21,
          end: 51,
        },
      },
      student500
    );

    expect(verdict.status).toBe("TAILOR");
    expect(verdict.ruleId).toBe("T2_FULL_WORK_RIGHTS");
  });

  it("returns TAILOR when sponsorship is unavailable", () => {
    const verdict = evaluateJob(
      {
        sponsorship: {
          value: "No sponsorship available",
          text: "sponsorship is not available",
          start: 22,
          end: 50,
        },
      },
      student500
    );

    expect(verdict.status).toBe("TAILOR");
    expect(verdict.ruleId).toBe("T2_NO_SPONSORSHIP");
  });

  it("returns TAILOR for permanent full-time employment", () => {
    const verdict = evaluateJob(
      {
        employmentType: {
          value: "Permanent full-time",
          text: "permanent full-time",
          start: 10,
          end: 29,
        },
      },
      student500
    );

    expect(verdict.status).toBe("TAILOR");
    expect(verdict.ruleId).toBe("T2_PERMANENT_FULL_TIME");
  });

  it("returns TAILOR for Australian experience requirement", () => {
    const verdict = evaluateJob(
      {
        australianExperienceRequirement: {
          value: "Australian experience required",
          text: "Australian work experience",
          start: 9,
          end: 35,
        },
      },
      student500
    );

    expect(verdict.status).toBe("TAILOR");
    expect(verdict.ruleId).toBe("T2_AUSTRALIAN_EXPERIENCE");
  });

  it("returns TAILOR when weekly hours exceed prototype threshold", () => {
    const verdict = evaluateJob(
      {
        hoursPerWeek: {
          value: "38 hours per week",
          text: "38 hours per week",
          start: 23,
          end: 40,
        },
      },
      student500
    );

    expect(verdict.status).toBe("TAILOR");
    expect(verdict.ruleId).toBe("T2_HOURS_DURING_TERM");
  });
});
