import {
  ExtractedJobAd,
  EvidenceField,
  VisaProfile,
  Verdict,
} from "../types/job";

function evidenceFrom(field: EvidenceField) {
  return {
    text: field.text,
    start: field.start,
    end: field.end,
  };
}

function containsAny(text: string, phrases: string[]) {
  const lower = text.toLowerCase();

  return phrases.some((phrase) => lower.includes(phrase.toLowerCase()));
}

function extractHours(field?: EvidenceField) {
  if (!field) return undefined;

  const match = field.text.match(/\d+(?:\.\d+)?/);

  if (!match) return undefined;

  return Number(match[0]);
}

export function evaluateJob(
  job: ExtractedJobAd,
  profile?: VisaProfile
): Verdict {
  // -----------------------
  // TIER 1 — HARD BLOCKERS
  // -----------------------

  if (job.citizenshipRequirement) {
    return {
      status: "SKIP",
      ruleId: "T1_CITIZENSHIP",
      reason: "This role requires Australian citizenship.",
      evidence: evidenceFrom(job.citizenshipRequirement),
    };
  }

  if (job.residencyRequirement) {
    return {
      status: "SKIP",
      ruleId: "T1_PERMANENT_RESIDENCY",
      reason: "This role requires Australian permanent residency.",
      evidence: evidenceFrom(job.residencyRequirement),
    };
  }

  if (job.securityClearance) {
    return {
      status: "SKIP",
      ruleId: "T1_SECURITY_CLEARANCE",
      reason: "This role requires a security clearance.",
      evidence: evidenceFrom(job.securityClearance),
    };
  }

  // -----------------------
  // TIER 2 — CONDITIONAL
  // -----------------------

  if (job.workRightsRequirement && profile?.subclass === "500") {
    return {
      status: "TAILOR",
      ruleId: "T2_FULL_WORK_RIGHTS",
      reason:
        "This role asks for full working rights. Check the role requirements against the work conditions of your selected visa profile.",
      evidence: evidenceFrom(job.workRightsRequirement),
    };
  }

  if (job.sponsorship) {
    const sponsorshipText = `${job.sponsorship.text} ${job.sponsorship.value}`;

    const noSponsorship = containsAny(sponsorshipText, [
      "no sponsorship",
      "sponsorship not available",
      "cannot sponsor",
      "unable to sponsor",
      "will not sponsor",
    ]);

    if (noSponsorship) {
      return {
        status: "TAILOR",
        ruleId: "T2_NO_SPONSORSHIP",
        reason:
          profile?.subclass === "485"
            ? "This employer does not offer sponsorship. Consider this requirement against your remaining visa runway."
            : "This employer does not offer sponsorship. Check whether the role aligns with your current and future work-rights situation.",
        evidence: evidenceFrom(job.sponsorship),
      };
    }
  }

  if (
    job.employmentType &&
    containsAny(job.employmentType.text, [
      "permanent full-time",
      "permanent full time",
    ])
  ) {
    return {
      status: "TAILOR",
      ruleId: "T2_PERMANENT_FULL_TIME",
      reason:
        profile?.monthsRemaining !== undefined
          ? `This is a permanent full-time role. Compare the role expectations with your remaining visa runway of approximately ${profile.monthsRemaining} months.`
          : "This is a permanent full-time role. Check whether its duration and work conditions align with your visa profile.",
      evidence: evidenceFrom(job.employmentType),
    };
  }

  if (job.australianExperienceRequirement) {
    return {
      status: "TAILOR",
      ruleId: "T2_AUSTRALIAN_EXPERIENCE",
      reason:
        "The advertisement asks for Australian experience. This is treated as a fit signal to address in your application rather than a hard blocker.",
      evidence: evidenceFrom(job.australianExperienceRequirement),
    };
  }

  const hours = extractHours(job.hoursPerWeek);

  if (
    profile?.subclass === "500" &&
    profile.duringStudyTerm &&
    hours !== undefined &&
    hours > 24
  ) {
    return {
      status: "TAILOR",
      ruleId: "T2_HOURS_DURING_TERM",
      reason:
        "The advertised weekly hours exceed the threshold used by this prototype for a subclass 500 student during study term. Review your actual visa work conditions before applying.",
      evidence: evidenceFrom(job.hoursPerWeek!),
    };
  }

  // -----------------------
  // NO BLOCKER DETECTED
  // -----------------------

  return {
    status: "APPLY",
    reason: "No eligibility blockers detected.",
  };
}
