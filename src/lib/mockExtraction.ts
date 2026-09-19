import { ExtractedJobAd, EvidenceField } from "../types/job";

function findEvidence(
  adText: string,
  phrases: string[],
  value: string
): EvidenceField | undefined {
  const lowerText = adText.toLowerCase();

  // Check longer phrases first so we capture the most specific evidence.
  const sortedPhrases = [...phrases].sort((a, b) => b.length - a.length);

  for (const phrase of sortedPhrases) {
    const start = lowerText.indexOf(phrase.toLowerCase());

    if (start !== -1) {
      return {
        value,
        text: adText.slice(start, start + phrase.length),
        start,
        end: start + phrase.length,
      };
    }
  }

  return undefined;
}

export function mockExtractJobAd(adText: string): ExtractedJobAd {
  return {
    citizenshipRequirement: findEvidence(
      adText,
      ["Australian citizenship", "Australian citizen", "must be a citizen"],
      "Australian citizenship required"
    ),

    residencyRequirement: findEvidence(
      adText,
      [
        "permanent residents only",
        "permanent residents",
        "permanent resident",
        "PR required",
      ],
      "Permanent residency required"
    ),

    securityClearance: findEvidence(
      adText,
      [
        "NV1 security clearance",
        "Baseline security clearance",
        "NV1 clearance",
        "Baseline clearance",
      ],
      "Security clearance required"
    ),
  };
}
