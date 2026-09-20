import type { FitProfile, VisaProfile } from "../types/job";

export type RecommendationProfile = VisaProfile & FitProfile;

export type RecommendationJob = {
  title: string;
  description?: string;
  location?: string;
  category?: string;
  contractType?: string;
  contractTime?: string;
};

// Temporary heuristic configuration. Replace here when data-driven rules arrive.
const CONFIG = {
  weights: { role: 40, location: 20, experience: 20, profile: 20 },
  partial: { snippetRole: 0.75, unknownLocation: 0.5, regionalLocation: 0.9, unknownExperience: 0.5 },
  penalties: { experience: 15, seniorBeginner: 30, seniorStretch: 15, workPattern: 25, restriction: 40, duration: 15 },
  thresholds: { juniorYears: 2, seniorYears: 5, beginnerYears: 3, weeklyHours: 24, fortnightlyHours: 48, strongRoleRatio: 0.75 },
  score: { min: 0, max: 100 },
} as const;

export type RecommendationSignal = {
  id: string;
  tone: "positive" | "neutral" | "caution";
  text: string;
};

export type JobRecommendation = {
  score: number;
  /** Ordered by importance; consumers may limit the number displayed. */
  signals: RecommendationSignal[];
  reasons: string[];
  penalties: string[];
  breakdown: { role: number; location: number; experience: number; profile: number; penalty: number };
};

// Subclass 500 holders are not blocked from senior/permanent roles by visa
// conditions alone, but the product scope for this profile is early-career
// search — titles must explicitly read as junior/graduate/intern to be shown.
export const JUNIOR_TITLE_PATTERN =
  /\b(graduate|junior|jr|entry level|intern|internship)\b/;

export function isEligibleForSubclass500(title: string) {
  return JUNIOR_TITLE_PATTERN.test(normalise(title));
}

function normalise(text: string) {
  return text.toLowerCase().replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/[^a-z0-9.+]+/g, " ").trim().replace(/\s+/g, " ");
}

function words(text: string) {
  return normalise(text).split(" ").filter(Boolean).map((word) => {
    if (/^engineer(?:ing|s)?$/.test(word)) return "engineer";
    if (/^develop(?:er|ers|ment)$/.test(word)) return "developer";
    return word;
  });
}

