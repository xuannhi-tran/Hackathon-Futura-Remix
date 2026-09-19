import {
  ExtractedJobAd,
  EvidenceField,
  VisaProfile,
  Verdict,
  FitProfile,
  FitSignal,
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

// =======================================
// TIER 3 — FIT SIGNALS
// These never change the eligibility verdict.
// =======================================

function extractFirstNumber(field?: EvidenceField): number | undefined {
  if (!field) return undefined;

  const match = field.text.match(/\d+(?:\.\d+)?/);

  if (!match) return undefined;

  return Number(match[0]);
}

function normaliseWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function fieldsOverlap(targetField: string, roleField: string): boolean {
  const targetWords = normaliseWords(targetField);

  const roleWords = normaliseWords(roleField);

  return targetWords.some((word) => roleWords.includes(word));
}

export function evaluateFitSignals(
  job: ExtractedJobAd,
  profile: FitProfile
): FitSignal[] {
  const signals: FitSignal[] = [];

  // -----------------------
  // EXPERIENCE FIT
  // -----------------------

  const requestedYears = extractFirstNumber(job.yearsExperience);

  if (requestedYears !== undefined && job.yearsExperience) {
    if (profile.yearsExperience >= requestedYears) {
      signals.push({
        id: "T3_EXPERIENCE_MATCH",
        status: "MATCH",
        label: "Experience fit",
        reason: `Your ${profile.yearsExperience} years of experience meets the advertised ${requestedYears}-year requirement.`,
        evidence: evidenceFrom(job.yearsExperience),
      });
    } else {
      signals.push({
        id: "T3_EXPERIENCE_STRETCH",
        status: "STRETCH",
        label: "Experience stretch",
        reason: `The advertisement asks for approximately ${requestedYears} years of experience, while your profile lists ${profile.yearsExperience}.`,
        evidence: evidenceFrom(job.yearsExperience),
      });
    }
  }

  // -----------------------
  // LOCATION FIT
  // -----------------------

  if (job.location) {
    const locationMatch =
      job.location.value
        .toLowerCase()
        .includes(profile.preferredLocation.toLowerCase()) ||
      job.location.text
        .toLowerCase()
        .includes(profile.preferredLocation.toLowerCase());

    signals.push({
      id: locationMatch ? "T3_LOCATION_MATCH" : "T3_LOCATION_DIFFERENT",

      status: locationMatch ? "MATCH" : "INFO",

      label: "Location fit",

      reason: locationMatch
        ? `The role location matches your preferred location: ${profile.preferredLocation}.`
        : `The role is listed as ${job.location.text}, while your preferred location is ${profile.preferredLocation}.`,

      evidence: evidenceFrom(job.location),
    });
  }

  // -----------------------
  // FIELD MATCH
  // -----------------------

  if (job.roleField) {
    const fieldMatch = fieldsOverlap(
      profile.targetField,
      `${job.roleField.value} ${job.roleField.text}`
    );

    signals.push({
      id: fieldMatch ? "T3_FIELD_MATCH" : "T3_FIELD_STRETCH",

      status: fieldMatch ? "MATCH" : "STRETCH",

      label: "Field match",

      reason: fieldMatch
        ? `This role aligns with your target field: ${profile.targetField}.`
        : `This role appears to be in ${job.roleField.value}, while your target field is ${profile.targetField}.`,

      evidence: evidenceFrom(job.roleField),
    });
  }

  return signals;
}
