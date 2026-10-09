/**
 * Clause-structure tests for "citizen / PR OR <some visa>" eligibility wording.
 *
 * The extraction layer (Gemini + fallbacks) supplies a citizenship and/or
 * residency evidence span. `resolveEligibilityClause` then reads the clause
 * around that span and decides which statuses it accepts. These tests simulate
 * the AI span by locating a phrase in the ad (as addEvidenceSpan would), run
 * the resolver exactly as route.ts does, and assert the verdict from
 * evaluateJob.
 *
 * Wordings below are either the real ads quoted in the task or sentences
 * written for this suite. None of them are copied from the hold-out set.
 */

import { describe, it, expect } from "vitest";

import {
  fallbackCitizenship,
  fallbackResidency,
  fallbackTemporaryVisaAllowed,
  fallbackWorkRightsRequirement,
  resolveEligibilityClause,
} from "../extractionFallbacks";
import { evaluateJob } from "../rules";

import type {
  EvidenceField,
  ExtractedJobAd,
  VisaProfile,
} from "../../types/job";

const student500: VisaProfile = {
  subclass: "500",
  duringStudyTerm: true,
  monthsRemaining: 18,
};

const graduate485: VisaProfile = {
  subclass: "485",
  duringStudyTerm: false,
  monthsRemaining: 24,
};

function span(adText: string, phrase?: string): EvidenceField | undefined {
  if (!phrase) return undefined;
  const start = adText.indexOf(phrase);
  if (start === -1) throw new Error(`"${phrase}" not found in ad text`);
  return { value: "ai", text: phrase, start, end: start + phrase.length };
}

/** Mirrors the extraction wiring in route.ts, minus Gemini. */
function extract(
  adText: string,
  citizenshipPhrase?: string,
  residencyPhrase?: string
): ExtractedJobAd {
  const resolution = resolveEligibilityClause(
    adText,
    span(adText, citizenshipPhrase) ?? fallbackCitizenship(adText),
    span(adText, residencyPhrase) ?? fallbackResidency(adText)
  );

  return {
    citizenshipRequirement: resolution.citizenshipRequirement,
    residencyRequirement: resolution.residencyRequirement,
    graduateVisaPathway: resolution.graduateVisaPathway,
    temporaryVisaAllowed:
      fallbackTemporaryVisaAllowed(adText) ?? resolution.temporaryVisaAllowed,
    workRightsRequirement: fallbackWorkRightsRequirement(adText),
  };
}

function verdictFor(
  adText: string,
  profile: VisaProfile,
  citizenshipPhrase?: string,
  residencyPhrase?: string
) {
  const job = extract(adText, citizenshipPhrase, residencyPhrase);
  const verdict = evaluateJob(job, profile);

  // Evidence must always be an exact substring of the ad.
  if (verdict.evidence) {
    expect(adText.slice(verdict.evidence.start, verdict.evidence.end)).toBe(
      verdict.evidence.text
    );
  }

  return verdict;
}

// ─────────────────────────────────────────────────────────────────────────────
// Real ads that used to fall through to citizenship
// ─────────────────────────────────────────────────────────────────────────────

