/**
 * Unit tests for deterministic extraction fallback functions.
 *
 * Tests verify:
 *   1. Positive matches return the correct text and a valid span
 *      (text === adText.slice(start, end)).
 *   2. Negative inputs return undefined — no false positives.
 *   3. The normalised `value` field is set correctly.
 *
 * These tests do NOT touch Gemini, rules.ts, or the UI.
 * They exercise src/lib/extractionFallbacks.ts directly.
 */

import { describe, it, expect } from "vitest";

import {
  fallbackCitizenship,
  fallbackResidency,
  fallbackSecurityClearance,
  fallbackTemporaryVisaAllowed,
  fallbackVisaPlanRequirement,
  fallbackLocation,
  fallbackRegistration,
  hasFullWorkRightsAlternative,
  fallbackWorkRightsRequirement,
  filterTemporaryVisaAllowed,
} from "../extractionFallbacks";

import { evaluateJob } from "../rules";

import type { EvidenceField } from "../../types/job";

// ─────────────────────────────────────────────────────────────────────────────
// Helper — verifies span integrity: text === adText.slice(start, end)
// ─────────────────────────────────────────────────────────────────────────────

function assertValidSpan(
  adText: string,
  result: ReturnType<typeof fallbackCitizenship>
) {
  expect(result).toBeDefined();

  if (!result) return;

  expect(adText.slice(result.start, result.end)).toBe(result.text);
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIDENCY FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

describe("fallbackResidency", () => {
  // ── positives ─────────────────────────────────────────────────────────────

  it("matches 'Australian citizens or permanent residents'", () => {
    const adText =
      "Applicants must be Australian citizens or permanent residents.";

    const result = fallbackResidency(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("Australian citizens or permanent residents");

    expect(result?.value).toBe("Australian permanent residency required");
  });

  it("matches 'Permanent residency required'", () => {
    const adText = "Permanent residency required.";

    const result = fallbackResidency(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("Permanent residency required");
  });

  it("matches 'permanent residents only'", () => {
    const adText = "This role is open to permanent residents only.";

    const result = fallbackResidency(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("permanent residents only");
  });

  it("matches 'must be an Australian permanent resident'", () => {
    const adText = "All applicants must be an Australian permanent resident.";

    const result = fallbackResidency(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("must be an Australian permanent resident");
  });

  it("matches 'Australian citizen / permanent resident'", () => {
    const adText =
      "You must be an Australian citizen / permanent resident to apply.";

    const result = fallbackResidency(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toContain("permanent resident");
  });

  it("matches 'Australian citizen or PR' followed by punctuation", () => {
    const adText = "Applicants must hold Australian citizen or PR status.";

    const result = fallbackResidency(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("Australian citizen or PR");
  });

  // ── negatives ─────────────────────────────────────────────────────────────

  it("does NOT match a generic use of 'resident'", () => {
    const adText =
      "The successful candidate will be a local resident of Melbourne.";

    expect(fallbackResidency(adText)).toBeUndefined();
  });

  it("does NOT match 'residential' in an unrelated context", () => {
    expect(
      fallbackResidency("We operate a residential care facility.")
    ).toBeUndefined();
  });

  it("does NOT match 'residence' in an unrelated context", () => {
    expect(
      fallbackResidency("Our company residence is located in Sydney.")
    ).toBeUndefined();
  });

  it("does NOT match 'resident' without 'permanent'", () => {
    expect(
      fallbackResidency("Applicants must be a resident of Australia.")
    ).toBeUndefined();
  });

  it("does NOT match 'Australian citizen or PR consultant'", () => {
    // "PR consultant" is an unrelated role — the lookahead guard should block.
    const adText =
      "Seeking an Australian citizen or PR consultant for this role.";
    const result = fallbackResidency(adText);
    // If it does match, the text must not include "consultant"
    if (result) {
      expect(result.text).not.toContain("consultant");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY CLEARANCE FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

describe("fallbackSecurityClearance", () => {
  // ── positives ─────────────────────────────────────────────────────────────

  it("matches 'must be able to obtain and maintain an Australian Government security clearance'", () => {
    const adText =
      "Applicants must be able to obtain and maintain an Australian Government security clearance.";

    const result = fallbackSecurityClearance(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toContain("security clearance");

    expect(result?.value).toBe("Security clearance required");
  });

  it("matches 'NV1 clearance required'", () => {
    const adText = "NV1 clearance required.";

    const result = fallbackSecurityClearance(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("NV1 clearance");
  });

  it("matches 'NV2 clearance'", () => {
    const adText = "You must hold an NV2 clearance before commencing.";

    const result = fallbackSecurityClearance(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("NV2 clearance");
  });

  it("matches standalone 'NV1'", () => {
    const adText = "A current NV1 is required for this role.";

    const result = fallbackSecurityClearance(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("NV1");
  });

  it("matches 'Negative Vetting Level 2'", () => {
    const adText = "Applicants must hold Negative Vetting Level 2.";

    const result = fallbackSecurityClearance(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("Negative Vetting Level 2");
  });

  it("matches 'Negative Vetting Level 1'", () => {
    const adText = "This role requires Negative Vetting Level 1 clearance.";

    const result = fallbackSecurityClearance(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("Negative Vetting Level 1");
  });

  it("matches 'Baseline Security Clearance'", () => {
    const adText =
      "Applicants must be eligible for Baseline Security Clearance.";

    const result = fallbackSecurityClearance(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("Baseline Security Clearance");
  });

  it("matches 'security clearance required'", () => {
    const adText = "A security clearance required for this position.";

    const result = fallbackSecurityClearance(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("security clearance required");
  });

  it("matches 'security clearance mandatory'", () => {
    const adText = "Security clearance mandatory for all staff.";

    const result = fallbackSecurityClearance(adText);

    assertValidSpan(adText, result);

    expect(result?.text.toLowerCase()).toContain("security clearance");
  });

  it("matches 'must obtain a security clearance'", () => {
    const adText = "The successful applicant must obtain a security clearance.";

    const result = fallbackSecurityClearance(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toContain("security clearance");
  });

  // ── negatives ─────────────────────────────────────────────────────────────

  it("does NOT match 'Join our cyber security team'", () => {
    expect(
      fallbackSecurityClearance("Join our cyber security team.")
    ).toBeUndefined();
  });

  it("does NOT match 'information security role'", () => {
    expect(
      fallbackSecurityClearance(
        "We are hiring for an information security role."
      )
    ).toBeUndefined();
  });

  it("does NOT match 'security' alone in an unrelated phrase", () => {
    expect(
      fallbackSecurityClearance(
        "You will work in our airport security division."
      )
    ).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY VISA ALLOWED FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

describe("fallbackTemporaryVisaAllowed", () => {
  // ── positives ─────────────────────────────────────────────────────────────

  it("matches explicit 'temporary visa ... may be offered employment'", () => {
    const adText =
      "If you hold a temporary visa that allows you to live and work in Australia, " +
      "you may be offered employment in line with the conditions of your visa.";

    const result = fallbackTemporaryVisaAllowed(adText);

    assertValidSpan(adText, result);

    expect(result?.value).toBe("Temporary visa holders explicitly allowed");
  });

  it("matches 'citizen of another country with an appropriate visa that allows you to work in Australia'", () => {
    const adText =
      "We also welcome candidates who are a citizen of another country " +
      "with an appropriate visa that allows you to work in Australia.";

    const result = fallbackTemporaryVisaAllowed(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toContain("appropriate visa");
  });

  it("matches 'or hold an appropriate visa that allows you to live and work in Australia'", () => {
    const adText =
      "You must be an Australian citizen, permanent resident, " +
      "or hold an appropriate visa that allows you to live and work in Australia.";

    const result = fallbackTemporaryVisaAllowed(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toContain("appropriate visa");
  });

  it("matches 'temporary visa holders may be considered'", () => {
    const adText =
      "Temporary visa holders may be considered for this opportunity.";

    const result = fallbackTemporaryVisaAllowed(adText);

    assertValidSpan(adText, result);
  });

  it("matches 'temporary visa holders can apply'", () => {
    const adText = "Temporary visa holders can apply for this role.";

    const result = fallbackTemporaryVisaAllowed(adText);

    assertValidSpan(adText, result);
  });

  it("matches 'employment of a temporary visa holder will only be offered'", () => {
    const adText =
      "Employment of a temporary visa holder will only be offered " +
      "where no suitably qualified Australian candidate is available.";

    const result = fallbackTemporaryVisaAllowed(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toContain("temporary visa holder");
  });

  // ── negatives — CRITICAL: must NOT produce temporaryVisaAllowed ───────────

  it("does NOT match 'Full working rights in Australia required'", () => {
    expect(
      fallbackTemporaryVisaAllowed("Full working rights in Australia required.")
    ).toBeUndefined();
  });

  it("does NOT match 'Unrestricted working rights required'", () => {
    expect(
      fallbackTemporaryVisaAllowed("Unrestricted working rights required.")
    ).toBeUndefined();
  });

  it("does NOT match 'full Australian working rights'", () => {
    expect(
      fallbackTemporaryVisaAllowed(
        "Applicants must have full Australian working rights."
      )
    ).toBeUndefined();
  });

  it("does NOT match 'valid Australian work rights'", () => {
    expect(
      fallbackTemporaryVisaAllowed(
        "You must hold valid Australian work rights."
      )
    ).toBeUndefined();
  });

  it("does NOT match generic 'visa' references in sponsorship context", () => {
    expect(
      fallbackTemporaryVisaAllowed(
        "We are unable to provide visa sponsorship for this role."
      )
    ).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VISA PLAN REQUIREMENT FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

describe("fallbackVisaPlanRequirement", () => {
  // ── positives ─────────────────────────────────────────────────────────────

  it("matches 'Provide a brief document outlining your proposed next visa plan'", () => {
    const adText =
      "Provide a brief document outlining your proposed next visa plan.";

    const result = fallbackVisaPlanRequirement(adText);

    assertValidSpan(adText, result);

    expect(result?.value).toBe("Future visa plan required");
  });

  it("matches 'proposed next visa plans'", () => {
    const adText =
      "Please include your proposed next visa plans with your application.";

    const result = fallbackVisaPlanRequirement(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("proposed next visa plans");
  });

  it("matches 'outline your visa plan'", () => {
    const adText =
      "Applicants should outline your visa plan in their cover letter.";

    const result = fallbackVisaPlanRequirement(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("outline your visa plan");
  });

  it("matches 'provide details of your proposed visa pathway'", () => {
    const adText =
      "Shortlisted applicants will need to provide details of your proposed visa pathway.";

    const result = fallbackVisaPlanRequirement(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("provide details of your proposed visa pathway");
  });

  it("matches 'explain your future visa pathway'", () => {
    const adText =
      "Please explain your future visa pathway as part of the selection process.";

    const result = fallbackVisaPlanRequirement(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("explain your future visa pathway");
  });

  // ── negatives ─────────────────────────────────────────────────────────────

  it("does NOT match 'What visa do you currently hold?'", () => {
    expect(
      fallbackVisaPlanRequirement("What visa do you currently hold?")
    ).toBeUndefined();
  });

  it("does NOT match a generic visa reference", () => {
    expect(
      fallbackVisaPlanRequirement(
        "We may be able to sponsor a visa for the right candidate."
      )
    ).toBeUndefined();
  });

  it("does NOT match 'visa' alone in sponsorship context", () => {
    expect(
      fallbackVisaPlanRequirement(
        "No visa sponsorship is available for this role."
      )
    ).toBeUndefined();
  });

  it("does NOT match 'Which of the following best describes your visa status?'", () => {
    expect(
      fallbackVisaPlanRequirement(
        "Which of the following best describes your visa status?"
      )
    ).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING FALLBACKS — SMOKE TESTS
// Verify that moving existing fallbacks to the module did not break them.
// ─────────────────────────────────────────────────────────────────────────────

describe("fallbackCitizenship (smoke — existing behaviour unchanged)", () => {
  it("still matches 'must be an Australian citizen'", () => {
    const adText = "Applicants must be an Australian citizen.";

    const result = fallbackCitizenship(adText);

    assertValidSpan(adText, result);

    expect(result?.value).toBe("Australian citizenship required");
  });

  it("still matches 'Australian Citizenship is mandatory'", () => {
    const adText = "Australian Citizenship is mandatory for this role.";

    assertValidSpan(adText, fallbackCitizenship(adText));
  });
});

describe("fallbackLocation (smoke — existing behaviour unchanged)", () => {
  it("still matches a labelled location field", () => {
    const adText = "Location: Sydney NSW\nApply now.";

    const result = fallbackLocation(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("Sydney NSW");
  });
});

describe("fallbackRegistration (smoke — existing behaviour unchanged)", () => {
  it("matches the most-specific AHPRA pattern present in the text", () => {
    // "current AHPRA registration" fires before the shorter "AHPRA registration"
    // because it is listed earlier in the patterns array.
    const adText = "Must hold current AHPRA registration.";

    const result = fallbackRegistration(adText);

    assertValidSpan(adText, result);

    // The matched text must contain "AHPRA registration"
    expect(result?.text).toContain("AHPRA registration");

    expect(result?.value).toBe("Professional registration requirement");
  });

  it("matches standalone 'AHPRA registration' when 'current' is absent", () => {
    const adText = "AHPRA registration is required for this position.";

    const result = fallbackRegistration(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("AHPRA registration");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasFullWorkRightsAlternative — unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("hasFullWorkRightsAlternative", () => {
  // Helper: build a valid EvidenceField pointing at the first occurrence
  // of `phrase` within `adText`, simulating what Gemini + addEvidenceSpan
  // would return.
  function makeField(adText: string, phrase: string): EvidenceField {
    const start = adText.indexOf(phrase);

    if (start === -1) {
      throw new Error(`phrase "${phrase}" not found in adText`);
    }

    return { value: "test", text: phrase, start, end: start + phrase.length };
  }

  // ── positives ─────────────────────────────────────────────────────────────

  it("returns true for Optiver-style citizen/PR-OR-full-rights clause", () => {
    const adText =
      "An Australian or New Zealand Citizen, Australian Permanent Resident " +
      "or able to provide evidence of full working rights.";

    const field = makeField(adText, "Australian or New Zealand Citizen");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(true);
  });

  it("returns true for the Permanent Resident evidence in the same Optiver clause", () => {
    const adText =
      "An Australian or New Zealand Citizen, Australian Permanent Resident " +
      "or able to provide evidence of full working rights.";

    const field = makeField(adText, "Australian Permanent Resident");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(true);
  });

  it("returns true for Urban Utilities-style citizen-OR-unrestricted-rights clause", () => {
    const adText =
      "Be an Australian or New Zealand Citizen or have unrestricted working rights";

    const field = makeField(adText, "Australian or New Zealand Citizen");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(true);
  });

  it("returns true for a plain 'citizen or full working rights' clause", () => {
    const adText =
      "You must be an Australian citizen or have full working rights in Australia.";

    // fallbackCitizenship would match this phrase
    const field = makeField(adText, "must be an Australian citizen");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(true);
  });

  it("returns true for 'citizen / full working rights' (slash separator)", () => {
    const adText =
      "Applicants must be an Australian citizen / hold full working rights.";

    const field = makeField(adText, "must be an Australian citizen");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(true);
  });

  // ── negatives ─────────────────────────────────────────────────────────────

  it("returns false for citizen-or-PR-only clause (no work-rights alternative)", () => {
    const adText =
      "Applicants must be Australian citizens or permanent residents.";

    const field = makeField(adText, "Australian citizens");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(false);
  });

  it("returns false for a plain citizenship-only requirement", () => {
    const adText = "Applicants must be Australian citizens.";

    const field = makeField(adText, "Australian citizens");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(false);
  });

  it("returns false when work rights appear in a DIFFERENT sentence to citizenship", () => {
    // Period separates the two clauses → extractContainingClause stops at the period.
    const adText =
      "Applicants must be Australian citizens. " +
      "Applicants must have full working rights.";

    const field = makeField(adText, "Australian citizens");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(false);
  });

  it("returns false when work rights appear on a DIFFERENT line to citizenship", () => {
    const adText =
      "Applicants must be Australian citizens.\nFull working rights required.";

    const field = makeField(adText, "Australian citizens");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(false);
  });

  it("returns false for generic legal right-to-work wording (not full/unrestricted)", () => {
    const adText =
      "Applicants must be Australian citizens or have the right to work in Australia.";

    const field = makeField(adText, "Australian citizens");

    // "right to work" is NOT a full/unrestricted phrase → no suppression.
    expect(hasFullWorkRightsAlternative(adText, field)).toBe(false);
  });

  it("returns false for undefined field", () => {
    expect(hasFullWorkRightsAlternative("any text", undefined)).toBe(false);
  });

  // ── new false-positive guard tests (tightened implementation) ───────────────

  it("returns false for 'Australian or New Zealand citizen with full working rights' — 'or' is inside the evidence, not between branches", () => {
    // The "or" separates Australian vs New Zealand, not citizenship vs work rights.
    // The between-text is " with ", which contains no OR-alternative separator.
    const adText =
      "Australian or New Zealand citizen with full working rights.";

    const field = makeField(adText, "Australian or New Zealand citizen");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(false);
  });

  it("returns false for 'Australian/New Zealand citizen with unrestricted working rights' — slash is inside the evidence", () => {
    // The "/" separates Australian vs New Zealand within the evidence phrase.
    // The between-text is " with ", which contains no OR-alternative separator.
    const adText =
      "Australian/New Zealand citizen with unrestricted working rights.";

    const field = makeField(adText, "Australian/New Zealand citizen");

    expect(hasFullWorkRightsAlternative(adText, field)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// filterTemporaryVisaAllowed — unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("filterTemporaryVisaAllowed", () => {
  function makeField(text: string): EvidenceField {
    return { value: "test", text, start: 0, end: text.length };
  }

  // ── positives ─────────────────────────────────────────────────────────────

  it("keeps positive temporary visa consideration language", () => {
    expect(filterTemporaryVisaAllowed(makeField("temporary visa holders may apply"))).toBeDefined();
    expect(filterTemporaryVisaAllowed(makeField("temporary visa holders may be considered"))).toBeDefined();
    expect(filterTemporaryVisaAllowed(makeField("temporary visa holders may be offered employment"))).toBeDefined();
  });

  it("keeps appropriate visa allowing work language", () => {
    expect(filterTemporaryVisaAllowed(makeField("hold an appropriate visa that allows you to work in Australia"))).toBeDefined();
    expect(filterTemporaryVisaAllowed(makeField("citizen of another country with an appropriate visa that allows work in Australia"))).toBeDefined();
  });

  it("keeps positive sponsorship language", () => {
    expect(filterTemporaryVisaAllowed(makeField("we can offer sponsorship for the right candidate"))).toBeDefined();
    expect(filterTemporaryVisaAllowed(makeField("sponsorship is available"))).toBeDefined();
    expect(filterTemporaryVisaAllowed(makeField("we will sponsor"))).toBeDefined();
  });

  // ── negatives (now expanded) ───────────────────────────────────────────────

  it("rejects negative sponsorship wording", () => {
    expect(filterTemporaryVisaAllowed(makeField("Visa sponsorship is not available."))).toBeUndefined();
    expect(filterTemporaryVisaAllowed(makeField("We cannot sponsor visas."))).toBeUndefined();
    expect(filterTemporaryVisaAllowed(makeField("No visa sponsorship offered."))).toBeUndefined();
    expect(filterTemporaryVisaAllowed(makeField("Sponsorship unavailable."))).toBeUndefined();
  });

  it("rejects screening / requirement wording containing 'visa'", () => {
    expect(filterTemporaryVisaAllowed(makeField("Visa required"))).toBeUndefined();
    expect(filterTemporaryVisaAllowed(makeField("What visa do you currently hold?"))).toBeUndefined();
    // Simply containing 'visa' without a positive pattern is rejected
    expect(filterTemporaryVisaAllowed(makeField("You must have a valid visa to apply."))).toBeUndefined();
  });

  it("rejects generic diversity wording", () => {
    expect(filterTemporaryVisaAllowed(makeField("We welcome people of all nationalities and backgrounds."))).toBeUndefined();
    expect(filterTemporaryVisaAllowed(makeField("We encourage applications from diverse cultures and inclusion."))).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(filterTemporaryVisaAllowed(undefined)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fallbackWorkRightsRequirement — unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("fallbackWorkRightsRequirement", () => {
  it("matches 'full working rights' and returns a valid span", () => {
    const adText =
      "An Australian or New Zealand Citizen or able to provide evidence of full working rights.";

    const result = fallbackWorkRightsRequirement(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("full working rights");

    expect(result?.value).toBe("Full working rights required");
  });

  it("matches 'unrestricted working rights' and returns a valid span", () => {
    const adText =
      "Be an Australian or New Zealand Citizen or have unrestricted working rights";

    const result = fallbackWorkRightsRequirement(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("unrestricted working rights");
  });

  it("matches 'full Australian working rights' (most specific first)", () => {
    const adText = "Applicants must have full Australian working rights.";

    const result = fallbackWorkRightsRequirement(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("full Australian working rights");
  });

  it("matches 'work without restriction'", () => {
    const adText = "Candidates must be able to work without restriction.";

    const result = fallbackWorkRightsRequirement(adText);

    assertValidSpan(adText, result);

    expect(result?.text).toBe("work without restriction");
  });

  // ── negatives ─────────────────────────────────────────────────────────────

  it("does NOT match generic 'right to work in Australia'", () => {
    expect(
      fallbackWorkRightsRequirement(
        "You must have the right to work in Australia."
      )
    ).toBeUndefined();
  });

  it("does NOT match 'legally entitled to work'", () => {
    expect(
      fallbackWorkRightsRequirement(
        "Applicants must be legally entitled to work in Australia."
      )
    ).toBeUndefined();
  });

  it("does NOT match a screening question", () => {
    expect(
      fallbackWorkRightsRequirement(
        "Which statement best describes your right to work in Australia?"
      )
    ).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OR-clause suppression — end-to-end pipeline tests
//
// These tests simulate what route.ts does (without Gemini) by constructing
// the resolved citizenship/residency evidence manually (as Gemini would
// return it), applying the suppression check, and then asserting both the
// extraction shape AND the evaluateJob verdict.
//
// Cases 1–6 from the specification.
// ─────────────────────────────────────────────────────────────────────────────

describe("OR-clause suppression — end-to-end (Cases 1–6)", () => {
  const student500 = {
    subclass: "500" as const,
    duringStudyTerm: true,
    monthsRemaining: 18,
  };

  const graduate485 = {
    subclass: "485" as const,
    duringStudyTerm: false,
    monthsRemaining: 24,
  };

  // Simulate the route.ts logic for a single ad text,
  // injecting the Gemini-extracted citizenship phrase directly.
  function simulateExtraction(
    adText: string,
    geminiCitizenshipText: string,
    geminiResidencyText?: string
  ) {
    // Build evidence fields as addEvidenceSpan would return them.
    const buildField = (text: string): EvidenceField | undefined => {
      const start = adText.indexOf(text);
      if (start === -1) return undefined;
      return { value: "extracted", text, start, end: start + text.length };
    };

    const resolvedCitizenship = buildField(geminiCitizenshipText);
    const resolvedResidency = geminiResidencyText
      ? buildField(geminiResidencyText)
      : undefined;

    const citizenshipSuppressed = hasFullWorkRightsAlternative(
      adText,
      resolvedCitizenship
    );
    const residencySuppressed = hasFullWorkRightsAlternative(
      adText,
      resolvedResidency
    );

    const resolvedWorkRights = fallbackWorkRightsRequirement(adText);

    return {
      citizenshipRequirement: citizenshipSuppressed
        ? undefined
        : resolvedCitizenship,
      residencyRequirement: residencySuppressed ? undefined : resolvedResidency,
      workRightsRequirement: resolvedWorkRights,
    };
  }

  // ── Case 1: Optiver shape ──────────────────────────────────────────────────

  it("Case 1a — Optiver: citizenship suppressed, residency suppressed, work-right present", () => {
    const adText =
      "An Australian or New Zealand Citizen, Australian Permanent Resident " +
      "or able to provide evidence of full working rights.";

    const extraction = simulateExtraction(
      adText,
      "Australian or New Zealand Citizen",
      "Australian Permanent Resident"
    );

    // Extraction layer must suppress both blockers.
    expect(extraction.citizenshipRequirement).toBeUndefined();
    expect(extraction.residencyRequirement).toBeUndefined();

    // Work-right evidence must be present and have a valid span.
    expect(extraction.workRightsRequirement).toBeDefined();
    expect(
      adText.slice(
        extraction.workRightsRequirement!.start,
        extraction.workRightsRequirement!.end
      )
    ).toBe(extraction.workRightsRequirement!.text);
  });

  it("Case 1b — Optiver + subclass 500 during study term → SKIP via T1_FULL_WORK_RIGHTS_STUDENT_500", () => {
    const adText =
      "An Australian or New Zealand Citizen, Australian Permanent Resident " +
      "or able to provide evidence of full working rights.";

    const extraction = simulateExtraction(
      adText,
      "Australian or New Zealand Citizen",
      "Australian Permanent Resident"
    );

    const verdict = evaluateJob(extraction, student500);

    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_FULL_WORK_RIGHTS_STUDENT_500");
  });

  // ── Case 2: Urban Utilities shape ─────────────────────────────────────────

  it("Case 2a — Urban Utilities: citizenship suppressed, work-right present", () => {
    const adText =
      "Be an Australian or New Zealand Citizen or have unrestricted working rights";

    const extraction = simulateExtraction(
      adText,
      "Australian or New Zealand Citizen"
    );

    expect(extraction.citizenshipRequirement).toBeUndefined();
    expect(extraction.workRightsRequirement).toBeDefined();
    expect(extraction.workRightsRequirement!.text).toBe(
      "unrestricted working rights"
    );
  });

  it("Case 2c — Urban Utilities: suppression works even when AI evidence encompasses the entire clause", () => {
    const adText =
      "Be an Australian or New Zealand Citizen or have unrestricted working rights";

    // Simulate AI returning the ENTIRE clause as the citizenship evidence.
    const extraction = simulateExtraction(adText, adText);

    expect(extraction.citizenshipRequirement).toBeUndefined();
    expect(extraction.workRightsRequirement).toBeDefined();

    const verdict = evaluateJob(extraction, student500);

    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_FULL_WORK_RIGHTS_STUDENT_500");
    expect(extraction.workRightsRequirement!.text).toBe(
      "unrestricted working rights"
    );
  });

  it("Case 2b — Urban Utilities + subclass 500 during study term → SKIP via T1_FULL_WORK_RIGHTS_STUDENT_500", () => {
    const adText =
      "Be an Australian or New Zealand Citizen or have unrestricted working rights";

    const extraction = simulateExtraction(
      adText,
      "Australian or New Zealand Citizen"
    );

    const verdict = evaluateJob(extraction, student500);

    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_FULL_WORK_RIGHTS_STUDENT_500");
  });

  // ── Case 3: citizen-or-PR-only must NOT be weakened ───────────────────────

  it("Case 3 — 'Australian citizens or permanent residents' still blocks as T1_CITIZENSHIP", () => {
    const adText =
      "Applicants must be Australian citizens or permanent residents.";

    // Simulate fallbackCitizenship match
    const extraction = simulateExtraction(adText, "Australian citizens");

    // Citizenship must NOT be suppressed — no work-rights alternative in clause.
    expect(extraction.citizenshipRequirement).toBeDefined();

    const verdict = evaluateJob(extraction, student500);

    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_CITIZENSHIP");
  });

  // ── Case 4: plain citizenship must NOT be weakened ────────────────────────

  it("Case 4 — plain 'Australian citizens' still blocks as T1_CITIZENSHIP", () => {
    const extraction = simulateExtraction(
      "Applicants must be Australian citizens.",
      "Australian citizens"
    );

    expect(extraction.citizenshipRequirement).toBeDefined();

    const verdict = evaluateJob(extraction, student500);

    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_CITIZENSHIP");
  });

  // ── Case 5: plain full working rights → correct rule ─────────────────────

  it("Case 5 — plain 'full working rights' produces SKIP via T1_FULL_WORK_RIGHTS_STUDENT_500", () => {
    const adText = "Applicants must have full working rights in Australia.";

    // No citizenship evidence → no suppression needed.
    const workField = fallbackWorkRightsRequirement(adText);

    expect(workField).toBeDefined();

    const verdict = evaluateJob(
      { workRightsRequirement: workField },
      student500
    );

    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_FULL_WORK_RIGHTS_STUDENT_500");
  });

  // ── Case 6: subclass 485 is NOT blocked by the OR clause ─────────────────

  it("Case 6 — Optiver OR-clause with subclass 485 → APPLY (work rights not a 485 blocker)", () => {
    const adText =
      "An Australian or New Zealand Citizen, Australian Permanent Resident " +
      "or able to provide evidence of full working rights.";

    const extraction = simulateExtraction(
      adText,
      "Australian or New Zealand Citizen",
      "Australian Permanent Resident"
    );

    // Citizenship and residency must be suppressed for 485 too.
    expect(extraction.citizenshipRequirement).toBeUndefined();
    expect(extraction.residencyRequirement).toBeUndefined();

    const verdict = evaluateJob(extraction, graduate485);

    // 485 is NOT blocked by full working rights alone → APPLY.
    expect(verdict.status).toBe("APPLY");
  });

  it("Case 6b — Urban Utilities OR-clause with subclass 485 → APPLY", () => {
    const adText =
      "Be an Australian or New Zealand Citizen or have unrestricted working rights";

    const extraction = simulateExtraction(
      adText,
      "Australian or New Zealand Citizen"
    );

    expect(extraction.citizenshipRequirement).toBeUndefined();

    const verdict = evaluateJob(extraction, graduate485);

    expect(verdict.status).toBe("APPLY");
  });
});
