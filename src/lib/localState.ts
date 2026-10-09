/**
 * Browser persistence for saved jobs and the profile form.
 *
 * Data stays in this browser's localStorage: nothing here is sent to the server
 * or to analytics. Every read and write is wrapped in try/catch; if storage is
 * unavailable the functions quietly do nothing and the app keeps working with
 * in-memory React state. Stored data is validated on load, and anything
 * malformed is dropped rather than trusted.
 */

import type { SavedJob, Verdict } from "../types/job";

export const SAVED_JOBS_KEY = "jobcompass:saved:v1";
export const PROFILE_KEY = "jobcompass:profile:v1";
export const MAX_SAVED_JOBS = 50;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoredProfile = {
  visaSubclass: "500" | "485";
  duringStudyTerm: boolean;
  monthsRemaining: number;
  targetField: string;
  preferredLocation: string;
  yearsExperience: number;
};

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJson(key: string, storage: StorageLike | null | undefined): unknown {
  try {
    const target = storage === undefined ? defaultStorage() : storage;
    const raw = target?.getItem(key);

    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(
  key: string,
  value: unknown,
  storage: StorageLike | null | undefined
): void {
  try {
    const target = storage === undefined ? defaultStorage() : storage;

    target?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full, blocked or unavailable: keep working in memory.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function parseVerdict(value: unknown): Verdict | null {
  if (!isRecord(value)) return null;

  const { status, reason, ruleId, evidence } = value;

  if (status !== "APPLY" && status !== "TAILOR" && status !== "SKIP") {
    return null;
  }
  if (typeof reason !== "string" || reason.length > 5000) return null;
  if (ruleId !== undefined && !isNonEmptyString(ruleId, 100)) return null;

  const verdict: Verdict = { status, reason };
  if (ruleId !== undefined) verdict.ruleId = ruleId;

  if (evidence !== undefined) {
    if (
      !isRecord(evidence) ||
      typeof evidence.text !== "string" ||
      !Number.isInteger(evidence.start) ||
      !Number.isInteger(evidence.end) ||
      (evidence.start as number) < 0 ||
      (evidence.end as number) <= (evidence.start as number)
    ) {
      return null;
    }

    verdict.evidence = {
      text: evidence.text,
      start: evidence.start as number,
      end: evidence.end as number,
    };
  }

  return verdict;
}

function parseSavedJob(value: unknown): SavedJob | null {
  if (!isRecord(value)) return null;

  const { id, title, adText } = value;

  if (
    !isNonEmptyString(id, 100) ||
    typeof title !== "string" ||
    title.length > 300 ||
    !isNonEmptyString(adText, 100_000)
  ) {
    return null;
  }

  const verdict = parseVerdict(value.verdict);

  return verdict ? { id, title, adText, verdict } : null;
}

/** Keeps valid, de-duplicated jobs, at most the most recent MAX_SAVED_JOBS. */
export function parseSavedJobs(value: unknown): SavedJob[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const jobs: SavedJob[] = [];

  for (const item of value) {
    const job = parseSavedJob(item);

    if (job && !seen.has(job.id)) {
      seen.add(job.id);
      jobs.push(job);
    }
  }

  return jobs.slice(-MAX_SAVED_JOBS);
}

export function loadSavedJobs(storage?: StorageLike | null): SavedJob[] {
  return parseSavedJobs(readJson(SAVED_JOBS_KEY, storage));
}

export function saveSavedJobs(
  jobs: SavedJob[],
  storage?: StorageLike | null
): void {
  writeJson(SAVED_JOBS_KEY, jobs.slice(-MAX_SAVED_JOBS), storage);
}

export function clearSavedJobs(storage?: StorageLike | null): void {
  try {
    const target = storage === undefined ? defaultStorage() : storage;

    target?.removeItem(SAVED_JOBS_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

function boundedNumber(value: unknown, max: number): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
    ? value
    : undefined;
}

/** Valid fields only; invalid or unknown fields are dropped individually. */
export function parseProfile(value: unknown): Partial<StoredProfile> | null {
  if (!isRecord(value)) return null;

  const profile: Partial<StoredProfile> = {};

  if (value.visaSubclass === "500" || value.visaSubclass === "485") {
    profile.visaSubclass = value.visaSubclass;
  }
  if (typeof value.duringStudyTerm === "boolean") {
    profile.duringStudyTerm = value.duringStudyTerm;
  }

  const months = boundedNumber(value.monthsRemaining, 120);
  if (months !== undefined) profile.monthsRemaining = months;

  const years = boundedNumber(value.yearsExperience, 60);
  if (years !== undefined) profile.yearsExperience = years;

  // Empty is valid: "Anywhere in Australia" is the empty location.
  if (typeof value.targetField === "string" && value.targetField.length <= 100) {
    profile.targetField = value.targetField;
  }
  if (
    typeof value.preferredLocation === "string" &&
    value.preferredLocation.length <= 100
  ) {
    profile.preferredLocation = value.preferredLocation;
  }

  return profile;
}

export function loadProfile(
  storage?: StorageLike | null
): Partial<StoredProfile> | null {
  return parseProfile(readJson(PROFILE_KEY, storage));
}

export function saveProfile(
  profile: StoredProfile,
  storage?: StorageLike | null
): void {
  writeJson(PROFILE_KEY, profile, storage);
}
