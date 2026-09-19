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

export type JobRecommendation = {
  score: number;
  reasons: string[];
  penalties: string[];
  breakdown: { role: number; location: number; experience: number; profile: number; penalty: number };
};

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
  const role = target.length ? Math.round(40 * Math.max(titleMatches / target.length, 0.75 * allMatches / target.length)) : 0;
  reasons.push(`Role fit +${role}/40: ${role ? `keyword overlap with ${profile.targetField}` : "no target-field keyword match in the available snippet"}.`);

  const preferred = normalise(profile.preferredLocation);
  const locationText = normalise(job.location ?? "");
  const location = !preferred ? 10 : locationText === preferred ? 20
    : ` ${locationText} `.includes(` ${preferred} `) ? 18 : 0;
  reasons.push(`Location fit +${location}/20: ${!preferred ? "no location preference set" : location ? `matches ${profile.preferredLocation}` : "preferred location not matched"}.`);

  // Seniority is read from the title so 'work with senior staff' is not a senior role.
  const senior = /\b(senior|sr|lead|principal|staff|head|director)\b/.test(title);
  const junior = /\b(graduate|junior|jr|entry level|intern|internship)\b/.test(title);
  const yearMatches = [...text.matchAll(/\b(\d+)(?:\s+(?:to\s+)?\d+)?\s*\+?\s*years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|commercial\s+)?experience\b/g)];
  const requestedYears = yearMatches.length ? Math.max(...yearMatches.map((match) => Number(match[1]))) : undefined;
  let experience = 10;
  let experienceReason = "experience level is unspecified";
  if (requestedYears !== undefined) {
    experience = profile.yearsExperience >= requestedYears ? 20 : 0;
    experienceReason = `snippet mentions ${requestedYears} years; your profile has ${profile.yearsExperience}`;
    if (profile.yearsExperience < requestedYears) deduct(15, "Advertised experience exceeds your profile.");
  } else if (junior) {
    experience = profile.yearsExperience <= 2 ? 20 : 10;
    experienceReason = "graduate, junior or entry-level title";
  } else if (senior && profile.yearsExperience >= 5) {
    experience = 20;
    experienceReason = "senior title aligns with your experience level";
  }
  if (senior && profile.yearsExperience < 5) {
    experience = 0;
    deduct(profile.yearsExperience < 3 ? 30 : 15, "Senior, lead, principal or staff-level title is a stretch for your experience.");
  }
  reasons.push(`Experience fit +${experience}/20: ${experienceReason}.`);

  // Thresholds are ranking heuristics, not a determination of individual visa conditions.
  const studyTerm = profile.subclass === "500" && profile.duringStudyTerm;
  const hourMatches = [...text.matchAll(/\b(\d+(?:\.\d+)?)(?:\s+(?:to\s+)?(\d+(?:\.\d+)?))?\s*(?:hours?|hrs?)\s*(?:per|a|each)?\s*(week|weekly|fortnight|fortnightly)\b/g)];
  const highHours = hourMatches.some((match) => Number(match[2] ?? match[1]) > (match[3].startsWith("fortnight") ? 48 : 24));
  if (studyTerm && (/\bfull time\b/.test(text) || highHours)) {
    deduct(25, "Full-time or high-hours wording may conflict with your study-term work pattern.");
  }

  const restrictions = [
    { pattern: /\b(?:australian citizens?(?:hip)?|citizens?(?:hip)? only|permanent residents?(?: only)?|permanent residency|pr only)\b/, label: "Citizenship or permanent-residency wording" },
    { pattern: /\b(?:security clearance|nv1|nv2|baseline clearance)\b/, label: "Security-clearance wording" },
    { pattern: /\b(?:(?:full|unrestricted)(?: australian)? (?:work|working) rights|work(?:ing)? without restriction)\b/, label: "Full or unrestricted work-right wording", studyTermOnly: true },
  ];
  // Work-right wording is penalised only for subclass 500 during study term.
  // Citizenship/PR and clearance wording applies to both subclasses.
  // Apply one strong deduction even if several restrictive phrases occur together.
  const detected = restrictions.filter(({ pattern, studyTermOnly }) =>
    (!studyTermOnly || studyTerm) && pattern.test(text)
  );
  if (detected.length) deduct(40, `${detected.map(({ label }) => label).join("; ")} appears in the snippet; review the full ad.`);

  const durations = [...text.matchAll(/\b(\d+)\s*(month|year)s?\s+(?:fixed term\s+)?contract\b/g)];
  if (profile.monthsRemaining !== undefined && durations.some((match) => Number(match[1]) * (match[2] === "year" ? 12 : 1) > profile.monthsRemaining!)) {
    deduct(15, `Duration/profile mismatch: advertised contract duration exceeds your ${profile.monthsRemaining} months remaining. This is a soft ranking adjustment, not a determination of legal eligibility.`);
  }
  reasons.push("Profile fit +20/20 before deductions: only explicit snippet work-pattern signals are assessed; missing wording does not establish eligibility.");
  return {
    score: Math.max(0, Math.min(100, role + location + experience + 20 - penalty)),
    reasons,
    penalties,
    breakdown: { role, location, experience, profile: 20, penalty },
  };
}
