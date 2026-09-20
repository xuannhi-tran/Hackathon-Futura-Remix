import {
  ExtractedJobAd,
  EvidenceField,
  VisaProfile,
  Verdict,
  FitProfile,
  FitSignal,
} from "../types/job";
import { matchesState } from "./location";

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

function isExplicitFullWorkRightsRequirement(field?: EvidenceField): boolean {
  if (!field) return false;

  const text = `${field.text} ${field.value}`;

  return containsAny(text, [
    "full working rights",
    "full australian working rights",
    "full work rights",
    "unrestricted working rights",
    "unrestricted work rights",
    "work without restriction",
    "working without restriction",
    "ability to work without restriction",
  ]);
}

function isGraduateRole(title?: string): boolean {
  if (!title) return false;
  return /\bgraduate\b/i.test(title);
}

export function evaluateJob(
  job: ExtractedJobAd,
  profile?: VisaProfile
): Verdict {
  // =======================================
  // EXPLICIT TEMPORARY VISA ACCEPTANCE
  //
  // This is checked before citizenship/PR because
  // some advertisements list citizenship/PR wording
  // alongside an explicit pathway for temporary visa
  // holders.
  // =======================================

  if (job.temporaryVisaAllowed) {
    return {
      status: "TAILOR",
      ruleId: "T2_TEMPORARY_VISA_ALLOWED",
      reason:
        "The advertisement explicitly indicates that temporary visa holders may be considered. Review the stated conditions against your visa profile.",
      evidence: evidenceFrom(job.temporaryVisaAllowed),
    };
  }

  // =======================================
  // TIER 1 — HARD BLOCKERS
  // =======================================

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

  // =======================================
  // WORK RIGHTS — PROFILE AWARE
  // =======================================

  const explicitFullWorkRights = isExplicitFullWorkRightsRequirement(
    job.workRightsRequirement
  );

  const weeklyHours = extractHours(job.hoursPerWeek);

  const is500StudyTerm = profile?.subclass === "500" && profile.duringStudyTerm;

  const isNearGraduationException =
    is500StudyTerm &&
    profile.monthsRemaining !== undefined &&
    profile.monthsRemaining <= 6 &&
    isGraduateRole(job.title);

  // Student visa 500 + study term:
  // explicit full/unrestricted working rights are
  // incompatible with the selected profile.
  if (explicitFullWorkRights && is500StudyTerm) {
    if (isNearGraduationException) {
      return {
        status: "TAILOR",
        ruleId: "T2_GRADUATE_ROLE_TIMING_REVIEW",
        reason: `This appears to be a graduate role and your subclass 500 visa has approximately ${profile.monthsRemaining} months remaining. The advertised work-right requirement may apply at the role's commencement rather than at application time. Confirm the commencement date and required work rights with the employer.`,
        evidence: evidenceFrom(job.workRightsRequirement!),
      };
    }

    return {
      status: "SKIP",
      ruleId: "T1_FULL_WORK_RIGHTS_STUDENT_500",
      reason:
        "This role requires full or unrestricted working rights. The selected subclass 500 profile is currently in study term and has work-hour restrictions.",
      evidence: evidenceFrom(job.workRightsRequirement!),
    };
  }

  // Important:
  // - subclass 485 is NOT blocked merely because
  //   the ad asks for full/unrestricted work rights.
  // - subclass 500 outside study term is also not
  //   automatically blocked by this phrase alone.
  // - generic wording such as "legally entitled to work"
  //   is not treated as a hard blocker by itself.

  // =======================================
  // HOURS — PROFILE AWARE
  // =======================================

  if (is500StudyTerm && weeklyHours !== undefined) {
    const fortnightlyHours = weeklyHours * 2;

    if (fortnightlyHours > 48) {
      if (isNearGraduationException) {
        return {
          status: "TAILOR",
          ruleId: "T2_GRADUATE_ROLE_TIMING_REVIEW",
          reason: `This appears to be a graduate role and your subclass 500 visa has approximately ${profile.monthsRemaining} months remaining. The advertised hours requirement may apply at the role's commencement rather than at application time. Confirm the commencement date and required work rights with the employer.`,
          evidence: evidenceFrom(job.hoursPerWeek!),
        };
      }

      return {
        status: "SKIP",
        ruleId: "T1_STUDENT_500_STUDY_TERM_HOURS",
        reason:
          "Based on the advertised weekly hours, this role would exceed the 48-hours-per-fortnight threshold used for the selected subclass 500 study-term profile. Review your actual visa conditions before applying.",
        evidence: evidenceFrom(job.hoursPerWeek!),
      };
    }
  }

  // =======================================
  // TIER 2 — CONDITIONAL
  // =======================================

  // Professional registration / admission:
  // e.g. AHPRA, legal admission,
  // practising certificate.
  //
  // We do not currently ask whether the user
  // already holds the registration, so this remains
  // TAILOR rather than SKIP.
  if (job.registration) {
    return {
      status: "TAILOR",
      ruleId: "T2_PROFESSIONAL_REGISTRATION",
      reason:
        "The role requires professional registration or admission. Check whether you already hold or can obtain the required registration before applying.",
      evidence: evidenceFrom(job.registration),
    };
  }

  // Employer asks temporary/student visa holders
  // to explain future visa plans.
  if (job.visaPlanRequirement) {
    return {
      status: "TAILOR",
      ruleId: "T2_VISA_PLAN_REQUIRED",
      reason:
        "The employer asks temporary visa holders to explain their visa plans. Treat this as a condition to address rather than a structural blocker.",
      evidence: evidenceFrom(job.visaPlanRequirement),
    };
  }

  // Generic work-right wording such as
  // "legally entitled to work in Australia"
  // is not enough to conclude SKIP.
  //
  // For subclass 500, surface it for review.
  if (
    job.workRightsRequirement &&
    profile?.subclass === "500" &&
    !explicitFullWorkRights
  ) {
    return {
      status: "TAILOR",
      ruleId: "T2_WORK_RIGHTS_REVIEW",
      reason:
        "The advertisement requires legal work rights in Australia but does not explicitly require unrestricted rights. Review the requirement against the conditions of your selected visa profile.",
      evidence: evidenceFrom(job.workRightsRequirement),
    };
  }

  // No sponsorship does not automatically mean
  // the candidate cannot work in the role.
  //
  // It remains a longer-term consideration.
  if (job.sponsorship) {
    const sponsorshipText = `${job.sponsorship.text} ${job.sponsorship.value}`;

    const noSponsorship = containsAny(sponsorshipText, [
      "no sponsorship",
      "no visa sponsorship",
      "sponsorship not available",
      "cannot sponsor",
      "cannot sponsor people",
      "cannot sponsor visas",
      "unable to sponsor",
      "not able to sponsor",
      "not willing to sponsor",
      "will not sponsor",
    ]);

    if (noSponsorship) {
      return {
        status: "TAILOR",
        ruleId: "T2_NO_SPONSORSHIP",

        reason:
          profile?.subclass === "485"
            ? "This employer does not offer sponsorship. You may still have current work rights, but consider this against your longer-term visa pathway."
            : "This employer does not offer sponsorship. Check whether the role aligns with your current and future work-rights situation.",

        evidence: evidenceFrom(job.sponsorship),
      };
    }
  }

  // Permanent full-time employment is not a
  // hard blocker by itself.
  //
  // For 500 holders especially, it is worth checking
  // against study-term restrictions and visa runway.
  if (
    job.employmentType &&
    containsAny(job.employmentType.text, [
      "permanent full-time",
      "permanent full time",
    ])
  ) {
    if (profile?.subclass === "500") {
      return {
        status: "TAILOR",
        ruleId: "T2_PERMANENT_FULL_TIME",

        reason:
          profile.monthsRemaining !== undefined
            ? `This is a permanent full-time role. Compare the role expectations with your subclass 500 conditions and your remaining visa runway of approximately ${profile.monthsRemaining} months.`
            : "This is a permanent full-time role. Check whether its work pattern and duration align with your subclass 500 conditions.",

        evidence: evidenceFrom(job.employmentType),
      };
    }

    // For subclass 485, permanent full-time
    // employment is not treated as a blocker
    // by itself.
  }

  // Australian/local experience is a softer
  // application-fit requirement.
  if (job.australianExperienceRequirement) {
    return {
      status: "TAILOR",
      ruleId: "T2_AUSTRALIAN_EXPERIENCE",

      reason:
        "The advertisement asks for Australian experience. This is treated as a condition to address in your application rather than a structural eligibility blocker.",

      evidence: evidenceFrom(job.australianExperienceRequirement),
    };
  }

  // =======================================
  // NO BLOCKER DETECTED
  // =======================================

  return {
    status: "APPLY",
    reason: "No eligibility blockers detected for the selected profile.",
  };
}

// =======================================
// TIER 3 — FIT SIGNALS
//
// These help prioritise applications.
// They NEVER change the eligibility verdict.
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
    const preferred = profile.preferredLocation?.trim();
    const isAnywhere = !preferred;

    if (!isAnywhere) {
      const locationMatch = matchesState(
        `${job.location.value} ${job.location.text}`,
        preferred
      );

      signals.push({
        id: locationMatch ? "T3_LOCATION_MATCH" : "T3_LOCATION_DIFFERENT",
        status: locationMatch ? "MATCH" : "INFO",
        label: "Location fit",
        reason: locationMatch
          ? `The role location matches your preferred state: ${preferred}.`
          : `The role is located at ${job.location.text}, outside your preferred state of ${preferred}.`,
        evidence: evidenceFrom(job.location),
      });
    }
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