describe("citizen/PR OR graduate visa — real wordings", () => {
  const cases: Array<{
    name: string;
    adText: string;
    citizenship: string;
    residency?: string;
  }> = [
    {
      name: "'citizen of, or hold permanent residency in, Australia or NZ, or hold a Graduate Visa'",
      adText:
        "To apply you must be a citizen of, or hold permanent residency in, Australia or New Zealand, or hold a Graduate Visa.",
      citizenship: "citizen of",
      residency: "permanent residency",
    },
    {
      name: "'Hold Australian or NZ citizenship, Permanent residency, or Graduate Visa 485 (valid until ...)'",
      adText:
        "Requirements:\nHold Australian or New Zealand citizenship, Permanent residency, or Graduate Visa 485 (valid until the end of 2028)\nStrong communication skills",
      citizenship: "Australian or New Zealand citizenship",
      residency: "Permanent residency",
    },
    {
      name: "'Are an Australian or NZ citizen, Australian permanent resident or are eligible for an Australian 485 Graduate Visa'",
      adText:
        "You will:\nAre an Australian or New Zealand citizen, Australian permanent resident or are eligible for an Australian 485 Graduate Visa.",
      citizenship: "Australian or New Zealand citizen",
      residency: "Australian permanent resident",
    },
  ];

  for (const c of cases) {
    it(`${c.name}: profile 485 → TAILOR, check validity dates`, () => {
      const verdict = verdictFor(
        c.adText,
        graduate485,
        c.citizenship,
        c.residency
      );

      expect(verdict.status).toBe("TAILOR");
      expect(verdict.reason).toMatch(/validity|valid|dates/i);
      expect(verdict.ruleId).not.toBe("T1_CITIZENSHIP");
      expect(verdict.ruleId).not.toBe("T1_PERMANENT_RESIDENCY");
    });

    it(`${c.name}: profile 500 → TAILOR via T2_GRADUATE_VISA_PATHWAY`, () => {
      const verdict = verdictFor(
        c.adText,
        student500,
        c.citizenship,
        c.residency
      );

      expect(verdict.status).toBe("TAILOR");
      expect(verdict.ruleId).toBe("T2_GRADUATE_VISA_PATHWAY");
      expect(verdict.reason).toMatch(/485/);
      expect(verdict.reason).toMatch(/start date/i);
    });
  }

  it("graduate-visa evidence for the validity wording includes the ad's validity note", () => {
    const adText =
      "Hold Australian or New Zealand citizenship, Permanent residency, or Graduate Visa 485 (valid until the end of 2028)";
    const verdict = verdictFor(
      adText,
      graduate485,
      "Australian or New Zealand citizenship",
      "Permanent residency"
    );

    expect(verdict.evidence?.text).toContain("485");
    expect(verdict.evidence?.text).toContain("valid until the end of 2028");
  });

  it("three-line bullet list ending in 'visa holder with appropriate working rights' → TAILOR (any visa) for both profiles", () => {
    const adText =
      "You must be:\n- An Australian citizen\n- An Australian permanent resident, or\n- A visa holder with appropriate working rights\n";

    for (const profile of [student500, graduate485]) {
      const verdict = verdictFor(
        adText,
        profile,
        "An Australian citizen",
        "An Australian permanent resident"
      );

      expect(verdict.status).toBe("TAILOR");
      expect(verdict.ruleId).toBe("T2_TEMPORARY_VISA_ALLOWED");
      expect(verdict.evidence?.text).toBe(
        "A visa holder with appropriate working rights"
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Must stay SKIP / not an eligibility requirement
// ─────────────────────────────────────────────────────────────────────────────

describe("regression — still SKIP", () => {
  it("'with full working rights' describes the NZ citizen, not a separate option", () => {
    const adText =
      "Be an Australian citizen, permanent resident, or New Zealand citizen with full working rights.";

    for (const profile of [student500, graduate485]) {
      const verdict = verdictFor(adText, profile, "Australian citizen");
      expect(verdict.status).toBe("SKIP");
      expect(verdict.ruleId).toBe("T1_CITIZENSHIP");
    }
  });

  it("'not able to sponsor visas' is not an accepted alternative", () => {
    const adText =
      "You must be an Australian citizen or permanent resident. We are not able to sponsor visas for this role.";

    for (const profile of [student500, graduate485]) {
      const verdict = verdictFor(adText, profile);
      expect(verdict.status).toBe("SKIP");
    }
  });

  it("citizen / NZ citizen / PR at the time of submitting is SKIP when the span is provided", () => {
    const adText =
      "an Australian / New Zealand Citizen or Australian Permanent Resident at the time of submitting your application";

    for (const profile of [student500, graduate485]) {
      const verdict = verdictFor(
        adText,
        profile,
        "Australian / New Zealand Citizen",
        "Australian Permanent Resident"
      );
      expect(verdict.status).toBe("SKIP");
    }
  });

  it("a document checklist is not an eligibility requirement", () => {
    const adText =
      "Please bring proof of your work rights – either Passport or Birth Certificate or Australian Citizenship Certificate";

    // Neither deterministic fallback treats this as an eligibility clause...
    expect(fallbackCitizenship(adText)).toBeUndefined();
    expect(fallbackResidency(adText)).toBeUndefined();

    // ...and even if the model files the certificate as citizenship, the
    // resolver discards it.
    const job = extract(adText, "Australian Citizenship");
    expect(job.citizenshipRequirement).toBeUndefined();

    for (const profile of [student500, graduate485]) {
      expect(evaluateJob(job, profile).status).not.toBe("SKIP");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generalisation: wording not present in any ad file
// ─────────────────────────────────────────────────────────────────────────────

describe("generalisation — sentences written for this suite", () => {
  describe("accepts any visa with work rights → TAILOR (T2_TEMPORARY_VISA_ALLOWED)", () => {
    const anyVisa: Array<{ adText: string; citizenship: string }> = [
      {
        adText:
          "Applicants should be Australian citizens, hold permanent residence, or be the holder of a valid work visa.",
        citizenship: "Australian citizens",
      },
      {
        adText:
          "Open to NZ citizens, Australian PRs, or candidates on a visa with the right to work here.",
        citizenship: "NZ citizens",
      },
      {
        adText:
          "You need to be a citizen, a permanent resident or a person who holds any visa permitting full-time employment in Australia.",
        citizenship: "citizen",
      },
      {
        adText: "Australian citizen or have the right to work in Australia.",
        citizenship: "Australian citizen",
      },
      {
        adText:
          "Candidates must be NZ citizens, Australian permanent residents or otherwise legally entitled to work in this country.",
        citizenship: "NZ citizens",
      },
      {
        adText:
          "Eligibility:\n* Australian citizen\n* New Zealand citizen\n* Permanent resident\n* Temporary resident with valid working rights",
        citizenship: "Australian citizen",
      },
    ];

    for (const c of anyVisa) {
      it(c.adText.replace(/\n/g, " ⏎ "), () => {
        for (const profile of [student500, graduate485]) {
          const verdict = verdictFor(c.adText, profile, c.citizenship);
          expect(verdict.status).toBe("TAILOR");
          expect(verdict.ruleId).toBe("T2_TEMPORARY_VISA_ALLOWED");
        }
      });
    }
  });

  describe("accepts only a 485 as the alternative", () => {
    const grad: Array<{ adText: string; citizenship: string }> = [
      {
        adText:
          "Open to Australian citizens, permanent residents, or Temporary Graduate (subclass 485) visa holders.",
        citizenship: "Australian citizens",
      },
      {
        adText:
          "Candidates need to be Australian citizens, permanent residents or people on a 485 visa.",
        citizenship: "Australian citizens",
      },
    ];

    for (const c of grad) {
      it(c.adText, () => {
        const v485 = verdictFor(c.adText, graduate485, c.citizenship);
        expect(v485.status).toBe("TAILOR");
        expect(v485.reason).toMatch(/valid|dates/i);

        const v500 = verdictFor(c.adText, student500, c.citizenship);
        expect(v500.status).toBe("TAILOR");
        expect(v500.ruleId).toBe("T2_GRADUATE_VISA_PATHWAY");
      });
    }
  });

  it("student-visa holders accepted alongside citizens/PR → TAILOR", () => {
    const adText =
      "Australian citizens, permanent residents or international students on a student visa may apply.";

    for (const profile of [student500, graduate485]) {
      const verdict = verdictFor(adText, profile, "Australian citizens");
      expect(verdict.status).toBe("TAILOR");
    }
  });

  describe("citizen-only wording stays SKIP", () => {
    const citizenOnly: Array<{ adText: string; citizenship: string }> = [
      {
        adText:
          "Australian citizens, permanent residents, not visa holders, are eligible for this position.",
        citizenship: "Australian citizens",
      },
      {
        adText:
          "Citizenship or permanent residency is a condition of employment, and we do not offer visa sponsorship.",
        citizenship: "Citizenship",
      },
      {
        adText:
          "Applicants need to be Australian or New Zealand citizens with valid working rights.",
        citizenship: "Australian or New Zealand citizens",
      },
      {
        adText:
          "Applicants need to be Australian citizens, or New Zealand citizens with the right to work in Australia.",
        citizenship: "Australian citizens",
      },
      {
        adText:
          "Applicants must be an Australian citizen or permanent resident (we are unable to sponsor a work visa).",
        citizenship: "Australian citizen",
      },
      {
        adText:
          "Requirements:\n- Must be an Australian citizen\n- Must hold a valid working rights declaration form\n",
        citizenship: "Must be an Australian citizen",
      },
    ];

    for (const c of citizenOnly) {
      it(c.adText.replace(/\n/g, " ⏎ "), () => {
        for (const profile of [student500, graduate485]) {
          const verdict = verdictFor(c.adText, profile, c.citizenship);
          expect(verdict.status).toBe("SKIP");
        }
      });
    }
  });
});
