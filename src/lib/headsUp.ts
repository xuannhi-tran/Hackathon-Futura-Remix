import type {
  EvidenceField,
  ExtractedJobAd,
  FitProfile,
  VisaProfile,
} from "../types/job";
import { evaluateJob, extractFirstNumber } from "./rules";

// =======================================
// HEADS-UPS
//
// Non-visa observations shown next to the verdict so an APPLY never hides
// obvious fit problems. They read only fields that were already extracted plus
// the user's profile, and they NEVER change the verdict: evaluateJob is called
// here only to avoid repeating a reason the verdict already gives.
// =======================================

export type HeadsUp = {
  id: string;
  severity: "warn" | "info";
  message: string;
  evidence?: {
    text: string;
    start: number;
    end: number;
  };
};

export type HeadsUpProfile = VisaProfile & Pick<FitProfile, "yearsExperience">;

/** Most heads-ups ever returned (after ordering by severity). */
export const MAX_HEADS_UPS = 3;

/** The ad must ask for at least this many more years than the profile has. */
const EXPERIENCE_GAP_YEARS = 2;

/**
 * Verdicts whose reason already covers the full-time / hours problem for a
 * subclass 500 student. The full-time heads-up is not repeated alongside them.
 */
export const FULL_TIME_COVERED_BY_VERDICT: ReadonlySet<string> = new Set([
  "T1_STUDENT_500_STUDY_TERM_HOURS",
  "T1_FULL_WORK_RIGHTS_STUDENT_500",
  "T2_PERMANENT_FULL_TIME",
  "T2_GRADUATE_ROLE_TIMING_REVIEW",
]);

function evidenceFrom(field: EvidenceField) {
  return { text: field.text, start: field.start, end: field.end };
}

function isFullTime(field?: EvidenceField): field is EvidenceField {
  if (!field) return false;

  return /\bfull[\s-]?time\b/i.test(field.text) && !/\bpart[\s-]?time\b/i.test(field.text);
}

const SEVERITY_ORDER = { warn: 0, info: 1 } as const;

export function evaluateHeadsUps(
  job: ExtractedJobAd,
  profile: HeadsUpProfile
): HeadsUp[] {
  const headsUps: HeadsUp[] = [];

  // -----------------------
  // EXPERIENCE_GAP
  // -----------------------

  const requestedYears = extractFirstNumber(job.yearsExperience);

  if (
    requestedYears !== undefined &&
    job.yearsExperience &&
    Number.isFinite(profile.yearsExperience) &&
    requestedYears - profile.yearsExperience >= EXPERIENCE_GAP_YEARS
  ) {
    headsUps.push({
      id: "EXPERIENCE_GAP",
      severity: "warn",
      message: `This ad asks for ${requestedYears}+ years of experience; your profile says ${profile.yearsExperience}. Consider whether it is realistic before applying.`,
      evidence: evidenceFrom(job.yearsExperience),
    });
  }

  // -----------------------
  // FULL_TIME_STUDENT_500
  // -----------------------

  if (
    profile.subclass === "500" &&
    profile.duringStudyTerm &&
    isFullTime(job.employmentType)
  ) {
    const verdict = evaluateJob(job, profile);

    if (!verdict.ruleId || !FULL_TIME_COVERED_BY_VERDICT.has(verdict.ruleId)) {
      headsUps.push({
        id: "FULL_TIME_STUDENT_500",
        severity: "warn",
        message:
          "Full-time hours may exceed the 48-hours-per-fortnight limit that applies to subclass 500 during study term. Check your actual visa conditions.",
        evidence: evidenceFrom(job.employmentType),
      });
    }
  }

  // Stable sort: severity first, rule order within a severity.
  return headsUps
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, MAX_HEADS_UPS);
}
