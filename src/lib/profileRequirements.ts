import type { StoredProfile } from "./localState";

// =======================================
// REQUIRED PROFILE FIELDS
//
// A first-time user must set these on purpose before the first analysis,
// instead of running it on silent defaults. "Unset" is null, which is distinct
// from a deliberate choice: preferredLocation "" means "Anywhere in Australia".
//
// Whether a profile is confirmed is derived from the fields being set; there is
// no separate "confirmed" flag to store.
// =======================================

export type VisaSubclass = "500" | "485";

export type ProfileDraft = {
  visaSubclass: VisaSubclass | null;
  duringStudyTerm: boolean | null;
  /** Required for subclass 500; optional for 485. */
  monthsRemaining: number | null;
  yearsExperience: number | null;
  preferredLocation: string | null;
};

export type RequiredProfileField = keyof ProfileDraft;

/** In display order. The names double as the form field ids. */
export const REQUIRED_PROFILE_FIELDS: readonly RequiredProfileField[] = [
  "visaSubclass",
  "duringStudyTerm",
  "monthsRemaining",
  "yearsExperience",
  "preferredLocation",
];

export const REQUIRED_FIELD_LABELS: Record<RequiredProfileField, string> = {
  visaSubclass: "Visa subclass",
  duringStudyTerm: "Currently studying?",
  monthsRemaining: "Months remaining on visa",
  yearsExperience: "Years of experience",
  preferredLocation: "Preferred state/territory",
};

export const PROFILE_REQUIRED_HINT =
  "Set your visa and experience first so the result fits you.";

export const EMPTY_PROFILE_DRAFT: ProfileDraft = {
  visaSubclass: null,
  duringStudyTerm: null,
  monthsRemaining: null,
  yearsExperience: null,
  preferredLocation: null,
};

function isValidCount(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * The required fields that are still unset, in display order. "Currently
 * studying?" and "Months remaining" only apply to subclass 500; with no
 * subclass chosen yet they are not asked for until the subclass is.
 */
export function missingRequiredProfileFields(
  profile: ProfileDraft
): RequiredProfileField[] {
  const missing: RequiredProfileField[] = [];

  if (profile.visaSubclass === null) missing.push("visaSubclass");

  if (profile.visaSubclass === "500" && profile.duringStudyTerm === null) {
    missing.push("duringStudyTerm");
  }

  if (profile.visaSubclass === "500" && !isValidCount(profile.monthsRemaining)) {
    missing.push("monthsRemaining");
  }

  if (!isValidCount(profile.yearsExperience)) missing.push("yearsExperience");

  if (profile.preferredLocation === null) missing.push("preferredLocation");

  return missing;
}

export type ConfirmedProfile = {
  visaSubclass: VisaSubclass;
  /** Always false for subclass 485. */
  duringStudyTerm: boolean;
  /** Always set for 500; for 485 only if the user chose to enter it. */
  monthsRemaining?: number;
  yearsExperience: number;
  preferredLocation: string;
};

/** The profile with every required field set, or null while any is missing. */
export function confirmedProfile(profile: ProfileDraft): ConfirmedProfile | null {
  if (missingRequiredProfileFields(profile).length > 0) return null;

  return {
    visaSubclass: profile.visaSubclass as VisaSubclass,
    duringStudyTerm:
      profile.visaSubclass === "500" ? profile.duringStudyTerm === true : false,
    monthsRemaining: isValidCount(profile.monthsRemaining)
      ? profile.monthsRemaining
      : undefined,
    yearsExperience: profile.yearsExperience as number,
    preferredLocation: profile.preferredLocation as string,
  };
}

/**
 * The starting draft for a visitor: a saved profile restores whatever valid
 * fields it holds, and every other required field stays unset. No saved
 * profile (first visit) leaves all of them unset.
 */
export function draftFromSavedProfile(
  saved: Partial<StoredProfile> | null | undefined
): ProfileDraft {
  if (!saved) return { ...EMPTY_PROFILE_DRAFT };

  return {
    visaSubclass: saved.visaSubclass ?? null,
    duringStudyTerm: saved.duringStudyTerm ?? null,
    monthsRemaining: saved.monthsRemaining ?? null,
    yearsExperience: saved.yearsExperience ?? null,
    preferredLocation: saved.preferredLocation ?? null,
  };
}

/**
 * The draft after the visa subclass changes, with no stale answers carried
 * across: 485 is never in study term and has no months on record, and coming
 * back to 500 asks for both again.
 */
export function withVisaSubclass(
  draft: ProfileDraft,
  next: VisaSubclass
): ProfileDraft {
  if (next === draft.visaSubclass) return draft;

  if (next === "485") {
    return { ...draft, visaSubclass: next, duringStudyTerm: false, monthsRemaining: null };
  }

  if (draft.visaSubclass === "485") {
    return { ...draft, visaSubclass: next, duringStudyTerm: null, monthsRemaining: null };
  }

  return { ...draft, visaSubclass: next };
}

/** Only the fields that are set, so an unset field is never written as a default. */
export function setFieldsOf(profile: ProfileDraft): Partial<StoredProfile> {
  const fields: Partial<StoredProfile> = {};

  if (profile.visaSubclass !== null) fields.visaSubclass = profile.visaSubclass;
  if (profile.duringStudyTerm !== null) {
    fields.duringStudyTerm = profile.duringStudyTerm;
  }
  if (profile.monthsRemaining !== null) {
    fields.monthsRemaining = profile.monthsRemaining;
  }
  if (profile.yearsExperience !== null) {
    fields.yearsExperience = profile.yearsExperience;
  }
  if (profile.preferredLocation !== null) {
    fields.preferredLocation = profile.preferredLocation;
  }

  return fields;
}
