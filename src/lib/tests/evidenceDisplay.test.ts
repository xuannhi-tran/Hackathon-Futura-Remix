import { describe, it, expect } from "vitest";
import { getDisplayEvidenceSpan } from "../evidenceDisplay";
import { Verdict } from "../../types/job";

describe("getDisplayEvidenceSpan", () => {
  it("A. Expands to the full clause for citizenship + PR + work rights", () => {
    const adText =
      "This is a sentence. An Australian or New Zealand Citizen, Australian Permanent Resident or able to provide evidence of full working rights. Another sentence.";

    // "full working rights" starts at 122, length 19, ends at 141
    const verdict: Verdict = {
      status: "SKIP",
      reason: "Needs full work rights",
      ruleId: "T1_FULL_WORK_RIGHTS_STUDENT_500",
      evidence: { text: "full working rights", start: 121, end: 140 },
    };

    const span = getDisplayEvidenceSpan(adText, verdict);

    // The clause starts at 20 (after "This is a sentence. "), ends at 141 (including ".")
    const expectedText =
      "An Australian or New Zealand Citizen, Australian Permanent Resident or able to provide evidence of full working rights.";
    const clauseStart = adText.indexOf(expectedText);
    const clauseEnd = clauseStart + expectedText.length;

    expect(span?.displayStart).toBe(clauseStart);
    expect(span?.displayEnd).toBe(clauseEnd);
    expect(adText.slice(span!.displayStart, span!.displayEnd)).toBe(
      expectedText
    );
  });

  it("B. Expands to the full clause for citizen + work rights OR", () => {
    const adText =
      "Hello. Be an Australian or New Zealand Citizen or have unrestricted working rights. Bye.";

    // "unrestricted working rights"
    const expectedText =
      "Be an Australian or New Zealand Citizen or have unrestricted working rights.";

    const verdict: Verdict = {
      status: "SKIP",
      reason: "Needs unrestricted work rights",
      ruleId: "T2_WORK_RIGHTS_REVIEW",
      evidence: {
        text: "unrestricted working rights",
        start: adText.indexOf("unrestricted working rights"),
        end:
          adText.indexOf("unrestricted working rights") +
          "unrestricted working rights".length,
      },
    };

    const span = getDisplayEvidenceSpan(adText, verdict);

    const clauseStart = adText.indexOf(expectedText);
    const clauseEnd = clauseStart + expectedText.length;

    expect(span?.displayStart).toBe(clauseStart);
    expect(span?.displayEnd).toBe(clauseEnd);
    expect(adText.slice(span!.displayStart, span!.displayEnd)).toBe(
      expectedText
    );
  });

  it("C. Ordinary case does not expand unnecessarily", () => {
    const adText =
      "Welcome! Applicants must have unrestricted working rights. Next line.";

    // "unrestricted working rights"
    const evidenceText = "unrestricted working rights";
    const start = adText.indexOf(evidenceText);
    const end = start + evidenceText.length;

    const verdict: Verdict = {
      status: "SKIP",
      reason: "Needs unrestricted work rights",
      ruleId: "T2_WORK_RIGHTS_REVIEW",
      evidence: { text: evidenceText, start, end },
    };

    const span = getDisplayEvidenceSpan(adText, verdict);

    expect(span?.displayStart).toBe(start);
    expect(span?.displayEnd).toBe(end);
    expect(adText.slice(span!.displayStart, span!.displayEnd)).toBe(
      evidenceText
    );
  });

  it("D. Unrelated surrounding text should not be pulled into the highlighted context", () => {
    const adText =
      "Line 1. Be an Australian or New Zealand Citizen or have unrestricted working rights. Line 3.";
    const evidenceText = "unrestricted working rights";
    const expectedText =
      "Be an Australian or New Zealand Citizen or have unrestricted working rights.";

    const verdict: Verdict = {
      status: "SKIP",
      reason: "Needs unrestricted work rights",
      ruleId: "T2_WORK_RIGHTS_REVIEW",
      evidence: {
        text: evidenceText,
        start: adText.indexOf(evidenceText),
        end: adText.indexOf(evidenceText) + evidenceText.length,
      },
    };

    const span = getDisplayEvidenceSpan(adText, verdict);

    expect(adText.slice(span!.displayStart, span!.displayEnd)).toBe(
      expectedText
    );
    expect(adText.slice(span!.displayStart, span!.displayEnd)).not.toContain(
      "Line 1"
    );
    expect(adText.slice(span!.displayStart, span!.displayEnd)).not.toContain(
      "Line 3"
    );
  });

  it("Expands for Citizen or PR", () => {
    const adText = "Australian Citizen or Permanent Resident required.";
    const expectedText = adText;
    const evidenceText = "Australian Citizen";

    const verdict: Verdict = {
      status: "SKIP",
      reason: "Needs citizenship",
      ruleId: "T1_CITIZENSHIP",
      evidence: {
        text: evidenceText,
        start: adText.indexOf(evidenceText),
        end: adText.indexOf(evidenceText) + evidenceText.length,
      },
    };

    const span = getDisplayEvidenceSpan(adText, verdict);
    expect(adText.slice(span!.displayStart, span!.displayEnd)).toBe(
      expectedText
    );
  });
});
