export type ProfileSummaryInput = {
  visaSubclass: "500" | "485";
  duringStudyTerm: boolean;
  yearsExperience?: number;
  preferredLocation?: string;
};

/**
 * One-line description of the profile an analysis assumed, e.g.
 * "Assuming: Student visa (500), in study term, 0 yrs experience, NSW."
 * Missing values are left out or described plainly, never printed as "undefined".
 */
export function buildProfileSummary(profile: ProfileSummaryInput): string {
  const parts: string[] = [];

  if (profile.visaSubclass === "500") {
    parts.push("Student visa (500)");
    parts.push(profile.duringStudyTerm ? "in study term" : "outside study term");
  } else {
    parts.push("Graduate visa (485)");
  }

  const years = profile.yearsExperience;

  if (typeof years === "number" && Number.isFinite(years) && years >= 0) {
    parts.push(`${years} ${years === 1 ? "yr" : "yrs"} experience`);
  }

  const location = profile.preferredLocation?.trim();
  parts.push(location || "any location");

  return `Assuming: ${parts.join(", ")}.`;
}
