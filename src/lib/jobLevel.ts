import { requestedYearsFromText } from "./jobRecommendation";

// =======================================
// JOB SUGGESTION LEVEL FILTER
//
// Keeps job suggestions at or below the user's level. Used only for
// suggestions; it has nothing to do with eligibility verdicts.
//
// Whole-word, case-insensitive title matching. When unsure, the job is kept.
// =======================================

// An explicit early-career word in the title protects it from every title
// rule below ("Graduate Architect", "Graduate Manager Trainee").
const ENTRY_QUALIFIER =
  /\b(?:graduate|grad|trainee|intern|internship|junior|jr|entry[\s-]level|cadet)\b/i;

// "Associate" also protects manager titles ("Associate Product Manager"), but
// not director / partner ("Associate Director" is senior).
const ASSOCIATE = /\bassociate\b/i;

// Qualifiers that make "consultant" an early-career title.
const CONSULTANT_QUALIFIER =
  /\b(?:junior|jr|graduate|grad|associate|entry[\s-]level|trainee|intern|internship|analyst)\b/i;

const SENIOR = /\b(?:senior|sr)\b/i;
const PRINCIPAL = /\bprincipal\b/i;
// "Lead Generation Specialist" is a sales entry role, not a leadership one.
// Whole-word matching already keeps "Leader" and "Leadership" out.
const LEAD = /\blead\b(?!\s+(?:generation|gen|nurturing|qualification)\b)/i;
// "Staff" alone is common in entry roles ("Retail Staff", "Staff Nurse").
// It only counts as a seniority word before an engineering / specialist noun.
const STAFF =
  /\bstaff\s+(?:software|data|machine|research|applied|security|engineer|developer|scientist|researcher|designer|architect|programmer|consultant)\b/i;
const HEAD_OF = /\bhead\s+of\b/i;
const DIRECTOR = /\bdirector\b/i;
const CHIEF = /\bchief\b/i;
const VP = /\b(?:vp|vice[\s-]president)\b/i;
const MANAGER = /\b(?:manager|managing)\b/i; // includes "General Manager"
const ARCHITECT = /\barchitect\b/i;
const PARTNER = /\bpartner\b/i;
const CONSULTANT = /\bconsultant\b/i;

/** Titles that read as senior leadership: only an explicit entry word protects them. */
const LEADERSHIP_TERMS = [DIRECTOR, CHIEF, VP];

const ENTRY_LEVEL_TERMS = [
  SENIOR,
  PRINCIPAL,
  LEAD,
  STAFF,
  HEAD_OF,
  DIRECTOR,
  CHIEF,
  VP,
  ARCHITECT,
  PARTNER,
];

const MID_LEVEL_TERMS = [SENIOR, PRINCIPAL, LEAD, HEAD_OF, DIRECTOR, CHIEF, VP];

/** Years of experience at which each title rule set applies. */
export const LEVEL_THRESHOLDS = { midFrom: 2, experiencedFrom: 4 } as const;

/** A description asking for this many more years than the profile has is above level. */
export const DESCRIPTION_YEARS_MARGIN = 3;

export function isEntryLevelProfile(profileExperience: number): boolean {
  return profileExperience < LEVEL_THRESHOLDS.midFrom;
}

function titleIsAboveLevel(title: string, years: number): boolean {
  const hasEntryWord = ENTRY_QUALIFIER.test(title);

  if (years >= LEVEL_THRESHOLDS.experiencedFrom) {
    return !hasEntryWord && LEADERSHIP_TERMS.some((term) => term.test(title));
  }

  const terms =
    years >= LEVEL_THRESHOLDS.midFrom ? MID_LEVEL_TERMS : ENTRY_LEVEL_TERMS;

  if (!hasEntryWord && terms.some((term) => term.test(title))) return true;

  if (!hasEntryWord && !ASSOCIATE.test(title) && MANAGER.test(title)) {
    return true;
  }

  // Consultant is only excluded for the entry-level profile.
  return (
    years < LEVEL_THRESHOLDS.midFrom &&
    CONSULTANT.test(title) &&
    !CONSULTANT_QUALIFIER.test(title)
  );
}

/**
 * True when a suggested job is clearly above the user's level.
 *
 * - 0-1 years: senior / lead / principal / staff / head of / director / chief /
 *   vp / manager / architect / partner titles, and "consultant" without an
 *   early-career qualifier.
 * - 2-3 years: senior / principal / lead / head of / director / chief / vp /
 *   manager titles. Consultant is allowed.
 * - 4+ years: only director / chief / vp titles.
 * - Any level: a description asking for N+ years where N is at least
 *   DESCRIPTION_YEARS_MARGIN more than the profile has.
 */
export function isAboveLevel(
  title: string,
  description: string | undefined,
  profileExperience: number
): boolean {
  if (!Number.isFinite(profileExperience) || profileExperience < 0) return false;

  if (titleIsAboveLevel(title, profileExperience)) return true;

  const requestedYears = description
    ? requestedYearsFromText(description)
    : undefined;

  return (
    requestedYears !== undefined &&
    requestedYears >= profileExperience + DESCRIPTION_YEARS_MARGIN
  );
}
