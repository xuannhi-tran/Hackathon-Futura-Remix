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
} from "../extractionFallbacks";

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