/** Snippet ranking only. No eligibility rules, extraction, or verdicts are used. */
export function recommendJob(job: RecommendationJob, profile: RecommendationProfile): JobRecommendation {
  const { weights, partial, thresholds, penalties: deductions } = CONFIG;
  const signals: RecommendationSignal[] = [];
  const reasons: string[] = [];
  const penalties: string[] = [];
  let penalty = 0;
  const deduct = (points: number, reason: string) => {
    penalty += points;
    penalties.push(`-${points}: ${reason}`);
  };
  const title = normalise(job.title);
  const text = normalise(`${job.title} ${job.description ?? ""} ${job.contractTime ?? ""} ${job.contractType ?? ""}`);
  const target = [...new Set(words(profile.targetField))];
  const titleWords = words(job.title);
  const allWords = words(`${job.title} ${job.description ?? ""} ${job.category ?? ""}`);
  const titleMatches = target.filter((word) => titleWords.includes(word)).length;
  const allMatches = target.filter((word) => allWords.includes(word)).length;
  const role = target.length ? Math.round(weights.role * Math.max(titleMatches / target.length, partial.snippetRole * allMatches / target.length)) : 0;
  reasons.push(`Role fit +${role}/${weights.role}: ${role ? `keyword overlap with ${profile.targetField}` : "no target-field keyword match in the available snippet"}.`);

  const preferred = normalise(profile.preferredLocation);
  const locationText = normalise(job.location ?? "");
  const location = !preferred ? weights.location * partial.unknownLocation : locationText === preferred ? weights.location
    : ` ${locationText} `.includes(` ${preferred} `) ? weights.location * partial.regionalLocation : 0;
  reasons.push(`Location fit +${location}/${weights.location}: ${!preferred ? "no location preference set" : location ? `matches ${profile.preferredLocation}` : "preferred location not matched"}.`);

  // Seniority is read from the title so 'work with senior staff' is not a senior role.
  const senior = /\b(senior|sr|lead|principal|staff|head|director)\b/.test(title);
  const junior = JUNIOR_TITLE_PATTERN.test(title);
  const yearMatches = [...text.matchAll(/\b(\d+)(?:\s+(?:to\s+)?\d+)?\s*\+?\s*years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|commercial\s+)?experience\b/g)];
  const requestedYears = yearMatches.length ? Math.max(...yearMatches.map((match) => Number(match[1]))) : undefined;
  let experience: number = weights.experience * partial.unknownExperience;
  let experienceReason = "experience level is unspecified";
  if (requestedYears !== undefined) {
    experience = profile.yearsExperience >= requestedYears ? weights.experience : 0;
    experienceReason = `snippet mentions ${requestedYears} years; your profile has ${profile.yearsExperience}`;
    if (profile.yearsExperience < requestedYears) deduct(deductions.experience, "Advertised experience exceeds your profile.");
  } else if (junior) {
    experience = profile.yearsExperience <= thresholds.juniorYears ? weights.experience : weights.experience * partial.unknownExperience;
    experienceReason = "graduate, junior or entry-level title";
  } else if (senior && profile.yearsExperience >= thresholds.seniorYears) {
    experience = weights.experience;
    experienceReason = "senior title aligns with your experience level";
  }
  if (senior && profile.yearsExperience < thresholds.seniorYears) {
    experience = 0;
    deduct(profile.yearsExperience < thresholds.beginnerYears ? deductions.seniorBeginner : deductions.seniorStretch, "Senior, lead, principal or staff-level title is a stretch for your experience.");
  }
  reasons.push(`Experience fit +${experience}/${weights.experience}: ${experienceReason}.`);

  // Thresholds are ranking heuristics, not a determination of individual visa conditions.
  const studyTerm = profile.subclass === "500" && profile.duringStudyTerm;
  const hourMatches = [...text.matchAll(/\b(\d+(?:\.\d+)?)(?:\s+(?:to\s+)?(\d+(?:\.\d+)?))?\s*(?:hours?|hrs?)\s*(?:per|a|each)?\s*(week|weekly|fortnight|fortnightly)\b/g)];
  const highHours = hourMatches.some((match) => Number(match[2] ?? match[1]) > (match[3].startsWith("fortnight") ? thresholds.fortnightlyHours : thresholds.weeklyHours));
  const workPattern = studyTerm && (/\bfull time\b/.test(text) || highHours);
  if (workPattern) {
    deduct(deductions.workPattern, "Full-time or high-hours wording may conflict with your study-term work pattern.");
  }

  const restrictions = [
    { pattern: /\b(?:australian citizens?(?:hip)?|citizens?(?:hip)? only|permanent residents?(?: only)?|permanent residency|pr only)\b/, summary: "citizenship or permanent residency", label: "Citizenship or permanent-residency wording" },
    { pattern: /\b(?:security clearance|nv1|nv2|baseline clearance)\b/, summary: "security clearance", label: "Security-clearance wording" },
    { pattern: /\b(?:(?:full|unrestricted)(?: australian)? (?:work|working) rights|work(?:ing)? without restriction)\b/, summary: "unrestricted work rights", label: "Full or unrestricted work-right wording", studyTermOnly: true },
  ];
  // Work-right wording is penalised only for subclass 500 during study term.
  // Citizenship/PR and clearance wording applies to both subclasses.
  // Apply one strong deduction even if several restrictive phrases occur together.
  const detected = restrictions.filter(({ pattern, studyTermOnly }) =>
    (!studyTermOnly || studyTerm) && pattern.test(text)
  );
  if (detected.length) deduct(deductions.restriction, `${detected.map(({ label }) => label).join("; ")} appears in the snippet; review the full ad.`);

  const durations = [...text.matchAll(/\b(\d+)\s*(month|year)s?\s+(?:fixed term\s+)?contract\b/g)];
  const durationMismatch = profile.monthsRemaining !== undefined && durations.some((match) => Number(match[1]) * (match[2] === "year" ? 12 : 1) > profile.monthsRemaining!);
  if (durationMismatch) {
    deduct(deductions.duration, `Duration/profile mismatch: advertised contract duration exceeds your ${profile.monthsRemaining} months remaining. This is a soft ranking adjustment, not a determination of legal eligibility.`);
  }
  reasons.push(`Profile fit +${weights.profile}/${weights.profile} before deductions: only explicit snippet work-pattern signals are assessed; missing wording does not establish eligibility.`);
  // Signals derive from rule outcomes, never from parsing human-readable reasons.
  // Their order is part of the engine contract; the UI only supplies styling.
  if (detected.length || workPattern) {
    signals.push({ id: "profile", tone: "caution", text: detected.length
      ? `Summary mentions ${detected.map(({ summary }) => summary).join(", ")}; check the full ad.${workPattern ? " Work hours may also conflict with your study-term pattern." : ""}`
      : "Full-time or high-hours work may not fit your current study-term work pattern." });
  }
  const strongRole = role >= weights.role * thresholds.strongRoleRatio;
  signals.push({ id: "role", tone: strongRole ? "positive" : role > 0 ? "neutral" : "caution",
    text: strongRole ? `Strong match for ${profile.targetField}` : role > 0
      ? `Some overlap with ${profile.targetField}` : `Limited evidence of a match for ${profile.targetField}` });
  signals.push({ id: "location", tone: !preferred ? "neutral" : location > 0 ? "positive" : "caution",
    text: !preferred ? "No preferred location set" : location > 0
      ? `Matches your preferred location: ${profile.preferredLocation}` : "Preferred location not matched in the summary" });
  const experienceMismatch = (requestedYears !== undefined && profile.yearsExperience < requestedYears)
    || (senior && profile.yearsExperience < thresholds.seniorYears);
  const experienceUnknown = requestedYears === undefined && !junior && !senior;
  signals.push({ id: "experience", tone: experienceMismatch ? "caution" : experienceUnknown ? "neutral" : experience === weights.experience ? "positive" : "neutral",
    text: experienceMismatch ? "Role may require more experience than your profile lists"
      : experienceUnknown ? "Experience requirement not specified"
      : experience === weights.experience ? "Experience level appears to match your profile"
      : "Entry-level role; consider whether it suits your experience" });
  if (durationMismatch) {
    signals.push({ id: "duration", tone: "caution", text: "Contract duration may extend beyond your current visa timeframe" });
  }
  return {
    score: Math.max(CONFIG.score.min, Math.min(CONFIG.score.max, role + location + experience + weights.profile - penalty)),
    signals,
    reasons,
    penalties,
    breakdown: { role, location, experience, profile: weights.profile, penalty },
  };
}
